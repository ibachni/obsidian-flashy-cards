import { describe, expect, it } from "vitest";
import type { ParsedCard } from "../../cards/parser";
import type { ReviewLogEntry } from "../../cards/review-log";
import {
	forecast,
	groupCardsByState,
	heatmapBuckets,
	perTopicRetention,
	retentionRate,
	streak,
} from "./aggregations";

function card(
	path: string,
	due: string,
	state: ParsedCard["fm"]["fsrs_state"] = "review",
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
			fsrs_state: state,
			fsrs_last_review: null,
			tags: [],
			related: [],
		},
	};
}

describe("groupCardsByState", () => {
	it("counts each state and sums to the input length", () => {
		const cards = [
			card("a", "2026-05-20", "new"),
			card("b", "2026-05-20", "new"),
			card("c", "2026-05-20", "learning"),
			card("d", "2026-05-20", "review"),
			card("e", "2026-05-20", "review"),
			card("f", "2026-05-20", "relearning"),
		];
		const got = groupCardsByState(cards);
		expect(got).toEqual({ new: 2, learning: 1, review: 2, relearning: 1 });
		const total = got.new + got.learning + got.review + got.relearning;
		expect(total).toBe(cards.length);
	});

	it("returns all-zero on empty input", () => {
		expect(groupCardsByState([])).toEqual({
			new: 0,
			learning: 0,
			review: 0,
			relearning: 0,
		});
	});
});

describe("forecast", () => {
	// 2026-05-20 local midnight
	const today = new Date(2026, 4, 20);

	it("builds `days` chronological buckets, starting at today", () => {
		const got = forecast([], today, 30);
		expect(got).toHaveLength(30);
		expect(got[0]?.date).toBe("2026-05-20");
		expect(got[29]?.date).toBe("2026-06-18");
	});

	it("groups cards into the right day + state bucket", () => {
		const cards = [
			card("a", "2026-05-20", "new"),
			card("b", "2026-05-21", "learning"),
			card("c", "2026-05-21", "review"),
			card("d", "2026-05-22", "relearning"),
		];
		const got = forecast(cards, today, 30);
		expect(got[0]?.counts).toEqual({
			new: 1,
			learning: 0,
			review: 0,
			relearning: 0,
		});
		expect(got[1]?.counts).toEqual({
			new: 0,
			learning: 1,
			review: 1,
			relearning: 0,
		});
		expect(got[2]?.counts).toEqual({
			new: 0,
			learning: 0,
			review: 0,
			relearning: 1,
		});
	});

	it("bucket counts add up to the total due-in-window", () => {
		const cards = [
			card("a", "2026-05-20", "review"),
			card("b", "2026-05-25", "review"),
			card("c", "2026-06-01", "new"),
		];
		const got = forecast(cards, today, 30);
		let total = 0;
		for (const b of got) {
			total += b.counts.new + b.counts.learning + b.counts.review + b.counts.relearning;
		}
		expect(total).toBe(cards.length);
	});

	it("excludes overdue cards (due before today)", () => {
		const cards = [
			card("past1", "2026-05-19", "review"),
			card("past2", "2025-12-31", "review"),
			card("today", "2026-05-20", "review"),
		];
		const got = forecast(cards, today, 30);
		const totalInBuckets = got.reduce(
			(acc, b) =>
				acc + b.counts.new + b.counts.learning + b.counts.review + b.counts.relearning,
			0,
		);
		expect(totalInBuckets).toBe(1);
	});

	it("excludes cards due past the window", () => {
		const cards = [
			card("inside", "2026-06-18", "review"), // last day of 30-day window
			card("outside", "2026-06-19", "review"), // day after window ends
		];
		const got = forecast(cards, today, 30);
		const totalInBuckets = got.reduce(
			(acc, b) =>
				acc + b.counts.new + b.counts.learning + b.counts.review + b.counts.relearning,
			0,
		);
		expect(totalInBuckets).toBe(1);
	});

	it("returns [] when days <= 0", () => {
		expect(forecast([card("a", "2026-05-20")], today, 0)).toEqual([]);
		expect(forecast([card("a", "2026-05-20")], today, -1)).toEqual([]);
	});

	it("normalizes `today` to local midnight (mid-day input is fine)", () => {
		const midday = new Date(2026, 4, 20, 14, 30); // 2:30pm
		const got = forecast(
			[card("a", "2026-05-20", "review")],
			midday,
			3,
		);
		expect(got[0]?.date).toBe("2026-05-20");
		expect(got[0]?.counts.review).toBe(1);
	});
});

