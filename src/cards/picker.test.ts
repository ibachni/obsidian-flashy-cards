import { describe, expect, it } from "vitest";
import type { ParsedCard } from "./parser";
import { nextDueAfter, pickNext } from "./picker";

function card(
	path: string,
	due: string,
	overrides: Partial<ParsedCard["fm"]> = {},
): ParsedCard {
	return {
		path,
		question: "q",
		answer: "a",
		fm: {
			type: "flashcard",
			topic: "Test",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_due: due,
			fsrs_stability: 1,
			fsrs_difficulty: 5,
			fsrs_elapsed_days: 0,
			fsrs_scheduled_days: 1,
			fsrs_learning_steps: 0,
			fsrs_reps: 0,
			fsrs_lapses: 0,
			fsrs_state: "new",
			fsrs_last_review: null,
			tags: [],
			related: [],
			...overrides,
		},
	};
}

describe("pickNext", () => {
	const now = new Date("2026-04-28T12:00:00");

	it("returns null when no card is due", () => {
		const cards = [card("a.md", "2026-05-01")];
		expect(pickNext(cards, now)).toBeNull();
	});

	it("returns the most overdue card first", () => {
		const cards = [
			card("recent.md", "2026-04-28"),
			card("oldest.md", "2026-04-20"),
			card("middle.md", "2026-04-25"),
		];
		const picked = pickNext(cards, now);
		expect(picked?.path).toBe("oldest.md");
	});

	it("breaks ties by lower stability (harder cards first)", () => {
		const cards = [
			card("easy.md", "2026-04-25", { fsrs_stability: 10 }),
			card("hard.md", "2026-04-25", { fsrs_stability: 0.5 }),
		];
		const picked = pickNext(cards, now);
		expect(picked?.path).toBe("hard.md");
	});

	it("respects scope: only cards in scope are eligible", () => {
		const cards = [
			card("in.md", "2026-04-20"),
			card("out.md", "2026-04-01"),
		];
		const picked = pickNext(cards, now, ["in.md"]);
		expect(picked?.path).toBe("in.md");
	});

	it("returns null when scope is empty or all out of scope", () => {
		const cards = [card("a.md", "2026-04-20")];
		expect(pickNext(cards, now, [])).toBeNull();
		expect(pickNext(cards, now, ["other.md"])).toBeNull();
	});

	it("treats a card due today as due — TZ regression", () => {
		// Regression on the timezone fix: a card whose fsrs_due is the
		// local YYYY-MM-DD of `now` must be selectable, no matter what
		// time of day `now` is in any timezone east of UTC.
		const todayLocal = new Date();
		const yyyy = todayLocal.getFullYear();
		const mm = String(todayLocal.getMonth() + 1).padStart(2, "0");
		const dd = String(todayLocal.getDate()).padStart(2, "0");
		// Force "now" to 01:00 local — the failure window in the old
		// `new Date(s)` code in CET (UTC offset 1–2h).
		const earlyAm = new Date(todayLocal);
		earlyAm.setHours(1, 0, 0, 0);
		const cards = [card("today.md", `${yyyy}-${mm}-${dd}`)];
		expect(pickNext(cards, earlyAm)?.path).toBe("today.md");
	});
});

describe("nextDueAfter", () => {
	const now = new Date("2026-04-28T12:00:00");

	it("returns the soonest non-due card's due date", () => {
		const cards = [
			card("future-far.md", "2026-06-01"),
			card("future-near.md", "2026-04-30"),
			card("past.md", "2026-04-01"),
		];
		const next = nextDueAfter(cards, now);
		expect(next).not.toBeNull();
		// Due dates parse as local midnight; compare via getTime
		expect(next!.getDate()).toBe(30);
		expect(next!.getMonth()).toBe(3); // April
	});

	it("returns null when all cards are already due", () => {
		const cards = [card("a.md", "2026-04-01"), card("b.md", "2026-04-15")];
		expect(nextDueAfter(cards, now)).toBeNull();
	});

	it("returns null when scope filters out all cards", () => {
		const cards = [card("a.md", "2026-05-01")];
		expect(nextDueAfter(cards, now, ["other.md"])).toBeNull();
	});
});
