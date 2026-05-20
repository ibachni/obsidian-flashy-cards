import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
	EditorSelection,
	EditorState,
	type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { Strikethrough } from "@lezer/markdown";

import { livePreviewPlugin } from "./live-preview-decorations";
import { themeExtension } from "./theme";

/**
 * Tells `closeBrackets` which characters to auto-pair. We extend the
 * defaults (`()` `[]` `{}` `'` `"`) with markdown-specific markers so
 * typing `*`, `_`, `` ` ``, or `$` inserts both halves of the pair and
 * places the cursor between them. closeBrackets also handles Backspace
 * (deletes both halves) and type-through (typing the closing char on
 * top of an auto-inserted closer just moves the cursor past it).
 */
const markdownCloseBracketsData = EditorState.languageData.of(() => [
	{
		closeBrackets: {
			brackets: ["(", "[", "{", '"', "'", "`", "*", "_", "$"],
		},
	},
]);

/**
 * Wrap (or unwrap) the current selection in `prefix`/`suffix`. Empty
 * selection inserts an empty pair and places the cursor between, so
 * `Cmd+B` on no selection gives `**|**`. If the selection is already
 * wrapped in the exact prefix/suffix, the wrappers are stripped — same
 * toggle pattern Notion/Bear use.
 */
function wrapSelection(view: EditorView, prefix: string, suffix = prefix): boolean {
	const tr = view.state.changeByRange((range) => {
		const text = view.state.doc.sliceString(range.from, range.to);
		const minLen = prefix.length + suffix.length;
		const alreadyWrapped =
			text.length >= minLen &&
			text.startsWith(prefix) &&
			text.endsWith(suffix);
		if (alreadyWrapped) {
			const inner = text.slice(prefix.length, text.length - suffix.length);
			return {
				changes: { from: range.from, to: range.to, insert: inner },
				// Park the cursor at the end of the unwrapped text so a
				// subsequent keystroke flows naturally — same end-of-edit
				// landing spot as the wrap path.
				range: EditorSelection.cursor(range.from + inner.length),
			};
		}
		const inserted = prefix + text + suffix;
		return {
			changes: { from: range.from, to: range.to, insert: inserted },
			// Empty selection: keep the cursor inside the marker pair so
			// the user can type the bold/italic/etc. content (e.g.,
			// `**|**`). Non-empty selection: land the cursor right after
			// the closing marker — the user's "apply formatting and
			// continue typing" expectation.
			range: range.empty
				? EditorSelection.cursor(range.from + prefix.length)
				: EditorSelection.cursor(range.from + inserted.length),
		};
	});
	view.dispatch(view.state.update(tr, { scrollIntoView: true }));
	return true;
}

/**
 * Wrap the selection as `[text](url)` with the `url` placeholder
 * pre-selected so the user can paste or type to replace. Empty
 * selection yields `[text](url)` with the `text` placeholder selected
 * instead — Cmd+K from a blank position starts at the link text.
 */
function wrapAsLink(view: EditorView): boolean {
	const { state } = view;
	const sel = state.selection.main;
	const selected = state.doc.sliceString(sel.from, sel.to);
	const linkText = selected || "text";
	const insert = `[${linkText}](url)`;
	view.dispatch(
		state.update({
			changes: { from: sel.from, to: sel.to, insert },
			selection: selected
				? // Selection existed → highlight the url placeholder
					EditorSelection.range(
						sel.from + linkText.length + 3,
						sel.from + linkText.length + 3 + 3,
					)
				: // No selection → highlight the text placeholder
					EditorSelection.range(sel.from + 1, sel.from + 1 + linkText.length),
			scrollIntoView: true,
		}),
	);
	return true;
}

/**
 * Window-level capture-phase keydown listener. Necessary because
 * Obsidian's hotkey scope binds `Cmd+B` / `Cmd+I` / etc. on the
 * window with its own listeners, and a plain CM6 keymap (or even
 * `EditorView.domEventHandlers`, which attaches at contentDOM) fires
 * too late — Obsidian's listener handles or `stopImmediatePropagation`s
 * the event before CM6 sees it. Capture phase on `window` fires
 * *before* any bubble-phase listener, so we win unconditionally.
 *
 * The listener gates on `document.activeElement === view.contentDOM`
 * so it only fires when this editor is focused; other Obsidian
 * shortcuts continue to work everywhere else.
 *
 * `getOnSubmit` is read via a getter on each invocation so the latest
 * React closure (with the latest `onSubmit` prop) is used — no need
 * to rebuild extensions when the parent's callback identity changes.
 */
function formattingPlugin(
	getOnSubmit: () => (() => void) | null,
): Extension {
	return ViewPlugin.fromClass(
		class {
			listener: (event: KeyboardEvent) => void;

			constructor(view: EditorView) {
				this.listener = (event) => {
					if (document.activeElement !== view.contentDOM) return;
					const isMod = event.metaKey || event.ctrlKey;
					if (!isMod) return;
					const key = event.key.toLowerCase();
					const shift = event.shiftKey;
					const handle = (fn: () => void): void => {
						event.preventDefault();
						event.stopImmediatePropagation();
						fn();
					};
					if (!shift) {
						if (key === "b") return handle(() => void wrapSelection(view, "**"));
						if (key === "i") return handle(() => void wrapSelection(view, "*"));
						if (key === "e") return handle(() => void wrapSelection(view, "`"));
						if (key === "k") return handle(() => void wrapAsLink(view));
						if (key === "enter") {
							const onSubmit = getOnSubmit();
							if (onSubmit) return handle(onSubmit);
						}
					} else {
						if (key === "s") return handle(() => void wrapSelection(view, "~~"));
						if (key === "h") return handle(() => void wrapSelection(view, "=="));
						if (key === "m") return handle(() => void wrapSelection(view, "$"));
					}
				};
				window.addEventListener("keydown", this.listener, { capture: true });
			}

			destroy() {
				window.removeEventListener("keydown", this.listener, {
					capture: true,
				});
			}
		},
	);
}

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
	getOnSubmit: () => (() => void) | null = () => null,
): Extension[] {
	return [
		history(),
		markdown({ extensions: [Strikethrough] }),
		closeBrackets(),
		markdownCloseBracketsData,
		// Window-level capture-phase keydown handler — fires before
		// Obsidian's app-wide hotkey scope (which is bubble-phase /
		// later-in-capture), so our wrap runs and Obsidian's bound
		// Cmd+B never reaches its handler.
		formattingPlugin(getOnSubmit),
		keymap.of([
			...closeBracketsKeymap,
			...defaultKeymap,
			...historyKeymap,
			indentWithTab,
		]),
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