function entry(overrides: Partial<ReviewLogEntry> = {}): ReviewLogEntry {
	return {
		path: "Cards/dns/foo.md",
		topic: "dns",
		date: "2026-05-20",
		grade: 3,
		interval: 1,
		prevState: "learning",
		...overrides,
	};
}

describe("retentionRate", () => {
	it("computes hits / total over the last `limit` entries (chronological input)", () => {
		const entries = [
			entry({ date: "2026-05-01", grade: 1 }), // miss
			entry({ date: "2026-05-02", grade: 3 }), // hit
			entry({ date: "2026-05-03", grade: 4 }), // hit
			entry({ date: "2026-05-04", grade: 2 }), // miss
		];
		const got = retentionRate(entries, 10);
		expect(got).toEqual({
			total: 4,
			hits: 2,
			rate: 0.5,
			sinceDate: "2026-05-01",
		});
	});

	it("caps at `limit` and reports sinceDate as the oldest within the cap", () => {
		const entries = [
			entry({ date: "2026-04-01", grade: 1 }),
			entry({ date: "2026-04-15", grade: 3 }),
			entry({ date: "2026-05-01", grade: 3 }),
			entry({ date: "2026-05-15", grade: 4 }),
		];
		const got = retentionRate(entries, 2);
		// Last 2 entries: 2026-05-01 (grade 3) and 2026-05-15 (grade 4).
		expect(got.total).toBe(2);
		expect(got.hits).toBe(2);
		expect(got.rate).toBe(1);
		expect(got.sinceDate).toBe("2026-05-01");
	});

	it("returns empty stat for zero entries", () => {
		expect(retentionRate([], 10)).toEqual({
			total: 0,
			hits: 0,
			rate: null,
			sinceDate: null,
		});
	});

	it("returns empty stat for limit <= 0", () => {
		expect(retentionRate([entry()], 0).total).toBe(0);
		expect(retentionRate([entry()], -1).rate).toBeNull();
	});
});

describe("streak", () => {
	const today = new Date(2026, 4, 20); // 2026-05-20

	it("returns 0 days and null lastDate on empty input", () => {
		expect(streak([], today)).toEqual({ days: 0, lastDate: null });
	});

	it("counts today when today has grades", () => {
		const got = streak([entry({ date: "2026-05-20" })], today);
		expect(got).toEqual({ days: 1, lastDate: "2026-05-20" });
	});

	it("today alive: yesterday-only chain still counts even when today is empty", () => {
		const got = streak(
			[
				entry({ date: "2026-05-18" }),
				entry({ date: "2026-05-19" }),
			],
			today,
		);
		expect(got).toEqual({ days: 2, lastDate: "2026-05-19" });
	});

	it("breaks on the first empty day before today", () => {
		const got = streak(
			[
				entry({ date: "2026-05-10" }),
				entry({ date: "2026-05-11" }),
				// gap at 2026-05-12
				entry({ date: "2026-05-13" }),
				entry({ date: "2026-05-14" }),
				entry({ date: "2026-05-15" }),
			],
			today,
		);
		// Today is empty (alive). Yesterday 2026-05-19 is empty → chain broken.
		// Result: days=0; lastDate = 2026-05-15 (most-recent grade).
		expect(got).toEqual({ days: 0, lastDate: "2026-05-15" });
	});

	it("handles same-day duplicates as a single streak day", () => {
		const got = streak(
			[
				entry({ date: "2026-05-19" }),
				entry({ date: "2026-05-19" }),
				entry({ date: "2026-05-19" }),
				entry({ date: "2026-05-20" }),
			],
			today,
		);
		expect(got).toEqual({ days: 2, lastDate: "2026-05-20" });
	});

	it("walks back arbitrarily far when the chain holds", () => {
		const entries: ReviewLogEntry[] = [];
		for (let i = 0; i < 30; i++) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			entries.push(
				entry({
					date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
				}),
			);
		}
		expect(streak(entries, today).days).toBe(30);
	});
});

