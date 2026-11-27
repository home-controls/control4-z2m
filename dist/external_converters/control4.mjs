// control4-z2m 0.2.1 - Zigbee2MQTT external converter
// Generated from src/ by tools/build.mjs - edit the TypeScript, not this file.


// src/core/build.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var sha256 = (data) => createHash("sha256").update(data).digest("hex");
function fileHash(url) {
  try {
    return sha256(readFileSync(fileURLToPath(url)));
  } catch {
    return void 0;
  }
}

// src/z2m/definitions.ts
import * as exposesModule from "zigbee-herdsman-converters/lib/exposes";

// src/core/constants.ts
var MANUFACTURER = "Control4";
var GENERIC_MODEL = "C4-Zigbee";
var MODELS = [
  {
    family: "apd120",
    model: "C4-APD120",
    aliases: ["C4-APD120", "C4-APD120-B", "C4-APD120-W"],
    description: "Adaptive phase dimmer"
  },
  {
    family: "dim1z",
    model: "C4-DIM1-Z",
    aliases: ["C4-DIM1-Z", "C4-DIM1-Z-B", "C4-DIM1-Z-W", "C4-DIM1-Z-AL", "DIMZ-1B1"],
    description: "In-wall dimmer"
  },
  {
    family: "sw120277",
    model: "C4-SW120277",
    aliases: ["C4-SW120277", "C4-SW120277-B", "C4-SW120277-W"],
    description: "On/off wall switch"
  },
  { family: "fs1z", model: "C4-FS1-Z", aliases: ["C4-FS1-Z"], description: "Fireplace switch" },
  { family: "fan", model: "C4-4SF120", aliases: ["C4-4SF120"], description: "4-speed fan controller" },
  { family: "outlet", model: "LOZ-5S1-W", aliases: ["loz-5s1-w", "LOZ-5S1-W"], description: "Dual switched outlet" },
  // From wmariz's quirk and lights0123's SmartThings driver; untested here.
  { family: "outlet_dimmer", model: "LOZ-5D1-W", aliases: ["loz-5d1-w", "LOZ-5D1-W"], description: "Dual dimmable outlet (untested)" },
  // Checks in as c4:control4_light:C4-V-ROSW120 (bharat's converter, fw 1.1.59); untested here.
  { family: "rosw120", model: "C4-V-ROSW120", aliases: ["C4-V-ROSW120"], description: "Receptacle outlet switch (untested)" },
  {
    family: "kc120277",
    model: "C4-KC120277",
    aliases: ["C4-KC120277", "C4-KC120277-B", "C4-KC120277-W", "KPZ-6B1-C"],
    description: "Configurable keypad"
  },
  {
    // C4-KD120 is what one checks in as (bharat's converter, five units on 5.1.1).
    // C4-KD277 is in that converter too, unseen; C4-KD240 is a guess from its part
    // number. One that differs stays unsupported, with its check-in logged.
    family: "kd120",
    model: "C4-KD120",
    aliases: ["C4-KD120", "C4-KD277", "C4-KD240"],
    description: "Keypad dimmer (untested)"
  },
  {
    // Forward-phase dimmer: bharat's converter runs it on the APD120's definition.
    family: "apd120",
    model: "C4-FPD120",
    aliases: ["C4-FPD120"],
    description: "Forward phase dimmer (as the APD120; untested)"
  },
  {
    // Checks in as c4:control4_keypad:C4-KP2-Z (fw 03.22.41, a 2014 SmartThings capture). Untested here.
    family: "kp2",
    model: "C4-KP2-Z",
    aliases: ["C4-KP2-Z"],
    description: "2-button keypad (untested)"
  },
  {
    family: "kp3",
    model: "C4-KP3-Z",
    aliases: ["KPZ-3B1", "C4-KP3-Z", "C4-KP3-Z-B", "C4-KP3-Z-W", "C4-KP3-Z-AL", "C4-KP3-Z-BL", "C4-KP3-Z-x"],
    description: "3-button keypad"
  },
  {
    family: "kp6",
    model: "C4-KP6-Z",
    aliases: ["KPZ-6B1", "C4-KP6-Z", "C4-KP6-Z-B", "C4-KP6-Z-W", "C4-KP6-Z-AL", "C4-KP6-Z-BL", "C4-KP6-Z-x"],
    description: "6-button keypad"
  },
  { family: "z2io", model: "C4-Z2IO-ZP", aliases: ["C4-Z2IO-ZP"], description: "IO / garage door module" },
  { family: "sr250", model: "C4-SR250B", aliases: ["C4-SR250B", "C4-SR250"], description: "47-key remote with LCD" },
  { family: "sr260", model: "C4-SR260", aliases: ["C4-SR260"], description: "50-key remote with LCD" }
];
var INVALID_MODELS = /* @__PURE__ */ new Set(["", "unknown", "unk_model", "none", GENERIC_MODEL.toLowerCase()]);
var TAP_GESTURES = ["press", "release", "single", "double", "triple", "quadruple", "hold", "hold_release"];
var COUNTER_GESTURES = ["tap_known", "fast_single", "fast_double", "fast_triple", "fast_quadruple"];
var DEFAULT_TAP_WINDOW_MS = 550;
var MIN_TAP_WINDOW_MS = 250;
var MAX_TAP_WINDOW_MS = 1500;
var TAP_WINDOW_OPTION = "tap_window";
var FAN_BUTTONS = {
  0: "top",
  1: "high",
  2: "medium_high",
  3: "medium_low",
  4: "low",
  5: "off"
};
var KC_POSITIONS = 7;
var AUX_BUTTONS = { 7: "aux_top", 8: "aux_bottom" };
var KC_LED_SLOTS = 12;
var KC_NUMBERING_OPTION = "button_numbering";
var KC_LAYOUT_OPTION = "button_layout";
function kcButtonNumber(wire, layout) {
  if (layout.numbering === "fitted" && layout.wires) {
    const i = layout.wires.indexOf(wire);
    return i >= 0 ? i + 1 : layout.wires.length + wire + 1;
  }
  return layout.numbering === "pairs" ? (wire >> 1) + 1 : wire + 1;
}
var POWER_KEYS = ["power", "voltage", "current", "power_apparent", "power_factor", "energy"];
var SR250_BUTTONS = {
  0: "list",
  1: "room_off",
  2: "watch",
  3: "listen",
  4: "page_up",
  5: "red",
  6: "green",
  7: "yellow",
  8: "blue",
  9: "control4",
  10: "page_down",
  11: "mute",
  12: "volume_down",
  13: "volume_up",
  14: "channel_up",
  15: "guide",
  16: "up",
  17: "down",
  18: "left",
  19: "right",
  20: "prev",
  21: "info",
  22: "menu",
  23: "cancel",
  24: "dvr",
  25: "skip_forward",
  26: "rewind",
  27: "pause",
  28: "fast_forward",
  29: "stop",
  30: "play",
  31: "digit_1",
  32: "digit_2",
  33: "digit_3",
  34: "digit_4",
  35: "digit_6",
  36: "digit_7",
  37: "digit_8",
  38: "digit_9",
  39: "star",
  40: "hash",
  41: "channel_down",
  42: "select",
  43: "skip_back",
  44: "record",
  45: "digit_5",
  46: "digit_0"
};
var SR260_BUTTONS = {
  0: "room_off",
  1: "watch",
  2: "control4",
  3: "listen",
  4: "list",
  5: "i",
  6: "ii",
  7: "iii",
  8: "guide",
  9: "page_up",
  10: "page_down",
  11: "prev",
  12: "volume_up",
  13: "up",
  14: "channel_up",
  15: "left",
  16: "select",
  17: "right",
  18: "volume_down",
  19: "down",
  20: "channel_down",
  21: "volume_mute",
  22: "info",
  23: "menu",
  24: "cancel",
  25: "reverse",
  26: "dvr",
  27: "forward",
  28: "skip_back",
  29: "play",
  30: "skip_forward",
  31: "record",
  32: "pause",
  33: "stop",
  34: "red",
  35: "green",
  36: "yellow",
  37: "blue",
  38: "digit_1",
  39: "digit_2",
  40: "digit_3",
  41: "digit_4",
  42: "digit_5",
  43: "digit_6",
  44: "digit_7",
  45: "digit_8",
  46: "digit_9",
  47: "star",
  48: "digit_0",
  49: "hash"
};
var REMOTE_GESTURES = ["press", "hold", "release"];
var PALETTE_NAMES = [
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
  "pink"
];
var DM_TV_PARAMS = [
  { index: 8, kind: "percent", default: 5, key: "min_brightness", label: "Min brightness" },
  { index: 6, kind: "percent", default: 100, key: "max_brightness", label: "Max brightness" },
  { index: 1, kind: "percent", default: 100, key: "default_on_brightness", label: "Default on brightness" },
  { index: 4, kind: "ms", default: 4e3, key: "hold_ramp_up", label: "Hold ramp up" },
  { index: 5, kind: "ms", default: 4e3, key: "hold_ramp_down", label: "Hold ramp down" }
];
var COLD_START_LEVEL_KEY = "cold_start_level";
var COLD_START_TIME_KEY = "cold_start_time";
var REBOOT_KEY = "reboot";
var AUTO_REBOOT_OPTION = "auto_reboot";
var DIM1Z_FACTORY = { min_brightness: 0, hold_ramp_up: 5e3, hold_ramp_down: 5e3 };
var COLD_START_PARAMS = [
  {
    index: 9,
    kind: "percent",
    default: 0,
    key: COLD_START_LEVEL_KEY,
    label: "Cold start level",
    description: "Turned on from off, the light starts at this level for the cold start time, then goes to its target (0 = off). Set it above min brightness"
  },
  {
    index: 10,
    kind: "ms",
    default: 0,
    key: COLD_START_TIME_KEY,
    label: "Cold start time",
    description: "How long a turn-on from off holds the cold start level"
  }
];
var DIM1Z_TV_PARAMS = [...DM_TV_PARAMS.map((p) => ({ ...p, default: DIM1Z_FACTORY[p.key] ?? p.default })), ...COLD_START_PARAMS];
var APD120_FACTORY = { min_brightness: 10, hold_ramp_up: 5e3, hold_ramp_down: 5e3 };
var APD120_TV_PARAMS = [...DM_TV_PARAMS.map((p) => ({ ...p, default: APD120_FACTORY[p.key] ?? p.default })), ...COLD_START_PARAMS];
var BMC_DEFAULTS = [417, 1e3, 1667];
var BUTTON_BEHAVIOURS = { load_on: 0, load_off: 1, toggle: 2, momentary: 4, event_only: 3 };
var BUTTON_BEHAVIOUR_NAMES = Object.keys(BUTTON_BEHAVIOURS);
var LED_MODES = { programmed: 0, follow_load: 1, push_release: 2 };
var LED_MODE_NAMES = Object.keys(LED_MODES);
var PADDLE_HALVES = [
  { half: "top", wire: 1, slot: 1, factory: "load_on" },
  { half: "bottom", wire: 5, slot: 4, factory: "load_off" }
];
var TX_POWER_MIN = -8;
var TX_POWER_MAX = 2;
var Z2IO_MODES = {
  1: { name: "relays_2_spst", relays: 2, contacts: 0 },
  2: { name: "contacts_4", relays: 0, contacts: 4 },
  3: { name: "relay_1_contacts_2", relays: 1, contacts: 2 },
  4: { name: "relay_1_spdt", relays: 1, contacts: 0 },
  5: { name: "relay_1_dpst", relays: 1, contacts: 0 }
};
var Z2IO_DEFAULT_MODE = 2;
var Z2IO_CONTACTS_HW = 5;

