import { describe, expect, it } from "vitest";
import { CardFrontmatter, CardFrontmatterOnDisk } from "./card";

const baseFm = {
	type: "flashcard" as const,
	topic: "Test",
	created: "2026-01-01",
	modified: "2026-01-01",
	fsrs_due: "2026-04-28",
	fsrs_stability: 0,
	fsrs_difficulty: 0,
	fsrs_elapsed_days: 0,
	fsrs_scheduled_days: 0,
	fsrs_reps: 0,
	fsrs_lapses: 0,
	fsrs_state: "new" as const,
	fsrs_last_review: null,
};

describe("CardFrontmatter schema", () => {
	it("accepts a minimal valid card", () => {
		const result = CardFrontmatter.safeParse(baseFm);
		expect(result.success).toBe(true);
	});

	it("coerces unquoted YAML dates (Date objects) to ISO strings", () => {
		// Obsidian's YAML parser auto-converts unquoted ISO dates to JS
		// Date instances. The schema must absorb both shapes and return
		// strings to the rest of the plugin.
		const result = CardFrontmatter.safeParse({
			...baseFm,
			created: new Date("2026-01-01T00:00:00Z"),
			modified: new Date("2026-01-01T00:00:00Z"),
			fsrs_due: new Date("2026-04-28T00:00:00Z"),
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(typeof result.data.created).toBe("string");
			expect(typeof result.data.modified).toBe("string");
			expect(typeof result.data.fsrs_due).toBe("string");
			expect(result.data.fsrs_due).toBe("2026-04-28T00:00:00.000Z");
		}
	});

	it("permits null fsrs_last_review (new cards)", () => {
		const result = CardFrontmatter.safeParse(baseFm);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.fsrs_last_review).toBeNull();
		}
	});

	it("defaults missing fsrs_learning_steps to 0", () => {
		// Pre-ts-fsrs-5.x cards on disk don't have this field; the
		// schema's `.default(0)` keeps them parseable until the next
		// grade write persists the value.
		const result = CardFrontmatter.safeParse(baseFm);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.fsrs_learning_steps).toBe(0);
		}
	});

	it("rejects type other than 'flashcard'", () => {
		const result = CardFrontmatter.safeParse({ ...baseFm, type: "note" });
		expect(result.success).toBe(false);
	});

	it("rejects unknown fsrs_state values", () => {
		const result = CardFrontmatter.safeParse({
			...baseFm,
			fsrs_state: "buried",
		});
		expect(result.success).toBe(false);
	});

	it("defaults missing tags / related to empty arrays", () => {
		const { ...withoutOptional } = baseFm;
		const result = CardFrontmatter.safeParse(withoutOptional);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tags).toEqual([]);
			expect(result.data.related).toEqual([]);
		}
	});
});

describe("CardFrontmatterOnDisk schema", () => {
	const baseNoFsrs = {
		type: "flashcard" as const,
		topic: "Test",
		created: "2026-01-01",
		modified: "2026-01-01",
	};

	const flatFsrs = {
		fsrs_due: "2026-04-28",
		fsrs_stability: 0,
		fsrs_difficulty: 0,
		fsrs_elapsed_days: 0,
		fsrs_scheduled_days: 0,
		fsrs_reps: 0,
		fsrs_lapses: 0,
		fsrs_state: "new" as const,
		fsrs_last_review: null,
	};

	const clozeSlot = {
		due: "2026-04-28",
		stability: 0,
		difficulty: 0,
		elapsed_days: 0,
		scheduled_days: 0,
		reps: 0,
		lapses: 0,
		state: "new" as const,
		last_review: null,
	};

	it("accepts a non-cloze card (flat fsrs_* fields)", () => {
		const result = CardFrontmatterOnDisk.safeParse({
			...baseNoFsrs,
			...flatFsrs,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a cloze card (fsrs_clozes map, no flat fsrs_*)", () => {
		const result = CardFrontmatterOnDisk.safeParse({
			...baseNoFsrs,
			fsrs_clozes: {
				"1": clozeSlot,
				"2": { ...clozeSlot, due: "2026-05-01" },
			},
		});
		expect(result.success).toBe(true);
	});

	it("rejects a card holding both flat fsrs_* and fsrs_clozes", () => {
		// XOR rule: a card claiming both forms is ambiguous schema drift.
		// Fail loud rather than silently picking a side.
		const result = CardFrontmatterOnDisk.safeParse({
			...baseNoFsrs,
			...flatFsrs,
			fsrs_clozes: { "1": clozeSlot },
		});
		expect(result.success).toBe(false);
	});

	it("rejects a card with neither form", () => {
		const result = CardFrontmatterOnDisk.safeParse(baseNoFsrs);
		expect(result.success).toBe(false);
	});

	it("rejects a cloze card whose slot is missing required FSRS fields", () => {
		// Each slot must be a complete FSRS state — a half-populated
		// slot would crash gradeWith downstream.
		const result = CardFrontmatterOnDisk.safeParse({
			...baseNoFsrs,
			fsrs_clozes: { "1": { ...clozeSlot, stability: undefined } },
		});
		expect(result.success).toBe(false);
	});

	it("rejects a non-cloze card with only fsrs_due (partial flat form)", () => {
		// Regression: an earlier refine probed only `fsrs_due` as a
		// proxy for "has flat form", letting a card with fsrs_due but
		// missing fsrs_stability etc. through — which then crashed
		// gradeWith downstream because the in-memory schema requires
		// all flat fields. The full-coverage refine catches this here.
		const result = CardFrontmatterOnDisk.safeParse({
			...baseNoFsrs,
			fsrs_due: "2026-04-28",
			// All other flat fsrs_* fields missing.
		});
		expect(result.success).toBe(false);
	});

	it("coerces a cloze slot's Date `due` to an ISO string", () => {
		// Obsidian's YAML parser auto-converts unquoted ISO dates to JS
		// Date instances. The cloze slot's `due` uses the same dateLike
		// transform as the flat schema, so the round-trip must produce
		// a string for downstream consumers (gradeWith expects strings).
		const result = CardFrontmatterOnDisk.safeParse({
			...baseNoFsrs,
			fsrs_clozes: {
				"1": { ...clozeSlot, due: new Date("2026-04-28T00:00:00Z") },
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(typeof result.data.fsrs_clozes!["1"]!.due).toBe("string");
			expect(result.data.fsrs_clozes!["1"]!.due).toBe(
				"2026-04-28T00:00:00.000Z",
			);
		}
	});

	it("defaults a cloze slot's missing `learning_steps` to 0", () => {
		// Mirrors the flat schema's behavior for the same field — cards
		// predating ts-fsrs 5.x don't have learning_steps on disk in
		// either form. `clozeSlot` deliberately omits it (see top of
		// describe block) so this test directly exercises the default.
		const result = CardFrontmatterOnDisk.safeParse({
			...baseNoFsrs,
			fsrs_clozes: { "1": clozeSlot },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.fsrs_clozes!["1"]!.learning_steps).toBe(0);
		}
	});
});
