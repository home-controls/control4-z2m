/** How a rendering of the conformance probe compares with its expected output. */
export type ProbeComparison = {ok: true} | {ok: false; field: number; got: string | undefined; want: string | undefined};

export function compareProbe(got: string, want: string): ProbeComparison;
