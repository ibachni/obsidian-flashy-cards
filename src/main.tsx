import {
	App,
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
	normalizePath,
	type ViewStateResult,
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import { seedClozeExample, seedDemoLog } from "./cards/demo-seed";
import { persistOcclusionGrade } from "./cards/grade-occlusion";
import { makeAppIODeps } from "./cards/occlusion-io";
import {
	fmToMaskFsrs,
	isOcclusionSibling,
	jsonPathForCard,
	resolveOcclusionJsonPath,
} from "./cards/occlusion";
import type { ParsedCard } from "./cards/parser";
import {
	applyGradeUpdate,
	applyUndoRestore,
	parseCardFile,
	scanCards,
} from "./cards/parser";
import { pickNext } from "./cards/picker";
import {
	appendGrade,
	truncateLastEntry,
	type ReviewLogEntry,
} from "./cards/review-log";
import { useCardStore } from "./cards/store";
import {
	createSlot,
	stashGrade,
	takeGrade,
	type UndoEntry,
	type UndoSlot,
} from "./cards/undo-buffer";
import type { CardFrontmatterT } from "./schema/card";
import {
	gradeWith,
	makeEngine,
	previewIntervals as enginePreviewIntervals,
	Rating,
	type FSRS,
	type Grade,
} from "./srs/fsrs-engine";
import { DeleteCardConfirm } from "./views/DeleteCardConfirm";
import { EditCardModal } from "./views/EditCardModal";
import type { Mode } from "./views/ModeNav";
import { PluginContextProvider } from "./views/PluginContext";
import { UnifiedPane } from "./views/UnifiedPane";

/**
 * Imperative handle the Review pane registers on the plugin while it's
 * the active mode. Lets the plugin's document-level keydown listener
 * call into live React state (revealed, current card) without coupling
 * the listener to the pane's component tree. Cleared on unmount.
 *
 * Same shape as `confirmClose` on the edit modal — a known-good pattern
 * in this codebase for bridging Obsidian-level events to React state.
 */
export interface ReviewActions {
	reveal: () => void;
	grade: (rating: Grade) => void;
	isRevealed: () => boolean;
	openSource: () => void;
}

export const VIEW_TYPE_LEARNING = "learning-system-view";
// String literals (not exported constants) — these refer to defunct view
// types that may still appear in a pre-migration user's workspace layout.
// Used once during onLayoutReady to detach stale leaves; see Phase 5.
const STALE_VIEW_TYPES = [
	"learning-system-browse-view",
	"learning-system-new-card-view",
] as const;

type ThemeMode = "cream" | "dark" | "system";

interface LearningSystemSettings {
	theme: ThemeMode;
	cardsRoot: string;
	fsrsRequestRetention: number;
	fsrsMaximumInterval: number;
}

const DEFAULT_SETTINGS: LearningSystemSettings = {
	theme: "cream",
	// `normalizePath` strips trailing slashes, so the canonical form
	// of the root is unsuffixed. `normalizedCardsRoot()` adds the
	// trailing slash where `startsWith` checks need it.
	cardsRoot: "Cards",
	fsrsRequestRetention: 0.9,
	fsrsMaximumInterval: 36500,
};

/**
 * Map a number-row key ("1"–"4") to an FSRS grade. Kept as a switch so
 * the call site reads as a one-liner without a Record lookup that would
 * widen the index to `string`. Caller is responsible for the key range.
 */
function keyToRating(key: string): Grade {
	switch (key) {
		case "1":
			return Rating.Again;
		case "2":
			return Rating.Hard;
		case "3":
			return Rating.Good;
		case "4":
			return Rating.Easy;
		default:
			return Rating.Good;
	}
}

function parseModeFromState(state: unknown): Mode | null {
	if (!state || typeof state !== "object") return null;
	const m = (state as { mode?: unknown }).mode;
	// Legacy "occlusion" persisted by pre-merger workspace layouts
	// re-maps to "create" — occlusion now lives as a card-type
	// inside the Create pane.
	if (m === "occlusion") return "create";
	if (m === "review" || m === "browse" || m === "create" || m === "stats") {
		return m;
	}
	return null;
}

class LearningSystemView extends ItemView {
	private root: Root | null = null;
	plugin: LearningSystemPlugin;
	// Active mode + which modes have ever been activated. Sticky-mount
	// is owned here (not in React state) so workspace restore can hydrate
	// both fields atomically before the React tree first renders.
	private mode: Mode = "browse";
	private mountedModes: Set<Mode> = new Set<Mode>(["browse"]);

	constructor(leaf: WorkspaceLeaf, plugin: LearningSystemPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LEARNING;
	}

	getDisplayText(): string {
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- product brand name
		return "Flashy Cards";
	}

	getIcon(): string {
		return "brain";
	}

	/**
	 * Persist the active mode into the leaf's workspace state. Spread
	 * `super.getState()` so we don't drop any base ItemView fields that
	 * future Obsidian versions might add.
	 */
	getState(): Record<string, unknown> {
		return { ...super.getState(), mode: this.mode };
	}

	/**
	 * Called by Obsidian during workspace restore (with the persisted
	 * `{ mode }`) and any time something programmatically updates the
	 * leaf's view state. Ordering: Obsidian may invoke this before or
	 * after `onOpen` depending on whether the leaf is being created or
	 * restored — we commit the mode either way and `renderRoot` no-ops
	 * when the React root hasn't been created yet. We await super first
	 * so a rejected base call doesn't leave our local state ahead of
	 * Obsidian's.
	 */
	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		const next = parseModeFromState(state);
		if (next && next !== this.mode) {
			this.mode = next;
			if (!this.mountedModes.has(next)) {
				this.mountedModes = new Set([...this.mountedModes, next]);
			}
		}
		this.renderRoot();
	}

	/**
	 * Public mode accessor — paired with `setMode` so callers (the
	 * plugin's document-level keydown listener) can read the active mode
	 * without reaching into a private field. Same shape as `setMode`.
	 */
	getMode(): Mode {
		return this.mode;
	}

	// Bound once so renderRoot passes a stable identity to React. Without
	// this, every renderRoot call would hand <UnifiedPane> a fresh arrow
	// and any future React.memo on ModeNav / its children would be moot.
	setMode = (mode: Mode): void => {
		if (mode === this.mode) return;
		this.mode = mode;
		if (!this.mountedModes.has(mode)) {
			this.mountedModes = new Set([...this.mountedModes, mode]);
		}
		this.renderRoot();
		// Debounced — Obsidian writes workspace.json once typing settles.
		this.app.workspace.requestSaveLayout();
	};

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("learning-system-root");
		this.contentEl.addClass("learning-system-pane");
		// Fixed-size shell for the React tree's internal scrolling.
		// Skipped on modals — they size to content.
		this.contentEl.addClass("learning-system-shell");
		// `tabIndex = -1` makes contentEl programmatically focusable
		// (no Tab-key reachability) without joining the default tab
		// order. We focus it explicitly below so pane-local shortcuts
		// like `d` work the moment the view opens, without the user
		// having to click an interactive element first.
		this.contentEl.tabIndex = -1;

		// React mounts on a child div so contentEl keeps the wrapper class
		// even if React replaces its own root. Theme variables cascade
		// from contentEl into the React subtree.
		const mountEl = this.contentEl.createDiv({ cls: "ls-app-shell" });
		this.root = createRoot(mountEl);
		this.renderRoot();

		// Pane-local keyboard bindings. Scoped to `contentEl` (not
		// `document`) so we only intercept keystrokes when focus is
		// inside the view — keystrokes typed into Obsidian's editor or
		// any other plugin's pane stay theirs. Modals append to
		// `document.body`, not into our tree, so they never bubble
		// through `contentEl` either; no modal-bail check needed.
		this.registerDomEvent(this.contentEl, "keydown", this.handleKeyDown);

		// Give the pane focus on open so keystrokes land on our handler
		// without an interim click. `preventScroll` keeps the workspace
		// from auto-scrolling on programmatic focus.
		this.contentEl.focus({ preventScroll: true });
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	private renderRoot(): void {
		if (!this.root) return;
		this.root.render(
			<PluginContextProvider
				value={{ app: this.app, plugin: this.plugin, view: this }}
			>
				<UnifiedPane
					mode={this.mode}
					mountedModes={this.mountedModes}
					onSetMode={this.setMode}
				/>
			</PluginContextProvider>,
		);
	}

	/**
	 * Pane-local keyboard dispatcher. Wired in `onOpen` against
	 * `contentEl`. Handles:
	 *   - `d` → toggle theme (any mode)
	 *   - `Space` / `Enter` → reveal (Review only)
	 *   - `1`–`4` → grade (Review only, once revealed)
	 *   - `e` → open the active card's source file (Review only)
	 *   - `u` → undo the last grade (Review only)
	 *
	 * Bound as a field arrow so `this` stays the view when handed to
	 * `registerDomEvent`.
	 */
	private handleKeyDown = (e: KeyboardEvent): void => {
		// Don't steal keys from inputs / textareas / contentEditable
		// inside the pane (tag filter, embedded editor, etc.).
		const target = e.target as HTMLElement | null;
		if (
			target instanceof HTMLElement &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable)
		) {
			return;
		}

		if (
			e.key === "d" &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!e.shiftKey
		) {
			e.preventDefault();
			this.plugin.toggleTheme();
			return;
		}

		// Review-mode-only keys below. Bail out for other modes so e.g.
		// pressing `1` in Browse / Create / Stats stays inert.
		if (this.mode !== "review") return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;

		const actions = this.plugin.reviewActions;
		if (!actions) return;

		switch (e.key) {
			case " ":
			case "Enter":
				if (!actions.isRevealed()) {
					// preventDefault keeps Space from scrolling the pane
					// and Enter from activating the currently-focused button.
					e.preventDefault();
					actions.reveal();
				}
				break;
			case "1":
			case "2":
			case "3":
			case "4":
				if (actions.isRevealed()) {
					e.preventDefault();
					actions.grade(keyToRating(e.key));
				}
				break;
			case "e":
				e.preventDefault();
				actions.openSource();
				break;
			case "u":
				e.preventDefault();
				void this.plugin.undoLastGrade();
				break;
		}
	};
}

