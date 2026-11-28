/**
 * Control4 protocol constants, device families and button maps.
 *
 * Shared by the extension (runtime) and the converter (definitions), so both
 * bundles agree on model names, button names and property keys.
 */

// ---------------------------------------------------------------------------
// Zigbee addressing
// ---------------------------------------------------------------------------

/** Network profile: ZCL frames (model check-ins, controller identity) on EP2. */
export const PROFILE_NETWORK = 0xc25d;
/** Button profile: the ASCII line protocol (`0s` / `0g` / `0r` / `0t`). */
export const PROFILE_BUTTON = 0xc25c;
/** Outlet profile: EP198 on the LOZ-5S1-W (ZCL reports). */
export const PROFILE_OUTLET = 0xc25e;
export const C4_PROFILES: ReadonlySet<number> = new Set([PROFILE_NETWORK, PROFILE_BUTTON, PROFILE_OUTLET]);

export const HA_PROFILE = 0x0104;

/** Every C4 frame uses wire cluster 0x0001 (not PowerConfiguration). */
export const C4_CLUSTER = 0x0001;

/** Control4's OUI, as herdsman formats an IEEE (`0x000fff...`). */
export const C4_IEEE_PREFIX = "0x000fff";

export const MANUFACTURER = "Control4";
/** What upstream zigbee-herdsman names a C4 device before its model is known. */
export const GENERIC_MODEL = "C4-Zigbee";

/**
 * The contract: the event fields an instance sends on control4/event, which the
 * dispatcher and blueprint read (test/fixtures/control4-event.json). Raise it
 * when a field is added, dropped or changes meaning; test/status.test.ts holds
 * each number to its fields.
 */
export const CONTRACT = 1;

// ZCL attributes in the EP2 check-in (network profile, cluster 0x0001).
export const ATTR_LEVEL = 0x0000;
export const ATTR_FIRMWARE = 0x0004;
export const ATTR_MODEL = 0x0007;

// ---------------------------------------------------------------------------
// Device families
// ---------------------------------------------------------------------------

export type Family =
    | "apd120"
    | "dim1z"
    | "sw120277"
    | "fs1z"
    | "fan"
    | "outlet"
    | "kc120277"
    | "kd120"
    | "kp2"
    | "kp3"
    | "kp6"
    | "outlet_dimmer"
    | "rosw120"
    | "z2io"
    | "sr250"
    | "sr260";

/** A handler's family: a supported one, or "unsupported" for a check-in naming a model this build doesn't know. */
export type DeviceFamily = Family | "unsupported";

export interface ModelInfo {
    family: Family;
    /** Z2M `model` (unique definition key). */
    model: string;
    /** Every model string the device may report (Z2M `zigbeeModel`). */
    aliases: string[];
    description: string;
}

