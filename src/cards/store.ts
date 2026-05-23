import { create } from "zustand";
import type { ParsedCard } from "./parser";

interface CardStoreState {
	/**
	 * Cards keyed by their in-memory `id`: `<path>` for non-cloze cards,
	 * `<path>#c<N>` for cloze siblings. The store treats each sibling as
	 * an independent card — picker, Review, Browse all iterate values()
	 * and never need to know whether two cards share a source file.
	 */
	cardsById: Map<string, ParsedCard>;
	invalidByPath: Map<string, string>;
	/**
	 * Optional list of card paths the Review pane should iterate over.
	 * `null` means "all cards in store". Set by Browse → "Test this
	 * section"; cleared by Review when its scoped session reaches the
	 * empty state.
	 */
	reviewScope: string[] | null;
	/**
	 * Path of the occlusion card currently being edited via the
	 * Occlusion pane, or `null` when the pane is in create mode. Set
	 * by the plugin's `openEditCardModal` branch for occlusion
	 * siblings — see main.tsx. Lives on the store (not as a pane prop)
	 * so the plugin can flip both the mode and the editing target in
	 * one update without re-mounting the pane.
	 */
	editingOcclusionPath: string | null;

	setCard: (card: ParsedCard) => void;
	setInvalid: (path: string, error: string) => void;
	/**
	 * Remove every card backed by `path`. For non-cloze cards this is a
	 * single-key delete (id === path). For cloze cards it sweeps the map
	 * for every sibling, since one file can back N entries.
	 */
	removeCard: (path: string) => void;
	/**
	 * Atomic re-parse: drop every existing card backed by `path` and
	 * insert the new sibling set in a single state update. Eliminates
	 * the intermediate "no cards from this path" frame that a separate
	 * removeCard + setCard sequence would expose to React renders.
	 *
	 * Used by the watcher's refreshCard flow. Also clears any prior
	 * invalid mark for the path — a successful re-parse supersedes
	 * earlier failures.
	 */
	replaceCardsForPath: (path: string, cards: ParsedCard[]) => void;
	clear: () => void;
	setReviewScope: (paths: string[] | null) => void;
	clearReviewScope: () => void;
	setEditingOcclusionPath: (path: string | null) => void;
}

export const useCardStore = create<CardStoreState>((set) => ({
	cardsById: new Map(),
	invalidByPath: new Map(),
	reviewScope: null,
	editingOcclusionPath: null,

	setCard: (card) =>
		set((s) => {
			const next = new Map(s.cardsById);
			next.set(card.id, card);
			const inv = new Map(s.invalidByPath);
			inv.delete(card.path);
			return { cardsById: next, invalidByPath: inv };
		}),

	setInvalid: (path, error) =>
		set((s) => {
			// Drop every card backed by this path — an "invalid" event
			// supersedes the previous parse, including all cloze siblings.
			const next = new Map(s.cardsById);
			for (const [id, card] of next) {
				if (card.path === path) next.delete(id);
			}
			const inv = new Map(s.invalidByPath);
			inv.set(path, error);
			return { cardsById: next, invalidByPath: inv };
		}),

	removeCard: (path) =>
		set((s) => {
			const next = new Map(s.cardsById);
			for (const [id, card] of next) {
				if (card.path === path) next.delete(id);
			}
			const inv = new Map(s.invalidByPath);
			inv.delete(path);
			return { cardsById: next, invalidByPath: inv };
		}),

	replaceCardsForPath: (path, cards) =>
		set((s) => {
			const next = new Map(s.cardsById);
			// Drop stale siblings of this path before inserting the new
			// set — handles the cloze-removed / cloze-renumbered cases
			// where a re-parse produces fewer or differently-numbered
			// siblings than the prior parse.
			for (const [id, card] of next) {
				if (card.path === path) next.delete(id);
			}
			for (const card of cards) {
				next.set(card.id, card);
			}
			const inv = new Map(s.invalidByPath);
			inv.delete(path);
			return { cardsById: next, invalidByPath: inv };
		}),

	clear: () =>
		set({ cardsById: new Map(), invalidByPath: new Map() }),

	setReviewScope: (paths) => set({ reviewScope: paths }),
	clearReviewScope: () => set({ reviewScope: null }),
	setEditingOcclusionPath: (path) => set({ editingOcclusionPath: path }),
}));
