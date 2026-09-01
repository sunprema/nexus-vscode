/**
 * Makes `require("vscode")` resolve to a stub, so the pure parts of this
 * extension can be tested with plain `node --test` instead of a full
 * Extension Development Host. Importing this module installs the stub as a
 * side effect, so it must be imported *before* anything that pulls in
 * "vscode" — TypeScript emits requires in source order, so import order in
 * the test file is what enforces that.
 *
 * The stub is deliberately tiny: it only needs to satisfy the module-load
 * of the files under test and whatever those tests actually call. Anything
 * a test doesn't stub throws, rather than silently returning undefined.
 */
import Module = require("module");

export interface AuthSession {
  accessToken: string;
}

/** Set by a test to control what `authentication.getSession` returns. */
export const auth: { session?: AuthSession } = {};

const stub = {
  authentication: {
    getSession: async () => auth.session,
  },
  workspace: {
    fs: {
      stat: async () => {
        throw new Error("vscodeStub: workspace.fs.stat is not stubbed for this test");
      },
    },
  },
  Uri: {
    parse: (value: string) => uri(value),
  },
  EventEmitter: class {
    event = () => undefined;
    fire() {}
  },
};

/** A stand-in for vscode.Uri carrying only what the code under test reads.
 * Not a parser — tests pass the parts explicitly. */
export function uri(parts: { scheme?: string; authority?: string; path?: string } | string): {
  scheme: string;
  authority: string;
  path: string;
  toString(): string;
  with(change: { path?: string; query?: string; fragment?: string }): unknown;
} {
  const value =
    typeof parts === "string" ? { scheme: "vscode-vfs", authority: "github", path: parts } : parts;
  const self = {
    scheme: value.scheme ?? "vscode-vfs",
    authority: value.authority ?? "github",
    path: value.path ?? "/",
    toString: () => `${self.scheme}://${self.authority}${self.path}`,
    with: (change: { path?: string }) => uri({ ...value, path: change.path ?? self.path }),
  };
  return self;
}

const load = (Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown })._load;
(Module as unknown as { _load: unknown })._load = function (
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean
) {
  return request === "vscode" ? stub : load.call(this, request, parent, isMain);
};
