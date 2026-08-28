---
path: "src/explainerProvider.ts"
summary: "Serves a code file's explainer entry as a read-only virtual Markdown document, always freshly re-fetched from nexus-cli."
source_commit: b2272078a9c925fc0f6b17bb03f902ee7b9de545
desynced: false
---

# src/explainerProvider.ts

## What this does
`ExplainerContentProvider` implements VS Code's
`TextDocumentContentProvider` for the `nexus-explainer:` URI scheme,
serving a code file's current explainer entry as read-only Markdown for
the split-view preview. `makeExplainerUri` builds that URI: the code path
plus `.md` lives in the URI's path component, so VS Code shows a sensible
tab title and treats the content as Markdown, while the resolved repo
root travels as a query parameter, since it isn't always derivable from
the path alone — a multi-root workspace, or one opened at a subdirectory
of the repo, means the repo root has to be resolved at click time, not
recoverable later from the URI's path.

## How it works
Nothing here reads the `explainer` git branch directly. Every request goes
through `fetchExplainer` (in `cliClient.ts`), which shells out to `nexus
show --json` — the same command a script or CI job would use — so
path-mapping and branch-name resolution live in exactly one place and
can't drift between this extension and the CLI. Three outcomes are
handled explicitly: a resolution error (missing repo info, or `nexus show`
itself failing) renders as a warning callout; "not found yet" renders a
message pointing at the `narrate` skill and `nexus sync`; otherwise the
explainer's actual Markdown content is returned unchanged. `refresh(uri)`
exists purely so a caller (currently `extension.ts`'s
`openExplainerPreview`) can force VS Code to re-request the content for an
already-open preview — the provider itself never caches anything, so every
open is already a fresh `nexus show` call regardless.

## Recent changes
- Renamed the `entire nexus show`/`entire nexus sync` references in doc comments and the "not found" message to `nexus show`/`nexus sync` (eddecb8)
- Initial implementation (b8a1a75)
