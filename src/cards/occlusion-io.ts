import { TFile, type App } from "obsidian";

import type { OcclusionIODeps } from "./occlusion";

/**
 * Adapt an Obsidian `App` into the injectable I/O deps shape used by
 * `readOcclusionSet` / `writeOcclusionSet` / `persistOcclusionGrade`.
 *
 * Reads go through `app.vault.adapter.read` (returns `null` when the
 * file is missing — Obsidian doesn't surface that case via the
 * TFile graph for paths the vault hasn't indexed).
 *
 * Writes go through the high-level Vault API so the TFile graph
 * stays consistent: `vault.modify` when the path already resolves to
 * a TFile, `vault.create` otherwise. Going through `adapter.write`
 * would skip TFile registration and leave subsequent
 * `getAbstractFileByPath(jsonPath)` calls returning `null` until the
 * vault rescans — silently breaking the rename / delete sidecar
 * handlers in main.tsx that look the JSON up by path.
 *
 * Lives in its own file because `instanceof TFile` requires a
 * *runtime* import of TFile, and the `obsidian` npm package has
 * `"main": ""` so vitest can't resolve it. Keeping
 * [occlusion.ts](./occlusion.ts) free of runtime obsidian imports
 * preserves the unit-testability of the pure schema + expansion +
 * serialization helpers.
 */
export function makeAppIODeps(app: App): OcclusionIODeps {
	return {
		read: async (path: string) => {
			const exists = await app.vault.adapter.exists(path);
			if (!exists) return null;
			return app.vault.adapter.read(path);
		},
		write: async (path: string, content: string) => {
			const existing = app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				await app.vault.modify(existing, content);
			} else {
				await app.vault.create(path, content);
			}
		},
	};
}
