import { describe, expect, it } from "vitest";
import { mathRangesIn } from "./math-ranges";

describe("mathRangesIn", () => {
	it("returns empty for plain text with no math", () => {
		expect(mathRangesIn("hello world")).toEqual([]);
		expect(mathRangesIn("")).toEqual([]);
	});

	it("detects a single inline math span", () => {
		expect(mathRangesIn("foo $a+b$ bar")).toEqual([
			{ from: 4, to: 9, tex: "a+b", display: false },
		]);
	});

	it("detects a single block math span", () => {
		expect(mathRangesIn("foo $$a+b$$ bar")).toEqual([
			{ from: 4, to: 11, tex: "a+b", display: true },
		]);
	});

	it("prefers block over inline when both could match the same start", () => {
		expect(mathRangesIn("$$x$$")).toEqual([
			{ from: 0, to: 5, tex: "x", display: true },
		]);
	});

	it("detects multiple separate inline spans", () => {
		const ranges = mathRangesIn("$a$ and $b$");
		expect(ranges).toEqual([
			{ from: 0, to: 3, tex: "a", display: false },
			{ from: 8, to: 11, tex: "b", display: false },
		]);
	});

	it("detects mixed inline and block in the same document", () => {
		const ranges = mathRangesIn("$a$ then $$b$$");
		expect(ranges).toEqual([
			{ from: 0, to: 3, tex: "a", display: false },
			{ from: 9, to: 14, tex: "b", display: true },
		]);
	});

	it("matches block math across multiple lines", () => {
		const doc = "$$\n\\int_0^1 x\\,dx\n$$";
		expect(mathRangesIn(doc)).toEqual([
			{ from: 0, to: doc.length, tex: "\n\\int_0^1 x\\,dx\n", display: true },
		]);
	});

	it("does not match inline math across a newline", () => {
		expect(mathRangesIn("$foo\nbar$")).toEqual([]);
	});

	it("is stateless across calls (regex lastIndex reset)", () => {
		const doc = "$a$";
		expect(mathRangesIn(doc)).toEqual([
			{ from: 0, to: 3, tex: "a", display: false },
		]);
		expect(mathRangesIn(doc)).toEqual([
			{ from: 0, to: 3, tex: "a", display: false },
		]);
	});
});
