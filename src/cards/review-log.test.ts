import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	appendGrade,
	readAll,
	readMonth,
	readRecent,
	truncateLastEntry,
	type ReviewLogEntry,
} from "./review-log";

const ROOT = "Cards/";

/**
 * Minimal in-memory adapter shim. The log layer only touches
 * `vault.adapter.{exists,mkdir,list,read,write,append}`, so we can
 * skip TFile/TFolder mocks entirely.
 *
 * Returns the fake App plus the file map so tests can inspect raw
 * disk contents and inject malformed entries directly.
 */
function makeApp() {
	const files = new Map<string, string>();
	const folders = new Set<string>(["", "Cards"]);
	let reads = 0;

	const adapter = {
		exists: async (p: string) => files.has(p) || folders.has(p),
		mkdir: async (p: string) => {
			folders.add(p);
		},
		list: async (p: string) => {
			const prefix = p.endsWith("/") ? p : `${p}/`;
			const childFiles: string[] = [];
			for (const key of files.keys()) {
				if (!key.startsWith(prefix)) continue;
				const tail = key.slice(prefix.length);
				if (!tail.includes("/")) childFiles.push(key);
			}
			const childFolders: string[] = [];
			for (const f of folders) {
				if (!f.startsWith(prefix) || f === p) continue;
				const tail = f.slice(prefix.length);
				if (!tail.includes("/")) childFolders.push(f);
			}
			return { files: childFiles, folders: childFolders };
		},
		read: async (p: string) => {
			reads++;
			return files.get(p) ?? "";
		},
		write: async (p: string, data: string) => {
			files.set(p, data);
		},
		append: async (p: string, data: string) => {
			files.set(p, (files.get(p) ?? "") + data);
		},
	};

	const app = {
		vault: { adapter },
	} as unknown as App;

	return { app, files, folders, readsRef: () => reads };
}

function entry(overrides: Partial<ReviewLogEntry> = {}): ReviewLogEntry {
	return {
		path: "Cards/dns/foo.md",
		topic: "dns",
		date: "2026-05-20",
		grade: 3,
		interval: 4,
		prevState: "learning",
		...overrides,
	};
}

describe("appendGrade", () => {
	it("creates the history directory and writes the first entry", async () => {
		const { app, files, folders } = makeApp();
		await appendGrade(app, ROOT, entry());
		expect(folders.has("Cards/.learning-system")).toBe(true);
		expect(folders.has("Cards/.learning-system/history")).toBe(true);
		const written = files.get("Cards/.learning-system/history/2026-05.jsonl");
		expect(written).toBeDefined();
		expect(written?.endsWith("\n")).toBe(true);
		expect(JSON.parse(written!.trim())).toEqual(entry());
	});

	it("appends within the same month into one file", async () => {
		const { app, files } = makeApp();
		await appendGrade(app, ROOT, entry({ date: "2026-05-01" }));
		await appendGrade(app, ROOT, entry({ date: "2026-05-15" }));
		await appendGrade(app, ROOT, entry({ date: "2026-05-31" }));
		const content = files.get("Cards/.learning-system/history/2026-05.jsonl");
		const lines = content!.split("\n").filter(Boolean);
		expect(lines).toHaveLength(3);
	});

	it("partitions across month boundaries into separate files", async () => {
		const { app, files } = makeApp();
		await appendGrade(app, ROOT, entry({ date: "2026-05-31" }));
		await appendGrade(app, ROOT, entry({ date: "2026-06-01" }));
		expect(files.has("Cards/.learning-system/history/2026-05.jsonl")).toBe(
			true,
		);
		expect(files.has("Cards/.learning-system/history/2026-06.jsonl")).toBe(
			true,
		);
	});

	it("round-trips through readMonth", async () => {
		const { app } = makeApp();
		const e1 = entry({ date: "2026-05-10", grade: 1 });
		const e2 = entry({ date: "2026-05-20", grade: 4, topic: "k8s" });
		await appendGrade(app, ROOT, e1);
		await appendGrade(app, ROOT, e2);
		const got = await readMonth(app, ROOT, "2026-05");
		expect(got).toEqual([e1, e2]);
	});
});

