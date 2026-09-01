import * as vscode from "vscode";
import { ExplainerCodeLensProvider } from "./codeLensProvider";
import {
  ExplainerContentProvider,
  NEXUS_EXPLAINER_SCHEME,
  makeExplainerUri,
} from "./explainerProvider";
import { NexusSource, relativeCodePath } from "./nexusSource";
import { startTour } from "./tourController";

/**
 * Everything this extension does, given somewhere to read explainer data
 * from and the documents to offer it on. The two entry points
 * (extensionNode.ts, extensionWeb.ts) differ only in those two arguments:
 * the CLI over local files, or GitHub over a virtual workspace.
 */
export function activateNexus(
  context: vscode.ExtensionContext,
  source: NexusSource,
  documentSelector: vscode.DocumentSelector
): void {
  const contentProvider = new ExplainerContentProvider(source);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(NEXUS_EXPLAINER_SCHEME, contentProvider)
  );

  const codeLensProvider = new ExplainerCodeLensProvider(source);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(documentSelector, codeLensProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.showExplainer", async (resource?: vscode.Uri) => {
      const target = await resolveCodeTarget(source, resource);
      if (!target) return;
      await openExplainerPreview(contentProvider, makeExplainerUri(target.repoRoot, target.codePath));
    })
  );

  // Registered only when the source can produce a diff: walking the
  // explainer branch's history is cheap locally and expensive over an API,
  // so NexusSource.diff is optional (see its doc comment).
  const diff = source.diff?.bind(source);
  if (diff) {
    context.subscriptions.push(
      vscode.commands.registerCommand("nexus.showExplainerDiff", async (resource?: vscode.Uri) => {
        const target = await resolveCodeTarget(source, resource);
        if (!target) return;

        const content = await diff(target.repoRoot, target.codePath);
        const doc = await vscode.workspace.openTextDocument({ content, language: "diff" });
        await vscode.window.showTextDocument(doc, { preview: true });
      })
    );
  }

  // Internal: the CodeLens already resolved the exact URI (repo root +
  // code path) when it built its title, so its click handler passes that
  // straight through instead of re-deriving it from whatever the active
  // editor happens to be at click time. Not declared in package.json —
  // it's never invoked from the Command Palette or a menu, only from a
  // CodeLens's `command`.
  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.showExplainerUri", (uri: vscode.Uri) =>
      openExplainerPreview(contentProvider, uri)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.refreshCodeLenses", () => codeLensProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.startTour", async () => {
      const repoRoot = await resolveWorkspaceRepoRoot(source);
      if (!repoRoot) {
        vscode.window.showWarningMessage("Nexus: open a file or folder inside a git repository first.");
        return;
      }
      await startTour(source, repoRoot);
    })
  );
}

interface CodeTarget {
  repoRoot: vscode.Uri;
  codePath: string;
}

/** Schemes that are never a narratable code file, whatever the source is:
 * a buffer that was never saved, and this extension's own read-only
 * explainer previews (from which "Show Explainer" would be circular). */
const NON_CODE_SCHEMES = new Set(["untitled", NEXUS_EXPLAINER_SCHEME]);

/**
 * Resolves the repo-relative code path a command should act on. Explorer's
 * context menu and the `x` keybinding pass the selected resource here; the
 * editor context menu, Command Palette, and ctrl+alt+e don't, so this falls
 * back to the active editor. Shared by every command that needs "which
 * file", so the fallback logic can't drift between them.
 *
 * Which URI schemes are actually servable is the source's call, not this
 * function's — it asks by trying to resolve a repo root.
 */
async function resolveCodeTarget(source: NexusSource, resource?: vscode.Uri): Promise<CodeTarget | undefined> {
  const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri || NON_CODE_SCHEMES.has(uri.scheme)) {
    vscode.window.showInformationMessage("Nexus: open a file first.");
    return undefined;
  }

  const repoRoot = await source.resolveRepoRoot(uri);
  if (!repoRoot) {
    vscode.window.showWarningMessage("Nexus: this file doesn't appear to be inside a git repository.");
    return undefined;
  }

  const codePath = relativeCodePath(repoRoot, uri);
  if (!codePath) {
    vscode.window.showWarningMessage("Nexus: this file isn't inside the repository it resolved to.");
    return undefined;
  }

  return { repoRoot, codePath };
}

/**
 * Resolves a repo root for a command that isn't about any one file (e.g.
 * starting a tour): the active editor's file if there is one, else the
 * first workspace folder.
 */
async function resolveWorkspaceRepoRoot(source: NexusSource): Promise<vscode.Uri | undefined> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri && !NON_CODE_SCHEMES.has(activeUri.scheme)) {
    const repoRoot = await source.resolveRepoRoot(activeUri);
    if (repoRoot) return repoRoot;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? source.resolveRepoRootForDir(folder.uri) : undefined;
}

async function openExplainerPreview(provider: ExplainerContentProvider, uri: vscode.Uri): Promise<void> {
  // Force a fresh read in case a stale preview from an earlier narration
  // is already open for this file.
  provider.refresh(uri);
  await vscode.commands.executeCommand("markdown.showPreviewToSide", uri);
}
