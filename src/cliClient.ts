import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Mirrors nexus_show.go's nexusShowResult exactly (nexus-cli's
 * `entire nexus show <path> --json`). Keep these two in sync by hand —
 * there's no shared schema between the Go and TypeScript sides.
 */
export interface NexusShowResult {
  path: string;
  explainer_path: string;
  explainer_branch: string;
  found: boolean;
  desynced: boolean;
  desync_markers?: string[];
  content: string;
  /** Set only when Nexus isn't set up here, or the explainer branch is
   * missing — distinct from an ordinary found=false (file just hasn't
   * been narrated yet). See nexus_show.go for the full contract. */
  error?: string;
}

/**
 * Resolves the git repository root for the file at fileFsPath, which may
 * differ from any VS Code workspace folder (e.g. a workspace opened at a
 * subdirectory of the repo, or a multi-root workspace). Mirrors how
 * nexus-cli itself resolves the worktree root — never assume the workspace
 * folder is the repo root.
 */
export async function resolveRepoRoot(fileFsPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path.dirname(fileFsPath),
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Shells out to `entire nexus show <codePath> --json` — this is
 * deliberately the *only* way this extension reads explainer content.
 * nexus-cli owns path-mapping and explainer-branch-name resolution; the
 * extension never reads the explainer branch's git objects itself, so it
 * can't drift from what the CLI actually does.
 */
export async function fetchExplainer(repoRoot: string, codePath: string): Promise<NexusShowResult> {
  try {
    const { stdout } = await execFileAsync("entire", ["nexus", "show", codePath, "--json"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout) as NexusShowResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: codePath,
      explainer_path: "",
      explainer_branch: "",
      found: false,
      desynced: false,
      content: "",
      error: `Couldn't run 'entire nexus show'. Is the entire CLI installed and on PATH?\n\n${message}`,
    };
  }
}