class LearningSystemSettingTab extends PluginSettingTab {
	plugin: LearningSystemPlugin;
	// Per-tab rescan debounce: validation feedback stays live (cheap),
	// but the vault-wide scan only fires after the user pauses typing.
	// Without this, every transient-valid prefix triggered a full scan.
	private cardsRootRescanTimer: number | undefined;

	constructor(app: App, plugin: LearningSystemPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		if (this.cardsRootRescanTimer !== undefined) {
			window.clearTimeout(this.cardsRootRescanTimer);
			this.cardsRootRescanTimer = undefined;
		}
	}

	private validateCardsRoot(value: string, errorEl: HTMLElement): boolean {
		const trimmed = value.trim();
		if (!trimmed) {
			errorEl.setText("Cards root is required.");
			return false;
		}
		// `normalizePath` strips trailing slashes, collapses `//`, flips
		// backslashes — same canonical form used everywhere we resolve
		// paths against this root.
		const normalized = normalizePath(trimmed);
		const file = this.plugin.app.vault.getAbstractFileByPath(normalized);
		if (!(file instanceof TFolder)) {
			errorEl.setText(`Folder not found: ${normalized}`);
			return false;
		}
		// Empty text + .ls-setting-error:empty CSS rule hides the element.
		errorEl.setText("");
		return true;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Cards").setHeading();

		const cardsRootSetting = new Setting(containerEl)
			.setName("Cards root")
			.setDesc(
				"Vault folder under which all flashcards live. Subfolders become topics.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Cards/")
					.setValue(this.plugin.settings.cardsRoot)
					.onChange((value) => {
						// Live validation: cheap, fires every keystroke.
						const ok = this.validateCardsRoot(value, cardsRootError);
						// Persist + rescan only after the user pauses typing
						// AND only when the path resolves — avoids storing a
						// half-typed path in data.json and stops a full vault
						// scan from running on every keystroke that lands on
						// a transiently-valid prefix.
						if (this.cardsRootRescanTimer !== undefined) {
							window.clearTimeout(this.cardsRootRescanTimer);
						}
						this.cardsRootRescanTimer = window.setTimeout(() => {
							this.cardsRootRescanTimer = undefined;
							if (!ok) return;
							this.plugin.settings.cardsRoot = normalizePath(value.trim());
							void this.plugin.saveSettings();
							void this.plugin.scanAndStoreCards();
						}, 300);
					}),
			);
		// Stack name+desc on top, full-width input below — paths are long
		// and the default right-aligned input clips them.
		cardsRootSetting.settingEl.addClass("ls-wide-input");

