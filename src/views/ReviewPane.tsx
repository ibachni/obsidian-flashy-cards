import {
	useEffect,
	useMemo,
	useReducer,
	useState,
	type ReactNode,
} from "react";
import { Notice } from "obsidian";
import { useCardStore } from "../cards/store";
import { nextDueAfter, pickNext } from "../cards/picker";
import { Rating, type Grade } from "../srs/fsrs-engine";
import {
	formatDelta,
	formatDueShort,
	formatInterval,
	parseDueDate,
} from "./date-utils";
import { MarkdownBlock } from "./MarkdownBlock";
import { usePluginContext } from "./PluginContext";
import {
	deriveStateTagKind,
	STATE_TAG_CLS,
	STATE_TAG_LABEL,
} from "./state-tag";

export function ReviewPane() {
	const { app, plugin } = usePluginContext();
	const cardsById = useCardStore((s) => s.cardsById);
	const reviewScope = useCardStore((s) => s.reviewScope);
	const clearReviewScope = useCardStore((s) => s.clearReviewScope);

	const [revealed, setRevealed] = useState(false);
	const [doneCount, setDoneCount] = useState(0);

	// Subscribe to the plugin's undo-slot pub-sub so the footer Undo
	// button enables/disables when the slot toggles. The slot lives on
	// the plugin (ephemeral session state, not card data — see plan
	// docs/features/keyboard-and-undo.md → Footer reactivity), so we
	// bridge to React via a forceUpdate. useReducer's dispatch identity
	// is stable, so the listener add/remove is symmetric.
	const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
	useEffect(() => {
		plugin.undoSlotListeners.add(forceUpdate);
		return () => {
			plugin.undoSlotListeners.delete(forceUpdate);
		};
	}, [plugin]);
	const canUndo = plugin.undoSlot.entry !== null;

	const cardArray = Array.from(cardsById.values());
	const now = new Date();
	const scopedArray =
		reviewScope === null
			? cardArray
			: cardArray.filter((c) => reviewScope.includes(c.path));
	const due = scopedArray.filter((c) => parseDueDate(c.fm.fsrs_due) <= now);
	const newCount = scopedArray.filter(
		(c) => c.fm.fsrs_state === "new",
	).length;
	const current = pickNext(cardArray, now, reviewScope);

	// Defined before the early return so the reviewActions useEffect
	// below can capture it without violating hook ordering. Guards on
	// `!current` since the empty-state branch can call into it (it
	// shouldn't, but the type narrowing isn't preserved across the
	// early return).
	const grade = async (rating: Grade) => {
		if (!current) return;
		try {
			await plugin.gradeAndPersist(current, rating);
			setDoneCount((c) => c + 1);
			setRevealed(false);
		} catch (e) {
			// Without this, a thrown error from gradeCard / processFrontMatter
			// leaves the UI stuck on the same revealed card with no feedback.
			// Surface as a Notice so the user can see what went wrong.
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] grade failed:", e);
			new Notice(`Grade failed: ${msg}`);
		}
	};

	// Imperative handle for the plugin's document-level keydown listener.
	// Always registered while mounted (cleared only on unmount) so the
	// `u` key can reach undoLastGrade even in the empty Review state
	// after the user grades their last card. Re-registers when `current`
	// or `revealed` changes so closures reflect live state. Lives above
	// the early-return so React's hook order stays stable across the
	// empty-state transition.
	//
	// `grade` and `app` aren't in deps: `grade` is functionally
	// equivalent across renders when current/revealed are stable, and
	// `app` is plugin-stable.
	useEffect(() => {
		plugin.reviewActions = {
			reveal: () => {
				// Guard so a stray Space/Enter in empty state doesn't
				// leave revealed=true for when a card returns via undo.
				if (current) setRevealed(true);
			},
			// grade() already guards on `!current` internally.
			grade: (rating) => void grade(rating),
			isRevealed: () => revealed,
			openSource: () => {
				if (!current) return;
				// Same primitive Browse row-click uses — keeps the open-
				// in-main-area behavior consistent. `newLeaf=false`
				// reuses the active leaf.
				void app.workspace.openLinkText(current.path, "", false);
			},
		};
		return () => {
			plugin.reviewActions = null;
		};
	}, [current, revealed]);

	// Projected next-due dates per rating. Keyed off `current?.path` so
	// the previews recompute only when the visible card changes — the
	// render-time `now` ticks on every parent render and would otherwise
	// re-fuzz the displayed intervals on each tick. The `now` used here
	// can be a few milliseconds off from the surrounding render-time
	// `now`; that's invisible at the minute/hour/day granularity the
	// formatter emits.
	//
	// Lives above the empty-state early-return so React's hook order
	// stays stable when `current` flips to null on the last grade —
	// otherwise the component renders one fewer hook and crashes.
	const intervals = useMemo<Record<Grade, string> | null>(() => {
		if (!current) return null;
		const previewNow = new Date();
		const previews = plugin.previewIntervals(current.fm, previewNow);
		return {
			[Rating.Again]: formatInterval(previews[Rating.Again], previewNow),
			[Rating.Hard]: formatInterval(previews[Rating.Hard], previewNow),
			[Rating.Good]: formatInterval(previews[Rating.Good], previewNow),
			[Rating.Easy]: formatInterval(previews[Rating.Easy], previewNow),
		};
	}, [current?.path, plugin]);

	if (!current) {
		const next = nextDueAfter(cardArray, now, reviewScope);
		const scopeWasActive = reviewScope !== null;
		// Reaching empty in a scoped session releases the scope so the
		// next time the user opens Review it iterates over the full deck.
		if (scopeWasActive) clearReviewScope();
		return (
			<div className="flex h-full flex-col gap-4">
				<p className="text-sm text-muted">
					No cards due
					{next && <> · next in {formatDelta(next, now)}</>}.
				</p>

				{/* `mt-auto` matches the active session's pinned footer
				    position so the row doesn't jump on the last grade. */}
				<footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-[11px] text-muted">
					{scopeWasActive && (
						<span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg">
							Scoped
						</span>
					)}
					<span className="ml-auto">
						{doneCount} done · {scopedArray.length}{" "}
						{scopeWasActive ? "in scope" : "total"} · {newCount} new
					</span>
				</footer>
			</div>
		);
	}

	const stateKind = deriveStateTagKind(current, now);
	const sessionTotal = doneCount + due.length;

	return (
		<div className="flex h-full flex-col gap-4">
			<header className="flex shrink-0 flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 truncate font-mono text-xs text-muted">
						{current.fm.topic}
						{current.fm.section && (
							<>
								<span className="px-1 opacity-50">/</span>
								{current.fm.section}
							</>
						)}
						{current.clozeIndex !== null && (
							<>
								<span className="px-1.5 opacity-50">·</span>c
								{current.clozeIndex}
							</>
						)}
						<span className="px-1.5 opacity-50">·</span>
						due {formatDueShort(current.fm.fsrs_due, now)}
					</span>
					<div className="flex shrink-0 items-center gap-1.5">
						{reviewScope !== null && (
							<span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg">
								Scoped
							</span>
						)}
						<span
							className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATE_TAG_CLS[stateKind]}`}
						>
							{STATE_TAG_LABEL[stateKind]}
						</span>
					</div>
				</div>
				<ProgressBar done={doneCount} total={sessionTotal} />
			</header>

			{/* `min-h-0` is load-bearing: a flex-1 child defaults to
			    `min-height: auto` (= content size) and won't overflow. */}
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
				<section>
					<MarkdownBlock
						source={current.question}
						sourcePath={current.path}
					/>
				</section>

				{revealed && (
					<section className="border-t border-border pt-4">
						<MarkdownBlock
							source={current.answer}
							sourcePath={current.path}
						/>
					</section>
				)}
			</div>

			<div className="flex shrink-0 flex-col gap-4">
				<div className="flex flex-wrap justify-center gap-3">
					{!revealed ? (
						<button
							type="button"
							className="ls-btn-primary inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
							onClick={() => setRevealed(true)}
						>
							Show answer
						</button>
					) : (
						<>
							<GradeButton
								label="Again"
								rating={Rating.Again}
								interval={intervals?.[Rating.Again]}
								onClick={grade}
							/>
							<GradeButton
								label="Hard"
								rating={Rating.Hard}
								interval={intervals?.[Rating.Hard]}
								onClick={grade}
							/>
							<GradeButton
								label="Good"
								rating={Rating.Good}
								interval={intervals?.[Rating.Good]}
								onClick={grade}
							/>
							<GradeButton
								label="Easy"
								rating={Rating.Easy}
								interval={intervals?.[Rating.Easy]}
								onClick={grade}
							/>
						</>
					)}
				</div>

				{/* Opacity sits on the passive zones, not the footer wrapper:
				    parent opacity multiplies through descendants and would
				    clip each icon's hover lift.

				    Layout uses container queries (sidebar widths vary) with
				    two grid-template-area arrangements:
				    - Narrow (default): two rows. Row 1 = counter (left) +
				      icons (right). Row 2 = hint centered, spanning both
				      columns. Keeps the hint from wrapping mid-line.
				    - Wide (≥380px): single row of counter | hint | icons.
				      The middle track is `auto` so the hint hugs its
				      content and stays mathematically centered between
				      two equal 1fr side tracks. */}
				<footer className="@container border-t border-border pt-3 text-[10px] text-muted">
					<div className="grid items-center gap-x-2 gap-y-2 grid-cols-[1fr_auto] [grid-template-areas:'counter_icons'_'hint_hint'] @[380px]:grid-cols-[1fr_auto_1fr] @[380px]:[grid-template-areas:'counter_hint_icons']">
						<span className="tabular-nums opacity-60 justify-self-start [grid-area:counter]">
							{doneCount}/{sessionTotal}
							{newCount > 0 && <> · {newCount} new</>}
						</span>

						<div className="opacity-60 justify-self-center [grid-area:hint]">
							<HotkeyHint />
						</div>

						<div className="flex shrink-0 items-center gap-0.5 justify-self-end [grid-area:icons]">
						<IconAction
							label="Edit card"
							onClick={() => plugin.openEditCardModal(current)}
						>
							<PencilIcon />
						</IconAction>
						<IconAction
							label="Delete card"
							danger
							onClick={() =>
								plugin.openDeleteCardConfirm(current, () =>
									setRevealed(false),
								)
							}
						>
							<TrashIcon />
						</IconAction>
						{/* Disabled (not hidden) keeps the row width stable as the
						    undo slot toggles. */}
						<IconAction
							label="Undo last grade"
							disabled={!canUndo}
							onClick={() => void plugin.undoLastGrade()}
						>
							<UndoIcon />
						</IconAction>
					</div>
					</div>
				</footer>
			</div>
		</div>
	);
}

function Kbd({ children }: { children: ReactNode }) {
	// `!` overrides on bg/border/color because Obsidian's unlayered <kbd>
	// defaults beat our layered utilities.
	return (
		<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border! bg-subtle! px-1.5 font-mono text-[9px] leading-none text-muted! shadow-none!">
			{children}
		</kbd>
	);
}

function HotkeyHint() {
	// flex-nowrap on the row so a too-narrow container hands wrapping
	// decisions back to the footer's container query (which switches
	// to a stacked layout) instead of breaking mid-hint.
	return (
		<div className="flex flex-nowrap items-center gap-x-2 text-[10px] text-muted">
			<span className="inline-flex items-center gap-1 whitespace-nowrap">
				<Kbd>Space</Kbd> reveal
			</span>
			<span className="inline-flex items-center gap-1 whitespace-nowrap">
				<Kbd>1</Kbd>–<Kbd>4</Kbd> grade
			</span>
			<span className="inline-flex items-center gap-1 whitespace-nowrap">
				<Kbd>E</Kbd> source
			</span>
			<span className="inline-flex items-center gap-1 whitespace-nowrap">
				<Kbd>U</Kbd> undo
			</span>
		</div>
	);
}

function IconAction({
	label,
	onClick,
	disabled = false,
	danger = false,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
			className={`ls-flat inline-flex shrink-0 items-center justify-center rounded p-1 text-muted! opacity-70 transition-all hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed ${danger ? "hover:text-state-overdue!" : "hover:text-fg-strong!"}`}
		>
			{children}
		</button>
	);
}

function ProgressBar({ done, total }: { done: number; total: number }) {
	if (total === 0) return null;
	const pct = Math.min(100, Math.max(0, (done / total) * 100));
	return (
		<div className="h-0.5 w-full overflow-hidden rounded-full bg-subtle/30">
			<div
				className="h-full bg-accent transition-all duration-150"
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}

// Static strings (not interpolated) so Tailwind's content scanner picks them up.
// `!` modifiers because Obsidian's unlayered <button> defaults (background,
// border, shadow, color) beat our layered Tailwind utilities — same pattern
// as `ls-btn-outline` / `ls-btn-primary`.
const GRADE_STYLE: Record<Grade, string> = {
	[Rating.Again]:
		"border-state-overdue/40! bg-state-overdue/22! text-state-overdue! hover:bg-state-overdue! hover:border-state-overdue! hover:text-bg!",
	[Rating.Hard]:
		"border-state-learning/40! bg-state-learning/22! text-state-learning! hover:bg-state-learning! hover:border-state-learning! hover:text-bg!",
	[Rating.Good]:
		"border-state-review/40! bg-state-review/22! text-state-review! hover:bg-state-review! hover:border-state-review! hover:text-bg!",
	[Rating.Easy]:
		"border-state-new/40! bg-state-new/22! text-state-new! hover:bg-state-new! hover:border-state-new! hover:text-bg!",
};

function GradeButton({
	label,
	rating,
	interval,
	onClick,
}: {
	label: string;
	rating: Grade;
	interval?: string;
	onClick: (r: Grade) => void | Promise<void>;
}) {
	return (
		<button
			type="button"
			className={`inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-md border! px-4 text-base font-medium shadow-none! transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${GRADE_STYLE[rating]}`}
			onClick={() => void onClick(rating)}
		>
			<span className="leading-none">{label}</span>
			{/* NBSP placeholder reserves the line height so the button row
			    doesn't twitch on the brief render where the interval is
			    still missing. */}
			<span className="font-mono text-xs font-normal leading-none tabular-nums opacity-60">
				{interval ?? "\u00A0"}
			</span>
		</button>
	);
}

function PencilIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
			<path d="M10 11v6" />
			<path d="M14 11v6" />
			<path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
		</svg>
	);
}

function UndoIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M3 7v6h6" />
			<path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
		</svg>
	);
}

