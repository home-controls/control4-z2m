/** Types for tools/port-zha-blueprints.mjs (used by the tests). */
export const FILES: string[];
/** Where the ZHA originals are kept (tools/zha-blueprints). */
export const ZHA_DIR: string;
export const EVENTS_NOTE: string[];
export function remoteEventType(command: string): string;
export function port(text: string, file: string): {text: string; events: number};
