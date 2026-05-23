import { Notice, TFile } from "obsidian";
import { useEffect, useRef } from "react";

import { jsonPathForCard } from "../cards/occlusion";
import type { ParsedCard } from "../cards/parser";
import { useCardStore } from "../cards/store";
import { usePluginContext } from "./PluginContext";

interface Props {
	card: ParsedCard;
	/** Called after a successful delete, before the modal closes. */
	onAfterDelete?: () => void;
	onClosed: () => void;
}

/**
 * Confirmation prompt for deleting a card. Renders inside an Obsidian
 * `Modal` host (see `LearningSystemDeleteCardConfirm` in main.tsx).
 *
 * The delete path:
 *   1. `app.fileManager.trashFile(file)` — respects the user's
 *      trash preference (system trash or `.trash/` inside the vault).
 *   2. Optimistic `removeCard` so Browse / Review re-render in the same
 *      tick. The `vault.on("delete")` listener will run a moment later
 *      and removeCard is idempotent — no double-handling.
 *   3. Prune the deleted path from `reviewScope`, so a scoped session
 *      doesn't carry a dead reference.
 */
export function DeleteCardConfirm({ card, onAfterDelete, onClosed }: Props) {
	const { app } = usePluginContext();
	const cardsById = useCardStore((s) => s.cardsById);

	const cancelRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		// Cancel is the default-focused button — Enter on open must not
		// delete. Focus it after mount.
		cancelRef.current?.focus();
	}, []);

	const slug = card.path.split("/").pop()?.replace(/\.md$/, "") ?? card.path;
	const display = `${card.fm.topic}/${slug}.md`;
	const reps = card.fm.fsrs_reps;
	const repsLabel = `${reps} ${reps === 1 ? "review" : "reviews"}`;

	// Both cloze and occlusion cards have N siblings sharing one file
	// (or pair of files). Count them so the confirm copy is honest
	// about the blast radius — deleting one sibling deletes the whole
	// set in both cases. Non-sibling cards stay at 0.
	const isCloze = card.clozeIndex !== null;
	const isOcclusion = card.maskIndex !== undefined;
	const siblingCount =
		!isCloze && !isOcclusion
			? 0
			: Array.from(cardsById.values()).filter((c) => c.path === card.path)
					.length;

	const onDelete = async () => {
		try {
			const file = app.vault.getAbstractFileByPath(card.path);
			if (!(file instanceof TFile)) {
				// Nothing to trash — drop the stale store entry so the row
				// stops showing and dismiss the prompt instead of leaving
				// the user on a confirm with no actionable target.
				new Notice(`Card file missing: ${card.path}`);
				useCardStore.getState().removeCard(card.path);
				onClosed();
				return;
			}

			await app.fileManager.trashFile(file);

			// Occlusion cards have a paired `.occlusion.json` sidecar.
			// Trash it alongside the markdown so the delete leaves no
			// orphaned files. Best-effort — a missing sidecar is fine
			// (a stale state we never recovered), and any error stays
			// in the console so the markdown delete still completes.
			if (isOcclusion) {
				try {
					const jsonPath = jsonPathForCard(card.path);
					const jsonFile = app.vault.getAbstractFileByPath(jsonPath);
					if (jsonFile instanceof TFile) {
						await app.fileManager.trashFile(jsonFile);
					}
				} catch (e) {
					console.error(
						"[learning-system] failed to trash paired occlusion sidecar:",
						e,
					);
				}
			}

			const store = useCardStore.getState();
			store.removeCard(card.path);
			// Prune from review scope so a scoped session doesn't carry a
			// dead path. Skip when the scope is null (unscoped) or doesn't
			// include this card.
			const scope = store.reviewScope;
			if (scope !== null && scope.includes(card.path)) {
				store.setReviewScope(scope.filter((p) => p !== card.path));
			}

			new Notice(`Deleted ${slug}.md`);
			onAfterDelete?.();
			onClosed();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[learning-system] delete card failed:", e);
			new Notice(`Failed to delete: ${msg}`);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<h2 className="text-base font-medium text-fg-strong! m-0">
				{isOcclusion && siblingCount > 1
					? `Delete this occlusion set (${siblingCount} cards)?`
					: siblingCount > 1
						? `Delete this file and all ${siblingCount} cloze siblings?`
						: "Delete this card?"}
			</h2>

			<div className="flex flex-col gap-1 text-sm text-muted!">
				<span className="font-mono text-fg!">{display}</span>
				<span className="text-xs uppercase tracking-wider">
					{card.fm.fsrs_state} · due {card.fm.fsrs_due} · {repsLabel}
				</span>
			</div>

			<p className="text-sm text-muted! m-0">
				{isOcclusion && siblingCount > 1
					? `This row is one of ${siblingCount} occlusion siblings sharing the same image. Deleting trashes both the .md file and its paired .occlusion.json sidecar — every sibling goes with them. Both files can be restored from the trash.`
					: siblingCount > 1
						? `This row is one of ${siblingCount} cloze siblings sharing the same file. Deleting removes the file — every sibling goes with it. The file moves to the trash and can be restored.`
						: "The file moves to the trash and can be restored."}
			</p>

			<div className="flex justify-end gap-2">
				<button
					ref={cancelRef}
					type="button"
					className="ls-btn-outline rounded px-3 py-1 text-sm"
					onClick={onClosed}
				>
					Cancel
				</button>
				<button
					type="button"
					className="ls-btn-danger rounded px-3 py-1 text-sm"
					onClick={() => void onDelete()}
				>
					Delete
				</button>
			</div>
		</div>
	);
}
