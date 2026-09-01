import * as vscode from "vscode";
import { makeExplainerUri } from "./explainerProvider";
import { NexusSource, relativeCodePath } from "./nexusSource";

/**
 * A CodeLens carrying the repo root and code path it was created for, so
 * resolveCodeLens doesn't need the original document to know what to look
 * up. Nexus narrates a whole file at a time, so there's exactly one of
 * these per document, anchored at line 0 — the per-*function* granularity
 * for test files is TestIntentCodeLens below, not this class.
 */
class ExplainerCodeLens extends vscode.CodeLens {
  constructor(range: vscode.Range, readonly repoRoot: vscode.Uri, readonly codePath: string) {
    super(range);
  }
}

/**
 * One test function's intent, shown as a CodeLens on the line where that
 * test is (textually) found — see findTestLine. Unlike ExplainerCodeLens,
 * this is fully resolved up front (command + title set in the
 * constructor): its position AND its content both come from the same
 * `show` call, so there's no separate cheaper "just show a placeholder"
 * phase to defer work to.
 */
class TestIntentCodeLens extends vscode.CodeLens {
  constructor(range: vscode.Range, explainerUri: vscode.Uri, intent: string) {
    super(range, {
      title: `$(beaker) Nexus: ${truncate(intent, 100)}`,
      command: "nexus.showExplainerUri",
      arguments: [explainerUri],
    });
  }
}

type NexusCodeLens = ExplainerCodeLens | TestIntentCodeLens;

/** Same naming conventions nexus-cli's default .nexusignore and the
 * 'narrate' skill use to recognize a test file — kept in sync by hand,
 * same as the rest of this file's schema mirroring. */
const TEST_FILE_PATTERNS: RegExp[] = [
  /_test\.go$/,
  /\.test\.[jt]sx?$/,
  /_test\.py$/,
  /(^|\/)test_[^/]+\.py$/,
  /_spec\.rb$/,
  /\.spec\.[jt]s$/,
  /(^|\/)(test|tests|__tests__|spec)\//,
];

