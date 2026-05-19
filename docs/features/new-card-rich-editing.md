# New card rich editing

Follow-up to [new-card-command.md](./new-card-command.md). The Question / Answer textareas in the new-card pane currently render as plain text fields — no markdown or LaTeX. Users editing cards inside Obsidian see live-preview / reading-mode rendering, but the create-time experience is bare text, so a card with `$E = mc^2$` and a bullet list looks like raw source until after it's saved and reopened.

## Motivation

Cards routinely use:

- Markdown: bold/italic, bullets, code spans/blocks, links, wiki-links to related notes.
- LaTeX: inline `$…$` and display `$$…$$` blocks for math-heavy decks.

Today users have no feedback on formatting until they reload the card in Obsidian's editor post-save. For batch entry that's a slow loop — typos in math or unbalanced backticks aren't caught until much later.

## Approaches considered

| | What it gives | Cost | Risk |
|---|---|---|---|
| A. Plain textarea + Preview tab | Rendered MD + LaTeX in a read-only pane, toggled per field | Low — `MarkdownRenderer.render` already does it | Low; one public Obsidian API call |
| B. Embedded live-preview editor (CM6) | True WYSIWYG, matches Obsidian's Live Preview mode | High — embed `MarkdownView` or build a CodeMirror editor with the right extensions manually | Uses undocumented internals; brittle across Obsidian updates |
| C. Custom CodeMirror 6 + `@codemirror/lang-markdown` | Source-mode syntax highlighting; no rendered math | Medium | Doesn't render LaTeX — weaker preview than A |
| D. Side-by-side editor + preview | Both modes always visible | Medium | Eats horizontal space; right sidebar is narrow |

**Recommendation:** **A** as a phased first step (cheap, big UX win), with **B** as a deferred follow-up once the use case has been validated and the API risk is worth it.

## Phase A — Preview tab per field

### Scope

[src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx) — wrap each multi-line textarea (Question, Answer) in a small `EditPreviewField` that toggles between two modes:

- **Edit**: the current textarea (source).
- **Preview**: a div containing the output of `MarkdownRenderer.render(app, content, el, sourcePath, view)`.

A small two-segment toggle (`Edit` / `Preview`) sits at the top-right of each field. Default mode is Edit; Preview is opt-in per field.

### Files

**New**

- [src/views/EditPreviewField.tsx](../../src/views/EditPreviewField.tsx) — extract `EditPreviewField` to its own file; it owns a non-trivial chunk of state (mode, ref to the preview container, an effect that re-renders on mode-change), large enough that inlining would clutter `NewCardPane.tsx`. Single-purpose component.

**Modified**

- [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx) — replace the bare `<textarea>` for Question and Answer with `<EditPreviewField>` instances. Pass the current value, an `onChange`, the `autoFocus` flag for Question, and a `sourcePath` derived from `<cardsRoot>/<topic>/` (or an empty string when topic is blank).
- [src/views/PluginContext.tsx](../../src/views/PluginContext.tsx) — no change needed. It already exposes the Obsidian `view` as a `Component`, which is what we pass to `MarkdownRenderer.render` for child-lifecycle cleanup.

### Component shape

```tsx
interface Props {
    value: string;
    onChange: (next: string) => void;
    sourcePath: string;          // for wiki-link / embed resolution
    autoFocus?: boolean;
    className?: string;          // forwarded to the textarea
    minHeightClass?: string;     // default "min-h-24" so toggling doesn't reflow
}
```

Internal state:

- `mode: "edit" | "preview"` (default `"edit"`)
- `previewRef: React.RefObject<HTMLDivElement>`

On `mode === "preview"`, a `useEffect` keyed on `[value, sourcePath, mode]`:

