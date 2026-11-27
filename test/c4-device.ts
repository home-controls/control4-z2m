/**
 * What c4_device does when one thing happens to one device, as Home Assistant
 * decides it: the committed blueprint (blueprints/c4_device.yaml) rendered by
 * the engine that stands in for HA's (c4-device/engine.ts), over a fake HA
 * holding the device and the entities its inputs name.
 *
 *   const kp = c4Device({buttons: {2: {targets: ["light.kitchen"], double: anyAction}}});
 *   kp.on(knownTap(2)).does                          // "early commit"
 *   kp.on(change("light.kitchen", 200)).led("button_2")  // {color: "Green", brightness: 75}
 *   kp.play("double", 2).map((r) => r.does)          // each fixture event of a double tap, in order
 *
 * A happening starts the runs HA would start for it, one per trigger it fires;
 * each run renders the top-level variables and condition, and a passing run
 * that reaches the LED feedback renders the led_status calls it publishes to
 * the device and the check that the device is heard. Tap outcomes, holds, early-commit waits and
 * Direction are not rendered (docs/plans/c4-device-rules.md).
 */

import {GESTURES, modelInfo} from "../src/core/constants";
import {buildDefinitions} from "../src/z2m/definitions";
import {eventEntityConfig, SHARED_TOPIC} from "../src/z2m/extension";
import {type LedCall, type LedLook, ledLook, type Run, readRun} from "../tools/c4-device-run.mjs";
import {sequences} from "../tools/c4-scenarios.mjs";
import {c4DeviceBlueprint, kindOf, substitute} from "./c4-device/blueprint";
import {checkTime, fires, later, parseTime} from "./c4-device/clock";
import {conditionPasses, type HaState, type HaWorld, haEnvironment, renderVariables} from "./c4-device/engine";
import {ledFeedback} from "./c4-device/led-feedback";

export type {Does, LedCall, LedLook, Run} from "../tools/c4-device-run.mjs";
export {C4TemplateError} from "./c4-device/engine";

export type ButtonNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type TapCount = "single" | "double" | "triple" | "quadruple";
/** number = a light on at that brightness (0-255); string = the state; null = no such entity. */
export type StateSpec = number | string | null | {state: string; attributes?: Record<string, unknown>};

/** A button's b<N>_ inputs, by their names without the prefix. */
export interface ButtonInputs {
    targets?: string[];
    mode?: string;
    hold?: boolean;
    action?: unknown[];
    double?: unknown[];
    triple?: unknown[];
    quad?: unknown[];
    led?: string[];
    watch?: string[];
    on?: string;
    off?: string;
    night_on?: string;
    night_off?: string;
}

export interface DeviceSetup {
    /** Its model_id. Default C4-KP3-Z. */
    model?: string;
    buttons?: Partial<Record<ButtonNumber, ButtonInputs>>;
    /** Every other input by its blueprint name (tap_response, led_follow, night_enabled, room_extra, ...). An input left out takes its default. */
    inputs?: Record<string, unknown>;
    /** The world before the happening. Every entity an input names exists, "off", unless given here. */
    states?: Record<string, StateSpec>;
    /** The device's "Paddle controls local load" switch, in that state; no such switch unless given. */
    paddleLocal?: boolean;
    /** The device's button behaviour select of each paddle half given (top_button_behaviour, bottom_button_behaviour), in that state; none unless given. */
    buttonBehaviour?: {top?: string; bottom?: string};
    /**
     * The device's Control4 events entity (ADR 0005): true (the default) with the
     * event types the extension declares for the model, false for none, or these event types.
     */
    eventsEntity?: boolean | string[];
    /** What now() says, "HH:MM:SS". Default 12:00:00. */
    time?: string;
}

