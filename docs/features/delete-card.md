# Delete a card from the UI

Roadmap item #2 from [feature-roadmap.md](./feature-roadmap.md). Sibling to [edit-card.md](./edit-card.md) — same surfaces, same patterns — and **depends on it landing first** so the row-level icon column and Review footer action area already exist.

## Motivation

Today a user who wants to remove a card has to:

1. Open the `.md` file in Obsidian's native editor (Browse row click).
2. Right-click the tab → "Delete file" (or move to system trash from the file manager).
3. Wait for the `metadataCache` event to propagate so the store removes it.

Steps 2–3 are off-surface from the plugin and the user gets no scoped feedback ("which deck am I cleaning up?"). Worse, the Review pane keeps the old card in its picker briefly until the store reconciles. A first-class Delete action with optimistic store removal closes that gap and matches what every other SRS app ships.

## Scope

What this does:

- Trashes the card file via `app.vault.trash(file, true)` — second arg `true` requests system trash (recoverable), not vault `.trash`. Same call shape as Obsidian's own "Delete file" action.
- Removes the card from `useCardStore` immediately so Browse, Review, and the topic table reflect the deletion in the same tick the user clicks.
- Prunes the deleted path from `reviewScope` if present, so a scoped review session doesn't carry a dead path.

What this does not do:

