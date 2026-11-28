/**
 * c4_device's LED feedback steps as Home Assistant runs them: what reaches the
 * device's LEDs (each led_status published on its set topic) and the check that
 * the device is heard.
 *
 * Only the step shapes the LED feedback has are modelled: delay, if, variables,
 * a for_each repeat, the led_status publish, the backlight's number.set_value,
 * and the hears notifications. Any
 * other step could end the run or reach the LEDs some other way, and is refused
 * by name, so an edit this does not model fails instead of passing unseen.
 */

import type {Environment} from "minijinja-js";

import type {LedCall} from "../../tools/c4-device-run.mjs";
import {C4TemplateError, conditionPasses, isTemplate, renderText, renderValue, renderVariables} from "./engine";

type Step = Record<string, unknown>;

export interface LedFeedback {
    /** The led_status calls that reach the LEDs; [] when none does. */
    leds: LedCall[];
    /** The hears check, when the steps make it. */
    hears?: boolean;
    /** The number.set_value writes the steps make (a keypad's backlight), when they make any. */
    numbers?: NumberWrite[];
}

/** One number.set_value: the entity and the value it is set to. */
export interface NumberWrite {
    entity_id: string;
    value: number;
}

/**
 * Each kind of step modelled, with the keys it may have beside its own and
 * COMMON: an action's metadata (the automation editor writes it) and its
 * continue_on_error (on no other step: it would reach the steps inside).
 */
const KINDS: Record<string, string[]> = {
    delay: [],
    if: ["then", "else"],
    variables: [],
    repeat: [],
    action: ["data", "target", "metadata", "continue_on_error"],
};
/** Keys any step may have. */
const COMMON = ["alias", "enabled"];
/** The actions the hears check runs, which cannot reach the LEDs, with the data keys each service takes, the first required. */
const NOTIFICATIONS: Record<string, string[]> = {
    "persistent_notification.create": ["message", "title", "notification_id"],
    "persistent_notification.dismiss": ["notification_id"],
};
/** The seconds in each unit of a delay given as a mapping (config_validation time_period_dict). */
const PERIOD_UNITS: Record<string, number> = {days: 86_400, hours: 3600, minutes: 60, seconds: 1, milliseconds: 0.001};

function unmodelled(what: string): never {
    throw new Error(`c4-device: the LED feedback has a step this harness does not model (${what})`);
}

/** What Home Assistant does where a step's rendered data is what its schema refuses: the run ends, continue_on_error or not. */
function runEnds(what: string): never {
    throw new Error(`c4-device: Home Assistant refuses ${what}, and the LED feedback's run ends there`);
}

function isMapping(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === "object" && !Array.isArray(x);
}

/** A mapping with exactly these keys, in any order. */
function hasKeys(x: unknown, ...keys: string[]): x is Record<string, unknown> {
    return isMapping(x) && Object.keys(x).sort().join() === keys.sort().join();
}

/** A step list as Home Assistant reads one: a lone step is a list of one (cv.ensure_list). */
function stepsOf(steps: unknown): unknown[] {
    return [steps ?? []].flat();
}

/**
 * The seconds of a time period, in the forms modelled (fewer than
 * config_validation positive_time_period takes): seconds, "HH:MM[:SS[.F]]", or a
 * mapping of PERIOD_UNITS, none negative; undefined for any other.
 */
function periodSeconds(d: unknown): number | undefined {
    const amount = (x: unknown) =>
        typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : typeof x === "string" && /^\d+(\.\d+)?$/.test(x) ? Number(x) : undefined;
    if (typeof d === "string") {
        const clock = /^(\d+):(\d+)(?::(\d+(?:\.\d+)?))?$/.exec(d);
        return clock ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0) : amount(d);
    }
    if (!isMapping(d)) return amount(d);
    let total = 0;
    for (const [unit, x] of Object.entries(d)) {
        const n = Object.hasOwn(PERIOD_UNITS, unit) ? amount(x) : undefined;
        if (n === undefined) return undefined;
        total += n * PERIOD_UNITS[unit];
    }
    return Object.keys(d).length ? total : undefined;
}

/**
 * A step list that makes the LED calls or the hears check: it publishes, or sets
 * calls or hears, anywhere inside it. (A templated action name says nothing: the
 * buttons option's homeassistant.turn_{{ want }} is one.)
 */
function definesLedFeedback(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(definesLedFeedback);
    if (!isMapping(node)) return false;
    if (node.action === "mqtt.publish") return true;
    if (isMapping(node.variables) && ("calls" in node.variables || "hears" in node.variables)) return true;
    return Object.values(node).some(definesLedFeedback);
}

