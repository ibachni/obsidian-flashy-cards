import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

import { highlightRangesIn } from "./highlight-ranges";
import { mathRangesIn } from "./math-ranges";
import { BlockMathWidget, InlineMathWidget } from "./math-widget";
import { rangesOverlap } from "./range-overlap";
import { tagRangesIn } from "./tag-ranges";
import { wikiLinkRangesIn } from "./wiki-link-ranges";

/**
 * Live-preview decorations for inline Markdown (Phase B.2).
 *
 * For each handled inline node we emit two kinds of decorations:
 *  - `Decoration.replace` (zero-width) over the literal markup tokens
 *    (`**`, `*`, `` ` ``, `#`) — applied only when the cursor isn't on
 *    that node's line, so the user can still edit the source by moving
 *    the cursor in.
 *  - `Decoration.mark` over the content range with a class
 *    (`cm-strong`, `cm-em`, `cm-inline-code`, `cm-header-N`) that the
 *    theme styles. The class is applied regardless of cursor position,
 *    so bold text stays bold while the cursor is in it.
 *
 * Implementation note: tree iteration emits parent-then-children, which
 * means nested formatting like `**bold *italic***` interleaves the
 * outer Strong's emissions with the inner Emphasis's. That breaks
 * `RangeSetBuilder`'s monotonic-from contract, so we collect into a
 * plain array and let `Decoration.set(arr, true)` sort.
 */

const HIDE = Decoration.replace({});
const MARK_STRONG = Decoration.mark({ class: "cm-strong" });
const MARK_EM = Decoration.mark({ class: "cm-em" });
const MARK_INLINE_CODE = Decoration.mark({ class: "cm-inline-code" });
const MARK_LIST_MARK = Decoration.mark({ class: "cm-list-mark" });
const MARK_LINK = Decoration.mark({ class: "cm-link" });
const MARK_TAG = Decoration.mark({ class: "cm-tag" });
const MARK_STRIKETHROUGH = Decoration.mark({ class: "cm-strikethrough" });
const MARK_HIGHLIGHT = Decoration.mark({ class: "cm-highlight" });

const HEADING_MARKS: Record<string, Decoration> = {
	ATXHeading1: Decoration.mark({ class: "cm-header cm-header-1" }),
	ATXHeading2: Decoration.mark({ class: "cm-header cm-header-2" }),
	ATXHeading3: Decoration.mark({ class: "cm-header cm-header-3" }),
	ATXHeading4: Decoration.mark({ class: "cm-header cm-header-4" }),
	ATXHeading5: Decoration.mark({ class: "cm-header cm-header-5" }),
	ATXHeading6: Decoration.mark({ class: "cm-header cm-header-6" }),
};

