# Keyboard-first Review + undo last grade

Roadmap items #3 (Undo last grade) and #5 (Keyboard-first Review pane) from [feature-roadmap.md](./feature-roadmap.md). Bundled because the `u` shortcut is one of the keys feature #5 ships, and there's no point binding it before the undo capability exists. Sharing the keyboard-handler scaffolding once is cheaper than wiring two waves of `keydown` plumbing.

## Motivation

Today the Review pane is mouse-driven: reveal is a button, grades are four buttons, edit and delete are footer buttons. The command-palette `grade-next-*` commands exist as fallback but require Cmd+P → typing → Enter for every card — that's three keystrokes per grade in what should be a one-key rhythm. A long review session (50+ cards) becomes physically tiring and breaks the focus loop that makes spaced repetition work.

The fat-finger problem makes it worse. Grading Again when you meant Good can't be undone without manually editing `fsrs_*` frontmatter — which most users won't even attempt, since touching FSRS state by hand is the exact failure mode [edit-card.md](./edit-card.md) was built to avoid. The single most-requested Anki feature is undo for a reason: high-volume keyboard grading creates fat-finger mistakes the user wants to recover from in-rhythm without leaving the pane.

## Scope

**In:**

- Keyboard bindings on the Review pane, active only when the Learning System leaf is focused **and** the active mode is `review`:
    - `Space` / `Enter` → reveal the answer.
    - `1` / `2` / `3` / `4` → grade Again / Hard / Good / Easy when revealed.
    - `e` → open the card's source `.md` in the main editor area.
    - `u` → undo the last grade.
- "Undo" link in the Review footer next to "Edit" / "Delete" — visible when the buffer holds a grade to undo, muted/disabled when not.
- One-slot in-memory undo buffer on the plugin instance: stores `{ path, previousFm, logDate }` after every grade; cleared after a successful undo.
- Undo restores the card's FSRS frontmatter to its pre-grade snapshot and truncates the matching review-log line so Stats stays accurate.
- A `learning-system:undo-last-grade` command for command-palette parity (mirrors how `edit-current-card` / `delete-current-card` ship both icon + command).

**Out:**

- `s` (suspend) — listed in the roadmap under #5 but suspend itself is feature #13. Ship the binding when #13 ships; reserve the key now by no-oping with a Notice if pressed pre-#13 (see [Decisions baked in](#decisions-baked-in) #5).
- Cmd+Z global shortcut. `u` is unambiguous and survives the Edit/Delete modal lifecycle without needing a custom keymap override; Cmd+Z is reserved by the host OS for editor undo and would fight Obsidian.
- Multi-step undo / redo. Single-slot per the roadmap spec — anything deeper risks the user undoing a grade from two cards ago and not noticing.
- Cross-session undo. The buffer is in-memory; an Obsidian reload clears it. Persisting the rollback through a vault reload would mean serializing pre-grade snapshots to disk and reconciling against a possibly-mutated card — high cost, narrow payoff.
- Projected interval previews on the grade buttons (`Good · 4d`). That's feature #4, separate.
- A first-class "Open file" link in the footer. That's feature #6 — but `e` and #6 share the same underlying call, so #6 reuses what this ships.

## Files

**New**

- [src/cards/undo-buffer.ts](../../src/cards/undo-buffer.ts) — pure module exporting a tiny one-slot ring buffer keyed off the plugin instance. Two functions: `stashGrade(slot, entry)` and `takeGrade(slot)`. The slot itself is a `{ entry: UndoEntry | null }` object the plugin owns. Pure so it's trivially unit-testable.
- [src/cards/review-log.ts](../../src/cards/review-log.ts) — gains one new exported function: `truncateLastEntry(app, cardsRoot, expected: { path, date })`. Reads the latest month file, verifies the last JSONL line matches `expected`, rewrites the file without it. No-op + `console.warn` if the last line doesn't match (something else wrote in between — see [Race window](#race-window-undo-vs-concurrent-grade)). Added to the existing file rather than a new module so all log writes/reads live together.
- [src/cards/undo-buffer.test.ts](../../src/cards/undo-buffer.test.ts) — Vitest unit tests for `stashGrade` / `takeGrade`.
- [src/cards/review-log.test.ts](../../src/cards/review-log.test.ts) — already exists; extend with cases for `truncateLastEntry` (happy path, mismatch abort, single-entry file → empty file, file missing → no-op).