export const MODELS: ModelInfo[] = [
    {
        family: "apd120",
        model: "C4-APD120",
        aliases: ["C4-APD120", "C4-APD120-B", "C4-APD120-W"],
        description: "Adaptive phase dimmer",
    },
    {
        family: "dim1z",
        model: "C4-DIM1-Z",
        aliases: ["C4-DIM1-Z", "C4-DIM1-Z-B", "C4-DIM1-Z-W", "C4-DIM1-Z-AL", "DIMZ-1B1"],
        description: "In-wall dimmer",
    },
    {
        family: "sw120277",
        model: "C4-SW120277",
        aliases: ["C4-SW120277", "C4-SW120277-B", "C4-SW120277-W"],
        description: "On/off wall switch",
    },
    {family: "fs1z", model: "C4-FS1-Z", aliases: ["C4-FS1-Z"], description: "Fireplace switch"},
    {family: "fan", model: "C4-4SF120", aliases: ["C4-4SF120"], description: "4-speed fan controller"},
    {family: "outlet", model: "LOZ-5S1-W", aliases: ["loz-5s1-w", "LOZ-5S1-W"], description: "Dual switched outlet"},
    // From wmariz's quirk and lights0123's SmartThings driver; untested here.
    {family: "outlet_dimmer", model: "LOZ-5D1-W", aliases: ["loz-5d1-w", "LOZ-5D1-W"], description: "Dual dimmable outlet (untested)"},
    // Checks in as c4:control4_light:C4-V-ROSW120 (bharat's converter, fw 1.1.59); untested here.
    {family: "rosw120", model: "C4-V-ROSW120", aliases: ["C4-V-ROSW120"], description: "Receptacle outlet switch (untested)"},
    {
        family: "kc120277",
        model: "C4-KC120277",
        aliases: ["C4-KC120277", "C4-KC120277-B", "C4-KC120277-W", "KPZ-6B1-C"],
        description: "Configurable keypad",
    },
    {
        // C4-KD120 is what one checks in as (bharat's converter, five units on 5.1.1).
        // C4-KD277 is in that converter too, unseen; C4-KD240 is a guess from its part
        // number. One that differs stays unsupported, with its check-in logged.
        family: "kd120",
        model: "C4-KD120",
        aliases: ["C4-KD120", "C4-KD277", "C4-KD240"],
        description: "Keypad dimmer (untested)",
    },
    {
        // Forward-phase dimmer: bharat's converter runs it on the APD120's definition.
        family: "apd120",
        model: "C4-FPD120",
        aliases: ["C4-FPD120"],
        description: "Forward phase dimmer (as the APD120; untested)",
    },
    {
        // Checks in as c4:control4_keypad:C4-KP2-Z (fw 03.22.41, a 2014 SmartThings capture). Untested here.
        family: "kp2",
        model: "C4-KP2-Z",
        aliases: ["C4-KP2-Z"],
        description: "2-button keypad (untested)",
    },
    {
        family: "kp3",
        model: "C4-KP3-Z",
        aliases: ["KPZ-3B1", "C4-KP3-Z", "C4-KP3-Z-B", "C4-KP3-Z-W", "C4-KP3-Z-AL", "C4-KP3-Z-BL", "C4-KP3-Z-x"],
        description: "3-button keypad",
    },
    {
        family: "kp6",
        model: "C4-KP6-Z",
        aliases: ["KPZ-6B1", "C4-KP6-Z", "C4-KP6-Z-B", "C4-KP6-Z-W", "C4-KP6-Z-AL", "C4-KP6-Z-BL", "C4-KP6-Z-x"],
        description: "6-button keypad",
    },
    {family: "z2io", model: "C4-Z2IO-ZP", aliases: ["C4-Z2IO-ZP"], description: "IO / garage door module"},
    {family: "sr250", model: "C4-SR250B", aliases: ["C4-SR250B", "C4-SR250"], description: "47-key remote with LCD"},
    {family: "sr260", model: "C4-SR260", aliases: ["C4-SR260"], description: "50-key remote with LCD"},
];

const INVALID_MODELS = new Set(["", "unknown", "unk_model", "none", GENERIC_MODEL.toLowerCase()]);

export function isValidModel(model: string | undefined | null): model is string {
    return typeof model === "string" && !INVALID_MODELS.has(model.trim().toLowerCase());
}

/** The model string carried in a check-in: `c4:control4_light:C4-APD120` -> `C4-APD120`. */
export function modelFromCheckin(raw: string): string {
    const parts = raw.split(":");
    return (parts.length >= 3 ? parts.slice(2).join(":") : raw).trim();
}

/**
 * Map a reported model string to a known alias (exact, then case-insensitive,
 * then the longest alias it starts with). Unknown strings come back unchanged.
 */
export function canonicalModel(raw: string): string {
    const text = raw.trim();
    for (const info of MODELS) {
        if (info.aliases.includes(text)) return text;
    }
    const lower = text.toLowerCase();
    let best: string | undefined;
    for (const info of MODELS) {
        for (const alias of info.aliases) {
            const a = alias.toLowerCase();
            if (a === lower) return alias;
            if (lower.startsWith(a) && (best === undefined || alias.length > best.length)) best = alias;
        }
    }
    return best ?? text;
}

/**
 * The model a Control4 device's Zigbee2MQTT record carries: its own when this build
 * supports it, else the generic one, whose definition still serves c4_get / c4_send.
 */
export function definitionModel(model: string): string {
    return modelInfo(model) ? model : GENERIC_MODEL;
}

export function modelInfo(model: string | undefined | null): ModelInfo | undefined {
    if (!model) return undefined;
    const canon = canonicalModel(model);
    return MODELS.find((m) => m.aliases.includes(canon));
}

export function isC4Ieee(ieee: string | undefined | null): boolean {
    return typeof ieee === "string" && ieee.toLowerCase().startsWith(C4_IEEE_PREFIX);
}

// ---------------------------------------------------------------------------
// Button gestures
// ---------------------------------------------------------------------------

