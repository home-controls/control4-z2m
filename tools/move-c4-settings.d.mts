/** Types for tools/move-c4-settings.mjs (used by the tests). */
interface StoreFile {
    version: 1;
    models: Record<string, string>;
    devices: Record<string, Record<string, unknown>>;
    /** Kept as they are, but for the moved devices' handoff records. */
    meta?: Record<string, unknown>;
    handoff?: {had?: Record<string, number>; profiles?: Record<string, unknown>};
}
export function move(
    from: StoreFile,
    to: StoreFile,
    ieees: string[],
    options?: {copy?: boolean},
): {from: StoreFile; to: StoreFile; moved: {ieee: string; model?: string; settings: number}[]};