// src/z2m/global.ts
var RUNTIME_KEY = "__control4_z2m_runtime__";
var CONVERTER_KEY = "__control4_z2m_converter__";
var RUNTIME_API = 2;

// src/z2m/definitions.ts
var ex = exposesModule.presets ? exposesModule : exposesModule.default;
var e = ex.presets;
var ea = ex.access;
var NOT_RUNNING = "Control4 extension is not running - install control4.mjs in external_extensions (see the README)";
function runtime() {
  const rt = globalThis[RUNTIME_KEY];
  if (!rt) throw new Error(NOT_RUNNING);
  return rt;
}
var RUNTIME_WAIT_MS = 15e3;
var RUNTIME_POLL_MS = 100;
var waiting = [];
var waitTimer;
function pollRuntime() {
  waitTimer = void 0;
  const rt = globalThis[RUNTIME_KEY];
  if (rt) for (const w of waiting.splice(0)) w.resolve(rt);
  const now = Date.now();
  while (waiting.length && waiting[0].deadline <= now) waiting.shift()?.reject(new Error(NOT_RUNNING));
  if (waiting.length) waitTimer = setTimeout(pollRuntime, RUNTIME_POLL_MS);
}
function readyRuntime() {
  const rt = globalThis[RUNTIME_KEY];
  if (rt && !waiting.length) return Promise.resolve(rt);
  return new Promise((resolve, reject) => {
    waiting.push({ resolve, reject, deadline: Date.now() + RUNTIME_WAIT_MS });
    waitTimer ??= setTimeout(pollRuntime, RUNTIME_POLL_MS);
  });
}
function converter(keys, endpoints) {
  return {
    key: keys,
    ...endpoints ? { endpoints } : {},
    // biome-ignore lint/suspicious/noExplicitAny: converter meta
    convertSet: async (_entity, key, value, meta) => {
      const ieee = String(meta.device.ieeeAddr).toLowerCase();
      const rt = await readyRuntime();
      if (key === "c4_model") {
        const model = rt.seedModel(ieee, String(value));
        return { state: { c4_model: model } };
      }
      const state = await rt.set(ieee, key, value, { message: meta.message ?? { [key]: value }, endpoint: meta.endpoint_name });
      return state ? { state } : void 0;
    },
    // biome-ignore lint/suspicious/noExplicitAny: converter meta
    convertGet: async (_entity, key, meta) => {
      await (await readyRuntime()).getValue(String(meta.device.ieeeAddr).toLowerCase(), key);
    }
  };
}
var COMMON_KEYS = ["c4_send", "c4_get", "c4_raw", "c4_identify", "c4_model", "send_raw", "send_get"];
var LED_CLUSTER_KEYS = ["set_led_color", "set_led_mode", "set_led_all_same_color", "set_all_led_modes", "set_led_single_on"];
var RAMP_KEYS = ["set_ramp_rate", "set_on_ramp", "set_off_ramp", "set_on_off_ramps"];
var LIGHT_KEYS = ["state", "brightness", "transition"];
var LED_ENGINE_KEYS = ["led_effect", "led_status", "led_stop", "led_refresh"];
var REMOTE_KEYS = [
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
  "gi_item_template"
];
function converters(keys, grouped = []) {
  const groupedKeys = new Set(grouped.flat());
  return [...grouped.map((g) => converter(g)), ...keys.filter((k) => !groupedKeys.has(k)).map((k) => converter([k]))];
}
function actions(buttons, gestures, extra = []) {
  const values = [];
  for (const b of buttons) for (const g of gestures) values.push(`${b}_${g}`);
  return e.action([...values, ...extra]);
}
function ledColor(key, label) {
  return e.enum(key, ea.STATE_SET, [...PALETTE_NAMES]).withLabel(label).withDescription(`${label} (the device keeps it; brightness scales it)`).withCategory("config");
}
function ledMode(key, label) {
  return e.enum(key, ea.STATE_SET, [...LED_MODE_NAMES]).withLabel(label).withDescription(
    "How the LED picks its colour: follow_load (on colour while the load is on, off colour while off), push_release (pressed colour while its button is held), or programmed (a colour set from outside, as a status colour)"
  ).withCategory("config");
}
function pollOptions(power) {
  const opt = (key, what) => e.numeric(key, ea.SET).withValueMin(0).withValueMax(86400).withUnit("s").withDescription(`Seconds between ${what} reads (default 30, minimum 10; 0 = never poll, announcements still arrive)`);
  return [opt("ambient_light_poll", "ambient light"), ...power ? [opt("power_poll", "power and energy")] : []];
}
function tapWindowOption() {
  return e.numeric(TAP_WINDOW_OPTION, ea.SET).withValueMin(MIN_TAP_WINDOW_MS / 1e3).withValueMax(MAX_TAP_WINDOW_MS / 1e3).withValueStep(0.05).withUnit("s").withDescription(
    `Seconds a tap sequence stays open for another tap before its fast count is published (default ${DEFAULT_TAP_WINDOW_MS / 1e3}); wider for slow tappers, narrower for a faster single tap`
  );
}
function kcNumberingOption() {
  return e.enum(KC_NUMBERING_OPTION, ea.SET, ["pairs", "slots", "fitted"]).withDescription(
    "pairs (default): every button is a two-slot paddle, numbered 1, 2, 3 from the top. slots: each position has its own number 1-7 (a double-height button takes its top position's number). fitted: the fitted buttons are numbered 1, 2, 3 from the top, whatever their size"
  );
}
function kcLayoutOption() {
  return e.text(KC_LAYOUT_OPTION, ea.SET).withDescription(
    "Positions of the fitted buttons from the top, 1-7 (for example 1, 3, 5 for three double-height buttons). Empty: learned from the buttons the keypad sends from, so press each one once after pairing"
  );
}
function ledBrightness() {
  return e.numeric("led_brightness", ea.STATE_SET).withValueMin(1).withValueMax(100).withValueStep(1).withUnit("%").withLabel("LED brightness").withDescription("Scales every LED colour (the protocol has no brightness register)").withCategory("config");
}
function ledTransition() {
  return e.numeric("led_transition", ea.STATE_SET).withValueMin(0).withValueMax(10).withValueStep(0.5).withUnit("s").withLabel("LED transition").withDescription("Crossfade time for idle-colour changes (0 = instant)").withCategory("config");
}
function ledNotification() {
  return e.binary("led_notification", ea.STATE, true, false).withLabel("LED notification").withDescription("An LED effect owns the LEDs right now").withCategory("diagnostic");
}
function transitions() {
  return [
    e.numeric("on_transition", ea.STATE_SET).withValueMin(0).withValueMax(60).withValueStep(0.1).withUnit("s").withLabel("Turn-on fade").withDescription("Fade when turned on (also stored in the dimmer's own ramp table)").withCategory("config"),
    e.numeric("off_transition", ea.STATE_SET).withValueMin(0).withValueMax(60).withValueStep(0.1).withUnit("s").withLabel("Turn-off fade").withDescription("Fade when turned off (also stored in the dimmer's own ramp table)").withCategory("config")
  ];
}
function tvParams(params) {
  return params.map((p) => {
    const slot = `c4.dm.tv 0x${p.index.toString(16).padStart(2, "0")}`;
    return e.numeric(p.key, ea.STATE_SET).withValueMin(0).withValueMax(p.kind === "percent" ? 100 : 1e4).withValueStep(p.kind === "percent" ? 1 : 100).withUnit(p.kind === "percent" ? "%" : "ms").withLabel(p.label).withDescription(p.description ? `${p.description} (${slot})` : `Dimmer parameter ${slot}`).withCategory("config");
  });
}
function rebootButton() {
  return e.enum(REBOOT_KEY, ea.SET, ["reboot"]).withLabel("Reboot").withDescription(
    "Restart the dimmer remotely: back in about 2 s, its light staying as it is and its settings kept (its LEDs flash green, then white)"
  ).withCategory("config");
}
function autoRebootOption() {
  return e.binary(AUTO_REBOOT_OPTION, ea.SET, true, false).withDescription(
    "Reboot this dimmer remotely when it stops answering or keeps re-joining (3 times within 3.5 h): up to 3 times a day, an hour or more apart. Default true"
  );
}
function paddleLocalControl() {
  return e.binary("paddle_local_control", ea.STATE_SET, "ON", "OFF").withLabel("Paddle controls local load").withDescription("Off: the paddle only reports taps; the load is controlled from Zigbee2MQTT alone").withCategory("config");
}
function ambient() {
  return e.numeric("ambient_light", ea.STATE_GET).withValueMin(0).withValueMax(255).withLabel("Ambient light").withDescription("Raw photodiode reading 0-255 (not lux)");
}
function powerSensors() {
  return [
    e.power().withAccess(ea.STATE_GET).withDescription("Real power the load draws"),
    e.voltage().withAccess(ea.STATE_GET).withDescription("Line voltage"),
    e.current().withAccess(ea.STATE_GET).withDescription("Current the load draws"),
    e.power_apparent().withAccess(ea.STATE_GET).withDescription("Apparent power the load draws"),
    e.power_factor().withAccess(ea.STATE_GET).withDescription("Power factor of the load"),
    e.energy().withAccess(ea.STATE_GET).withDescription("Energy the load has used: the device's lifetime counter (about 1.27 Wh a count), carried across its reboots")
  ];
}
function multiclickTimes() {
  return BMC_DEFAULTS.map(
    (_, i) => e.numeric(`multiclick_time_${i + 1}`, ea.STATE_SET).withValueMin(50).withValueMax(5e3).withValueStep(10).withUnit("ms").withLabel(`Multi-click time ${i + 1}`).withDescription("How long the device waits to resolve taps (lower = faster single tap)").withCategory("config")
  );
}
var MULTICLICK_KEYS = BMC_DEFAULTS.map((_, i) => `multiclick_time_${i + 1}`);
function gen3Health(fault) {
  const out = [
    e.text("reset_reason", ea.STATE).withLabel("Reset reason").withDescription("Why the device last restarted (c4.sy.ri; EmberZNet's code in brackets)").withCategory("diagnostic"),
    e.text("firmware_version", ea.STATE).withLabel("Firmware version").withDescription("c4.sy.fwv").withCategory("diagnostic"),
    e.text("bootloader_version", ea.STATE).withLabel("Bootloader version").withDescription("c4.sy.blv").withCategory("diagnostic"),
    e.numeric("tx_power", ea.STATE_SET).withValueMin(TX_POWER_MIN).withValueMax(TX_POWER_MAX).withValueStep(1).withUnit("dBm").withLabel("TX power").withDescription("Radio transmit power (c4.sy.zpw); Control4 provisions 0. Put back after a re-join if the device has lost it").withCategory("config")
  ];
  if (fault)
    out.push(
      e.binary("fault", ea.STATE, true, false).withLabel("Fault").withDescription("The device reports a fault on its load: a short circuit or an overload (c4.dmx.warn)").withCategory("diagnostic")
    );
  return out;
}
var GEN3_KEYS = [...MULTICLICK_KEYS, "tx_power"];
function behaviours() {
  return PADDLE_HALVES.map(
    (h) => e.enum(`${h.half}_button_behaviour`, ea.STATE_SET, [...BUTTON_BEHAVIOUR_NAMES]).withLabel(`${h.half === "top" ? "Top" : "Bottom"} button behaviour`).withDescription(
      `What the ${h.half} half does to the load when pressed: load_on, load_off, toggle, momentary (dims while held, back on release) or event_only (only sends its taps). Factory: ${h.factory}`
    ).withCategory("config")
  );
}
var BEHAVIOUR_KEYS = PADDLE_HALVES.map((h) => `${h.half}_button_behaviour`);
function paddleLeds() {
  const out = [];
  for (const h of PADDLE_HALVES) {
    const name = h.half === "top" ? "Top" : "Bottom";
    out.push(
      ledColor(`led_${h.half}_on_color`, `${name} LED on colour`),
      ledColor(`led_${h.half}_off_color`, `${name} LED off colour`),
      ledMode(`led_${h.half}_mode`, `${name} LED mode`)
    );
  }
  return out;
}
var PADDLE_LED_KEYS = PADDLE_HALVES.flatMap((h) => [`led_${h.half}_on_color`, `led_${h.half}_off_color`, `led_${h.half}_mode`]);
function names(map) {
  return [...new Set(Object.values(map))];
}
var keypadNames = (n) => Array.from({ length: n }, (_, i) => `button_${i + 1}`);
function z2ioExposes(mode) {
  const m = Z2IO_MODES[mode] ?? Z2IO_MODES[Z2IO_DEFAULT_MODE];
  const out = [];
  for (let r = 1; r <= m.relays; r++) {
    out.push(e.binary(`relay_${r}`, ea.ALL, "ON", "OFF").withLabel(`Relay ${r}`).withDescription(`Relay ${r} (latched)`));
    out.push(e.enum(`relay_${r}_pulse`, ea.SET, ["pulse"]).withLabel(`Pulse relay ${r}`).withDescription("Energise then release (garage door opener)"));
  }
  for (let c = 1; c <= Math.min(m.contacts, Z2IO_CONTACTS_HW); c++) {
    out.push(e.binary(`contact_${c}`, ea.STATE, false, true).withLabel(`Contact ${c}`).withDescription("On = open, off = closed"));
  }
  out.push(
    e.temperature(),
    e.numeric("external_temperature", ea.STATE).withUnit("\xB0C").withLabel("External temperature").withDescription("External probe (absent when no probe is connected)"),
    e.humidity(),
    e.numeric("pulse_duration", ea.STATE_SET).withValueMin(100).withValueMax(5e3).withValueStep(50).withUnit("ms").withLabel("Pulse duration").withCategory("config"),
    e.enum(
      "io_mode",
      ea.STATE_SET,
      Object.values(Z2IO_MODES).map((v) => v.name)
    ).withLabel("IO mode").withDescription("How the two relays / five contacts are used (c4.z2x.opt)").withCategory("config"),
    e.action(["contact_state_changed", "relay_state_changed"])
  );
  return out;
}
function dimmingPhase() {
  return e.enum("dimming_phase", ea.STATE, ["forward", "reverse", "none", "other"]).withLabel("Dimming phase").withDescription("The dimming phase in use (c4.dmx.dim): forward or reverse, as the dimmer detected for its load").withCategory("diagnostic");
}
var KC_KEYS = [
  "led_brightness",
  "led_transition",
  // led_N_bound stays as a key: on = push_release, off = programmed.
  ...Array.from({ length: KC_LED_SLOTS }, (_, i) => [
    `led_${i + 1}_idle_color`,
    `led_${i + 1}_pressed_color`,
    `led_${i + 1}_mode`,
    `led_${i + 1}_bound`
  ]).flat(),
  "backlight_color",
  "backlight_brightness",
  "ambient_light",
  ...LED_ENGINE_KEYS,
  ...LED_CLUSTER_KEYS,
  ...GEN3_KEYS
];
var POSITION_BEHAVIOUR_KEYS = Array.from({ length: KC_POSITIONS }, (_, i) => `button_position_${i + 1}_behaviour`);
var FAMILIES = {
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
      ...gen3Health(true)
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
      ...GEN3_KEYS
    ],
    grouped: [LIGHT_KEYS],
    options: [...pollOptions(true), tapWindowOption()]
  },
  dim1z: {
    exposes: [
      e.light_brightness(),
      actions(
        ["button_1", "button_2"],
        ["press", "single", "double", "triple", "quadruple", "hold", "hold_release", ...COUNTER_GESTURES],
        ["led_notification_start", "led_notification_end"]
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
      rebootButton()
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
      REBOOT_KEY
    ],
    grouped: [LIGHT_KEYS],
    options: [tapWindowOption(), autoRebootOption()]
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
      ...gen3Health(true)
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
      ...GEN3_KEYS
    ],
    options: [...pollOptions(true), tapWindowOption()]
  },
  fs1z: {
    exposes: [
      e.switch().withDescription("Fireplace (deliberately a switch, never a light)"),
      // As the DIM1-Z: paddle-down, no release (#51).
      actions(["button_1", "button_2"], ["press", "single", "double", "triple", "quadruple", "hold", "hold_release", ...COUNTER_GESTURES])
    ],
    keys: ["state"],
    options: [tapWindowOption()]
  },
  fan: {
    exposes: [e.fan().withState().withSpeed(1, 4), actions(names(FAN_BUTTONS), [...TAP_GESTURES, ...COUNTER_GESTURES])],
    keys: ["state", "speed", ...LED_CLUSTER_KEYS],
    grouped: [["state", "speed"]],
    options: [tapWindowOption()]
  },
  outlet: {
    exposes: [e.switch().withEndpoint("l1"), e.switch().withEndpoint("l2"), actions(["outlet_1", "outlet_2"], [...TAP_GESTURES, ...COUNTER_GESTURES])],
    keys: ["state"],
    endpoint: () => ({ l1: 1, l2: 11 }),
    multiEndpoint: true,
    options: [tapWindowOption()]
  },
  outlet_dimmer: {
    exposes: [
      e.light_brightness().withEndpoint("l1"),
      e.light_brightness().withEndpoint("l2"),
      actions(["outlet_1", "outlet_2"], [...TAP_GESTURES, ...COUNTER_GESTURES])
    ],
    keys: LIGHT_KEYS,
    grouped: [LIGHT_KEYS],
    endpoint: () => ({ l1: 1, l2: 11 }),
    multiEndpoint: true,
    options: [tapWindowOption()]
  },
  rosw120: {
    exposes: [e.switch().withDescription("The switched outlet"), actions(["button_1"], [...TAP_GESTURES, ...COUNTER_GESTURES])],
    keys: ["state"],
    options: [tapWindowOption()]
  },
  kc120277: {
    exposes: (device) => kcExposes(kcLayoutOf(device)),
    keys: KC_KEYS,
    options: [...pollOptions(false), tapWindowOption(), kcNumberingOption(), kcLayoutOption()]
  },
  kd120: {
    exposes: (device) => kdExposes(kcLayoutOf(device)),
    keys: [
      ...LIGHT_KEYS,
      "on_transition",
      "off_transition",
      ...RAMP_KEYS,
      ...APD120_TV_PARAMS.map((p) => p.key),
      ...KC_KEYS,
      ...POSITION_BEHAVIOUR_KEYS,
      ...POWER_KEYS
    ],
    grouped: [LIGHT_KEYS],
    options: [...pollOptions(true), tapWindowOption(), kcNumberingOption(), kcLayoutOption()]
  },
  kp2: keypadFamily(2),
  kp3: keypadFamily(3),
  kp6: keypadFamily(6),
  z2io: {
    exposes: (device) => {
      const ieee = device?.ieeeAddr;
      let mode;
      try {
        mode = ieee ? runtime().z2ioMode(ieee.toLowerCase()) : void 0;
      } catch {
        mode = void 0;
      }
      return z2ioExposes(mode ?? Z2IO_DEFAULT_MODE);
    },
    keys: ["relay_1", "relay_2", "relay_1_pulse", "relay_2_pulse", "pulse_duration", "io_mode", "poll", "temperature", "humidity", "external_temperature"]
  },
  sr250: remoteFamily(SR250_BUTTONS, false),
  sr260: remoteFamily(SR260_BUTTONS, true)
};
function kcLayoutOf(device) {
  const ieee = device?.ieeeAddr;
  let layout;
  try {
    layout = ieee ? runtime().kcLayout?.(ieee.toLowerCase()) : void 0;
  } catch {
    layout = void 0;
  }
  return layout ?? { wires: void 0, numbering: "pairs" };
}
function kcExposes(layout) {
  return [...kcKeypadExposes(layout), ...gen3Health(false)];
}
function kdExposes(layout) {
  const wires = layout.wires ?? Array.from({ length: KC_POSITIONS }, (_, i) => i);
  return [
    e.light_brightness(),
    ...transitions(),
    ...tvParams(APD120_TV_PARAMS),
    ...kcKeypadExposes(layout, names(AUX_BUTTONS)),
    ...wires.map(
      (w) => e.enum(`button_position_${w + 1}_behaviour`, ea.STATE_SET, [...BUTTON_BEHAVIOUR_NAMES]).withLabel(`Position ${w + 1} button behaviour`).withDescription(
        `What the button at position ${w + 1} from the top does to the load: load_on, load_off, toggle, momentary (dims while held, back on release) or event_only (only sends its taps). Factory: toggle`
      ).withCategory("config")
    ),
    ...powerSensors(),
    dimmingPhase(),
    ...gen3Health(true)
  ];
}
function kcKeypadExposes(layout, extraButtons = []) {
  const wires = layout.wires;
  const buttonNames = wires ? [...new Set(wires.map((w) => `button_${kcButtonNumber(w, layout)}`))] : Array.from({ length: KC_POSITIONS }, (_, i) => `button_${i + 1}`);
  const leds = [];
  const add = (slot, label) => leds.push(
    ledColor(`led_${slot + 1}_idle_color`, `${label} idle colour`),
    ledColor(`led_${slot + 1}_pressed_color`, `${label} pressed colour`),
    ledMode(`led_${slot + 1}_mode`, `${label} mode`)
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
    e.numeric("backlight_brightness", ea.STATE_SET).withValueMin(0).withValueMax(100).withValueStep(1).withUnit("%").withLabel("Backlight brightness").withDescription("Brightness of the light behind the buttons' engraving (c4.dmx.blc)").withCategory("config"),
    ...multiclickTimes(),
    ambient(),
    ledNotification()
  ];
}
function keypadFamily(n) {
  const ex2 = [
    actions(keypadNames(n), [...TAP_GESTURES, ...COUNTER_GESTURES], ["led_notification_start", "led_notification_end"]),
    ledBrightness(),
    ledTransition()
  ];
  const keys = ["led_brightness", "led_transition", ...LED_ENGINE_KEYS, ...LED_CLUSTER_KEYS];
  for (let i = 1; i <= n; i++) {
    ex2.push(ledColor(`button_${i}_idle_color`, `Button ${i} idle colour`), ledColor(`button_${i}_pressed_color`, `Button ${i} pressed colour`));
    keys.push(`button_${i}_idle_color`, `button_${i}_pressed_color`);
  }
  ex2.push(ledNotification());
  return { exposes: ex2, keys, options: [tapWindowOption()] };
}
function remoteFamily(buttons, sr260) {
  const exposes = [
    actions(names(buttons), REMOTE_GESTURES, ["motion_wake", "menu_select", "menu_cancel"]),
    e.battery(),
    e.text("room_name", ea.STATE_SET).withLabel("LCD room").withDescription("Row 1 of the LCD (c4.ln.ri)"),
    e.text("active_source", ea.STATE_SET).withLabel("LCD source").withDescription("Row 2 of the LCD (c4.ln.ri)")
  ];
  if (sr260) {
    exposes.push(e.text("display_message", ea.STATE_SET).withLabel("LCD message").withDescription("Pop-up message (empty clears it)"));
    exposes.push(
      e.text("text_color", ea.STATE_SET).withLabel("Text colour").withDescription(
        "#RRGGBB (or a palette name, or the 0-255 byte), matched to the remote's 256 colours (c4.zr.tc); empty stops re-sending it, and the remote keeps the last colour it was sent"
      )
    );
  }
  return {
    exposes,
    keys: [...REMOTE_KEYS, ...sr260 ? ["show_message", "text_color"] : []],
    options: [e.text("lcd_default_room", ea.SET).withDescription("Room shown on the LCD until room_name is set (default: Home)")]
  };
}
function definition(model, zigbeeModel, description, fam) {
  const keys = [...fam?.keys ?? [], ...COMMON_KEYS];
  const exposes = fam?.exposes ?? [
    e.text("c4_model", ea.STATE_SET).withDescription("Model not known yet: set it (e.g. C4-DIM1-Z) or wait for the device's check-in"),
    e.text("reported_model", ea.STATE).withLabel("Reported model").withDescription("The model the device's check-in named, when this build doesn't support it yet (its frames are logged at info)").withCategory("diagnostic")
  ];
  const def = {
    zigbeeModel,
    model,
    vendor: MANUFACTURER,
    description: `Control4 ${description}`,
    fromZigbee: [],
    toZigbee: converters(keys, fam?.grouped ?? []),
    exposes
  };
  if (fam?.endpoint) def.endpoint = fam.endpoint;
  if (fam?.multiEndpoint) def.meta = { multiEndpoint: true };
  if (fam?.options) def.options = fam.options;
  return def;
}
function buildDefinitions() {
  const defs = MODELS.map((m) => definition(m.model, m.aliases, m.description, FAMILIES[m.family]));
  defs.push(definition(GENERIC_MODEL, [GENERIC_MODEL], "Zigbee device (model not yet known)", void 0));
  return defs;
}

// src/z2m/converter-entry.ts
var loaded = { api: RUNTIME_API, file: fileHash(import.meta.url) };
globalThis[CONVERTER_KEY] = loaded;
var converter_entry_default = buildDefinitions();
export {
  converter_entry_default as default
};
