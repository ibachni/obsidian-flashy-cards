import { type App, Modal, Notice, TFile } from "obsidian";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { maskField, revealField } from "../cards/cloze";
import { rewriteBody } from "../cards/edit-card";
import type { ParsedCard } from "../cards/parser";
import { useCardStore } from "../cards/store";
import type { CardFrontmatterT } from "../schema/card";
import { MarkdownField, type MarkdownFieldHandle } from "./MarkdownField";
import { usePluginContext } from "./PluginContext";
import { TagCombobox } from "./TagCombobox";
import { TopicCombobox } from "./TopicCombobox";

const INPUT_CLASS =
	"w-full rounded border! border-border! bg-transparent! shadow-none! px-2 py-1 text-sm text-fg-strong! focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

interface Props {
	card: ParsedCard;
	onSaved: () => void;
	onCancel: () => void;
	/**
	 * Hook for the Modal host to consult before closing. Returning `false`
	 * cancels the close. Used so Esc / outside-click route through the
	 * same dirty-confirm as the Cancel button — Obsidian's default Esc
	 * binding bypasses React.
	 *
	 * When the form is dirty, the callback opens a `DiscardConfirmModal`
	 * and returns `false` to block this close attempt; the modal calls
	 * `forceClose` once the user confirms discard.
	 */
	registerConfirmClose?: (fn: () => boolean) => void;
	/**
	 * Bypasses the dirty-confirm and closes the host modal. Invoked from
	 * the `DiscardConfirmModal` after the user confirms discard.
	 */
	forceClose?: () => void;
}

/**
 * Small Obsidian `Modal` shown when the user tries to close the edit
 * form with unsaved changes. Replaces `window.confirm`, which renders
 * a browser-chrome dialog that looks out-of-place inside Obsidian and
 * fails `no-alert` lint.
 */
