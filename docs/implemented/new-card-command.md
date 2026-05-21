# New card command

A right-sidebar pane for creating flashcards without hand-writing the FSRS frontmatter — sibling to the existing Review and Browse panes.

## Motivation

A valid card has 18 frontmatter fields, 11 of which are FSRS bookkeeping (`fsrs_due`, `fsrs_stability`, `fsrs_difficulty`, …). The schema in [src/schema/card.ts](../../src/schema/card.ts) requires almost all of them. Authoring by hand is error-prone and tedious. The plugin owns FSRS state, so it should own card creation.

## Files

**New**

- [src/cards/new-card.ts](../../src/cards/new-card.ts) — pure helpers: `slugify`, `newCardFrontmatter`, `findAvailablePath`, `serializeCard`. Unit-testable.
- [src/cards/new-card.test.ts](../../src/cards/new-card.test.ts) — Vitest unit tests.
- [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx) — React component for the form. Mounted by a `LearningSystemNewCardView extends ItemView` class in [src/main.tsx](../../src/main.tsx), mirroring the existing `LearningSystemView` (Review) and `LearningSystemBrowseView` (Browse) wiring at [src/main.tsx:74-89](../../src/main.tsx#L74-L89). The form (topic combobox, tag combobox, Q/A textareas) lives inside this component; no separate component file for the topic combobox in v1.

**Modified**

- [src/views/TagCombobox.tsx](../../src/views/TagCombobox.tsx) — parameterize for create-mode reuse: add `placeholder?: string` and `allowCreate?: boolean` props. When `allowCreate` is true and the trimmed query doesn't match any existing tag, the dropdown shows a `Create "<query>"` row that adds the new tag to the selection on Enter / click. Existing call sites pass neither prop and get the current "Filter by tag…" / no-create behavior unchanged.
- [src/main.tsx](../../src/main.tsx) — register the view type, command, ribbon icon, and an `activateNewCardView()` method that opens or reveals the leaf.

## Pane UI

Vertical form in the right sidebar:

1. **Topic** — inline combobox: autocomplete over existing topics (derived from `useCardStore`'s parsed cards' `fm.topic`), free input allowed for new topics. Implemented inline in `NewCardPane.tsx` rather than extracted — it's small enough that a shared abstraction would be premature. Required.
2. **Section** — text input. Optional.
3. **Tags** — [src/views/TagCombobox.tsx](../../src/views/TagCombobox.tsx) with `placeholder="Add tag…"` and `allowCreate`. Optional.
4. **Question** — multi-line textarea, autofocus when the pane opens. Required.
5. **Answer** — multi-line textarea. Required.
6. **Buttons**: **Save** (primary). No Cancel — the pane is dismissed by closing its tab, the same way Browse / Review panes are dismissed.

`Save` is disabled until Topic + Question + Answer are non-empty (whitespace-trimmed).

## Anki-style save flow

On `Save`:

1. Build the frontmatter object and validate it with `CardFrontmatter.safeParse` *before* serialization (defensive — should never fail given how we construct it; we don't use `result.data`, the check is purely a guard against drift between this code and the schema).
2. Resolve the destination path. Ensure the topic folder exists: check `app.vault.getAbstractFileByPath(folder)` first and only call `app.vault.createFolder(folder)` when it returns `null` (createFolder throws if the folder already exists, so the second card into an existing topic would otherwise fail).
3. Write the file via `app.vault.create(path, contents)`.
4. Show a `Notice` ("Created <slug>.md").
5. **Reset the form**: clear Question + Answer, refocus Question. **Keep** Topic / Section / Tags — they're sticky across rapid-entry sessions (matches Anki).

The pane stays mounted; the user closes its tab when they're done batch-entering. The created card is *not* opened in an editor — the user is presumed to be in a batch-entry flow. The Browse pane already lists it as soon as `metadataCache.changed` fires.

## Filename + path

- Slug: lowercase the question, replace non-`[a-z0-9]+` runs with `-`, strip leading/trailing `-`, then truncate. Truncation rule: if the result is ≤60 chars keep as-is; otherwise cut to 60 chars, and if a `-` exists at position ≥20 in the cut, trim back to it (so we end on a word boundary); if no `-` is ≥20 deep, hard-cut at 60.
- Fallback: if the slug is empty after normalization (e.g. question is all punctuation/CJK), use `card-<YYYYMMDD-HHmmss>`.
- Collision: if `<root>/<topic>/<slug>.md` exists, try `<slug>-2.md`, `<slug>-3.md`, … up to `-99`. Beyond that, append a timestamp.
- Path: `<cardsRoot>/<topic>/<slug>.md`. Topic is treated as a single path segment for v1 — slashes in the topic input get replaced with `-`.

## Frontmatter defaults

Match the existing schema in [src/schema/card.ts](../../src/schema/card.ts) for a freshly-created card:

```yaml
type: flashcard
topic: <user>
section: <user, omitted if blank>
created: <today, YYYY-MM-DD>
modified: <today>
fsrs_due: <today>          # immediately reviewable; see "Decisions baked in" #5
fsrs_stability: 0
fsrs_difficulty: 0
fsrs_elapsed_days: 0
fsrs_scheduled_days: 0
fsrs_learning_steps: 0
fsrs_reps: 0
fsrs_lapses: 0
fsrs_state: new
fsrs_last_review: null
tags: <user, empty array if none>
related: []
```

Date shape on disk: the existing convention ([dns-authoritative-server.md](../../dns-authoritative-server.md)) is *bare* YAML dates (`created: 2026-04-27`, no quotes), which is what makes Obsidian's Properties UI render a date-picker. `stringifyYaml`'s output depends on the value type passed in — a JS `Date` may serialize as a quoted ISO datetime, and a `"YYYY-MM-DD"` string serializes as a quoted string. Neither matches the convention.

Approach: build the date-field block by hand and concatenate. `serializeCard` (in [src/cards/new-card.ts](../../src/cards/new-card.ts)) returns:

```
---
type: flashcard
topic: <topic>
section: <section>           # only when non-empty
created: 2026-05-18
modified: 2026-05-18
fsrs_due: 2026-05-18
fsrs_stability: 0
...
fsrs_state: new
fsrs_last_review:            # bare null → renders as "null" via stringifyYaml below
tags:
  - <t1>
  - <t2>
related: []
---

# Question

<q>

# Answer

<a>
```

Implementation: serialize the date-typed and `null`-typed fields by hand (`fsrs_due`, `created`, `modified`, `fsrs_last_review`) so they land as bare values, and use `stringifyYaml` for the rest of the object (numbers, strings, arrays) to keep quoting consistent with `processFrontMatter` output. The serializer is a pure function and unit-tested. A 5-minute spike against the real `stringifyYaml` in `manifest.json`'s Obsidian build during implementation will confirm the exact behavior; if `stringifyYaml` happens to produce bare dates for `Date` instances after all, drop the hand-serialization for those fields.

## Wiring in main.tsx

- `VIEW_TYPE_NEW_CARD = "learning-system-new-card-view"`, registered via `this.registerView(...)` alongside the existing two view types.
- `LearningSystemNewCardView extends ItemView` mirrors `LearningSystemBrowseView`: empties `contentEl`, adds `learning-system-root` + `learning-system-pane`, mounts a React root on a child div, and renders `<PluginContextProvider><NewCardPane /></PluginContextProvider>`.
- `activateNewCardView()` mirrors `activateBrowseView()` — reveal an existing leaf if present, else `getRightLeaf(false)` + `setViewState`.
- `this.addCommand({ id: "new-card", name: "New card", callback: () => void this.activateNewCardView() })`.
- `this.addRibbonIcon("plus-circle", "Learning System: New card", () => void this.activateNewCardView())`.
- Extend the `applyTheme` types array to include `VIEW_TYPE_NEW_CARD` so the `dark` class toggles on the new pane too.

The pane reads `useCardStore` via `usePluginContext()` for topic autocomplete, and uses `plugin.app.vault` / `plugin.settings.cardsRoot` for the write.

## Theming

The pane's `contentEl` carries `learning-system-root` + `learning-system-pane` like the existing two panes — paints the cream/dark surface and provides the CSS variables. `TagCombobox`'s `closest(".learning-system-root")` theme detection ([TagCombobox.tsx:76-78](../../src/views/TagCombobox.tsx#L76-L78)) walks up to the pane's `contentEl` for free; no special workaround needed.

## Tests

In [src/cards/new-card.test.ts](../../src/cards/new-card.test.ts):

- `slugify`: ASCII normalization, punctuation collapse, length cap with `-` boundary, length cap *without* a `-` near the boundary (hard cut at 60), empty-input fallback.
- `newCardFrontmatter`: state defaults, date stamping, tags/section optional behavior, validates with `CardFrontmatter.safeParse`.
- `serializeCard`: date fields are emitted bare (no quotes), `fsrs_last_review` is `null` on disk, `section` is omitted when blank, body sections are well-formed.
- `findAvailablePath`: returns base path when free, `-2` on first collision, increments, falls back to timestamp after `-99`.

The modal itself stays untested — UI behavior is best verified manually.

## Implementation phases

Each phase is independently shippable and leaves the plugin in a working state. Phases 1 and 2 have no dependencies on each other and can be done in either order or in parallel.

### Phase 1 — Pure helpers + tests

Scope: [src/cards/new-card.ts](../../src/cards/new-card.ts), [src/cards/new-card.test.ts](../../src/cards/new-card.test.ts).

- Implement `slugify`, `newCardFrontmatter`, `findAvailablePath`, `serializeCard` as pure functions.
- Run the 5-minute `stringifyYaml` spike to confirm the hand-serialization plan for date / `null` fields; adjust `serializeCard` accordingly.
- Write the unit tests listed in [Tests](#tests).

Exit criteria: `vitest run` is green. Nothing user-visible yet.

### Phase 2 — `TagCombobox` create-mode

Scope: [src/views/TagCombobox.tsx](../../src/views/TagCombobox.tsx).

- Add `placeholder?: string` and `allowCreate?: boolean` props.
- Render the `Create "<query>"` row when `allowCreate` is true and the trimmed query has no exact match; selecting it adds the new tag.
- Verify the existing Browse-pane call site is unchanged (no props passed → current behavior).

Exit criteria: Browse pane behaves identically; new props are available for Phase 4.

### Phase 3 — Pane scaffolding

Scope: [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx), [src/main.tsx](../../src/main.tsx) (view-type registration + activation).

- Add `VIEW_TYPE_NEW_CARD`, `LearningSystemNewCardView`, `activateNewCardView()` to main.tsx alongside the existing pair, and add the view type to `applyTheme`'s loop.
- Render the static form layout (Topic, Section, Tags, Question, Answer, Save) in `NewCardPane.tsx` — inert, no state wiring beyond the minimal `useState` needed for `TagCombobox` (controlled).
- Temporarily expose the pane via a dev-only command (`new-card-dev`) to manually verify theming and the `TagCombobox` dropdown portal renders themed.

Exit criteria: command opens a pane with correct theme tokens; fields render but do nothing.

### Phase 4 — Form behavior + Anki save flow

Scope: [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx) (form logic).

- Inline topic combobox sourcing options from `useCardStore`'s parsed cards.
- Field state, trimmed-required validation, Save-disabled gating.
- Save handler: build frontmatter → `CardFrontmatter.safeParse` guard → ensure topic folder (`getAbstractFileByPath` then `createFolder`) → `vault.create` → `Notice` → reset Q/A, keep Topic/Section/Tags, refocus Question.
- Pane stays mounted across saves; the only dismissal gesture is closing the tab.

Exit criteria: a manual create flow produces a file that the Browse pane picks up.

### Phase 5 — Command + ribbon wiring

Scope: [src/main.tsx](../../src/main.tsx).

- `addCommand({ id: "new-card", name: "New card", callback: () => void this.activateNewCardView() })`.
- `addRibbonIcon("plus-circle", ...)`.
- Remove the dev-only opener from Phase 3.

Exit criteria: command palette and ribbon both open the pane; end-to-end batch entry works.

## Decisions baked in

1. **No auto-added tags.** The one existing example card has `tags: [flashcard, dns, authoritative]` (duplicating `type` and `topic`), but a convention isn't inferable from one card. The user adds tags manually. Easy to change later if a convention emerges.
2. **Single-segment topics.** No nested topic folders yet. Add later if needed; would require teaching the topic combobox about path separators.
3. **No "open in editor" after save.** Anki-style batch flow takes priority. If a non-batch "create one" path is wanted later, add a separate command that opens the file after save.
4. **No edit-existing-card flow.** Out of scope — the user edits cards directly in Obsidian; the plugin only handles creation.
5. **New cards are immediately reviewable (`fsrs_due: today`).** Matches the interactive "I just made this, I want to grade it" flow. Alternative would be `fsrs_due: today + N days` to keep new cards out of the active queue until later, but that conflicts with the FSRS `new` state's whole purpose. If a user needs backlog behavior, the right knob is a per-day new-card cap in the review picker, not a created-card delay.