/** One button gesture: the Z2M action suffix and the ZHA command it replaces. */
export const GESTURES = {
    press: "initial_switch_press",
    release: "remote_button_short_release",
    single: "remote_button_short_press",
    double: "remote_button_double_press",
    triple: "remote_button_triple_press",
    quadruple: "remote_button_quadruple_press",
    hold: "remote_button_long_press",
    hold_release: "remote_button_long_release",
    fast_single: "remote_button_fast_short_press",
    fast_double: "remote_button_fast_double_press",
    fast_triple: "remote_button_fast_triple_press",
    fast_quadruple: "remote_button_fast_quadruple_press",
    tap_known: "remote_button_tap_known",
} as const;

export type Gesture = keyof typeof GESTURES;

/** Click count from `cc <btn> <n>` -> gesture. */
export function clickGesture(countHex: string | undefined): Gesture {
    switch ((countHex ?? "").toLowerCase()) {
        case "01":
            return "single";
        case "02":
            return "double";
        case "03":
            return "triple";
        default:
            return "quadruple";
    }
}

export const TAP_GESTURES: Gesture[] = ["press", "release", "single", "double", "triple", "quadruple", "hold", "hold_release"];
/** What the extension's own tap counter publishes: each known tap, then the fast count. */
export const COUNTER_GESTURES: Gesture[] = ["tap_known", "fast_single", "fast_double", "fast_triple", "fast_quadruple"];

/** Tap window for a device with none of its own (ms). */
export const DEFAULT_TAP_WINDOW_MS = 550;
/** Shortest tap window the device option may set (ms). */
export const MIN_TAP_WINDOW_MS = 250;
/** Longest tap window the device option may set (ms). */
export const MAX_TAP_WINDOW_MS = 1500;
/** Device option giving a device its own tap window, in seconds. */
export const TAP_WINDOW_OPTION = "tap_window";

// ---------------------------------------------------------------------------
// Button maps
// ---------------------------------------------------------------------------

/** APD120 / SW120277 paddle (c4.dmx.*): 0x00 and 0x01 are the top half. */
export const PADDLE_BUTTONS: Record<number, string> = {0x00: "top", 0x01: "top", 0x05: "bottom"};

/** 4SF120 fan: one button per speed, top (high) to bottom (off). */
export const FAN_BUTTONS: Record<number, string> = {
    0x00: "top",
    0x01: "high",
    0x02: "medium_high",
    0x03: "medium_low",
    0x04: "low",
    0x05: "off",
};

/** DIM1-Z / FS1-Z (c4.dm.*): 0x00 top, 0x01 bottom. */
export const DM_BUTTONS: Record<number, string> = {0x00: "button_1", 0x01: "button_2"};

/** LOZ-5S1-W: the button id is the outlet index. */
export const OUTLET_BUTTONS: Record<number, string> = {0x00: "outlet_1", 0x01: "outlet_2"};

/**
 * The button ids a KP-generation keypad sends, top to bottom. The KP2-Z's two are 00
 * and 02 (a 2014 SmartThings capture of one: the three-position board, middle left out).
 */
export const KP_BUTTON_IDS: Record<"kp2" | "kp3" | "kp6", number[]> = {kp2: [0, 2], kp3: [0, 1, 2], kp6: [0, 1, 2, 3, 4, 5]};

/** button_N for the Nth id, top to bottom. */
export function keypadButtonsOf(ids: number[]): Record<number, string> {
    return Object.fromEntries(ids.map((id, i) => [id, `button_${i + 1}`]));
}

/** N of a button name `button_N`; undefined for any other name. */
export function buttonNumberOf(name: string): number | undefined {
    const m = /^button_([1-9]\d*)$/.exec(name);
    return m ? Number(m[1]) : undefined;
}

/** KC120277: seven positions; a button reports the first LED slot of its pair. */
export const KC_POSITIONS = 7;
/**
 * An auxiliary keypad (C4-KA, no radio of its own) wired to a load device reports
 * through it, on wires 07 / 08 (bharat's converter; seen on a KD120).
 */
export const AUX_BUTTONS: Record<number, string> = {0x07: "aux_top", 0x08: "aux_bottom"};
export const KC_LED_SLOTS = 12;
/**
 * KC120277 device option: how buttons are numbered. "pairs" (default): every
 * button is a two-slot paddle, ids 0, 2, 4 -> buttons 1, 2, 3. "slots": each
 * slot has its own number, ids 0, 1, 2 -> buttons 1, 2, 3 (single-height
 * buttons; a double-height one takes the number of its top slot).
 */
