import { describe, expect, it } from "vitest";
import type { CardFrontmatterT } from "../schema/card";
import {
	createSlot,
	stashGrade,
	takeGrade,
	type UndoEntry,
} from "./undo-buffer";

function fm(overrides: Partial<CardFrontmatterT> = {}): CardFrontmatterT {
	return {
		type: "flashcard",
		topic: "dns",
		created: "2026-05-01T00:00:00.000Z",
		modified: "2026-05-10T00:00:00.000Z",
		fsrs_due: "2026-05-14T00:00:00.000Z",
		fsrs_stability: 2.5,
		fsrs_difficulty: 5,
		fsrs_elapsed_days: 0,
		fsrs_scheduled_days: 4,
		fsrs_learning_steps: 0,
		fsrs_reps: 3,
		fsrs_lapses: 0,
		fsrs_state: "review",
		fsrs_last_review: "2026-05-10T00:00:00.000Z",
		tags: [],
		related: [],
		...overrides,
	};
}

function entry(overrides: Partial<UndoEntry> = {}): UndoEntry {
	return {
		cardId: "Cards/dns/foo.md",
		path: "Cards/dns/foo.md",
		clozeIndex: null,
		previousFm: fm(),
		logDate: "2026-05-20",
		...overrides,
	};
}

describe("undo-buffer", () => {
	it("starts empty", () => {
		const slot = createSlot();
		expect(slot.entry).toBeNull();
		expect(takeGrade(slot)).toBeNull();
	});

	it("stashGrade overwrites the prior entry (single-slot)", () => {
		const slot = createSlot();
		const first = entry({ path: "Cards/a.md", logDate: "2026-05-19" });
		const second = entry({ path: "Cards/b.md", logDate: "2026-05-20" });
		stashGrade(slot, first);
		stashGrade(slot, second);
		expect(slot.entry).toBe(second);
	});

	it("takeGrade returns the entry and clears the slot", () => {
		const slot = createSlot();
		const e = entry();
		stashGrade(slot, e);
		expect(takeGrade(slot)).toBe(e);
		expect(slot.entry).toBeNull();
	});

	it("consecutive takeGrade returns null after the first", () => {
		const slot = createSlot();
		stashGrade(slot, entry());
		expect(takeGrade(slot)).not.toBeNull();
		expect(takeGrade(slot)).toBeNull();
		expect(takeGrade(slot)).toBeNull();
	});
});
