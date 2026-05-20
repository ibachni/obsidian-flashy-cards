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
		fontFamily: "inherit",
		backgroundColor: "transparent",
		color: "var(--ls-fg-strong)",
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
		caretColor: "var(--ls-fg-strong)",
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
		borderLeftColor: "var(--ls-fg-strong)",
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

	// Obsidian-style `#tag` pill. Subtle accent-tinted background +
	// rounded corners, matching how Obsidian's editor itself paints
	// tags in Live Preview.
	".cm-tag": {
		color: "rgb(var(--ls-accent))",
		backgroundColor:
			"color-mix(in srgb, rgb(var(--ls-accent)) 12%, transparent)",
		borderRadius: "0.4em",
		padding: "0 0.4em",
		fontSize: "0.9em",
	},

	// GFM strikethrough `~~text~~`.
	".cm-strikethrough": {
		textDecoration: "line-through",
		color: "rgb(var(--ls-muted))",
	},

	// Obsidian-style `==highlight==`. Soft yellow tint that adapts to
	// theme via `color-mix` against the accent — keeps a single brand
	// token in play rather than introducing a new highlight color.
	".cm-highlight": {
		backgroundColor:
			"color-mix(in srgb, rgb(var(--ls-state-learning)) 35%, transparent)",
		borderRadius: "0.2em",
		padding: "0 0.15em",
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