export const KC_NUMBERING_OPTION = "button_numbering";
/**
 * KC120277 device option: the fitted buttons' positions from the top ("1, 3, 5"). The
 * device can't report its kit, so without it the layout is learned from the buttons
 * it sends from.
 */
export const KC_LAYOUT_OPTION = "button_layout";

export type KcNumbering = "pairs" | "slots" | "fitted";

/** How a KC120277's buttons are named: its fitted buttons' wires (when known) and the numbering. */
export interface KcLayout {
    wires: number[] | undefined;
    numbering: KcNumbering;
}

/** The numbering option's value: pairs (the default), slots or fitted. */
export function kcNumbering(raw: unknown): KcNumbering {
    return raw === "slots" || raw === "fitted" ? raw : "pairs";
}

/**
 * The Button number of a KC120277 wire. "pairs": two positions a button (0, 2, 4 ->
 * 1, 2, 3). "slots": one a position. "fitted": its place among the fitted wires (the
 * `button_layout` option), and a wire the option doesn't list after them, so no two
 * buttons share a number.
 */
export function kcButtonNumber(wire: number, layout: KcLayout): number {
    if (layout.numbering === "fitted" && layout.wires) {
        const i = layout.wires.indexOf(wire);
        return i >= 0 ? i + 1 : layout.wires.length + wire + 1;
    }
    return layout.numbering === "pairs" ? (wire >> 1) + 1 : wire + 1;
}

/** The wire of Button N, the inverse of kcButtonNumber; undefined when no wire has that number. */
export function kcWireOf(n: number, layout: KcLayout): number | undefined {
    if (n < 1) return undefined;
    if (layout.numbering === "fitted" && layout.wires) return n <= layout.wires.length ? layout.wires[n - 1] : n - layout.wires.length - 1;
    return layout.numbering === "pairs" ? (n - 1) * 2 : n - 1;
}

/** Every key a `c4.dmx.pwr` reading publishes (a /get of any of them polls it). */
export const POWER_KEYS = ["power", "voltage", "current", "power_apparent", "power_factor", "energy"];

export const SR250_BUTTONS: Record<number, string> = {
    0x00: "list",
    0x01: "room_off",
    0x02: "watch",
    0x03: "listen",
    0x04: "page_up",
    0x05: "red",
    0x06: "green",
    0x07: "yellow",
    0x08: "blue",
    0x09: "control4",
    0x0a: "page_down",
    0x0b: "mute",
    0x0c: "volume_down",
    0x0d: "volume_up",
    0x0e: "channel_up",
    0x0f: "guide",
    0x10: "up",
    0x11: "down",
    0x12: "left",
    0x13: "right",
    0x14: "prev",
    0x15: "info",
    0x16: "menu",
    0x17: "cancel",
    0x18: "dvr",
    0x19: "skip_forward",
    0x1a: "rewind",
    0x1b: "pause",
    0x1c: "fast_forward",
    0x1d: "stop",
    0x1e: "play",
    0x1f: "digit_1",
    0x20: "digit_2",
    0x21: "digit_3",
    0x22: "digit_4",
    0x23: "digit_6",
    0x24: "digit_7",
    0x25: "digit_8",
    0x26: "digit_9",
    0x27: "star",
    0x28: "hash",
    0x29: "channel_down",
    0x2a: "select",
    0x2b: "skip_back",
    0x2c: "record",
    0x2d: "digit_5",
    0x2e: "digit_0",
};

export const SR260_BUTTONS: Record<number, string> = {
    0x00: "room_off",
    0x01: "watch",
    0x02: "control4",
    0x03: "listen",
    0x04: "list",
    0x05: "i",
    0x06: "ii",
    0x07: "iii",
    0x08: "guide",
    0x09: "page_up",
    0x0a: "page_down",
    0x0b: "prev",
    0x0c: "volume_up",
    0x0d: "up",
    0x0e: "channel_up",
    0x0f: "left",
    0x10: "select",
    0x11: "right",
    0x12: "volume_down",
    0x13: "down",
    0x14: "channel_down",
    0x15: "volume_mute",
    0x16: "info",
    0x17: "menu",
    0x18: "cancel",
    0x19: "reverse",
    0x1a: "dvr",
    0x1b: "forward",
    0x1c: "skip_back",
    0x1d: "play",
    0x1e: "skip_forward",
    0x1f: "record",
    0x20: "pause",
    0x21: "stop",
    0x22: "red",
    0x23: "green",
    0x24: "yellow",
    0x25: "blue",
    0x26: "digit_1",
    0x27: "digit_2",
    0x28: "digit_3",
    0x29: "digit_4",
    0x2a: "digit_5",
    0x2b: "digit_6",
    0x2c: "digit_7",
    0x2d: "digit_8",
    0x2e: "digit_9",
    0x2f: "star",
    0x30: "digit_0",
    0x31: "hash",
};

