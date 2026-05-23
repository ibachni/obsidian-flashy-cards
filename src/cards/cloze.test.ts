import { describe, expect, it } from "vitest";
import {
	collectClozeIndices,
	maskField,
	parseClozes,
	revealField,
} from "./cloze";

describe("parseClozes", () => {
	it("returns [] when no cloze syntax is present", () => {
		expect(parseClozes("just some text")).toEqual([]);
	});

	it("captures a single cloze span with index and text", () => {
		const spans = parseClozes("{{c1::Paris}} is the capital");
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ index: 1, text: "Paris" });
	});

	it("captures multiple spans with different indices", () => {
		const spans = parseClozes("{{c1::Paris}} is in {{c2::France}}");
		expect(spans.map((s) => s.index)).toEqual([1, 2]);
		expect(spans.map((s) => s.text)).toEqual(["Paris", "France"]);
	});

	it("captures multiple spans sharing the same index", () => {
		// Same-index spans hide together for the matching sibling.
		const spans = parseClozes("{{c1::Paris}} is in {{c1::France}}");
		expect(spans.map((s) => s.index)).toEqual([1, 1]);
	});

	it("skips empty-body clozes (treated as no cloze)", () => {
		const spans = parseClozes("before {{c1::}} after");
		expect(spans).toEqual([]);
	});

	it("captures multi-digit indices", () => {
		const spans = parseClozes("{{c12::twelfth}} and {{c100::hundredth}}");
		expect(spans.map((s) => s.index)).toEqual([12, 100]);
	});

	it("captures spans containing math expressions", () => {
		// `{{c1::$x^2$}}` is a common pattern — the inner `$x^2$` must
		// reach the output untouched.
		const spans = parseClozes("solve {{c1::$x^2 = 4$}}");
		expect(spans[0]!.text).toBe("$x^2 = 4$");
	});

	it("does not match nested clozes (documents the limitation)", () => {
		// The regex stops at the first `}}`, so an outer cloze
		// containing an inner cloze produces a single malformed span
		// whose body includes the inner cloze's opening — the trailing
		// " tail}}" is then orphaned with no `{{c…::` to match against.
		// Pin the behavior so a future regex change announces itself.
		const spans = parseClozes("{{c1::outer {{c2::inner}} tail}}");
		expect(spans).toHaveLength(1);
		expect(spans[0]!.text).toBe("outer {{c2::inner");
	});

	it("reports correct byte offsets for start/end", () => {
		const text = "x {{c1::abc}} y";
		const [s] = parseClozes(text);
		expect(text.slice(s!.start, s!.end)).toBe("{{c1::abc}}");
	});

	it("does not match cloze bodies that span a newline", () => {
		// Regex `.` excludes `\n` so a multi-line body fails to match
		// — protects against runaway captures across paragraphs.
		// Documented limitation: a future user need for multi-line
		// clozes would have to opt in (likely via a `s`-flag variant).
		expect(parseClozes("{{c1::line one\nline two}}")).toEqual([]);
	});
});

describe("collectClozeIndices", () => {
	it("returns [] when neither field has clozes", () => {
		expect(collectClozeIndices("plain question", "plain answer")).toEqual([]);
	});

	it("returns sorted unique indices from the question field", () => {
		expect(
			collectClozeIndices(
				"{{c2::two}} and {{c1::one}} and {{c2::also two}}",
				"plain",
			),
		).toEqual([1, 2]);
	});

	it("merges indices from both fields", () => {
		expect(
			collectClozeIndices("{{c1::q}} text", "answer has {{c3::three}}"),
		).toEqual([1, 3]);
	});

	it("works when only the answer has clozes", () => {
		// Useful for cards where the question is plain prose and the
		// answer is a structured definition with multiple recallable
		// pieces.
		expect(collectClozeIndices("What is X?", "{{c1::X}} is {{c2::Y}}")).toEqual(
			[1, 2],
		);
	});

	it("dedupes overlapping indices across fields", () => {
		expect(
			collectClozeIndices("Q has {{c1::a}}", "A also has {{c1::b}}"),
		).toEqual([1]);
	});
});

describe("maskField", () => {
	it("returns the input unchanged when no clozes are present", () => {
		expect(maskField("just text", 1)).toBe("just text");
	});

	it("masks the active cloze and reveals others", () => {
		// Sibling 1 viewing "Paris is in France" should hide Paris and
		// keep France visible — that's the Anki convention.
		expect(
			maskField("{{c1::Paris}} is in {{c2::France}}", 1),
		).toBe("[…] is in France");
		expect(
			maskField("{{c1::Paris}} is in {{c2::France}}", 2),
		).toBe("Paris is in […]"); // U+2026 ellipsis
	});

	it("masks all spans sharing the active index together", () => {
		expect(
			maskField("{{c1::A}} then {{c1::B}}", 1),
		).toBe("[…] then […]");
	});

	it("leaves all clozes revealed when the active index is unused", () => {
		// e.g. sibling 5 looking at a card whose clozes are 1 and 2 —
		// nothing to mask, every span shows its text.
		expect(maskField("{{c1::a}} {{c2::b}}", 99)).toBe("a b");
	});
});

describe("revealField", () => {
	it("returns the input unchanged when no clozes are present", () => {
		expect(revealField("plain answer", 1)).toBe("plain answer");
	});

	it("wraps the active cloze in <mark> and unwraps others", () => {
		expect(revealField("{{c1::Paris}} is in {{c2::France}}", 1)).toBe(
			'<mark class="ls-cloze-active">Paris</mark> is in France',
		);
	});

	it("highlights every span sharing the active index", () => {
		expect(revealField("{{c1::A}} and {{c1::B}}", 1)).toBe(
			'<mark class="ls-cloze-active">A</mark> and <mark class="ls-cloze-active">B</mark>',
		);
	});

	it("falls back to plain unwrap when the active index is unused", () => {
		// Avoids a "no highlight" outcome where the user sees the answer
		// but can't tell which span they were supposed to recall — but
		// also the more common case is the active index matches at
		// least one span, since the parser only produces siblings whose
		// indices exist in the source.
		expect(revealField("{{c1::a}} {{c2::b}}", 99)).toBe("a b");
	});
});