describe("readMonth", () => {
	it("returns [] when the file is missing", async () => {
		const { app } = makeApp();
		expect(await readMonth(app, ROOT, "2026-05")).toEqual([]);
	});

	it("skips malformed lines with a warn and parses the rest", async () => {
		const { app, files, folders } = makeApp();
		folders.add("Cards/.learning-system");
		folders.add("Cards/.learning-system/history");
		const good = entry({ date: "2026-05-10" });
		const content =
			JSON.stringify(good) + "\n" + "not json {{{\n" + JSON.stringify(good) + "\n";
		files.set("Cards/.learning-system/history/2026-05.jsonl", content);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const got = await readMonth(app, ROOT, "2026-05");
			expect(got).toHaveLength(2);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0]?.[0]).toMatch(/2026-05\.jsonl:2/);
		} finally {
			warn.mockRestore();
		}
	});

	it("tolerates trailing newlines / empty lines", async () => {
		const { app, files, folders } = makeApp();
		folders.add("Cards/.learning-system");
		folders.add("Cards/.learning-system/history");
		const e = entry({ date: "2026-05-10" });
		files.set(
			"Cards/.learning-system/history/2026-05.jsonl",
			JSON.stringify(e) + "\n\n",
		);
		expect(await readMonth(app, ROOT, "2026-05")).toEqual([e]);
	});
});

describe("readRecent", () => {
	it("returns newest-first across files and within a file", async () => {
		const { app } = makeApp();
		await appendGrade(app, ROOT, entry({ date: "2026-04-01", grade: 1 }));
		await appendGrade(app, ROOT, entry({ date: "2026-05-01", grade: 2 }));
		await appendGrade(app, ROOT, entry({ date: "2026-05-15", grade: 3 }));
		const got = await readRecent(app, ROOT, 10);
		expect(got.map((e) => e.date)).toEqual([
			"2026-05-15",
			"2026-05-01",
			"2026-04-01",
		]);
	});

	it("stops reading once limit is reached, not walking older files unnecessarily", async () => {
		const { app, readsRef } = makeApp();
		await appendGrade(app, ROOT, entry({ date: "2026-04-15" }));
		await appendGrade(app, ROOT, entry({ date: "2026-05-10" }));
		await appendGrade(app, ROOT, entry({ date: "2026-05-20" }));
		const readsBefore = readsRef();
		const got = await readRecent(app, ROOT, 2);
		expect(got).toHaveLength(2);
		const readsAfter = readsRef();
		// Only the newest month should have been read.
		expect(readsAfter - readsBefore).toBe(1);
	});

	it("returns [] when limit is 0", async () => {
		const { app } = makeApp();
		await appendGrade(app, ROOT, entry());
		expect(await readRecent(app, ROOT, 0)).toEqual([]);
	});

	it("returns [] when history directory is missing", async () => {
		const { app } = makeApp();
		expect(await readRecent(app, ROOT, 10)).toEqual([]);
	});
});

describe("readAll", () => {
	it("concatenates every month file in chronological order", async () => {
		const { app } = makeApp();
		// Write months out of order; readAll should still come back sorted.
		await appendGrade(app, ROOT, entry({ date: "2026-06-01", grade: 3 }));
		await appendGrade(app, ROOT, entry({ date: "2026-04-15", grade: 1 }));
		await appendGrade(app, ROOT, entry({ date: "2026-05-10", grade: 2 }));
		const got = await readAll(app, ROOT);
		expect(got.map((e) => e.date)).toEqual([
			"2026-04-15",
			"2026-05-10",
			"2026-06-01",
		]);
	});

	it("ignores non-jsonl files and badly-named jsonl files in history/", async () => {
		const { app, files, folders } = makeApp();
		folders.add("Cards/.learning-system");
		folders.add("Cards/.learning-system/history");
		const e = entry({ date: "2026-05-10" });
		files.set(
			"Cards/.learning-system/history/2026-05.jsonl",
			JSON.stringify(e) + "\n",
		);
		// Decoy files that should be skipped.
		files.set(
			"Cards/.learning-system/history/notes.txt",
			"do not parse this",
		);
		files.set(
			"Cards/.learning-system/history/archive.jsonl",
			'{"junk":true}\n',
		);
		const got = await readAll(app, ROOT);
		expect(got).toEqual([e]);
	});

	it("returns [] when history directory is missing", async () => {
		const { app } = makeApp();
		expect(await readAll(app, ROOT)).toEqual([]);
	});
});

