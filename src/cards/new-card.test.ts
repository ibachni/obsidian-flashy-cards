import { describe, expect, it } from "vitest";
import { CardFrontmatter } from "../schema/card";
import {
	findAvailablePath,
	newCardFrontmatter,
	serializeCard,
	slugify,
} from "./new-card";

describe("slugify", () => {
	it("normalizes ASCII to lowercase kebab-case", () => {
		expect(slugify("Hello World")).toBe("hello-world");
		expect(slugify("What is the capital of France?")).toBe(
			"what-is-the-capital-of-france",
		);
	});

	it("collapses punctuation runs to single dashes", () => {
		expect(slugify("Hello!! World??")).toBe("hello-world");
		expect(slugify("foo___bar...baz")).toBe("foo-bar-baz");
		expect(slugify("  spaces   everywhere  ")).toBe("spaces-everywhere");
	});

	it("falls back to `card-<YYYYMMDD-HHmmss>` when the input normalizes to nothing", () => {
		const now = new Date(2026, 4, 18, 14, 23, 45);
		expect(slugify("???", now)).toBe("card-20260518-142345");
		expect(slugify("你好", now)).toBe("card-20260518-142345");
		expect(slugify("   ", now)).toBe("card-20260518-142345");
		expect(slugify("", now)).toBe("card-20260518-142345");
	});

	it("keeps strings ≤60 chars verbatim", () => {
		const s = "what-is-an-authoritative-dns-server";
		expect(s.length).toBeLessThanOrEqual(60);
		expect(slugify("What is an authoritative DNS server?")).toBe(s);
	});

	it("trims at the last word boundary when over 60 chars and a dash sits at pos ≥20", () => {
		// Normalized form is 71 chars. The 60-char cut ends exactly at
		// "...runs-through"; the last dash (pos 52, between "runs" and
		// "through") is ≥20, so the slug trims back to it.
		const result = slugify(
			"the quick brown fox jumps over the lazy dog and runs through the meadow",
		);
		expect(result).toBe("the-quick-brown-fox-jumps-over-the-lazy-dog-and-runs");
	});

	it("hard-cuts at 60 when no dash exists at pos ≥20 within the cut", () => {
		const input = "a".repeat(70);
		const result = slugify(input);
		expect(result).toHaveLength(60);
		expect(result).toBe("a".repeat(60));
	});

	it("hard-cuts at 60 when the only dashes fall before pos 20", () => {
		// "ab-cd-" then a long alphanumeric run with no dashes after pos 20.
		const input = "ab-cd-" + "x".repeat(70);
		const result = slugify(input);
		expect(result).toHaveLength(60);
		// First 60 chars include "ab-cd-" then 54 x's.
		expect(result).toBe("ab-cd-" + "x".repeat(54));
	});
});

describe("newCardFrontmatter", () => {
	const today = new Date(2026, 4, 18); // 2026-05-18 local

	it("defaults all FSRS counters to a fresh-card state", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		expect(fm.type).toBe("flashcard");
		expect(fm.fsrs_state).toBe("new");
		expect(fm.fsrs_stability).toBe(0);
		expect(fm.fsrs_difficulty).toBe(0);
		expect(fm.fsrs_elapsed_days).toBe(0);
		expect(fm.fsrs_scheduled_days).toBe(0);
		expect(fm.fsrs_learning_steps).toBe(0);
		expect(fm.fsrs_reps).toBe(0);
		expect(fm.fsrs_lapses).toBe(0);
		expect(fm.fsrs_last_review).toBeNull();
		expect(fm.related).toEqual([]);
	});

	it("stamps created / modified / fsrs_due with today's local date", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		expect(fm.created).toBe("2026-05-18");
		expect(fm.modified).toBe("2026-05-18");
		expect(fm.fsrs_due).toBe("2026-05-18");
	});

	it("omits section when not provided", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		expect(fm.section).toBeUndefined();
	});

	it("omits section when provided blank", () => {
		const fm = newCardFrontmatter({ topic: "dns", section: "", today });
		expect(fm.section).toBeUndefined();
	});

	it("includes section when non-empty", () => {
		const fm = newCardFrontmatter({
			topic: "dns",
			section: "foundations",
			today,
		});
		expect(fm.section).toBe("foundations");
	});

	it("defaults tags to an empty array; passes them through when provided", () => {
		expect(newCardFrontmatter({ topic: "dns", today }).tags).toEqual([]);
		expect(
			newCardFrontmatter({
				topic: "dns",
				tags: ["protocol", "networking"],
				today,
			}).tags,
		).toEqual(["protocol", "networking"]);
	});

	it("produces a frontmatter that round-trips through CardFrontmatter.safeParse", () => {
		const fm = newCardFrontmatter({
			topic: "dns",
			section: "foundations",
			tags: ["protocol"],
			today,
		});
		const result = CardFrontmatter.safeParse(fm);
		expect(result.success).toBe(true);
	});
});

