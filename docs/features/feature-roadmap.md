# Feature ideas (prioritized)

A ranked roadmap of features that would meaningfully improve the Learning System for daily use. Priorities reflect impact on real workflow, not implementation cost.

The plugin today covers: Review (FSRS), Browse (filter + scoped review), Create (Anki-style rapid entry), cream/dark theming, FSRS settings, and a planned Claudian holding-file integration. Everything below is either missing or could be substantially deeper.

---

## P0 — Daily-use gaps

These are the things a user runs into within the first hour of real use. Without them, the system feels unfinished.

### 1. Edit an existing card from the UI
Currently a user has to open the .md file and edit Q/A by hand. They can also accidentally clobber FSRS frontmatter. Add an "Edit" action on [src/views/CardRow.tsx](../../src/views/CardRow.tsx) and in the Review pane that opens the card in a NewCardPane-style form (with FSRS fields protected). Save writes Q/A and `modified` only; never touches `fsrs_*`.

### 2. Delete a card from the UI
Trash icon on each row in Browse and a "Delete" action in Review. Confirm modal, then `app.vault.trash(file, true)` (system trash, recoverable). Removes from the store immediately.

### 3. Undo last grade
Single-step undo is enough. After every grade, stash `{ path, previousFm }` in a one-slot ring buffer. A keyboard shortcut (e.g. `u` or `cmd+z` while Review is focused) and a small "Undo" link in the footer restores the prior FSRS state. Critical for fat-finger mistakes — the most-requested Anki feature.

### 4. Show projected intervals on grade buttons
Each button currently reads just "Again / Hard / Good / Easy". Display the next interval beneath the label — e.g. `Good · 4d`, `Easy · 11d`. The FSRS engine already computes these for the `gradeWith` call; surface them at render time. Hugely improves calibration intuition.

### 5. Keyboard-first Review pane
- `Space` (or `Enter`) reveals the answer.
- `1` / `2` / `3` / `4` grade Again / Hard / Good / Easy when revealed.
- `e` opens the card source.
- `u` undoes the previous grade.
- `s` suspends (see P1).

Today only the command-palette `grade-next-*` commands work, which requires both hands and breaks the rhythm of a long review session.

### 6. Open card source from Review
A small "Open file" link in the Review footer (next to `current.fm.topic · section · due …`). One-click jump to the .md when the user spots a typo or wants context mid-review.

### 7. Card preview in Create before save
The Q and A fields are markdown — but the user can't see the rendered output until after save. Add a small "Preview" toggle on each `MarkdownField` that renders the source via `MarkdownBlock`. Catches broken `$$math$$` and `[[wiki-links]]` before they hit disk.

---

## P1 — Common SRS expectations

These are features mature SRS apps ship and that a returning Anki/Mochi/RemNote user will look for immediately.

### 8. Cloze deletions
The single biggest format gap. Allow `{{c1::hidden}}` syntax in the question field; the parser splits one card into N sibling cards (one per cloze group), all sharing the source markdown. This roughly doubles the value of the plugin for language/vocab/definitions.

Schema change: add `fsrs_cloze_index: number | null` and treat cloze siblings as separate cards keyed by `<path>#c<n>`. New picker logic. New rendering path that masks the cloze in question and reveals it in answer.

### 9. Daily new-card cap + per-day review cap
Two integers in settings: `dailyNewLimit` (default 10) and `dailyReviewCap` (default unlimited). The picker honors both. Stops the "new-card avalanche" that happens when a user adds 50 cards in a batch and is then crushed by reviews three days later.

### 10. Statistics / progress dashboard
A fourth mode in the nav: **Stats**. Show:
- Cards by state (new / learning / review / relearning) — pie or bar.
- Retention rate (% Good+Easy out of last 200 grades).
- Daily review streak.
- Forecast: cards due over the next 30 days, stacked by state.
- Per-topic retention so the user knows where they're weakest.

Read the data from existing frontmatter — no new persistence layer needed. Computed on the fly from `useCardStore`.

### 11. Heatmap calendar of reviews
GitHub-style year heatmap of reviews per day. Requires logging each grade — see #16 (review log).

### 12. Bulk operations in Browse
Multi-select rows (checkbox column or `shift-click`). Bulk actions:
- Move to topic (folder rename + frontmatter rewrite).
- Add / remove tag.
- Delete.
- Suspend / unsuspend.

Browse already supports filtering; bulk operations turn it into a real management surface.

### 13. Full-text search across cards
A search box at the top of Browse. Matches against Q, A, topic, tags. Debounced 150ms. Optionally fuzzy. Augments the existing topic+tag+state filters rather than replacing them.

