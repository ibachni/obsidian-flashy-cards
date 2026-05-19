/**
 * Pure regex scanner for math runs in a markdown document — extracted
 * from `math-widget.ts` so unit tests can exercise it without
 * importing Obsidian (the `obsidian` package has `main: ""` and won't
 * resolve in vitest).
 *
 * Display (`$$…$$`) is matched before inline (`$…$`) at each position
 * via alternation order. Known false positive: `$100 and $50` looks
 * like math; acceptable trade given the spec's "regex-based" mandate
 * and how rare bare-dollar-paired text is in flashcards.
 */

export interface MathRange {
	from: number;
	to: number;
	tex: string;
	display: boolean;
}

const MATH_REGEX = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

export function mathRangesIn(doc: string): MathRange[] {
	const ranges: MathRange[] = [];
	// Reset lastIndex so repeat calls don't carry state.
	MATH_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MATH_REGEX.exec(doc)) !== null) {
		if (match[1] !== undefined) {
			ranges.push({
				from: match.index,
				to: match.index + match[0].length,
				tex: match[1],
				display: true,
			});
		} else if (match[2] !== undefined) {
			ranges.push({
				from: match.index,
				to: match.index + match[0].length,
				tex: match[2],
				display: false,
			});
		}
	}
	return ranges;
}
