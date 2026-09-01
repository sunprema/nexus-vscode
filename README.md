# Nexus Explainer

A VS Code extension for [Project Nexus](../REQUIREMENTS.md)'s bicameral
Code/Explainer workflow: view the `explainer` branch's narrative for the
file you're editing, split-screen, without leaving VS Code or touching your
working tree.

## What it does today

Open any file in a repo where `nexus init` has run, and a CodeLens
appears at the top: **📖 Nexus: View Explainer**, **📖 Nexus: No explainer
yet**, or **⚠️ Nexus: View Explainer (desync flagged)** — click it, or run
**Nexus: Show Explainer** from the Command Palette / editor right-click menu
/ `Ctrl+Alt+E` / `Cmd+Alt+E`. Either way it opens a read-only Markdown
preview beside your editor showing that file's current entry from the
`explainer` branch.

There's exactly one CodeLens per file, not per function — Nexus narrates
a whole file at a time, so a per-symbol lens would have nothing distinct
to point at yet (that needs the line-mapping piece from TR4.3, not built).

Nothing is checked out or written to disk. On the desktop the extension
shells out to [`nexus show <path> --json`](../nexus-cli/internal/cli/show.go)
— the same command a script or CI job would use — which reads the
explainer branch's git objects directly. `nexus` (Project Nexus's standalone
CLI) must be installed and on `PATH`.

**In the browser** — `vscode.dev` and `github.dev`, where a repository is
mounted as a virtual filesystem and there is no process to shell out to —
the same CodeLens and preview are served by reading the explainer branch
from GitHub over HTTP instead. Nothing to install locally: open
`github.dev/<owner>/<repo>` and the narrative is there. It borrows your
existing GitHub session when you have one, so private repos work too, and
falls back to unauthenticated reads of public ones. The only thing missing
in the browser is **Nexus: Show Explainer Diff**, which needs the CLI's
history walk.

If the file hasn't been narrated yet, or Nexus isn't set up in the repo,
the CodeLens and the preview both say so instead of showing stale or
missing content silently. If Nexus isn't set up in a repo at all, no
CodeLens appears (checked once per repo root per session — run **Nexus:
Refresh Explainer Status**, or reload the window, after running
`nexus init` on an already-open repo).

## Requirements

- `nexus init` already run in the repo you're working in.
- VS Code's built-in Markdown preview (bundled by default; only matters if
  you've disabled it).
- **Desktop only:** the `nexus` CLI on `PATH`. The browser build has no CLI
  and needs none; it reads the same data from GitHub, and so works only for
  repositories hosted there.

## Installation

