import { z } from "zod";

import {
	CardFrontmatter,
	type CardFrontmatterOnDiskT,
	type CardFrontmatterT,
	type FsrsFlatT,
} from "../schema/card";
import type { ParsedCard } from "./parser";

/**
 * Per-mask FSRS block stored inside the JSON sidecar. Mirrors the
 * flat `fsrs_*` shape in card.ts so the parser can project
 * `masks[N].fsrs` straight into `ParsedCard.fm` without renaming
 * fields. `null` means "new card — no schedule yet"; the parser
 * synthesizes a default new-state slot when it sees `null`.
 *
 * Defined locally rather than imported from card.ts so the JSON
 * schema can evolve independently (e.g. accept a missing
 * `fsrs_learning_steps` on disk via `.default(0)` without touching
 * markdown frontmatter validation).
 */
const FsrsBlock = z.object({
	fsrs_due: z.string(),
	fsrs_stability: z.number(),
	fsrs_difficulty: z.number(),
	fsrs_elapsed_days: z.number(),
	fsrs_scheduled_days: z.number(),
	fsrs_learning_steps: z.number().int().nonnegative().default(0),
	fsrs_reps: z.number().int().nonnegative(),
	fsrs_lapses: z.number().int().nonnegative(),
	fsrs_state: z.enum(["new", "learning", "review", "relearning"]),
	fsrs_last_review: z.string().nullable(),
});

export const OcclusionMask = z.object({
	// Pixel coordinates in image-pixel space (not normalized). v1
	// limitation — swapping the source image requires re-drawing masks.
	x: z.number().int().nonnegative(),
	y: z.number().int().nonnegative(),
	w: z.number().int().positive(),
	h: z.number().int().positive(),
	// `null` for unscheduled (new) masks. The editor writes new masks
	// with `fsrs: null`; the parser synthesizes new-state defaults so
	// the sibling lands in the picker immediately; the first grade
	// write fills in real values.
	fsrs: FsrsBlock.nullable(),
});

export type OcclusionMaskT = z.infer<typeof OcclusionMask>;

/**
 * Q-side rendering mode for the whole occlusion set. All three modes
 * produce N siblings (one per mask); they differ in what the Q side
 * paints over the image:
 *
 * - `hide-one` (default; matches the original v1 behavior) — the
 *   active mask is filled black, others are visible. Classic Anki
 *   image-occlusion shape: "what's behind this rectangle?"
 * - `show-one` — every mask EXCEPT the active one is filled black;
 *   the active mask is a window onto the image. "What part of the
 *   diagram are you looking at?"
 * - `reveal-in-order` — masks at array index < active are revealed,
 *   the active mask + everything after are filled black. The A side
 *   reveals only the active mask, so reviews progress part-by-part.
 *   Array order = reveal sequence; the editor in this mode lets the
 *   user reorder by typing a digit while a mask is selected.
 *
 * The `.default("hide-one")` keeps v1 sidecars (which never wrote a
 * mode field) parsing cleanly with the original behavior — no
 * migration needed.
 */
export const OcclusionMode = z.enum(["hide-one", "show-one", "reveal-in-order"]);
export type OcclusionModeT = z.infer<typeof OcclusionMode>;

export const OcclusionSet = z.object({
	// Vault-relative path to the source image (e.g.
	// `_attachments/anatomy-heart.png`). Vault-relative so the same
	// JSON works regardless of which topic folder the set lives in.
	image: z.string().min(1),
	// Mode is optional on disk with a default so v1 JSONs round-trip
	// cleanly. New sets always write an explicit mode.
	mode: OcclusionMode.default("hide-one"),
	// At least one mask — an empty set is indistinguishable from a
	// deleted card downstream. Editor enforces this on save; the
	// schema is the second line of defense.
	masks: z.array(OcclusionMask).min(1),
});

export type OcclusionSetT = z.infer<typeof OcclusionSet>;

/**
 * True iff mask `i` should be painted black on the current side of
 * the card. Pure function — no React, no DOM — so the rendering
 * logic for all three modes is unit-testable in isolation. The
 * `OcclusionRenderer` calls this once per mask per render.
 *
 * `activeIdx` is the 0-based array index of the sibling currently
 * being reviewed (derived from `ParsedCard.maskIndex - 1`).
 */
