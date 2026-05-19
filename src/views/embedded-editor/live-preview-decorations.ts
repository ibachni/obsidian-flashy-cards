import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

import { mathRangesIn } from "./math-ranges";
import { BlockMathWidget, InlineMathWidget } from "./math-widget";
import { rangesOverlap } from "./range-overlap";
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

	// Per-token preview: only the markup the cursor's selection range
	// actually touches reveals its source. Matches Obsidian — moving
	// the cursor off `**bold**` collapses just that `**` pair while
	// `$math$` on the same line continues to render.
	const isOnCursor = (from: number, to: number) =>
		rangesOverlap(sel.from, sel.to, from, to);

	syntaxTree(state).iterate({
		enter: (node) => {
			const name = node.type.name;
			const onCursor = isOnCursor(node.from, node.to);

			if (name === "StrongEmphasis" || name === "Emphasis") {
				const first = node.node.firstChild;
				const last = node.node.lastChild;
				if (!first || !last || first.to > last.from) return;
				const mark = name === "StrongEmphasis" ? MARK_STRONG : MARK_EM;
				if (!onCursor) decorations.push(HIDE.range(first.from, first.to));
				decorations.push(mark.range(first.to, last.from));
				if (!onCursor) decorations.push(HIDE.range(last.from, last.to));
				return;
			}

			if (name === "InlineCode") {
				const first = node.node.firstChild;
				const last = node.node.lastChild;
				if (!first || !last || first.to > last.from) return;
				if (!onCursor) decorations.push(HIDE.range(first.from, first.to));
				decorations.push(MARK_INLINE_CODE.range(first.to, last.from));
				if (!onCursor) decorations.push(HIDE.range(last.from, last.to));
				return;
			}

			if (name.startsWith("ATXHeading")) {
				const mark = HEADING_MARKS[name];
				if (!mark) return;
				const headerMark = node.node.firstChild;
				if (headerMark && headerMark.type.name === "HeaderMark") {
					if (!onCursor) {
						decorations.push(HIDE.range(headerMark.from, headerMark.to));
					}
					decorations.push(mark.range(headerMark.to, node.to));
				} else {
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
				if (!onCursor) {
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
	// decorations when the cursor's selection isn't touching the
	// math range. Cursor inside the math → source stays visible for
	// editing.
	const docText = state.doc.toString();
	for (const range of mathRangesIn(docText)) {
		if (isOnCursor(range.from, range.to)) continue;
		const widget = range.display
			? new BlockMathWidget(range.tex)
			: new InlineMathWidget(range.tex);
		decorations.push(
			Decoration.replace({ widget }).range(range.from, range.to),
		);
	}

	// Wiki-links via regex (Phase B.4). lezer-markdown doesn't know
	// about Obsidian's `[[…]]` syntax. Hide brackets / pipe-separator
	// / target portion when the cursor isn't touching the link;
	// always mark the display text with `cm-link`.
	for (const range of wikiLinkRangesIn(docText)) {
		const onCursor = isOnCursor(range.from, range.to);
		if (!onCursor) {
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

export const livePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.selectionSet ||
				update.viewportChanged
			) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);
