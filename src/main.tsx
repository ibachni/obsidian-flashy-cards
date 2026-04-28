import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import type { ParsedCard } from "./cards/parser";
import { parseCardFile, scanCards } from "./cards/parser";
import { pickNext } from "./cards/picker";
import { useCardStore } from "./cards/store";
import type { CardFrontmatterT } from "./schema/card";
import {
	gradeWith,
	makeEngine,
	Rating,
	type FSRS,
	type Grade,
} from "./srs/fsrs-engine";
import { BrowsePane } from "./views/BrowsePane";
import { PluginContextProvider } from "./views/PluginContext";
import { ReviewPane } from "./views/ReviewPane";

export const VIEW_TYPE_LEARNING = "learning-system-view";
export const VIEW_TYPE_BROWSE = "learning-system-browse-view";

type ThemeMode = "cream" | "dark" | "system";

interface LearningSystemSettings {
	theme: ThemeMode;
	cardsRoot: string;
	fsrsRequestRetention: number;
	fsrsMaximumInterval: number;
	claudianHoldingFile: string;
}

const DEFAULT_SETTINGS: LearningSystemSettings = {
	theme: "cream",
	cardsRoot: "200_private/600_Learning/",
	fsrsRequestRetention: 0.9,
	fsrsMaximumInterval: 36500,
	claudianHoldingFile: "_handoff_learning.md",
};

