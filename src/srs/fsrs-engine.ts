import {
	fsrs,
	generatorParameters,
	Rating,
	State,
	type Card as FsrsCard,
	type Grade,
} from "ts-fsrs";
import type { CardFrontmatterT } from "../schema/card";

// ts-fsrs is configured with library defaults except for fuzz, which is
// enabled to spread cards across days when many are scheduled together.
// Per phase1 risk register: leave parameters at defaults until P4.
const params = generatorParameters({ enable_fuzz: true });
const engine = fsrs(params);

function fsrsStateToString(s: State): CardFrontmatterT["fsrs_state"] {
	switch (s) {
		case State.New:
			return "new";
		case State.Learning:
			return "learning";
		case State.Review:
			return "review";
		case State.Relearning:
			return "relearning";
	}
}

function stringToFsrsState(s: CardFrontmatterT["fsrs_state"]): State {
	switch (s) {
		case "new":
			return State.New;
		case "learning":
			return State.Learning;
		case "review":
			return State.Review;
		case "relearning":
			return State.Relearning;
	}
}

/**
 * Flat object containing exactly the `fsrs_*` fields a grade write must
 * persist back to a card's frontmatter. Caller is responsible for the
 * `modified` field — that's a card-level concern, not FSRS state.
 */
export interface FsrsUpdate {
	fsrs_due: string;
	fsrs_stability: number;
	fsrs_difficulty: number;
	fsrs_elapsed_days: number;
	fsrs_scheduled_days: number;
	fsrs_learning_steps: number;
	fsrs_reps: number;
	fsrs_lapses: number;
	fsrs_state: CardFrontmatterT["fsrs_state"];
	fsrs_last_review: string;
}

function toFsrsCard(fm: CardFrontmatterT): FsrsCard {
	return {
		due: new Date(fm.fsrs_due),
		stability: fm.fsrs_stability,
		difficulty: fm.fsrs_difficulty,
		elapsed_days: fm.fsrs_elapsed_days,
		scheduled_days: fm.fsrs_scheduled_days,
		learning_steps: fm.fsrs_learning_steps,
		reps: fm.fsrs_reps,
		lapses: fm.fsrs_lapses,
		state: stringToFsrsState(fm.fsrs_state),
		last_review: fm.fsrs_last_review
			? new Date(fm.fsrs_last_review)
			: undefined,
	};
}

function fromFsrsCard(card: FsrsCard, now: Date): FsrsUpdate {
	return {
		// fsrs_due as date-only — FSRS schedules in days, and this keeps
		// Obsidian's Properties UI rendering it as a date picker.
		fsrs_due: card.due.toISOString().slice(0, 10),
		fsrs_stability: card.stability,
		fsrs_difficulty: card.difficulty,
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		fsrs_elapsed_days: card.elapsed_days,
		fsrs_scheduled_days: card.scheduled_days,
		fsrs_learning_steps: card.learning_steps,
		fsrs_reps: card.reps,
		fsrs_lapses: card.lapses,
		fsrs_state: fsrsStateToString(card.state),
		// last_review with full ISO datetime — preserves precise timestamps
		// for any future review-history analysis.
		fsrs_last_review: now.toISOString(),
	};
}

export function gradeCard(
	fm: CardFrontmatterT,
	rating: Grade,
	now: Date = new Date(),
): FsrsUpdate {
	const fsrsCard = toFsrsCard(fm);
	const result = engine.next(fsrsCard, now, rating);
	return fromFsrsCard(result.card, now);
}

export { Rating };
export type { Grade };
