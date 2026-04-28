import { createContext, useContext, type ReactNode } from "react";
import type { App, Component } from "obsidian";
import type LearningSystemPlugin from "../main";

export interface PluginCtx {
	app: App;
	plugin: LearningSystemPlugin;
	/** The Obsidian View — used as the parent Component for MarkdownRenderer cleanup. */
	view: Component;
}

const Context = createContext<PluginCtx | null>(null);

export function PluginContextProvider({
	value,
	children,
}: {
	value: PluginCtx;
	children: ReactNode;
}) {
	return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePluginContext(): PluginCtx {
	const ctx = useContext(Context);
	if (!ctx) {
		throw new Error(
			"usePluginContext must be used within PluginContextProvider",
		);
	}
	return ctx;
}
