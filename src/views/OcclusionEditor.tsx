import {
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";

import type { OcclusionModeT } from "../cards/occlusion";
import {
	area,
	clampRect,
	hitTest,
	MIN_AREA,
	moveItem,
	moveRect,
	normalizeRect,
	resizeRect,
	snapRect,
	type Handle,
	type Rect,
} from "./occlusion-geometry";
import { usePluginContext } from "./PluginContext";

/**
 * Editor-side mask: pure `Rect` geometry plus an opaque `id` the
 * editor mints on creation and preserves through every reorder /
 * move / resize. The id never reaches disk — the OcclusionSet
 * schema stores masks by array position — but it lets the pane's
 * "edit existing card" flow match edited masks against their
 * pre-edit on-disk counterparts to preserve per-mask FSRS slots
 * across geometry changes.
 */
export interface EditorMask extends Rect {
	id: string;
}

/** Mint a short opaque id for a freshly-drawn mask. */
export function makeMaskId(): string {
	return Math.random().toString(36).slice(2, 10);
}

interface Props {
	/** Vault-relative path of the source image. */
	imagePath: string;
	/** Current set of masks. Caller owns persistence; this is purely a controlled component. */
	masks: EditorMask[];
	/** Emit on every commit (rect added, moved, resized, deleted, reordered). */
	onChange: (masks: EditorMask[]) => void;
	/**
	 * Active mode. Drives two behaviors:
	 *   - `reveal-in-order` shows a sequence number on each rectangle
	 *     so the user can see the reveal order visually, and lets
	 *     them press digit keys while a mask is selected to move
	 *     that mask to the new 1-indexed position (multi-digit via
	 *     a 700ms accumulator + Enter to commit).
	 *   - Other modes don't surface order — `hide-one` and `show-one`
	 *     treat all siblings as equivalent.
	 */
	mode: OcclusionModeT;
	/**
	 * Notify the host of the current reorder-buffer state so it can
	 * render a "Setting to: 12…" hint outside the SVG. Fires with
	 * `""` when the buffer is empty. Optional — callers that don't
	 * need the hint can omit.
	 */
	onReorderBufferChange?: (buffer: string) => void;
}

type Interaction =
	| { kind: "idle" }
	| {
			// Drawing a brand-new rectangle. `start` is the mousedown
			// point; the live preview rect is recomputed each pointermove.
			kind: "drawing";
			start: { x: number; y: number };
			current: Rect;
	  }
	| {
			// Moving an existing rectangle by dragging its body.
			kind: "moving";
			index: number;
			startMask: Rect;
			startPointer: { x: number; y: number };
	  }
	| {
			// Resizing via a corner/edge handle.
			kind: "resizing";
			index: number;
			handle: Handle;
			startMask: Rect;
	  };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * SVG-based drawing surface for occlusion masks. Strict controlled
 * component: takes `masks` + `onChange`, never owns the canonical
 * list. The host (OcclusionPane) is responsible for persisting and
 * for any save-on-blur policy.
 *
 * Interaction model:
 *   - Mouse-down on empty canvas → start drawing
 *   - Mouse-down on an existing rect's body → select + start moving
 *   - Mouse-down on a handle → start resizing from that handle
 *   - Backspace/Delete with a selection → remove the mask
 *   - Escape → deselect
 *
 * Coordinates: image-pixel space throughout (matches the SVG
 * `viewBox`). Mouse events translate via `clientToImage` using the
 * current bounding rect — works regardless of CSS scale.
 */
export function OcclusionEditor({
	imagePath,
	masks,
	onChange,
	mode,
	onReorderBufferChange,
}: Props) {
	const { app } = usePluginContext();
	const svgRef = useRef<SVGSVGElement>(null);
	// Focus target for keyboard handling (Backspace/Delete/Escape).
	// Without this, click-to-select wouldn't move focus into the
	// wrapper and the keydown handler would never fire — the user
	// would have to Tab in before Delete worked.
	const wrapperRef = useRef<HTMLDivElement>(null);
	// Image dimensions drive the viewBox; the SVG scales responsively
	// via CSS but mask coordinates stay in image-pixel space.
	const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [interaction, setInteraction] = useState<Interaction>({ kind: "idle" });
	// Reorder digit buffer (reveal-in-order mode only). Accumulates
	// across consecutive keypresses so the user can type two-digit
	// positions like "14"; cleared on Enter, Escape, or a 700ms
	// inactivity timeout. Each press also commits the current buffer
	// value via `moveItem`, so feedback is live — the buffer is just
	// the "what counts as a continuation" window.
	const [reorderBuffer, setReorderBuffer] = useState("");
	const reorderTimer = useRef<number | null>(null);

	const clearReorderBuffer = () => {
		if (reorderTimer.current !== null) {
			window.clearTimeout(reorderTimer.current);
			reorderTimer.current = null;
		}
		setReorderBuffer("");
	};

	// Cancel any pending reorder timeout when the component unmounts —
	// firing into an unmounted setState would warn (and leak).
	useEffect(() => {
		return () => {
			if (reorderTimer.current !== null) {
				window.clearTimeout(reorderTimer.current);
			}
		};
	}, []);

	// Bubble buffer changes up so the pane can show a "Setting to:
	// 12…" hint outside the SVG (where text wouldn't fit cleanly).
	useEffect(() => {
		onReorderBufferChange?.(reorderBuffer);
	}, [reorderBuffer, onReorderBufferChange]);

	useEffect(() => {
		let cancelled = false;
		setDims(null);
		const url = app.vault.adapter.getResourcePath(imagePath);
		const probe = new Image();
		probe.onload = () => {
			if (cancelled) return;
			setDims({ w: probe.naturalWidth, h: probe.naturalHeight });
		};
		probe.onerror = () => {
			if (cancelled) return;
			setDims(null);
		};
		probe.src = url;
		return () => {
			cancelled = true;
			probe.onload = null;
			probe.onerror = null;
		};
	}, [app, imagePath]);

	// Drop the selection if the masks array shrinks below it (mask
	// deleted out from under us, e.g. via Backspace).
	useEffect(() => {
		if (selectedIndex !== null && selectedIndex >= masks.length) {
			setSelectedIndex(null);
		}
	}, [masks.length, selectedIndex]);

	/**
	 * Translate a DOM mouse coordinate to image-pixel space. Reads the
	 * SVG's current bounding rect (CSS-sized) and scales against the
	 * image's intrinsic dimensions. The SVG uses `viewBox` for layout,
	 * so this is equivalent to `getScreenCTM().inverse()` but avoids
	 * the matrix algebra.
	 */
	const clientToImage = (clientX: number, clientY: number): { x: number; y: number } | null => {
		const svg = svgRef.current;
		if (!svg || !dims) return null;
		const rect = svg.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		const x = ((clientX - rect.left) / rect.width) * dims.w;
		const y = ((clientY - rect.top) / rect.height) * dims.h;
		return { x, y };
	};

	const handleSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
		// Right-click and other non-primary buttons fall through.
		if (e.button !== 0) return;
		const pt = clientToImage(e.clientX, e.clientY);
		if (!pt || !dims) return;
		// Capture pointer so the drag tracks even if the cursor leaves
		// the SVG bounds. Released in pointerup / pointercancel.
		(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
		// Move keyboard focus into the wrapper so subsequent
		// Backspace/Delete/Escape reach `handleKeyDown`. Without this,
		// click-to-select leaves focus on whatever the user had focused
		// before (commonly the Save button), and the key handler never
		// fires on the editor.
		wrapperRef.current?.focus({ preventScroll: true });

		// Did the click land on an existing rect? Topmost wins.
		const hitIdx = hitTest(masks, pt.x, pt.y);
		if (hitIdx !== null) {
			setSelectedIndex(hitIdx);
			setInteraction({
				kind: "moving",
				index: hitIdx,
				startMask: { ...masks[hitIdx]! },
				startPointer: pt,
			});
			return;
		}

		// Empty canvas → start drawing.
		setSelectedIndex(null);
		setInteraction({
			kind: "drawing",
			start: pt,
			current: { x: pt.x, y: pt.y, w: 0, h: 0 },
		});
	};

	const handleSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
		if (interaction.kind === "idle") return;
		const pt = clientToImage(e.clientX, e.clientY);
		if (!pt || !dims) return;

		if (interaction.kind === "drawing") {
			setInteraction({
				...interaction,
				current: {
					x: interaction.start.x,
					y: interaction.start.y,
					w: pt.x - interaction.start.x,
					h: pt.y - interaction.start.y,
				},
			});
		} else if (interaction.kind === "moving") {
			const dx = pt.x - interaction.startPointer.x;
			const dy = pt.y - interaction.startPointer.y;
			const next = clampRect(
				moveRect(interaction.startMask, dx, dy),
				dims.w,
				dims.h,
			);
			const nextMasks = masks.slice();
			// Spread preserves the EditorMask's `id` through every
			// geometry change — geometry helpers return plain `Rect`
			// and would otherwise drop it.
			nextMasks[interaction.index] = {
				...nextMasks[interaction.index]!,
				...next,
			};
			onChange(nextMasks);
		} else if (interaction.kind === "resizing") {
			const next = resizeRect(
				interaction.startMask,
				interaction.handle,
				pt.x,
				pt.y,
			);
			const nextMasks = masks.slice();
			// Don't normalize during the drag — that would make the
			// visible rect snap-flip across the anchor mid-drag. The
			// commit (pointerup) applies normalize + snap.
			nextMasks[interaction.index] = {
				...nextMasks[interaction.index]!,
				...next,
			};
			onChange(nextMasks);
		}
	};

	const handleSvgPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
		if (interaction.kind === "idle") return;
		try {
			(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
		} catch {
			// releasePointerCapture throws if the pointer isn't captured —
			// happens on pointercancel paths. Safe to ignore.
		}

		if (interaction.kind === "drawing") {
			const candidate = snapRect(
				clampRect(
					normalizeRect(interaction.current),
					dims?.w ?? Infinity,
					dims?.h ?? Infinity,
				),
			);
			// Discard tiny drags — usually a stray click, not a real mask.
			if (area(candidate) >= MIN_AREA) {
				const newMask: EditorMask = { ...candidate, id: makeMaskId() };
				const nextMasks = [...masks, newMask];
				onChange(nextMasks);
				setSelectedIndex(nextMasks.length - 1);
			}
		} else if (interaction.kind === "moving") {
			// Commit: snap to integer pixels. The live drag already
			// applied clamp; snap finishes the canonicalization.
			const final = snapRect(masks[interaction.index]!);
			const nextMasks = masks.slice();
			nextMasks[interaction.index] = {
				...nextMasks[interaction.index]!,
				...final,
			};
			onChange(nextMasks);
		} else if (interaction.kind === "resizing") {
			// Normalize + clamp + snap at commit time. The live drag
			// may have produced negative w/h.
			const raw = masks[interaction.index]!;
			const final = snapRect(
				clampRect(normalizeRect(raw), dims?.w ?? Infinity, dims?.h ?? Infinity),
			);
			// Below-min rectangles collapse to their pre-drag size —
			// the user can't accidentally shrink a mask to invisibility.
			const baseMask = masks[interaction.index]!;
			const finalGeom = area(final) >= MIN_AREA ? final : interaction.startMask;
			const committed: EditorMask = { ...baseMask, ...finalGeom };
			const nextMasks = masks.slice();
			nextMasks[interaction.index] = committed;
			onChange(nextMasks);
		}

		setInteraction({ kind: "idle" });
	};

	const handlePointerDownOnHandle = (
		e: ReactPointerEvent<SVGElement>,
		index: number,
		handle: Handle,
	) => {
		if (e.button !== 0) return;
		// Stop the SVG-level handler from also firing (which would
		// start a draw or hit-test the body).
		e.stopPropagation();
		svgRef.current?.setPointerCapture(e.pointerId);
		setSelectedIndex(index);
		setInteraction({
			kind: "resizing",
			index,
			handle,
			startMask: { ...masks[index]! },
		});
	};

	const handleKeyDown = (e: ReactKeyboardEvent) => {
		if (e.key === "Backspace" || e.key === "Delete") {
			if (selectedIndex === null) return;
			e.preventDefault();
			const next = masks.filter((_, i) => i !== selectedIndex);
			onChange(next);
			setSelectedIndex(null);
			clearReorderBuffer();
			return;
		}
		if (e.key === "Escape") {
			setSelectedIndex(null);
			clearReorderBuffer();
			return;
		}
		// Reveal-in-order mode: digits 0–9 accumulate into a buffer
		// so the user can type two-digit positions (e.g. "1" then "4"
		// → 14). Each press commits the current buffer value
		// immediately so the user sees the move land; the buffer is
		// just the window during which a follow-up digit extends the
		// number. Enter commits + clears. Escape cancels.
		// Other modes ignore digits entirely — the reveal sequence
		// doesn't matter, and a stray digit shouldn't reshuffle masks
		// behind the user's back.
		if (
			mode === "reveal-in-order" &&
			selectedIndex !== null &&
			/^[0-9]$/.test(e.key)
		) {
			e.preventDefault();
			// Cap the buffer at 3 digits (positions 1–999). Anyone with
			// a 1000-mask set is doing something exotic and can drop
			// the buffer with Esc + start again.
			const nextBuffer = (reorderBuffer + e.key).slice(-3);
			// Empty buffer ("0", or "00…") is meaningless — wait for a
			// non-zero digit. Stash the digits for continuation but
			// don't move yet.
			const numeric = parseInt(nextBuffer, 10);
			if (Number.isNaN(numeric) || numeric < 1) {
				setReorderBuffer(nextBuffer);
				scheduleReorderTimeout();
				return;
			}
			const target = Math.min(numeric - 1, masks.length - 1);
			if (target !== selectedIndex) {
				onChange(moveItem(masks, selectedIndex, target));
				setSelectedIndex(target);
			}
			setReorderBuffer(nextBuffer);
			scheduleReorderTimeout();
			return;
		}
		if (e.key === "Enter" && reorderBuffer.length > 0) {
			e.preventDefault();
			clearReorderBuffer();
		}
	};

	const scheduleReorderTimeout = () => {
		if (reorderTimer.current !== null) {
			window.clearTimeout(reorderTimer.current);
		}
		// 700ms matches the time-to-second-digit a non-trained user
		// takes to chord two numbers — fast enough that the hint
		// doesn't linger, slow enough that intentional two-digit input
		// works without rushing.
		reorderTimer.current = window.setTimeout(() => {
			setReorderBuffer("");
			reorderTimer.current = null;
		}, 700);
	};

	if (!dims) {
		return (
			<div className="flex h-48 items-center justify-center rounded border border-border bg-subtle/20 text-sm text-muted">
				Loading image…
			</div>
		);
	}

	const previewRect =
		interaction.kind === "drawing" ? normalizeRect(interaction.current) : null;
	const imageUrl = app.vault.adapter.getResourcePath(imagePath);

	return (
		<div
			ref={wrapperRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			// `outline-none` so the tab-focus ring doesn't ring the whole
			// drawing surface — focus is just needed for keyboard events.
			className="ls-occlusion-editor outline-none"
			aria-label="Occlusion editor"
		>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${dims.w} ${dims.h}`}
				className="block h-auto w-full select-none"
				onPointerDown={handleSvgPointerDown}
				onPointerMove={handleSvgPointerMove}
				onPointerUp={handleSvgPointerUp}
				onPointerCancel={handleSvgPointerUp}
				style={{ touchAction: "none" }}
			>
				<image
					href={imageUrl}
					width={dims.w}
					height={dims.h}
					preserveAspectRatio="xMidYMid meet"
				/>

				{masks.map((m, i) => {
					const isSelected = i === selectedIndex;
					// During an in-progress drag the user-visible rect may
					// have non-canonical (negative) w/h; render the
					// normalized form so handles stay attached to the
					// visible corners.
					const visible = normalizeRect(m);
					// Badge font size tracks image dimensions so the
					// number stays legible on both small and large
					// images. Tuned at ~4% of longest edge.
					const badgeSize = Math.max(
						14,
						Math.round(Math.max(dims.w, dims.h) / 25),
					);
					return (
						<g key={i}>
							<rect
								x={visible.x}
								y={visible.y}
								width={visible.w}
								height={visible.h}
								fill="var(--ls-mask-fill, #000)"
								opacity={isSelected ? 0.78 : 0.85}
								stroke={isSelected ? "rgb(var(--ls-accent, 198 151 73))" : "none"}
								strokeWidth={Math.max(1, Math.round(dims.w / 600))}
							/>
							{mode === "reveal-in-order" && (
								<text
									x={visible.x + visible.w / 2}
									y={visible.y + visible.h / 2}
									textAnchor="middle"
									dominantBaseline="central"
									fontSize={badgeSize}
									fontWeight="bold"
									fill="white"
									stroke="rgba(0,0,0,0.7)"
									strokeWidth={Math.max(1, badgeSize / 14)}
									paintOrder="stroke fill"
									pointerEvents="none"
								>
									{i + 1}
								</text>
							)}
							{isSelected &&
								HANDLES.map((h) => {
									const pos = handlePosition(visible, h);
									// Handle size in image-pixel space so it
									// scales with the SVG. Tuned at ~1.2% of
									// the image's longer side.
									const size = Math.max(
										6,
										Math.round(Math.max(dims.w, dims.h) / 80),
									);
									return (
										<rect
											key={h}
											x={pos.x - size / 2}
											y={pos.y - size / 2}
											width={size}
											height={size}
											fill="rgb(var(--ls-accent, 198 151 73))"
											stroke="white"
											strokeWidth={Math.max(1, Math.round(dims.w / 1200))}
											style={{ cursor: handleCursor(h) }}
											onPointerDown={(ev) =>
												handlePointerDownOnHandle(ev, i, h)
											}
										/>
									);
								})}
						</g>
					);
				})}

				{previewRect && area(previewRect) > 0 && (
					<rect
						x={previewRect.x}
						y={previewRect.y}
						width={previewRect.w}
						height={previewRect.h}
						fill="var(--ls-mask-fill, #000)"
						opacity={0.4}
						stroke="rgb(var(--ls-accent, 198 151 73))"
						strokeDasharray="4 2"
						strokeWidth={Math.max(1, Math.round(dims.w / 600))}
					/>
				)}
			</svg>
		</div>
	);
}

/** Image-space position of a handle on a rectangle. */
function handlePosition(r: Rect, h: Handle): { x: number; y: number } {
	const cx = r.x + r.w / 2;
	const cy = r.y + r.h / 2;
	switch (h) {
		case "nw":
			return { x: r.x, y: r.y };
		case "n":
			return { x: cx, y: r.y };
		case "ne":
			return { x: r.x + r.w, y: r.y };
		case "e":
			return { x: r.x + r.w, y: cy };
		case "se":
			return { x: r.x + r.w, y: r.y + r.h };
		case "s":
			return { x: cx, y: r.y + r.h };
		case "sw":
			return { x: r.x, y: r.y + r.h };
		case "w":
			return { x: r.x, y: cy };
	}
}

function handleCursor(h: Handle): string {
	switch (h) {
		case "nw":
		case "se":
			return "nwse-resize";
		case "ne":
		case "sw":
			return "nesw-resize";
		case "n":
		case "s":
			return "ns-resize";
		case "e":
		case "w":
			return "ew-resize";
	}
}
