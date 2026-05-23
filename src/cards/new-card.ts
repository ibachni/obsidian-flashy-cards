import type { CardFrontmatterT, ClozeFsrsSlotT } from "../schema/card";

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timestamp(d: Date): string {
	const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
	const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	return `${date}-${time}`;
}

/**
 * Normalize a question into a kebab-case filename slug.
 *
 * Pipeline: lowercase → collapse non-`[a-z0-9]+` runs to `-` → strip
 * leading/trailing `-` → truncate. Truncation: ≤60 chars passes through;
 * longer is cut to 60, then trimmed back to the last `-` at position ≥20
 * (word boundary). If no `-` lands deep enough, hard-cut at 60.
 *
 * Empty-input fallback: when normalization wipes the input out entirely
 * (all punctuation, CJK, etc.), returns `card-<YYYYMMDD-HHmmss>` so the
 * caller always has a usable filename. `now` is injectable for tests.
 */
export function slugify(s: string, now: Date = new Date()): string {
	const normalized = s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	const stripped = normalized.replace(/^-+|-+$/g, "");
	if (stripped.length === 0) return `card-${timestamp(now)}`;
	if (stripped.length <= 60) return stripped;
	const cut = stripped.slice(0, 60);
	const lastDash = cut.lastIndexOf("-");
	if (lastDash >= 20) return cut.slice(0, lastDash);
	return cut;
}

/**
 * Build the frontmatter for a freshly-created card. FSRS bookkeeping
 * defaults to "new" with zeroed counters; `created`/`modified`/`fsrs_due`
 * stamp to `today` (local date). `today` is injectable for tests.
 */
export function newCardFrontmatter(input: {
	topic: string;
	section?: string;
	tags?: string[];
	today?: Date;
}): CardFrontmatterT {
	const today = input.today ?? new Date();
	const stamp = isoDate(today);
	const fm: CardFrontmatterT = {
		type: "flashcard",
		topic: input.topic,
		created: stamp,
		modified: stamp,
		fsrs_due: stamp,
		fsrs_stability: 0,
		fsrs_difficulty: 0,
		fsrs_elapsed_days: 0,
		fsrs_scheduled_days: 0,
		fsrs_learning_steps: 0,
		fsrs_reps: 0,
		fsrs_lapses: 0,
		fsrs_state: "new",
		fsrs_last_review: null,
		tags: input.tags ?? [],
		related: [],
	};
	if (input.section && input.section.length > 0) {
		fm.section = input.section;
	}
	return fm;
}

