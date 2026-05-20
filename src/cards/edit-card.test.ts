import { describe, expect, it } from "vitest";
import { rewriteBody } from "./edit-card";
import { parseBodySections } from "./parser";

const FM = [
	"---",
	"type: flashcard",
	"topic: dns",
	"created: 2026-05-18",
	"modified: 2026-05-18",
	"fsrs_due: 2026-05-18",
	"fsrs_state: new",
	"tags:",
	"  - protocol",
	"related: []",
	"---",
].join("\n");

describe("rewriteBody", () => {
	it("replaces # Question and # Answer sections with new content", () => {
		const original = [
			FM,
			"",
			"# Question",
			"",
			"old q?",
			"",
			"# Answer",
			"",
			"old a.",
			"",
		].join("\n");
		const out = rewriteBody(original, {
			question: "new q?",
			answer: "new a.",
		});
		expect(out).toContain("\n# Question\n\nnew q?\n");
		expect(out).toContain("\n# Answer\n\nnew a.\n");
		expect(out).not.toContain("old q?");
		expect(out).not.toContain("old a.");
	});

	it("leaves the frontmatter block byte-identical (key order, list style, trailing newline)", () => {
		const original = [
			FM,
			"",
			"# Question",
			"old q",
			"",
			"# Answer",
			"old a",
			"",
		].join("\n");
		const out = rewriteBody(original, { question: "q", answer: "a" });
		// The frontmatter slice (---\n…\n---\n) is copied byte-for-byte.
		expect(out.startsWith(FM + "\n")).toBe(true);
	});

	it("preserves comments and unknown keys in the frontmatter", () => {
		const fmWithComments = [
			"---",
			"# top-of-frontmatter comment",
			"type: flashcard",
			"topic: dns",
			"custom_field: hello world",
			"created: 2026-05-18",
			"modified: 2026-05-18",
			"fsrs_due: 2026-05-18",
			"fsrs_state: new",
			"tags: []",
			"related: []",
			"---",
		].join("\n");
		const original =
			fmWithComments + "\n\n# Question\n\nq?\n\n# Answer\n\na.\n";
		const out = rewriteBody(original, { question: "Q2", answer: "A2" });
		expect(out).toContain("# top-of-frontmatter comment");
		expect(out).toContain("custom_field: hello world");
	});

	it("round-trips through parseBodySections to yield the new Q/A", () => {
		const original = FM + "\n\n# Question\n\nold q\n\n# Answer\n\nold a\n";
		const out = rewriteBody(original, {
			question: "new question text",
			answer: "new answer text",
		});
		// Strip the frontmatter exactly like parser.stripFrontmatter does.
		const body = out.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
		const sections = parseBodySections(body);
		expect(sections["Question"]).toBe("new question text");
		expect(sections["Answer"]).toBe("new answer text");
	});

	it("handles CRLF line endings — frontmatter stays byte-identical, body framing uses CRLF", () => {
		const crlfFm = FM.replace(/\n/g, "\r\n");
		const original =
			crlfFm + "\r\n\r\n# Question\r\n\r\nold q\r\n\r\n# Answer\r\n\r\nold a\r\n";
		const out = rewriteBody(original, { question: "qx", answer: "ax" });
		expect(out.startsWith(crlfFm + "\r\n")).toBe(true);
		expect(out).toContain("\r\n# Question\r\n\r\nqx\r\n");
		expect(out).toContain("\r\n# Answer\r\n\r\nax\r\n");
	});

	it("appends new sections when the body is empty (frontmatter only)", () => {
		const original = FM + "\n";
		const out = rewriteBody(original, { question: "q?", answer: "a." });
		expect(out.startsWith(FM + "\n")).toBe(true);
		expect(out).toContain("\n# Question\n\nq?\n");
		expect(out).toContain("\n# Answer\n\na.\n");
	});

	it("embeds question/answer content verbatim, including `# ` inside a fenced code block", () => {
		// Inherits parseBodySections's code-fence limitation: the rewriter
		// emits the user's content as-is. Parsing the result back would
		// mis-split, but the rewriter itself doesn't crash or normalize.
		const original = FM + "\n\n# Question\n\nold\n\n# Answer\n\nold\n";
		const questionWithFence = "Look at this:\n```\n# header inside code\n```";
		const out = rewriteBody(original, {
			question: questionWithFence,
			answer: "answer text",
		});
		expect(out).toContain(questionWithFence);
		expect(out).toContain("answer text");
	});

	it("is a pure rewrite — calling it twice with the same args is idempotent", () => {
		const original = FM + "\n\n# Question\n\nx\n\n# Answer\n\ny\n";
		const once = rewriteBody(original, { question: "Q", answer: "A" });
		const twice = rewriteBody(once, { question: "Q", answer: "A" });
		expect(twice).toBe(once);
	});
});
