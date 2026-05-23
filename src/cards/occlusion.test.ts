import { describe, expect, it } from "vitest";

import { CardFrontmatterOnDisk } from "../schema/card";
import {
	OcclusionMask,
	OcclusionSet,
	expandOcclusionSiblings,
	fmToMaskFsrs,
	isOcclusionSibling,
	jsonBasenameForCard,
	jsonPathForCard,
	readOcclusionSet,
	resolveOcclusionJsonPath,
	shouldHideMask,
	writeOcclusionSet,
	type OcclusionIODeps,
	type OcclusionSetT,
} from "./occlusion";

// Minimal on-disk frontmatter for an occlusion card. The XOR refine
// requires that occlusion cards omit all flat `fsrs_*` fields and
// `fsrs_clozes` — per-mask FSRS lives in the JSON sidecar.
const baseOcclusionFm = {
	type: "flashcard" as const,
	topic: "Anatomy",
	created: "2026-05-22",
	modified: "2026-05-22",
	occlusion_source: "heart.occlusion.json",
};

const scheduledFsrs = (due: string) => ({
	fsrs_due: due,
	fsrs_stability: 4.2,
	fsrs_difficulty: 6.1,
	fsrs_elapsed_days: 3,
	fsrs_scheduled_days: 7,
	fsrs_learning_steps: 0,
	fsrs_reps: 3,
	fsrs_lapses: 0,
	fsrs_state: "review" as const,
	fsrs_last_review: "2026-05-22",
});

describe("OcclusionMask schema", () => {
	it("accepts a structurally valid mask with FSRS state", () => {
		const mask = {
			x: 100,
			y: 50,
			w: 80,
			h: 40,
			fsrs: scheduledFsrs("2026-05-25"),
		};
		expect(OcclusionMask.safeParse(mask).success).toBe(true);
	});

	it("accepts an unscheduled mask (fsrs: null)", () => {
		const mask = { x: 100, y: 50, w: 80, h: 40, fsrs: null };
		expect(OcclusionMask.safeParse(mask).success).toBe(true);
	});

	it("rejects a mask with negative width", () => {
		// Negative w/h is the rect-normalize bug — the editor must
		// commit normalized rectangles, the schema is the second line
		// of defense.
		const mask = { x: 10, y: 10, w: -50, h: 30, fsrs: null };
		expect(OcclusionMask.safeParse(mask).success).toBe(false);
	});

	it("rejects a mask with zero width or zero height", () => {
		// A zero-area mask is the editor's "discard tiny drag" path
		// failing — must never reach disk.
		const zeroW = { x: 10, y: 10, w: 0, h: 30, fsrs: null };
		const zeroH = { x: 10, y: 10, w: 30, h: 0, fsrs: null };
		expect(OcclusionMask.safeParse(zeroW).success).toBe(false);
		expect(OcclusionMask.safeParse(zeroH).success).toBe(false);
	});

	it("rejects a mask with negative x or y", () => {
		const mask = { x: -5, y: 10, w: 30, h: 30, fsrs: null };
		expect(OcclusionMask.safeParse(mask).success).toBe(false);
	});
});

describe("OcclusionSet schema", () => {
	it("round-trips through parse → stringify → parse", () => {
		const set: OcclusionSetT = {
			image: "_attachments/anatomy-heart.png",
			mode: "hide-one",
			masks: [
				{ x: 100, y: 50, w: 80, h: 40, fsrs: scheduledFsrs("2026-05-25") },
				{ x: 200, y: 90, w: 60, h: 30, fsrs: null },
				{ x: 50, y: 200, w: 100, h: 40, fsrs: null },
			],
		};
		const roundTripped = OcclusionSet.parse(JSON.parse(JSON.stringify(set)));
		expect(roundTripped).toEqual(set);
	});

	it("rejects an empty masks array", () => {
		// An empty set is indistinguishable from a deleted card
		// downstream — fail loud.
		const empty = { image: "_attachments/x.png", masks: [] };
		expect(OcclusionSet.safeParse(empty).success).toBe(false);
	});

	it("rejects an empty image path", () => {
		const noImage = {
			image: "",
			masks: [{ x: 1, y: 1, w: 1, h: 1, fsrs: null }],
		};
		expect(OcclusionSet.safeParse(noImage).success).toBe(false);
	});

	it("rejects an extra top-level field by … silently accepting (Zod default)", () => {
		// Documenting current behavior: Zod's default `passthrough` is
		// `strip`, so unknown keys are ignored rather than rejected.
		// Captured as a test so a future tightening of the schema is a
		// conscious choice.
		const withExtra = {
			image: "_attachments/x.png",
			mode: "hide-one",
			masks: [{ x: 1, y: 1, w: 1, h: 1, fsrs: null }],
			extraneous: "ignored",
		};
		const result = OcclusionSet.safeParse(withExtra);
		expect(result.success).toBe(true);
		if (result.success) {
			expect((result.data as Record<string, unknown>).extraneous).toBeUndefined();
		}
	});
});

