import { useEffect, useRef } from "react";
import { Component, MarkdownRenderer } from "obsidian";
import { usePluginContext } from "./PluginContext";

interface Props {
	source: string;
	/** File path used as the resolution context for wikilinks / embeds. */
	sourcePath?: string;
	className?: string;
}

/**
 * Renders markdown via Obsidian's `MarkdownRenderer.render`, which gives
 * us LaTeX, code highlighting, and wikilink resolution for free.
 *
 * Each render call gets its own child Component — accumulating renders
 * on a long-lived parent Component would leak event listeners and embed
 * registrations. The cleanup function unloads the child on rerender or
 * unmount.
 */
export function MarkdownBlock({ source, sourcePath = "", className }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const { app } = usePluginContext();

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const sub = new Component();
		sub.load();
		el.empty();
		void MarkdownRenderer.render(app, source, el, sourcePath, sub);

		return () => {
			sub.unload();
		};
	}, [source, sourcePath, app]);

	return <div ref={ref} className={className} />;
}
