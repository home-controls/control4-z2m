/** Types for tools/deploy.mjs (used by the tests). */
type Kind = "converter" | "extension";
/** The two control4.mjs files' code. */
export interface Files {
    converter: string;
    extension: string;
}
/** What the tool does with one instance, from its retained messages. */
export interface Target {
    base: string;
    version?: string;
    /** The build its status reported before the push, or null (no status, or a build not known yet). */
    before: string | null;
    statusBefore?: Record<string, unknown>;
    problemsBefore: string[];
    action: "push" | "skip" | "report";
    reason?: string;
    /** The code it published (its retained bridge/extensions and bridge/converters): what a rollback puts back. */
    kept?: Files;
}
/** One line of the run's table. */
export interface Row {
    base: string;
    before: string | null;
    now: string | null;
    result: string;
}
/** What the tool hears and says over MQTT (see pushInstance in the tool). */
export interface Io {
    publish(topic: string, payload: string): Promise<unknown>;
    mark(): number;
    // biome-ignore lint/suspicious/noExplicitAny: a parsed MQTT payload
    wait<T>(topic: string, since: number, ms: number, accept: (json: any, text: string) => T | undefined): Promise<T | undefined>;
    latest(topic: string): string | undefined;
}
export const SAVE_ORDER: Kind[];
export const TIMEOUTS: {save: number; proof: number; rollback: number; republish: number};
export function plan(retained: Map<string, string>, distBuild: string): Target[];
export function judge(status: unknown, build: string, problemsBefore?: string[]): true | string | undefined;
export function saveRequest(base: string, kind: Kind, code: string, transaction: string): {topic: string; response: string; payload: string};
export function rollbackBuild(kept: Files): string;
export function table(rows: Row[]): string;
export function pushInstance(io: Io, target: Target & {kept: Files}, dist: Files & {build: string}, t?: typeof TIMEOUTS): Promise<{row: Row; ok: boolean}>;
