import { useState } from "react";
import { Notice } from "obsidian";
import { useCardStore } from "../cards/store";
import { nextDueAfter, pickNext } from "../cards/picker";
import { Rating, type Grade } from "../srs/fsrs-engine";
import { formatDelta, parseDueDate } from "./date-utils";
import { MarkdownBlock } from "./MarkdownBlock";
import { usePluginContext } from "./PluginContext";
import { ViewSwitcher } from "./ViewSwitcher";

export function ReviewPane() {
	const { plugin } = usePluginContext();
	const cardsByPath = useCardStore((s) => s.cardsByPath);
	const reviewScope = useCardStore((s) => s.reviewScope);
	const clearReviewScope = useCardStore((s) => s.clearReviewScope);

	const [revealed, setRevealed] = useState(false);
	const [doneCount, setDoneCount] = useState(0);

	const cardArray = Array.from(cardsByPath.values());
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

	if (!current) {
		const next = nextDueAfter(cardArray, now, reviewScope);
		const scopeWasActive = reviewScope !== null;
		// Reaching empty in a scoped session releases the scope so the
		// next time the user opens Review it iterates over the full deck.
		if (scopeWasActive) clearReviewScope();
		return (
			<div className="flex flex-col gap-4 px-6 pt-3 pb-6">
				<header className="flex items-center justify-between gap-2">
					<h2 className="text-base font-semibold">Review</h2>
					<ViewSwitcher active="review" variant="compact" />
				</header>

				<p className="text-sm text-muted">
					No cards due
					{next && <> · next in {formatDelta(next, now)}</>}.
				</p>

				<footer className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-muted">
					{scopeWasActive ? (
						<span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-fg">
							Reviewing scoped subset
						</span>
					) : (
						<span />
					)}
					<span>
						{doneCount} done · {scopedArray.length}{" "}
						{scopeWasActive ? "in scope" : "total"} · {newCount} new
					</span>
				</footer>
			</div>
		);
	}

	const grade = async (rating: Grade) => {
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

	return (
		<div className="flex flex-col gap-4 px-6 pt-3 pb-6">
			<header className="flex items-center justify-between gap-2">
				<h2 className="text-base font-semibold">Review</h2>
				<ViewSwitcher active="review" variant="compact" />
			</header>

			<section>
				<h3 className="mb-2 text-xs uppercase tracking-wide text-muted">
					Question
				</h3>
				<MarkdownBlock source={current.question} sourcePath={current.path} />
			</section>

			{revealed && (
				<section className="border-t border-border pt-4">
					<h3 className="mb-2 text-xs uppercase tracking-wide text-muted">
						Answer
					</h3>
					<MarkdownBlock
						source={current.answer}
						sourcePath={current.path}
					/>
				</section>
			)}

			<div className="flex flex-wrap gap-2">
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
						<GradeButton label="Again" rating={Rating.Again} onClick={grade} />
						<GradeButton label="Hard" rating={Rating.Hard} onClick={grade} />
						<GradeButton label="Good" rating={Rating.Good} onClick={grade} />
						<GradeButton label="Easy" rating={Rating.Easy} onClick={grade} />
					</>
				)}
			</div>

			<footer className="flex flex-col gap-1 pt-2 text-xs text-muted">
				<div className="flex flex-wrap items-center gap-2">
					{reviewScope !== null && (
						<span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-fg">
							Reviewing scoped subset
						</span>
					)}
					<span className="uppercase tracking-wide">
						{current.fm.topic}
						{current.fm.section && ` · ${current.fm.section}`}
						{` · due ${current.fm.fsrs_due}`}
						{` · ${current.fm.fsrs_state}`}
					</span>
				</div>
				<span>
					{doneCount} done · {due.length} due · {newCount} new
				</span>
			</footer>
		</div>
	);
}

function GradeButton({
	label,
	rating,
	onClick,
}: {
	label: string;
	rating: Grade;
	onClick: (r: Grade) => void | Promise<void>;
}) {
	return (
		<button
			type="button"
			className="ls-btn-outline inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
			onClick={() => void onClick(rating)}
		>
			{label}
		</button>
	);
}

