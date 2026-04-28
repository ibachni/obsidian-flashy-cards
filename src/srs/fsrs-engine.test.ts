import { describe, expect, it } from "vitest";
import type { CardFrontmatterT } from "../schema/card";
import { gradeWith, makeEngine, Rating, type Grade } from "./fsrs-engine";

function newCardFm(overrides: Partial<CardFrontmatterT> = {}): CardFrontmatterT {
	return {
		type: "flashcard",
		topic: "Test",
		created: "2026-01-01",
		modified: "2026-01-01",
		fsrs_due: "2026-04-28",
		fsrs_stability: 0,
		fsrs_difficulty: 0,
		fsrs_elapsed_days: 0,
		fsrs_scheduled_days: 0,
		fsrs_learning_steps: 0,
		fsrs_reps: 0,
		fsrs_lapses: 0,
		fsrs_state: "new",
		fsrs_last_review: null,
		tags: [],
		related: [],
		...overrides,
	};
}

describe("gradeWith", () => {
	const engine = makeEngine();
	const now = new Date("2026-04-28T12:00:00Z");

	it("transitions a new card out of `new` state on any grade", () => {
		const fm = newCardFm();
		const grades: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
		for (const rating of grades) {
			const update = gradeWith(engine, fm, rating, now);
			expect(update.fsrs_state).not.toBe("new");
			expect(update.fsrs_reps).toBeGreaterThan(0);
		}
	});

	it("writes fsrs_due as date-only YYYY-MM-DD", () => {
		// The plugin stores fsrs_due as date-only so Obsidian's Properties
		// UI renders a date picker. parseDueDate then reads it back as
		// local midnight. Round-trip contract.
		const update = gradeWith(engine, newCardFm(), Rating.Good, now);
		expect(update.fsrs_due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("writes fsrs_last_review as full ISO datetime", () => {
		const update = gradeWith(engine, newCardFm(), Rating.Good, now);
		expect(update.fsrs_last_review).toBe(now.toISOString());
	});

	it("Again increases lapses on a card already in review", () => {
		const fm = newCardFm({
			fsrs_state: "review",
			fsrs_stability: 30,
			fsrs_difficulty: 5,
			fsrs_reps: 5,
			fsrs_lapses: 0,
			fsrs_due: "2026-04-28",
			fsrs_last_review: "2026-04-01T12:00:00.000Z",
		});
		const update = gradeWith(engine, fm, Rating.Again, now);
		expect(update.fsrs_lapses).toBe(1);
	});

	it("Easy schedules further out than Hard for the same input", () => {
		const fm = newCardFm({
			fsrs_state: "review",
			fsrs_stability: 10,
			fsrs_difficulty: 5,
			fsrs_reps: 3,
			fsrs_due: "2026-04-28",
			fsrs_last_review: "2026-04-20T12:00:00.000Z",
		});
		const hard = gradeWith(engine, fm, Rating.Hard, now);
		const easy = gradeWith(engine, fm, Rating.Easy, now);
		expect(easy.fsrs_scheduled_days).toBeGreaterThan(hard.fsrs_scheduled_days);
	});
});
