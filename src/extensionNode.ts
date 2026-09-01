import * as vscode from "vscode";
import { activateNexus } from "./activation";
import { CliNexusSource } from "./cliSource";

/**
 * The desktop entry point (package.json's "main"): the `nexus` CLI over
 * local files. Everything else lives in activation.ts, shared with the
 * browser entry point.
 */
export function activate(context: vscode.ExtensionContext): void {
  activateNexus(context, new CliNexusSource(), { scheme: "file" });
}

export function deactivate(): void {}
