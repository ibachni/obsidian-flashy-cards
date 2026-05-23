import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedCard } from "./parser";
import { useCardStore } from "./store";

function card(id: string, path: string): ParsedCard {
	return {
		id,
		path,
		clozeIndex: id === path ? null : Number(id.split("#c")[1]),
		question: "q",
		answer: "a",
		fm: {
			type: "flashcard",
			topic: "Test",
			created: "2026-01-01",
			modified: "2026-01-01",
			fsrs_due: "2026-04-28",
			fsrs_stability: 1,
			fsrs_difficulty: 5,
			fsrs_elapsed_days: 0,
			fsrs_scheduled_days: 1,
			fsrs_learning_steps: 0,
			fsrs_reps: 0,
			fsrs_lapses: 0,
			fsrs_state: "new",
			fsrs_last_review: null,
			tags: [],
			related: [],
		},
	};
}

describe("useCardStore", () => {
	beforeEach(() => {
		useCardStore.getState().clear();
	});

	it("setCard keys by id, not path", () => {
		// Two cloze siblings share a path but have distinct ids — both
		// must coexist in the store.
		useCardStore.getState().setCard(card("vocab/x.md#c1", "vocab/x.md"));
		useCardStore.getState().setCard(card("vocab/x.md#c2", "vocab/x.md"));
		const cards = useCardStore.getState().cardsById;
		expect(cards.size).toBe(2);
		expect(cards.get("vocab/x.md#c1")).toBeDefined();
		expect(cards.get("vocab/x.md#c2")).toBeDefined();
	});

	it("removeCard sweeps every sibling backed by the given path", () => {
		// File-level delete must cascade to every sibling. Without the
		// sweep, removing "vocab/x.md" would leave the cloze siblings
		// stranded with no backing file.
		useCardStore.getState().setCard(card("vocab/x.md#c1", "vocab/x.md"));
		useCardStore.getState().setCard(card("vocab/x.md#c2", "vocab/x.md"));
		useCardStore.getState().setCard(card("other/y.md", "other/y.md"));
		useCardStore.getState().removeCard("vocab/x.md");
		const cards = useCardStore.getState().cardsById;
		expect(cards.size).toBe(1);
		expect(cards.get("other/y.md")).toBeDefined();
		expect(cards.get("vocab/x.md#c1")).toBeUndefined();
		expect(cards.get("vocab/x.md#c2")).toBeUndefined();
	});

	it("setInvalid sweeps siblings of the affected path", () => {
		// A parse that flips to invalid (e.g. the user broke the YAML)
		// must drop every prior sibling — the file's whole card set is
		// suspect, not just one cloze.
		useCardStore.getState().setCard(card("vocab/x.md#c1", "vocab/x.md"));
		useCardStore.getState().setCard(card("vocab/x.md#c2", "vocab/x.md"));
		useCardStore.getState().setInvalid("vocab/x.md", "bad yaml");
		const state = useCardStore.getState();
		expect(state.cardsById.size).toBe(0);
		expect(state.invalidByPath.get("vocab/x.md")).toBe("bad yaml");
	});

	it("setCard clears any prior invalid mark for its path", () => {
		useCardStore.getState().setInvalid("vocab/x.md", "bad yaml");
		useCardStore.getState().setCard(card("vocab/x.md", "vocab/x.md"));
		expect(useCardStore.getState().invalidByPath.get("vocab/x.md")).toBeUndefined();
	});

	it("replaceCardsForPath drops orphan siblings on re-parse", () => {
		// The watcher contract: when a file's cloze count changes, the
		// re-parse must produce a store state that no longer contains
		// the dropped sibling — otherwise the picker would surface a
		// card whose backing data no longer exists.
		useCardStore.getState().setCard(card("vocab/x.md#c1", "vocab/x.md"));
		useCardStore.getState().setCard(card("vocab/x.md#c2", "vocab/x.md"));
		useCardStore.getState().setCard(card("vocab/x.md#c3", "vocab/x.md"));
		// User removed c2 and c3 from the body. Re-parse returns just c1.
		useCardStore
			.getState()
			.replaceCardsForPath("vocab/x.md", [
				card("vocab/x.md#c1", "vocab/x.md"),
			]);
		const cards = useCardStore.getState().cardsById;
		expect(cards.size).toBe(1);
		expect(cards.get("vocab/x.md#c1")).toBeDefined();
		expect(cards.get("vocab/x.md#c2")).toBeUndefined();
		expect(cards.get("vocab/x.md#c3")).toBeUndefined();
	});

	it("replaceCardsForPath preserves cards from other paths", () => {
		useCardStore.getState().setCard(card("vocab/x.md#c1", "vocab/x.md"));
		useCardStore.getState().setCard(card("other/y.md", "other/y.md"));
		useCardStore
			.getState()
			.replaceCardsForPath("vocab/x.md", [
				card("vocab/x.md#c1", "vocab/x.md"),
				card("vocab/x.md#c2", "vocab/x.md"),
			]);
		const cards = useCardStore.getState().cardsById;
		expect(cards.size).toBe(3);
		expect(cards.get("other/y.md")).toBeDefined();
	});

	it("replaceCardsForPath clears any prior invalid mark", () => {
		// Recovery path: file was invalid (bad YAML), user fixed it,
		// re-parse succeeds. The invalid mark must lift in the same
		// state update as the cards arrive.
		useCardStore.getState().setInvalid("vocab/x.md", "bad yaml");
		useCardStore
			.getState()
			.replaceCardsForPath("vocab/x.md", [
				card("vocab/x.md", "vocab/x.md"),
			]);
		const state = useCardStore.getState();
		expect(state.invalidByPath.get("vocab/x.md")).toBeUndefined();
		expect(state.cardsById.get("vocab/x.md")).toBeDefined();
	});

	it("clear empties everything", () => {
		useCardStore.getState().setCard(card("vocab/x.md", "vocab/x.md"));
		useCardStore.getState().setInvalid("vocab/y.md", "err");
		useCardStore.getState().clear();
		const state = useCardStore.getState();
		expect(state.cardsById.size).toBe(0);
		expect(state.invalidByPath.size).toBe(0);
	});
});
