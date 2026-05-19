/**
 * Closed-interval overlap test for integer ranges. Returns true iff
 * `[aStart..aEnd]` and `[bStart..bEnd]` share at least one position.
 *
 * Used by the live-preview ViewPlugin to decide whether the cursor's
 * selection range overlaps a markup or math/wiki-link range — if it
 * does, that token's source is left visible for editing; if not, the
 * markers (or whole expression, for math) get hidden / widget-replaced.
 *
 * Pure function — extracted so vitest can exercise it without loading
 * `live-preview-decorations.ts`, which transitively imports `obsidian`
 * (whose package.json has `main: ""` and won't resolve in node).
 */
export function rangesOverlap(
	aStart: number,
	aEnd: number,
	bStart: number,
	bEnd: number,
): boolean {
	return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}
