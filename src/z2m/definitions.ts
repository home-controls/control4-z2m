/**
 * Zigbee2MQTT device definitions for every Control4 family.
 *
 * Exposes are static data built with zigbee-herdsman-converters' exposes; every
 * /set and /get key is handled by the runtime that the extension installs on
 * globalThis, so this bundle carries no device logic of its own.
 */

import * as exposesModule from "zigbee-herdsman-converters/lib/exposes";

import {
    APD120_TV_PARAMS,
    AUTO_REBOOT_OPTION,
    AUX_BUTTONS,
    BMC_DEFAULTS,
    BUTTON_BEHAVIOUR_NAMES,
    COUNTER_GESTURES,
    DEFAULT_TAP_WINDOW_MS,
    DIM1Z_TV_PARAMS,
    FAN_BUTTONS,
    type Family,
    GENERIC_MODEL,
    type Gesture,
    KC_LAYOUT_OPTION,
    KC_LED_SLOTS,
    KC_NUMBERING_OPTION,
    KC_POSITIONS,
    type KcLayout,
    kcButtonNumber,
    LED_MODE_NAMES,
    MANUFACTURER,
    MAX_TAP_WINDOW_MS,
    MIN_TAP_WINDOW_MS,
    MODELS,
    PADDLE_HALVES,
    PALETTE_NAMES,
    POWER_KEYS,
    REBOOT_KEY,
    REMOTE_GESTURES,
    SR250_BUTTONS,
    SR260_BUTTONS,
    TAP_GESTURES,
    TAP_WINDOW_OPTION,
    type TvParam,
    TX_POWER_MAX,
    TX_POWER_MIN,
    Z2IO_CONTACTS_HW,
    Z2IO_DEFAULT_MODE,
    Z2IO_MODES,
} from "../core/constants";
import {RUNTIME_KEY} from "./global";

// biome-ignore lint/suspicious/noExplicitAny: CJS interop across converter versions
const ex: any = (exposesModule as any).presets ? exposesModule : (exposesModule as any).default;
// biome-ignore lint/suspicious/noExplicitAny: expose objects
type Expose = any;
const e = ex.presets;
const ea = ex.access;

// ---------------------------------------------------------------------------
// Runtime bridge
// ---------------------------------------------------------------------------

interface RuntimeApi {
    set(ieee: string, key: string, value: unknown, meta: {message: Record<string, unknown>; endpoint?: string}): Promise<Record<string, unknown> | undefined>;
    getValue(ieee: string, key: string): Promise<void>;
    seedModel(ieee: string, model: string): string;
    z2ioMode(ieee: string): number | undefined;
    kcLayout?(ieee: string): KcLayout | undefined;
}

const NOT_RUNNING = "Control4 extension is not running - install control4.mjs in external_extensions (see the README)";

function runtime(): RuntimeApi {
    const rt = (globalThis as Record<string, unknown>)[RUNTIME_KEY] as RuntimeApi | undefined;
    if (!rt) throw new Error(NOT_RUNNING);
    return rt;
}

/**
 * How long a /set or /get waits for the extension to start. Zigbee2MQTT takes MQTT
 * commands a few seconds before its extensions are running (#60), and Home Assistant
 * sends nothing again: an automation's command in that window would be lost.
 */
export const RUNTIME_WAIT_MS = 15_000;
const RUNTIME_POLL_MS = 100;

/** Commands waiting for the extension, in the order they arrived. */
const waiting: {resolve: (rt: RuntimeApi) => void; reject: (e: Error) => void; deadline: number}[] = [];
// biome-ignore lint/correctness/noUnusedVariables: read by the ??= guard below, which biome counts as a write only
let waitTimer: ReturnType<typeof setTimeout> | undefined;

function pollRuntime(): void {
    waitTimer = undefined;
    const rt = (globalThis as Record<string, unknown>)[RUNTIME_KEY] as RuntimeApi | undefined;
    // All at once, in arrival order: ON then OFF must not reach the device as OFF then ON.
    if (rt) for (const w of waiting.splice(0)) w.resolve(rt);
    const now = Date.now();
    while (waiting.length && waiting[0].deadline <= now) waiting.shift()?.reject(new Error(NOT_RUNNING));
    if (waiting.length) waitTimer = setTimeout(pollRuntime, RUNTIME_POLL_MS);
}

/** The runtime, once the extension is running: waits up to RUNTIME_WAIT_MS for it, behind any command already waiting. */
function readyRuntime(): Promise<RuntimeApi> {
    const rt = (globalThis as Record<string, unknown>)[RUNTIME_KEY] as RuntimeApi | undefined;
    if (rt && !waiting.length) return Promise.resolve(rt);
    return new Promise((resolve, reject) => {
        waiting.push({resolve, reject, deadline: Date.now() + RUNTIME_WAIT_MS});
        waitTimer ??= setTimeout(pollRuntime, RUNTIME_POLL_MS);
    });
}

