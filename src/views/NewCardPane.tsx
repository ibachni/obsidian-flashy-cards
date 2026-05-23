import { Notice, TFolder } from "obsidian";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

import { collectClozeIndices } from "../cards/cloze";
import {
	findAvailablePath,
	newCardFrontmatter,
	serializeCard,
	serializeClozeCard,
	slugify,
} from "../cards/new-card";
import { useCardStore } from "../cards/store";
import { CardFrontmatter } from "../schema/card";
import { MarkdownField, type MarkdownFieldHandle } from "./MarkdownField";
import { OcclusionPane } from "./OcclusionPane";
import { usePluginContext } from "./PluginContext";
import { TagCombobox } from "./TagCombobox";
import { TopicCombobox } from "./TopicCombobox";

const INPUT_CLASS =
	"w-full rounded border! border-border! bg-transparent! shadow-none! px-2 py-1 text-sm text-fg-strong! focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

/**
 * Three card kinds the user can create from this pane:
 *   - `normal` — plain Q/A markdown. The classic case.
 *   - `cloze` — Q/A markdown with `{{cN::…}}` cloze markers; saved as
 *     a multi-sibling card via `fsrs_clozes`.
 *   - `occlusion` — image with mask rectangles; the form is the full
 *     `OcclusionPane` component below the type selector.
 */
type CardType = "normal" | "cloze" | "occlusion";

interface Props {
	/**
	 * Whether this pane is currently the active mode. Used to focus the
	 * Question field on first activation — the in-pane equivalent of
	 * the previous `autoFocus`-on-mount, which no-op'd inside the
	 * unified pane because the editor mounted hidden.
	 */
	active: boolean;
}

/**
 * Unified create-pane. The "Card type" selector at the top toggles
 * between three sub-forms; switching away from a sub-form unmounts
 * its in-progress state. Sticky fields (topic, section, tags) are
 * NOT shared across types — each type's form owns its own state, so
 * switching is destructive but predictable.
 *
 * Occlusion edits route through here too: when the plugin sets
 * `editingOcclusionPath`, this pane auto-switches to `occlusion`
 * and `OcclusionPane`'s own load effect pulls the set in.
 */
export function NewCardPane({ active }: Props) {
	const [cardType, setCardType] = useState<CardType>("normal");

	// Edit-existing-occlusion: when the plugin's `openEditCardModal`
	// routes an occlusion sibling to Create mode, this store field
	// gets set. Force the card-type selector to "occlusion" so the
	// embedded OcclusionPane mounts and runs its load effect on the
	// editing path. The path itself is consumed by OcclusionPane.
	const editingOcclusionPath = useCardStore((s) => s.editingOcclusionPath);
	useEffect(() => {
		if (editingOcclusionPath !== null && cardType !== "occlusion") {
			setCardType("occlusion");
		}
	}, [editingOcclusionPath, cardType]);

	const setEditingOcclusionPath = useCardStore(
		(s) => s.setEditingOcclusionPath,
	);

	const handleTypeChange = (next: CardType) => {
		if (next === cardType) return;
		// Switching away from `occlusion` while editing an existing
		// set would orphan the edit context. Clear it so a later
		// switch back to `occlusion` doesn't silently re-load the
		// previous target.
		if (cardType === "occlusion" && editingOcclusionPath !== null) {
			setEditingOcclusionPath(null);
		}
		setCardType(next);
	};

	return (
		<div className="flex h-full flex-col gap-3">
			<div className="shrink-0">
				<CardTypeSelector value={cardType} onChange={handleTypeChange} />
			</div>

			{cardType === "occlusion" ? (
				<div className="flex min-h-0 flex-1 flex-col">
					<OcclusionPane />
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					<NormalOrClozeForm active={active} cardType={cardType} />
				</div>
			)}
		</div>
	);
}

/**
 * The Q/A form shared by `normal` and `cloze`. The save flow branches
 * on `cardType`:
 *   - `normal` — calls `serializeCard` (flat `fsrs_*` block).
 *   - `cloze` — detects cloze indices in question + answer via
 *     `collectClozeIndices`, refuses to save if none found, then
 *     calls `serializeClozeCard` (per-sibling `fsrs_clozes`).
 *
 * Form state is local — switching types via the parent unmounts this
 * component and drops the state. Acceptable for v1; a future polish
 * could persist topic/section/tags across switches.
 */
