/**
 * Cloze deletion primitives. Pure functions: no I/O, no Obsidian
 * imports, easily unit-testable.
 *
 * Syntax: `{{cN::text}}` where N is a positive integer (the cloze
 * number) and `text` is the answer span. Multiple spans can share a
 * number — they all hide together for sibling N. Non-nesting (a
 * cloze cannot contain another cloze); the regex stops at the first
 * `}}` it sees inside the body.
 *
 * Not supported (intentionally, per docs/features/cloze-deletions.md):
 * - Hint syntax `{{c1::text::hint}}`
 * - Nested clozes
 * - Empty clozes `{{c1::}}` — skipped at parse, treated as no cloze
 */

const CLOZE_RE = /\{\{c(\d+)::((?:(?!\}\}).)*)\}\}/g;

export interface ClozeSpan {
	/** Cloze number (the `N` in `{{cN::…}}`). */
	index: number;
	/** Byte offset of the opening `{{` in the source string. */
	start: number;
	/** Byte offset just past the closing `}}` (exclusive). */
	end: number;
	/** The revealed text inside the braces. */
	text: string;
}

/**
 * Scan a string for cloze spans. Empty-body spans (`{{c1::}}`) are
 * dropped — there's no reasonable rendering for them and they'd
 * silently create an "unrecallable" sibling.
 */
export function parseClozes(text: string): ClozeSpan[] {
	const out: ClozeSpan[] = [];
	for (const m of text.matchAll(CLOZE_RE)) {
		const body = m[2] ?? "";
		if (body.length === 0) continue;
		out.push({
			index: Number(m[1]),
			start: m.index,
			end: m.index + m[0].length,
			text: body,
		});
	}
	return out;
}

/**
 * Sorted unique cloze indices across both fields. Empty arrays if
 * neither field has any cloze syntax — the caller treats that as a
 * "non-cloze card".
 */
export function collectClozeIndices(
	question: string,
	answer: string,
): number[] {
	const set = new Set<number>();
	for (const c of parseClozes(question)) set.add(c.index);
	for (const c of parseClozes(answer)) set.add(c.index);
	return Array.from(set).sort((a, b) => a - b);
}

/** Shared scan + replace skeleton for the two transform variants below. */
function transformClozes(
	text: string,
	activeIndex: number,
	renderActive: (text: string) => string,
): string {
	const spans = parseClozes(text);
	if (spans.length === 0) return text;
	let out = "";
	let cursor = 0;
	for (const span of spans) {
		out += text.slice(cursor, span.start);
		out += span.index === activeIndex ? renderActive(span.text) : span.text;
		cursor = span.end;
	}
	out += text.slice(cursor);
	return out;
}

/**
 * Question-side rendering for cloze sibling `activeIndex`: replace
 * spans matching the active index with `[…]`, unwrap other spans to
 * their plain text (Anki convention — context for non-active clozes
 * stays visible). Non-cloze text passes through unchanged.
 */
export function maskField(text: string, activeIndex: number): string {
	return transformClozes(text, activeIndex, () => "[…]");
}

/**
 * Answer-side rendering for cloze sibling `activeIndex`: wrap spans
 * matching the active index in `<mark class="ls-cloze-active">…</mark>`
 * so the renderer can highlight them, unwrap other spans plainly.
 *
 * The `<mark>` tag is recognized HTML so Obsidian's MarkdownRenderer
 * preserves it through sanitization — no custom renderer extension
 * needed.
 */
export function revealField(text: string, activeIndex: number): string {
	return transformClozes(
		text,
		activeIndex,
		(t) => `<mark class="ls-cloze-active">${t}</mark>`,
	);
}
