import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { fetchExplainer, resolveRepoRoot } from "./cliClient";
import { makeExplainerUri } from "./explainerProvider";

/**
 * A CodeLens carrying the repo root and code path it was created for, so
 * resolveCodeLens doesn't need the original document to know what to look
 * up. Nexus narrates a whole file at a time (there's no per-function
 * granularity in the explainer branch — that needs the line-mapping piece
 * from TR4.3, not built yet), so there's exactly one of these per document,
 * anchored at line 0.
 */
class ExplainerCodeLens extends vscode.CodeLens {
  constructor(range: vscode.Range, readonly repoRoot: string, readonly codePath: string) {
    super(range);
  }
}

/**
 * Shows a single CodeLens at the top of any file inside a Nexus-enabled
 * repo, resolving to the file's explainer status (found / not yet narrated
 * / desync flagged) on demand.
 *
 * Two things are cached per session, not invalidated automatically: the
 * repo root for a given directory (a file's repo doesn't change mid-
 * session) and whether Nexus is set up at a given repo root (checked once
 * via .nexus/settings.json's presence). Running `entire nexus init` on an
 * already-open repo won't make lenses appear on its own — run "Nexus:
 * Refresh Explainer Status" (which clears both caches; see refresh()), or
 * reload the window. The actual per-file status (found/desynced) is never
 * cached: resolveCodeLens always re-shells to `entire nexus show`,
 * matching ExplainerContentProvider's "always read
 * fresh" choice, since that call is cheap (a git-object read, no LLM).
 */
export class ExplainerCodeLensProvider implements vscode.CodeLensProvider<ExplainerCodeLens> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  private readonly repoRootCache = new Map<string, Promise<string | undefined>>();
  private readonly nexusEnabledCache = new Map<string, boolean>();

  /** Clears the repo-root/nexus-enabled caches and forces every visible
   * editor to re-request its CodeLenses. This is what "Nexus: Refresh
   * Explainer Status" calls — the intended fix for "I just ran
   * `entire nexus init` and no CodeLens appeared". Per-file found/desynced
   * status is never cached in the first place, so there's nothing to clear
   * for that part. */
  refresh(): void {
    this.repoRootCache.clear();
    this.nexusEnabledCache.clear();
    this.changeEmitter.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<ExplainerCodeLens[]> {
    if (document.uri.scheme !== "file") {
      return [];
    }

    const repoRoot = await this.getRepoRoot(document.uri.fsPath);
    if (!repoRoot || !this.isNexusEnabled(repoRoot)) {
      return [];
    }

    const codePath = path.relative(repoRoot, document.uri.fsPath).split(path.sep).join("/");
    return [new ExplainerCodeLens(new vscode.Range(0, 0, 0, 0), repoRoot, codePath)];
  }

  async resolveCodeLens(
    codeLens: ExplainerCodeLens,
    _token: vscode.CancellationToken
  ): Promise<ExplainerCodeLens> {
    const result = await fetchExplainer(codeLens.repoRoot, codeLens.codePath);
    const uri = makeExplainerUri(codeLens.repoRoot, codeLens.codePath);

    let title: string;
    if (result.error) {
      title = "$(warning) Nexus: unavailable";
    } else if (result.desynced) {
      title = "$(warning) Nexus: View Explainer (desync flagged)";
    } else if (result.found) {
      title = "$(book) Nexus: View Explainer";
    } else {
      title = "$(book) Nexus: No explainer yet";
    }

    codeLens.command = {
      title,
      command: "nexus.showExplainerUri",
      arguments: [uri],
    };
    return codeLens;
  }

  private getRepoRoot(fileFsPath: string): Promise<string | undefined> {
    const dir = path.dirname(fileFsPath);
    let cached = this.repoRootCache.get(dir);
    if (!cached) {
      cached = resolveRepoRoot(fileFsPath);
      this.repoRootCache.set(dir, cached);
    }
    return cached;
  }

  private isNexusEnabled(repoRoot: string): boolean {
    let enabled = this.nexusEnabledCache.get(repoRoot);
    if (enabled === undefined) {
      enabled = fs.existsSync(path.join(repoRoot, ".nexus", "settings.json"));
      this.nexusEnabledCache.set(repoRoot, enabled);
    }
    return enabled;
  }
}