		// Inline validation: shows "Folder not found: …" while the path
		// doesn't resolve. Hidden when the path is a real folder; in that
		// case the rescan above runs.
		const cardsRootError = containerEl.createDiv({ cls: "ls-setting-error" });
		this.validateCardsRoot(this.plugin.settings.cardsRoot, cardsRootError);

		new Setting(containerEl).setName("Appearance").setHeading();

		new Setting(containerEl)
			.setName("Theme")
			.setDesc("Cream, dark, or follow Obsidian's setting.")
			.addDropdown((dd) =>
				dd
					.addOption("cream", "Cream")
					.addOption("dark", "Dark")
					.addOption("system", "Match Obsidian")
					.setValue(this.plugin.settings.theme)
					.onChange(async (value) => {
						this.plugin.settings.theme = value as ThemeMode;
						await this.plugin.saveSettings();
						this.plugin.applyTheme();
					}),
			);

		new Setting(containerEl).setName("FSRS").setHeading();

		new Setting(containerEl)
			.setName("Request retention")
			.setDesc(
				"Target probability of recalling a card correctly. Higher = more frequent reviews. Default 0.9.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(0.7, 0.99, 0.01)
					.setValue(this.plugin.settings.fsrsRequestRetention)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fsrsRequestRetention = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildEngine();
					}),
			);

		new Setting(containerEl)
			.setName("Maximum interval")
			.setDesc("Cap on days between reviews. Default 36500 (~100 years).")
			.addText((text) =>
				text
					.setPlaceholder("36500")
					.setValue(String(this.plugin.settings.fsrsMaximumInterval))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!Number.isNaN(n) && n > 0) {
							this.plugin.settings.fsrsMaximumInterval = n;
							await this.plugin.saveSettings();
							this.plugin.rebuildEngine();
						}
					}),
			);
	}
}

/**
 * Modal host for the edit-card form. Mounts a React root inside the
 * modal's `contentEl`, scoped with `learning-system-root` +
 * `learning-system-pane` so theme variables cascade and the
 * `closest(".learning-system-root")` walk used by TagCombobox /
 * TopicCombobox resolves correctly.
 *
 * The modal is the dismissal surface: `onSaved` / `onCancel` both call
 * `this.close()`. Form state lives inside React and is discarded on
 * close — dirty-confirm runs *inside* React (Cancel button / Esc), not
 * here. (Obsidian's default Esc-to-close is fine: an Esc that escapes
 * React lands here, and there's nothing to confirm because either the
 * form was clean or the user already saw the confirm dialog.)
 */
class LearningSystemEditCardModal extends Modal {
	private root: Root | null = null;
	private readonly plugin: LearningSystemPlugin;
	private readonly card: ParsedCard;
	// Predicate set by the React form — returns false to veto a close
	// (Esc / outside-click / Cancel). Defaults to "always allow" so the
	// modal stays closable if React hasn't registered yet.
	private confirmClose: () => boolean = () => true;

	constructor(plugin: LearningSystemPlugin, card: ParsedCard) {
		super(plugin.app);
		this.plugin = plugin;
		this.card = card;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		// Paint the entire modal box (not just the inner content) with our
		// theme variables and surface color. Otherwise Obsidian's default
		// `.modal` background bleeds around the cream content as a halo —
		// the "outer ring different color than inner" complaint.
		// `learning-system-root` + `dark` go on modalEl alone; contentEl
		// inherits the variables via the cascade and only needs the pane
		// class (which carries the `min-height: 100%` rule that we don't
		// want on the modal box itself).
		modalEl.addClass("learning-system-root");
		modalEl.addClass("ls-modal-surface");
		contentEl.addClass("learning-system-pane");
		// Apply current theme — Obsidian's Modal sits outside the
		// LearningSystemView's contentEl, so applyTheme()'s loop misses it.
		const isDark =
			this.plugin.settings.theme === "dark" ||
			(this.plugin.settings.theme === "system" &&
				document.body.classList.contains("theme-dark"));
		modalEl.toggleClass("dark", isDark);

		const mountEl = contentEl.createDiv();
		this.root = createRoot(mountEl);
		this.root.render(
			<PluginContextProvider
				value={{
					app: this.app,
					plugin: this.plugin,
					// PluginContext expects a Component; Modal isn't one. The
					// plugin is a long-lived Component and `ctx.view` is
					// currently only used as a parent for any future
					// MarkdownRenderer call — fine for the modal's lifetime.
					view: this.plugin,
				}}
			>
				<EditCardModal
					card={this.card}
					onSaved={() => this.forceClose()}
					onCancel={() => this.close()}
					registerConfirmClose={(fn) => {
						this.confirmClose = fn;
					}}
					forceClose={() => this.forceClose()}
				/>
			</PluginContextProvider>,
		);
	}

	/**
	 * Obsidian's default Esc / outside-click both route through `close()`,
	 * so this is the chokepoint where the dirty-confirm has to live.
	 * `onSaved` calls `forceClose()` to bypass the predicate after a
	 * successful write.
	 */
	close(): void {
		if (!this.confirmClose()) return;
		super.close();
	}