/** Something that happens to the device or around it. */
export type Happening =
    | {
          readonly kind: "button";
          readonly button: ButtonNumber;
          readonly label: string;
          /** Its Contract payload, from the fixture sequences re-addressed to the device's button (c4-scenarios' `sequences`). */
          readonly payload: (seqs: ReturnType<typeof sequences>) => Record<string, unknown> | undefined;
      }
    | {readonly kind: "event"; readonly payload: Record<string, unknown>}
    | {readonly kind: "change"; readonly entity: string; readonly to: StateSpec; readonly from?: StateSpec}
    | {readonly kind: "boot" | "reload"}
    | {readonly kind: "clock"; readonly time?: string};

/** A run, with what it sends the LEDs when it reaches the LED feedback. */
export type DeviceRun = Run & {
    /** The led_status calls; [] when the run sends none. */
    leds: LedCall[];
    /** Boot / reload only: the device has its Control4 events entity. */
    hears?: boolean;
};

export interface Reaction {
    /** From the run that passes; "nothing" when none does. */
    does: Run["does"];
    button: ButtonNumber | null;
    targets: string[];
    /** The led_status calls it sends; [] when none. */
    leds: LedCall[];
    /** The look of one LED, by name ("button_3") or number ("5"). */
    led(name: string): LedLook | undefined;
    /** On boot / reload: the device has its Control4 events entity. */
    hears?: boolean;
    /** Every run it started, in trigger order. */
    runs: DeviceRun[];
}

/** One of a button's sequences in the contract fixture (c4-scenarios' `sequences`). */
export type SequenceName = keyof ReturnType<typeof sequences>;

export interface C4Device {
    readonly ieee: string;
    readonly model: string;
    /** What the happening makes c4_device do. Throws when more than one run passes: one change must start one LED run. */
    on(h: Happening): Reaction;
    /** Every run the happening starts, in trigger order. */
    runs(h: Happening): DeviceRun[];
    /** What each event of the button's fixture sequence makes c4_device do, in order, each from the setup's world. */
    play(sequence: SequenceName, button: ButtonNumber): Reaction[];
}

interface Automation {
    variables: Record<string, unknown>;
    condition: unknown[];
    trigger: Record<string, unknown>[];
    action: Record<string, unknown>[];
}

type Step = Record<string, unknown>;

const DEVICE_ID = "c4_device_under_test";
const DEVICE_NAME = "Test keypad";
const EVENTS_ENTITY = "event.test_keypad_control4_events";
const PADDLE_SWITCH = "switch.test_keypad_paddle_local_control";
const BEHAVIOUR_SELECT = (half: string) => `select.test_keypad_${half}_button_behaviour`;

/** A Tap action that does something; what it does is never rendered here. */
export const anyAction: unknown[] = [{action: "script.turn_on", target: {entity_id: "script.any"}}];

let definitions: ReturnType<typeof buildDefinitions> | undefined;

/** The event types the extension's events entity declares for a model: the commands of its definition's actions. */
function declaredEventTypes(model: string, ieee: string): string[] {
    const info = modelInfo(model);
    if (!info) throw new Error(`c4-device: '${model}' is no Control4 model the converter defines`);
    // Zigbee2MQTT reports the model itself, never an alias or another spelling of it, as the model_id.
    if (info.model !== model) throw new Error(`c4-device: '${model}' is not a model_id Home Assistant shows; the model is ${info.model}`);
    definitions ??= buildDefinitions();
    const def = definitions.find((d: {model: string}) => d.model === info.model) as {exposes: unknown} | undefined;
    // A model whose exposes depend on the device (the KC120277's layout) gives them for a device not yet known: every button.
    type Ex = {name?: string; values?: string[]}[];
    const raw = typeof def?.exposes === "function" ? (def.exposes as (d: unknown, o: unknown) => Ex)({ieeeAddr: ieee, modelID: info.model}, {}) : def?.exposes;
    const exposes = Array.isArray(raw) ? (raw as Ex) : [];
    const actions = exposes.find((x) => x.name === "action")?.values ?? [];
    return eventEntityConfig(ieee, actions, info.family).event_types as string[];
}

