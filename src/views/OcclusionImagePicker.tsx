import { Notice, TFile } from "obsidian";
import {
	useEffect,
	useMemo,
	useState,
	type ChangeEvent,
	type DragEvent,
} from "react";

import {
	extensionForMime,
	saveAttachment,
} from "../cards/image-attachment";
import { usePluginContext } from "./PluginContext";

interface Props {
	/** Currently selected image (vault-relative path), or null when none. */
	selected: string | null;
	/** Notify the host when the user picks or drops a new image. */
	onSelect: (path: string) => void;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Grid of existing `_attachments/` image thumbnails plus a paste/drop
 * zone for ingesting a fresh image. Bridges the existing
 * `saveAttachment` pipeline (used by the embedded editor) into the
 * occlusion flow — same file naming, same folder.
 *
 * Scope intentionally limited to images already inside
 * `<cardsRoot>/_attachments/` (per the doc's design decision #6).
 * Users with images elsewhere in the vault can paste them in; the
 * paste route saves a copy into `_attachments/` like any other paste.
 */
export function OcclusionImagePicker({ selected, onSelect }: Props) {
	const { app, plugin } = usePluginContext();
	const [ingesting, setIngesting] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	// Bumps on vault events that may change the image list. Threaded
	// into the `images` useMemo's deps so the filter recomputes when
	// the underlying file set changes — a plain forceUpdate trick
	// would re-render but useMemo wouldn't see new files because
	// `[app, attachmentsDir]` are both stable across renders.
	const [vaultTick, setVaultTick] = useState(0);

	const attachmentsDir = useMemo(() => {
		const root = plugin.normalizedCardsRoot();
		return `${root}_attachments`;
	}, [plugin]);

	// Re-list whenever the `_attachments/` folder changes. Scoping the
	// event filter to attachments-prefixed paths avoids waking up on
	// every unrelated vault write — same vault-event firehose otherwise
	// drives the rest of the plugin, but image pickers are mounted
	// rarely so cheap-per-event matters.
	useEffect(() => {
		const bump = (path: string) => {
			if (!path.startsWith(attachmentsDir)) return;
			setVaultTick((t) => t + 1);
		};
		const refs = [
			app.vault.on("create", (f) => bump(f.path)),
			app.vault.on("delete", (f) => bump(f.path)),
			app.vault.on("rename", (f, oldPath) => {
				if (
					f.path.startsWith(attachmentsDir) ||
					oldPath.startsWith(attachmentsDir)
				) {
					setVaultTick((t) => t + 1);
				}
			}),
		];
		return () => {
			for (const ref of refs) app.vault.offref(ref);
		};
	}, [app, attachmentsDir]);

	// `vaultTick` is the seam that triggers recomputation on
	// vault.create / delete / rename inside the attachments folder.
	// Reading it here keeps lint happy without an eslint-disable.
	void vaultTick;
	const images = useMemo(() => {
		const out: TFile[] = [];
		for (const file of app.vault.getFiles()) {
			if (!file.path.startsWith(attachmentsDir)) continue;
			if (!IMAGE_EXT_RE.test(file.path)) continue;
			out.push(file);
		}
		// Newest first — matches what most users want after a fresh paste.
		out.sort((a, b) => b.stat.mtime - a.stat.mtime);
		return out;
	}, [app, attachmentsDir, vaultTick]);

	const ingestBlob = async (file: File): Promise<void> => {
		if (ingesting) return;
		// Gate to MIMEs `saveAttachment` knows how to write.
		if (!file.type.startsWith("image/") || extensionForMime(file.type) === "bin") {
			new Notice(
				`Unsupported image type: ${file.type}. Use png, jpeg, gif, or webp.`,
			);
			return;
		}
		setIngesting(true);
		try {
			const { path } = await saveAttachment(
				{
					exists: (p) => app.vault.getAbstractFileByPath(p) !== null,
					ensureFolder: async (p) => {
						await app.vault.createFolder(p);
					},
					writeBinary: async (p, data) => {
						await app.vault.createBinary(p, data);
					},
				},
				plugin.normalizedCardsRoot(),
				file,
				{ hint: file.name },
			);
			onSelect(path);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] occlusion image ingest failed:", e);
			new Notice(`Image upload failed: ${msg}`);
		} finally {
			setIngesting(false);
		}
	};

	const onDrop = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file) void ingestBlob(file);
	};

	const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		// Reset so the same filename can be picked twice in a row.
		e.target.value = "";
		if (file) void ingestBlob(file);
	};

	return (
		<div className="flex flex-col gap-3">
			<div
				onDragOver={(e) => {
					e.preventDefault();
					setDragOver(true);
				}}
				onDragLeave={() => setDragOver(false)}
				onDrop={onDrop}
				className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-center text-xs transition-colors ${
					dragOver
						? "border-accent bg-accent/10 text-fg-strong"
						: "border-border text-muted hover:border-accent/60"
				}`}
			>
				<span>
					{ingesting
						? "Uploading…"
						: dragOver
							? "Drop to add"
							: "Drop an image, or"}
				</span>
				<label
					className="ls-btn-outline cursor-pointer rounded px-2 py-1 text-xs"
					aria-disabled={ingesting}
				>
					Choose file
					<input
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						className="hidden"
						onChange={onFileInput}
						disabled={ingesting}
					/>
				</label>
			</div>

			{images.length === 0 ? (
				<p className="text-xs text-muted">
					No images in {attachmentsDir} yet. Drop or pick one above.
				</p>
			) : (
				// Photo-strip layout: each thumb keeps its natural
				// aspect ratio (uniform 56px height, width auto), and
				// `flex-wrap` packs as many as fit per row. No
				// filename labels — the image itself is the
				// identifier; hover surfaces the basename via
				// `title=` for users who need to confirm.
				<div className="flex flex-wrap gap-1">
					{images.map((file) => (
						<ThumbnailTile
							key={file.path}
							file={file}
							isSelected={file.path === selected}
							onClick={() => onSelect(file.path)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

interface ThumbProps {
	file: TFile;
	isSelected: boolean;
	onClick: () => void;
}

function ThumbnailTile({ file, isSelected, onClick }: ThumbProps) {
	const { app } = usePluginContext();
	const url = app.vault.adapter.getResourcePath(file.path);
	const basename = file.path.split("/").pop() ?? file.path;
	return (
		<button
			type="button"
			onClick={onClick}
			title={basename}
			className={`ls-flat overflow-hidden rounded-sm p-0! transition-all ${
				isSelected
					? "ring-2 ring-accent ring-offset-1 ring-offset-bg"
					: "opacity-80 hover:opacity-100"
			}`}
		>
			<img
				src={url}
				alt={basename}
				// Natural-size preview with a max-bound cap. Small
				// images render at their actual pixel size (no
				// upscaling); large images shrink proportionally so a
				// 3000px-wide screenshot doesn't blow out the picker.
				// Width/height are both `auto` so aspect ratio comes
				// straight from the file — no cropping (`object-cover`
				// removed) and no letterboxing. `block` strips the
				// inline descender gap.
				className="block h-auto w-auto max-h-32 max-w-48"
				draggable={false}
				loading="lazy"
			/>
		</button>
	);
}