Grab the `.vsix` from the [latest release](https://github.com/sunprema/nexus-vscode/releases/latest)
(e.g. [`nexus-explainer-0.2.0.vsix`](https://github.com/sunprema/nexus-vscode/releases/download/v0.2.0/nexus-explainer-0.2.0.vsix)),
then either:

- In VS Code: open the Extensions view → `...` menu → **Install from
  VSIX...** → pick the downloaded file.
- Or from a terminal:
  ```bash
  code --install-extension nexus-explainer-0.2.0.vsix
  ```

No cloning or Extension Development Host required.

### Cutting a release (maintainers)

Push a tag matching `v*.*.*` (e.g. `v0.1.0`) and CI builds the VSIX and
attaches it to a GitHub Release automatically — see
`.github/workflows/release.yml`. To build one locally instead: `npm run package`.

## Development

```bash
npm install
npm run bundle    # builds both entry points; or: npm run watch
npm test          # typechecks, bundles, then runs the unit tests (Node 22+)
npm run test:web  # opens the web build in a browser-hosted VS Code
```

`esbuild.mjs` builds the two files VS Code actually loads —
`dist/extension-node.js` (`main`) and `dist/extension-web.js` (`browser`).
Bundling isn't optional for the web build: a web extension ships as a
single file with no runtime module resolution. It also enforces the split
by construction — `platform: "browser"` can't resolve `child_process`, so a
web build that ever reached `cliSource.ts` fails to build rather than
throwing on activation.

`npm run compile` (plain `tsc`) still emits to `out/` — that's what the
tests run against, and it's excluded from the packaged extension.

The tests run under plain `node --test`, not in an Extension Development
Host: `src/test/vscodeStub.ts` stands in for the `vscode` module so the
parsing and GitHub-request logic can be exercised directly. Anything that
genuinely needs the editor (CodeLens placement, the Markdown preview) is
still only verified by hand.

Press F5 in VS Code (with this folder open) to launch an Extension
Development Host with the extension loaded.

## Architecture notes

- **`src/nexusSource.ts`** — the `NexusSource` interface every provider and
  command works against ("what data does this extension need"), plus the
  result types mirroring nexus-cli's `--json` shapes. Repositories are
  identified by a `vscode.Uri`, never a filesystem path, so the same code
  can serve a local repo or a virtual one.
- **`src/githubSource.ts`** — a second implementation, reading the
  explainer branch straight from GitHub over HTTP for a VS Code with no
  subprocess and no filesystem (`vscode.dev`, `github.dev`, where a repo is
  mounted at `vscode-vfs://github/<owner>/<repo>`). It reimplements rather
  than delegates the three conventions nexus-cli owns — `<path>.md` on the
  explainer branch, the reserved `.nexus/tours/` and `.nexus/history/`
  prefixes, and frontmatter beating the desync-marker scan — so those are
  the places it must change when the CLI does. It borrows the user's
  existing GitHub session when there is one (never prompting for a new
  one), which is what lets it read private repos; without one it reads
  public repos through `raw.githubusercontent.com`, which isn't rate
  limited. It implements no `diff`.
- **`src/cliSource.ts`** — the desktop implementation of that interface:
  the only place that shells out to `git` (to resolve the repo root for the
  active file — never assume a VS Code workspace folder *is* the repo root)
  and to `nexus show`/`diff`/`map`/`tour`. It serves `file:` repositories
  only.
- **`src/explainerProvider.ts`** — a `TextDocumentContentProvider` for the
  `nexus-explainer:` URI scheme. The code path lives in the URI's path
  (with `.md` appended, so VS Code shows a sensible tab title and treats
  the content as Markdown); the resolved repo root travels as a query
  param, since it isn't always derivable from the URI alone.
- **`src/activation.ts`** — everything the extension does, given a source
  and a document selector: `activateNexus` registers the providers and
  commands and nothing else knows which host it's on. No other state.
- **`src/extensionNode.ts` / `src/extensionWeb.ts`** — the two entry
  points, each a dozen lines: the CLI source over `file:` documents, or the
  GitHub source over `vscode-vfs:` ones. `vscode-vfs` rather than `*`
  because a browser window also holds `untitled` buffers and locally opened
  folders, which are not GitHub repositories.

`NexusSource.diff` is deliberately optional: walking the explainer
branch's history is cheap for a local git repo and expensive over an API,
so a source may omit it, and the "Show Explainer Diff" command is
registered only when the active source has it.

Deliberately **not** built as a caching layer: every open re-reads through
the source. Explainer content changes only when the `narrate` skill
commits, which isn't a high-frequency event — the simplicity of "always
read fresh" outweighs any latency saved by caching, and it means a
freshly-narrated file never shows stale content from before.

## Roadmap (not yet built)

- Source Control panel integration — surface the explainer next to a
  changed file when reviewing a diff, closer to the PRD's actual reviewer
  workflow (read the explainer instead of the code diff).
- `.nexus/pending.json` awareness — the CodeLens already reflects a single
  file's desync status, but not whether `main` has moved past what's been
  narrated at all.
- Scroll-sync between code and explainer — needs the line-mapping
  ("sourcemap") piece from TR4.3, deliberately deferred so far.
- **Publishing the web build.** The VSIX is already marked
  `ExtensionKind: workspace,web`, but installing it in `vscode.dev` /
  `github.dev` means publishing to the Marketplace — a VSIX can't be
  side-loaded there. A `.vscode/extensions.json` recommendation in a
  narrated repo then turns that into a one-click prompt for visitors.
- **`nexus diff` in the browser.** It would need the commits API to walk a
  file's explainer history: two extra requests and a diff library, against
  a rate limit, for what the CLI does with two local git-object reads.
- **The virtual-workspace URI shape.** `parseGitHubRepo` accepts
  `vscode-vfs://github/<owner>/<repo>` and the `github+<id>` authority
  variant. Confirm against a real `github.dev` window before relying on
  it.
