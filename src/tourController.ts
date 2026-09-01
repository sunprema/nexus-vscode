import * as vscode from "vscode";
import { NexusSource, NexusTourStop } from "./nexusSource";

const NEXT = "Next";
const PREVIOUS = "Previous";
const END_TOUR = "End Tour";

/**
 * Entry point for "Nexus: Start Tour": lists the tours available in this
 * repo (from the source's map, filtered to kind === "tour" — no separate
 * "list tours" call needed), lets the user pick one, then walks its stops.
 * Every read goes through the NexusSource, same as the explainer/diff
 * commands, so slug resolution and stop ordering stay owned by it.
 */
export async function startTour(source: NexusSource, repoRoot: vscode.Uri): Promise<void> {
  const map = await source.map(repoRoot);
  if (map.error) {
    vscode.window.showWarningMessage(`Nexus: ${map.error}`);
    return;
  }

  const tours = map.entries.filter((e) => e.kind === "tour");
  if (tours.length === 0) {
    vscode.window.showInformationMessage("Nexus: no guided tours in this repo yet.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    tours.map((t) => ({
      label: t.summary || t.path,
      description: `${t.stop_count ?? 0} stop${t.stop_count === 1 ? "" : "s"}`,
      slug: t.path,
    })),
    { placeHolder: "Select a guided tour" }
  );
  if (!picked) return;

  const tour = await source.tour(repoRoot, picked.slug);
  if (tour.error) {
    vscode.window.showWarningMessage(`Nexus: ${tour.error}`);
    return;
  }
  if (!tour.found || !tour.stops || tour.stops.length === 0) {
    vscode.window.showWarningMessage(`Nexus: tour "${picked.slug}" has no stops.`);
    return;
  }

  await runTour(repoRoot, tour.title ?? picked.slug, tour.stops);
}

/** Walks stops in order, letting each step choose the next index (or -1 to
 * stop), so Previous/Next/dismiss are all just different return values. */
async function runTour(repoRoot: vscode.Uri, title: string, stops: NexusTourStop[]): Promise<void> {
  let index = 0;
  while (index >= 0 && index < stops.length) {
    index = await showStop(repoRoot, title, stops, index);
  }
}

async function showStop(
  repoRoot: vscode.Uri,
  title: string,
  stops: NexusTourStop[],
  index: number
): Promise<number> {
  const stop = stops[index];
  try {
    await openStop(repoRoot, stop);
  } catch {
    vscode.window.showWarningMessage(`Nexus: couldn't open "${stop.path}" — it may have moved or been deleted.`);
  }

  const buttons: string[] = [];
  if (index > 0) buttons.push(PREVIOUS);
  buttons.push(index < stops.length - 1 ? NEXT : END_TOUR);

  const header = `${title} — stop ${index + 1} of ${stops.length}`;
  const choice = await vscode.window.showInformationMessage(`${header}\n${stop.note}`, ...buttons);

  if (choice === NEXT) return index + 1;
  if (choice === PREVIOUS) return index - 1;
  return -1; // END_TOUR, or the notification was dismissed.
}

/** Opens a stop's file and, when it names a line, selects and reveals it.
 * Joins onto the repo root's URI rather than building a filesystem path,
 * so a stop opens the same way in a virtual workspace as a local one. */
async function openStop(repoRoot: vscode.Uri, stop: NexusTourStop): Promise<void> {
  const uri = vscode.Uri.joinPath(repoRoot, ...stop.path.split("/"));
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: true });

  if (!stop.line || stop.line < 1) return;
  const line = Math.min(stop.line - 1, doc.lineCount - 1);
  const range = doc.lineAt(line).range;
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}
