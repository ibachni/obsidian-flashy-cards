import type { CSSProperties } from "react";
import type { StateKey } from "./aggregations";

/**
 * Inline-style colors for the four FSRS states in Stats panels.
 *
 * We use inline `backgroundColor` rather than Tailwind utility classes
 * because Tailwind v4's scanner only generated `bg-state-new/22` etc.
 * from state-tag.ts — the full-opacity `bg-state-new` (no modifier)
 * never made it into the compiled CSS. Inline styles bypass the
 * scanner; the CSS variables resolve through the `.learning-system-root`
 * cascade just like any other themed color.
 *
 * Differs from `state-tag.ts` by splitting `learning` and `relearning`
 * into distinct colors: relearning maps to the overdue clay-red token
 * because relearning *is* a lapse — the user forgot a card that had
 * already graduated. The Browse row collapses both into one tag kind;
 * Stats wants the distinction visible.
 */
export const STATE_BAR_STYLE: Record<StateKey, CSSProperties> = {
	new: { backgroundColor: "rgb(var(--ls-state-new))" },
	learning: { backgroundColor: "rgb(var(--ls-state-learning))" },
	review: { backgroundColor: "rgb(var(--ls-state-review))" },
	relearning: { backgroundColor: "rgb(var(--ls-state-overdue))" },
};

export const STATE_LABEL: Record<StateKey, string> = {
	new: "New",
	learning: "Learning",
	review: "Review",
	relearning: "Relearning",
};

/** Render order: lowest-activity (new) at the bottom of stacks. */
export const STATE_ORDER: readonly StateKey[] = [
	"new",
	"learning",
	"review",
	"relearning",
];