function haState(spec: Exclude<StateSpec, null>): HaState {
    if (typeof spec === "number") return {state: "on", attributes: {brightness: spec}};
    if (typeof spec === "string") return {state: spec, attributes: {}};
    return {state: spec.state, attributes: {...spec.attributes}};
}

export function c4Device(setup: DeviceSetup = {}): C4Device {
    const bp = c4DeviceBlueprint();
    const model = setup.model ?? "C4-KP3-Z";
    const ieee = "0x000fff0000006e2a";
    const given: Record<string, unknown> = {...setup.inputs};
    for (const [n, button] of Object.entries(setup.buttons ?? {})) {
        for (const [k, v] of Object.entries(button)) {
            const name = `b${n}_${k}`;
            if (name in given) throw new Error(`c4-device: ${name} is given twice, under buttons and in inputs`);
            given[name] = v;
        }
    }
    for (const name of Object.keys(given)) {
        if (!bp.inputs.has(name) || name === "c4_device") throw new Error(`c4-device: c4_device has no input '${name}' to set`);
    }
    if (setup.time !== undefined) checkTime(setup.time);
    const inputs: Record<string, unknown> = {};
    for (const [name, decl] of bp.inputs) inputs[name] = decl.default;
    Object.assign(inputs, given, {c4_device: DEVICE_ID});
    for (const [name, decl] of bp.inputs) {
        if (decl.time && parseTime(inputs[name]) === undefined)
            throw new Error(`c4-device: ${name} ${JSON.stringify(inputs[name])} is no time of day this harness models (H:M or H:M:S, as cv.time reads it)`);
    }
    const automation = substitute(bp.automation, inputs) as Automation;

    const states: Record<string, HaState> = {};
    for (const [name, decl] of bp.inputs) {
        if (!decl.entity) continue;
        for (const e of [inputs[name]].flat()) if (typeof e === "string" && e) states[e] = {state: "off", attributes: {}};
    }
    const entities: string[] = [];
    const declared = declaredEventTypes(model, ieee);
    const offered = bp.inputs.get("c4_device")?.models ?? [];
    if (!offered.includes(model)) throw new Error(`c4-device: c4_device's device selector does not offer '${model}'; it takes ${offered.join(", ")}`);
    if (setup.eventsEntity !== false) {
        entities.push(EVENTS_ENTITY);
        const eventTypes = Array.isArray(setup.eventsEntity) ? setup.eventsEntity : declared;
        states[EVENTS_ENTITY] = {state: "2026-10-29T12:00:00.000+00:00", attributes: {event_types: eventTypes}};
    }
    if (setup.paddleLocal !== undefined) {
        entities.push(PADDLE_SWITCH);
        states[PADDLE_SWITCH] = {state: setup.paddleLocal ? "on" : "off", attributes: {}};
    }
    for (const [half, behaviour] of Object.entries(setup.buttonBehaviour ?? {})) {
        if (!["top", "bottom"].includes(half)) throw new Error(`c4-device: a paddle has no '${half}' half`);
        entities.push(BEHAVIOUR_SELECT(half));
        states[BEHAVIOUR_SELECT(half)] = {state: String(behaviour), attributes: {}};
    }
    for (const [entity, spec] of Object.entries(setup.states ?? {})) {
        if (spec === null) delete states[entity];
        else states[entity] = haState(spec);
    }
    const device = {identifiers: [["mqtt", `zigbee2mqtt_${ieee}`]] as [string, string][], model_id: model, name: DEVICE_NAME, entities};
    const worldOf = (now: Record<string, HaState>, time = setup.time ?? "12:00:00"): HaWorld => ({devices: {[DEVICE_ID]: device}, states: now, time});

    const chooseOf = (a: Automation) => (a.action.find((s) => "choose" in s)?.choose ?? []) as Step[];
    const options = chooseOf(automation);
    // Which option is the LED feedback is read as the blueprint writes it, so an input (a button's action) never counts.
    const written = chooseOf(bp.automation as unknown as Automation);

    /** One run for one trigger variable, in a world: its top-level variables, its condition, and the LED feedback it reaches. */
    const run = (world: HaWorld, trigger: Record<string, unknown>): DeviceRun => {
        const env = haEnvironment(world);
        const vars = renderVariables(env, automation.variables, {this: null, trigger});
        const passes = automation.condition.every((c) => conditionPasses(env, c, vars));
        const {this: _this, trigger: _trigger, ...variables} = vars;
        // Each delay the LED feedback waits moves on the clock that now() reads in the steps after it.
        const start = world.time;
        const onDelay = (waited: number) => {
            world.time = later(start, waited);
        };
        return {...readRun(variables, passes), ...(passes ? ledFeedback(env, options, vars, `${SHARED_TOPIC}/${ieee}/set`, {onDelay, written}) : {leds: []})};
    };

    const triggerIdx = (pred: (t: Record<string, unknown>) => boolean) => {
        const idx = automation.trigger.findIndex(pred);
        if (idx < 0) throw new Error("c4-device: c4_device has no such trigger");
        return idx;
    };
    const eventIdx = triggerIdx((t) => kindOf(t) === "event.received");
    const eventTypes = (automation.trigger[eventIdx].options as {event_type: string[]}).event_type;

    // A paddle has two halves, Button 1 and Button 2, as the blueprint itself says.
    const paddle =
        renderVariables(haEnvironment(worldOf(states)), automation.variables, {this: null, trigger: {platform: "homeassistant", event: "start", id: "boot"}})
            .is_paddle === true;
    const checkButton = (n: number) => {
        if (paddle && n > 2) throw new Error(`c4-device: a ${model} is a paddle, with no Button ${n}`);
    };
    for (const n of Object.keys(setup.buttons ?? {})) checkButton(Number(n));

    const payloadOf = (h: Extract<Happening, {kind: "button" | "event"}>): Record<string, unknown> => {
        if (h.kind === "event") return h.payload;
        checkButton(h.button);
        const payload = h.payload(sequences({model, ieee, name: DEVICE_NAME}, h.button));
        if (!payload) throw new Error(`c4-device: the Contract fixture has no ${h.label} for a ${model}`);
        if (!declared.includes(String(payload.command))) throw new Error(`c4-device: a ${model} never sends ${payload.command} (${h.label})`);
        return payload;
    };

    /**
     * The device's events entity reports the event: event.received, when the entity
     * declares its type (Home Assistant drops any other) and c4_device starts on it.
     */
    const eventRuns = (payload: Record<string, unknown>): DeviceRun[] => {
        const before = states[EVENTS_ENTITY];
        const command = String(payload.command);
        if (!before || !(before.attributes.event_types as string[]).includes(command) || !eventTypes.includes(command)) return [];
        const after: HaState = {
            state: "2026-10-29T12:00:01.000+00:00",
            attributes: {...payload, event_type: payload.command, event_types: before.attributes.event_types},
        };
        const trigger = {
            platform: "event.received",
            id: "event",
            idx: String(eventIdx),
            entity_id: EVENTS_ENTITY,
            from_state: {entity_id: EVENTS_ENTITY, ...before},
            to_state: {entity_id: EVENTS_ENTITY, ...after},
        };
        return [run(worldOf({...states, [EVENTS_ENTITY]: after}), trigger)];
    };

    /** An entity's state changes: one run per state trigger that fires, in trigger order. */
    const changeRuns = (h: Extract<Happening, {kind: "change"}>): DeviceRun[] => {
        const before = h.from === undefined ? states[h.entity] : h.from === null ? undefined : haState(h.from);
        const after = h.to === null ? undefined : haState(h.to);
        const now = {...states};
        if (after) now[h.entity] = after;
        else delete now[h.entity];
        const stateObject = (s: HaState | undefined) => (s ? {entity_id: h.entity, ...s} : null);
        const out: DeviceRun[] = [];
        automation.trigger.forEach((t, idx) => {
            if (kindOf(t) !== "state" || ![t.entity_id ?? []].flat().includes(h.entity)) return;
            const attribute = t.attribute as string | undefined;
            // An attribute trigger fires when that attribute changes; `to: ~` on a change of the state itself.
            if (attribute) {
                if (JSON.stringify(before?.attributes[attribute] ?? null) === JSON.stringify(after?.attributes[attribute] ?? null)) return;
            } else if ((before?.state ?? null) === (after?.state ?? null)) return;
            const trigger = {
                platform: "state",
                entity_id: h.entity,
                from_state: stateObject(before),
                to_state: stateObject(after),
                for: null,
                attribute: attribute ?? null,
                id: t.id,
                idx: String(idx),
            };
            out.push(run(worldOf(now), trigger));
        });
        return out;
    };

    const runs = (h: Happening): DeviceRun[] => {
        switch (h.kind) {
            case "button":
            case "event":
                return eventRuns(payloadOf(h));
            case "change":
                return changeRuns(h);
            case "boot": {
                const idx = triggerIdx((t) => kindOf(t) === "homeassistant" && t.event === "start");
                return [run(worldOf(states), {platform: "homeassistant", event: "start", id: "boot", idx: String(idx)})];
            }
            case "reload": {
                const idx = triggerIdx((t) => kindOf(t) === "event" && t.event_type === "automation_reloaded");
                return [run(worldOf(states), {platform: "event", event: {event_type: "automation_reloaded", data: {}}, id: "reload", idx: String(idx)})];
            }
            case "clock": {
                const time = h.time ?? setup.time ?? "12:00:00";
                checkTime(time);
                const out: DeviceRun[] = [];
                automation.trigger.forEach((t, idx) => {
                    if (fires(t, time)) out.push(run(worldOf(states, time), {platform: kindOf(t), now: time, id: String(t.id), idx: String(idx)}));
                });
                return out;
            }
        }
    };

    const on = (h: Happening): Reaction => {
        const all = runs(h);
        const passing = all.filter((r) => r.passes);
        if (passing.length > 1) throw new Error(`c4-device: ${passing.length} runs pass for one happening (${passing.map((r) => r.trigger).join(", ")})`);
        const [one] = passing;
        const leds = one?.leds ?? [];
        return {
            does: one?.does ?? "nothing",
            button: one?.button ?? null,
            targets: one?.targets ?? [],
            leds,
            led: (name) => ledLook(leds, name),
            ...(one && "hears" in one ? {hears: one.hears} : {}),
            runs: all,
        };
    };

    /** Each event of the button's fixture sequence, as the happening of that button it is. */
    const play = (sequence: SequenceName, button: ButtonNumber): Reaction[] => {
        checkButton(button);
        const seq = sequences({model, ieee, name: DEVICE_NAME}, button)[sequence];
        if (!seq.length) throw new Error(`c4-device: the Contract fixture has no ${sequence} sequence for a ${model}`);
        return seq.map((s, i) =>
            on({kind: "button", button, label: `${sequence} event ${i + 1} (${s.payload.gesture})`, payload: (seqs) => seqs[sequence][i]?.payload}),
        );
    };

    return {ieee, model, runs, on, play};
}