// biome-ignore lint/suspicious/noExplicitAny: converter meta
function converter(keys: string[], endpoints?: string[]): any {
    return {
        key: keys,
        ...(endpoints ? {endpoints} : {}),
        // biome-ignore lint/suspicious/noExplicitAny: converter meta
        convertSet: async (_entity: unknown, key: string, value: unknown, meta: any) => {
            const ieee = String(meta.device.ieeeAddr).toLowerCase();
            const rt = await readyRuntime();
            if (key === "c4_model") {
                const model = rt.seedModel(ieee, String(value));
                return {state: {c4_model: model}};
            }
            const state = await rt.set(ieee, key, value, {message: meta.message ?? {[key]: value}, endpoint: meta.endpoint_name});
            return state ? {state} : undefined;
        },
        // biome-ignore lint/suspicious/noExplicitAny: converter meta
        convertGet: async (_entity: unknown, key: string, meta: any) => {
            await (await readyRuntime()).getValue(String(meta.device.ieeeAddr).toLowerCase(), key);
        },
    };
}

const COMMON_KEYS = ["c4_send", "c4_get", "c4_raw", "c4_identify", "c4_model", "send_raw", "send_get"];
/** The ZHA LED cluster (0xFC43) commands, on every c4.dmx-family device. */
const LED_CLUSTER_KEYS = ["set_led_color", "set_led_mode", "set_led_all_same_color", "set_all_led_modes", "set_led_single_on"];
/** The ZHA ramp cluster (0xFC44) commands, on the dimmers. */
const RAMP_KEYS = ["set_ramp_rate", "set_on_ramp", "set_off_ramp", "set_on_off_ramps"];
const LIGHT_KEYS = ["state", "brightness", "transition"];
const LED_ENGINE_KEYS = ["led_effect", "led_status", "led_stop", "led_refresh"];
const REMOTE_KEYS = [
    "room_name",
    "active_source",
    "set_room_info",
    "show_list",
    "close_list",
    "display_message",
    "display_icon",
    "gi_icon",
    "gi_max_items",
    "gi_reply_ep",
    "gi_template",
    "gi_item_template",
];

/** One converter per key, so a message carrying several keys runs them all. */
function converters(keys: string[], grouped: string[][] = []): unknown[] {
    const groupedKeys = new Set(grouped.flat());
    return [...grouped.map((g) => converter(g)), ...keys.filter((k) => !groupedKeys.has(k)).map((k) => converter([k]))];
}

// ---------------------------------------------------------------------------
// Expose helpers
// ---------------------------------------------------------------------------

function actions(buttons: string[], gestures: Gesture[], extra: string[] = []): Expose {
    const values: string[] = [];
    for (const b of buttons) for (const g of gestures) values.push(`${b}_${g}`);
    return e.action([...values, ...extra]);
}

function ledColor(key: string, label: string): Expose {
    return e
        .enum(key, ea.STATE_SET, [...PALETTE_NAMES])
        .withLabel(label)
        .withDescription(`${label} (the device keeps it; brightness scales it)`)
        .withCategory("config");
}

function ledMode(key: string, label: string): Expose {
    return e
        .enum(key, ea.STATE_SET, [...LED_MODE_NAMES])
        .withLabel(label)
        .withDescription(
            "How the LED picks its colour: follow_load (on colour while the load is on, off colour while off), push_release (pressed colour while its button is held), or programmed (a colour set from outside, as a status colour)",
        )
        .withCategory("config");
}

/** Device options: how often the polled sensors are read (a busy mesh can stretch or stop them). */
function pollOptions(power: boolean): Expose[] {
    const opt = (key: string, what: string) =>
        e
            .numeric(key, ea.SET)
            .withValueMin(0)
            .withValueMax(86400)
            .withUnit("s")
            .withDescription(`Seconds between ${what} reads (default 30, minimum 10; 0 = never poll, announcements still arrive)`);
    return [opt("ambient_light_poll", "ambient light"), ...(power ? [opt("power_poll", "power and energy")] : [])];
}

/** Device option: how long a tap sequence stays open for another tap (read as each sequence starts). */
function tapWindowOption(): Expose {
    return e
        .numeric(TAP_WINDOW_OPTION, ea.SET)
        .withValueMin(MIN_TAP_WINDOW_MS / 1000)
        .withValueMax(MAX_TAP_WINDOW_MS / 1000)
        .withValueStep(0.05)
        .withUnit("s")
        .withDescription(
            `Seconds a tap sequence stays open for another tap before its fast count is published (default ${DEFAULT_TAP_WINDOW_MS / 1000}); wider for slow tappers, narrower for a faster single tap`,
        );
}