describe("serializeCard", () => {
	const today = new Date(2026, 4, 18);

	it("emits date fields bare (no quotes), matching Obsidian's date-picker convention", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		const out = serializeCard({ fm, question: "Q?", answer: "A." });
		expect(out).toContain("\ncreated: 2026-05-18\n");
		expect(out).toContain("\nmodified: 2026-05-18\n");
		expect(out).toContain("\nfsrs_due: 2026-05-18\n");
		// Defensive: no quoted dates anywhere.
		expect(out).not.toMatch(/"\d{4}-\d{2}-\d{2}"/);
	});

	it("emits fsrs_last_review as bare null (colon with empty value) for new cards", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		const out = serializeCard({ fm, question: "Q?", answer: "A." });
		expect(out).toMatch(/\nfsrs_last_review:\n/);
	});

	it("omits section line when blank", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		const out = serializeCard({ fm, question: "Q?", answer: "A." });
		expect(out).not.toContain("section:");
	});

	it("includes section line when present", () => {
		const fm = newCardFrontmatter({
			topic: "dns",
			section: "foundations",
			today,
		});
		const out = serializeCard({ fm, question: "Q?", answer: "A." });
		expect(out).toContain("\nsection: foundations\n");
	});

	it("renders tags as a YAML list and an empty `related` as inline `[]`", () => {
		const fm = newCardFrontmatter({
			topic: "dns",
			tags: ["protocol", "networking"],
			today,
		});
		const out = serializeCard({ fm, question: "Q?", answer: "A." });
		expect(out).toContain("\ntags:\n  - protocol\n  - networking\n");
		expect(out).toContain("\nrelated: []\n");
	});

	it("renders empty tags as inline `[]`", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		const out = serializeCard({ fm, question: "Q?", answer: "A." });
		expect(out).toContain("\ntags: []\n");
	});

	it("emits well-formed Question and Answer body sections", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		const out = serializeCard({
			fm,
			question: "What is X?",
			answer: "X is Y.",
		});
		expect(out).toContain("\n# Question\n\nWhat is X?\n");
		expect(out).toContain("\n# Answer\n\nX is Y.\n");
	});

	it("opens with a frontmatter fence and closes with one before the body", () => {
		const fm = newCardFrontmatter({ topic: "dns", today });
		const out = serializeCard({ fm, question: "Q?", answer: "A." });
		expect(out.startsWith("---\n")).toBe(true);
		// Exactly one closing fence before the body.
		const closingFenceCount = (out.match(/\n---\n/g) ?? []).length;
		expect(closingFenceCount).toBe(1);
	});
});

describe("findAvailablePath", () => {
	it("returns the base path when nothing is taken", () => {
		expect(findAvailablePath("Cards/dns/foo.md", () => false)).toBe(
			"Cards/dns/foo.md",
		);
	});

	it("returns `-2` on first collision", () => {
		const taken = new Set(["Cards/dns/foo.md"]);
		expect(
			findAvailablePath("Cards/dns/foo.md", (p) => taken.has(p)),
		).toBe("Cards/dns/foo-2.md");
	});

	it("increments through occupied suffixes", () => {
		const taken = new Set([
			"Cards/dns/foo.md",
			"Cards/dns/foo-2.md",
			"Cards/dns/foo-3.md",
			"Cards/dns/foo-4.md",
		]);
		expect(
			findAvailablePath("Cards/dns/foo.md", (p) => taken.has(p)),
		).toBe("Cards/dns/foo-5.md");
	});

	it("falls back to a timestamped name after -99 is exhausted", () => {
		const taken = new Set<string>(["Cards/dns/foo.md"]);
		for (let i = 2; i <= 99; i++) taken.add(`Cards/dns/foo-${i}.md`);
		const now = new Date(2026, 4, 18, 14, 23, 45);
		const result = findAvailablePath(
			"Cards/dns/foo.md",
			(p) => taken.has(p),
			now,
		);
		expect(result).toBe("Cards/dns/foo-20260518-142345.md");
	});
});
