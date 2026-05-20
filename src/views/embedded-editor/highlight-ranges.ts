/**
 * Pure regex scanner for Obsidian-style `==highlight==` runs.
 *
 * lezer-markdown doesn't know about Obsidian's `==…==` syntax, so we
 * mirror the pattern we use for math and wiki-links: scan the doc text
 * with a regex and emit ranges the live-preview plugin can turn into
 * HIDE + MARK decorations.
 *
 * Conservative pattern: require non-whitespace inside the markers and
 * disallow line breaks so a stray `==` at end-of-line followed by
 * another at start-of-next-line doesn't accidentally match across
 * lines.
 */

export interface HighlightRange {
	from: number;
	to: number;
	/** Inner text without the surrounding `==`. */
	text: string;
}

const HIGHLIGHT_REGEX = /==([^=\n][^=\n]*?)==/g;

export function highlightRangesIn(doc: string): HighlightRange[] {
	const ranges: HighlightRange[] = [];
	HIGHLIGHT_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = HIGHLIGHT_REGEX.exec(doc)) !== null) {
		ranges.push({
			from: match.index,
			to: match.index + match[0].length,
			text: match[1] ?? "",
		});
	}
	return ranges;
}
