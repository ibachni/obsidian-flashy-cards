import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_LEARNING = "learning-system-view";

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
		this.contentEl.setText("Hello, Learning System");
	}

	async onClose(): Promise<void> {}
}

export default class LearningSystemPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(
			VIEW_TYPE_LEARNING,
			(leaf) => new LearningSystemView(leaf),
		);

		this.addRibbonIcon("brain", "Learning System", () => {
			void this.activateView();
		});
	}

	onunload(): void {
		// No-op — registerView() handles leaf cleanup on plugin unload.
		// Manually calling detachLeavesOfType here is the older pattern and
		// can interfere with Obsidian's workspace restore.
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_LEARNING)[0];

		if (existing) {
			void workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: VIEW_TYPE_LEARNING, active: true });
		void workspace.revealLeaf(leaf);
	}
}
