import { normalizePath, type App } from "obsidian";
import { appendGrade, type ReviewLogEntry } from "./review-log";

/**
 * One-shot helper for populating the sidecar review log with plausible
 * fake data, so the Stats pane has something to render on a fresh
 * install. Wired to the `seed-demo-log` dev command in main.tsx.
 *
 * Topics are tuned to produce visibly different retention rates and a
 * weakest-first order in the per-topic panel. Days are mostly
 * contiguous so the streak counter shows a non-trivial number; a few
 * gaps in the past 90 days make the heatmap legible.
 */

interface DemoTopic {
	name: string;
	/** Target retention rate — drives the Good/Easy vs Again/Hard mix. */
	retention: number;
	/** Relative weight when sampling a topic for each entry. */
	weight: number;
}

const TOPICS: DemoTopic[] = [
	{ name: "dns", retention: 0.88, weight: 3 },
	{ name: "kubernetes", retention: 0.62, weight: 2 },
	{ name: "networking", retention: 0.75, weight: 2 },
	{ name: "linux", retention: 0.92, weight: 1 },
	{ name: "git", retention: 0.55, weight: 1 },
];

/**
 * Days back to skip — creates gaps in the heatmap and caps the streak.
 * The first gap (day 18) sets the streak length, so push it back far
 * enough that the panel reads as "you've been at this a while" rather
 * than "you just got started yesterday".
 */
const GAP_DAYS = new Set([18, 32, 50, 68, 82]);

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function localIsoDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pickTopic(): DemoTopic {
	const totalWeight = TOPICS.reduce((acc, t) => acc + t.weight, 0);
	let r = Math.random() * totalWeight;
	for (const t of TOPICS) {
		r -= t.weight;
		if (r <= 0) return t;
	}
	// Fallback for floating-point edge — shouldn't fire.
	return TOPICS[TOPICS.length - 1]!;
}

/**
 * Map a random roll against the topic's target retention into a grade.
 * Within "hits" (>= retention threshold), Easy is the minority; within
 * "misses", Hard is the majority. Mirrors how a moderately confident
 * reviewer tends to grade.
 */
function pickGrade(retention: number): 1 | 2 | 3 | 4 {
	const r = Math.random();
	if (r < retention) {
		// Hit: ~25% Easy, 75% Good.
		return Math.random() < 0.25 ? 4 : 3;
	}
	// Miss: ~65% Hard, 35% Again.
	return Math.random() < 0.65 ? 2 : 1;
}

/**
 * Build the on-disk content for the cloze demo card. Pure — no I/O,
 * no Obsidian imports — so the YAML round-trip can be regression-
 * tested against the schema without a vault mock.
 *
 * `today` is injected so tests can pin the date for snapshot stability.
 * In production the caller passes a freshly computed local-ISO date.
 */
export function buildClozeExampleContent(today: string): string {
	// Per-sibling slots. All `new` and due `today` so the card
	// surfaces immediately in the picker. Each slot is identical
	// except for the index key — the parser projects each into a flat
	// ParsedCard at read time.
	const slotYaml = (): string =>
		[
			`    due: ${today}`,
			`    stability: 0`,
			`    difficulty: 0`,
			`    elapsed_days: 0`,
			`    scheduled_days: 0`,
			`    learning_steps: 0`,
			`    reps: 0`,
			`    lapses: 0`,
			`    state: new`,
			`    last_review:`,
		].join("\n");

	return [
		"---",
		"type: flashcard",
		"topic: Cloze demo",
		`created: ${today}`,
		`modified: ${today}`,
		"fsrs_clozes:",
		`  "1":`,
		slotYaml(),
		`  "2":`,
		slotYaml(),
		`  "3":`,
		slotYaml(),
		"tags:",
		"  - demo",
		"  - es",
		"related: []",
		"---",
		"",
		"# Question",
		"",
		"Conjugate _hablar_ (to speak) in the present indicative:",
		"- yo {{c1::hablo}}",
		"- tú {{c2::hablas}}",
		"- él/ella {{c3::habla}}",
		"",
		"# Answer",
		"",
		"Regular **-ar** verb. Stem: _habl-_. Endings: _-o_, _-as_, _-a_, _-amos_, _-áis_, _-an_.",
		"",
	].join("\n");
}

/**
 * Drop a single working cloze-deletion card into the cards root so a
 * fresh install can see the format end-to-end: three sibling rows in
 * Browse (each suffixed `· c1` / `· c2` / `· c3`), masked question in
 * Review, accent-highlighted answer after reveal.
 *
 * Hand-rolled YAML rather than going through `serializeCard` because
 * the latter assumes flat `fsrs_*` scalars — cloze cards use the
 * `fsrs_clozes` map instead. Skips if the target file already exists
 * so re-running the command doesn't clobber an in-progress edit.
 *
 * Returns the path written, or `null` if a file already existed
 * there. Notice firing lives in the caller (`runSeedClozeExample` in
 * main.tsx) so message ownership matches the `seedDemoLog` pattern.
 *
 * Goes through the Vault API end-to-end so the new file lands in
 * Obsidian's TFile graph immediately — adapter writes would skip
 * registration and confuse downstream lookups until the next rescan.
 * `createFolder` is recursive, so deep cardsRoots like
 * `Notes/learning/cards/` boot without intermediate-directory errors.
 */
export async function seedClozeExample(
	app: App,
	cardsRoot: string,
): Promise<string | null> {
	const root = normalizePath(cardsRoot);
	const path = normalizePath(`${root}/cloze-example.md`);
	if (app.vault.getAbstractFileByPath(path) !== null) return null;

	const content = buildClozeExampleContent(localIsoDate(new Date()));

	if (app.vault.getAbstractFileByPath(root) === null) {
		await app.vault.createFolder(root);
	}
	await app.vault.create(path, content);
	return path;
}

export async function seedDemoLog(
	app: App,
	cardsRoot: string,
	daysBack: number = 90,
): Promise<number> {
	const today = new Date();
	let total = 0;

	for (let d = 0; d < daysBack; d++) {
		if (GAP_DAYS.has(d)) continue;

		const date = new Date(today);
		date.setDate(date.getDate() - d);
		const dateStr = localIsoDate(date);

		// 4–14 grades per day, slightly more on recent days to give the
		// heatmap a visible ramp.
		const base = 4;
		const variance = 11;
		const recencyBonus = Math.max(0, 4 - Math.floor(d / 15));
		const gradesToday = base + recencyBonus + Math.floor(Math.random() * variance);

		for (let i = 0; i < gradesToday; i++) {
			const topic = pickTopic();
			const grade = pickGrade(topic.retention);
			const entry: ReviewLogEntry = {
				path: normalizePath(
					`${cardsRoot}/${topic.name}/demo-card-${total}.md`,
				),
				topic: topic.name,
				date: dateStr,
				grade,
				interval: 1 + Math.floor(Math.random() * 30),
				prevState: "review",
			};
			await appendGrade(app, cardsRoot, entry);
			total++;
		}
	}

	return total;
}
