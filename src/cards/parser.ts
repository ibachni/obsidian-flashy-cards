import { App, TFile } from "obsidian";
import {
	CardFrontmatter,
	CardFrontmatterOnDisk,
	type CardFrontmatterOnDiskT,
	type CardFrontmatterT,
	type ClozeFsrsSlotT,
} from "../schema/card";
import type { FsrsUpdate } from "../srs/fsrs-engine";
import {
	collectClozeIndices,
	maskField,
	revealField,
} from "./cloze";
import {
	expandOcclusionSiblings,
	readOcclusionSet,
	resolveOcclusionJsonPath,
	type OcclusionIODeps,
} from "./occlusion";

/**
 * In-memory card identity. For non-cloze cards `id === path`. For
 * cloze siblings `id === \`${path}#c${clozeIndex}\``. For occlusion
 * siblings `id === \`${path}#m${maskIndex}\``. This is the single seam
 * where one .md file can become N cards downstream.
 */
export interface ParsedCard {
	id: string;
	path: string;
	/**
	 * `null` for non-cloze cards. For cloze siblings, the cloze number
	 * this sibling represents (e.g. 1, 2, 3 …). Mutually exclusive with
	 * `maskIndex` — a card is either a cloze sibling or an occlusion
	 * sibling or neither.
	 */
	clozeIndex: number | null;
	/**
	 * `undefined` for non-occlusion cards. For occlusion siblings, the
	 * 1-based mask number this sibling represents. Carries through to
	 * the renderer so it knows which rectangle to fill on the Q side.
	 */
	maskIndex?: number;
	fm: CardFrontmatterT;
	/** Pre-rendered question for this sibling (cloze masking applied). */
	question: string;
	/** Pre-rendered answer for this sibling (cloze highlight applied). */
	answer: string;
	/**
	 * Raw question source with cloze syntax intact. Only populated for
	 * cloze siblings — the EditCardModal uses this so the user edits
	 * the source `{{cN::…}}` form, not the masked view.
	 */
	rawQuestion?: string;
	/** Raw answer source with cloze syntax intact. Cloze siblings only. */
	rawAnswer?: string;
}

export type ParseOutcome =
	| { kind: "parsed"; cards: ParsedCard[] }
	| { kind: "invalid"; path: string; error: string }
	| { kind: "skipped"; path: string };

