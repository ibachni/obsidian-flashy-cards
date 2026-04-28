import type { ParsedCard } from "../cards/parser";
import { parseDueDate } from "./date-utils";

export type StateTagKind = "new" | "learning" | "review" | "overdue";

/**
 * Visual-semantic kind for a card's state tag. "Overdue" is a derived
 * condition (due-date passed) rather than an FSRS state, so it
 * supersedes the literal `fsrs_state` value when both apply.
 */
export function deriveStateTagKind(
	card: ParsedCard,
	now: Date = new Date(),
): StateTagKind {
	if (parseDueDate(card.fm.fsrs_due) < now) return "overdue";
	if (card.fm.fsrs_state === "new") return "new";
	if (
		card.fm.fsrs_state === "learning" ||
		card.fm.fsrs_state === "relearning"
	) {
		return "learning";
	}
	return "review";
}

// Static map — Tailwind v4's content scanner needs to see the literal
// class strings. Don't assemble these via template strings.
//
// Background opacity is /22 rather than /15: at 15% the pills sat too
// quietly against the pane bg in both themes (overdue / review barely
// readable in dark). 22% is a real fill while still staying inside the
// "tag, not button" register.
export const STATE_TAG_CLS: Record<StateTagKind, string> = {
	new: "bg-state-new/22 text-state-new",
	learning: "bg-state-learning/22 text-state-learning",
	review: "bg-state-review/22 text-state-review",
	overdue: "bg-state-overdue/22 text-state-overdue",
};

export const STATE_TAG_LABEL: Record<StateTagKind, string> = {
	new: "New",
	learning: "Learning",
	review: "Review",
	overdue: "Overdue",
};
