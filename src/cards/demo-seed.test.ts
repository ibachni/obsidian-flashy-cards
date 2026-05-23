import { describe, expect, it } from "vitest";
// `yaml` is transitively present in node_modules (Obsidian's own
// runtime dep). We use it here only at test time to mirror Obsidian's
// runtime YAML parser, since the `obsidian` package exports type-only
// stubs from npm. Adding it as a direct dep just for tests would bloat
// the bundle; the eslint rule is too strict for transitive test deps.
// eslint-disable-next-line import/no-extraneous-dependencies
import { parse as parseYaml } from "yaml";
import { CardFrontmatterOnDisk } from "../schema/card";
import { buildClozeExampleContent } from "./demo-seed";
import { expandCard } from "./parser";

/**
 * Regression guard for the cloze demo card. The seeder hand-writes
 * YAML that bypasses `serializeCard`, so a future schema tightening
 * (e.g. a new required field on `ClozeFsrsSlot`, a stricter refine)
 * could silently break the demo command — the user would run the
 * command, the file would appear in their vault, and Browse would
 * show it as invalid with a cryptic error.
 *
 * These tests pin the end-to-end contract: the demo content must
 * round-trip through the same parser path a real card takes.
 */
describe("buildClozeExampleContent", () => {
	const content = buildClozeExampleContent("2026-05-22");

	function splitFrontmatter(s: string): { fm: string; body: string } {
		const m = s.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!m) throw new Error("no frontmatter delimiters");
		return { fm: m[1]!, body: m[2]! };
	}

	it("emits parseable YAML that satisfies CardFrontmatterOnDisk", () => {
		const { fm } = splitFrontmatter(content);
		const parsed = parseYaml(fm) as unknown;
		const result = CardFrontmatterOnDisk.safeParse(parsed);
		if (!result.success) {
			// Surface the schema error directly so a regression shows
			// the offending field rather than a bare "false" assertion.
			throw new Error(
				`schema rejected demo card: ${result.error.issues
					.map((i) => `${i.path.join(".")}: ${i.message}`)
					.join("; ")}`,
			);
		}
		expect(result.success).toBe(true);
	});

	it("expands into exactly three cloze siblings with sequential indices", () => {
		const { fm, body } = splitFrontmatter(content);
		const data = CardFrontmatterOnDisk.parse(parseYaml(fm));
		// Body splits on H1; reuse the parser's heading conventions.
		const qMatch = body.match(/# Question\n+([\s\S]*?)\n+# Answer/);
		const aMatch = body.match(/# Answer\n+([\s\S]*?)$/);
		expect(qMatch).not.toBeNull();
		expect(aMatch).not.toBeNull();
		const question = qMatch![1]!.trim();
		const answer = aMatch![1]!.trim();

		const result = expandCard("Cards/cloze-example.md", data, question, answer);
		expect(result.kind).toBe("parsed");
		if (result.kind !== "parsed") return;
		expect(result.cards.map((c) => c.clozeIndex)).toEqual([1, 2, 3]);
		// Every sibling starts in `new` state — the demo is meant to
		// surface in the picker immediately.
		expect(result.cards.every((c) => c.fm.fsrs_state === "new")).toBe(true);
		// Mask spot-check: sibling 1 hides `hablo` and reveals the
		// other conjugations.
		expect(result.cards[0]!.question).toContain("yo […]");
		expect(result.cards[0]!.question).toContain("tú hablas");
	});
});
