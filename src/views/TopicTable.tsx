import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface TopicRow {
	topic: string;
	newCount: number;
	learningCount: number;
	dueCount: number;
}

interface Props {
	rows: TopicRow[];
	selected: Set<string>;
	onToggle: (topic: string) => void;
}

/**
 * Per-topic overview. Click a row to toggle its inclusion in the topic
 * filter (multi-select OR-logic across topics). Counts are passed in
 * pre-computed by BrowsePane via useMemo.
 */
export function TopicTable({ rows, selected, onToggle }: Props) {
	if (rows.length === 0) {
		return (
			<p className="text-sm text-muted">
				No topics yet — add cards under the cards root.
			</p>
		);
	}

	return (
		<div className="overflow-hidden rounded-md border border-border">
			<table className="w-full text-sm">
				<thead className="bg-subtle/50">
					<tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
						<th className="px-3 py-2 text-left font-semibold">Topic</th>
						<th className="px-3 py-2 text-right font-semibold">New</th>
						<th className="px-3 py-2 text-right font-semibold">Learning</th>
						<th className="px-3 py-2 text-right font-semibold">Due</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<TopicTr
							key={r.topic}
							row={r}
							isSelected={selected.has(r.topic)}
							onClick={() => onToggle(r.topic)}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TopicTr({
	row,
	isSelected,
	onClick,
}: {
	row: TopicRow;
	isSelected: boolean;
	onClick: () => void;
}) {
	const handleKey = (e: ReactKeyboardEvent<HTMLTableRowElement>) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onClick();
		}
	};
	const rowClass = isSelected
		? "bg-accent/10 cursor-pointer transition-colors"
		: "cursor-pointer transition-colors hover:bg-subtle";

	return (
		<tr
			role="button"
			tabIndex={0}
			aria-pressed={isSelected}
			onClick={onClick}
			onKeyDown={handleKey}
			className={rowClass}
		>
			<td className="px-3 py-2 text-sm text-fg!">{row.topic}</td>
			<td className="px-3 py-2 text-right text-sm tabular-nums text-fg!">
				{row.newCount}
			</td>
			<td className="px-3 py-2 text-right text-sm tabular-nums text-fg!">
				{row.learningCount}
			</td>
			<td className="px-3 py-2 text-right text-sm tabular-nums text-fg!">
				{row.dueCount}
			</td>
		</tr>
	);
}