/** Remote gestures: bb = press, bh = hold (repeats while held), be = release. */
export const REMOTE_GESTURES: Gesture[] = ["press", "hold", "release"];

/** The ZHA remote quirks named bb / bh / be short_press / long_press / short_release. */
export const REMOTE_COMMANDS: Partial<Record<Gesture, string>> = {
    press: "remote_button_short_press",
    hold: "remote_button_long_press",
    release: "remote_button_short_release",
};

// ---------------------------------------------------------------------------
// LED palette (index == the ZHA select's enum value)
// ---------------------------------------------------------------------------

export const PALETTE_NAMES = [
    "off",
    "white",
    "warm_white",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "teal",
    "cyan",
    "blue",
    "purple",
    "magenta",
    "pink",
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];

export const PALETTE_HEX: Record<PaletteName, string> = {
    off: "000000",
    white: "ffffff",
    warm_white: "ff8f3f",
    red: "ff0000",
    orange: "ff5a00",
    amber: "ffbf00",
    yellow: "ffff00",
    lime: "80ff00",
    green: "00ff00",
    teal: "00ff80",
    cyan: "00ffff",
    blue: "0000ff",
    purple: "8000ff",
    magenta: "ff00ff",
    pink: "ff2080",
};

// ---------------------------------------------------------------------------
// Dimmer parameters (c4.dm.tv)
// ---------------------------------------------------------------------------

export const RAMP_IDX_ON = 0x02;
export const RAMP_IDX_OFF = 0x03;

export interface TvParam {
    index: number;
    kind: "percent" | "ms";
    default: number;
    key: string;
    label: string;
    description?: string;
}

export const DM_TV_PARAMS: TvParam[] = [
    {index: 0x08, kind: "percent", default: 5, key: "min_brightness", label: "Min brightness"},
    {index: 0x06, kind: "percent", default: 100, key: "max_brightness", label: "Max brightness"},
    {index: 0x01, kind: "percent", default: 100, key: "default_on_brightness", label: "Default on brightness"},
    {index: 0x04, kind: "ms", default: 4000, key: "hold_ramp_up", label: "Hold ramp up"},
    {index: 0x05, kind: "ms", default: 4000, key: "hold_ramp_down", label: "Hold ramp down"},
];

export const COLD_START_LEVEL_KEY = "cold_start_level";
export const COLD_START_TIME_KEY = "cold_start_time";

/**
 * /set key that reboots a device remotely: a DIM1-Z (`0i c4.dm.rb`, tested 2026-11-07:
 * back in about 2 s, its load at the same level and its settings kept), a KC120277 or
 * an APD120 (`0i c4.sy.rb`, tested 2026-11-15).
 */
export const REBOOT_KEY = "reboot";
/** Device option of those models: false stops the automatic reboot of an unreachable or re-joining device. */
export const AUTO_REBOOT_OPTION = "auto_reboot";
/**
 * Models of a family that is rebooted remotely whose own reboot is untested: no Reboot
 * button and no automatic reboots. The FPD120 runs on the APD120's family.
 */
export const REBOOT_UNTESTED: ReadonlySet<string> = new Set(["C4-FPD120"]);

/** A DIM1-Z's own factory values where they differ from the defaults above (read from four units, fw 03.22.41). */
const DIM1Z_FACTORY: Record<string, number> = {min_brightness: 0, hold_ramp_up: 5000, hold_ramp_down: 5000};

/**
 * DIM1-Z cold start: turned on from off, the load jumps to the level, holds it
 * for the time, then ramps to its target - a low-wattage load that will not
 * start at a low level starts cleanly. Measured on fw 03.22.41: 0x09 caps a
 * write at 100 (the level), 0x0a keeps 500 (the time); the Composer-log notes
 * have the two the other way round. Both are 0 from the factory.
 */