### 14. Suspend / bury
- **Suspend**: card removed from queue until manually unsuspended. Use case: leech cards, seasonal material, on-hold content. Adds `fsrs_suspended: bool` to frontmatter.
- **Bury**: card removed from queue for the rest of the day (auto-unsuspend at midnight). Use case: just-failed a sibling, want to avoid immediate re-test.

Action buttons in Review and Browse. Suspended cards show in Browse with a muted style and are excluded from `pickNext`.

### 15. Flag / star
Boolean `flagged: bool` in frontmatter. UI: flag icon in Review and Browse. Filter pill in Browse ("Flagged only"). Useful for "come back to this", "review with teacher", "wrong answer feels arbitrary".

### 16. Per-card review history
Append-only log of grades. Two options:
- **Inline** in frontmatter as `fsrs_log: [{date, grade, interval}]` (gets long quickly).
- **Sidecar file** at `<root>/.learning-system/history/<path-hash>.jsonl` (cleaner; survives card moves via path hash).

Sidecar is the right answer. Surface the log in Browse as a popover on row hover, and as a section in the (future) per-card detail view.

### 17. Image support
Drag-and-drop or paste an image into Q/A. Image gets saved under `<cardsRoot>/_attachments/` and embedded as `![[…]]`. Renders in Review via the existing `MarkdownBlock`. Essential for diagrams, anatomy, anything visual.

### 18. Quick-create from selection
Command: "Create card from selection". User highlights text in any note → invokes the command → NewCardPane opens with the selection pre-filled as the question (or split heuristically on the first `?`). Topic defaults to the source file's parent folder.

This is the bridge between Obsidian-as-notes and Obsidian-as-flashcards. Without it, card creation is a context switch.

### 19. Reverse cards / sibling cards
A checkbox in Create: "Also create reverse (A → Q)". Generates a sibling card with Q and A swapped, linked via the existing `related: []` field. Good for vocab, definitions, term-and-meaning.

### 20. Tag hierarchy
Tags currently flat. Allow `parent/child/grandchild` style with `/` as separator. Browse's `TagCombobox` renders them as a tree. Filtering on `lang` matches everything under `lang/*`. Mirrors Obsidian's nested-tag convention so the cognitive model is consistent.