export function shouldHideMask(
	i: number,
	activeIdx: number,
	mode: OcclusionModeT,
	revealed: boolean,
): boolean {
	switch (mode) {
		case "hide-one":
			// Q: active is hidden, others visible. A: nothing hidden.
			return !revealed && i === activeIdx;
		case "show-one":
			// Q: only active is visible. A: nothing hidden (full reveal).
			return !revealed && i !== activeIdx;
		case "reveal-in-order":
			// Q: hide active and everything after (already-revealed
			// earlier masks stay visible). A: hide everything strictly
			// after active — the just-answered mask becomes visible too.
			return revealed ? i > activeIdx : i >= activeIdx;
	}
}

/**
 * Default FSRS slot for an unscheduled (new) mask. Values mirror what
 * a freshly created card would get from `newCardFrontmatter`: zeroed
 * counters, `state: "new"`, and `due` set to a far-past date so the
 * picker surfaces the sibling immediately. The first grade write on
 * this mask persists real values into the JSON sidecar.
 *
 * Same shape and rationale as `synthesizeNewSlot` in parser.ts —
 * kept separate because the slot field names differ between the two
 * sibling kinds.
 */
function synthesizeNewMaskFsrs(): FsrsFlatT {
	return {
		fsrs_due: "1970-01-01",
		fsrs_stability: 0,
		fsrs_difficulty: 0,
		fsrs_elapsed_days: 0,
		fsrs_scheduled_days: 0,
		fsrs_learning_steps: 0,
		fsrs_reps: 0,
		fsrs_lapses: 0,
		fsrs_state: "new",
		fsrs_last_review: null,
	};
}

/**
 * Project an occlusion set into N `ParsedCard`s — one per mask.
 *
 * Each sibling:
 *   - `id = "${path}#m${n}"` (1-based, mirrors cloze's `#c<N>` keying)
 *   - `path` = original card path (Obsidian-resolvable; `split('#')[0]` recovers it)
 *   - `clozeIndex = null`, `maskIndex = n` (1-based)
 *   - `fm` carries the markdown-side base frontmatter (topic, tags, …)
 *     plus FSRS scalars projected from `mask.fsrs` (or new-state
 *     defaults when `null`)
 *   - `question` / `answer` are informational placeholders — Review
 *     branches on `fm.occlusion_source` and renders via
 *     `OcclusionRenderer` instead of `MarkdownBlock`, so these strings
 *     are only seen if something downstream forgets to branch.
 *
 * Pure (no Obsidian imports past the type-only `ParsedCard`) so the
 * expansion is unit-testable without an App mock.
 */
export function expandOcclusionSiblings(
	path: string,
	base: CardFrontmatterOnDiskT,
	set: OcclusionSetT,
): ParsedCard[] {
	const total = set.masks.length;
	const cards: ParsedCard[] = [];
	for (let i = 0; i < total; i++) {
		const mask = set.masks[i]!;
		const n = i + 1;
		const slot = mask.fsrs ?? synthesizeNewMaskFsrs();
		const fm: CardFrontmatterT = {
			type: base.type,
			topic: base.topic,
			section: base.section,
			created: base.created,
			modified: base.modified,
			tags: base.tags,
			related: base.related,
			occlusion_source: base.occlusion_source,
			fsrs_due: slot.fsrs_due,
			fsrs_stability: slot.fsrs_stability,
			fsrs_difficulty: slot.fsrs_difficulty,
			fsrs_elapsed_days: slot.fsrs_elapsed_days,
			fsrs_scheduled_days: slot.fsrs_scheduled_days,
			fsrs_learning_steps: slot.fsrs_learning_steps,
			fsrs_reps: slot.fsrs_reps,
			fsrs_lapses: slot.fsrs_lapses,
			fsrs_state: slot.fsrs_state,
			fsrs_last_review: slot.fsrs_last_review,
		};
		// Defensive parse — projection must satisfy CardFrontmatter.
		// Failure here is a schema-internal bug; surface it via a thrown
		// error rather than silently producing a malformed ParsedCard.
		const guard = CardFrontmatter.safeParse(fm);
		if (!guard.success) {
			throw new Error(
				`occlusion projection failed: ${guard.error.issues
					.map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
					.join("; ")}`,
			);
		}
		cards.push({
			id: `${path}#m${n}`,
			path,
			clozeIndex: null,
			maskIndex: n,
			fm: guard.data,
			// Informational only — the Review pane uses OcclusionRenderer
			// for occlusion siblings and never reads these.
			question: `Image occlusion · mask ${n}/${total}`,
			answer: `Image occlusion · mask ${n}/${total} (revealed)`,
		});
	}
	return cards;
}

