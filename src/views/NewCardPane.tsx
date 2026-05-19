import { Notice, TFolder } from "obsidian";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";

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

const INPUT_CLASS =
	"w-full rounded border! border-border! bg-transparent! shadow-none! px-2 py-1 text-sm text-fg! focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

/**
 * Right-sidebar pane for creating flashcards — Anki-style rapid entry.
 * Save resets Question/Answer and refocuses Question; Topic / Section /
 * Tags persist across saves until the user edits them. There is no
 * Cancel button — the pane is dismissed by closing its tab, like Browse
 * and Review.
 */
export function NewCardPane() {
	const { app, plugin } = usePluginContext();
	const cardsByPath = useCardStore((s) => s.cardsByPath);

	const [topic, setTopic] = useState("");
	const [section, setSection] = useState("");
	const [tags, setTags] = useState<Set<string>>(new Set());
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [saving, setSaving] = useState(false);

	const questionRef = useRef<MarkdownFieldHandle>(null);

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
		<div className="flex flex-col gap-4 px-6 pt-3 pb-6">
			<header className="flex items-center justify-between gap-2">
				<h2 className="m-0 text-base font-semibold">New card</h2>
			</header>

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
					compact
				/>
			</Field>

			<MarkdownField
				ref={questionRef}
				label="Question"
				value={question}
				onChange={setQuestion}
				autoFocus
			/>

			<MarkdownField
				label="Answer"
				value={answer}
				onChange={setAnswer}
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
			<span className="text-xs font-medium text-muted!">
				{label}
				{optional && <span className="text-muted!"> (optional)</span>}
			</span>
			{children}
		</div>
	);
}

/**
 * Single-select combobox with free input — Topic field. Mirrors
 * `TagCombobox`'s trigger row + portaled dropdown layout (input on the
 * left, chevron button on the right) so the two fields read as visually
 * matching. Free input is the primary path; the dropdown is a
 * convenience for picking an existing topic.
 *
 * Kept inline per the plan ("no separate component file for the topic
 * combobox in v1").
 */
function TopicCombobox({
	value,
	onChange,
	allTopics,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	allTopics: string[];
	placeholder?: string;
}) {
	const [open, setOpen] = useState(false);
	const [highlighted, setHighlighted] = useState(0);
	const [isDark, setIsDark] = useState(false);
	const [panelStyle, setPanelStyle] = useState<{
		top: number;
		right: number;
	}>({ top: 0, right: 0 });

	const triggerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const chevronRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const matches = useMemo(() => {
		const q = value.trim().toLowerCase();
		if (q === "") return allTopics;
		return allTopics.filter((t) => t.toLowerCase().includes(q));
	}, [value, allTopics]);

	useEffect(() => {
		if (highlighted >= matches.length) setHighlighted(0);
	}, [matches.length, highlighted]);

	useLayoutEffect(() => {
		if (!open) return;
		const chevron = chevronRef.current;
		if (!chevron) return;
		const rect = chevron.getBoundingClientRect();
		setPanelStyle({
			top: rect.bottom + 4,
			right: window.innerWidth - rect.right,
		});
		const root = chevron.closest(".learning-system-root");
		setIsDark(root?.classList.contains("dark") ?? false);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			const target = e.target;
			if (!(target instanceof Node)) return;
			if (triggerRef.current?.contains(target)) return;
			if (panelRef.current?.contains(target)) return;
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	const pick = (topic: string) => {
		onChange(topic);
		setOpen(false);
	};

	const handleKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setOpen(true);
			setHighlighted((h) =>
				matches.length === 0 ? 0 : (h + 1) % matches.length,
			);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setOpen(true);
			setHighlighted((h) =>
				matches.length === 0
					? 0
					: (h - 1 + matches.length) % matches.length,
			);
		} else if (e.key === "Enter") {
			if (open && matches.length > 0) {
				e.preventDefault();
				const t = matches[highlighted];
				if (t !== undefined) pick(t);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
		}
	};

	return (
		<>
			<div
				ref={triggerRef}
				className="flex items-center gap-1 py-1"
				onClick={() => inputRef.current?.focus()}
			>
				<input
					ref={inputRef}
					type="text"
					value={value}
					placeholder={placeholder}
					onChange={(e) => {
						onChange(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={handleKey}
					className="min-w-24 flex-1 bg-transparent! text-sm text-fg! outline-none"
				/>
				<button
					ref={chevronRef}
					type="button"
					className="shrink-0 rounded border! border-border! bg-transparent! shadow-none! p-1! text-fg! transition-colors hover:bg-subtle!"
					onClick={(e) => {
						// stopPropagation: the trigger <div> has its own
						// onClick that refocuses the input. Without
						// stopping here, a click on the chevron bubbles
						// to the trigger, refocuses the input, and the
						// input's onFocus → setOpen(true) undoes our
						// close.
						e.stopPropagation();
						const willOpen = !open;
						setOpen(willOpen);
						if (willOpen) inputRef.current?.focus();
					}}
					aria-label="Toggle topic suggestions"
					aria-expanded={open}
				>
					<ChevronIcon open={open} />
				</button>
			</div>
			{open &&
				matches.length > 0 &&
				createPortal(
					<div
						ref={panelRef}
						style={{
							position: "fixed",
							top: panelStyle.top,
							right: panelStyle.right,
							zIndex: 1000,
							backgroundColor: isDark
								? "rgb(38, 38, 42)"
								: "rgb(250, 245, 235)",
						}}
						className={`learning-system-root ${isDark ? "dark" : ""} w-fit min-w-45 max-h-[60vh] overflow-y-auto rounded-md border border-border shadow-md`}
					>
						<ul className="m-0 list-none p-0">
							{matches.map((t, i) => (
								<li key={t}>
									<button
										type="button"
										className={`ls-tag-option flex w-full items-center px-3 py-1.5 text-left text-sm${
											i === highlighted ? " is-highlighted" : ""
										}`}
										onMouseEnter={() => setHighlighted(i)}
										onClick={() => pick(t)}
									>
										{t}
									</button>
								</li>
							))}
						</ul>
					</div>,
					document.body,
				)}
		</>
	);
}

function ChevronIcon({ open }: { open: boolean }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
		>
			<polyline points="6 9 12 15 18 9" />
		</svg>
	);
}