function NormalOrClozeForm({
	active,
	cardType,
}: {
	active: boolean;
	cardType: "normal" | "cloze";
}) {
	const { app, plugin } = usePluginContext();
	const cardsById = useCardStore((s) => s.cardsById);

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
	// Cloze cards require at least one `{{cN::…}}` marker across Q/A —
	// without one, the save would produce a card with `fsrs_clozes: {}`
	// which the parser would mark invalid. Compute eagerly so the Save
	// button's disabled state reflects it.
	const clozeIndices =
		cardType === "cloze"
			? collectClozeIndices(trimmedQuestion, trimmedAnswer)
			: [];
	const hasClozeMarkers = cardType !== "cloze" || clozeIndices.length > 0;
	const canSave =
		!saving &&
		trimmedTopic.length > 0 &&
		trimmedQuestion.length > 0 &&
		trimmedAnswer.length > 0 &&
		hasClozeMarkers;

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

			let contents: string;
			if (cardType === "cloze") {
				contents = serializeClozeCard({
					topic: trimmedTopic,
					section: section.trim() || undefined,
					tags: Array.from(tags),
					today: now,
					clozeIndices,
					question: trimmedQuestion,
					answer: trimmedAnswer,
				});
			} else {
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
				contents = serializeCard({
					fm,
					question: trimmedQuestion,
					answer: trimmedAnswer,
				});
			}
			await app.vault.create(finalPath, contents);

			const filename = finalPath.split("/").pop() ?? finalPath;
			if (cardType === "cloze") {
				new Notice(
					`Created ${filename} with ${clozeIndices.length} cloze ${clozeIndices.length === 1 ? "sibling" : "siblings"}`,
				);
			} else {
				new Notice(`Created ${filename}`);
			}

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

			{cardType === "cloze" && (
				// Inline hint so the user doesn't have to remember the
				// cloze syntax. Stays visible while the form is empty;
				// turns green once at least one marker is detected.
				<p className="text-xs">
					{clozeIndices.length > 0 ? (
						<span className="text-state-review">
							{clozeIndices.length}{" "}
							{clozeIndices.length === 1 ? "cloze" : "clozes"} detected:{" "}
							{clozeIndices.map((n) => `c${n}`).join(", ")}
						</span>
					) : (
						<span className="text-muted">
							Use{" "}
							<code className="rounded bg-subtle px-1 font-mono">
								{"{{c1::answer}}"}
							</code>
							,{" "}
							<code className="rounded bg-subtle px-1 font-mono">
								{"{{c2::another}}"}
							</code>{" "}
							inside the question or answer to create cloze siblings.
						</span>
					)}
				</p>
			)}

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

/**
 * Three-way radio selector for the card kind. Same visual shape as
 * the occlusion-mode selector — stacked tiles with title + tiny
 * description — but compact horizontal layout in wide containers.
 */
const CARD_TYPE_OPTIONS: {
	value: CardType;
	label: string;
	description: string;
}[] = [
	{
		value: "normal",
		label: "Normal",
		description: "Plain question and answer.",
	},
	{
		value: "cloze",
		label: "Cloze",
		description: "Hide one or more spans via {{cN::…}} markers.",
	},
	{
		value: "occlusion",
		label: "Occlusion",
		description: "Mask rectangles on an image.",
	},
];

function CardTypeSelector({
	value,
	onChange,
}: {
	value: CardType;
	onChange: (v: CardType) => void;
}) {
	return (
		<div>
			<span className="mb-1 block text-sm font-medium text-muted!">
				Card type
			</span>
			<div className="grid grid-cols-1 gap-1.5 @[600px]:grid-cols-3">
				{CARD_TYPE_OPTIONS.map((opt) => (
					<label
						key={opt.value}
						className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-xs transition-colors ${
							value === opt.value
								? "border-accent! bg-accent/10 text-fg-strong!"
								: "border-border text-muted hover:border-accent/60"
						}`}
					>
						<input
							type="radio"
							name="card-type"
							value={opt.value}
							checked={value === opt.value}
							onChange={() => onChange(opt.value)}
							className="mt-0.5"
						/>
						<span className="flex flex-col">
							<span className="font-medium">{opt.label}</span>
							<span className="text-[11px] opacity-80">{opt.description}</span>
						</span>
					</label>
				))}
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
