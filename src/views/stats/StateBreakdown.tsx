import { useMemo } from "react";

import { useCardStore } from "../../cards/store";
import { groupCardsByState } from "./aggregations";
import { STATE_BAR_STYLE, STATE_LABEL, STATE_ORDER } from "./state-colors";

export function StateBreakdown() {
	const cardsByPath = useCardStore((s) => s.cardsByPath);
	const counts = useMemo(
		() => groupCardsByState(Array.from(cardsByPath.values())),
		[cardsByPath],
	);
	const total =
		counts.new + counts.learning + counts.review + counts.relearning;

	return (
		<section className="flex flex-col gap-2">
			<header className="flex items-baseline justify-between">
				<h3 className="m-0 text-xs uppercase tracking-wide text-muted!">
					State breakdown
				</h3>
				<span className="text-xs text-muted!">
					{total} {total === 1 ? "card" : "cards"}
				</span>
			</header>

			{total === 0 ? (
				<div className="rounded border border-border bg-subtle/30 px-3 py-6 text-center text-xs text-muted!">
					No cards yet.
				</div>
			) : (
				<>
					<div className="flex h-3 w-full overflow-hidden rounded border border-border">
						{STATE_ORDER.map((k) => {
							const c = counts[k];
							if (c === 0) return null;
							return (
								<div
									key={k}
									style={{
										...STATE_BAR_STYLE[k],
										width: `${(c / total) * 100}%`,
									}}
									title={`${STATE_LABEL[k]} · ${c}`}
								/>
							);
						})}
					</div>
					<ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs">
						{STATE_ORDER.map((k) => (
							<li key={k} className="flex items-center gap-1.5">
								<span
									className="inline-block h-2 w-2 rounded-sm"
									style={STATE_BAR_STYLE[k]}
								/>
								<span className="text-muted!">{STATE_LABEL[k]}</span>
								<span className="text-fg-strong!">{counts[k]}</span>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
