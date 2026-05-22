import { Notice, TFile } from "obsidian";
import { useEffect, useMemo, useRef, useState } from "react";

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
	 */
	registerConfirmClose?: (fn: () => boolean) => void;
}

/**
 * Edit form for a single card. Renders inside an Obsidian `Modal` host
 * (see `LearningSystemEditCardModal` in main.tsx). Field shape matches
 * the create form so users see the same surface for both flows.
 *
 * Never touches FSRS frontmatter. The save flow is two-step:
 *   1. `processFrontMatter` for topic/section/tags/modified (atomic merge,
 *      preserves any `fsrs_*` write that lands between read and write).
 *   2. `rewriteBody` + `vault.modify` for the Q/A body.
 *
 * `modified` is the only date this path writes; `created` is owned by
 * the create path, `fsrs_*` by the grade path.
 */
export function EditCardModal({
	card,
	onSaved,
	onCancel,
	registerConfirmClose,
}: Props) {
	const { app } = usePluginContext();
	const cardsByPath = useCardStore((s) => s.cardsByPath);

	const [topic, setTopic] = useState(card.fm.topic);
	const [section, setSection] = useState(card.fm.section ?? "");
	const [tags, setTags] = useState<Set<string>>(new Set(card.fm.tags));
	const [question, setQuestion] = useState(card.question);
	const [answer, setAnswer] = useState(card.answer);
	const [saving, setSaving] = useState(false);

	// Capture the open-time snapshot once. Dirty detection compares
	// current state to this — not to `card`, which can be replaced
	// underneath us by a concurrent metadataCache update.
	const initialRef = useRef({
		topic: card.fm.topic,
		section: card.fm.section ?? "",
		tags: new Set(card.fm.tags),
		question: card.question,
		answer: card.answer,
	});

	const questionRef = useRef<MarkdownFieldHandle>(null);
	useEffect(() => {
		questionRef.current?.focus();
	}, []);

	const cardArray = useMemo(
		() => Array.from(cardsByPath.values()),
		[cardsByPath],
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
			return window.confirm("Discard unsaved changes?");
		});
	}, [registerConfirmClose]);

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

			// Step 2 — body. Re-read so a grade that landed between (1)
			// and (2) has its frontmatter preserved verbatim by rewriteBody.
			const content = await app.vault.read(file);
			const next = rewriteBody(content, {
				question: trimmedQuestion,
				answer: trimmedAnswer,
			});
			await app.vault.modify(file, next);

			// Optimistic store update — mirrors gradeAndPersist's pattern.
			// metadataCache.changed reconciles a tick later.
			const updatedFm: CardFrontmatterT = {
				...card.fm,
				topic: nextTopic,
				section: nextSection.length > 0 ? nextSection : undefined,
				tags: nextTags,
				modified: today,
			};
			useCardStore.getState().setCard({
				...card,
				fm: updatedFm,
				question: trimmedQuestion,
				answer: trimmedAnswer,
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
	children: React.ReactNode;
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
