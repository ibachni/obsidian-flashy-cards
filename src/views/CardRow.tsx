import type { MouseEvent as ReactMouseEvent } from "react";
import type { ParsedCard } from "../cards/parser";
import {
	deriveStateTagKind,
	STATE_TAG_CLS,
	STATE_TAG_LABEL,
} from "./state-tag";

interface Props {
	card: ParsedCard;
	onClick: (path: string, e: ReactMouseEvent) => void;
	onEdit: (card: ParsedCard) => void;
	onDelete: (card: ParsedCard) => void;
}

export function CardRow({ card, onClick, onEdit, onDelete }: Props) {
	const slug = card.path.split("/").pop()?.replace(/\.md$/, "") ?? card.path;
	const kind = deriveStateTagKind(card);

	// Row body + action icons are sibling buttons inside the <li> rather
	// than nested buttons — nesting interactive elements is invalid HTML
	// and breaks Tab focus on inner controls across browsers.
	return (
		<li className="ls-card-row flex items-stretch gap-1 rounded">
			<button
				type="button"
				className="ls-card-row-label ls-flat flex flex-1 min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-fg! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				onClick={(e) => onClick(card.path, e)}
			>
				<span className="flex-1 truncate text-sm">{slug}</span>
				<span
					className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATE_TAG_CLS[kind]}`}
				>
					{STATE_TAG_LABEL[kind]}
				</span>
			</button>
			<button
				type="button"
				aria-label={`Edit ${slug}`}
				title="Edit card"
				className="ls-flat shrink-0 inline-flex items-center justify-center rounded p-1 text-muted! hover:text-fg-strong! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				onClick={() => onEdit(card)}
			>
				<PencilIcon />
			</button>
			<button
				type="button"
				aria-label={`Delete ${slug}`}
				title="Delete card"
				className="ls-flat shrink-0 inline-flex items-center justify-center rounded p-1 text-muted! hover:text-state-overdue! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				onClick={() => onDelete(card)}
			>
				<TrashIcon />
			</button>
		</li>
	);
}

function PencilIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
			<path d="M10 11v6" />
			<path d="M14 11v6" />
			<path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
		</svg>
	);
}
