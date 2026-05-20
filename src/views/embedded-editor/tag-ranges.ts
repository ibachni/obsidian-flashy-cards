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

// `(?<=^|\s)` keeps us off tags embedded inside words ("a#b" stays
// untagged). The body allows `-`, `_`, and `/` so nested and
// kebab/snake tags work. The lookahead enforces at least one letter so
// `#123` (all digits) is rejected.
const TAG_REGEX = /(?<=^|\s)#(?=[\w/-]*[A-Za-z_][\w/-]*)([\w/-]+)/g;

export function tagRangesIn(doc: string): TagRange[] {
	const ranges: TagRange[] = [];
	TAG_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TAG_REGEX.exec(doc)) !== null) {
		ranges.push({
			from: match.index,
			to: match.index + match[0].length,
			name: match[1] ?? "",
		});
	}
	return ranges;
}
