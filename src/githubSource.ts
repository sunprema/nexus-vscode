import * as yaml from "js-yaml";
import * as vscode from "vscode";
import {
  NexusMapEntry,
  NexusMapResult,
  NexusShowResult,
  NexusSource,
  NexusTestIntent,
  NexusTourResult,
  NexusTourStop,
  nexusSettingsExist,
} from "./nexusSource";

/**
 * A NexusSource that reads the explainer branch straight from GitHub over
 * HTTP, for a VS Code with no subprocess and no filesystem to run the
 * `nexus` CLI against — vscode.dev and github.dev, where a repository is
 * mounted as a virtual filesystem.
 *
 * It therefore has to reimplement, rather than delegate, the three
 * conventions nexus-cli owns. They are hand-mirrored here (as the result
 * types in nexusSource.ts are) and every one of them is a place this file
 * must change when the CLI does:
 *
 *   1. a code file's entry lives at `<path>.md` on the explainer branch
 *      (internal/cli/show.go),
 *   2. `.nexus/tours/<slug>.md` holds guided tours and `.nexus/history/`
 *      holds history records; neither mirrors a code file (tour.go,
 *      history.go),
 *   3. YAML frontmatter carries summary/source_commit/desynced/tests, and
 *      when it is present it — not the marker scan — is the authoritative
 *      desync signal (frontmatter.go, show.go).
 *
 * The branch name is fixed rather than read from `.nexus/settings.json`,
 * matching nexus-cli: settings.json records `explainer_branch` but
 * documents it as not configurable.
 */

const EXPLAINER_BRANCH = "explainer";
const TOUR_DIR = ".nexus/tours/";
const HISTORY_DIR = ".nexus/history/";
/** check.go's nexusDesyncMarker: a real marker is always a whole line, so
 * this is matched with startsWith, never as a substring. */
const DESYNC_MARKER = "> **Nexus desync**";

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface GitHubRepo {
  owner: string;
  repo: string;
}

/**
 * Recognizes the virtual-filesystem URIs a browser-hosted VS Code mounts a
 * GitHub repository at — `vscode-vfs://github/<owner>/<repo>/...`, whose
 * authority also appears suffixed (`github+<id>`) when more than one
 * account is connected. Returns undefined for anything else, which is how
 * this source reports "not a repository I can serve" (the CLI source says
 * the same about non-`file:` URIs).
 */