/** KC120277 device option: number buttons by two-slot paddle (default) or by single slot. */
function kcNumberingOption(): Expose {
    return e
        .enum(KC_NUMBERING_OPTION, ea.SET, ["pairs", "slots", "fitted"])
        .withDescription(
            "pairs (default): every button is a two-slot paddle, numbered 1, 2, 3 from the top. slots: each position has its own number 1-7 (a double-height button takes its top position's number). fitted: the fitted buttons are numbered 1, 2, 3 from the top, whatever their size",
        );
}

/** KC120277 device option: the fitted buttons' positions, when learning them from presses isn't wanted. */
function kcLayoutOption(): Expose {
    return e
        .text(KC_LAYOUT_OPTION, ea.SET)
        .withDescription(
            "Positions of the fitted buttons from the top, 1-7 (for example 1, 3, 5 for three double-height buttons). Empty: learned from the buttons the keypad sends from, so press each one once after pairing",
        );
}

function ledBrightness(): Expose {
    return e
        .numeric("led_brightness", ea.STATE_SET)
        .withValueMin(1)
        .withValueMax(100)
        .withValueStep(1)
        .withUnit("%")
        .withLabel("LED brightness")
        .withDescription("Scales every LED colour (the protocol has no brightness register)")
        .withCategory("config");
}

function ledTransition(): Expose {
    return e
        .numeric("led_transition", ea.STATE_SET)
        .withValueMin(0)
        .withValueMax(10)
        .withValueStep(0.5)
        .withUnit("s")
        .withLabel("LED transition")
        .withDescription("Crossfade time for idle-colour changes (0 = instant)")
        .withCategory("config");
}

function ledNotification(): Expose {
    return e
        .binary("led_notification", ea.STATE, true, false)
        .withLabel("LED notification")
        .withDescription("An LED effect owns the LEDs right now")
        .withCategory("diagnostic");
}

function transitions(): Expose[] {
    return [
        e
            .numeric("on_transition", ea.STATE_SET)
            .withValueMin(0)
            .withValueMax(60)
            .withValueStep(0.1)
            .withUnit("s")
            .withLabel("Turn-on fade")
            .withDescription("Fade when turned on (also stored in the dimmer's own ramp table)")
            .withCategory("config"),
        e
            .numeric("off_transition", ea.STATE_SET)
            .withValueMin(0)
            .withValueMax(60)
            .withValueStep(0.1)
            .withUnit("s")
            .withLabel("Turn-off fade")
            .withDescription("Fade when turned off (also stored in the dimmer's own ramp table)")
            .withCategory("config"),
    ];
}

function tvParams(params: TvParam[]): Expose[] {
    return params.map((p) => {
        const slot = `c4.dm.tv 0x${p.index.toString(16).padStart(2, "0")}`;
        return e
            .numeric(p.key, ea.STATE_SET)
            .withValueMin(0)
            .withValueMax(p.kind === "percent" ? 100 : 10000)
            .withValueStep(p.kind === "percent" ? 1 : 100)
            .withUnit(p.kind === "percent" ? "%" : "ms")
            .withLabel(p.label)
            .withDescription(p.description ? `${p.description} (${slot})` : `Dimmer parameter ${slot}`)
            .withCategory("config");
    });
}

/** A write-only enum with one value: Home Assistant shows it as a button. */
function rebootButton(): Expose {
    return (
        e
            .enum(REBOOT_KEY, ea.SET, ["reboot"])
            .withLabel("Reboot")
            .withDescription(
                "Restart the dimmer remotely: back in about 2 s, its light staying as it is and its settings kept (its LEDs flash green, then white)",
            )
            // A settable expose can't be "diagnostic" in Zigbee2MQTT.
            .withCategory("config")
    );
}

/** DIM1-Z device option: whether the extension reboots the dimmer when it stops answering or keeps re-joining. */
function autoRebootOption(): Expose {
    return e
        .binary(AUTO_REBOOT_OPTION, ea.SET, true, false)
        .withDescription(
            "Reboot this dimmer remotely when it stops answering or keeps re-joining (3 times within 3.5 h): up to 3 times a day, an hour or more apart. Default true",
        );
}

function paddleLocalControl(): Expose {
    return e
        .binary("paddle_local_control", ea.STATE_SET, "ON", "OFF")
        .withLabel("Paddle controls local load")
        .withDescription("Off: the paddle only reports taps; the load is controlled from Zigbee2MQTT alone")
        .withCategory("config");
}

