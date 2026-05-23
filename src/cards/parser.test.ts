import { describe, expect, it } from "vitest";
import { CardFrontmatterOnDisk, type CardFrontmatterT } from "../schema/card";
import type { OcclusionIODeps, OcclusionSetT } from "./occlusion";
import type { FsrsUpdate } from "../srs/fsrs-engine";
import {
	applyGradeUpdate,
	applyUndoRestore,
	expandCard,
	fmToClozeSlot,
	parseBodySections,
	parseOcclusionCard,
	type ParsedCard,
} from "./parser";

// Minimal raw frontmatter shapes used by the expansion tests. Real
// inputs come from Obsidian's metadata cache; tests build the shape
// directly and run it through CardFrontmatterOnDisk to mirror the
// production parse path.
const baseFlatFm = {
	type: "flashcard" as const,
	topic: "Test",
	created: "2026-01-01",
	modified: "2026-01-01",
	fsrs_due: "2026-04-28",
	fsrs_stability: 1,
	fsrs_difficulty: 5,
	fsrs_elapsed_days: 0,
	fsrs_scheduled_days: 1,
	fsrs_reps: 0,
	fsrs_lapses: 0,
	fsrs_state: "new" as const,
	fsrs_last_review: null,
};

const clozeSlot = (due: string) => ({
	due,
	stability: 1,
	difficulty: 5,
	elapsed_days: 0,
	scheduled_days: 1,
	reps: 0,
	lapses: 0,
	state: "review" as const,
	last_review: null,
});

describe("parseBodySections", () => {
	it("splits a body into Question / Answer sections", () => {
		const body = [
			"# Question",
			"What is the capital of France?",
			"",
			"# Answer",
			"Paris.",
		].join("\n");
		const sections = parseBodySections(body);
		expect(sections["Question"]).toBe("What is the capital of France?");
		expect(sections["Answer"]).toBe("Paris.");
	});

	it("trims leading/trailing whitespace inside each section", () => {
		const body = [
			"# Question",
			"   What is X?   ",
			"",
			"",
			"# Answer",
			"  X is Y.  ",
			"",
		].join("\n");
		const sections = parseBodySections(body);
		expect(sections["Question"]).toBe("What is X?");
		expect(sections["Answer"]).toBe("X is Y.");
	});

	it("ignores preamble before the first H1", () => {
		const body = [
			"some preamble text",
			"that isn't a section",
			"",
			"# Question",
			"q?",
			"# Answer",
			"a.",
		].join("\n");
		const sections = parseBodySections(body);
		expect(Object.keys(sections)).toEqual(["Question", "Answer"]);
	});

	it("returns {} for a body with no H1s", () => {
		const body = "just some text, no headings";
		expect(parseBodySections(body)).toEqual({});
	});

	it("does not match H2+ headings", () => {
		// Only `# ` (single `#` + space) splits. `##` is not a section.
		const body = [
			"# Question",
			"q with ## subsection inside",
			"# Answer",
			"a.",
		].join("\n");
		const sections = parseBodySections(body);
		expect(sections["Question"]).toContain("## subsection");
	});
});

