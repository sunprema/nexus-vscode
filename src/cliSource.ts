import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  NexusMapResult,
  NexusShowResult,
  NexusSource,
  NexusTourResult,
  nexusSettingsExist,
} from "./nexusSource";

const execFileAsync = promisify(execFile);

/**
 * The desktop NexusSource: shells out to the `nexus` CLI on PATH.
 *
 * This is deliberately the *only* place that reads explainer data by
 * running a process, and it never reads the explainer branch's git
 * objects itself — nexus-cli owns path-mapping and explainer-branch-name
 * resolution, so the extension can't drift from what the CLI actually
 * does. It only serves `file:` repositories: a virtual workspace
 * (vscode.dev, github.dev) has no filesystem for a subprocess to run
 * against, and resolveRepoRoot reports that by returning undefined rather
 * than failing later with a confusing git error.
 */
export class CliNexusSource implements NexusSource {
  async resolveRepoRoot(fileUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (fileUri.scheme !== "file") return undefined;
    return this.gitToplevel(path.dirname(fileUri.fsPath));
  }

  async resolveRepoRootForDir(dirUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (dirUri.scheme !== "file") return undefined;
    return this.gitToplevel(dirUri.fsPath);
  }

  isEnabled(repoRoot: vscode.Uri): Promise<boolean> {
    return nexusSettingsExist(repoRoot);
  }

  /**
   * `nexus show <codePath> --json`. A failure to run the CLI at all is
   * reported as an ordinary result with `error` set — the same channel
   * nexus-cli uses for "Nexus isn't set up here" — so every caller has
   * one thing to check instead of two.
   */
  async show(repoRoot: vscode.Uri, codePath: string): Promise<NexusShowResult> {
    try {
      return await this.json<NexusShowResult>(repoRoot, ["show", codePath, "--json"]);
    } catch (err) {
      return {
        path: codePath,
        explainer_path: "",
        explainer_branch: "",
        found: false,
        desynced: false,
        content: "",
        error: cliUnavailable("nexus show", err),
      };
    }
  }

  /** `nexus map --json` — used to list a repo's tours (filter entries by
   * kind === "tour") without needing a separate "list tours" command. */
  async map(repoRoot: vscode.Uri): Promise<NexusMapResult> {
    try {
      return await this.json<NexusMapResult>(repoRoot, ["map", "--json"]);
    } catch (err) {
      return {
        explainer_branch: "",
        count: 0,
        with_summary: 0,
        entries: [],
        error: cliUnavailable("nexus map", err),
      };
    }
  }

  /** `nexus tour <slug> --json`. */
  async tour(repoRoot: vscode.Uri, slug: string): Promise<NexusTourResult> {
    try {
      return await this.json<NexusTourResult>(repoRoot, ["tour", slug, "--json"]);
    } catch (err) {
      return {
        slug,
        explainer_branch: "",
        found: false,
        error: cliUnavailable("nexus tour", err),
      };
    }
  }

  /**
   * `nexus diff <codePath>` — the "cheap tier" diff narrator: a plain
   * unified diff between the two most recent versions of this file's
   * explainer entry, computed entirely from what the explainer branch
   * already carries (no LLM call). Returns the CLI's plain-text output,
   * or the same "couldn't run it" message the other commands report.
   */
  async diff(repoRoot: vscode.Uri, codePath: string): Promise<string> {
    try {
      const { stdout } = await this.run(repoRoot, ["diff", codePath]);
      return stdout;
    } catch (err) {
      return cliUnavailable("nexus diff", err);
    }
  }

  private async gitToplevel(cwd: string): Promise<vscode.Uri | undefined> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
      return vscode.Uri.file(stdout.trim());
    } catch {
      return undefined;
    }
  }

  private async json<T>(repoRoot: vscode.Uri, args: string[]): Promise<T> {
    const { stdout } = await this.run(repoRoot, args);
    return JSON.parse(stdout) as T;
  }

  private run(repoRoot: vscode.Uri, args: string[]) {
    return execFileAsync("nexus", args, {
      cwd: repoRoot.fsPath,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}

function cliUnavailable(command: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Couldn't run '${command}'. Is the nexus CLI installed and on PATH?\n\n${message}`;
}