export function parseGitHubRepo(uri: vscode.Uri): GitHubRepo | undefined {
  if (uri.scheme !== "vscode-vfs") return undefined;
  if (uri.authority !== "github" && !uri.authority.startsWith("github+")) return undefined;

  const [owner, repo] = uri.path.split("/").filter(Boolean);
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

/** The YAML frontmatter nexus-cli's 'narrate' skill writes, as far as this
 * extension reads it. Every field is optional: a file narrated before
 * frontmatter existed has none of them. */
interface Frontmatter {
  summary?: string;
  source_commit?: string;
  desynced?: boolean;
  tests?: NexusTestIntent[];
  title?: string;
  stops?: NexusTourStop[];
}

/**
 * Splits an explainer file into frontmatter and body, mirroring
 * frontmatter.go's parseNexusFrontmatter: content that doesn't open with a
 * `---` block, or whose block isn't valid YAML, degrades to "no
 * frontmatter, the whole file is the body" rather than erroring — most
 * often it just means the file predates frontmatter or was hand-edited.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
  hasFrontmatter: boolean;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = FRONTMATTER.exec(normalized);
  if (!match) return { frontmatter: {}, body: normalized, hasFrontmatter: false };

  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== "object") {
      return { frontmatter: {}, body: normalized, hasFrontmatter: false };
    }
    return { frontmatter: parsed as Frontmatter, body: match[2], hasFrontmatter: true };
  } catch {
    return { frontmatter: {}, body: normalized, hasFrontmatter: false };
  }
}

/** show.go's precedence: frontmatter wins when present, and the marker
 * scan is the fallback only for files narrated before it existed. */
function desyncMarkerLines(content: string): string[] {
  return content.split("\n").filter((line) => line.startsWith(DESYNC_MARKER));
}

/** Builds the `nexus show --json` shape for a file whose entry was found. */
export function buildShowResult(codePath: string, content: string): NexusShowResult {
  const { frontmatter, hasFrontmatter } = parseFrontmatter(content);
  const markers = desyncMarkerLines(content);

  return {
    path: codePath,
    explainer_path: `${codePath}.md`,
    explainer_branch: EXPLAINER_BRANCH,
    found: true,
    desynced: hasFrontmatter ? Boolean(frontmatter.desynced) : markers.length > 0,
    desync_markers: markers.length ? markers : undefined,
    tests: Array.isArray(frontmatter.tests) ? frontmatter.tests : undefined,
    content,
  };
}

/**
 * Classifies the explainer branch's `.md` blobs into map entries, the way
 * map.go's walk does: anything under the reserved tours prefix is a tour
 * (keyed by slug), history records are not entries at all, and everything
 * else is a per-file entry whose path is the code path.
 *
 * Per-file `summary`, `source_commit` and `desynced` are left unpopulated
 * — see NexusSource.map's contract. Filling them in would cost one HTTP
 * request per narrated file, and this source's only caller (the tour
 * picker) doesn't read them. Tour entries, which that caller does read,
 * are completed by fetching just the tour files.
 */
export function mapEntriesFromTree(paths: string[]): NexusMapEntry[] {
  const entries: NexusMapEntry[] = [];
  for (const path of paths) {
    if (!path.endsWith(".md") || path.startsWith(HISTORY_DIR)) continue;

    if (path.startsWith(TOUR_DIR)) {
      entries.push({
        path: path.slice(TOUR_DIR.length, -".md".length),
        kind: "tour",
        desynced: false,
        has_frontmatter: false,
      });
    } else {
      entries.push({
        path: path.slice(0, -".md".length),
        kind: "explainer",
        desynced: false,
        has_frontmatter: false,
      });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Builds the `nexus tour --json` shape from a tour file. tour.go treats a
 * frontmatter block with zero stops as "not a tour" rather than an empty
 * one, so that is reported as a malformed file, not as found.
 */
export function buildTourResult(slug: string, content: string): NexusTourResult {
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);
  const stops = Array.isArray(frontmatter.stops) ? frontmatter.stops : [];

  if (!hasFrontmatter || stops.length === 0) {
    return {
      slug,
      explainer_branch: EXPLAINER_BRANCH,
      found: false,
      error: `Tour "${slug}" is malformed: it has no stops.`,
    };
  }

  return {
    slug,
    explainer_branch: EXPLAINER_BRANCH,
    found: true,
    title: typeof frontmatter.title === "string" ? frontmatter.title : slug,
    stops,
    body: body.trim() || undefined,
  };
}

/** Thrown by the fetch layer for a response that is neither content nor a
 * plain 404, so callers can turn it into a result-level `error` string
 * instead of letting it escape as an unhandled rejection. */
class GitHubError extends Error {}

export class GitHubNexusSource implements NexusSource {
  /** One "does this repo have an explainer branch" answer per repo, which
   * is what separates "this file hasn't been narrated" from "Nexus isn't
   * set up here" — the distinction show.go's `error` field exists for.
   * Cached because it is asked on every miss. */
  private readonly branchExists = new Map<string, Promise<boolean>>();

  async resolveRepoRoot(fileUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const repo = parseGitHubRepo(fileUri);
    if (!repo) return undefined;
    return fileUri.with({ path: `/${repo.owner}/${repo.repo}`, query: "", fragment: "" });
  }

  resolveRepoRootForDir(dirUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    return this.resolveRepoRoot(dirUri);
  }

  /** Reads through VS Code's filesystem abstraction, not the API: the
   * workspace is already mounted and authenticated, so this costs no
   * request of our own. */
  isEnabled(repoRoot: vscode.Uri): Promise<boolean> {
    return nexusSettingsExist(repoRoot);
  }

  async show(repoRoot: vscode.Uri, codePath: string): Promise<NexusShowResult> {
    const empty: NexusShowResult = {
      path: codePath,
      explainer_path: `${codePath}.md`,
      explainer_branch: EXPLAINER_BRANCH,
      found: false,
      desynced: false,
      content: "",
    };

    const repo = parseGitHubRepo(repoRoot);
    if (!repo) return { ...empty, error: notAGitHubRepo(repoRoot) };

    try {
      const content = await this.readExplainerFile(repo, `${codePath}.md`);
      if (content !== undefined) return buildShowResult(codePath, content);

      // No entry — but "not narrated yet" and "Nexus isn't set up here"
      // are different answers, and only one of them is an error.
      return (await this.hasExplainerBranch(repo))
        ? empty
        : { ...empty, error: noExplainerBranch(repo) };
    } catch (err) {
      return { ...empty, error: describe(err) };
    }
  }

  async map(repoRoot: vscode.Uri): Promise<NexusMapResult> {
    const empty: NexusMapResult = {
      explainer_branch: EXPLAINER_BRANCH,
      count: 0,
      with_summary: 0,
      entries: [],
    };

    const repo = parseGitHubRepo(repoRoot);
    if (!repo) return { ...empty, error: notAGitHubRepo(repoRoot) };

    let paths: string[];
    try {
      paths = await this.listExplainerBranch(repo);
    } catch (err) {
      return { ...empty, error: describe(err) };
    }
    if (!paths.length) return { ...empty, error: noExplainerBranch(repo) };

    const entries = mapEntriesFromTree(paths);

    // Only tours are completed, and only because the tour picker shows
    // their title and stop count. See mapEntriesFromTree.
    await Promise.all(
      entries
        .filter((entry) => entry.kind === "tour")
        .map(async (entry) => {
          try {
            const content = await this.readExplainerFile(repo, `${TOUR_DIR}${entry.path}.md`);
            if (content === undefined) return;
            const { frontmatter, hasFrontmatter } = parseFrontmatter(content);
            entry.has_frontmatter = hasFrontmatter;
            entry.summary = typeof frontmatter.title === "string" ? frontmatter.title : undefined;
            entry.stop_count = Array.isArray(frontmatter.stops) ? frontmatter.stops.length : 0;
          } catch {
            // One unreadable tour shouldn't empty the picker; it just
            // shows up under its slug with no stop count.
          }
        })
    );

    return {
      explainer_branch: EXPLAINER_BRANCH,
      count: entries.length,
      with_summary: entries.filter((entry) => entry.summary).length,
      entries,
    };
  }

  async tour(repoRoot: vscode.Uri, slug: string): Promise<NexusTourResult> {
    const empty: NexusTourResult = { slug, explainer_branch: EXPLAINER_BRANCH, found: false };

    const repo = parseGitHubRepo(repoRoot);
    if (!repo) return { ...empty, error: notAGitHubRepo(repoRoot) };

    try {
      const content = await this.readExplainerFile(repo, `${TOUR_DIR}${slug}.md`);
      if (content === undefined) {
        return (await this.hasExplainerBranch(repo))
          ? empty
          : { ...empty, error: noExplainerBranch(repo) };
      }
      return buildTourResult(slug, content);
    } catch (err) {
      return { ...empty, error: describe(err) };
    }
  }

  // NexusSource.diff is deliberately not implemented: it would need the
  // commits API to walk a file's explainer history, which is rate-limited
  // and slow over HTTP for something the CLI does with two local
  // git-object reads. The command isn't registered when it's missing.

  /**
   * A file's raw content from the explainer branch, or undefined when it
   * isn't there.
   *
   * Two hosts, chosen by whether the user has a GitHub session: raw
   * .githubusercontent.com is not rate-limited but only serves public
   * repositories, while the contents API serves private ones too and
   * costs one of the (authenticated) 5,000 requests/hour. The session is
   * never created here — only borrowed if the user already has one, which
   * in github.dev they necessarily do.
   */
  private async readExplainerFile(repo: GitHubRepo, path: string): Promise<string | undefined> {
    const token = await gitHubToken();
    const encoded = path.split("/").map(encodeURIComponent).join("/");

    const url = token
      ? `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encoded}?ref=${EXPLAINER_BRANCH}`
      : `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${EXPLAINER_BRANCH}/${encoded}`;

    const response = await fetch(url, { headers: gitHubHeaders(token, "application/vnd.github.raw") });
    if (response.status === 404) return undefined;
    if (!response.ok) throw await httpError(response);
    return response.text();
  }

  /** Every path on the explainer branch, in one request — the only way to
   * list a branch, and the reason `map` costs an API call while browsing
   * files doesn't. An empty list means the branch isn't there. */
  private async listExplainerBranch(repo: GitHubRepo): Promise<string[]> {
    const token = await gitHubToken();
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${EXPLAINER_BRANCH}?recursive=1`;
    const response = await fetch(url, { headers: gitHubHeaders(token, "application/vnd.github+json") });

    if (response.status === 404) return [];
    if (!response.ok) throw await httpError(response);

    const tree = (await response.json()) as { tree?: { path?: string; type?: string }[] };
    return (tree.tree ?? [])
      .filter((node) => node.type === "blob" && typeof node.path === "string")
      .map((node) => node.path as string);
  }

  private hasExplainerBranch(repo: GitHubRepo): Promise<boolean> {
    const key = `${repo.owner}/${repo.repo}`;
    let cached = this.branchExists.get(key);
    if (!cached) {
      cached = this.fetchBranchExists(repo);
      this.branchExists.set(key, cached);
    }
    return cached;
  }

  private async fetchBranchExists(repo: GitHubRepo): Promise<boolean> {
    const token = await gitHubToken();
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/branches/${EXPLAINER_BRANCH}`;
    const response = await fetch(url, { headers: gitHubHeaders(token, "application/vnd.github+json") });
    if (response.status === 404) return false;
    if (!response.ok) throw await httpError(response);
    return true;
  }
}

/** The user's existing GitHub session, if any. Never prompts: a missing
 * session just means public-only reads, which is the right default for a
 * read-only extension. */
async function gitHubToken(): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: false });
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

function gitHubHeaders(token: string | undefined, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function httpError(response: Response): Promise<GitHubError> {
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const when = reset ? new Date(reset * 1000).toLocaleTimeString() : "shortly";
      return new GitHubError(
        `GitHub's API rate limit is used up; it resets at ${when}. ` +
          "Signing in to GitHub in this window raises the limit considerably."
      );
    }
  }
  return new GitHubError(`GitHub answered ${response.status} ${response.statusText}.`);
}

function noExplainerBranch(repo: GitHubRepo): string {
  return (
    `No '${EXPLAINER_BRANCH}' branch in ${repo.owner}/${repo.repo}, so there is nothing to read. ` +
    "A repo gets one by running 'nexus init' and narrating a commit."
  );
}

function notAGitHubRepo(repoRoot: vscode.Uri): string {
  return `Nexus can't read ${repoRoot.toString()} over GitHub — it isn't a GitHub repository.`;
}

function describe(err: unknown): string {
  if (err instanceof GitHubError) return err.message;
  const message = err instanceof Error ? err.message : String(err);
  return `Couldn't reach GitHub.\n\n${message}`;
}
