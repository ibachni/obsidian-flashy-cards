import { useEffect, useState } from "react";

import { readAll, type ReviewLogEntry } from "../../cards/review-log";
import { usePluginContext } from "../PluginContext";

export interface ReviewLogState {
	entries: ReviewLogEntry[];
	/** True before the first read returns. After that, stays false even
	 *  while a background refresh is in flight (stale-while-revalidate). */
	loading: boolean;
}

/**
 * Pane-local hook that loads the full review log on mount and refreshes
 * it whenever a card's frontmatter changes inside `cardsRoot`. The
 * `metadataCache.changed` event is our proxy for "user just graded
 * something" — gradeAndPersist rewrites `modified`, which fires it.
 *
 * Returns last-good entries while a refresh is in flight so panels
 * don't flicker their skeletons on every grade.
 */
export function useReviewLog(): ReviewLogState {
	const { app, plugin } = usePluginContext();
	const [state, setState] = useState<ReviewLogState>({
		entries: [],
		loading: true,
	});

	useEffect(() => {
		let cancelled = false;
		const root = plugin.normalizedCardsRoot();

		const load = async () => {
			const entries = await readAll(app, root);
			if (cancelled) return;
			setState({ entries, loading: false });
		};

		void load();

		const ref = app.metadataCache.on("changed", (file) => {
			if (!file.path.startsWith(root)) return;
			void load();
		});

		return () => {
			cancelled = true;
			app.metadataCache.offref(ref);
		};
	}, [app, plugin]);

	return state;
}