function ambient(): Expose {
    return e
        .numeric("ambient_light", ea.STATE_GET)
        .withValueMin(0)
        .withValueMax(255)
        .withLabel("Ambient light")
        .withDescription("Raw photodiode reading 0-255 (not lux)");
}

/** The load's power reading (c4.dmx.pwr, and after the level in each c4.dmx.ls). */
function powerSensors(): Expose[] {
    return [
        e.power().withAccess(ea.STATE_GET).withDescription("Real power the load draws"),
        e.voltage().withAccess(ea.STATE_GET).withDescription("Line voltage"),
        e.current().withAccess(ea.STATE_GET).withDescription("Current the load draws"),
        e.power_apparent().withAccess(ea.STATE_GET).withDescription("Apparent power the load draws"),
        e.power_factor().withAccess(ea.STATE_GET).withDescription("Power factor of the load"),
        e
            .energy()
            .withAccess(ea.STATE_GET)
            .withDescription("Energy the load has used: the device's lifetime counter (about 1.27 Wh a count), carried across its reboots"),
    ];
}

function multiclickTimes(): Expose[] {
    return BMC_DEFAULTS.map((_, i) =>
        e
            .numeric(`multiclick_time_${i + 1}`, ea.STATE_SET)
            .withValueMin(50)
            .withValueMax(5000)
            .withValueStep(10)
            .withUnit("ms")
            .withLabel(`Multi-click time ${i + 1}`)
            .withDescription("How long the device waits to resolve taps (lower = faster single tap)")
            .withCategory("config"),
    );
}
const MULTICLICK_KEYS = BMC_DEFAULTS.map((_, i) => `multiclick_time_${i + 1}`);

/** What the Gen3 board (KC120277 / APD120 / SW120277) tells about itself, and its radio power. */
function gen3Health(fault: boolean): Expose[] {
    const out: Expose[] = [
        e
            .text("reset_reason", ea.STATE)
            .withLabel("Reset reason")
            .withDescription("Why the device last restarted (c4.sy.ri; EmberZNet's code in brackets)")
            .withCategory("diagnostic"),
        e.text("firmware_version", ea.STATE).withLabel("Firmware version").withDescription("c4.sy.fwv").withCategory("diagnostic"),
        e.text("bootloader_version", ea.STATE).withLabel("Bootloader version").withDescription("c4.sy.blv").withCategory("diagnostic"),
        e
            .numeric("tx_power", ea.STATE_SET)
            .withValueMin(TX_POWER_MIN)
            .withValueMax(TX_POWER_MAX)
            .withValueStep(1)
            .withUnit("dBm")
            .withLabel("TX power")
            .withDescription("Radio transmit power (c4.sy.zpw); Control4 provisions 0. Put back after a re-join if the device has lost it")
            .withCategory("config"),
    ];
    if (fault)
        out.push(
            e
                .binary("fault", ea.STATE, true, false)
                .withLabel("Fault")
                .withDescription("The device reports a fault on its load: a short circuit or an overload (c4.dmx.warn)")
                .withCategory("diagnostic"),
        );
    return out;
}
const GEN3_KEYS = [...MULTICLICK_KEYS, "tx_power"];

/** A paddle half's button behaviour. */
function behaviours(): Expose[] {
    return PADDLE_HALVES.map((h) =>
        e
            .enum(`${h.half}_button_behaviour`, ea.STATE_SET, [...BUTTON_BEHAVIOUR_NAMES])
            .withLabel(`${h.half === "top" ? "Top" : "Bottom"} button behaviour`)
            .withDescription(
                `What the ${h.half} half does to the load when pressed: load_on, load_off, toggle, momentary (dims while held, back on release) or event_only (only sends its taps). Factory: ${h.factory}`,
            )
            .withCategory("config"),
    );
}
const BEHAVIOUR_KEYS = PADDLE_HALVES.map((h) => `${h.half}_button_behaviour`);

/** The two LEDs of an APD120 / SW120277 (slots 01 and 04), by the DIM1-Z's key names. */
function paddleLeds(): Expose[] {
    const out: Expose[] = [];
    for (const h of PADDLE_HALVES) {
        const name = h.half === "top" ? "Top" : "Bottom";
        out.push(
            ledColor(`led_${h.half}_on_color`, `${name} LED on colour`),
            ledColor(`led_${h.half}_off_color`, `${name} LED off colour`),
            ledMode(`led_${h.half}_mode`, `${name} LED mode`),
        );
    }
    return out;
}
const PADDLE_LED_KEYS = PADDLE_HALVES.flatMap((h) => [`led_${h.half}_on_color`, `led_${h.half}_off_color`, `led_${h.half}_mode`]);

