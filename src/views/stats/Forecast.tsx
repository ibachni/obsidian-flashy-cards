import { useMemo } from "react";

import { useCardStore } from "../../cards/store";
import { forecast, type ForecastBucket } from "./aggregations";
import { STATE_BAR_STYLE, STATE_LABEL, STATE_ORDER } from "./state-colors";

const DAYS = 30;
/** Show an x-axis tick every Nth bucket so labels don't crowd. */
const LABEL_STRIDE = 5;

function bucketTotal(b: ForecastBucket): number {
	return b.counts.new + b.counts.learning + b.counts.review + b.counts.relearning;
}

function shortDate(iso: string): string {
	// "2026-05-20" → "05-20"
	return iso.slice(5);
}

export function Forecast() {
	const cardsById = useCardStore((s) => s.cardsById);
	const buckets = useMemo(() => {
		// `today` is captured on each store-change render, not on every
		// React render — which is fine; the forecast doesn't need
		// sub-minute precision. A user crossing midnight while staring at
		// the pane gets the new day's view on the next grade event.
		return forecast(Array.from(cardsById.values()), new Date(), DAYS);
	}, [cardsById]);

	const max = Math.max(1, ...buckets.map(bucketTotal));
	const grandTotal = buckets.reduce((acc, b) => acc + bucketTotal(b), 0);

	return (
		<section className="flex flex-col gap-2">
			<header className="flex items-baseline justify-between">
				<h3 className="m-0 text-xs uppercase tracking-wide text-muted!">
					Forecast · next {DAYS} days
				</h3>
				<span className="text-xs text-muted!">
					{grandTotal} {grandTotal === 1 ? "card" : "cards"}
				</span>
			</header>

			{grandTotal === 0 ? (
				<div className="rounded border border-border bg-subtle/30 px-3 py-6 text-center text-xs text-muted!">
					No cards scheduled in the next {DAYS} days.
				</div>
			) : (
				<>
					<div
						className="flex items-end gap-px"
						style={{ height: "6rem" }}
					>
						{buckets.map((b) => (
							<div
								key={b.date}
								className="flex h-full flex-1 flex-col-reverse justify-start"
							>
								{STATE_ORDER.map((k) => {
									const c = b.counts[k];
									if (c === 0) return null;
									const pct = (c / max) * 100;
									return (
										<div
											key={k}
											style={{
												...STATE_BAR_STYLE[k],
												height: `${pct}%`,
											}}
											title={`${b.date} · ${STATE_LABEL[k]} ${c}`}
										/>
									);
								})}
							</div>
						))}
					</div>

					{/* One slot per bar, mirroring the bar row's `flex gap-px`
					    layout so each label aligns over its own column.
					    `whitespace-nowrap` lets the 5-char date overflow into
					    the empty slots that follow it. */}
					<div className="flex gap-px text-[10px] text-muted!">
						{buckets.map((b, i) => (
							<span
								key={b.date}
								className="flex-1 whitespace-nowrap text-left"
							>
								{i % LABEL_STRIDE === 0 ? shortDate(b.date) : ""}
							</span>
						))}
					</div>
				</>
			)}
		</section>
	);
}
