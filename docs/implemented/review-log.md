# Per-card review log

Roadmap item #15 from [feature-roadmap.md](./feature-roadmap.md). Append-only log of grades stored in a sidecar directory. **Foundation for** [stats-pane.md](./stats-pane.md) (#9, #10) — retention rate, streak, per-topic retention, and the heatmap all need it. Designed so other future features can reuse the same sidecar location (#13 suspend, #14 flag, #26 FSRS retraining).

## Motivation

FSRS state in frontmatter is a snapshot — current stability, current due date, current state. It doesn't say *when* the user actually graded the card, *what* they graded, or *how the state changed*. So the plugin can't show:

- "your retention is 87% over the last 200 grades"
- "you've reviewed every day for 12 days"
- "your weakest topic is X with 62% retention"
- a calendar of reviews

A grade log fills the gap. It also unblocks FSRS retraining (#26), which needs ground-truth grade history to optimize weights against.

## Scope

What this does:

- Appends one JSONL line per grade to `<cardsRoot>/.learning-system/history/<YYYY-MM>.jsonl`.
- Hooks into `gradeAndPersist` ([src/main.tsx:684-711](../../src/main.tsx#L684-L711)) so every grade — Review pane buttons, `grade-next-*` commands, future undo-redo — flows through one chokepoint.
- Read primitives: `readMonth`, `readRecent`, `readAll`, `appendGrade`.

What this does not do:

- No UI yet. Surfacing the log per-card (popover on hover, detail view) is a follow-up.
- No backfill of historical grades — users with existing review history get a fresh log starting today.
- No log truncation, rotation, or compaction. Monthly partitions are bounded enough.
- No migration to a single SQLite store. JSONL is the right answer for v1: human-readable, append-only, no library, sync-friendly.

## Sidecar location

`<cardsRoot>/.learning-system/history/<YYYY-MM>.jsonl`.

Why under `cardsRoot`:

- Travels with the cards on vault export, vault sync, vault backup. The log *is* learning data.
- Discoverable: a user who opens their Cards folder sees the history alongside.

Why dot-prefixed:

- Obsidian's file explorer hides `.`-prefixed entries by default — keeps the management surface clean.
- Standard convention for "metadata I don't want you to edit by hand."

Why monthly partitions, not one growing file or one-per-card:

- Heatmap (#10) reads 12 files per render — bounded I/O regardless of total history size.
- Retention rate (last 200 grades) typically lives in the most recent 1–2 files.
- Avoids the read-modify-write race that a single growing file invites with concurrent grades.
- One-per-card explodes file count (a year of daily review = ~365 files per card × N cards).

Why JSONL (one JSON per line) over JSON array:

- True append-only — `vault.append(file, line + "\n")` and we're done. No read-modify-write cycle.
- Trivially recoverable: a truncated last line is the only failure mode and it skips silently on parse.

## Entry shape

```json
{"path":"…/foo.md","topic":"dns","date":"2026-05-20","grade":3,"interval":4,"prevState":"learning"}
```

- `path` — vault-relative file path *at grade time*. Snapshot, not stable across renames (see [Rename / delete behavior](#rename--delete-behavior)).
- `topic` — `card.fm.topic` at grade time. Logged inline so per-topic retention doesn't need to join against current frontmatter (which loses data for renamed/deleted cards).
- `date` — local-zone `YYYY-MM-DD`. Matches how `modified` and `fsrs_due` are written elsewhere. Sufficient for daily aggregates.
- `grade` — 1/2/3/4 = Again/Hard/Good/Easy. Matches the `Rating` enum in [src/srs/fsrs-engine.ts](../../src/srs/fsrs-engine.ts).
- `interval` — `fsrs_scheduled_days` *after* the grade (i.e. days until next review). Useful for forecasting and FSRS retraining.
- `prevState` — `fsrs_state` *before* the grade. Lets us compute "graduations" (new → learning, learning → review) and identify lapses (review → relearning).

Intentional omissions:

- No `prevStability` / `prevDifficulty` — recoverable from FSRS replay if ever needed; logging every parameter bloats the file.
- No second-precision `timestamp` — Stats panels aggregate daily; the date string is enough. Avoids timezone-string serialization concerns.
- No separate `cardId` — cards have no stable ID. `path` is the only identifier; renames are accepted as a known gap.

## Rename / delete behavior

- **Rename**: do nothing. The log entry is a historical snapshot. Future grades on the renamed card log under the new path. "Lifetime stats for card X" filters by current path and accepts the rename-induced data gap.
- **Delete**: do nothing. The reviews actually happened — per-topic retention still counts them; the user's effort isn't erased by trashing the card. A future surfacing UI may opt to hide entries from deleted cards.
- **Vault folder move** (entire `cardsRoot` moves): the `history/` folder moves with it. No special handling.

## Files

**New**

- [src/cards/review-log.ts](../../src/cards/review-log.ts) — `appendGrade`, `readMonth`, `readRecent`, `readAll`. Pure functions over an `App` + the cards-root path; no plugin coupling.
- [src/cards/review-log.test.ts](../../src/cards/review-log.test.ts) — unit tests against an in-memory `App` shim.

**Modified**

- [src/main.tsx](../../src/main.tsx) — wire `appendGrade` into `gradeAndPersist` after the optimistic store update.

## API

```ts
export interface ReviewLogEntry {
    path: string;
    topic: string;
    date: string;            // YYYY-MM-DD (local)
    grade: 1 | 2 | 3 | 4;
    interval: number;
    prevState: "new" | "learning" | "review" | "relearning";
}

export async function appendGrade(
    app: App,
    cardsRoot: string,
    entry: ReviewLogEntry,
): Promise<void>;

export async function readMonth(
    app: App,
    cardsRoot: string,
    ym: string,            // YYYY-MM
): Promise<ReviewLogEntry[]>;

export async function readRecent(
    app: App,
    cardsRoot: string,
    limit: number,
): Promise<ReviewLogEntry[]>;

export async function readAll(
    app: App,
    cardsRoot: string,
): Promise<ReviewLogEntry[]>;
```

`cardsRoot` is `plugin.normalizedCardsRoot()`. Passing it explicitly keeps `review-log.ts` independent of the plugin instance — simpler tests.

`appendGrade` creates `.learning-system/history/` on first use (mirrors the create-card folder-bootstrap pattern). Single line per call: `JSON.stringify(entry) + "\n"`.

`readMonth` returns entries for one month file; missing file → `[]`. Each line parses independently; malformed lines are skipped with `console.warn` and a path/line marker. Never throws on partial corruption — a single bad line should not poison the whole panel.

`readRecent(limit)` walks back month-by-month until it has `limit` entries or runs out. Used by retention rate ("last 200 grades").

`readAll` lists every `.jsonl` in `history/` and concatenates in chronological order. Used by the heatmap (full-year view).

## Hooking into `gradeAndPersist`

[src/main.tsx:684-711](../../src/main.tsx#L684-L711) is the chokepoint. Capture `prevState` *before* the FSRS write, then append after the store update:

```ts
async gradeAndPersist(card: ParsedCard, rating: Grade): Promise<void> {
    // … existing file lookup …
    const prevState = card.fm.fsrs_state;
    const update = gradeWith(this.fsrsEngine, card.fm, rating, now);
    // … existing processFrontMatter + optimistic store update …

    try {
        await appendGrade(this.app, this.normalizedCardsRoot(), {
            path: card.path,
            topic: card.fm.topic,
            date: modified,
            grade: rating as 1 | 2 | 3 | 4,
            interval: update.fsrs_scheduled_days,
            prevState,
        });
    } catch (e) {
        console.error("[learning-system] log append failed:", e);
        // Best-effort: a failed log write must never block a grade.
    }
}
```

The `try/catch` is load-bearing: a `vault.append` failure (disk full, sync conflict) should leave the grade intact in frontmatter and surface only in the console. Losing a single log entry is acceptable; losing a grade is not.

## Tests

In [src/cards/review-log.test.ts](../../src/cards/review-log.test.ts):

- `appendGrade` round-trips through `readMonth`.
- Multiple appends within the same UTC month land in the same file; appends crossing a month boundary go to the next file.
- `readMonth` skips and warns on a corrupted line; intact lines still parse.
- `readRecent` reads only as many month files as needed to reach `limit`.
- `readAll` lists `.jsonl` files in `history/` and concatenates them in chronological order.
- Missing `history/` directory: all read functions return `[]`; `appendGrade` creates it.

Use an in-memory `App` shim with a tiny `Vault` mock (file map + `append` / `read` / `createFolder`). Same shape other unit tests in [src/cards/](../../src/cards/) use.

## Implementation phases

### Phase 1 — Log primitives + tests

Scope: [src/cards/review-log.ts](../../src/cards/review-log.ts), [src/cards/review-log.test.ts](../../src/cards/review-log.test.ts).

- Implement `appendGrade`, `readMonth`, `readRecent`, `readAll`.
- Write the unit tests listed above against an in-memory `App` mock.

Exit criteria: `vitest run` green. No user-facing change.

### Phase 2 — Wire into `gradeAndPersist`

Scope: [src/main.tsx](../../src/main.tsx).

- Capture `prevState` before the FSRS write.
- Call `appendGrade` inside a `try/catch` after the optimistic store update.

Exit criteria: grading a card writes a line to `<cardsRoot>/.learning-system/history/<YYYY-MM>.jsonl`. A simulated `vault.append` failure (temporarily rename the directory read-only) doesn't block or surface to the user — error appears only in the console.

## Decisions baked in

1. **JSONL, not JSON array.** Append-only, no read-modify-write race against concurrent grades.
2. **Monthly partitions.** Bounded I/O for heatmap, fast warm-up for recency-based stats. Trivially archivable.
3. **Path is logged but not used as the file name.** Renames don't migrate history; the gap is accepted as a v1 trade-off.
4. **Log writes are best-effort.** Never block or fail a grade. The append is wrapped in a `try/catch` at the call site.
5. **`topic` denormalized into every entry.** Per-topic retention shouldn't depend on the card still existing.
6. **No UI in this feature.** The log is plumbing. Surfaces live in #9 (Stats pane), #10 (heatmap), and a future #15-surface (per-card detail view).
