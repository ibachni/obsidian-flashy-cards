# Full-text search across cards

Roadmap item #12 from [feature-roadmap.md](./feature-roadmap.md). Browse today has three filter axes — topic (via [TopicTable](../../src/views/TopicTable.tsx)), tags (via [TagCombobox](../../src/views/TagCombobox.tsx)), and FSRS state (the `<select>` in [BrowsePane.tsx:163-173](../../src/views/BrowsePane.tsx#L163-L173)). None of them help when the user remembers *what* a card was about but not *where* they filed it. With a few hundred cards across a dozen topics, "where's the one about TCP slow-start?" already requires opening the topic tree, guessing, and scrolling. With a few thousand it becomes unworkable.

## Motivation

Two concrete user moments motivate this:

1. **"I made a card about X yesterday" recall.** The user remembers a phrase from the question or answer but not the slug, topic, or tags. Topic-and-tag filtering can't surface it without trial-and-error guessing.
2. **De-duplication before Create.** The Create pane has no "did I already make this?" affordance. Before opening NewCardPane to enter a card, the user wants a quick check against existing Q/A text. A search box on Browse is the cheapest place to put that check.

Search augments the existing filters; it never replaces them. A user filtering "topic: networking, tag: tcp" and typing "slow-start" should see only the intersection. That's what the roadmap entry calls for ("augments the existing topic+tag+state filters rather than replacing them"), and it's the obviously correct semantics — set intersection is the user's mental model of stacked filters everywhere else in the plugin.

## Scope

**In:**

