import { create } from "zustand";
import type { ParsedCard } from "./parser";

interface CardStoreState {
	cardsByPath: Map<string, ParsedCard>;
	invalidByPath: Map<string, string>;
	/**
	 * Optional list of card paths the Review pane should iterate over.
	 * `null` means "all cards in store". Set by Browse → "Test this
	 * section"; cleared by Review when its scoped session reaches the
	 * empty state.
	 */
	reviewScope: string[] | null;

	setCard: (card: ParsedCard) => void;
	setInvalid: (path: string, error: string) => void;
	removeCard: (path: string) => void;
	clear: () => void;
	setReviewScope: (paths: string[] | null) => void;
	clearReviewScope: () => void;
}

export const useCardStore = create<CardStoreState>((set) => ({
	cardsByPath: new Map(),
	invalidByPath: new Map(),
	reviewScope: null,

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

	setReviewScope: (paths) => set({ reviewScope: paths }),
	clearReviewScope: () => set({ reviewScope: null }),
}));