describe("expandCard", () => {
	it("returns a 1-element array for a non-cloze card", () => {
		const data = CardFrontmatterOnDisk.parse(baseFlatFm);
		const result = expandCard("notes/x.md", data, "Q?", "A.");
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards).toHaveLength(1);
		expect(result.cards[0]).toMatchObject({
			id: "notes/x.md",
			path: "notes/x.md",
			clozeIndex: null,
			question: "Q?",
			answer: "A.",
		});
		// Non-cloze cards do not carry the raw form (the rendered Q/A
		// is already the source).
		expect(result.cards[0]!.rawQuestion).toBeUndefined();
		expect(result.cards[0]!.rawAnswer).toBeUndefined();
	});

	it("expands a cloze card into one sibling per unique index", () => {
		// Three unique indices across question + answer → three siblings,
		// each with its own id, clozeIndex, and projected fm fields.
		const data = CardFrontmatterOnDisk.parse({
			type: "flashcard",
			topic: "Vocab",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_clozes: {
				"1": clozeSlot("2026-05-01"),
				"2": clozeSlot("2026-05-02"),
				"3": clozeSlot("2026-05-03"),
			},
		});
		const q = "{{c1::Paris}} is in {{c2::France}}";
		const a = "Note: {{c3::Eiffel Tower}} is famous.";
		const result = expandCard("vocab/paris.md", data, q, a);
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards).toHaveLength(3);
		expect(result.cards.map((c) => c.id)).toEqual([
			"vocab/paris.md#c1",
			"vocab/paris.md#c2",
			"vocab/paris.md#c3",
		]);
		expect(result.cards.map((c) => c.clozeIndex)).toEqual([1, 2, 3]);
		// Per-sibling fm.fsrs_due comes from the matching slot —
		// confirms the slot→flat projection mapping.
		expect(result.cards.map((c) => c.fm.fsrs_due)).toEqual([
			"2026-05-01",
			"2026-05-02",
			"2026-05-03",
		]);
		// Pre-rendered question masks the active cloze; pre-rendered
		// answer wraps the active span in <mark>.
		expect(result.cards[0]!.question).toBe("[…] is in France");
		expect(result.cards[2]!.answer).toBe(
			'Note: <mark class="ls-cloze-active">Eiffel Tower</mark> is famous.',
		);
		// Cloze siblings carry the raw source so the edit modal can
		// show the {{cN::…}} form.
		expect(result.cards[0]!.rawQuestion).toBe(q);
		expect(result.cards[0]!.rawAnswer).toBe(a);
	});

	it("handles cloze syntax in the answer field only", () => {
		// "What's the capital?" / "{{c1::Paris}}" — useful for cards
		// where the question is plain prose and the answer is a
		// structured definition with recallable pieces.
		const data = CardFrontmatterOnDisk.parse({
			type: "flashcard",
			topic: "Vocab",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_clozes: { "1": clozeSlot("2026-05-01") },
		});
		const result = expandCard(
			"vocab/q.md",
			data,
			"What's the capital of France?",
			"{{c1::Paris}}",
		);
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards).toHaveLength(1);
		// Question has no clozes → masking is a no-op.
		expect(result.cards[0]!.question).toBe("What's the capital of France?");
		expect(result.cards[0]!.answer).toBe(
			'<mark class="ls-cloze-active">Paris</mark>',
		);
	});

	it("flags fsrs_clozes set but no cloze markers in body as invalid", () => {
		// User removed the {{cN::…}} markers without cleaning
		// frontmatter — the card would produce zero siblings, which is
		// indistinguishable from "card deleted" downstream. Fail loud.
		const data = CardFrontmatterOnDisk.parse({
			type: "flashcard",
			topic: "Vocab",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_clozes: { "1": clozeSlot("2026-05-01") },
		});
		const result = expandCard("vocab/q.md", data, "plain question", "plain");
		expect(result.kind).toBe("invalid");
	});

	it("defaults fsrs_learning_steps to 0 when the on-disk card omits it", () => {
		// Regression: an earlier draft cast the OnDisk data straight to
		// CardFrontmatterT, which left `fsrs_learning_steps` undefined
		// for cards predating ts-fsrs 5.x. Routing the non-cloze branch
		// through CardFrontmatter.safeParse picks up the default.
		// baseFlatFm intentionally lacks fsrs_learning_steps so the
		// OnDisk parse exercises the absence path.
		const data = CardFrontmatterOnDisk.parse(baseFlatFm);
		const result = expandCard("notes/x.md", data, "Q?", "A.");
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards[0]!.fm.fsrs_learning_steps).toBe(0);
	});

	it("emits cloze siblings in ascending clozeIndex order", () => {
		// Locks in the sort guarantee from collectClozeIndices — the
		// Review pane / Browse list rely on stable per-card ordering
		// across reloads.
		const data = CardFrontmatterOnDisk.parse({
			type: "flashcard",
			topic: "Vocab",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_clozes: {
				"3": clozeSlot("2026-05-03"),
				"1": clozeSlot("2026-05-01"),
				"2": clozeSlot("2026-05-02"),
			},
		});
		// Source order in body is reversed (c2, c1, c3) to confirm the
		// sort key is the cloze index, not the body-occurrence order.
		const result = expandCard(
			"vocab/x.md",
			data,
			"{{c2::b}} {{c1::a}} {{c3::c}}",
			"plain",
		);
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards.map((c) => c.clozeIndex)).toEqual([1, 2, 3]);
	});

	it("synthesizes a new-state slot for clozes without an on-disk slot", () => {
		// Body has {{c1::…}} and {{c2::…}}; frontmatter only has slot
		// "1". Sibling 2 has no FSRS state on disk — the parser
		// synthesizes a `new`-state slot in memory so the sibling
		// shows up in the picker immediately. The first grade write
		// will persist the slot via gradeAndPersist.
		const data = CardFrontmatterOnDisk.parse({
			type: "flashcard",
			topic: "Vocab",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_clozes: { "1": clozeSlot("2026-05-01") },
		});
		const result = expandCard(
			"vocab/q.md",
			data,
			"{{c1::a}} and {{c2::b}}",
			"plain",
		);
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards).toHaveLength(2);
		expect(result.cards.map((c) => c.clozeIndex)).toEqual([1, 2]);
		// Sibling 1 reads from the disk slot (due 2026-05-01).
		expect(result.cards[0]!.fm.fsrs_due).toBe("2026-05-01");
		expect(result.cards[0]!.fm.fsrs_state).toBe("review");
		// Sibling 2 is the synthesized new-state slot — due far in the
		// past so the picker surfaces it immediately.
		expect(result.cards[1]!.fm.fsrs_state).toBe("new");
		expect(result.cards[1]!.fm.fsrs_reps).toBe(0);
		expect(result.cards[1]!.fm.fsrs_lapses).toBe(0);
	});
});

