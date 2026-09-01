// The stub must be installed before githubSource pulls in "vscode".
import "./vscodeStub";

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { auth, uri } from "./vscodeStub";
import {
  GitHubNexusSource,
  buildShowResult,
  buildTourResult,
  mapEntriesFromTree,
  parseFrontmatter,
  parseGitHubRepo,
} from "../githubSource";

type AnyUri = Parameters<GitHubNexusSource["show"]>[0];

const repoRoot = uri("/sunprema/nexus-cli") as unknown as AnyUri;

/** Routes fetch by URL substring; anything unrouted fails the test loudly. */
function stubFetch(routes: { match: string; status?: number; body?: string; headers?: Record<string, string> }[]) {
  (globalThis as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`unrouted fetch: ${url}`);
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: { get: (name: string) => route.headers?.[name.toLowerCase()] ?? null },
      text: async () => route.body ?? "",
      json: async () => JSON.parse(route.body ?? "{}"),
    };
  };
}

test("parseGitHubRepo recognizes virtual GitHub workspaces", () => {
  assert.deepEqual(parseGitHubRepo(uri("/owner/repo") as never), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGitHubRepo(uri("/owner/repo/src/a.go") as never), { owner: "owner", repo: "repo" });
  assert.deepEqual(
    parseGitHubRepo(uri({ authority: "github+abc123", path: "/owner/repo" }) as never),
    { owner: "owner", repo: "repo" }
  );
  assert.equal(parseGitHubRepo(uri({ scheme: "file", path: "/home/u/repo" }) as never), undefined);
  assert.equal(parseGitHubRepo(uri({ authority: "azurerepos", path: "/o/r" }) as never), undefined);
  assert.equal(parseGitHubRepo(uri("/owner") as never), undefined);
});

test("parseFrontmatter mirrors the CLI's degrade-don't-error contract", () => {
  const withFm = parseFrontmatter('---\nsummary: "hi"\ndesynced: false\n---\n# Body\n');
  assert.equal(withFm.hasFrontmatter, true);
  assert.equal(withFm.frontmatter.summary, "hi");
  assert.equal(withFm.body, "# Body\n");

  const none = parseFrontmatter("# Just a heading\n");
  assert.equal(none.hasFrontmatter, false);
  assert.equal(none.body, "# Just a heading\n");

  // Invalid YAML is not an error: the whole file becomes the body.
  const bad = parseFrontmatter("---\nsummary: [unclosed\n---\nBody\n");
  assert.equal(bad.hasFrontmatter, false);
  assert.equal(bad.body, "---\nsummary: [unclosed\n---\nBody\n");

  // The block ends at the FIRST closing delimiter, so a later '---' in the
  // body (a horizontal rule, a mermaid fence) stays in the body.
  const rule = parseFrontmatter("---\nsummary: a\n---\nBefore\n\n---\n\nAfter\n");
  assert.equal(rule.hasFrontmatter, true);
  assert.match(rule.body, /Before[\s\S]*---[\s\S]*After/);

  assert.equal(parseFrontmatter("---\r\nsummary: a\r\n---\r\nBody\r\n").frontmatter.summary, "a");
});

test("buildShowResult follows show.go's desync precedence", () => {
  const marker = "> [!WARNING]\n> **Nexus desync** — the code moved on.\n";

  // Frontmatter is authoritative when present, even against a marker line.
  const fmWins = buildShowResult("a.go", `---\nsummary: s\ndesynced: false\n---\n${marker}`);
  assert.equal(fmWins.desynced, false);
  assert.deepEqual(fmWins.desync_markers, ["> **Nexus desync** — the code moved on."]);

  assert.equal(buildShowResult("a.go", "---\ndesynced: true\n---\nBody\n").desynced, true);

  // No frontmatter: fall back to the marker scan.
  assert.equal(buildShowResult("a.go", marker).desynced, true);

  // Prose that merely mentions the marker isn't one — a real marker is a
  // whole line, which is why check.go matches on startsWith.
  const prose = buildShowResult("a.go", "Files get a `> **Nexus desync**` line when they drift.\n");
  assert.equal(prose.desynced, false);
  assert.equal(prose.desync_markers, undefined);

  const tests = buildShowResult("a_test.go", "---\ntests:\n  - name: TestFoo\n    intent: checks foo\n---\nB\n");
  assert.deepEqual(tests.tests, [{ name: "TestFoo", intent: "checks foo" }]);
  assert.equal(tests.explainer_path, "a_test.go.md");
  assert.equal(tests.found, true);
});

test("mapEntriesFromTree classifies tours, entries, and reserved paths", () => {
  const entries = mapEntriesFromTree([
    "internal/cli/show.go.md",
    ".nexus/tours/request-lifecycle.md",
    ".nexus/history/2026-01-01-incident.md",
    "cmd/nexus/main.go",
    "README.md",
  ]);

  assert.deepEqual(entries.map((e) => e.kind + ":" + e.path).sort(), [
    "explainer:README",
    "explainer:internal/cli/show.go",
    "tour:request-lifecycle",
  ]);
});