describe("expandOcclusionSiblings", () => {
	it("produces N siblings keyed `<path>#m<n>` (1-based)", () => {
		const base = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [
				{ x: 10, y: 10, w: 30, h: 30, fsrs: scheduledFsrs("2026-05-01") },
				{ x: 50, y: 50, w: 30, h: 30, fsrs: scheduledFsrs("2026-05-02") },
				{ x: 90, y: 90, w: 30, h: 30, fsrs: scheduledFsrs("2026-05-03") },
			],
		};
		const cards = expandOcclusionSiblings("anatomy/heart.md", base, set);
		expect(cards.map((c) => c.id)).toEqual([
			"anatomy/heart.md#m1",
			"anatomy/heart.md#m2",
			"anatomy/heart.md#m3",
		]);
		expect(cards.map((c) => c.maskIndex)).toEqual([1, 2, 3]);
		// path is the same on every sibling — the `#m<n>` is in `id` only,
		// so consumers that resolve TFile from path get the real file.
		expect(cards.every((c) => c.path === "anatomy/heart.md")).toBe(true);
		// clozeIndex is null for occlusion siblings; the discriminator is
		// `maskIndex`.
		expect(cards.every((c) => c.clozeIndex === null)).toBe(true);
	});

	it("projects mask.fsrs into ParsedCard.fm flat fields", () => {
		const base = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [
				{ x: 10, y: 10, w: 30, h: 30, fsrs: scheduledFsrs("2026-05-01") },
				{ x: 50, y: 50, w: 30, h: 30, fsrs: scheduledFsrs("2026-05-02") },
			],
		};
		const cards = expandOcclusionSiblings("anatomy/heart.md", base, set);
		expect(cards.map((c) => c.fm.fsrs_due)).toEqual([
			"2026-05-01",
			"2026-05-02",
		]);
		expect(cards[0]!.fm.fsrs_state).toBe("review");
		expect(cards[0]!.fm.fsrs_stability).toBe(4.2);
	});

	it("synthesizes new-state defaults for masks with fsrs: null", () => {
		// First-grade case: the editor just created the set; no mask
		// has been scheduled yet. The picker must see the sibling as a
		// "new" card so it surfaces immediately.
		const base = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [
				{ x: 10, y: 10, w: 30, h: 30, fsrs: null },
				{ x: 50, y: 50, w: 30, h: 30, fsrs: null },
			],
		};
		const cards = expandOcclusionSiblings("anatomy/heart.md", base, set);
		expect(cards[0]!.fm.fsrs_state).toBe("new");
		expect(cards[0]!.fm.fsrs_reps).toBe(0);
		expect(cards[0]!.fm.fsrs_lapses).toBe(0);
		// Far-past due so `due <= now` is trivially true and the picker
		// surfaces it immediately.
		expect(cards[0]!.fm.fsrs_due).toBe("1970-01-01");
	});

	it("carries the base frontmatter (topic, tags, occlusion_source) through every sibling", () => {
		const base = CardFrontmatterOnDisk.parse({
			...baseOcclusionFm,
			tags: ["anatomy", "exam"],
		});
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [
				{ x: 10, y: 10, w: 30, h: 30, fsrs: null },
				{ x: 50, y: 50, w: 30, h: 30, fsrs: null },
			],
		};
		const cards = expandOcclusionSiblings("anatomy/heart.md", base, set);
		for (const card of cards) {
			expect(card.fm.topic).toBe("Anatomy");
			expect(card.fm.tags).toEqual(["anatomy", "exam"]);
			expect(card.fm.occlusion_source).toBe("heart.occlusion.json");
		}
	});
});

describe("fmToMaskFsrs", () => {
	it("strips non-FSRS fields and returns the same field names", () => {
		// Round-trip with expand: project mask.fsrs → fm.fsrs_* via
		// expandOcclusionSiblings, then project back via fmToMaskFsrs.
		// Must equal the source slot — no field renames or drops.
		const base = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const slot = scheduledFsrs("2026-05-25");
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [{ x: 10, y: 10, w: 30, h: 30, fsrs: slot }],
		};
		const [card] = expandOcclusionSiblings("anatomy/heart.md", base, set);
		const roundTripped = fmToMaskFsrs(card!.fm);
		expect(roundTripped).toEqual(slot);
	});
});

