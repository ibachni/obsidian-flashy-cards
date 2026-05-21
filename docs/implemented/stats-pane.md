# Stats pane + heatmap

Roadmap items #9 (Statistics / progress dashboard) and #10 (heatmap calendar) from [feature-roadmap.md](./feature-roadmap.md). Bundled because the heatmap is naturally a panel of the Stats pane — same audience, same data source, same lifecycle.

**Depends on** [review-log.md](./review-log.md) (#15). The log primitives must land first — three of five Stats panels and the heatmap all read from it.

## Motivation

The plugin tells the user *what's due* but not *how they're doing*. SRS reward loops depend on visible progress: streak counters keep daily habits alive; retention rate signals whether the deck is too hard or too easy; heatmaps make the time investment legible. Without these, the plugin reads as a queue manager rather than a learning tool.

## Scope

What's in (v1):

- A fourth pane mode: **Stats**, accessible from `ModeNav` and a new `learning-system:open-stats` command.
- Five panels:
    1. State breakdown (counts by `fsrs_state`).
    2. Forecast (cards due over the next 30 days, stacked by state).
    3. Retention rate (% Good+Easy over the last 200 grades).
    4. Streak (consecutive days with ≥1 grade).
    5. Per-topic retention (last 30 days, sorted weakest-first).
- A sixth panel: GitHub-style 12-month heatmap of daily grade counts.

What's out:

- No filters or date pickers. Each panel has a fixed window per the roadmap spec.
- No drill-down on click (per-day detail view, per-topic detail view).
- No FSRS retraining trigger (#26 — separate feature; uses the same log).
- No CSV / image export (#34 — separate).
- No persistence beyond the existing log; nothing is computed offline or cached on disk.

## Files

**New**

- [src/views/StatsPane.tsx](../../src/views/StatsPane.tsx) — top-level pane router.
- [src/views/stats/StateBreakdown.tsx](../../src/views/stats/StateBreakdown.tsx)
- [src/views/stats/Forecast.tsx](../../src/views/stats/Forecast.tsx)
- [src/views/stats/RetentionRate.tsx](../../src/views/stats/RetentionRate.tsx)
- [src/views/stats/Streak.tsx](../../src/views/stats/Streak.tsx)
- [src/views/stats/PerTopicRetention.tsx](../../src/views/stats/PerTopicRetention.tsx)
- [src/views/stats/Heatmap.tsx](../../src/views/stats/Heatmap.tsx)
- [src/views/stats/aggregations.ts](../../src/views/stats/aggregations.ts) — pure functions over `ReviewLogEntry[]` / `ParsedCard[]` returning panel-shaped data.
- [src/views/stats/aggregations.test.ts](../../src/views/stats/aggregations.test.ts)

**Modified**

- [src/views/ModeNav.tsx](../../src/views/ModeNav.tsx) — add "Stats" tab.
- [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx) — route `stats` mode to `StatsPane`.
- [src/main.tsx](../../src/main.tsx) — extend the `Mode` union (currently `"review" | "browse" | "create"` in [ModeNav.tsx](../../src/views/ModeNav.tsx)) with `"stats"`; update `parseModeFromState` ([main.tsx:58-63](../../src/main.tsx#L58-L63)); add `learning-system:open-stats` command for parity with `open-review` / `open-browse` / `new-card`.

## Data flow

Two sources, two cadences.

**Frontmatter-derived** (state breakdown, forecast) — already in `useCardStore`. Re-derived on every render; cheap (≤2k cards × 30 forecast days = 60k iterations).

**Log-derived** (retention rate, streak, per-topic, heatmap) — read from sidecar JSONL on pane activation, cached in a React state slot at the pane level. Refreshed on a `metadataCache.changed` event for files inside `cardsRoot` (proxy for "user just graded something") and on pane re-focus.

Why not subscribe directly to grade events: there isn't one. `gradeAndPersist` is the chokepoint but doesn't emit; adding a custom event source for a single consumer is overkill. The `metadataCache.changed` proxy is good-enough — grades trigger it via the `modified` write.

Cache shape: `{ entries: ReviewLogEntry[], loadedAt: number } | null`. `null` while the first read is in flight. Stale-while-revalidate: panels render last-good data while a fresh read is pending.

## Panel designs

### 1. State breakdown

Horizontal bar split into segments — new / learning / review / relearning. Width proportional to count; color matches the [state-tag.ts](../../src/views/state-tag.ts) tokens. Numeric labels under each segment. Total in the panel header.

Source: `useCardStore.cardsByPath` → group by `fsrs_state`. Pure derivation; no log needed.

### 2. Forecast

30 vertical bars, one per day. Each bar stacked by state (same color tokens as panel 1). x-axis labels: dates (every 5 days to avoid crowding). y-axis: implicit, no axis line.

Source: filter cards where `fsrs_due ∈ [today, today+29]`, group by date + state. SVG bars; no chart library.

Overdue cards are *not* shown in the forecast — they're already due, the state breakdown covers them.

### 3. Retention rate

Big-number panel. `% (Good + Easy) / total` over the last 200 graded entries. Sub-line: `n of 200 grades · since YYYY-MM-DD`.

Source: `readRecent(200)`. Aggregation: `count(grade ≥ 3) / count(all)`.

Edge case: <200 entries available. Show the actual count and a small note: "Counts grow as you grade more cards."

### 4. Streak

Big-number panel: e.g. "12 day streak". Sub-line: "Last reviewed YYYY-MM-DD".

Algorithm: walk back day-by-day from today; count consecutive days with ≥1 entry. Stop on the first empty day. Today counts as alive even with zero grades (don't break the streak before tomorrow).

Source: `readRecent(n)` where n is large enough to cover the streak. Practical cap: 3 months — anyone with a 90+ day streak still gets credit; longer streaks display as "90+".

### 5. Per-topic retention

Vertical list, weakest first (lowest retention). Each row: topic name · `n grades · 72%`. 30-day window.

Source: filter `readAll` entries to last-30-days, group by `topic`, compute retention. Topics with <5 grades over the window are hidden (noise floor; a 1-of-1 lapse reads as 0% and panics the user without signal).

### 6. Heatmap

53 weeks × 7 days (rows = day-of-week, columns = week, oldest left). Cells colored by grade-count bucket: 0 (bg-subtle), 1–2, 3–5, 6–9, 10+ (5 buckets). Tooltip per cell: `2026-05-20 · 7 reviews`.

Source: `readAll` (or a 12-month read window). Aggregation: `Map<YYYY-MM-DD, count>` covering today − 364 ... today.

Layout: the Obsidian right-pane is typically narrow (~300px). Full 53 weeks at 10px cells needs ~600px. Adaptive sizing:

- Measure container width with a `ResizeObserver`.
- Compute cell size to fit: `(width − labels) / 53`, clamped to `[6, 12]px`.
- If even at 6px the grid overflows, fall back to a most-recent-26-weeks view with a "Show full year" toggle.

Color buckets read CSS variables (`--ls-accent` with opacity steps) so cream / dark theming works without a per-panel branch.

## Performance

- State breakdown / forecast: O(n cards). Recomputed every render; <2k cards × 30 days is fast enough that memoization isn't worth the complexity.
- Retention / streak / per-topic: bounded by the log read window.
- Heatmap: O(n entries) once, mapped into a `Date → count` Map. Re-renders are cheap because the data shape is stable.

The log read is async. Each log-derived panel renders a small skeleton while loading. We avoid a top-level pane-wide spinner — the frontmatter panels can render immediately.

## Mode + nav wiring

`Mode` becomes `"review" | "browse" | "create" | "stats"`. Touchpoints:

- `parseModeFromState` ([main.tsx:58-63](../../src/main.tsx#L58-L63)) — add `"stats"` to the literal check.
- `ModeNav` — add a fourth tab; icon matches the existing tab visual register.
- `UnifiedPane` — route `stats` mode to `StatsPane`, mirror the sticky-mount pattern (`mountedModes`) the other modes use.
- New command:
    ```ts
    this.addCommand({
        id: "open-stats",
        name: "Open stats",
        callback: () => void this.activateView({ mode: "stats" }),
    });
    ```

## Tests

In [src/views/stats/aggregations.test.ts](../../src/views/stats/aggregations.test.ts):

- `groupCardsByState(cards)` — counts add up to `cards.length`.
- `forecast(cards, today, days)` — bucket counts add up to total due-in-window; days outside the window excluded; cards with overdue dates excluded from the forecast.
- `retentionRate(entries, limit)` — Good+Easy over total; respects the `limit` cap; sub-limit input returns the actual ratio.
- `streak(entries, today)` — consecutive-day walk; handles same-day duplicates; handles "today has no grades yet" (streak continues until tomorrow).
- `perTopicRetention(entries, days, minGrades)` — filters by window, groups by topic, hides under-minimum topics.
- `heatmapBuckets(entries, today)` — date→count map covers the full year, including zero-count days; out-of-window entries excluded.

Panel components stay untested at the unit level — manual smoke test per phase.

## Implementation phases

Each phase ships independently and leaves the plugin in a working state.

### Phase 1 — Stats mode scaffolding

Scope: [src/views/ModeNav.tsx](../../src/views/ModeNav.tsx), [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx), [src/main.tsx](../../src/main.tsx), [src/views/StatsPane.tsx](../../src/views/StatsPane.tsx).

- Extend `Mode` with `"stats"`; update `parseModeFromState`.
- Add Stats tab in `ModeNav`.
- Empty `StatsPane` shell with section headings (one per planned panel) and "loading" placeholders.
- Register `learning-system:open-stats`.

Exit criteria: tab appears, switching renders the empty pane, command activates the mode.

### Phase 2 — Frontmatter panels

Scope: [src/views/stats/StateBreakdown.tsx](../../src/views/stats/StateBreakdown.tsx), [src/views/stats/Forecast.tsx](../../src/views/stats/Forecast.tsx), [src/views/stats/aggregations.ts](../../src/views/stats/aggregations.ts).

- Implement `groupCardsByState` and `forecast` aggregations + their unit tests.
- Render the two panels against `useCardStore`.

Exit criteria: stats pane shows the breakdown bar and 30-day forecast against the live store; values update when cards are added/graded/deleted.

### Phase 3 — Log-derived numeric panels

Scope: [src/views/stats/RetentionRate.tsx](../../src/views/stats/RetentionRate.tsx), [src/views/stats/Streak.tsx](../../src/views/stats/Streak.tsx), [src/views/stats/PerTopicRetention.tsx](../../src/views/stats/PerTopicRetention.tsx), aggregation helpers + tests.

- Wire log reads into pane-level state. Single read on activation; `metadataCache.changed` refresh.
- Implement `retentionRate`, `streak`, `perTopicRetention`.
- Render the three panels with loading skeletons.

Exit criteria: grading a card refreshes retention/streak/per-topic on next pane focus or after the `metadataCache` event lands; under-floor topics are hidden from per-topic retention.

### Phase 4 — Heatmap

Scope: [src/views/stats/Heatmap.tsx](../../src/views/stats/Heatmap.tsx), `heatmapBuckets` aggregation + tests.

- SVG grid with adaptive cell sizing via `ResizeObserver`.
- Tooltip per cell.
- Color buckets via CSS variables for theme parity.
- Narrow-width fallback to a 26-week view with a toggle.

Exit criteria: 12 months of cells render in both cream and dark themes; tooltip on hover shows the date + count; resizing the pane below ~360px switches to the 26-week view.

## Decisions baked in

1. **Stats is its own mode, not a settings sub-panel.** It's a daily-use surface, not configuration.
2. **The heatmap is a Stats panel, not its own mode.** Same audience, same data source, same lifecycle.
3. **Fixed windows, no filters.** Configurability is scope creep; the spec windows (last-200 grades, next-30-days, 365-day heatmap, last-30-day per-topic) are deliberate defaults.
4. **No chart library.** SVG + CSS reaches every panel; saves ~40–100kB and a config-time decision tree about which lib.
5. **Stats is read-only.** Browse is where management actions live; mixing them dilutes both.
6. **Per-topic retention has a min-grade floor (5).** Below that, the percentage is too noisy to be useful and reads as alarm.
7. **Log read is panel-local state, not Zustand.** Stats is the only consumer; pushing it through the shared store invites stale-cache bugs in Browse / Review.
