/** Types for tools/port-zha-packages.mjs (used by the tests). */
export const FILES: string[];
export const COMMANDS: Record<number, Record<number, string>>;
export function port(text: string, file: string): {text: string; calls: number};
