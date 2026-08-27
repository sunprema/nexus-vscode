import * as path from "path";
import * as vscode from "vscode";
import { ExplainerCodeLensProvider } from "./codeLensProvider";
import { resolveRepoRoot } from "./cliClient";
import { ExplainerContentProvider, NEXUS_EXPLAINER_SCHEME, makeExplainerUri } from "./explainerProvider";

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
    vscode.commands.registerCommand("nexus.showExplainer", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== "file") {
        vscode.window.showInformationMessage("Nexus: open a file first.");
        return;
      }

      const fileFsPath = editor.document.uri.fsPath;
      const repoRoot = await resolveRepoRoot(fileFsPath);
      if (!repoRoot) {
        vscode.window.showWarningMessage("Nexus: this file doesn't appear to be inside a git repository.");
        return;
      }

      // Git (and nexus-cli) expect forward-slash-separated relative paths
      // regardless of platform; path.relative uses the OS separator.
      const codePath = path.relative(repoRoot, fileFsPath).split(path.sep).join("/");
      await openExplainerPreview(contentProvider, makeExplainerUri(repoRoot, codePath));
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
}

async function openExplainerPreview(provider: ExplainerContentProvider, uri: vscode.Uri): Promise<void> {
  // Force a fresh read in case a stale preview from an earlier narration
  // is already open for this file.
  provider.refresh(uri);
  await vscode.commands.executeCommand("markdown.showPreviewToSide", uri);
}

export function deactivate(): void {}
