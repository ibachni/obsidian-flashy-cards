# Unified pane with mode nav

Collapse the three separate views (Review, Browse, New card) into a single Obsidian view with a centered Review · Browse · Create nav bar. One ribbon icon (brain), one view type, one leaf in the workspace.

## Motivation

The three-icon, three-leaf model has three downsides:

1. **Ribbon clutter** — three icons for what users perceive as one tool.
2. **Workspace drift** — users can end up with up to three side-pane tabs and have to remember which is which.
3. **Inconsistent headers** — each pane renders its own left-aligned `<h2>`, and the inter-pane switcher only covers Review ↔ Browse. New card has no nav at all. Vertical content start positions also drift between panes because each pane decides its own header height.

A single view with a centered mode nav fixes all three: one entry point, one leaf, identical layout below the header in every mode.

## Target UI

```
┌──────────────────────────────────────────────┐
│            Review   Browse   Create          │  ← centered nav, underlined = active, bold on hover
├──────────────────────────────────────────────┤
│                                              │
│   <mode content — no per-mode title>         │
│                                              │
```

- Header is rendered once by the shell. Mode components render only their body.
- Active mode: underlined, full ink, medium weight, `cursor: default`.
- Inactive mode: muted text, **bold on hover** (per request — note: contrasts with existing `hover:text-fg` lift; see [Decisions baked in](#decisions-baked-in) #1).
- No left-aligned `<h2>` in any mode body.
- The content area starts at the same `padding-top` in all three modes — the shell owns vertical rhythm.

## Files

**New**

- [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx) — shell component. Owns the active mode (`"review" | "browse" | "create"`), renders the centered nav bar in a single `<header>`, and renders the active mode's body component inside a content wrapper with consistent padding. Default mode: `"browse"`.
- [src/views/ModeNav.tsx](../../src/views/ModeNav.tsx) — the three-option nav. Replaces [src/views/ViewSwitcher.tsx](../../src/views/ViewSwitcher.tsx).

**Modified**

- [src/main.tsx](../../src/main.tsx) — keep only `VIEW_TYPE_LEARNING` + `LearningSystemView`. Remove `VIEW_TYPE_BROWSE`, `VIEW_TYPE_NEW_CARD`, `LearningSystemBrowseView`, `LearningSystemNewCardView`, `activateBrowseView()`, `activateNewCardView()`, the library/plus-circle ribbon icons, and the corresponding entries in `applyTheme`'s `types` array and the `d`-keybinding's `activeIsOurs` check. Replace `activateView()` to optionally accept a starting mode. Add a one-shot detach pass for stale `learning-system-browse-view` / `learning-system-new-card-view` leaves at `onLayoutReady` so existing workspaces don't keep showing dead tabs.
- [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx) — drop the `<header>` (title + ViewSwitcher) and the outer wrapper's `px-6 pt-3 pb-6`. Component becomes pure body; the shell owns padding and chrome.
- [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx) — same: drop `<header>` and outer wrapper padding. The "Test this section" button keeps its current footer placement; instead of calling `plugin.activateView()` after `setReviewScope`, it switches the unified pane's mode to `"review"` (see [Mode switching API](#mode-switching-api)).
- [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx) — drop the `<header>` (currently just `<h2>New card</h2>`) and outer wrapper padding.
- [src/views/ViewSwitcher.tsx](../../src/views/ViewSwitcher.tsx) — **delete**. No remaining call sites after the pane changes above.

## View-state model

The unified view persists the active mode in the leaf's `setViewState({ state })` payload so workspace restore returns the user to their last-used mode. On first open (no persisted state), default to `"browse"` per the request.

```ts
// in LearningSystemView
async setState(state: unknown, result: ViewStateResult) {
  if (isModeState(state)) this.mode = state.mode;
  await super.setState(state, result);
  this.rerender();
}
getState(): ViewState { return { mode: this.mode }; }
```

The React shell reads the initial mode from a `mode` prop the view passes in, and the view re-renders the React tree whenever the mode changes (either via `setState` from workspace restore, or via the nav bar / `BrowsePane`'s "Test this section" path calling `view.setMode("review")`).

`useState` inside `UnifiedPane.tsx` is a viable simpler alternative, but it loses the user's last mode on every workspace reload — bad UX once users start using the pane heavily.

## Mode switching API

`LearningSystemView` exposes `setMode(mode)` as a bound class field. The React shell calls it from:

- The nav bar's three buttons (Review / Browse / Create) — wired through `UnifiedPane`'s `onSetMode` prop.
- The Browse pane's "Test this section" button — after `setReviewScope(...)`, invokes an `onSwitchToReview` callback prop instead of activating a separate Review leaf.

We pass `setMode` down as prop callbacks rather than reaching into `usePluginContext().view`. [PluginContext.tsx](../../src/views/PluginContext.tsx) types `view` as the base Obsidian `Component`, so panes consuming the context don't have to assume the view exposes any plugin-specific surface. Prop callbacks keep the type contract honest; `BrowsePane.onSwitchToReview` is a required prop (the only mount point is `UnifiedPane`, which always supplies it).

## Commands & ribbon

**Ribbon**

- Single "brain" icon → `activateView()` (opens or reveals the unified leaf; uses the persisted mode, or `"browse"` on first open).
- Remove the `library` and `plus-circle` ribbon icons.

**Commands**

- `open-learning-system` (new id, name: "Open Learning System") → `activateView()`. Replaces the implicit "open Review" via the brain ribbon.
- `open-browse` (existing id, keep for keyboard-shortcut continuity) → `activateView({ mode: "browse" })`.
- `new-card` (existing id, keep) → `activateView({ mode: "create" })`.
- Add `open-review` → `activateView({ mode: "review" })` for symmetry.
- Grade-next commands (`grade-next-*`) and `toggle-theme` are unchanged.

**Stable IDs**: `open-browse` and `new-card` keep their existing ids per [AGENTS.md](../../AGENTS.md) ("Use stable command IDs; avoid renaming once released"). Their behavior changes (mode switch within the unified leaf instead of opening a separate leaf), but the IDs and user-facing names stay.

## Migration: stale leaves

Existing users may have `learning-system-browse-view` or `learning-system-new-card-view` leaves persisted in their workspace layout. After the view types are unregistered, Obsidian will render them as "No view of type X" placeholders.

Mitigation (in `onload`, inside the `onLayoutReady` callback):

```ts
for (const stale of ["learning-system-browse-view", "learning-system-new-card-view"]) {
  for (const leaf of this.app.workspace.getLeavesOfType(stale)) {
    leaf.detach();
  }
}
```

One-shot, cheap, idempotent. Leaves of the surviving `learning-system-view` type are untouched.

## Theming & layout details

- `applyTheme`'s `types` array shrinks to `[VIEW_TYPE_LEARNING]`. The `d`-keybinding's `activeIsOurs` check correspondingly drops the two extra `getActiveViewOfType` calls.
- The shell wrapper carries the same `flex flex-col gap-4 px-6 pt-3 pb-6` outer styles the three panes currently use individually. Pane bodies become children of that wrapper and contribute only their own sections.
- Nav bar styling: a flex row with `justify-center` in the header. Each button is `ls-flat` (kills Obsidian's button chrome) + text-only. Active = `underline underline-offset-4 text-fg font-medium cursor-default`; inactive = `text-muted hover:font-bold hover:text-fg transition-all`. The `hover:font-bold` swap is what the request asks for; see [Decisions baked in](#decisions-baked-in) #1 for the layout-shift caveat.

## Implementation phases

Each phase leaves the plugin compiling and the existing user-facing flows working. Phases are listed in dependency order.

### Phase 1 — Extract `ModeNav` and shell scaffold

Scope: [src/views/ModeNav.tsx](../../src/views/ModeNav.tsx) (new), [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx) (new).

- Add `ModeNav` with three buttons. Props: `active`, `onChange(mode)`. Styling per [Theming & layout details](#theming--layout-details).
- Add `UnifiedPane` shell with `useState` for the active mode (Phase 4 promotes it to view state). Renders header + a `<main>` wrapper. Body slot is a `switch (mode)` over `<ReviewPane />`, `<BrowsePane />`, `<NewCardPane />` (the existing components, still with their own headers — phase 2 strips them).
- Not wired into `main.tsx` yet; nothing user-visible.

Exit: components compile; can be hand-rendered in a Vitest smoke test or temporarily wired behind a dev command to eyeball the nav bar.

### Phase 2 — Strip per-pane headers and outer padding

Scope: [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx), [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx), [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx).

- Remove the `<header>` block from each pane (title + any switcher).
- Remove the outer `px-6 pt-3 pb-6` from each pane's root `<div>` — the shell owns padding now.
- The three panes still render correctly when mounted directly by their existing view classes (no header, but full body) — verify in Obsidian against each existing ribbon icon before moving on. The visual regression is intentional and temporary.

Exit: the three existing views still open and function; each renders flush-against-top without padding. Confirms the panes are decoupled from their previous chrome.

### Phase 3 — Wire `UnifiedPane` into `LearningSystemView`

Scope: [src/main.tsx](../../src/main.tsx) (just the `LearningSystemView` class and its activation).

- `LearningSystemView.onOpen` mounts `<UnifiedPane initialMode="browse" />` instead of `<ReviewPane />`.
- Update the brain ribbon's tooltip from "Learning System" if needed; behavior is unchanged.
- Other view classes and ribbon icons stay registered for now — gives a side-by-side comparison and a fallback during testing.
- `BrowsePane`'s "Test this section" still calls `plugin.activateView()` here; we rewire it in Phase 4.

Exit: clicking the brain ribbon opens a pane with the nav bar and Browse as the default mode; the nav buttons switch the content; the other two ribbons still open standalone (now header-less) panes.

### Phase 4 — Promote mode to view state + rewire `BrowsePane`

Scope: [src/main.tsx](../../src/main.tsx) (`LearningSystemView`), [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx), [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx).

- Move active-mode storage from `UnifiedPane`'s `useState` to the view via `setState` / `getState` (see [View-state model](#view-state-model)). Add `setMode(mode)` to the view as a bound class field for stable identity.
- `UnifiedPane` accepts `mode`, `mountedModes`, and `onSetMode` props from the view; nav buttons call `onSetMode`. Sticky-mount tracking (`mountedModes`) lives on the view alongside `mode` so workspace restore hydrates both before React's first render.
- `BrowsePane`'s "Test this section": after `setReviewScope(...)`, invokes an `onSwitchToReview` callback prop supplied by `UnifiedPane` (which routes it to `setMode("review")`). During Phase 4 the prop was optional with a `plugin.activateView()` fallback for the still-extant `LearningSystemBrowseView`; Phase 5 removes that legacy class and the prop becomes required.
- Workspace reload now restores the last-used mode.

Exit: nav state survives reload; scoped review flow works without leaf-switching.

### Phase 5 — Retire the two extra view types and ribbons

Scope: [src/main.tsx](../../src/main.tsx), [src/views/ViewSwitcher.tsx](../../src/views/ViewSwitcher.tsx), [src/views/BrowsePane.tsx](../../src/views/BrowsePane.tsx), [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx).

- Delete `LearningSystemBrowseView`, `LearningSystemNewCardView`, `VIEW_TYPE_BROWSE`, `VIEW_TYPE_NEW_CARD`, `activateBrowseView`, `activateNewCardView`.
- Remove the `library` and `plus-circle` ribbon icons.
- Shrink `applyTheme`'s `types` array to `[VIEW_TYPE_LEARNING]`; drop the two extra `getActiveViewOfType` calls in the `d`-key handler.
- Update `activateView()` to accept `options?: { mode?: Mode }`; new leaves seed `setViewState` with `{ state: { mode } }` to land in the requested mode on first render, and existing leaves call `view.setMode(mode)` after `revealLeaf`.
- Update `open-browse` / `new-card` commands to call `this.activateView({ mode: "browse" | "create" })`. Add `open-review` and `open-learning-system` commands.
- Add the stale-leaf detach pass in `onLayoutReady` (see [Migration: stale leaves](#migration-stale-leaves)).
- **Pulled forward from Phase 6**: delete [src/views/ViewSwitcher.tsx](../../src/views/ViewSwitcher.tsx). It imports `plugin.activateBrowseView` which gets removed in this phase, so it can't outlive Phase 5 without a build break.
- Tighten now-required prop contracts: `BrowsePane.onSwitchToReview` and `NewCardPane.active` lose their optional fallbacks since `UnifiedPane` is the only remaining mount point and always supplies them. Drop the unused `plugin` destructure in `BrowsePane`.

Exit: one ribbon icon, one view type, four commands (one entry + three mode-targeted) routing through the unified view. Workspace re-open of pre-migration layouts no longer shows dead tabs. `ViewSwitcher.tsx` is gone.

### Phase 6 — Folded into Phase 5

Originally a standalone "delete `ViewSwitcher.tsx`" phase, but the file had to leave alongside `activateBrowseView` / `activateNewCardView` to keep the tree compiling. Folded into Phase 5; no standalone work remained.

## Tests

- Existing unit suites (parser, picker, FSRS, schema, dates) stay green — no business-logic changes.
- No new unit tests for `UnifiedPane` / `ModeNav`: behavior is small enough to verify manually, matching the precedent set in [docs/features/new-card-command.md](./new-card-command.md) ("The modal itself stays untested — UI behavior is best verified manually").
- Manual checks per phase: noted in each phase's Exit line.

## Decisions baked in

1. **Bold-on-hover causes a 1–2px layout shift.** Font-weight changes alter glyph metrics, so the three buttons will reflow horizontally when one is hovered. Two cheap fixes if it bothers in practice: (a) reserve space with `min-width` per button based on the bold metric, or (b) use `text-shadow: 0 0 0.65px currentColor` as a faux-bold that doesn't reflow. We'll ship plain `font-bold` first and only mitigate if the jitter is visible.
2. **Default mode is `"browse"` on first open, last-used mode on subsequent opens.** The request specifies Browse for initial open; persisting last-used is the natural extension and matches Obsidian's convention for view state (e.g. Outline, Backlinks panes remember their state).
3. **Single leaf, not three.** Users can no longer have Review and Browse open side-by-side. That capability was technically available before but had no shortcut to set it up (each ribbon opened in the same right sidebar slot, evicting the previous). If a real demand for side-by-side appears, the unified view supports `workspace.duplicateLeaf` out of the box.
4. **No animation on mode switch.** Crossfading or sliding between three panes adds complexity without a clear user benefit; instant swap matches Obsidian's native tab feel.
5. **`PluginContext.view` already exists**, so panes can reach `setMode` without new plumbing. We don't introduce a separate `ModeContext`.
6. **Stale-leaf cleanup is silent.** No `Notice` — the detach happens during layout-ready, before the user has a chance to interact, and surfacing it would be more confusing than helpful.