export class DiscardConfirmModal extends Modal {
	private readonly onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Discard unsaved changes?" });
		contentEl.createEl("p", {
			text: "Your edits to this card will be lost.",
		});
		const btns = contentEl.createDiv({ cls: "modal-button-container" });
		const keepBtn = btns.createEl("button", { text: "Keep editing" });
		keepBtn.addEventListener("click", () => this.close());
		const discardBtn = btns.createEl("button", {
			text: "Discard",
			cls: "mod-warning",
		});
		discardBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
		// Default focus on "Keep editing" so an accidental Enter doesn't
		// throw away the user's work.
		keepBtn.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Edit form for a single card. Renders inside an Obsidian `Modal` host
 * (see `LearningSystemEditCardModal` in main.tsx). Field shape matches
 * the create form so users see the same surface for both flows.
 *
 * Never touches FSRS frontmatter. The save flow is two-step:
 *   1. `processFrontMatter` for topic/section/tags/modified (atomic merge,
 *      preserves any `fsrs_*` write that lands between read and write).
 *   2. `vault.process(file, rewriteBody)` for the Q/A body — also
 *      under Obsidian's per-file lock, so the body update and any
 *      concurrent grade serialize cleanly.
 *
 * `modified` is the only date this path writes; `created` is owned by
 * the create path, `fsrs_*` by the grade path.
 */
export function EditCardModal({
	card,
	onSaved,
	onCancel,
	registerConfirmClose,
	forceClose,
}: Props) {
	const { app } = usePluginContext();
	const cardsById = useCardStore((s) => s.cardsById);

	// Cloze siblings carry the raw `{{cN::…}}` source on `rawQuestion`
	// / `rawAnswer`; non-cloze cards don't. Pre-fill with the source so
	// the user edits the syntax they wrote, not the rendered mask /
	// highlighted view — saving the masked view would erase the cloze
	// markup. Falls through to `card.question` / `card.answer` for
	// non-cloze cards (where the two are identical).
	const initialQuestion = card.rawQuestion ?? card.question;
	const initialAnswer = card.rawAnswer ?? card.answer;

	const [topic, setTopic] = useState(card.fm.topic);
	const [section, setSection] = useState(card.fm.section ?? "");
	const [tags, setTags] = useState<Set<string>>(new Set(card.fm.tags));
	const [question, setQuestion] = useState(initialQuestion);
	const [answer, setAnswer] = useState(initialAnswer);
	const [saving, setSaving] = useState(false);

	// Capture the open-time snapshot once. Dirty detection compares
	// current state to this — not to `card`, which can be replaced
	// underneath us by a concurrent metadataCache update.
	const initialRef = useRef({
		topic: card.fm.topic,
		section: card.fm.section ?? "",
		tags: new Set(card.fm.tags),
		question: initialQuestion,
		answer: initialAnswer,
	});

	const questionRef = useRef<MarkdownFieldHandle>(null);
	useEffect(() => {
		questionRef.current?.focus();
	}, []);

	const cardArray = useMemo(
		() => Array.from(cardsById.values()),
		[cardsById],
	);

	const allTopics = useMemo(() => {
		const set = new Set<string>();
		for (const c of cardArray) set.add(c.fm.topic);
		return Array.from(set).sort();
	}, [cardArray]);

	const allTags = useMemo(() => {
		const set = new Set<string>();
		for (const c of cardArray) for (const t of c.fm.tags) set.add(t);
		return Array.from(set).sort();
	}, [cardArray]);

	const trimmedTopic = topic.trim();
	const trimmedQuestion = question.trim();
	const trimmedAnswer = answer.trim();
	const canSave =
		!saving &&
		trimmedTopic.length > 0 &&
		trimmedQuestion.length > 0 &&
		trimmedAnswer.length > 0;

	const isDirty = (): boolean => {
		const init = initialRef.current;
		if (trimmedTopic !== init.topic.trim()) return true;
		if (section.trim() !== init.section.trim()) return true;
		if (question !== init.question) return true;
		if (answer !== init.answer) return true;
		if (tags.size !== init.tags.size) return true;
		for (const t of tags) if (!init.tags.has(t)) return true;
		return false;
	};

	// Mirror the latest isDirty into a ref so the confirm-close callback
	// registered once on mount always sees fresh state. Without this, the
	// callback captures stale closures and reports "not dirty" on Esc
	// after the user has typed.
	const isDirtyRef = useRef(isDirty);
	isDirtyRef.current = isDirty;
	useEffect(() => {
		if (!registerConfirmClose) return;
		registerConfirmClose(() => {
			if (!isDirtyRef.current()) return true;
			// Dirty: defer the close decision to an async confirm modal.
			// Return false now to block this close attempt; the discard
			// modal calls `forceClose` once the user confirms.
			if (forceClose) {
				new DiscardConfirmModal(app, forceClose).open();
			}
			return false;
		});
	}, [registerConfirmClose, forceClose, app]);

	// Dirty-confirm lives in the Modal host's `close()` override so Esc /
	// outside-click and the Cancel button share one prompt.
	const tryCancel = () => {
		if (saving) return;
		onCancel();
	};

	const onSave = async () => {
		if (!canSave) return;

		if (!isDirty()) {
			// No-op save: skip the writes (and the Notice) entirely.
			onSaved();
			return;
		}

		setSaving(true);
		try {
			const file = app.vault.getAbstractFileByPath(card.path);
			if (!(file instanceof TFile)) {
				new Notice(`Card file missing: ${card.path}`);
				return;
			}

			const today = new Date().toISOString().slice(0, 10);
			const nextTopic = trimmedTopic;
			const nextSection = section.trim();
			const nextTags = Array.from(tags);

			// Step 1 — frontmatter via processFrontMatter (atomic merge,
			// leaves fsrs_* and any unknown keys untouched).
			await app.fileManager.processFrontMatter(file, (raw) => {
				const fm = raw as Record<string, unknown>;
				fm.topic = nextTopic;
				if (nextSection.length > 0) {
					fm.section = nextSection;
				} else {
					delete fm.section;
				}
				fm.tags = nextTags;
				fm.modified = today;
			});

			// Step 2 — body. `vault.process` reads + writes atomically
			// under Obsidian's per-file lock, so a grade landing between
			// the read and the write can no longer clobber this edit.
			// `rewriteBody` preserves frontmatter verbatim.
			await app.vault.process(file, (content) =>
				rewriteBody(content, {
					question: trimmedQuestion,
					answer: trimmedAnswer,
				}),
			);

			// Optimistic store update — mirrors gradeAndPersist's pattern.
			// metadataCache.changed reconciles a tick later.
			//
			// For cloze siblings the in-memory `question` / `answer`
			// fields are the pre-rendered masked / highlighted views;
			// recompute them from the trimmed raw source so the store
			// stays consistent with what the parser would emit. The
			// raw source goes on `rawQuestion` / `rawAnswer` so the
			// next edit also sees the source. Non-cloze cards just
			// store the raw text — those two are identical.
			const updatedFm: CardFrontmatterT = {
				...card.fm,
				topic: nextTopic,
				section: nextSection.length > 0 ? nextSection : undefined,
				tags: nextTags,
				modified: today,
			};
			const isCloze = card.clozeIndex !== null;
			useCardStore.getState().setCard({
				...card,
				fm: updatedFm,
				question: isCloze
					? maskField(trimmedQuestion, card.clozeIndex as number)
					: trimmedQuestion,
				answer: isCloze
					? revealField(trimmedAnswer, card.clozeIndex as number)
					: trimmedAnswer,
				...(isCloze
					? { rawQuestion: trimmedQuestion, rawAnswer: trimmedAnswer }
					: {}),
			});

			const slug = card.path.split("/").pop() ?? card.path;
			new Notice(`Updated ${slug}`);
			onSaved();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] edit card failed:", e);
			new Notice(`Failed to save: ${msg}`);
		} finally {
			setSaving(false);
		}
	};

