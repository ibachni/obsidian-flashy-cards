/**
 * Where to draw a portaled combobox dropdown so it fits the viewport.
 * Either `top` or `bottom` is set — not both — depending on whether
 * the panel opens downward (default) or upward (when below is tight).
 * `maxHeight` caps the panel to the actually-available space so a
 * short viewport can't push the panel past the screen edge in
 * either direction.
 *
 * Pure (no React, no DOM beyond reading `getBoundingClientRect` /
 * `window.innerHeight`) so the comboboxes share one positioning
 * model — `TopicCombobox` and `TagCombobox` had identical
 * `top: rect.bottom + 4` logic that ignored available space.
 */
export interface PanelPosition {
	top?: number;
	bottom?: number;
	right: number;
	maxHeight: number;
}

/**
 * Compute panel coordinates relative to an anchor element (typically
 * the combobox chevron button). The panel is right-aligned to the
 * anchor's right edge — matches the visual model where the dropdown
 * "drops out" of the indicator the user clicked.
 *
 * Algorithm: prefer below; flip up only when the space below is
 * smaller than ~200px AND there's more room above. The 200px
 * threshold matches a comfortable minimum panel height (≈5 rows at
 * default text size). Below-by-default keeps the placement
 * predictable for the common case where the form lives high in the
 * viewport.
 */
export function computePanelPosition(anchor: HTMLElement): PanelPosition {
	const rect = anchor.getBoundingClientRect();
	// 4px gap between the anchor and the panel; 8px margin to the
	// viewport edge keeps the panel from kissing the window border.
	const gap = 4;
	const viewportMargin = 8;
	const spaceBelow = window.innerHeight - rect.bottom - viewportMargin;
	const spaceAbove = rect.top - viewportMargin;
	const right = window.innerWidth - rect.right;
	const MIN_BELOW = 200;

	if (spaceBelow < MIN_BELOW && spaceAbove > spaceBelow) {
		return {
			bottom: window.innerHeight - rect.top + gap,
			right,
			maxHeight: Math.max(0, spaceAbove),
		};
	}
	return {
		top: rect.bottom + gap,
		right,
		maxHeight: Math.max(0, spaceBelow),
	};
}