function names(map: Record<number, string>): string[] {
    return [...new Set(Object.values(map))];
}

const keypadNames = (n: number) => Array.from({length: n}, (_, i) => `button_${i + 1}`);

// ---------------------------------------------------------------------------
// Per family
// ---------------------------------------------------------------------------

interface FamilyDef {
    exposes: Expose[] | ((device: unknown, options: unknown) => Expose[]);
    keys: string[];
    grouped?: string[][];
    endpoint?: () => Record<string, number>;
    options?: Expose[];
    multiEndpoint?: boolean;
}

function z2ioExposes(mode: number): Expose[] {
    const m = Z2IO_MODES[mode] ?? Z2IO_MODES[Z2IO_DEFAULT_MODE];
    const out: Expose[] = [];
    for (let r = 1; r <= m.relays; r++) {
        out.push(e.binary(`relay_${r}`, ea.ALL, "ON", "OFF").withLabel(`Relay ${r}`).withDescription(`Relay ${r} (latched)`));
        out.push(e.enum(`relay_${r}_pulse`, ea.SET, ["pulse"]).withLabel(`Pulse relay ${r}`).withDescription("Energise then release (garage door opener)"));
    }
    for (let c = 1; c <= Math.min(m.contacts, Z2IO_CONTACTS_HW); c++) {
        out.push(e.binary(`contact_${c}`, ea.STATE, false, true).withLabel(`Contact ${c}`).withDescription("On = open, off = closed"));
    }
    out.push(
        e.temperature(),
        e
            .numeric("external_temperature", ea.STATE)
            .withUnit("°C")
            .withLabel("External temperature")
            .withDescription("External probe (absent when no probe is connected)"),
        e.humidity(),
        e
            .numeric("pulse_duration", ea.STATE_SET)
            .withValueMin(100)
            .withValueMax(5000)
            .withValueStep(50)
            .withUnit("ms")
            .withLabel("Pulse duration")
            .withCategory("config"),
        e
            .enum(
                "io_mode",
                ea.STATE_SET,
                Object.values(Z2IO_MODES).map((v) => v.name),
            )
            .withLabel("IO mode")
            .withDescription("How the two relays / five contacts are used (c4.z2x.opt)")
            .withCategory("config"),
        e.action(["contact_state_changed", "relay_state_changed"]),
    );
    return out;
}

function dimmingPhase(): Expose {
    return e
        .enum("dimming_phase", ea.STATE, ["forward", "reverse", "none", "other"])
        .withLabel("Dimming phase")
        .withDescription("The dimming phase in use (c4.dmx.dim): forward or reverse, as the dimmer detected for its load")
        .withCategory("diagnostic");
}

/** The KC120277's keys, which the keypad dimmer has too. */
const KC_KEYS = [
    "led_brightness",
    "led_transition",
    // led_N_bound stays as a key: on = push_release, off = programmed.
    ...Array.from({length: KC_LED_SLOTS}, (_, i) => [
        `led_${i + 1}_idle_color`,
        `led_${i + 1}_pressed_color`,
        `led_${i + 1}_mode`,
        `led_${i + 1}_bound`,
    ]).flat(),
    "backlight_color",
    "backlight_brightness",
    "ambient_light",
    ...LED_ENGINE_KEYS,
    ...LED_CLUSTER_KEYS,
    ...GEN3_KEYS,
];
const POSITION_BEHAVIOUR_KEYS = Array.from({length: KC_POSITIONS}, (_, i) => `button_position_${i + 1}_behaviour`);