### 21. Nested topics
Topics are currently single-segment ("Decisions baked in" #2 in [new-card-command.md](./new-card-command.md)). Lift the restriction: `lang/spanish/verbs/` becomes a valid topic. The `TopicTable` becomes a tree; the topic combobox supports `/` as a separator and shows the hierarchy.

### 22. Saved filter presets
Browse filters are good but ephemeral — they reset on reload. Let the user save a filter combination as a named preset ("DNS due today", "Spanish learning"). Stored in `data.json`. One-click recall.

---

## P2 — Power-user polish

These are features that the regular user might never touch but that the heavy user will lean on.

### 23. Cram mode
A "Cram" button on a topic / filtered Browse set: review every card in the set N times today, ignoring FSRS scheduling, without writing back to `fsrs_*`. Use case: night before an exam.

### 24. Custom study session
A modal that builds a temporary deck from arbitrary filters ("only cards I've failed this week", "20 random new cards from topic X"). Reviews against the temporary set; FSRS still updates per-card.

### 25. Smart deck (saved dynamic query)
A named, saved set of filters that always reflects current state — e.g. "Lapsed in last 7 days". Appears in Browse alongside topics. Combines #22 and #24.

### 26. Per-topic FSRS overrides
Some topics need higher retention (anki-grade language vocab) and some lower (general reading). Override `requestRetention` and `maximumInterval` per topic, stored alongside the topic folder.

### 27. Adaptive FSRS retraining
Once enough review history is accumulated (#16), expose a "Retrain FSRS parameters" command that runs the FSRS optimizer against the user's actual grade log and updates engine weights. ts-fsrs ships this.

### 28. Typed-answer mode
For cards where exact recall matters, type the answer instead of self-grading. Compare against the answer field (case-insensitive, whitespace-normalized). Show diff on mismatch. Auto-grade Good on exact match, surface the human grading buttons on mismatch.

### 29. AI card generation from selection or note
Right-click a selection or whole note → "Generate flashcards". Calls an LLM (user-supplied API key, opt-in per [AGENTS.md](../../AGENTS.md) policy) to produce candidate Q/A pairs. User reviews, edits, accepts into a chosen topic. Massive accelerator for converting notes into cards.

### 30. AI-graded typed answers
For typed-answer mode (#28), use a semantic-similarity model (or a small LLM call) to grade "close enough" answers. Particularly valuable for free-form definitions where exact-string matching is too strict.

### 31. Hint field
Optional `hint: string` in frontmatter. Shown above the answer reveal as a one-tap reveal. Useful for cards where you want a partial cue before giving up.

### 32. Source / citation field
Optional `source: string | wikilink` in frontmatter. Renders as a "From: [[…]]" line in Review. Connects cards back to the originating note — important for the Obsidian-native use case.

### 33. Surface the `related` field
Frontmatter already has `related: []`. Add UI: pill list of related cards in Review (hover → preview, click → open). In Create, a "Link related" combobox over existing cards. The schema's already there, just exposed via UI.

### 34. Anki import
Import an `.apkg` or Anki CSV export into the vault. Map Anki notes to cards, preserving review history if available. The single biggest barrier for an Anki user to migrate.

### 35. Export
Round-trip the other direction: Anki CSV, JSON, or markdown bundle. Useful for backup, sharing decks, or moving off the plugin.

### 36. Daily reminder notification
Optional notification (via Obsidian's `Notice` API or a system notification on desktop) once a day if there are due cards and the user hasn't opened the Review pane.

### 37. Mobile-optimized swipe gestures
On iOS/Android: swipe left = Again, swipe down = Hard, swipe up = Good, swipe right = Easy. Tap = reveal. The plugin already declares `isDesktopOnly: false`; the pane just needs gesture handlers.

### 38. Obsidian Tasks integration
Auto-create a task in the user's Daily Note ("Review N cards") that completes when the queue is empty. Bidirectional: completing the task opens the Review pane.

### 39. Mark-and-elaborate workflow (already planned P2)
The settings UI mentions `claudianHoldingFile` for appending mark-and-elaborate prompts. Finish this: a button in Review ("Elaborate") that appends a structured prompt to the holding file with the current card, ready for the user to expand in a Claudian session.

### 40. "Recently failed" / "Recently created" views
Two preset views in Browse:
- **Recently failed**: cards graded Again in the last 7 days, ordered by most recent fail.
- **Recently created**: new cards added in the last N days, useful for double-checking a batch entry.

### 41. Sibling-card burying
When a sibling card (same `path`, different cloze index) is graded, auto-bury the others for the day. Without this, the same card source surfaces three times in one session.

---

## P3 — Experimental / future-looking

Speculative but high-ceiling features. Don't build until P0–P2 are solid.

### 42. Audio cards
Record audio directly in the Create pane (Web Audio API). Use case: pronunciation practice, music intervals. Plays inline in Review.

### 43. Image occlusion
Upload an image, draw rectangles to mask. Each mask becomes a card (Q: image with this rectangle hidden, A: image with the rectangle revealed). Anatomy, geography, UI inspection — huge in medical-student communities.

### 44. Inline cloze syntax in regular notes
Detect `{{c1::cloze}}` markup in any note in the vault and auto-create flashcards from it. The card's source file is the note itself, not a dedicated card file. Lets the user write notes and "promote" sentences to cards in-place.

### 45. Backlink-driven card creation
When viewing any note, show a small "Linked cards: N" pill. Click → list of cards whose `source` or `related` references this note. Closes the loop between note-taking and reviewing.

### 46. Streak / gamification
XP per review, daily streak counter, milestone badges. Carefully — gamification can become coercive. Default off; opt-in.

### 47. Cross-vault sync API
Export FSRS state per card to a portable JSON manifest; import on another machine. Lets a user maintain one set of cards across multiple vaults without git-tracking the entire learning folder.

### 48. Drag-and-drop reordering in Browse
Drag a card from one topic onto another in the `TopicTable` to move it. Updates the folder + frontmatter.

### 49. Community card sharing
Export a topic as a shareable bundle (markdown + manifest); import a bundle into a vault. Foundation for a deck marketplace if there's ever demand.

### 50. Spaced practice across vaults
For users with personal + work vaults, a "global review" mode that pulls due cards from multiple vaults. Requires a daemon or a shared sidecar location.

---

## Cross-cutting themes

Some patterns repeat across the list and are worth calling out:

- **Sidecar metadata.** Several features (review log, suspended state, flag) want per-card mutable data that doesn't belong in user-edited frontmatter. A `<cardsRoot>/.learning-system/` sidecar directory keyed by card path (or a path-hash for rename-safety) solves several P1/P2 features at once.
- **A schema migration path.** Adding `fsrs_suspended`, `flagged`, `hint`, `source` to the Zod schema in [src/schema/card.ts](../../src/schema/card.ts) every time is going to bite. Bake in a forward-compatible defaulting strategy now (already partially present via `.default(0)` for `fsrs_learning_steps`).
- **The Browse pane is the right surface for management.** Most P0/P1 management features (bulk ops, suspend, flag, delete, search, presets) belong on the existing Browse pane rather than scattered across new views.
- **The Review pane needs more density.** Today it shows Q, A, and grade buttons. The footer has room for: streak, retention rate, next interval previews, suspend/flag controls, "open file", and undo — all without crowding.
- **AI features stay opt-in per [AGENTS.md](../../AGENTS.md).** The policy is local-first; #29/#30 require explicit user opt-in, a settings-level API key, and clear disclosure.