function needsQuoting(s: string): boolean {
	if (s.length === 0) return true;
	if (/^[\s!#&*@`|>{}[\],?:\-<=%"']/.test(s)) return true;
	if (/\s$/.test(s)) return true;
	if (/[\n\r\t"\\]/.test(s)) return true;
	if (/: | #/.test(s)) return true;
	if (/^(null|true|false|yes|no|on|off|~)$/i.test(s)) return true;
	if (/^-?\d+(\.\d+)?$/.test(s)) return true;
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
	return false;
}

function yamlScalar(s: string): string {
	if (needsQuoting(s)) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return s;
}

/**
 * Build the base (non-FSRS) part of a card's frontmatter for cloze
 * cards. Cloze cards skip the flat `fsrs_*` block entirely — per-
 * sibling FSRS lives under `fsrs_clozes` — so this helper carries
 * the topic, section, tags, dates, and (for now empty) `related`
 * list. The caller produces the `fsrs_clozes` map separately via
 * `newClozeSlot`.
 */
export function newClozeCardBase(input: {
	topic: string;
	section?: string;
	tags?: string[];
	today?: Date;
}): {
	topic: string;
	section?: string;
	tags: string[];
	related: string[];
	created: string;
	modified: string;
} {
	const today = input.today ?? new Date();
	const stamp = isoDate(today);
	const base: {
		topic: string;
		section?: string;
		tags: string[];
		related: string[];
		created: string;
		modified: string;
	} = {
		topic: input.topic,
		tags: input.tags ?? [],
		related: [],
		created: stamp,
		modified: stamp,
	};
	if (input.section && input.section.length > 0) {
		base.section = input.section;
	}
	return base;
}

/**
 * Single new-state slot for `fsrs_clozes[N]`. Same shape every cloze
 * sibling starts with: zeroed counters, `state: "new"`, due today so
 * the picker surfaces it immediately. The first grade write
 * populates real values via `applyGradeUpdate`.
 */
export function newClozeSlot(today: Date = new Date()): ClozeFsrsSlotT {
	const stamp = isoDate(today);
	return {
		due: stamp,
		stability: 0,
		difficulty: 0,
		elapsed_days: 0,
		scheduled_days: 0,
		learning_steps: 0,
		reps: 0,
		lapses: 0,
		state: "new",
		last_review: null,
	};
}

/**
 * Render a cloze card to its on-disk markdown form. Mirrors
 * `serializeCard` but emits `fsrs_clozes: { "1": {…}, "2": {…} }`
 * instead of the flat `fsrs_*` block. The `clozeIndices` list comes
 * from the caller (typically `collectClozeIndices(question, answer)`);
 * each index gets an identical new-state slot.
 *
 * Title is optional in the schema but accepted here so the caller
 * can label new cards consistently with occlusion / future flows.
 */
export function serializeClozeCard(input: {
	title?: string;
	topic: string;
	section?: string;
	tags?: string[];
	today?: Date;
	clozeIndices: number[];
	question: string;
	answer: string;
}): string {
	const today = input.today ?? new Date();
	const base = newClozeCardBase({
		topic: input.topic,
		section: input.section,
		tags: input.tags,
		today,
	});
	const slot = newClozeSlot(today);
	const slotYaml = (): string[] => [
		`    due: ${slot.due}`,
		`    stability: ${slot.stability}`,
		`    difficulty: ${slot.difficulty}`,
		`    elapsed_days: ${slot.elapsed_days}`,
		`    scheduled_days: ${slot.scheduled_days}`,
		`    learning_steps: ${slot.learning_steps}`,
		`    reps: ${slot.reps}`,
		`    lapses: ${slot.lapses}`,
		`    state: ${slot.state}`,
		`    last_review:`,
	];
	const lines: string[] = ["---"];
	lines.push("type: flashcard");
	if (input.title && input.title.length > 0) {
		lines.push(`title: ${yamlScalar(input.title)}`);
	}
	lines.push(`topic: ${yamlScalar(base.topic)}`);
	if (base.section && base.section.length > 0) {
		lines.push(`section: ${yamlScalar(base.section)}`);
	}
	lines.push(`created: ${base.created}`);
	lines.push(`modified: ${base.modified}`);
	lines.push("fsrs_clozes:");
	for (const n of input.clozeIndices) {
		lines.push(`  "${n}":`);
		for (const row of slotYaml()) lines.push(row);
	}
	if (base.tags.length === 0) {
		lines.push("tags: []");
	} else {
		lines.push("tags:");
		for (const t of base.tags) lines.push(`  - ${yamlScalar(t)}`);
	}
	if (base.related.length === 0) {
		lines.push("related: []");
	} else {
		lines.push("related:");
		for (const r of base.related) lines.push(`  - ${yamlScalar(r)}`);
	}
	lines.push("---");
	lines.push("");
	lines.push("# Question");
	lines.push("");
	lines.push(input.question);
	lines.push("");
	lines.push("# Answer");
	lines.push("");
	lines.push(input.answer);
	lines.push("");
	return lines.join("\n");
}

/**
 * Render a card to its on-disk markdown form. Hand-serialized rather
 * than via `stringifyYaml` so date fields (`created`, `modified`,
 * `fsrs_due`) land as bare `YYYY-MM-DD` — which is what makes Obsidian's
 * Properties UI render a date-picker — and so we keep no runtime dep on
 * the `obsidian` package (its npm build has `"main": ""`; only types
 * are exported).
 */
export function serializeCard(card: {
	fm: CardFrontmatterT;
	question: string;
	answer: string;
}): string {
	const { fm, question, answer } = card;
	const lines: string[] = ["---"];
	lines.push(`type: ${fm.type}`);
	lines.push(`topic: ${yamlScalar(fm.topic)}`);
	if (fm.section && fm.section.length > 0) {
		lines.push(`section: ${yamlScalar(fm.section)}`);
	}
	lines.push(`created: ${fm.created}`);
	lines.push(`modified: ${fm.modified}`);
	lines.push(`fsrs_due: ${fm.fsrs_due}`);
	lines.push(`fsrs_stability: ${fm.fsrs_stability}`);
	lines.push(`fsrs_difficulty: ${fm.fsrs_difficulty}`);
	lines.push(`fsrs_elapsed_days: ${fm.fsrs_elapsed_days}`);
	lines.push(`fsrs_scheduled_days: ${fm.fsrs_scheduled_days}`);
	lines.push(`fsrs_learning_steps: ${fm.fsrs_learning_steps}`);
	lines.push(`fsrs_reps: ${fm.fsrs_reps}`);
	lines.push(`fsrs_lapses: ${fm.fsrs_lapses}`);
	lines.push(`fsrs_state: ${fm.fsrs_state}`);
	if (fm.fsrs_last_review === null) {
		lines.push("fsrs_last_review:");
	} else {
		lines.push(`fsrs_last_review: ${fm.fsrs_last_review}`);
	}
	if (fm.tags.length === 0) {
		lines.push("tags: []");
	} else {
		lines.push("tags:");
		for (const t of fm.tags) lines.push(`  - ${yamlScalar(t)}`);
	}
	if (fm.related.length === 0) {
		lines.push("related: []");
	} else {
		lines.push("related:");
		for (const r of fm.related) lines.push(`  - ${yamlScalar(r)}`);
	}
	lines.push("---");
	lines.push("");
	lines.push("# Question");
	lines.push("");
	lines.push(question);
	lines.push("");
	lines.push("# Answer");
	lines.push("");
	lines.push(answer);
	lines.push("");
	return lines.join("\n");
}

/**
 * Probe for an unused path. Tries `base`, then `<stem>-2.<ext>` …
 * `<stem>-99.<ext>`, then falls back to a timestamped name.
 *
 * `exists` is injected so this stays pure and unit-testable; the modal
 * passes `(p) => app.vault.getAbstractFileByPath(p) !== null`.
 */
export function findAvailablePath(
	basePath: string,
	exists: (p: string) => boolean,
	now: Date = new Date(),
): string {
	if (!exists(basePath)) return basePath;
	const dotIdx = basePath.lastIndexOf(".");
	const stem = dotIdx >= 0 ? basePath.slice(0, dotIdx) : basePath;
	const ext = dotIdx >= 0 ? basePath.slice(dotIdx) : "";
	for (let i = 2; i <= 99; i++) {
		const candidate = `${stem}-${i}${ext}`;
		if (!exists(candidate)) return candidate;
	}
	return `${stem}-${timestamp(now)}${ext}`;
}
