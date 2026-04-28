import { describe, expect, it } from "vitest";
import { CardFrontmatter } from "./card";

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