/** The sequence a count is part of, in the fixture sequences. */
const SEQUENCE: Record<Exclude<TapCount, "quadruple">, "tap" | "double" | "triple"> = {single: "tap", double: "double", triple: "triple"};

/** The fixture has no quadruple tap: its triple's count, counted four (as c4-scenarios counts its triple from the double). */
function countedFour(count: Happening & {kind: "button"}, gesture: "fast_quadruple" | "quadruple"): Happening {
    return {...count, label: count.label.replace("triple", "quadruple"), payload: (seqs) => asGesture(count.payload(seqs), gesture)};
}

/** A Contract payload as the same button's other gesture. */
function asGesture(p: Record<string, unknown> | undefined, gesture: "fast_quadruple" | "quadruple" | "hold"): Record<string, unknown> | undefined {
    return p && {...p, gesture, command: GESTURES[gesture], action: `${p.button}_${gesture}`};
}

/** The gesture `gesture` in sequence `from`, re-addressed to the button. */
function gestureOf(
    button: ButtonNumber,
    label: string,
    from: keyof ReturnType<typeof sequences>,
    gesture: string,
    also: Record<string, unknown> = {},
): Happening {
    return {
        kind: "button",
        button,
        label,
        payload: (seqs) => seqs[from].map((e) => e.payload).find((p) => p.gesture === gesture && Object.entries(also).every(([k, v]) => p[k] === v)),
    };
}

