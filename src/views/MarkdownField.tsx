import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";

import {
	EmbeddedEditor,
	type EmbeddedEditorHandle,
} from "./embedded-editor/EmbeddedEditor";
import { usePluginContext } from "./PluginContext";

export interface MarkdownFieldHandle {
	focus: () => void;
}

interface Props {
	label: string;
	value: string;
	onChange: (next: string) => void;
	autoFocus?: boolean;
	optional?: boolean;
	/** Cmd+Enter handler — forwarded to the embedded editor. */
	onSubmit?: () => void;
}

/**
 * Labelled markdown field for the new-card pane's Question and Answer.
 * Wraps an `EmbeddedEditor` (CM6 + lang-markdown + live-preview
 * decorations + MathJax widgets) — the editor *is* the preview, so the
 * old Edit/Preview toggle is gone.
 *
 * Imperative handle: `focus()` delegates to the embedded editor. The
 * new-card pane's post-save reset uses it to bring focus back to the
 * Question field.
 */
export const MarkdownField = forwardRef<MarkdownFieldHandle, Props>(
	function MarkdownField(
		{ label, value, onChange, autoFocus, optional, onSubmit },
		ref,
	) {
		const editorRef = useRef<EmbeddedEditorHandle>(null);
		const { app, plugin } = usePluginContext();

		// Snapshot identity — the editor mounts once and reads
		// `getCardsRoot()` per event, so re-deriving this object every
		// render would not trigger rebuilds anyway, but `useMemo` keeps
		// the inner ref-sync effect cheap.
		const imageAttachments = useMemo(
			() => ({ app, getCardsRoot: () => plugin.normalizedCardsRoot() }),
			[app, plugin],
		);

		useImperativeHandle(
			ref,
			() => ({
				focus: () => editorRef.current?.focus(),
			}),
			[],
		);

		return (
			<div className="flex flex-col gap-1">
				<span className="text-sm font-medium text-muted!">
					{label}
					{optional && <span className="text-muted!"> (optional)</span>}
				</span>
				<EmbeddedEditor
					ref={editorRef}
					value={value}
					onChange={onChange}
					autoFocus={autoFocus}
					onSubmit={onSubmit}
					imageAttachments={imageAttachments}
				/>
			</div>
		);
	},
);
