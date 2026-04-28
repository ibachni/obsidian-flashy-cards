import { useCardStore } from "../cards/store";
import { usePluginContext } from "./PluginContext";

interface Props {
	active: "review" | "browse";
	variant?: "full" | "compact";
}

/**
 * Cross-view navigation between the Review and Browse panes.
 *
 * `full` variant renders a shadcn-style segmented control. Used at the
 * top of the Browse pane.
 *
 * `compact` variant renders a single text-link to the inactive view.
 * Used in the Review header where focus mode is the priority.
 *
 * When switching from Browse → Review, `clearReviewScope()` runs first
 * so a stale scope from a previous "Test this section" session doesn't
 * leak into a fresh review.
 */
export function ViewSwitcher({ active, variant = "full" }: Props) {
	const { plugin } = usePluginContext();

	const goReview = () => {
		useCardStore.getState().clearReviewScope();
		void plugin.activateView();
	};
	const goBrowse = () => {
		void plugin.activateBrowseView();
	};

	if (variant === "compact") {
		const inactive = active === "review" ? "browse" : "review";
		const label = inactive === "browse" ? "Browse →" : "Review →";
		const onClick = inactive === "browse" ? goBrowse : goReview;
		return (
			<button
				type="button"
				className="bg-transparent! border-none! shadow-none! px-0! text-xs text-muted! transition-colors hover:text-fg!"
				onClick={onClick}
			>
				{label}
			</button>
		);
	}

	return (
		<div className="inline-flex items-center gap-3">
			<SegmentButton
				label="Review"
				isActive={active === "review"}
				onClick={goReview}
			/>
			<SegmentButton
				label="Browse"
				isActive={active === "browse"}
				onClick={goBrowse}
			/>
		</div>
	);
}

function SegmentButton({
	label,
	isActive,
	onClick,
}: {
	label: string;
	isActive: boolean;
	onClick: () => void;
}) {
	// Minimalist text-link style — matches the compact variant used in
	// the Review header. Active = full ink + medium weight; inactive =
	// muted with a hover lift to fg. No bg, no border, no shadow — the
	// flatten classes cancel Obsidian's default button chrome.
	const base =
		"bg-transparent! border-none! shadow-none! px-0! text-xs transition-colors";
	const styles = isActive
		? "text-fg! font-medium! cursor-default"
		: "text-muted! hover:text-fg!";
	return (
		<button
			type="button"
			className={`${base} ${styles}`}
			aria-pressed={isActive}
			onClick={isActive ? undefined : onClick}
		>
			{label}
		</button>
	);
}
