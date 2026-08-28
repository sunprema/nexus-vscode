---
path: "src/codeLensProvider.ts"
summary: "Shows a CodeLens at the top of every file in a Nexus-enabled repo, plus one per test function in a recognized test file, naming what each test verifies."
source_commit: b2272078a9c925fc0f6b17bb03f902ee7b9de545
desynced: false
---

# src/codeLensProvider.ts

## What this does
`ExplainerCodeLensProvider` is what makes **📖 Nexus: View Explainer** (or
**No explainer yet** / **desync flagged**) appear at the top of any file in
a repo where Nexus is set up. For a file whose path matches a common
test-naming convention, it adds one further CodeLens per test function,
each showing that test's `intent` from the explainer's frontmatter — a
one-line summary of what the test actually verifies, positioned on the
line where that test's name is textually found in the document.

## How it works
There are two distinct CodeLens types, `ExplainerCodeLens` and
`TestIntentCodeLens`, because they resolve completely differently.
`ExplainerCodeLens` is created cheap and unresolved (just a repo root and
code path, anchored at line 0); its actual title only gets fetched lazily
in `resolveCodeLens`, when VS Code decides it's actually going to render
it. `TestIntentCodeLens` has no separate resolve step at all — its title
and command are set at construction time in `provideCodeLenses`, because
both its *position* (which line) and its *content* (the intent text) come
from the same `nexus show` call, so there's nothing cheaper to defer.

Three things are cached per session, and each invalidates differently. The
repo-root-per-directory cache and the Nexus-enabled-per-repo-root cache
never expire on their own — a file's repo doesn't change mid-session, and
neither does whether Nexus is set up there — so both are cleared only by
`refresh()` (wired to the "Nexus: Refresh Explainer Status" command). The
test-intent lens cache is different: it's keyed by the document's own
`version` number, since a test lens's *position* (not just its title)
depends on the file's current text — an edit invalidates it automatically
without needing `refresh()`. The top-of-file lens's found/desynced status
is never cached at all: `resolveCodeLens` always re-shells to `nexus
show`, since that call is cheap (a git-object read, no LLM) and the
alternative — a stale desync flag — would be actively misleading.

`findTestLine` locates a test by a plain literal text search for its name
rather than any language-aware parsing, so the same logic works whether a
test is named `func TestFoo(...)`, `def test_foo(...)`, or
`it("does the thing", ...)` without a per-language regex matrix. A test
whose name no longer appears in the document (renamed or removed since
the last narration) is simply skipped — the lens says nothing about it
rather than guessing a wrong line.

## Recent changes
- Renamed the `entire nexus init`/`entire nexus show` references in this file's doc comments to `nexus init`/`nexus show` (eddecb8)
- Added per-test-function CodeLenses (`TestIntentCodeLens`, `looksLikeTestFile`, `findTestLine`) and the document-version-keyed cache for them (8da5251)
- Initial implementation: the top-of-file `ExplainerCodeLens` with lazy resolution and the repo-root/Nexus-enabled caches (5aba718)
