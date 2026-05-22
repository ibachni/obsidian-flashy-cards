import { Forecast } from "./stats/Forecast";
import { Heatmap } from "./stats/Heatmap";
import { PerTopicRetention } from "./stats/PerTopicRetention";
import { RetentionRate } from "./stats/RetentionRate";
import { StateBreakdown } from "./stats/StateBreakdown";
import { Streak } from "./stats/Streak";
import { useReviewLog } from "./stats/useReviewLog";

/**
 * Stats pane host. The review-log read is centralized here so the three
 * log-derived panels and the heatmap share one subscription and one
 * cached array — independent calls would multiply both the read I/O
 * and the `metadataCache.changed` listeners.
 *
 * Frontmatter-derived panels (State breakdown, Forecast) bind to
 * `useCardStore` directly; they don't need the log.
 */
export function StatsPane() {
	const { entries, loading } = useReviewLog();

	return (
		<div className="flex flex-col gap-6">
			<Heatmap entries={entries} loading={loading} />
			<StateBreakdown />
			<Forecast />
			<RetentionRate entries={entries} loading={loading} />
			<Streak entries={entries} loading={loading} />
			<PerTopicRetention entries={entries} loading={loading} />
		</div>
	);
}
