import * as vscode from "vscode";
import { fetchExplainer } from "./cliClient";

export const NEXUS_EXPLAINER_SCHEME = "nexus-explainer";

/**
 * Builds the virtual URI for a code file's explainer entry. The code path
 * (plus ".md") lives in the URI path — so VS Code shows a sensible tab
 * title and treats the document as Markdown — and repoRoot travels as a
 * query param, since it can't be recovered from the path alone (a
 * multi-root workspace, or a workspace opened at a subdirectory of the
 * repo, means the file's repo root isn't always derivable from context at
 * read time).
 */
export function makeExplainerUri(repoRoot: string, codePath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: NEXUS_EXPLAINER_SCHEME,
    path: `/${codePath}.md`,
    query: `repoRoot=${encodeURIComponent(repoRoot)}`,
  });
}

function codePathFromUri(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, "").replace(/\.md$/, "");
}

/**
 * Serves explainer content as read-only virtual documents. Never reads the
 * explainer branch's git objects itself — every request shells out to
 * `nexus show`, so path-mapping and branch resolution stay owned by
 * nexus-cli, not duplicated here.
 */
export class ExplainerContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  /** Call after narration may have changed a file's explainer entry, to
   * invalidate any already-open preview of it. */
  refresh(uri: vscode.Uri): void {
    this.changeEmitter.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const repoRoot = new URLSearchParams(uri.query).get("repoRoot");
    const codePath = codePathFromUri(uri);

    if (!repoRoot) {
      return `_Nexus: missing repository information for \`${codePath}\`._\n`;
    }

    const result = await fetchExplainer(repoRoot, codePath);

    if (result.error) {
      return `# ${codePath}\n\n> ⚠️ ${result.error}\n`;
    }

    if (!result.found) {
      return (
        `# ${codePath}\n\n` +
        "_No explainer entry yet for this file. Run the `narrate` skill in your " +
        "coding agent to create one — `nexus sync` shows what's pending._\n"
      );
    }

    return result.content;
  }
}
