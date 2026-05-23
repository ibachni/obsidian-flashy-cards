# Learning System

Spaced-repetition flashcards inside Obsidian. Each card is a plain markdown file in your vault — no database, no lock-in. Scheduling uses [FSRS](https://github.com/open-spaced-repetition/ts-fsrs), the same algorithm that powers modern Anki.

## What you get

One pane, three modes:

- **Review** — work through what's due. Keyboard-first: `Space` to reveal, `1`–`4` to grade, `u` to undo, `e` to open the source file.
- **Browse** — every card in a table. Filter by topic, tag, or state. "Test this section" turns any filtered set into a focused review.
- **Create** — Anki-style rapid entry. Topic, tags, Q, A → Save → next card. Topic and tags stay sticky for batch sessions.
- **Stats** — retention rate, daily streak, 30-day forecast, GitHub-style heatmap, per-topic weak spots.

Plus: cloze deletions (`{{c1::...}}`), image occlusion, drag-and-drop images, edit/delete from the UI, and an append-only review log under `.learning-system/history/`.

## Quickstart

1. Open the Learning System pane (brain icon in the ribbon, or **Open Learning System** in the command palette).
2. Hit **Create**, fill in a topic, question, and answer, then **Save**. The card lands at `<cards root>/<topic>/<slug>.md`.
3. Switch to **Review** — your new card is due immediately. Press `Space` to reveal, `1`–`4` to grade.

Set the cards root and other defaults under **Settings → Learning System**.

## Card format

A card is just a markdown file with FSRS state in frontmatter:

```markdown
---
type: flashcard
topic: spanish/verbs
tags: [lang]
fsrs_due: 2026-05-23
fsrs_state: new
# ...other fsrs_* fields managed by the plugin
---

## Question
What does *aprender* mean?

## Answer
to learn
```

You can edit cards by hand in any markdown editor — the plugin only touches the `fsrs_*` fields on grade.

## Install (manual)

Clone or download this repo, then build and copy the artifacts into your vault:

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<your vault>/.obsidian/plugins/learning-system/`, then enable **Learning System** under **Settings → Community plugins**.

For development, `npm run dev` watches both the TypeScript bundle and Tailwind styles. Pointing the dev folder directly at `.obsidian/plugins/learning-system/` and reloading Obsidian (`Cmd/Ctrl-R`) gives you a tight loop.

## License

[MIT](LICENSE). Third-party dependencies bundled into `main.js` retain their original licenses — see [NOTICES.md](NOTICES.md).