const COLD_START_PARAMS: TvParam[] = [
    {
        index: 0x09,
        kind: "percent",
        default: 0,
        key: COLD_START_LEVEL_KEY,
        label: "Cold start level",
        description:
            "Turned on from off, the light starts at this level for the cold start time, then goes to its target (0 = off). Set it above min brightness",
    },
    {
        index: 0x0a,
        kind: "ms",
        default: 0,
        key: COLD_START_TIME_KEY,
        label: "Cold start time",
        description: "How long a turn-on from off holds the cold start level",
    },
];

export const DIM1Z_TV_PARAMS: TvParam[] = [...DM_TV_PARAMS.map((p) => ({...p, default: DIM1Z_FACTORY[p.key] ?? p.default})), ...COLD_START_PARAMS];

/** An APD120's own factory values where they differ from DM_TV_PARAMS (read from one, fw 5.1.1, 2026-11-07). */
const APD120_FACTORY: Record<string, number> = {min_brightness: 10, hold_ramp_up: 5000, hold_ramp_down: 5000};

/** APD120 dimmer parameters. Its `c4.dm.is` is this table in slot order (00-0a), so one Get reads them all. */
export const APD120_TV_PARAMS: TvParam[] = [...DM_TV_PARAMS.map((p) => ({...p, default: APD120_FACTORY[p.key] ?? p.default})), ...COLD_START_PARAMS];

/** Multi-click thresholds (c4.dmx.bmc 0/1/2) of the KC120277, APD120 and SW120277: factory values in ms. */
export const BMC_DEFAULTS = [417, 1000, 1667];

// ---------------------------------------------------------------------------
// The Gen3 board (KC120277 / APD120 / SW120277): button behaviour, LED mode
// ---------------------------------------------------------------------------

/**
 * Button behaviour (`c4.dmx.btn <wire> 01 <code>`): what a button does to its own
 * device's load. Code 05 ("disabled") is left out on purpose: with some firmware
 * state it fires a press on both edges, so every tap reads as a double tap.
 */
export const BUTTON_BEHAVIOURS = {load_on: 0x00, load_off: 0x01, toggle: 0x02, momentary: 0x04, event_only: 0x03} as const;
export type ButtonBehaviour = keyof typeof BUTTON_BEHAVIOURS;
export const BUTTON_BEHAVIOUR_NAMES = Object.keys(BUTTON_BEHAVIOURS) as ButtonBehaviour[];

/** LED mode (`c4.dmx.led <slot> 01 <code>`): how an LED slot picks its colour. */
export const LED_MODES = {programmed: 0x00, follow_load: 0x01, push_release: 0x02} as const;
export type LedMode = keyof typeof LED_MODES;
export const LED_MODE_NAMES = Object.keys(LED_MODES) as LedMode[];

/**
 * The two paddle halves of an APD120 / SW120277: the button wire each reports, the
 * LED slot beside it (the paint test of 2026-11-07: slots 01 and 04), and the button
 * behaviour each has from the factory.
 */
export const PADDLE_HALVES = [
    {half: "top", wire: 0x01, slot: 0x01, factory: "load_on"},
    {half: "bottom", wire: 0x05, slot: 0x04, factory: "load_off"},
] as const satisfies readonly {half: string; wire: number; slot: number; factory: ButtonBehaviour}[];
export type PaddleHalf = (typeof PADDLE_HALVES)[number]["half"];

/** Radio TX power (`c4.sy.zpw`, signed dBm): the range a Set takes. Control4 provisions 0 dBm. */
export const TX_POWER_MIN = -8;
export const TX_POWER_MAX = 2;

/** Z2IO IO modes (c4.z2x.opt) -> relays / contacts. */
export const Z2IO_MODES: Record<number, {name: string; relays: number; contacts: number}> = {
    1: {name: "relays_2_spst", relays: 2, contacts: 0},
    2: {name: "contacts_4", relays: 0, contacts: 4},
    3: {name: "relay_1_contacts_2", relays: 1, contacts: 2},
    4: {name: "relay_1_spdt", relays: 1, contacts: 0},
    5: {name: "relay_1_dpst", relays: 1, contacts: 0},
};
export const Z2IO_DEFAULT_MODE = 2;
export const Z2IO_CONTACTS_HW = 5;

/**
 * Wh per count of the energy counter (`c4.dmx.pwr` field 5): about 4.6 kJ a count, from
 * an APD120's 35.5 W load ticking every ~130 s (2026-11-07). A day's reading against
 * field 2 would pin it down better.
 */
export const ENERGY_WH_PER_COUNT = 1.27;
