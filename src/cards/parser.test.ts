import { describe, expect, it } from "vitest";
import { parseBodySections } from "./parser";

describe("parseBodySections", () => {
	it("splits a body into Question / Answer sections", () => {
		const body = [
			"# Question",
			"What is the capital of France?",
			"",
			"# Answer",
			"Paris.",
		].join("\n");
		const sections = parseBodySections(body);
		expect(sections["Question"]).toBe("What is the capital of France?");
		expect(sections["Answer"]).toBe("Paris.");
	});

	it("trims leading/trailing whitespace inside each section", () => {
		const body = [
			"# Question",
			"   What is X?   ",
			"",
			"",
			"# Answer",
			"  X is Y.  ",
			"",
		].join("\n");
		const sections = parseBodySections(body);
		expect(sections["Question"]).toBe("What is X?");
		expect(sections["Answer"]).toBe("X is Y.");
	});

	it("ignores preamble before the first H1", () => {
		const body = [
			"some preamble text",
			"that isn't a section",
			"",
			"# Question",
			"q?",
			"# Answer",
			"a.",
		].join("\n");
		const sections = parseBodySections(body);
		expect(Object.keys(sections)).toEqual(["Question", "Answer"]);
	});

	it("returns {} for a body with no H1s", () => {
		const body = "just some text, no headings";
		expect(parseBodySections(body)).toEqual({});
	});

	it("does not match H2+ headings", () => {
		// Only `# ` (single `#` + space) splits. `##` is not a section.
		const body = [
			"# Question",
			"q with ## subsection inside",
			"# Answer",
			"a.",
		].join("\n");
		const sections = parseBodySections(body);
		expect(sections["Question"]).toContain("## subsection");
	});
});
