import { describe, expect, it } from "vitest";
import {
	endOfTodayDate,
	formatDelta,
	formatInterval,
	parseDueDate,
} from "./date-utils";

describe("parseDueDate", () => {
	it("parses a date-only YYYY-MM-DD as local midnight (not UTC)", () => {
		// Regression: `new Date("2026-04-28")` is **UTC** midnight; that
		// shift by the local TZ offset made cards "due today" wait until
		// after that offset elapsed (e.g. 02:00 in CET). parseDueDate
		// must produce local midnight so Review and Browse agree.
		const d = parseDueDate("2026-04-28");
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(3); // April
		expect(d.getDate()).toBe(28);
		expect(d.getHours()).toBe(0);
		expect(d.getMinutes()).toBe(0);
	});

	it("a card due today is `<= now` from local 00:00 onward", () => {
		// The exact bug from the review: at 01:30 local time on the due
		// date, the UTC parse left the card not-yet-due in any timezone
		// east of UTC. With local-midnight parse, the card is due all day.
		const today = new Date();
		const yyyy = today.getFullYear();
		const mm = String(today.getMonth() + 1).padStart(2, "0");
		const dd = String(today.getDate()).padStart(2, "0");
		const due = parseDueDate(`${yyyy}-${mm}-${dd}`);
		// "Now" pinned to 00:30 local — earliest realistic moment a user
		// would expect a card due today to be reviewable.
		const earlyMorning = new Date(today);
		earlyMorning.setHours(0, 30, 0, 0);
		expect(due.getTime()).toBeLessThanOrEqual(earlyMorning.getTime());
	});

	it("passes full ISO datetimes through unchanged", () => {
		const iso = "2026-04-28T13:42:00.000Z";
		const d = parseDueDate(iso);
		expect(d.toISOString()).toBe(iso);
	});
});

describe("endOfTodayDate", () => {
	it("returns 23:59:59.999 of today in local time", () => {
		const eod = endOfTodayDate();
		const now = new Date();
		expect(eod.getFullYear()).toBe(now.getFullYear());
		expect(eod.getMonth()).toBe(now.getMonth());
		expect(eod.getDate()).toBe(now.getDate());
		expect(eod.getHours()).toBe(23);
		expect(eod.getMinutes()).toBe(59);
		expect(eod.getSeconds()).toBe(59);
		expect(eod.getMilliseconds()).toBe(999);
	});
});

describe("formatDelta", () => {
	const now = new Date("2026-04-28T12:00:00Z");

	it("formats sub-hour deltas as minutes", () => {
		const t = new Date(now.getTime() + 5 * 60_000);
		expect(formatDelta(t, now)).toBe("5m");
	});

	it("formats sub-day deltas as hours + minutes", () => {
		const t = new Date(now.getTime() + (2 * 60 + 13) * 60_000);
		expect(formatDelta(t, now)).toBe("2h 13m");
	});

	it("formats multi-day deltas as days + hours", () => {
		const t = new Date(now.getTime() + (28 * 60 + 0) * 60_000);
		expect(formatDelta(t, now)).toBe("1d 4h");
	});

	it("clamps negative deltas to 0m", () => {
		const t = new Date(now.getTime() - 60_000);
		expect(formatDelta(t, now)).toBe("0m");
	});
});

describe("formatInterval", () => {
	const now = new Date("2026-04-28T12:00:00Z");

	it("renders sub-hour intervals in minutes", () => {
		expect(formatInterval(new Date(now.getTime() + 10 * 60_000), now)).toBe(
			"10m",
		);
		expect(formatInterval(new Date(now.getTime() + 59 * 60_000), now)).toBe(
			"59m",
		);
	});

	it("floors at 1m for near-zero positive deltas", () => {
		// Fuzz-jittered learning steps can land seconds away from `now`.
		// Rendering `0m` would read as broken — clamp upward to 1m.
		expect(formatInterval(new Date(now.getTime() + 5_000), now)).toBe("1m");
		expect(formatInterval(now, now)).toBe("1m");
	});

	it("rolls 60m up to 1h", () => {
		expect(formatInterval(new Date(now.getTime() + 60 * 60_000), now)).toBe(
			"1h",
		);
		expect(
			formatInterval(new Date(now.getTime() + 23 * 60 * 60_000), now),
		).toBe("23h");
	});

	it("rolls 24h up to 1d and stays in days under 30", () => {
		const d = 24 * 60 * 60_000;
		expect(formatInterval(new Date(now.getTime() + d), now)).toBe("1d");
		expect(formatInterval(new Date(now.getTime() + 11 * d), now)).toBe("11d");
		expect(formatInterval(new Date(now.getTime() + 29 * d), now)).toBe("29d");
	});

	it("switches to months between 30d and 12mo", () => {
		const d = 24 * 60 * 60_000;
		expect(formatInterval(new Date(now.getTime() + 30 * d), now)).toBe("1mo");
		expect(formatInterval(new Date(now.getTime() + 180 * d), now)).toBe("6mo");
	});

	it("switches to years from 12mo onward", () => {
		const d = 24 * 60 * 60_000;
		expect(formatInterval(new Date(now.getTime() + 365 * d), now)).toBe("1y");
		expect(formatInterval(new Date(now.getTime() + 3 * 365 * d), now)).toBe(
			"3y",
		);
	});
});
