import * as path from "path";
import * as vscode from "vscode";
import { ExplainerCodeLensProvider } from "./codeLensProvider";
import { fetchExplainerDiff, resolveRepoRoot, resolveRepoRootForDir } from "./cliClient";
import { ExplainerContentProvider, NEXUS_EXPLAINER_SCHEME, makeExplainerUri } from "./explainerProvider";
import { startTour } from "./tourController";

export function activate(context: vscode.ExtensionContext): void {
  const contentProvider = new ExplainerContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(NEXUS_EXPLAINER_SCHEME, contentProvider)
  );

  const codeLensProvider = new ExplainerCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, codeLensProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.showExplainer", async (resource?: vscode.Uri) => {
      const target = await resolveCodeTarget(resource);
      if (!target) return;
      await openExplainerPreview(contentProvider, makeExplainerUri(target.repoRoot, target.codePath));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.showExplainerDiff", async (resource?: vscode.Uri) => {
      const target = await resolveCodeTarget(resource);
      if (!target) return;

      const diff = await fetchExplainerDiff(target.repoRoot, target.codePath);
      const doc = await vscode.workspace.openTextDocument({ content: diff, language: "diff" });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

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
      const repoRoot = await resolveWorkspaceRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage("Nexus: open a file or folder inside a git repository first.");
        return;
      }
      await startTour(repoRoot);
    })
  );
}

interface CodeTarget {
  repoRoot: string;
  codePath: string;
}

/**
 * Resolves the repo-relative code path a command should act on. Explorer's
 * context menu and the `x` keybinding pass the selected resource here; the
 * editor context menu, Command Palette, and ctrl+alt+e don't, so this falls
 * back to the active editor. Shared by every command that needs "which
 * file", so the fallback logic can't drift between them.
 */
async function resolveCodeTarget(resource?: vscode.Uri): Promise<CodeTarget | undefined> {
  const uri = resource?.scheme === "file" ? resource : vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") {
    vscode.window.showInformationMessage("Nexus: open a file first.");
    return undefined;
  }

  const fileFsPath = uri.fsPath;
  const repoRoot = await resolveRepoRoot(fileFsPath);
  if (!repoRoot) {
    vscode.window.showWarningMessage("Nexus: this file doesn't appear to be inside a git repository.");
    return undefined;
  }

  // Git (and nexus-cli) expect forward-slash-separated relative paths
  // regardless of platform; path.relative uses the OS separator.
  const codePath = path.relative(repoRoot, fileFsPath).split(path.sep).join("/");
  return { repoRoot, codePath };
}

/**
 * Resolves a repo root for a command that isn't about any one file (e.g.
 * starting a tour): the active editor's file if there is one, else the
 * first workspace folder.
 */
async function resolveWorkspaceRepoRoot(): Promise<string | undefined> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") {
    const repoRoot = await resolveRepoRoot(activeUri.fsPath);
    if (repoRoot) return repoRoot;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? resolveRepoRootForDir(folder.uri.fsPath) : undefined;
}

async function openExplainerPreview(provider: ExplainerContentProvider, uri: vscode.Uri): Promise<void> {
  // Force a fresh read in case a stale preview from an earlier narration
  // is already open for this file.
  provider.refresh(uri);
  await vscode.commands.executeCommand("markdown.showPreviewToSide", uri);
}

export function deactivate(): void {}