- No bulk delete (multi-select rows) — that's roadmap #11 (bulk ops).
- No "delete and reschedule siblings" — there are no siblings until cloze (#7) ships.
- No empty-folder cleanup. If deleting the last card in a topic leaves an empty `<cardsRoot>/<topic>/` folder, that's fine — the create path will reuse it; Obsidian doesn't surface empty folders in the file tree by default.

## Files

**New**

- [src/views/DeleteCardConfirm.tsx](../../src/views/DeleteCardConfirm.tsx) — React component for the confirmation prompt, rendered inside an Obsidian `Modal` host the same way `EditCardModal` is ([edit-card.md → Hosting the form](./edit-card.md#hosting-the-form)).

**Modified**

- [src/views/CardRow.tsx](../../src/views/CardRow.tsx) — add a trash icon to the row's action area (already established by Edit in [edit-card.md](./edit-card.md), Phase 5). Sits to the right of the pencil. Both icons get `stopPropagation` so the row's open-in-Obsidian click still fires elsewhere.
- [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx) — pass `onDelete(card)` down to `CardRow`; opens the confirm modal.
- [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx) — add a "Delete" button to the footer action row, next to "Edit". Pressing it opens the confirm modal for `current`.
- [src/main.tsx](../../src/main.tsx) — add `plugin.openDeleteCardConfirm(card)` and a `learning-system:delete-current-card` command (Review-only, `checkCallback` returns false when no `current`).

## Confirmation modal

Small, focused, and biased toward safety. Layout:

```
Delete this card?

  <topic>/<slug>.md
  fsrs_state · due <fsrs_due> · <reps> reviews

The file moves to your system trash and can be restored.

                    [ Cancel ]   [ Delete ]
```

Behavior:

- **Cancel** is the default-focused button — Enter on open does not delete. Esc closes without deleting.
- **Delete** is a destructive button (red / accent-danger). Confirms and triggers the trash call.
- The body line that shows `<reps> reviews` is the friction signal: deleting a card with real review history is rare and intentional, and seeing the rep count surfaces the cost.
- No "don't ask again" checkbox in v1. Cards aren't created in bulk often enough for the confirm friction to matter; bulk-delete (#11) ships its own non-modal flow.

## Delete flow

1. **Resolve the file.** `const file = app.vault.getAbstractFileByPath(card.path); if (!(file instanceof TFile)) { Notice("Card file missing"); return; }` — mirrors the guard in [gradeAndPersist](../../src/main.tsx#L685-L689).
2. **Trash.** `await app.vault.trash(file, true)`. The `true` flag puts the file in the OS trash (Finder / Explorer / freedesktop), which is recoverable through the OS. On platforms where system trash isn't available (mobile), Obsidian falls back to the vault's local `.trash/` automatically — no extra handling needed.
3. **Optimistic store removal.** `useCardStore.getState().removeCard(card.path)` — the action already exists at [store.ts:46-53](../../src/cards/store.ts#L46-L53). Browse and Review re-render without the card in the same tick.
4. **Prune `reviewScope`.** If `reviewScope` is non-null and contains `card.path`, call `setReviewScope(prev.filter(p => p !== card.path))`. Without this, a scoped session ending with only deleted paths would compute as "empty scope" — which currently auto-clears the scope ([ReviewPane.tsx:32-36](../../src/views/ReviewPane.tsx#L32-L36)). Pruning keeps the scope state honest.
5. **Notice.** `new Notice("Deleted <slug>.md")`.
6. **Close the modal.**

The Obsidian `vault.trash` call also fires the `vault.on("delete", …)` event the plugin already listens for in [main.tsx](../../src/main.tsx); that handler's `removeCard` will be a no-op (we already pruned), which is fine.

## Review-mid-grade behavior

Deleting the current card from the Review footer is the trickiest case. The sequence:

1. User clicks Delete → confirm modal opens. The Review pane is still showing `current`.
2. User confirms. `removeCard(current.path)` runs.
3. `cardsByPath` updates → `useCardStore` selector fires → `ReviewPane` re-renders.
4. `pickNext(cardArray, now, reviewScope)` runs against the new array. It returns the next due card, or `null` if none.
5. The pane either shows the next card with `revealed: false` or the empty-state.

`revealed` is local state in `ReviewPane` and survives the re-render. Reset it in the same gesture: pass an `onAfterDelete` callback into the modal that calls `setRevealed(false)`. Without this, the next card surfaces with its answer already shown.

## Entry points

- **Browse row** — trash icon, right of the pencil icon added in #1. `e.stopPropagation()` so row-click is unaffected.
- **Review footer** — "Delete" button next to "Edit".
- **Command palette** — `learning-system:delete-current-card`. Review-only via `checkCallback`.

No keyboard shortcut in v1. Mass-delete-by-keyboard is an antifeature in an SRS; roadmap #3 (undo last grade) handles the more common fat-finger case.

## Tests

`vault.trash` is an Obsidian-API call against a mocked vault — not worth a unit test for v1. The valuable behaviors are integration-shaped and verified manually per phase:

- Deleting from Browse removes the row immediately.
- Deleting the Review-current card surfaces the next card with `revealed: false`.
- Deleting a card from a scoped session prunes it from `reviewScope`; the scope-active indicator stays until the session genuinely empties.
- Trashed file appears in the OS trash and can be restored; restoring it brings the card back on the next `metadataCache` scan.

If [src/cards/store.ts](../../src/cards/store.ts) grows a non-trivial `removeCard` later (e.g. cascading sibling removal for cloze, #7), add a unit test then.

## Implementation phases

Two phases, each shippable.

### Phase 1 — Modal + delete flow

Scope: [src/views/DeleteCardConfirm.tsx](../../src/views/DeleteCardConfirm.tsx), [src/main.tsx](../../src/main.tsx).

- Add `LearningSystemDeleteCardConfirm extends Modal` — same shape as the edit modal host.
- Implement the confirm body and Cancel / Delete buttons.
- Implement the delete flow (steps 1–6 above), including `reviewScope` pruning.
- Temporary dev command (`delete-card-dev`) that opens the modal for the first card in the store — verifies theming, copy, and the trash call against a throwaway card.

Exit criteria: dev command trashes a test card, removes it from the store, and the file shows up in the OS trash.

### Phase 2 — Entry points

Scope: [src/views/CardRow.tsx](../../src/views/CardRow.tsx), [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx), [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx), [src/main.tsx](../../src/main.tsx).

- Add trash icon to `CardRow`; pass `onDelete` through `BrowsePane`.
- Add "Delete" button to the `ReviewPane` footer next to "Edit". Pass an `onAfterDelete` callback that resets `revealed`.
- Replace the dev command with `learning-system:delete-current-card` (Review-only).

Exit criteria: Delete reachable from Browse row, Review footer, and command palette; Review-mid-grade behaves per [Review-mid-grade behavior](#review-mid-grade-behavior).

## Decisions baked in

1. **System trash, not vault trash.** `vault.trash(file, true)` — recoverable via the OS. Avoids cluttering `<vault>/.trash/` and matches what users expect from "Delete".
2. **Confirmation is mandatory in v1.** No "don't ask again". Edit (#1) is non-destructive and skips a confirm; Delete is destructive and doesn't. Bulk-delete (#11) ships its own UX where a confirm-per-row would be wrong.
3. **Optimistic store removal.** Mirrors `gradeAndPersist`'s optimistic update — the `vault.on("delete")` handler still runs and reconciles. Without this, the Browse row would linger for a tick.
4. **Delete-current-card resets `revealed`.** Otherwise the next card surfaces with the answer pre-revealed. Tiny detail, immediately jarring.
5. **No keyboard shortcut.** Destructive single-key bindings are too easy to fat-finger in a review rhythm.
