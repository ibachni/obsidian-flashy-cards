import { Notice, TFolder } from "obsidian";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

import {
	findAvailablePath,
	newCardFrontmatter,
	serializeCard,
	slugify,
} from "../cards/new-card";
import { useCardStore } from "../cards/store";
import { CardFrontmatter } from "../schema/card";
import { MarkdownField, type MarkdownFieldHandle } from "./MarkdownField";
import { usePluginContext } from "./PluginContext";
import { TagCombobox } from "./TagCombobox";
import { TopicCombobox } from "./TopicCombobox";

const INPUT_CLASS =
	"w-full rounded border! border-border! bg-transparent! shadow-none! px-2 py-1 text-sm text-fg-strong! focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

/**
 * Right-sidebar pane for creating flashcards — Anki-style rapid entry.
 * Save resets Question/Answer and refocuses Question; Topic / Section /
 * Tags persist across saves until the user edits them. There is no
 * Cancel button — the pane is dismissed by closing its tab, like Browse
 * and Review.
 */
interface Props {
	/**
	 * Whether this pane is currently the active mode. Used to focus the
	 * Question field on first activation — the in-pane equivalent of
	 * the previous `autoFocus`-on-mount, which no-op'd inside the
	 * unified pane because the editor mounted hidden.
	 */
	active: boolean;
}

export function NewCardPane({ active }: Props) {
	const { app, plugin } = usePluginContext();
	const cardsByPath = useCardStore((s) => s.cardsByPath);

	const [topic, setTopic] = useState("");
	const [section, setSection] = useState("");
	const [tags, setTags] = useState<Set<string>>(new Set());
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [saving, setSaving] = useState(false);

	const questionRef = useRef<MarkdownFieldHandle>(null);
	// One-shot focus: fires the first time the pane becomes active. We
	// don't re-focus on every revisit — that would yank focus away from
	// whatever field the user was last editing.
	const focusedOnceRef = useRef(false);
	useEffect(() => {
		if (active && !focusedOnceRef.current) {
			focusedOnceRef.current = true;
			questionRef.current?.focus();
		}
	}, [active]);

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

	const onSave = async () => {
		if (!canSave) return;
		setSaving(true);
		try {
			const now = new Date();
			// Topic stays verbatim in frontmatter; the path segment gets
			// slashes flattened so we never accidentally nest topics.
			const sanitizedTopic = trimmedTopic.replace(/\//g, "-");
			const folder = `${plugin.normalizedCardsRoot()}${sanitizedTopic}`;
			const slug = slugify(trimmedQuestion, now);
			const basePath = `${folder}/${slug}.md`;

			const fm = newCardFrontmatter({
				topic: trimmedTopic,
				section: section.trim() || undefined,
				tags: Array.from(tags),
				today: now,
			});

			// Defensive guard — should never fail given how we construct
			// fm. Catches schema drift between new-card.ts and card.ts.
			const guard = CardFrontmatter.safeParse(fm);
			if (!guard.success) {
				const err = guard.error.issues
					.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
					.join("; ");
				new Notice(`Frontmatter validation failed: ${err}`);
				return;
			}

			// Topic folder: create only if missing. createFolder throws
			// when the folder already exists, so the second card into an
			// existing topic would otherwise fail.
			const existingFolder = app.vault.getAbstractFileByPath(folder);
			if (existingFolder === null) {
				await app.vault.createFolder(folder);
			} else if (!(existingFolder instanceof TFolder)) {
				new Notice(`Path exists but isn't a folder: ${folder}`);
				return;
			}

			const finalPath = findAvailablePath(
				basePath,
				(p) => app.vault.getAbstractFileByPath(p) !== null,
				now,
			);
			const contents = serializeCard({
				fm,
				question: trimmedQuestion,
				answer: trimmedAnswer,
			});
			await app.vault.create(finalPath, contents);

			const filename = finalPath.split("/").pop() ?? finalPath;
			new Notice(`Created ${filename}`);

			// Anki-style reset: clear Q/A, keep sticky fields, refocus
			// Question for the next entry.
			setQuestion("");
			setAnswer("");
			questionRef.current?.focus();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] create card failed:", e);
			new Notice(`Failed to create card: ${msg}`);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-4">
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

			<div className="flex justify-end">
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
