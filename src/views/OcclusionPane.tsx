import { Notice, TFile, TFolder } from "obsidian";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { makeAppIODeps } from "../cards/occlusion-io";
import {
	jsonBasenameForCard,
	jsonPathForCard,
	OcclusionSet,
	readOcclusionSet,
	resolveOcclusionJsonPath,
	serializeOcclusionMarkdown,
	writeOcclusionSet,
	type OcclusionMaskT,
	type OcclusionModeT,
	type OcclusionSetT,
} from "../cards/occlusion";
import { findAvailablePath, slugify } from "../cards/new-card";
import { useCardStore } from "../cards/store";
import {
	makeMaskId,
	OcclusionEditor,
	type EditorMask,
} from "./OcclusionEditor";
import { OcclusionImagePicker } from "./OcclusionImagePicker";
import { usePluginContext } from "./PluginContext";
import { TagCombobox } from "./TagCombobox";
import { TopicCombobox } from "./TopicCombobox";

const INPUT_CLASS =
	"w-full rounded border! border-border! bg-transparent! shadow-none! px-2 py-1 text-sm text-fg-strong! focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

/**
 * Occlusion mode shell: image picker on the left, drawing surface on
 * the right, form fields + Save below. Owns the full create flow —
 * the user picks/pastes an image, draws N rectangles, fills topic /
 * section / tags, and saves; the plugin writes `<slug>.md` and
 * `<slug>.occlusion.json` colocated, then resets for the next card.
 *
 * Sticky fields (topic, section, tags) survive across saves the same
 * way they do in NewCardPane — Anki-style rapid entry.
 *
 * v1 limitations baked in:
 *   - Desktop-only — touch/mobile pointer events don't drive the
 *     editor in any usable way (drawing rectangles with a fingertip).
 *   - No image cropping/rotation; prep the source elsewhere.
 *   - No per-mask labels.
 */