1. `previewRef.current.empty()` (using Obsidian's HTMLElement augmentation).
2. `await MarkdownRenderer.render(app, value, previewRef.current, sourcePath, view)`.

The effect aborts cleanly if the component unmounts mid-render by checking a `cancelled` flag in cleanup — `MarkdownRenderer.render` is async, and the component might unmount or the value might change before it completes.

### Implementation notes

- **API call.** `MarkdownRenderer.render(app, markdown, containerEl, sourcePath, component)` — use the modern signature, not the deprecated `renderMarkdown`. `app` and `view` (as `component`) come from `usePluginContext()`.
- **`sourcePath`.** Best-guess base path of the card-to-be: `<cardsRoot>/<topic>/<placeholder>.md`. Used by Obsidian to resolve relative `[[wiki-links]]` and embed paths. Wiki-link resolution isn't critical for preview — the rendered link is the literal `[[…]]` if unresolved, which is fine. When topic is blank, pass `""`.
- **LaTeX.** Obsidian's MathJax pipeline is wired into `MarkdownRenderer.render`. `$inline$` and `$$display$$` should render out of the box, no extra setup.
- **Tab UI.** Lightweight segmented control modelled on [ViewSwitcher.tsx](../../src/views/ViewSwitcher.tsx)'s `full` variant — two `<button>`s side by side, the active one styled with `text-fg! font-medium!` and the inactive with `text-muted! hover:text-fg!`. Aligned to the right above the textarea/preview so the field label stays on the left.
- **Empty preview.** When `value.trim().length === 0`, render `<span className="text-muted! text-sm">Nothing to preview.</span>` instead of running `render`.
- **Height parity.** Apply the same `min-h-24 resize-y` to the preview div as the textarea. Toggling between modes shouldn't reflow the form. Preview takes the same vertical space the textarea occupied.
- **Theming.** Wrap the preview div in `markdown-rendered` (an Obsidian class that styles rendered content with proper line-height, list spacing, math sizing). Inside `learning-system-root` the cream-themed `--ls-*` variables are available, but `markdown-rendered` handles most of its own typography.

### Decisions baked in

1. **Render on mode-flip, not while typing.** No debounced live preview. Re-rendering on every keystroke would be wasteful (and `render` is async — concurrent renders need careful sequencing). Re-render only when the user explicitly switches to Preview, or when `value` changes *while in Preview*. The latter handles the case where the user toggles to Preview, switches back to Edit, edits, then back to Preview — the preview reflects the latest content.
2. **Read-only Preview.** Clicking inside the rendered HTML doesn't grant editing. To edit, switch the tab. Obsidian's Live Preview gives "click rendered MD → cursor lands in source" — we don't get that without going to Phase B.
3. **Save reads source, not preview.** The save handler in `NewCardPane` continues to read `value` (the textarea content) — the preview is purely visual. No format conversion at save time.
4. **Per-field mode.** Question and Answer have independent toggle state. Switching one to Preview doesn't switch the other.
5. **Topic / Section / Tags stay plain inputs.** Single-line metadata; markdown rendering would be visual noise and the use case is thin. Only Question / Answer get the toggle.

### Tests

No new Vitest coverage — the change is UI on top of an existing Obsidian API call, and the codebase's policy is "modal/pane UI is manually verified." Manual verification checklist:

- Type `**bold**`, `*italic*`, ` ``code`` `, a bulleted list, a `[link](https://example.com)` → flip to Preview → rendered HTML matches Obsidian's reading mode.
- Type `$E = mc^2$` (inline) and `$$\int_0^1 x\,dx$$` (display) → preview shows rendered math via MathJax.
- Type `[[some-note]]` → preview shows the link (resolved or literal); no JS errors.
- Flip back to Edit → source is intact, cursor lands in the textarea.
- Save the card → on-disk file body contains the source markdown unchanged (no HTML).
- Open the saved card in Obsidian's reading view → matches what the pane's preview showed.
- Edge: empty textarea + Preview → muted "Nothing to preview." message, no render attempt.
- Edge: switch to Preview, edit the textarea content via DevTools, the preview should *not* update until you flip away and back (per "render on mode-flip, not while typing").

### Exit criteria

A Question / Answer field can be authored with `$…$` math, `**bold**`, bullet lists, and wiki-link syntax, and the user can flip to Preview to verify the rendered output before clicking Save. No new on-disk format; the source written to the card file is byte-identical to today's output for the same input.

## Phase B — Embedded live-preview editor

Replace each `EditPreviewField`'s textarea with a custom CodeMirror 6 editor that renders Markdown affordances inline + LaTeX via MathJax, approximating Obsidian's Live Preview. The Edit/Preview toggle becomes redundant and is removed in the final sub-phase.

### Why not reuse Obsidian's `MarkdownView`

The first thing to consider is mounting a real `MarkdownView` on a draft file and reparenting its DOM. We explicitly *don't* go that route. Reasons:

1. `MarkdownView` requires a vault-resolved `TFile`. Hidden dot-folders (`.obsidian/plugins/<id>/drafts/`) are intentionally not indexed by Obsidian, so they can't back a `TFile`. Any draft file we create has to live in the visible vault tree and would surface in Search, Graph view, link suggestions, and Quick Switcher.
2. Reparenting a `WorkspaceLeaf`'s DOM into our pane violates internal workspace invariants — leaves are owned by `WorkspaceSplit`s and the framework reaches into them for sizing, focus, persistence on restart, etc. Plugins that try this routinely break on Obsidian updates.
3. The lifecycle (leaf cleanup, draft-file teardown on crash, focus stealing) is hairy.

Custom CM6 trades "exactly matches Obsidian's Live Preview" for "no internal-API dependencies and a deterministic lifecycle." For card content (short, simple, mostly text + math), the trade is favorable.

### Approach

Build a self-contained CodeMirror 6 `EditorView` using only public CM6 packages (all already externalized in [esbuild.config.mjs:23-37](../../esbuild.config.mjs#L23-L37)) plus `@codemirror/lang-markdown` (new bundled dep). On top of `lang-markdown`'s syntax tree:

- A `ViewPlugin` that walks syntax-tree nodes for `Emphasis`, `StrongEmphasis`, `ATXHeading*`, `InlineCode`, `Link`, etc., and emits CM6 `Decoration.mark` + `Decoration.replace` ranges that *hide* the markup characters when the cursor isn't on that line — the canonical Live-Preview-lite recipe.
- A `WidgetType` for inline `$…$` and block `$$…$$` math, rendered via Obsidian's public [`loadMathJax()`](../../node_modules/obsidian/obsidian.d.ts#L3494) and `renderMath()` helpers.
- A theme extension that maps CM6's `--cm-*` tokens to our `--ls-*` cream/dark variables so the editor's appearance follows the plugin theme.

### Files

**New** ([src/views/embedded-editor/](../../src/views/embedded-editor/)):

- `EmbeddedEditor.tsx` — React wrapper. Constructs an `EditorView` in a `useEffect`, mirrors `value` ↔ editor doc via a transaction-aware controlled bridge, exposes a `focus()` imperative handle matching `EditPreviewFieldHandle`. ~120 lines.
- `extensions.ts` — Assembles the extension stack: `markdown({ codeLanguages, addKeymap })`, `keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])`, `history()`, our custom live-preview ViewPlugin, our math WidgetType, theme. ~60 lines.
- `live-preview-decorations.ts` — `ViewPlugin` + helper that walks `syntaxTree(view.state)` and produces `DecorationSet`s. Hides markup characters via `Decoration.replace({ widget: new HiddenMarkupWidget() })` on lines not touched by the current selection. ~150 lines.
- `math-widget.ts` — `WidgetType` subclasses (`InlineMathWidget`, `BlockMathWidget`) that call `renderMath(tex, displayMode)` from Obsidian, cache the rendered MathML in a `WeakMap` keyed by the source text, and append into the widget element. Triggered by a syntax-tree match on `$` / `$$` runs. ~80 lines.
- `theme.ts` — CM6 `EditorView.theme({...})` extension binding `.cm-editor`, `.cm-content`, `.cm-cursor`, `.cm-selectionBackground` to the cream/dark CSS variables. Loaded into the editor's extension array. ~40 lines.
- `live-preview-decorations.test.ts` — Vitest unit tests for the pure helpers (cursor-on-line predicate, markup-range computation given a synthetic syntax tree). The CM6 setup itself is not unit-tested; manual verification owns the integration.

**Modified**:

- [src/views/EditPreviewField.tsx](../../src/views/EditPreviewField.tsx) — swap the textarea branch for `<EmbeddedEditor>`. In B.5 (final sub-phase), drop the Preview branch and the `ModeButton` row entirely.
- [package.json](../../package.json) — add `@codemirror/lang-markdown` to `dependencies` (bundled, not externalized). Optional: `@lezer/markdown` if we need to walk the parse tree directly; it ships as a transitive dep of lang-markdown so usually no explicit add needed.
- [esbuild.config.mjs](../../esbuild.config.mjs) — no change. CM6 core packages are already externalized; `@codemirror/lang-markdown` is intentionally bundled so we control the version.

### Sub-phases

Each sub-phase ships independently and leaves the plugin in a working state.

#### B.1 — CM6 source editor, no live preview

Scope: `EmbeddedEditor.tsx`, `extensions.ts`, `theme.ts`. Replace the textarea branch with a CM6 `EditorView` carrying:

- `markdown()` from `@codemirror/lang-markdown` (syntax highlighting in source mode)
- `history()` + `keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])`
- `EditorView.lineWrapping`
- Our theme extension
- An `updateListener` that fires `onChange(view.state.doc.toString())` whenever `update.docChanged`

The Edit/Preview toggle stays — preview still uses `MarkdownRenderer.render` as in Phase A. What changes is the edit mode: source markdown gets proper syntax highlighting and tab-aware indentation in Edit mode.

**Imperative handle:** `EmbeddedEditor` exposes `focus()` via `forwardRef`. `EditPreviewField`'s existing `focus()` handler delegates to it.

**Controlled bridge:** parent passes `value` and `onChange`. `EmbeddedEditor` keeps an internal "last known prop value" ref to detect external value resets (e.g., the post-save clear) and applies them via `view.dispatch({ changes: { from: 0, to: state.doc.length, insert: newValue } })` only when the prop value differs from the editor's doc string. Avoids feedback loops.

Exit criteria: Question and Answer fields use CM6 in Edit mode. Save / focus / paste / undo / redo work. Preview tab is unchanged.

#### B.2 — Live-preview decorations for inline markup

Scope: `live-preview-decorations.ts`.

Implement the markup-hiding ViewPlugin:

1. `syntaxTree(view.state).iterate(...)` walks the markdown nodes.
2. For each `Emphasis`, `StrongEmphasis`, `InlineCode`, `Link` node:
   - Find the markup ranges (e.g., `**` on each side for `StrongEmphasis`).
   - If the current selection's main range doesn't intersect that node's line, emit `Decoration.replace({})` over each markup range (collapses to zero-width).
   - Emit `Decoration.mark({ class: "cm-strong" })` (or `cm-em`, etc.) over the content range so CSS gives it visual weight.
3. For `ATXHeading*`, hide the leading `#` runs (when off-line) and tag the content with `cm-header-N`.
4. For `BulletList` / `OrderedList`, decorate the marker (no hide — Obsidian shows bullets).

Theme CSS additions (in `theme.ts`): font-weight for `.cm-strong`, italics for `.cm-em`, monospace + accent bg for `.cm-inline-code`, etc.

Exit criteria: typing `**bold**` while cursor is *elsewhere* shows bold text without the `**` markers; moving the cursor into the line restores the markers. Same for italic, headings, code spans, links.

#### B.3 — Math rendering

Scope: `math-widget.ts`.

1. Call `await loadMathJax()` once at module load (lazy — first time the editor mounts).
2. Implement two `WidgetType`s:
   - `InlineMathWidget(tex: string)`: `toDOM()` returns a `<span>` containing the result of `renderMath(tex, /* display */ false).innerHTML`.
   - `BlockMathWidget(tex: string)`: same with `display: true` and a `<div>`.
3. In the live-preview ViewPlugin, add detection for `$…$` (inline) and `$$…$$` (block) runs. The lang-markdown parser may not tokenize these — fall back to a regex pass over the document and emit decorations for matched ranges.
4. For each match: when cursor is *not* on that line, emit `Decoration.replace({ widget: new InlineMathWidget(tex) })`. When cursor *is* on the line, leave the source visible.

`eq()` on the widgets compares the TeX source so identical re-renders are skipped (CM6 reuses widgets when `eq` returns true).

Exit criteria: typing `$E = mc^2$` shows rendered math when the cursor leaves the line; clicking back into the math shows source for editing. Block `$$…$$` renders centered. No flicker on every keystroke (widget identity caching).

#### B.4 — Wiki-links + plain links

Scope: extend `live-preview-decorations.ts`.

- `[[wiki-link]]` syntax: hide brackets when off-line, style the link text with `cm-link`. No click-to-navigate yet (open in Obsidian after Save).
- `[text](url)`: same — hide the URL portion when off-line, show only `text` styled.

Exit criteria: wiki-link and plain-link source becomes "rendered text" when the cursor isn't on the line, just like Obsidian.

#### B.5 — Remove the Preview tab

Scope: [EditPreviewField.tsx](../../src/views/EditPreviewField.tsx).

The CM6 editor now *is* the preview. Drop the toggle and the preview-render branch. Rename `EditPreviewField` to `MarkdownField` (the "preview" half is gone). `MarkdownRenderer.render` is no longer used here, and the `pendingFocusRef` switch-to-edit dance becomes a plain `editor.focus()`.

Update [NewCardPane.tsx](../../src/views/NewCardPane.tsx) imports.

Exit criteria: a user typing `**bold** $\pi$` sees the rendered output as they type. No tabs, no mode toggle.

### Decisions baked in

1. **CM6 from scratch, not reparented `MarkdownView`.** Rationale above. Cost: doesn't get features we don't reimplement (callouts, embeds, native PDF preview). Benefit: deterministic lifecycle, no draft files in vault, no internal-API dependency.
2. **Lang-markdown bundled, CM6 core externalized.** Keeps the version of the lexer we depend on pinned by our build; the runtime CM6 framework comes from Obsidian so we don't ship a duplicate.
3. **Markup decorations driven by line-not-line.** Hide markers when the cursor is on a different line from the markup, not on a different character. Cheaper to compute and matches Obsidian's behavior.
4. **MathJax via `loadMathJax()` + `renderMath()`, no KaTeX.** Obsidian already ships MathJax; bundling KaTeX would duplicate ~250 KB. The rendering is async (MathJax startup) — handled by awaiting `loadMathJax()` at module load.
5. **No keymap for save / no `Mod-Enter` triggers Save.** The user clicks Save explicitly; CM6 captures most keystrokes including `Enter` (for newline). The ribbon icon + command palette + the explicit button stay the only Save paths. Spec'd here so we don't get tempted to add a keymap later that conflicts with regular typing.
6. **Same `focus()` contract.** `MarkdownField` exposes the same imperative handle shape as `EditPreviewField`, so the call site in `NewCardPane.tsx` doesn't change beyond the import and the rename.

### Risks

- **Live-preview-lite never quite matches Obsidian's behavior.** Acceptable trade given lifecycle and maintenance benefits. Document in the README that the pane editor is a subset.
- **MathJax startup latency.** First-time `loadMathJax()` can take 100–300ms; subsequent renders are instant. The editor stays interactive during load — math widgets just show source until the resolve completes, then `view.dispatch({ effects: invalidateMathCache.of(null) })` triggers re-decoration.
- **Tailwind preflight conflicts.** Our build skips preflight, but CM6 has its own baseline CSS. Watch for double-borders or font-size clashes when the editor mounts. Mitigation: theme extension binds the specific `.cm-*` selectors we care about and overrides defaults.
- **CodeMirror state vs React state.** Two sources of truth (controlled prop + editor doc). The transaction-bridge pattern in B.1 keeps them in sync, but watch for re-render loops when the parent forces a new `value` mid-edit. Test coverage in `live-preview-decorations.test.ts` for the bridge logic.
- **B.3 widget identity.** If `eq()` is wrong, every keystroke re-renders every math widget — visible flicker and performance hit. Test by typing fast in a doc with several math blocks; widgets shouldn't flash.

### Tests

Unit (in `live-preview-decorations.test.ts`):

- `isLineWithSelection(state, lineNumber)` — pure predicate over an `EditorState`.
- `mathRangesIn(doc)` — regex helper returning `{ from, to, tex, display }[]` for `$…$` / `$$…$$` matches. Critical for B.3 since we drive math decorations off this.
- Slug-style markup-range helpers (input: source text + node range; output: where the `**` markers sit).

The CM6 integration (mount, update, transactions) is verified manually. No DOM testing.

### Exit criteria (whole phase)

Question and Answer fields render `**bold**`, `*italic*`, `# Heading`, `- list`, `` `code` ``, `$math$`, `$$display$$`, `[link](url)`, and `[[wiki-link]]` inline as the user types. The Edit/Preview toggle is gone. The save handler reads the editor's source text unchanged; on-disk files are identical to Phase A's output for the same input.

## Open questions

1. **Preview footprint.** `MarkdownRenderer.render` may pull in MathJax lazily on the first math-containing render — the first preview flip could feel slow. Worth profiling in Phase A.
2. **Wiki-link resolution semantics.** `sourcePath` for an unsaved card is ambiguous (the file doesn't exist yet). Using the prospective folder path works for most cases, but a card linking to itself via its own slug would resolve to a non-existent file. Probably fine — users don't typically self-link in fresh cards — but worth noting.
3. **Image / embed handling in preview.** `![[image.png]]` embeds will render in the preview tab if the asset exists in the vault. Pasting screenshots is a likely follow-up request; out of scope here but the preview will already display them correctly via `MarkdownRenderer.render`.
