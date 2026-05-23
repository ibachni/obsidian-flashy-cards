import { TFile, normalizePath, type App } from "obsidian";

import type { OcclusionIODeps } from "./occlusion";

/**
 * Adapt an Obsidian `App` into the injectable I/O deps shape used by
 * `readOcclusionSet` / `writeOcclusionSet` / `persistOcclusionGrade`.
 *
 * Reads and writes both route through the high-level Vault API so the
 * TFile graph stays consistent: `getAbstractFileByPath` returns the
 * tracked TFile, `vault.read` / `vault.process` / `vault.create` keep
 * the cache populated. Going through `adapter.*` would skip TFile
 * registration and leave subsequent `getAbstractFileByPath(jsonPath)`
 * calls returning `null` until the vault rescans — silently breaking
 * the rename / delete sidecar handlers in main.tsx that look the JSON
 * up by path.
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
			const file = app.vault.getAbstractFileByPath(normalizePath(path));
			if (!(file instanceof TFile)) return null;
			return app.vault.read(file);
		},
		write: async (path: string, content: string) => {
			const safe = normalizePath(path);
			const existing = app.vault.getAbstractFileByPath(safe);
			if (existing instanceof TFile) {
				// `vault.process` is the locked replacement for
				// `vault.modify` recommended by the plugin guidelines.
				// We pass an identity-on-write transform because the
				// caller (`writeOcclusionSet`) hands us the complete
				// serialized JSON — there's nothing to transform from
				// the previous content, but we still want the
				// per-file lock so a concurrent grade write on the
				// same JSON serializes behind us.
				await app.vault.process(existing, () => content);
			} else {
				await app.vault.create(safe, content);
			}
		},
	};
}
