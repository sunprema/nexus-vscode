import * as vscode from "vscode";

/**
 * The seam between "what Nexus data does this extension need" and "where
 * does that data come from". Every provider and command in this extension
 * works against this interface, never against a concrete source, so the
 * same UI can be backed by the `nexus` CLI on the desktop or by GitHub's
 * API in a browser-hosted VS Code (vscode.dev / github.dev), where there
 * is no process to shell out to and no filesystem to read.
 *
 * The result shapes below mirror nexus-cli's `--json` output exactly.
 * Keep them in sync with the Go side by hand — there's no shared schema.
 */

/** Mirrors nexus-cli's frontmatter.go nexusTestIntent. */
export interface NexusTestIntent {
  name: string;
  intent: string;
}

/** Mirrors nexus-cli's show.go nexusShowResult (`nexus show <path> --json`). */
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
 * Mirrors nexus-cli's map.go nexusMapEntry/nexusMapResult (`nexus map
 * --json`). kind distinguishes a per-file explainer entry (path is a code
 * path) from a guided tour (path is a slug, under nexus-cli's reserved
 * .nexus/tours/ prefix on the explainer branch).
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

/** Mirrors nexus-cli's tour.go nexusTourStop/nexusTourResult. */
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
 * Where explainer data comes from. Repositories are identified by a
 * `vscode.Uri`, never a filesystem path: a browser-hosted workspace has
 * no filesystem, and even on the desktop a Uri can't be silently misused
 * as one.
 *
 * Implementations report every "normal" outcome — Nexus not set up, no
 * entry yet, no such tour — through the result types' own `error` /
 * `found` fields, exactly as nexus-cli does, and reserve thrown errors
 * for genuine faults.
 */
export interface NexusSource {
  /**
   * The repository root containing fileUri, or undefined when it isn't in
   * one this source can serve. Never assume a workspace folder *is* the
   * repo root — a workspace can be opened at a subdirectory.
   */
  resolveRepoRoot(fileUri: vscode.Uri): Promise<vscode.Uri | undefined>;

  /** Same, for a caller that already has a directory (e.g. a workspace
   * folder) rather than a file inside one. */
  resolveRepoRootForDir(dirUri: vscode.Uri): Promise<vscode.Uri | undefined>;

  /** Whether Nexus is set up in this repo at all. */
  isEnabled(repoRoot: vscode.Uri): Promise<boolean>;

  /** One code file's current explainer entry. */
  show(repoRoot: vscode.Uri, codePath: string): Promise<NexusShowResult>;

  /**
   * The whole-branch index of explainer entries and guided tours.
   *
   * `path` and `kind` are always populated. The per-entry detail fields
   * (`summary`, `source_commit`, `desynced`, `has_frontmatter`,
   * `stop_count`) are best-effort: a source that would need one request
   * per narrated file to fill them in may leave them empty rather than
   * make hundreds of them. Treat an absent summary as "unknown", not as
   * "this file has none".
   */
  map(repoRoot: vscode.Uri): Promise<NexusMapResult>;

  /** One guided tour's ordered stops. */
  tour(repoRoot: vscode.Uri, slug: string): Promise<NexusTourResult>;

  /**
   * A unified diff of a file's last two narrated versions, as plain text.
   * Optional: a source that can't compute one omits it, and the command
   * that needs it is not registered. Walking the explainer branch's
   * history is cheap for a local git repo and expensive over an API, so
   * this is the one capability a source is allowed not to have.
   */
  diff?(repoRoot: vscode.Uri, codePath: string): Promise<string>;
}

/**
 * The repo-relative, forward-slash-separated path git and nexus-cli
 * expect, or undefined when fileUri isn't under repoRoot.
 *
 * Compares Uri *paths* rather than filesystem paths so this works for any
 * scheme. The case-insensitive retry covers Windows, where the drive
 * letter's case can differ between what git reports and what VS Code
 * hands us; it deliberately doesn't depend on a platform check, since
 * `process` doesn't exist in a browser-hosted extension host.
 */
export function relativeCodePath(repoRoot: vscode.Uri, fileUri: vscode.Uri): string | undefined {
  const root = repoRoot.path.replace(/\/+$/, "");
  const file = fileUri.path;
  const prefix = root + "/";

  if (file.startsWith(prefix)) return file.slice(prefix.length);
  if (file.toLowerCase().startsWith(prefix.toLowerCase())) return file.slice(prefix.length);
  return undefined;
}

/**
 * Whether `.nexus/settings.json` exists in this repo — the same "is Nexus
 * set up here" check nexus-cli makes, done through VS Code's filesystem
 * abstraction so it works for a virtual workspace as well as a local one.
 */
export async function nexusSettingsExist(repoRoot: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(repoRoot, ".nexus", "settings.json"));
    return true;
  } catch {
    return false;
  }
}