describe("truncateLastEntry", () => {
	it("drops the matching last entry from a multi-line file", async () => {
		const { app, files } = makeApp();
		const e1 = entry({ date: "2026-05-10", grade: 1 });
		const e2 = entry({ date: "2026-05-15", grade: 2 });
		const e3 = entry({ date: "2026-05-20", grade: 3 });
		await appendGrade(app, ROOT, e1);
		await appendGrade(app, ROOT, e2);
		await appendGrade(app, ROOT, e3);
		const ok = await truncateLastEntry(app, ROOT, {
			path: e3.path,
			date: e3.date,
		});
		expect(ok).toBe(true);
		const content = files.get("Cards/.learning-system/history/2026-05.jsonl");
		const lines = content!.split("\n").filter(Boolean);
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1]!)).toEqual(e2);
	});

	it("aborts and warns when the last line does not match expected", async () => {
		const { app, files } = makeApp();
		const e1 = entry({ date: "2026-05-10", path: "Cards/a.md" });
		const e2 = entry({ date: "2026-05-11", path: "Cards/b.md" });
		await appendGrade(app, ROOT, e1);
		await appendGrade(app, ROOT, e2);
		const before = files.get("Cards/.learning-system/history/2026-05.jsonl");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const ok = await truncateLastEntry(app, ROOT, {
				path: "Cards/different.md",
				date: e2.date,
			});
			expect(ok).toBe(false);
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
		const after = files.get("Cards/.learning-system/history/2026-05.jsonl");
		expect(after).toBe(before);
	});

	it("empties the file when truncating a single-entry file", async () => {
		const { app, files } = makeApp();
		const e = entry({ date: "2026-05-10" });
		await appendGrade(app, ROOT, e);
		const ok = await truncateLastEntry(app, ROOT, {
			path: e.path,
			date: e.date,
		});
		expect(ok).toBe(true);
		expect(files.get("Cards/.learning-system/history/2026-05.jsonl")).toBe("");
	});

	it("is a no-op when the file is missing", async () => {
		const { app } = makeApp();
		const ok = await truncateLastEntry(app, ROOT, {
			path: "Cards/anything.md",
			date: "2026-05-10",
		});
		expect(ok).toBe(false);
	});

	it("handles CRLF line endings", async () => {
		const { app, files, folders } = makeApp();
		folders.add("Cards/.learning-system");
		folders.add("Cards/.learning-system/history");
		const e1 = entry({ date: "2026-05-10", path: "Cards/a.md" });
		const e2 = entry({ date: "2026-05-15", path: "Cards/b.md" });
		const content =
			JSON.stringify(e1) + "\r\n" + JSON.stringify(e2) + "\r\n";
		files.set("Cards/.learning-system/history/2026-05.jsonl", content);
		const ok = await truncateLastEntry(app, ROOT, {
			path: e2.path,
			date: e2.date,
		});
		expect(ok).toBe(true);
		const after = files.get("Cards/.learning-system/history/2026-05.jsonl");
		// The remaining entry stays; trailing newline preserved so the
		// next append lands cleanly.
		expect(after).toBe(JSON.stringify(e1) + "\n");
	});

	it("tolerates trailing blank lines after the target entry", async () => {
		const { app, files, folders } = makeApp();
		folders.add("Cards/.learning-system");
		folders.add("Cards/.learning-system/history");
		const e1 = entry({ date: "2026-05-10", path: "Cards/a.md" });
		const e2 = entry({ date: "2026-05-15", path: "Cards/b.md" });
		files.set(
			"Cards/.learning-system/history/2026-05.jsonl",
			JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n\n",
		);
		const ok = await truncateLastEntry(app, ROOT, {
			path: e2.path,
			date: e2.date,
		});
		expect(ok).toBe(true);
		const after = files.get("Cards/.learning-system/history/2026-05.jsonl");
		expect(after).toBe(JSON.stringify(e1) + "\n");
	});
});