/**
 * Inverse of `expandOcclusionSiblings` for a single mask — extract the
 * unprefixed-but-not-renamed FSRS block from a flat `CardFrontmatterT`.
 * Same field names on both sides, so this is structural rather than a
 * rename. Used by the grade-write path (Phase 4) to push FSRS state
 * back into the JSON sidecar's `masks[N].fsrs` slot.
 */
export function fmToMaskFsrs(fm: CardFrontmatterT): FsrsFlatT {
	return {
		fsrs_due: fm.fsrs_due,
		fsrs_stability: fm.fsrs_stability,
		fsrs_difficulty: fm.fsrs_difficulty,
		fsrs_elapsed_days: fm.fsrs_elapsed_days,
		fsrs_scheduled_days: fm.fsrs_scheduled_days,
		fsrs_learning_steps: fm.fsrs_learning_steps,
		fsrs_reps: fm.fsrs_reps,
		fsrs_lapses: fm.fsrs_lapses,
		fsrs_state: fm.fsrs_state,
		fsrs_last_review: fm.fsrs_last_review,
	};
}

/**
 * Resolve a card-relative `occlusion_source` (typically a basename
 * like `heart.occlusion.json`) into the vault-absolute path of the
 * sidecar. Anchors against the card file's folder so the JSON sits
 * next to the markdown.
 *
 * Tolerates a `source` that's already a longer relative path (e.g.
 * `../shared/foo.occlusion.json`) — the caller is responsible for
 * keeping the field sane.
 */
export function resolveOcclusionJsonPath(
	cardPath: string,
	source: string,
): string {
	const slash = cardPath.lastIndexOf("/");
	const dir = slash >= 0 ? cardPath.slice(0, slash) : "";
	return dir.length > 0 ? `${dir}/${source}` : source;
}

/**
 * Compute the conventional sidecar path for a given card path. Used
 * by the editor when creating a new occlusion set, and by the
 * file-rename / file-delete handlers to find the paired JSON.
 *
 * Convention: `<slug>.md` → `<slug>.occlusion.json` colocated in the
 * same folder.
 */
export function jsonPathForCard(cardPath: string): string {
	if (cardPath.endsWith(".md")) {
		return `${cardPath.slice(0, -3)}.occlusion.json`;
	}
	return `${cardPath}.occlusion.json`;
}

/**
 * Just the basename portion of the sidecar path — what goes into the
 * card's `occlusion_source` frontmatter field. Keeps the field short
 * and folder-portable (the JSON resolves relative to the card).
 */
export function jsonBasenameForCard(cardPath: string): string {
	const full = jsonPathForCard(cardPath);
	const slash = full.lastIndexOf("/");
	return slash >= 0 ? full.slice(slash + 1) : full;
}

/**
 * Errors `readOcclusionSet` can surface to callers. The parser uses
 * these to mark the card `invalid` with an informative message — the
 * user almost always moved one file without the other (`missing`), or
 * hand-edited the JSON to a malformed shape (`invalid`).
 */
export type OcclusionReadError =
	| { kind: "missing"; path: string }
	| { kind: "invalid"; path: string; error: string };

export type OcclusionReadResult =
	| { kind: "ok"; set: OcclusionSetT }
	| OcclusionReadError;

/**
 * I/O hooks for read/write paths. Injectable so unit tests can drive
 * the reader/writer without an Obsidian vault — matches the pattern in
 * `image-attachment.ts`. Production wiring uses `app.vault.adapter`.
 */
export interface OcclusionIODeps {
	read: (path: string) => Promise<string | null>;
	write: (path: string, content: string) => Promise<void>;
}

/**
 * Read + Zod-validate an occlusion set from disk. Returns a tagged
 * result rather than throwing so the parser can fold the failure
 * cases into its `ParseOutcome` without try/catch noise.
 *
 * - `missing` — file doesn't exist (one half of a pair was moved/deleted)
 * - `invalid` — JSON parse error or schema validation error
 * - `ok` — set is structurally valid (semantic checks like the image
 *   file existing are the renderer's problem)
 */
export async function readOcclusionSet(
	deps: OcclusionIODeps,
	jsonPath: string,
): Promise<OcclusionReadResult> {
	const text = await deps.read(jsonPath);
	if (text === null) {
		return { kind: "missing", path: jsonPath };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { kind: "invalid", path: jsonPath, error: `JSON parse: ${msg}` };
	}
	const result = OcclusionSet.safeParse(parsed);
	if (!result.success) {
		const error = result.error.issues
			.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
			.join("; ");
		return { kind: "invalid", path: jsonPath, error };
	}
	return { kind: "ok", set: result.data };
}

