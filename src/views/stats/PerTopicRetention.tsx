import { useMemo } from "react";

import type { ReviewLogEntry } from "../../cards/review-log";
import { perTopicRetention } from "./aggregations";

const WINDOW_DAYS = 30;
const MIN_GRADES = 5;

interface Props {
	entries: ReviewLogEntry[];
	loading: boolean;
}

export function PerTopicRetention({ entries, loading }: Props) {
	const rows = useMemo(
		() => perTopicRetention(entries, new Date(), WINDOW_DAYS, MIN_GRADES),
		[entries],
	);

	return (
		<section className="flex flex-col gap-2">
			<header className="flex items-baseline justify-between">
				<h3 className="m-0 text-xs uppercase tracking-wide text-muted!">
					Per-topic retention · last {WINDOW_DAYS} days
				</h3>
				{rows.length > 0 && (
					<span className="text-xs text-muted!">
						{rows.length} {rows.length === 1 ? "topic" : "topics"}
					</span>
				)}
			</header>

			{loading && entries.length === 0 ? (
				<Skeleton />
			) : rows.length === 0 ? (
				<div className="rounded border border-border bg-subtle/30 px-3 py-6 text-center text-xs text-muted!">
					Need at least {MIN_GRADES} grades on a topic in the last {WINDOW_DAYS} days
					to compute retention.
				</div>
			) : (
				<ul className="m-0 flex flex-col gap-1 list-none p-0">
					{rows.map((r) => (
						<li
							key={r.topic}
							className="flex items-baseline justify-between gap-3 rounded px-2 py-1 hover:bg-subtle/50"
						>
							<span className="truncate text-sm text-fg!">{r.topic}</span>
							<span className="shrink-0 text-xs text-muted!">
								{r.total} {r.total === 1 ? "grade" : "grades"} ·{" "}
								<span className="text-fg-strong!">
									{Math.round(r.rate * 100)}%
								</span>
							</span>
						</li>
					))}
				</ul>
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
