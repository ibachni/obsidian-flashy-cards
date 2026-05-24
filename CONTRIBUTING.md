# Contributing

Thanks for the interest, I am happy about anyone willing to contribute. This is a small, personally-maintained plugin, so a few notes on scope before you spend time on a change.

## What's out of scope

- Wholesale rewrites or framework swaps.
- Server-side sync, account systems, or anything that takes cards out of the user's vault.
- Algorithm replacements for FSRS.

## Dev loop

```bash
npm install
npm run dev      # esbuild + tailwind in watch mode
```

The tightest iteration loop is to point the dev output at a real vault's plugin folder. Symlink (or build into) `<vault>/.obsidian/plugins/flashy-cards/`, then `Cmd/Ctrl-R` in Obsidian to reload after a rebuild. Enable the plugin once under **Settings → Community plugins**.

A scratch vault you don't mind seeding with test cards is strongly recommended — the **Create** flow writes files into your `cards root`.

## Before opening a PR

Run all three:

```bash
npm run lint
npm test
npm run build
```

For any UI change, please exercise the affected pane in a real Obsidian window. Type-checks and unit tests catch correctness but not visual regressions — light mode, dark mode, and at least one Obsidian theme other than default is the realistic minimum.

If the change touches scheduling, the card parser, or the review log, add or extend a unit test alongside it. Tests run via Vitest and use [test/obsidian-shim.ts](test/obsidian-shim.ts) instead of the live Obsidian runtime — production code paths that touch the vault must remain reachable through injected fakes, not direct calls into the `obsidian` package at module load.

## Code style

- Tabs for indentation. Existing files are the source of truth.
- Comments explain the **why** — hidden constraints, surprising cascade interactions, why a workaround exists. Don't restate what the code does.

## Architectural invariants

These are non-negotiable without an issue discussion:

- **Cards are plain markdown files.** FSRS state lives in frontmatter (`fsrs_*` keys); body holds the question/answer. No database, no separate state file per card.
- **Append-only review log** under `.learning-system/history/`. Never rewrite or compact in place.
- **Single esbuild entry**: `src/main.tsx`. Code-splitting is off; the plugin ships as one bundle plus one stylesheet.
- **Tailwind preflight is intentionally disabled** and `!important` on chrome overrides is load-bearing. See the block comment in [src/styles.css](src/styles.css) before "fixing" any of it.
- **No network calls.** The plugin runs fully offline. No webfonts, telemetry, or remote assets.

## Commits and PRs

- Short imperative commit titles, in the style of the existing `git log` (e.g. `Fix cloze parser for nested braces`).
- Squash or rebase locally so the history reads cleanly; the maintainer may also squash on merge.
- PR description: what changed, why, and how to verify. Link the issue if there is one.

## License

By contributing you agree your changes are released under the project's [MIT license](LICENSE).
