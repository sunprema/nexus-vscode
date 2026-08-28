import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Mirrors nexus-cli's show.go nexusShowResult exactly (its
 * `nexus show <path> --json`). Keep these two in sync by hand —
 * there's no shared schema between the Go and TypeScript sides.
 */
export interface NexusTestIntent {
  name: string;
  intent: string;
}

export interface NexusShowResult {
  path: string;
  explainer_path: string;
  explainer_branch: string;
  found: boolean;
  desynced: boolean;
  desync_markers?: string[];
  /** Set only for a recognized test file — see frontmatter.go's
   * nexusTestIntent. One entry per test function, naming what it verifies
   * rather than restating its assertions. */
  tests?: NexusTestIntent[];
  content: string;
  /** Set only when Nexus isn't set up here, or the explainer branch is
   * missing — distinct from an ordinary found=false (file just hasn't
   * been narrated yet). See show.go for the full contract. */
  error?: string;
}

/**
 * Mirrors nexus-cli's map.go nexusMapEntry/nexusMapResult (its
 * `nexus map --json`). kind distinguishes a per-file explainer entry
 * (path is a code path) from a guided tour (path is a slug, under
 * nexus-cli's reserved .nexus/tours/ prefix on the explainer branch).
 */
export interface NexusMapEntry {
  path: string;
  kind: "explainer" | "tour";
  summary?: string;
  source_commit?: string;
  desynced: boolean;
  has_frontmatter: boolean;
  stop_count?: number;
}

export interface NexusMapResult {
  explainer_branch: string;
  count: number;
  with_summary: number;
  entries: NexusMapEntry[];
  error?: string;
}

/**
 * Mirrors nexus-cli's tour.go nexusTourStop/nexusTourResult (its
 * `nexus tour <slug> --json`).
 */
export interface NexusTourStop {
  path: string;
  line?: number;
  note: string;
}

export interface NexusTourResult {
  slug: string;
  explainer_branch: string;
  found: boolean;
  title?: string;
  stops?: NexusTourStop[];
  body?: string;
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
  return resolveRepoRootForDir(path.dirname(fileFsPath));
}

/**
 * Same as resolveRepoRoot, but for a caller that already has a directory
 * (e.g. a workspace folder) rather than a file — resolveRepoRoot's
 * path.dirname step would otherwise walk one level too far up.
 */
export async function resolveRepoRootForDir(dirFsPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dirFsPath,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Shells out to `nexus show <codePath> --json` — this is deliberately the
 * *only* way this extension reads explainer content. nexus-cli owns
 * path-mapping and explainer-branch-name resolution; the extension never
 * reads the explainer branch's git objects itself, so it can't drift from
 * what the CLI actually does.
 */
export async function fetchExplainer(repoRoot: string, codePath: string): Promise<NexusShowResult> {
  try {
    const { stdout } = await execFileAsync("nexus", ["show", codePath, "--json"], {
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
      error: `Couldn't run 'nexus show'. Is the nexus CLI installed and on PATH?\n\n${message}`,
    };
  }
}

/**
 * Shells out to `nexus diff <codePath>` — the "cheap tier" diff narrator: a
 * plain unified diff between the two most recent versions of this file's
 * explainer entry, computed entirely from what the explainer branch already
 * carries (no LLM call). Like fetchExplainer, this is the only way the
 * extension reads this data; nexus-cli resolves history walking and
 * path-mapping so the extension can't drift from it.
 */
export async function fetchExplainerDiff(repoRoot: string, codePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("nexus", ["diff", codePath], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Couldn't run 'nexus diff'. Is the nexus CLI installed and on PATH?\n\n${message}`;
  }
}

/**
 * Shells out to `nexus map --json` — the whole-branch index of explainer
 * entries and guided tours. Used to list the tours available in this repo
 * (filter entries by kind === "tour") without needing a separate "list
 * tours" CLI command.
 */
export async function fetchNexusMap(repoRoot: string): Promise<NexusMapResult> {
  try {
    const { stdout } = await execFileAsync("nexus", ["map", "--json"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout) as NexusMapResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      explainer_branch: "",
      count: 0,
      with_summary: 0,
      entries: [],
      error: `Couldn't run 'nexus map'. Is the nexus CLI installed and on PATH?\n\n${message}`,
    };
  }
}

/**
 * Shells out to `nexus tour <slug> --json` for one tour's full stop list.
 */
export async function fetchNexusTour(repoRoot: string, slug: string): Promise<NexusTourResult> {
  try {
    const { stdout } = await execFileAsync("nexus", ["tour", slug, "--json"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout) as NexusTourResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      slug,
      explainer_branch: "",
      found: false,
      error: `Couldn't run 'nexus tour'. Is the nexus CLI installed and on PATH?\n\n${message}`,
    };
  }
}
