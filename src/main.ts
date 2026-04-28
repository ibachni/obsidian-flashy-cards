import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

import type { ParsedCard } from "./cards/parser";
import { parseCardFile, scanCards } from "./cards/parser";
import { useCardStore } from "./cards/store";
import { gradeCard, Rating, type Grade } from "./srs/fsrs-engine";

export const VIEW_TYPE_LEARNING = "learning-system-view";

type ThemeMode = "cream" | "dark" | "system";

interface LearningSystemSettings {
	theme: ThemeMode;
	cardsRoot: string;
}

const DEFAULT_SETTINGS: LearningSystemSettings = {
	theme: "cream",
	cardsRoot: "200_private/600_Learning/",
};

class LearningSystemView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
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
		// Inner div uses Tailwind utilities to demonstrate the toolchain
		// is wired (p-6 from Tailwind, accent border from our theme tokens).
		// The wrapper itself is themed via direct CSS in styles.css.
		const inner = this.contentEl.createDiv({
			cls: "p-6 border-l-4 border-accent",
		});
		inner.setText("Hello, Learning System");
	}

	async onClose(): Promise<void> {}
}

class LearningSystemSettingTab extends PluginSettingTab {
	plugin: LearningSystemPlugin;

	constructor(app: App, plugin: LearningSystemPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Theme")
			.setDesc(
				"Cream, dark, or follow Obsidian's setting. " +
					"(Stubbed in M2 — M6 fleshes out the full settings tab.)",
			)
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
	}
}

export default class LearningSystemPlugin extends Plugin {
	settings: LearningSystemSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_LEARNING,
			(leaf) => new LearningSystemView(leaf),
		);

		this.addRibbonIcon("brain", "Learning System", () => {
			void this.activateView();
		});

		// M4 dry-run commands: grade the next due card with each rating.
		// M5 will replace these with UI buttons in the Review pane.
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
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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

	pickNextDueCard(): ParsedCard | null {
		const cards = Array.from(useCardStore.getState().cardsByPath.values());
		if (cards.length === 0) return null;

		const now = new Date();
		const due = cards.filter((c) => new Date(c.fm.fsrs_due) <= now);
		// Fallback to any card if nothing is currently due — useful for M4
		// dry-run when the M0 cards are scheduled tomorrow but you want to
		// exercise the round-trip today.
		const pool = due.length > 0 ? due : cards;

		return (
			pool.slice().sort((a, b) => {
				return (
					new Date(a.fm.fsrs_due).getTime() -
					new Date(b.fm.fsrs_due).getTime()
				);
			})[0] ?? null
		);
	}

	async gradeNextDue(rating: Grade): Promise<void> {
		console.debug(
			`[learning-system] gradeNextDue invoked: rating=${Rating[rating]} (${rating})`,
		);
		try {
			const card = this.pickNextDueCard();
			if (!card) {
				new Notice("No cards loaded.");
				return;
			}
			console.debug(
				`[learning-system] picked card: ${card.path} (state=${card.fm.fsrs_state}, due=${card.fm.fsrs_due})`,
			);

			const file = this.app.vault.getAbstractFileByPath(card.path);
			if (!(file instanceof TFile)) {
				new Notice(`Card file missing: ${card.path}`);
				return;
			}

			const now = new Date();
			const update = gradeCard(card.fm, rating, now);
			console.debug(
				`[learning-system] gradeCard result:`,
				update,
			);

			// processFrontMatter's callback receives `any`. Cast to a
			// known-shape Record before mutating, then use Object.assign so
			// every field flows from `update` in one statement.
			await this.app.fileManager.processFrontMatter(file, (raw) => {
				const fm = raw as Record<string, unknown>;
				Object.assign(fm, update, {
					modified: now.toISOString().slice(0, 10),
				});
			});

			const slug = card.path.split("/").pop() ?? card.path;
			const verdict = Rating[rating];
			new Notice(
				`${slug} · ${verdict} → due ${update.fsrs_due} (reps ${update.fsrs_reps}, lapses ${update.fsrs_lapses})`,
			);
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
