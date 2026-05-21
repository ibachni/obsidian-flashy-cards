import { useMemo } from "react";

import type { ReviewLogEntry } from "../../cards/review-log";
import { streak } from "./aggregations";

/** Anything past this shows as "N+" — keeps the number readable. */
const DISPLAY_CAP = 90;

interface Props {
	entries: ReviewLogEntry[];
	loading: boolean;
}

export function Streak({ entries, loading }: Props) {
	const stat = useMemo(() => streak(entries, new Date()), [entries]);

	return (
		<section className="flex flex-col gap-2">
			<h3 className="m-0 text-xs uppercase tracking-wide text-muted!">
				Streak
			</h3>

			{loading && entries.length === 0 ? (
				<Skeleton />
			) : (
				<div className="flex items-baseline gap-3">
					<span className="text-3xl font-medium text-fg-strong!">
						{stat.days >= DISPLAY_CAP ? `${DISPLAY_CAP}+` : stat.days}
					</span>
					<span className="text-xs text-muted!">
						{stat.days === 1 ? "day" : "days"}
						{stat.lastDate && ` · last reviewed ${stat.lastDate}`}
					</span>
				</div>
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
