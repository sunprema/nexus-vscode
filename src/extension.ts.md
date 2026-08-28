---
path: "src/extension.ts"
summary: "The extension's activation entry point: registers the CodeLens provider, the virtual explainer document provider, and every Nexus command."
source_commit: b2272078a9c925fc0f6b17bb03f902ee7b9de545
desynced: false
---

# src/extension.ts

## What this does
`activate` is what VS Code calls when the extension loads. It wires up the
two providers (`ExplainerContentProvider` for the virtual `nexus-explainer:`
documents, `ExplainerCodeLensProvider` for the per-file CodeLens) and
registers five commands: `nexus.showExplainer`, `nexus.showExplainerDiff`,
the internal `nexus.showExplainerUri`, `nexus.refreshCodeLenses`, and
`nexus.startTour`.

## How it works
`resolveCodeTarget` is the shared "which file, and which repo" resolution
used by every command that acts on a specific file: it prefers the
resource VS Code passed (from an Explorer context-menu click or a
keybinding), and falls back to the active editor for commands invoked from
the Command Palette or an editor context menu — a single fallback path so
none of the commands can disagree about which file they're acting on. The
code path itself is always forward-slash-joined regardless of platform,
since git and `nexus-cli` both expect that even on Windows, while
`path.relative` would otherwise return an OS-separated path.

`nexus.showExplainerUri` is deliberately *not* declared in `package.json`
(so it never appears in the Command Palette or any menu) — it exists only
as the `command` a CodeLens's title attaches, since the CodeLens has
already resolved the exact repo root and code path when it built itself
and shouldn't have to re-derive them from whatever the active editor
happens to be when clicked.

`openExplainerPreview` always calls `provider.refresh(uri)` right before
opening the preview, so a stale document from an earlier narration pass
never lingers on screen — every open is guaranteed to re-shell to `nexus
show` for fresh content, matching `ExplainerContentProvider`'s own
"always read fresh" design.

## Recent changes
- Added `nexus.startTour` and `nexus.showExplainerDiff`, and extracted the shared `resolveCodeTarget` resolution (previously inline in `nexus.showExplainer` alone) so every file-scoped command resolves "which file" the same way (8da5251)
- Added the CodeLens provider registration, the internal `nexus.showExplainerUri`, and `nexus.refreshCodeLenses`; extracted `openExplainerPreview` as a shared helper (5aba718)
- Initial implementation: `nexus.showExplainer` and the content-provider registration (b8a1a75)
