/**
 * Builds the two entry points VS Code loads: `main` for the desktop
 * extension host (Node) and `browser` for the web one (a web worker, in
 * vscode.dev and github.dev).
 *
 * Bundling isn't optional for the web build — a web extension has to ship
 * as a single file, with no module resolution at runtime — and it's what
 * inlines js-yaml, so nothing has to be hand-listed in .vscodeignore.
 *
 * It also enforces the split by construction: `platform: "browser"` can't
 * resolve `child_process`, so if the web entry ever reaches cliSource.ts,
 * however indirectly, this build fails instead of shipping something that
 * throws on activation.
 */
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  format: "cjs",
  target: "es2022",
  // vscode is provided by the extension host, never bundled.
  external: ["vscode"],
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
};

const builds = [
  {
    ...shared,
    entryPoints: ["src/extensionNode.ts"],
    outfile: "dist/extension-node.js",
    platform: "node",
  },
  {
    ...shared,
    entryPoints: ["src/extensionWeb.ts"],
    outfile: "dist/extension-web.js",
    platform: "browser",
    // js-yaml's browser build is picked up through this condition; the
    // Node one reaches for `process` and `Buffer`, which a web worker in
    // the extension host doesn't have.
    conditions: ["browser"],
  },
];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
