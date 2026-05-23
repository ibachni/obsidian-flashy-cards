# Image occlusion

Roadmap item #42 from [feature-roadmap.md](./feature-roadmap.md). The user picks (or pastes) an image, draws rectangles over the parts they want to test, and the plugin generates N sibling cards — each one masks a different rectangle on the Question side and reveals the full image on the Answer side. Anatomy, geography, UI inspection, music notation: the entire "what is this thing on the diagram?" workflow.

This depends on [image-support.md](./image-support.md) (#16) being merged first — the occlusion editor pastes/picks images via the same `saveAttachment` pipeline.

## Motivation

Image occlusion is the headline feature in medical-school SRS communities for a reason: the rectangle-over-image pattern matches how visual knowledge actually surfaces under recall. A flat front/back card with `![[anatomy.png]]` on both sides doesn't test recall at all — the user sees the labelled diagram every time and the answer reveal adds nothing. Occlusion forces the user to name the hidden thing.

The format also amortizes a single high-effort source into many low-effort cards. One annotated diagram of the heart yields a dozen sibling cards keyed off the same image. Without occlusion, the user would manually crop a dozen sub-images, type a dozen Q/A pairs, and lose the spatial context that made the diagram useful in the first place.

The roadmap places this in P3 because it's a multi-component build (drawing surface, sibling expansion, custom render path, JSON sidecar) and the daily-driver gaps in P0/P1 come first. But once cloze (#7) lands, the sibling-card machinery is half-built — bundling occlusion into the same wave is cheaper than coming back to it later.

## Scope

**In:**

- A new pane mode `occlusion` in [ModeNav.tsx](../../src/views/ModeNav.tsx) and [UnifiedPane.tsx](../../src/views/UnifiedPane.tsx), peer to Review / Browse / Create / Stats.
- An image picker on the occlusion pane: lists existing files under `<cardsRoot>/_attachments/` (image extensions only) with thumbnails, plus a paste/drop zone that routes through `saveAttachment`.
- An SVG-based drawing surface: drag to draw a rectangle, click to select, drag handles to resize, Backspace/Delete to remove. The image renders at intrinsic dimensions inside a `viewBox`; the surface scales responsively but rectangle coordinates are stored in image-pixel space.
- A "Save as occlusion card" button that writes a markdown file plus a colocated JSON sidecar (`<slug>.occlusion.json`) holding the image path and mask list.
- Parser support: when the parser sees `occlusion_source: <basename>.occlusion.json` in frontmatter, it reads the JSON and emits N sibling `ParsedCard`s keyed by `<path>#m<n>` (where `n` is the 1-based mask index).
- Review render path: when `current.fm.occlusion_source` is set, `ReviewPane` branches to an `OcclusionRenderer` component instead of `MarkdownBlock`. Q-side renders the image with a filled rectangle over the hidden mask; A-side renders the full image with no overlay.
- Per-sibling FSRS state stored in the JSON sidecar (not in markdown frontmatter — see [Data model](#data-model)).
- Browse row annotation: occlusion siblings show `occlusion (1/3)` in their row.
- Sibling-aware delete: deleting an occlusion sibling deletes the whole set (with a confirm modal that names the count).

**Out:**

- Editing the markdown body of an occlusion card via [EditCardModal.tsx](../../src/views/EditCardModal.tsx). Opening Edit on an occlusion sibling shows a Notice "Use Occlusion mode to edit this card." The Edit modal can't represent mask geometry.
- Per-mask labels ("left ventricle"). Future additive change to the sidecar schema (`masks[].label?: string`). Out for v1; v1 cards are "this rectangle vs. the rest of the image".
- Multi-mask-hide ("hide masks 1 + 3 together"). Not a typical Anki pattern; defer indefinitely.
- Touch / mobile pointer-events. v1 is desktop-only for the editor; the renderer (read-only) works everywhere. Mobile users see a `Notice` if they try to open occlusion mode on a phone.
- Image cropping or rotation. The user is expected to prep the image elsewhere.
- Normalized (0–1) mask coordinates. v1 stores pixel coordinates; swapping the source image requires re-drawing masks. Documented limitation.
- Image zoom controls. v1 fits to pane; large images may render small. Add a "100%" toggle if real users hit the limit.

## Data model

Two files per occlusion set, colocated:

- `<cardsRoot>/<topic>/<slug>.md` — the card markdown, with frontmatter `occlusion_source: <slug>.occlusion.json` and an auto-generated body (Q section embeds the image; A section embeds the image; both bodies are informational — the real render path is custom).
- `<cardsRoot>/<topic>/<slug>.occlusion.json` — the structured sidecar.

### Why two files

Three placement options were considered:

| Option | Pro | Con |
|---|---|---|
| Masks as nested YAML frontmatter | One file per set; greppable | Obsidian's Properties UI renders nested arrays of objects badly (the same reason `fsrs_*` is flattened); the field is machine-edited and noisy in the user's view |
| Sibling JSON file colocated with the `.md` | Clean separation; JSON-shaped data stays JSON; markdown frontmatter stays small and Properties-UI-friendly | Two files per set; rename/move requires moving both |
| Flattened frontmatter (`occlusion_mask_1: "x,y,w,h"`, …) | Properties-UI friendly | Ugly; loses structure; per-sibling FSRS state has no good home |

**Pick the sibling JSON file.** The flat markdown frontmatter gets exactly one new field (`occlusion_source`), keeping `CardFrontmatter` clean and the Properties UI uncluttered. Per-sibling FSRS state lives in the JSON next to its mask, which is the natural home for it (see [Per-sibling FSRS state](#per-sibling-fsrs-state)). The rename/move concern is real but small: a future delete-occlusion-set helper handles both files, and Obsidian's rename-on-disk doesn't reach into either anyway.

### JSON shape

```jsonc
{
  "image": "_attachments/anatomy-heart.png",
  "masks": [
    {
      "x": 100, "y": 50, "w": 80, "h": 40,
      "fsrs": {
        "fsrs_due": "2026-05-25",
        "fsrs_state": "review",
        "fsrs_stability": 4.2,
        "fsrs_difficulty": 6.1,
        "fsrs_reps": 3,
        "fsrs_lapses": 0,
        "fsrs_last_review": "2026-05-22",
        "fsrs_learning_steps": 0
      }
    },
    { "x": 200, "y": 90, "w": 60, "h": 30, "fsrs": null },
    { "x": 50, "y": 200, "w": 100, "h": 40, "fsrs": null }
  ]
}
```

- `image` is vault-relative (so the same JSON works regardless of which topic folder the set lives in).
- `masks` is ordered; index = stable sibling identity. Reordering masks would reassign FSRS state to the wrong card; the editor preserves order on reorder operations.
- `fsrs` is `null` for unscheduled (new) masks; the picker treats `null` as "new card with default FSRS values".

### Markdown body shape

```markdown
---
type: flashcard
topic: anatomy
created: 2026-05-22
modified: 2026-05-22
occlusion_source: heart.occlusion.json
---

# Question

![[anatomy-heart.png]]

(Image occlusion · 3 masks)

# Answer

![[anatomy-heart.png]]
```

The body is intentionally informational. Q and A both embed the full image so that opening the source `.md` in Obsidian's native editor shows the user *something* sensible (not a broken card). The real render path is `OcclusionRenderer`, which ignores the body content and reads directly from the JSON.

The standard `# Question` / `# Answer` shape means the existing [src/cards/parser.ts](../../src/cards/parser.ts) parses the file without bespoke handling — the sibling expansion is an additive post-parse step.

### Sibling keying

`<path>#m<n>`, 1-based, where `m` is the mask-kind prefix. This mirrors the planned cloze convention `<path>#c<n>` from #7. Reasons:

- Obsidian doesn't allow `#` in file paths, so composite paths are unambiguously synthetic.
- `card.path.split('#')[0]` recovers the real file path, which is all `getAbstractFileByPath` needs.
- The picker, undo buffer, review log, and Browse rows already treat `card.path` as an opaque string — composite paths flow through.

A helper `resolveCardFile(app, cardPath): TFile | null` lands in `src/cards/edit-card.ts` (or a new `src/cards/path-utils.ts`) and is used wherever a `card.path` becomes a `TFile`. This is a v1 prerequisite for both #42 and #7.

## Per-sibling FSRS state

This is the most significant architectural decision in the feature. Options:

| Option | Pro | Con |
|---|---|---|
| Per-sibling flat fields in frontmatter (`fsrs_due_m1`, `fsrs_state_m1`, …) | Self-contained; matches the existing `fsrs_*` shape | Frontmatter explodes — 10 masks = 80 new fields; Properties UI becomes unusable |
| Per-sibling block in JSON sidecar | Clean separation; scales; data already structured | Diverges from cloze (#7), which presumably uses inline frontmatter |
| Per-sibling sidecar files under `.learning-system/fsrs/<hash>/m<n>.json` | Uniform with the sidecar convention started by review-log | Two write paths for one grade; more files; more places to corrupt |

**Pick the JSON sidecar.** The occlusion set already has a JSON sidecar; adding per-mask `fsrs` blocks to it is a natural extension. This **diverges from cloze (#7)** — flag in #7's design doc. Justification: cloze siblings share one source body and differ by which text span is hidden; the body is the source of truth and frontmatter is small. Occlusion siblings share one source image and differ by `{x,y,w,h}` — already JSON-shaped, already separated. Keep FSRS state with the mask it belongs to.

This means `gradeAndPersist` needs to branch on `card.fm.occlusion_source`:

- If unset: existing path — `processFrontMatter` writes `fsrs_*` to the markdown file.
- If set: read the JSON, update `masks[n].fsrs`, write the JSON back atomically (read → mutate → `app.vault.modify` the whole file). `processFrontMatter` still runs on the markdown file to bump `modified`.

Concurrency: two grades on different siblings of the same set in quick succession both rewrite the JSON. The `app.vault.modify` API is not atomic against itself. Mitigation: an in-process write queue keyed by JSON path (a single `Map<string, Promise<void>>` on the plugin). Grades chain through the queue. This is the same shape `gradeAndPersist` already implicitly assumes via the JavaScript single-threaded event loop, but the read-modify-write JSON edit creates a longer window where reordering matters.

## Files

**New (data layer)**

- [src/cards/occlusion.ts](../../src/cards/occlusion.ts) — Zod schema for `OcclusionSet`; helpers `readOcclusionSet(app, jsonPath)`, `writeOcclusionSet(app, jsonPath, set)`, `expandOcclusionSiblings(card, set): ParsedCard[]`. `expandOcclusionSiblings` produces N `ParsedCard`s each with `path = <originalPath>#m<n>`, body fields populated by sentinel markers the renderer recognizes, and frontmatter `fm` carrying both the markdown FM (for `topic`, `tags`, etc.) and a synthetic `fsrs_*` block extracted from `set.masks[n].fsrs` (or defaults when `null`).
- [src/cards/occlusion.test.ts](../../src/cards/occlusion.test.ts) — schema round-trip, sibling expansion (N masks → N siblings, correct keying, FSRS defaults for unscheduled masks), invalid-JSON handling, missing-file handling.
- [src/cards/grade-occlusion.ts](../../src/cards/grade-occlusion.ts) — JSON-side grade write. Exports `persistOcclusionGrade(app, jsonPath, maskIndex, fsrsUpdate)`. Owns the read-modify-write cycle and the per-path write queue.

**New (editor / renderer)**

- [src/views/OcclusionPane.tsx](../../src/views/OcclusionPane.tsx) — the host. Layout: image picker on the left, drawing surface on the right, action row ("Save", "Cancel"). Handles the new-card form fields (topic combobox, tags, optional Q/A text overrides) shared with the Create pane.
- [src/views/OcclusionEditor.tsx](../../src/views/OcclusionEditor.tsx) — the SVG drawing surface. Takes `imagePath` and `masks: Mask[]`, emits `onChange(masks)`. Mouse-down + drag draws a new rectangle; click selects; drag handles resize; Backspace/Delete removes the selected mask. Snaps to integer pixel coordinates.
- [src/views/OcclusionRenderer.tsx](../../src/views/OcclusionRenderer.tsx) — read-only render for Review (and any future preview surface). Takes `card`, `set`, `maskIndex`, `revealed`. Renders an `<svg viewBox="0 0 W H">` with `<image href={app.vault.adapter.getResourcePath(set.image)} />` and overlay rectangles. Q-side: solid fill on the active mask, optional outlines on other masks (configurable; default outline-on so the user sees "this is one of N occlusions"). A-side: no overlay.
- [src/views/OcclusionImagePicker.tsx](../../src/views/OcclusionImagePicker.tsx) — grid of thumbnails for existing `_attachments/` images plus a paste/drop zone. Selecting a thumbnail or dropping a new file sets the active image. Thumbnails use `app.vault.adapter.getResourcePath(file.path)`.
- [src/views/OcclusionEditor.test.ts](../../src/views/OcclusionEditor.test.ts) — pure tests on the geometry helpers: rect-normalize (handle drag-up-left producing negative w/h), hit-test for click selection, resize-handle math. SVG event handling itself is verified manually.

**Modified**

- [src/schema/card.ts](../../src/schema/card.ts) — add `occlusion_source: z.string().optional()` to `CardFrontmatter`. No default needed; absent means "not an occlusion card".
- [src/cards/parser.ts](../../src/cards/parser.ts) — after Zod parse succeeds, if `fm.occlusion_source` is set, resolve the JSON path relative to the card file, read + Zod-validate via `readOcclusionSet`, and call `expandOcclusionSiblings` to produce N siblings. On JSON parse error, mark the card as `invalid` with the JSON error message (don't silently swallow). On a missing JSON file, mark invalid with a "sidecar not found" message — the user almost certainly moved one file without the other.
- [src/cards/picker.ts](../../src/cards/picker.ts) — no logic change. Siblings are `ParsedCard`s with composite paths and synthetic `fsrs_*` blocks. The picker already operates on `ParsedCard` opaquely. Add a hook signature for sibling-bury so #40 has a place to land (`shouldSkipSibling(cardPath, doneToday): boolean` returning false by default).
- [src/main.tsx](../../src/main.tsx):
    - `gradeAndPersist`: branch on `card.fm.occlusion_source`. Occlusion grades route through `persistOcclusionGrade` against the JSON sidecar; the markdown file gets a `modified` bump via `processFrontMatter`. The undo buffer's `previousFm` becomes "previous state blob" — generalize to a discriminated `{ kind: "frontmatter", fm: …} | { kind: "occlusion-mask", maskFsrs: …}` shape, or carry a per-card-kind restore function.
    - Add `learning-system:new-occlusion-card` command opening occlusion mode (creates the leaf if needed).
    - File-rename and file-delete handlers ([main.tsx:884](../../src/main.tsx#L884), [main.tsx:904](../../src/main.tsx#L904)): when an occlusion `.md` is moved, move the paired `.occlusion.json` alongside it. When deleted, trash the JSON too.
- [src/views/ModeNav.tsx](../../src/views/ModeNav.tsx) — extend `Mode` to `"review" | "browse" | "create" | "stats" | "occlusion"`; add the entry to `ORDER`.
- [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx) — add the occlusion mode panel, sticky-mounted via the existing `mountedModes` pattern.
- [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx) — branch on `current.fm.occlusion_source`. When set, render `<OcclusionRenderer card={current} set={…} maskIndex={current.maskIndex} revealed={revealed} />` instead of the existing `MarkdownBlock` pair. The grade buttons and footer stay the same. Mask index needs to flow from the parser through the picker into the pane — add `maskIndex?: number` to `ParsedCard` (synthetic siblings carry it; normal cards leave it `undefined`).
- [src/views/CardRow.tsx](../../src/views/CardRow.tsx) — when `fm.occlusion_source` is set, append a small `occlusion (N/M)` annotation to the row.
- [src/views/DeleteCardConfirm.tsx](../../src/views/DeleteCardConfirm.tsx) — branch on the occlusion source. Confirm copy: "Delete this occlusion set (N cards)?" Delete both the `.md` and the `.occlusion.json`.
- [src/views/EditCardModal.tsx](../../src/views/EditCardModal.tsx) — guard at open: if the card is an occlusion sibling, `Notice("Use Occlusion mode to edit this card.")` and refuse to open. Alternative: route directly to occlusion mode pre-loaded with this set. Pick the route option in Phase 5.
- [src/cards/undo-buffer.ts](../../src/cards/undo-buffer.ts) — generalize `UndoEntry` to carry either a frontmatter snapshot or a mask FSRS snapshot. Both are restorable; the discriminator lives in the entry.

## Decision matrix — where the editor lives

| Option | Pro | Con |
|---|---|---|
| New mode in `UnifiedPane` | First-class workflow; matches Create's hosting; persists across mode switches; full viewport | Adds a fifth tab to `ModeNav` (visual real estate) |
| Modal opened from a command | Reuses the modal host pattern (Edit, Delete); no nav surface added | Obsidian modals cap around 80vw — a 1500px-wide source image clips awkwardly |
| New leaf in a separate tab | Full canvas room | Two surfaces for card creation is confusing; doesn't match the unified-pane model |

**Pick the new mode.** Drawing rectangles on a large image needs viewport room (modals clip); the workflow is "open occlusion mode, drop image, draw, save" — sticky-mount fits perfectly; `ModeNav` already supports a fifth slot. The visual real-estate concern is genuine but the row is short ("Occlusion" is 9 chars; existing labels are similar length).

## Render path detail

`OcclusionRenderer` is a controlled SVG component:

```tsx
<svg viewBox={`0 0 ${imageW} ${imageH}`} className="ls-occlusion-svg">
  <image href={getResourcePath(set.image)} width={imageW} height={imageH} />
  {!revealed && (
    <rect
      x={mask.x} y={mask.y} width={mask.w} height={mask.h}
      fill="var(--ls-mask-fill, #000)"
    />
  )}
  {!revealed && showOutlines && set.masks.map((m, i) => i !== maskIndex && (
    <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h}
      fill="none" stroke="var(--ls-accent)" strokeWidth={1} strokeDasharray="4 2" />
  ))}
</svg>
```

The SVG scales responsively via CSS (`width: 100%; height: auto`). `viewBox` carries the intrinsic dimensions so mask coordinates (image-pixel space) render correctly at any display size.

Image resolution: `app.vault.adapter.getResourcePath(set.image)` returns a `capacitor://` or `app://` URL the browser can load. This is the same primitive Obsidian uses for native image preview; no caching layer needed on our side.

`imageW` / `imageH` are read from the image once on mount (a hidden `<img>` element's `naturalWidth`/`naturalHeight` after `onLoad`, then state-set). Until the load resolves, the renderer shows a small skeleton — should be one frame on local-disk vaults.

`--ls-mask-fill` defaults to `#000` and is themeable; cream/dark themes don't need it overridden (black on either background is the conventional Anki look). Adding a per-mask color is a future additive change.

## Editor interactions

The editor handles three operations:

1. **Draw new rectangle.** Mouse-down on empty canvas → start dragging from that point. Live-preview the in-progress rect at 50% opacity. On mouse-up, if `w * h >= MIN_AREA` (~100 px²), commit; otherwise discard. Negative w/h from drag-up-left is normalized at commit time.
2. **Select rectangle.** Click inside an existing rect → select it. Selected rect renders with handles at corners and edge midpoints. Click empty canvas → deselect.
3. **Resize.** Drag a handle → resize from the opposite corner/edge. Drag the body → move. Hold Shift to maintain aspect ratio (future polish; v1 ships without).

Keyboard:

- Backspace / Delete with a selection → remove the rect.
- Escape → deselect.
- Cmd/Ctrl+Z → undo the last editor operation (in-editor undo; doesn't touch the file. Implementation: a small in-memory operation stack on the editor component).

The editor never auto-saves. Save happens explicitly via the pane's "Save" button.

## Interactions with shipped features

- **Edit modal.** Routes to occlusion mode for occlusion cards (or shows a guard Notice). Normal cards still open the modal as before.
- **Delete from UI.** Branches on `occlusion_source`. The confirm copy names the sibling count. Trashes both files via `app.vault.trash`.
- **Undo last grade.** Generalized `UndoEntry` carries either a frontmatter snapshot (normal cards) or a mask FSRS snapshot (occlusion cards). Restore routes through the same `undoLastGrade()` method, branching on the snapshot kind. The review-log truncation step is unchanged — log entries are agnostic to card kind.
- **Review log.** Append a `path: <original>#m<n>` entry per grade. The log already takes `path` as an opaque string. Downstream Stats panels that group by `path` count siblings independently — usually correct, occasionally surprising. Note in the Stats doc.
- **Browse filters.** Each sibling is its own `ParsedCard` so topic/tag/state filters work per-sibling. Searching for a topic that contains 3 occlusion sets returns 3 cards × 3 masks = 9 rows. Acceptable; matches how cloze siblings (#7) will behave.
- **Image support (#16).** Direct dependency. The occlusion image picker calls `saveAttachment` to ingest new images and lists existing ones via `app.vault.getFiles().filter(f => f.path.startsWith(attachDir) && /\.(png|jpe?g|gif|webp)$/i.test(f.path))`.

## Interactions with future roadmap items

- **Cloze siblings (#7).** Shares the sibling-keying convention `<path>#<kind><n>`. Strongly recommend landing #7 first if both are queued so the keying + composite-path-resolution code (`resolveCardFile`) has one source-of-truth. If #42 lands first, document the helpers so #7 reuses them.
- **Sibling-bury (#40).** The picker hook `shouldSkipSibling` lands as a no-op in this feature; #40 fills it in with a per-day skip-set keyed by the real file path.
- **Daily new-card cap (#8).** Each occlusion sibling counts as one new card. A 10-mask set is 10 new cards — the user is expected to budget for that.
- **Stats — per-topic retention (#9).** Already groups by `path` via `split('#')[0]` (or will, once siblings exist). Verify when occlusion lands.
- **Anki import (#33).** Anki's image-occlusion add-on uses a similar mask model. A future import path could map cleanly. Out of scope here.

## Tests

Pure helpers:

- [src/cards/occlusion.test.ts](../../src/cards/occlusion.test.ts):
    - Zod round-trip on a valid `OcclusionSet`.
    - Invalid mask (negative w) → schema error.
    - Empty masks array → schema error (min 1).
    - `expandOcclusionSiblings`: 3-mask set → 3 siblings; paths `<orig>#m1`, `<orig>#m2`, `<orig>#m3`; siblings carry correct `maskIndex`; siblings with `fsrs: null` get default FSRS values.
- [src/cards/grade-occlusion.test.ts](../../src/cards/grade-occlusion.test.ts):
    - Grade sibling 1 → JSON's `masks[0].fsrs` updates; other masks untouched.
    - Concurrent grade on siblings 1 and 2 (two awaited promises in flight) → both writes land via the queue; final JSON has both updates.
    - Grade against a missing JSON → throws cleanly; the markdown FM update doesn't run.
- [src/views/OcclusionEditor.test.ts](../../src/views/OcclusionEditor.test.ts):
    - Rect normalize: `{x: 100, y: 100, w: -50, h: -30}` → `{x: 50, y: 70, w: 50, h: 30}`.
    - Hit-test: click at (75, 85) hits a rect at `{x: 50, y: 60, w: 50, h: 40}`.
    - Resize handle math: drag NE handle of a rect anchors at SW corner.

Manual smoke (per [edit-card.md](./edit-card.md) convention):

- Open occlusion mode → drop a PNG → image renders in the editor.
- Draw three rectangles by click-and-drag → save → see `<cardsRoot>/<topic>/<slug>.md` and `<cardsRoot>/<topic>/<slug>.occlusion.json`.
- Switch to Review → see three cards in sequence; each masks a different rectangle; "Show answer" reveals the full image.
- Grade sibling 1 with Good (`3`) → JSON's `masks[0].fsrs.fsrs_due` advances; press `u` → grade rolls back; JSON's mask 0 is back to its prior state; log truncates.
- Grade siblings 1, 2, 3 in quick succession → all three persist correctly (write queue serializes).
- Open the source `.md` file in a regular Obsidian leaf → shows the embedded image and an "Image occlusion · 3 masks" hint; no crash.
- Click the pencil icon on an occlusion-sibling Browse row → guard Notice or routes to occlusion mode (whichever was picked in Phase 5).
- Click the trash icon on a sibling Browse row → confirm dialog says "Delete this occlusion set (3 cards)?"; confirm → both files in trash; all three Browse rows disappear.
- Rename the `.md` file via Obsidian's file explorer → `.occlusion.json` follows it; Browse rows update.
- Open occlusion mode on mobile → Notice "Image occlusion editor requires desktop."

## Implementation phases

Seven phases. Each is independently testable; phases 1–3 land without UI exposure.

### Phase 1 — Schema + data layer

Scope: [src/schema/card.ts](../../src/schema/card.ts), [src/cards/occlusion.ts](../../src/cards/occlusion.ts), [src/cards/occlusion.test.ts](../../src/cards/occlusion.test.ts).

- Add `occlusion_source` to `CardFrontmatter`.
- Implement `OcclusionSet` Zod schema, `readOcclusionSet`, `writeOcclusionSet`, `expandOcclusionSiblings`.
- Unit tests against the helpers (no vault — inject fs operations).

Exit: `vitest run` green; nothing user-visible.

### Phase 2 — Parser + sibling expansion

Scope: [src/cards/parser.ts](../../src/cards/parser.ts), [src/cards/parser.test.ts](../../src/cards/parser.test.ts).

- Extend parser to detect `occlusion_source` post-Zod and expand into siblings via `expandOcclusionSiblings`.
- Carry `maskIndex` through `ParsedCard` (new optional field).
- Hand-craft test fixtures: a `.md` + a `.occlusion.json` pair; parser produces N `ParsedCard`s with composite paths and per-sibling FSRS.
- Handle missing JSON, invalid JSON, JSON with zero masks — all surface as `invalid` parses with informative messages.

Exit: a hand-crafted occlusion set on disk is parsed into N siblings; Browse shows them (with no special annotation yet — that's Phase 6).

### Phase 3 — `OcclusionRenderer` + Review integration

Scope: [src/views/OcclusionRenderer.tsx](../../src/views/OcclusionRenderer.tsx), [src/views/ReviewPane.tsx](../../src/views/ReviewPane.tsx).

- Implement the read-only renderer.
- Branch `ReviewPane` on `current.fm.occlusion_source`.
- At this point, a hand-crafted occlusion set reviews end-to-end (siblings appear in the picker; each one masks a different rect; "Show answer" reveals the full image).
- Grading still goes to markdown frontmatter (Phase 4 fixes this) — for now, FSRS state updates land on the wrong file (the `.md` instead of the JSON). Note as a known-bad state and don't ship Phase 3 to users in isolation.

Exit: end-to-end review of a hand-crafted set works; grade behavior is wrong but documented.

### Phase 4 — Per-sibling grade persistence + undo

Scope: [src/cards/grade-occlusion.ts](../../src/cards/grade-occlusion.ts), [src/main.tsx](../../src/main.tsx), [src/cards/undo-buffer.ts](../../src/cards/undo-buffer.ts).

- Implement `persistOcclusionGrade` with the per-JSON write queue.
- Branch `gradeAndPersist` in `main.tsx`: occlusion grades route to `persistOcclusionGrade`; markdown FM gets a `modified` bump only.
- Generalize `UndoEntry` to a discriminated union; both grade kinds land in the same one-slot buffer.
- File-rename / file-delete handlers move/trash the JSON alongside the markdown.

Exit: grading a hand-crafted occlusion set updates the JSON correctly; undo rolls it back; rename-on-disk doesn't strand the JSON.

### Phase 5 — Occlusion mode + editor

Scope: [src/views/ModeNav.tsx](../../src/views/ModeNav.tsx), [src/views/UnifiedPane.tsx](../../src/views/UnifiedPane.tsx), [src/views/OcclusionPane.tsx](../../src/views/OcclusionPane.tsx), [src/views/OcclusionEditor.tsx](../../src/views/OcclusionEditor.tsx), [src/views/OcclusionImagePicker.tsx](../../src/views/OcclusionImagePicker.tsx), [src/views/OcclusionEditor.test.ts](../../src/views/OcclusionEditor.test.ts).

- Extend `Mode` and `ORDER`.
- Build the pane shell (image picker + editor + form fields + Save).
- Build the editor (draw / select / resize / delete).
- Build the image picker (existing thumbnails + paste/drop).
- Save flow: write JSON via `app.vault.create`, then markdown via `app.vault.create`. Failure of the second leaves a stranded JSON (acceptable v1; Notice + manual cleanup).
- Unit tests on the editor's pure geometry helpers.

Exit: a user can create a new occlusion card end-to-end from inside Obsidian; the set appears in Review next session.

### Phase 6 — Delete / Edit branching + Browse annotation

Scope: [src/views/DeleteCardConfirm.tsx](../../src/views/DeleteCardConfirm.tsx), [src/views/EditCardModal.tsx](../../src/views/EditCardModal.tsx), [src/views/CardRow.tsx](../../src/views/CardRow.tsx).

- Delete on an occlusion sibling deletes the whole set, with sibling-count confirm copy.
- Edit on an occlusion sibling either shows a guard Notice or routes to occlusion mode pre-loaded (pick one — recommend routing if Phase 5 supports pre-loading via state).
- Browse rows annotate `occlusion (N/M)`.

Exit: occlusion cards have full management UI parity with normal cards.

### Phase 7 — Polish + manual smoke

Scope: cleanup only.

- Walk the manual smoke checklist from [Tests](#tests).
- Confirm large images (≥2000px wide) render at fit-to-pane without overflowing the editor.
- Confirm mobile correctly shows the unsupported Notice.
- Confirm the file-rename / file-delete handlers don't leave stranded JSON.
- Confirm concurrent grades on multiple siblings of one set persist correctly under the write queue.
- Confirm `Notice` copy is consistent with the existing patterns ([keyboard-and-undo.md → Tests](./keyboard-and-undo.md#tests)).

Exit: feature ready to merge.

## Decisions baked in

1. **Sidecar JSON, not nested frontmatter, not flattened keys.** Masks are machine-edited structured data and don't belong in the user-facing Properties panel. The same JSON holds per-mask FSRS state, which would balloon the frontmatter otherwise.
2. **Per-sibling FSRS in the sidecar, not in markdown frontmatter.** Diverges from the cloze (#7) plan; documented divergence with a why. Justification: the data is already JSON-shaped; the frontmatter explosion problem is real.
3. **`<path>#m<n>` sibling keying.** Mirrors cloze's `#c<n>`. Composite paths flow through the picker/undo/review-log as opaque strings; `split('#')[0]` recovers the file path everywhere a `TFile` is needed.
4. **New pane mode, not a modal.** Drawing on large images needs viewport room. Sticky-mount fits the existing `UnifiedPane` pattern.
5. **Pixel coordinates, not normalized.** Cheaper, debuggable in raw JSON, and the source image is immutable per set — coordinates don't drift. Replacing the image requires re-drawing masks; documented.
6. **Image picker shows existing `_attachments/`, not the whole vault.** Constrains the search and reinforces the convention that occlusion sources live in the plugin's own folder. Users who want an image outside `_attachments/` can paste it in (gets saved to `_attachments/` like any other paste).
7. **Outlines on the other masks during Q-side render.** Matches Anki's image-occlusion convention; signals "this is one of N occlusions" so the user knows what kind of test this is. Configurable in a future polish pass if users want pure-blind mode.
8. **Body markdown is auto-generated and informational.** The source of truth for the masks is the JSON. The body exists so that opening the `.md` in a regular Obsidian leaf doesn't show a confusing empty file.
9. **No mask labels in v1.** Additive field; ship without; revisit if users ask.
10. **Desktop-only editor; renderer works everywhere.** Drawing rectangles on a phone screen with a finger isn't a usable workflow. Reviewing existing occlusion cards on mobile is.
11. **`gradeAndPersist` branches on `occlusion_source`, not via subclass / strategy pattern.** Two card kinds isn't enough complexity to warrant a strategy interface; cloze (#7) will be the third kind that motivates the refactor, not the second.