/** The button's known tap with this tap index (1 = the first tap of its sequence). */
export function knownTap(button: ButtonNumber, tapIndex = 1): Happening {
    const from = tapIndex === 1 ? "tap" : tapIndex === 2 ? "double" : "triple";
    return gestureOf(button, `known tap #${tapIndex}`, from, "tap_known", {tap_index: tapIndex});
}

/** The extension's fast count of the button's tap sequence; `known`: whether every tap of it was a known tap (default true). */
export function fastCount(button: ButtonNumber, n: TapCount = "single", {known = true}: {known?: boolean} = {}): Happening {
    if (n === "quadruple") return countedFour(fastCount(button, "triple", {known}) as Happening & {kind: "button"}, "fast_quadruple");
    const from = n === "single" && !known ? "unknownTap" : SEQUENCE[n];
    return gestureOf(button, `fast ${n} (known_taps ${known})`, from, `fast_${n}`, {known_taps: known});
}

/** The device's own count of the button's tap sequence. */
export function deviceCount(button: ButtonNumber, n: TapCount = "single"): Happening {
    if (n === "quadruple") return countedFour(deviceCount(button, "triple") as Happening & {kind: "button"}, "quadruple");
    return gestureOf(button, `device count ${n}`, SEQUENCE[n], n);
}

