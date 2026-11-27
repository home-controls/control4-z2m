/**
 * The template engine that stands in for Home Assistant's: minijinja-js set up
 * to render as HA's Jinja2 does, HA's template extensions over a world given as
 * plain data, and HA's typing of a rendered result (helpers/template
 * `_parse_result`). test/fixtures/jinja-conformance.* holds it to what a real HA
 * renders.
 */

import {Environment} from "minijinja-js";

export interface HaState {
    state: string;
    attributes: Record<string, unknown>;
}

export interface HaDevice {
    identifiers: [string, string][];
    model_id: string;
    name: string;
    entities: string[];
}

/** What device_attr / device_entities / states / is_state / state_attr / now() read. */
export interface HaWorld {
    devices: Record<string, HaDevice>;
    states: Record<string, HaState>;
    /** Local time, "HH:MM:SS". */
    time: string;
}

const EMPTY: HaWorld = {devices: {}, states: {}, time: "12:00:00"};

/** No default given: HA raises instead of returning one. */
const NO_DEFAULT = Symbol("no default");

/** The spaces outside ASCII that Python counts as such (str.isspace); JS trim also takes U+FEFF, Python does not. */
const UNICODE_SPACE = "\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const stripping = (ascii: string) => new RegExp(`^[${ascii}${UNICODE_SPACE}]+|[${ascii}${UNICODE_SPACE}]+$`, "g");
/** Python's str.isspace() characters: ASCII whitespace, U+001C-U+001F, and the Unicode spaces. */
const PY_STRIP = stripping("\\t\\n\\v\\f\\r\\x1c-\\x20");
/** The spaces Python's int() and float() take around a number: ASCII whitespace and the Unicode spaces, not U+001C-U+001F. */
const NUMBER_STRIP = stripping("\\t\\n\\v\\f\\r ");

/** Python's str.strip(), as HA strips a template's source and its result. */
function strip(text: string): string {
    return text.replace(PY_STRIP, "");
}

/**
 * Python's int() of text, as far as the engine models it: a sign and ASCII digits, inside the spaces
 * int() takes; else undefined. int() also takes underscores and other scripts' digits, which it does not.
 */
export function intOfText(text: string): number | undefined {
    const t = text.replace(NUMBER_STRIP, "");
    return /^[+-]?\d+$/.test(t) ? Number.parseInt(t, 10) : undefined;
}

/**
 * Jinja2's do_int, as HA's int filter / function uses it: int(value), else int(float(value)), else the default.
 * With base= (a keyword argument, which arrives as a trailing object), text is read in that base, as
 * Python's int(text, base) reads it (a 0x / 0o / 0b prefix of that base allowed); else the default.
 */
function toInt(value: unknown, fallback: unknown = NO_DEFAULT, kwargs?: unknown): unknown {
    if (fallback !== null && typeof fallback === "object" && !Array.isArray(fallback) && kwargs === undefined) {
        kwargs = fallback;
        fallback = (fallback as {default?: unknown}).default ?? NO_DEFAULT;
    }
    const base = Number((kwargs as {base?: unknown} | undefined)?.base ?? 10);
    if (base !== 10) {
        const digits = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, base);
        const prefix = {16: "0x", 8: "0o", 2: "0b"}[base] ?? "";
        const t = typeof value === "string" ? value.replace(NUMBER_STRIP, "").toLowerCase() : "";
        const m = new RegExp(`^([+-]?)(?:${prefix})?([${digits}]+)$`).exec(t);
        if (m) return (m[1] === "-" ? -1 : 1) * Number.parseInt(m[2], base);
        if (fallback === NO_DEFAULT) throw new Error(`int got invalid input '${String(value)}' but no default was specified`);
        return fallback;
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string") {
        const n = intOfText(value);
        if (n !== undefined) return n;
        const f = toFloat(value.replace(NUMBER_STRIP, ""), Number.NaN) as number;
        if (Number.isFinite(f)) return Math.trunc(f);
    }
    if (fallback === NO_DEFAULT) throw new Error(`int got invalid input '${String(value)}' but no default was specified`);
    return fallback;
}

/** Python float(value) for the decimal text c4_device reads, else the default. */
function toFloat(value: unknown, fallback: unknown = NO_DEFAULT): unknown {
    if (typeof value === "number") return value;
    const t = typeof value === "string" ? value.replace(NUMBER_STRIP, "") : "";
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
    if (fallback === NO_DEFAULT) throw new Error(`float got invalid input '${String(value)}' but no default was specified`);
    return fallback;
}

/** HA's round filter to a whole number: Python's round(), half to even. c4_device rounds to no other precision. */
function haRound(value: unknown, precision = 0): number {
    if (precision !== 0) throw new Error("c4-device: round to a precision other than 0 is not modelled");
    const x = toFloat(value) as number;
    const floor = Math.floor(x);
    const diff = x - floor;
    return diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
}

function isNumber(value: unknown): boolean {
    try {
        return Number.isFinite(toFloat(value) as number);
    } catch {
        return false;
    }
}

