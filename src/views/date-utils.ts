/**
 * End of *today* in local time. Used by both BrowsePane filter logic
 * and TopicTable due-count computation so a card's "due today"
 * classification is identical across the two surfaces.
 */
export function endOfTodayDate(): Date {
	const d = new Date();
	d.setHours(23, 59, 59, 999);
	return d;
}

/**
 * Parse an `fsrs_due` value into a comparable Date.
 *
 * `fsrs_due` is written as date-only `YYYY-MM-DD` (so Obsidian's
 * Properties UI renders a date picker). `new Date('2026-04-28')`
 * parses that as **UTC midnight**, which means a card "due today"
 * isn't eligible until the timezone offset has elapsed (02:00 in CET).
 * That makes the Review pane disagree with Browse's "Due today"
 * (`endOfTodayDate`) for the first hours of the day east of UTC.
 *
 * Parsing as local midnight aligns the two surfaces: a card due
 * `YYYY-MM-DD` is eligible from local 00:00 of that day. Full ISO
 * datetimes (e.g. `fsrs_last_review`) pass through unchanged.
 */
export function parseDueDate(s: string): Date {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (m) {
		return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	}
	return new Date(s);
}

/**
 * Human-friendly rendering of an `fsrs_due` date for footer/meta strips.
 * Drops the year when it matches the current year (most common case),
 * so the date reads as "Apr 28" rather than "Apr 28, 2026" — quieter
 * for the eye when surrounded by other meta.
 */
export function formatDueShort(iso: string, now: Date = new Date()): string {
	const d = parseDueDate(iso);
	const opts: Intl.DateTimeFormatOptions =
		d.getFullYear() === now.getFullYear()
			? { month: "short", day: "numeric" }
			: { month: "short", day: "numeric", year: "numeric" };
	return d.toLocaleDateString(undefined, opts);
}

/**
 * Compact relative-time delta — used in the empty-state of the Review
 * pane and in any future "next due" ticker. Output examples: `5m`,
 * `2h 13m`, `1d 4h`.
 */
export function formatDelta(target: Date, now: Date = new Date()): string {
	const ms = target.getTime() - now.getTime();
	const minutes = Math.max(0, Math.round(ms / (60 * 1000)));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remMins = minutes % 60;
	if (hours < 24) return `${hours}h ${remMins}m`;
	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return `${days}d ${remHours}h`;
}