describe("applyGradeUpdate", () => {
	const update: FsrsUpdate = {
		fsrs_due: "2026-05-15",
		fsrs_stability: 12.3,
		fsrs_difficulty: 7.1,
		fsrs_elapsed_days: 14,
		fsrs_scheduled_days: 7,
		fsrs_learning_steps: 0,
		fsrs_reps: 4,
		fsrs_lapses: 1,
		fsrs_state: "review",
		fsrs_last_review: "2026-05-08T10:00:00.000Z",
	};

	function nonClozeCard(): ParsedCard {
		const fm: CardFrontmatterT = {
			type: "flashcard",
			topic: "Test",
			created: "2026-01-01",
			modified: "2026-04-01",
			fsrs_due: "2026-04-15",
			fsrs_stability: 5,
			fsrs_difficulty: 6,
			fsrs_elapsed_days: 7,
			fsrs_scheduled_days: 3,
			fsrs_learning_steps: 0,
			fsrs_reps: 3,
			fsrs_lapses: 0,
			fsrs_state: "review",
			fsrs_last_review: "2026-04-08T10:00:00.000Z",
			tags: [],
			related: [],
		};
		return {
			id: "notes/x.md",
			path: "notes/x.md",
			clozeIndex: null,
			fm,
			question: "Q?",
			answer: "A.",
		};
	}

	function clozeSiblingCard(n: number): ParsedCard {
		const base = nonClozeCard();
		return {
			...base,
			id: `vocab/x.md#c${n}`,
			path: "vocab/x.md",
			clozeIndex: n,
		};
	}

	it("non-cloze: assigns flat fsrs_* scalars and bumps modified", () => {
		const raw: Record<string, unknown> = {
			type: "flashcard",
			topic: "Test",
			modified: "2026-04-01",
			fsrs_due: "2026-04-15",
			fsrs_stability: 5,
		};
		applyGradeUpdate(raw, nonClozeCard(), update, "2026-05-08");
		expect(raw.fsrs_due).toBe("2026-05-15");
		expect(raw.fsrs_stability).toBe(12.3);
		expect(raw.fsrs_state).toBe("review");
		expect(raw.modified).toBe("2026-05-08");
		// No cloze map should appear on a non-cloze write.
		expect(raw.fsrs_clozes).toBeUndefined();
	});

	it("cloze sibling: writes the slot under fsrs_clozes[N] and bumps modified", () => {
		const raw: Record<string, unknown> = {
			type: "flashcard",
			topic: "Vocab",
			modified: "2026-04-01",
			fsrs_clozes: {
				"1": {
					due: "2026-04-10",
					stability: 1,
					difficulty: 5,
					elapsed_days: 0,
					scheduled_days: 1,
					learning_steps: 0,
					reps: 0,
					lapses: 0,
					state: "new",
					last_review: null,
				},
			},
		};
		applyGradeUpdate(raw, clozeSiblingCard(1), update, "2026-05-08");
		const clozes = raw.fsrs_clozes as Record<string, Record<string, unknown>>;
		expect(clozes["1"]!.due).toBe("2026-05-15");
		expect(clozes["1"]!.stability).toBe(12.3);
		expect(clozes["1"]!.state).toBe("review");
		expect(raw.modified).toBe("2026-05-08");
		// Flat fsrs_* must not be set on a cloze write — the XOR refine
		// would reject the next parse otherwise.
		expect(raw.fsrs_due).toBeUndefined();
		expect(raw.fsrs_stability).toBeUndefined();
	});

	it("cloze sibling: leaves other slots untouched", () => {
		// Critical guarantee — grading sibling 1 must not corrupt slot 2.
		const slot2 = {
			due: "2026-05-20",
			stability: 8,
			difficulty: 6,
			elapsed_days: 5,
			scheduled_days: 10,
			learning_steps: 0,
			reps: 2,
			lapses: 0,
			state: "review" as const,
			last_review: "2026-05-10T10:00:00.000Z",
		};
		const raw: Record<string, unknown> = {
			type: "flashcard",
			topic: "Vocab",
			fsrs_clozes: {
				"1": {
					due: "2026-04-10",
					stability: 1,
					difficulty: 5,
					elapsed_days: 0,
					scheduled_days: 1,
					learning_steps: 0,
					reps: 0,
					lapses: 0,
					state: "new",
					last_review: null,
				},
				"2": slot2,
			},
		};
		applyGradeUpdate(raw, clozeSiblingCard(1), update, "2026-05-08");
		const clozes = raw.fsrs_clozes as Record<string, Record<string, unknown>>;
		expect(clozes["2"]).toEqual(slot2);
	});

	it("cloze sibling: creates fsrs_clozes if missing (first-grade after synthesis)", () => {
		// The parser synthesizes an in-memory new-state slot when the body
		// has {{cN::…}} but disk has no slot yet. The first grade must
		// create the on-disk fsrs_clozes map from scratch.
		const raw: Record<string, unknown> = {
			type: "flashcard",
			topic: "Vocab",
		};
		applyGradeUpdate(raw, clozeSiblingCard(3), update, "2026-05-08");
		const clozes = raw.fsrs_clozes as Record<string, Record<string, unknown>>;
		expect(clozes["3"]).toBeDefined();
		expect(clozes["3"]!.state).toBe("review");
	});
});

