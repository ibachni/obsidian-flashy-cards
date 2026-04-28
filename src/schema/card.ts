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

// FSRS fields are flattened into the top-level frontmatter (fsrs_*) so Obsidian's
// Properties UI can render them — nested YAML objects show as "Unsupported property".
export const CardFrontmatter = z.object({
	type: z.literal("flashcard"),
	topic: z.string(),
	section: z.string().optional(),
	created: dateLike,
	modified: dateLike,
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
	fsrs_state: z.enum(["new", "learning", "review", "relearning"]),
	fsrs_last_review: dateLikeNullable,
	tags: z.array(z.string()).default([]),
	related: z.array(z.string()).default([]),
});

export type CardFrontmatterT = z.infer<typeof CardFrontmatter>;