/** Called at each delay with the seconds the run's delays have waited so far, to set the clock now() reads. */
type OnDelay = (waited: number) => void;

/**
 * The LED feedback a passing run reaches: the first of the top-level choose's
 * `options` whose conditions pass, run by ledSteps when it is the LED feedback.
 * Which option that is reads `written`, the same options before !input
 * substitution, so a publish a button's action brings in never counts.
 */
export function ledFeedback(
    env: Environment,
    options: unknown[],
    vars: Record<string, unknown>,
    setTopic: string,
    {onDelay, written}: {onDelay?: OnDelay; written: unknown[]},
): LedFeedback {
    for (const [i, option] of (options as Step[]).entries()) {
        if (![option.conditions ?? []].flat().every((c) => conditionPasses(env, c, vars, "led branch"))) continue;
        return definesLedFeedback((written[i] as Step | undefined)?.sequence) ? ledSteps(env, option.sequence, vars, setTopic, onDelay) : {leds: []};
    }
    return {leds: []};
}

/**
 * Run `steps` from `vars`, the run's variables, for the device whose set topic
 * is `setTopic`; `onDelay` sets the clock now() reads at each delay.
 */
export function ledSteps(env: Environment, steps: unknown, vars: Record<string, unknown>, setTopic: string, onDelay: OnDelay = () => {}): LedFeedback {
    const leds: LedCall[] = [];
    const numbers: NumberWrite[] = [];
    const heard: {hears?: boolean} = {};
    let waited = 0;

    /**
     * What an action's data renders to. Where one of its templates fails, the run ends there (a
     * C4TemplateError) - unless the action goes on under continue_on_error. Home Assistant then goes
     * past it (service.py raises it as a HomeAssistantError), but the engine standing in for HA's
     * cannot tell such a failure from a gap of its own, so that is refused by name.
     */
    const renderData = <T>(step: Step, render: () => T): T => {
        try {
            return render();
        } catch (error) {
            if (step.continue_on_error === true && error instanceof C4TemplateError)
                unmodelled(`${String(step.action)} whose template fails under continue_on_error, which Home Assistant goes past (${error.message})`);
            throw error;
        }
    };

    /** The led_status a publish sends, when it is one call on the device's set topic. */
    const publish = (step: Step, now: Record<string, unknown>) => {
        const data = step.data;
        if (!hasKeys(data, "topic", "payload")) unmodelled(`mqtt.publish with data ${JSON.stringify(data)}`);
        if (typeof data.topic !== "string" || typeof data.payload !== "string") unmodelled("mqtt.publish whose topic or payload is no text");
        const [topic, payload] = renderData(step, () => [
            renderText(env, data.topic as string, now, "led step", "topic"),
            renderText(env, data.payload as string, now, "led step", "payload"),
        ]);
        if (topic !== setTopic) unmodelled(`mqtt.publish on ${topic}, not the device's ${setTopic}`);
        let body: unknown;
        try {
            body = JSON.parse(payload);
        } catch {
            unmodelled(`mqtt.publish of ${payload}, which is no JSON`);
        }
        if (!hasKeys(body, "led_status") || !isMapping(body.led_status)) unmodelled(`mqtt.publish of ${payload}, which is no one led_status call`);
        leds.push(body.led_status as unknown as LedCall);
    };

    /** A hears notification cannot reach the LEDs, but data its service refuses, or a template of it that fails, ends the run here. */
    const notify = (action: string, step: Step, now: Record<string, unknown>) => {
        const takes = NOTIFICATIONS[action];
        const raw = step.data ?? {};
        const data = renderData(step, () => renderValue(env, raw, now, "led step", action));
        // cv.string: a template's result is its text, but a list or a mapping that no template wrote is refused.
        const isText = (k: string, v: unknown) =>
            v !== null && v !== undefined && (!(Array.isArray(v) || isMapping(v)) || (isMapping(raw) && isTemplate(raw[k])));
        const ok = isMapping(data) && takes[0] in data && Object.entries(data).every(([k, v]) => takes.includes(k) && isText(k, v));
        if (!ok) runEnds(`${action} with data ${JSON.stringify(data)}`);
    };

    /** A number.set_value on one number entity: target {entity_id}, data {value}, as the backlight step writes it. */
    const setNumber = (step: Step, now: Record<string, unknown>) => {
        if (!hasKeys(step.target, "entity_id") || !hasKeys(step.data, "value"))
            unmodelled(`number.set_value with ${JSON.stringify({target: step.target, data: step.data})}`);
        const [target, data] = renderData(step, () => [
            renderValue(env, step.target, now, "led step", "target"),
            renderValue(env, step.data, now, "led step", "data"),
        ]) as [Record<string, unknown>, Record<string, unknown>];
        const value = typeof data.value === "number" ? data.value : Number.NaN;
        if (typeof target.entity_id !== "string" || !target.entity_id.startsWith("number.") || !Number.isFinite(value))
            runEnds(`number.set_value with ${JSON.stringify({target, data})}`);
        numbers.push({entity_id: target.entity_id, value});
    };

    // Home Assistant's script_variables: a variables step sets a name where it is defined, else at the
    // top level, so one scope serves every nested sequence; only `repeat` is a pass's own.
    const walk = (list: unknown, scope: Record<string, unknown>): Record<string, unknown> => {
        let now = scope;
        for (const step of stepsOf(list)) {
            if (!isMapping(step)) unmodelled(`step ${JSON.stringify(step)}`);
            if (step.enabled === false) continue;
            if ("enabled" in step && step.enabled !== true) unmodelled(`enabled: ${JSON.stringify(step.enabled)}`);
            const keys = Object.keys(step);
            const kind = keys.find((k) => Object.hasOwn(KINDS, k));
            if (!kind || keys.some((k) => k !== kind && !COMMON.includes(k) && !KINDS[kind].includes(k)))
                unmodelled(keys.length ? keys.join(", ") : "an empty step");
            if (kind === "delay") {
                // Home Assistant ends the run on a delay that renders to no time period (_get_pos_time_period_template);
                // this takes fewer forms than it does, so it refuses the rest without saying which Home Assistant runs.
                const delay = renderValue(env, step.delay, now, "led step", "delay");
                const seconds = periodSeconds(delay);
                if (seconds === undefined) unmodelled(`delay of ${JSON.stringify(delay)}`);
                waited += seconds;
                onDelay(waited);
            } else if (kind === "variables") {
                if (!isMapping(step.variables)) unmodelled(`variables ${JSON.stringify(step.variables)}`);
                now = renderVariables(env, step.variables, now, "hears" in step.variables ? "hears" : "led step", true);
                if ("hears" in step.variables) heard.hears = now.hears as boolean;
            } else if (kind === "if") {
                if (!("then" in step)) unmodelled("if with no then");
                const conditions = [step.if].flat();
                for (const c of conditions) if (!isTemplate(c)) unmodelled(`if condition ${JSON.stringify(c)}`);
                const pass = conditions.every((c) => conditionPasses(env, c, now, "led branch"));
                now = walk(pass ? step.then : step.else, now);
            } else if (kind === "repeat") {
                const r = step.repeat;
                if (!hasKeys(r, "for_each", "sequence")) unmodelled(`repeat ${JSON.stringify(r)}`);
                // for_each renders once, as the repeat starts; the sequence then runs once per item.
                const items = renderValue(env, r.for_each, now, "led step", "for_each");
                if (!Array.isArray(items)) unmodelled(`repeat for_each that renders ${JSON.stringify(items)}`);
                const outer = "repeat" in now ? {repeat: now.repeat} : {};
                items.forEach((item, i) => {
                    // set_repeat_var sets no item for a None one.
                    const pass = {first: i === 0, index: i + 1, last: i === items.length - 1, ...(item === null ? {} : {item})};
                    now = walk(r.sequence, {...now, repeat: pass});
                });
                const {repeat: _pass, ...after} = now;
                now = {...after, ...outer};
            } else if (kind === "action") {
                const action = step.action as string;
                if ("metadata" in step && !isMapping(step.metadata)) unmodelled(`metadata ${JSON.stringify(step.metadata)}`);
                // cv.boolean takes yes, on and 1 as well; the yaml package reads them otherwise than Home Assistant's loader.
                if ("continue_on_error" in step && typeof step.continue_on_error !== "boolean")
                    unmodelled(`continue_on_error: ${JSON.stringify(step.continue_on_error)}`);
                if ("target" in step && action !== "number.set_value") unmodelled(`${action} with a target`);
                if (action === "mqtt.publish") publish(step, now);
                else if (action === "number.set_value") setNumber(step, now);
                else if (Object.hasOwn(NOTIFICATIONS, action)) notify(action, step, now);
                else unmodelled(`action ${JSON.stringify(step.action)}`);
            } else {
                unmodelled(kind);
            }
        }
        return now;
    };
    walk(steps, vars);
    return {leds, ...heard, ...(numbers.length ? {numbers} : {})};
}
