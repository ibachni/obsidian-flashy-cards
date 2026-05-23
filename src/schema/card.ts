import { z } from "zod";

// Obsidian's YAML parser auto-converts unquoted ISO date strings into JS Date
// objects (`created: 2026-04-27` → Date instance, not string). Cards stay
// idiomatically unquoted on disk so Obsidian's Properties UI keeps the native
// date-picker; the schema absorbs both shapes here and normalizes to an ISO
// string for the rest of the plugin. (Decided 2026-04-27 — Option B in
// phase1_plan M0.3 / M3.1.)
const dateLike = z
	.union([z.string(), z.date()])
	.transform((d) => (d instanceof Date ? d.toISOString() : d));

const dateLikeNullable = z
	.union([z.string(), z.date(), z.null()])
	.transform((d) =>
		d === null ? null : d instanceof Date ? d.toISOString() : d,
	);

const fsrsStateEnum = z.enum(["new", "learning", "review", "relearning"]);

// Base (non-FSRS) frontmatter fields shared by every card on disk.
// Extracted so the cloze and non-cloze schemas can spread it without
// repeating themselves.
const BaseFrontmatter = z.object({
	type: z.literal("flashcard"),
	topic: z.string(),
	section: z.string().optional(),
	// Human-readable card title. Optional everywhere on disk so v1
	// cards (which never wrote a title) keep parsing; required by the
	// occlusion creation UI because those cards have no question text
	// to derive a label from. Browse uses this when present, falling
	// back to the filename slug for cards that haven't been titled.
	title: z.string().optional(),
	created: dateLike,
	modified: dateLike,
	tags: z.array(z.string()).default([]),
	related: z.array(z.string()).default([]),
	// Occlusion cards carry a pointer to their colocated JSON sidecar
	// (e.g. `heart.occlusion.json`). When set, the parser resolves the
	// sidecar relative to the card file, validates the shape, and
	// expands the markdown into N sibling cards — one per mask. The
	// flat `fsrs_*` fields on disk are still required (the
	// XOR-with-`fsrs_clozes` refine sees occlusion cards as the
	// non-cloze form); per-mask FSRS state lives inside the JSON
	// sidecar, not in markdown frontmatter.
	occlusion_source: z.string().optional(),
});

// FSRS fields with the `fsrs_` prefix — used by non-cloze cards on
// disk AND by the in-memory `ParsedCard.fm` shape (cloze siblings also
// hand consumers this flat shape; the parser projects from
// `fsrs_clozes[N]` into these fields; occlusion siblings project from
// their JSON sidecar `masks[N].fsrs`).
const FsrsFlatShape = {
	fsrs_due: dateLike,
	fsrs_stability: z.number(),
	fsrs_difficulty: z.number(),
	fsrs_elapsed_days: z.number(),
	fsrs_scheduled_days: z.number(),
	// Index into FSRS's learning_steps ladder. Added in ts-fsrs 5.x;
	// existing cards (M0) don't have this on disk yet — `.default(0)`
	// fills it in until the first grade write persists it.
	fsrs_learning_steps: z.number().int().nonnegative().default(0),
	fsrs_reps: z.number().int().nonnegative(),
	fsrs_lapses: z.number().int().nonnegative(),
	fsrs_state: fsrsStateEnum,
	fsrs_last_review: dateLikeNullable,
};

/**
 * Standalone Zod object for the flat FSRS fields. Re-used by the
 * occlusion JSON sidecar's per-mask `fsrs` block — that lives outside
 * markdown but uses the same field shape so the renderer/grader can
 * speak the same projected `CardFrontmatterT.fsrs_*` form regardless
 * of which storage backed it.
 */
export const FsrsFlat = z.object(FsrsFlatShape);
export type FsrsFlatT = z.infer<typeof FsrsFlat>;

// In-memory frontmatter shape. Every `ParsedCard.fm` has this shape —
// cloze siblings included, because the parser projects `fsrs_clozes[N]`
// into these flat fields per sibling.
export const CardFrontmatter = BaseFrontmatter.extend(FsrsFlatShape);
export type CardFrontmatterT = z.infer<typeof CardFrontmatter>;