	const slug = card.path.split("/").pop() ?? card.path;

	// Layout: pin the header and the action row, let the middle region
	// (fields) absorb overflow. Without this, the resizable Q/A editors
	// can push the Save/Cancel buttons past the modal's max-height and
	// out of the viewport. `min-h-0` on the scroller is required so flex
	// actually honors `overflow-y: auto` instead of expanding to content.
	return (
		<div className="flex flex-col gap-4 max-h-[85vh]">
			<div className="flex flex-col gap-0.5 shrink-0">
				<h2 className="text-base font-medium text-fg-strong! m-0">
					Edit card
				</h2>
				<p className="text-xs text-muted! m-0">
					<span>{slug}</span>
					<span> · </span>
					<span
						title="FSRS scheduling is preserved when you save."
						className="cursor-help"
					>
						{card.fm.fsrs_state} · due {card.fm.fsrs_due}
					</span>
				</p>
			</div>

			<div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto pr-1">
				<Field label="Topic">
					<TopicCombobox
						value={topic}
						onChange={setTopic}
						allTopics={allTopics}
						placeholder="dns"
					/>
				</Field>

				<Field label="Section" optional>
					<input
						type="text"
						value={section}
						onChange={(e) => setSection(e.target.value)}
						className={INPUT_CLASS}
						placeholder="foundations"
					/>
				</Field>

				<Field label="Tags" optional>
					<TagCombobox
						allTags={allTags}
						selected={tags}
						onChange={setTags}
						placeholder="Add tag…"
						allowCreate
					/>
				</Field>

				<MarkdownField
					ref={questionRef}
					label="Question"
					value={question}
					onChange={setQuestion}
					onSubmit={() => void onSave()}
				/>

				<MarkdownField
					label="Answer"
					value={answer}
					onChange={setAnswer}
					onSubmit={() => void onSave()}
				/>
			</div>

			<div className="flex justify-end gap-2 shrink-0">
				<button
					type="button"
					className="rounded px-3 py-1 text-sm"
					onClick={tryCancel}
					disabled={saving}
				>
					Cancel
				</button>
				<button
					type="button"
					className="ls-btn-primary rounded px-3 py-1 text-sm"
					disabled={!canSave}
					onClick={() => void onSave()}
				>
					Save
				</button>
			</div>
		</div>
	);
}

function Field({
	label,
	optional,
	children,
}: {
	label: string;
	optional?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-sm font-medium text-muted!">
				{label}
				{optional && <span className="text-muted!"> (optional)</span>}
			</span>
			{children}
		</div>
	);
}