describe("applyUndoRestore", () => {
	const previousFm: CardFrontmatterT = {
		type: "flashcard",
		topic: "Test",
		created: "2026-01-01",
		modified: "2026-04-01",
		fsrs_due: "2026-04-15",
		fsrs_stability: 5,
		fsrs_difficulty: 6,
		fsrs_elapsed_days: 7,
		fsrs_scheduled_days: 3,
		fsrs_learning_steps: 0,
		fsrs_reps: 3,
		fsrs_lapses: 0,
		fsrs_state: "review",
		fsrs_last_review: "2026-04-08T10:00:00.000Z",
		tags: [],
		related: [],
	};

	it("non-cloze: restores flat scalars and modified in one assign", () => {
		// Mirrors today's Object.assign(fm, previousFm) behavior. Keys
		// the user added mid-window survive; the pre-grade scalars come
		// back.
		const raw: Record<string, unknown> = {
			type: "flashcard",
			topic: "Test",
			modified: "2026-05-08",
			fsrs_due: "2026-05-15",
			fsrs_stability: 12.3,
			fsrs_state: "review",
			user_added_field: "preserved",
		};
		applyUndoRestore(raw, { clozeIndex: null, previousFm });
		expect(raw.fsrs_due).toBe("2026-04-15");
		expect(raw.fsrs_stability).toBe(5);
		expect(raw.modified).toBe("2026-04-01");
		expect(raw.user_added_field).toBe("preserved");
	});

	it("cloze sibling: restores fsrs_clozes[N] and leaves other slots untouched", () => {
		const slot2Untouched = {
			due: "2026-05-20",
			stability: 8,
			difficulty: 6,
			elapsed_days: 5,
			scheduled_days: 10,
			learning_steps: 0,
			reps: 2,
			lapses: 0,
			state: "review" as const,
			last_review: "2026-05-10T10:00:00.000Z",
		};
		const raw: Record<string, unknown> = {
			type: "flashcard",
			topic: "Vocab",
			modified: "2026-05-08",
			fsrs_clozes: {
				"1": {
					due: "2026-05-15", // post-grade — undo must roll this back
					stability: 12.3,
					difficulty: 7.1,
					elapsed_days: 14,
					scheduled_days: 7,
					learning_steps: 0,
					reps: 4,
					lapses: 1,
					state: "review",
					last_review: "2026-05-08T10:00:00.000Z",
				},
				"2": slot2Untouched,
			},
		};
		applyUndoRestore(raw, { clozeIndex: 1, previousFm });
		const clozes = raw.fsrs_clozes as Record<string, Record<string, unknown>>;
		// Slot 1 rolled back to the previousFm snapshot.
		expect(clozes["1"]!.due).toBe("2026-04-15");
		expect(clozes["1"]!.stability).toBe(5);
		expect(clozes["1"]!.reps).toBe(3);
		// Slot 2 untouched.
		expect(clozes["2"]).toEqual(slot2Untouched);
		// modified rolled back too — round-trip symmetry with the grade
		// path, which bumped it forward.
		expect(raw.modified).toBe("2026-04-01");
	});
});

