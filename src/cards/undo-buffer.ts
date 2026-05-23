import type { CardFrontmatterT } from "../schema/card";

export interface UndoEntry {
	/**
	 * In-memory card id — `<path>` for non-cloze cards, `<path>#c<N>`
	 * for cloze siblings. Used by the store lookup so the rollback
	 * lands on the exact sibling that was graded.
	 */
	cardId: string;
	/** Card path — used to resolve the TFile and as the review-log `path` field. */
	path: string;
	/**
	 * `null` for non-cloze cards; the cloze number for siblings. Drives
	 * the undo branch in `undoLastGrade`: non-cloze restores flat
	 * `fsrs_*` scalars, cloze sibling restores `fsrs_clozes[N]`.
	 */
	clozeIndex: number | null;
	/** Deep-cloned frontmatter snapshot from *before* the grade. Restored verbatim. */
	previousFm: CardFrontmatterT;
	/** YYYY-MM-DD written into the review-log entry's `date` field. Used to find the month file. */
	logDate: string;
}

/**
 * One-slot ring buffer. A plain object wrapper so call sites can swap
 * in a future multi-step ring buffer without changing the API.
 */
export interface UndoSlot {
	entry: UndoEntry | null;
}

export function createSlot(): UndoSlot {
	return { entry: null };
}

/**
 * Overwrites whatever was in the slot. Single-slot by design — matches
 * the roadmap spec and Anki: undo is for fat-finger recovery, not history.
 */
export function stashGrade(slot: UndoSlot, entry: UndoEntry): void {
	slot.entry = entry;
}

/**
 * Returns the stored entry and clears the slot in one step. Returns
 * `null` when the slot is empty — caller surfaces "Nothing to undo".
 */
export function takeGrade(slot: UndoSlot): UndoEntry | null {
	const entry = slot.entry;
	slot.entry = null;
	return entry;
}
