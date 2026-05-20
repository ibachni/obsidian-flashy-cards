/**
 * Frontmatter prefix matcher. Same shape as `stripFrontmatter` in
 * [parser.ts](./parser.ts) — matches the leading `---\n…\n---\n?` block,
 * with optional CRLF on every line break.
 */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Replace the body (`# Question` + `# Answer` sections) of a card file
 * while leaving the frontmatter block byte-identical.
 *
 * Intentionally narrow: never touches the frontmatter, even though the
 * caller often has a parsed object in hand. Frontmatter mutations must
 * go through `app.fileManager.processFrontMatter`, the same primitive
 * `gradeAndPersist` uses — that's what makes concurrent edit + grade
 * writes safe and keeps FSRS state owned by exactly one code path.
 *
 * EOL style is detected from the matched frontmatter (CRLF vs LF) and
 * used for the body framing (the blank lines between sections). The
 * user-provided `question` / `answer` strings are embedded verbatim;
 * mixed line endings inside them are not normalized.
 *
 * Edge: if no frontmatter is found, the new body is appended to the
 * existing content. This shouldn't happen for valid cards but is
 * defensible.
 *
 * Edge: inherits `parseBodySections`'s code-fence limitation — a `# `
 * inside a fenced code block in `question` or `answer` will be emitted
 * as-is and will confuse the parser on read-back. Same caveat as the
 * create path.
 */
export function rewriteBody(
	content: string,
	body: { question: string; answer: string },
): string {
	const match = content.match(FRONTMATTER_RE);
	const sample = match?.[0] ?? content;
	const nl = /\r\n/.test(sample) ? "\r\n" : "\n";

	const newBody =
		nl +
		"# Question" +
		nl +
		nl +
		body.question +
		nl +
		nl +
		"# Answer" +
		nl +
		nl +
		body.answer +
		nl;

	if (!match) {
		const sep = content.length === 0 || content.endsWith(nl) ? "" : nl;
		return content + sep + newBody;
	}

	return match[0] + newBody;
}
