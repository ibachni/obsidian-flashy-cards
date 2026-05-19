import { finishRenderMath, loadMathJax, renderMath } from "obsidian";
import { WidgetType } from "@codemirror/view";

/**
 * MathJax widgets for the embedded editor (Phase B.3).
 *
 * Pure regex detection lives in `math-ranges.ts` so unit tests don't
 * have to resolve `obsidian` (whose npm package ships with `main: ""`
 * and won't load in vitest).
 *
 * `loadMathJax` is fired-and-forgotten at module load — the first
 * editor mount triggers it, and subsequent widget renders find
 * MathJax ready. If a widget tries to render before MathJax has
 * loaded, it falls back to showing the source so the editor stays
 * usable.
 */

// Top-level fire-and-forget. We don't await — the editor must mount
// regardless of MathJax's load latency.
void loadMathJax().catch((err: unknown) => {
	console.error("[learning-system] MathJax load failed:", err);
});

abstract class MathWidget extends WidgetType {
	constructor(
		readonly tex: string,
		readonly display: boolean,
	) {
		super();
	}

	// CM6 reuses widgets when `eq` returns true — keyed on tex + mode.
	// Without this, every keystroke would re-instantiate a widget at
	// the same position and trigger MathJax re-render, causing visible
	// flicker.
	eq(other: WidgetType): boolean {
		return (
			other instanceof MathWidget &&
			other.tex === this.tex &&
			other.display === this.display
		);
	}

	toDOM(): HTMLElement {
		const el = document.createElement(this.display ? "div" : "span");
		el.className = `cm-math-widget ${this.display ? "cm-math-block" : "cm-math-inline"}`;
		try {
			const rendered = renderMath(this.tex, this.display);
			el.appendChild(rendered);
			// finishRenderMath flushes MathJax's stylesheet — required
			// once per batch of renders. Cheap when called repeatedly.
			void finishRenderMath();
		} catch (e) {
			// MathJax not ready yet, or tex source malformed — show
			// source as a fallback so the editor never looks broken.
			el.textContent = this.display ? `$$${this.tex}$$` : `$${this.tex}$`;
			el.classList.add("cm-math-error");
			console.error("[learning-system] math render failed:", e);
		}
		return el;
	}

	// Let clicks through so the user can click the rendered widget to
	// position the cursor inside the source and edit.
	ignoreEvent(): boolean {
		return false;
	}
}

export class InlineMathWidget extends MathWidget {
	constructor(tex: string) {
		super(tex, false);
	}
}

export class BlockMathWidget extends MathWidget {
	constructor(tex: string) {
		super(tex, true);
	}
}
