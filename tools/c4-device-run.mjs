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

/** A trace's step entries in the order Home Assistant ran them. */
function stepEntries(steps) {
    return Object.values(steps)
        .flat()
        .filter((e) => e && typeof e === "object")
        .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
}

/**
 * One c4_device run as Home Assistant traced it: a `trace/get` result (or the
 * extended_dict of a saved trace), read into the same shape as the local
 * render's runs. The top-level variables come from the trigger step, whether
 * it passed from `condition/0`, and the LED calls and `hears` from whichever
 * action step set them, found by content rather than by path, so a change to
 * the blueprint's action layout doesn't break it.
 */
export function readTrace(trace) {
    const steps = trace && typeof trace.trace === "object" && trace.trace ? trace.trace : {};
    const triggerKey = Object.keys(steps).find((k) => /^trigger(\/\d+)?$/.test(k));
    if (!triggerKey) throw new Error("c4_device trace: it has no trigger step, so no top-level variables");
    const {this: _this, trigger: _trigger, context: _context, ...variables} = steps[triggerKey][0]?.changed_variables ?? {};
    const passes = steps["condition/0"]?.[0]?.result?.result === true;
    const entries = stepEntries(steps);
    const set = (name) => entries.find((e) => e.changed_variables && Object.hasOwn(e.changed_variables, name))?.changed_variables[name];
    const calls = set("calls");
    const hears = set("hears");
    const stepError = entries.find((e) => typeof e.error === "string")?.error;
    const error = typeof trace.error === "string" ? trace.error : stepError;
    return {
        ...readRun(variables, passes),
        leds: Array.isArray(calls) ? calls : [],
        ...(typeof hears === "boolean" ? {hears} : {}),
        ...(error ? {error} : {}),
        running: trace.state === "running",
    };
}

/** The look one LED gets from a run's led_status calls, by its name ("button_3") or number ("5"). */
export function ledLook(calls, name) {
    const call = calls.find((c) => String(c.buttons).split(",").includes(String(name)));
    if (!call) return undefined;
    const {buttons: _buttons, ...look} = call;
    return look;
}
