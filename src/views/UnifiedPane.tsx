import { BrowsePane } from "./BrowsePane";
import { ModeNav, type Mode } from "./ModeNav";
import { NewCardPane } from "./NewCardPane";
import { ReviewPane } from "./ReviewPane";
import { StatsPane } from "./StatsPane";

interface Props {
	mode: Mode;
	mountedModes: Set<Mode>;
	onSetMode: (mode: Mode) => void;
}

/**
 * Shell that hosts Review / Browse / Create as modes within a single
 * Obsidian view. Purely controlled: the active mode and the set of
 * already-mounted modes both live on the `LearningSystemView` so they
 * can be hydrated atomically during workspace restore, ahead of the
 * React tree's first render.
 *
 * Lazy-mount, sticky-mount: a pane mounts the first time its mode is
 * selected and then stays mounted (hidden via the `hidden` attribute
 * when inactive). Two reasons:
 *   1. CodeMirror inside `NewCardPane` would otherwise initialize with
 *      a zero-dimension parent if rendered hidden from the start, which
 *      can leave gutter/wrap math stale until the user types.
 *   2. Once mounted, the pane keeps its form/scroll/local state across
 *      mode switches — matching the pre-unification behavior where each
 *      pane lived in its own leaf and stayed mounted in the background.
 *
 * The outer wrapper carries the padding the three panes currently apply
 * individually (`px-6 pt-3 pb-6` + `gap-4`). Phase 2 already stripped
 * that wrapper from each pane so the shell owns vertical rhythm and
 * every mode starts at the same Y position.
 */
export function UnifiedPane({ mode, mountedModes, onSetMode }: Props) {
	return (
		<div className="flex flex-col gap-4 px-6 pt-3 pb-6">
			<header className="flex flex-col items-center gap-2">
				<h1 className="ls-brand m-0">Learning System</h1>
				<ModeNav active={mode} onChange={onSetMode} />
			</header>
			{mountedModes.has("review") && (
				<div hidden={mode !== "review"}>
					<ReviewPane />
				</div>
			)}
			{mountedModes.has("browse") && (
				<div hidden={mode !== "browse"}>
					<BrowsePane onSwitchToReview={() => onSetMode("review")} />
				</div>
			)}
			{mountedModes.has("create") && (
				<div hidden={mode !== "create"}>
					<NewCardPane active={mode === "create"} />
				</div>
			)}
			{mountedModes.has("stats") && (
				<div hidden={mode !== "stats"}>
					<StatsPane />
				</div>
			)}
		</div>
	);
}
