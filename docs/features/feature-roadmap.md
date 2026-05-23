# Feature ideas (prioritized)

A ranked roadmap of features that would meaningfully improve the Learning System for daily use. Priorities reflect impact on real workflow, not implementation cost.

The plugin today covers: Review (FSRS), Browse (filter + scoped review), Create (Anki-style rapid entry), cream/dark theming, FSRS settings, and a planned Claudian holding-file integration. Everything below is either missing or could be substantially deeper.

---

## P0 — Daily-use gaps

These are the things a user runs into within the first hour of real use. Without them, the system feels unfinished.

### 1. Edit an existing card from the UI
**Shipped** — see [edit-card.md](./edit-card.md). Pencil icon on each Browse row, "Edit" button in the Review footer, and the `learning-system:edit-current-card` command open a modal form. Frontmatter writes go through `processFrontMatter` so `fsrs_*` is never touched; body writes use a narrow `rewriteBody` that copies the frontmatter block byte-for-byte.

### 2. Delete a card from the UI
**Shipped** — see [delete-card.md](./delete-card.md). Trash icon on each Browse row, "Delete" button in the Review footer, and the `learning-system:delete-current-card` command open a confirm modal that runs `app.vault.trash(file, true)` (system trash, recoverable). Optimistic `removeCard` so Browse/Review re-render in the same tick; prunes the path from `reviewScope` if a scoped session is active.

### 3. Undo last grade
**Shipped** — see [keyboard-and-undo.md](./keyboard-and-undo.md). One-slot ring buffer (`undoSlot` on the plugin) populated by `gradeAndPersist` after a successful FSRS write; `undoLastGrade` re-applies the prior frontmatter via `processFrontMatter`. Surfaced as the `u` keybind and an Undo icon in the Review footer; the icon's enabled/disabled state tracks the buffer via a pub-sub `undoSlotListeners` set so it reflects live state without prop drilling.

### 4. Show projected intervals on grade buttons
**Shipped** — see [previewIntervals](../../src/srs/fsrs-engine.ts) and [formatInterval](../../src/views/date-utils.ts). One `engine.repeat` call yields all four candidate due dates without mutating the card; the formatter picks a single dominant unit (`1m` / `4h` / `4d` / `2mo` / `1y`, floored at 1m for fuzz-jittered learning steps). Rendered as a smaller mono/tabular second line under each grade-button label, memoized per visible card so fuzzed values don't re-jitter on render ticks.