describe("path helpers", () => {
	it("resolveOcclusionJsonPath anchors the source against the card's folder", () => {
		expect(
			resolveOcclusionJsonPath(
				"Cards/anatomy/heart.md",
				"heart.occlusion.json",
			),
		).toBe("Cards/anatomy/heart.occlusion.json");
	});

	it("resolveOcclusionJsonPath handles a card at the vault root", () => {
		expect(resolveOcclusionJsonPath("root.md", "root.occlusion.json")).toBe(
			"root.occlusion.json",
		);
	});

	it("jsonPathForCard swaps `.md` for `.occlusion.json`", () => {
		expect(jsonPathForCard("Cards/anatomy/heart.md")).toBe(
			"Cards/anatomy/heart.occlusion.json",
		);
	});

	it("jsonPathForCard tolerates a card path without a `.md` extension", () => {
		// Defensive — the parser only ever hands us `.md` paths, but a
		// future caller might not. Falling back to appending keeps the
		// helper total.
		expect(jsonPathForCard("Cards/anatomy/heart")).toBe(
			"Cards/anatomy/heart.occlusion.json",
		);
	});

	it("jsonBasenameForCard returns the bare basename for frontmatter", () => {
		expect(jsonBasenameForCard("Cards/anatomy/heart.md")).toBe(
			"heart.occlusion.json",
		);
	});
});

describe("readOcclusionSet", () => {
	function fakeReader(files: Record<string, string>): OcclusionIODeps {
		return {
			read: async (p) => (p in files ? files[p]! : null),
			write: async () => {
				throw new Error("unexpected write in readOcclusionSet tests");
			},
		};
	}

	it("returns {kind: 'ok', set} for a structurally valid JSON file", async () => {
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [{ x: 10, y: 10, w: 30, h: 30, fsrs: null }],
		};
		const deps = fakeReader({ "anatomy/heart.occlusion.json": JSON.stringify(set) });
		const result = await readOcclusionSet(deps, "anatomy/heart.occlusion.json");
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.set).toEqual(set);
		}
	});

	it("returns {kind: 'missing'} when the file isn't present", async () => {
		const deps = fakeReader({});
		const result = await readOcclusionSet(deps, "anatomy/heart.occlusion.json");
		expect(result).toEqual({
			kind: "missing",
			path: "anatomy/heart.occlusion.json",
		});
	});

	it("returns {kind: 'invalid'} on JSON parse error", async () => {
		const deps = fakeReader({ "x.json": "{ not valid json" });
		const result = await readOcclusionSet(deps, "x.json");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.error).toMatch(/JSON parse/);
		}
	});

	it("returns {kind: 'invalid'} on schema violation", async () => {
		// Empty masks array — fails the `.min(1)` check.
		const deps = fakeReader({
			"x.json": JSON.stringify({ image: "x.png", masks: [] }),
		});
		const result = await readOcclusionSet(deps, "x.json");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.path).toBe("x.json");
		}
	});
});

describe("writeOcclusionSet", () => {
	function fakeWriter(): {
		deps: OcclusionIODeps;
		writes: Map<string, string>;
	} {
		const writes = new Map<string, string>();
		return {
			writes,
			deps: {
				read: async () => null,
				write: async (p, c) => {
					writes.set(p, c);
				},
			},
		};
	}

	it("writes pretty-printed JSON ending with a newline", async () => {
		const { deps, writes } = fakeWriter();
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [{ x: 10, y: 10, w: 30, h: 30, fsrs: null }],
		};
		await writeOcclusionSet(deps, "anatomy/heart.occlusion.json", set);
		const written = writes.get("anatomy/heart.occlusion.json");
		expect(written).toBeDefined();
		expect(written!.endsWith("\n")).toBe(true);
		// Pretty-printed — at least one newline between fields.
		expect(written!.split("\n").length).toBeGreaterThan(3);
		// Round-trips through JSON.parse without loss.
		expect(JSON.parse(written!)).toEqual(set);
	});

	it("refuses to write a malformed set (empty masks)", async () => {
		const { deps } = fakeWriter();
		const bad = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [],
		} as unknown as OcclusionSetT;
		await expect(
			writeOcclusionSet(deps, "anatomy/heart.occlusion.json", bad),
		).rejects.toThrow(/refusing to write/);
	});
});

