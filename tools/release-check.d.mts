export function parseVersion(v: string): [number, number, number] | undefined;
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function verdict(o: {distChanged: boolean; baseVersion: string; headVersion: string}): string | undefined;
