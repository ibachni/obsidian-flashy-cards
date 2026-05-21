import { useLayoutEffect, useRef, useState } from "react";

import type { ReviewLogEntry } from "../../cards/review-log";
import { heatmapBuckets, type HeatmapCell } from "./aggregations";

const YEAR_WEEKS = 53;
const HALF_YEAR_WEEKS = 26;
const MIN_CELL = 6;
const MAX_CELL = 12;
const CELL_GAP = 1;

/** Bucket → Tailwind-scanned class string. Order matters. */
const HEAT_CLS = [
	"ls-heat-0",
	"ls-heat-1",
	"ls-heat-2",
	"ls-heat-3",
	"ls-heat-4",
] as const;

function bucketIndex(count: number): number {
	if (count === 0) return 0;
	if (count <= 2) return 1;
	if (count <= 5) return 2;
	if (count <= 9) return 3;
	return 4;
}

/**
 * Place chronological cells into a (weeks × 7) grid with today at the
 * bottom-right of the rightmost column (today's day-of-week row). Going
 * back, fill upward; on Sunday (row 0) wrap to the previous column at
 * row 6 (Saturday). Leading slots are `null` when we run out of cells.
 */
function layoutWeeks(
	cells: HeatmapCell[],
	today: Date,
	weeks: number,
): (HeatmapCell | null)[][] {
	const grid: (HeatmapCell | null)[][] = Array.from({ length: weeks }, () =>
		Array<HeatmapCell | null>(7).fill(null),
	);
	let col = weeks - 1;
	let row = today.getDay();
	for (let i = cells.length - 1; i >= 0; i--) {
		if (col < 0) break;
		const column = grid[col];
		const c = cells[i];
		if (column && c) column[row] = c;
		row -= 1;
		if (row < 0) {
			row = 6;
			col -= 1;
		}
	}
	return grid;
}

interface Props {
	entries: ReviewLogEntry[];
	loading: boolean;
}

export function Heatmap({ entries, loading }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [forceFullYear, setForceFullYear] = useState(false);

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver((observed) => {
			const first = observed[0];
			if (first) setWidth(first.contentRect.width);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// View-mode logic. The toggle only appears when full-year would
	// require sub-MIN_CELL columns — i.e. when the user actually has a
	// choice to make.
	const cellAtYear = width === 0 ? MAX_CELL : Math.floor(width / YEAR_WEEKS);
	const wouldOverflow = width > 0 && cellAtYear < MIN_CELL;
	const showHalfYear = wouldOverflow && !forceFullYear;
	const weeks = showHalfYear ? HALF_YEAR_WEEKS : YEAR_WEEKS;
	const cellSize =
		width === 0
			? MAX_CELL
			: Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(width / weeks)));

	const today = new Date();
	// Match the requested window to the grid's actual capacity. The last
	// column only fills rows 0..today.getDay() (future days stay null);
	// asking for `weeks * 7` instead would silently drop the oldest
	// (worst case 6) cells when today is earlier in the week than
	// Saturday. Window length varies by day-of-week — year-view spans
	// 365–371 days, half-year spans 176–182.
	const days = (weeks - 1) * 7 + today.getDay() + 1;
	const cells = heatmapBuckets(entries, today, days);
	const grid = layoutWeeks(cells, today, weeks);
	const totalGrades = cells.reduce((acc, c) => acc + c.count, 0);

	const svgWidth = weeks * cellSize;
	const svgHeight = 7 * cellSize;

	return (
		<section ref={containerRef} className="flex flex-col gap-2">
			<header className="flex items-baseline justify-between">
				<h3 className="m-0 text-xs uppercase tracking-wide text-muted!">
					Activity · {showHalfYear ? "last 26 weeks" : "last year"}
				</h3>
				<span className="text-xs text-muted!">
					{totalGrades} {totalGrades === 1 ? "review" : "reviews"}
				</span>
			</header>

			{loading && entries.length === 0 ? (
				<Skeleton />
			) : totalGrades === 0 ? (
				<div className="rounded border border-border bg-subtle/30 px-3 py-6 text-center text-xs text-muted!">
					No reviews logged yet — grade a card to start your activity calendar.
				</div>
			) : (
				<>
					<svg
						width={svgWidth}
						height={svgHeight}
						viewBox={`0 0 ${svgWidth} ${svgHeight}`}
						className="block"
						role="img"
						aria-label={`Review activity over the ${showHalfYear ? "last 26 weeks" : "last year"}`}
					>
						{grid.map((week, wi) =>
							week.map((cell, di) => {
								if (!cell) return null;
								return (
									<rect
										key={`${wi}-${di}`}
										x={wi * cellSize}
										y={di * cellSize}
										width={cellSize - CELL_GAP}
										height={cellSize - CELL_GAP}
										rx={1}
										className={HEAT_CLS[bucketIndex(cell.count)]}
									>
										<title>
											{cell.date} · {cell.count}{" "}
											{cell.count === 1 ? "review" : "reviews"}
										</title>
									</rect>
								);
							}),
						)}
					</svg>
					{wouldOverflow && (
						<button
							type="button"
							className="ls-flat self-start rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted! hover:text-fg-strong! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
							onClick={() => setForceFullYear((v) => !v)}
						>
							{forceFullYear ? "Show recent only" : "Show full year"}
						</button>
					)}
				</>
			)}
		</section>
	);
}

function Skeleton() {
	return (
		<div className="rounded border border-border bg-subtle/30 px-3 py-6 text-center text-xs text-muted!">
			Loading…
		</div>
	);
}
