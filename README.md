# Nexus Explainer

A VS Code extension for [Project Nexus](../REQUIREMENTS.md)'s bicameral
Code/Explainer workflow: view the `explainer` branch's narrative for the
file you're editing, split-screen, without leaving VS Code or touching your
working tree.

## What it does today

Run **Nexus: Show Explainer** (Command Palette, editor right-click menu, or
`Ctrl+Alt+E` / `Cmd+Alt+E`) with a file open. It opens a read-only Markdown
preview beside your editor showing that file's current entry from the
`explainer` branch.

Nothing is checked out or written to disk. The extension shells out to
[`entire nexus show <path> --json`](../nexus-cli/cmd/entire/cli/nexus_show.go)
— the same command a script or CI job would use — which reads the
explainer branch's git objects directly. `entire` (this project's CLI fork)
must be installed and on `PATH`.

If the file hasn't been narrated yet, or Nexus isn't set up in the repo,
the preview says so instead of showing stale or missing content silently.

## Requirements

- The `entire` CLI (this repo's Nexus fork) on `PATH`.
- `entire nexus init` already run in the repo you're working in.
- VS Code's built-in Markdown preview (bundled by default; only matters if
  you've disabled it).

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Press F5 in VS Code (with this folder open) to launch an Extension
Development Host with the extension loaded.

## Architecture notes

- **`src/cliClient.ts`** — the only place that shells out to `git` (to
  resolve the repo root for the active file — never assume a VS Code
  workspace folder *is* the repo root) and to `entire nexus show`.
- **`src/explainerProvider.ts`** — a `TextDocumentContentProvider` for the
  `nexus-explainer:` URI scheme. The code path lives in the URI's path
  (with `.md` appended, so VS Code shows a sensible tab title and treats
  the content as Markdown); the resolved repo root travels as a query
  param, since it isn't always derivable from the URI alone.
- **`src/extension.ts`** — wires up the command and the content provider.
  No other state.

Deliberately **not** built as a caching layer: every open re-shells to
`entire nexus show`. Explainer content changes only when the `narrate`
skill commits, which isn't a high-frequency event — the simplicity of
"always read fresh" outweighs any latency saved by caching, and it means a
freshly-narrated file never shows stale content from before.

## Roadmap (not yet built)

- CodeLens annotations per function/file ("view explainer") instead of
  requiring the command/keybinding.
- Source Control panel integration — surface the explainer next to a
  changed file when reviewing a diff, closer to the PRD's actual reviewer
  workflow (read the explainer instead of the code diff).
- Staleness/desync indicators, using `desynced`/`desync_markers` from
  `nexus show --json` (already returned, not yet surfaced in the UI) and
  `.nexus/pending.json` (not yet read by this extension at all).
- Scroll-sync between code and explainer — needs the line-mapping
  ("sourcemap") piece from TR4.3, deliberately deferred so far.
