import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { Notice } from "obsidian";

import {
	extensionForMime,
	saveAttachment,
} from "../../cards/image-attachment";

/**
 * Gate predicate: matches image File entries whose MIME we can write
 * out without falling through to the `.bin` extension. SVG
 * (`image/svg+xml`) is intentionally excluded for v1. SVG pastes
 * still land as text via the default paste handler.
 */
function isSupportedImage(file: File): boolean {
	return (
		file.type.startsWith("image/") &&
		extensionForMime(file.type) !== "bin"
	);
}

function makePendingId(): string {
	return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function placeholderText(id: string): string {
	return `![[uploading-${id}.png]]`;
}

function insertAtCursor(view: EditorView, text: string): void {
	const sel = view.state.selection.main;
	view.dispatch({
		changes: { from: sel.from, to: sel.to, insert: text },
		selection: { anchor: sel.from + text.length },
	});
}

/**
 * Find the placeholder string in the current doc and replace it with
 * `replacement`. Returns `false` if the placeholder is gone — the user
 * edited it away between the synchronous insertion and our async
 * resolve. By construction the placeholder is unique (contains a
 * timestamp + random suffix), so `indexOf` doesn't risk hitting the
 * wrong occurrence.
 */
function replacePlaceholder(
	view: EditorView,
	placeholder: string,
	replacement: string,
): boolean {
	const doc = view.state.doc.toString();
	const idx = doc.indexOf(placeholder);
	if (idx < 0) return false;
	view.dispatch({
		changes: { from: idx, to: idx + placeholder.length, insert: replacement },
	});
	return true;
}

function appendAtEnd(view: EditorView, text: string): void {
	const end = view.state.doc.length;
	const lastChar = end > 0 ? view.state.doc.sliceString(end - 1, end) : "";
	const sep = end === 0 || lastChar === "\n" ? "" : "\n";
	view.dispatch({
		changes: { from: end, insert: sep + text },
	});
}

async function handleImageFile(
	view: EditorView,
	app: App,
	cardsRoot: string,
	file: File,
): Promise<void> {
	const id = makePendingId();
	const placeholder = placeholderText(id);
	insertAtCursor(view, placeholder);

	try {
		const { wikiembed } = await saveAttachment(
			{
				exists: (p) => app.vault.getAbstractFileByPath(p) !== null,
				ensureFolder: async (p) => {
					await app.vault.createFolder(p);
				},
				writeBinary: async (p, data) => {
					await app.vault.createBinary(p, data);
				},
			},
			cardsRoot,
			file,
			{ hint: file.name },
		);
		if (!replacePlaceholder(view, placeholder, wikiembed)) {
			appendAtEnd(view, wikiembed);
			new Notice("Image inserted at end — placeholder was edited away");
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error("[learning-system] image paste failed:", e);
		replacePlaceholder(
			view,
			placeholder,
			`<!-- image paste failed: ${msg} -->`,
		);
		new Notice(`Image paste failed: ${msg}`);
	}
}

/**
 * CM6 extension: routes paste and drop of image File entries through
 * [saveAttachment](../../cards/image-attachment.ts) and inserts a
 * `![[…]]` embed at the cursor.
 *
 * `getCardsRoot` is called per event (not snapshotted) so a settings
 * change to `cardsRoot` doesn't require rebuilding the editor.
 *
 * UX is placeholder-then-replace: the placeholder lands synchronously
 * so the editor feels responsive on multi-megabyte pastes; the real
 * embed swaps in when the binary write resolves. If the user has
 * edited the placeholder away by then, the embed falls back to the
 * end of the doc with a `Notice`.
 *
 * Drop guard: a `dataTransfer` carrying Obsidian's `"obsidian/file"`
 * marker is a vault-internal drag (e.g., the file explorer dropping a
 * file onto an editor); we defer to Obsidian's built-in wikilink
 * insertion. External drops (Finder → editor) we handle ourselves.
 */
export function pasteDropPlugin(
	app: App,
	getCardsRoot: () => string,
): Extension {
	return EditorView.domEventHandlers({
		paste(event, view) {
			const files = event.clipboardData?.files;
			const file = files && files.length > 0 ? files[0] : undefined;
			if (!file || !isSupportedImage(file)) return false;
			event.preventDefault();
			void handleImageFile(view, app, getCardsRoot(), file);
			return true;
		},
		drop(event, view) {
			const dt = event.dataTransfer;
			if (!dt) return false;
			// Vault-internal drag — let Obsidian's own handler run.
			if (dt.types.includes("obsidian/file")) return false;
			const file = dt.files.length > 0 ? dt.files[0] : undefined;
			if (!file || !isSupportedImage(file)) return false;
			event.preventDefault();
			event.stopPropagation();
			void handleImageFile(view, app, getCardsRoot(), file);
			return true;
		},
	});
}
