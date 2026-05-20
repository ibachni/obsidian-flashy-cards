# Edit an existing card from the UI

Roadmap item #1 from [feature-roadmap.md](./feature-roadmap.md). Today a user who wants to fix a typo, retag a card, or restructure a question has to open the underlying `.md` and hand-edit it — which means they can also accidentally clobber the FSRS frontmatter (`fsrs_due`, `fsrs_state`, …) and silently corrupt their scheduling. The plugin owns FSRS state for create + grade; it should own it for edit too.

## Motivation

Two concrete failure modes the current flow allows:

1. **Frontmatter typos.** Editing `tags:` by hand turns `- dns` into `- dn s` or drops the `-` indent. The next scan invalidates the card and it disappears from Browse / Review with no clear signal.
2. **FSRS clobber.** A user tidying frontmatter (or an AI assistant doing a "format pass") deletes `fsrs_learning_steps`, resets `fsrs_due`, or rewrites `fsrs_state` to `new`. The card's review history is effectively erased.

Both are eliminated by an Edit form that exposes only the user-owned fields and routes the write through `processFrontMatter`, the same atomic-merge primitive `gradeAndPersist` uses ([src/main.tsx:684-711](../../src/main.tsx#L684-L711)).

## Scope

User-editable from the UI: `topic`, `section`, `tags`, `question`, `answer`.

Never written by the edit path: `type`, `created`, `related` (v1 — `related` gets its own UI per roadmap #32), and all `fsrs_*` fields. `modified` is set to today by the save handler — same convention as `gradeAndPersist`.

Out of scope for v1: renaming / moving the file. A change to `topic` updates frontmatter only; the file stays at its original path. Move-on-topic-change is a follow-up (touches Browse's bulk-ops surface, roadmap #11).

## Files

**New**

- [src/cards/edit-card.ts](../../src/cards/edit-card.ts) — pure helpers: `rewriteBody(content, { question, answer })` returns the file contents with the `# Question` and `# Answer` body sections replaced and the frontmatter block left byte-identical. Mirrors the shape of [src/cards/new-card.ts](../../src/cards/new-card.ts).
- [src/cards/edit-card.test.ts](../../src/cards/edit-card.test.ts) — Vitest unit tests for `rewriteBody`.
- [src/views/EditCardModal.tsx](../../src/views/EditCardModal.tsx) — React component for the edit form, rendered inside an Obsidian `Modal` host (see [Hosting the form](#hosting-the-form)). Reuses `MarkdownField`, `TopicCombobox`, and `TagCombobox` from the create path.

**Modified**

- [src/views/CardRow.tsx](../../src/views/CardRow.tsx) — add an Edit affordance (pencil icon button) to the right of the state tag. Click stops propagation so the existing row-click (open in Obsidian) still works on the rest of the row.
- [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx) — wire row-level Edit into a modal open call; pass an `onEdit(card)` callback down to `CardRow`.
- [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx) — add an "Edit" button to the footer action area (next to the topic / section / due line). Clicking opens the same modal for `current`.
- [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx) — extract `TopicCombobox` (currently inlined, [NewCardPane.tsx:254-423](../../src/views/NewCardPane.tsx#L254-L423)) into a sibling module so the edit form can reuse it. Pure refactor — no behavior change.
- [src/main.tsx](../../src/main.tsx) — add `openEditCardModal(card)` on the plugin instance and a `learning-system:edit-current-card` command for keyboard-driven access from Review.

## Hosting the form

Two options considered:

1. **Modal overlay** — open an Obsidian `Modal` from anywhere (Browse row, Review footer, command palette), mount a React root inside its `contentEl`, dismiss on save / Esc / outside click.
2. **New `edit` mode in UnifiedPane** — like Create, but parameterized by which card is open.

Modal wins for v1. Reasons:

- Edit is a one-shot per-card action, not a sticky workflow. There's no batch-edit story (yet — that's roadmap #11), so we don't need form state to survive navigation.
- A modal opens in place from both Browse and Review without touching mode-routing in `UnifiedPane`.
- Avoids the CodeMirror-mounts-hidden gotcha that drove the `mountedModes` lazy-mount design ([UnifiedPane.tsx:34-58](../../src/views/UnifiedPane.tsx#L34-L58)) — a modal is only mounted while open.

Wiring: `LearningSystemEditCardModal extends Modal` in `main.tsx`. `onOpen` clears `contentEl`, adds `learning-system-root` + `learning-system-pane` (so theming + `TagCombobox`'s `closest(".learning-system-root")` walk both work, same as [new-card-command.md → Theming](./new-card-command.md)), creates a React root, renders `<PluginContextProvider><EditCardModal card={card} onSaved={...} onCancel={...} /></PluginContextProvider>`. `onClose` unmounts the root.

## Form

Same field layout as `NewCardPane`, pre-filled from the card:

1. **Topic** — `TopicCombobox` (extracted), pre-filled with `card.fm.topic`.
2. **Section** — text input, pre-filled with `card.fm.section ?? ""`.
3. **Tags** — `TagCombobox` (with `allowCreate`), pre-filled with `new Set(card.fm.tags)`.
4. **Question** — `MarkdownField`, pre-filled with `card.question`.
5. **Answer** — `MarkdownField`, pre-filled with `card.answer`.
6. **Buttons** — **Save** (primary) and **Cancel**. Cancel and Esc both dismiss without writing. Save is disabled unless Topic + Question + Answer are non-empty (whitespace-trimmed) — same gating as Create.

A small read-only line below the title shows the file path (`<topic>/<slug>.md`) and `fsrs_state · due <fsrs_due>`, so the user sees *what they're editing* and *that the FSRS state is preserved*. Tooltip on the FSRS line: "FSRS scheduling is preserved when you save."

Dirty-detection: track an `initial` snapshot at open; if any field differs and the user hits Esc or Cancel, show a `confirm()` ("Discard unsaved changes?"). Saving with no changes is a no-op (returns early before any write, shows no notice).

## Save flow

The atomicity concern is real but narrow. Two writers touch the file:

- **Grade** (`gradeAndPersist`) — writes only frontmatter via `processFrontMatter`. Never touches the body.
- **Edit** — writes frontmatter (topic/section/tags/modified) *and* body (Q/A).

So Edit's frontmatter write and Grade's frontmatter write can race on `modified` — last-writer-wins is acceptable; both stamp today's date. Edit's body write and Grade's frontmatter write are independent (different file regions), but `vault.modify` rewrites the whole file. Naive `vault.modify(file, serialize(...))` would clobber a Grade landing between our read and our write.

Two-step save eliminates the body/frontmatter race:

1. **Frontmatter** — `app.fileManager.processFrontMatter(file, (fm) => { fm.topic = …; fm.section = … || delete fm.section; fm.tags = […]; fm.modified = today; })`. Atomic, leaves every other key (including all `fsrs_*`) untouched. Same primitive `gradeAndPersist` uses, so concurrent grades merge cleanly.
2. **Body** — `const content = await app.vault.read(file); const next = rewriteBody(content, { question, answer }); await app.vault.modify(file, next);`. `rewriteBody` matches the leading `---\n…\n---\n` block with a single regex, copies it byte-for-byte, and only replaces what comes after. A grade that landed between (1) and (2) has only mutated frontmatter, which step (2) re-reads and preserves verbatim. Worst case: the user's `modified` from step (1) gets overwritten by a grade's `modified` — a 1-second-resolution date stamp, same value either way.

On success:

- Optimistic store update: `useCardStore.setCard({ ...card, fm: { ...card.fm, topic, section, tags, modified }, question, answer })`. Mirrors `gradeAndPersist`'s pattern ([main.tsx:704-710](../../src/main.tsx#L704-L710)) — the `metadataCache.changed` event will reconcile a tick later.
- `Notice("Updated <slug>.md")`.
- Close the modal.

On error: `Notice("Failed to save: <message>")` and keep the modal open with the user's edits intact.

## Why not rewrite the whole file?

Tempting alternative: build the full file from the (mutated) frontmatter + body and `vault.modify`. Rejected for the same reason `gradeAndPersist` uses `processFrontMatter`: any FSRS write that lands between our read and our modify would be silently overwritten. The two-step save keeps FSRS state owned by exactly one code path (`processFrontMatter` callbacks that touch `fsrs_*`), which is the invariant that makes the FSRS engine trustworthy.

`rewriteBody` is intentionally narrow — it does *not* touch the frontmatter block, even though it has the parsed object in hand. Anyone tempted to "just bump modified here" gets sent back to `processFrontMatter`.

## Entry points

- **Browse row** — pencil icon on `CardRow`. Click opens the modal for that card. Existing row-click (open in Obsidian) continues to work on the rest of the row; the icon `onClick` calls `e.stopPropagation()`.
- **Review footer** — "Edit" button next to the topic / section / due line. Opens the modal for `current`.
- **Command palette** — `learning-system:edit-current-card`. From the Review pane, edits the current card; from Browse or anywhere else, the command is hidden (`checkCallback` returns false when there's no current card). Future: a `learning-system:edit-card-by-slug` quick-switcher (out of scope for v1).

## Tests

In [src/cards/edit-card.test.ts](../../src/cards/edit-card.test.ts):

- `rewriteBody`: replaces `# Question` + `# Answer` sections; leaves the frontmatter block byte-identical (including comments, trailing whitespace, key order); handles CRLF line endings; handles a question with `# ` inside a fenced code block (existing parser caveat — `parseBodySections` has the same limitation, [parser.ts:33-44](../../src/cards/parser.ts#L33-L44) — and the rewriter inherits it).
- `rewriteBody` round-trip: parsing the rewritten output with `parseCardFile` yields the new Q/A and the original frontmatter unchanged.
- Edge: empty body (no `# Question` / `# Answer` yet, shouldn't happen but defensible) → returns content with the new sections appended.

The modal itself stays untested at the unit level — manual smoke test per phase.

## Implementation phases

Each phase ships independently and leaves the plugin in a working state.

### Phase 1 — `rewriteBody` + tests

Scope: [src/cards/edit-card.ts](../../src/cards/edit-card.ts), [src/cards/edit-card.test.ts](../../src/cards/edit-card.test.ts).

- Implement `rewriteBody(content, { question, answer })` as a pure function. Use the same `---\n[\s\S]*?\n---\n?` regex shape as [parser.ts:22-24](../../src/cards/parser.ts#L22-L24) to find the frontmatter terminator, then splice in the new body.
- Write the unit tests listed above.

Exit criteria: `vitest run` green. Nothing user-visible.

### Phase 2 — Extract `TopicCombobox`

Scope: [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx), new [src/views/TopicCombobox.tsx](../../src/views/TopicCombobox.tsx).

- Move the inline `TopicCombobox` ([NewCardPane.tsx:254-423](../../src/views/NewCardPane.tsx#L254-L423)) into its own file. Same API; no logic change.
- Update `NewCardPane.tsx` to import it.

Exit criteria: Create pane works identically; the component is importable from a sibling view.

### Phase 3 — Modal host + form scaffolding

Scope: [src/views/EditCardModal.tsx](../../src/views/EditCardModal.tsx), [src/main.tsx](../../src/main.tsx).

- Add `LearningSystemEditCardModal extends Modal` to main.tsx. `onOpen` mounts React; `onClose` unmounts.
- Add `plugin.openEditCardModal(card: ParsedCard)` and register a temporary dev command (`edit-card-dev`) that opens the modal for the first card in the store — sufficient to verify theming and field pre-fill.
- Render the static form layout, pre-filled from the card. Cancel / Esc dismiss; Save is wired but does nothing yet.

Exit criteria: dev command opens a themed modal pre-filled with a real card's data.

### Phase 4 — Save flow

Scope: [src/views/EditCardModal.tsx](../../src/views/EditCardModal.tsx), [src/main.tsx](../../src/main.tsx).

- Implement the two-step save (`processFrontMatter` → `rewriteBody` + `vault.modify`).
- Optimistic `useCardStore.setCard` update on success.
- Dirty-detection on Cancel / Esc.
- `Notice` on success / failure.

Exit criteria: a manual edit changes Q/A and tags; reloading the vault confirms the change persisted and `fsrs_*` is byte-identical to before.

### Phase 5 — Entry points

Scope: [src/views/CardRow.tsx](../../src/views/CardRow.tsx), [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx), [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx), [src/main.tsx](../../src/main.tsx).

- Add pencil-icon Edit button to `CardRow`; pass `onEdit` down from `BrowsePane`.
- Add "Edit" button to `ReviewPane` footer.
- Replace the dev command with `learning-system:edit-current-card` (Review-only, `checkCallback`).

Exit criteria: Edit reachable from Browse row, Review footer, and command palette.

## Decisions baked in

1. **Edit is a modal, not a pane.** One-shot, no batch story yet, avoids unified-pane plumbing.
2. **Frontmatter writes go through `processFrontMatter`.** Single primitive for all mutable frontmatter — preserves FSRS state under concurrent writes.
3. **Body writes use a narrow rewriter that ignores frontmatter.** Eliminates the temptation (and the bug class) of regenerating the whole file from a stale `card.fm` snapshot.
4. **Topic change does not move the file in v1.** Renames are a Browse-bulk-ops concern (roadmap #11); keeping the path stable here means undo is trivial.
5. **`related` is not editable in v1.** Surfacing `related` is roadmap #32 and ships with its own picker UI.
6. **`modified` is the only date this path writes.** `created` is owned by the create path; FSRS dates are owned by the grade path.
