# Cloze deletions

Roadmap item #7 from [feature-roadmap.md](./feature-roadmap.md). The single biggest format gap in the plugin today — one `.md` file produces exactly one card, which is wrong for vocab, language, definitions, and any "fill in the blank" study material that an Anki/Mochi/RemNote user expects to be a first-class format.

## Motivation

A user studying Spanish writes one card per verb form. Today that's seven files (yo / tú / él / nosotros / vosotros / ellos × tense) for a single conjugation table they conceptually know as "the present indicative of *hablar*". Each file holds one question and one answer; FSRS schedules each independently. The bookkeeping is so heavy that most users either give up on covering the full table or fold everything into one card and lose the per-form scheduling.

Cloze deletions collapse this: one file, `{{c1::hablo}} {{c2::hablas}} {{c3::habla}} …`, expands into N **sibling cards** sharing the source markdown. Each sibling has independent FSRS state, so the user gets per-form scheduling without per-form file management. Roughly doubles the practical value of the plugin for language/vocab/definitions, per the roadmap entry.

## Scope

**In:**

- `{{cN::text}}` syntax in either the question or the answer field. `N` is any positive integer.
- One sibling per unique cloze number across both fields. Multiple spans sharing a number (e.g. `{{c1::Paris}} … {{c1::France}}`) hide together as a single sibling.
- Per-sibling FSRS state in a frontmatter map `fsrs_clozes: { "1": { due, stability, … }, "2": { … } }`. Non-cloze cards keep flat `fsrs_*` scalars exactly as today — no migration.
- Mask convention: the active sibling's cloze spans render as `[…]` in the question and as a highlighted span (`<mark>`) in the answer. Inactive clozes show their text revealed (Anki convention).
- Cloze identity flows through every existing surface: Browse rows, Review pane, grade-and-persist, undo, review log, Stats.
- Editing a cloze card via `EditCardModal` shows the **raw** source (`{{c1::…}}`), not the masked form.

**Out:**

