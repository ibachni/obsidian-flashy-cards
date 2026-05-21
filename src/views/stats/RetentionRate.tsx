import { useMemo } from "react";

import type { ReviewLogEntry } from "../../cards/review-log";
import { retentionRate } from "./aggregations";

const LIMIT = 200;

interface Props {
	entries: ReviewLogEntry[];
	loading: boolean;
}

export function RetentionRate({ entries, loading }: Props) {
	const stat = useMemo(() => retentionRate(entries, LIMIT), [entries]);

	return (
		<section className="flex flex-col gap-2">
			<h3 className="m-0 text-xs uppercase tracking-wide text-muted!">
				Retention
			</h3>

			{loading && entries.length === 0 ? (
				<Skeleton />
			) : stat.total === 0 ? (
				<EmptyNote text="Grade some cards to see your retention rate." />
			) : (
				<div className="flex items-baseline gap-3">
					<span className="text-3xl font-medium text-fg-strong!">
						{Math.round((stat.rate ?? 0) * 100)}%
					</span>
					<span className="text-xs text-muted!">
						{stat.total} of {LIMIT} grades
						{stat.sinceDate && ` · since ${stat.sinceDate}`}
					</span>
				</div>
			)}
			{!loading && stat.total > 0 && stat.total < LIMIT && (
				<p className="m-0 text-[10px] text-muted!">
					Counts grow as you grade more cards.
				</p>
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

function EmptyNote({ text }: { text: string }) {
	return (
		<div className="rounded border border-border bg-subtle/30 px-3 py-6 text-center text-xs text-muted!">
			{text}
		</div>
	);
}
