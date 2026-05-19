/**
 * Pure regex scanner for Obsidian `[[wiki-link]]` runs.
 *
 * Extracted so unit tests can exercise the matcher without loading
 * `obsidian` (whose npm package ships with `main: ""` and won't
 * resolve in vitest).
 *
 * Forms:
 *  - `[[target]]` → display = target
 *  - `[[target|display]]` → display = explicit display text
 *
 * The display range is what we'll mark with `cm-link`; everything
 * outside it (the leading `[[`, the optional `target|`, the trailing
 * `]]`) gets `Decoration.replace`d when the cursor isn't on the line.
 */

export interface WikiLinkRange {
	from: number;
	to: number;
	/** Start of the display text (inclusive). */
	displayFrom: number;
	/** End of the display text (exclusive). */
	displayTo: number;
}

// Disallow `]` and `\n` inside the target/display portions so we can't
// greedily eat across closing brackets or wrap lines.
const WIKI_REGEX = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

export function wikiLinkRangesIn(doc: string): WikiLinkRange[] {
	const ranges: WikiLinkRange[] = [];
	WIKI_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = WIKI_REGEX.exec(doc)) !== null) {
		const fullStart = match.index;
		const fullEnd = match.index + match[0].length;
		const target = match[1] ?? "";
		const display = match[2];
		const targetStart = fullStart + 2;
		const targetEnd = targetStart + target.length;
		const displayFrom = display !== undefined ? targetEnd + 1 : targetStart;
		const displayTo =
			display !== undefined ? displayFrom + display.length : targetEnd;
		ranges.push({
			from: fullStart,
			to: fullEnd,
			displayFrom,
			displayTo,
		});
	}
	return ranges;
}