	private forceClose(): void {
		this.confirmClose = () => true;
		super.close();
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

/**
 * Modal host for the delete confirmation. Same scoping (theme classes +
 * React root) as the edit modal, but simpler: there's no form state to
 * preserve, so Esc / outside-click can close freely.
 */
class LearningSystemDeleteCardConfirm extends Modal {
	private root: Root | null = null;
	private readonly plugin: LearningSystemPlugin;
	private readonly card: ParsedCard;
	private readonly onAfterDelete?: () => void;

	constructor(
		plugin: LearningSystemPlugin,
		card: ParsedCard,
		onAfterDelete?: () => void,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.card = card;
		this.onAfterDelete = onAfterDelete;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("learning-system-root");
		modalEl.addClass("ls-modal-surface");
		contentEl.addClass("learning-system-pane");
		const isDark =
			this.plugin.settings.theme === "dark" ||
			(this.plugin.settings.theme === "system" &&
				document.body.classList.contains("theme-dark"));
		modalEl.toggleClass("dark", isDark);

		const mountEl = contentEl.createDiv();
		this.root = createRoot(mountEl);
		this.root.render(
			<PluginContextProvider
				value={{
					app: this.app,
					plugin: this.plugin,
					view: this.plugin,
				}}
			>
				<DeleteCardConfirm
					card={this.card}
					onAfterDelete={this.onAfterDelete}
					onClosed={() => this.close()}
				/>
			</PluginContextProvider>,
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

export default class LearningSystemPlugin extends Plugin {
	settings: LearningSystemSettings = DEFAULT_SETTINGS;
	private fsrsEngine: FSRS = makeEngine();
	// One-slot in-memory undo buffer. Populated by gradeAndPersist after a
	// successful FSRS write; consumed by undoLastGrade. Cleared after a
	// successful undo. Lives on the plugin so it survives Review-pane
	// re-mounts (sticky-mount keeps the pane around, but a future
	// remount-on-mode-switch shouldn't drop the buffer).
	undoSlot: UndoSlot = createSlot();
	// Subscribers re-render when the slot toggles between filled/empty.
	// Field lives here in Phase 2 (with firing wired in); Phase 3's
	// Review-pane footer is the first subscriber. Set rather than array
	// so duplicate subscribe is a no-op and unsubscribe is O(1).
	undoSlotListeners: Set<() => void> = new Set();
	// Set by ReviewPane's useEffect while it's the active mode; cleared
	// on unmount. The keydown listener checks this before dispatching —
	// `null` means the pane hasn't registered (e.g. on Browse) and the
	// keydown is a no-op for keys that need pane state.
	reviewActions: ReviewActions | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.rebuildEngine();

		this.registerView(
			VIEW_TYPE_LEARNING,
			(leaf) => new LearningSystemView(leaf, this),
		);

		// eslint-disable-next-line obsidianmd/ui/sentence-case -- product brand name
		this.addRibbonIcon("brain", "Flashy Cards", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open",
			name: "Open",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "open-review",
			name: "Open review",
			callback: () => void this.activateView({ mode: "review" }),
		});

		// Stable ID retained per AGENTS.md ("Use stable command IDs"). Name
		// trimmed since "Browse view" no longer means a separate view —
		// it's now a mode of the unified pane.
		this.addCommand({
			id: "open-browse",
			name: "Open browse",
			callback: () => void this.activateView({ mode: "browse" }),
		});

		this.addCommand({
			id: "new-card",
			name: "New card",
			callback: () => void this.activateView({ mode: "create" }),
		});

		this.addCommand({
			id: "open-stats",
			name: "Open stats",
			callback: () => void this.activateView({ mode: "stats" }),
		});

		// Dev-only seeder for the review log so the Stats pane has data
		// to render on a fresh install. Writes ~1000 fake grade entries
		// to `<cardsRoot>/.learning-system/history/`. Delete that
		// directory to clean up.
		this.addCommand({
			id: "seed-demo-log",
			name: "Seed demo review log (dev)",
			callback: () => {
				void this.runSeedDemoLog();
			},
		});

		// Writes one working 3-sibling cloze card to <cardsRoot>/cloze-example.md
		// so a fresh install can see the cloze format end-to-end. Skips
		// if the file already exists; delete it manually to re-seed.
		this.addCommand({
			id: "seed-cloze-example",
			name: "Seed cloze example card (dev)",
			callback: () => {
				void this.runSeedClozeExample();
			},
		});

		this.addCommand({
			id: "toggle-theme",
			name: "Toggle theme (cream / dark)",
			callback: () => this.toggleTheme(),
		});

		// Hidden when no card is due (checkCallback returns false) so the
		// palette doesn't show an action with no target. Same "current
		// card" notion the Review pane uses — pickNext over the store
		// with the active review scope.
		this.addCommand({
			id: "edit-current-card",
			name: "Edit current card",
			checkCallback: (checking) => {
				const state = useCardStore.getState();
				const cards = Array.from(state.cardsById.values());
				const card = pickNext(cards, new Date(), state.reviewScope);
				if (!card) return false;
				if (!checking) this.openEditCardModal(card);
				return true;
			},
		});

		// Same "current card" notion as edit-current-card — pickNext over
		// the store with the active review scope. Hidden when no card is
		// due so the palette doesn't surface a destructive action with
		// no target.
		this.addCommand({
			id: "delete-current-card",
			name: "Delete current card",
			checkCallback: (checking) => {
				const state = useCardStore.getState();
				const cards = Array.from(state.cardsById.values());
				const card = pickNext(cards, new Date(), state.reviewScope);
				if (!card) return false;
				if (!checking) this.openDeleteCardConfirm(card);
				return true;
			},
		});

		// Keyboard shortcuts (theme toggle, review-mode reveal/grade/
		// undo/open-source) live on the view itself — see
		// `LearningSystemView.handleKeyDown`. Scoping there means
		// keystrokes typed into Obsidian's editor or any other plugin's
		// pane never reach our handler.

		// Grade-via-command-palette commands. Kept after M5 since they're
		// keyboard-accessible alternatives to the UI buttons.
		this.addCommand({
			id: "grade-next-again",
			name: "Grade again",
			callback: () => void this.gradeNextDue(Rating.Again),
		});
		this.addCommand({
			id: "grade-next-hard",
			name: "Grade hard",
			callback: () => void this.gradeNextDue(Rating.Hard),
		});
		this.addCommand({
			id: "grade-next-good",
			name: "Grade good",
			callback: () => void this.gradeNextDue(Rating.Good),
		});
		this.addCommand({
			id: "grade-next-easy",
			name: "Grade easy",
			callback: () => void this.gradeNextDue(Rating.Easy),
		});

		// Hidden when the undo slot is empty so the palette doesn't
		// surface an action with no target. checkCallback reads the slot
		// directly — no listener plumbing needed for the palette.
		this.addCommand({
			id: "undo-last-grade",
			name: "Undo last grade",
			checkCallback: (checking) => {
				if (this.undoSlot.entry === null) return false;
				if (!checking) void this.undoLastGrade();
				return true;
			},
		});

		this.addSettingTab(new LearningSystemSettingTab(this.app, this));

		// Defer applyTheme + initial card scan until the workspace has
		// restored its leaves and the metadata cache has populated.
		// onLayoutReady fires immediately if layout is already ready, so
		// this also covers the toggle-off-then-on case.
		//
		// Also clean up leaves of the two pre-unification view types that
		// may still be persisted in an existing user's workspace layout.
		// We unregister those view types in this build, so without a
		// detach pass Obsidian would render "No view of type X"
		// placeholders. One-shot, idempotent, silent — no Notice.
		this.app.workspace.onLayoutReady(() => {
			for (const stale of STALE_VIEW_TYPES) {
				for (const leaf of this.app.workspace.getLeavesOfType(stale)) {
					// Defensive: a throw on one leaf shouldn't strand the
					// rest. `detach()` is not documented to throw, but a
					// future Obsidian change shouldn't be able to half-
					// migrate the user's workspace.
					try {
						leaf.detach();
					} catch (e) {
						console.error(
							`[learning-system] failed to detach stale leaf (${stale}):`,
							e,
						);
					}
				}
			}
			this.applyTheme();
			void this.scanAndStoreCards();
		});

		// In `system` theme mode, follow Obsidian's theme-dark/-light
		// class on <body>. Without this observer the plugin pane only
		// re-resolves on view (re)open, so toggling Obsidian's theme
		// while a Learning pane is open leaves the pane on the stale
		// theme. attributeFilter limits the observer to class changes.
		const themeObserver = new MutationObserver(() => {
			if (this.settings.theme === "system") this.applyTheme();
		});
		themeObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});
		this.register(() => themeObserver.disconnect());

		// Re-validate a card whenever its frontmatter or body changes.
		// metadataCache.on("changed") fires after Obsidian has re-parsed
		// the frontmatter — safer than vault.on("modify"), which can race
		// the cache update.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.extension !== "md") return;
				if (!file.path.startsWith(this.normalizedCardsRoot())) return;
				void this.refreshCard(file);
			}),
		);

		// Drop the old path on rename and re-parse if the new path is inside
		// cards_root. Covers slug fixes, moves between topic folders, and
		// moves into/out of the cards root.
		//
		// Defer refreshCard with setTimeout(0): Obsidian fires the rename
		// event synchronously during the rename, and the metadata cache
		// may not be fully re-keyed to the new path yet when the handler
		// runs. Yielding one tick lets the cache settle before we read it.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				console.debug(
					`[learning-system] rename: ${oldPath} → ${file.path}`,
				);
				useCardStore.getState().removeCard(oldPath);
				// Occlusion pairing: if there was a `.occlusion.json` next
				// to the old `.md`, move it alongside. Best-effort and
				// silent — a `.md` rename on a non-occlusion card finds no
				// paired JSON and exits cleanly. Runs fire-and-forget so
				// the rename event handler stays synchronous.
				void this.moveOcclusionSidecarIfPaired(oldPath, file.path);
				if (file.path.startsWith(this.normalizedCardsRoot())) {
					window.setTimeout(() => {
						void this.refreshCard(file);
					}, 0);
				}
			}),
		);

		// Drop deleted files from the store regardless of where they lived —
		// removeCard is a no-op if the path wasn't tracked.
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!(file instanceof TFile)) return;
				useCardStore.getState().removeCard(file.path);
				// Occlusion pairing: trash the JSON sidecar when the `.md`
				// is deleted. Fire-and-forget; silent no-op if no JSON
				// exists. Skipped when the deleted file is itself the
				// JSON (avoids a recursive-trash on the partner).
				if (file.extension === "md") {
					void this.trashOcclusionSidecarIfPaired(file.path);
				}
			}),
		);
	}

	onunload(): void {
		// No-op — registerView() handles leaf cleanup on plugin unload.
		// Manually calling detachLeavesOfType here is the older pattern and
		// can interfere with Obsidian's workspace restore.
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<LearningSystemSettings> | null;
		const merged = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
		// Pick only known keys. Spread copies anything in `data` into
		// `this.settings`, and saveData re-persists it — so legacy/dead
		// keys (e.g. an old snake_case field) would otherwise stick
		// around in data.json forever.
		this.settings = {
			theme: merged.theme,
			// `normalizePath` here is the canonical entry point: every
			// other call site composes paths against `settings.cardsRoot`,
			// so if we normalize once on load there's no chance of a stray
			// leading slash / trailing slash / backslash slipping into
			// constructed paths downstream.
			cardsRoot: normalizePath(merged.cardsRoot),
			fsrsRequestRetention: merged.fsrsRequestRetention,
			fsrsMaximumInterval: merged.fsrsMaximumInterval,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	rebuildEngine(): void {
		this.fsrsEngine = makeEngine({
			request_retention: this.settings.fsrsRequestRetention,
			maximum_interval: this.settings.fsrsMaximumInterval,
		});
	}

	/**
	 * Pure-read projection of next-due dates per rating. Used by the
	 * Review pane to render the small interval line under each grade
	 * button. Wraps the engine so views never reach for `fsrsEngine`
	 * directly — keeps engine reconstruction (rebuildEngine on settings
	 * change) transparent to consumers.
	 */
	previewIntervals(
		fm: CardFrontmatterT,
		now: Date = new Date(),
	): Record<Grade, Date> {
		return enginePreviewIntervals(this.fsrsEngine, fm, now);
	}

	applyTheme(): void {
		const isDark =
			this.settings.theme === "dark" ||
			(this.settings.theme === "system" &&
				document.body.classList.contains("theme-dark"));

		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LEARNING)) {
			if (leaf.view instanceof ItemView) {
				leaf.view.contentEl.toggleClass("dark", isDark);
			}
		}
	}

	/**
	 * Flip cream ↔ dark. If the current setting is "system", we resolve
	 * what's *currently* shown and flip away from that — pressing `d`
	 * always changes what the user sees, never silently no-ops.
	 *
	 * Sync apply, async persist. Earlier we awaited saveSettings before
	 * applyTheme — if the persistence promise stalled or rejected, the
	 * class flip never landed and the toggle appeared broken on the
	 * second press. The visual change must not depend on disk I/O.
	 */
	toggleTheme(): void {
		let next: ThemeMode;
		if (this.settings.theme === "cream") {
			next = "dark";
		} else if (this.settings.theme === "dark") {
			next = "cream";
		} else {
			const isDark = document.body.classList.contains("theme-dark");
			next = isDark ? "cream" : "dark";
		}
		this.settings.theme = next;
		this.applyTheme();
		void this.saveSettings();
	}

	/**
	 * Open or reveal the unified Learning System leaf. When `mode` is
	 * provided:
	 *   - If a leaf already exists, switch its mode via `setMode` after
	 *     revealing.
	 *   - If creating a new leaf, seed the initial view state with the
	 *     mode so `setState` lands on the requested mode before the
	 *     React tree first renders (no Browse → target-mode flash).
	 *
	 * No-mode calls (e.g. the brain ribbon) preserve the leaf's
	 * persisted mode, or default to Browse on first-ever open.
	 */
	async activateView(options?: { mode?: Mode }): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_LEARNING)[0];

		if (existing) {
			void workspace.revealLeaf(existing);
			if (existing.view instanceof LearningSystemView) {
				if (options?.mode) {
					existing.view.setMode(options.mode);
				}
				// Refocus the contentEl so pane-local shortcuts work
				// right after a ribbon-click / command-palette open
				// without forcing a click into the pane first. `onOpen`
				// only fires on initial leaf creation; this branch
				// covers every subsequent activation.
				existing.view.contentEl.focus({ preventScroll: true });
			}
			this.applyTheme();
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({
			type: VIEW_TYPE_LEARNING,
			active: true,
			state: options?.mode ? { mode: options.mode } : undefined,
		});
		void workspace.revealLeaf(leaf);
		this.applyTheme();
	}

	/**
	 * Cards-root path with a guaranteed trailing slash, used by the
	 * many `path.startsWith(root)` checks. `settings.cardsRoot` is
	 * already `normalizePath`-clean (stored that way by `loadSettings`),
	 * so the only work this does is append `/`.
	 */
	normalizedCardsRoot(): string {
		const r = this.settings.cardsRoot;
		return r.endsWith("/") ? r : r + "/";
	}

	openEditCardModal(card: ParsedCard): void {
		// Occlusion siblings route to Create mode pre-loaded with the
		// set's JSON. NewCardPane subscribes to
		// `useCardStore.editingOcclusionPath`, flips its internal
		// "Card type" selector to "occlusion", and triggers the load.
		// The mode flip happens in the same activation so the pane
		// mounts (or re-renders) already aimed at the right card.
		if (card.maskIndex !== undefined) {
			useCardStore.getState().setEditingOcclusionPath(card.path);
			void this.activateView({ mode: "create" });
			return;
		}
		new LearningSystemEditCardModal(this, card).open();
	}

	openDeleteCardConfirm(card: ParsedCard, onAfterDelete?: () => void): void {
		new LearningSystemDeleteCardConfirm(this, card, onAfterDelete).open();
	}

	private async runSeedDemoLog(): Promise<void> {
		try {
			const count = await seedDemoLog(this.app, this.normalizedCardsRoot());
			// Sidecar .jsonl writes don't fire metadataCache.changed (only
			// markdown frontmatter changes do), and StatsPane is sticky-
			// mounted so mode-switching doesn't re-mount the React tree.
			// The only ways to refresh: grade a card or close/reopen the
			// leaf. Spelling that out so the user isn't confused when the
			// pane stays empty.
			new Notice(
				`Seeded ${count} demo log entries. Grade any card or reopen the Flashy Cards leaf to refresh Stats.`,
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] seed-demo-log failed:", e);
			new Notice(`Seed failed: ${msg}`);
		}
	}

	private async runSeedClozeExample(): Promise<void> {
		try {
			const path = await seedClozeExample(
				this.app,
				this.normalizedCardsRoot(),
			);
			// Notice ownership lives here (not inside the seeder) so the
			// success and skip paths share one call site — same pattern
			// as runSeedDemoLog.
			if (path === null) {
				new Notice(
					"Cloze example already exists. Delete it manually to re-seed.",
				);
			} else {
				new Notice(`Created cloze example at ${path}`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] seed-cloze-example failed:", e);
			new Notice(`Seed failed: ${msg}`);
		}
	}

	async scanAndStoreCards(): Promise<void> {
		const result = await scanCards(this.app, this.settings.cardsRoot);
		const store = useCardStore.getState();
		store.clear();
		for (const card of result.parsed) {
			store.setCard(card);
		}
		for (const inv of result.invalid) {
			store.setInvalid(inv.path, inv.error);
		}
		const total = result.parsed.length + result.invalid.length;
		console.debug(
			`[learning-system] loaded ${total} cards (${result.parsed.length} valid, ${result.invalid.length} invalid)`,
		);
		for (const inv of result.invalid) {
			console.error(
				`[learning-system] invalid card: ${inv.path} — ${inv.error}`,
			);
		}
	}

	/**
	 * Run the FSRS computation, write the new state to the card's
	 * frontmatter, and bump `modified`. Used by both the Review pane
	 * (M5 UI) and the grade-next-* commands.
	 *
	 * Branches on `card.clozeIndex`: non-cloze cards write flat
	 * `fsrs_*` scalars (today's path); cloze siblings write to
	 * `fsrs_clozes[String(clozeIndex)]` so per-sibling FSRS state stays
	 * independent. The in-memory `card.fm` is the projected flat view
	 * either way, so `gradeWith` doesn't need to care about the form.
	 */
	async gradeAndPersist(card: ParsedCard, rating: Grade): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (!(file instanceof TFile)) {
			new Notice(`Card file missing: ${card.path}`);
			return;
		}

		const now = new Date();
		// Snapshot the pre-grade state before processFrontMatter mutates
		// the on-disk frontmatter — the log entry needs to record where
		// the card was *coming from*, not where it ends up.
		const prevState = card.fm.fsrs_state;
		// structuredClone so future schema additions flow through without
		// revisiting; the snapshot must be a deep copy because the FSRS
		// update mutates fm in place via processFrontMatter.
		const previousFmSnapshot = structuredClone(card.fm);
		const update = gradeWith(this.fsrsEngine, card.fm, rating, now);

		const modified = now.toISOString().slice(0, 10);

		if (isOcclusionSibling(card)) {
			// Occlusion sibling: per-mask FSRS lives in the JSON sidecar.
			// The grade routes through the per-JSON write queue so
			// concurrent grades on different siblings of the same set
			// serialize. The markdown file gets a `modified` bump only.
			const jsonPath = resolveOcclusionJsonPath(
				card.path,
				card.fm.occlusion_source ?? "",
			);
			await persistOcclusionGrade(
				makeAppIODeps(this.app),
				jsonPath,
				card.maskIndex!,
				update,
			);
			await this.app.fileManager.processFrontMatter(file, (raw) => {
				(raw as Record<string, unknown>).modified = modified;
			});
		} else {
			// processFrontMatter's callback receives `any`. The mutation
			// logic is extracted into `applyGradeUpdate` so the cloze vs.
			// non-cloze branch is unit-testable without an App mock.
			await this.app.fileManager.processFrontMatter(file, (raw) => {
				applyGradeUpdate(
					raw as Record<string, unknown>,
					card,
					update,
					modified,
				);
			});
		}

		// Stash for undo only after the FSRS write succeeded — a failed
		// processFrontMatter must not leave a snapshot that would roll
		// back a grade that never landed. `maskIndex` is undefined for
		// non-occlusion cards; the undo path branches on it.
		stashGrade(this.undoSlot, {
			cardId: card.id,
			path: card.path,
			clozeIndex: card.clozeIndex,
			maskIndex: card.maskIndex,
			previousFm: previousFmSnapshot,
			logDate: modified,
		});
		this.notifyUndoSlotChanged();

		// Optimistic store update: processFrontMatter persists, but the
		// metadataCache "changed" event that refreshes the Zustand store
		// can land a tick later. Without this push, pickNext re-renders
		// the just-graded card briefly with its old fsrs_due. The cache
		// event arrives later and reconciles.
		const updatedFm: CardFrontmatterT = { ...card.fm, ...update, modified };
		useCardStore.getState().setCard({ ...card, fm: updatedFm });

		// Append to the sidecar log. Best-effort — a failed log write
		// must never block or surface to the user; the grade already
		// landed in frontmatter.
		try {
			const entry: ReviewLogEntry = {
				// Use card.id so cloze siblings get per-sibling history
				// rows (e.g. `vocab/hablar.md#c2`). Non-cloze cards have
				// id === path so this is a no-op for them.
				path: card.id,
				topic: card.fm.topic,
				date: modified,
				grade: rating as ReviewLogEntry["grade"],
				interval: update.fsrs_scheduled_days,
				prevState,
			};
			await appendGrade(this.app, this.normalizedCardsRoot(), entry);
		} catch (e) {
			console.error("[learning-system] review-log append failed:", e);
		}
	}

	/**
	 * Fire every undo-slot listener. Listeners are invoked synchronously;
	 * a throw from one shouldn't strand the rest, so each is wrapped.
	 */
	private notifyUndoSlotChanged(): void {
		for (const fn of this.undoSlotListeners) {
			try {
				fn();
			} catch (e) {
				console.error("[learning-system] undoSlot listener threw:", e);
			}
		}
	}

	/**
	 * Roll the last grade back: restore the card's pre-grade frontmatter,
	 * push the rollback into the Zustand store, and truncate the matching
	 * log entry so Stats stays consistent. Best-effort log truncation —
	 * an unrelated last line aborts the truncate but the FM restore still
	 * runs. The slot is cleared regardless of which branch returns, so a
	 * second `u` is always a no-op.
	 */
	async undoLastGrade(): Promise<void> {
		const entry: UndoEntry | null = takeGrade(this.undoSlot);
		if (!entry) {
			new Notice("Nothing to undo");
			return;
		}
		// Slot just toggled filled → empty; notify before any await so
		// the footer re-renders immediately. A subscriber's handler
		// must be cheap (a setState/forceUpdate) — anything heavier is
		// the subscriber's bug, not ours.
		this.notifyUndoSlotChanged();

		const file = this.app.vault.getAbstractFileByPath(entry.path);
		if (!(file instanceof TFile)) {
			new Notice("Card no longer exists; cannot undo");
			// Still truncate the log so Stats doesn't drift — the user
			// removed the card but the grade entry shouldn't outlive it.
			try {
				await truncateLastEntry(
					this.app,
					this.normalizedCardsRoot(),
					// `cardId` (compound for cloze siblings) matches the log
					// entry's `path` field — see ReviewLogEntry doc-comment.
					{ path: entry.cardId, date: entry.logDate },
				);
			} catch (e) {
				console.error("[learning-system] undo log truncation failed:", e);
			}
			return;
		}

		try {
			if (entry.maskIndex !== undefined) {
				// Occlusion sibling: roll back the mask's FSRS slot in
				// the JSON sidecar via the same write queue the grade
				// write used. Project the snapshot's flat fsrs_* fields
				// into the mask block via fmToMaskFsrs (same field
				// names — structural conversion).
				const jsonPath = resolveOcclusionJsonPath(
					entry.path,
					entry.previousFm.occlusion_source ?? "",
				);
				await persistOcclusionGrade(
					makeAppIODeps(this.app),
					jsonPath,
					entry.maskIndex,
					fmToMaskFsrs(entry.previousFm),
				);
				// Also restore the markdown's `modified` field — round-trip
				// symmetry with gradeAndPersist, which bumped it forward.
				await this.app.fileManager.processFrontMatter(file, (raw) => {
					(raw as Record<string, unknown>).modified =
						entry.previousFm.modified;
				});
			} else {
				await this.app.fileManager.processFrontMatter(file, (raw) => {
					applyUndoRestore(raw as Record<string, unknown>, entry);
				});
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] undo frontmatter restore failed:", e);
			new Notice(`Undo failed: ${msg}`);
			return;
		}

		// Optimistic store update — same reasoning as gradeAndPersist:
		// metadataCache.changed lands a tick later, and without this push
		// pickNext briefly re-renders the post-grade state. Look up by
		// cardId (not path) so the right sibling is restored.
		const current = useCardStore.getState().cardsById.get(entry.cardId);
		if (current) {
			useCardStore
				.getState()
				.setCard({ ...current, fm: entry.previousFm });
		}

		// Best-effort log truncation. Mismatch / missing-file return
		// `false` and stay silent (truncateLastEntry already console.warn's
		// on mismatch) — same trade-off as the multi-device sync race.
		// Thrown errors are different: surface a Notice so the user knows
		// Stats may be one entry stale.
		try {
			await truncateLastEntry(
				this.app,
				this.normalizedCardsRoot(),
				// `cardId` (compound for cloze siblings) matches the log
				// entry's `path` field — see ReviewLogEntry doc-comment.
				{ path: entry.cardId, date: entry.logDate },
			);
		} catch (e) {
			console.error("[learning-system] undo log truncation failed:", e);
			new Notice("Undo applied; log rollback failed");
		}

		const slug = entry.path.split("/").pop() ?? entry.path;
		new Notice(`Undo: ${slug}`);
	}

	async gradeNextDue(rating: Grade): Promise<void> {
		try {
			const cards = Array.from(useCardStore.getState().cardsById.values());
			const card = pickNext(cards);
			if (!card) {
				new Notice("No cards due.");
				return;
			}

			await this.gradeAndPersist(card, rating);

			const slug = card.path.split("/").pop() ?? card.path;
			const verdict = Rating[rating];
			new Notice(`${slug} · ${verdict}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] grade failed:", e);
			new Notice(`Grade failed: ${msg}`);
		}
	}

	/**
	 * If a `.occlusion.json` sidecar paired the old `.md` path, rename
	 * it to sit next to the new `.md` path. Silent no-op when no JSON
	 * is paired (non-occlusion cards, or one half of the pair already
	 * missing).
	 *
	 * The convention `<slug>.md` ↔ `<slug>.occlusion.json` means the
	 * new sidecar path is derivable from the new `.md` path — no need
	 * to read the card's frontmatter at the rename moment.
	 */
	async moveOcclusionSidecarIfPaired(
		oldMdPath: string,
		newMdPath: string,
	): Promise<void> {
		try {
			const oldJson = jsonPathForCard(oldMdPath);
			const jsonFile = this.app.vault.getAbstractFileByPath(oldJson);
			if (!(jsonFile instanceof TFile)) return; // no paired sidecar
			const newJson = jsonPathForCard(newMdPath);
			await this.app.fileManager.renameFile(jsonFile, newJson);
		} catch (e) {
			console.error(
				"[learning-system] failed to move occlusion sidecar alongside rename:",
				e,
			);
		}
	}

	/**
	 * If a `.occlusion.json` sidecar paired the deleted `.md` path,
	 * trash it alongside. Silent no-op when no JSON is paired. The
	 * delete confirm modal also calls this path on user-initiated
	 * delete; the vault.on("delete") handler covers the rename-then-
	 * delete and external-delete cases.
	 */
	async trashOcclusionSidecarIfPaired(mdPath: string): Promise<void> {
		try {
			const jsonPath = jsonPathForCard(mdPath);
			const jsonFile = this.app.vault.getAbstractFileByPath(jsonPath);
			if (!(jsonFile instanceof TFile)) return; // no paired sidecar
			await this.app.fileManager.trashFile(jsonFile);
		} catch (e) {
			console.error(
				"[learning-system] failed to trash occlusion sidecar alongside delete:",
				e,
			);
		}
	}

	async refreshCard(file: TFile): Promise<void> {
		const outcome = await parseCardFile(this.app, file);
		const store = useCardStore.getState();
		switch (outcome.kind) {
			case "skipped":
				// File no longer flagged as flashcard — drop from store.
				store.removeCard(file.path);
				break;
			case "invalid":
				store.setInvalid(outcome.path, outcome.error);
				console.error(
					`[learning-system] invalid card: ${outcome.path} — ${outcome.error}`,
				);
				break;
			case "parsed":
				// Atomic re-parse: drops stale siblings and inserts the
				// new set in one state update. Necessary for the
				// cloze-removed / cloze-renumbered cases where a
				// removeCard + setCard sequence would briefly expose
				// "no cards from this path" to React renders.
				store.replaceCardsForPath(file.path, outcome.cards);
				// Refresh logs are intentionally chatty — easy to filter by [learning-system].
				console.debug(
					`[learning-system] re-validated: ${file.path} (${outcome.cards.length} card(s))`,
				);
				break;
		}
	}
}