/** Python re.findall for a pattern with at most one group: the whole matches, or that group's. */
function regexFindall(value: unknown, find = ""): string[] {
    return [...String(value).matchAll(new RegExp(find, "g"))].map((m) => (m.length > 1 ? (m[1] ?? "") : m[0]));
}

/** Jinja2's sum(iterable, start=...) as c4_device calls it; minijinja's own has no start. Keyword arguments arrive as a trailing object. */
function sum(seq: unknown[], kwargs: {start?: unknown} = {}): unknown {
    let acc = kwargs.start ?? 0;
    for (const x of seq) acc = Array.isArray(acc) ? acc.concat(x) : (acc as number) + (x as number);
    return acc;
}

/** An environment that renders as HA does, reading `world` (none: no devices, no entities). */
export function haEnvironment(world: HaWorld = EMPTY): Environment {
    const env = new Environment();
    env.pycompat = true;
    env.undefinedBehavior = "lenient";
    const state = (e: unknown) => world.states[String(e)];
    const states = (e: unknown) => state(e)?.state ?? "unknown";
    const isState = (e: unknown, want: unknown) => state(e)?.state === want;
    const fns: Record<string, (...args: never[]) => unknown> = {
        device_attr: (dev: unknown, attr: unknown) => (world.devices[String(dev)] as unknown as Record<string, unknown> | undefined)?.[String(attr)] ?? null,
        device_entities: (dev: unknown) => [...(world.devices[String(dev)]?.entities ?? [])],
        states,
        is_state: isState,
        state_attr: (e: unknown, attr: unknown) => state(e)?.attributes[String(attr)] ?? null,
        now: () => ({
            strftime: (fmt: string) => fmt.replace("%H", world.time.slice(0, 2)).replace("%M", world.time.slice(3, 5)).replace("%S", world.time.slice(6, 8)),
        }),
        int: toInt,
        float: toFloat,
        is_number: isNumber,
    };
    for (const name of ["device_attr", "device_entities", "states", "is_state", "state_attr", "now", "int", "float", "is_number"])
        env.addFunction(name, fns[name]);
    env.addFilter("states", states);
    env.addFilter("int", toInt);
    env.addFilter("float", toFloat);
    env.addFilter("round", haRound);
    env.addFilter("is_number", isNumber);
    env.addFilter("regex_findall", regexFindall);
    env.addFilter("sum", sum);
    // HA's to_json with no options: compact, keys in order, as JSON.stringify writes; an undefined value is no JSON there, not a key to drop.
    env.addFilter("to_json", (value: unknown) =>
        JSON.stringify(value, (_key, v: unknown) => {
            if (v === undefined) throw new Error("Type is not JSON serializable: Undefined");
            return v;
        }),
    );
    env.addTest("is_state", isState);
    env.addTest("search", (value: unknown, find = "") => new RegExp(find).test(String(value)));
    env.addTest("match", (value: unknown, find = "") => new RegExp(`^(?:${find})`).test(String(value)));
    return env;
}

// ---------------------------------------------------------------------------
// HA's script semantics: variables and template conditions
// ---------------------------------------------------------------------------

/**
 * A template that failed to render: Home Assistant aborts the run where a
 * variable or an action fails, and takes a failing condition as not met; the
 * harness stops at either.
 */
export class C4TemplateError extends Error {
    constructor(
        readonly step: "variable" | "condition" | "led branch" | "hears" | "led step",
        /** The variable whose template failed; none for a condition. */
        readonly variable: string | undefined,
        cause: unknown,
    ) {
        super(`${step}${variable ? ` ${variable}` : ""}: ${(cause as Error)?.message ?? cause}`, {cause});
        this.name = "C4TemplateError";
    }
}