/**
 * Serialize + write an occlusion set. Pretty-printed with two-space
 * indent so a curious user opening the JSON in Obsidian's file
 * explorer sees readable content. The editor and the grade-write
 * path both round-trip through this function — no other writers.
 */
export async function writeOcclusionSet(
	deps: OcclusionIODeps,
	jsonPath: string,
	set: OcclusionSetT,
): Promise<void> {
	// Re-validate before writing so a programming error upstream
	// doesn't strand a malformed JSON on disk that the parser will
	// then reject on the next reload.
	const guard = OcclusionSet.safeParse(set);
	if (!guard.success) {
		const error = guard.error.issues
			.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
			.join("; ");
		throw new Error(`refusing to write malformed occlusion set: ${error}`);
	}
	const content = JSON.stringify(guard.data, null, 2) + "\n";
	await deps.write(jsonPath, content);
}

/**
 * Hand-serialize the occlusion `.md` body. Frontmatter holds
 * `type`, `topic`, optional `section`, `created`, `modified`, tags,
 * related, and `occlusion_source`. The body is informational only —
 * both # Question and # Answer embed the source image so that a user
 * opening the `.md` in a regular Obsidian leaf sees something
 * sensible. The real rendering happens via `OcclusionRenderer`.
 *
 * Mirrors `serializeCard` in new-card.ts but skips the flat fsrs_*
 * block — occlusion cards don't carry one (per-mask FSRS lives in
 * the JSON sidecar).
 */
export function serializeOcclusionMarkdown(input: {
	title: string;
	topic: string;
	section?: string;
	tags?: string[];
	related?: string[];
	created: string;
	modified: string;
	occlusionSource: string;
	imageBasename: string;
	maskCount: number;
}): string {
	const tags = input.tags ?? [];
	const related = input.related ?? [];
	const lines: string[] = ["---"];
	lines.push("type: flashcard");
	lines.push(`title: ${yamlScalar(input.title)}`);
	lines.push(`topic: ${yamlScalar(input.topic)}`);
	if (input.section && input.section.length > 0) {
		lines.push(`section: ${yamlScalar(input.section)}`);
	}
	lines.push(`created: ${input.created}`);
	lines.push(`modified: ${input.modified}`);
	lines.push(`occlusion_source: ${yamlScalar(input.occlusionSource)}`);
	if (tags.length === 0) {
		lines.push("tags: []");
	} else {
		lines.push("tags:");
		for (const t of tags) lines.push(`  - ${yamlScalar(t)}`);
	}
	if (related.length === 0) {
		lines.push("related: []");
	} else {
		lines.push("related:");
		for (const r of related) lines.push(`  - ${yamlScalar(r)}`);
	}
	lines.push("---");
	lines.push("");
	lines.push("# Question");
	lines.push("");
	lines.push(`![[${input.imageBasename}]]`);
	lines.push("");
	lines.push(`(Image occlusion · ${input.maskCount} masks)`);
	lines.push("");
	lines.push("# Answer");
	lines.push("");
	lines.push(`![[${input.imageBasename}]]`);
	lines.push("");
	return lines.join("\n");
}

// Minimal YAML-scalar quoter for the values we emit in the
// occlusion markdown body. Mirrors `needsQuoting`/`yamlScalar` in
// new-card.ts — duplicated rather than imported to keep this file
// free of an awkward cross-import (new-card.ts depends on parser
// types we'd otherwise circularly reference).
function needsQuoting(s: string): boolean {
	if (s.length === 0) return true;
	if (/^[\s!#&*@`|>{}[\],?:\-<=%"']/.test(s)) return true;
	if (/\s$/.test(s)) return true;
	if (/[\n\r\t"\\]/.test(s)) return true;
	if (/: | #/.test(s)) return true;
	if (/^(null|true|false|yes|no|on|off|~)$/i.test(s)) return true;
	if (/^-?\d+(\.\d+)?$/.test(s)) return true;
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
	return false;
}

function yamlScalar(s: string): string {
	if (needsQuoting(s)) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return s;
}

/**
 * Type guard for "is this card an occlusion sibling" — used by the
 * grade-write branch in main.tsx and any other consumer that needs to
 * decide between the JSON-sidecar and frontmatter persistence paths.
 *
 * `maskIndex` is the discriminator (not `fm.occlusion_source` —
 * non-sibling cards on disk could carry the field but never expand to
 * `maskIndex`-bearing siblings if the JSON is missing).
 */
export function isOcclusionSibling(card: ParsedCard): boolean {
	return typeof card.maskIndex === "number";
}
