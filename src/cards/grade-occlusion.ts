import type { FsrsFlatT } from "../schema/card";
import {
	readOcclusionSet,
	writeOcclusionSet,
	type OcclusionIODeps,
} from "./occlusion";

/**
 * In-process write queue keyed by JSON sidecar path. The grade write
 * is a read-modify-write cycle (read JSON → patch one mask's FSRS →
 * write JSON back); two grades on different siblings of the same set
 * landing concurrently must serialize, or the second write would
 * clobber the first's slot.
 *
 * Module-level Map (vs. a plugin field) so the queue is shared across
 * any caller — there's only ever one logical write surface per JSON
 * path. The map self-prunes when the most recent queued write
 * resolves (see the finally block in `persistOcclusionGrade`).
 */
const writeQueues: Map<string, Promise<void>> = new Map();

/**
 * Append a read-modify-write of a single mask's FSRS slot to the
 * per-JSON write queue. Returns when *this* write has landed (or
 * thrown).
 *
 * Failures inside one queued write don't poison the chain — the next
 * write's continuation absorbs the error before its own
 * read-modify-write runs. This is what makes "grade sibling 1, grade
 * sibling 2, grade sibling 1 again" all land even if the second one
 * happened to throw mid-flight.
 *
 * Parameters:
 *   - `jsonPath` — vault-absolute path to the `.occlusion.json` sidecar.
 *   - `maskIndex` — 1-based index of the mask whose FSRS to update;
 *     matches `ParsedCard.maskIndex`.
 *   - `fsrs` — the post-grade FSRS state. Re-used for both the grade
 *     path (FsrsUpdate from the engine) and the undo-restore path
 *     (previousFm projected via `fmToMaskFsrs`).
 */
export async function persistOcclusionGrade(
	deps: OcclusionIODeps,
	jsonPath: string,
	maskIndex: number,
	fsrs: FsrsFlatT,
): Promise<void> {
	const previous = writeQueues.get(jsonPath) ?? Promise.resolve();
	const next = previous
		// Swallow upstream rejections so this caller's own outcome is
		// independent of the previous write's. Without this, a failure
		// in write N strands every later write in the chain.
		.catch(() => undefined)
		.then(async () => {
			const result = await readOcclusionSet(deps, jsonPath);
			if (result.kind === "missing") {
				throw new Error(
					`cannot grade occlusion: sidecar missing at ${jsonPath}`,
				);
			}
			if (result.kind === "invalid") {
				throw new Error(
					`cannot grade occlusion: sidecar invalid at ${jsonPath} (${result.error})`,
				);
			}
			const set = result.set;
			const idx = maskIndex - 1;
			if (idx < 0 || idx >= set.masks.length) {
				throw new Error(
					`cannot grade occlusion: mask ${maskIndex} out of range (1..${set.masks.length})`,
				);
			}
			// Direct mutation is safe — `set` is the parsed-and-validated
			// object we own. The schema re-validates inside writeOcclusionSet.
			set.masks[idx]!.fsrs = fsrs;
			await writeOcclusionSet(deps, jsonPath, set);
		});
	writeQueues.set(jsonPath, next);
	try {
		await next;
	} finally {
		// Only the most-recent queued write owns the slot — clearing
		// it on resolution prevents the map from growing indefinitely.
		// If a later write chained onto this one, that later write
		// overwrote the slot already and the equality check fails.
		if (writeQueues.get(jsonPath) === next) {
			writeQueues.delete(jsonPath);
		}
	}
}

/**
 * Reset the in-process queue. Test-only — production code never
 * needs to drain the queue manually; awaiting your own
 * `persistOcclusionGrade` call is sufficient.
 */
export function _resetOcclusionWriteQueueForTests(): void {
	writeQueues.clear();
}