/** helpers/template is_template_string: only such text becomes a template (config_validation template_complex). */
const TEMPLATE = /\{%|\{\{|\{#/;

/** Text that Home Assistant makes a template. */
export function isTemplate(value: unknown): value is string {
    return typeof value === "string" && TEMPLATE.test(value);
}

/**
 * helpers/template render_complex: each template string in a structure is
 * rendered (source and result stripped) and typed by haValue; any other text
 * stays as written.
 */
function renderComplex(env: Environment, value: unknown, vars: Record<string, unknown>): unknown {
    if (Array.isArray(value)) return value.map((x) => renderComplex(env, x, vars));
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([k, x]) => [renderComplex(env, k, vars), renderComplex(env, x, vars)]));
    return isTemplate(value) ? haValue(renderStripped(env, value, vars)) : value;
}

/** A template's text as HA renders it: its source stripped, then its result. */
function renderStripped(env: Environment, source: string, vars: Record<string, unknown>): string {
    return strip(env.renderStr(strip(source), vars));
}

/** Where a template failed. */
type StepLabel = C4TemplateError["step"];

/**
 * A string field as a step's action gets it (config_validation string): the
 * text a template writes, stripped, before HA types it; other text as written.
 */
export function renderText(env: Environment, value: string, vars: Record<string, unknown>, step: StepLabel, what?: string): string {
    try {
        return isTemplate(value) ? renderStripped(env, value, vars) : value;
    } catch (error) {
        throw new C4TemplateError(step, what, error);
    }
}

/** One value as a script step renders it (render_complex); a failure names the step and what it rendered. */
export function renderValue(env: Environment, value: unknown, vars: Record<string, unknown>, step: StepLabel, what?: string): unknown {
    try {
        return renderComplex(env, value, vars);
    } catch (error) {
        throw new C4TemplateError(step, what, error);
    }
}

/**
 * helpers/script_variables: each variable renders in order and sees the ones
 * before it. The automation's own variables never override a name the run
 * already has; a `variables` action step does (`override`).
 */
export function renderVariables(
    env: Environment,
    spec: Record<string, unknown>,
    vars: Record<string, unknown>,
    step: "variable" | "hears" | "led step" = "variable",
    override = false,
): Record<string, unknown> {
    const out = {...vars};
    for (const [name, value] of Object.entries(spec)) {
        if (!override && name in out) continue;
        out[name] = renderValue(env, value, out, step, name);
    }
    return out;
}

/** A template condition (the string shorthand): its stripped, untyped result is "true", ignoring case. */
export function conditionPasses(env: Environment, condition: unknown, vars: Record<string, unknown>, step: "condition" | "led branch" = "condition"): boolean {
    if (typeof condition !== "string") throw new Error(`c4-device: only template conditions are modelled, not ${JSON.stringify(condition)}`);
    try {
        return renderStripped(env, condition, vars).toLowerCase() === "true";
    } catch (error) {
        throw new C4TemplateError(step, undefined, error);
    }
}

// ---------------------------------------------------------------------------
// HA's typing of a rendered result
// ---------------------------------------------------------------------------

/**
 * Python ast.literal_eval, for the literals c4_device's variables print: str,
 * int, float, bool, None, list and dict (no tuples or sets).
 */
function literalEval(s: string): unknown {
    let i = 0;
    const ws = () => {
        while (i < s.length && /\s/.test(s[i])) i++;
    };
    const fail = (): never => {
        throw new SyntaxError(`not a literal: ${s.slice(0, 80)}`);
    };
    /** Items up to `close`, each read by `item`, comma-separated (a trailing comma allowed). */
    const items = (close: string, item: () => void) => {
        i++;
        ws();
        while (s[i] !== close) {
            if (i >= s.length) fail();
            item();
            ws();
            if (s[i] === ",") i++;
            else if (s[i] !== close) fail();
            ws();
        }
        i++;
    };
    const value = (): unknown => {
        ws();
        const c = s[i];
        if (c === "[") {
            const list: unknown[] = [];
            items("]", () => list.push(value()));
            return list;
        }
        if (c === "{") {
            const dict: Record<string, unknown> = {};
            items("}", () => {
                const k = value();
                ws();
                if (s[i] !== ":") fail();
                i++;
                dict[String(k)] = value();
            });
            return dict;
        }
        if (c === "'" || c === '"') {
            i++;
            let out = "";
            while (s[i] !== c) {
                if (i >= s.length) fail();
                if (s[i] !== "\\") {
                    out += s[i++];
                    continue;
                }
                // The escapes minijinja's repr writes: \\, the quote it chose, \n \r \t, and \xNN for other control characters.
                const e = s[i + 1];
                i += 2;
                if (e === "x") {
                    out += String.fromCharCode(Number.parseInt(s.slice(i, i + 2), 16));
                    i += 2;
                } else out += {n: "\n", r: "\r", t: "\t"}[e] ?? e;
            }
            i++;
            return out;
        }
        const num = /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(s.slice(i));
        if (num) {
            i += num[0].length;
            return Number(num[0]);
        }
        for (const [word, v] of [
            ["True", true],
            ["False", false],
            ["None", null],
        ] as const) {
            if (s.startsWith(word, i) && !/\w/.test(s[i + word.length] ?? "")) {
                i += word.length;
                return v;
            }
        }
        return fail();
    };
    const v = value();
    ws();
    if (i !== s.length) fail();
    return v;
}

/** helpers/template.py _IS_NUMERIC. */
const IS_NUMERIC = /^[+-]?(?!0\d)\d*(?:\.\d*)?$/;

/** What HA makes of a rendered (and stripped) result: a number, a literal, or the text itself. */
export function haValue(rendered: string): unknown {
    if (IS_NUMERIC.test(rendered) && /\d/.test(rendered)) return rendered.includes(".") ? Number(rendered) : Number.parseInt(rendered, 10);
    let v: unknown;
    try {
        v = literalEval(rendered);
    } catch {
        return rendered;
    }
    // A string literal, or a number literal _IS_NUMERIC refused (such as "007"), stays the text.
    if (typeof v === "string" || typeof v === "number") return rendered;
    return v;
}
