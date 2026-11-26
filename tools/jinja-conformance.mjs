// The conformance probe (test/fixtures/jinja-conformance.*): how a rendering of
// it compares with the output Home Assistant gave, which the tests' engine is
// held to. tools/ha-validate-blueprints.mjs compares a live Home Assistant's.

/**
 * `{ok: true}` when the two match, whitespace around them aside; otherwise the
 * first |-separated field that differs (counted from 1), with each side's
 * field, undefined where that side has none. A field holding a | shifts the rest.
 */
export function compareProbe(got, want) {
    const g = got.trim();
    const w = want.trim();
    if (g === w) return {ok: true};
    const [gs, ws] = [g.split("|"), w.split("|")];
    const at = Array.from({length: Math.max(gs.length, ws.length)}, (_, i) => i).find((i) => gs[i] !== ws[i]) ?? 0;
    return {ok: false, field: at + 1, got: gs[at], want: ws[at]};
}