const FAMILIES: Record<Family, FamilyDef> = {
    apd120: {
        exposes: [
            e.light_brightness(),
            actions(["top", "bottom"], [...TAP_GESTURES, ...COUNTER_GESTURES], ["led_notification_start", "led_notification_end"]),
            ...transitions(),
            ...tvParams(APD120_TV_PARAMS),
            ...behaviours(),
            ...multiclickTimes(),
            ledBrightness(),
            ledTransition(),
            ...paddleLeds(),
            ledNotification(),
            ambient(),
            ...powerSensors(),
            dimmingPhase(),
            ...gen3Health(true),
        ],
        keys: [
            ...LIGHT_KEYS,
            "on_transition",
            "off_transition",
            ...RAMP_KEYS,
            ...LED_CLUSTER_KEYS,
            ...APD120_TV_PARAMS.map((p) => p.key),
            ...BEHAVIOUR_KEYS,
            ...PADDLE_LED_KEYS,
            "led_brightness",
            "led_transition",
            ...LED_ENGINE_KEYS,
            "ambient_light",
            ...POWER_KEYS,
            ...GEN3_KEYS,
        ],
        grouped: [LIGHT_KEYS],
        options: [...pollOptions(true), tapWindowOption()],
    },
    dim1z: {
        exposes: [
            e.light_brightness(),
            actions(
                ["button_1", "button_2"],
                ["press", "single", "double", "triple", "quadruple", "hold", "hold_release", ...COUNTER_GESTURES],
                ["led_notification_start", "led_notification_end"],
            ),
            ...transitions(),
            ...tvParams(DIM1Z_TV_PARAMS),
            paddleLocalControl(),
            ledColor("led_top_on_color", "Top LED on colour"),
            ledColor("led_top_off_color", "Top LED off colour"),
            ledColor("led_bottom_on_color", "Bottom LED on colour"),
            ledColor("led_bottom_off_color", "Bottom LED off colour"),
            ledBrightness(),
            ledNotification(),
            rebootButton(),
        ],
        keys: [
            ...LIGHT_KEYS,
            "on_transition",
            "off_transition",
            ...RAMP_KEYS,
            ...LED_CLUSTER_KEYS,
            ...DIM1Z_TV_PARAMS.map((p) => p.key),
            "paddle_local_control",
            "led_top_on_color",
            "led_top_off_color",
            "led_bottom_on_color",
            "led_bottom_off_color",
            "led_brightness",
            ...LED_ENGINE_KEYS,
            REBOOT_KEY,
        ],
        grouped: [LIGHT_KEYS],
        options: [tapWindowOption(), autoRebootOption()],
    },
    sw120277: {
        exposes: [
            e.switch(),
            actions(["top", "bottom"], [...TAP_GESTURES, ...COUNTER_GESTURES], ["led_notification_start", "led_notification_end"]),
            ...behaviours(),
            ...multiclickTimes(),
            ledBrightness(),
            ledTransition(),
            ...paddleLeds(),
            ledNotification(),
            ambient(),
            ...powerSensors(),
            ...gen3Health(true),
        ],
        // paddle_local_control stays as a key (on = top load_on / bottom load_off, off = both event_only).
        keys: [
            "state",
            "paddle_local_control",
            ...BEHAVIOUR_KEYS,
            ...LED_CLUSTER_KEYS,
            ...PADDLE_LED_KEYS,
            "led_brightness",
            "led_transition",
            ...LED_ENGINE_KEYS,
            "ambient_light",
            ...POWER_KEYS,
            ...GEN3_KEYS,
        ],
        options: [...pollOptions(true), tapWindowOption()],
    },
    fs1z: {
        exposes: [
            e.switch().withDescription("Fireplace (deliberately a switch, never a light)"),
            // As the DIM1-Z: paddle-down, no release (#51).
            actions(["button_1", "button_2"], ["press", "single", "double", "triple", "quadruple", "hold", "hold_release", ...COUNTER_GESTURES]),
        ],
        keys: ["state"],
        options: [tapWindowOption()],
    },
    fan: {
        exposes: [e.fan().withState().withSpeed(1, 4), actions(names(FAN_BUTTONS), [...TAP_GESTURES, ...COUNTER_GESTURES])],
        keys: ["state", "speed", ...LED_CLUSTER_KEYS],
        grouped: [["state", "speed"]],
        options: [tapWindowOption()],
    },
    outlet: {
        exposes: [e.switch().withEndpoint("l1"), e.switch().withEndpoint("l2"), actions(["outlet_1", "outlet_2"], [...TAP_GESTURES, ...COUNTER_GESTURES])],
        keys: ["state"],
        endpoint: () => ({l1: 1, l2: 11}),
        multiEndpoint: true,
        options: [tapWindowOption()],
    },
    outlet_dimmer: {
        exposes: [
            e.light_brightness().withEndpoint("l1"),
            e.light_brightness().withEndpoint("l2"),
            actions(["outlet_1", "outlet_2"], [...TAP_GESTURES, ...COUNTER_GESTURES]),
        ],
        keys: LIGHT_KEYS,
        grouped: [LIGHT_KEYS],
        endpoint: () => ({l1: 1, l2: 11}),
        multiEndpoint: true,
        options: [tapWindowOption()],
    },
    rosw120: {
        exposes: [e.switch().withDescription("The switched outlet"), actions(["button_1"], [...TAP_GESTURES, ...COUNTER_GESTURES])],
        keys: ["state"],
        options: [tapWindowOption()],
    },
    kc120277: {
        exposes: (device: unknown) => kcExposes(kcLayoutOf(device)),
        keys: KC_KEYS,
        options: [...pollOptions(false), tapWindowOption(), kcNumberingOption(), kcLayoutOption()],
    },
    kd120: {
        exposes: (device: unknown) => kdExposes(kcLayoutOf(device)),
        keys: [
            ...LIGHT_KEYS,
            "on_transition",
            "off_transition",
            ...RAMP_KEYS,
            ...APD120_TV_PARAMS.map((p) => p.key),
            ...KC_KEYS,
            ...POSITION_BEHAVIOUR_KEYS,
            ...POWER_KEYS,
        ],
        grouped: [LIGHT_KEYS],
        options: [...pollOptions(true), tapWindowOption(), kcNumberingOption(), kcLayoutOption()],
    },
    kp2: keypadFamily(2),
    kp3: keypadFamily(3),
    kp6: keypadFamily(6),
    z2io: {
        exposes: (device: unknown) => {
            const ieee = (device as {ieeeAddr?: string})?.ieeeAddr;
            let mode: number | undefined;
            try {
                mode = ieee ? runtime().z2ioMode(ieee.toLowerCase()) : undefined;
            } catch {
                mode = undefined;
            }
            return z2ioExposes(mode ?? Z2IO_DEFAULT_MODE);
        },
        keys: ["relay_1", "relay_2", "relay_1_pulse", "relay_2_pulse", "pulse_duration", "io_mode", "poll", "temperature", "humidity", "external_temperature"],
    },
    sr250: remoteFamily(SR250_BUTTONS, false),
    sr260: remoteFamily(SR260_BUTTONS, true),
};

