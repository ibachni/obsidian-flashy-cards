import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { livePreviewPlugin } from "./live-preview-decorations";
import { themeExtension } from "./theme";

/**
 * Build the CM6 extension array for an embedded markdown editor.
 *
 * Phase B.1 stack:
 *  - `markdown()` for syntax tree + source-mode highlighting.
 *  - `history()` + the default and history keymaps + `indentWithTab`
 *    so undo/redo/cut/paste/Tab work as expected. Tab inserts indent
 *    rather than moving focus, matching Obsidian's behavior.
 *  - `EditorView.lineWrapping` so long lines wrap visually instead of
 *    introducing horizontal scroll inside a sidebar pane.
 *  - An `updateListener` that surfaces document changes to React. We
 *    only call `onDocChange` when the doc actually changed so non-doc
 *    transactions (selection moves, viewport changes) don't churn the
 *    parent's state.
 *  - The cream/dark theme extension last so it wins over upstream
 *    defaults via source order.
 */
export function buildExtensions(
	onDocChange: (doc: string) => void,
): Extension[] {
	return [
		history(),
		markdown(),
		keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
		EditorView.lineWrapping,
		livePreviewPlugin,
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				onDocChange(update.state.doc.toString());
			}
		}),
		themeExtension,
	];
}
