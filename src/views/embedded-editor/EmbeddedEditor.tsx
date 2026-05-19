import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";

import { buildExtensions } from "./extensions";

export interface EmbeddedEditorHandle {
	focus: () => void;
}

interface Props {
	value: string;
	onChange: (next: string) => void;
	autoFocus?: boolean;
	/**
	 * Fixed-height utility for the editor wrapper. Required so CM6's
	 * `height: 100%` resolves against an explicit parent height —
	 * `min-h-*` collapses to `auto` for percentage children and leaves
	 * the empty area below the first line non-editable. User can drag
	 * the resize handle to grow taller; internal scroll picks up past
	 * that.
	 */
	heightClass?: string;
}

/**
 * React wrapper around a CodeMirror 6 `EditorView` configured for
 * markdown source editing (Phase B.1). The editor exposes a `focus()`
 * imperative handle so the parent can yank focus after Save resets the
 * field.
 *
 * Controlled-bridge contract: `value` is the source of truth from
 * React's perspective. The editor's doc is the source of truth while
 * the user types. We keep them in sync with two effects:
 *
 *  1. An `updateListener` on the editor (set up in `buildExtensions`)
 *     fires `onChange` with the new doc whenever the doc changes.
 *     Before firing, we update `lastPropValueRef` so the prop-sync
 *     effect (#2) doesn't immediately overwrite what the user typed.
 *  2. A prop-watch effect compares `value` to the editor's current doc
 *     and dispatches a replace transaction only when they differ. This
 *     handles parent-driven resets (post-save clear) without round-
 *     tripping during normal typing.
 *
 * The mount effect runs exactly once: we don't recreate the editor on
 * every render. `onChange` is captured via a ref so a fresh function
 * identity per render doesn't trigger remount.
 */
export const EmbeddedEditor = forwardRef<EmbeddedEditorHandle, Props>(
	function EmbeddedEditor(
		{ value, onChange, autoFocus, heightClass = "h-24" },
		ref,
	) {
		const containerRef = useRef<HTMLDivElement>(null);
		const viewRef = useRef<EditorView | null>(null);
		const onChangeRef = useRef(onChange);
		// Tracks what the editor's doc *should* be from the prop side.
		// Set inside both effects so neither feeds back into the other.
		const lastPropValueRef = useRef(value);

		useEffect(() => {
			onChangeRef.current = onChange;
		}, [onChange]);

		useEffect(() => {
			const container = containerRef.current;
			if (!container) return;

			const extensions = buildExtensions((doc) => {
				if (doc !== lastPropValueRef.current) {
					lastPropValueRef.current = doc;
					onChangeRef.current(doc);
				}
			});

			const view = new EditorView({
				state: EditorState.create({
					doc: lastPropValueRef.current,
					extensions,
				}),
				parent: container,
			});
			viewRef.current = view;

			if (autoFocus) view.focus();

			return () => {
				view.destroy();
				viewRef.current = null;
			};
			// Mount once. autoFocus is intentionally not a dep — it only
			// matters on initial mount, like the textarea's autoFocus.
		}, []);

		useEffect(() => {
			const view = viewRef.current;
			if (!view) return;
			const currentDoc = view.state.doc.toString();
			if (value === currentDoc) return;
			// Update the guard before dispatching so the update listener
			// sees `doc === lastPropValueRef` and skips firing onChange.
			lastPropValueRef.current = value;
			view.dispatch({
				changes: { from: 0, to: currentDoc.length, insert: value },
			});
		}, [value]);

		useImperativeHandle(
			ref,
			() => ({
				focus: () => viewRef.current?.focus(),
			}),
			[],
		);

		return (
			<div
				ref={containerRef}
				className={`${heightClass} resize-y overflow-hidden rounded border! border-border! bg-transparent! shadow-none! focus-within:ring-1 focus-within:ring-accent`}
			/>
		);
	},
);