/** The button's paddle-down. */
export function press(button: ButtonNumber): Happening {
    return gestureOf(button, "press", "tap", "press");
}

/** The button's release after a tap. */
export function release(button: ButtonNumber): Happening {
    return gestureOf(button, "release", "tap", "release");
}

/** The button's hold event. The fixture has no DIM1-Z hold: its press, held. */
export function hold(button: ButtonNumber): Happening {
    const fixture = gestureOf(button, "hold", "hold", "hold") as Happening & {kind: "button"};
    const pressed = press(button) as Happening & {kind: "button"};
    return {
        ...fixture,
        payload: (seqs) => {
            const held = fixture.payload(seqs);
            return held || seqs.hold.length ? held : asGesture(pressed.payload(seqs), "hold");
        },
    };
}

/** Any Contract payload, as given. */
export function event(payload: Record<string, unknown>): Happening {
    return {kind: "event", payload};
}

/** An entity's state changes to `to`, from `from` (default: its state in the setup). */
export function change(entity: string, to: StateSpec, from?: StateSpec): Happening {
    return from === undefined ? {kind: "change", entity, to} : {kind: "change", entity, to, from};
}

/** Home Assistant starts. */
export function boot(): Happening {
    return {kind: "boot"};
}

/** The automations are reloaded (or this one is saved). */
export function reload(): Happening {
    return {kind: "reload"};
}

/** The clock reaches `time` (default: the setup's): each time trigger due then fires (Night start / end, the LED re-check). */
export function clock(time?: string): Happening {
    return time === undefined ? {kind: "clock"} : {kind: "clock", time};
}

/** A Tap action that is one scene.apply: each light at a brightness (0-255), or off. */
export function sceneApply(levels: Record<string, number | "off">): unknown[] {
    const entities = Object.fromEntries(Object.entries(levels).map(([e, l]) => [e, l === "off" ? "off" : {state: "on", brightness: l}]));
    return [{action: "scene.apply", data: {entities}}];
}

/** The conformance probe only: the same environment, raw output as HA's render_template gives it. */
export function renderTemplate(source: string, variables: Record<string, unknown> = {}): string {
    return haEnvironment().renderStr(source, variables);
}
