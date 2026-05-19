import { EditorView } from "@codemirror/view";

/**
 * CM6 theme bound to the plugin's cream/dark CSS variables. Applied
 * on the editor root so the embedded surface visually matches the
 * other form fields and follows theme toggles automatically.
 *
 * The wrapping div in `EmbeddedEditor` owns the border / background /
 * focus-ring styling (Tailwind-driven), so this theme only paints what
 * lives inside the editor: text color, caret, padding, selection.
 */
export const themeExtension = EditorView.theme({
	"&": {
		height: "100%",
		fontSize: "0.875rem",
		backgroundColor: "transparent",
		color: "rgb(var(--ls-fg))",
	},
	// Fill the editor's available height so empty space below text is
	// still part of the editable surface — clicking anywhere focuses
	// the editor and positions the cursor on the last line.
	".cm-scroller": {
		minHeight: "100%",
		cursor: "text",
	},
	".cm-content": {
		minHeight: "100%",
		padding: "0.25rem 0.5rem",
		fontFamily: "inherit",
		caretColor: "rgb(var(--ls-fg))",
		// Suppress the browser default focus outline on the
		// contenteditable element — it's what was showing up as a
		// dotted horizontal line between filled and empty rows.
		outline: "none",
	},
	".cm-focused": {
		outline: "none",
	},
	".cm-line": {
		padding: "0",
	},
	"&.cm-focused .cm-cursor": {
		borderLeftColor: "rgb(var(--ls-fg))",
	},
	".cm-selectionBackground, ::selection": {
		backgroundColor:
			"color-mix(in srgb, rgb(var(--ls-accent)) 25%, transparent) !important",
	},

	// Live-preview decoration styles (Phase B.2).
	".cm-strong": {
		fontWeight: "bold",
	},
	".cm-em": {
		fontStyle: "italic",
	},
	".cm-inline-code": {
		fontFamily: "var(--font-monospace, monospace)",
		backgroundColor: "rgb(var(--ls-subtle))",
		borderRadius: "0.2em",
		padding: "0 0.25em",
		fontSize: "0.9em",
	},
	".cm-header": {
		fontWeight: "bold",
		lineHeight: "1.25",
	},
	".cm-header-1": { fontSize: "1.5em" },
	".cm-header-2": { fontSize: "1.3em" },
	".cm-header-3": { fontSize: "1.15em" },
	".cm-header-4": { fontSize: "1.05em" },
	".cm-header-5": { fontSize: "1em" },
	".cm-header-6": { fontSize: "0.95em" },
	".cm-list-mark": {
		color: "rgb(var(--ls-muted))",
	},
	// Plain-link + wiki-link display text (Phase B.4). No click-to-
	// navigate yet — Obsidian handles links once the card is saved.
	".cm-link": {
		color: "rgb(var(--ls-accent))",
		textDecoration: "underline",
	},

	// Math widget containers (Phase B.3). Inline math sits in the
	// flow as inline-block; block math takes its own centred line.
	".cm-math-inline": {
		display: "inline-block",
	},
	".cm-math-block": {
		display: "block",
		textAlign: "center",
		margin: "0.5em 0",
	},
	".cm-math-error": {
		color: "rgb(var(--ls-state-overdue))",
		fontFamily: "var(--font-monospace, monospace)",
	},
});
