import type { App } from "obsidian";

export interface ReviewLogEntry {
	path: string;
	topic: string;
	/** Local-zone YYYY-MM-DD. */
	date: string;
	grade: 1 | 2 | 3 | 4;
	interval: number;
	prevState: "new" | "learning" | "review" | "relearning";
}

const HISTORY_SUBDIR = ".learning-system/history";
const META_SUBDIR = ".learning-system";

function metaDir(cardsRoot: string): string {
	return `${cardsRoot}${META_SUBDIR}`;
}

function historyDir(cardsRoot: string): string {
	return `${cardsRoot}${HISTORY_SUBDIR}`;
}

function monthFile(cardsRoot: string, ym: string): string {
	return `${historyDir(cardsRoot)}/${ym}.jsonl`;
}

function ymOf(date: string): string {
	// date is YYYY-MM-DD; slicing avoids parsing into Date and re-emitting,
	// which would round-trip through UTC and could shift the month.
	return date.slice(0, 7);
}

/**
 * Append one grade entry to the current month's JSONL file.
 *
 * Creates `.learning-system/history/` on first use. Uses the vault
 * adapter directly so the function is pure-string and easy to test
 * without TFile/TFolder mocks. Caller wraps this in a try/catch — a
 * failed log write must not block a grade.
 */
export async function appendGrade(
	app: App,
	cardsRoot: string,
	entry: ReviewLogEntry,
): Promise<void> {
	const adapter = app.vault.adapter;
	const dir = historyDir(cardsRoot);
	const path = monthFile(cardsRoot, ymOf(entry.date));
	const line = JSON.stringify(entry) + "\n";

	if (!(await adapter.exists(dir))) {
		// `mkdir` is non-recursive on some adapters — bootstrap each level.
		const meta = metaDir(cardsRoot);
		if (!(await adapter.exists(meta))) await adapter.mkdir(meta);
		await adapter.mkdir(dir);
	}

	if (await adapter.exists(path)) {
		await adapter.append(path, line);
	} else {
		await adapter.write(path, line);
	}
}

/**
 * Parse one month file. Returns `[]` if the file is missing.
 * Malformed lines are skipped with a console.warn; the rest of the
 * file still parses — a single bad line should not poison the panel.
 */
export async function readMonth(
	app: App,
	cardsRoot: string,
	ym: string,
): Promise<ReviewLogEntry[]> {
	const path = monthFile(cardsRoot, ym);
	if (!(await app.vault.adapter.exists(path))) return [];
	const content = await app.vault.adapter.read(path);
	return parseEntries(content, path);
}

function parseEntries(
	content: string,
	sourcePath: string,
): ReviewLogEntry[] {
	const out: ReviewLogEntry[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line || !line.trim()) continue;
		try {
			out.push(JSON.parse(line) as ReviewLogEntry);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.warn(
				`[learning-system] review-log: skipping ${sourcePath}:${i + 1} — ${msg}`,
			);
		}
	}
	return out;
}

/**
 * Walk back month-by-month from the newest file until `limit` entries
 * are collected. Returns newest-first within and across files.
 */
export async function readRecent(
	app: App,
	cardsRoot: string,
	limit: number,
): Promise<ReviewLogEntry[]> {
	if (limit <= 0) return [];
	const months = (await listMonths(app, cardsRoot)).sort().reverse();
	const out: ReviewLogEntry[] = [];
	for (const ym of months) {
		const entries = await readMonth(app, cardsRoot, ym);
		// Within a file, entries are append-order (oldest → newest).
		// Iterate in reverse so the result is globally newest-first.
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (e === undefined) continue;
			out.push(e);
			if (out.length >= limit) return out;
		}
	}
	return out;
}

/**
 * Read every month file in chronological order. Used by the heatmap.
 * Returns oldest-first.
 */
export async function readAll(
	app: App,
	cardsRoot: string,
): Promise<ReviewLogEntry[]> {
	const months = (await listMonths(app, cardsRoot)).sort();
	const out: ReviewLogEntry[] = [];
	for (const ym of months) {
		out.push(...(await readMonth(app, cardsRoot, ym)));
	}
	return out;
}

async function listMonths(app: App, cardsRoot: string): Promise<string[]> {
	const dir = historyDir(cardsRoot);
	const adapter = app.vault.adapter;
	if (!(await adapter.exists(dir))) return [];
	const listed = await adapter.list(dir);
	const out: string[] = [];
	for (const p of listed.files) {
		const name = p.split("/").pop() ?? "";
		if (!name.endsWith(".jsonl")) continue;
		const stem = name.slice(0, -".jsonl".length);
		if (/^\d{4}-\d{2}$/.test(stem)) out.push(stem);
	}
	return out;
}
