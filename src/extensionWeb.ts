import * as vscode from "vscode";
import { activateNexus } from "./activation";
import { GitHubNexusSource } from "./githubSource";

/**
 * The browser entry point (package.json's "browser"), for vscode.dev and
 * github.dev: GitHub over HTTP, on the virtual filesystem a repository is
 * mounted at there.
 *
 * The selector is `vscode-vfs` rather than `*` deliberately — a
 * browser-hosted window can also hold `untitled` buffers and local folders
 * opened through the File System Access API, none of which are a GitHub
 * repository. GitHubNexusSource would refuse them anyway; not registering
 * is just cheaper than refusing once per document.
 */
export function activate(context: vscode.ExtensionContext): void {
  activateNexus(context, new GitHubNexusSource(), { scheme: "vscode-vfs" });
}

export function deactivate(): void {}
