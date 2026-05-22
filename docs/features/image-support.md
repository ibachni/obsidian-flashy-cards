# Image support

Roadmap item #16 from [feature-roadmap.md](./feature-roadmap.md). Pasting or dropping an image into the Question or Answer field saves the bytes under `<cardsRoot>/_attachments/` and inserts an `![[…]]` embed at the cursor; Review renders the image via the existing `MarkdownBlock`. This unblocks diagrams, anatomy, screenshots — anything visual — and is the prerequisite for image occlusion ([image-occlusion.md](./image-occlusion.md)).

## Motivation

Today the only way to put an image into a card is to manually drop the file into the vault, type out `![[filename]]` in the right field, and then verify the wikilink resolves. Three context switches and a chance to mis-type the filename — enough friction that most users won't bother, which silently rules out a whole class of cards.

The plugin already renders embedded images correctly: [MarkdownBlock](../../src/views/MarkdownBlock.tsx) calls `MarkdownRenderer.render(app, source, el, sourcePath, sub)` with `sourcePath = current.path`, so `![[image.png]]` resolves against Obsidian's global link cache regardless of where the card lives in the vault. The missing piece is end-to-end ergonomics: get the image into the markdown source without leaving the editor.

Image occlusion (#42) sits directly on top of this pipeline — it needs to write bytes to the same `_attachments/` folder before it can offer those images as occlusion sources. Shipping #16 first means #42 reuses the helper unmodified.

## Scope

**In:**

- Paste handler on the embedded Q/A editors. If the clipboard carries an image (`event.clipboardData.files[0].type.startsWith("image/")`), save the bytes and insert `![[<basename>]]` at the cursor; otherwise fall through to default text paste.
- Drop handler on the same editors. Same logic against `event.dataTransfer.files`.
- A single shared helper `saveAttachment(app, cardsRoot, blob, opts)` that owns the filename strategy, the directory existence check, and the write.
- Placeholder-then-replace UX: while the write is pending, insert `![[uploading-<id>.png]]` at the cursor so the user sees something immediately; swap for the real embed on resolve, or for a `<!-- image paste failed: <err> -->` comment + `Notice` on reject.
- MIME-to-extension mapping for `image/png`, `image/jpeg`, `image/webp`, `image/gif`. SVG (`image/svg+xml`) is out for v1.
- Both Create pane (NewCardPane) and Edit modal pick up the handler automatically, since they share `MarkdownField`.

**Out:**

- A separate "Insert image" button. Paste and drop cover the actual usage pattern; a button-driven file picker is a follow-up if real users ask for it.
- Auto-resize / image optimization. Bytes are written as-is.
- Configurable attachment folder. The roadmap pins `_attachments/`; making it a setting is a P2 polish item once the primary use is real.
- Orphan-attachment cleanup. When a card is deleted, its `![[…]]` references aren't scanned and the attachment stays. A single image is often shared across cards, and silent destructive ops violate the AGENTS.md policy. A dedicated `<cardsRoot>/.learning-system/orphan-attachments.md` report command is the right shape but lives in a future task.
- SVG paste handling. Some apps (Excalidraw, Figma) put SVG on the clipboard as text/svg+xml rather than as a File. v1 detects only `image/*` File entries; SVGs land as text and are clearly visible as such.
- Frontmatter changes. Images live in the body — `CardFrontmatter` ([src/schema/card.ts](../../src/schema/card.ts)) is untouched.

## Files

**New**

- [src/cards/image-attachment.ts](../../src/cards/image-attachment.ts) — pure-ish helpers. Exports `saveAttachment(app, cardsRoot, blob, opts): Promise<{ path, wikiembed }>`. Owns filename selection (timestamp + monotonic suffix probe, mirroring [findAvailablePath](../../src/cards/new-card.ts#L164)), MIME-to-extension mapping, directory ensure, and the `app.vault.createBinary` write. Returns the vault-relative path and a ready-to-insert `![[<basename>]]` string.
- [src/cards/image-attachment.test.ts](../../src/cards/image-attachment.test.ts) — Vitest unit tests. Inject `exists` and `writeBinary` callbacks so the helper stays vault-agnostic in tests; cover MIME mapping, collision suffix probing, sanitization of basenames with awkward characters.
- [src/views/embedded-editor/paste-drop-plugin.ts](../../src/views/embedded-editor/paste-drop-plugin.ts) — CM6 `ViewPlugin` factory. Registers `paste` and `drop` DOM-event handlers via `EditorView.domEventHandlers`. On an image-bearing event, prevents the default text paste, inserts the placeholder, awaits `saveAttachment`, and swaps the placeholder for the real embed. Factory signature is `(app, getCardsRoot)` where `getCardsRoot` is a callback (not a snapshot) so settings changes don't require an editor rebuild.

**Modified**

- [src/views/embedded-editor/extensions.ts](../../src/views/embedded-editor/extensions.ts) — `buildExtensions` accepts two new args (`app: App`, `getCardsRoot: () => string`); appends `pasteDropPlugin(app, getCardsRoot)` to the returned extension array. The new plugin uses `domEventHandlers` on the content DOM (bubble phase), so it doesn't collide with the existing window-capture `formattingPlugin`.
- [src/views/embedded-editor/EmbeddedEditor.tsx](../../src/views/embedded-editor/EmbeddedEditor.tsx) — accept `app` and `getCardsRoot` as props, forward them to `buildExtensions`.
- [src/views/MarkdownField.tsx](../../src/views/MarkdownField.tsx) — pull `app` and `normalizedCardsRoot` from `usePluginContext()` inside `MarkdownField`; forward to `EmbeddedEditor`. Tradeoff: makes `MarkdownField` plugin-bound, but it's already in `src/views/` next to other plugin-bound components and the only two callers (Create, Edit) are both inside the plugin.
- [src/views/NewCardPane.tsx](../../src/views/NewCardPane.tsx) — no change. Inherits the new behavior through `MarkdownField`.
- [src/views/EditCardModal.tsx](../../src/views/EditCardModal.tsx) — no change. Same reason. The Edit save path uses `rewriteBody`, which is content-agnostic — embeds round-trip cleanly.

## `saveAttachment` shape

```ts
interface SaveAttachmentOpts {
  /** Original filename from the drop event, if any. Used as the basename
   *  before the timestamp/collision suffix. Defaults to "paste". */
  hint?: string;
  /** Override for the current time — injected for tests. */
  now?: Date;
}

interface SaveAttachmentResult {
  /** Vault-relative path, e.g. "<cardsRoot>/_attachments/paste-20260522-143000.png". */
  path: string;
  /** Ready-to-insert wikilink, e.g. "![[paste-20260522-143000.png]]". */
  wikiembed: string;
}
```

Internal steps:

1. Resolve target dir as `${cardsRoot}/_attachments/`. If it doesn't exist, create it via `app.vault.createFolder` (idempotent).
2. Determine extension from `blob.type` via MIME map; fall back to `.bin` for unknown types (defensive; in practice the paste/drop handler gates on `image/*`).
3. Compute candidate stem: `${opts.hint ?? "paste"}-${YYYYMMDD}-${HHmmss}`, e.g. `paste-20260522-143000`. Sanitize the hint by replacing `[^a-zA-Z0-9._-]` with `-`.
4. Probe for collisions with `findAvailablePath`-style logic (`-2`, `-3`, …). The helper is small enough to inline rather than reuse — it lives in `new-card.ts` and is shaped for `.md` files.
5. Read blob as `ArrayBuffer` via `await blob.arrayBuffer()`.
6. Write with `await app.vault.createBinary(finalPath, arrayBuffer)`. This is the visible-file path (not `app.vault.adapter.writeBinary`), so the file is registered as a `TFile`, indexed in `metadataCache`, and resolvable by `![[…]]` embeds without a workspace refresh.
7. Return `{ path: finalPath, wikiembed: '![[' + basename(finalPath) + ']]' }`.

## Filename strategy

Three strategies considered:

| Strategy | Pro | Con |
|---|---|---|
| Timestamp + suffix probe | Human-readable; sorts naturally; cheap | Two pastes within one second need a `-2` probe |
| Content hash (`sha1-<8>.png`) | Dedup across cards for free; rename-safe | Loses recency in the file manager; needs Web Crypto |
| User-provided name (modal) | Self-documenting | Kills the rapid-paste flow — one extra modal per image |

**Pick timestamp + suffix probe.** Same shape as [findAvailablePath](../../src/cards/new-card.ts#L164). Content hashing is a nice future migration (deduplicates pasted screenshots) but isn't worth the build cost for v1. The dedup gain only matters once a user has many cards sharing the same source image, which is exactly what image occlusion (#42) needs — but occlusion writes the source image once per set, picked from `_attachments/`, so dedup isn't on the critical path.

## Embed shape

Use `![[basename]]` (wikilink), not `![](_attachments/foo.png)` (relative path). Reasons:

- Matches Obsidian's "Use [[Wikilinks]]" default; consistent with how user-authored embeds look.
- Survives the user manually moving the attachment inside the vault — Obsidian rewrites wikilinks; relative paths break silently.
- Resolves regardless of the card's depth in the topic tree — wikilinks search the global link cache.

Downside: only resolves inside Obsidian. Acceptable — this is an Obsidian-only plugin.

## Placeholder UX

The write is asynchronous (potentially tens of milliseconds for a multi-megabyte PNG). To keep the editor responsive:

1. On the paste/drop event, generate a transient ID (`pending-${Date.now()}-${Math.random().toString(36).slice(2,6)}`).
2. Synchronously dispatch a CM6 transaction inserting `![[uploading-${id}.png]]` at the cursor. The user sees something immediately.
3. Start the `saveAttachment` call.
4. On resolve, dispatch a second transaction: find the placeholder string in the current doc (it's a unique sentinel by construction), replace with the real `![[…]]`. The find can fail if the user typed enough to delete the placeholder in the interim — in that case, append the embed at the end of the doc and `Notice("Image inserted at end — placeholder was edited away")`.
5. On reject, replace the placeholder with `<!-- image paste failed: ${err.message} -->` and `Notice` the error.

The placeholder doesn't render as an image (the file `uploading-${id}.png` doesn't exist), so the user sees the literal placeholder text. That's intentional — it signals "in progress" without flickering a broken-image icon.

## Drop vs. paste

The same plugin handles both. Differences:

- Paste reads from `event.clipboardData.files`; drop reads from `event.dataTransfer.files`.
- Drop fires on the `drop` event, which Obsidian's own drag-handler also listens for. Test that we don't fight Obsidian's "drop a file from the file explorer onto an editor → create a wikilink" behavior. Our handler runs on the contentDOM (editor content) — if Obsidian's runs higher up and is greedy, our preventDefault may not be enough. Verification step: drag a file from Finder into the Q field, confirm a single embed is inserted (not two, not a file-rename).

If Obsidian's drop handler conflicts, the fallback is: only handle drops whose `dataTransfer.files[0]` is an image and whose `dataTransfer.types` doesn't include `"obsidian/file"` (Obsidian's internal drag-source marker). Paste is unconflicted.

## Schema impact

None. Embeds are body content. `CardFrontmatter` ([src/schema/card.ts](../../src/schema/card.ts)) is untouched.

## Review rendering verification

`MarkdownBlock` already does the right thing — [ReviewPane.tsx](../../src/views/ReviewPane.tsx) passes `sourcePath={current.path}` and `MarkdownRenderer.render` resolves `![[…]]` via the metadata cache. No code change needed in the render path. Verification:

- Paste a screenshot into Q on the Create pane → save → switch to Review → image renders.
- Same flow but with the card under a deeply-nested topic folder (`<cardsRoot>/topic/sub/sub/card.md`) — wikilink still resolves because depth doesn't matter for `![[basename]]`.
- Browse row click → opens the card in the main editor area → Obsidian's native preview shows the image.

## Interactions with existing features

- **Edit modal** ([EditCardModal.tsx](../../src/views/EditCardModal.tsx)). Pasting into Edit's Q/A editors works because the modal uses `MarkdownField`. `rewriteBody` ([src/cards/edit-card.ts:32](../../src/cards/edit-card.ts#L32)) is byte-faithful to the frontmatter and content-agnostic for the body — embeds round-trip.
- **Delete from UI** ([DeleteCardConfirm.tsx](../../src/views/DeleteCardConfirm.tsx)). Calls `app.vault.trash(file, true)` on the `.md` file only. Attachments are not scanned or removed (see Scope → Out).
- **Undo last grade** ([keyboard-and-undo.md](./keyboard-and-undo.md)). Orthogonal. The undo buffer holds frontmatter snapshots; body changes aren't tracked because grade never touches the body.
- **Review log** ([src/cards/review-log.ts](../../src/cards/review-log.ts)). Orthogonal. Log entries record path/topic/grade/interval, not body content.
- **Browse filters** ([BrowsePane.tsx](../../src/views/BrowsePane.tsx)). Orthogonal. Filters are frontmatter-only.

## Interactions with future roadmap items

- **Cloze siblings (#7).** Also lives in the body. `{{c1::![[diagram.png]]}}` should split cleanly because cloze marker parsing operates on the marker, not the wrapped text. Note as a manual-test case once #7 ships.
- **Image occlusion (#42).** Reuses `saveAttachment` to write the source image. The occlusion pane's image picker lists existing attachments by filtering `app.vault.getFiles()` on the attachments dir + image extensions. See [image-occlusion.md](./image-occlusion.md).
- **Quick-create from selection (#17), AI card generation (#28).** Both eventually emit markdown bodies. If they emit `![[…]]`, the same attachment pipeline applies — but neither needs a special code path; they just call `saveAttachment` like the paste handler does.

## Tests

Pure helpers:

- [src/cards/image-attachment.test.ts](../../src/cards/image-attachment.test.ts):
    - MIME mapping happy paths (png/jpeg/webp/gif).
    - Unknown MIME → `.bin` extension.
    - Hint sanitization: `"My Image.png" → "My-Image"` stem, `.png` ext.
    - Empty hint → `"paste"` stem.
    - Collision: two saves within the same second with the same hint → second gets `-2` suffix.
    - 99 collisions in the same second → falls back to a longer timestamp (mirrors `findAvailablePath` final-fallback shape).

Integration-shaped (manual; no Vitest):

- Paste a PNG screenshot from system clipboard into Q on Create → embed appears with the placeholder briefly visible.
- Same on Edit modal Q.
- Same on Edit modal A.
- Drop a PNG from Finder into Q.
- Paste plain text into Q → still pastes as text (no image branch taken).
- Paste an image, then immediately type "hello" before save resolves → embed lands at end, Notice surfaces.
- Save a card with an embed; verify the file at `<cardsRoot>/_attachments/paste-…png` exists; verify Review renders.
- Paste two images within the same second → both save, second gets `-2`.

## Implementation phases

Three phases, each shippable.

### Phase 1 — `saveAttachment` helper + tests

Scope: [src/cards/image-attachment.ts](../../src/cards/image-attachment.ts), [src/cards/image-attachment.test.ts](../../src/cards/image-attachment.test.ts).

- Implement the helper with `exists`/`writeBinary` injection points for testability.
- Provide a real-vault adapter (or have the helper accept `app` and use it directly — pick one shape and stay consistent with `new-card.ts`).
- Cover MIME mapping, hint sanitization, collision probing in unit tests.
- No UI wiring yet.

Exit: `vitest run` green; nothing user-visible.

### Phase 2 — CM6 paste/drop plugin

Scope: [src/views/embedded-editor/paste-drop-plugin.ts](../../src/views/embedded-editor/paste-drop-plugin.ts), [src/views/embedded-editor/extensions.ts](../../src/views/embedded-editor/extensions.ts), [src/views/embedded-editor/EmbeddedEditor.tsx](../../src/views/embedded-editor/EmbeddedEditor.tsx), [src/views/MarkdownField.tsx](../../src/views/MarkdownField.tsx).

- Implement the ViewPlugin factory with paste handling first.
- Thread `app` and `getCardsRoot` through `MarkdownField` → `EmbeddedEditor` → `buildExtensions` → `pasteDropPlugin`.
- Implement the placeholder-then-replace flow.
- Add drop handling once paste is solid (same logic, different event source).

Exit: paste/drop into the Create pane's Q or A inserts an embed; image saves to `_attachments/`.

### Phase 3 — Edit modal verification + manual smoke

Scope: no code changes expected.

- Confirm Edit modal Q/A also accept paste/drop (inherits via `MarkdownField`).
- Walk the manual smoke list from [Tests](#tests).
- Confirm drop doesn't fight Obsidian's own drag handlers (Finder → Q field, Files-pane → Q field). Implement the `obsidian/file` dataTransfer-type guard if needed.
- Confirm `![[…]]` embeds render in Review for cards at varying topic depths.

Exit: feature ready to merge.

## Decisions baked in

1. **Wikilink embed, not relative path.** Matches Obsidian convention; survives in-vault renames; depth-independent.
2. **Hardcoded `_attachments/` folder, not a setting.** Roadmap spec. Making it configurable is P2 polish; nothing downstream depends on the name being flexible.
3. **Timestamp filename, not content hash.** Cheaper, more readable, and the dedup payoff isn't on the critical path. Re-evaluate once a real user has 100+ image cards.
4. **No orphan cleanup on card delete.** Attachments are often shared across cards; silent destructive ops are a footgun per AGENTS.md. Orphan reporting is a separate future command.
5. **Placeholder-then-replace, not blocking insert.** Multi-megabyte pastes are common (modern screenshots are large); blocking the editor for the duration is bad UX.
6. **No new "Insert image" button.** Paste and drop cover the actual ergonomic gap. A button is additive and can land later if asked for.
7. **SVG paste handling deferred.** SVG-on-clipboard varies wildly by source app. v1 handles File entries with `image/*` MIME; SVG-as-text-string is a clean follow-up if real users report wanting it.
