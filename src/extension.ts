import * as path from "path";
import * as vscode from "vscode";
import { resolveRepoRoot } from "./cliClient";
import { ExplainerContentProvider, NEXUS_EXPLAINER_SCHEME, makeExplainerUri } from "./explainerProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ExplainerContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(NEXUS_EXPLAINER_SCHEME, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.showExplainer", () => showExplainer(provider))
  );
}

async function showExplainer(provider: ExplainerContentProvider): Promise<void> {
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
  const uri = makeExplainerUri(repoRoot, codePath);

  // Force a fresh read in case a stale preview from an earlier narration
  // is already open for this file.
  provider.refresh(uri);

  await vscode.commands.executeCommand("markdown.showPreviewToSide", uri);
}

export function deactivate(): void {}
