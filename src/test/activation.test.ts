// The stub must be installed before the bundles require "vscode".
import "./vscodeStub";

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { registry } from "./vscodeStub";

/**
 * Activates the built bundles — the actual files VS Code loads — against
 * the stub, so "does the web build register the right things, and nothing
 * that needs Node" is checked by the test suite rather than by opening
 * github.dev and hoping. `npm test` builds them first.
 */
const dist = path.resolve(__dirname, "..", "..", "dist");

function activateBundle(file: string): { subscriptions: unknown[] } {
  registry.reset();
  const context = { subscriptions: [] as unknown[] };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bundle = require(path.join(dist, file)) as { activate(ctx: unknown): void };
  bundle.activate(context);
  return context;
}

test("the desktop bundle wires the CLI source to local files", () => {
  const context = activateBundle("extension-node.js");

  assert.deepEqual(registry.codeLensSelectors, [{ scheme: "file" }]);
  assert.deepEqual(registry.contentProviderSchemes, ["nexus-explainer"]);
  assert.deepEqual(registry.commands.sort(), [
    "nexus.refreshCodeLenses",
    "nexus.showExplainer",
    "nexus.showExplainerDiff",
    "nexus.showExplainerUri",
    "nexus.startTour",
  ]);
  assert.equal(context.subscriptions.length, 7);
});

test("the web bundle wires the GitHub source to virtual workspaces", () => {
  activateBundle("extension-web.js");

  assert.deepEqual(registry.codeLensSelectors, [{ scheme: "vscode-vfs" }]);
  assert.deepEqual(registry.contentProviderSchemes, ["nexus-explainer"]);

  // No diff command: GitHubNexusSource implements no diff, and package.json
  // hides the palette entry with `!isWeb` to match.
  assert.deepEqual(registry.commands.sort(), [
    "nexus.refreshCodeLenses",
    "nexus.showExplainer",
    "nexus.showExplainerUri",
    "nexus.startTour",
  ]);
});

test("the web bundle pulls in no Node built-ins", () => {
  const source = fs.readFileSync(path.join(dist, "extension-web.js"), "utf8");
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);

  assert.deepEqual([...new Set(required)], ["vscode"]);
  for (const forbidden of ["child_process", "node:child_process", "Buffer", "process.platform"]) {
    assert.equal(source.includes(forbidden), false, `web bundle references ${forbidden}`);
  }
});