test("buildTourResult treats a stopless tour as malformed", () => {
  const good = buildTourResult(
    "tour",
    '---\ntitle: "A tour"\nstops:\n  - path: a.go\n    line: 4\n    note: here\n---\nWhy this exists.\n'
  );
  assert.equal(good.found, true);
  assert.equal(good.title, "A tour");
  assert.deepEqual(good.stops, [{ path: "a.go", line: 4, note: "here" }]);
  assert.equal(good.body, "Why this exists.");

  const stopless = buildTourResult("tour", "---\ntitle: x\n---\nBody\n");
  assert.equal(stopless.found, false);
  assert.match(stopless.error ?? "", /no stops/);
});

test("show distinguishes 'not narrated yet' from 'Nexus isn't set up here'", async () => {
  auth.session = undefined;
  const source = new GitHubNexusSource();

  stubFetch([
    { match: "/explainer/internal/cli/show.go.md", body: "---\nsummary: s\n---\n# Entry\n" },
  ]);
  const found = await source.show(repoRoot, "internal/cli/show.go");
  assert.equal(found.found, true);
  assert.equal(found.error, undefined);
  assert.match(found.content, /# Entry/);

  // Missing file, branch present: an ordinary miss, not an error.
  stubFetch([
    { match: "/explainer/missing.go.md", status: 404 },
    { match: "/branches/explainer", body: "{}" },
  ]);
  const miss = await new GitHubNexusSource().show(repoRoot, "missing.go");
  assert.equal(miss.found, false);
  assert.equal(miss.error, undefined);

  // Missing file, no branch: that IS an error, and names the fix.
  stubFetch([
    { match: "/explainer/missing.go.md", status: 404 },
    { match: "/branches/explainer", status: 404 },
  ]);
  const unset = await new GitHubNexusSource().show(repoRoot, "missing.go");
  assert.equal(unset.found, false);
  assert.match(unset.error ?? "", /nexus init/);
});

test("show reports a spent rate limit as a dated message", async () => {
  auth.session = undefined;
  stubFetch([
    {
      match: "raw.githubusercontent.com",
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" },
    },
  ]);
  const result = await new GitHubNexusSource().show(repoRoot, "a.go");
  assert.equal(result.found, false);
  assert.match(result.error ?? "", /rate limit/i);
});

test("a signed-in user reads through the contents API instead of raw", async () => {
  auth.session = { accessToken: "t0ken" };
  const seen: string[] = [];
  (globalThis as { fetch: unknown }).fetch = async (input: unknown, init?: { headers?: Record<string, string> }) => {
    seen.push(`${String(input)} auth=${init?.headers?.Authorization ?? ""}`);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      text: async () => "---\nsummary: private\n---\nBody\n",
      json: async () => ({}),
    };
  };

  const result = await new GitHubNexusSource().show(repoRoot, "a.go");
  assert.equal(result.found, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /api\.github\.com\/repos\/sunprema\/nexus-cli\/contents\/a\.go\.md\?ref=explainer/);
  assert.match(seen[0], /auth=Bearer t0ken/);
  auth.session = undefined;
});

test("map completes tours and leaves per-file entries unpopulated", async () => {
  auth.session = undefined;
  stubFetch([
    {
      match: "git/trees/explainer",
      body: JSON.stringify({
        tree: [
          { path: "internal/cli/show.go.md", type: "blob" },
          { path: ".nexus/tours/lifecycle.md", type: "blob" },
          { path: "internal", type: "tree" },
        ],
      }),
    },
    {
      match: ".nexus/tours/lifecycle.md",
      body: "---\ntitle: The lifecycle\nstops:\n  - path: a.go\n    note: one\n  - path: b.go\n    note: two\n---\n",
    },
  ]);

  const map = await new GitHubNexusSource().map(repoRoot);
  assert.equal(map.error, undefined);
  assert.equal(map.count, 2);

  const tour = map.entries.find((e) => e.kind === "tour");
  assert.equal(tour?.summary, "The lifecycle");
  assert.equal(tour?.stop_count, 2);

  const file = map.entries.find((e) => e.kind === "explainer");
  assert.equal(file?.path, "internal/cli/show.go");
  assert.equal(file?.summary, undefined);
});

test("map reports a missing explainer branch", async () => {
  auth.session = undefined;
  stubFetch([{ match: "git/trees/explainer", status: 404 }]);
  const map = await new GitHubNexusSource().map(repoRoot);
  assert.match(map.error ?? "", /No 'explainer' branch/);
});

test("a non-GitHub workspace is refused, not attempted", async () => {
  auth.session = undefined;
  (globalThis as { fetch: unknown }).fetch = async () => {
    throw new Error("should not have made a request");
  };
  const local = uri({ scheme: "file", path: "/home/u/repo" }) as unknown as AnyUri;
  const result = await new GitHubNexusSource().show(local, "a.go");
  assert.match(result.error ?? "", /isn't a GitHub repository/);
});