export interface ScanResult {
	parsed: ParsedCard[];
	invalid: { path: string; error: string }[];
	skipped: number;
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Split a card body on H1 headings into a record of `heading → content`.
 * Naive splitter — does not handle H1s appearing inside code blocks.
 * The risk register notes this as a known edge case (P1 risks table).
 *
 * Exported for unit-testing.
 */
export function parseBodySections(body: string): Record<string, string> {
	const parts = body.split(/^# (.+)$/m);
	// parts[0] is preamble (before first H1); parts[2k-1] is heading k, parts[2k] is content.
	const sections: Record<string, string> = {};
	for (let i = 1; i + 1 < parts.length; i += 2) {
		const heading = parts[i];
		const content = parts[i + 1];
		if (heading === undefined || content === undefined) continue;
		sections[heading.trim()] = content.trim();
	}
	return sections;
}

/**
 * Inverse of `projectSlotToFm` — extract the unprefixed slot shape
 * from a flat in-memory `CardFrontmatterT`. Used by the grade-write
 * and undo-restore paths in main.tsx when targeting `fsrs_clozes[N]`.
 *
 * Keep in sync with `FsrsFlatShape` in src/schema/card.ts and the
 * `ClozeFsrsSlot` schema — same fields, no `fsrs_` prefix on the slot
 * side.
 */
export function fmToClozeSlot(fm: CardFrontmatterT): ClozeFsrsSlotT {
	return {
		due: fm.fsrs_due,
		stability: fm.fsrs_stability,
		difficulty: fm.fsrs_difficulty,
		elapsed_days: fm.fsrs_elapsed_days,
		scheduled_days: fm.fsrs_scheduled_days,
		learning_steps: fm.fsrs_learning_steps,
		reps: fm.fsrs_reps,
		lapses: fm.fsrs_lapses,
		state: fm.fsrs_state,
		last_review: fm.fsrs_last_review,
	};
}

/**
 * Apply a grade result to a raw frontmatter object in place. Pure
 * (no I/O, no Obsidian imports past type-only) so the cloze vs.
 * non-cloze branch is unit-testable without an App mock.
 *
 * - Non-cloze: assigns the flat `fsrs_*` scalars onto `raw` directly.
 * - Cloze sibling: serializes the merged scalar view into
 *   `raw.fsrs_clozes[String(clozeIndex)]` as an unprefixed slot,
 *   creating the `fsrs_clozes` map if it didn't exist (first-grade
 *   case where the parser had synthesized the slot in memory).
 *
 * Bumps `modified` either way. `card.clozeIndex === null` is the
 * non-cloze discriminator.
 */
export function applyGradeUpdate(
	raw: Record<string, unknown>,
	card: ParsedCard,
	update: FsrsUpdate,
	modified: string,
): void {
	if (card.clozeIndex !== null) {
		const clozes =
			(raw.fsrs_clozes as Record<string, unknown> | undefined) ?? {};
		// Merge the projected card.fm with the FSRS update so the slot
		// carries the full post-grade FSRS state. Only the FSRS fields
		// matter — fmToClozeSlot ignores everything else.
		const merged: CardFrontmatterT = { ...card.fm, ...update };
		clozes[String(card.clozeIndex)] = fmToClozeSlot(merged);
		raw.fsrs_clozes = clozes;
		raw.modified = modified;
	} else {
		Object.assign(raw, update, { modified });
	}
}

/**
 * Restore a pre-grade frontmatter snapshot in place. Inverse of
 * `applyGradeUpdate`. Same shape: cloze siblings write to
 * `fsrs_clozes[N]`, non-cloze cards Object.assign flat scalars (and
 * `modified`) back.
 *
 * Takes the `clozeIndex` + `previousFm` pair directly rather than a
 * full `UndoEntry` so the helper is decoupled from the undo-buffer
 * module's exact shape — tests don't have to construct a `cardId`
 * just to verify the mutation.
 */
export function applyUndoRestore(
	raw: Record<string, unknown>,
	entry: { clozeIndex: number | null; previousFm: CardFrontmatterT },
): void {
	if (entry.clozeIndex !== null) {
		const clozes =
			(raw.fsrs_clozes as Record<string, unknown> | undefined) ?? {};
		clozes[String(entry.clozeIndex)] = fmToClozeSlot(entry.previousFm);
		raw.fsrs_clozes = clozes;
		// Restore `modified` for round-trip symmetry with the grade path,
		// which bumped it forward.
		raw.modified = entry.previousFm.modified;
	} else {
		// Object.assign restores flat scalars and `modified` in one go.
		// Only overwrites keys present in previousFm — keys the user
		// added mid-window survive; keys they removed aren't re-added.
		Object.assign(raw, entry.previousFm);
	}
}

/**
 * Build an in-memory `new`-state FSRS slot for a cloze sibling whose
 * body marker exists but whose on-disk slot doesn't yet (the user just
 * added `{{cN::…}}` to the card). The values mirror what a freshly
 * created card would get: zeroed counters, `state: "new"`, and `due`
 * set to a far-past date so the picker surfaces it immediately.
 *
 * Phase 2 persists this slot on the first grade write — `applyGradeUpdate`
 * creates the `fsrs_clozes[N]` entry on disk from the gradeWith output.
 */
function synthesizeNewSlot(): ClozeFsrsSlotT {
	return {
		// Epoch start — older than any plausible card creation date so
		// `due <= now` is trivially true and the sibling lands in the
		// review queue right away.
		due: "1970-01-01",
		stability: 0,
		difficulty: 0,
		elapsed_days: 0,
		scheduled_days: 0,
		learning_steps: 0,
		reps: 0,
		lapses: 0,
		state: "new",
		last_review: null,
	};
}

/**
 * Project a `fsrs_clozes[N]` slot (unprefixed field names) plus the
 * card's base (non-FSRS) fields into the flat `CardFrontmatterT` shape
 * that every downstream consumer expects. The parser hides the slot
 * indirection from the rest of the codebase — picker, FSRS engine,
 * Review pane all see scalar `fm.fsrs_*` regardless of whether the
 * source file held flat scalars or a `fsrs_clozes` map.
 *
 * Keep in sync with `FsrsFlatShape` in src/schema/card.ts — when that
 * schema gains a field, this projection must too.
 */
function projectSlotToFm(
	base: CardFrontmatterOnDiskT,
	slot: ClozeFsrsSlotT,
): CardFrontmatterT {
	return {
		type: base.type,
		topic: base.topic,
		section: base.section,
		created: base.created,
		modified: base.modified,
		tags: base.tags,
		related: base.related,
		fsrs_due: slot.due,
		fsrs_stability: slot.stability,
		fsrs_difficulty: slot.difficulty,
		fsrs_elapsed_days: slot.elapsed_days,
		fsrs_scheduled_days: slot.scheduled_days,
		fsrs_learning_steps: slot.learning_steps,
		fsrs_reps: slot.reps,
		fsrs_lapses: slot.lapses,
		fsrs_state: slot.state,
		fsrs_last_review: slot.last_review,
	};
}

/**
 * Pure expansion: given a validated on-disk frontmatter + question +
 * answer + path, produce the in-memory `ParsedCard[]`. Extracted from
 * `parseCardFile` so it's unit-testable without an Obsidian App mock —
 * everything Obsidian-aware lives in the caller (file read, metadata
 * cache, schema validation).
 *
 * Returns either the expanded card list or a structured error to
 * surface upstream as `kind: "invalid"`.
 */
export function expandCard(
	path: string,
	data: CardFrontmatterOnDiskT,
	question: string,
	answer: string,
): { kind: "parsed"; cards: ParsedCard[] } | { kind: "invalid"; error: string } {
	// Cloze form: expand into one ParsedCard per unique cloze index found
	// across both question and answer. The refine on CardFrontmatterOnDisk
	// guarantees fsrs_clozes !== undefined here implies all flat fsrs_*
	// are absent.
	if (data.fsrs_clozes !== undefined) {
		const indices = collectClozeIndices(question, answer);
		if (indices.length === 0) {
			// fsrs_clozes is present on disk but the body has no cloze
			// syntax — the user is mid-edit (removed all cloze markers
			// without cleaning frontmatter) or the file was hand-rolled
			// incorrectly. Flag as invalid so it shows up in the Browse
			// invalid list instead of silently producing zero cards.
			return {
				kind: "invalid",
				error:
					"fsrs_clozes is set but body has no {{cN::…}} markers — remove fsrs_clozes or add cloze syntax",
			};
		}

		const cards: ParsedCard[] = [];
		for (const n of indices) {
			// Cloze body marker exists but no on-disk slot yet — the user
			// just added `{{cN::…}}`. Synthesize a `new`-state slot in
			// memory so the sibling appears in the picker; the first grade
			// will persist the slot to disk via gradeAndPersist.
			const slot = data.fsrs_clozes[String(n)] ?? synthesizeNewSlot();
			cards.push({
				id: `${path}#c${n}`,
				path,
				clozeIndex: n,
				fm: projectSlotToFm(data, slot),
				question: maskField(question, n),
				answer: revealField(answer, n),
				rawQuestion: question,
				rawAnswer: answer,
			});
		}
		return { kind: "parsed", cards };
	}

	// Non-cloze form: re-parse through the strict in-memory schema. The
	// OnDisk refine guarantees this won't fail in practice, but the
	// second parse (a) applies `fsrs_learning_steps`'s default(0) for
	// cards predating ts-fsrs 5.x and (b) lets TypeScript see the
	// narrowed required-fields shape without an `as unknown` cast.
	const flatResult = CardFrontmatter.safeParse(data);
	if (!flatResult.success) {
		// Reaching here means the OnDisk refine accepted something the
		// in-memory schema rejects — a schema-internal bug, not a user
		// error. Surface as invalid so the file is visible in Browse.
		const error = flatResult.error.issues
			.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
			.join("; ");
		return { kind: "invalid", error: `schema invariant: ${error}` };
	}
	return {
		kind: "parsed",
		cards: [
			{
				id: path,
				path,
				clozeIndex: null,
				fm: flatResult.data,
				question,
				answer,
			},
		],
	};
}

/**
 * Resolve + read the occlusion sidecar JSON for a card whose
 * frontmatter sets `occlusion_source`, then expand into per-mask
 * siblings. Returns either the expanded `ParsedCard[]` or a
 * structured error to surface as `kind: "invalid"`.
 *
 * Split out from `parseCardFile` so the I/O dep is injectable —
 * `parseCardFile` wires `app.vault.adapter`, tests can wire a fake
 * reader against a `Record<string, string>` of JSON contents.
 */
export async function parseOcclusionCard(
	deps: OcclusionIODeps,
	path: string,
	data: CardFrontmatterOnDiskT,
): Promise<
	| { kind: "parsed"; cards: ParsedCard[] }
	| { kind: "invalid"; error: string }
> {
	// The refine guarantees occlusion_source is set when this branch
	// fires, but the type is still `string | undefined` after Zod —
	// guard explicitly so the rest of this function reads cleanly.
	const source = data.occlusion_source;
	if (!source) {
		return {
			kind: "invalid",
			error: "occlusion branch entered without occlusion_source",
		};
	}
	const jsonPath = resolveOcclusionJsonPath(path, source);
	const read = await readOcclusionSet(deps, jsonPath);
	switch (read.kind) {
		case "missing":
			return {
				kind: "invalid",
				error: `occlusion sidecar not found: ${jsonPath} — the .md was moved without the .occlusion.json`,
			};
		case "invalid":
			return {
				kind: "invalid",
				error: `occlusion sidecar invalid: ${read.error}`,
			};
		case "ok": {
			const cards = expandOcclusionSiblings(path, data, read.set);
			return { kind: "parsed", cards };
		}
	}
}

export async function parseCardFile(
	app: App,
	file: TFile,
): Promise<ParseOutcome> {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter;

	if (!fm || fm.type !== "flashcard") {
		return { kind: "skipped", path: file.path };
	}

	const result = CardFrontmatterOnDisk.safeParse(fm);
	if (!result.success) {
		const error = result.error.issues
			.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
			.join("; ");
		return { kind: "invalid", path: file.path, error };
	}

	// Occlusion branch: the sidecar JSON is the source of truth for
	// masks and per-mask FSRS state. The markdown body is informational
	// only — skip the # Question / # Answer requirement entirely.
	if (result.data.occlusion_source !== undefined) {
		// Read-only deps: the parser never writes. Inlined here rather
		// than reused from occlusion-io.ts so this module stays free of
		// a runtime `obsidian` import — `TFile` as a value would pull
		// in the obsidian package whose `"main": ""` breaks vitest.
		const readOnlyDeps: OcclusionIODeps = {
			read: async (p) => {
				const exists = await app.vault.adapter.exists(p);
				return exists ? app.vault.adapter.read(p) : null;
			},
			write: async () => {
				throw new Error("parser must not write occlusion sidecars");
			},
		};
		const outcome = await parseOcclusionCard(
			readOnlyDeps,
			file.path,
			result.data,
		);
		if (outcome.kind === "invalid") {
			return { kind: "invalid", path: file.path, error: outcome.error };
		}
		return { kind: "parsed", cards: outcome.cards };
	}

	const content = await app.vault.cachedRead(file);
	const body = stripFrontmatter(content);
	const sections = parseBodySections(body);
	const question = sections["Question"];
	const answer = sections["Answer"];

	if (!question || !answer) {
		const missing = [
			!question ? "# Question" : null,
			!answer ? "# Answer" : null,
		]
			.filter(Boolean)
			.join(" and ");
		return {
			kind: "invalid",
			path: file.path,
			error: `body missing ${missing}`,
		};
	}

	const expanded = expandCard(file.path, result.data, question, answer);
	if (expanded.kind === "invalid") {
		return { kind: "invalid", path: file.path, error: expanded.error };
	}
	return { kind: "parsed", cards: expanded.cards };
}

export async function scanCards(
	app: App,
	cardsRoot: string,
): Promise<ScanResult> {
	const parsed: ParsedCard[] = [];
	const invalid: { path: string; error: string }[] = [];
	let skipped = 0;

	const root = cardsRoot.endsWith("/") ? cardsRoot : cardsRoot + "/";

	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(root)) continue;
		const outcome = await parseCardFile(app, file);
		switch (outcome.kind) {
			case "parsed":
				for (const card of outcome.cards) parsed.push(card);
				break;
			case "invalid":
				invalid.push({ path: outcome.path, error: outcome.error });
				break;
			case "skipped":
				skipped++;
				break;
		}
	}

	return { parsed, invalid, skipped };
}
