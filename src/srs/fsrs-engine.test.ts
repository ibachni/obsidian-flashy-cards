import { describe, expect, it } from "vitest";
import type { CardFrontmatterT } from "../schema/card";
import {
	gradeWith,
	makeEngine,
	previewIntervals,
	Rating,
	type Grade,
} from "./fsrs-engine";

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

describe("previewIntervals", () => {
	const engine = makeEngine();
	const now = new Date("2026-04-28T12:00:00Z");

	it("returns Again ≤ Hard ≤ Good ≤ Easy due dates for a review card", () => {
		// Calibration invariant: harder grades give shorter intervals.
		// Stable fuzz seeding doesn't matter here — for a mature card the
		// ordering holds for any reasonable parameter set.
		const fm = newCardFm({
			fsrs_state: "review",
			fsrs_stability: 20,
			fsrs_difficulty: 5,
			fsrs_reps: 4,
			fsrs_due: "2026-04-28",
			fsrs_last_review: "2026-04-08T12:00:00.000Z",
		});
		const dues = previewIntervals(engine, fm, now);
		expect(dues[Rating.Again].getTime()).toBeLessThanOrEqual(
			dues[Rating.Hard].getTime(),
		);
		expect(dues[Rating.Hard].getTime()).toBeLessThanOrEqual(
			dues[Rating.Good].getTime(),
		);
		expect(dues[Rating.Good].getTime()).toBeLessThanOrEqual(
			dues[Rating.Easy].getTime(),
		);
	});

	it("returns intervals for a new card without mutating it", () => {
		// The Review pane shows previews the moment a card is revealed,
		// and `new` is the most common starting state — exercise that
		// path explicitly so an upstream change to ts-fsrs's new-state
		// handling can't quietly break us.
		const fm = newCardFm(); // state: "new"
		const snapshot = structuredClone(fm);
		const dues = previewIntervals(engine, fm, now);
		expect(dues[Rating.Easy].getTime()).toBeGreaterThan(
			dues[Rating.Again].getTime(),
		);
		expect(fm).toEqual(snapshot);
	});

	it("does not mutate the input frontmatter", () => {
		// Critical: the preview is rendered every time the Review pane
		// shows a card. If it accidentally mutated fm we'd corrupt the
		// in-memory card store before the user actually graded.
		const fm = newCardFm({
			fsrs_state: "review",
			fsrs_stability: 10,
			fsrs_difficulty: 5,
		});
		const snapshot = structuredClone(fm);
		previewIntervals(engine, fm, now);
		expect(fm).toEqual(snapshot);
	});
});
