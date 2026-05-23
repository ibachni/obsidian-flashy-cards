import { beforeEach, describe, expect, it } from "vitest";

import type { FsrsFlatT } from "../schema/card";
import {
	_resetOcclusionWriteQueueForTests,
	persistOcclusionGrade,
} from "./grade-occlusion";
import type { OcclusionIODeps, OcclusionSetT } from "./occlusion";

function fakeStorage(initial: Record<string, string> = {}): {
	deps: OcclusionIODeps;
	store: Map<string, string>;
	writes: string[];
} {
	const store = new Map<string, string>(Object.entries(initial));
	const writes: string[] = [];
	const deps: OcclusionIODeps = {
		read: async (p) => (store.has(p) ? store.get(p)! : null),
		write: async (p, c) => {
			writes.push(p);
			store.set(p, c);
		},
	};
	return { deps, store, writes };
}

const scheduledFsrs = (due: string, reps = 3): FsrsFlatT => ({
	fsrs_due: due,
	fsrs_stability: 4.2,
	fsrs_difficulty: 6.1,
	fsrs_elapsed_days: 3,
	fsrs_scheduled_days: 7,
	fsrs_learning_steps: 0,
	fsrs_reps: reps,
	fsrs_lapses: 0,
	fsrs_state: "review",
	fsrs_last_review: "2026-05-22",
});

const seedSet: OcclusionSetT = {
	image: "_attachments/heart.png",
	mode: "hide-one",
	masks: [
		{ x: 10, y: 10, w: 30, h: 30, fsrs: null },
		{ x: 50, y: 50, w: 30, h: 30, fsrs: null },
		{ x: 90, y: 90, w: 30, h: 30, fsrs: null },
	],
};

beforeEach(() => {
	_resetOcclusionWriteQueueForTests();
});

describe("persistOcclusionGrade", () => {
	it("updates the target mask's fsrs slot and leaves siblings untouched", async () => {
		const { deps, store } = fakeStorage({
			"x/heart.occlusion.json": JSON.stringify(seedSet),
		});
		const update = scheduledFsrs("2026-06-01");
		await persistOcclusionGrade(deps, "x/heart.occlusion.json", 1, update);

		const written = JSON.parse(store.get("x/heart.occlusion.json")!) as OcclusionSetT;
		expect(written.masks[0]!.fsrs).toEqual(update);
		// Other masks remain null — critical invariant.
		expect(written.masks[1]!.fsrs).toBeNull();
		expect(written.masks[2]!.fsrs).toBeNull();
		// Image and mask geometry preserved.
		expect(written.image).toBe(seedSet.image);
		expect(written.masks[0]!.x).toBe(10);
		expect(written.masks[0]!.w).toBe(30);
	});

	it("serializes concurrent grades on different siblings of the same set", async () => {
		// Two grades on masks 1 and 2, both started before either has
		// resolved. The queue must serialize the read-modify-write
		// cycles so the second's read sees the first's write — final
		// JSON has both updates.
		const { deps, store } = fakeStorage({
			"x/heart.occlusion.json": JSON.stringify(seedSet),
		});
		const u1 = scheduledFsrs("2026-06-01", 1);
		const u2 = scheduledFsrs("2026-06-02", 2);
		// Kick both off without awaiting between — exercises the queue.
		await Promise.all([
			persistOcclusionGrade(deps, "x/heart.occlusion.json", 1, u1),
			persistOcclusionGrade(deps, "x/heart.occlusion.json", 2, u2),
		]);

		const written = JSON.parse(store.get("x/heart.occlusion.json")!) as OcclusionSetT;
		expect(written.masks[0]!.fsrs?.fsrs_due).toBe("2026-06-01");
		expect(written.masks[1]!.fsrs?.fsrs_due).toBe("2026-06-02");
		expect(written.masks[2]!.fsrs).toBeNull();
	});

	it("throws on a missing sidecar without writing anything", async () => {
		const { deps, writes } = fakeStorage({}); // no file at all
		await expect(
			persistOcclusionGrade(
				deps,
				"x/missing.occlusion.json",
				1,
				scheduledFsrs("2026-06-01"),
			),
		).rejects.toThrow(/sidecar missing/);
		expect(writes).toEqual([]);
	});

	it("throws on an invalid sidecar without writing", async () => {
		const { deps, writes } = fakeStorage({
			"x/bad.occlusion.json": "{ not json",
		});
		await expect(
			persistOcclusionGrade(
				deps,
				"x/bad.occlusion.json",
				1,
				scheduledFsrs("2026-06-01"),
			),
		).rejects.toThrow(/sidecar invalid/);
		expect(writes).toEqual([]);
	});

	it("throws on a mask index out of range without writing", async () => {
		const { deps, writes } = fakeStorage({
			"x/heart.occlusion.json": JSON.stringify(seedSet),
		});
		await expect(
			persistOcclusionGrade(
				deps,
				"x/heart.occlusion.json",
				99,
				scheduledFsrs("2026-06-01"),
			),
		).rejects.toThrow(/out of range/);
		expect(writes).toEqual([]);
	});

	it("a failure in one queued write doesn't strand later writes", async () => {
		// First write hits an out-of-range mask (rejects without
		// writing); second write must still land. Verifies the
		// `.catch(() => undefined)` on the chain — a rejection in
		// write N can't poison write N+1.
		const { deps, store } = fakeStorage({
			"x/heart.occlusion.json": JSON.stringify(seedSet),
		});

		const failing = persistOcclusionGrade(
			deps,
			"x/heart.occlusion.json",
			99, // out of range
			scheduledFsrs("2026-06-01"),
		);
		const ok = persistOcclusionGrade(
			deps,
			"x/heart.occlusion.json",
			2,
			scheduledFsrs("2026-06-02"),
		);
		await expect(failing).rejects.toThrow(/out of range/);
		await expect(ok).resolves.toBeUndefined();
		const written = JSON.parse(store.get("x/heart.occlusion.json")!) as OcclusionSetT;
		expect(written.masks[1]!.fsrs?.fsrs_due).toBe("2026-06-02");
		// Mask 0 was never written — failing call rejected before write.
		expect(written.masks[0]!.fsrs).toBeNull();
	});
});
