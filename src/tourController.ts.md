---
path: "src/tourController.ts"
summary: "Drives the \"Nexus: Start Tour\" command: pick a tour from nexus map, then walk its stops one at a time with Next/Previous/End Tour."
source_commit: b2272078a9c925fc0f6b17bb03f902ee7b9de545
desynced: false
---

# src/tourController.ts

## What this does
`startTour` is the entry point for the "Nexus: Start Tour" command. It
lists the guided tours available in the current repo (by fetching `nexus
map` and filtering entries to `kind === "tour"` — there's no separate
"list tours" CLI command), lets the user pick one via a quick-pick menu,
then walks that tour's stops in order, opening each stop's file and
showing its note with Next/Previous/End Tour buttons.

## How it works
`runTour` is a small state machine: `showStop` opens the current stop's
file, shows an information message with the stop's note and whichever
buttons make sense at that position (no Previous on the first stop, "End
Tour" instead of "Next" on the last), and returns the next index to visit
— `index + 1`, `index - 1`, or `-1` to stop, which `runTour`'s loop
condition (`index >= 0 && index < stops.length`) treats as "done" either
way, whether the user explicitly ended the tour or just dismissed the
notification. `openStop` opens the target file in preview mode and, if the
stop names a specific line, clamps it to the file's actual line count
before selecting and revealing it — a stop pointing past the end of a file
that's since shrunk doesn't throw, it just reveals the last line instead.
If a stop's file can't be opened at all (moved or deleted since the tour
was written), the tour doesn't abort: it shows a warning for that one stop
and continues to the next.

## Recent changes
- Renamed the `entire nexus map` reference in this file's doc comment to `nexus map` (eddecb8)
- Initial implementation (8da5251)