/** A KC120277's (or keypad dimmer's) button layout as the runtime knows it; every position while it doesn't. */
function kcLayoutOf(device: unknown): KcLayout {
    const ieee = (device as {ieeeAddr?: string})?.ieeeAddr;
    let layout: KcLayout | undefined;
    try {
        layout = ieee ? runtime().kcLayout?.(ieee.toLowerCase()) : undefined;
    } catch {
        layout = undefined;
    }
    return layout ?? {wires: undefined, numbering: "pairs"};
}

/** A KC120277's exposes: its keypad, and what the Gen3 board tells about itself. */
export function kcExposes(layout: KcLayout): Expose[] {
    return [...kcKeypadExposes(layout), ...gen3Health(false)];
}

/**
 * A keypad dimmer's exposes (C4-KD120: an APD120 and a KC120277 in one device): the
 * APD120's light and settings, the KC120277's keypad, and each fitted button's
 * behaviour toward the load (every position's while the buttons aren't known).
 */
export function kdExposes(layout: KcLayout): Expose[] {
    const wires = layout.wires ?? Array.from({length: KC_POSITIONS}, (_, i) => i);
    return [
        e.light_brightness(),
        ...transitions(),
        ...tvParams(APD120_TV_PARAMS),
        ...kcKeypadExposes(layout, names(AUX_BUTTONS)),
        ...wires.map((w) =>
            e
                .enum(`button_position_${w + 1}_behaviour`, ea.STATE_SET, [...BUTTON_BEHAVIOUR_NAMES])
                .withLabel(`Position ${w + 1} button behaviour`)
                .withDescription(
                    `What the button at position ${w + 1} from the top does to the load: load_on, load_off, toggle, momentary (dims while held, back on release) or event_only (only sends its taps). Factory: toggle`,
                )
                .withCategory("config"),
        ),
        ...powerSensors(),
        dimmingPhase(),
        ...gen3Health(true),
    ];
}

/**
 * The keypad of a KC120277 or keypad dimmer. With its fitted buttons known (learned
 * from presses or set), only they get actions and only their LEDs get entities, each
 * LED named for the button it lights; before that, every position and LED slot.
 */
function kcKeypadExposes(layout: KcLayout, extraButtons: string[] = []): Expose[] {
    const wires = layout.wires;
    const buttonNames = wires
        ? [...new Set(wires.map((w) => `button_${kcButtonNumber(w, layout)}`))]
        : Array.from({length: KC_POSITIONS}, (_, i) => `button_${i + 1}`);
    // A button lights the LED slots of the positions it covers: from its own wire down to the
    // next fitted button's, at most three (a triple-height button).
    const leds: Expose[] = [];
    const add = (slot: number, label: string) =>
        leds.push(
            ledColor(`led_${slot + 1}_idle_color`, `${label} idle colour`),
            ledColor(`led_${slot + 1}_pressed_color`, `${label} pressed colour`),
            ledMode(`led_${slot + 1}_mode`, `${label} mode`),
        );
    if (wires) {
        wires.forEach((w, i) => {
            const n = kcButtonNumber(w, layout);
            const span = Math.max(1, Math.min(3, (wires[i + 1] ?? KC_POSITIONS) - w));
            for (let k = 0; k < span && w + k < KC_LED_SLOTS; k++) add(w + k, k === 0 ? `Button ${n} LED` : `Button ${n} LED ${k + 1} (slot ${w + k + 1})`);
        });
    } else {
        for (let slot = 0; slot < KC_LED_SLOTS; slot++) add(slot, `LED ${slot + 1}`);
    }
    return [
        actions([...buttonNames, ...extraButtons], [...TAP_GESTURES, ...COUNTER_GESTURES], ["led_notification_start", "led_notification_end"]),
        ledBrightness(),
        ledTransition(),
        ...leds,
        ledColor("backlight_color", "Backlight colour").withDescription("Colour of the light behind the buttons' engraving (c4.dmx.blc); off turns it off"),
        e
            .numeric("backlight_brightness", ea.STATE_SET)
            .withValueMin(0)
            .withValueMax(100)
            .withValueStep(1)
            .withUnit("%")
            .withLabel("Backlight brightness")
            .withDescription("Brightness of the light behind the buttons' engraving (c4.dmx.blc)")
            .withCategory("config"),
        ...multiclickTimes(),
        ambient(),
        ledNotification(),
    ];
}

