import {
	fsrs,
	generatorParameters,
	Rating,
	State,
	type Card as FsrsCard,
	type FSRS,
	type Grade,
} from "ts-fsrs";
import type { CardFrontmatterT } from "../schema/card";

/**
 * Tunable FSRS parameters surfaced in the Settings tab. `enable_fuzz`
 * stays on always — without it, many cards graduate together and pile
 * up on the same future day.
 */
export interface EngineParams {
	request_retention?: number;
	maximum_interval?: number;
}

export function makeEngine(params: EngineParams = {}): FSRS {
	return fsrs(
		generatorParameters({
			enable_fuzz: true,
			request_retention: params.request_retention ?? 0.9,
			maximum_interval: params.maximum_interval ?? 36500,
		}),
	);
}

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

export function gradeWith(
	engine: FSRS,
	fm: CardFrontmatterT,
	rating: Grade,
	now: Date = new Date(),
): FsrsUpdate {
	const fsrsCard = toFsrsCard(fm);
	const result = engine.next(fsrsCard, now, rating);
	return fromFsrsCard(result.card, now);
}

/**
 * Compute the candidate next-due dates for all four ratings without
 * mutating the card. Powers the projected-interval labels under each
 * grade button so the user can see calibrate Again vs. Hard vs. Good
 * vs. Easy before committing.
 *
 * One `engine.repeat` call yields all four candidates — cheaper than
 * four `engine.next` calls and avoids any chance of state drift between
 * the preview and the eventual grade write.
 */
export function previewIntervals(
	engine: FSRS,
	fm: CardFrontmatterT,
	now: Date = new Date(),
): Record<Grade, Date> {
	const preview = engine.repeat(toFsrsCard(fm), now);
	return {
		[Rating.Again]: preview[Rating.Again].card.due,
		[Rating.Hard]: preview[Rating.Hard].card.due,
		[Rating.Good]: preview[Rating.Good].card.due,
		[Rating.Easy]: preview[Rating.Easy].card.due,
	};
}

export { Rating };
export type { Grade, FSRS };
