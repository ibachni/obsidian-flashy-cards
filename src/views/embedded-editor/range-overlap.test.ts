import { describe, expect, it } from "vitest";
import { rangesOverlap } from "./range-overlap";

describe("rangesOverlap", () => {
	it("returns false when ranges are disjoint", () => {
		expect(rangesOverlap(1, 3, 5, 7)).toBe(false);
		expect(rangesOverlap(5, 7, 1, 3)).toBe(false);
	});

	it("returns true when ranges fully overlap", () => {
		expect(rangesOverlap(1, 5, 3, 4)).toBe(true);
		expect(rangesOverlap(3, 4, 1, 5)).toBe(true);
	});

	it("returns true when they touch at a single boundary position", () => {
		expect(rangesOverlap(1, 3, 3, 5)).toBe(true);
		expect(rangesOverlap(3, 5, 1, 3)).toBe(true);
	});

	it("returns true for identical zero-width ranges", () => {
		expect(rangesOverlap(4, 4, 4, 4)).toBe(true);
	});

	it("returns false when adjacent but non-overlapping", () => {
		expect(rangesOverlap(1, 2, 3, 4)).toBe(false);
		expect(rangesOverlap(3, 4, 1, 2)).toBe(false);
	});
});