function keypadFamily(n: number): FamilyDef {
    const ex2: Expose[] = [
        actions(keypadNames(n), [...TAP_GESTURES, ...COUNTER_GESTURES], ["led_notification_start", "led_notification_end"]),
        ledBrightness(),
        ledTransition(),
    ];
    const keys = ["led_brightness", "led_transition", ...LED_ENGINE_KEYS, ...LED_CLUSTER_KEYS];
    for (let i = 1; i <= n; i++) {
        ex2.push(ledColor(`button_${i}_idle_color`, `Button ${i} idle colour`), ledColor(`button_${i}_pressed_color`, `Button ${i} pressed colour`));
        keys.push(`button_${i}_idle_color`, `button_${i}_pressed_color`);
    }
    ex2.push(ledNotification());
    return {exposes: ex2, keys, options: [tapWindowOption()]};
}

function remoteFamily(buttons: Record<number, string>, sr260: boolean): FamilyDef {
    const exposes: Expose[] = [
        actions(names(buttons), REMOTE_GESTURES, ["motion_wake", "menu_select", "menu_cancel"]),
        e.battery(),
        e.text("room_name", ea.STATE_SET).withLabel("LCD room").withDescription("Row 1 of the LCD (c4.ln.ri)"),
        e.text("active_source", ea.STATE_SET).withLabel("LCD source").withDescription("Row 2 of the LCD (c4.ln.ri)"),
    ];
    if (sr260) {
        exposes.push(e.text("display_message", ea.STATE_SET).withLabel("LCD message").withDescription("Pop-up message (empty clears it)"));
        exposes.push(
            e
                .text("text_color", ea.STATE_SET)
                .withLabel("Text colour")
                .withDescription(
                    "#RRGGBB (or a palette name, or the 0-255 byte), matched to the remote's 256 colours (c4.zr.tc); empty stops re-sending it, and the remote keeps the last colour it was sent",
                ),
        );
    }
    return {
        exposes,
        keys: [...REMOTE_KEYS, ...(sr260 ? ["show_message", "text_color"] : [])],
        options: [e.text("lcd_default_room", ea.SET).withDescription("Room shown on the LCD until room_name is set (default: Home)")],
    };
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

function definition(model: string, zigbeeModel: string[], description: string, fam: FamilyDef | undefined) {
    const keys = [...(fam?.keys ?? []), ...COMMON_KEYS];
    const exposes = fam?.exposes ?? [
        e.text("c4_model", ea.STATE_SET).withDescription("Model not known yet: set it (e.g. C4-DIM1-Z) or wait for the device's check-in"),
        e
            .text("reported_model", ea.STATE)
            .withLabel("Reported model")
            .withDescription("The model the device's check-in named, when this build doesn't support it yet (its frames are logged at info)")
            .withCategory("diagnostic"),
    ];
    // biome-ignore lint/suspicious/noExplicitAny: Z2M definition shape
    const def: any = {
        zigbeeModel,
        model,
        vendor: MANUFACTURER,
        description: `Control4 ${description}`,
        fromZigbee: [],
        toZigbee: converters(keys, fam?.grouped ?? []),
        exposes,
    };
    if (fam?.endpoint) def.endpoint = fam.endpoint;
    if (fam?.multiEndpoint) def.meta = {multiEndpoint: true};
    if (fam?.options) def.options = fam.options;
    return def;
}

export function buildDefinitions() {
    const defs = MODELS.map((m) => definition(m.model, m.aliases, m.description, FAMILIES[m.family]));
    defs.push(definition(GENERIC_MODEL, [GENERIC_MODEL], "Zigbee device (model not yet known)", undefined));
    return defs;
}

export {FAMILIES};
