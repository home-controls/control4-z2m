// One c4_device run (blueprints/c4_device.yaml) in the domain's words: what
// the run does, for which button, on which targets. The local render
// (test/c4-device.ts) reads its runs through this, and so can anything that
// has a run's top-level variables, such as a Home Assistant trace.

/** The trigger ids (`tid`) of the runs that paint the LEDs or check the device on boot / reload. */
const LED_RUNS = ["led", "led_bri", "boot", "reload"];
/** The blueprint's multi-tap `gesture`s, by the Tap count each is. */
const MULTI_TAPS = {double: "double", triple: "triple", quad: "quadruple"};

/**
 * One run's decision from its top-level variables, under the blueprint's own
 * names, and whether its condition passed. Throws when a passing run's
 * variables say two things at once, or nothing: the blueprint's condition and
 * its flags then disagree, and a tap could run twice or not at all.
 */
export function readRun(variables, passes) {
    const bi = typeof variables.bi === "number" ? variables.bi : -1;
    const run = {
        passes,
        does: "nothing",
        trigger: String(variables.tid ?? ""),
        button: bi >= 0 ? bi + 1 : null,
        targets: Array.isArray(variables.tgt) ? [...variables.tgt] : [],
        variables,
    };
    if (!passes) return run;
    if (LED_RUNS.includes(run.trigger)) return {...run, does: "leds"};
    const says = [
        variables.is_tap === true && "tap",
        variables.early === true && "early commit",
        variables.hold_candidate === true && "hold",
        Object.hasOwn(MULTI_TAPS, variables.gesture) && MULTI_TAPS[variables.gesture],
    ].filter(Boolean);
    if (says.length !== 1)
        throw new Error(`c4_device: a run on '${run.trigger}' passes, but its variables say ${says.length ? says.join(" and ") : "nothing to do"}`);
    return {...run, does: says[0]};
}

/** The look one LED gets from a run's led_status calls, by its name ("button_3") or number ("5"). */
export function ledLook(calls, name) {
    const call = calls.find((c) => String(c.buttons).split(",").includes(String(name)));
    if (!call) return undefined;
    const {buttons: _buttons, ...look} = call;
    return look;
}