function looksLikeTestFile(codePath: string): boolean {
  return TEST_FILE_PATTERNS.some((re) => re.test(codePath));
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** Cache key for "which repo is this file in": the file's parent
 * directory, as a string, for any URI scheme. */
function directoryKey(uri: vscode.Uri): string {
  const key = uri.toString();
  return key.slice(0, key.lastIndexOf("/"));
}

/**
 * Shows a CodeLens at the top of any file inside a Nexus-enabled repo,
 * resolving to the file's explainer status (found / not yet narrated /
 * desync flagged) on demand — plus, for a recognized test file, one more
 * CodeLens per test function carrying that test's intent (see
 * TestIntentCodeLens).
 *
 * Three things are cached per session, not invalidated automatically: the
 * repo root for a given directory (a file's repo doesn't change mid-
 * session), whether Nexus is set up at a given repo root (checked once via
 * .nexus/settings.json's presence), and — unlike those two — a test file's
 * resolved test-intent lenses, keyed by document version rather than
 * forever: unlike the top-of-file lens (position fixed at line 0, so only
 * its *title* needs re-resolving, lazily, in resolveCodeLens), a test
 * lens's *position* depends on the file's current text, so the whole
 * lookup has to happen up front in provideCodeLenses and is worth
 * memoizing per edit rather than re-querying the source for an unchanged
 * buffer. Running `nexus init` on an already-open repo won't make lenses
 * appear on its own — run "Nexus: Refresh Explainer Status" (which clears
 * all three caches; see refresh()), or reload the window. The top lens's
 * own found/desynced status is never cached: resolveCodeLens always
 * re-queries the source, matching ExplainerContentProvider's "always read
 * fresh" choice, since that call is cheap (a git-object read, no LLM).
 */
export class ExplainerCodeLensProvider implements vscode.CodeLensProvider<NexusCodeLens> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  private readonly repoRootCache = new Map<string, Promise<vscode.Uri | undefined>>();
  private readonly nexusEnabledCache = new Map<string, Promise<boolean>>();
  private readonly testIntentCache = new Map<string, { version: number; lenses: TestIntentCodeLens[] }>();

  constructor(private readonly source: NexusSource) {}

  /** Clears every cache and forces every visible editor to re-request its
   * CodeLenses. This is what "Nexus: Refresh Explainer Status" calls — the
   * intended fix for "I just ran `nexus init` and no CodeLens
   * appeared", or "I just narrated and the test intents are stale". */
  refresh(): void {
    this.repoRootCache.clear();
    this.nexusEnabledCache.clear();
    this.testIntentCache.clear();
    this.changeEmitter.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<NexusCodeLens[]> {
    const repoRoot = await this.getRepoRoot(document.uri);
    if (!repoRoot || !(await this.isNexusEnabled(repoRoot))) {
      return [];
    }

    const codePath = relativeCodePath(repoRoot, document.uri);
    if (!codePath) {
      return [];
    }

    const lenses: NexusCodeLens[] = [new ExplainerCodeLens(new vscode.Range(0, 0, 0, 0), repoRoot, codePath)];

    if (looksLikeTestFile(codePath)) {
      lenses.push(...(await this.getTestIntentLenses(repoRoot, codePath, document)));
    }

    return lenses;
  }

  async resolveCodeLens(codeLens: NexusCodeLens, _token: vscode.CancellationToken): Promise<NexusCodeLens> {
    if (!(codeLens instanceof ExplainerCodeLens)) {
      // TestIntentCodeLens is fully resolved at construction time; VS Code
      // shouldn't call resolveCodeLens for a lens that already has a
      // command, but return it unchanged rather than assume that.
      return codeLens;
    }

    const result = await this.source.show(codeLens.repoRoot, codeLens.codePath);
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

  private getRepoRoot(fileUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const key = directoryKey(fileUri);
    let cached = this.repoRootCache.get(key);
    if (!cached) {
      cached = this.source.resolveRepoRoot(fileUri);
      this.repoRootCache.set(key, cached);
    }
    return cached;
  }

  private isNexusEnabled(repoRoot: vscode.Uri): Promise<boolean> {
    const key = repoRoot.toString();
    let cached = this.nexusEnabledCache.get(key);
    if (!cached) {
      cached = this.source.isEnabled(repoRoot);
      this.nexusEnabledCache.set(key, cached);
    }
    return cached;
  }

  /** Fetches the file's explainer entry, matches each `tests` entry to a
   * line by searching the document's own text, and caches the result by
   * document version — see the class doc comment for why this one caches
   * differently from the other two. */
  private async getTestIntentLenses(
    repoRoot: vscode.Uri,
    codePath: string,
    document: vscode.TextDocument
  ): Promise<TestIntentCodeLens[]> {
    const key = document.uri.toString();
    const cached = this.testIntentCache.get(key);
    if (cached && cached.version === document.version) {
      return cached.lenses;
    }

    const result = await this.source.show(repoRoot, codePath);
    const explainerUri = makeExplainerUri(repoRoot, codePath);
    const text = document.getText();

    const lenses: TestIntentCodeLens[] = [];
    for (const test of result.tests ?? []) {
      const line = findTestLine(text, test.name, document);
      if (line === undefined) continue; // Stale — renamed/removed since narration; say nothing rather than guess.
      lenses.push(new TestIntentCodeLens(new vscode.Range(line, 0, line, 0), explainerUri, test.intent));
    }

    this.testIntentCache.set(key, { version: document.version, lenses });
    return lenses;
  }
}

/**
 * Finds the line where a test's own name (a function identifier, or a
 * quoted description passed to it()/test()) first appears verbatim in the
 * document — deliberately not language-aware parsing: a plain literal
 * search works whether the source names the test as `func TestFoo(...)`,
 * `def test_foo(...)`, or `it("does the thing", ...)`, without a
 * per-language regex matrix to maintain. Returns undefined if the name
 * isn't found at all.
 */
function findTestLine(text: string, name: string, document: vscode.TextDocument): number | undefined {
  const idx = text.indexOf(name);
  return idx < 0 ? undefined : document.positionAt(idx).line;
}
