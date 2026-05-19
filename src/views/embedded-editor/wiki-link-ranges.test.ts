import { describe, expect, it } from "vitest";
import { wikiLinkRangesIn } from "./wiki-link-ranges";

describe("wikiLinkRangesIn", () => {
	it("returns empty for plain text with no wiki-links", () => {
		expect(wikiLinkRangesIn("hello world")).toEqual([]);
		expect(wikiLinkRangesIn("")).toEqual([]);
	});

	it("detects a simple [[target]]", () => {
		// "[[foo]]" — chars 0,1 = "[[", 2..5 = "foo", 5,6 = "]]"
		expect(wikiLinkRangesIn("[[foo]]")).toEqual([
			{ from: 0, to: 7, displayFrom: 2, displayTo: 5 },
		]);
	});

	it("detects [[target|display]] with display range pointing at the alias", () => {
		// "[[foo|bar]]" — display "bar" lives at chars 6..9
		expect(wikiLinkRangesIn("[[foo|bar]]")).toEqual([
			{ from: 0, to: 11, displayFrom: 6, displayTo: 9 },
		]);
	});

	it("detects multiple wiki-links in a doc", () => {
		const ranges = wikiLinkRangesIn("see [[a]] and [[b|B]]");
		expect(ranges).toEqual([
			{ from: 4, to: 9, displayFrom: 6, displayTo: 7 },
			{ from: 14, to: 21, displayFrom: 18, displayTo: 19 },
		]);
	});

	it("matches adjacent wiki-links without skipping", () => {
		const ranges = wikiLinkRangesIn("[[a]][[b]]");
		expect(ranges).toHaveLength(2);
		expect(ranges[0]).toEqual({ from: 0, to: 5, displayFrom: 2, displayTo: 3 });
		expect(ranges[1]).toEqual({ from: 5, to: 10, displayFrom: 7, displayTo: 8 });
	});

	it("does not match an unclosed wiki-link", () => {
		expect(wikiLinkRangesIn("[[unclosed")).toEqual([]);
	});

	it("does not match across newlines", () => {
		expect(wikiLinkRangesIn("[[a\nb]]")).toEqual([]);
	});

	it("stops at the first `]` inside the target (no greedy run-on)", () => {
		// "[[a]b]]" — first "]" terminates at position 3, leaving "b]]"
		// dangling. The regex requires "]]" after the target, so there's
		// no match: it would need [[a]] but the chars are [[a]b]] — the
		// "]b" interrupts before "]]" appears.
		expect(wikiLinkRangesIn("[[a]b]]")).toEqual([]);
	});

	it("is stateless across calls (regex lastIndex reset)", () => {
		const doc = "[[foo]]";
		expect(wikiLinkRangesIn(doc)).toHaveLength(1);
		expect(wikiLinkRangesIn(doc)).toHaveLength(1);
	});
});
