import { describe, expect, it } from "vitest";
import {
	area,
	clampRect,
	hitTest,
	MIN_AREA,
	moveItem,
	moveRect,
	normalizeRect,
	pointInRect,
	resizeRect,
	snapRect,
	type Rect,
} from "./occlusion-geometry";

describe("normalizeRect", () => {
	it("flips negative width and height to canonical form", () => {
		// drag-up-left case from the doc:
		// start at (100, 100), drag to (50, 70) → {x:100, y:100, w:-50, h:-30}
		expect(normalizeRect({ x: 100, y: 100, w: -50, h: -30 })).toEqual({
			x: 50,
			y: 70,
			w: 50,
			h: 30,
		});
	});

	it("passes through positive w/h unchanged", () => {
		expect(normalizeRect({ x: 10, y: 20, w: 30, h: 40 })).toEqual({
			x: 10,
			y: 20,
			w: 30,
			h: 40,
		});
	});

	it("handles negative w only", () => {
		expect(normalizeRect({ x: 100, y: 20, w: -40, h: 50 })).toEqual({
			x: 60,
			y: 20,
			w: 40,
			h: 50,
		});
	});

	it("handles negative h only", () => {
		expect(normalizeRect({ x: 20, y: 100, w: 30, h: -40 })).toEqual({
			x: 20,
			y: 60,
			w: 30,
			h: 40,
		});
	});
});

describe("snapRect", () => {
	it("rounds all fields to integers", () => {
		expect(snapRect({ x: 10.4, y: 20.6, w: 30.5, h: 40.499 })).toEqual({
			x: 10,
			y: 21,
			w: 31,
			h: 40,
		});
	});
});

describe("pointInRect", () => {
	const r: Rect = { x: 50, y: 60, w: 50, h: 40 };

	it("hits an interior point", () => {
		expect(pointInRect(r, 75, 85)).toBe(true);
	});

	it("hits a point on the edge (inclusive)", () => {
		expect(pointInRect(r, 50, 60)).toBe(true);
		expect(pointInRect(r, 100, 100)).toBe(true);
	});

	it("misses a point outside the rect", () => {
		expect(pointInRect(r, 49, 85)).toBe(false);
		expect(pointInRect(r, 101, 85)).toBe(false);
		expect(pointInRect(r, 75, 59)).toBe(false);
		expect(pointInRect(r, 75, 101)).toBe(false);
	});
});

describe("hitTest", () => {
	it("returns the index of the topmost hit", () => {
		// Two overlapping rects; the second was drawn later and wins.
		const rects: Rect[] = [
			{ x: 0, y: 0, w: 100, h: 100 },
			{ x: 50, y: 50, w: 50, h: 50 },
		];
		expect(hitTest(rects, 75, 75)).toBe(1);
	});

	it("hits the only-containing rect when no overlap exists", () => {
		const rects: Rect[] = [
			{ x: 0, y: 0, w: 40, h: 40 },
			{ x: 100, y: 100, w: 40, h: 40 },
		];
		expect(hitTest(rects, 110, 110)).toBe(1);
		expect(hitTest(rects, 10, 10)).toBe(0);
	});

	it("returns null when no rect contains the point", () => {
		const rects: Rect[] = [{ x: 0, y: 0, w: 40, h: 40 }];
		expect(hitTest(rects, 50, 50)).toBeNull();
	});

	it("returns null on an empty list", () => {
		expect(hitTest([], 0, 0)).toBeNull();
	});

	it("hits the doc's example point inside a rect", () => {
		// From image-occlusion.md → Tests:
		// "Hit-test: click at (75, 85) hits a rect at {x: 50, y: 60, w: 50, h: 40}."
		expect(hitTest([{ x: 50, y: 60, w: 50, h: 40 }], 75, 85)).toBe(0);
	});
});

