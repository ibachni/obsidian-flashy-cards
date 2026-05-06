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
}

export function CardRow({ card, onClick }: Props) {
	const slug = card.path.split("/").pop()?.replace(/\.md$/, "") ?? card.path;
	const kind = deriveStateTagKind(card);

	return (
		<li>
			<button
				type="button"
				className="ls-card-row flex w-full items-center gap-2 rounded bg-transparent! border-none! shadow-none! px-2 py-1.5 text-left text-fg! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				onClick={(e) => onClick(card.path, e)}
			>
				<span className="flex-1 truncate text-sm">{slug}</span>
				<span
					className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATE_TAG_CLS[kind]}`}
				>
					{STATE_TAG_LABEL[kind]}
				</span>
			</button>
		</li>
	);
}
