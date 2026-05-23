import { findAvailablePath } from "./new-card";

/**
 * MIME types we explicitly support for v1. SVG (`image/svg+xml`) is
 * intentionally absent — see [image-support.md](../../docs/features/image-support.md)
 * Scope → Out. Unknown MIMEs fall back to `.bin` so a misfiring caller
 * still gets a writable filename; the paste/drop handler is expected
 * to gate on `image/*` before reaching this helper.
 */
const MIME_TO_EXT: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
};

export interface SaveAttachmentDeps {
	/** True iff the given vault path is occupied (file or folder). */
	exists: (path: string) => boolean;
	/** Create the folder, including missing parents. The helper guards
	 *  with `exists` before calling this, so an impl that throws on
	 *  duplicates (like `app.vault.createFolder`) is fine. */
	ensureFolder: (path: string) => Promise<void>;
	/** Write bytes to a vault path as a visible TFile. */
	writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
}

export interface SaveAttachmentOpts {
	/** Original filename from the paste/drop event, if any. Used as the
	 *  basename before the timestamp/collision suffix. Defaults to
	 *  "paste". The hint's own extension (if present) is stripped — the
	 *  final extension comes from the blob's MIME type. */
	hint?: string;
	/** Override for the current time. Injected for tests. */
	now?: Date;
}

export interface SaveAttachmentResult {
	/** Vault-relative path, e.g. `Cards/_attachments/paste-20260522-143000.png`. */
	path: string;
	/** Ready-to-insert wikilink, e.g. `![[paste-20260522-143000.png]]`. */
	wikiembed: string;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function timestamp(d: Date): string {
	const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
	const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	return `${date}-${time}`;
}

/** Resolve a blob's MIME to a bare extension (no dot). */
export function extensionForMime(mime: string): string {
	return MIME_TO_EXT[mime] ?? "bin";
}

/**
 * Pull a filesystem-safe stem out of `hint`. Strips a trailing
 * extension (everything after the last `.`), replaces non-`[a-zA-Z0-9._-]`
 * runs with `-`, then trims leading/trailing dashes. Empty or
 * whitespace-only hints fall back to `"paste"`.
 */
export function sanitizeHint(hint: string | undefined): string {
	if (!hint) return "paste";
	const dot = hint.lastIndexOf(".");
	const raw = dot >= 0 ? hint.slice(0, dot) : hint;
	const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned.length > 0 ? cleaned : "paste";
}

function basename(p: string): string {
	const i = p.lastIndexOf("/");
	return i >= 0 ? p.slice(i + 1) : p;
}

function joinDir(dir: string, child: string): string {
	const left = dir.endsWith("/") ? dir.slice(0, -1) : dir;
	return `${left}/${child}`;
}

/**
 * Save a binary blob into `<cardsRoot>/_attachments/` and return the
 * vault path plus a ready-to-insert `![[…]]` wikilink.
 *
 * Filename shape: `<hint>-<YYYYMMDD>-<HHmmss>.<ext>`. Collisions get
 * a `-2`/`-3`/… suffix via [findAvailablePath](./new-card.ts), with a
 * timestamped fallback after `-99` is exhausted (mirrors the new-card
 * path policy).
 *
 * I/O is injected via `deps` rather than taking `app` directly — this
 * matches the pure-helper shape in [new-card.ts](./new-card.ts) and
 * keeps the helper unit-testable without an Obsidian vault. The
 * paste/drop plugin wires `deps` against `app.vault`.
 */
export async function saveAttachment(
	deps: SaveAttachmentDeps,
	cardsRoot: string,
	blob: Blob,
	opts: SaveAttachmentOpts = {},
): Promise<SaveAttachmentResult> {
	const now = opts.now ?? new Date();
	const ext = extensionForMime(blob.type);
	const stem = sanitizeHint(opts.hint);
	const folder = joinDir(cardsRoot, "_attachments");
	const basePath = `${folder}/${stem}-${timestamp(now)}.${ext}`;

	if (!deps.exists(folder)) {
		await deps.ensureFolder(folder);
	}

	const finalPath = findAvailablePath(basePath, deps.exists, now);
	const buf = await blob.arrayBuffer();
	await deps.writeBinary(finalPath, buf);

	return {
		path: finalPath,
		wikiembed: `![[${basename(finalPath)}]]`,
	};
}
