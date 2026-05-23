import { describe, expect, it } from "vitest";
import {
	extensionForMime,
	saveAttachment,
	sanitizeHint,
	type SaveAttachmentDeps,
} from "./image-attachment";

interface FakeVault {
	files: Map<string, ArrayBuffer>;
	folders: Set<string>;
	deps: SaveAttachmentDeps;
	folderCreates: string[];
}

function fakeVault(initial: Iterable<string> = []): FakeVault {
	const files = new Map<string, ArrayBuffer>();
	const folders = new Set<string>();
	const folderCreates: string[] = [];
	for (const p of initial) files.set(p, new ArrayBuffer(0));
	const deps: SaveAttachmentDeps = {
		exists: (p) => files.has(p) || folders.has(p),
		ensureFolder: async (p) => {
			folderCreates.push(p);
			folders.add(p);
		},
		writeBinary: async (p, data) => {
			files.set(p, data);
		},
	};
	return { files, folders, deps, folderCreates };
}

function pngBlob(size = 4): Blob {
	return new Blob([new Uint8Array(size)], { type: "image/png" });
}

describe("extensionForMime", () => {
	it("maps the four supported image MIMEs", () => {
		expect(extensionForMime("image/png")).toBe("png");
		expect(extensionForMime("image/jpeg")).toBe("jpg");
		expect(extensionForMime("image/webp")).toBe("webp");
		expect(extensionForMime("image/gif")).toBe("gif");
	});

	it("falls back to `bin` for unknown MIMEs", () => {
		expect(extensionForMime("image/svg+xml")).toBe("bin");
		expect(extensionForMime("application/octet-stream")).toBe("bin");
		expect(extensionForMime("")).toBe("bin");
	});
});

describe("sanitizeHint", () => {
	it("strips the trailing extension and replaces spaces with dashes", () => {
		expect(sanitizeHint("My Image.png")).toBe("My-Image");
	});

	it("preserves dots, dashes, and underscores inside the stem", () => {
		expect(sanitizeHint("foo.bar_baz-qux.png")).toBe("foo.bar_baz-qux");
	});

	it("collapses runs of disallowed characters into a single dash", () => {
		expect(sanitizeHint("hello!!world??.png")).toBe("hello-world");
		expect(sanitizeHint("a/b\\c:d.png")).toBe("a-b-c-d");
	});

	it("trims leading and trailing dashes after sanitization", () => {
		expect(sanitizeHint(" leading.png")).toBe("leading");
		expect(sanitizeHint("trailing .png")).toBe("trailing");
	});

	it("falls back to `paste` for missing or wiped-out hints", () => {
		expect(sanitizeHint(undefined)).toBe("paste");
		expect(sanitizeHint("")).toBe("paste");
		expect(sanitizeHint("???")).toBe("paste");
		expect(sanitizeHint(".png")).toBe("paste");
	});
});

describe("saveAttachment", () => {
	const now = new Date(2026, 4, 22, 14, 30, 0); // 2026-05-22 14:30:00 local

	it("writes to `<cardsRoot>/_attachments/<stem>-<timestamp>.<ext>`", async () => {
		const vault = fakeVault();
		const result = await saveAttachment(
			vault.deps,
			"Cards",
			pngBlob(),
			{ hint: "diagram.png", now },
		);
		expect(result.path).toBe(
			"Cards/_attachments/diagram-20260522-143000.png",
		);
		expect(result.wikiembed).toBe(
			"![[diagram-20260522-143000.png]]",
		);
		expect(vault.files.has(result.path)).toBe(true);
	});

	it("creates the `_attachments` folder when it doesn't exist", async () => {
		const vault = fakeVault();
		await saveAttachment(vault.deps, "Cards", pngBlob(), { now });
		expect(vault.folderCreates).toEqual(["Cards/_attachments"]);
	});

	it("skips folder creation when the folder is already present", async () => {
		const vault = fakeVault();
		vault.folders.add("Cards/_attachments");
		await saveAttachment(vault.deps, "Cards", pngBlob(), { now });
		expect(vault.folderCreates).toEqual([]);
	});

	it("tolerates a trailing slash on `cardsRoot`", async () => {
		const vault = fakeVault();
		const result = await saveAttachment(
			vault.deps,
			"Cards/",
			pngBlob(),
			{ now },
		);
		expect(result.path).toBe(
			"Cards/_attachments/paste-20260522-143000.png",
		);
	});

	it("defaults the stem to `paste` when no hint is provided", async () => {
		const vault = fakeVault();
		const result = await saveAttachment(vault.deps, "Cards", pngBlob(), {
			now,
		});
		expect(result.path).toBe(
			"Cards/_attachments/paste-20260522-143000.png",
		);
	});

	it("uses the MIME type for the extension, not the hint", async () => {
		const vault = fakeVault();
		const jpeg = new Blob([new Uint8Array(2)], { type: "image/jpeg" });
		const result = await saveAttachment(vault.deps, "Cards", jpeg, {
			hint: "screenshot.png",
			now,
		});
		expect(result.path.endsWith(".jpg")).toBe(true);
	});

	it("falls back to `.bin` when the MIME isn't recognised", async () => {
		const vault = fakeVault();
		const blob = new Blob([new Uint8Array(2)], { type: "image/svg+xml" });
		const result = await saveAttachment(vault.deps, "Cards", blob, {
			hint: "icon.svg",
			now,
		});
		expect(result.path.endsWith(".bin")).toBe(true);
	});

	it("appends `-2` on the first collision within the same second", async () => {
		const vault = fakeVault([
			"Cards/_attachments/paste-20260522-143000.png",
		]);
		vault.folders.add("Cards/_attachments");
		const result = await saveAttachment(vault.deps, "Cards", pngBlob(), {
			now,
		});
		expect(result.path).toBe(
			"Cards/_attachments/paste-20260522-143000-2.png",
		);
		expect(result.wikiembed).toBe(
			"![[paste-20260522-143000-2.png]]",
		);
	});

	it("falls back to an appended-timestamp name once `-2`…`-99` are taken", async () => {
		const taken = new Set<string>([
			"Cards/_attachments/paste-20260522-143000.png",
		]);
		for (let i = 2; i <= 99; i++) {
			taken.add(`Cards/_attachments/paste-20260522-143000-${i}.png`);
		}
		const vault = fakeVault(taken);
		vault.folders.add("Cards/_attachments");
		const result = await saveAttachment(vault.deps, "Cards", pngBlob(), {
			now,
		});
		expect(result.path).toBe(
			"Cards/_attachments/paste-20260522-143000-20260522-143000.png",
		);
	});

	it("writes the blob's bytes to the chosen path", async () => {
		const vault = fakeVault();
		const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
			type: "image/png",
		});
		const result = await saveAttachment(vault.deps, "Cards", blob, { now });
		const written = vault.files.get(result.path);
		expect(written).toBeDefined();
		expect(new Uint8Array(written!)).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it("sanitizes awkward hint characters before building the filename", async () => {
		const vault = fakeVault();
		const result = await saveAttachment(vault.deps, "Cards", pngBlob(), {
			hint: "My Cool Image!! (final).png",
			now,
		});
		expect(result.path).toBe(
			"Cards/_attachments/My-Cool-Image-final-20260522-143000.png",
		);
	});
});