describe("resizeRect", () => {
	const r: Rect = { x: 50, y: 60, w: 50, h: 40 };

	it("nw handle: drag anchors at SE corner", () => {
		// Drag the NW handle to (30, 40). SE corner (100, 100) stays put.
		const next = resizeRect(r, "nw", 30, 40);
		expect(next).toEqual({ x: 30, y: 40, w: 70, h: 60 });
	});

	it("ne handle: drag anchors at SW corner", () => {
		// Doc spec: "Resize handle math: drag NE handle of a rect
		// anchors at SW corner." SW = (50, 100). Drag NE to (120, 30).
		const next = resizeRect(r, "ne", 120, 30);
		// Expected: top-y moves to 30, right-x moves to 120; left-x and
		// bottom-y stay → {x: 50, y: 30, w: 70, h: 70}.
		expect(next).toEqual({ x: 50, y: 30, w: 70, h: 70 });
	});

	it("se handle: drag anchors at NW corner", () => {
		const next = resizeRect(r, "se", 120, 130);
		expect(next).toEqual({ x: 50, y: 60, w: 70, h: 70 });
	});

	it("sw handle: drag anchors at NE corner", () => {
		const next = resizeRect(r, "sw", 30, 130);
		expect(next).toEqual({ x: 30, y: 60, w: 70, h: 70 });
	});

	it("n edge: only moves top edge", () => {
		const next = resizeRect(r, "n", 75, 30);
		expect(next).toEqual({ x: 50, y: 30, w: 50, h: 70 });
	});

	it("s edge: only moves bottom edge", () => {
		const next = resizeRect(r, "s", 75, 130);
		expect(next).toEqual({ x: 50, y: 60, w: 50, h: 70 });
	});

	it("e edge: only moves right edge", () => {
		const next = resizeRect(r, "e", 120, 85);
		expect(next).toEqual({ x: 50, y: 60, w: 70, h: 40 });
	});

	it("w edge: only moves left edge", () => {
		const next = resizeRect(r, "w", 30, 85);
		expect(next).toEqual({ x: 30, y: 60, w: 70, h: 40 });
	});

	it("produces negative w/h when the drag crosses the anchor (normalized later)", () => {
		// Dragging the SE handle past the NW anchor produces a flipped
		// rect during the live preview; normalizeRect at commit-time
		// flips it back to canonical form.
		const next = resizeRect(r, "se", 30, 40);
		expect(next.w).toBeLessThan(0);
		expect(next.h).toBeLessThan(0);
		expect(normalizeRect(next)).toEqual({ x: 30, y: 40, w: 20, h: 20 });
	});
});

describe("moveRect", () => {
	it("translates by (dx, dy) and preserves size", () => {
		expect(moveRect({ x: 10, y: 20, w: 30, h: 40 }, 5, -3)).toEqual({
			x: 15,
			y: 17,
			w: 30,
			h: 40,
		});
	});
});

describe("clampRect", () => {
	it("nudges a rect that overhangs the right/bottom edges inward", () => {
		expect(clampRect({ x: 90, y: 90, w: 30, h: 30 }, 100, 100)).toEqual({
			x: 70,
			y: 70,
			w: 30,
			h: 30,
		});
	});

	it("nudges negative origins back to 0", () => {
		expect(clampRect({ x: -5, y: -10, w: 30, h: 30 }, 100, 100)).toEqual({
			x: 0,
			y: 0,
			w: 30,
			h: 30,
		});
	});

	it("shrinks a rect larger than the canvas", () => {
		expect(clampRect({ x: 0, y: 0, w: 150, h: 30 }, 100, 100)).toEqual({
			x: 0,
			y: 0,
			w: 100,
			h: 30,
		});
	});

	it("leaves an in-bounds rect alone", () => {
		expect(clampRect({ x: 10, y: 20, w: 30, h: 40 }, 100, 100)).toEqual({
			x: 10,
			y: 20,
			w: 30,
			h: 40,
		});
	});
});

describe("moveItem", () => {
	it("moves an item forward and shifts the in-between items back", () => {
		// Mode 2 use case: selected mask at index 2 (default order 3),
		// user presses "1" to make it sibling 1 — the array slides.
		expect(moveItem(["a", "b", "c", "d"], 2, 0)).toEqual([
			"c",
			"a",
			"b",
			"d",
		]);
	});

	it("moves an item backward and shifts the in-between items forward", () => {
		expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual([
			"b",
			"c",
			"a",
			"d",
		]);
	});

	it("is a no-op when from === to", () => {
		const arr = ["a", "b", "c"];
		expect(moveItem(arr, 1, 1)).toEqual(arr);
	});

	it("never mutates the input array", () => {
		const arr = ["a", "b", "c"];
		moveItem(arr, 0, 2);
		expect(arr).toEqual(["a", "b", "c"]);
	});

	it("returns a clone (no-op) on out-of-range indices", () => {
		// Defensive — user presses "9" with only 3 masks. The editor
		// clamps before calling, but the helper handles the case anyway.
		expect(moveItem(["a", "b", "c"], 0, 5)).toEqual(["a", "b", "c"]);
		expect(moveItem(["a", "b", "c"], -1, 0)).toEqual(["a", "b", "c"]);
	});
});

describe("area", () => {
	it("multiplies w by h", () => {
		expect(area({ x: 0, y: 0, w: 10, h: 12 })).toBe(120);
	});

	it("uses absolute values for negative w/h (in-progress draw)", () => {
		expect(area({ x: 0, y: 0, w: -10, h: -12 })).toBe(120);
	});

	it("matches MIN_AREA boundary for a 10×10 box", () => {
		expect(area({ x: 0, y: 0, w: 10, h: 10 })).toBe(MIN_AREA);
	});
});
