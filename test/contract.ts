/** The control4/event contract fixture, written and checked by test/extension.test.ts. */

import fs from "node:fs";
import path from "node:path";

/** Real payloads the extension published on control4/event. */
export const CONTRACT_EVENTS = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", "control4-event.json"), "utf8")) as Record<string, unknown>[];

/** Every field of those payloads, sorted. */
export const CONTRACT_FIELDS = [...new Set(CONTRACT_EVENTS.flatMap((e) => Object.keys(e)))].sort();

/** An event as `head` (e.g. its gesture) plus the known-tap fields it carries: "tap_known #2", "fast_double known=true". */
export function showEvent(e: Record<string, unknown>, ...head: unknown[]): string {
    return [...head, e.tap_index === undefined ? "" : `#${e.tap_index}`, e.known_taps === undefined ? "" : `known=${e.known_taps}`].filter(Boolean).join(" ");
}
