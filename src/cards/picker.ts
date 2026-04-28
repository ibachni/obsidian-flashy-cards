import type { ParsedCard } from "./parser";
import { parseDueDate } from "../views/date-utils";

function applyScope(
	cards: ParsedCard[],
	scope: string[] | null,
): ParsedCard[] {
	if (scope === null) return cards;
	const allowed = new Set(scope);
	return cards.filter((c) => allowed.has(c.path));
}

/**
 * Pick the next card due for review.
 *
 * Filtering: cards whose `fsrs_due` is at or before `now`, optionally
 * restricted to a scoped path set (set by Browse → "Test this section").
 * Ordering: most overdue first (smaller fsrs_due timestamp wins),
 * tiebreak by lower stability (harder cards prioritized).
 *
 * Returns null when nothing is due — the Review pane shows its empty
 * state. M4's earlier "fall back to any card" was removed per the
 * deferred register: the empty state is the contract now.
 */
export function pickNext(
	cards: ParsedCard[],
	now: Date = new Date(),
	scope: string[] | null = null,
): ParsedCard | null {
	const pool = applyScope(cards, scope);
	const due = pool.filter((c) => parseDueDate(c.fm.fsrs_due) <= now);
	if (due.length === 0) return null;

	const sorted = due.slice().sort((a, b) => {
		const ageDiff =
			parseDueDate(a.fm.fsrs_due).getTime() -
			parseDueDate(b.fm.fsrs_due).getTime();
		if (ageDiff !== 0) return ageDiff;
		return a.fm.fsrs_stability - b.fm.fsrs_stability;
	});

	return sorted[0] ?? null;
}

/**
 * Soonest non-due card's due date — used by the Review pane's empty
 * state to render "Next card due in 4h 23m." Returns null when *all*
 * cards (within scope) are already due, or when nothing falls inside
 * the scope.
 */
export function nextDueAfter(
	cards: ParsedCard[],
	now: Date = new Date(),
	scope: string[] | null = null,
): Date | null {
	const pool = applyScope(cards, scope);
	let earliest: Date | null = null;
	for (const c of pool) {
		const t = parseDueDate(c.fm.fsrs_due);
		if (t > now && (earliest === null || t < earliest)) {
			earliest = t;
		}
	}
	return earliest;
}