describe("perTopicRetention", () => {
	const today = new Date(2026, 4, 20);

	it("groups by topic, computes retention, sorts weakest-first", () => {
		const entries = [
			// dns: 5 grades, 4 hits → 80%
			entry({ topic: "dns", date: "2026-05-10", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-11", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-12", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-13", grade: 4 }),
			entry({ topic: "dns", date: "2026-05-14", grade: 1 }),
			// k8s: 5 grades, 2 hits → 40%
			entry({ topic: "k8s", date: "2026-05-10", grade: 1 }),
			entry({ topic: "k8s", date: "2026-05-11", grade: 1 }),
			entry({ topic: "k8s", date: "2026-05-12", grade: 2 }),
			entry({ topic: "k8s", date: "2026-05-13", grade: 3 }),
			entry({ topic: "k8s", date: "2026-05-14", grade: 4 }),
		];
		const got = perTopicRetention(entries, today, 30, 5);
		expect(got.map((t) => t.topic)).toEqual(["k8s", "dns"]);
		expect(got[0]?.rate).toBeCloseTo(0.4);
		expect(got[1]?.rate).toBeCloseTo(0.8);
	});

	it("excludes entries outside the trailing window", () => {
		const entries = [
			// Inside the 5-day window (2026-05-16 .. 2026-05-20)
			entry({ topic: "dns", date: "2026-05-16", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-17", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-18", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-19", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-20", grade: 3 }),
			// Outside the window
			entry({ topic: "dns", date: "2026-05-15", grade: 1 }),
			entry({ topic: "dns", date: "2026-01-01", grade: 1 }),
		];
		const got = perTopicRetention(entries, today, 5, 5);
		expect(got).toHaveLength(1);
		expect(got[0]?.total).toBe(5);
		expect(got[0]?.hits).toBe(5);
	});

	it("hides topics with fewer than minGrades entries", () => {
		const entries = [
			entry({ topic: "dns", date: "2026-05-19", grade: 3 }),
			entry({ topic: "dns", date: "2026-05-20", grade: 3 }),
			// only 2 grades — below floor of 5
		];
		const got = perTopicRetention(entries, today, 30, 5);
		expect(got).toEqual([]);
	});

	it("returns [] when windowDays <= 0", () => {
		expect(perTopicRetention([entry()], today, 0, 5)).toEqual([]);
		expect(perTopicRetention([entry()], today, -3, 5)).toEqual([]);
	});
});

describe("heatmapBuckets", () => {
	const today = new Date(2026, 4, 20);

	it("returns `days` cells in chronological order ending on today", () => {
		const got = heatmapBuckets([], today, 7);
		expect(got).toHaveLength(7);
		expect(got[0]?.date).toBe("2026-05-14");
		expect(got[6]?.date).toBe("2026-05-20");
		for (const c of got) expect(c.count).toBe(0);
	});

	it("counts entries per day", () => {
		const entries = [
			entry({ date: "2026-05-19" }),
			entry({ date: "2026-05-19" }),
			entry({ date: "2026-05-20" }),
			entry({ date: "2026-05-20" }),
			entry({ date: "2026-05-20" }),
		];
		const got = heatmapBuckets(entries, today, 7);
		const map = new Map(got.map((c) => [c.date, c.count]));
		expect(map.get("2026-05-19")).toBe(2);
		expect(map.get("2026-05-20")).toBe(3);
	});

	it("excludes entries outside the window", () => {
		const entries = [
			entry({ date: "2026-01-01" }),
			entry({ date: "2026-05-13" }), // one day before the 7-day window
			entry({ date: "2026-05-14" }), // first day of window
		];
		const got = heatmapBuckets(entries, today, 7);
		const total = got.reduce((acc, c) => acc + c.count, 0);
		expect(total).toBe(1);
	});

	it("defaults to a 365-day window when `days` is omitted", () => {
		const got = heatmapBuckets([], today);
		expect(got).toHaveLength(365);
	});

	it("returns [] when days <= 0", () => {
		expect(heatmapBuckets([entry()], today, 0)).toEqual([]);
		expect(heatmapBuckets([entry()], today, -1)).toEqual([]);
	});
});
