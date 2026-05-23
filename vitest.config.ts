import { defineConfig } from "vitest/config";

// Aliases `obsidian` (which ships type-only declarations) to a runtime
// stub so production modules importing `TFile` / `TFolder` /
// `normalizePath` as values can load under vitest. See
// [test/obsidian-shim.ts](./test/obsidian-shim.ts) for the stub list.
//
// The relative path resolves against this config file's location (the
// project root), which is how Vite handles alias targets — no `path` /
// `url` builtins needed.
export default defineConfig({
	test: {
		alias: {
			obsidian: "/test/obsidian-shim.ts",
		},
	},
});
