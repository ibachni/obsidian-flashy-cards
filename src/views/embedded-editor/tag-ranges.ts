/**
 * Pure regex scanner for Obsidian-style `#tag` runs.
 *
 * Obsidian recognises a tag when `#` is preceded by start-of-input or
 * whitespace and followed by at least one non-numeric word character.
 * Pure-numeric tags (`#123`) are deliberately rejected so dates and
 * codes don't accidentally become tags.
 *
 * Extracted so unit tests can exercise the matcher without loading
 * `obsidian` (whose npm package ships with `main: ""` and won't
 * resolve in vitest).
 */

export interface TagRange {
	/** Start of the `#` character. */
	from: number;
	/** End of the tag body (exclusive). */
	to: number;
	/** Tag text without the leading `#`. */
	name: string;
}

// `(^|\s)` captures the prefix (start-of-input or a whitespace char)
// instead of using a lookbehind — lookbehinds aren't supported on
// iOS Safari < 16.4 and Obsidian Mobile builds against the platform
// WebView. The body allows `-`, `_`, and `/` so nested and kebab/
// snake tags work. The lookahead enforces at least one letter so
// `#123` (all digits) is rejected.
const TAG_REGEX = /(^|\s)#(?=[\w/-]*[A-Za-z_][\w/-]*)([\w/-]+)/g;

export function tagRangesIn(doc: string): TagRange[] {
	const ranges: TagRange[] = [];
	TAG_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TAG_REGEX.exec(doc)) !== null) {
		const prefixLen = match[1]?.length ?? 0;
		const body = match[2] ?? "";
		const from = match.index + prefixLen;
		ranges.push({
			from,
			to: from + 1 + body.length,
			name: body,
		});
	}
	return ranges;
}