// Per-sibling FSRS slot inside `fsrs_clozes`. Field names drop the
// `fsrs_` prefix because they already nest under `fsrs_clozes` — the
// double prefix would read as noise (`fsrs_clozes."1".fsrs_due`).
export const ClozeFsrsSlot = z.object({
	due: dateLike,
	stability: z.number(),
	difficulty: z.number(),
	elapsed_days: z.number(),
	scheduled_days: z.number(),
	learning_steps: z.number().int().nonnegative().default(0),
	reps: z.number().int().nonnegative(),
	lapses: z.number().int().nonnegative(),
	state: fsrsStateEnum,
	last_review: dateLikeNullable,
});

export type ClozeFsrsSlotT = z.infer<typeof ClozeFsrsSlot>;

// On-disk schema for the raw YAML before the parser branches into
// "non-cloze single ParsedCard" or "cloze N siblings". All flat
// `fsrs_*` fields are optional because cloze cards omit them in favor
// of `fsrs_clozes`; the refine below enforces "exactly one form".
//
// Consumers should NOT use this type — the parser narrows it into
// `CardFrontmatterT` (flat shape) for each ParsedCard it emits.
export const CardFrontmatterOnDisk = BaseFrontmatter.extend({
	fsrs_due: dateLike.optional(),
	fsrs_stability: z.number().optional(),
	fsrs_difficulty: z.number().optional(),
	fsrs_elapsed_days: z.number().optional(),
	fsrs_scheduled_days: z.number().optional(),
	fsrs_learning_steps: z.number().int().nonnegative().optional(),
	fsrs_reps: z.number().int().nonnegative().optional(),
	fsrs_lapses: z.number().int().nonnegative().optional(),
	fsrs_state: fsrsStateEnum.optional(),
	fsrs_last_review: dateLikeNullable.optional(),
	fsrs_clozes: z.record(z.string(), ClozeFsrsSlot).optional(),
}).refine(
	// XOR-with-full-coverage check across three card forms:
	//   1. non-cloze, non-occlusion — ALL flat fsrs_* required;
	//      neither `fsrs_clozes` nor `occlusion_source` set
	//   2. cloze — `fsrs_clozes` set; no flat fsrs_*, no occlusion_source
	//   3. occlusion — `occlusion_source` set; no flat fsrs_* (per-mask
	//      FSRS lives in the JSON sidecar), no fsrs_clozes
	// Catches schema drift early — a card holding multiple forms, or
	// only some of the flat fields, would crash downstream FSRS calls.
	//
	// `fsrs_learning_steps` is intentionally excluded from the required
	// list — it has a default(0) in the in-memory schema, so its absence
	// on disk is normal (cards predating ts-fsrs 5.x).
	(fm) => {
		const hasClozes = fm.fsrs_clozes !== undefined;
		const hasOcclusion = fm.occlusion_source !== undefined;
		const flatRequired = [
			fm.fsrs_due,
			fm.fsrs_stability,
			fm.fsrs_difficulty,
			fm.fsrs_elapsed_days,
			fm.fsrs_scheduled_days,
			fm.fsrs_reps,
			fm.fsrs_lapses,
			fm.fsrs_state,
			fm.fsrs_last_review, // nullable but not optional — null OK, undefined not
		];
		const hasAllFlat = flatRequired.every((v) => v !== undefined);
		const hasAnyFlat = flatRequired.some((v) => v !== undefined);

		// Cloze + occlusion never coexist; either with flat fields also forbidden.
		if (hasClozes && hasOcclusion) return false;
		if ((hasClozes || hasOcclusion) && hasAnyFlat) return false;
		if (hasClozes) return true; // cloze form complete
		if (hasOcclusion) return true; // occlusion form complete (per-mask FSRS in sidecar)
		return hasAllFlat; // non-cloze, non-occlusion must carry every required flat field
	},
	{
		message:
			"card must be exactly one of: non-cloze (all flat fsrs_* fields present), cloze (fsrs_clozes present), or occlusion (occlusion_source present)",
	},
);

export type CardFrontmatterOnDiskT = z.infer<typeof CardFrontmatterOnDisk>;
