import {
	useMemo,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import type { ParsedCard } from "../cards/parser";
import { useCardStore } from "../cards/store";
import { CardRow } from "./CardRow";
import { endOfTodayDate, parseDueDate } from "./date-utils";
import { usePluginContext } from "./PluginContext";
import { TagCombobox } from "./TagCombobox";
import { TopicTable, type TopicRow } from "./TopicTable";
import { ViewSwitcher } from "./ViewSwitcher";

type StatusFilter = "all" | "new" | "learning" | "review" | "due-today";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "due-today", label: "Due today" },
	{ value: "new", label: "New" },
	{ value: "learning", label: "Learning" },
	{ value: "review", label: "Review" },
];

export function BrowsePane() {
	const { app, plugin } = usePluginContext();
	const cardsByPath = useCardStore((s) => s.cardsByPath);
	const setReviewScope = useCardStore((s) => s.setReviewScope);

	const [selectedTopics, setSelectedTopics] = useState<Set<string>>(
		new Set(),
	);
	const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
	const [status, setStatus] = useState<StatusFilter>("all");

	const cardArray = useMemo(
		() => Array.from(cardsByPath.values()),
		[cardsByPath],
	);

	const allTags = useMemo(() => {
		const set = new Set<string>();
		for (const c of cardArray) {
			for (const t of c.fm.tags) set.add(t);
		}
		return Array.from(set).sort();
	}, [cardArray]);

	const topicRows: TopicRow[] = useMemo(() => {
		const endOfToday = endOfTodayDate();
		const map = new Map<string, TopicRow>();
		for (const c of cardArray) {
			let row = map.get(c.fm.topic);
			if (!row) {
				row = {
					topic: c.fm.topic,
					newCount: 0,
					learningCount: 0,
					dueCount: 0,
				};
				map.set(c.fm.topic, row);
			}
			if (c.fm.fsrs_state === "new") row.newCount++;
			if (
				c.fm.fsrs_state === "learning" ||
				c.fm.fsrs_state === "relearning"
			) {
				row.learningCount++;
			}
			if (parseDueDate(c.fm.fsrs_due) <= endOfToday) row.dueCount++;
		}
		return Array.from(map.values()).sort((a, b) =>
			a.topic.localeCompare(b.topic),
		);
	}, [cardArray]);

	const filtered = useMemo(() => {
		const endOfToday = endOfTodayDate();

		return cardArray.filter((c) => {
			if (selectedTopics.size > 0 && !selectedTopics.has(c.fm.topic)) {
				return false;
			}
			if (
				selectedTags.size > 0 &&
				!c.fm.tags.some((t) => selectedTags.has(t))
			) {
				return false;
			}
			if (status === "due-today") {
				if (parseDueDate(c.fm.fsrs_due) > endOfToday) return false;
			} else if (status !== "all") {
				if (c.fm.fsrs_state !== status) return false;
			}
			return true;
		});
	}, [cardArray, selectedTopics, selectedTags, status]);

	const dueTodayInFiltered = useMemo(() => {
		const endOfToday = endOfTodayDate();
		return filtered.filter((c) => parseDueDate(c.fm.fsrs_due) <= endOfToday)
			.length;
	}, [filtered]);

	const filtersActive =
		selectedTopics.size > 0 || selectedTags.size > 0 || status !== "all";

	const toggleTopic = (t: string) =>
		setSelectedTopics((prev) => toggleInSet(prev, t));

	const clearAll = () => {
		setSelectedTopics(new Set());
		setSelectedTags(new Set());
		setStatus("all");
	};

	const handleRowClick = (path: string, e: ReactMouseEvent) => {
		const newPane = e.metaKey || e.ctrlKey;
		void app.workspace.openLinkText(path, "", newPane);
	};

	const startScopedReview = () => {
		if (filtered.length === 0) return;
		setReviewScope(filtered.map((c) => c.path));
		void plugin.activateView();
	};

	return (
		<div className="flex flex-col gap-4 px-6 pt-3 pb-6">
			<header className="flex items-center justify-between gap-2">
				<h2 className="text-base font-semibold">Browse</h2>
				<ViewSwitcher active="browse" variant="compact" />
			</header>

			<TopicTable
				rows={topicRows}
				selected={selectedTopics}
				onToggle={toggleTopic}
			/>

			<div className="flex flex-col gap-2">
				<TagCombobox
					allTags={allTags}
					selected={selectedTags}
					onChange={setSelectedTags}
				/>
				<select
					className="ls-flat px-2 py-1 text-sm text-fg! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
					value={status}
					onChange={(e) => setStatus(e.target.value as StatusFilter)}
				>
					{STATUS_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</div>

			{filtersActive && (
				<button
					type="button"
					className="ls-flat self-start text-xs text-muted! underline transition-colors hover:text-fg!"
					onClick={clearAll}
				>
					Clear all filters
				</button>
			)}

			{filtered.length === 0 ? (
				<p className="py-6 text-sm text-muted">
					No cards match the current filters.
				</p>
			) : (
				<ul className="m-0 flex list-none flex-col p-0">
					{filtered.map((c: ParsedCard) => (
						<CardRow key={c.path} card={c} onClick={handleRowClick} />
					))}
				</ul>
			)}

			<footer className="flex flex-wrap items-center justify-between gap-3 pt-2">
				<span className="text-xs text-muted">
					{filtered.length} {filtered.length === 1 ? "card" : "cards"} ·{" "}
					{dueTodayInFiltered} due today
				</span>
				<button
					type="button"
					disabled={filtered.length === 0}
					className="ls-btn-primary inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
					onClick={startScopedReview}
				>
					Test this section
				</button>
			</footer>
		</div>
	);
}

function toggleInSet<T>(prev: Set<T>, item: T): Set<T> {
	const next = new Set(prev);
	if (next.has(item)) next.delete(item);
	else next.add(item);
	return next;
}