function buildDecorations(view: EditorView): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	const { state } = view;
	const sel = state.selection.main;
	// Reveal source ONLY for a point cursor sitting on the markup
	// characters themselves. Two gates:
	//   1. Unfocused editor → never reveal (CM6 preserves the last
	//      selection across blur, so without this an editor that lost
	//      focus mid-edit would freeze its markup in "source" mode).
	//   2. Range selection → never reveal. Cmd+A or any drag-select
	//      means the user is acting on content, not editing markup;
	//      keep the rendered view.
	// Together: source shows only when the user is actually parked on
	// a `#`, `` ` ``, `**`, or `$` character.
	const focused = view.hasFocus;
	const isPoint = sel.from === sel.to;
	const isOnMark = (from: number, to: number) =>
		focused && isPoint && rangesOverlap(sel.from, sel.to, from, to);

	syntaxTree(state).iterate({
		enter: (node) => {
			const name = node.type.name;

			if (name === "StrongEmphasis" || name === "Emphasis") {
				const first = node.node.firstChild;
				const last = node.node.lastChild;
				if (!first || !last || first.to > last.from) return;
				const mark = name === "StrongEmphasis" ? MARK_STRONG : MARK_EM;
				// Cursor on either marker (the `**` / `*` runs) keeps
				// both markers visible; cursor inside the bold/italic
				// text hides them. Matches Obsidian's WYSIWYG affordance.
				const onMark =
					isOnMark(first.from, first.to) || isOnMark(last.from, last.to);
				if (!onMark) decorations.push(HIDE.range(first.from, first.to));
				decorations.push(mark.range(first.to, last.from));
				if (!onMark) decorations.push(HIDE.range(last.from, last.to));
				return;
			}

			if (name === "InlineCode") {
				const first = node.node.firstChild;
				const last = node.node.lastChild;
				if (!first || !last || first.to > last.from) return;
				const onMark =
					isOnMark(first.from, first.to) || isOnMark(last.from, last.to);
				if (!onMark) decorations.push(HIDE.range(first.from, first.to));
				decorations.push(MARK_INLINE_CODE.range(first.to, last.from));
				if (!onMark) decorations.push(HIDE.range(last.from, last.to));
				return;
			}

			if (name === "Strikethrough") {
				const first = node.node.firstChild;
				const last = node.node.lastChild;
				if (!first || !last || first.to > last.from) return;
				const onMark =
					isOnMark(first.from, first.to) || isOnMark(last.from, last.to);
				if (!onMark) decorations.push(HIDE.range(first.from, first.to));
				decorations.push(MARK_STRIKETHROUGH.range(first.to, last.from));
				if (!onMark) decorations.push(HIDE.range(last.from, last.to));
				return;
			}

			if (name.startsWith("ATXHeading")) {
				const mark = HEADING_MARKS[name];
				if (!mark) return;
				const headerMark = node.node.firstChild;
				if (headerMark && headerMark.type.name === "HeaderMark") {
					// Lezer's HeaderMark spans just the `#` run. The
					// space(s) between it and the heading text are
					// markdown syntax too — without including them in
					// the HIDE range, the rendered h1 has a visible
					// leading gap. Extend the hide-end past any
					// trailing whitespace.
					const docStr = state.doc.toString();
					let markEnd = headerMark.to;
					while (markEnd < node.to && docStr[markEnd] === " ") {
						markEnd++;
					}
					// Cursor on the `#` or the trailing space keeps the
					// source visible; cursor on the heading text hides
					// the marker.
					const onMark = isOnMark(headerMark.from, markEnd);
					if (!onMark) {
						decorations.push(HIDE.range(headerMark.from, markEnd));
					}
					// Guard against a heading that is *only* the marker
					// (e.g. a lone `#` line) — `mark.range(x, x)` throws
					// "Mark decorations may not be empty".
					if (markEnd < node.to) {
						decorations.push(mark.range(markEnd, node.to));
					}
				} else if (node.from < node.to) {
					decorations.push(mark.range(node.from, node.to));
				}
				return;
			}

			if (name === "ListMark") {
				decorations.push(MARK_LIST_MARK.range(node.from, node.to));
				return;
			}

			if (name === "Link") {
				// Lezer's Link node spans `[text](url)`. We locate `](`
				// by slicing the source text — simpler than walking the
				// LinkMark children, and tolerant of nested inline
				// content inside `[text]`.
				const text = state.doc.sliceString(node.from, node.to);
				const sep = text.indexOf("](");
				// Need at least one char of link text between [ and ].
				if (sep <= 1) return;
				const textStart = node.from + 1;
				const textEnd = node.from + sep;
				// Cursor anywhere on the URL portion (or the bracket
				// markers) reveals source so the user can edit it.
				const onSource =
					isOnMark(node.from, textStart) || isOnMark(textEnd, node.to);
				if (!onSource) {
					decorations.push(HIDE.range(node.from, textStart));
					decorations.push(HIDE.range(textEnd, node.to));
				}
				decorations.push(MARK_LINK.range(textStart, textEnd));
				return;
			}
		},
	});

	// Math via regex (Phase B.3). lezer-markdown doesn't tokenize
	// `$…$` / `$$…$$`, so we scan the doc text and emit widget
	// decorations. Cursor on the `$` delimiters keeps source visible;
	// cursor inside the TeX text still renders the widget (the user
	// double-clicks / clicks the rendered math to enter edit mode).
	const docText = state.doc.toString();
	for (const range of mathRangesIn(docText)) {
		const delimLen = range.display ? 2 : 1;
		const openTo = range.from + delimLen;
		const closeFrom = range.to - delimLen;
		const onMark = isOnMark(range.from, openTo) || isOnMark(closeFrom, range.to);
		if (onMark) continue;
		const widget = range.display
			? new BlockMathWidget(range.tex)
			: new InlineMathWidget(range.tex);
		decorations.push(
			Decoration.replace({ widget }).range(range.from, range.to),
		);
	}

	// Obsidian-style `#tag` runs. Pure marker — no HIDE; we keep the
	// `#` visible (pill-style) like Obsidian's editor. Only the
	// `cm-tag` class is applied.
	for (const range of tagRangesIn(docText)) {
		decorations.push(MARK_TAG.range(range.from, range.to));
	}

	// Obsidian-style `==highlight==` runs. lezer-markdown doesn't know
	// the syntax, so we scan via regex and emit HIDE for both `==`
	// pairs + a `cm-highlight` mark over the inner text.
	for (const range of highlightRangesIn(docText)) {
		const openTo = range.from + 2;
		const closeFrom = range.to - 2;
		const onMark = isOnMark(range.from, openTo) || isOnMark(closeFrom, range.to);
		if (!onMark) {
			decorations.push(HIDE.range(range.from, openTo));
			decorations.push(HIDE.range(closeFrom, range.to));
		}
		decorations.push(MARK_HIGHLIGHT.range(openTo, closeFrom));
	}

	// Wiki-links via regex (Phase B.4). lezer-markdown doesn't know
	// about Obsidian's `[[…]]` syntax. Hide brackets / pipe-separator
	// / target portion unless the cursor is sitting on those markers;
	// always mark the display text with `cm-link`.
	for (const range of wikiLinkRangesIn(docText)) {
		const onMark =
			isOnMark(range.from, range.displayFrom) ||
			isOnMark(range.displayTo, range.to);
		if (!onMark) {
			if (range.displayFrom > range.from) {
				decorations.push(HIDE.range(range.from, range.displayFrom));
			}
			if (range.to > range.displayTo) {
				decorations.push(HIDE.range(range.displayTo, range.to));
			}
		}
		decorations.push(
			MARK_LINK.range(range.displayFrom, range.displayTo),
		);
	}

	return Decoration.set(decorations, true);
}

/**
 * Safe wrapper — buildDecorations walks Lezer's syntax tree and pushes
 * Decoration ranges into an array. If any single edge case throws
 * (malformed parse node, unexpected child shape, Decoration.set
 * rejecting an invalid range), the entire decoration set would
 * otherwise be lost AND `this.decorations` would never reinitialize on
 * subsequent updates — the editor would stay rendering raw source
 * forever. Catching keeps the editor functional and logs once so the
 * issue surfaces in DevTools.
 */
function safeBuildDecorations(view: EditorView): DecorationSet {
	try {
		return buildDecorations(view);
	} catch (e) {
		console.error("[learning-system] live-preview decorations failed:", e);
		return Decoration.none;
	}
}

export const livePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = safeBuildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.selectionSet ||
				update.viewportChanged ||
				update.focusChanged
			) {
				this.decorations = safeBuildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);
