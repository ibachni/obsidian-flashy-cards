import type { ParsedCard } from "../../cards/parser";
import type { ReviewLogEntry } from "../../cards/review-log";
import { parseDueDate } from "../date-utils";

export type StateKey = "new" | "learning" | "review" | "relearning";

export interface StateCounts {
	new: number;
	learning: number;
	review: number;
	relearning: number;
}

export interface ForecastBucket {
	/** YYYY-MM-DD, local. */
	date: string;
	counts: StateCounts;
}

function emptyCounts(): StateCounts {
	return { new: 0, learning: 0, review: 0, relearning: 0 };
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/**
 * Render a Date as a local-zone `YYYY-MM-DD`. Same shape as
 * `new-card.ts`'s private `isoDate`; we don't share it because that
 * file is the create path and any cross-import would risk circular
 * loading.
 */
function localIsoDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfLocalDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Count cards by FSRS state. Used by the State breakdown panel. Pure
 * over the parsed-card array — no date math.
 */
export function groupCardsByState(cards: ParsedCard[]): StateCounts {
	const out = emptyCounts();
	for (const c of cards) out[c.fm.fsrs_state]++;
	return out;
}

/**
 * Build `days` daily buckets starting at the local-midnight of `today`,
 * counting cards due in each bucket stacked by state.
 *
 * Overdue cards (due before today) are excluded — they're already on
 * the queue and the State breakdown panel covers them. Cards due past
 * the window are also excluded.
 *
 * Each card lands in at most one bucket. Buckets are returned in
 * chronological order with zero-count days included so a renderer can
 * just `.map` over them.
 */
export function forecast(
	cards: ParsedCard[],
	today: Date,
	days: number,
): ForecastBucket[] {
	if (days <= 0) return [];
	const startMs = startOfLocalDay(today).getTime();
	const dayMs = 24 * 60 * 60 * 1000;

	const buckets: ForecastBucket[] = [];
	for (let i = 0; i < days; i++) {
		buckets.push({
			date: localIsoDate(new Date(startMs + i * dayMs)),
			counts: emptyCounts(),
		});
	}

	for (const c of cards) {
		const due = parseDueDate(c.fm.fsrs_due);
		const dayIndex = Math.floor((due.getTime() - startMs) / dayMs);
		if (dayIndex < 0 || dayIndex >= days) continue;
		const bucket = buckets[dayIndex];
		if (bucket) bucket.counts[c.fm.fsrs_state]++;
	}

	return buckets;
}

export interface RetentionStat {
	/** Number of grades counted (capped at `limit`). */
	total: number;
	/** Count of Good + Easy grades among `total`. */
	hits: number;
	/** hits / total, or `null` when total === 0. */
	rate: number | null;
	/** Oldest date among the counted entries, or `null` when empty. */
	sinceDate: string | null;
}

/**
 * Compute retention over the most recent `limit` entries.
 *
 * Expects `entries` in chronological (oldest-first) order — the same
 * order `readAll` returns. The function slices the last `limit`
 * entries; passing more than `limit` is fine, fewer just returns the
 * actual ratio.
 *
 * Good / Easy = "remembered" (grade >= 3). Again / Hard count as
 * misses.
 */
export function retentionRate(
	entries: ReviewLogEntry[],
	limit: number,
): RetentionStat {
	const capped = limit > 0 ? entries.slice(-limit) : [];
	let hits = 0;
	for (const e of capped) if (e.grade >= 3) hits++;
	return {
		total: capped.length,
		hits,
		rate: capped.length === 0 ? null : hits / capped.length,
		sinceDate: capped[0]?.date ?? null,
	};
}

export interface StreakStat {
	days: number;
	/** Most recent date with any grades, regardless of streak status. */
	lastDate: string | null;
}

/**
 * Consecutive-day streak walking backwards from `today`. Today is
 * "alive" — a day with no grades yet does not break the prior chain.
 * Stops at the first fully-empty day before today.
 *
 * `lastDate` is the most-recent grade date globally (not necessarily
 * inside the streak chain) — useful for the "Last reviewed" sub-line
 * even when the streak is zero.
 */
export function streak(entries: ReviewLogEntry[], today: Date): StreakStat {
	const dates = new Set<string>();
	let lastDate: string | null = null;
	for (const e of entries) {
		dates.add(e.date);
		if (lastDate === null || e.date > lastDate) lastDate = e.date;
	}

	const cursor = startOfLocalDay(today);
	let days = 0;
	if (dates.has(localIsoDate(cursor))) days++;

	const walker = new Date(cursor);
	walker.setDate(walker.getDate() - 1);
	while (dates.has(localIsoDate(walker))) {
		days++;
		walker.setDate(walker.getDate() - 1);
	}

	return { days, lastDate };
}

export interface TopicRetention {
	topic: string;
	total: number;
	hits: number;
	rate: number;
}

/**
 * Retention rate per topic over a trailing window. Topics with fewer
 * than `minGrades` entries in the window are dropped — a single lapse
 * on a brand-new topic reading as 0% would panic the user.
 *
 * Returns weakest-first so the panel can render the rows in order
 * without an extra sort.
 */
export function perTopicRetention(
	entries: ReviewLogEntry[],
	today: Date,
	windowDays: number,
	minGrades: number,
): TopicRetention[] {
	if (windowDays <= 0) return [];
	const cutoff = startOfLocalDay(today);
	cutoff.setDate(cutoff.getDate() - (windowDays - 1));
	const cutoffKey = localIsoDate(cutoff);

	const byTopic = new Map<string, { total: number; hits: number }>();
	for (const e of entries) {
		// ISO YYYY-MM-DD compares correctly as strings — no Date parse.
		if (e.date < cutoffKey) continue;
		const cur = byTopic.get(e.topic) ?? { total: 0, hits: 0 };
		cur.total++;
		if (e.grade >= 3) cur.hits++;
		byTopic.set(e.topic, cur);
	}

	const out: TopicRetention[] = [];
	for (const [topic, { total, hits }] of byTopic) {
		if (total < minGrades) continue;
		out.push({ topic, total, hits, rate: hits / total });
	}
	out.sort((a, b) => a.rate - b.rate);
	return out;
}

export interface HeatmapCell {
	/** YYYY-MM-DD, local. */
	date: string;
	count: number;
}

/**
 * Build a chronological array of `days` daily grade counts ending on
 * `today` (inclusive). Includes zero-count days so the renderer can
 * iterate without gaps. Entries outside the window are excluded.
 *
 * Default of 365 covers a year — what the GitHub-style heatmap wants.
 */
export function heatmapBuckets(
	entries: ReviewLogEntry[],
	today: Date,
	days: number = 365,
): HeatmapCell[] {
	if (days <= 0) return [];
	const totals = new Map<string, number>();
	for (const e of entries) totals.set(e.date, (totals.get(e.date) ?? 0) + 1);

	const end = startOfLocalDay(today);
	const start = new Date(end);
	start.setDate(start.getDate() - (days - 1));

	const cells: HeatmapCell[] = [];
	const d = new Date(start);
	while (d <= end) {
		const key = localIsoDate(d);
		cells.push({ date: key, count: totals.get(key) ?? 0 });
		d.setDate(d.getDate() + 1);
	}
	return cells;
}
