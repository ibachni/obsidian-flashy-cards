/**
 * Pure geometry primitives for the occlusion editor's drawing surface.
 * No React or DOM dependencies — the editor component composes these
 * with pointer events; tests exercise them directly.
 *
 * Coordinates throughout are image-pixel space (matching the SVG
 * `viewBox`). The editor translates DOM pixel space (mouse coords) to
 * image space before calling into these helpers.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Eight resize handles by compass direction. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * Minimum area (in image pixels²) below which a freshly-drawn rectangle
 * is discarded on mouse-up. Tuned at ~100 — matches a 10×10 box, which
 * is too small to be a legible mask on any reasonable source image.
 */
export const MIN_AREA = 100;

/**
 * Normalize a rectangle so width and height are positive. A user
 * dragging up-and-left produces negative w/h during the in-progress
 * draw; commit time runs this so storage always sees the canonical
 * top-left+positive-extent shape.
 */
export function normalizeRect(r: Rect): Rect {
	const x = r.w < 0 ? r.x + r.w : r.x;
	const y = r.h < 0 ? r.y + r.h : r.y;
	const w = Math.abs(r.w);
	const h = Math.abs(r.h);
	return { x, y, w, h };
}

/**
 * Snap a rectangle to integer pixel coordinates. Stored masks are
 * always integers — the schema rejects non-integers anyway, and a
 * sub-pixel mask would be invisible on the rendered SVG. Called at
 * commit time, not during in-progress drag (sub-pixel motion during
 * drag is what makes drawing feel smooth).
 */
export function snapRect(r: Rect): Rect {
	const x = Math.round(r.x);
	const y = Math.round(r.y);
	const w = Math.round(r.w);
	const h = Math.round(r.h);
	return { x, y, w, h };
}

/** True iff `(px, py)` lies inside `r`, treating edges as inside. */
export function pointInRect(r: Rect, px: number, py: number): boolean {
	return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/**
 * Return the index of the topmost rectangle containing `(px, py)`, or
 * `null` if no rectangle is hit. Topmost = last-drawn = highest index.
 * Used for click-to-select where overlapping rectangles need a
 * deterministic z-order pick.
 */
export function hitTest(
	rects: Rect[],
	px: number,
	py: number,
): number | null {
	for (let i = rects.length - 1; i >= 0; i--) {
		if (pointInRect(rects[i]!, px, py)) return i;
	}
	return null;
}

/** Area of a rectangle (negative w/h tolerated via abs). */
export function area(r: Rect): number {
	return Math.abs(r.w) * Math.abs(r.h);
}

/**
 * Resize `start` by dragging `handle` to a new pointer position
 * `(px, py)` in image space. The opposite corner/edge stays anchored.
 *
 * The result may have negative w/h if the drag crossed the anchor —
 * the caller should run `normalizeRect` to flip the sign. (Doing it
 * here would prevent the editor from showing the live preview as the
 * pointer moves across the anchor; the flip happens at commit time.)
 *
 * Edge handles (n, s, e, w) move only one axis: the cross-axis stays
 * pinned at the start value. The handle's name encodes which edges
 * move — `n` moves the top edge, `e` moves the right edge, etc.
 */
export function resizeRect(
	start: Rect,
	handle: Handle,
	px: number,
	py: number,
): Rect {
	// Anchors: the corner opposite to the handle stays fixed.
	const left = start.x;
	const right = start.x + start.w;
	const top = start.y;
	const bottom = start.y + start.h;

	let nx = left;
	let ny = top;
	let nw = start.w;
	let nh = start.h;

	switch (handle) {
		case "nw":
			nx = px;
			ny = py;
			nw = right - px;
			nh = bottom - py;
			break;
		case "n":
			ny = py;
			nh = bottom - py;
			break;
		case "ne":
			ny = py;
			nw = px - left;
			nh = bottom - py;
			break;
		case "e":
			nw = px - left;
			break;
		case "se":
			nw = px - left;
			nh = py - top;
			break;
		case "s":
			nh = py - top;
			break;
		case "sw":
			nx = px;
			nw = right - px;
			nh = py - top;
			break;
		case "w":
			nx = px;
			nw = right - px;
			break;
	}
	return { x: nx, y: ny, w: nw, h: nh };
}

/**
 * Translate `start` by `(dx, dy)`. Used for body drags (move the whole
 * rectangle). Returns a new rect — never mutates.
 */
export function moveRect(start: Rect, dx: number, dy: number): Rect {
	return { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h };
}

/**
 * Move the item at `fromIndex` to `toIndex`, shifting the items
 * between them by one slot to fill the gap. Returns a new array;
 * never mutates. Used by the editor's "press 1–9 to set reveal order"
 * shortcut in `reveal-in-order` mode — each press splices the
 * selected mask to a new position, and the rest of the array slides
 * to accommodate.
 *
 * Out-of-range / same-position calls return a shallow clone — safe
 * to use in a setState chain without conditional logic at the call
 * site.
 */
export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
	if (
		fromIndex < 0 ||
		fromIndex >= items.length ||
		toIndex < 0 ||
		toIndex >= items.length ||
		fromIndex === toIndex
	) {
		return items.slice();
	}
	const out = items.slice();
	const [moved] = out.splice(fromIndex, 1);
	out.splice(toIndex, 0, moved!);
	return out;
}

/**
 * Clamp a rectangle so it fits inside `[0, w] × [0, h]` (typically the
 * image bounds). Preserves width/height when possible; nudges the
 * origin inward when an edge would leave the canvas. A rect that's
 * wider than the canvas is shrunk to the canvas width — the editor
 * never strands a partially-off-canvas mask.
 */
export function clampRect(r: Rect, w: number, h: number): Rect {
	const out: Rect = { ...r };
	if (out.w > w) out.w = w;
	if (out.h > h) out.h = h;
	if (out.x < 0) out.x = 0;
	if (out.y < 0) out.y = 0;
	if (out.x + out.w > w) out.x = w - out.w;
	if (out.y + out.h > h) out.y = h - out.h;
	return out;
}