class LearningSystemView extends ItemView {
	private root: Root | null = null;
	plugin: LearningSystemPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: LearningSystemPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LEARNING;
	}

	getDisplayText(): string {
		return "Learning System";
	}

	getIcon(): string {
		return "brain";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("learning-system-root");
		this.contentEl.addClass("learning-system-pane");

		// React mounts on a child div so contentEl keeps the wrapper class
		// even if React replaces its own root. Theme variables cascade
		// from contentEl into the React subtree.
		const mountEl = this.contentEl.createDiv();
		this.root = createRoot(mountEl);
		this.root.render(
			<PluginContextProvider
				value={{ app: this.app, plugin: this.plugin, view: this }}
			>
				<ReviewPane />
			</PluginContextProvider>,
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}

class LearningSystemBrowseView extends ItemView {
	private root: Root | null = null;
	plugin: LearningSystemPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: LearningSystemPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_BROWSE;
	}

	getDisplayText(): string {
		return "Learning Browse";
	}

	getIcon(): string {
		return "library";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("learning-system-root");
		this.contentEl.addClass("learning-system-pane");

		const mountEl = this.contentEl.createDiv();
		this.root = createRoot(mountEl);
		this.root.render(
			<PluginContextProvider
				value={{ app: this.app, plugin: this.plugin, view: this }}
			>
				<BrowsePane />
			</PluginContextProvider>,
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
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
		const trimmed = value.trim().replace(/\/+$/, "");
		if (!trimmed) {
			errorEl.setText("Cards root is required.");
			return false;
		}
		const file = this.plugin.app.vault.getAbstractFileByPath(trimmed);
		if (!(file instanceof TFolder)) {
			errorEl.setText(`Folder not found: ${trimmed}`);
			return false;
		}
		// Empty text + .ls-setting-error:empty CSS rule hides the element.
		errorEl.setText("");
		return true;
	}

	private validateHoldingFile(value: string, errorEl: HTMLElement): boolean {
		const trimmed = value.trim();
		if (!trimmed) {
			errorEl.setText("Holding file path is required.");
			return false;
		}
		// The file doesn't have to exist yet — P2 creates it on first
		// mark-and-elaborate. We only flag the case where the path
		// already points at a folder, which would block file creation.
		const file = this.plugin.app.vault.getAbstractFileByPath(trimmed);
		if (file instanceof TFolder) {
			errorEl.setText(`Path is a folder, not a file: ${trimmed}`);
			return false;
		}
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
					.setPlaceholder("200_private/600_Learning/")
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
							this.plugin.settings.cardsRoot = value;
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

		new Setting(containerEl).setName("Claudian integration").setHeading();

		const holdingFileSetting = new Setting(containerEl)
			.setName("Holding file")
			.setDesc(
				"Path where mark-and-elaborate prompts will be appended. Reserved for P2 wiring; not used yet.",
			)
			.addText((text) =>
				text
					.setPlaceholder("_handoff_learning.md")
					.setValue(this.plugin.settings.claudianHoldingFile)
					.onChange(async (value) => {
						this.plugin.settings.claudianHoldingFile = value;
						await this.plugin.saveSettings();
						this.validateHoldingFile(value, holdingFileError);
					}),
			);
		holdingFileSetting.settingEl.addClass("ls-wide-input");

		const holdingFileError = containerEl.createDiv({
			cls: "ls-setting-error",
		});
		this.validateHoldingFile(
			this.plugin.settings.claudianHoldingFile,
			holdingFileError,
		);
	}
}

export default class LearningSystemPlugin extends Plugin {
	settings: LearningSystemSettings = DEFAULT_SETTINGS;
	private fsrsEngine: FSRS = makeEngine();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.rebuildEngine();

		this.registerView(
			VIEW_TYPE_LEARNING,
			(leaf) => new LearningSystemView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_BROWSE,
			(leaf) => new LearningSystemBrowseView(leaf, this),
		);

		this.addRibbonIcon("brain", "Learning System", () => {
			void this.activateView();
		});
		this.addRibbonIcon("library", "Learning System: Browse", () => {
			void this.activateBrowseView();
		});

		this.addCommand({
			id: "open-browse",
			name: "Open Browse view",
			callback: () => void this.activateBrowseView(),
		});

		this.addCommand({
			id: "toggle-theme",
			name: "Toggle theme (cream / dark)",
			callback: () => this.toggleTheme(),
		});

		// `d` toggles cream/dark while a Learning System pane is the
		// user's current context. Two acceptable conditions:
		//   1. focus is inside our pane (`closest` match), OR
		//   2. one of our views is the active leaf — covers the case
		//      where focus drifted to <body> after the first toggle and
		//      `closest` would otherwise filter every subsequent press.
		// Inputs / editable elements bail out unconditionally so typing
		// "d" in the tag filter still works.
		this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
			if (e.key !== "d") return;
			if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			const target = e.target as HTMLElement | null;
			if (
				target instanceof HTMLElement &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}
			const inPane = !!target?.closest?.(".learning-system-pane");
			const activeIsOurs =
				!!this.app.workspace.getActiveViewOfType(LearningSystemView) ||
				!!this.app.workspace.getActiveViewOfType(
					LearningSystemBrowseView,
				);
			if (!inPane && !activeIsOurs) return;
			e.preventDefault();
			this.toggleTheme();
		});

		// Grade-via-command-palette commands. Kept after M5 since they're
		// keyboard-accessible alternatives to the UI buttons.
		this.addCommand({
			id: "grade-next-again",
			name: "Grade next due card: Again",
			callback: () => void this.gradeNextDue(Rating.Again),
		});
		this.addCommand({
			id: "grade-next-hard",
			name: "Grade next due card: Hard",
			callback: () => void this.gradeNextDue(Rating.Hard),
		});
		this.addCommand({
			id: "grade-next-good",
			name: "Grade next due card: Good",
			callback: () => void this.gradeNextDue(Rating.Good),
		});
		this.addCommand({
			id: "grade-next-easy",
			name: "Grade next due card: Easy",
			callback: () => void this.gradeNextDue(Rating.Easy),
		});

		this.addSettingTab(new LearningSystemSettingTab(this.app, this));

		// Defer applyTheme + initial card scan until the workspace has
		// restored its leaves and the metadata cache has populated.
		// onLayoutReady fires immediately if layout is already ready, so
		// this also covers the toggle-off-then-on case.
		this.app.workspace.onLayoutReady(() => {
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
			cardsRoot: merged.cardsRoot,
			fsrsRequestRetention: merged.fsrsRequestRetention,
			fsrsMaximumInterval: merged.fsrsMaximumInterval,
			claudianHoldingFile: merged.claudianHoldingFile,
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

	applyTheme(): void {
		const isDark =
			this.settings.theme === "dark" ||
			(this.settings.theme === "system" &&
				document.body.classList.contains("theme-dark"));

		const types = [VIEW_TYPE_LEARNING, VIEW_TYPE_BROWSE];
		for (const type of types) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				if (leaf.view instanceof ItemView) {
					leaf.view.contentEl.toggleClass("dark", isDark);
				}
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

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_LEARNING)[0];

		if (existing) {
			void workspace.revealLeaf(existing);
			this.applyTheme();
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: VIEW_TYPE_LEARNING, active: true });
		void workspace.revealLeaf(leaf);
		this.applyTheme();
	}

	async activateBrowseView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_BROWSE)[0];

		if (existing) {
			void workspace.revealLeaf(existing);
			this.applyTheme();
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: VIEW_TYPE_BROWSE, active: true });
		void workspace.revealLeaf(leaf);
		this.applyTheme();
	}

	normalizedCardsRoot(): string {
		const r = this.settings.cardsRoot;
		return r.endsWith("/") ? r : r + "/";
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
	 */
	async gradeAndPersist(card: ParsedCard, rating: Grade): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (!(file instanceof TFile)) {
			new Notice(`Card file missing: ${card.path}`);
			return;
		}

		const now = new Date();
		const update = gradeWith(this.fsrsEngine, card.fm, rating, now);

		const modified = now.toISOString().slice(0, 10);

		// processFrontMatter's callback receives `any`. Cast to a
		// known-shape Record before mutating, then use Object.assign so
		// every field flows from `update` in one statement.
		await this.app.fileManager.processFrontMatter(file, (raw) => {
			const fm = raw as Record<string, unknown>;
			Object.assign(fm, update, { modified });
		});

		// Optimistic store update: processFrontMatter persists, but the
		// metadataCache "changed" event that refreshes the Zustand store
		// can land a tick later. Without this push, pickNext re-renders
		// the just-graded card briefly with its old fsrs_due. The cache
		// event arrives later and reconciles.
		const updatedFm: CardFrontmatterT = { ...card.fm, ...update, modified };
		useCardStore.getState().setCard({ ...card, fm: updatedFm });
	}

	async gradeNextDue(rating: Grade): Promise<void> {
		try {
			const cards = Array.from(useCardStore.getState().cardsByPath.values());
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
				store.setCard(outcome.card);
				// Refresh logs are intentionally chatty — easy to filter by [learning-system].
				console.debug(
					`[learning-system] re-validated: ${outcome.card.path}`,
				);
				break;
		}
	}
}
