import * as vscode from "vscode";
import { NexusSource } from "./nexusSource";

export const NEXUS_EXPLAINER_SCHEME = "nexus-explainer";

/**
 * Builds the virtual URI for a code file's explainer entry. The code path
 * (plus ".md") lives in the URI path — so VS Code shows a sensible tab
 * title and treats the document as Markdown — and the repo root travels
 * as a query param, since it can't be recovered from the path alone (a
 * multi-root workspace, or a workspace opened at a subdirectory of the
 * repo, means the file's repo root isn't always derivable from context at
 * read time).
 */
export function makeExplainerUri(repoRoot: vscode.Uri, codePath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: NEXUS_EXPLAINER_SCHEME,
    path: `/${codePath}.md`,
    query: `repoRoot=${encodeURIComponent(repoRoot.toString())}`,
  });
}

function codePathFromUri(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, "").replace(/\.md$/, "");
}

/**
 * Serves explainer content as read-only virtual documents. Never resolves
 * the explainer branch itself — every request goes through the NexusSource
 * it was given, so path-mapping and branch resolution stay owned by that
 * source (nexus-cli on the desktop), not duplicated here.
 */
export class ExplainerContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly source: NexusSource) {}

  /** Call after narration may have changed a file's explainer entry, to
   * invalidate any already-open preview of it. */
  refresh(uri: vscode.Uri): void {
    this.changeEmitter.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const rawRoot = new URLSearchParams(uri.query).get("repoRoot");
    const codePath = codePathFromUri(uri);

    if (!rawRoot) {
      return `_Nexus: missing repository information for \`${codePath}\`._\n`;
    }

    const result = await this.source.show(vscode.Uri.parse(rawRoot), codePath);

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