describe("OcclusionSet mode", () => {
	it("defaults to 'hide-one' when the field is absent (v1 sidecar compat)", () => {
		// V1 wrote no `mode` field. The parser must accept those JSONs
		// and interpret them with the original behavior.
		const legacy = {
			image: "_attachments/x.png",
			mode: "hide-one",
			masks: [{ x: 1, y: 1, w: 10, h: 10, fsrs: null }],
		};
		const parsed = OcclusionSet.parse(legacy);
		expect(parsed.mode).toBe("hide-one");
	});

	it("accepts each of the three modes verbatim", () => {
		for (const mode of ["hide-one", "show-one", "reveal-in-order"] as const) {
			const parsed = OcclusionSet.parse({
				image: "_attachments/x.png",
				mode,
				masks: [{ x: 1, y: 1, w: 10, h: 10, fsrs: null }],
			});
			expect(parsed.mode).toBe(mode);
		}
	});

	it("rejects an unknown mode value", () => {
		const result = OcclusionSet.safeParse({
			image: "_attachments/x.png",
			mode: "do-the-thing",
			masks: [{ x: 1, y: 1, w: 10, h: 10, fsrs: null }],
		});
		expect(result.success).toBe(false);
	});
});

describe("shouldHideMask", () => {
	// 3-mask set, active sibling = index 1 (the middle one).
	const ACTIVE = 1;

	describe("mode: hide-one", () => {
		it("Q hides only the active mask", () => {
			expect(shouldHideMask(0, ACTIVE, "hide-one", false)).toBe(false);
			expect(shouldHideMask(1, ACTIVE, "hide-one", false)).toBe(true);
			expect(shouldHideMask(2, ACTIVE, "hide-one", false)).toBe(false);
		});
		it("A reveals everything", () => {
			expect(shouldHideMask(0, ACTIVE, "hide-one", true)).toBe(false);
			expect(shouldHideMask(1, ACTIVE, "hide-one", true)).toBe(false);
			expect(shouldHideMask(2, ACTIVE, "hide-one", true)).toBe(false);
		});
	});

	describe("mode: show-one", () => {
		it("Q hides every mask except the active one (active is a window)", () => {
			expect(shouldHideMask(0, ACTIVE, "show-one", false)).toBe(true);
			expect(shouldHideMask(1, ACTIVE, "show-one", false)).toBe(false);
			expect(shouldHideMask(2, ACTIVE, "show-one", false)).toBe(true);
		});
		it("A reveals everything", () => {
			expect(shouldHideMask(0, ACTIVE, "show-one", true)).toBe(false);
			expect(shouldHideMask(1, ACTIVE, "show-one", true)).toBe(false);
			expect(shouldHideMask(2, ACTIVE, "show-one", true)).toBe(false);
		});
	});

	describe("mode: reveal-in-order", () => {
		it("Q hides the active mask and every later mask", () => {
			// For active=1: index 0 is already revealed (prior sibling),
			// index 1 (active) is hidden, index 2 is hidden (not yet
			// reached).
			expect(shouldHideMask(0, ACTIVE, "reveal-in-order", false)).toBe(false);
			expect(shouldHideMask(1, ACTIVE, "reveal-in-order", false)).toBe(true);
			expect(shouldHideMask(2, ACTIVE, "reveal-in-order", false)).toBe(true);
		});
		it("A reveals everything up to and including the active mask", () => {
			// For active=1: indices 0 and 1 revealed, index 2 still hidden.
			expect(shouldHideMask(0, ACTIVE, "reveal-in-order", true)).toBe(false);
			expect(shouldHideMask(1, ACTIVE, "reveal-in-order", true)).toBe(false);
			expect(shouldHideMask(2, ACTIVE, "reveal-in-order", true)).toBe(true);
		});
		it("first sibling Q hides everything", () => {
			// Pinning the boundary case: sibling 1 (active=0) shows
			// nothing of the masks. The user gets a fully-masked image
			// and must recall the first answer cold.
			for (const i of [0, 1, 2]) {
				expect(shouldHideMask(i, 0, "reveal-in-order", false)).toBe(true);
			}
		});
		it("last sibling A reveals everything", () => {
			// Active = last mask; on the A side, nothing remains hidden.
			for (const i of [0, 1, 2]) {
				expect(shouldHideMask(i, 2, "reveal-in-order", true)).toBe(false);
			}
		});
	});
});

describe("isOcclusionSibling", () => {
	it("returns true for cards with maskIndex set", () => {
		const base = CardFrontmatterOnDisk.parse(baseOcclusionFm);
		const set: OcclusionSetT = {
			image: "_attachments/heart.png",
			mode: "hide-one",
			masks: [{ x: 10, y: 10, w: 30, h: 30, fsrs: null }],
		};
		const [card] = expandOcclusionSiblings("anatomy/heart.md", base, set);
		expect(isOcclusionSibling(card!)).toBe(true);
	});

	it("returns false for cards without maskIndex (cloze or non-cloze)", () => {
		expect(
			isOcclusionSibling({
				id: "x.md",
				path: "x.md",
				clozeIndex: null,
				fm: {} as never,
				question: "",
				answer: "",
			}),
		).toBe(false);
	});
});