describe("expandCard rendering (Phase 3 snapshot)", () => {
	it("produces masked Q and highlighted A for each cloze sibling", () => {
		// Locks in the per-sibling rendering pipeline. Each sibling's
		// question hides ONLY its own cloze (others show their text);
		// each sibling's answer reveals ALL clozes with the active
		// sibling's spans wrapped in <mark class="ls-cloze-active">…</mark>
		// for the CSS highlight to target.
		const data = CardFrontmatterOnDisk.parse({
			type: "flashcard",
			topic: "Spanish/Verbs",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_clozes: {
				"1": clozeSlot("2026-05-01"),
				"2": clozeSlot("2026-05-02"),
			},
		});
		const q = "{{c1::hablo}} (I speak) — {{c2::hablamos}} (we speak)";
		const a = "Present indicative of *hablar*, c1: {{c1::hablo}}.";
		const result = expandCard("vocab/hablar.md", data, q, a);
		if (result.kind !== "parsed") throw new Error("expected parsed");

		// Sibling 1 (active = c1).
		expect(result.cards[0]!.question).toBe(
			"[…] (I speak) — hablamos (we speak)",
		);
		expect(result.cards[0]!.answer).toBe(
			'Present indicative of *hablar*, c1: <mark class="ls-cloze-active">hablo</mark>.',
		);

		// Sibling 2 (active = c2). c2 doesn't appear in the answer at
		// all — the answer reveals every cloze but only highlights spans
		// matching the active index, so c2's view of the answer has no
		// <mark> wrapping.
		expect(result.cards[1]!.question).toBe(
			"hablo (I speak) — […] (we speak)",
		);
		expect(result.cards[1]!.answer).toBe(
			"Present indicative of *hablar*, c1: hablo.",
		);
	});
});

