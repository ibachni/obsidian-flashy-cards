/**
 * Runtime stand-in for the `obsidian` npm package. Obsidian ships
 * type-only declarations (`"main": ""` in its package.json), so any
 * production module that imports a *value* (class, function) from
 * `obsidian` would fail to resolve at vitest load time.
 *
 * This file is aliased to `obsidian` by [vitest.config.ts](../vitest.config.ts).
 * Tests never instantiate or call into the live Obsidian runtime —
 * production code paths that touch the vault are exercised through
 * injected fakes — so the stubs here only need to exist as importable
 * shapes. `normalizePath` is the one exception: a few tests check
 * post-normalization output, so its implementation mirrors the real
 * one closely enough for those assertions.
 */

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.trim();
}

export class TAbstractFile {
	path = "";
}

export class TFile extends TAbstractFile {
	extension = "";
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class App {}
export class Component {}
export class ItemView {}
export class Modal {}
export class Notice {
	constructor(_message: string) {}
}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class WorkspaceLeaf {}
export class MarkdownRenderer {}
