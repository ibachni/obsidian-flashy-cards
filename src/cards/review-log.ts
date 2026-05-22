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

/**
 * Truncate the last entry of the newest month file when it matches
 * `expected`. Used by the undo flow to keep Stats consistent with the
 * frontmatter rollback. If the last line is a different entry (sync
 * race, concurrent grade), the file is left unchanged and the function
 * returns `false` — callers can surface a Notice that the log may be
 * one entry stale. Returns `false` (no throw) if the file is missing
 * or empty so a missing-log adapter doesn't block undo.
 */
export async function truncateLastEntry(
	app: App,
	cardsRoot: string,
	expected: { path: string; date: string },
): Promise<boolean> {
	const adapter = app.vault.adapter;
	const path = monthFile(cardsRoot, ymOf(expected.date));
	if (!(await adapter.exists(path))) return false;

	const content = await adapter.read(path);
	// Split on \n, then strip a trailing \r from each piece — handles
	// both LF and CRLF line endings without parsing twice.
	const lines = content.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));

	let lastIdx = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line && line.trim()) {
			lastIdx = i;
			break;
		}
	}
	if (lastIdx === -1) return false;

	let parsed: ReviewLogEntry;
	try {
		parsed = JSON.parse(lines[lastIdx]!) as ReviewLogEntry;
	} catch {
		console.warn(
			`[learning-system] review-log: truncate aborted — last line of ${path} is malformed`,
		);
		return false;
	}

	if (parsed.path !== expected.path || parsed.date !== expected.date) {
		console.warn(
			`[learning-system] review-log: truncate aborted — last entry of ${path} does not match expected (${expected.path} ${expected.date})`,
		);
		return false;
	}

	// Drop the matched line; keep any blank lines that preceded it so
	// the surrounding format stays identical to what readMonth tolerates.
	const next = lines.slice(0, lastIdx).join("\n");
	// If anything remains, end with a newline so the next append lands
	// on its own line. Empty file → empty string (next append re-creates
	// the trailing newline pattern via the write/append branch).
	const out = next.length > 0 && !next.endsWith("\n") ? next + "\n" : next;
	await adapter.write(path, out);
	return true;
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