describe("parseOcclusionCard", () => {
	function fakeReader(files: Record<string, string>): OcclusionIODeps {
		return {
			read: async (p) => (p in files ? files[p]! : null),
			write: async () => {
				throw new Error("unexpected write in parser tests");
			},
		};
	}

	const baseOcclusionFm = {
		type: "flashcard" as const,
		topic: "Anatomy",
		created: "2026-05-22",
		modified: "2026-05-22",
		occlusion_source: "heart.occlusion.json",
	};

	it("expands a hand-crafted .md + .occlusion.json pair into N siblings", async () => {
		// Mirrors the on-disk shape from the doc: card at
		// `anatomy/heart.md`, sidecar at `anatomy/heart.occlusion.json`,
		// three masks → three ParsedCards keyed `<path>#m<n>`.
		const data = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [
				{ x: 10, y: 10, w: 30, h: 30, fsrs: null },
				{ x: 50, y: 50, w: 30, h: 30, fsrs: null },
				{ x: 90, y: 90, w: 30, h: 30, fsrs: null },
			],
		};
		const deps = fakeReader({
			"anatomy/heart.occlusion.json": JSON.stringify(set),
		});
		const result = await parseOcclusionCard(deps, "anatomy/heart.md", data);
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards).toHaveLength(3);
		expect(result.cards.map((c) => c.id)).toEqual([
			"anatomy/heart.md#m1",
			"anatomy/heart.md#m2",
			"anatomy/heart.md#m3",
		]);
		// Each sibling carries the same source path (no `#m<n>` suffix)
		// so `getAbstractFileByPath(card.path)` resolves to the real file.
		expect(result.cards.every((c) => c.path === "anatomy/heart.md")).toBe(
			true,
		);
		// FSRS defaults from synthesized new-state slots.
		expect(result.cards.every((c) => c.fm.fsrs_state === "new")).toBe(true);
	});

	it("flags a missing sidecar JSON as invalid with an informative error", async () => {
		// User moved the .md without the .occlusion.json, or hand-rolled
		// frontmatter pointing at a non-existent sidecar.
		const data = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const deps = fakeReader({});
		const result = await parseOcclusionCard(deps, "anatomy/heart.md", data);
		expect(result.kind).toBe("invalid");
		if (result.kind !== "invalid") return;
		expect(result.error).toMatch(/sidecar not found/);
		expect(result.error).toContain("anatomy/heart.occlusion.json");
	});

	it("flags a malformed sidecar JSON as invalid", async () => {
		const data = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const deps = fakeReader({
			"anatomy/heart.occlusion.json": "{ this is not json",
		});
		const result = await parseOcclusionCard(deps, "anatomy/heart.md", data);
		expect(result.kind).toBe("invalid");
		if (result.kind !== "invalid") return;
		expect(result.error).toMatch(/sidecar invalid/);
	});

	it("flags a schema-violating sidecar (empty masks) as invalid", async () => {
		const data = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const deps = fakeReader({
			"anatomy/heart.occlusion.json": JSON.stringify({
				image: "_attachments/heart.png",
				mode: "hide-one",
				masks: [],
			}),
		});
		const result = await parseOcclusionCard(deps, "anatomy/heart.md", data);
		expect(result.kind).toBe("invalid");
		if (result.kind !== "invalid") return;
		expect(result.error).toMatch(/sidecar invalid/);
	});

	it("preserves per-mask FSRS state from the sidecar", async () => {
		const data = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [
				{
					x: 10,
					y: 10,
					w: 30,
					h: 30,
					fsrs: {
						fsrs_due: "2026-06-01",
						fsrs_stability: 7.5,
						fsrs_difficulty: 5,
						fsrs_elapsed_days: 14,
						fsrs_scheduled_days: 21,
						fsrs_learning_steps: 0,
						fsrs_reps: 5,
						fsrs_lapses: 1,
						fsrs_state: "review",
						fsrs_last_review: "2026-05-18",
					},
				},
				{ x: 50, y: 50, w: 30, h: 30, fsrs: null },
			],
		};
		const deps = fakeReader({
			"anatomy/heart.occlusion.json": JSON.stringify(set),
		});
		const result = await parseOcclusionCard(deps, "anatomy/heart.md", data);
		if (result.kind !== "parsed") throw new Error("expected parsed");
		// Sibling 1 reads from the disk slot.
		expect(result.cards[0]!.fm.fsrs_state).toBe("review");
		expect(result.cards[0]!.fm.fsrs_due).toBe("2026-06-01");
		expect(result.cards[0]!.fm.fsrs_stability).toBe(7.5);
		// Sibling 2 reads from the synthesized new-state defaults.
		expect(result.cards[1]!.fm.fsrs_state).toBe("new");
	});
});

describe("fmToClozeSlot", () => {
	it("strips the fsrs_ prefix and round-trips through projectSlotToFm", () => {
		// Used by the cloze grade-and-persist branch to write back into
		// `fsrs_clozes[N]`. Pin the field-for-field mapping so a future
		// FSRS schema addition gets caught before it silently drops on
		// the slot side.
		const data = CardFrontmatterOnDisk.parse({
			type: "flashcard",
			topic: "Vocab",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_clozes: { "1": clozeSlot("2026-05-01") },
		});
		const result = expandCard("vocab/x.md", data, "{{c1::a}}", "plain");
		if (result.kind !== "parsed") throw new Error("expected parsed");
		const slot = fmToClozeSlot(result.cards[0]!.fm);
		expect(slot).toEqual({
			due: "2026-05-01",
			stability: 1,
			difficulty: 5,
			elapsed_days: 0,
			scheduled_days: 1,
			learning_steps: 0,
			reps: 0,
			lapses: 0,
			state: "review",
			last_review: null,
		});
	});
});
