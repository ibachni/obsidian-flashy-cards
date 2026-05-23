import { useEffect, useState } from "react";

import type { ParsedCard } from "../cards/parser";
import { makeAppIODeps } from "../cards/occlusion-io";
import {
	readOcclusionSet,
	resolveOcclusionJsonPath,
	shouldHideMask,
	type OcclusionSetT,
} from "../cards/occlusion";
import { usePluginContext } from "./PluginContext";

interface Props {
	card: ParsedCard;
	/** Q-side render when false; A-side (no overlay) when true. */
	revealed: boolean;
	/**
	 * Whether to outline the other (non-active) masks on the Q side.
	 * Defaults to true — matches Anki's image-occlusion convention so
	 * the user can see "this is one of N occlusions" rather than
	 * staring at a single mystery rectangle. Set false for pure-blind
	 * mode (future polish).
	 */
	showOutlines?: boolean;
}

type SetState =
	| { kind: "loading" }
	| { kind: "ok"; set: OcclusionSetT }
	| { kind: "error"; message: string };

type DimsState =
	| { kind: "loading" }
	| { kind: "ok"; w: number; h: number }
	| { kind: "error"; message: string };

/**
 * Read-only render of an occlusion sibling. Driven by the card's
 * `fm.occlusion_source` + `maskIndex` — the parser already produced
 * the right sibling identity; this component just paints it.
 *
 * Two async loads gate the final render: the JSON sidecar (so we
 * know which masks to draw) and the image's intrinsic dimensions
 * (so the SVG `viewBox` is sized correctly for mask coordinates).
 * Both are local-disk reads — typically resolve in one frame.
 */
export function OcclusionRenderer({
	card,
	revealed,
	showOutlines = true,
}: Props) {
	const { app } = usePluginContext();
	const [setState, setSetState] = useState<SetState>({ kind: "loading" });
	const [dims, setDims] = useState<DimsState>({ kind: "loading" });

	// Reload the JSON whenever the underlying card path changes. The
	// `maskIndex` doesn't trigger a reload — it's the same file, just
	// a different sibling. ReviewPane re-mounts (or re-renders) this
	// component when stepping through siblings via the picker.
	useEffect(() => {
		let cancelled = false;
		setSetState({ kind: "loading" });
		setDims({ kind: "loading" });
		const jsonPath = resolveOcclusionJsonPath(
			card.path,
			card.fm.occlusion_source ?? "",
		);
		void (async () => {
			const result = await readOcclusionSet(makeAppIODeps(app), jsonPath);
			if (cancelled) return;
			if (result.kind === "ok") {
				setSetState({ kind: "ok", set: result.set });
			} else if (result.kind === "missing") {
				setSetState({
					kind: "error",
					message: `Sidecar missing: ${jsonPath}`,
				});
			} else {
				setSetState({
					kind: "error",
					message: `Sidecar invalid: ${result.error}`,
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [app, card.path, card.fm.occlusion_source]);

	// Image dimensions: load via a detached <img> element. We need the
	// intrinsic w/h because mask coordinates are pixel-space; the SVG
	// `viewBox` uses these so masks render at the right relative spot
	// regardless of display size. Re-runs only when the image path
	// changes (rare — would mean the user edited the JSON's `image`
	// field while reviewing).
	const imagePath = setState.kind === "ok" ? setState.set.image : null;
	useEffect(() => {
		if (imagePath === null) return;
		let cancelled = false;
		const url = app.vault.adapter.getResourcePath(imagePath);
		const probe = new Image();
		probe.onload = () => {
			if (cancelled) return;
			setDims({ kind: "ok", w: probe.naturalWidth, h: probe.naturalHeight });
		};
		probe.onerror = () => {
			if (cancelled) return;
			setDims({
				kind: "error",
				message: `Image not loadable: ${imagePath}`,
			});
		};
		probe.src = url;
		return () => {
			cancelled = true;
			// Detach handlers so a late `load` after unmount can't
			// setState into an unmounted component.
			probe.onload = null;
			probe.onerror = null;
		};
	}, [app, imagePath]);

	if (setState.kind === "loading" || dims.kind === "loading") {
		return (
			<div className="flex h-48 items-center justify-center text-sm text-muted">
				Loading occlusion…
			</div>
		);
	}
	if (setState.kind === "error") {
		return (
			<div className="flex h-48 items-center justify-center text-sm text-state-overdue">
				{setState.message}
			</div>
		);
	}
	if (dims.kind === "error") {
		return (
			<div className="flex h-48 items-center justify-center text-sm text-state-overdue">
				{dims.message}
			</div>
		);
	}

	const { set } = setState;
	const { w: imgW, h: imgH } = dims;
	// `maskIndex` is 1-based on the ParsedCard; the masks array is
	// 0-based. Off-by-one would silently mask the wrong rectangle —
	// the test on occlusion.test.ts pins `shouldHideMask`'s contract
	// against this conversion.
	const activeIdx = (card.maskIndex ?? 1) - 1;
	const imageUrl = app.vault.adapter.getResourcePath(set.image);

	return (
		<svg
			viewBox={`0 0 ${imgW} ${imgH}`}
			className="ls-occlusion-svg block h-auto w-full"
			role="img"
			aria-label={ariaLabelFor(set, card.maskIndex ?? 1, revealed)}
		>
			<image
				href={imageUrl}
				width={imgW}
				height={imgH}
				preserveAspectRatio="xMidYMid meet"
			/>
			{set.masks.map((m, i) => {
				if (!shouldHideMask(i, activeIdx, set.mode, revealed)) return null;
				return (
					<rect
						key={`hide-${i}`}
						x={m.x}
						y={m.y}
						width={m.w}
						height={m.h}
						// `--ls-mask-fill` is themeable but defaults to #000 —
						// black on either background matches the conventional
						// Anki look.
						fill="var(--ls-mask-fill, #000)"
					/>
				);
			})}
			{/* Outlines on the non-active *visible* masks are only useful in
			    hide-one mode — show-one and reveal-in-order already make
			    the structure obvious through what's covered vs. uncovered.
			    `showOutlines` lets callers override (e.g. a future
			    pure-blind mode). */}
			{!revealed &&
				showOutlines &&
				set.mode === "hide-one" &&
				set.masks.map((m, i) =>
					i === activeIdx ? null : (
						<rect
							key={`outline-${i}`}
							x={m.x}
							y={m.y}
							width={m.w}
							height={m.h}
							fill="none"
							stroke="rgb(var(--ls-accent, 198 151 73))"
							strokeWidth={Math.max(1, Math.round(imgW / 600))}
							strokeDasharray="4 2"
						/>
					),
				)}
		</svg>
	);
}

function ariaLabelFor(
	set: OcclusionSetT,
	maskIndex: number,
	revealed: boolean,
): string {
	const total = set.masks.length;
	if (revealed) return `Image occlusion — answer revealed (mask ${maskIndex}/${total})`;
	switch (set.mode) {
		case "hide-one":
			return `Image occlusion — mask ${maskIndex} of ${total} hidden`;
		case "show-one":
			return `Image occlusion — only mask ${maskIndex} of ${total} visible`;
		case "reveal-in-order":
			return `Image occlusion — masks 1–${maskIndex - 1} revealed, ${maskIndex} of ${total} hidden`;
	}
}