**Modified**

- [src/main.tsx](../../src/main.tsx)
    - Add a private `undoSlot: { entry: UndoEntry | null } = { entry: null }` field on `LearningSystemPlugin`.
    - In `gradeAndPersist`: before the `processFrontMatter` write, snapshot `{ path: card.path, previousFm: structuredClone(card.fm), logDate: modified }` into `undoSlot`. Snapshot lands only if the FSRS update succeeds (don't stash on a failed grade).
    - Add `undoLastGrade()` method — see [Undo flow](#undo-flow).
    - Register the `learning-system:undo-last-grade` command with a `checkCallback` that returns false when `undoSlot.entry === null`.
    - The existing `d`-keybinding listener already demonstrates the "inputs / editable elements bail" pattern ([main.tsx:618-637](../../src/main.tsx#L618-L637)). Reuse the shape: a single document-level `keydown` registration that gates on `view.mode === "review"`, focus inside `.learning-system-pane` or active leaf is ours, and the target is not an input. See [Keyboard listener placement](#keyboard-listener-placement).
- [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx)
    - Add an "Undo" button to the footer action row alongside "Edit" / "Delete". Render via `plugin.undoSlot.entry` — but since plugin state isn't a React store, the button needs a re-render trigger. Cheapest path: read a `[, force] = useReducer(...)` counter that bumps from a subscription on the plugin instance (a tiny `EventEmitter`-shaped surface). See [Footer reactivity](#footer-reactivity).
    - No internal keyboard handlers here — keyboard lives in `main.tsx` per [Keyboard listener placement](#keyboard-listener-placement). The reveal toggle and grade fns stay where they are; the listener calls them via a setter the pane exposes.
- [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx) — no change. The active mode is already on the view, and the plugin reads it from there.

## Undo entry shape

```ts
interface UndoEntry {
  /** Card path — used to resolve the TFile and verify against the current card. */
  path: string;
  /** Deep-cloned frontmatter snapshot from *before* the grade. Restored verbatim. */
  previousFm: CardFrontmatterT;
  /** YYYY-MM-DD written into the review-log entry's `date` field. Used to find the month file. */
  logDate: string;
}
```

`previousFm` includes the prior `fsrs_*` block, the prior `modified` date, and every other key — restoring it overwrites today's grade-side `modified` write with whatever was there before, which is the correct rollback semantics. The previous-fm clone uses `structuredClone` (built-in) rather than a hand-rolled deep copy so future schema additions (suspended, flagged, hint, source — see [feature-roadmap.md → Cross-cutting themes](./feature-roadmap.md#cross-cutting-themes)) work without revisiting this code.

The slot wrapper is a plain object so swapping in a future ring buffer (multi-step undo) doesn't change the call sites: `slot.entry = …` / `const e = slot.entry; slot.entry = null`. Pure functions in [undo-buffer.ts](../../src/cards/undo-buffer.ts) encapsulate this so direct mutation isn't sprinkled around.

## Undo flow

`plugin.undoLastGrade()`:

1. **Pop the slot.** `const entry = takeGrade(this.undoSlot)`. Returns `null` if nothing's there → show `Notice("Nothing to undo")` and return.
2. **Resolve the file.** `const file = app.vault.getAbstractFileByPath(entry.path)`. If it's not a `TFile`, the card was deleted between grade and undo — show `Notice("Card no longer exists; cannot undo")` and return without re-stashing (the buffer is already cleared). The log truncation still runs in this branch so Stats stays consistent.
3. **Restore frontmatter.** `await app.fileManager.processFrontMatter(file, (raw) => Object.assign(raw, entry.previousFm))`. Same primitive as `gradeAndPersist` — atomic, leaves any non-FSRS keys the user edited mid-grade alone? **Not quite.** `Object.assign(raw, previousFm)` only overwrites keys that exist in `previousFm`. Keys added by the user (e.g. they hit Save in Edit during the modal-while-graded window) would survive. Keys *removed* by the user wouldn't be re-added — same trade-off the grade path has.
4. **Optimistic store update.** `useCardStore.getState().setCard({ ...currentCard, fm: entry.previousFm })`. `currentCard` comes from `cardsByPath.get(entry.path)` — uses the fresh question/answer if the user edited those mid-window. If the path isn't in the store anymore (deleted), step 2 already returned.
5. **Truncate the log line.** `await truncateLastEntry(app, normalizedCardsRoot(), { path: entry.path, date: entry.logDate })`. Best-effort like `appendGrade` is — if it fails, log to console and surface a `Notice("Undo applied; log rollback failed")` so the user knows Stats may be one entry stale.
6. **Notice + footer refresh.** `Notice("Undo: <slug>.md")`. Emit a change event so the Review footer re-renders without the "Undo" link.
7. **Slot stays cleared.** No re-stash. A second `u` is a no-op.

### Race window: undo vs. concurrent grade

The slot can desync from disk in one scenario: the user grades a card on machine A while the same vault is synced from machine B. Between A's grade and A's undo, B writes a different grade. A's undo would then restore A's pre-grade snapshot, overwriting B's grade.

This is the same race `gradeAndPersist` already has (it doesn't read-verify before writing), so we don't add new behavior. The log-truncate guard catches a subset: if B's grade landed via the same vault, B appended a log line and A's `truncateLastEntry` would see a path mismatch on the last line and abort the truncation with a console warning. The FM restore still happens — accepted trade-off for v1. Multi-device sync isn't a v1 supported workflow.

The narrower in-process race — user clicks Grade, then clicks Undo before `gradeAndPersist`'s promise settles — is resolved by the order of operations: the slot is set *after* `processFrontMatter` returns, so an Undo click while the grade is still in flight finds an empty slot and shows "Nothing to undo".

## Keyboard listener placement

Two options considered:

1. **React `useEffect` inside `ReviewPane`.** Pros: state (`revealed`, `current`) is already in scope; cleanup is automatic on unmount. Cons: the pane is sticky-mounted (`mountedModes` pattern, see [unified-pane.md → Lazy-mount, sticky-mount](./unified-pane.md)) — when the user is on Browse or Create, the pane stays mounted with `hidden`. A document-level listener installed by the pane would keep firing in the background; the gate would need to read mode from context or props, which adds plumbing for no benefit.
2. **Plugin-level `registerDomEvent`.** Pros: same pattern as the existing `d` theme toggle ([main.tsx:618-637](../../src/main.tsx#L618-L637)); cleanup tied to plugin unload; no React-state coupling. Cons: needs to bridge to React-owned state (`revealed`).

**Option 2 wins.** The pane exposes a tiny imperative handle via the plugin: `plugin.reviewActions = { reveal, grade, isRevealed }` set from a `useEffect` in `ReviewPane` and cleared on unmount. The plugin keydown handler calls into `reviewActions` when it exists, or no-ops when it doesn't. This is the same shape as `confirmClose` in `LearningSystemEditCardModal` ([main.tsx:379-385](../../src/main.tsx#L379-L385)) — a known-good pattern in this codebase.

Handler logic:

```ts
this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const target = e.target as HTMLElement | null;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) return;

  // Match the `d` listener's locality check: focus inside our pane,
  // or one of our leaves is the active leaf.
  const inPane = !!target?.closest?.(".learning-system-pane");
  const activeIsOurs = !!this.app.workspace.getActiveViewOfType(LearningSystemView);
  if (!inPane && !activeIsOurs) return;

  // Mode gate: only fire on Review.
  const activeLeaf = this.app.workspace.getActiveViewOfType(LearningSystemView);
  if (activeLeaf?.getMode?.() !== "review") return;

  const actions = this.reviewActions; // set by ReviewPane's useEffect
  if (!actions) return;

  switch (e.key) {
    case " ":
    case "Enter":
      if (!actions.isRevealed()) { e.preventDefault(); actions.reveal(); }
      break;
    case "1": case "2": case "3": case "4":
      if (actions.isRevealed()) { e.preventDefault(); actions.grade(keyToRating(e.key)); }
      break;
    case "e":
      e.preventDefault(); actions.openSource();
      break;
    case "u":
      e.preventDefault(); void this.undoLastGrade();
      break;
  }
});
```

`getMode()` is a small public accessor added to `LearningSystemView` so we don't reach into a private field — same shape as `setMode`.

`preventDefault` matters most for `Space`/`Enter`: without it, Space scrolls the pane and Enter activates whichever button has focus (often "Show answer" once, then nothing, then a grade button — confusing).

## Footer reactivity

The "Undo" link needs to enable/disable as the slot toggles, but the slot lives on the plugin instance, not in a React store. Two options:

1. **Tiny pub-sub on the plugin.** Add `undoSlotListeners: Set<() => void>` and call them after `stashGrade` / `takeGrade`. The pane subscribes in `useEffect`, increments a counter on each fire, re-renders. ~10 lines, no dependency change.
2. **Migrate the slot into a Zustand store.** Heavier — every grade now goes through one more store update, and undo state isn't really "card store" data.

**Option 1.** The store is reserved for card data; ephemeral session state (undo slot, future "currently elaborating" markers) doesn't fit. The listener set is private to the plugin and the pane is the only subscriber.

## Open card source (`e`)

`openSource()` in `reviewActions` calls:

```ts
const file = this.app.vault.getAbstractFileByPath(current.path);
if (file instanceof TFile) {
  void this.app.workspace.getLeaf().openFile(file);
}
```

`getLeaf()` (no args) reuses the active leaf in the main editor area — same behavior as the existing Browse row-click (verify by reading [BrowsePane.tsx](../../src/views/BrowsePane.tsx) before Phase 4). This is the underlying primitive feature #6 will surface as a footer link.

## UI: footer changes

Footer rows in order:

1. Scope chip (existing).
2. Card metadata: `<topic> · <section> · due <fsrs_due> · <fsrs_state>` (existing).
3. Action buttons: Edit (existing), Delete (existing), **Undo** (new).
4. Counts: `<doneCount> done · <due> due · <newCount> new` (existing).

The Undo link uses the same `ls-flat … text-[10px] uppercase tracking-wider` styling as Edit/Delete. Color: muted by default, `text-fg-strong!` on hover (same as Edit, not red — undo is non-destructive). Disabled state: lower opacity, `pointer-events: none`, no hover effect. Implemented via a single `disabled` attribute on `<button>` so screen readers see the state correctly.

The button label is **Undo** rather than **Undo grade** — the action area is constrained and the context (Review footer) disambiguates.

## Tests

Pure helpers:

- [src/cards/undo-buffer.test.ts](../../src/cards/undo-buffer.test.ts) — `stashGrade` overwrites the prior entry; `takeGrade` returns the entry and clears the slot; consecutive `takeGrade` returns null.
- [src/cards/review-log.test.ts](../../src/cards/review-log.test.ts) (extend) — `truncateLastEntry`:
    - Happy path: 3-line file, truncate matching last entry → file is 2 lines.
    - Mismatch: last entry has a different path/date → file unchanged, function returns `false` / warns.
    - Single-entry file → empty file (or deleted file — pick one; spec says "empty so the next append works without re-creating").
    - Missing file → no-op, no throw.
    - CRLF line endings → handled.

Unit tests stop there. The grade/undo round-trip, the keyboard handler, and footer reactivity are integration-shaped and verified manually per phase.

Manual smoke checklist (per [edit-card.md](./edit-card.md) convention):

- Grade a card with `3`; press `u`; card returns to Review with its prior `fsrs_due` and `fsrs_state`. Browse row reflects the rollback in the same tick.
- Grade two cards in a row; press `u`; only the *second* grade rolls back. Press `u` again; Notice "Nothing to undo".
- Grade a card via the on-screen "Good" button (not keyboard); press `u`; same rollback.
- Grade a card with `1`; press `u`; check the month file's last line is gone.
- Press `1` while answer is hidden → no grade fires.
- Press `Space` while a tag-filter combobox is focused on Browse → no reveal (focus check works).
- Press `e` on the current card → the `.md` opens in the main editor.
- Press `u` while no card is current (empty Review state) → Notice "Nothing to undo".

## Implementation phases

Five phases, each shippable.

### Phase 1 — Undo buffer + log truncation

Scope: [src/cards/undo-buffer.ts](../../src/cards/undo-buffer.ts), [src/cards/review-log.ts](../../src/cards/review-log.ts), [src/cards/undo-buffer.test.ts](../../src/cards/undo-buffer.test.ts), [src/cards/review-log.test.ts](../../src/cards/review-log.test.ts).

- Implement the pure helpers and their tests.
- No wiring into `main.tsx` yet.

Exit: `vitest run` green; nothing user-visible.

### Phase 2 — Grade-side snapshot + `undoLastGrade`

Scope: [src/main.tsx](../../src/main.tsx).

- Add `undoSlot` + `undoSlotListeners` fields.
- Snapshot in `gradeAndPersist` after the FSRS update succeeds.
- Implement `undoLastGrade()` per [Undo flow](#undo-flow).
- Register `learning-system:undo-last-grade` command with `checkCallback`.

Exit: grading a card, then invoking the command via Cmd+P, rolls the card back; the `.jsonl` last line is gone.

### Phase 3 — Footer "Undo" link

Scope: [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx), [src/main.tsx](../../src/main.tsx).

- Add the footer button with disabled-state handling.
- Subscribe to `undoSlotListeners` from a `useEffect` in the pane; force re-render on change.
- Click → `plugin.undoLastGrade()`.

Exit: the Undo link is visible after a grade, disabled when nothing to undo, and clicking it rolls back.

### Phase 4 — `reviewActions` handle + keyboard listener

Scope: [src/main.tsx](../../src/main.tsx), [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx).

- Expose `LearningSystemView.getMode()`.
- Pane registers a `plugin.reviewActions = { reveal, grade, isRevealed, openSource }` handle in a `useEffect` keyed on `[current, revealed]`; clears on unmount.
- Register the document-level `keydown` listener per [Keyboard listener placement](#keyboard-listener-placement).
- Handle `Space` / `Enter` / `1`-`4` / `e` / `u`.

Exit: all keyboard bindings work; bindings no-op outside Review mode and inside inputs.

### Phase 5 — Polish & manual smoke

Scope: cleanup only.

- Walk the [Tests → manual smoke checklist](#tests).
- Re-check focus/IME safety for non-Latin keyboards (Space + 1-4 are layout-neutral; `e` / `u` should also work — they're position-independent character keys).
- Confirm Edit/Delete modals still work as expected (the `keydown` listener bails on `INPUT`/`TEXTAREA`/`contentEditable`, and the modal's own Esc/Enter handling is independent).

Exit: feature ready to merge.

## Decisions baked in

1. **In-memory undo, not persistent.** A reload clears the buffer. Persisting would mean serializing snapshots to disk and validating them against possibly-mutated cards on next launch — high complexity, narrow payoff, and a footgun if the user "undoes" a grade from yesterday they've already followed up on.
2. **One-slot, not a stack.** Matches the roadmap spec and matches Anki. Undo is for fat-finger recovery, not history navigation.
3. **Log truncation is best-effort with a guard.** The `expected: { path, date }` check prevents truncating an unrelated entry if something raced. Stats accuracy is the goal, not strict log immutability.
4. **Keyboard handler lives in main.tsx, not in the pane.** Same locality model as the `d` theme toggle. Bridging to React state via an imperative handle (`reviewActions`) is the cheapest way to keep keyboard logic in one place while reading live React state.
5. **`s` is reserved but not yet bound.** Adding a no-op handler now (Notice "Suspend is not implemented yet — coming in #13") is tempting but spammy. Skip the binding entirely; #13 ships it.
6. **`Space` and `Enter` both reveal.** Anki's `Space` is the de-facto SRS standard; `Enter` is the OS default for "activate default button" and many users hit it without thinking. Mapping both costs nothing.
7. **`u` not `Cmd+Z`.** `u` is unambiguous, doesn't fight the host OS, and doesn't break Obsidian's own editor undo. Mapping `Cmd+Z` would also require deciding what to do when focus is in an editor (the answer is "let the editor handle it"), which adds branches to the gate.
8. **No grade flash / animation on undo.** The pane simply re-renders with the prior state; the user already knows they pressed `u`. Animation would slow down rapid undo-then-regrade.
