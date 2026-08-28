---
path: "src/cliClient.ts"
summary: "The only place this extension shells out to `nexus` or `git` — every explainer/diff/map/tour read goes through here."
source_commit: b2272078a9c925fc0f6b17bb03f902ee7b9de545
desynced: false
---

# src/cliClient.ts

## What this does
This module is the extension's entire boundary with the outside world: it
defines the TypeScript types mirroring `nexus-cli`'s JSON output
(`NexusShowResult`, `NexusMapResult`, `NexusTourResult`, and their nested
shapes) and the functions that actually shell out — `resolveRepoRoot`,
`fetchExplainer`, `fetchExplainerDiff`, `fetchNexusMap`, `fetchNexusTour`.
No other file in this extension calls `git` or `nexus` directly.

## How it works
Each `fetch*` function is a thin wrapper: run the matching `nexus`
subcommand with `--json` (or plain text for diff) in the target repo root,
parse the result, and on any failure — the binary isn't installed, isn't
on `PATH`, or exits non-zero — return a result shaped like a normal
"not found" response but with its `error` field set to a message telling
the user to check that `nexus` is installed. Callers don't need a separate
error-handling path for "the CLI call itself failed" versus "the CLI ran
fine but found nothing" — both come back as ordinary result objects.

`resolveRepoRoot`/`resolveRepoRootForDir` are the one function pair that
shells out to `git` instead of `nexus` — `git rev-parse --show-toplevel`
— because they need to work *before* it's known whether `nexus init` has
even been run in this repo. They deliberately never assume a VS Code
workspace folder is the repo root: a workspace can be opened at a
subdirectory of a repo, or as a multi-root workspace, so every other
function in this extension resolves the repo root from the *file's own
location* via this pair, not from `vscode.workspace.workspaceFolders`.

## Recent changes
- Renamed every shelled-out command from `entire nexus <cmd>` to `nexus <cmd>`, and updated doc comments referencing nexus-cli's old `nexus_show.go`/`nexus_map.go`/`nexus_tour.go`/`nexus_frontmatter.go` filenames to their current `show.go`/`map.go`/`tour.go`/`frontmatter.go` (eddecb8)
- Added `resolveRepoRootForDir`, `fetchExplainerDiff`, `fetchNexusMap`/`fetchNexusTour` and their result types, for tour discovery and the diff view (8da5251)
- Initial implementation: `resolveRepoRoot`, `fetchExplainer`, and the `NexusShowResult` type mirror (b8a1a75)
