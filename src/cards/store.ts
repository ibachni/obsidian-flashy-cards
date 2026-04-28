import { create } from "zustand";
import type { ParsedCard } from "./parser";

interface CardStoreState {
	cardsByPath: Map<string, ParsedCard>;
	invalidByPath: Map<string, string>;

	setCard: (card: ParsedCard) => void;
	setInvalid: (path: string, error: string) => void;
	removeCard: (path: string) => void;
	clear: () => void;
}

export const useCardStore = create<CardStoreState>((set) => ({
	cardsByPath: new Map(),
	invalidByPath: new Map(),

	setCard: (card) =>
		set((s) => {
			const next = new Map(s.cardsByPath);
			next.set(card.path, card);
			const inv = new Map(s.invalidByPath);
			inv.delete(card.path);
			return { cardsByPath: next, invalidByPath: inv };
		}),

	setInvalid: (path, error) =>
		set((s) => {
			const next = new Map(s.cardsByPath);
			next.delete(path);
			const inv = new Map(s.invalidByPath);
			inv.set(path, error);
			return { cardsByPath: next, invalidByPath: inv };
		}),

	removeCard: (path) =>
		set((s) => {
			const next = new Map(s.cardsByPath);
			next.delete(path);
			const inv = new Map(s.invalidByPath);
			inv.delete(path);
			return { cardsByPath: next, invalidByPath: inv };
		}),

	clear: () =>
		set({ cardsByPath: new Map(), invalidByPath: new Map() }),
}));