- **Hint syntax** `{{c1::text::hint}}`. Defer until a real use case shows up; the regex would have to handle the hint variant and the renderer would need a second visual treatment.
- **Sibling-card burying** (roadmap #40). Independent feature — when you grade sibling #1, the others stay in queue. Bundling here would conflate "card representation" with "scheduling policy".
- **Cloze toolbar / keybind** in `NewCardPane` (button that wraps the current selection in `{{c1::…}}` and auto-increments the index). Polish; the syntax is typeable as-is.
- **Migration of existing flat-FSRS cards to a unified sidecar**. The roadmap's cross-cutting note flags this direction long-term; doing it as a prerequisite for cloze would 5× the diff.
- **Nested clozes** (`{{c1::a {{c2::b}} c}}`). Regex is non-nesting by design. Document as unsupported and call it out in the parser.
- **Cloze in the topic / tags / section fields**. Body only.

## Persistence shape

Decided: **frontmatter map keyed by cloze number as string**. Co-located with the source, survives file moves, no sidecar to sync.

Cloze card:

```yaml
---
topic: Spanish/Verbs
created: 2026-05-22
modified: 2026-05-22
tags: [verbs]
related: []
fsrs_clozes:
  "1":
    due: 2026-05-23
    stability: 1.2
    difficulty: 5.0
    elapsed_days: 0
    scheduled_days: 1
    learning_steps: 0
    reps: 1
    lapses: 0
    state: learning
    last_review: 2026-05-22T10:14:00.000Z
  "2":
    due: 2026-05-25
    # …
---

# Q
{{c1::hablo}} (I speak) — {{c2::hablamos}} (we speak)

# A
Present indicative of *hablar*.
```

Non-cloze card: unchanged — flat `fsrs_*` scalars.

A card has **exactly one** form: either `fsrs_clozes` (cloze) or flat `fsrs_*` (non-cloze), never both. The validator enforces this with `z.refine` — strict, because a card holding both is schema drift we want to catch on read, not paper over.

## Cloze identity (the one seam everything flows through)

A new `id` field on `ParsedCard`:

- Non-cloze: `id = path` (unchanged behavior — `path` is still the identity for these).
- Cloze sibling N: `id = \`${path}#c${N}\``.

The store keys by `id` instead of `path`. The review log writes `id` as its `path` field — entries become `"vocab/hablar.md#c1"` etc, which preserves per-sibling history without a schema bump on the log side. Undo's slot carries `{ cardId, path, clozeIndex, previousFm }` so it knows whether to write back flat scalars or `fsrs_clozes[N]`.

This is the **single seam** where one file becomes N cards. Everything downstream — picker, review, grade-and-persist, render — operates on flat `ParsedCard`s where `fm.fsrs_*` are scalars. The parser does the expansion; the rest of the code stays unaware.

## Files

**New**

- `src/cards/cloze.ts` — pure module. Exports:
    - `parseClozes(text: string): ClozeSpan[]` — `[{ index, start, end, text }]` for each match.
    - `collectClozeIndices(question: string, answer: string): number[]` — sorted unique indices across both fields.
    - `maskField(text: string, activeIndex: number): string` — replace `{{cN::…}}` with `[…]` when `N === activeIndex`, otherwise unwrap to plain text.
    - `revealField(text: string, activeIndex: number): string` — unwrap all `{{cN::…}}`; wrap active-index spans in `<mark class="ls-cloze-active">…</mark>`.
- `src/cards/cloze.test.ts` — Vitest unit tests, exhaustively covering the regex and masking behavior.
- `docs/features/cloze-deletions.md` — this file.

**Modified**

- `src/schema/card.ts` — factor `FsrsScalars` out of `CardFrontmatter`; add optional `fsrs_clozes: z.record(z.string(), FsrsScalars)`; add the "exactly one form" refine.
- `src/cards/parser.ts` — `parseFile` return type changes from `ParsedCard` to `ParsedCard[]`. Adds the expansion logic. Cloze siblings carry `clozeIndex`, `rawQuestion`, `rawAnswer`, and the per-slot FSRS scalars on `fm`.
- `src/cards/store.ts` — `cardsByPath` becomes `cardsById`; `setCard` keys by `card.id`; `removeCard(path)` becomes a path-prefix sweep so all siblings of a deleted/renamed file go together.
- `src/main.tsx` — `gradeAndPersist` branches on `card.clozeIndex`: cloze sibling writes to `fsrs_clozes[String(clozeIndex)]`, non-cloze writes flat scalars. Same shape for `undoLastGrade`. Watcher → parser → store flow updates to handle `ParsedCard[]`.
- `src/cards/undo-buffer.ts` — `UndoEntry` grows `cardId` and `clozeIndex`; the consumer in `main.tsx` does the actual slot routing.
- `src/cards/review-log.ts` — no shape change; just pass `card.id` through where `path` flows in. Document that the `path` field can now carry the `#cN` suffix.
- `src/views/EditCardModal.tsx` — pre-fill from `card.rawQuestion ?? card.question` / `card.rawAnswer ?? card.answer` so the user edits the source syntax, not the masked view.
- `src/views/BrowsePane.tsx` / `src/views/CardRow.tsx` — show a small `· c1` suffix on cloze siblings so they're distinguishable in lists.
- `src/styles.css` — `.ls-cloze-active` style for the answer-side highlight.

**Unchanged (intentionally)**

- `src/cards/picker.ts` — operates on `ParsedCard[]` with flat `fm.fsrs_*`. Doesn't care that two cards share a path.
- `src/views/ReviewPane.tsx` — receives a `ParsedCard` with pre-rendered `question` / `answer`. The mask happens at parse time, not render time.
- `src/srs/fsrs-engine.ts` — `gradeWith` / `previewIntervals` take a flat scalar `fm`. The caller constructs the right input.
- `src/views/MarkdownBlock.tsx` — Obsidian's `MarkdownRenderer.render` already preserves `<mark>` HTML, so the highlight works without renderer changes.
- `src/views/NewCardPane.tsx` — user can type the syntax as-is; parser handles it on next read.

## Phase plan

Each phase ends in a state where the plugin is shippable and the non-cloze experience is unchanged. The whole feature does not need to land in one PR.

### Phase 1 — Cloze module + schema + parser expansion (foundation)

**Goal:** the data model knows about clozes end-to-end, but no UI surface uses it yet.

- Add `src/cards/cloze.ts` with `parseClozes`, `collectClozeIndices`, `maskField`, `revealField`.
- Extend `src/schema/card.ts` with `fsrs_clozes` and the "exactly one form" refine.
- Rewrite `src/cards/parser.ts` to return `ParsedCard[]`. For non-cloze cards: a 1-element array, unchanged shape. For cloze cards: N elements with the expansion logic.
- Add `id`, `clozeIndex`, `rawQuestion`, `rawAnswer` to the `ParsedCard` type.

**Tests:**

- `cloze.test.ts`: regex covers single span, repeated index, no match, multibyte text, math `$x^2$` inside cloze, code-fence boundary.
- `parser.test.ts`: a non-cloze file expands to a 1-element array unchanged; a cloze file with three unique indices in the question expands to three siblings with correct `id` / `clozeIndex` / `fm` slot mapping; a file with `fsrs_clozes` + flat scalars both present fails validation; a file with cloze in answer only also expands.

**Phase 1 ships nothing user-visible.** Existing cards keep working because the parser returns 1-element arrays for them and the rest of the code reads `array[0]` (or iterates, which is the same thing).

### Phase 2 — Store keying + grade-and-persist + undo + review log

**Goal:** A cloze card hand-edited into a file can be graded, undone, and shows up correctly in the review log. Browse and Review still don't display masks.

- `src/cards/store.ts`: rename `cardsByPath` → `cardsById`, key by `card.id`. `removeCard(path)` becomes a sweep over `cardsById.entries()`.
- `src/main.tsx`: watcher → parser → store flow handles `ParsedCard[]` (iterate and `setCard` each).
- `src/main.tsx`: `gradeAndPersist` branches on `card.clozeIndex`. Helper `fsrsScalarsFromUpdate(update)` strips the `fsrs_` prefix.
- `src/cards/undo-buffer.ts`: `UndoEntry` grows `cardId`, `clozeIndex`. `undoLastGrade` in `main.tsx` mirrors the grade-and-persist branch.
- `src/cards/review-log.ts`: pass `card.id` where `path` flows; document the new shape in a comment at the top of the file.

**Tests:**

- Grade-and-persist: cloze sibling write lands in `fsrs_clozes[N]` and leaves other slots untouched.
- Undo: cloze sibling undo restores `fsrs_clozes[N]` to its prior shape; non-cloze undo unchanged.
- Store: cloze siblings are all removed when a file is deleted/renamed.

**At end of Phase 2:** a user who manually adds `{{c1::…}} {{c2::…}}` to a card and reloads the plugin sees two sibling rows in Browse (with default `path#c1` styling — no nice label yet), can grade each independently, can undo each independently, and the review log has per-sibling entries.

### Phase 3 — Rendering (mask + highlight)

**Goal:** Review pane shows the masked question and the revealed-and-highlighted answer.

- Parser pre-renders `question` and `answer` via `maskField` / `revealField` on each sibling. `ParsedCard.question` is the masked form; `ParsedCard.answer` is the revealed-with-`<mark>` form.
- `src/styles.css`: add the `.ls-cloze-active` rule.
- `src/views/CardRow.tsx`: show `· c1` / `· c2` suffix when `clozeIndex !== null`.
- `src/views/BrowsePane.tsx`: nothing if `CardRow` carries the suffix.

**Tests:**

- Parser snapshot: for a fixture cloze card, the produced `question` and `answer` strings match the expected mask/reveal.
- No new UI-layer tests — the project has no RTL setup; the visual surface is the parser-output strings, which are already covered.

**Manual smoke test:** open the plugin, reload, grade a cloze card. Mask `[…]` should render in Q; highlighted span should render in A.

### Phase 4 — Edit modal + demo seed + roadmap update

**Goal:** Round-trip user experience. Editing a cloze card shows the source. A demo card showcases the format.

- `src/views/EditCardModal.tsx`: pre-fill from `card.rawQuestion ?? card.question` / `card.rawAnswer ?? card.answer`. The save path is already body-replace via `rewriteBody`, so editing the source is one-line change.
- `src/cards/demo-seed.ts`: add one cloze card (e.g. Spanish verb conjugation or a capital-cities row) so a fresh install demonstrates the format.
- `docs/features/feature-roadmap.md`: mark #7 as **Shipped** with a link to this doc.

**Tests:** none new — the edit-modal write path is already covered by the existing edit-card tests; the demo seed has no test surface.

## Decisions baked in

1. **Identity is `id`, not `path`.** Every other call site (review log, undo, store) flows the compound id through. Avoids a parallel "is this a cloze sibling?" check at every consumer.
2. **Pre-rendered mask in `ParsedCard.question` / `.answer`.** Render-time masking would push cloze awareness into `MarkdownBlock` and any future renderer. Pre-rendering keeps the renderer dumb.
3. **`fsrs_clozes` as `Record<string, FsrsScalars>`.** YAML round-trips object keys as strings; a `Record<number, …>` schema would lie. The parser converts to/from `number` at the boundary.
4. **Strict "one form" validation.** A card with both `fsrs_clozes` and flat `fsrs_*` fails parse with a clear error. Better than silently picking a side and rotting data.
5. **Mask convention: hide active, reveal others.** Anki convention; the user explicitly chose this in the planning round. The alternative (hide all) is sometimes useful for multi-fact recall but is harder for the common case.
6. **No special UI for cloze in `NewCardPane`.** The syntax is typeable. A toolbar button is a Phase 5 (out-of-scope) polish.
7. **Cloze in both Q and A.** Either field can hold cloze syntax; siblings span both. A card with `{{c1::…}}` only in the answer still produces sibling #1 — useful for "show the question, hide the punchline" cards.
8. **Same cloze number across spans hides together.** `{{c1::Paris}} is in {{c1::France}}` produces one sibling whose Q hides both spans. Matches Anki and makes "multi-blank single-fact" cards possible.

## Edge cases

- **Empty cloze body** `{{c1::}}` — parser skips (treated as no cloze).
- **Cloze inside code fence** — the parser doesn't know about fences. A `{{c1::…}}` inside a fenced code block will still expand into a sibling and the question will render the mask. Document this; if a user actually needs literal `{{cN::}}` in a code block, escape outside the cloze regex (e.g. `\{{c1::}}` — future hint, not blocking).
- **Cloze with `}}` inside the text** — regex is `(?:(?!\}\}).)*`, non-greedy and stopping at `}}`. A user wanting `}}` in cloze text is stuck; this is a known limitation, document it.
- **Cloze numbers > 99** — supported (regex is `\d+`), no upper bound enforced.
- **Cloze re-numbered after edit** — if the user renames `{{c2::…}}` to `{{c3::…}}`, sibling #2 disappears and sibling #3 appears in `new` state. The orphaned `fsrs_clozes["2"]` slot stays in frontmatter (we don't prune it). Future cleanup tool can sweep orphans; not worth the cycles for Phase 1.
- **Renaming a file via Obsidian's file explorer** — `processFrontMatter` follows the rename, and the watcher already handles path changes. Cloze siblings' `id` values rebuild on the next parse with the new path. Review-log entries keep the old path-prefix — historically accurate, no special handling needed.

## Risks

- **`<mark>` HTML in user-content markdown.** Obsidian's `MarkdownRenderer.render` permits a sanitized HTML subset including `<mark>`. If a future Obsidian release tightens the sanitizer, the highlight stops working but the answer text is still legible. Acceptable.
- **Schema refine error messages.** Zod's default refine error reads "Invalid input". The refine should include a clear `message:` so a manually-edited card's failure mode is debuggable.
- **Parser return-type change.** `parseFile` returning `ParsedCard[]` instead of `ParsedCard` touches every caller. Audit and refactor in Phase 1; the failure mode is loud (type error), so this is safe.
