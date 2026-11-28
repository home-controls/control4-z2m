export function parseVersion(v: string): [number, number, number] | undefined;
export function isPrerelease(v: string): boolean;
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function nextVersion(current: string, kind: "rc" | "final", level?: "patch" | "minor" | "major"): string;
export function verdict(o: {
    distChanged: boolean;
    distFresh: boolean;
    baseVersion: string;
    headVersion: string;
    sourceSinceCandidate?: boolean;
}): string | undefined;