- A text input above the existing `TagCombobox` + status select in Browse. Placeholder: `Search cards…`.
- Matches against four fields per card, in this precedence order: `question`, `answer`, `topic`, `tags` (any tag substring). `title` (when present) too — same precedence weight as `question`.
- Substring match, case-insensitive, Unicode-normalized (NFC). No regex, no fuzzy in v1 (see [Decisions baked in](#decisions-baked-in) #3).
- Debounced 150ms — the input is controlled (state updates per keystroke for the visible value) but the filter computation reads a debounced derived value.
- Empty query is a pass-through: behaves identically to today's Browse.
- The query participates in `filtersActive` so "Clear all filters" wipes it alongside topics, tags, and status.
- Optional: highlight matched substrings in the `CardRow` slug — only when the slug (filename / title) contains the match. Out-of-slug matches (in Q/A body) are not surfaced inline; the user clicks through to see them. See [Match highlighting](#match-highlighting).
- Result count in the existing footer (`{filtered.length} cards · {dueTodayInFiltered} due today`) already reflects the search-narrowed set — no extra UI needed.

**Out:**

- Fuzzy matching (typo tolerance). Substring is good enough for v1; fuzzy adds a dependency (or a hand-rolled scorer) and the failure mode of a fuzzy false-positive is worse than the failure mode of "type one more character to disambiguate."
- Regex / glob / boolean operators (`AND`, `OR`, `-exclude`). The Browse filter row already covers the common boolean combinations (topic AND tag AND state); cramming a query DSL into the search box duplicates that machinery for no real win.
- Search across review log history or any sidecar data — only the in-memory `ParsedCard` set. The log is for Stats; searching it is a separate problem (and a separate feature if it ever surfaces demand).
- Search inside images or occlusion JSON. Occlusion siblings are searchable via their `title` and `topic` only (their `question` and `answer` are placeholder text generated from the mask geometry — not user content). Cloze siblings search against the *raw* source (`rawQuestion` / `rawAnswer`) so `{{c1::Madrid}}` is findable by typing `madrid` even though the masked sibling shows `[…]` — see [Cloze and occlusion search content](#cloze-and-occlusion-search-content).
- Persisting the query across reloads / saved-search presets. That's roadmap #21 — search is one of the things that preset would persist, but the persistence layer ships separately.
- A keyboard shortcut to focus the search box (e.g. `/`). Easy to add later; out for v1 to avoid stealing a keystroke the Review pane might want.

## Files

**New**

- [src/cards/search.ts](../../src/cards/search.ts) — pure module. One exported function `matchesQuery(card: ParsedCard, normalizedQuery: string): boolean` and one helper `normalizeForSearch(s: string): string` (lower-case + NFC normalize + trim). Pure so it's unit-testable without any React or Obsidian. See [Match algorithm](#match-algorithm).
- [src/cards/search.test.ts](../../src/cards/search.test.ts) — Vitest unit tests for `matchesQuery` and `normalizeForSearch`. Cases enumerated in [Tests](#tests).
- [src/views/use-debounced.ts](../../src/views/use-debounced.ts) — a 12-line `useDebounced<T>(value, delayMs)` hook. Trailing-edge debounce with cleanup on unmount. Standalone module because BrowsePane is already long and this is reusable (search is the only consumer today; future filter inputs can pick it up). If a debounce hook already exists in the codebase by implementation time, skip the file and import from there.

**Modified**

- [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx)
    - Add a `query: string` state and a `debouncedQuery` derived value via `useDebounced(query, 150)`.
    - Render a search `<input>` above the `TagCombobox`. Styled to match the existing flat-input shape used by `TagCombobox`'s input ([TagCombobox.tsx:197-209](../../src/views/TagCombobox.tsx#L197-L209)) so the two rows read as a pair.
    - Extend the `filtered` `useMemo` to AND in `matchesQuery(card, normalized)` when `normalized !== ""`.
    - Include the query in the `filtersActive` boolean and the `clearAll` reset.
- [src/views/CardRow.tsx](../../src/views/CardRow.tsx) — optional, gated on [Match highlighting](#match-highlighting) shipping in this feature or a follow-up. Accepts an optional `highlight?: string` prop (the normalized query) and wraps matching substrings in the slug with `<mark className="ls-search-hit">…</mark>`. No-op when undefined.
- [styles.css](../../styles.css) — only if `<mark className="ls-search-hit">` is used. One rule that maps to `--ls-accent` background tint with `--ls-fg-strong` text, so the hit reads as a soft pill rather than the browser default canary yellow.

## Match algorithm

```ts
export function normalizeForSearch(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

export function matchesQuery(card: ParsedCard, q: string): boolean {
  if (q === "") return true;
  // Cloze siblings: search raw source so `{{c1::Madrid}}` matches "madrid".
  // The masked `question` would hide active clozes as `[…]`, which makes
  // them unfindable by their own content — the inverse of what the user
  // expects.
  const question = card.rawQuestion ?? card.question;
  const answer = card.rawAnswer ?? card.answer;
  const haystack = [
    card.fm.title ?? "",
    card.fm.topic,
    card.fm.tags.join(" "),
    question,
    answer,
  ];
  for (const h of haystack) {
    if (normalizeForSearch(h).includes(q)) return true;
  }
  return false;
}
```

The caller in BrowsePane normalizes the query once per filter pass:

```ts
const normalized = useMemo(() => normalizeForSearch(debouncedQuery.trim()), [debouncedQuery]);
```

A handful of micro-decisions encoded above:

- **Tags joined with a space, not searched per-tag.** Cheaper, and a query like `dns prod` (which the user probably means as "tags containing both") will still match a card tagged `dns` + `prod` because both substrings appear in the joined string in some order. The false-positive case ("tag containing the literal `dns prod`" matching what the user thought of as a two-word query) is implausible in practice — tags don't contain spaces. If they ever do, this gets revisited.
- **Cloze siblings search the raw source.** See [Cloze and occlusion search content](#cloze-and-occlusion-search-content).
- **`title ?? ""` instead of conditional.** Occlusion cards always have a title; non-occlusion cards may not. Joining `""` into the haystack costs nothing and keeps the loop branchless.
- **No early-exit by field precedence.** We don't rank results — `filtered` is just `cardArray.filter(...)`. Ordering is left to the existing alphabetical-by-id sort. The "precedence order" in [Scope](#scope) is documentation of where matches *can* come from, not a scoring scheme. v1 doesn't sort by relevance.

### Performance

`cardArray.filter` with a per-card haystack scan is O(N · L) where N = cards and L = total characters per card's searchable fields. At 5k cards × ~500 chars/card that's 2.5M `String.includes` ops *per keystroke* without debounce. With the 150ms debounce that drops to 2.5M ops *per pause*, well under one frame on any modern machine — `String.includes` on short strings is one of the fastest hot paths in V8. We do not need an index for v1.

If profiling ever shows this as the dominant work in a long Browse render (10k+ cards), the cheap upgrade is to pre-compute `searchableText: string` once per card (memoized off `cardsById` identity, since cards are replaced atomically by `replaceCardsForPath`) and search that single string. Not worth doing pre-emptively.

## Cloze and occlusion search content

The roadmap entry says "Matches against Q, A, topic, tags." For non-cloze/non-occlusion cards that's literal. The other two card forms need a per-form decision:

**Cloze siblings.** `card.question` is the masked view (`Madrid is the capital of […]`). `card.rawQuestion` is the source (`Madrid is the capital of {{c1::Spain}}`). The user thinks of the card by its source content, not by what's visible on one specific sibling — typing `spain` should find the card. Search against `rawQuestion ?? question` and `rawAnswer ?? answer`. The `??` fallback handles non-cloze cards (where `rawQuestion` is undefined and `question` is the only form).

A side effect worth flagging: a search for `c1` would technically match every cloze card via the `{{c1::…}}` syntax in `rawQuestion`. Not a problem in practice — `c1` isn't a query a user types — but if it ever shows up as a false-positive complaint, strip cloze markers when normalizing: `s.replace(/\{\{c\d+::([^}]+)\}\}/g, "$1")`. Skipped in v1.

**Occlusion siblings.** The body has placeholder text generated by the parser, not user content. There's nothing meaningful to search inside `question` / `answer`. The user-authored fields are `title`, `topic`, and `tags`, which the haystack already includes. The mask labels (free-text strings on each mask in the occlusion JSON) are *not* searched in v1 — they live in the sidecar, the parser doesn't currently project them into `ParsedCard`, and threading them through is more plumbing than v1 needs. If users start labelling masks meaningfully and reach for search to find them, that's a small follow-up (add `card.maskLabels?: string[]` to the projection, append to the haystack).

## Match highlighting

Inline highlighting in the `CardRow` slug is a small UX win — when the user types `dns`, the matching `dns` substring in the row label glows accent. It only works for slug matches, not Q/A matches, because we don't render Q/A in Browse rows. That's fine: the row already tells you "this matched"; the highlight just tells you *which part*.

Two implementation paths:

1. **Ship together with the search box (v1).** ~15 lines in `CardRow`: split the slug by the (case-insensitively-matched) query, wrap matched chunks in `<mark className="ls-search-hit">`. Pass the normalized query as a prop from `BrowsePane`.
2. **Ship search first, highlight as a follow-up.** Search is useful without highlighting; highlighting is meaningless without search.

Recommendation: ship together. The cost is trivial and "I can see why this row showed up" is half the perceived quality of the feature. The styles.css rule is one line:

```css
.ls-search-hit {
  background: color-mix(in srgb, var(--ls-accent) 30%, transparent);
  color: var(--ls-fg-strong);
  border-radius: 2px;
  padding: 0 1px;
}
```

`color-mix` is in every browser Obsidian runs on. Falls back gracefully if not — the `<mark>` element's default browser styling is still legible.

## Debounce semantics

150ms trailing-edge debounce per the roadmap spec. Implementation:

```ts
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

The visible input value updates synchronously on every keystroke — the input feels responsive. The filter set updates 150ms after the user stops typing. The footer count updates in the same pass.

Edge case: if the user clears the input (`""`) the debounce still applies, so for ~150ms the previous filter is still in effect. Acceptable — clearing-then-immediately-acting-on-the-clear is rare, and the alternative (skip debounce on empty) adds a branch for a barely-observable benefit. Trust the trailing edge.

## Reactivity to vault changes

Search is a pure derivation of `cardsById` × `query`. When the watcher refreshes a card via `replaceCardsForPath`, the new card flows through the same `useMemo` chain and gets re-evaluated against the current query automatically. No special handling needed — same pattern as the existing topic / tag / state filters.

One caveat: if the user has typed a query that matched a card whose path is then deleted (or whose content is edited to no longer match), the row simply disappears from the filtered list on the next render. That's the correct behavior; flagging it just to be explicit about it.

## Accessibility

- The input gets `aria-label="Search cards"` (no visible label — the placeholder carries the affordance).
- The footer's `{filtered.length} cards` count is read by screen readers on each filter change because it's a stable text node that updates. No `aria-live` needed; the change happens after user input so it's not surprising.
- Highlighted `<mark>` elements are announced as "highlighted" by some screen readers — desirable here ("highlighted dns" tells the user *which* substring matched).

## Tests

In [src/cards/search.test.ts](../../src/cards/search.test.ts):

- `normalizeForSearch` — lower-cases, NFC-normalizes (e.g. `"Café".normalize("NFD")` → `"café"`), passes through ASCII verbatim.
- `matchesQuery` happy path — matches in question, answer, topic, tags, title. One test per field.
- `matchesQuery` case insensitivity — `"DNS"` query matches `"dns"` content and vice versa.
- `matchesQuery` Unicode — `"cafe"` matches `"café"` only if both are NFC-normalized and the diacritic is preserved literally; conversely `"café"` matches `"cafe"` only if the user accepts diacritic-sensitive matching. v1 is diacritic-sensitive — document the choice in the test name. (Diacritic-insensitive matching is a one-line `s.normalize("NFD").replace(/\p{Diacritic}/gu, "")` upgrade if ever requested.)
- `matchesQuery` cloze sibling — when `rawQuestion` is set, matches against raw source not the masked view. Crafted fixture: `{ question: "[…] is the capital", rawQuestion: "Madrid is the capital", clozeIndex: 1, ... }` — `"madrid"` matches, `"[…]"` matches the masked sibling (acceptable false-positive, edge case).
- `matchesQuery` empty query — returns true for every card.
- `matchesQuery` no-match — returns false when the substring genuinely doesn't appear.

The hook (`useDebounced`) and the React wiring stay untested at the unit level — manual smoke test per phase.

## Implementation phases

Each phase ships independently and leaves the plugin in a working state.

### Phase 1 — `search.ts` + tests

Scope: [src/cards/search.ts](../../src/cards/search.ts), [src/cards/search.test.ts](../../src/cards/search.test.ts).

- Implement `normalizeForSearch` and `matchesQuery` as pure functions.
- Write the unit tests listed above.

Exit criteria: `vitest run` green. Nothing user-visible.

### Phase 2 — Debounce hook

Scope: [src/views/use-debounced.ts](../../src/views/use-debounced.ts).

- Implement `useDebounced<T>(value, delayMs)`. No tests — exercised by manual smoke in Phase 3.

Skip this phase if a debounce hook already lives in the codebase by implementation time; just import from there in Phase 3.

Exit criteria: hook compiles and is importable.

### Phase 3 — Wire into BrowsePane (no highlighting)

Scope: [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx).

- Add `query` state, `debouncedQuery` derived value, normalized memo, and the AND clause in the `filtered` memo.
- Render the `<input>` above `TagCombobox`. Styled to match the flat-input look.
- Wire into `filtersActive` and `clearAll`.

Exit criteria: typing in the search box narrows the visible card list after 150ms; the footer count updates; clearing the box restores the prior filter set; "Clear all filters" wipes the query.

### Phase 4 — Match highlighting in `CardRow`

Scope: [src/views/CardRow.tsx](../../src/views/CardRow.tsx), [styles.css](../../styles.css), [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx) (one prop wiring).

- Add `highlight?: string` prop to `CardRow`. When set and non-empty, split the slug by case-insensitive match and wrap matching chunks in `<mark className="ls-search-hit">`.
- Add the `.ls-search-hit` rule to `styles.css`.
- Pass the normalized query from `BrowsePane` (only when non-empty, to keep the no-search case branchless).

Exit criteria: a search query that matches a card's slug visibly highlights the matching substring; Q/A-only matches still appear in the list but without inline highlight (acceptable — the row's presence is the signal).

## Decisions baked in

1. **Search is a Browse-pane concern, not its own surface.** The roadmap entry calls for a search box on Browse; no separate "Search" mode in `UnifiedPane`. Browse is already the management surface — search joins the existing filter row rather than competing with it.
2. **Search composes with the existing filters via set intersection.** Same mental model as every other filter in the plugin. The roadmap entry explicitly calls this out and it's the unambiguously correct semantics.
3. **Substring only, no fuzzy / regex / boolean DSL in v1.** Substring is fast, predictable, and unambiguous. Fuzzy's false positives are worse than its false negatives at this scale; a query DSL duplicates the filter row.
4. **Cloze siblings search the raw source, not the masked view.** Users think of the card by its content, not by which cloze sibling they're looking at. The masked `[…]` form would make cards unfindable by their own active-cloze text — the inverse of what the user expects.
5. **Occlusion siblings search title + topic + tags only.** The body is placeholder text generated from mask geometry; there's no user content to search. Mask labels are not searched in v1 (the parser doesn't project them; small follow-up if demand surfaces).
6. **150ms trailing-edge debounce, no leading-edge variant.** The roadmap entry specifies 150ms; trailing-edge matches the user's mental model ("when I stop typing, the list updates"). Leading-edge would flash the wrong filter set on the first keystroke.
7. **No relevance ranking. Filter, don't score.** The existing alphabetical sort stays. Scoring is a separable concern and the right place for it (if ever) is a dedicated "smart deck" / saved-search surface (roadmap #24), not the Browse filter row.
8. **Diacritic-sensitive matching in v1.** Cheaper, deterministic. One-line upgrade to diacritic-insensitive if a real user hits it.
9. **The search input is `aria-label`led, not visibly labelled.** Same convention as the `TagCombobox` input; visible labels above every input would bloat the filter row.