### 5. Keyboard-first Review pane
**Shipped** — see [keyboard-and-undo.md](./keyboard-and-undo.md). Document-level keydown listener on the plugin dispatches via `plugin.reviewActions`, which `ReviewPane` registers on mount and clears on unmount: `Space`/`Enter` reveal, `1`–`4` grade Again/Hard/Good/Easy when revealed, `e` open source, `u` undo. A `HotkeyHint` row in the Review footer surfaces the bindings inline. Still TODO: `s` suspend (depends on #13).

### 6. Open card source from Review
**Shipped** as part of #5 — `e` invokes `app.workspace.openLinkText(current.path, "", false)` to reuse the active leaf, same primitive Browse uses for row-click. Affordance is the keybind row in the footer rather than a separate "Open file" link; can promote to a click target later if heavy-use friction shows up.

---

## P1 — Common SRS expectations

These are features mature SRS apps ship and that a returning Anki/Mochi/RemNote user will look for immediately.

### 7. Cloze deletions
**Shipped** — see [cloze-deletions.md](./cloze-deletions.md). `{{cN::text}}` syntax in question and/or answer expands one .md file into N sibling cards, each keyed by `<path>#c<N>` and carrying its own FSRS state in a frontmatter `fsrs_clozes` map. Parser pre-renders the masked question (active cloze hidden as `[…]`, other clozes show their text — Anki convention) and the revealed answer (active spans wrapped in `<mark class="ls-cloze-active">` for the accent tint). Browse rows distinguish siblings with a `· cN` suffix; Review pane meta strip shows the active cloze index. Edit modal pre-fills from the raw source so editing doesn't erase cloze syntax. Dev command `seed-cloze-example` drops a 3-sibling Spanish-verb demo card into the cards root.

### 8. Daily new-card cap + per-day review cap
Two integers in settings: `dailyNewLimit` (default 10) and `dailyReviewCap` (default unlimited). The picker honors both. Stops the "new-card avalanche" that happens when a user adds 50 cards in a batch and is then crushed by reviews three days later.

### 9. Statistics / progress dashboard
**Shipped** — see [stats-pane.md](./stats-pane.md). Fourth mode in the nav: **Stats**, with five panels — state breakdown, 30-day forecast (stacked by state), retention rate (last 200 grades), daily streak (with "today alive" semantics), and per-topic retention (last 30 days, weakest-first, with a min-grade noise floor). Frontmatter panels read from `useCardStore`; log-derived panels read through a shared `useReviewLog` hook that refreshes on `metadataCache.changed`.

### 10. Heatmap calendar of reviews
**Shipped** — see [stats-pane.md](./stats-pane.md) (the sixth panel on the Stats pane). GitHub-style 53×7 SVG grid with adaptive cell sizing via `ResizeObserver` (6–12px), 5 color buckets ramping from `--ls-subtle` through `--ls-accent` so cream/dark theming works without a per-bucket branch. Auto-falls-back to a 26-week view on narrow panes with a "Show full year" toggle when there's an actual choice to make.

### 11. Bulk operations in Browse
Multi-select rows (checkbox column or `shift-click`). Bulk actions:
- Move to topic (folder rename + frontmatter rewrite).
- Add / remove tag.
- Delete.
- Suspend / unsuspend.

Browse already supports filtering; bulk operations turn it into a real management surface.

### 12. Full-text search across cards
A search box at the top of Browse. Matches against Q, A, topic, tags. Debounced 150ms. Optionally fuzzy. Augments the existing topic+tag+state filters rather than replacing them.

### 13. Suspend / bury
- **Suspend**: card removed from queue until manually unsuspended. Use case: leech cards, seasonal material, on-hold content. Adds `fsrs_suspended: bool` to frontmatter.
- **Bury**: card removed from queue for the rest of the day (auto-unsuspend at midnight). Use case: just-failed a sibling, want to avoid immediate re-test.

Action buttons in Review and Browse. Suspended cards show in Browse with a muted style and are excluded from `pickNext`.

### 14. Flag / star
Boolean `flagged: bool` in frontmatter. UI: flag icon in Review and Browse. Filter pill in Browse ("Flagged only"). Useful for "come back to this", "review with teacher", "wrong answer feels arbitrary".

### 15. Per-card review history
**Partially shipped** — sidecar log foundation landed; see [review-log.md](./review-log.md). Append-only JSONL at `<cardsRoot>/.learning-system/history/<YYYY-MM>.jsonl` with one line per grade `{path, topic, date, grade, interval, prevState}`. Hooked into `gradeAndPersist` as a best-effort write (never blocks a grade). Read primitives `appendGrade` / `readMonth` / `readRecent` / `readAll` already consumed by the Stats pane (#9) and the heatmap (#10).

**Still TODO**: surface the log per-card (Browse row hover popover; per-card detail view). The data is there — only the UI is missing.

### 16. Image support
Drag-and-drop or paste an image into Q/A. Image gets saved under `<cardsRoot>/_attachments/` and embedded as `![[…]]`. Renders in Review via the existing `MarkdownBlock`. Essential for diagrams, anatomy, anything visual.

### 17. Quick-create from selection
Command: "Create card from selection". User highlights text in any note → invokes the command → NewCardPane opens with the selection pre-filled as the question (or split heuristically on the first `?`). Topic defaults to the source file's parent folder.

This is the bridge between Obsidian-as-notes and Obsidian-as-flashcards. Without it, card creation is a context switch.

### 18. Reverse cards / sibling cards
A checkbox in Create: "Also create reverse (A → Q)". Generates a sibling card with Q and A swapped, linked via the existing `related: []` field. Good for vocab, definitions, term-and-meaning.

### 19. Tag hierarchy
Tags currently flat. Allow `parent/child/grandchild` style with `/` as separator. Browse's `TagCombobox` renders them as a tree. Filtering on `lang` matches everything under `lang/*`. Mirrors Obsidian's nested-tag convention so the cognitive model is consistent.

### 20. Nested topics
Topics are currently single-segment ("Decisions baked in" #2 in [new-card-command.md](./new-card-command.md)). Lift the restriction: `lang/spanish/verbs/` becomes a valid topic. The `TopicTable` becomes a tree; the topic combobox supports `/` as a separator and shows the hierarchy.

### 21. Saved filter presets
Browse filters are good but ephemeral — they reset on reload. Let the user save a filter combination as a named preset ("DNS due today", "Spanish learning"). Stored in `data.json`. One-click recall.

---

## P2 — Power-user polish

These are features that the regular user might never touch but that the heavy user will lean on.

### 22. Cram mode
A "Cram" button on a topic / filtered Browse set: review every card in the set N times today, ignoring FSRS scheduling, without writing back to `fsrs_*`. Use case: night before an exam.

### 23. Custom study session
A modal that builds a temporary deck from arbitrary filters ("only cards I've failed this week", "20 random new cards from topic X"). Reviews against the temporary set; FSRS still updates per-card.

### 24. Smart deck (saved dynamic query)
A named, saved set of filters that always reflects current state — e.g. "Lapsed in last 7 days". Appears in Browse alongside topics. Combines #21 and #23.

### 25. Per-topic FSRS overrides
Some topics need higher retention (anki-grade language vocab) and some lower (general reading). Override `requestRetention` and `maximumInterval` per topic, stored alongside the topic folder.

### 26. Adaptive FSRS retraining
Once enough review history is accumulated (#15), expose a "Retrain FSRS parameters" command that runs the FSRS optimizer against the user's actual grade log and updates engine weights. ts-fsrs ships this.

### 27. Typed-answer mode
For cards where exact recall matters, type the answer instead of self-grading. Compare against the answer field (case-insensitive, whitespace-normalized). Show diff on mismatch. Auto-grade Good on exact match, surface the human grading buttons on mismatch.

### 28. AI card generation from selection or note
Right-click a selection or whole note → "Generate flashcards". Calls an LLM (user-supplied API key, opt-in per [AGENTS.md](../../AGENTS.md) policy) to produce candidate Q/A pairs. User reviews, edits, accepts into a chosen topic. Massive accelerator for converting notes into cards.

### 29. AI-graded typed answers
For typed-answer mode (#27), use a semantic-similarity model (or a small LLM call) to grade "close enough" answers. Particularly valuable for free-form definitions where exact-string matching is too strict.

### 30. Hint field
Optional `hint: string` in frontmatter. Shown above the answer reveal as a one-tap reveal. Useful for cards where you want a partial cue before giving up.

### 31. Source / citation field
Optional `source: string | wikilink` in frontmatter. Renders as a "From: [[…]]" line in Review. Connects cards back to the originating note — important for the Obsidian-native use case.

### 32. Surface the `related` field
Frontmatter already has `related: []`. Add UI: pill list of related cards in Review (hover → preview, click → open). In Create, a "Link related" combobox over existing cards. The schema's already there, just exposed via UI.

### 33. Anki import
Import an `.apkg` or Anki CSV export into the vault. Map Anki notes to cards, preserving review history if available. The single biggest barrier for an Anki user to migrate.

### 34. Export
Round-trip the other direction: Anki CSV, JSON, or markdown bundle. Useful for backup, sharing decks, or moving off the plugin.

### 35. Daily reminder notification
Optional notification (via Obsidian's `Notice` API or a system notification on desktop) once a day if there are due cards and the user hasn't opened the Review pane.

### 36. Mobile-optimized swipe gestures
On iOS/Android: swipe left = Again, swipe down = Hard, swipe up = Good, swipe right = Easy. Tap = reveal. The plugin already declares `isDesktopOnly: false`; the pane just needs gesture handlers.

### 37. Obsidian Tasks integration
Auto-create a task in the user's Daily Note ("Review N cards") that completes when the queue is empty. Bidirectional: completing the task opens the Review pane.

### 38. Mark-and-elaborate workflow (already planned P2)
The settings UI mentions `claudianHoldingFile` for appending mark-and-elaborate prompts. Finish this: a button in Review ("Elaborate") that appends a structured prompt to the holding file with the current card, ready for the user to expand in a Claudian session.

### 39. "Recently failed" / "Recently created" views
Two preset views in Browse:
- **Recently failed**: cards graded Again in the last 7 days, ordered by most recent fail.
- **Recently created**: new cards added in the last N days, useful for double-checking a batch entry.

### 40. Sibling-card burying
When a sibling card (same `path`, different cloze index) is graded, auto-bury the others for the day. Without this, the same card source surfaces three times in one session.

---

## P3 — Experimental / future-looking

Speculative but high-ceiling features. Don't build until P0–P2 are solid.

### 41. Audio cards
Record audio directly in the Create pane (Web Audio API). Use case: pronunciation practice, music intervals. Plays inline in Review.

### 42. Image occlusion
Upload an image, draw rectangles to mask. Each mask becomes a card (Q: image with this rectangle hidden, A: image with the rectangle revealed). Anatomy, geography, UI inspection — huge in medical-student communities.

### 43. Inline cloze syntax in regular notes
Detect `{{c1::cloze}}` markup in any note in the vault and auto-create flashcards from it. The card's source file is the note itself, not a dedicated card file. Lets the user write notes and "promote" sentences to cards in-place.

### 44. Backlink-driven card creation
When viewing any note, show a small "Linked cards: N" pill. Click → list of cards whose `source` or `related` references this note. Closes the loop between note-taking and reviewing.

### 45. Streak / gamification
XP per review, daily streak counter, milestone badges. Carefully — gamification can become coercive. Default off; opt-in.

### 46. Cross-vault sync API
Export FSRS state per card to a portable JSON manifest; import on another machine. Lets a user maintain one set of cards across multiple vaults without git-tracking the entire learning folder.

### 47. Drag-and-drop reordering in Browse
Drag a card from one topic onto another in the `TopicTable` to move it. Updates the folder + frontmatter.

### 48. Community card sharing
Export a topic as a shareable bundle (markdown + manifest); import a bundle into a vault. Foundation for a deck marketplace if there's ever demand.

### 49. Spaced practice across vaults
For users with personal + work vaults, a "global review" mode that pulls due cards from multiple vaults. Requires a daemon or a shared sidecar location.

---

## Cross-cutting themes

Some patterns repeat across the list and are worth calling out:

- **Sidecar metadata.** Several features (review log, suspended state, flag) want per-card mutable data that doesn't belong in user-edited frontmatter. A `<cardsRoot>/.learning-system/` sidecar directory keyed by card path (or a path-hash for rename-safety) solves several P1/P2 features at once.
- **A schema migration path.** Adding `fsrs_suspended`, `flagged`, `hint`, `source` to the Zod schema in [src/schema/card.ts](../../src/schema/card.ts) every time is going to bite. Bake in a forward-compatible defaulting strategy now (already partially present via `.default(0)` for `fsrs_learning_steps`).
- **The Browse pane is the right surface for management.** Most P0/P1 management features (bulk ops, suspend, flag, delete, search, presets) belong on the existing Browse pane rather than scattered across new views.
- **The Review pane needs more density.** Today it shows Q, A, and grade buttons. The footer has room for: streak, retention rate, next interval previews, suspend/flag controls, "open file", and undo — all without crowding.
- **AI features stay opt-in per [AGENTS.md](../../AGENTS.md).** The policy is local-first; #28/#29 require explicit user opt-in, a settings-level API key, and clear disclosure.