export function OcclusionPane() {
	const { app, plugin } = usePluginContext();
	const cardsById = useCardStore((s) => s.cardsById);

	const [imagePath, setImagePath] = useState<string | null>(null);
	const [masks, setMasks] = useState<EditorMask[]>([]);
	const [title, setTitle] = useState("");
	const [topic, setTopic] = useState("");
	const [section, setSection] = useState("");
	const [tags, setTags] = useState<Set<string>>(new Set());
	// Mode is sticky across saves (same as topic/tags) — most users
	// stick with one workflow per study session.
	const [mode, setMode] = useState<OcclusionModeT>("hide-one");
	const [saving, setSaving] = useState(false);
	// Reorder buffer pushed up from the editor so we can show
	// "Setting to: 12…" near the hint text. Empty when the user
	// isn't actively typing a position.
	const [reorderBuffer, setReorderBuffer] = useState("");
	// Path of the card the user is editing, or `null` when creating a
	// new card. Set by the plugin's `openEditCardModal` branch for
	// occlusion siblings — see main.tsx. Drives the load-effect below
	// and the create-vs-update branch in the save flow.
	const editingPath = useCardStore((s) => s.editingOcclusionPath);
	const setEditingPath = useCardStore((s) => s.setEditingOcclusionPath);
	// Stash of the per-mask FSRS slots that came off disk when the
	// pane loaded an existing set, keyed by editor mask id. Save uses
	// this to preserve FSRS through reorder / move / resize: a mask
	// whose id is in the map projects back to its original slot; one
	// whose id isn't (a freshly-drawn mask added during the edit) gets
	// `fsrs: null` so the parser synthesizes new-state defaults.
	const originalFsrsByIdRef = useRef<Map<string, OcclusionMaskT["fsrs"]>>(
		new Map(),
	);

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
	const trimmedTitle = title.trim();
	const canSave =
		!saving &&
		imagePath !== null &&
		masks.length > 0 &&
		trimmedTopic.length > 0 &&
		trimmedTitle.length > 0;

	const reset = () => {
		// Keep sticky fields (topic, section, tags) but drop the
		// just-saved image + masks + title so the next card starts
		// fresh. Title is per-card (not sticky) — each card needs its
		// own label. Editing state goes away too — after save the
		// user is back in the create flow.
		setImagePath(null);
		setMasks([]);
		setTitle("");
		originalFsrsByIdRef.current = new Map();
		if (editingPath !== null) {
			setEditingPath(null);
		}
	};

	// Load an existing occlusion set when the user clicked the pencil
	// on an occlusion sibling. The load assigns fresh editor ids to
	// each loaded mask and remembers the original FSRS slots by id —
	// the save flow uses that map to preserve per-mask schedule state
	// across geometry edits, reorders, and mode changes.
	useEffect(() => {
		if (editingPath === null) return;
		let cancelled = false;
		void (async () => {
			const jsonPath = jsonPathForCard(editingPath);
			const result = await readOcclusionSet(makeAppIODeps(app), jsonPath);
			if (cancelled) return;
			if (result.kind !== "ok") {
				const detail =
					result.kind === "missing"
						? `missing at ${jsonPath}`
						: result.error;
				new Notice(`Cannot edit: occlusion sidecar ${detail}`);
				setEditingPath(null);
				return;
			}
			const set = result.set;
			// Pull topic / section / tags off any sibling of this card —
			// they all share the same markdown frontmatter.
			const sourceCard = Array.from(cardsById.values()).find(
				(c) => c.path === editingPath,
			);

			const idMap = new Map<string, OcclusionMaskT["fsrs"]>();
			const editorMasks: EditorMask[] = set.masks.map((m) => {
				const id = makeMaskId();
				idMap.set(id, m.fsrs);
				return { x: m.x, y: m.y, w: m.w, h: m.h, id };
			});
			originalFsrsByIdRef.current = idMap;
			setImagePath(set.image);
			setMasks(editorMasks);
			setMode(set.mode);
			if (sourceCard) {
				setTitle(sourceCard.fm.title ?? "");
				setTopic(sourceCard.fm.topic);
				setSection(sourceCard.fm.section ?? "");
				setTags(new Set(sourceCard.fm.tags));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [editingPath, app, cardsById, setEditingPath]);

	const cancelEditing = () => {
		// User abandons unsaved edits. Wipe everything and drop back
		// to the create flow — matching the post-save behavior.
		setEditingPath(null);
		setImagePath(null);
		setMasks([]);
		setTitle("");
		originalFsrsByIdRef.current = new Map();
	};

	const onSave = async () => {
		if (!canSave || imagePath === null) return;
		setSaving(true);
		try {
			const now = new Date();
			const today = now.toISOString().slice(0, 10);

			// Build the OcclusionSet payload. For each editor mask we
			// look up its id in the original-FSRS map (populated only
			// when editing): hits preserve their FSRS slot through
			// reorder / move / resize / mode change; misses (new masks
			// the user added during this session, and every mask in
			// the create flow) get `fsrs: null` so the parser
			// synthesizes new-state defaults.
			const originalById = originalFsrsByIdRef.current;
			const occlusion: OcclusionSetT = {
				image: imagePath,
				mode,
				masks: masks.map((m) => ({
					x: m.x,
					y: m.y,
					w: m.w,
					h: m.h,
					fsrs: originalById.get(m.id) ?? null,
				})),
			};
			// Defensive guard — catches schema drift between the editor
			// (which already enforces positive integer w/h) and the
			// on-disk schema.
			const guard = OcclusionSet.safeParse(occlusion);
			if (!guard.success) {
				const err = guard.error.issues
					.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
					.join("; ");
				new Notice(`Occlusion validation failed: ${err}`);
				return;
			}

			if (editingPath !== null) {
				// EDIT FLOW: existing files, update in place.
				// Markdown's `created` and the on-disk filename stay
				// put (loaded from the existing card); only `title`,
				// `modified`, topic/section/tags, and the JSON's
				// contents change. The filename intentionally doesn't
				// rename to track the new title — renaming would
				// shuffle review-log keys + every consumer of
				// `card.path`. The user can rename via Obsidian's
				// file explorer if they want the file to match.
				const jsonPath = resolveOcclusionJsonPath(
					editingPath,
					jsonBasenameForCard(editingPath),
				);
				await writeOcclusionSet(
					makeAppIODeps(app),
					jsonPath,
					guard.data,
				);
				const mdFile = app.vault.getAbstractFileByPath(editingPath);
				if (mdFile instanceof TFile) {
					await app.fileManager.processFrontMatter(mdFile, (raw) => {
						const fm = raw as Record<string, unknown>;
						fm.title = trimmedTitle;
						fm.topic = trimmedTopic;
						if (section.trim().length > 0) {
							fm.section = section.trim();
						} else {
							delete fm.section;
						}
						fm.tags = Array.from(tags);
						fm.modified = today;
					});
				}
				new Notice(
					`Updated "${trimmedTitle}" (${masks.length} mask${masks.length === 1 ? "" : "s"})`,
				);
				reset();
				return;
			}

			// CREATE FLOW: brand-new files.
			// Topic stays verbatim in frontmatter; the path segment gets
			// slashes flattened so we never accidentally nest topics.
			const sanitizedTopic = trimmedTopic.replace(/\//g, "-");
			const folder = `${plugin.normalizedCardsRoot()}${sanitizedTopic}`;
			// Filename slug comes from the user-supplied title (the
			// canonical handle the user wants to see). `slugify` handles
			// non-ASCII and length truncation; collisions get a `-2`,
			// `-3`, … suffix via `findAvailablePath`.
			const imageBasename = imagePath.split("/").pop() ?? "occlusion";
			const slug = slugify(trimmedTitle, now);
			const basePath = `${folder}/${slug}.md`;

			// Topic folder: create only if missing. createFolder throws
			// when the folder already exists — same guard as NewCardPane.
			const existingFolder = app.vault.getAbstractFileByPath(folder);
			if (existingFolder === null) {
				await app.vault.createFolder(folder);
			} else if (!(existingFolder instanceof TFolder)) {
				new Notice(`Path exists but isn't a folder: ${folder}`);
				return;
			}

			const finalMdPath = findAvailablePath(
				basePath,
				(p) => app.vault.getAbstractFileByPath(p) !== null,
				now,
			);
			const finalJsonPath = jsonPathForCard(finalMdPath);
			const jsonBasename = jsonBasenameForCard(finalMdPath);

			// Write JSON first, then markdown. If the second write fails
			// we attempt to clean up the JSON; a stranded markdown
			// without the JSON would show up as invalid in Browse on
			// the next reload, which is worse UX.
			await writeOcclusionSet(
				makeAppIODeps(app),
				finalJsonPath,
				guard.data,
			);

			const markdown = serializeOcclusionMarkdown({
				title: trimmedTitle,
				topic: trimmedTopic,
				section: section.trim() || undefined,
				tags: Array.from(tags),
				related: [],
				created: today,
				modified: today,
				occlusionSource: jsonBasename,
				imageBasename,
				maskCount: masks.length,
			});

			try {
				await app.vault.create(finalMdPath, markdown);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				// Best-effort cleanup of the just-written JSON so the
				// user isn't left with an orphan.
				let cleanupNote = "";
				try {
					const jsonFile = app.vault.getAbstractFileByPath(finalJsonPath);
					if (jsonFile instanceof TFile) {
						await app.fileManager.trashFile(jsonFile);
						cleanupNote = " The sidecar was trashed.";
					} else {
						cleanupNote = ` The sidecar at ${finalJsonPath} may be stranded.`;
					}
				} catch (cleanupErr) {
					console.error(
						"[learning-system] occlusion JSON cleanup failed:",
						cleanupErr,
					);
					cleanupNote = ` The sidecar at ${finalJsonPath} could not be cleaned up.`;
				}
				new Notice(`Markdown write failed (${msg}).${cleanupNote}`);
				return;
			}

			new Notice(
				`Created "${trimmedTitle}" with ${masks.length} mask${masks.length === 1 ? "" : "s"}`,
			);
			reset();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] occlusion save failed:", e);
			new Notice(`Save failed: ${msg}`);
		} finally {
			setSaving(false);
		}
	};

	// Two distinct screens:
	//   1. Pre-image — the picker takes the full width, centered. The
	//      user's only job is to pick or drop a source image.
	//   2. Post-image — sticky header with the chosen image's filename
	//      and a "Change image" button; everything below (mode, editor,
	//      form fields, Save) scrolls as one column.
	// The split keeps the editor uncluttered when the user is still
	// choosing a source, and gives the editor maximum horizontal room
	// once they've picked one. The picker re-mounts on "Change image"
	// so the scroll position and thumbnail focus reset cleanly.
	if (imagePath === null) {
		return (
			<div className="flex h-full flex-col items-center justify-start gap-4 py-6">
				<div className="w-full max-w-md">
					<Field label="Image">
						<OcclusionImagePicker
							selected={null}
							onSelect={setImagePath}
						/>
					</Field>
				</div>
			</div>
		);
	}

	const imageBasename = imagePath.split("/").pop() ?? imagePath;
	const isEditing = editingPath !== null;
	const editingSlug = isEditing
		? (editingPath.split("/").pop() ?? editingPath)
		: null;
	return (
		<div className="flex h-full flex-col">
			{/* Pinned header. Stays put because it's a `shrink-0` flex
			    sibling outside the scroll container — no `sticky`
			    needed. Carries the source-image identity + the
			    header-level actions. In edit mode the left side
			    shows "Editing <slug>"; in create mode it shows just
			    the image filename. */}
			<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-bg py-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					{isEditing && (
						<span className="text-[10px] font-medium uppercase tracking-wider text-accent">
							Editing · {editingSlug}
						</span>
					)}
					<div className="flex min-w-0 items-center gap-2">
						{/* Show the title (truncated) when set;
						    otherwise fall back to the image basename
						    so the header isn't empty mid-edit. */}
						<span className="truncate text-sm font-medium text-fg-strong">
							{trimmedTitle.length > 0 ? trimmedTitle : imageBasename}
						</span>
						<span className="shrink-0 text-[11px] text-muted">
							{masks.length} mask{masks.length === 1 ? "" : "s"}
						</span>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{isEditing ? (
						<button
							type="button"
							className="ls-btn-outline rounded px-2 py-1 text-xs"
							onClick={cancelEditing}
						>
							Cancel
						</button>
					) : (
						<button
							type="button"
							className="ls-btn-outline rounded px-2 py-1 text-xs"
							onClick={() => {
								// Drop the chosen image and any in-progress
								// masks — the user is starting over with a
								// new source. Sticky form fields (topic,
								// section, tags) survive because the user
								// almost always wants them across cards.
								setImagePath(null);
								setMasks([]);
							}}
						>
							Change image
						</button>
					)}
					<button
						type="button"
						className="ls-btn-primary rounded px-3 py-1 text-sm"
						disabled={!canSave}
						onClick={() => void onSave()}
					>
						{saving ? "Saving…" : isEditing ? "Save changes" : "Save"}
					</button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
				<Field label="Mode">
					<ModeSelector mode={mode} onChange={setMode} />
				</Field>

				<OcclusionEditor
					imagePath={imagePath}
					masks={masks}
					onChange={setMasks}
					mode={mode}
					onReorderBufferChange={setReorderBuffer}
				/>
				<p className="text-xs text-muted">
					Drag to draw · click to select · drag handles to resize · Backspace to remove · Esc to deselect
					{mode === "reveal-in-order" && (
						<>
							{" · "}
							<span className="text-fg-strong">
								Type a position (1–{Math.max(masks.length, 1)}) with a mask selected; Enter to commit.
							</span>
							{reorderBuffer.length > 0 && (
								<>
									{" · "}
									<span className="rounded bg-accent/20 px-1.5 py-0.5 font-mono text-fg-strong">
										Setting to: {reorderBuffer}…
									</span>
								</>
							)}
						</>
					)}
				</p>

				<div className="flex flex-col gap-3 border-t border-border pt-3">
					<Field label="Title">
						<input
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							className={INPUT_CLASS}
							placeholder="Anatomy of the heart"
						/>
					</Field>

					<Field label="Topic">
						<TopicCombobox
							value={topic}
							onChange={setTopic}
							allTopics={allTopics}
							placeholder="anatomy"
						/>
					</Field>

					<Field label="Section" optional>
						<input
							type="text"
							value={section}
							onChange={(e) => setSection(e.target.value)}
							className={INPUT_CLASS}
							placeholder="cardiology"
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

					{/* Footer Save mirrors the sticky-header Save so the
					    user can commit without scrolling back up after
					    filling out the form. */}
					<div className="flex justify-end">
						<button
							type="button"
							className="ls-btn-primary rounded px-3 py-1 text-sm"
							disabled={!canSave}
							onClick={() => void onSave()}
						>
							{saving
								? "Saving…"
								: isEditing
									? "Save changes"
									: "Save occlusion card"}
						</button>
					</div>
				</div>
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

/**
 * Stacked radio group for the three review modes. Native `<input
 * type="radio">` so screen readers and keyboard navigation work
 * without bespoke handling. Descriptions live alongside the label —
 * the differences between modes are non-obvious from the name alone.
 */
const MODE_OPTIONS: { value: OcclusionModeT; label: string; description: string }[] = [
	{
		value: "hide-one",
		label: "Hide one",
		description:
			"One rectangle is covered per sibling; the rest are visible.",
	},
	{
		value: "show-one",
		label: "Show one",
		description:
			"Only one rectangle is visible per sibling; everything else is covered.",
	},
	{
		value: "reveal-in-order",
		label: "Reveal in order",
		description:
			"Masks are uncovered one by one; earlier siblings stay revealed.",
	},
];

function ModeSelector({
	mode,
	onChange,
}: {
	mode: OcclusionModeT;
	onChange: (m: OcclusionModeT) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			{MODE_OPTIONS.map((opt) => (
				<label
					key={opt.value}
					className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-xs transition-colors ${
						mode === opt.value
							? "border-accent! bg-accent/10 text-fg-strong!"
							: "border-border text-muted hover:border-accent/60"
					}`}
				>
					<input
						type="radio"
						name="occlusion-mode"
						value={opt.value}
						checked={mode === opt.value}
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
	);
}
