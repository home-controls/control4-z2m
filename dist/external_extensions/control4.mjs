// control4-z2m 0.1.0 - Zigbee2MQTT external extension
// Generated from src/ by tools/build.mjs - edit the TypeScript, not this file.


// src/z2m/extension.ts
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

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
function buildIdOf(extensionHash, converterHash) {
  return sha256(`${extensionHash}:${converterHash}`).slice(0, 12);
}

// src/core/constants.ts
var PROFILE_NETWORK = 49757;
var PROFILE_BUTTON = 49756;
var PROFILE_OUTLET = 49758;
var C4_PROFILES = /* @__PURE__ */ new Set([PROFILE_NETWORK, PROFILE_BUTTON, PROFILE_OUTLET]);
var HA_PROFILE = 260;
var C4_CLUSTER = 1;
var C4_IEEE_PREFIX = "0x000fff";
var MANUFACTURER = "Control4";
var GENERIC_MODEL = "C4-Zigbee";
var CONTRACT = 1;
var ATTR_LEVEL = 0;
var ATTR_FIRMWARE = 4;
var ATTR_MODEL = 7;
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
function isValidModel(model) {
  return typeof model === "string" && !INVALID_MODELS.has(model.trim().toLowerCase());
}
function modelFromCheckin(raw) {
  const parts = raw.split(":");
  return (parts.length >= 3 ? parts.slice(2).join(":") : raw).trim();
}
function canonicalModel(raw) {
  const text = raw.trim();
  for (const info of MODELS) {
    if (info.aliases.includes(text)) return text;
  }
  const lower = text.toLowerCase();
  let best;
  for (const info of MODELS) {
    for (const alias of info.aliases) {
      const a = alias.toLowerCase();
      if (a === lower) return alias;
      if (lower.startsWith(a) && (best === void 0 || alias.length > best.length)) best = alias;
    }
  }
  return best ?? text;
}
function definitionModel(model) {
  return modelInfo(model) ? model : GENERIC_MODEL;
}
function modelInfo(model) {
  if (!model) return void 0;
  const canon = canonicalModel(model);
  return MODELS.find((m) => m.aliases.includes(canon));
}
function isC4Ieee(ieee) {
  return typeof ieee === "string" && ieee.toLowerCase().startsWith(C4_IEEE_PREFIX);
}
var GESTURES = {
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
  tap_known: "remote_button_tap_known"
};
function clickGesture(countHex) {
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
var DEFAULT_TAP_WINDOW_MS = 550;
var MIN_TAP_WINDOW_MS = 250;
var MAX_TAP_WINDOW_MS = 1500;
var TAP_WINDOW_OPTION = "tap_window";
var PADDLE_BUTTONS = { 0: "top", 1: "top", 5: "bottom" };
var FAN_BUTTONS = {
  0: "top",
  1: "high",
  2: "medium_high",
  3: "medium_low",
  4: "low",
  5: "off"
};
var DM_BUTTONS = { 0: "button_1", 1: "button_2" };
var OUTLET_BUTTONS = { 0: "outlet_1", 1: "outlet_2" };
var KP_BUTTON_IDS = { kp2: [0, 2], kp3: [0, 1, 2], kp6: [0, 1, 2, 3, 4, 5] };
function keypadButtonsOf(ids) {
  return Object.fromEntries(ids.map((id, i) => [id, `button_${i + 1}`]));
}
function buttonNumberOf(name) {
  const m = /^button_([1-9]\d*)$/.exec(name);
  return m ? Number(m[1]) : void 0;
}
var KC_POSITIONS = 7;
var AUX_BUTTONS = { 7: "aux_top", 8: "aux_bottom" };
var KC_LED_SLOTS = 12;
var KC_NUMBERING_OPTION = "button_numbering";
var KC_LAYOUT_OPTION = "button_layout";
function kcNumbering(raw) {
  return raw === "slots" || raw === "fitted" ? raw : "pairs";
}
function kcButtonNumber(wire, layout) {
  if (layout.numbering === "fitted" && layout.wires) {
    const i = layout.wires.indexOf(wire);
    return i >= 0 ? i + 1 : layout.wires.length + wire + 1;
  }
  return layout.numbering === "pairs" ? (wire >> 1) + 1 : wire + 1;
}
function kcWireOf(n, layout) {
  if (n < 1) return void 0;
  if (layout.numbering === "fitted" && layout.wires) return n <= layout.wires.length ? layout.wires[n - 1] : n - layout.wires.length - 1;
  return layout.numbering === "pairs" ? (n - 1) * 2 : n - 1;
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
var REMOTE_COMMANDS = { press: "remote_button_short_press", hold: "remote_button_long_press", release: "remote_button_short_release" };
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
var PALETTE_HEX = {
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
  pink: "ff2080"
};
var RAMP_IDX_ON = 2;
var RAMP_IDX_OFF = 3;
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
var ENERGY_WH_PER_COUNT = 1.27;

// src/core/protocol.ts
function buildFrame(text) {
  return Buffer.from(`${text}\r
`, "latin1");
}
function hex4(n) {
  return (n & 65535).toString(16).padStart(4, "0");
}
function hex2(n) {
  return (n & 255).toString(16).padStart(2, "0");
}
function sanitize(text) {
  return String(text ?? "").replace(/[\r\n]/g, " ").replace(/"/g, "");
}
var APP_HEADER_PROFILES = [PROFILE_NETWORK, PROFILE_BUTTON, PROFILE_OUTLET].map((p) => [p & 255, p >> 8]);
function stripAppHeader(data) {
  if (data.length >= 8) {
    for (const [lo, hi] of APP_HEADER_PROFILES) {
      if (data[4] === lo && data[5] === hi) return data.subarray(8);
    }
  }
  return data;
}
function parseFrame(data) {
  const raw = stripAppHeader(data).toString("latin1");
  const nul = raw.indexOf("\0");
  const text = (nul >= 0 ? raw.slice(0, nul) : raw).trim();
  const tokens = tokenize(text);
  const head = tokens[0] ?? "";
  const prefix = head.slice(0, 2);
  const kind = prefix === "0t" ? "announce" : prefix === "0r" ? "reply" : prefix === "0s" ? "set" : prefix === "0g" ? "get" : prefix === "0i" ? "init" : "other";
  return { text, tokens, kind, seq: head.slice(2, 6).toLowerCase() };
}
function tokenize(text) {
  const out = [];
  const re = /"[^"]*"|\S+/g;
  let m = re.exec(text);
  while (m !== null) {
    out.push(m[0]);
    m = re.exec(text);
  }
  return out;
}
function lastValue(values) {
  return values[values.length - 1];
}
function parseHex(value) {
  if (value === void 0) return void 0;
  const n = Number.parseInt(value, 16);
  return Number.isNaN(n) ? void 0 : n;
}
function pctToBrightness(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  if (pct >= 99) return 254;
  return Math.round(pct * 254 / 100);
}
function parseZclHeader(data) {
  if (data.length < 3) return void 0;
  const fc = data[0];
  let i = 1;
  let manufacturerCode;
  if (fc & 4) {
    if (data.length < 5) return void 0;
    manufacturerCode = data.readUInt16LE(1);
    i = 3;
  }
  return { frameControl: fc, manufacturerCode, tsn: data[i], commandId: data[i + 1], offset: i + 2 };
}
var FIXED_SIZES = {
  8: 1,
  9: 2,
  10: 3,
  11: 4,
  16: 1,
  24: 1,
  25: 2,
  26: 3,
  27: 4,
  32: 1,
  33: 2,
  34: 3,
  35: 4,
  36: 5,
  37: 6,
  38: 7,
  39: 8,
  40: 1,
  41: 2,
  42: 3,
  43: 4,
  48: 1,
  49: 2,
  57: 4,
  226: 4,
  232: 2,
  233: 2,
  234: 4,
  240: 8
};
function readValue(type, buf, i) {
  if (type === 65 || type === 66) {
    if (i >= buf.length) return void 0;
    const len = buf[i];
    if (len === 255) return [type === 66 ? "" : Buffer.alloc(0), i + 1];
    const end = i + 1 + len;
    if (end > buf.length) return void 0;
    const raw2 = buf.subarray(i + 1, end);
    return [type === 66 ? raw2.toString("latin1") : Buffer.from(raw2), end];
  }
  const size = FIXED_SIZES[type];
  if (size === void 0 || i + size > buf.length) return void 0;
  const raw = buf.subarray(i, i + size);
  let value;
  if (type === 16) value = raw[0] !== 0;
  else if (type === 240) value = Buffer.from(raw);
  else if (type >= 40 && type <= 43) value = raw.readIntLE(0, size);
  else if (size <= 6) value = raw.readUIntLE(0, size);
  else value = Buffer.from(raw);
  return [value, i + size];
}
function parseReportAttributes(payload) {
  const out = /* @__PURE__ */ new Map();
  let i = 0;
  while (i + 3 <= payload.length) {
    const id = payload.readUInt16LE(i);
    const type = payload[i + 2];
    const r = readValue(type, payload, i + 3);
    if (!r) break;
    out.set(id, r[0]);
    i = r[1];
  }
  return out;
}
function parseReadAttributesResponse(payload) {
  const out = /* @__PURE__ */ new Map();
  let i = 0;
  while (i + 3 <= payload.length) {
    const id = payload.readUInt16LE(i);
    const status = payload[i + 2];
    i += 3;
    if (status !== 0) continue;
    if (i >= payload.length) break;
    const type = payload[i];
    const r = readValue(type, payload, i + 1);
    if (!r) break;
    out.set(id, r[0]);
    i = r[1];
  }
  return out;
}
function ieeeToBytesLE(ieee) {
  const hex = ieee.toLowerCase().replace(/^0x/, "").replace(/[^0-9a-f]/g, "").padStart(16, "0");
  return Buffer.from(hex, "hex").reverse();
}
function buildIdentityFrame(coordinatorIeee, tsn, asReadResponse = false) {
  const eui = ieeeToBytesLE(coordinatorIeee);
  const parts = [Buffer.from([8, tsn & 255, asReadResponse ? 1 : 10])];
  const status = asReadResponse ? [0] : [];
  parts.push(Buffer.from([8, 0, ...status, 33, 0, 0]));
  parts.push(Buffer.from([9, 0, ...status, 240]), eui);
  parts.push(Buffer.from([10, 0, ...status, 32, 2]));
  return Buffer.concat(parts);
}
function buildZclCommand(tsn, commandId, payload = []) {
  return Buffer.from([17, tsn & 255, commandId & 255, ...payload]);
}
var CLUSTER_ON_OFF = 6;
var CLUSTER_LEVEL = 8;
function moveToLevelWithOnOff(tsn, level, transitionTenths) {
  const t = Math.max(0, Math.min(65535, Math.round(transitionTenths)));
  return buildZclCommand(tsn, 4, [Math.max(0, Math.min(254, Math.round(level))), t & 255, t >> 8]);
}
function rgbHex(rgb2) {
  return rgb2.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}
function hexRgb(hex) {
  const n = Number.parseInt(hex, 16) || 0;
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function scaleHex(hex, pct) {
  const p = Math.max(1, Math.min(100, Math.trunc(pct)));
  if (p === 100) return hex;
  return rgbHex(hexRgb(hex).map((c) => c ? Math.max(1, Math.floor(c * p / 100)) : 0));
}
function scaleRgb(rgb2, pct) {
  const p = Math.max(0, Math.min(100, Math.trunc(pct)));
  if (p === 100) return rgb2;
  if (p === 0) return [0, 0, 0];
  return rgb2.map((c) => {
    const v = Math.round(c * p / 100);
    return c > 0 && v === 0 ? 1 : v;
  });
}
function blendRgb(a, b, f) {
  const t = Math.max(0, Math.min(1, f));
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}
function blendHex(a, b, f) {
  return rgbHex(blendRgb(hexRgb(a), hexRgb(b), f));
}
function hueRgb(hue, brightness = 100) {
  const h = (hue % 1 + 1) % 1 * 6;
  const i = Math.floor(h);
  const f = h - i;
  const q = 1 - f;
  const table = [
    [1, f, 0],
    [q, 1, 0],
    [0, 1, f],
    [0, q, 1],
    [f, 0, 1],
    [1, 0, q]
  ];
  const [r, g, b] = table[i % 6];
  return scaleRgb([Math.trunc(r * 255), Math.trunc(g * 255), Math.trunc(b * 255)], brightness);
}

// src/core/leds.ts
var FADE_STEPS = 20;
var DM_LED_THROTTLE = 150;
var LED_BRIGHTNESS_KEY = "led_brightness";
var LED_TRANSITION_KEY = "led_transition";
function paletteHex(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    const name = PALETTE_NAMES[value];
    if (name) return PALETTE_HEX[name];
  }
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (text in PALETTE_HEX) return PALETTE_HEX[text];
  const hex = text.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/.test(hex)) return hex;
  throw new Error(`unknown LED colour '${value}' (use one of ${PALETTE_NAMES.join(", ")})`);
}
function normalizePalette(value) {
  if (typeof value === "number" && PALETTE_NAMES[value]) return PALETTE_NAMES[value];
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (PALETTE_NAMES.includes(text)) return text;
  throw new Error(`unknown LED colour '${value}' (use one of ${PALETTE_NAMES.join(", ")})`);
}
var LED_DEFAULT_COLOUR = "off";
var LED_DEFAULTS_KEY = "led_defaults";
var LED_DEFAULTS_MIGRATION = "led_defaults_v1";
var LedWriter = class {
  constructor(dev, protocol) {
    this.dev = dev;
    this.protocol = protocol;
  }
  dev;
  protocol;
  /** What each `<slot>:<param>` was last sent; a write of the same colour is skipped. */
  lastSent = /* @__PURE__ */ new Map();
  fadeTokens = /* @__PURE__ */ new Map();
  /** Keys a fade is still drawing: their lastSent is a step on the way, not where they end. */
  fading = /* @__PURE__ */ new Set();
  /**
   * What each key's write in flight carries. A write queued behind others hasn't
   * landed yet, and a re-apply meanwhile must not send the same colour again: three
   * brightness sets back to back once re-sent every colour three times over.
   */
  queued = /* @__PURE__ */ new Map();
  /** The newest write token of each key that has landed: an older write landing late doesn't overwrite it. */
  landed = /* @__PURE__ */ new Map();
  brightness() {
    const v = Number(this.dev.setting(LED_BRIGHTNESS_KEY, 100));
    return Number.isFinite(v) ? Math.max(1, Math.min(100, Math.trunc(v))) : 100;
  }
  fadeMs() {
    const v = Number(this.dev.setting(LED_TRANSITION_KEY, 0));
    return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) * 1e3 : 0;
  }
  /** Record what a slot shows, so the next fade starts from there. */
  noteSent(slot, param, hex) {
    this.lastSent.set(`${slot}:${param}`, hex);
  }
  /** The device may have lost what it was sent (it rebooted): the next write of every slot goes out. */
  forget() {
    this.lastSent.clear();
  }
  /** Already showing `hex` (or a write of it is on its way) and not mid-fade: a write would change nothing. */
  unchanged(key, hex) {
    return (this.queued.get(key) ?? this.lastSent.get(key)) === hex && !this.fading.has(key);
  }
  /** A new write token for `key`: a fade still drawing it stops at its next step. */
  bump(key) {
    const token = (this.fadeTokens.get(key) ?? 0) + 1;
    this.fadeTokens.set(key, token);
    return token;
  }
  /**
   * Send one write of `hex` for `key`, counted as on its way until it lands. Only a
   * write that went out counts as sent: a lost one is sent again next time.
   */
  async send(key, hex, write) {
    const token = this.bump(key);
    this.fading.delete(key);
    this.queued.set(key, hex);
    try {
      const ok = await write();
      if (ok && token > (this.landed.get(key) ?? 0)) {
        this.lastSent.set(key, hex);
        this.landed.set(key, token);
      } else if (!ok && this.fadeTokens.get(key) === token) {
        this.lastSent.delete(key);
      }
      return ok;
    } finally {
      if (this.fadeTokens.get(key) === token) this.queued.delete(key);
    }
  }
  /** Scaled hex for a palette entry at the current LED brightness. */
  scaled(colour) {
    return scaleHex(paletteHex(colour), this.brightness());
  }
  /**
   * Write a colour to slots. A slot already showing it is skipped. Returns how
   * many slots were written (or started fading).
   */
  async apply(slots, verb, colour) {
    const hex = this.scaled(colour);
    const idle = verb === "idle";
    const fade = idle ? this.fadeMs() : 0;
    const dev = this.dev;
    const link = dev.ctx.link;
    if (this.protocol === "dmx") {
      const param = idle ? "04" : "03";
      let written2 = 0;
      for (const i of slots) {
        const build = (c) => `c4.dmx.led ${hex2(i)} ${param} ${c}`;
        const wrote = await this.crossfade(
          i,
          param,
          build,
          hex,
          fade,
          () => link.scheduleVerify(
            dev,
            `dmx led ${hex2(i)} ${param}`,
            `c4.dmx.led ${hex2(i)} ${param}`,
            (values) => values[values.length - 1].toLowerCase() === hex,
            () => dev.trySet(build(hex))
          )
        );
        if (wrote) written2++;
      }
      return written2;
    }
    if (this.protocol === "dm") {
      const b = slots[0] ?? 0;
      const suffix = idle ? "f" : "o";
      if (this.unchanged(`${b}:${suffix}`, hex)) return 0;
      const write = async () => {
        const ok = await dev.trySet(`c4.dm.l${b}${suffix} ${hex}`);
        await dev.sleep(DM_LED_THROTTLE);
        await dev.trySet("c4.dm.lm 01");
        return ok;
      };
      await this.send(`${b}:${suffix}`, hex, write);
      const field = 4 + 2 * b + (suffix === "o" ? 0 : 1);
      void link.scheduleVerify(dev, `dm led ${b}${suffix}`, "c4.dm.is", (values) => values[field].toLowerCase() === hex, write, DM_LED_THROTTLE);
      return 1;
    }
    let written = 0;
    for (const i of slots) {
      if (idle) {
        const store = !this.unchanged(`${i}:lf`, hex);
        if (store) await this.send(`${i}:lf`, hex, () => dev.trySet(`c4.kp.lf ${hex2(i)} ${hex}`));
        const shown = await this.crossfade(i, "lv", (c) => `c4.kp.lv ${hex2(i)} ${c}`, hex, fade);
        if (store || shown) written++;
      } else if (!this.unchanged(`${i}:lo`, hex)) {
        await this.send(`${i}:lo`, hex, () => dev.trySet(`c4.kp.lo ${hex2(i)} ${hex}`));
        written++;
      }
    }
    return written;
  }
  /** Show `target` on a slot, fading from what it shows when `fadeMs` > 0. False when it already shows it. */
  async crossfade(slot, param, build, target, fadeMs, onDone) {
    const key = `${slot}:${param}`;
    if (this.unchanged(key, target)) return false;
    const start = this.queued.get(key) ?? this.lastSent.get(key);
    if (!start || fadeMs <= 0 || start === target) {
      await this.send(key, target, () => this.dev.trySet(build(target)));
      onDone?.();
      return true;
    }
    const token = this.bump(key);
    this.queued.delete(key);
    this.landed.set(key, token);
    const gap = fadeMs / FADE_STEPS;
    const run = async () => {
      try {
        let ok = false;
        for (let i = 1; i <= FADE_STEPS; i++) {
          if (this.fadeTokens.get(key) !== token || !this.dev.alive) return;
          const started = Date.now();
          const mix = blendHex(start, target, i / FADE_STEPS);
          ok = await this.dev.trySet(build(mix));
          if (ok) this.lastSent.set(key, mix);
          if (i < FADE_STEPS) await this.dev.sleep(Math.max(0, gap - (Date.now() - started)));
        }
        if (ok) this.lastSent.set(key, target);
        else this.lastSent.delete(key);
        onDone?.();
      } finally {
        if (this.fadeTokens.get(key) === token) this.fading.delete(key);
      }
    };
    this.fading.add(key);
    this.dev.spawn(run());
    return true;
  }
  /**
   * A slot's LED mode (`c4.dmx.led <slot> 01 <code>`): programmed, follow load or
   * push/release. Param 02 (what it follows) and param 00 stay as the device has
   * them (tested 2026-11-07). Read back after; a lost write is sent once more.
   */
  async setMode(slot, mode) {
    const code = hex2(LED_MODES[mode]);
    const cmd = `c4.dmx.led ${hex2(slot)} 01 ${code}`;
    await this.dev.set(cmd);
    void this.dev.ctx.link.scheduleVerify(
      this.dev,
      `dmx led ${hex2(slot)} 01`,
      `c4.dmx.led ${hex2(slot)} 01`,
      (values) => lastValue(values)?.toLowerCase() === code,
      () => this.dev.trySet(cmd)
    );
  }
  /**
   * Show every stored colour at the current brightness (after a brightness
   * change): each slot once, with the colour of the last select covering it.
   * Only a slot whose scaled colour differs from what it shows is written, so
   * an off slot (black at any brightness) or a repeat of the same brightness
   * costs no frame. Returns how many slots have a stored colour and how many
   * were written.
   */
  async reapply(selects) {
    const effective = /* @__PURE__ */ new Map();
    for (const sel of selects) {
      const stored = this.dev.setting(sel.key);
      if (stored === void 0) continue;
      for (const slot of sel.slots) effective.set(`${sel.verb}:${slot}`, { slot, verb: sel.verb, colour: stored });
    }
    let written = 0;
    for (const e of effective.values()) {
      if (!this.dev.alive) break;
      written += await this.apply([e.slot], e.verb, e.colour);
    }
    return { stored: effective.size, written };
  }
};

// src/core/animation.ts
var TX_INTERVAL = 45;
var TX_QUEUE_MAX = 32;
var TX_TARGET_MAX = 16;
var MAX_ACTIVE_ANIMATIONS = 8;
var MIN_INTERVAL = 150;
var MIN_BASE_INTERVAL = 750;
var DM_STEP_PER_LED = DM_LED_THROTTLE + 50;
var DEFAULT_SOLID_DURATION = 3e3;
var PULSE_GAMMA = 2.2;
var LED_HEAL_DELAYS = [3e4, 12e4, 6e5];
var PALETTE_RGB = { black: [0, 0, 0] };
for (const name of PALETTE_NAMES) PALETTE_RGB[name] = hexRgb(PALETTE_HEX[name]);
var STATUS_COLOURS = {
  ok: "green",
  on: "amber",
  off: "off",
  idle: "off",
  info: "blue",
  warning: "amber",
  alert: "red",
  error: "red",
  unavailable: "red",
  unknown: "purple"
};
function parseColour(value, fallback = [0, 0, 0]) {
  if (value === void 0 || value === null) return fallback;
  if (Array.isArray(value)) {
    if (value.length !== 3) throw new Error(`colour ${JSON.stringify(value)} needs exactly 3 components`);
    return value.map((c) => Math.max(0, Math.min(255, Math.trunc(Number(c)))));
  }
  if (typeof value === "boolean") throw new Error(`colour ${value} is not a colour`);
  if (typeof value === "number") {
    const name = PALETTE_NAMES[value];
    return name ? PALETTE_RGB[name] : fallback;
  }
  const text = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return fallback;
  if (text in PALETTE_RGB) return PALETTE_RGB[text];
  if (text in STATUS_COLOURS) return PALETTE_RGB[STATUS_COLOURS[text]];
  let hex = text.startsWith("#") ? text.slice(1) : text;
  if (/^[0-9a-f]{3}$/.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (/^[0-9a-f]{6}$/.test(hex)) return hexRgb(hex);
  throw new Error(`unrecognised colour '${value}'`);
}
function resolveSpec(spec) {
  return {
    ...spec,
    buttons: [...spec.buttons],
    colour: scaleRgb(spec.colour, spec.brightness),
    colour2: scaleRgb(spec.colour2, spec.brightness),
    interval: Math.max(MIN_INTERVAL, spec.interval),
    count: Math.max(0, Math.trunc(spec.count)),
    duration: spec.duration === void 0 ? void 0 : Math.max(100, spec.duration)
  };
}
function frame(buttons, pick) {
  const f = /* @__PURE__ */ new Map();
  buttons.forEach((b, i) => f.set(b, pick(b, i)));
  return f;
}
function* solid(s) {
  yield frame(s.buttons, () => s.colour);
}
function* blink(s) {
  yield frame(s.buttons, () => s.colour);
  yield frame(s.buttons, () => s.colour2);
}
function* pulse(s) {
  const steps = 8;
  const seq = [...Array(steps).keys(), ...Array.from({ length: steps }, (_, k) => steps - k)];
  for (const i of seq) {
    const c = blendRgb(s.colour2, s.colour, (i / steps) ** PULSE_GAMMA);
    yield frame(s.buttons, () => c);
  }
}
function* chase(s) {
  for (const lit of s.buttons) yield frame(s.buttons, (b) => b === lit ? s.colour : s.colour2);
}
function* bounce(s) {
  const order = [...s.buttons, ...s.buttons.slice(1, -1).reverse()];
  for (const lit of order) yield frame(s.buttons, (b) => b === lit ? s.colour : s.colour2);
}
function* fill(s) {
  for (let i = 0; i <= s.buttons.length; i++) {
    const lit = new Set(s.buttons.slice(0, i));
    yield frame(s.buttons, (b) => lit.has(b) ? s.colour : s.colour2);
  }
  for (let i = s.buttons.length; i >= 0; i--) {
    const lit = new Set(s.buttons.slice(0, i));
    yield frame(s.buttons, (b) => lit.has(b) ? s.colour : s.colour2);
  }
}
function* alternate(s) {
  for (const phase of [0, 1]) yield frame(s.buttons, (_b, i) => i % 2 === phase ? s.colour : s.colour2);
}
function* rainbow(s) {
  const steps = 12;
  const n = Math.max(1, s.buttons.length);
  for (let st = 0; st < steps; st++) yield frame(s.buttons, (_b, i) => hueRgb(i / n + st / steps, s.brightness));
}
function* strobe(s) {
  for (let k = 0; k < 2; k++) {
    yield frame(s.buttons, () => s.colour);
    yield frame(s.buttons, () => s.colour2);
  }
  yield frame(s.buttons, () => s.colour2);
  yield frame(s.buttons, () => s.colour2);
}
var EFFECTS = {
  solid,
  blink,
  pulse,
  breathe: pulse,
  chase,
  bounce,
  fill,
  alternate,
  rainbow,
  strobe
};
var EFFECT_DEFAULT_INTERVAL = {
  solid: DEFAULT_SOLID_DURATION,
  blink: 400,
  pulse: 120,
  breathe: 120,
  chase: 180,
  bounce: 180,
  fill: 150,
  alternate: 400,
  rainbow: 200,
  strobe: 120
};
var sleep = (ms) => new Promise((r) => {
  const t = setTimeout(r, ms);
  t.unref?.();
});
var TxPump = class {
  constructor(log) {
    this.log = log;
  }
  log;
  queue = [];
  busy = /* @__PURE__ */ new Set();
  running = false;
  stopped = false;
  sent = 0;
  dropped = 0;
  failed = 0;
  queuedFor(target) {
    let n = 0;
    for (const item of this.queue) if (item.target === target) n++;
    return n;
  }
  full(target) {
    return this.queue.length >= TX_QUEUE_MAX || this.queuedFor(target) >= TX_TARGET_MAX;
  }
  /** Queue one frame; false when dropped (queue full). `done` hears whether a queued frame went out. */
  submit(target, cmd, done) {
    if (this.stopped || target.alive === false || this.full(target)) {
      this.dropped++;
      if (this.dropped % 50 === 1) this.log.debug(`Control4 LED: TX queue full - ${this.dropped} frames dropped so far`);
      return false;
    }
    this.queue.push({ target, cmd, done });
    this.kick();
    return true;
  }
  /** Queue a frame and wait until it has gone out (waits for room, never drops). */
  async send(target, cmd) {
    while (this.full(target) && !this.stopped && target.alive !== false) await sleep(TX_INTERVAL);
    if (this.stopped || target.alive === false) return false;
    return new Promise((resolve) => {
      this.queue.push({ target, cmd, done: resolve });
      this.kick();
    });
  }
  kick() {
    if (this.running || this.stopped) return;
    this.running = true;
    void this.drain();
  }
  async drain() {
    while (!this.stopped) {
      const idx = this.queue.findIndex((i) => !this.busy.has(i.target));
      if (idx < 0) break;
      const item = this.queue.splice(idx, 1)[0];
      if (item.target.alive === false) {
        item.done?.(false);
        continue;
      }
      this.busy.add(item.target);
      void item.target.set(item.cmd).then(
        () => this.finish(item, true),
        (error) => {
          this.log.debug(`Control4 LED: frame '${item.cmd}' failed: ${error}`);
          this.finish(item, false);
        }
      );
      await sleep(TX_INTERVAL);
    }
    this.running = false;
  }
  finish(item, ok) {
    if (ok) this.sent++;
    else this.failed++;
    this.busy.delete(item.target);
    item.done?.(ok);
    if (this.queue.length) this.kick();
  }
  stop() {
    this.stopped = true;
    for (const item of this.queue) item.done?.(false);
    this.queue = [];
  }
  stats() {
    return { sent: this.sent, dropped: this.dropped, failed: this.failed, queued: this.queue.length, in_flight: this.busy.size };
  }
};
var Animator = class {
  constructor(host, buttons, protocol, engine) {
    this.host = host;
    this.buttons = buttons;
    this.protocol = protocol;
    this.engine = engine;
  }
  host;
  buttons;
  protocol;
  engine;
  status = /* @__PURE__ */ new Map();
  /**
   * Buttons a status, a clear or an effect has named since this start. The status
   * layer leaves every other LED alone: it keeps what the device last showed, so
   * a start does not repaint LEDs the next led_status call puts back.
   */
  painted = /* @__PURE__ */ new Set();
  /** kp / dmx: the colour a status button shows while pressed (else the status colour). */
  pressed = /* @__PURE__ */ new Map();
  deferTimer;
  deferForce = false;
  statusEffect;
  statusRun;
  overlay;
  overlayPriority = -1;
  overlayButtons = [];
  lastSent = /* @__PURE__ */ new Map();
  /** dmx: follow-load LEDs switched to programmed mode for a status colour, to give back when it clears. */
  borrowed = /* @__PURE__ */ new Set();
  dmWant = /* @__PURE__ */ new Map();
  dmShown = /* @__PURE__ */ new Map();
  dmPainting = false;
  dmAttach = true;
  dmLost = [];
  /**
   * dm: bumped by every slot written. A read-back follows a paint only while the
   * latest writes are unconfirmed (dmConfirmed behind dmWrites), so a paint that
   * changes nothing costs no Zigbee read, and one whose read-back got no answer is
   * checked again at the next paint.
   */
  dmWrites = 0;
  dmConfirmed = 0;
  /** The next self-repaint of the status (LED_HEAL_DELAYS), while one is due. */
  healTimer;
  /** Self-repaints since the last led_status or refresh. */
  healTries = 0;
  /** A status frame did not go out since the last self-repaint. */
  healLost = false;
  get animating() {
    return this.overlay !== void 0;
  }
  /** A status colour / effect or an animation is on the LEDs (else the device shows its own stored colours). */
  get painting() {
    return this.status.size > 0 || this.statusEffect !== void 0 || this.animating;
  }
  state() {
    return {
      ieee: this.host.ieee,
      buttons: [...this.buttons],
      protocol: this.protocol,
      animating: this.animating,
      priority: this.animating ? this.overlayPriority : null,
      status: Object.fromEntries([...this.status].sort((a, b) => a[0] - b[0]).map(([b, c]) => [b, rgbHex(c)])),
      status_pressed: Object.fromEntries([...this.pressed].sort((a, b) => a[0] - b[0]).map(([b, c]) => [b, rgbHex(c)])),
      status_effect: this.statusEffect?.effect ?? null
    };
  }
  /**
   * 1-based LED numbers (as printed), button names (`button_3`, a paddle's `top`),
   * "all", "1,3", "button_1,4" or [1, 3] -> device ids.
   */
  resolveButtons(buttons) {
    if (buttons === void 0 || buttons === null) return [...this.buttons];
    const list = Array.isArray(buttons) ? buttons : [buttons];
    if (list.length === 0) return [...this.buttons];
    const tokens = list.flatMap((raw) => String(raw).replace(/,/g, " ").split(/\s+/)).filter(Boolean);
    const out = /* @__PURE__ */ new Set();
    for (const t of tokens.map((x) => x.trim().toLowerCase())) {
      if (t === "all" || t === "*") return [...this.buttons];
      if (/^\d+$/.test(t)) {
        const n = Number(t);
        if (n >= 1 && n <= this.buttons.length) out.add(this.buttons[n - 1]);
        else this.engine.log.warning(`Control4 LED [${this.host.name}]: button ${t} out of range (1-${this.buttons.length})`);
        continue;
      }
      const leds = this.host.ledsOf?.(t);
      if (leds) for (const b of leds) out.add(b);
      else this.engine.log.warning(`Control4 LED [${this.host.name}]: no button '${t}'`);
    }
    return this.buttons.filter((b) => out.has(b));
  }
  // -- transmission -------------------------------------------------------
  /**
   * `pressed`: per-button pressed colours (kp / dmx); a button without one shows its colour pressed too.
   * `heal`: a status paint - a frame of it that does not go out is painted again by itself
   * (LED_HEAL_DELAYS). An animation's frames drop by design and are not.
   */
  emit(colours, force = false, pressed, heal = false) {
    if (this.protocol === "dm") {
      this.dmEmit(colours, force);
      return;
    }
    for (const [btn, val] of colours) {
      if (val === "stored") {
        if (this.protocol === "dmx") this.giveBack(btn, force, heal);
        continue;
      }
      const hex = rgbHex(val);
      const press = pressed?.get(btn);
      const pressHex = press ? rgbHex(press) : hex;
      const key = pressHex === hex ? hex : `${hex}/${pressHex}`;
      if (!force && this.lastSent.get(btn) === key) continue;
      const lost = (ok) => {
        if (ok || this.lastSent.get(btn) !== key) return;
        this.lastSent.delete(btn);
        if (heal) this.noteLost();
      };
      let queued;
      if (this.protocol === "dmx" && this.dmxMode(btn) !== "push_release") {
        this.paintProgrammed(btn, hex, force, heal);
        continue;
      }
      if (this.protocol === "dmx") {
        queued = this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 03 ${pressHex}`, lost) && this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 04 ${hex}`, lost);
      } else {
        queued = this.engine.tx.submit(this.host, `c4.kp.lv ${hex2(btn)} ${hex}`, lost);
        if (press && queued) queued = this.engine.tx.submit(this.host, `c4.kp.lo ${hex2(btn)} ${pressHex}`, lost);
      }
      if (queued) this.lastSent.set(btn, key);
      else if (heal) this.noteLost();
    }
  }
  /**
   * dmx, a slot not in push/release mode: one frame per colour. A programmed LED shows
   * its param 05; a follow-load one is switched to programmed first, so the colour
   * stays through load changes (tested 2026-11-07), and given back when it clears.
   * There is no pressed colour in programmed mode.
   */
  paintProgrammed(btn, hex, force, heal = false) {
    const key = `p:${hex}`;
    if (!force && this.lastSent.get(btn) === key) return;
    const lost = (ok) => {
      if (ok || this.lastSent.get(btn) !== key) return;
      this.lastSent.delete(btn);
      if (heal) this.noteLost();
    };
    if (this.dmxMode(btn) === "follow_load" && !this.borrowed.has(btn)) {
      const borrowLost = (ok) => {
        if (ok || !this.borrowed.has(btn)) return;
        this.borrowed.delete(btn);
        this.host.onBorrow?.(btn, false);
        this.lastSent.delete(btn);
        if (heal) this.noteLost();
      };
      if (!this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 01 00`, borrowLost)) {
        if (heal) this.noteLost();
        return;
      }
      this.borrowed.add(btn);
      this.host.onBorrow?.(btn, true);
    }
    if (this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 05 ${hex}`, lost)) this.lastSent.set(btn, key);
    else if (heal) this.noteLost();
  }
  /** dmx: a slot's LED mode; undefined while not known (a host that names no modes: push/release). */
  dmxMode(btn) {
    return this.host.ledMode ? this.host.ledMode(btn) : "push_release";
  }
  /**
   * dmx: give a borrowed follow-load LED back. Its mode goes back to follow load, and
   * its param 05 to the colour that shows for the load now (on a follow-load slot 05
   * is the colour on show), whether or not the mode change repaints it.
   */
  giveBack(btn, force, heal = false) {
    if (!this.borrowed.has(btn)) return;
    if (!force && this.lastSent.get(btn) === "stored") return;
    const lost = (ok) => {
      if (ok || this.borrowed.has(btn)) return;
      this.borrowed.add(btn);
      this.host.onBorrow?.(btn, true);
      if (this.lastSent.get(btn) === "stored") this.lastSent.delete(btn);
      if (heal) this.noteLost();
    };
    if (!this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 01 01`, lost)) {
      if (heal) this.noteLost();
      return;
    }
    this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 05 ${this.host.idleHex(btn)}`);
    this.borrowed.delete(btn);
    this.host.onBorrow?.(btn, false);
    this.lastSent.set(btn, "stored");
  }
  /**
   * dmx: slots a status colour had borrowed before a restart (saved by the host). They
   * keep showing that colour, as every LED keeps what it shows over a start, and are
   * given back at the next clear.
   */
  seedBorrowed(slots) {
    for (const s of slots) if (this.buttons.includes(s)) this.borrowed.add(s);
  }
  /** dmx: the slot's mode was set from outside: it is no longer borrowed, and its next paint goes out. */
  forgetBorrowed(btn) {
    this.borrowed.delete(btn);
    this.lastSent.delete(btn);
  }
  /** The status pressed colours, minus the buttons an effect frame is drawing. */
  pressedOutside(f) {
    const p = new Map(this.pressed);
    for (const b of f.keys()) p.delete(b);
    return p;
  }
  // -- dm painter (C4-DIM1-Z) --------------------------------------------
  dmEmit(colours, force) {
    for (const [btn, val] of colours) {
      if (val === "stored") this.dmWant.set(btn, void 0);
      else {
        const hex = rgbHex(val);
        this.dmWant.set(btn, [hex, hex]);
      }
    }
    if (force) {
      this.dmShown.clear();
      this.dmAttach = true;
    }
    if (!this.dmPainting) {
      this.dmPainting = true;
      void this.dmPaint().finally(() => {
        this.dmPainting = false;
      });
    }
  }
  dmTarget(btn) {
    return this.dmWant.get(btn) ?? this.host.dmStored(btn);
  }
  dmVisible() {
    const on = this.host.loadOn();
    if (on === void 0) return [0, 1];
    return on ? [0] : [1];
  }
  async dmSend(cmd) {
    await this.engine.tx.send(this.host, cmd);
    await sleep(DM_LED_THROTTLE);
  }
  shown(btn) {
    let s = this.dmShown.get(btn);
    if (!s) {
      s = [void 0, void 0];
      this.dmShown.set(btn, s);
    }
    return s;
  }
  async dmPaint() {
    try {
      for (; ; ) {
        if (!this.host.alive) return;
        const vis = this.dmVisible();
        const todo = [];
        for (const b of this.dmWant.keys()) {
          for (const i of vis) {
            const t = this.dmTarget(b)[i];
            if (this.shown(b)[i] !== t) todo.push([b, i, t]);
          }
        }
        if (todo.length) {
          for (const [b, i, hex] of todo) {
            await this.dmSend(`c4.dm.l${b}${i === 0 ? "o" : "f"} ${hex}`);
            this.shown(b)[i] = hex;
            this.dmWrites++;
          }
          if (this.dmAttach) {
            this.dmAttach = false;
            await this.dmSend("c4.dm.lm 01");
          }
          continue;
        }
        const hidden = [];
        for (const b of this.dmWant.keys()) {
          for (const i of [0, 1]) {
            if (vis.includes(i)) continue;
            const t = this.dmTarget(b)[i];
            if (this.shown(b)[i] !== t) hidden.push([b, i, t]);
          }
        }
        if (!hidden.length) {
          if (this.dmConfirmed !== this.dmWrites) this.dmScheduleVerify();
          return;
        }
        for (const [b, i, hex] of hidden) {
          await this.dmSend(`c4.dm.l${b}${i === 0 ? "o" : "f"} ${hex}`);
          this.shown(b)[i] = hex;
          this.dmWrites++;
        }
      }
    } catch (error) {
      this.engine.log.debug(`Control4 LED [${this.host.name}]: dm paint failed: ${error}`);
    }
  }
  dmScheduleVerify() {
    if (this.animating || this.dmWant.size === 0) return;
    if (this.statusRun && !this.statusRun.cancelled) return;
    const writes = this.dmWrites;
    this.host.verifyDm(
      (values) => {
        const got = values.slice(-5, -1).map((v) => v.toLowerCase());
        this.dmLost = [];
        for (const b of this.dmWant.keys()) {
          if (b !== 0 && b !== 1) continue;
          for (const i of [0, 1]) {
            const t = this.dmTarget(b)[i];
            if (got[2 * b + i] !== t.toLowerCase()) this.dmLost.push([b, i, t]);
          }
        }
        if (this.dmLost.length === 0) this.dmConfirmed = Math.max(this.dmConfirmed, writes);
        return this.dmLost.length === 0;
      },
      async () => {
        for (const [b, i, hex] of [...this.dmLost]) {
          await this.dmSend(`c4.dm.l${b}${i === 0 ? "o" : "f"} ${hex}`);
          this.shown(b)[i] = hex;
        }
      }
    );
    this.scheduleHeal(true);
  }
  // -- self-repaint ---------------------------------------------------------
  /** A status frame did not go out: paint the status again by itself (LED_HEAL_DELAYS). */
  noteLost() {
    this.healLost = true;
    this.scheduleHeal();
  }
  /** What a self-repaint has to do: a lost status frame, or a DIM1-Z paint not confirmed yet. */
  needsHeal() {
    return this.healLost || this.protocol === "dm" && this.dmWant.size > 0 && this.dmConfirmed !== this.dmWrites;
  }
  /** `restart`: from now, even while one is due (a DIM1-Z read-back has just started). */
  scheduleHeal(restart = false) {
    if (restart && this.healTimer) {
      clearTimeout(this.healTimer);
      this.healTimer = void 0;
    }
    if (this.healTimer || !this.host.alive || this.healTries >= LED_HEAL_DELAYS.length) return;
    const delay = LED_HEAL_DELAYS[this.healTries];
    this.healTimer = setTimeout(() => {
      this.healTimer = void 0;
      if (!this.host.alive || !this.needsHeal()) return;
      if (this.statusRun && !this.statusRun.cancelled) {
        this.healLost = false;
        return;
      }
      if (this.host.unreachable?.()) return;
      this.healTries++;
      this.healLost = false;
      this.engine.log.debug(`Control4 LED [${this.host.name}]: a status frame was lost or is unconfirmed; painting the status again (${this.healTries}/${LED_HEAL_DELAYS.length})`);
      void this.applyStatus();
    }, delay + Math.random() * delay * 0.2);
    this.healTimer.unref?.();
  }
  /** The device is going (unregistered): no self-repaint is left behind. */
  cancelHeal() {
    if (this.healTimer) clearTimeout(this.healTimer);
    this.healTimer = void 0;
    this.healLost = false;
    this.healTries = 0;
  }
  // -- status layer ---------------------------------------------------------
  fallback(btn) {
    if (this.protocol === "dm") return "stored";
    if (this.protocol === "dmx" && (this.borrowed.has(btn) || this.dmxMode(btn) === "follow_load")) return "stored";
    return hexRgb(this.host.idleHex(btn));
  }
  /** Status colours of the buttons painted since the start (their idle colour when they have none). */
  statusFrame() {
    const f = /* @__PURE__ */ new Map();
    for (const b of this.buttons) if (this.painted.has(b)) f.set(b, this.status.get(b) ?? this.fallback(b));
    return f;
  }
  async setStatus(options) {
    const brightness = options.brightness ?? 100;
    const targets = this.resolveButtons(options.buttons);
    for (const b of targets) this.painted.add(b);
    this.healTries = 0;
    if (options.clear) {
      for (const b of targets) {
        this.status.delete(b);
        this.pressed.delete(b);
      }
    } else if (options.colour) {
      const rgb2 = scaleRgb(options.colour, brightness);
      const press = options.pressed ? scaleRgb(options.pressed, options.pressedBrightness ?? brightness) : void 0;
      for (const b of targets) {
        this.status.set(b, rgb2);
        if (press) this.pressed.set(b, press);
        else this.pressed.delete(b);
      }
    }
    const effect = options.effect;
    if (effect && effect !== "none" && effect !== "solid") {
      if (!(effect in EFFECTS)) throw new Error(`unknown effect '${effect}'`);
      const step = options.interval ?? (EFFECT_DEFAULT_INTERVAL[effect] ?? 600) * 3;
      const colour = options.colour ?? (targets.length ? this.status.get(targets[0]) : void 0) ?? [255, 255, 255];
      this.statusEffect = {
        effect,
        buttons: targets.length ? targets : [...this.buttons],
        colour,
        colour2: [0, 0, 0],
        interval: Math.max(MIN_BASE_INTERVAL, step),
        count: 0,
        brightness,
        priority: 0,
        restore: false
      };
      for (const b of this.statusEffect.buttons) this.painted.add(b);
    } else if (effect !== void 0) {
      this.statusEffect = void 0;
    }
    await this.applyStatus();
  }
  async applyStatus(force = false) {
    const wait2 = this.protocol === "dm" ? this.host.quietMs?.() ?? 0 : 0;
    if (wait2 > 0) {
      this.deferForce ||= force;
      if (this.deferTimer) clearTimeout(this.deferTimer);
      this.deferTimer = setTimeout(() => {
        const f = this.deferForce;
        this.deferForce = false;
        this.deferTimer = void 0;
        void this.applyStatus(f);
      }, wait2);
      this.deferTimer.unref?.();
      return;
    }
    this.cancelStatus();
    if (this.animating) {
      const rest = /* @__PURE__ */ new Map();
      for (const [b, c] of this.statusFrame()) if (!this.overlayButtons.includes(b)) rest.set(b, c);
      if (rest.size) this.emit(rest, force, this.pressed, true);
      return;
    }
    if (this.statusEffect) {
      const spec = resolveSpec(this.statusEffect);
      spec.interval = Math.max(MIN_BASE_INTERVAL, spec.interval);
      this.emit(this.statusFrame(), force, this.pressed, true);
      const run = { cancelled: false };
      this.statusRun = run;
      void this.loop(spec, run, false, true);
      return;
    }
    this.emit(this.statusFrame(), force, this.pressed, true);
  }
  cancelStatus() {
    if (this.statusRun) this.statusRun.cancelled = true;
    this.statusRun = void 0;
  }
  async refresh() {
    this.lastSent.clear();
    this.healTries = 0;
    await this.applyStatus(true);
  }
  // -- overlays ---------------------------------------------------------------
  async play(input) {
    if (!(input.effect in EFFECTS)) throw new Error(`unknown effect '${input.effect}'`);
    const spec = resolveSpec(input);
    if (!spec.buttons.length) spec.buttons = [...this.buttons];
    if (this.protocol === "dm") spec.interval = Math.max(DM_STEP_PER_LED * Math.max(1, spec.buttons.length), spec.interval);
    if (!spec.buttons.length) return false;
    const wasAnimating = this.animating;
    if (this.overlay) {
      if (spec.priority < this.overlayPriority) {
        this.engine.log.debug(`Control4 LED [${this.host.name}]: ${spec.effect} (priority ${spec.priority}) refused - ${this.overlayPriority} running`);
        return false;
      }
      this.overlay.cancelled = true;
      this.overlay = void 0;
    } else if (this.engine.activeCount() >= MAX_ACTIVE_ANIMATIONS) {
      this.engine.log.warning(
        `Control4 LED [${this.host.name}]: refused ${spec.effect} - ${MAX_ACTIVE_ANIMATIONS} devices already animating (protects the coordinator TX path)`
      );
      return false;
    }
    this.cancelStatus();
    const run = { cancelled: false };
    this.overlay = run;
    this.overlayPriority = spec.priority;
    this.overlayButtons = [...spec.buttons];
    for (const b of spec.buttons) this.painted.add(b);
    if (!wasAnimating) this.host.onNotifying(true);
    void this.loop(spec, run, spec.restore);
    return true;
  }
  async stop(restore = true) {
    const run = this.overlay;
    this.overlay = void 0;
    this.overlayPriority = -1;
    if (run) {
      run.cancelled = true;
      this.host.onNotifying(false);
    }
    if (restore) await this.applyStatus(true);
  }
  async loop(spec, run, restore, mergeStatus = false) {
    const generator = EFFECTS[spec.effect];
    const deadline = spec.duration === void 0 ? void 0 : Date.now() + spec.duration;
    let cycles = 0;
    try {
      outer: for (; ; ) {
        for (const f of generator(spec)) {
          if (run.cancelled || !this.host.alive) break outer;
          let out = f;
          if (mergeStatus) {
            out = this.statusFrame();
            for (const [b, c] of f) out.set(b, c);
          }
          this.emit(out, false, mergeStatus ? this.pressedOutside(f) : void 0);
          await sleep(spec.interval);
          if (run.cancelled) break outer;
          if (deadline !== void 0 && Date.now() >= deadline) break outer;
        }
        cycles++;
        if (spec.count && cycles >= spec.count) break;
      }
    } finally {
      if (this.overlay === run) {
        this.overlay = void 0;
        this.overlayPriority = -1;
        this.host.onNotifying(false);
        if (restore) await this.applyStatus(true);
      }
    }
  }
};
var AnimationEngine = class {
  constructor(tx, log) {
    this.tx = tx;
    this.log = log;
  }
  tx;
  log;
  animators = /* @__PURE__ */ new Map();
  register(host, buttons, protocol) {
    let a = this.animators.get(host.ieee);
    if (!a) {
      a = new Animator(host, buttons, protocol, this);
      this.animators.set(host.ieee, a);
    } else {
      a.host = host;
      a.buttons = [...buttons];
      a.protocol = protocol;
    }
    return a;
  }
  unregister(ieee) {
    const a = this.animators.get(ieee);
    if (a) {
      a.cancelHeal();
      void a.stop(false);
    }
    this.animators.delete(ieee);
  }
  get(ieee) {
    return this.animators.get(ieee.toLowerCase());
  }
  all() {
    return [...this.animators.values()];
  }
  activeCount() {
    let n = 0;
    for (const a of this.animators.values()) if (a.animating) n++;
    return n;
  }
};
function num(v, min, max, fallback) {
  if (v === void 0 || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`'${v}' is not a number`);
  return Math.max(min, Math.min(max, n));
}
async function ledEffect(animator, data) {
  const effect = String(data.effect ?? "blink");
  if (!(effect in EFFECTS)) throw new Error(`unknown effect '${effect}' (one of ${Object.keys(EFFECTS).join(", ")})`);
  let interval = data.interval !== void 0 ? num(data.interval, 0.05, 10, 0.4) * 1e3 : void 0;
  if (interval === void 0 && data.speed !== void 0) interval = num(data.speed, 50, 1e4, 400);
  if (interval === void 0) interval = EFFECT_DEFAULT_INTERVAL[effect] ?? 400;
  let duration = data.duration !== void 0 ? num(data.duration, 0.1, 3600, 1) * 1e3 : void 0;
  let count2 = Math.trunc(num(data.count, 0, 255, 3));
  if (effect === "solid" && count2 === 0 && !duration) {
    interval = 3e4;
  } else if (effect === "solid") {
    duration = duration ?? DEFAULT_SOLID_DURATION;
    interval = duration;
    count2 = 1;
  }
  const colour = parseColour(data.color ?? data.colour, [255, 255, 255]);
  const colour2Raw = data.color2 ?? data.colour2;
  return animator.play({
    effect,
    buttons: animator.resolveButtons(data.buttons),
    colour,
    colour2: colour2Raw === void 0 ? [0, 0, 0] : parseColour(colour2Raw),
    interval,
    count: count2,
    duration,
    brightness: Math.trunc(num(data.brightness, 0, 100, 100)),
    priority: Math.trunc(num(data.priority, 0, 255, 10)),
    restore: data.restore === void 0 ? true : Boolean(data.restore)
  });
}
async function ledStatus(animator, data) {
  let colour;
  const raw = data.color ?? data.colour;
  if (raw !== void 0) colour = parseColour(raw);
  else if (data.state !== void 0) {
    const st = String(data.state);
    if (!(st in STATUS_COLOURS)) throw new Error(`unknown state '${st}' (one of ${Object.keys(STATUS_COLOURS).join(", ")})`);
    colour = parseColour(STATUS_COLOURS[st]);
  }
  const effect = data.effect === void 0 ? void 0 : String(data.effect);
  if (effect !== void 0 && effect !== "none" && !(effect in EFFECTS)) throw new Error(`unknown effect '${effect}'`);
  const pressedRaw = data.pressed_color ?? data.pressed_colour;
  const pressed = pressedRaw === void 0 || pressedRaw === null || pressedRaw === "" ? void 0 : parseColour(pressedRaw);
  const clear = Boolean(data.clear);
  if (colour === void 0 && effect === void 0 && !clear) throw new Error("led_status needs at least one of: state, color, effect, clear");
  await animator.setStatus({
    buttons: data.buttons,
    colour,
    effect,
    interval: data.interval !== void 0 ? num(data.interval, 0.5, 30, 1) * 1e3 : void 0,
    brightness: Math.trunc(num(data.brightness, 0, 100, 100)),
    clear,
    pressed,
    pressedBrightness: data.pressed_brightness === void 0 ? void 0 : Math.trunc(num(data.pressed_brightness, 0, 100, 100))
  });
}

// src/core/handoff.ts
var HANDOFF_TIMING = {
  /** How long the new instance collects offers: past it, the device starts as new. */
  offers: 5e3,
  /** How long it waits for each done before acking again. */
  done: 5e3,
  /** Acks sent in all before it settles without the missing dones. */
  acks: 3
};
var same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
var record = (v) => typeof v === "object" && v && !Array.isArray(v) ? v : {};
var Handoff = class {
  constructor(host, timing = HANDOFF_TIMING) {
    this.host = host;
    this.timing = timing;
  }
  host;
  timing;
  joins = /* @__PURE__ */ new Map();
  /** Devices this instance is letting go of, as an old instance. */
  leaving = /* @__PURE__ */ new Set();
  stopped = false;
  get store() {
    return this.host.store;
  }
  /** At start: every device Zigbee2MQTT has now has been had here; keep its name and options. */
  seed(ieees) {
    for (const ieee of ieees) {
      this.touch(ieee, this.host.lastSeen(ieee) ?? 0);
      this.keepProfile(ieee);
    }
  }
  stop() {
    this.stopped = true;
    for (const join of this.joins.values()) clearTimeout(join.timer);
    this.joins.clear();
  }
  /** A handoff for the device is under way here, as the new instance. */
  pending(ieee) {
    return this.joins.has(ieee.toLowerCase());
  }
  /** The device's name or options changed here: keep a copy, for a handoff after its removal. */
  keepProfile(ieee) {
    const profile = this.host.profile(ieee);
    if (profile) this.store.setProfile(ieee, profile);
  }
  /** The device left, or was removed from, this instance: it was had until now. */
  left(ieee) {
    if (!this.leaving.has(ieee.toLowerCase())) this.touch(ieee, this.host.now());
  }
  /** A successful join interview: ask whoever last had the device for what it knew. */
  joined(raw) {
    const ieee = raw.toLowerCase();
    const old = this.joins.get(ieee);
    if (old) clearTimeout(old.timer);
    const join = {
      id: `${this.host.base()}:${this.host.now()}`,
      prior: this.store.had(ieee),
      before: { model: this.store.model(ieee), settings: this.store.all(ieee) },
      offers: [],
      waiting: /* @__PURE__ */ new Set(),
      evicted: false,
      acks: 0
    };
    this.touch(ieee, this.host.now());
    this.keepProfile(ieee);
    this.joins.set(ieee, join);
    this.host.send(ieee, "request", { from: this.host.base(), id: join.id });
    join.timer = setTimeout(() => this.decide(ieee, join), this.timing.offers);
    join.timer.unref?.();
  }
  onMessage(raw, step, body) {
    const msg = record(body);
    const from = typeof msg.from === "string" ? msg.from : void 0;
    if (this.stopped || !from || from === this.host.base()) return;
    const ieee = raw.toLowerCase();
    const join = this.joins.get(ieee);
    const forThisJoin = join !== void 0 && msg.id === join.id && msg.to === this.host.base();
    switch (step) {
      case "request":
        this.answer(ieee, from, msg.id);
        return;
      case "offer":
        if (forThisJoin && join.timer && !join.offers.some((o) => o.from === from)) join.offers.push(this.offerOf(from, msg));
        return;
      case "ack":
        if (Array.isArray(msg.to) && msg.to.includes(this.host.base())) void this.release(ieee, from, msg.id);
        return;
      case "done":
        if (forThisJoin && join.waiting.delete(from)) {
          if (msg.evicted === true) join.evicted = true;
          if (join.waiting.size === 0) this.end(ieee, join);
        }
        return;
    }
  }
  touch(ieee, at) {
    const had = this.store.had(ieee);
    if (had === void 0 || at > had) this.store.setHad(ieee, at);
  }
  // -- as an old instance ----------------------------------------------------
  answer(ieee, to, id) {
    if (this.leaving.has(ieee)) return;
    const holds = this.host.has(ieee);
    const stored = this.store.had(ieee);
    if (stored === void 0 && !holds) return;
    const had = Math.max(stored ?? 0, holds ? this.host.lastSeen(ieee) ?? 0 : 0);
    const profile = this.host.profile(ieee) ?? this.store.profile(ieee);
    this.host.send(ieee, "offer", { from: this.host.base(), to, id, had, holds, model: this.store.model(ieee), settings: this.store.all(ieee), ...profile ? { profile } : {} });
  }
  /** Acked: drop the saved settings, evict a record still here, and say done. */
  async release(ieee, to, id) {
    if (this.leaving.has(ieee)) return;
    this.leaving.add(ieee);
    let evicted = false;
    try {
      if (this.host.has(ieee)) {
        await this.host.evict(ieee);
        evicted = true;
      }
    } catch (error) {
      this.host.log.warning(`Control4: could not remove ${ieee}, which joined ${to}: ${error.message}`);
    } finally {
      this.store.forget(ieee);
      this.leaving.delete(ieee);
    }
    if (this.stopped) return;
    this.host.log.info(`Control4: ${ieee} joined ${to}; its saved settings here are dropped${evicted ? " and its record removed" : ""}`);
    this.host.send(ieee, "done", { from: this.host.base(), to, id, evicted });
  }
  // -- as the new instance ---------------------------------------------------
  offerOf(from, msg) {
    const profile = record(msg.profile);
    return {
      from,
      had: typeof msg.had === "number" ? msg.had : 0,
      holds: msg.holds === true,
      model: typeof msg.model === "string" ? msg.model : void 0,
      settings: record(msg.settings),
      profile: typeof profile.name === "string" ? { name: profile.name, options: record(profile.options) } : void 0
    };
  }
  /** The offers are in: take the newest (unless this instance's own is newer), then ack them all. */
  decide(ieee, join) {
    join.timer = void 0;
    if (!join.offers.length) {
      this.joins.delete(ieee);
      this.host.log.info(`Control4: no other instance answered for ${ieee}; it starts as a new device`);
      return;
    }
    const newest = join.offers.reduce((x, y) => y.had > x.had ? y : x);
    if (join.prior === void 0 || newest.had > join.prior) {
      join.winner = newest;
      const model = this.merge(ieee, join, newest);
      this.host.adopt(ieee, model, newest.profile?.options);
      this.host.log.info(`Control4: ${ieee} brought its saved settings${newest.profile ? `, name and options` : ""} from ${newest.from}`);
    } else {
      this.host.log.info(`Control4: ${ieee} was here more recently than on ${join.offers.map((o) => o.from).join(", ")}; it keeps the values it has`);
    }
    for (const o of join.offers) join.waiting.add(o.from);
    this.ack(ieee, join);
  }
  /**
   * The offer's saved settings replace what this instance held before the join;
   * a value written here since the join wins. Returns the learned model now kept.
   */
  merge(ieee, join, offer) {
    const now = { model: this.store.model(ieee), settings: this.store.all(ieee) };
    const out = { ...offer.settings };
    for (const key of /* @__PURE__ */ new Set([...Object.keys(now.settings), ...Object.keys(join.before.settings)])) {
      if (same(now.settings[key], join.before.settings[key])) continue;
      if (now.settings[key] === void 0) delete out[key];
      else out[key] = now.settings[key];
    }
    const model = now.model !== join.before.model ? now.model : offer.model ?? now.model;
    this.store.replace(ieee, model, out);
    return model;
  }
  ack(ieee, join) {
    join.acks++;
    this.host.send(ieee, "ack", { from: this.host.base(), to: [...join.waiting], id: join.id });
    join.timer = setTimeout(() => {
      join.timer = void 0;
      if (join.acks < this.timing.acks) this.ack(ieee, join);
      else this.end(ieee, join);
    }, this.timing.done);
    join.timer.unref?.();
  }
  end(ieee, join) {
    clearTimeout(join.timer);
    if (this.joins.get(ieee) !== join) return;
    this.joins.delete(ieee);
    const evicted = join.evicted || join.offers.some((o) => o.holds);
    this.host.settle(ieee, join.winner?.profile?.name, evicted);
  }
};

// src/core/log.ts
var NS = "z2m:control4";
function wrapZ2mLogger(logger) {
  const call = (level, message) => {
    const fn = logger?.[level] ?? logger?.[level === "warning" ? "warn" : level];
    if (typeof fn === "function") fn.call(logger, message, NS);
  };
  return {
    debug: (m) => call("debug", m),
    info: (m) => call("info", m),
    warning: (m) => call("warning", m),
    error: (m) => call("error", m)
  };
}

// src/core/fasttap.ts
var FAST_TAP_RELEASE_TIMEOUT = 2e3;
var FAST = { 1: "fast_single", 2: "fast_double", 3: "fast_triple" };
var FastTaps = class {
  taps = /* @__PURE__ */ new Map();
  /** Keys seen sending a release; devices add the ones kept in their saved settings when they start. */
  releasers = /* @__PURE__ */ new Set();
  get pending() {
    return this.taps.size;
  }
  /**
   * Feed one gesture before it is published. A sequence's fast count comes
   * back one of two ways: `emit` fires it when a tap window ends the
   * sequence, and a release that ends it returns it as `fastCount`, which
   * the caller must publish after the release or it is lost. On a device
   * with no hold (`hasHold` false) a press is known to be a tap at once.
   */
  observe(key, gesture, windowMs, emit, hasHold = true) {
    const state = this.taps.get(key);
    const clear = (s2) => {
      if (s2?.timer) clearTimeout(s2.timer);
    };
    const end = (done) => {
      this.taps.delete(key);
      clear(done);
      return FAST[done.count] ?? "fast_quadruple";
    };
    const windowClosed = () => {
      const current = this.taps.get(key);
      if (!current) return;
      current.timer = void 0;
      if (!current.awaitingRelease) {
        emit(end(current), current.allTapsKnown);
        return;
      }
      current.expired = true;
      current.timer = setTimeout(() => this.taps.delete(key), FAST_TAP_RELEASE_TIMEOUT);
      current.timer.unref?.();
    };
    if (gesture === "hold") {
      clear(state);
      this.taps.delete(key);
      return {};
    }
    if (gesture === "release") {
      this.releasers.add(key);
      if (state) {
        const knownTapIndex = state.awaitingRelease && state.allTapsKnown ? state.count : void 0;
        state.awaitingRelease = false;
        if (state.expired) return { tapIndex: state.count, fastCount: end(state), allTapsKnown: state.allTapsKnown, knownTapIndex };
        return { tapIndex: state.count, knownTapIndex };
      }
      return {};
    }
    if (gesture !== "press") return {};
    clear(state);
    const s = state && !state.expired ? state : { count: 0, windowMs, awaitingRelease: false, expired: false, allTapsKnown: true };
    if (s.awaitingRelease) s.allTapsKnown = false;
    s.count += 1;
    s.awaitingRelease = this.releasers.has(key);
    if (!s.awaitingRelease && hasHold) s.allTapsKnown = false;
    s.timer = setTimeout(windowClosed, s.windowMs);
    s.timer.unref?.();
    this.taps.set(key, s);
    return { tapIndex: s.count, knownTapIndex: hasHold ? void 0 : s.count };
  }
  clear() {
    for (const s of this.taps.values()) if (s.timer) clearTimeout(s.timer);
    this.taps.clear();
  }
};

// src/core/transport.ts
var DeliveryError = class extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
    this.name = "DeliveryError";
  }
  reason;
};
var OUTGOING_DIRECT = 0;
var APS_RETRY = 64;
var APS_ENABLE_ROUTE_DISCOVERY = 256;
var APS_ENABLE_ADDRESS_DISCOVERY = 4096;
var SL_OK = 0;
var SL_BUSY = 4;
var SL_NETWORK_DOWN = 22;
var SL_MAX_MESSAGE_LIMIT = 3075;
var INCOMING_UNICAST = 0;
var INCOMING_UNICAST_REPLY = 1;
var HIGH_RAM_CONCENTRATOR = 65529;
var SEND_ATTEMPTS = 3;
var BUSY_DEFER_MS = 500;
var NETWORK_DOWN_DEFER_MS = 1500;
var SENT_TIMEOUT_MS = 12e3;
var EARLY_MAX_AGE_MS = 1e3;
var EARLY_MAX = 64;
var wait = (ms) => new Promise((r) => setTimeout(r, ms));
var EmberTransport = class {
  constructor(adapter, log) {
    this.adapter = adapter;
    this.log = log;
    this.ezsp = adapter.ezsp;
  }
  adapter;
  log;
  name = "ember";
  ezsp;
  original;
  pending = /* @__PURE__ */ new Map();
  early = /* @__PURE__ */ new Map();
  onSent = (status, _type, dst, aps, tag) => {
    const p = this.pending.get(tag);
    if (p && p.nwk === dst && p.profile === aps?.profileId) {
      this.settle(tag, status);
      return;
    }
    this.early.delete(tag);
    this.early.set(tag, { status, nwk: dst, profile: aps?.profileId, at: Date.now() });
    if (this.early.size > EARLY_MAX) this.early.delete(this.early.keys().next().value);
  };
  static supports(adapter) {
    return typeof adapter?.ezsp?.ezspIncomingMessageHandler === "function" && typeof adapter?.ezsp?.send === "function";
  }
  start(onFrame) {
    if (this.original) return;
    const ezsp = this.ezsp;
    this.original = ezsp.ezspIncomingMessageHandler;
    const original = this.original;
    const log = this.log;
    ezsp.ezspIncomingMessageHandler = function(type, apsFrame, packetInfo, contents) {
      if (C4_PROFILES.has(apsFrame?.profileId)) {
        try {
          const consumed = onFrame({
            nwk: packetInfo.senderShortId,
            profile: apsFrame.profileId,
            cluster: apsFrame.clusterId,
            srcEp: apsFrame.sourceEndpoint,
            dstEp: apsFrame.destinationEndpoint,
            data: Buffer.from(contents),
            lqi: packetInfo.lastHopLqi,
            rssi: packetInfo.lastHopRssi,
            unicast: type === INCOMING_UNICAST || type === INCOMING_UNICAST_REPLY
          });
          if (consumed) return;
        } catch (error) {
          log.warning(`Control4 receive hook failed: ${error.stack ?? error}`);
        }
      }
      return original.call(this, type, apsFrame, packetInfo, contents);
    };
    ezsp.on?.("messageSent", this.onSent);
  }
  stop() {
    if (this.original) {
      this.ezsp.ezspIncomingMessageHandler = this.original;
      this.original = void 0;
    }
    this.ezsp.off?.("messageSent", this.onSent);
    for (const [tag, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new DeliveryError("transport stopped", "stopped"));
      this.pending.delete(tag);
    }
  }
  settle(tag, status) {
    const p = this.pending.get(tag);
    if (!p) return;
    this.pending.delete(tag);
    clearTimeout(p.timer);
    if (status === SL_OK) p.resolve();
    else p.reject(new DeliveryError(`delivery failed (status 0x${status.toString(16)})`, "failed"));
  }
  async send(nwk, frame2, options = {}) {
    const ack = options.ack !== false;
    const apsFrame = {
      profileId: frame2.profile,
      clusterId: frame2.cluster,
      sourceEndpoint: frame2.srcEp,
      destinationEndpoint: frame2.dstEp,
      options: APS_ENABLE_ROUTE_DISCOVERY | APS_ENABLE_ADDRESS_DISCOVERY | (ack ? APS_RETRY : 0),
      groupId: 0,
      sequence: 0
    };
    let sent;
    const run = async () => {
      for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
        let status = -1;
        let tag = -1;
        try {
          [status, tag] = await this.ezsp.send(OUTGOING_DIRECT, nwk, apsFrame, frame2.data, 0, 0);
        } catch (error) {
          this.log.debug(`Control4 send to 0x${nwk.toString(16)} raised ${error}`);
        }
        if (status === SL_OK) {
          if (ack) sent = this.waitSent(tag, nwk, frame2.profile);
          return;
        }
        if (attempt === SEND_ATTEMPTS) break;
        if (status === SL_BUSY || status === SL_MAX_MESSAGE_LIMIT || status === -1) await wait(BUSY_DEFER_MS);
        else if (status === SL_NETWORK_DOWN) await wait(NETWORK_DOWN_DEFER_MS);
        else break;
      }
      throw new DeliveryError(`could not queue frame to 0x${nwk.toString(16)}`, "unqueued");
    };
    const queue = this.adapter.queue;
    if (queue && typeof queue.execute === "function") await queue.execute(run, nwk);
    else await run();
    if (sent) await sent;
  }
  waitSent(tag, nwk, profile) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tag);
        reject(new DeliveryError("no delivery confirmation", "unconfirmed"));
      }, SENT_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(tag, { nwk, profile, resolve, reject, timer });
      const early = this.early.get(tag);
      if (early !== void 0) {
        this.early.delete(tag);
        if (early.nwk === nwk && early.profile === profile && Date.now() - early.at <= EARLY_MAX_AGE_MS) this.settle(tag, early.status);
      }
    });
  }
  async mtorr(radius) {
    if (typeof this.ezsp.ezspSendManyToOneRouteRequest !== "function") return false;
    try {
      const status = await this.ezsp.ezspSendManyToOneRouteRequest(HIGH_RAM_CONCENTRATOR, radius);
      return status === SL_OK;
    } catch (error) {
      this.log.warning(`Control4 route refresh failed: ${error}`);
      return false;
    }
  }
};

// src/core/link.ts
var SEND_GAP_DEVICE = 40;
var SEND_GAP_GLOBAL = 20;
var TX_WINDOW = 4;
var TX_SLOT_HOLD_MAX = 3e3;
var BACKLOG_WARN = 1e4;
var GET_TIMEOUT = 6e3;
var KEEPALIVE_QUIET = 20 * 6e4;
var KEEPALIVE_REPOKE = 10 * 6e4;
var KEEPALIVE_TICK = 6e4;
var KEEPALIVE_MAX_PER_TICK = 4;
var KEEPALIVE_POKE_GAP = 3e3;
var KEEPALIVE_FIRST_DELAY = 12e4;
var KEEPALIVE_WARN_AFTER = 3;
var REBOOT_ADVICE = "commands to it are lost. It may still have power, work from its own paddles and check in every hour, but a paddle press does not bring it back: reboot it (on a DIM1-Z, tap the top paddle 15 times) or cut its power.";
var AUTO_REBOOT_GAP = 60 * 6e4;
var AUTO_REBOOT_MAX = 3;
var AUTO_REBOOT_WINDOW = 24 * 60 * 6e4;
var AUTO_REBOOT_INSTANCE_GAP = 6e4;
var AUTO_REBOOT_MAX_UNREACHABLE = 3;
var AUTO_REBOOT_ADVICE = `commands to it are lost. It may still have power, work from its own paddles and check in every hour, but a paddle press does not bring it back. The extension reboots it remotely (up to ${AUTO_REBOOT_MAX} times a day, an hour or more apart); if it stays unreachable, press its Reboot button or reboot it by hand (tap the top paddle 15 times), or cut its power.`;
var RETRY_DELAY = 2e3;
var MTORR_MIN_GAP = 6e4;
var MTORR_RADIUS = 5;
var STATE_READ_DELAY = 5e3;
var STATE_READ_GAP = 250;
var STATE_READ_RETRIES = [3e4, 12e4];
var GET_CAPABLE_MODELS = /* @__PURE__ */ new Set(["C4-DIM1-Z", "C4-APD120", "C4-SW120277", "C4-KC120277"]);
var PING_PROPERTY = "c4.sy.fwv";
var sleep2 = (ms) => new Promise((r) => {
  const t = setTimeout(r, ms);
  t.unref?.();
});
function isDeliveryFailure(error) {
  return error instanceof DeliveryError || error?.name === "DeliveryError" || error?.name === "TimeoutError";
}
var Link = class {
  constructor(host) {
    this.host = host;
    this.startedAt = host.now();
  }
  host;
  nextDev = /* @__PURE__ */ new Map();
  nextGlobal = 0;
  backlogWarned = false;
  lastUnicast = /* @__PURE__ */ new Map();
  lastPoke = /* @__PURE__ */ new Map();
  pokeFailures = /* @__PURE__ */ new Map();
  /** When each device's automatic reboots went out, within AUTO_REBOOT_WINDOW. */
  autoReboots = /* @__PURE__ */ new Map();
  /** When each device was last rebooted, automatically or by its Reboot button. */
  lastReboot = /* @__PURE__ */ new Map();
  lastAutoReboot = Number.NEGATIVE_INFINITY;
  answered = /* @__PURE__ */ new Set();
  pending = /* @__PURE__ */ new Map();
  lastMtorr = Number.NEGATIVE_INFINITY;
  startedAt;
  keepaliveTimer;
  verifyTokens = /* @__PURE__ */ new Map();
  stopped = false;
  tx = /* @__PURE__ */ new Map();
  mtorrs = 0;
  stateReads = /* @__PURE__ */ new Map();
  readsRunning = false;
  /** Ends the queue's wait for its next read early (something sooner was queued). */
  wakeReads;
  /** Devices with a frame in the send window. */
  inFlight = /* @__PURE__ */ new Set();
  waiting = [];
  /** Devices with a load command under way (sendWithRecovery): their frames skip the window. */
  loadCommands = /* @__PURE__ */ new Map();
  stop() {
    this.stopped = true;
    for (const w of this.waiting.splice(0)) w.fail(new Error("Control4: link stopped"));
    this.stateReads.clear();
    this.wakeReads?.();
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = void 0;
  }
  // -- pacing ---------------------------------------------------------------
  /** `waited`: how long the frame already waited for the send window. */
  async waitTurn(ieee, waited = 0) {
    const now = this.host.now();
    const slot = Math.max(now, this.nextDev.get(ieee) ?? 0, this.nextGlobal);
    this.nextDev.set(ieee, slot + SEND_GAP_DEVICE);
    this.nextGlobal = slot + SEND_GAP_GLOBAL;
    const delay = slot - now;
    this.noteBacklog(waited + delay);
    if (delay > 0) await sleep2(delay);
  }
  noteBacklog(delay) {
    if (delay >= BACKLOG_WARN && !this.backlogWarned) {
      this.backlogWarned = true;
      this.host.log.warning(`Control4: transmit backlog is ${Math.round(delay / 1e3)}s deep - something is sending faster than the mesh can carry`);
    } else if (delay < 1e3) {
      this.backlogWarned = false;
    }
  }
  /**
   * One frame to a device through the send window, then its waitTurn slot.
   * The slot is held until `send` settles (delivered or failed), or for
   * TX_SLOT_HOLD_MAX at most. `urgent` (the controller identity), like a frame
   * of a load command under way, waits only for its own device's frame.
   */
  async transmit(ieee, send, urgent = false) {
    if (this.stopped) throw new Error("Control4: link stopped");
    const queuedAt = this.host.now();
    await new Promise((go, fail) => {
      this.waiting.push({ ieee, urgent, go, fail });
      this.pump();
    });
    let hold;
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      clearTimeout(hold);
      this.inFlight.delete(ieee);
      this.pump();
    };
    try {
      await this.waitTurn(ieee, this.host.now() - queuedAt);
      hold = setTimeout(release, TX_SLOT_HOLD_MAX);
      hold.unref?.();
      return await send();
    } finally {
      release();
    }
  }
  /** Starts every waiting frame that may go: FIFO, one per device, TX_WINDOW unless urgent. */
  pump() {
    for (let i = 0; i < this.waiting.length; ) {
      const w = this.waiting[i];
      const mayGo = !this.inFlight.has(w.ieee) && (w.urgent || this.loadCommands.has(w.ieee) || this.inFlight.size < TX_WINDOW);
      if (!mayGo) {
        i++;
        continue;
      }
      this.waiting.splice(i, 1);
      this.inFlight.add(w.ieee);
      w.go();
    }
  }
  // -- health ------------------------------------------------------------------
  /** Every transmit to a device, delivered or not (for the stats request). */
  noteTx(ieee, ok) {
    const t = this.tx.get(ieee) ?? { sent: 0, failed: 0 };
    t.sent++;
    if (!ok) {
      t.failed++;
      t.lastFailure = this.host.now();
    }
    this.tx.set(ieee, t);
  }
  /** What the stats request reports about one device's link. */
  health(ieee) {
    const now = this.host.now();
    const t = this.tx.get(ieee);
    const rx = this.lastUnicast.get(ieee);
    const secs = (ts) => ts === void 0 ? void 0 : Math.round((now - ts) / 1e3);
    return {
      sent: t?.sent ?? 0,
      failed: t?.failed ?? 0,
      last_failure_s: secs(t?.lastFailure),
      last_rx_s: secs(rx),
      keepalive_failures: this.pokeFailures.get(ieee) ?? 0
    };
  }
  /** Every transmit since start, summed over the devices (for the instance status). */
  totals() {
    let sent = 0;
    let failed = 0;
    for (const t of this.tx.values()) {
      sent += t.sent;
      failed += t.failed;
    }
    return { sent, failed };
  }
  /** Link-wide counters for the stats request. */
  summary() {
    const now = this.host.now();
    return {
      route_refreshes: this.mtorrs,
      last_route_refresh_s: Number.isFinite(this.lastMtorr) ? Math.round((now - this.lastMtorr) / 1e3) : void 0,
      state_reads_queued: this.stateReads.size,
      tx_in_flight: this.inFlight.size,
      tx_waiting: this.waiting.length
    };
  }
  // -- receive bookkeeping ---------------------------------------------------
  noteRx(ieee, unicast) {
    if (!unicast) return;
    const now = this.host.now();
    const silentSince = this.lastUnicast.get(ieee) ?? this.startedAt;
    this.lastUnicast.set(ieee, now);
    const fails = this.pokeFailures.get(ieee) ?? 0;
    this.pokeFailures.delete(ieee);
    if (fails < KEEPALIVE_WARN_AFTER) return;
    const rebootedAt = this.lastReboot.get(ieee);
    const after = rebootedAt !== void 0 && rebootedAt >= silentSince ? ` (${Math.round((now - rebootedAt) / 6e4)} min after a remote reboot)` : "";
    this.host.log.warning(`Control4: ${ieee} is reachable again${after}`);
    this.host.reachabilityChanged?.();
  }
  /** The device was just rebooted (its Reboot button, or autoReboot): the time its re-join count and reboot_min start from. */
  noteRebooted(ieee, at = this.host.now()) {
    this.lastReboot.set(ieee, at);
  }
  /** When the device was last rebooted, automatically or by its Reboot button. */
  lastRebootAt(ieee) {
    return this.lastReboot.get(ieee);
  }
  /**
   * List a device as unreachable now, without waiting for KEEPALIVE_WARN_AFTER missed
   * keepalives (it re-joined and answers nothing). Its next direct frame clears it, as for those.
   */
  markUnreachable(dev, why) {
    if ((this.pokeFailures.get(dev.ieee) ?? 0) >= KEEPALIVE_WARN_AFTER) return;
    this.pokeFailures.set(dev.ieee, KEEPALIVE_WARN_AFTER);
    this.host.log.warning(`Control4: ${dev.ieee} (${dev.model}) ${why} - ${this.adviceFor(dev)}`);
    this.autoReboot(dev, "it is unreachable");
    this.host.reachabilityChanged?.();
  }
  canAutoReboot(dev) {
    return dev.reboot !== void 0 && dev.autoReboot?.() !== false;
  }
  adviceFor(dev) {
    return this.canAutoReboot(dev) ? AUTO_REBOOT_ADVICE : REBOOT_ADVICE;
  }
  /**
   * Reboot a device that can be rebooted remotely (a DIM1-Z). True when one went out.
   * Not when its auto_reboot option is off, it had one less than AUTO_REBOOT_GAP ago or
   * AUTO_REBOOT_MAX within AUTO_REBOOT_WINDOW, the host holds reboots (a traffic alarm),
   * more than AUTO_REBOOT_MAX_UNREACHABLE devices are unreachable at once, or another
   * device got one less than AUTO_REBOOT_INSTANCE_GAP ago. Unreachable devices ask when
   * they are listed and at each later missed keepalive; the runtime asks for a device
   * that keeps re-joining.
   */
  autoReboot(dev, why, now = this.host.now()) {
    if (!this.canAutoReboot(dev)) return false;
    const recent = (this.autoReboots.get(dev.ieee) ?? []).filter((t) => now - t < AUTO_REBOOT_WINDOW);
    this.autoReboots.set(dev.ieee, recent);
    const last = recent.at(-1);
    if (recent.length >= AUTO_REBOOT_MAX || last !== void 0 && now - last < AUTO_REBOOT_GAP) return false;
    const unreachable = this.unreachable(now).length;
    const held = this.host.rebootsHeld?.() ?? (unreachable > AUTO_REBOOT_MAX_UNREACHABLE ? `${unreachable} devices are unreachable at once` : void 0);
    if (held) {
      this.host.log.info(`Control4: not rebooting ${dev.ieee} (${dev.model}) remotely: ${held}`);
      return false;
    }
    if (now - this.lastAutoReboot < AUTO_REBOOT_INSTANCE_GAP) {
      this.host.log.debug(`Control4: not rebooting ${dev.ieee} yet: another device was rebooted less than a minute ago`);
      return false;
    }
    recent.push(now);
    this.lastAutoReboot = now;
    const before = this.lastReboot.get(dev.ieee);
    this.noteRebooted(dev.ieee, now);
    this.host.log.warning(`Control4: ${dev.ieee} (${dev.model}): ${why} - rebooting it remotely (${recent.length} of ${AUTO_REBOOT_MAX} in 24 h)`);
    void dev.reboot?.().catch((error) => {
      const times = this.autoReboots.get(dev.ieee) ?? [];
      const i = times.indexOf(now);
      if (i >= 0) times.splice(i, 1);
      if (this.lastReboot.get(dev.ieee) === now) {
        if (before === void 0) this.lastReboot.delete(dev.ieee);
        else this.lastReboot.set(dev.ieee, before);
      }
      this.host.log.info(`Control4: the remote reboot of ${dev.ieee} was not sent: ${error}`);
    });
    return true;
  }
  /** The device has not answered KEEPALIVE_WARN_AFTER keepalives in a row (or was marked so), and has sent nothing direct since. */
  isUnreachable(ieee) {
    return (this.pokeFailures.get(ieee) ?? 0) >= KEEPALIVE_WARN_AFTER;
  }
  /** The devices that have not answered KEEPALIVE_WARN_AFTER keepalives in a row, quietest first. */
  unreachable(now = this.host.now()) {
    return this.host.devices().filter((d) => (this.pokeFailures.get(d.ieee) ?? 0) >= KEEPALIVE_WARN_AFTER).map((d) => {
      const out = { ieee: d.ieee, model: d.model, quietMin: Math.round(this.quietFor(d.ieee, now) / 6e4) };
      const rebootedAt = this.lastReboot.get(d.ieee);
      if (rebootedAt !== void 0 && rebootedAt >= (this.lastUnicast.get(d.ieee) ?? this.startedAt)) out.rebootMin = Math.round((now - rebootedAt) / 6e4);
      return out;
    }).sort((a, b) => b.quietMin - a.quietMin);
  }
  resolveReply(ieee, frame2) {
    if (frame2.kind !== "reply" || frame2.tokens.length < 2 || frame2.seq.length < 4) return;
    this.answered.add(ieee);
    const key = `${ieee}:${frame2.seq}`;
    const resolve = this.pending.get(key);
    if (!resolve) return;
    this.pending.delete(key);
    resolve({ status: frame2.tokens[1], prop: frame2.tokens[2], values: frame2.tokens.slice(3) });
  }
  canAnswerGet(dev) {
    return this.answered.has(dev.ieee) || GET_CAPABLE_MODELS.has(dev.model);
  }
  // -- Get round trip -------------------------------------------------------
  /**
   * A Get round trip. The timeout runs from when the Get has gone out (paced
   * and acknowledged), not from when it was queued: on a busy mesh a queued
   * Get must not count as an unanswered one.
   */
  async get(dev, prop, timeout = GET_TIMEOUT) {
    const seq = hex4(dev.nextSeq());
    const key = `${dev.ieee}:${seq}`;
    let timer;
    let finish = () => void 0;
    const reply = new Promise((resolve) => {
      finish = resolve;
    });
    this.pending.set(key, (r) => {
      if (timer) clearTimeout(timer);
      finish(r);
    });
    try {
      await dev.sendText(`0g${seq} ${prop}`);
    } catch (error) {
      this.host.log.debug(`Control4: get ${prop} on ${dev.ieee} failed: ${error}`);
      this.pending.delete(key);
      return void 0;
    }
    if (this.pending.has(key)) {
      timer = setTimeout(() => {
        this.pending.delete(key);
        finish(void 0);
      }, timeout);
      timer.unref?.();
    }
    return reply;
  }
  /**
   * What Z2M's availability ping does. Models that answer a Get must answer
   * one; the others never answer, but their radio acknowledges the frame, so
   * a delivered Get proves them reachable and a failed delivery does not.
   * Sleepy devices (the remotes) are not pinged: undefined.
   */
  async honestPing(dev) {
    if (!dev.isRouter) return void 0;
    if (this.canAnswerGet(dev)) {
      const reply = await this.get(dev, PING_PROPERTY);
      this.host.log.debug(`Control4: availability ping ${dev.ieee} -> ${reply ? "answered" : "no answer"}`);
      return reply !== void 0;
    }
    try {
      await dev.sendText(`0g${hex4(dev.nextSeq())} ${PING_PROPERTY}`);
      this.host.log.debug(`Control4: availability ping ${dev.ieee} -> delivered`);
      return true;
    } catch (error) {
      this.host.log.debug(`Control4: availability ping ${dev.ieee} -> ${error}`);
      return isDeliveryFailure(error) ? false : void 0;
    }
  }
  // -- route refresh ----------------------------------------------------------
  requestRouteRefresh(reason) {
    const now = this.host.now();
    if (now - this.lastMtorr < MTORR_MIN_GAP) return;
    this.lastMtorr = now;
    this.mtorrs++;
    this.host.log.info(`Control4: route refresh (${reason})`);
    this.host.mtorr(MTORR_RADIUS).catch(() => void 0);
  }
  // -- keepalive ----------------------------------------------------------------
  quietFor(ieee, now) {
    return now - (this.lastUnicast.get(ieee) ?? this.startedAt);
  }
  keepaliveCandidates(now = this.host.now()) {
    const found = [];
    for (const dev of this.host.devices()) {
      if (!dev.isRouter || !this.canAnswerGet(dev)) continue;
      const quiet = this.quietFor(dev.ieee, now);
      if (quiet < KEEPALIVE_QUIET) continue;
      if (now - (this.lastPoke.get(dev.ieee) ?? Number.NEGATIVE_INFINITY) < KEEPALIVE_REPOKE) continue;
      found.push([quiet, dev]);
    }
    found.sort((a, b) => b[0] - a[0]);
    return found.map(([, d]) => d);
  }
  async poke(dev) {
    this.lastPoke.set(dev.ieee, this.host.now());
    if (await this.get(dev, PING_PROPERTY) !== void 0) return true;
    const fails = (this.pokeFailures.get(dev.ieee) ?? 0) + 1;
    this.pokeFailures.set(dev.ieee, fails);
    this.requestRouteRefresh(`keepalive got no answer from ${dev.ieee}`);
    const quietMin = Math.round(this.quietFor(dev.ieee, this.host.now()) / 6e4);
    if (fails === KEEPALIVE_WARN_AFTER) {
      this.host.log.warning(
        `Control4: ${dev.ieee} (${dev.model}) has not answered ${fails} keepalives and has sent nothing direct for ${quietMin} min - ${this.adviceFor(dev)}`
      );
      this.autoReboot(dev, "it is unreachable");
      this.host.reachabilityChanged?.();
    } else {
      this.host.log.info(`Control4: keepalive ${dev.ieee} got no answer (${fails} in a row, quiet ${quietMin} min)`);
      if (fails > KEEPALIVE_WARN_AFTER) this.autoReboot(dev, `it is still unreachable after ${fails} keepalives`);
    }
    return false;
  }
  startKeepalive() {
    if (this.keepaliveTimer || this.stopped) return;
    const tick = async () => {
      try {
        const todo = this.keepaliveCandidates();
        for (const dev of todo.slice(0, KEEPALIVE_MAX_PER_TICK)) {
          if (this.stopped) return;
          await this.poke(dev);
          await sleep2(KEEPALIVE_POKE_GAP);
        }
      } catch (error) {
        this.host.log.debug(`Control4: keepalive pass failed: ${error}`);
      }
      schedule(KEEPALIVE_TICK + (Math.random() * 2e4 - 1e4));
    };
    const schedule = (ms) => {
      if (this.stopped) return;
      this.keepaliveTimer = setTimeout(() => void tick(), ms);
      this.keepaliveTimer.unref?.();
    };
    schedule(KEEPALIVE_FIRST_DELAY + Math.random() * 3e4);
  }
  // -- state reads --------------------------------------------------------------
  /**
   * A one-off state read (startup, join, announce). They run one device at a
   * time, the first `delay` after it was queued and STATE_READ_GAP after the
   * previous one, so a floor of dimmers coming up together is read in a
   * trickle, not a burst. A device already queued keeps its place; `run`
   * replaces the queued one. A read that got no answer is queued again
   * (STATE_READ_RETRIES); a skipped one needs no gap. `ieee` may carry a
   * suffix (`<ieee>:settings`) for a second read of the device with its own
   * place, retries and cancel.
   */
  queueStateRead(ieee, run, delay = STATE_READ_DELAY) {
    if (this.stopped) return;
    const queued = this.stateReads.get(ieee);
    if (queued) queued.run = run;
    else this.stateReads.set(ieee, { at: this.host.now() + delay, run, tries: 0 });
    this.wakeReads?.();
    void this.drainStateReads();
  }
  cancelStateRead(ieee) {
    this.stateReads.delete(ieee);
  }
  async drainStateReads() {
    if (this.readsRunning) return;
    this.readsRunning = true;
    try {
      for (; ; ) {
        if (this.stopped) return;
        let next;
        for (const entry of this.stateReads) if (!next || entry[1].at < next[1].at) next = entry;
        if (!next) return;
        const [ieee, job] = next;
        const wait2 = job.at - this.host.now();
        if (wait2 > 0) {
          await new Promise((resolve) => {
            const done = () => {
              clearTimeout(timer);
              this.wakeReads = void 0;
              resolve();
            };
            const timer = setTimeout(done, wait2);
            timer.unref?.();
            this.wakeReads = done;
          });
          continue;
        }
        this.stateReads.delete(ieee);
        let result = "failed";
        try {
          result = await job.run();
        } catch (error) {
          this.host.log.debug(`Control4: state read of ${ieee} failed: ${error}`);
        }
        if (result === "failed" && job.tries < STATE_READ_RETRIES.length && !this.stateReads.has(ieee) && !this.stopped) {
          this.stateReads.set(ieee, { at: this.host.now() + STATE_READ_RETRIES[job.tries], run: job.run, tries: job.tries + 1 });
        }
        if (result !== "skipped") await sleep2(STATE_READ_GAP);
      }
    } finally {
      this.readsRunning = false;
    }
  }
  // -- recovery -----------------------------------------------------------------
  async sendWithRecovery(ieee, send, label) {
    this.loadCommands.set(ieee, (this.loadCommands.get(ieee) ?? 0) + 1);
    try {
      return await send();
    } catch (error) {
      if (!isDeliveryFailure(error)) throw error;
      this.host.log.info(`Control4: ${label} to ${ieee} failed (${error.message}) - refreshing routes, retrying in ${RETRY_DELAY / 1e3}s`);
      this.requestRouteRefresh(`${label} to ${ieee} failed`);
      await sleep2(RETRY_DELAY);
      const result = await send();
      this.host.log.info(`Control4: ${label} to ${ieee} succeeded on retry`);
      return result;
    } finally {
      const n = (this.loadCommands.get(ieee) ?? 1) - 1;
      if (n > 0) this.loadCommands.set(ieee, n);
      else this.loadCommands.delete(ieee);
    }
  }
  /**
   * Read `readProp` back after a write; re-send once on a mismatch. A newer
   * verify for the same (device, label) replaces an older one. A missing
   * reply ends the pass quietly - it must never become a poll loop.
   */
  scheduleVerify(dev, label, readProp, matches, resend, settleMs = 500, onMismatch) {
    const key = `${dev.ieee}:${label}`;
    const token = (this.verifyTokens.get(key) ?? 0) + 1;
    this.verifyTokens.set(key, token);
    const current = () => this.verifyTokens.get(key) === token && !this.stopped;
    const run = async () => {
      await sleep2(settleMs);
      let values = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!current()) return;
        const reply = await this.get(dev, readProp);
        if (!reply || reply.status !== "000") {
          this.host.log.debug(`Control4 verify ${label} on ${dev.ieee}: no usable reply`);
          return;
        }
        values = reply.values;
        let good;
        try {
          good = matches(values);
        } catch {
          this.host.log.debug(`Control4 verify ${label}: could not parse ${values.join(" ")}`);
          return;
        }
        if (good) return;
        if (attempt === 0) {
          if (!current()) return;
          this.host.log.info(`Control4 verify ${label} on ${dev.ieee}: device reports ${values.join(" ")} - write was lost, re-sending`);
          await resend();
          await sleep2(Math.max(settleMs, 1e3));
        }
      }
      if (!current()) return;
      this.host.log.warning(`Control4 verify ${label} on ${dev.ieee}: still ${values.join(" ")} after a re-send`);
      try {
        onMismatch?.(values);
      } catch {
      }
    };
    return run().catch((error) => this.host.log.debug(`Control4 verify ${label} failed: ${error}`));
  }
};

// src/core/traffic.ts
var SILENT_AFTER = 30 * 6e4;
var UNCONFIRMED_LIMIT = 5;
var CHECK_EVERY = 6e4;
var TrafficWatch = class {
  constructor(host) {
    this.host = host;
    this.startedAt = host.now();
  }
  host;
  startedAt;
  lastFrame;
  unconfirmed = 0;
  raised = /* @__PURE__ */ new Set();
  timer;
  start() {
    this.startedAt = this.host.now();
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), CHECK_EVERY);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = void 0;
  }
  armed() {
    return this.host.armed();
  }
  problems() {
    return ["no_frames", "sends_failing"].filter((p) => this.raised.has(p));
  }
  /** Seconds since the last Control4 frame; null before the first. */
  lastFrameSeconds() {
    return this.lastFrame === void 0 ? null : Math.round((this.host.now() - this.lastFrame) / 1e3);
  }
  /** A Control4 frame came through the receive hook. */
  frame() {
    this.lastFrame = this.host.now();
    if (this.lower("no_frames")) this.host.log.info("Control4: Control4 frames are coming through again");
  }
  /** A send ended: `messageSent` says whether herdsman confirmed it (undefined: the outcome doesn't tell). */
  sent(messageSent) {
    if (messageSent === void 0) return;
    if (messageSent) {
      this.unconfirmed = 0;
      if (this.lower("sends_failing")) this.host.log.info("Control4: sends are confirmed again");
      return;
    }
    this.unconfirmed++;
    if (this.unconfirmed >= UNCONFIRMED_LIMIT && this.raise("sends_failing")) {
      this.host.log.error(
        `Control4: the last ${UNCONFIRMED_LIMIT} sends got no delivery confirmation (no messageSent from herdsman): commands to Control4 devices are not getting through, or not being confirmed. A herdsman, coordinator firmware or adapter change?`
      );
    }
  }
  check() {
    if (!this.host.armed()) {
      this.lower("no_frames");
      return;
    }
    const quiet = this.host.now() - (this.lastFrame ?? this.startedAt);
    if (quiet >= SILENT_AFTER && this.raise("no_frames")) {
      this.host.log.error(
        `Control4: no Control4 frame has come through Zigbee2MQTT for ${Math.round(quiet / 6e4)} min, though this instance has devices that answer keepalives: Control4 buttons here go unheard. Zigbee2MQTT has stopped handing Control4 frames to the extension - a herdsman, coordinator firmware or adapter change?`
      );
    }
  }
  raise(p) {
    if (this.raised.has(p)) return false;
    this.raised.add(p);
    this.host.changed();
    return true;
  }
  lower(p) {
    if (!this.raised.delete(p)) return false;
    this.host.changed();
    return true;
  }
};

// src/devices/base.ts
var UnsupportedKey = class extends Error {
};
var REPLY_CAPTURE_MS = 2e4;
var DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
var RELEASING_BUTTONS_KEY = "releasing_buttons";
var C4Device = class {
  constructor(ctx, ieee, model, family) {
    this.ctx = ctx;
    this.ieee = ieee;
    this.model = model;
    this.family = family;
    for (const button of this.releasingButtons()) ctx.fast.releasers.add(this.tapKey(button));
  }
  ctx;
  ieee;
  model;
  family;
  seq = 64;
  tsn = 0;
  timers = /* @__PURE__ */ new Set();
  sleepers = /* @__PURE__ */ new Set();
  stopped = false;
  captureUntil = 0;
  /** False for a device whose buttons never report a hold: its press is known to be a tap at once. */
  hasHold = true;
  get log() {
    return this.ctx.log;
  }
  get name() {
    return this.ctx.friendlyName(this.ieee);
  }
  get isRouter() {
    return this.ctx.isRouter(this.ieee);
  }
  /** Shared 16-bit C4 transport sequence (seeded 0x0040 like the Director). */
  nextSeq() {
    const s = this.seq;
    this.seq = s + 1 & 65535;
    return s;
  }
  nextTsn() {
    this.tsn = this.tsn + 1 & 255;
    return this.tsn;
  }
  // -- transmit ---------------------------------------------------------------
  async sendFrame(frame2, options) {
    if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
    await this.ctx.link.transmit(this.ieee, async () => {
      if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
      await this.ctx.send(this.ieee, frame2, options);
    });
  }
  sendText(text, dstEp = 1, srcEp = 1, options) {
    this.log.debug(`Control4 ${this.name} -> ${text}`);
    return this.sendFrame({ profile: PROFILE_BUTTON, cluster: C4_CLUSTER, srcEp, dstEp, data: buildFrame(text) }, options);
  }
  /** `0s<seq> <cmd>`. Throws on a delivery failure. */
  set(cmd, dstEp = 1) {
    return this.sendText(`0s${hex4(this.nextSeq())} ${cmd}`, dstEp);
  }
  /** `0s<seq> <cmd>`, failures logged at debug and swallowed (LED / provisioning frames). */
  async trySet(cmd, dstEp = 1) {
    try {
      await this.set(cmd, dstEp);
      return true;
    } catch (error) {
      this.log.debug(`Control4 ${this.name}: '${cmd}' failed: ${error}`);
      return false;
    }
  }
  get(prop, timeout) {
    return this.ctx.link.get(this, prop, timeout);
  }
  /** A ZCL attribute read on a standard cluster, paced like every other send. Throws on no answer. */
  async zclRead(ep, cluster, attrs) {
    if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
    return this.ctx.link.transmit(this.ieee, async () => {
      if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
      this.log.debug(`Control4 ${this.name} -> ZCL read ${cluster} ${attrs.join(", ")}`);
      return this.ctx.zclRead(this.ieee, ep, cluster, attrs);
    });
  }
  // -- state ------------------------------------------------------------------
  publish(payload) {
    if (this.stopped || Object.keys(payload).length === 0) return;
    this.ctx.publish(this.ieee, payload);
  }
  state() {
    return this.ctx.state(this.ieee);
  }
  /** Whether the state published last says the load is on. */
  isOn() {
    return String(this.state().state ?? "OFF").toUpperCase() === "ON";
  }
  setting(key, fallback) {
    const v = this.ctx.store.get(this.ieee, key);
    return v === void 0 || v === null ? fallback : v;
  }
  saveSetting(key, value) {
    this.ctx.store.set(this.ieee, key, value);
  }
  option(key) {
    return this.ctx.deviceOption(this.ieee, key);
  }
  /**
   * This device's tap window (ms): its `tap_window` option (seconds, a number
   * or decimal text) clamped to the allowed range, else the default.
   */
  tapWindow() {
    const raw = this.option(TAP_WINDOW_OPTION);
    const seconds = typeof raw === "number" ? raw : typeof raw === "string" && DECIMAL.test(raw) ? Number(raw) : Number.NaN;
    if (Number.isNaN(seconds)) return DEFAULT_TAP_WINDOW_MS;
    return Math.min(MAX_TAP_WINDOW_MS, Math.max(MIN_TAP_WINDOW_MS, seconds * 1e3));
  }
  // -- timers -----------------------------------------------------------------
  after(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.stopped) return;
      this.spawn(fn());
    }, ms);
    t.unref?.();
    this.timers.add(t);
    return t;
  }
  cancel(t) {
    if (!t) return;
    clearTimeout(t);
    this.timers.delete(t);
  }
  /** A sleep that ends early (resolves) when the handler stops, so nothing awaits forever. */
  sleep(ms) {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(t);
        this.timers.delete(t);
        this.sleepers.delete(wake);
        resolve();
      };
      const t = setTimeout(wake, ms);
      t.unref?.();
      this.timers.add(t);
      this.sleepers.add(wake);
    });
  }
  spawn(value) {
    if (value && typeof value.catch === "function") {
      value.catch((error) => this.log.debug(`Control4 ${this.name}: background task failed: ${error?.stack ?? error}`));
    }
  }
  // -- lifecycle --------------------------------------------------------------
  /**
   * Called once the handler exists (startup, join, or model learned). On a
   * hot-load (`hotLoad`) Zigbee2MQTT kept running, so the device already had its
   * once-per-process start-up work: skip it.
   */
  start(_hotLoad = false) {
  }
  /** LED colour keys, for devices that have them (keypads, dimmers, LED bars). */
  get ledKeys() {
    return void 0;
  }
  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const wake of [...this.sleepers]) wake();
    this.sleepers.clear();
  }
  /** Re-adopt a handler after a model change keeps the same family. */
  get alive() {
    return !this.stopped;
  }
  // -- actions ----------------------------------------------------------------
  /**
   * Publish a button gesture as a Z2M action (`button_1_double`) with the
   * ZHA command name alongside. The fast-tap counter sees the gesture
   * first, so its tap index is known before the gesture is published; a
   * fast count the gesture closes is published after it.
   */
  emitAction(button, gesture, extra = {}, fastTaps = true) {
    const emitFast = (fast, allTapsKnown) => this.emitAction(button, fast, { ...extra, action_known_taps: allTapsKnown }, false);
    if (fastTaps && gesture === "release") this.rememberRelease(button);
    const tap = fastTaps ? this.ctx.fast.observe(this.tapKey(button), gesture, this.tapWindow(), emitFast, this.hasHold) : {};
    const payload = {
      action: `${button}_${gesture}`,
      action_button: button,
      action_gesture: gesture,
      action_command: GESTURES[gesture],
      ...extra
    };
    this.publish(payload);
    this.sendEvent(payload);
    if (tap.knownTapIndex !== void 0) this.emitAction(button, "tap_known", { ...extra, action_tap_index: tap.knownTapIndex }, false);
    if (tap.fastCount) emitFast(tap.fastCount, tap.allTapsKnown === true);
  }
  tapKey(button) {
    return `${this.ieee}:${button}`;
  }
  /** The buttons seen sending a release, kept in the saved settings across starts. */
  releasingButtons() {
    const stored = this.setting(RELEASING_BUTTONS_KEY);
    return Array.isArray(stored) ? stored.filter((b) => typeof b === "string") : [];
  }
  /** Keep a button's first release; one already kept writes nothing. */
  rememberRelease(button) {
    const buttons = this.releasingButtons();
    if (!buttons.includes(button)) this.saveSetting(RELEASING_BUTTONS_KEY, [...buttons, button]);
  }
  /** A non-button action (motion_wake, menu_select, led_notification_end ...). */
  emitEvent(action, extra = {}) {
    const payload = { action, action_command: action, ...extra };
    this.publish(payload);
    this.sendEvent(payload);
  }
  /** The same event for blueprints: `action_` prefixes dropped, IEEE and model added. */
  sendEvent(payload) {
    if (this.stopped) return;
    const event = { ieee: this.ieee, device: this.name, model: this.model };
    for (const [k, v] of Object.entries(payload)) event[k === "action" ? k : k.replace(/^action_/, "")] = v;
    this.ctx.event(this.ieee, event);
  }
  // -- receive ----------------------------------------------------------------
  handleAscii(frame2) {
    const t = frame2.tokens;
    if (t.length < 2) return;
    if (frame2.kind === "reply") {
      this.onReply(frame2);
      this.captureReply(frame2);
      return;
    }
    if (t[1] === "sa" && t.length >= 3) {
      this.onAnnounce(t[2], t.slice(3));
      return;
    }
    this.onOther(frame2);
  }
  onAnnounce(namespace, data) {
    this.log.debug(`Control4 ${this.name}: unhandled announcement ${namespace} ${data.join(" ")}`);
  }
  onReply(_frame) {
  }
  onOther(frame2) {
    this.log.debug(`Control4 ${this.name}: frame ${frame2.text}`);
  }
  /** EP2 / EP196 attribute 0x0000 from the check-in (a level on some families). */
  onNetworkLevel(_value) {
  }
  /** EP198 attributes (outlet profile). */
  onOutletAttributes(_attrs) {
  }
  // -- reply capture (protocol probing) ---------------------------------------
  armCapture(ms = REPLY_CAPTURE_MS) {
    this.captureUntil = Math.max(this.captureUntil, this.ctx.now() + ms);
  }
  captureReply(frame2) {
    if (this.ctx.now() > this.captureUntil) return;
    const t = frame2.tokens;
    const reply = { sequence: frame2.seq, status: t[1], namespace: t[2], data: t.slice(3), raw_text: frame2.text };
    this.log.warning(`Control4 REPLY ${this.name}: ${frame2.text}`);
    this.publish({ c4_reply: reply });
  }
  // -- control ----------------------------------------------------------------
  /** Handle one /set key. Returns the state to publish (optimistic), if any. */
  async setValue(key, value, meta) {
    if (key === "send_raw") key = "c4_send";
    else if (key === "send_get") key = "c4_get";
    switch (key) {
      case "c4_send": {
        const { cmd, dstEp } = commandArg(value);
        const type = sendType(value);
        this.armCapture();
        if (type === "i") await this.sendText(`0i${hex4(this.nextSeq())} ${cmd}`, dstEp);
        else await this.set(cmd, dstEp);
        return void 0;
      }
      case "c4_get": {
        const { cmd, dstEp } = commandArg(value);
        this.armCapture();
        await this.sendText(`0g${hex4(this.nextSeq())} ${cmd}`, dstEp);
        return void 0;
      }
      case "c4_identify":
        await this.ctx.sendIdentity(this, "manual");
        return void 0;
    }
    void meta;
    throw new UnsupportedKey(`'${key}' is not supported by ${this.model}`);
  }
  /** Handle a /get key (poll the device); default: nothing to read. */
  async getValue(_key) {
  }
  /**
   * The one-off state read to queue at startup, join and announce, for a
   * device whose state otherwise only comes from its own reports. Default: none.
   */
  stateReader() {
    return void 0;
  }
  /** State to publish once at startup (persisted settings). */
  initialState() {
    return {};
  }
};
function commandArg(value) {
  if (value && typeof value === "object") {
    const v = value;
    return { cmd: String(v.cmd ?? "").trim(), dstEp: Number(v.dst_ep ?? 1) || 1 };
  }
  return { cmd: String(value ?? "").trim(), dstEp: 1 };
}
function sendType(value) {
  const type = value && typeof value === "object" ? value.type : void 0;
  if (type === void 0 || type === null || type === "") return "s";
  const t = String(type).trim();
  if (t === "s" || t === "i") return t;
  throw new Error(`c4_send: unknown type '${type}' (use "s" or "i")`);
}
function toBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  return s === "on" || s === "true" || s === "1" || s === "yes";
}
function toNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`'${value}' is not a number`);
  return Math.max(min, Math.min(max, n));
}

// src/devices/animkeys.ts
var ANIMATION_KEYS = ["led_effect", "led_status", "led_stop", "led_refresh"];
var AnimationKeys = class {
  constructor(dev, host, buttons, protocol) {
    this.dev = dev;
    const full = {
      get ieee() {
        return dev.ieee;
      },
      get name() {
        return dev.name;
      },
      get alive() {
        return dev.alive;
      },
      set: (cmd) => dev.set(cmd),
      onNotifying: (active) => {
        dev.publish({ led_notification: active });
        dev.emitEvent(active ? "led_notification_start" : "led_notification_end");
      },
      idleHex: host.idleHex,
      dmStored: host.dmStored,
      loadOn: host.loadOn,
      verifyDm: host.verifyDm,
      quietMs: host.quietMs,
      ledsOf: host.ledsOf,
      ledMode: host.ledMode,
      onBorrow: host.onBorrow,
      unreachable: () => dev.ctx.link.isUnreachable(dev.ieee)
    };
    this.animator = dev.ctx.anim.register(full, buttons, protocol);
  }
  dev;
  animator;
  handles(key) {
    return ANIMATION_KEYS.includes(key);
  }
  async set(key, value) {
    const data = value && typeof value === "object" ? value : {};
    switch (key) {
      case "led_effect":
        if (typeof value === "string") await ledEffect(this.animator, { effect: value });
        else await ledEffect(this.animator, data);
        return void 0;
      case "led_status":
        await ledStatus(this.animator, data);
        return void 0;
      case "led_stop":
        await this.animator.stop(data.restore === void 0 ? true : Boolean(data.restore));
        return void 0;
      case "led_refresh":
        await this.animator.refresh();
        return void 0;
    }
    return void 0;
  }
  initialState() {
    return { led_notification: this.animator.animating };
  }
};

// src/devices/dimming.ts
var DEFAULT_ON_LEVEL = 191;
var LEVEL_SETTLE = 2e3;
var ON_TRANSITION_KEY = "on_transition";
var OFF_TRANSITION_KEY = "off_transition";
var DEFAULT_ON_TRANSITION = 0.8;
var DEFAULT_OFF_TRANSITION = 2;
var LoadControl = class {
  constructor(dev, options = {}) {
    this.dev = dev;
    this.options = options;
  }
  dev;
  options;
  settleTimer;
  lastOnLevel;
  onTransition() {
    return Number(this.dev.setting(ON_TRANSITION_KEY, DEFAULT_ON_TRANSITION));
  }
  offTransition() {
    return Number(this.dev.setting(OFF_TRANSITION_KEY, DEFAULT_OFF_TRANSITION));
  }
  /** A level the device reported (0-254). Commits it as "last lit" once settled. */
  noteLevel(level) {
    this.dev.cancel(this.settleTimer);
    this.settleTimer = void 0;
    if (level <= 0) return;
    this.settleTimer = this.dev.after(LEVEL_SETTLE, () => {
      this.lastOnLevel = level;
      this.dev.saveSetting("last_level", level);
    });
  }
  lastLevel() {
    return this.lastOnLevel ?? this.dev.setting("last_level");
  }
  onLevel() {
    if (this.options.fixedOnLevel) return this.options.fixedOnLevel;
    const last = this.lastLevel();
    if (last) return last;
    const cur = Number(this.dev.state().brightness);
    return cur > 0 ? cur : DEFAULT_ON_LEVEL;
  }
  /** Send Move-to-Level-with-On/Off (recovering once from a delivery failure). */
  async moveTo(level, transitionSeconds) {
    const dev = this.dev;
    const tenths = Math.round(transitionSeconds * 10);
    dev.log.debug(`Control4 ${dev.name} -> ZCL move_to_level_with_on_off level=${level} transition=${tenths / 10}s`);
    this.options.onMove?.(tenths / 10, level);
    try {
      await dev.ctx.link.sendWithRecovery(
        dev.ieee,
        () => dev.sendFrame({
          profile: HA_PROFILE,
          cluster: CLUSTER_LEVEL,
          srcEp: 1,
          dstEp: 1,
          data: moveToLevelWithOnOff(dev.nextTsn(), level, tenths)
        }),
        "level command"
      );
    } catch (error) {
      this.options.onSent?.(false);
      throw error;
    }
    this.options.onSent?.(true);
  }
  /**
   * A fade the dimmer runs itself: `0i<seq> c4.dm.rtl 00 <level %> <ms>`, one frame
   * for a fade of any length, where a ZCL level command takes the dimmer's stored
   * fades. The target is held to the dimmer's min / max brightness. Returns the level
   * (0-254) it fades to.
   */
  async fadeTo(level, seconds) {
    const dev = this.dev;
    let pct = level <= 0 ? 0 : Math.max(1, Math.min(100, Math.round(level * 100 / 254)));
    if (pct > 0 && this.options.clampPct) {
      const held = this.options.clampPct(pct);
      if (held !== pct) {
        pct = held;
        level = pctToBrightness(pct);
      }
    }
    let ms = Math.round(seconds * 1e3);
    if (this.options.hardwareFade === "sweep") {
      const live = this.options.liveLevel?.();
      const from = live ?? (dev.isOn() ? Number(dev.state().brightness) || 0 : 0);
      const fromPct = Math.round(from * 100 / 254);
      const span = Math.abs(pct - fromPct);
      if (span > 0) ms = Math.round(ms * 100 / span);
    }
    ms = Math.max(0, Math.min(2147483647, ms));
    const text = `c4.dm.rtl 00 ${hex2(pct)} ${ms.toString(16).padStart(8, "0")}`;
    dev.log.debug(`Control4 ${dev.name} -> hardware fade to ${pct} % over ${seconds}s (${text})`);
    this.options.onMove?.(seconds, level);
    try {
      await dev.ctx.link.sendWithRecovery(dev.ieee, () => dev.sendText(`0i${hex4(dev.nextSeq())} ${text}`), "fade command");
    } catch (error) {
      this.options.onSent?.(false);
      throw error;
    }
    this.options.onSent?.(true);
    return level;
  }
  /** /set for state / brightness / transition (one call per message). */
  async set(meta, dimmable) {
    const msg = meta.message;
    const transitionOverride = msg.transition !== void 0 ? toNumber(msg.transition, 0, 6553) : void 0;
    let state = msg.state !== void 0 ? String(msg.state).toUpperCase() : void 0;
    const brightness = dimmable && msg.brightness !== void 0 ? Math.round(toNumber(msg.brightness, 0, 254)) : void 0;
    const current = String(this.dev.state().state ?? "OFF").toUpperCase();
    if (state === "TOGGLE") state = current === "ON" ? "OFF" : "ON";
    const hardware = this.options.hardwareFade !== void 0 && transitionOverride !== void 0 && transitionOverride > 0;
    const fadeFor = (level2) => hardware && (this.options.fadeAllowed?.(level2) ?? true);
    if (state === "OFF" || brightness === 0 && state !== "ON") {
      if (fadeFor(0)) {
        await this.fadeTo(0, transitionOverride);
        return { state: "OFF" };
      }
      const t = Math.max(transitionOverride ?? this.offTransition(), this.options.minOffTransition ?? 0);
      await this.moveTo(0, t);
      return { state: "OFF" };
    }
    let level = brightness !== void 0 && brightness > 0 ? brightness : this.onLevel();
    if (fadeFor(level)) level = await this.fadeTo(level, transitionOverride);
    else await this.moveTo(level, Math.max(transitionOverride ?? this.onTransition(), this.options.minOnTransition ?? 0));
    if (!dimmable) return { state: "ON" };
    return { state: "ON", brightness: level };
  }
  /**
   * Any ramp-table slot: `{"set_ramp_rate": {"index": 4, "time_ms": 3000}}`
   * (the ZHA ramp cluster's set_ramp_rate). Slots 2 / 3 are the on / off fade.
   */
  async setRampRate(value) {
    const v = value && typeof value === "object" ? value : {};
    const idx = Math.round(toNumber(v.index, 1, 10));
    if (![1, 2, 3, 4, 5, 6, 8, 9, 10].includes(idx)) throw new Error(`ramp index ${idx} is not one of 01-06, 08-0a`);
    const ms = Math.round(toNumber(v.time_ms, 0, 65535));
    await this.dev.set(`c4.dm.tv 00 ${hex2(idx)} ${ms.toString(16).padStart(4, "0")}`);
    if (idx === RAMP_IDX_ON || idx === RAMP_IDX_OFF) {
      const key = idx === RAMP_IDX_ON ? ON_TRANSITION_KEY : OFF_TRANSITION_KEY;
      const seconds = Math.round(ms / 100) / 10;
      this.dev.saveSetting(key, seconds);
      return { [key]: seconds };
    }
    return void 0;
  }
  /** The ZHA ramp cluster's commands: set_on_ramp / set_off_ramp / set_on_off_ramps ({time_ms ...}). */
  async rampCommand(key, value) {
    const v = value && typeof value === "object" ? value : {};
    const out = {};
    const apply = async (index, ms) => Object.assign(out, await this.setRampRate({ index, time_ms: ms }) ?? {});
    if (key === "set_on_ramp") await apply(RAMP_IDX_ON, v.time_ms);
    else if (key === "set_off_ramp") await apply(RAMP_IDX_OFF, v.time_ms);
    else if (key === "set_on_off_ramps") {
      await apply(RAMP_IDX_ON, v.on_time_ms);
      await apply(RAMP_IDX_OFF, v.off_time_ms);
    }
    return out;
  }
  /** on_transition / off_transition: persist and push to the device ramp table. */
  async setTransition(key, value) {
    const seconds = Math.round(toNumber(value, 0, 60) * 10) / 10;
    const idx = key === ON_TRANSITION_KEY ? RAMP_IDX_ON : RAMP_IDX_OFF;
    const ms = Math.max(0, Math.min(65535, Math.round(seconds * 1e3)));
    await this.dev.set(`c4.dm.tv 00 ${hex2(idx)} ${ms.toString(16).padStart(4, "0")}`);
    this.dev.saveSetting(key, seconds);
    return { [key]: seconds };
  }
};
function reportedLevel(level) {
  return pctToBrightness(Math.floor(level * 100 / 255));
}
var FadeHold = class {
  constructor(dev, settleMs, options) {
    this.dev = dev;
    this.settleMs = settleMs;
    this.options = options;
  }
  dev;
  settleMs;
  options;
  fade;
  /** The fade that arrived last: its target and the report that said so. */
  landed;
  /** The level the load last reported (0-254) while a fade of ours runs; undefined otherwise. */
  current() {
    return this.fade?.held;
  }
  /** A level command of ours goes out (LoadControl's onMove): holds reports from now. */
  begin(target, transitionSeconds) {
    this.dev.cancel(this.fade?.timer);
    this.fade = { target, ms: transitionSeconds * 1e3 + this.settleMs, timer: void 0, endsAt: 0, held: void 0 };
    this.landed = void 0;
  }
  /**
   * That command was delivered or has failed (LoadControl's onSent). A slow
   * mesh (or a retry) delivers it late: the ramp starts then. Returns the
   * window it opened, in ms (undefined: no fade of ours is waiting).
   */
  sent(delivered) {
    const fade = this.fade;
    if (!fade) return void 0;
    if (!delivered) {
      this.fade = void 0;
      if (fade.held !== void 0) this.options.apply(fade.held);
      return void 0;
    }
    this.arm(fade, fade.ms);
    return fade.ms;
  }
  /** The level to publish for a report (0-254); undefined while it is a step of our fade. */
  report(level) {
    const fade = this.fade;
    if (!fade) {
      if (this.landed?.level === level) return this.landed.target;
      this.landed = void 0;
      return level;
    }
    const arrived = fade.target === 0 ? level === 0 : level === reportedLevel(fade.target);
    if (arrived) {
      this.dev.cancel(fade.timer);
      this.fade = void 0;
      this.landed = { target: fade.target, level };
      return fade.target;
    }
    fade.held = level;
    if (fade.timer) this.arm(fade, this.settleMs);
    return void 0;
  }
  /** Keep the window open at least `ms` from now (never shortens it). */
  arm(fade, ms) {
    const endsAt = Date.now() + ms;
    if (fade.timer && endsAt <= fade.endsAt) return;
    this.dev.cancel(fade.timer);
    fade.endsAt = endsAt;
    fade.timer = this.dev.after(ms, () => this.end(fade));
  }
  /**
   * The window ended without the target report. A held report on the other
   * side of on/off is real (the paddle reversed the fade): publish it. One on
   * the same side may be where the load stopped: the device finds out.
   */
  end(fade) {
    if (this.fade !== fade) return;
    this.fade = void 0;
    const held = fade.held;
    if (held === void 0) return;
    if (held > 0 !== fade.target > 0) this.options.apply(held);
    else this.options.stoppedShort(held);
  }
};
var TvParams = class {
  constructor(dev, params = DM_TV_PARAMS) {
    this.dev = dev;
    this.params = params;
  }
  dev;
  params;
  find(key) {
    return this.params.find((p) => p.key === key);
  }
  /** A parameter's stored value (its factory default if never written). */
  value(key) {
    const p = this.find(key);
    return Number(this.dev.setting(p.key, p.default));
  }
  initialState() {
    const out = {};
    for (const p of this.params) out[p.key] = this.dev.setting(p.key, p.default);
    return out;
  }
  /** A level % held to the dimmer's min and max brightness. */
  clampPct(pct) {
    return Math.max(this.value("min_brightness"), Math.min(this.value("max_brightness"), pct));
  }
  async set(key, value) {
    const p = this.find(key);
    const v = Math.round(p.kind === "percent" ? toNumber(value, 0, 100) : toNumber(value, 0, 65535));
    const send = () => this.dev.set(`c4.dm.tv 00 ${hex2(p.index)} ${v.toString(16).padStart(8, "0")}`);
    await send();
    this.dev.saveSetting(p.key, v);
    void this.dev.ctx.link.scheduleVerify(
      this.dev,
      `dm.tv ${hex2(p.index)}`,
      `c4.dm.tv 00 ${hex2(p.index)}`,
      (values) => parseHex(values[values.length - 1]) === v,
      send,
      500,
      (values) => {
        const actual = parseHex(values[values.length - 1]);
        if (actual === void 0) return;
        this.dev.saveSetting(p.key, actual);
        this.dev.publish({ [p.key]: actual });
      }
    );
    return { [p.key]: v };
  }
};

// src/devices/ledkeys.ts
var byte = (v, fallback = 0) => {
  const n = Math.round(Number(v ?? fallback));
  return hex2(Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : fallback);
};
var rgb = (a, p) => `${byte(a[`${p}_red`])}${byte(a[`${p}_green`])}${byte(a[`${p}_blue`])}`;
var count = (a) => Number.parseInt(byte(a.num_buttons, 12), 16);
var LED_CLUSTER_COMMANDS = {
  set_led_color: (a) => [`c4.dmx.led ${byte(a.button_id)} 03 ${rgb(a, "on")}`, `c4.dmx.led ${byte(a.button_id)} 04 ${rgb(a, "off")}`],
  set_led_mode: (a) => [`c4.dmx.led ${byte(a.button_id)} 00 ${byte(a.mode)}`, `c4.dmx.led ${byte(a.button_id)} 01 ${byte(a.behavior)}`, `c4.dmx.led ${byte(a.button_id)} 02 ${byte(a.color_mode)}`],
  set_led_all_same_color: (a) => Array.from({ length: count(a) }, (_, b) => [`c4.dmx.led ${hex2(b)} 03 ${rgb(a, "on")}`, `c4.dmx.led ${hex2(b)} 04 ${rgb(a, "off")}`]).flat(),
  set_all_led_modes: (a) => Array.from({ length: count(a) }, (_, b) => [`c4.dmx.led ${hex2(b)} 00 ${byte(a.mode)}`, `c4.dmx.led ${hex2(b)} 01 ${byte(a.behavior)}`, `c4.dmx.led ${hex2(b)} 02 ${byte(a.color_mode)}`]).flat(),
  set_led_single_on: (a) => Array.from({ length: 12 }, (_, i) => `c4.dmx.led ${hex2(i)} 01 ${i === Number(a.button_idx) ? byte(a.behavior_on) : byte(a.behavior_others)}`)
};
async function ledClusterCommand(dev, key, value) {
  let failed = 0;
  for (const cmd of LED_CLUSTER_COMMANDS[key](value && typeof value === "object" ? value : {})) {
    if (!await dev.trySet(cmd)) failed++;
    await dev.sleep(50);
  }
  if (failed) dev.log.warning(`Control4 ${dev.name}: ${key}: ${failed} frame(s) failed`);
  return void 0;
}
function ledModeOf(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    const name = LED_MODE_NAMES.find((m) => LED_MODES[m] === value);
    if (name) return name;
  }
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s/-]+/g, "_");
  if (LED_MODE_NAMES.includes(text)) return text;
  throw new Error(`unknown LED mode '${value}' (use one of ${LED_MODE_NAMES.join(", ")})`);
}
var LedKeys = class {
  constructor(dev, writer, selects, modes = /* @__PURE__ */ new Map(), withTransition = true) {
    this.dev = dev;
    this.writer = writer;
    this.selects = selects;
    this.modes = modes;
    this.withTransition = withTransition;
  }
  dev;
  writer;
  selects;
  modes;
  withTransition;
  keys() {
    const k = [...this.selects.map((s) => s.key), ...this.modes.keys(), LED_BRIGHTNESS_KEY];
    if (this.withTransition) k.push(LED_TRANSITION_KEY);
    return k;
  }
  handles(key) {
    return this.keys().includes(key);
  }
  /** The mode key of a slot, if it has one. */
  modeKey(slot) {
    for (const [key, s] of this.modes) if (s === slot) return key;
    return void 0;
  }
  /** A slot's LED mode as last read from the device or set (undefined: not known yet). */
  mode(slot) {
    const key = this.modeKey(slot);
    const stored = key ? this.dev.setting(key) : void 0;
    return stored && LED_MODE_NAMES.includes(stored) ? stored : void 0;
  }
  async set(key, value) {
    const sel = this.selects.find((s) => s.key === key);
    if (sel) {
      const name = normalizePalette(value);
      this.dev.saveSetting(key, name);
      const out = { [key]: name };
      if (sel.slots.length > 1) {
        for (const other of this.selects) {
          if (other === sel || other.verb !== sel.verb || !other.slots.every((s) => sel.slots.includes(s))) continue;
          this.dev.saveSetting(other.key, name);
          out[other.key] = name;
        }
      }
      await this.writer.apply(sel.slots, sel.verb, name);
      return out;
    }
    const slot = this.modes.get(key);
    if (slot !== void 0) {
      const mode = ledModeOf(value);
      await this.writer.setMode(slot, mode);
      this.dev.saveSetting(key, mode);
      return { [key]: mode };
    }
    if (key === LED_BRIGHTNESS_KEY) {
      const pct = Math.round(toNumber(value, 1, 100));
      this.dev.saveSetting(key, pct);
      const { stored, written } = await this.writer.reapply(this.selects);
      this.dev.log.info(`Control4 ${this.dev.name}: LED brightness ${pct}% (${written} of ${stored} colours changed)`);
      return { [key]: pct };
    }
    if (key === LED_TRANSITION_KEY) {
      const s = Math.round(toNumber(value, 0, 10) * 10) / 10;
      this.dev.saveSetting(key, s);
      return { [key]: s };
    }
    throw new Error(`unknown LED key ${key}`);
  }
  /**
   * Give a newly paired device its default colours: every slot that has no stored colour
   * is written LED_DEFAULT_COLOUR once (each slot/verb once, even under an all-slots key)
   * and the keys are stored and published. Returns how many keys were set.
   */
  async applyDefaults() {
    const unset = this.selects.filter((s) => this.dev.setting(s.key) === void 0);
    if (!unset.length) return 0;
    const written = /* @__PURE__ */ new Set();
    for (const sel of unset) {
      const todo = sel.slots.filter((slot) => !written.has(`${sel.verb}:${slot}`));
      if (!todo.length) continue;
      await this.writer.apply(todo, sel.verb, LED_DEFAULT_COLOUR);
      for (const slot of todo) written.add(`${sel.verb}:${slot}`);
    }
    if (!this.dev.alive) return 0;
    const out = {};
    for (const sel of unset) {
      this.dev.saveSetting(sel.key, LED_DEFAULT_COLOUR);
      out[sel.key] = LED_DEFAULT_COLOUR;
    }
    this.dev.publish(out);
    return unset.length;
  }
  initialState() {
    const out = {};
    for (const s of this.selects) out[s.key] = this.dev.setting(s.key) ?? null;
    for (const [k, slot] of this.modes) out[k] = this.mode(slot) ?? null;
    out[LED_BRIGHTNESS_KEY] = this.dev.setting(LED_BRIGHTNESS_KEY, 100);
    if (this.withTransition) out[LED_TRANSITION_KEY] = this.dev.setting(LED_TRANSITION_KEY, 0);
    return out;
  }
};

// src/devices/sensors.ts
var AMB_PROPERTY = "c4.dmx.amb";
var PWR_PROPERTY = "c4.dmx.pwr";
var PENDING_TTL = 2e4;
var MIN_PERIOD = 1e4;
var OFF_RECHECK = 6e4;
var FAILURES_BEFORE_BACKOFF = 3;
var BACKOFF = 6e5;
var Poller = class {
  constructor(dev, periodMs, firstDelayMs, optionKey) {
    this.dev = dev;
    this.periodMs = periodMs;
    this.firstDelayMs = firstDelayMs;
    this.optionKey = optionKey;
  }
  dev;
  periodMs;
  firstDelayMs;
  optionKey;
  pending = /* @__PURE__ */ new Map();
  failures = 0;
  timer;
  /** The poll period now: the device option when set, else the default; undefined = off. */
  period() {
    const raw = this.dev.option(this.optionKey);
    if (raw === void 0 || raw === null || raw === "") return this.periodMs;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) return this.periodMs;
    if (seconds <= 0) return void 0;
    return Math.max(MIN_PERIOD, seconds * 1e3);
  }
  start() {
    this.schedule(this.firstDelayMs + Math.random() * (this.period() ?? this.periodMs));
  }
  schedule(ms) {
    this.dev.cancel(this.timer);
    this.timer = this.dev.after(ms, async () => {
      const period = this.period();
      if (period === void 0) {
        this.schedule(OFF_RECHECK);
        return;
      }
      try {
        await this.pollOnce();
        this.failures = 0;
      } catch {
        this.failures++;
      }
      const base = this.failures >= FAILURES_BEFORE_BACKOFF ? Math.max(BACKOFF, period) : period;
      this.schedule(base * (0.9 + Math.random() * 0.2));
    });
  }
  async pollOnce() {
    const seq = hex4(this.dev.nextSeq());
    const now = this.dev.ctx.now();
    for (const [s, ts] of this.pending) if (now - ts >= PENDING_TTL) this.pending.delete(s);
    this.pending.set(seq, now);
    await this.dev.sendText(`0g${seq} ${this.request()}`);
  }
  /** A `0r<seq> 000 <prop> <fields...>` reply; true when it was ours. */
  reply(seq, fields) {
    const sentAt = this.pending.get(seq);
    if (sentAt === void 0) return false;
    this.pending.delete(seq);
    if (this.dev.ctx.now() - sentAt >= PENDING_TTL) return false;
    return this.accept(fields);
  }
};
var AmbientSensor = class _AmbientSensor extends Poller {
  constructor(dev) {
    super(dev, 3e4, 45e3, "ambient_light_poll");
  }
  request() {
    return `${AMB_PROPERTY} 00`;
  }
  static parse(fields) {
    const v = parseHex(fields[0]);
    return v !== void 0 && v >= 0 && v <= 255 ? v : void 0;
  }
  accept(fields) {
    const level = _AmbientSensor.parse(fields);
    if (level === void 0) return false;
    this.dev.publish({ ambient_light: level });
    return true;
  }
  /** Unsolicited `sa c4.dmx.amb <val>`. */
  announce(fields) {
    const level = _AmbientSensor.parse(fields);
    if (level !== void 0) this.dev.publish({ ambient_light: level });
  }
};
var PWR_EVENT_DEBOUNCE = 2e3;
var PWR_EVENT_DELAY = 800;
var ENERGY_RAW_KEY = "energy_raw";
var ENERGY_OFFSET_KEY = "energy_offset";
var PowerSensor = class _PowerSensor extends Poller {
  lastTrigger = Number.NEGATIVE_INFINITY;
  constructor(dev) {
    super(dev, 3e4, 2e4, "power_poll");
  }
  request() {
    return PWR_PROPERTY;
  }
  static parse(fields) {
    if (fields.length < 6) return void 0;
    const v = fields.slice(0, 6).map((f) => parseHex(f));
    if (v.some((x) => x === void 0)) return void 0;
    const [volts, ma, watts, va, pf, count2] = v;
    return { voltage: volts, current: ma / 1e3, power: watts, power_apparent: va, power_factor: pf / 1e3, energyCount: count2 };
  }
  /**
   * The energy total in kWh, which never falls. The counter drops at a reboot (to
   * its last flash save: 2932 -> 2000 on the APD120), and Home Assistant reads a
   * drop in a total_increasing sensor as a meter reset, counting the difference
   * twice. So what a drop takes off goes into a saved offset, and raw + offset goes out.
   */
  energy(count2) {
    const last = this.dev.setting(ENERGY_RAW_KEY);
    let offset = Number(this.dev.setting(ENERGY_OFFSET_KEY, 0)) || 0;
    if (typeof last === "number" && count2 < last) {
      offset += last - count2;
      this.dev.saveSetting(ENERGY_OFFSET_KEY, offset);
      this.dev.log.info(`Control4 ${this.dev.name}: its energy counter fell from ${last} to ${count2} (a reboot restores its last save); the total carries on from ${last}`);
    }
    if (last !== count2) this.dev.saveSetting(ENERGY_RAW_KEY, count2);
    return Math.round((count2 + offset) * ENERGY_WH_PER_COUNT) / 1e3;
  }
  /** Publish a reading, from a poll reply or a c4.dmx.ls announcement. False when it doesn't parse. */
  publishReading(fields) {
    const r = _PowerSensor.parse(fields);
    if (!r) return false;
    const { energyCount, ...values } = r;
    this.dev.publish({ ...values, energy: this.energy(energyCount) });
    return true;
  }
  accept(fields) {
    return this.publishReading(fields);
  }
  /** Read power right after a load change (debounced, after the ramp settles). */
  pollSoon() {
    const now = this.dev.ctx.now();
    if (now - this.lastTrigger < PWR_EVENT_DEBOUNCE) return;
    this.lastTrigger = now;
    this.dev.after(PWR_EVENT_DELAY, () => this.pollOnce());
  }
};

// src/devices/dmx.ts
var DmxDevice = class extends C4Device {
  amb;
  pwr;
  led;
  get ledKeys() {
    return this.led;
  }
  start(_hotLoad = false) {
    this.amb?.start();
    this.pwr?.start();
  }
  buttonName(id) {
    return this.buttons[id] ?? `button_${id}`;
  }
  fire(hex, gesture, count2) {
    const id = parseHex(hex);
    if (id === void 0) return;
    this.emitAction(this.buttonName(id), gesture, { action_button_id: id });
    if (count2 !== void 0) this.syncClick(id, count2);
  }
  onAnnounce(ns, data) {
    switch (ns) {
      case "c4.dmx.ls":
        this.onLightState(data);
        return;
      case "c4.dmx.dim":
        this.onPhase(data[data.length - 1]);
        return;
      case "c4.dmx.warn":
        this.onWarning(data);
        return;
      case "c4.dmx.amb":
        this.amb?.announce(data);
        return;
      case "c4.dmx.bp":
        this.fire(data[0], "press");
        return;
      case "c4.dmx.sc":
        this.fire(data[0], "release");
        return;
      case "c4.dmx.cc":
        if (data.length >= 2) this.fire(data[0], clickGesture(data[1]), parseHex(data[1]));
        return;
      case "c4.dmx.hc":
        this.fire(data[0], "hold");
        return;
      case "c4.dmx.he":
        this.fire(data[0], "hold_release");
        return;
      case "c4.dmx.tc":
        return;
    }
    if (ns.startsWith("c4.ln.") || ns.startsWith("c4.zr.")) return;
    this.log.info(`Control4 ${this.name}: unknown namespace '${ns}' data=${data.join(" ")}`);
  }
  onReply(frame2) {
    const t = frame2.tokens;
    if (t.length > 3 && t[1] === "000") {
      if (t[2] === AMB_PROPERTY) this.amb?.reply(frame2.seq, t.slice(3));
      else if (t[2] === PWR_PROPERTY) this.pwr?.reply(frame2.seq, t.slice(3));
    }
  }
  /** `c4.dmx.ls`: field 2 is the load level in percent. */
  onLightState(_fields) {
  }
  /** `c4.dmx.dim`: the dimming phase in use (not a level). */
  onPhase(hex) {
    this.log.debug(`Control4 ${this.name}: dimming phase ${hex}`);
  }
  /** `c4.dmx.warn`: the warning the device announces. */
  onWarning(data) {
    this.log.info(`Control4 ${this.name}: device warning ${data.join(" ")}`);
  }
  /** A click-count confirmation (cc) on a paddle half. */
  syncClick(_id, _count) {
  }
  async setValue(key, value, meta) {
    if (this.led?.handles(key)) return this.led.set(key, value);
    if (key in LED_CLUSTER_COMMANDS) return ledClusterCommand(this, key, value);
    return super.setValue(key, value, meta);
  }
  async getValue(key) {
    if (key === "ambient_light") await this.amb?.pollOnce();
    else if (POWER_KEYS.includes(key)) await this.pwr?.pollOnce();
  }
  initialState() {
    return { ...this.led?.initialState() ?? {} };
  }
};
var FAN_BUTTON_SPEED = { 1: 4, 2: 3, 3: 2, 4: 1, 5: 0 };
var FAN_PROVISIONED_KEY = "fan_provisioned";
var Fan = class extends DmxDevice {
  buttons = FAN_BUTTONS;
  start() {
    super.start();
    if (!this.setting(FAN_PROVISIONED_KEY, false)) this.after(2e4 + Math.random() * 1e4, () => this.provision());
  }
  /** Transition-time params (as the Director provisions) and the speed LEDs. */
  async provision() {
    for (let i = 1; i <= 6; i++) {
      await this.trySet(`c4.dm.tv 00 ${hex2(i)} 00`);
      await this.sleep(50);
    }
    for (let btn = 0; btn <= 4; btn++) {
      for (const cmd of [`c4.dmx.led ${hex2(btn)} 00 00`, `c4.dmx.led ${hex2(btn)} 01 ${hex2(7 - btn)}`, `c4.dmx.led ${hex2(btn)} 02 00`]) {
        await this.trySet(cmd);
        await this.sleep(50);
      }
    }
    if (!this.alive) return;
    this.saveSetting(FAN_PROVISIONED_KEY, true);
    this.log.info(`Control4 ${this.name}: fan provisioned (ramps + speed LEDs)`);
  }
  publishSpeed(speed) {
    if (speed > 0) this.saveSetting("last_speed", speed);
    this.publish(speed > 0 ? { state: "ON", speed } : { state: "OFF" });
  }
  onAnnounce(ns, data) {
    if (ns === "c4.dmx.fs") {
      const speed = parseHex(data[2]);
      if (speed !== void 0 && speed >= 0 && speed <= 4) this.publishSpeed(speed);
      return;
    }
    super.onAnnounce(ns, data);
  }
  syncClick(id, count2) {
    const speed = FAN_BUTTON_SPEED[id];
    if (count2 >= 1 && speed !== void 0) this.publishSpeed(speed);
  }
  async setValue(key, value, meta) {
    if (key === "state" || key === "speed") {
      const msg = meta.message;
      let speed;
      if (msg.speed !== void 0) speed = Math.round(toNumber(msg.speed, 0, 4));
      else {
        let s = String(msg.state ?? value).toUpperCase();
        if (s === "TOGGLE") s = String(this.state().state ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
        speed = s === "ON" ? Number(this.setting("last_speed", 4)) || 4 : 0;
      }
      await this.ctx.link.sendWithRecovery(this.ieee, () => this.set(`c4.dmx.fsc 00 ${hex2(speed)}`), "fan command");
      if (speed > 0) this.saveSetting("last_speed", speed);
      return speed > 0 ? { state: "ON", speed } : { state: "OFF" };
    }
    return super.setValue(key, value, meta);
  }
};

// src/devices/dm.ts
var DIM1Z_LEDS = [
  { key: "led_top_on_color", slots: [0], verb: "active" },
  { key: "led_top_off_color", slots: [0], verb: "idle" },
  { key: "led_bottom_on_color", slots: [1], verb: "active" },
  { key: "led_bottom_off_color", slots: [1], verb: "idle" }
];
var DIM1Z_LED_NAMES = { top: [0], button_1: [0], bottom: [1], button_2: [1] };
var PADDLE_NS = /^c4\.dm\.b([0-9a-f]+)([cbe])$/;
var DmDevice = class extends C4Device {
  fireDm(hex, gesture) {
    const id = parseHex(hex);
    if (id === void 0) return;
    this.emitAction(DM_BUTTONS[id] ?? `button_${id + 1}`, gesture, { action_button_id: id });
  }
};
var LED_REPAINT_SETTLE = 1e3;
var STATE_READ_REUSE = 2e3;
var STATE_READ_RAMP_WAITS = 10;
var STATE_READ_FRESH = 1e4;
var SETTINGS_READ_KEY = "settings_read";
var SETTINGS_READ_DELAY = 3e4;
var Dim1z = class extends DmDevice {
  // A hold reports b<idx>b / b<idx>e with no paddle-down before it, so a
  // paddle-down is a tap the moment it arrives.
  hasHold = false;
  /** Until when the load may still be ramping (ms epoch): our fade + settle, or the last c4.dm.t0c + settle. */
  rampUntil = 0;
  /** The DIM1-Z's mid-fade c4.dm.t0c reports; one that stops short has the real level read. */
  hold = new FadeHold(this, LED_REPAINT_SETTLE, {
    apply: (level) => this.applyLoad(level > 0, level),
    stoppedShort: () => void this.refreshLoad()
  });
  load = new LoadControl(this, {
    onMove: (s, level) => {
      const fadeSeconds = s + this.coldStartMs(level) / 1e3;
      this.noteRamp(fadeSeconds * 1e3 + LED_REPAINT_SETTLE);
      this.hold.begin(level, fadeSeconds);
    },
    onSent: (delivered) => {
      const ms = this.hold.sent(delivered);
      if (ms !== void 0) this.noteRamp(ms);
    },
    // Its `rtl` time is a full 0-100 % sweep (tested 2026-11-07 on Linen Closet).
    hardwareFade: "sweep",
    clampPct: (pct) => this.tv.clampPct(pct),
    liveLevel: () => this.hold.current(),
    fadeAllowed: (level) => this.coldStartMs(level) === 0
  });
  repaintTimer;
  repaintPending = false;
  /** Bumped by every level report and every fade of ours: a read that saw it change is stale. */
  levelEpoch = 0;
  lastStateRead = 0;
  stateRead;
  tv = new TvParams(this, DIM1Z_TV_PARAMS);
  led;
  get ledKeys() {
    return this.led;
  }
  anim;
  constructor(...args) {
    super(...args);
    this.led = new LedKeys(this, new LedWriter(this, "dm"), DIM1Z_LEDS, /* @__PURE__ */ new Map(), false);
    this.anim = new AnimationKeys(
      this,
      {
        idleHex: () => "000000",
        dmStored: (btn) => this.storedPair(btn),
        loadOn: () => {
          const s = this.state().state;
          return s === void 0 ? void 0 : String(s).toUpperCase() === "ON";
        },
        verifyDm: (matches, resend) => {
          void this.ctx.link.scheduleVerify(this, "dm led paint", "c4.dm.is", matches, resend, 1500);
        },
        quietMs: () => Math.max(0, this.rampUntil - Date.now()),
        // Button 1 is the top paddle, as its events name it.
        ledsOf: (name) => DIM1Z_LED_NAMES[name]
      },
      [0, 1],
      "dm"
    );
  }
  noteRamp(ms) {
    this.levelEpoch++;
    this.rampUntil = Math.max(this.rampUntil, Date.now() + ms);
  }
  get ramping() {
    return this.rampUntil > Date.now();
  }
  /** Wait for the load to stop ramping (a held paddle keeps extending it): false if it never does or the handler stops. */
  async rampDone() {
    for (let waits = 0; this.ramping; waits++) {
      if (waits >= STATE_READ_RAMP_WAITS || this.stopped) return false;
      await this.sleep(this.rampUntil - Date.now());
    }
    return !this.stopped;
  }
  /** The settings read's place in the state-read queue (the load read has the device's own). */
  get settingsReadKey() {
    return `${this.ieee}:settings`;
  }
  start(hotLoad = false) {
    super.start(hotLoad);
    if (this.setting(SETTINGS_READ_KEY) === void 0) this.ctx.link.queueStateRead(this.settingsReadKey, () => this.readSettings(), SETTINGS_READ_DELAY);
  }
  stop() {
    this.ctx.link.cancelStateRead(this.settingsReadKey);
    super.stop();
  }
  /**
   * Reboot the dimmer: `0i c4.dm.rb`, an interrupt frame (as a `0s` Set it answers e00).
   * Tested 2026-11-07: it sends no reply, its LEDs flash green then white, and it is back
   * in about 2 s with its load at the same level and every setting kept. It restarts on
   * receipt, often before its APS acknowledgement, and each APS retry then reboots it
   * again (three reboots in 3.5 s, seen by the sniffer): so the frame asks for no
   * acknowledgement and goes once. A delivery failure is no error.
   */
  async reboot() {
    try {
      await this.sendText(`0i${hex4(this.nextSeq())} c4.dm.rb`, 1, 1, { ack: false });
    } catch (error) {
      const reason = error.reason;
      if (!isDeliveryFailure(error) || reason === "unqueued" || reason === "stopped") throw error;
      this.log.debug(`Control4 ${this.name}: the reboot's delivery was not confirmed (it restarts on receipt): ${error}`);
    }
  }
  /** Whether the link may reboot it on its own: its auto_reboot option, on unless set off. */
  autoReboot() {
    const v = this.option(AUTO_REBOOT_OPTION);
    return v === void 0 || v === null || v === "" || toBool(v);
  }
  /** A turn-on from off holds the cold start level this long before its own fade. */
  coldStartMs(level) {
    if (level <= 0 || String(this.state().state ?? "OFF").toUpperCase() === "ON") return 0;
    return this.tv.value(COLD_START_LEVEL_KEY) > 0 ? this.tv.value(COLD_START_TIME_KEY) : 0;
  }
  /** [load-on, load-off] colours stored for paddle LED `btn`, at LED brightness. */
  storedPair(btn) {
    const pct = Number(this.setting(LED_BRIGHTNESS_KEY, 100));
    const pos = btn === 0 ? "top" : "bottom";
    const hex = (k) => {
      const name = this.setting(k);
      return scaleHex(name ? PALETTE_HEX[name] ?? "000000" : "000000", pct);
    };
    return [hex(`led_${pos}_on_color`), hex(`led_${pos}_off_color`)];
  }
  onAnnounce(ns, data) {
    if (ns === "c4.dm.t0c") {
      const pct = parseHex(data[0]);
      if (pct === void 0) return;
      this.noteRamp(LED_REPAINT_SETTLE);
      const level = this.hold.report(pctToBrightness(pct));
      if (level !== void 0) this.applyLoad(level > 0, level);
      return;
    }
    if (ns === "c4.dm.b0c" || ns === "c4.dm.b1c") {
      this.fireDm(ns[7], "press");
      return;
    }
    if (ns === "c4.dm.cc") {
      if (data.length >= 2) this.fireDm(data[0], clickGesture(data[1]));
      return;
    }
    const m = PADDLE_NS.exec(ns);
    if (m && m[2] !== "c") {
      this.fireDm(m[1], m[2] === "b" ? "hold" : "hold_release");
      return;
    }
    super.onAnnounce(ns, data);
  }
  /** Publish the load's state, from a c4.dm.t0c report or a ZCL read. */
  applyLoad(on, level) {
    this.load.noteLevel(on ? level ?? 0 : 0);
    const was = this.state().state;
    this.publish(on ? level ? { state: "ON", brightness: level } : { state: "ON" } : { state: "OFF" });
    if ((on ? "ON" : "OFF") !== was && this.anim.animator?.painting) this.repaintPending = true;
    if (this.repaintPending) {
      this.cancel(this.repaintTimer);
      this.repaintTimer = this.after(LED_REPAINT_SETTLE, () => {
        this.repaintPending = false;
        return this.anim.animator.applyStatus();
      });
    }
  }
  /**
   * Read genOnOff / genLevelCtrl on EP1 (the standard clusters ZHA read) and
   * publish what the dimmer reports. Never while the load fades: a read
   * mid-ramp can leave it glowing, and its own reports give the state then.
   */
  async readLoad() {
    if (!await this.rampDone()) return "skipped";
    const epoch = this.levelEpoch;
    const stale = () => this.stopped || this.levelEpoch !== epoch;
    let onOff;
    try {
      onOff = (await this.zclRead(1, "genOnOff", ["onOff"])).onOff;
    } catch (error) {
      this.log.debug(`Control4 ${this.name}: on/off read failed: ${error}`);
      return "failed";
    }
    if (stale()) return "skipped";
    let level;
    try {
      level = (await this.zclRead(1, "genLevelCtrl", ["currentLevel"])).currentLevel;
    } catch (error) {
      this.log.debug(`Control4 ${this.name}: level read failed: ${error}`);
    }
    if (stale()) return "skipped";
    if (typeof onOff !== "number" && typeof onOff !== "boolean") return "failed";
    this.lastStateRead = Date.now();
    const on = Boolean(onOff);
    const lvl = typeof level === "number" && level > 0 ? Math.min(254, Math.round(level)) : void 0;
    this.log.debug(`Control4 ${this.name}: read on_off=${Number(on)} level=${lvl ?? "-"}`);
    this.applyLoad(on, lvl);
    return "read";
  }
  /** One read at a time; a second caller shares the read in flight. */
  refreshLoad() {
    this.stateRead ??= this.readLoad().finally(() => {
      this.stateRead = void 0;
    });
    return this.stateRead;
  }
  async getValue(key) {
    if (key !== "state" && key !== "brightness") return;
    if (Date.now() - this.lastStateRead < STATE_READ_REUSE) return;
    await this.refreshLoad();
  }
  stateReader() {
    const epoch = this.levelEpoch;
    return async () => {
      if (this.stopped || this.levelEpoch !== epoch || this.ramping) return "skipped";
      if (Date.now() - this.lastStateRead < STATE_READ_FRESH) return "skipped";
      return this.refreshLoad();
    };
  }
  /** A Get once the load has stopped ramping: its reply, or undefined (no answer, or it never stopped). */
  async quietGet(prop) {
    if (!await this.rampDone()) return void 0;
    return this.get(prop);
  }
  /**
   * Read the dimmer parameters the device holds, so its entities show what it
   * does, not a default or a write it lost: once, and again after it may have
   * been reset (it left the network, or came from another instance).
   * c4.dm.is carries default-on, both fades and the paddle flag; the others are
   * single c4.dm.tv slots. All or nothing: an unanswered Get keeps nothing. One
   * the dimmer answers with an error (a variant without it) is left as shown.
   */
  async readSettings() {
    if (this.stopped || this.setting(SETTINGS_READ_KEY) !== void 0) return "skipped";
    const isReply = await this.quietGet("c4.dm.is");
    if (!isReply) return "failed";
    const is = isReply.status === "000" ? isReply.values : [];
    const percent = (hex) => {
      const n = parseHex(hex);
      return n !== void 0 && n <= 100 ? n : void 0;
    };
    const seconds = (hex) => {
      const ms = parseHex(hex);
      return ms === void 0 ? void 0 : Math.round(ms / 100) / 10;
    };
    const read = {};
    const put = (key, value) => {
      if (value !== void 0) read[key] = value;
    };
    if (is.length >= 9) {
      put("default_on_brightness", percent(is[1]));
      put(ON_TRANSITION_KEY, seconds(is[2]));
      put(OFF_TRANSITION_KEY, seconds(is[3]));
      const flags = parseHex(is[8]);
      if (flags !== void 0) put("paddle_local_control", flags & 2 ? "ON" : "OFF");
    }
    for (const p of DIM1Z_TV_PARAMS) {
      if (p.key in read) continue;
      const reply = await this.quietGet(`c4.dm.tv 00 ${hex2(p.index)}`);
      if (!reply) return "failed";
      if (reply.status !== "000") continue;
      const value = reply.values[reply.values.length - 1];
      put(p.key, p.kind === "percent" ? percent(value) : parseHex(value));
    }
    if (this.stopped) return "skipped";
    const shown = this.initialState();
    const changed = Object.keys(read).filter((k) => shown[k] !== read[k]);
    for (const [key, value] of Object.entries(read)) {
      if (key === "paddle_local_control") this.saveSetting("ba", value === "ON" ? 1 : 0);
      else this.saveSetting(key, value);
    }
    this.saveSetting(SETTINGS_READ_KEY, Date.now());
    this.publish(read);
    if (changed.length) this.log.info(`Control4 ${this.name}: settings read from the device: ${changed.map((k) => `${k} ${shown[k]} -> ${read[k]}`).join(", ")}`);
    else this.log.debug(`Control4 ${this.name}: settings read from the device, as shown`);
    return "read";
  }
  async setValue(key, value, meta) {
    if (key === "state" || key === "brightness" || key === "transition") return this.load.set(meta, true);
    if (key === ON_TRANSITION_KEY || key === OFF_TRANSITION_KEY) return this.load.setTransition(key, value);
    if (key === "set_ramp_rate") return this.load.setRampRate(value);
    if (key === "set_on_ramp" || key === "set_off_ramp" || key === "set_on_off_ramps") return this.load.rampCommand(key, value);
    if (key in LED_CLUSTER_COMMANDS) return ledClusterCommand(this, key, value);
    if (this.tv.find(key)) return this.tv.set(key, value);
    if (key === REBOOT_KEY) {
      this.log.info(`Control4 ${this.name}: rebooting it from its Reboot button (c4.dm.rb) - back in about 2 s, its light and settings as they are`);
      await this.reboot();
      this.ctx.link.noteRebooted(this.ieee);
      return void 0;
    }
    if (key === "paddle_local_control") {
      const on = toBool(value);
      await this.set(`c4.dm.ba ${on ? "01" : "00"}`);
      this.saveSetting("ba", on ? 1 : 0);
      return { paddle_local_control: on ? "ON" : "OFF" };
    }
    if (this.led.handles(key)) return this.led.set(key, value);
    if (this.anim.handles(key)) return this.anim.set(key, value);
    return super.setValue(key, value, meta);
  }
  initialState() {
    const ba = this.setting("ba", 1);
    return {
      ...this.led.initialState(),
      ...this.tv.initialState(),
      ...this.anim.initialState(),
      [ON_TRANSITION_KEY]: this.load.onTransition(),
      [OFF_TRANSITION_KEY]: this.load.offTransition(),
      paddle_local_control: ba ? "ON" : "OFF"
    };
  }
};
var FS1_CONFIRM_TIMEOUT = 6e3;
var FS1_STATE_PROPS = /* @__PURE__ */ new Set(["c4.dm.t0c", "c4.dm.ls"]);
var Fs1z = class extends DmDevice {
  // Assumed to report as the DIM1-Z does, its generation (no FS1-Z capture yet, #51):
  // b<idx>c once per physical press, and a hold as b<idx>b / b<idx>e with no b<idx>c
  // before it. So a paddle-down is a tap the moment it arrives.
  hasHold = false;
  load = new LoadControl(this, { fixedOnLevel: 254, minOnTransition: 0.8, minOffTransition: 2 });
  lastReport;
  report(on) {
    this.lastReport = { on, at: this.ctx.now() };
    this.publish({ state: on ? "ON" : "OFF" });
  }
  onAnnounce(ns, data) {
    if (ns === "c4.dm.t0c") {
      const pct = parseHex(data[0]);
      if (pct !== void 0) this.report(pct > 0);
      return;
    }
    if (ns === "c4.dm.cc") {
      if (data.length >= 2) this.fireDm(data[0], clickGesture(data[1]));
      return;
    }
    const m = PADDLE_NS.exec(ns);
    if (m) {
      this.fireDm(m[1], m[2] === "c" ? "press" : m[2] === "b" ? "hold" : "hold_release");
      return;
    }
    super.onAnnounce(ns, data);
  }
  onReply(frame2) {
    const t = frame2.tokens;
    if (t.length > 3 && t[1] === "000" && FS1_STATE_PROPS.has(t[2])) {
      const pct = parseHex(t[3]);
      if (pct !== void 0) this.report(pct > 0);
    }
  }
  async setValue(key, value, meta) {
    if (key === "state") {
      const sentAt = this.ctx.now();
      const result = await this.load.set(meta, false);
      this.after(FS1_CONFIRM_TIMEOUT, () => {
        const r = this.lastReport;
        if (!r || r.at >= sentAt) return;
        this.log.warning(`Control4 ${this.name}: no c4.dm.t0c confirmation within ${FS1_CONFIRM_TIMEOUT / 1e3}s - reverting to the last reported state`);
        this.publish({ state: r.on ? "ON" : "OFF" });
      });
      return result;
    }
    return super.setValue(key, value, meta);
  }
};
var OUTLET_ENDPOINTS = { l1: 0, l2: 1 };
var Outlet = class extends DmxDevice {
  buttons = OUTLET_BUTTONS;
  publishOutlet(idx, on) {
    if (idx === 0 || idx === 1) this.publish({ [`state_l${idx + 1}`]: on ? "ON" : "OFF" });
  }
  onAnnounce(ns, data) {
    if (ns === "c4.dm.tc") {
      const idx = parseHex(data[0]);
      const level = parseHex(data[1]);
      if (idx !== void 0 && level !== void 0) this.publishOutlet(idx, level > 0);
      return;
    }
    super.onAnnounce(ns, data);
  }
  syncClick(id, count2) {
    this.publishOutlet(id, count2 === 1);
  }
  onNetworkLevel(value) {
    this.publishOutlet(0, value > 0);
  }
  onOutletAttributes(attrs) {
    const v = attrs.get(0);
    if (typeof v === "number") this.publishOutlet(0, v > 0);
  }
  async setValue(key, value, meta) {
    if (key === "state") {
      const ep = meta.endpoint ?? "l1";
      const idx = OUTLET_ENDPOINTS[ep];
      if (idx === void 0) throw new Error(`unknown outlet '${ep}'`);
      let s = String(value).toUpperCase();
      if (s === "TOGGLE") s = String(this.state()[`state_${ep}`] ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
      const on = s === "ON";
      await this.ctx.link.sendWithRecovery(this.ieee, () => this.set(`c4.dm.tv ${hex2(idx)} 00 ${on ? "64" : "00"}`), "outlet command");
      return { state: on ? "ON" : "OFF" };
    }
    return super.setValue(key, value, meta);
  }
  async getValue(key) {
    if (key.startsWith("state")) {
      for (const idx of [0, 1]) await this.sendText(`0g${hex4(this.nextSeq())} c4.dm.tv ${hex2(idx)} 00`);
    }
  }
};

// src/devices/gen3.ts
var RESET_REASON_KEY = "reset_reason";
var RESET_CODE_KEY = "reset_reason_code";
var TX_POWER_KEY = "tx_power";
var TX_POWER_SET_KEY = "tx_power_set";
var LED_BORROWED_KEY = "led_borrowed";
var FIRMWARE_VERSION_KEY = "firmware_version";
var BOOTLOADER_VERSION_KEY = "bootloader_version";
var FAULT_KEY = "fault";
var DIMMING_PHASE_KEY = "dimming_phase";
var RESET_BASE = {
  UNK: "unknown",
  FIB: "bootloader",
  BTL: "bootloader",
  EXT: "external reset",
  PWR: "power on",
  WDG: "watchdog",
  SW: "software",
  CRS: "crash",
  FSH: "flash failure",
  BAD: "bad image",
  FLT: "fault"
};
var RESET_EXTENDED = {
  "EXT PIN": "reset pin",
  "PWR HV": "power on",
  "PWR LV": "brown-out",
  "WDG EXP": "expired",
  "WDG LWM": "low-water mark",
  "SW RBT": "reboot",
  "SW DSL": "deep sleep",
  "CRS AST": "assert",
  "FLT HRD": "hard fault",
  "FLT MEM": "memory fault",
  "FLT BUS": "bus fault",
  "FLT USG": "usage fault",
  "FLT DBG": "debug monitor",
  "FLT DMA": "DMA fault",
  "FLT VCT": "vector table fault"
};
var RESET_ALARMING = /* @__PURE__ */ new Set(["CRS", "WDG", "FLT", "FSH", "BAD"]);
function describeResetReason(code) {
  const norm = code.trim().replace(/\s+/g, " ");
  const base = norm.split(" ")[0] ?? "";
  const baseText = RESET_BASE[base];
  if (!baseText) return norm || "unknown";
  const ext = RESET_EXTENDED[norm];
  return `${baseText}${ext && ext !== baseText ? `: ${ext}` : ""} (${norm})`;
}
function textValue(values) {
  const quoted = values.find((v) => v.startsWith('"'));
  const raw = quoted ? quoted.replace(/^"|"$/g, "") : values.join(" ");
  return raw.replace(/[^\x20-\x7e]/g, " ").trim().replace(/\s+/g, " ");
}
function resetAlarming(code) {
  return RESET_ALARMING.has(code.trim().split(/\s+/)[0] ?? "");
}
function behaviourOf(value) {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (BUTTON_BEHAVIOUR_NAMES.includes(text)) return text;
  throw new Error(`unknown button behaviour '${value}' (use one of ${BUTTON_BEHAVIOUR_NAMES.join(", ")})`);
}
function behaviourFromCode(hex) {
  const code = parseHex(hex);
  return BUTTON_BEHAVIOUR_NAMES.find((b) => BUTTON_BEHAVIOURS[b] === code);
}
function behaviourRead(dev, wire, key, what) {
  return {
    prop: `c4.dmx.btn ${hex2(wire)} 01`,
    parse: (v) => {
      const b = behaviourFromCode(lastValue(v));
      if (!b) dev.log.info(`Control4 ${dev.name}: ${what} has a button behaviour the extension doesn't name (${lastValue(v)}); left as it is`);
      return b ? { [key]: b } : void 0;
    }
  };
}
async function writeBehaviour(dev, wire, key, value) {
  const behaviour = behaviourOf(value);
  const code = hex2(BUTTON_BEHAVIOURS[behaviour]);
  const cmd = `c4.dmx.btn ${hex2(wire)} 01 ${code}`;
  await dev.set(cmd);
  dev.saveSetting(key, behaviour);
  void dev.ctx.link.scheduleVerify(dev, `dmx btn ${hex2(wire)}`, `c4.dmx.btn ${hex2(wire)} 01`, (v) => parseHex(lastValue(v)) === BUTTON_BEHAVIOURS[behaviour], () => dev.trySet(cmd), 500, (v) => {
    const actual = behaviourFromCode(lastValue(v));
    if (!actual) return;
    dev.saveSetting(key, actual);
    dev.publish({ [key]: actual });
  });
  return { [key]: behaviour };
}
function modeFromCode(hex) {
  const code = parseHex(hex);
  return LED_MODE_NAMES.find((m) => LED_MODES[m] === code);
}
function signedByte(hex) {
  const n = parseHex(hex);
  if (n === void 0 || n > 255) return void 0;
  return n > 127 ? n - 256 : n;
}
function paletteNameOf(hex) {
  const h = (hex ?? "").toLowerCase();
  return Object.keys(PALETTE_HEX).find((n) => PALETTE_HEX[n] === h);
}
var Gen3Device = class extends DmxDevice {
  /** The APD120 and SW120277 report a fault status (Composer's Fault Detection); the keypad has no load. */
  hasFault = false;
  anim;
  get ledKeys() {
    return this.led;
  }
  /** The settings read's place in the state-read queue (the health read has the device's own). */
  get settingsReadKey() {
    return `${this.ieee}:settings`;
  }
  start(hotLoad = false) {
    super.start(hotLoad);
    this.anim?.animator.seedBorrowed(this.borrowedSlots());
    if (this.setting(SETTINGS_READ_KEY) === void 0) this.ctx.link.queueStateRead(this.settingsReadKey, () => this.readSettings(), SETTINGS_READ_DELAY);
  }
  stop() {
    this.ctx.link.cancelStateRead(this.settingsReadKey);
    super.stop();
  }
  // -- settings read from the device ----------------------------------------
  /** Every setting this model holds, read once (and again after it may have been reset). */
  settingReads() {
    const borrowed = this.borrowedSlots();
    const reads = BMC_DEFAULTS.map((_, i) => ({
      prop: `c4.dmx.bmc ${hex2(i)}`,
      parse: (v) => {
        const ms = parseHex(lastValue(v));
        return ms !== void 0 && ms <= 65535 ? { [`multiclick_time_${i + 1}`]: ms } : void 0;
      }
    }));
    for (const [key, slot] of this.led.modes) {
      if (borrowed.includes(slot)) continue;
      reads.push({
        prop: `c4.dmx.led ${hex2(slot)} 01`,
        parse: (v) => {
          const mode = modeFromCode(lastValue(v));
          if (!mode) this.log.info(`Control4 ${this.name}: LED slot ${slot} is in a mode the extension doesn't name (${lastValue(v)}); left as it is`);
          return mode ? { [key]: mode } : void 0;
        }
      });
    }
    reads.push(
      {
        prop: "c4.sy.zpw",
        parse: (v) => {
          const dbm = signedByte(lastValue(v));
          return dbm === void 0 ? void 0 : { [TX_POWER_KEY]: dbm };
        }
      },
      { prop: "c4.sy.fwv", parse: (v) => textValue(v) ? { [FIRMWARE_VERSION_KEY]: textValue(v) } : void 0 },
      { prop: "c4.sy.blv", parse: (v) => textValue(v) ? { [BOOTLOADER_VERSION_KEY]: textValue(v) } : void 0 }
    );
    return reads;
  }
  /**
   * Read the settings the device holds, so its entities show what it does, not a
   * default: once, and again after it may have been reset (it left the network, or
   * came from another instance). A Get it answers with an error (a firmware without
   * that setting) is skipped. An unanswered one ends the read: what was read so far
   * is kept, and the read is tried again later.
   */
  async readSettings() {
    if (this.stopped || this.setting(SETTINGS_READ_KEY) !== void 0) return "skipped";
    const read = {};
    let complete = true;
    for (const r of this.settingReads()) {
      const reply = await this.get(r.prop);
      if (this.stopped) return "skipped";
      if (!reply) {
        complete = false;
        break;
      }
      if (reply.status !== "000") continue;
      Object.assign(read, r.parse(reply.values) ?? {});
    }
    this.applyRead(read);
    if (!complete) return "failed";
    this.saveSetting(SETTINGS_READ_KEY, Date.now());
    return "read";
  }
  /** Keep and publish what was read, and log what differed from what was shown. */
  applyRead(read) {
    if (!Object.keys(read).length) return;
    const shown = this.initialState();
    const changed = Object.keys(read).filter((k) => shown[k] !== read[k]);
    for (const [key, value] of Object.entries(read)) this.saveSetting(key, value);
    this.publish(read);
    if (changed.length) this.log.info(`Control4 ${this.name}: settings read from the device: ${changed.map((k) => `${k} ${shown[k] ?? "-"} -> ${read[k]}`).join(", ")}`);
    else this.log.debug(`Control4 ${this.name}: settings read from the device, as shown`);
  }
  // -- health read at each start and re-join --------------------------------
  stateReader() {
    return () => this.readHealth();
  }
  /** Why it last restarted, its fault status, and its TX power put back if it lost it. */
  async readHealth() {
    if (this.stopped) return "skipped";
    const ri = await this.get("c4.sy.ri");
    if (this.stopped) return "skipped";
    if (!ri) return "failed";
    if (ri.status === "000") this.noteResetReason(textValue(ri.values));
    if (this.hasFault) {
      const warn = await this.get("c4.dmx.warn 00");
      if (warn?.status === "000") this.noteFault(lastValue(warn.values));
    }
    await this.restoreTxPower();
    return "read";
  }
  noteResetReason(code) {
    const norm = code.trim().replace(/\s+/g, " ");
    const text = describeResetReason(norm);
    const before = this.setting(RESET_CODE_KEY);
    this.saveSetting(RESET_CODE_KEY, norm);
    this.saveSetting(RESET_REASON_KEY, text);
    this.publish({ [RESET_REASON_KEY]: text });
    if (before === norm) return;
    if (resetAlarming(norm)) this.log.warning(`Control4 ${this.name}: it last restarted on a ${text}`);
    else this.log.info(`Control4 ${this.name}: it last restarted on ${text}`);
  }
  /** `c4.dmx.warn 00`: the fault status (Composer's Fault Detection, short circuit or overload); 0 = none. */
  noteFault(hex) {
    const code = parseHex(hex);
    if (code === void 0) return;
    const fault = code !== 0;
    const was = this.setting(FAULT_KEY);
    this.saveSetting(FAULT_KEY, fault);
    this.publish({ [FAULT_KEY]: fault });
    if (fault && was !== true) this.log.warning(`Control4 ${this.name}: the device reports a fault (c4.dmx.warn 00 = ${hex}): a short circuit or overload on its load?`);
    else if (!fault && was === true) this.log.info(`Control4 ${this.name}: its fault has cleared`);
  }
  onWarning(data) {
    if (data.length >= 2 && data[0] === "00") this.noteFault(data[1]);
    else if (data.length === 1) this.noteFault(data[0]);
    else super.onWarning(data);
  }
  // -- TX power -------------------------------------------------------------
  async setTxPower(value) {
    const dbm = Math.round(toNumber(value, TX_POWER_MIN, TX_POWER_MAX));
    const send = () => this.set(`c4.sy.zpw ${hex2(dbm & 255)}`);
    await send();
    this.saveSetting(TX_POWER_KEY, dbm);
    this.saveSetting(TX_POWER_SET_KEY, true);
    void this.ctx.link.scheduleVerify(this, "sy.zpw", "c4.sy.zpw", (v) => signedByte(lastValue(v)) === dbm, send, 500, (v) => {
      const actual = signedByte(lastValue(v));
      if (actual === void 0) return;
      this.saveSetting(TX_POWER_KEY, actual);
      this.publish({ [TX_POWER_KEY]: actual });
    });
    return { [TX_POWER_KEY]: dbm };
  }
  /** A TX power set from Home Assistant is put back if the device has lost it (whether it survives a power cut is unknown). */
  async restoreTxPower() {
    if (!this.setting(TX_POWER_SET_KEY, false)) return;
    const want = this.setting(TX_POWER_KEY);
    if (typeof want !== "number") return;
    const reply = await this.get("c4.sy.zpw");
    if (!reply || reply.status !== "000") return;
    const have = signedByte(lastValue(reply.values));
    if (have === void 0 || have === want) return;
    this.log.info(`Control4 ${this.name}: its TX power is ${have} dBm, not the ${want} dBm set: putting it back`);
    await this.trySet(`c4.sy.zpw ${hex2(want & 255)}`);
  }
  // -- LEDs borrowed for a status colour --------------------------------------
  borrowedSlots() {
    const stored = this.setting(LED_BORROWED_KEY);
    return Array.isArray(stored) ? stored.filter((s) => typeof s === "number") : [];
  }
  /** The animator borrowed a follow-load LED (switched it to programmed for a status colour), or gave it back. */
  noteBorrow(slot, borrowed) {
    const slots = new Set(this.borrowedSlots());
    if (borrowed) slots.add(slot);
    else slots.delete(slot);
    this.saveSetting(LED_BORROWED_KEY, [...slots].sort((a, b) => a - b));
  }
  // -- keys -------------------------------------------------------------------
  async setValue(key, value, meta) {
    const m = /^multiclick_time_([123])$/.exec(key);
    if (m) {
      const idx = Number(m[1]) - 1;
      const ms = Math.round(toNumber(value, 50, 5e3));
      await this.set(`c4.dmx.bmc ${hex2(idx)} ${ms.toString(16).padStart(4, "0")}`);
      this.saveSetting(key, ms);
      return { [key]: ms };
    }
    if (key === TX_POWER_KEY) return this.setTxPower(value);
    const modeSlot = this.led.modes.get(key);
    if (modeSlot !== void 0) {
      this.anim?.animator.forgetBorrowed(modeSlot);
      this.noteBorrow(modeSlot, false);
    }
    if (this.anim?.handles(key)) return this.anim.set(key, value);
    return super.setValue(key, value, meta);
  }
  initialState() {
    const out = { ...super.initialState(), ...this.anim?.initialState() ?? {} };
    BMC_DEFAULTS.forEach((def, i) => {
      out[`multiclick_time_${i + 1}`] = this.setting(`multiclick_time_${i + 1}`, def);
    });
    out[TX_POWER_KEY] = this.setting(TX_POWER_KEY) ?? null;
    for (const k of [RESET_REASON_KEY, FIRMWARE_VERSION_KEY, BOOTLOADER_VERSION_KEY]) out[k] = this.setting(k) ?? null;
    if (this.hasFault) out[FAULT_KEY] = this.setting(FAULT_KEY) ?? null;
    return out;
  }
};
var PADDLE_LEDS = PADDLE_HALVES.flatMap((h) => [
  { key: `led_${h.half}_on_color`, slots: [h.slot], verb: "active" },
  { key: `led_${h.half}_off_color`, slots: [h.slot], verb: "idle" }
]);
var PADDLE_LED_MODES = new Map(PADDLE_HALVES.map((h) => [`led_${h.half}_mode`, h.slot]));
var behaviourKey = (half) => `${half}_button_behaviour`;
var LED_KEY_MIGRATION = {
  led_top_on_color: ["led_2_active_color", "led_active_color"],
  led_top_off_color: ["led_2_idle_color", "led_idle_color"],
  led_bottom_on_color: ["led_5_active_color", "led_active_color"],
  led_bottom_off_color: ["led_5_idle_color", "led_idle_color"]
};
var PADDLE_LED_NAMES = { top: [1], button_1: [1], bottom: [4], button_2: [4] };
var PaddleDevice = class extends Gen3Device {
  buttons = PADDLE_BUTTONS;
  hasFault = true;
  constructor(...args) {
    super(...args);
    this.amb = new AmbientSensor(this);
    this.pwr = new PowerSensor(this);
    this.migrateLedKeys();
    this.led = new LedKeys(this, new LedWriter(this, "dmx"), PADDLE_LEDS, PADDLE_LED_MODES);
    this.anim = new AnimationKeys(
      this,
      {
        idleHex: (slot) => this.shownHex(slot),
        dmStored: () => ["000000", "000000"],
        loadOn: () => this.loadOn(),
        verifyDm: () => void 0,
        ledsOf: (name) => PADDLE_LED_NAMES[name],
        // Not known until the settings read: then a status colour is painted without changing it.
        ledMode: (slot) => this.led.mode(slot),
        onBorrow: (slot, borrowed) => this.noteBorrow(slot, borrowed)
      },
      PADDLE_HALVES.map((h) => h.slot),
      "dmx"
    );
  }
  /**
   * What was saved under the 12-slot bar's keys moves to the two LEDs this model has
   * (slots 01 and 04): the colours, and `led_2_bound` / `led_5_bound` as their modes
   * (bound was push/release, unbound programmed).
   */
  migrateLedKeys() {
    for (const [key, olds] of Object.entries(LED_KEY_MIGRATION)) {
      if (this.setting(key) !== void 0) continue;
      const from = olds.map((o) => this.setting(o)).find((v) => v !== void 0);
      if (from !== void 0) this.saveSetting(key, from);
    }
    for (const h of PADDLE_HALVES) {
      const bound = this.setting(`led_${h.slot + 1}_bound`);
      if (typeof bound === "boolean" && this.setting(`led_${h.half}_mode`) === void 0) this.saveSetting(`led_${h.half}_mode`, bound ? "push_release" : "programmed");
    }
  }
  loadOn() {
    return this.state().state === void 0 ? void 0 : this.isOn();
  }
  /** The colour an LED shows when no status colour is on it: in follow-load mode, its colour for the load now. */
  shownHex(slot) {
    const half = PADDLE_HALVES.find((h) => h.slot === slot)?.half ?? "top";
    const mode = this.led.mode(slot) ?? "follow_load";
    const on = mode === "follow_load" && this.loadOn() === true;
    const name = this.setting(`led_${half}_${on ? "on" : "off"}_color`);
    const hex = name ? PALETTE_HEX[name] ?? "000000" : "000000";
    return scaleHex(hex, Number(this.setting(LED_BRIGHTNESS_KEY, 100)));
  }
  /** A half's button behaviour as last read or set (its factory behaviour until then). */
  behaviour(half) {
    const stored = this.setting(behaviourKey(half));
    if (stored && BUTTON_BEHAVIOUR_NAMES.includes(stored)) return stored;
    return PADDLE_HALVES.find((h) => h.half === half)?.factory ?? "event_only";
  }
  settingReads() {
    return [...super.settingReads(), ...PADDLE_HALVES.map((h) => behaviourRead(this, h.wire, behaviourKey(h.half), `its ${h.half} half`))];
  }
  /** A half's button behaviour: `c4.dmx.btn <wire> 01 <code>` (never 05), read back after. */
  setBehaviour(half, value) {
    const h = PADDLE_HALVES.find((x) => x.half === half);
    return writeBehaviour(this, h.wire, behaviourKey(half), value);
  }
  /** The SW120277's old paddle_local_control, as button behaviours: on = top on / bottom off, off = both event-only. */
  async setLocalControl(value) {
    const on = toBool(value);
    const out = {};
    for (const h of PADDLE_HALVES) Object.assign(out, await this.setBehaviour(h.half, on ? h.factory : "event_only"));
    return out;
  }
  onPhase(hex) {
    void hex;
  }
  async setValue(key, value, meta) {
    for (const h of PADDLE_HALVES) if (key === behaviourKey(h.half)) return this.setBehaviour(h.half, value);
    return super.setValue(key, value, meta);
  }
  initialState() {
    const out = super.initialState();
    for (const h of PADDLE_HALVES) out[behaviourKey(h.half)] = this.behaviour(h.half);
    return out;
  }
};
var APD_FADE_SETTLE = 2e3;
var PHASES = { 0: "none", 1: "forward", 2: "reverse" };
function phaseName(hex) {
  const code = parseHex(hex);
  if (code === void 0) return void 0;
  return PHASES[code] ?? "other";
}
var LOAD_KEYS = /* @__PURE__ */ new Set([
  "state",
  "brightness",
  "transition",
  ON_TRANSITION_KEY,
  OFF_TRANSITION_KEY,
  "set_ramp_rate",
  "set_on_ramp",
  "set_off_ramp",
  "set_on_off_ramps"
]);
var DimmerLoad = class {
  constructor(dev) {
    this.dev = dev;
    this.hold = new FadeHold(dev, APD_FADE_SETTLE, {
      apply: (level) => this.applyLevel(level),
      stoppedShort: (held) => this.applyLevel(held)
    });
    this.tv = new TvParams(dev, APD120_TV_PARAMS);
    this.load = new LoadControl(dev, {
      onMove: (s, level) => this.hold.begin(level, s),
      onSent: (delivered) => void this.hold.sent(delivered),
      // Its `rtl` time is this move's own length (tested on the APD120 2026-11-07).
      hardwareFade: "move",
      clampPct: (pct) => this.tv.clampPct(pct),
      liveLevel: () => this.hold.current(),
      // A turn-on from off with a cold start set keeps the cold start (as on the DIM1-Z).
      fadeAllowed: (level) => level <= 0 || dev.isOn() || this.tv.value("cold_start_level") <= 0
    });
  }
  dev;
  /**
   * The dimmer's mid-fade c4.dmx.ls reports. It reports to the end of the ramp,
   * so one that stops short (a max-brightness trim) is where the load is.
   */
  hold;
  tv;
  load;
  /** Its `c4.dm.is`: the tv table in slot order (00-0a), one Get for the lot. */
  tableRead() {
    return {
      prop: "c4.dm.is",
      parse: (v) => {
        if (v.length < 11) return void 0;
        const n = v.map((x) => parseHex(x));
        const out = {};
        const pct = (x) => x !== void 0 && x <= 100 ? x : void 0;
        const put = (key, x) => {
          if (x !== void 0) out[key] = x;
        };
        put("default_on_brightness", pct(n[1]));
        put(ON_TRANSITION_KEY, n[2] === void 0 ? void 0 : Math.round(n[2] / 100) / 10);
        put(OFF_TRANSITION_KEY, n[3] === void 0 ? void 0 : Math.round(n[3] / 100) / 10);
        put("hold_ramp_up", n[4]);
        put("hold_ramp_down", n[5]);
        put("max_brightness", pct(n[6]));
        put("min_brightness", pct(n[8]));
        put("cold_start_level", pct(n[9]));
        put("cold_start_time", n[10]);
        return out;
      }
    };
  }
  /** `c4.dmx.dim`: the phase it dims in. */
  phaseRead() {
    return {
      prop: "c4.dmx.dim",
      parse: (v) => {
        const phase = phaseName(lastValue(v));
        return phase ? { [DIMMING_PHASE_KEY]: phase } : void 0;
      }
    };
  }
  onPhase(hex) {
    const phase = phaseName(hex);
    if (!phase) return;
    this.dev.saveSetting(DIMMING_PHASE_KEY, phase);
    this.dev.publish({ [DIMMING_PHASE_KEY]: phase });
  }
  /**
   * `c4.dmx.ls 00 00 <level %> <V> <mA> <W> <VA> <PF x 1000> <energy> 0000`: the
   * level, published as the light's state. False when it carried none.
   */
  onLightState(fields) {
    const pct = parseHex(fields[2]);
    if (pct === void 0) return false;
    const level = this.hold.report(pctToBrightness(pct));
    if (level !== void 0) this.applyLevel(level);
    return true;
  }
  applyLevel(level) {
    this.load.noteLevel(level);
    this.dev.publish(level > 0 ? { state: "ON", brightness: level } : { state: "OFF" });
  }
  handles(key) {
    return LOAD_KEYS.has(key) || this.tv.find(key) !== void 0;
  }
  async set(key, value, meta) {
    if (key === "state" || key === "brightness" || key === "transition") return this.load.set(meta, true);
    if (key === ON_TRANSITION_KEY || key === OFF_TRANSITION_KEY) return this.load.setTransition(key, value);
    if (key === "set_ramp_rate") return this.load.setRampRate(value);
    if (key === "set_on_ramp" || key === "set_off_ramp" || key === "set_on_off_ramps") return this.load.rampCommand(key, value);
    return this.tv.set(key, value);
  }
  initialState() {
    return {
      ...this.tv.initialState(),
      [ON_TRANSITION_KEY]: this.load.onTransition(),
      [OFF_TRANSITION_KEY]: this.load.offTransition(),
      [DIMMING_PHASE_KEY]: this.dev.setting(DIMMING_PHASE_KEY) ?? null
    };
  }
};
var Apd120 = class extends PaddleDevice {
  dimmer = new DimmerLoad(this);
  get load() {
    return this.dimmer.load;
  }
  get tv() {
    return this.dimmer.tv;
  }
  settingReads() {
    return [this.dimmer.tableRead(), ...super.settingReads(), this.dimmer.phaseRead()];
  }
  onPhase(hex) {
    this.dimmer.onPhase(hex);
  }
  /** The level, then a power reading (`c4.dmx.ls` fields 3 on). */
  onLightState(fields) {
    if (!this.dimmer.onLightState(fields)) return;
    if (!this.pwr?.publishReading(fields.slice(3))) this.pwr?.pollSoon();
  }
  // A tap moves no state here: syncClick stays the base's no-op (DimmerLoad says why).
  async setValue(key, value, meta) {
    if (this.dimmer.handles(key)) return this.dimmer.set(key, value, meta);
    return super.setValue(key, value, meta);
  }
  initialState() {
    return { ...super.initialState(), ...this.dimmer.initialState() };
  }
};
var DECOUPLE_FLAG = "sw_decoupled";
var Sw120277 = class extends PaddleDevice {
  constructor(...args) {
    super(...args);
    if (this.setting(DECOUPLE_FLAG, false)) {
      for (const h of PADDLE_HALVES) if (this.setting(behaviourKey(h.half)) === void 0) this.saveSetting(behaviourKey(h.half), "event_only");
    }
  }
  onLightState(fields) {
    const pct = parseHex(fields[2]);
    if (pct === void 0) return;
    this.publish({ state: pct > 0 ? "ON" : "OFF" });
    if (!this.pwr?.publishReading(fields.slice(3))) this.pwr?.pollSoon();
  }
  /**
   * A tap on a half that switches the relay one way: its state, should the relay's
   * own c4.dmx.ls report be lost. A toggling half's state comes from that report
   * alone: it arrives before the tap's count, so flipping on the count would undo it.
   * An event-only or momentary half moves nothing.
   */
  syncClick(id, count2) {
    if (count2 < 1) return;
    const h = PADDLE_HALVES.find((x) => x.wire === id);
    if (!h) return;
    const b = this.behaviour(h.half);
    if (b === "load_on") this.publish({ state: "ON" });
    else if (b === "load_off") this.publish({ state: "OFF" });
  }
  async onOff(on) {
    await this.ctx.link.sendWithRecovery(
      this.ieee,
      () => this.sendFrame({
        profile: HA_PROFILE,
        cluster: CLUSTER_ON_OFF,
        srcEp: 1,
        dstEp: 1,
        data: buildZclCommand(this.nextTsn(), on ? 1 : 0)
      }),
      "on/off command"
    );
  }
  async setValue(key, value, meta) {
    if (key === "state") {
      let s = String(value).toUpperCase();
      if (s === "TOGGLE") s = String(this.state().state ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
      await this.onOff(s === "ON");
      return { state: s === "ON" ? "ON" : "OFF" };
    }
    if (key === "paddle_local_control") return this.setLocalControl(value);
    return super.setValue(key, value, meta);
  }
};

// src/devices/keypad.ts
function storedHex(dev, key) {
  const name = dev.setting(key);
  const hex = name ? PALETTE_HEX[name] ?? "000000" : "000000";
  return scaleHex(hex, Number(dev.setting(LED_BRIGHTNESS_KEY, 100)));
}
function kpLedSelects(ids) {
  const out = [];
  ids.forEach((id, i) => {
    out.push({ key: `button_${i + 1}_idle_color`, slots: [id], verb: "idle" });
    out.push({ key: `button_${i + 1}_pressed_color`, slots: [id], verb: "active" });
  });
  return out;
}
var Keypad = class extends DmxDevice {
  buttons;
  anim;
  constructor(ctx, ieee, model, family) {
    super(ctx, ieee, model, family);
    const ids = KP_BUTTON_IDS[family];
    const count2 = ids.length;
    this.buttons = keypadButtonsOf(ids);
    this.led = new LedKeys(this, new LedWriter(this, "kp"), kpLedSelects(ids));
    this.anim = new AnimationKeys(
      this,
      {
        idleHex: (btn) => storedHex(this, `button_${ids.indexOf(btn) + 1}_idle_color`),
        dmStored: () => ["000000", "000000"],
        loadOn: () => void 0,
        verifyDm: () => void 0,
        // button_N's LED is its id's slot.
        ledsOf: (name) => {
          const n = buttonNumberOf(name);
          return n !== void 0 && n <= count2 ? [ids[n - 1]] : void 0;
        }
      },
      ids,
      "kp"
    );
  }
  start(hotLoad = false) {
    super.start(hotLoad);
    if (hotLoad) return;
    this.after(12e3 + Math.random() * 2e4, async () => {
      for (let i = 0; i < 3; i++) {
        await this.ctx.sendIdentity(this, `${this.family}_init_${i}`);
        await this.sleep(4e3);
      }
    });
  }
  onAnnounce(ns, data) {
    switch (ns) {
      case "c4.kp.cc":
        if (data.length >= 2) super.onAnnounce("c4.dmx.cc", data);
        return;
      case "c4.kp.bb":
        super.onAnnounce("c4.dmx.bp", data);
        return;
      case "c4.kp.bc":
        super.onAnnounce("c4.dmx.sc", data);
        return;
      case "c4.kp.bh":
      // hold, repeats every ~0.6 s (KPZ-3B1 fw 03.22.41)
      case "c4.kp.hc":
        super.onAnnounce("c4.dmx.hc", data);
        return;
      case "c4.kp.be":
      case "c4.kp.he":
        super.onAnnounce("c4.dmx.he", data);
        return;
    }
    super.onAnnounce(ns, data);
  }
  async setValue(key, value, meta) {
    if (this.anim.handles(key)) return this.anim.set(key, value);
    return super.setValue(key, value, meta);
  }
  initialState() {
    return { ...super.initialState(), ...this.anim.initialState() };
  }
};
function kcLedSelects() {
  const out = [];
  for (let i = 0; i < KC_LED_SLOTS; i++) {
    out.push({ key: `led_${i + 1}_idle_color`, slots: [i], verb: "idle" });
    out.push({ key: `led_${i + 1}_pressed_color`, slots: [i], verb: "active" });
  }
  return out;
}
function kcModeKeys() {
  return new Map(Array.from({ length: KC_LED_SLOTS }, (_, i) => [`led_${i + 1}_mode`, i]));
}
var KC_WIRES_KEY = "fitted_wires";
var BACKLIGHT_COLOR_KEY = "backlight_color";
var BACKLIGHT_BRIGHTNESS_KEY = "backlight_brightness";
function parseLayout(raw) {
  if (raw === void 0 || raw === null || String(raw).trim() === "") return void 0;
  const positions = String(raw).split(/[\s,;]+/).filter(Boolean).map(Number);
  if (!positions.length || positions.some((n) => !Number.isInteger(n) || n < 1 || n > KC_POSITIONS)) return void 0;
  return [...new Set(positions.map((n) => n - 1))].sort((a, b) => a - b);
}
var Kc120277 = class extends Gen3Device {
  buttons = {};
  constructor(...args) {
    super(...args);
    this.amb = new AmbientSensor(this);
    this.migrateBound();
    this.led = new LedKeys(this, new LedWriter(this, "dmx"), kcLedSelects(), kcModeKeys());
    this.seedWires();
    const slots = Array.from({ length: KC_LED_SLOTS }, (_, i) => i);
    this.anim = new AnimationKeys(
      this,
      {
        idleHex: (btn) => storedHex(this, `led_${btn + 1}_idle_color`),
        dmStored: () => ["000000", "000000"],
        loadOn: () => void 0,
        verifyDm: () => void 0,
        // A button's LED is the slot of the wire it reports.
        ledsOf: (name) => {
          const n = buttonNumberOf(name);
          if (n === void 0) return void 0;
          const wire = kcWireOf(n, this.layout());
          return wire !== void 0 && wire < KC_LED_SLOTS ? [wire] : void 0;
        },
        // Control4 provisions a keypad's button LEDs push/release.
        ledMode: (slot) => this.led.mode(slot) ?? "push_release",
        onBorrow: (slot, borrowed) => this.noteBorrow(slot, borrowed)
      },
      slots,
      "dmx"
    );
  }
  /** `led_N_bound` was push/release (on) or programmed (off): saved as the slot's mode. */
  migrateBound() {
    for (let i = 1; i <= KC_LED_SLOTS; i++) {
      const bound = this.setting(`led_${i}_bound`);
      if (typeof bound === "boolean" && this.setting(`led_${i}_mode`) === void 0) this.saveSetting(`led_${i}_mode`, bound ? "push_release" : "programmed");
    }
  }
  /** Wires a press came from that the button_layout option doesn't list (each warned of once). */
  unlisted = /* @__PURE__ */ new Set();
  /** The wires seen so far, or undefined while none is. */
  learnedWires() {
    const stored = this.setting(KC_WIRES_KEY);
    const wires = Array.isArray(stored) ? stored.filter((w) => typeof w === "number") : [];
    return wires.length ? [...wires].sort((a, b) => a - b) : void 0;
  }
  /** The fitted buttons' wires: the `button_layout` option, else the wires seen; undefined while not known. */
  fittedWires() {
    return parseLayout(this.option(KC_LAYOUT_OPTION)) ?? this.learnedWires();
  }
  /**
   * How its buttons are named, and what its exposes need. "fitted" numbering takes its
   * order from the `button_layout` option: while the layout is still being learned it
   * numbers as "slots", or each newly learned button would renumber the ones below it.
   */
  layout() {
    const set = parseLayout(this.option(KC_LAYOUT_OPTION));
    const numbering = kcNumbering(this.option(KC_NUMBERING_OPTION));
    return { wires: set ?? this.learnedWires(), numbering: numbering === "fitted" && !set ? "slots" : numbering };
  }
  /** Buttons seen sending a release before wires were learned: their wires, under the numbering in use now. */
  seedWires() {
    if (this.learnedWires()) return;
    const releasing = this.setting("releasing_buttons");
    if (!Array.isArray(releasing)) return;
    const wires = /* @__PURE__ */ new Set();
    for (const name of releasing) {
      const n = typeof name === "string" ? buttonNumberOf(name) : void 0;
      if (n === void 0) continue;
      const wire = kcWireOf(n, { wires: void 0, numbering: kcNumbering(this.option(KC_NUMBERING_OPTION)) === "pairs" ? "pairs" : "slots" });
      if (wire !== void 0 && wire < KC_POSITIONS) wires.add(wire);
    }
    if (wires.size) this.saveSetting(KC_WIRES_KEY, [...wires].sort((a, b) => a - b));
  }
  /** A press from a wire not seen before: a fitted button. Its actions and LED are exposed from now on. */
  learnWire(wire) {
    if (wire >= KC_POSITIONS) return;
    const set = parseLayout(this.option(KC_LAYOUT_OPTION));
    if (set && !set.includes(wire) && !this.unlisted.has(wire)) {
      this.unlisted.add(wire);
      this.log.warning(`Control4 ${this.name}: a button at position ${wire + 1} is missing from its button_layout option (${this.option(KC_LAYOUT_OPTION)}): add it there`);
    }
    const known = this.learnedWires() ?? [];
    if (known.includes(wire)) return;
    this.saveSetting(KC_WIRES_KEY, [...known, wire].sort((a, b) => a - b));
    this.log.info(`Control4 ${this.name}: a button at position ${wire + 1} (wire ${wire}); its actions and LED are exposed`);
    if (parseLayout(this.option(KC_LAYOUT_OPTION)) === void 0) this.ctx.exposesChanged(this.ieee);
  }
  fire(hex, gesture, count2) {
    const id = parseHex(hex);
    if (id !== void 0) this.learnWire(id);
    super.fire(hex, gesture, count2);
  }
  /** Button N by the numbering option: pairs (default), slots, or fitted (the Nth fitted button from the top). */
  buttonName(id) {
    return `button_${kcButtonNumber(id, this.layout())}`;
  }
  settingReads() {
    return [
      ...super.settingReads(),
      {
        prop: "c4.dmx.blc 00 05",
        parse: (v) => {
          const name = paletteNameOf(lastValue(v));
          if (!name) this.log.info(`Control4 ${this.name}: its backlight colour ${lastValue(v)} is not a palette colour; shown as unknown`);
          return name ? { [BACKLIGHT_COLOR_KEY]: name } : void 0;
        }
      },
      {
        prop: "c4.dmx.blc 00 03",
        parse: (v) => {
          const n = parseHex(lastValue(v));
          return n !== void 0 && n <= 255 ? { [BACKLIGHT_BRIGHTNESS_KEY]: Math.round(n * 100 / 255) } : void 0;
        }
      }
    ];
  }
  /** The backlight (`c4.dmx.blc 00 05`, black = off) and its brightness (`blc 00 03`), both tested on the Kitchen Keypad 2026-11-07. */
  async setBacklight(key, value) {
    let cmd;
    let shown;
    let matches;
    if (key === BACKLIGHT_COLOR_KEY) {
      const name = normalizePalette(value);
      const hex = PALETTE_HEX[name];
      cmd = `c4.dmx.blc 00 05 ${hex}`;
      shown = name;
      matches = (v) => lastValue(v)?.toLowerCase() === hex;
    } else {
      const pct = Math.round(toNumber(value, 0, 100));
      const byte2 = Math.round(pct * 255 / 100);
      cmd = `c4.dmx.blc 00 03 ${hex2(byte2)}`;
      shown = pct;
      matches = (v) => parseHex(lastValue(v)) === byte2;
    }
    await this.set(cmd);
    this.saveSetting(key, shown);
    void this.ctx.link.scheduleVerify(this, `dmx ${key}`, cmd.split(" ").slice(0, 3).join(" "), matches, () => this.trySet(cmd));
    return { [key]: shown };
  }
  async setValue(key, value, meta) {
    if (key === BACKLIGHT_COLOR_KEY || key === BACKLIGHT_BRIGHTNESS_KEY) return this.setBacklight(key, value);
    const bound = /^led_(\d+)_bound$/.exec(key);
    if (bound) {
      await super.setValue(`led_${bound[1]}_mode`, toBool(value) ? "push_release" : "programmed", meta);
      return { [`led_${bound[1]}_mode`]: toBool(value) ? "push_release" : "programmed" };
    }
    return super.setValue(key, value, meta);
  }
  initialState() {
    return {
      ...super.initialState(),
      [BACKLIGHT_COLOR_KEY]: this.setting(BACKLIGHT_COLOR_KEY) ?? null,
      [BACKLIGHT_BRIGHTNESS_KEY]: this.setting(BACKLIGHT_BRIGHTNESS_KEY) ?? null
    };
  }
};

// src/devices/kd120.ts
var KD_FACTORY_BEHAVIOUR = "toggle";
var positionBehaviourKey = (wire) => `button_position_${wire + 1}_behaviour`;
var POSITION_BEHAVIOUR = /^button_position_([1-7])_behaviour$/;
var Kd120 = class extends Kc120277 {
  hasFault = true;
  dimmer;
  constructor(...args) {
    super(...args);
    this.pwr = new PowerSensor(this);
    this.dimmer = new DimmerLoad(this);
  }
  get load() {
    return this.dimmer.load;
  }
  get tv() {
    return this.dimmer.tv;
  }
  /** The wires whose behaviour is read and shown: the fitted buttons', or every position while those aren't known. */
  behaviourWires() {
    return this.fittedWires() ?? Array.from({ length: KC_POSITIONS }, (_, i) => i);
  }
  /** A position's button behaviour as last read or set (its factory behaviour until then). */
  behaviour(wire) {
    const stored = this.setting(positionBehaviourKey(wire));
    return stored && BUTTON_BEHAVIOUR_NAMES.includes(stored) ? stored : KD_FACTORY_BEHAVIOUR;
  }
  /** Wires 07 / 08 are an auxiliary keypad wired to it, not a fitted button (the KC numbering would call 07 button_4). */
  buttonName(id) {
    return AUX_BUTTONS[id] ?? super.buttonName(id);
  }
  settingReads() {
    return [
      this.dimmer.tableRead(),
      ...super.settingReads(),
      ...this.behaviourWires().map((w) => behaviourRead(this, w, positionBehaviourKey(w), `its button at position ${w + 1}`)),
      this.dimmer.phaseRead()
    ];
  }
  onPhase(hex) {
    this.dimmer.onPhase(hex);
  }
  /** The level, then a power reading (`c4.dmx.ls` fields 3 on), as on the APD120. */
  onLightState(fields) {
    if (!this.dimmer.onLightState(fields)) return;
    if (!this.pwr?.publishReading(fields.slice(3))) this.pwr?.pollSoon();
  }
  async setValue(key, value, meta) {
    if (this.dimmer.handles(key)) return this.dimmer.set(key, value, meta);
    const m = POSITION_BEHAVIOUR.exec(key);
    if (m) return writeBehaviour(this, Number(m[1]) - 1, key, value);
    return super.setValue(key, value, meta);
  }
  initialState() {
    const out = { ...super.initialState(), ...this.dimmer.initialState() };
    for (const w of this.behaviourWires()) out[positionBehaviourKey(w)] = this.behaviour(w);
    return out;
  }
};

// src/devices/outlet-dimmer.ts
var ENDPOINT_OF = { 0: "l1", 1: "l2" };
var LIGHT_KEYS = /* @__PURE__ */ new Set(["state", "brightness", "transition"]);
var MAX_TRANSITION_S = 3600;
var lastLevelKey = (ep) => `last_level_${ep}`;
var OutletDimmer = class extends DmxDevice {
  buttons = OUTLET_BUTTONS;
  onAnnounce(ns, data) {
    if (ns === "c4.dm.tc") {
      const ch = parseHex(data[0]);
      const pct = parseHex(data[1]);
      if (ch !== void 0 && pct !== void 0) this.applyLevel(ch, pct);
      return;
    }
    super.onAnnounce(ns, data);
  }
  /** An outlet's level (%) as its light state; a level above 0 is remembered for a plain turn-on. */
  applyLevel(ch, pct) {
    const ep = ENDPOINT_OF[ch];
    if (!ep) return;
    const level = pctToBrightness(Math.min(100, pct));
    if (level > 0) this.saveSetting(lastLevelKey(ep), level);
    this.publish(level > 0 ? { [`state_${ep}`]: "ON", [`brightness_${ep}`]: level } : { [`state_${ep}`]: "OFF" });
  }
  /** Each outlet's level, read with `0g c4.dm.tv <ch> 00` (its reply carries the level last). */
  async readLevels() {
    for (const ch of [0, 1]) {
      const reply = await this.get(`c4.dm.tv ${hex2(ch)} 00`);
      if (this.stopped) return "skipped";
      if (!reply) return "failed";
      const pct = parseHex(lastValue(reply.values));
      if (reply.status === "000" && pct !== void 0) this.applyLevel(ch, pct);
    }
    return "read";
  }
  stateReader() {
    return () => this.readLevels();
  }
  async getValue(key) {
    if (key === "state" || key === "brightness") await this.readLevels();
  }
  async setValue(key, value, meta) {
    if (!LIGHT_KEYS.has(key)) return super.setValue(key, value, meta);
    const ep = meta.endpoint ?? "l1";
    const ch = OUTLET_ENDPOINTS[ep];
    if (ch === void 0) throw new Error(`unknown outlet '${ep}'`);
    const msg = meta.message;
    let state = msg.state === void 0 ? void 0 : String(msg.state).toUpperCase();
    if (state === "TOGGLE") state = String(this.state()[`state_${ep}`] ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
    let level;
    if (state === "OFF") level = 0;
    else if (msg.brightness !== void 0) level = Math.round(toNumber(msg.brightness, 0, 254));
    else level = Number(this.setting(lastLevelKey(ep), 254)) || 254;
    const pct = level <= 0 ? 0 : Math.max(1, Math.min(100, Math.round(level * 100 / 254)));
    const seconds = msg.transition === void 0 ? 0 : toNumber(msg.transition, 0, MAX_TRANSITION_S);
    const ms = Math.round(seconds * 1e3);
    const send = ms > 0 ? () => this.sendText(`0i${hex4(this.nextSeq())} c4.dm.rtl ${hex2(ch)} ${hex2(pct)} ${ms.toString(16).padStart(8, "0")}`) : () => this.set(`c4.dm.tv ${hex2(ch)} 00 ${hex2(pct)}`);
    await this.ctx.link.sendWithRecovery(this.ieee, send, "outlet command");
    if (level > 0) this.saveSetting(lastLevelKey(ep), level);
    return level > 0 ? { state: "ON", brightness: level } : { state: "OFF" };
  }
};

// src/devices/remote.ts
var REMOTE_EVENT_PREFIX = "remote_";
function remoteEventType(command) {
  return command.startsWith(REMOTE_EVENT_PREFIX) ? command : `${REMOTE_EVENT_PREFIX}${command}`;
}
var DEFAULT_ROOM = "Home";
var LOCALE = "en_US";
var WAKE_REFRESH_MIN = 5e3;
var DIAG_POLL = 30 * 6e4;
var PAGE_SIZE = 5;
var GI_MAX_FRAME = 70;
var LCD_MAX_FRAME = GI_MAX_FRAME;
var ROOM_MAX = 24;
var SEQ0 = "0000";
function fitLcd(build, text) {
  let s = text;
  while (s && buildFrame(build(s)).length > LCD_MAX_FRAME) s = s.slice(0, -1);
  return s;
}
var DM_DEFAULT_ICON = 90;
var GET_BLOCKED = ["rst", "rb", "reset", "fw", "boot", "erase", "fac"];
var GET_ALLOWED = ["c4.sy.fwv"];
var SR250_GI_TEMPLATE = "0r{seq} 000 {n} {items}";
var SR260_GI_TEMPLATE = "0r{seq} 000 {items}";
var GI_ITEM_TEMPLATE = '"{icon}{label}"';
var GLYPH = /^\[([0-9a-fA-F]{2})\]/;
function splitGlyph(text) {
  const m = GLYPH.exec(text);
  if (!m) return [void 0, text];
  return [Number.parseInt(m[1], 16), text.slice(m[0].length)];
}
function format(template, fields) {
  return template.replace(/\{(\w+)\}/g, (whole, name) => {
    if (!(name in fields)) throw new Error(`unknown placeholder ${whole}`);
    return fields[name];
  });
}
var Remote = class extends C4Device {
  buttons = SR250_BUTTONS;
  pageKeys = { "04": -1, "0a": 1 };
  giTemplate = SR250_GI_TEMPLATE;
  titleIcon = 129;
  menu;
  listId = 0;
  rowsPending = false;
  lastRefresh = Number.NEGATIVE_INFINITY;
  lastDiag = Number.NEGATIVE_INFINITY;
  bootstrapped = false;
  start(hotLoad = false) {
    if (this.bootstrapped) return;
    this.bootstrapped = true;
    if (!hotLoad) this.after(16e3, () => this.bootstrap());
  }
  // -- LCD rows -----------------------------------------------------------------
  room() {
    const v = this.setting("room_name");
    if (v) return v;
    const opt = this.option("lcd_default_room");
    return typeof opt === "string" && opt.trim() ? opt.trim() : DEFAULT_ROOM;
  }
  source() {
    return this.setting("active_source", "");
  }
  async sendRoomInfo(room, source) {
    const r = fitLcd((s) => `0s${SEQ0} c4.ln.ri "${s}" ""`, sanitize(room).slice(0, ROOM_MAX));
    const src = fitLcd((s) => `0s${SEQ0} c4.ln.ri "${r}" "${s}"`, sanitize(source));
    await this.set(`c4.ln.ri "${r}" "${src}"`);
  }
  /** Push the cached rows; false when the remote did not take it (re-sent on wake). */
  async pushRoomInfo() {
    try {
      await this.sendRoomInfo(this.room(), this.source());
    } catch (error) {
      this.rowsPending = true;
      this.log.warning(`Control4 ${this.name}: LCD rows undelivered (${error.message}) - will re-send when the remote wakes`);
      return false;
    }
    this.rowsPending = false;
    return true;
  }
  async sendTime() {
    const now = /* @__PURE__ */ new Date();
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    await this.set(`c4.zr.tm ${hex2(now.getHours())} ${hex2(now.getMinutes())} ${hex2(now.getSeconds())} ${hex2(dow)}`);
  }
  async sendLocale() {
    await this.set(`c4.zr.loc 00 0f "${LOCALE}"`);
  }
  async clearDisplay() {
    await this.sendText(`0i${hex4(this.nextSeq())} c4.ln.le`);
  }
  async displayMessage(message, icon = DM_DEFAULT_ICON) {
    const text = fitLcd((s) => `0i${SEQ0} c4.ln.dm ${hex2(icon)} "${s}"`, sanitize(message));
    await this.sendText(`0i${hex4(this.nextSeq())} c4.ln.dm ${hex2(icon)} "${text}"`);
  }
  // -- commissioning -------------------------------------------------------------
  async bootstrap() {
    for (let attempt = 0; attempt < 4 && this.alive; attempt++) {
      try {
        await this.ctx.sendIdentity(this, `${this.family}_bootstrap`);
        await this.sleep(400);
        await this.sendTime();
        await this.sleep(400);
        await this.sendLocale();
        await this.sleep(400);
        await this.sendRoomInfo(this.room(), this.source());
        this.rowsPending = false;
        this.log.info(`Control4 ${this.name}: commissioned (identity, clock, locale, room '${this.room()}') [${attempt + 1}/4]`);
        if (attempt === 0) {
          await this.sleep(400);
          for (const ep of [197, 1]) {
            try {
              await this.ctx.bind(this.ieee, ep, C4_CLUSTER);
            } catch (error) {
              this.log.debug(`Control4 ${this.name}: bind ep ${ep} failed: ${error}`);
            }
          }
        }
      } catch (error) {
        this.log.debug(`Control4 ${this.name}: bootstrap send failed [${attempt + 1}/4]: ${error}`);
      }
      await this.sleep(6e3);
    }
  }
  // -- receive -------------------------------------------------------------------
  handleAscii(frame2) {
    const t = frame2.tokens;
    if (frame2.kind === "init" && t[1] === "c4.ln.gi" && t.length >= 5) {
      const listId = parseHex(t[2]);
      const offset = parseHex(t[3]);
      const count2 = parseHex(t[4]);
      if (listId !== void 0 && offset !== void 0 && count2 !== void 0) {
        this.spawn(this.answerGi(listId, offset, count2, frame2.seq));
        return;
      }
    }
    if (frame2.kind === "reply" && t.length >= 4 && t[1] === "000" && t[2] === "c4.zr.bl") {
      this.setBattery(parseHex(t[3]));
    }
    super.handleAscii(frame2);
  }
  setBattery(level) {
    if (level !== void 0 && level >= 0 && level <= 100) this.publish({ battery: level });
  }
  fireKey(hex, gesture) {
    const id = parseHex(hex);
    if (id === void 0) return;
    const name = this.buttons[id];
    if (name === void 0) {
      this.log.warning(`Control4 ${this.name}: unmapped button 0x${hex2(id)}`);
      return;
    }
    const command = REMOTE_COMMANDS[gesture];
    this.emitAction(name, gesture, { action_button_id: id, ...command ? { action_command: command } : {} }, false);
  }
  onAnnounce(ns, data) {
    switch (ns) {
      case "c4.zr.bb":
        this.fireKey(data[0], "press");
        break;
      case "c4.zr.bh":
        this.fireKey(data[0], "hold");
        break;
      case "c4.zr.be":
        this.fireKey(data[0], "release");
        break;
      case "c4.ln.is":
        this.menuSelect(parseHex(data[0]) ?? 0, parseHex(data[1]) ?? 0);
        break;
      case "c4.ln.ise":
        break;
      // release of the matching `is`
      case "c4.ln.cn":
        this.menuCancel(parseHex(data[0]) ?? 0, parseHex(data[1]) ?? 0);
        break;
      case "c4.zr.mot":
        this.emitEvent("motion_wake");
        break;
      case "c4.zr.bl":
        this.setBattery(parseHex(data[0]));
        break;
      default:
        this.log.debug(`Control4 ${this.name}: ${ns} ${data.join(" ")}`);
    }
    const key = (data[0] ?? "").toLowerCase();
    if (ns === "c4.zr.bb" && key in this.pageKeys) this.pageList(this.pageKeys[key]);
    if (ns === "c4.zr.mot" || ns === "c4.zr.bb") this.diagPoll();
    if (ns === "c4.zr.mot") this.wakeRefresh(true);
    else if (ns === "c4.zr.bb" && this.rowsPending) this.wakeRefresh(false);
  }
  wakeRefresh(sendTime) {
    const now = this.ctx.now();
    if (now - this.lastRefresh < WAKE_REFRESH_MIN) return;
    this.lastRefresh = now;
    this.spawn(
      (async () => {
        if (sendTime) {
          try {
            await this.sendTime();
          } catch (error) {
            this.log.debug(`Control4 ${this.name}: wake tm failed: ${error}`);
          }
          await this.sleep(200);
        }
        await this.pushRoomInfo();
      })()
    );
  }
  diagPoll() {
    const now = this.ctx.now();
    if (now - this.lastDiag < DIAG_POLL) return;
    this.lastDiag = now;
    this.spawn(
      this.sendText(`0g${hex4(this.nextSeq())} c4.zr.bl`).catch(() => {
        this.lastDiag = Number.NEGATIVE_INFINITY;
      })
    );
  }
  // -- menus -------------------------------------------------------------------
  /**
   * Never 0x0001: an SR260 draws list 1 as a centred heading (its first item)
   * with no title or count, not as a menu. 2 and up give the normal menu (the
   * Director's own lists start higher).
   */
  nextListId() {
    const next = this.listId + 1;
    this.listId = next > 65535 ? 2 : Math.max(next, 2);
    return this.listId;
  }
  async showList(title, items, selectedIndex, titleIcon = this.titleIcon) {
    if (!items.length) throw new Error("show_list: items must contain at least one entry");
    const sel = Math.max(0, Math.min(items.length - 1, Math.trunc(selectedIndex) || 0));
    const listId = this.nextListId();
    this.menu = { listId, title, items, selectedIndex: sel };
    const head = (seq) => `0i${seq} c4.ln.sl ${hex4(listId)} ${hex4(items.length)} ${hex4(sel)} "${String.fromCharCode(titleIcon & 255)}`;
    const shown = fitLcd((s) => `${head(SEQ0)}${s}"`, sanitize(title));
    const cmd = `${head(hex4(this.nextSeq()))}${shown}"`;
    try {
      await this.sendText(cmd);
    } catch (error) {
      this.menu = void 0;
      if (isDeliveryFailure(error)) {
        this.log.warning(`Control4 ${this.name}: menu undelivered - the remote is probably asleep; press a key and retry`);
        return;
      }
      throw error;
    }
  }
  async closeList() {
    this.menu = void 0;
    try {
      await this.clearDisplay();
    } catch (error) {
      this.log.debug(`Control4 ${this.name}: close_list undelivered: ${error}`);
    }
  }
  pageList(direction) {
    const menu = this.menu;
    if (!menu?.items.length) return;
    const cur = menu.cursor ?? menu.selectedIndex;
    const next = Math.max(0, Math.min(menu.items.length - 1, cur + direction * PAGE_SIZE));
    if (next === cur) return;
    this.spawn(
      (async () => {
        const icons = menu.icons;
        await this.showList(menu.title, menu.items, next);
        if (this.menu) {
          this.menu.cursor = next;
          if (icons) this.menu.icons = icons;
        }
      })()
    );
  }
  menuSelect(listId, idx) {
    const menu = this.menu?.listId === listId ? this.menu : void 0;
    const item = menu && idx >= 0 && idx < menu.items.length ? menu.items[idx] : null;
    this.menu = void 0;
    this.emitEvent("menu_select", { action_list_id: listId, action_selected_index: idx, action_item: item, action_title: menu?.title ?? "" });
    this.log.info(`Control4 ${this.name}: menu_select list=0x${hex4(listId)} idx=${idx} item=${item}`);
    this.spawn(
      (async () => {
        if (item) {
          this.saveSetting("active_source", item);
          this.publish({ active_source: item });
        }
        try {
          await this.sendRoomInfo(this.room(), this.source());
        } catch {
        }
        await this.closeList();
      })()
    );
  }
  menuCancel(listId, idx) {
    const title = this.menu?.listId === listId ? this.menu.title : "";
    this.menu = void 0;
    this.emitEvent("menu_cancel", { action_list_id: listId, action_selected_index: idx, action_title: title });
    this.spawn(this.closeList());
  }
  giSetting(key) {
    const defaults = { gi_icon: 1, gi_max_items: 0, gi_reply_ep: 1 };
    const v = Number(this.setting(key, defaults[key]));
    return Number.isFinite(v) ? v : defaults[key];
  }
  /** Answer a c4.ln.gi page request with as many labels as fit one frame. */
  async answerGi(listId, offset, count2, seq) {
    const menu = this.menu;
    if (!menu || menu.listId !== listId) {
      this.log.debug(`Control4 ${this.name}: gi for list 0x${hex4(listId)} with no matching menu`);
      return;
    }
    const icon = this.giSetting("gi_icon");
    const maxItems = this.giSetting("gi_max_items");
    const replyEp = this.giSetting("gi_reply_ep") || 1;
    const prefix = icon <= 255 ? String.fromCharCode(icon) : "";
    let items = count2 ? menu.items.slice(offset, offset + count2) : menu.items.slice(offset);
    if (maxItems) items = items.slice(0, maxItems);
    const template = this.setting("gi_template") || this.giTemplate;
    const itemTemplate = this.setting("gi_item_template") || GI_ITEM_TEMPLATE;
    const fields = { seq, list: hex4(listId), offset: hex4(offset), count: hex4(count2) };
    const render = (parts2) => {
      const f = { ...fields, n: hex4(parts2.length), items: parts2.join(" ") };
      try {
        return format(template, f).trimEnd();
      } catch {
        this.log.warning(`Control4 ${this.name}: bad gi_template '${template}'`);
        return format(this.giTemplate, f).trimEnd();
      }
    };
    const parts = [];
    for (let i = 0; i < items.length; i++) {
      const label = sanitize(items[i]);
      const glyph = menu.icons?.[offset + i];
      const ic = glyph !== void 0 ? String.fromCharCode(glyph) : prefix;
      let part;
      try {
        part = format(itemTemplate, { icon: ic, label, index: hex4(offset + i) });
      } catch {
        part = format(GI_ITEM_TEMPLATE, { icon: ic, label });
      }
      if (parts.length && render([...parts, part]).length + 2 > GI_MAX_FRAME) break;
      parts.push(part);
    }
    try {
      await this.sendText(render(parts), replyEp);
    } catch (error) {
      this.log.warning(`Control4 ${this.name}: menu labels undelivered: ${error}`);
    }
  }
  // -- control -----------------------------------------------------------------
  async showListFromPayload(data) {
    const raw = data.items;
    const items = Array.isArray(raw) ? raw.map((x) => String(x ?? "")) : String(raw ?? "").split("|");
    await this.showList(String(data.title ?? ""), items, Number(data.selected_index ?? 0));
  }
  async setValue(key, value, meta) {
    const obj = value && typeof value === "object" ? value : {};
    switch (key) {
      case "room_name":
      case "active_source": {
        const text = value === null || value === void 0 ? "" : String(value);
        this.saveSetting(key, text);
        await this.pushRoomInfo();
        return { [key]: key === "room_name" ? this.room() : text };
      }
      case "set_room_info": {
        if (obj.room !== void 0) this.saveSetting("room_name", String(obj.room));
        if (obj.source !== void 0) this.saveSetting("active_source", String(obj.source));
        await this.pushRoomInfo();
        return { room_name: this.room(), active_source: this.source() };
      }
      case "show_list":
        await this.showListFromPayload(obj);
        return void 0;
      case "close_list":
        await this.closeList();
        return void 0;
      case "display_message": {
        const text = String(value ?? "");
        if (!text) await this.clearDisplay();
        else await this.displayMessage(text, Number(this.setting("display_icon", DM_DEFAULT_ICON)) & 255);
        return { display_message: text };
      }
      case "display_icon": {
        const icon = Math.round(toNumber(value, 0, 255));
        this.saveSetting(key, icon);
        return { display_icon: icon };
      }
      case "gi_icon":
      case "gi_max_items":
      case "gi_reply_ep":
        this.saveSetting(key, Math.round(toNumber(value, 0, 65535)));
        return void 0;
      case "gi_template":
      case "gi_item_template":
        this.saveSetting(key, value ? String(value) : void 0);
        return void 0;
      case "c4_send":
      case "send_raw":
        throw new Error("raw Set frames are disabled on remotes (an SR250 once lost its firmware to a bad Set)");
      case "c4_get":
      case "send_get": {
        const cmd = String(value && typeof value === "object" ? value.cmd : value).trim();
        const name = cmd.split(" ")[0].toLowerCase();
        if (!cmd || !GET_ALLOWED.includes(name) && GET_BLOCKED.some((b) => (name.split(".").pop() ?? "").includes(b))) {
          throw new Error(`refused probe Get '${cmd}'`);
        }
        break;
      }
    }
    return super.setValue(key, value, meta);
  }
  initialState() {
    return { room_name: this.room(), active_source: this.source() };
  }
};
var Sr260 = class extends Remote {
  buttons = SR260_BUTTONS;
  pageKeys = { "09": -1, "0a": 1 };
  giTemplate = SR260_GI_TEMPLATE;
  messageTimer;
  /** Titles / items may start with a `[xx]` glyph code from the icon table. */
  async showListFromPayload(data) {
    const [titleIcon, title] = splitGlyph(String(data.title ?? ""));
    const raw = data.items;
    const rawItems = Array.isArray(raw) ? raw.map((x) => String(x ?? "")) : String(raw ?? "").split("|");
    const icons = [];
    const labels = rawItems.map((r) => {
      const [g, label] = splitGlyph(r);
      icons.push(g);
      return label;
    });
    await this.showList(title, labels, Number(data.selected_index ?? 0), titleIcon ?? 129);
    if (this.menu && icons.some((g) => g !== void 0)) this.menu.icons = icons;
  }
  async showMessage(message, icon, seconds) {
    this.cancel(this.messageTimer);
    this.messageTimer = void 0;
    if (!message) {
      await this.clearDisplay();
      return;
    }
    try {
      await this.displayMessage(message, icon === void 0 ? DM_DEFAULT_ICON : icon & 255);
    } catch (error) {
      this.log.warning(`Control4 ${this.name}: message undelivered (${error})`);
      return;
    }
    if (seconds > 0) {
      this.messageTimer = this.after(seconds * 1e3, async () => {
        this.messageTimer = void 0;
        if (this.menu) return;
        await this.clearDisplay().catch(() => void 0);
      });
    }
  }
  /**
   * The rows, then the text colour when one is set: every path that pushes rows (setup,
   * wake, /set) re-applies it. The colour going undelivered doesn't make the rows count as
   * undelivered; the next push sends it again.
   */
  async sendRoomInfo(room, source) {
    await super.sendRoomInfo(room, source);
    const color = this.setting("text_color_byte");
    if (typeof color === "number") await this.trySet(`c4.zr.tc ${hex2(color)}`);
  }
  async setValue(key, value, meta) {
    if (key === "text_color") {
      const byte2 = rgb332(value);
      this.saveSetting("text_color_byte", byte2);
      if (byte2 !== void 0) await this.set(`c4.zr.tc ${hex2(byte2)}`);
      return { text_color: byte2 === void 0 ? "" : rgb332Hex(byte2) };
    }
    if (key === "show_message") {
      const obj = value && typeof value === "object" ? value : { message: value };
      await this.showMessage(String(obj.message ?? ""), obj.icon === void 0 ? void 0 : Number(obj.icon), Number(obj.seconds ?? 0) || 0);
      return void 0;
    }
    return super.setValue(key, value, meta);
  }
};
function rgb332(value) {
  if (value === void 0 || value === null || typeof value === "string" && !value.trim()) return void 0;
  if (typeof value === "number" || typeof value === "string" && /^\s*\d+\s*$/.test(value)) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`text colour byte ${value} is not 0-255`);
    return n;
  }
  const obj = value;
  const rgb2 = typeof value === "object" && !Array.isArray(value) ? [obj.r, obj.g, obj.b] : value;
  if (Array.isArray(rgb2) && rgb2.some((c) => c === void 0 || c === null || !Number.isFinite(Number(c)))) {
    throw new Error(`text colour ${JSON.stringify(value)} needs numeric r, g and b`);
  }
  const [r, g, b] = parseColour(rgb2);
  return r & 224 | (g & 224) >> 3 | b >> 6;
}
function rgb332Hex(byte2) {
  const part = (v, max) => hex2(Math.round(v * 255 / max));
  return `#${part(byte2 >> 5 & 7, 7)}${part(byte2 >> 2 & 7, 7)}${part(byte2 & 3, 3)}`;
}

// src/devices/rosw120.ts
var ROSW_READBACK_DELAY = 1e3;
var Rosw120 = class extends DmxDevice {
  buttons = { 0: "button_1" };
  reading;
  readback;
  onAnnounce(ns, data) {
    if (ns === "c4.dmx.tc") {
      const level = parseHex(data[1]);
      if (level !== void 0) this.publish({ state: level > 0 ? "ON" : "OFF" });
      return;
    }
    super.onAnnounce(ns, data);
  }
  /** A tap may have switched the outlet (its tc says so, but a lost one must not leave the state wrong). */
  syncClick(_id, count2) {
    if (count2 >= 1) this.readSoon();
  }
  /** Read its on/off back once the last command or tap has settled. */
  readSoon() {
    if (this.readback) clearTimeout(this.readback);
    this.readback = this.after(ROSW_READBACK_DELAY, () => {
      this.readback = void 0;
      void this.readState();
    });
  }
  /** genOnOff onOff on EP1, published as its state. One read at a time. */
  readState() {
    this.reading ??= (async () => {
      try {
        const onOff = (await this.zclRead(1, "genOnOff", ["onOff"])).onOff;
        if (this.stopped) return "skipped";
        if (typeof onOff !== "number" && typeof onOff !== "boolean") return "failed";
        this.publish({ state: onOff ? "ON" : "OFF" });
        return "read";
      } catch (error) {
        this.log.debug(`Control4 ${this.name}: on/off read failed: ${error}`);
        return "failed";
      }
    })().finally(() => {
      this.reading = void 0;
    });
    return this.reading;
  }
  stateReader() {
    return () => this.readState();
  }
  async getValue(key) {
    if (key === "state") await this.readState();
  }
  async setValue(key, value, meta) {
    if (key !== "state") return super.setValue(key, value, meta);
    let s = String(value).toUpperCase();
    if (s === "TOGGLE") s = this.isOn() ? "OFF" : "ON";
    const on = s === "ON";
    await this.ctx.link.sendWithRecovery(
      this.ieee,
      () => this.sendFrame({ profile: HA_PROFILE, cluster: CLUSTER_ON_OFF, srcEp: 1, dstEp: 1, data: buildZclCommand(this.nextTsn(), on ? 1 : 0) }),
      "on/off command"
    );
    this.readSoon();
    return { state: on ? "ON" : "OFF" };
  }
};

// src/devices/unsupported.ts
var REPORTED_MODEL_KEY = "reported_model";
var FINGERPRINT_KEY = "fingerprint";
var FRAME_LOG_LIMIT = 500;
var FINGERPRINT_PROPS = [
  "c4.sy.fwv",
  // firmware (Gen2 / Gen3 boards)
  "c4.sy.ri",
  // why it last restarted
  "c4.dmx.bmc 00",
  // the Gen3 board (APD120 / SW120277 / KC120277 / keypad dimmer)
  "c4.dmx.btn 00 01",
  // a Gen3 button wire's behaviour
  "c4.dmx.led 00 01",
  // a Gen3 LED slot's mode
  "c4.dmx.amb 00",
  // an ambient light sensor
  "c4.dm.is",
  // a dimmer's settings (DIM1-Z, APD120)
  "c4.dm.tv 00 00",
  // load 1's live level
  "c4.dm.tv 01 00",
  // load 2's live level (dual outlet, dual-load dimmer)
  "c4.kp.bhp"
  // the KP-generation keypads' hold threshold
];
var FINGERPRINT_GIVE_UP = 2;
var Unsupported = class extends C4Device {
  framesLogged = 0;
  get fingerprintKey() {
    return `${this.ieee}:fingerprint`;
  }
  start(hotLoad = false) {
    super.start(hotLoad);
    this.saveSetting(REPORTED_MODEL_KEY, this.model);
    if (this.setting(FINGERPRINT_KEY) === void 0) this.ctx.link.queueStateRead(this.fingerprintKey, () => this.readFingerprint(), SETTINGS_READ_DELAY);
  }
  stop() {
    this.ctx.link.cancelStateRead(this.fingerprintKey);
    super.stop();
  }
  handleAscii(frame2) {
    if (this.framesLogged < FRAME_LOG_LIMIT) {
      this.framesLogged++;
      this.log.info(`Control4 UNSUPPORTED ${this.name} (${this.model}) <- ${frame2.text}`);
      if (this.framesLogged === FRAME_LOG_LIMIT) this.log.info(`Control4 ${this.name}: ${FRAME_LOG_LIMIT} frames logged; the rest of this run's go to debug`);
    }
    super.handleAscii(frame2);
  }
  /** Once per device: which namespaces it answers, logged and saved. Read-only: it changes nothing on the device. */
  async readFingerprint() {
    if (this.stopped || this.setting(FINGERPRINT_KEY) !== void 0) return "skipped";
    const found = {};
    let unanswered = 0;
    for (const prop of FINGERPRINT_PROPS) {
      const reply = await this.get(prop);
      if (this.stopped) return "skipped";
      if (!reply) {
        found[prop] = "no reply";
        if (++unanswered >= FINGERPRINT_GIVE_UP) break;
        continue;
      }
      unanswered = 0;
      found[prop] = [reply.status, ...reply.values].join(" ").trim();
    }
    this.saveSetting(FINGERPRINT_KEY, found);
    const lines = Object.entries(found).map(([prop, r]) => `${prop} -> ${r}`);
    this.log.info(`Control4 ${this.name} (${this.model}) fingerprint: ${lines.join("; ")}`);
    this.log.info(`Control4 ${this.name} (${this.model}): ${fingerprintHint(found)}`);
    return "read";
  }
  initialState() {
    return { [REPORTED_MODEL_KEY]: this.model };
  }
};
var answered = (found, prefix) => Object.entries(found).some(([prop, r]) => prop.startsWith(prefix) && r.startsWith("000"));
function fingerprintHint(found) {
  if (Object.values(found).every((r) => r === "no reply")) return "it answered no Get: an older model, or out of reach. Its button and check-in frames above are what there is to go on";
  const parts = [];
  if (answered(found, "c4.dmx.")) parts.push("it speaks c4.dmx, the Gen3 board of the APD120 / SW120277 / KC120277");
  if (answered(found, "c4.dm.")) parts.push(`it has a c4.dm load${found["c4.dm.tv 01 00"]?.startsWith("000") ? " (two channels answer)" : ""}`);
  if (answered(found, "c4.kp.")) parts.push("it speaks c4.kp, as the KP3-Z / KP6-Z keypads");
  if (!parts.length) parts.push("it answered, but none of the namespaces asked");
  return `${parts.join("; ")}. Send this log to the project to have the model added`;
}

// src/devices/z2io.ts
var Z2IO_EP = 197;
var TEMP_NO_PROBE = 23315;
var DEFAULT_PULSE_MS = 500;
function z2ioModeName(mode) {
  return Z2IO_MODES[mode]?.name ?? Z2IO_MODES[Z2IO_DEFAULT_MODE].name;
}
function z2ioModeFromName(name) {
  const n = Number(name);
  if (Number.isInteger(n) && Z2IO_MODES[n]) return n;
  for (const [k, v] of Object.entries(Z2IO_MODES)) if (v.name === name) return Number(k);
  return void 0;
}
var Z2io = class extends C4Device {
  pending = /* @__PURE__ */ new Map();
  provisioned = false;
  contacts = [];
  relays = [];
  get mode() {
    const m = Number(this.setting("z2io_mode", Z2IO_DEFAULT_MODE));
    return Z2IO_MODES[m] ? m : Z2IO_DEFAULT_MODE;
  }
  get relayCount() {
    return Z2IO_MODES[this.mode].relays;
  }
  get contactCount() {
    return Z2IO_MODES[this.mode].contacts;
  }
  sendText(text, dstEp = Z2IO_EP, srcEp = Z2IO_EP) {
    return super.sendText(text, dstEp, srcEp);
  }
  /** `0s|0g<seq> <prop> <args>` and wait for the matching `0r` (timeout from when it went out). */
  async request(kind, prop, args = [], timeout = 5e3) {
    const seq = hex4(this.nextSeq());
    let timer;
    let finish = () => void 0;
    const reply = new Promise((resolve) => {
      finish = resolve;
    });
    this.pending.set(seq, (r) => {
      this.cancel(timer);
      this.pending.delete(seq);
      finish(r);
    });
    try {
      await this.sendText([`0${kind}${seq}`, prop, ...args].join(" "));
    } catch (error) {
      this.pending.delete(seq);
      this.log.warning(`Control4 ${this.name}: ${prop} failed: ${error}`);
      return void 0;
    }
    if (this.pending.has(seq)) {
      timer = this.after(timeout, () => {
        this.pending.delete(seq);
        finish(void 0);
      });
    }
    return reply;
  }
  start(hotLoad = false) {
    if (hotLoad) this.provisioned = true;
  }
  stop() {
    super.stop();
    for (const settle of [...this.pending.values()]) settle(void 0);
    this.pending.clear();
  }
  handleAscii(frame2) {
    if (!this.provisioned) {
      this.provisioned = true;
      this.spawn(this.initialize());
    }
    super.handleAscii(frame2);
  }
  onReply(frame2) {
    const t = frame2.tokens;
    const r = { status: t[1], prop: t[2], values: t.slice(3) };
    this.pending.get(frame2.seq)?.(r);
    if (r.status === "000" && r.prop) this.update(r.prop, r.values);
  }
  onAnnounce(ns, data) {
    this.update(ns, data);
  }
  update(prop, values) {
    const v = values[0];
    switch (prop) {
      case "c4.z2x.cts":
        this.updateContacts(parseHex(v));
        return;
      case "c4.z2x.rls":
        this.updateRelays(parseHex(v));
        return;
      case "c4.z2x.tmpi": {
        const raw = parseHex(v);
        if (raw !== void 0) this.publish({ temperature: Math.round((raw * 0.01 - 273.15) * 100) / 100 });
        return;
      }
      case "c4.z2x.tmpe": {
        const raw = parseHex(v);
        if (raw !== void 0 && raw !== TEMP_NO_PROBE) this.publish({ external_temperature: Math.round((raw * 0.01 - 273.15) * 100) / 100 });
        return;
      }
      case "c4.z2x.thumi": {
        const raw = parseHex(v);
        if (raw !== void 0) this.publish({ humidity: Math.round(raw) / 100 });
        return;
      }
      case "c4.sy.fwv":
        if (v) this.publish({ firmware: v });
        return;
    }
  }
  updateContacts(cts) {
    if (cts === void 0) return;
    const changes = [];
    const out = {};
    for (let ch = 0; ch < this.contactCount; ch++) {
      const closed = Boolean(cts & 1 << ch);
      out[`contact_${ch + 1}`] = closed;
      if (this.contacts[ch] !== closed) {
        changes.push({ channel: ch + 1, state: closed ? "closed" : "open", previous: this.contacts[ch] === void 0 ? "unknown" : this.contacts[ch] ? "closed" : "open" });
        this.contacts[ch] = closed;
      }
    }
    this.publish(out);
    if (changes.length) this.emitEvent("contact_state_changed", { action_changes: changes, action_cts_raw: cts });
  }
  updateRelays(rls) {
    if (rls === void 0) return;
    const changes = [];
    const out = {};
    for (let ch = 0; ch < this.relayCount; ch++) {
      const on = Boolean(rls & 1 << ch);
      out[`relay_${ch + 1}`] = on ? "ON" : "OFF";
      if (this.relays[ch] !== on) {
        changes.push({ channel: ch + 1, on });
        this.relays[ch] = on;
      }
    }
    this.publish(out);
    if (changes.length) this.emitEvent("relay_state_changed", { action_changes: changes, action_rls_raw: rls });
  }
  /** Two-pass provisioning as the Director does it, then a state poll. */
  async initialize() {
    const opt = String(this.mode);
    const step = () => this.sleep(50);
    await this.request("s", "c4.z2x.ctd", ["1", "1f4"]);
    await step();
    await this.request("s", "c4.z2x.opt", [opt]);
    await step();
    await this.request("g", "c4.z2x.cts");
    await this.request("g", "c4.z2x.rls");
    for (let ch = 1; ch <= this.relayCount; ch++) await this.request("g", "c4.z2x.rlp", [String(ch)]);
    for (const prop of ["c4.z2x.ana0", "c4.z2x.ana1"]) await this.request("g", prop, [], 2e3);
    for (const prop of ["c4.sy.fwv", "c4.sy.blv", "c4.z2x.ldm", "c4.z2x.zmac", "c4.z2x.zpid", "c4.z2x.zepid", "c4.z2x.znid", "c4.z2x.zchan"]) {
      await this.request("g", prop, [], 3e3);
      await step();
    }
    await this.request("s", "c4.sy.zpc", ["348"]);
    await this.request("s", "c4.z2x.ctd", ["1", "1f4"]);
    await this.request("s", "c4.z2x.opt", [opt]);
    await this.poll();
    this.log.info(`Control4 ${this.name}: IO module provisioned (mode ${z2ioModeName(this.mode)})`);
  }
  async poll() {
    const props = [];
    if (this.contactCount > 0) props.push("c4.z2x.cts");
    if (this.relayCount > 0) props.push("c4.z2x.rls");
    props.push("c4.z2x.tmpi", "c4.z2x.tmpe", "c4.z2x.thumi");
    for (const prop of props) {
      await this.request("g", prop);
      await this.sleep(300);
    }
  }
  relayChannel(key) {
    const ch = Number(/^relay_(\d)/.exec(key)?.[1]);
    if (!(ch >= 1 && ch <= this.relayCount)) throw new Error(`relay ${ch} is not available in IO mode ${z2ioModeName(this.mode)}`);
    return ch;
  }
  async relay(ch, on) {
    const r = await this.request("s", on ? "c4.z2x.rlc" : "c4.z2x.rlo", [String(ch)]);
    return r?.status === "000";
  }
  async setValue(key, value, meta) {
    if (/^relay_[12]$/.test(key)) {
      const ch = this.relayChannel(key);
      let s = String(value).toUpperCase();
      if (s === "TOGGLE") s = this.relays[ch - 1] ? "OFF" : "ON";
      if (!await this.relay(ch, s === "ON")) throw new Error(`relay ${ch} did not acknowledge`);
      return { [key]: s === "ON" ? "ON" : "OFF" };
    }
    if (/^relay_[12]_pulse$/.test(key)) {
      const ch = this.relayChannel(key);
      const custom = value && typeof value === "object" ? value.pulse_ms : void 0;
      const ms = Math.round(toNumber(custom ?? this.setting("pulse_duration", DEFAULT_PULSE_MS), 100, 5e3));
      if (!await this.relay(ch, true)) throw new Error(`relay ${ch} did not energise`);
      await this.sleep(ms);
      if (!await this.relay(ch, false)) {
        this.log.warning(`Control4 ${this.name}: relay ${ch} energised but release failed - it may still be on!`);
        throw new Error(`relay ${ch} did not release`);
      }
      return void 0;
    }
    switch (key) {
      case "pulse_duration": {
        const ms = Math.round(toNumber(value, 100, 5e3));
        this.saveSetting(key, ms);
        return { pulse_duration: ms };
      }
      case "io_mode": {
        const mode = z2ioModeFromName(value);
        if (mode === void 0) throw new Error(`unknown IO mode '${value}'`);
        const r = await this.request("s", "c4.z2x.opt", [String(mode)]);
        this.saveSetting("z2io_mode", mode);
        this.contacts = [];
        this.relays = [];
        this.ctx.exposesChanged(this.ieee);
        this.spawn(this.poll());
        if (r?.status !== "000") this.log.warning(`Control4 ${this.name}: IO mode ${mode} not acknowledged (${r?.status ?? "no reply"})`);
        return { io_mode: z2ioModeName(mode) };
      }
      case "poll":
        await this.poll();
        return void 0;
    }
    void toBool;
    return super.setValue(key, value, meta);
  }
  async getValue(_key) {
    await this.poll();
  }
  initialState() {
    return { io_mode: z2ioModeName(this.mode), pulse_duration: this.setting("pulse_duration", DEFAULT_PULSE_MS) };
  }
};

// src/core/runtime.ts
var LED_DEFAULTS_RETRY = 5e3;
var IDENTITY_RETRIES = [3e3, 1e4];
var IDENTITY_REJOIN_SENDS = 3;
var IDENTITY_REJOIN_GAP = 4e3;
var REJOIN_CHECKS = [12e4, 24e4];
var REJOIN_STUCK_COUNT = 3;
var REJOIN_STUCK_WINDOW = 3.5 * 60 * 6e4;
var REJOIN_REBOOT_DELAY = 3e4;
var REJOIN_REBOOT_JITTER = 3e4;
var isCheckinSource = (source) => source === "read_attributes" || source.startsWith("model_report");
var sleep3 = (ms) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  t.unref?.();
});
var PADDLE_STREAM = /* @__PURE__ */ new Set(["apd120", "kd120", "sw120277", "dim1z", "fs1z"]);
function createDevice(ctx, ieee, model, family) {
  switch (family) {
    case "apd120":
      return new Apd120(ctx, ieee, model, family);
    case "sw120277":
      return new Sw120277(ctx, ieee, model, family);
    case "fan":
      return new Fan(ctx, ieee, model, family);
    case "dim1z":
      return new Dim1z(ctx, ieee, model, family);
    case "fs1z":
      return new Fs1z(ctx, ieee, model, family);
    case "outlet":
      return new Outlet(ctx, ieee, model, family);
    case "outlet_dimmer":
      return new OutletDimmer(ctx, ieee, model, family);
    case "rosw120":
      return new Rosw120(ctx, ieee, model, family);
    case "kp2":
    case "kp3":
    case "kp6":
      return new Keypad(ctx, ieee, model, family);
    case "kc120277":
      return new Kc120277(ctx, ieee, model, family);
    case "kd120":
      return new Kd120(ctx, ieee, model, family);
    case "z2io":
      return new Z2io(ctx, ieee, model, family);
    case "sr250":
      return new Remote(ctx, ieee, model, family);
    case "sr260":
      return new Sr260(ctx, ieee, model, family);
    case "unsupported":
      return new Unsupported(ctx, ieee, model, family);
  }
}
function messageSentOf(error) {
  if (!(error instanceof DeliveryError)) return void 0;
  if (error.reason === "unconfirmed") return false;
  return error.reason === "failed" ? true : void 0;
}
var Runtime = class {
  constructor(host) {
    this.host = host;
    const now = () => host.now ? host.now() : Date.now();
    this.now = now;
    this.link = new Link({
      log: host.log,
      devices: () => [...this.devices.values()],
      mtorr: (radius) => host.transport?.mtorr(radius) ?? Promise.resolve(false),
      now,
      reachabilityChanged: () => host.statusChanged?.(),
      // With no frames coming through (or sends failing), every dimmer looks unreachable.
      rebootsHeld: () => {
        const raised = this.traffic.problems();
        return raised.length ? `the instance reports ${raised.join(", ")}` : void 0;
      }
    });
    this.tx = new TxPump(host.log);
    this.anim = new AnimationEngine(this.tx, host.log);
    this.traffic = new TrafficWatch({
      log: host.log,
      now,
      // A router keepalive pokes once it is quiet: a healthy instance hears from it.
      armed: () => [...this.devices.values()].some((d) => d.isRouter && this.link.canAnswerGet(d)),
      changed: () => host.statusChanged?.()
    });
    this.ctx = {
      log: host.log,
      store: host.store,
      link: this.link,
      fast: this.fast,
      tx: this.tx,
      anim: this.anim,
      send: (ieee, frame2, options) => this.sendRaw(ieee, frame2, options),
      zclRead: (ieee, ep, cluster, attrs) => this.zclRead(ieee, ep, cluster, attrs),
      publish: (ieee, payload) => host.publish(ieee, payload),
      event: (ieee, payload) => host.publishEvent?.(ieee, payload),
      state: (ieee) => host.state(ieee),
      isRouter: (ieee) => host.deviceInfo(ieee)?.type !== "EndDevice",
      friendlyName: (ieee) => host.friendlyName(ieee),
      coordinatorIeee: () => host.coordinatorIeee(),
      bind: (ieee, srcEp, cluster) => host.bind(ieee, srcEp, cluster),
      deviceOption: (ieee, key) => host.deviceOption(ieee, key),
      exposesChanged: (ieee) => host.exposesChanged(ieee),
      sendIdentity: (dev, source) => this.sendIdentity(dev.ieee, source),
      now
    };
  }
  host;
  devices = /* @__PURE__ */ new Map();
  link;
  fast = new FastTaps();
  tx;
  anim;
  traffic;
  ctx;
  started = false;
  /** Devices without a handler yet, for identity replies and keepalive. */
  bare = /* @__PURE__ */ new Map();
  /** Devices whose undelivered check-in reply is being retried. */
  recovering = /* @__PURE__ */ new Set();
  /** Each device's latest re-join: a newer one supersedes the checks of an older one. */
  rejoins = /* @__PURE__ */ new Map();
  /** When each device re-joined, within REJOIN_STUCK_WINDOW and since its last automatic reboot. */
  rejoinTimes = /* @__PURE__ */ new Map();
  now;
  /** TSN for identities sent by network address (a device Zigbee2MQTT doesn't know yet). */
  unknownTsn = 0;
  get log() {
    return this.host.log;
  }
  /**
   * `hotLoad`: Zigbee2MQTT kept running, so the devices it starts with already had
   * their once-per-process start-up work, and skip it. Devices that join later don't.
   */
  start(hotLoad = false) {
    if (this.started) return;
    this.started = true;
    this.host.transport?.start((frame2) => this.onFrame(frame2));
    this.migrateLedDefaults();
    for (const ieee of this.host.c4Devices()) this.ensureDevice(ieee, hotLoad);
    this.link.startKeepalive();
    this.traffic.start();
  }
  stop() {
    this.started = false;
    this.host.transport?.stop();
    this.link.stop();
    this.traffic.stop();
    this.tx.stop();
    this.fast.clear();
    for (const dev of this.devices.values()) dev.stop();
    this.devices.clear();
    this.host.store.flushSync();
  }
  // -- devices --------------------------------------------------------------
  /** The model to use for a device: learned from a check-in, else herdsman's. */
  modelOf(ieee) {
    const stored = this.host.store.model(ieee);
    if (isValidModel(stored)) return stored;
    const zh = this.host.deviceInfo(ieee)?.modelID;
    return isValidModel(zh) ? zh : void 0;
  }
  /** Create (or re-create after a model change) the handler for a device; `hotLoad` as for start(). */
  ensureDevice(ieee, hotLoad = false) {
    const id = ieee.toLowerCase();
    if (!isC4Ieee(id)) return void 0;
    const model = this.modelOf(id);
    const info = modelInfo(model);
    const existing = this.devices.get(id);
    if (!model) return existing;
    const family = info?.family ?? "unsupported";
    if (existing && existing.family === family && (family !== "unsupported" || existing.model === model)) {
      existing.model = model;
      return existing;
    }
    if (existing) {
      existing.stop();
      this.anim.unregister(id);
    }
    const dev = createDevice(this.ctx, id, model, family);
    this.devices.set(id, dev);
    this.bare.delete(id);
    dev.start(hotLoad);
    const initial = dev.initialState();
    if (Object.keys(initial).length) this.host.publish(id, initial);
    this.scheduleLedDefaults(dev);
    if (!hotLoad) this.requestStateRead(id);
    if (info) this.log.info(`Control4: ${this.host.friendlyName(id)} is a ${model} (${family})`);
    else
      this.log.warning(
        `Control4: ${this.host.friendlyName(id)} (${id}) reports model ${model}, which this build doesn't support yet. It stays a generic Control4 device: its check-ins are answered, its frames are logged at info, and c4_get / c4_send reach it`
      );
    return dev;
  }
  /**
   * Devices already paired when LED defaults were introduced keep whatever their LEDs show:
   * mark them once, so only devices paired from now on start with every colour off.
   */
  migrateLedDefaults() {
    const store = this.host.store;
    if (store.meta(LED_DEFAULTS_MIGRATION)) return;
    for (const ieee of /* @__PURE__ */ new Set([...this.host.c4Devices(), ...store.knownDevices()])) {
      if (store.get(ieee, LED_DEFAULTS_KEY) === void 0) store.set(ieee, LED_DEFAULTS_KEY, "existing");
    }
    store.setMeta(LED_DEFAULTS_MIGRATION, true);
  }
  /**
   * A newly paired device with LEDs: write the default colours once, 20-30 s after it
   * appears, and only once its handoff is over: a device that moved brings its own.
   */
  scheduleLedDefaults(dev) {
    if (!dev.ledKeys || this.host.store.get(dev.ieee, LED_DEFAULTS_KEY) !== void 0) return;
    const apply = async () => {
      if (this.host.store.get(dev.ieee, LED_DEFAULTS_KEY) !== void 0) return;
      if (this.host.handoffPending?.(dev.ieee)) {
        dev.after(LED_DEFAULTS_RETRY, apply);
        return;
      }
      const n = await dev.ledKeys?.applyDefaults();
      if (!dev.alive) return;
      this.host.store.set(dev.ieee, LED_DEFAULTS_KEY, LED_DEFAULT_COLOUR);
      if (n) this.log.info(`Control4: ${dev.name} is new; its ${n} LED colours start as ${LED_DEFAULT_COLOUR}`);
    };
    dev.after(2e4 + Math.random() * 1e4, apply);
  }
  /**
   * Queue the device's one-off state read (startup, join, announce), if it has
   * one: a DIM1-Z otherwise has no state until its level next changes.
   */
  requestStateRead(ieee) {
    const dev = this.get(ieee);
    const read = dev?.stateReader();
    if (dev && read) this.link.queueStateRead(dev.ieee, read);
  }
  /**
   * Back after a power cut or a reboot (it announced): its LEDs may have lost what
   * they were sent, and both LED layers skip a colour they think it already shows.
   * Forget that, and repaint its status LEDs 20-30 s later, once the network has
   * settled from everything else rejoining.
   */
  repaintLeds(ieee) {
    const dev = this.get(ieee);
    if (!dev) return;
    dev.ledKeys?.writer.forget();
    const animator = this.anim.get(dev.ieee);
    if (animator) dev.after(2e4 + Math.random() * 1e4, () => animator.refresh());
  }
  /** A device that left may come back reset: provision it, and read its settings, again when it does. */
  forgetProvisioning(ieee) {
    this.host.store.set(ieee, FAN_PROVISIONED_KEY, void 0);
    this.forgetSettingsRead(ieee);
  }
  /** Read the device's own settings again when its handler next starts: it may have been reset. */
  forgetSettingsRead(ieee) {
    this.host.store.set(ieee, SETTINGS_READ_KEY, void 0);
  }
  removeDevice(ieee) {
    const id = ieee.toLowerCase();
    this.devices.get(id)?.stop();
    this.devices.delete(id);
    this.anim.unregister(id);
    this.bare.delete(id);
    this.link.cancelStateRead(id);
  }
  get(ieee) {
    return this.devices.get(ieee.toLowerCase());
  }
  /** A fresh handler for the device, reading its saved settings anew (after a handoff brought them). */
  rebuild(ieee) {
    this.removeDevice(ieee);
    return this.ensureDevice(ieee);
  }
  /** Manually set a device's model (the ZHA c4_quirk_data.json seed). */
  seedModel(ieee, rawModel) {
    const model = canonicalModel(rawModel);
    if (!modelInfo(model)) throw new Error(`unknown Control4 model '${rawModel}'`);
    this.host.store.setModel(ieee, model);
    this.host.setModel(ieee.toLowerCase(), model);
    this.ensureDevice(ieee);
    return model;
  }
  // -- transmit ---------------------------------------------------------------
  async sendRaw(ieee, frame2, options) {
    const transport = this.host.transport;
    if (!transport) throw new Error("Control4: no supported coordinator (an Ember / EFR32 adapter is required)");
    const info = this.host.deviceInfo(ieee);
    if (!info) throw new Error(`Control4: unknown device ${ieee}`);
    try {
      await transport.send(info.nwk, frame2, options);
      this.link.noteTx(ieee, true);
      this.traffic.sent(options?.ack === false ? void 0 : true);
    } catch (error) {
      this.link.noteTx(ieee, false);
      this.traffic.sent(messageSentOf(error));
      throw error;
    }
  }
  async zclRead(ieee, ep, cluster, attrs) {
    if (!this.host.zclRead) throw new Error("Control4: this host cannot read ZCL attributes");
    try {
      const values = await this.host.zclRead(ieee, ep, cluster, attrs);
      this.link.noteTx(ieee, true);
      return values;
    } catch (error) {
      this.link.noteTx(ieee, false);
      throw error;
    }
  }
  linkDevice(ieee) {
    const dev = this.devices.get(ieee);
    if (dev) {
      return Object.assign(/* @__PURE__ */ Object.create(null), {
        ieee,
        tsn: dev.nextTsn(),
        get model() {
          return dev.model;
        },
        get isRouter() {
          return dev.isRouter;
        },
        nextSeq: () => dev.nextSeq(),
        sendText: (t) => dev.sendText(t)
      });
    }
    let bare = this.bare.get(ieee);
    if (!bare) {
      let seq = 64;
      bare = {
        ieee,
        tsn: 0,
        model: this.modelOf(ieee) ?? "",
        isRouter: this.host.deviceInfo(ieee)?.type !== "EndDevice",
        nextSeq: () => {
          const s = seq;
          seq = seq + 1 & 65535;
          return s;
        },
        sendText: async () => void 0
      };
      this.bare.set(ieee, bare);
    }
    bare.tsn = bare.tsn + 1 & 255;
    return bare;
  }
  /**
   * The controller identity (coordinator IEEE in attrs 8/9/A on EP2). Sent as
   * Report Attributes on every model check-in - never throttle it: a device
   * whose check-in goes unanswered treats the controller as lost and rejoins.
   * A check-in reply that isn't delivered is retried (retryIdentity).
   */
  async sendIdentity(ieee, source, readResponseTsn, urgent = true) {
    const sent = await this.transmitIdentity(ieee, source, readResponseTsn, urgent);
    if (!(sent instanceof Error)) return;
    const checkin = isCheckinSource(source);
    this.log.info(
      `Control4: ${this.host.friendlyName(ieee)}'s controller identity (${source}) was not delivered (${sent.message})${checkin ? " - a Control4 device whose check-in goes unanswered treats its controller as lost; refreshing routes and trying again" : ""}`
    );
    if (checkin) void this.retryIdentity(ieee, source);
  }
  /** The coordinator's IEEE, once herdsman knows it. */
  coordinator(source) {
    const coordinator = this.host.coordinatorIeee();
    if (coordinator && !/^0x(f{16})$/i.test(coordinator)) return coordinator;
    this.log.debug(`Control4 identity (${source}): coordinator IEEE not known yet - skipped`);
    return void 0;
  }
  /** One identity frame: true when delivered, the error when not delivered, false when not sent for another reason. */
  async transmitIdentity(ieee, source, readResponseTsn, urgent = true) {
    const coordinator = this.coordinator(source);
    if (!coordinator) return false;
    const tsn = readResponseTsn ?? this.linkDevice(ieee).tsn;
    const data = buildIdentityFrame(coordinator, tsn, readResponseTsn !== void 0);
    try {
      await this.link.transmit(ieee, () => this.sendRaw(ieee, { profile: PROFILE_NETWORK, cluster: C4_CLUSTER, srcEp: 2, dstEp: 2, data }), urgent);
      this.log.debug(`Control4 identity (${source}) sent to ${ieee}`);
      return true;
    } catch (error) {
      if (isDeliveryFailure(error)) return error;
      this.log.debug(`Control4 identity (${source}) to ${ieee} failed: ${error}`);
      return false;
    }
  }
  /**
   * A check-in reply that wasn't delivered: its route is broken. Refresh routes, ask the
   * device for its address (its direct reply gives the coordinator a fresh route), and send
   * the identity again within seconds, before the device counts its controller as lost.
   */
  async retryIdentity(ieee, source) {
    if (this.recovering.has(ieee)) return;
    this.recovering.add(ieee);
    const name = () => this.host.friendlyName(ieee);
    try {
      this.link.requestRouteRefresh(`controller identity to ${ieee} not delivered`);
      await Promise.resolve(this.host.rediscover?.(ieee)).catch((error) => this.log.debug(`Control4: rediscovering ${ieee} failed: ${error}`));
      for (let i = 0; i < IDENTITY_RETRIES.length; i++) {
        await sleep3(IDENTITY_RETRIES[i]);
        if (!this.started || !this.host.deviceInfo(ieee)) return;
        const sent = await this.transmitIdentity(ieee, `${source}_retry_${i + 1}`);
        if (sent === true) {
          this.log.info(`Control4: ${name()}'s controller identity was delivered on retry ${i + 1}`);
          return;
        }
        if (sent === false) return;
      }
      this.log.info(`Control4: ${name()}'s controller identity is still not delivered after ${IDENTITY_RETRIES.length} retries - it may count its controller as lost and re-join`);
    } finally {
      this.recovering.delete(ieee);
    }
  }
  /**
   * A check-in, or a poll for its controller, from a network address Zigbee2MQTT doesn't
   * know yet: a device that re-joined under a new address. Answer it now, by that address
   * (the identity is the same for every device), so it doesn't count its controller as lost
   * while the address is looked up.
   */
  answerUnknown(frame2) {
    if (frame2.profile !== PROFILE_NETWORK) return;
    const hdr = parseZclHeader(frame2.data);
    if (!hdr) return;
    let readResponseTsn;
    if (hdr.commandId === 0) {
      readResponseTsn = hdr.tsn;
    } else if (hdr.commandId === 10) {
      const model = parseReportAttributes(frame2.data.subarray(hdr.offset))?.get(ATTR_MODEL);
      if (typeof model !== "string" || !isValidModel(canonicalModel(modelFromCheckin(model)))) return;
    } else {
      return;
    }
    void this.sendIdentityTo(frame2.nwk, readResponseTsn);
  }
  async sendIdentityTo(nwk, readResponseTsn) {
    const transport = this.host.transport;
    const coordinator = this.coordinator(`check-in from ${nwk}`);
    if (!transport || !coordinator) return;
    this.unknownTsn = this.unknownTsn + 1 & 255;
    const data = buildIdentityFrame(coordinator, readResponseTsn ?? this.unknownTsn, readResponseTsn !== void 0);
    try {
      await this.link.transmit(`nwk:${nwk}`, () => transport.send(nwk, { profile: PROFILE_NETWORK, cluster: C4_CLUSTER, srcEp: 2, dstEp: 2, data }), true);
      this.traffic.sent(true);
      this.log.info(`Control4: answered a check-in from network address ${nwk}, which Zigbee2MQTT does not know yet, with the controller identity`);
    } catch (error) {
      this.traffic.sent(messageSentOf(error));
      this.log.info(`Control4: the controller identity to network address ${nwk} (not known to Zigbee2MQTT yet) was not delivered: ${error.message}`);
    }
  }
  /**
   * A device announced itself: it re-joined or powered up, often because it counted its
   * controller as lost. Tell it who its controller is now, IDENTITY_REJOIN_SENDS times, and
   * check that a Get-capable router answers again: one that doesn't is listed unreachable
   * after REJOIN_CHECKS, not after three missed keepalives (about 40 minutes).
   */
  rejoined(ieee) {
    const dev = this.get(ieee);
    if (!dev) return;
    const token = (this.rejoins.get(dev.ieee) ?? 0) + 1;
    this.rejoins.set(dev.ieee, token);
    const current = () => dev.alive && this.rejoins.get(dev.ieee) === token;
    dev.after(2e3 + Math.random() * 5e3, async () => {
      for (let i = 0; i < IDENTITY_REJOIN_SENDS; i++) {
        if (i) await dev.sleep(IDENTITY_REJOIN_GAP);
        if (!current()) return;
        await this.sendIdentity(dev.ieee, `rejoin_${i + 1}`, void 0, false);
      }
    });
    this.watchStuckRejoins(dev, current);
    if (!dev.isRouter || !this.link.canAnswerGet(dev)) return;
    const check = (n) => dev.after(REJOIN_CHECKS[n] - (n ? REJOIN_CHECKS[n - 1] : 0), async () => {
      if (!current() || await this.link.get(dev, PING_PROPERTY) !== void 0) return;
      if (!current()) return;
      if (n + 1 < REJOIN_CHECKS.length) check(n + 1);
      else this.link.markUnreachable(dev, `re-joined and has answered none of the ${REJOIN_CHECKS.length} checks since`);
    });
    check(0);
  }
  /**
   * Count the device's re-joins: at the REJOIN_STUCK_COUNT-th within REJOIN_STUCK_WINDOW
   * since its last reboot (by the link or its Reboot button), ask the link to reboot it;
   * the link decides whether the device can and may be. A reboot it held back leaves the
   * re-joins counted.
   */
  watchStuckRejoins(dev, current) {
    const now = this.now();
    const rebooted = this.link.lastRebootAt(dev.ieee) ?? Number.NEGATIVE_INFINITY;
    const times = [...this.rejoinTimes.get(dev.ieee) ?? [], now].filter((t) => now - t <= REJOIN_STUCK_WINDOW && t > rebooted);
    this.rejoinTimes.set(dev.ieee, times);
    if (times.length < REJOIN_STUCK_COUNT) return;
    const min = Math.round((now - times[0]) / 6e4);
    const span = min < 90 ? `${min} min` : `about ${Math.round(min / 60)} h`;
    dev.after(REJOIN_REBOOT_DELAY + Math.random() * REJOIN_REBOOT_JITTER, () => {
      if (!current()) return;
      if (this.link.autoReboot(dev, `it has re-joined ${times.length} times in ${span} (stuck re-joining)`)) this.rejoinTimes.delete(dev.ieee);
    });
  }
  // -- receive ----------------------------------------------------------------
  onFrame(frame2) {
    this.traffic.frame();
    const ieee = this.host.ieeeByNwk(frame2.nwk)?.toLowerCase();
    if (!ieee) {
      this.answerUnknown(frame2);
      return false;
    }
    if (!isC4Ieee(ieee)) return false;
    if (frame2.unicast || !this.ctx.isRouter(ieee)) this.host.noteSeen(ieee, frame2.lqi, frame2.rssi);
    this.link.noteRx(ieee, frame2.unicast);
    try {
      if (frame2.profile === PROFILE_BUTTON) this.onAscii(ieee, frame2);
      else if (frame2.profile === PROFILE_NETWORK) this.onNetwork(ieee, frame2);
      else if (frame2.profile === PROFILE_OUTLET) this.onOutlet(ieee, frame2);
    } catch (error) {
      this.log.warning(`Control4: frame from ${ieee} failed: ${error.stack ?? error}`);
    }
    return true;
  }
  onAscii(ieee, frame2) {
    const parsed = parseFrame(frame2.data);
    this.log.debug(`Control4 ${this.host.friendlyName(ieee)} <- ${parsed.text}`);
    this.link.resolveReply(ieee, parsed);
    const dev = this.devices.get(ieee) ?? this.ensureDevice(ieee);
    dev?.handleAscii(parsed);
  }
  onNetwork(ieee, frame2) {
    const hdr = parseZclHeader(frame2.data);
    if (!hdr) return;
    const payload = frame2.data.subarray(hdr.offset);
    if (hdr.commandId === 0) {
      void this.sendIdentity(ieee, "read_attributes", hdr.tsn);
      return;
    }
    let attrs;
    if (hdr.commandId === 10) attrs = parseReportAttributes(payload);
    else if (hdr.commandId === 1) attrs = parseReadAttributesResponse(payload);
    if (!attrs) return;
    this.applyAttributes(ieee, attrs, hdr.commandId === 10, "network");
  }
  onOutlet(ieee, frame2) {
    const hdr = parseZclHeader(frame2.data);
    if (!hdr) return;
    const payload = frame2.data.subarray(hdr.offset);
    let attrs;
    if (hdr.commandId === 10) attrs = parseReportAttributes(payload);
    else if (hdr.commandId === 1) attrs = parseReadAttributesResponse(payload);
    if (!attrs) return;
    this.applyAttributes(ieee, attrs, false, "outlet");
    this.devices.get(ieee)?.onOutletAttributes(attrs);
  }
  applyAttributes(ieee, attrs, isReport, source) {
    const modelRaw = attrs.get(ATTR_MODEL);
    if (typeof modelRaw === "string") {
      const model = canonicalModel(modelFromCheckin(modelRaw));
      if (isValidModel(model)) {
        this.learnModel(ieee, model);
        if (isReport && source === "network") void this.sendIdentity(ieee, `model_report_${model}`);
      }
    }
    const fw = attrs.get(ATTR_FIRMWARE);
    if (typeof fw === "string" && fw.trim()) this.host.setFirmware(ieee, fw.trim());
    const level = attrs.get(ATTR_LEVEL);
    if (source === "network" && typeof level === "number") {
      const dev = this.devices.get(ieee);
      if (dev && !PADDLE_STREAM.has(dev.family)) dev.onNetworkLevel(level);
    }
  }
  learnModel(ieee, model) {
    const known = this.host.store.model(ieee);
    if (known !== model) {
      this.host.store.setModel(ieee, model);
      this.log.info(`Control4: learned model ${model} for ${this.host.friendlyName(ieee)}`);
    }
    const record2 = definitionModel(model);
    if (this.host.deviceInfo(ieee)?.modelID !== record2) this.host.setModel(ieee, record2);
    const dev = this.devices.get(ieee);
    if (!dev || dev.model !== model) this.ensureDevice(ieee);
  }
  // -- converter API ---------------------------------------------------------
  async set(ieee, key, value, meta) {
    const dev = this.get(ieee) ?? this.ensureDevice(ieee);
    if (!dev) throw new Error(`Control4: ${ieee} has no known model yet - wait for its check-in or seed it (bridge/request/control4/set_model)`);
    try {
      return await dev.setValue(key, value, meta);
    } catch (error) {
      if (error instanceof UnsupportedKey) throw new Error(error.message);
      throw error;
    }
  }
  async getValue(ieee, key) {
    await this.get(ieee)?.getValue(key);
  }
  /** Z2M availability ping: true/false, or undefined when this device cannot be pinged. */
  async honestPing(ieee) {
    const dev = this.get(ieee);
    if (!dev) return void 0;
    const answersGet = this.link.canAnswerGet(dev);
    const alive = await this.link.honestPing(dev);
    if (alive && !answersGet) this.host.noteSeen(dev.ieee);
    return alive;
  }
  /** The IO mode a Z2IO uses (its exposes depend on it). */
  z2ioMode(ieee) {
    const dev = this.get(ieee);
    return dev instanceof Z2io ? dev.mode : void 0;
  }
  /** A KC120277's fitted buttons (if known) and numbering (its exposes depend on them). */
  kcLayout(ieee) {
    const dev = this.get(ieee);
    return dev instanceof Kc120277 ? dev.layout() : void 0;
  }
};

// src/core/store.ts
import fs from "node:fs";
import path from "node:path";
var object = (v, fallback) => typeof v === "object" && v && !Array.isArray(v) ? v : fallback;
var Store = class {
  constructor(file, log, debounceMs = 300) {
    this.file = file;
    this.log = log;
    this.debounceMs = debounceMs;
    this.load();
  }
  file;
  log;
  debounceMs;
  data = { version: 1, models: {}, devices: {}, handoff: { had: {}, profiles: {} } };
  timer;
  lastWritten = "";
  load() {
    if (!this.file) return;
    let text;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch {
      return;
    }
    try {
      const parsed = JSON.parse(text);
      const handoff = object(parsed.handoff, {});
      this.data = {
        version: 1,
        models: typeof parsed.models === "object" && parsed.models ? parsed.models : {},
        devices: typeof parsed.devices === "object" && parsed.devices ? parsed.devices : {},
        meta: typeof parsed.meta === "object" && parsed.meta ? parsed.meta : {},
        handoff: { had: object(handoff.had, {}), profiles: object(handoff.profiles, {}) }
      };
      this.lastWritten = this.serialize();
    } catch (error) {
      this.log.warning(`Control4 store ${this.file} unreadable (${error}); kept as .corrupt, starting empty`);
      try {
        fs.renameSync(this.file, `${this.file}.corrupt`);
      } catch {
      }
    }
  }
  serialize() {
    return JSON.stringify(this.data, null, 1);
  }
  schedule() {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = void 0;
      this.flushSync();
    }, this.debounceMs);
    this.timer.unref?.();
  }
  /** Write now if anything changed (also called on shutdown). */
  flushSync() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
    if (!this.file) return;
    const text = this.serialize();
    if (text === this.lastWritten) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const fd = fs.openSync(tmp, "w");
      try {
        fs.writeSync(fd, text);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, this.file);
      this.lastWritten = text;
    } catch (error) {
      this.log.warning(`Control4 store: write failed (${error})`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
      }
    }
  }
  model(ieee) {
    return this.data.models[ieee.toLowerCase()];
  }
  setModel(ieee, model) {
    const key = ieee.toLowerCase();
    if (this.data.models[key] === model) return;
    this.data.models[key] = model;
    this.schedule();
  }
  get(ieee, key) {
    return this.data.devices[ieee.toLowerCase()]?.[key];
  }
  set(ieee, key, value) {
    const id = ieee.toLowerCase();
    const entry = this.data.devices[id] ?? {};
    if (value === void 0) {
      if (!(key in entry)) return;
      delete entry[key];
    } else {
      if (JSON.stringify(entry[key]) === JSON.stringify(value)) return;
      entry[key] = value;
    }
    this.data.devices[id] = entry;
    this.schedule();
  }
  all(ieee) {
    return { ...this.data.devices[ieee.toLowerCase()] ?? {} };
  }
  /** Every device the store has seen (a model or any setting). */
  knownDevices() {
    return [.../* @__PURE__ */ new Set([...Object.keys(this.data.models), ...Object.keys(this.data.devices)])];
  }
  meta(key) {
    return this.data.meta?.[key];
  }
  setMeta(key, value) {
    this.data.meta = { ...this.data.meta ?? {}, [key]: value };
    this.schedule();
  }
  // -- handoff (ADR 0004) -----------------------------------------------------
  get handoff() {
    this.data.handoff ??= { had: {}, profiles: {} };
    return this.data.handoff;
  }
  /** When this instance last had the device in its own Zigbee2MQTT (ms); undefined if it never did. */
  had(ieee) {
    return this.handoff.had[ieee.toLowerCase()];
  }
  setHad(ieee, at) {
    const key = ieee.toLowerCase();
    if (this.handoff.had[key] === at) return;
    this.handoff.had[key] = at;
    this.schedule();
  }
  /** This instance's copy of the device's name and device options, kept for a handoff after its removal. */
  profile(ieee) {
    return this.handoff.profiles[ieee.toLowerCase()];
  }
  setProfile(ieee, profile) {
    const key = ieee.toLowerCase();
    if (JSON.stringify(this.handoff.profiles[key]) === JSON.stringify(profile)) return;
    this.handoff.profiles[key] = profile;
    this.schedule();
  }
  /** Replace the device's learned model and saved settings wholesale (a handoff's merge). */
  replace(ieee, model, settings) {
    const key = ieee.toLowerCase();
    if (model === void 0) delete this.data.models[key];
    else this.data.models[key] = model;
    if (Object.keys(settings).length) this.data.devices[key] = { ...settings };
    else delete this.data.devices[key];
    this.schedule();
  }
  /** Drop everything this instance keeps about the device: it has a new home. */
  forget(ieee) {
    const key = ieee.toLowerCase();
    delete this.data.models[key];
    delete this.data.devices[key];
    delete this.handoff.had[key];
    delete this.handoff.profiles[key];
    this.schedule();
  }
};

// src/z2m/global.ts
var RUNTIME_KEY = "__control4_z2m_runtime__";
var CONVERTER_KEY = "__control4_z2m_converter__";
var HOT_LOAD_KEY = "__control4_z2m_hot_load__";
var RUNTIME_API = 2;

// src/z2m/status.ts
var STATUS_INTERVAL = 6e4;
var STATUS_EXPIRE_AFTER = 180;
function problemsOf(s) {
  const out = [];
  if (!s.radio) out.push("no_radio");
  if (!s.interviewHook) out.push("interview_hook");
  if (!s.pingHook) out.push("ping_hook");
  if (s.converterApi === void 0) out.push("converter_missing");
  else if (s.converterApi !== s.runtimeApi) out.push("converter_api");
  out.push(...s.traffic ?? []);
  if (s.unreachable) out.push("devices_unreachable");
  return out;
}
var ENTITIES = [
  {
    component: "binary_sensor",
    key: "problem",
    name: "Control4 problem",
    config: {
      device_class: "problem",
      value_template: "{{ 'ON' if value_json.problems | length > 0 else 'OFF' }}",
      json_attributes_template: "{{ {'problems': value_json.problems} | tojson }}"
    }
  },
  { component: "sensor", key: "build", name: "Control4 build", config: { value_template: "{{ value_json.build or 'unknown' }}", icon: "mdi:source-commit" } },
  { component: "sensor", key: "contract", name: "Control4 contract", config: { value_template: "{{ value_json.contract }}", icon: "mdi:handshake-outline" } },
  { component: "sensor", key: "sent", name: "Control4 messages sent", config: { value_template: "{{ value_json.totals.sent }}", state_class: "total_increasing", icon: "mdi:upload" } },
  { component: "sensor", key: "failed", name: "Control4 failed sends", config: { value_template: "{{ value_json.totals.failed }}", state_class: "total_increasing", icon: "mdi:upload-off" } },
  { component: "sensor", key: "route_refreshes", name: "Control4 route refreshes", config: { value_template: "{{ value_json.totals.route_refreshes }}", state_class: "total_increasing", icon: "mdi:routes" } },
  { component: "sensor", key: "led_queue", name: "Control4 LED queue", config: { value_template: "{{ value_json.totals.led_queue }}", state_class: "measurement", icon: "mdi:tray-full" } }
];
function discoveryConfigs(o) {
  return ENTITIES.map((e) => [
    `${e.component}/control4_${o.coordinatorIeee}/${e.key}/config`,
    {
      name: e.name,
      unique_id: `control4_z2m_${o.coordinatorIeee}_${e.key}`,
      state_topic: o.statusTopic,
      ...e.config,
      entity_category: "diagnostic",
      expire_after: STATUS_EXPIRE_AFTER,
      availability: [
        { topic: o.statusTopic, value_template: "{{ 'online' }}" },
        { topic: `${o.base}/bridge/state`, value_template: "{{ value_json.state }}" }
      ],
      availability_mode: "all",
      // Only the identifier: Zigbee2MQTT's own discovery names and describes its bridge device.
      device: { identifiers: [`zigbee2mqtt_bridge_${o.coordinatorIeee}`] },
      origin: { name: "control4-z2m", ...o.build ? { sw: o.build } : {} }
    }
  ]);
}

// src/z2m/extension.ts
var EXTENSION_FILE = fileHash(import.meta.url);
var OUTLET_SECOND_EP = 11;
var ZCL_READ_TIMEOUT = 5e3;
var EVICT_TIMEOUT = 15e3;
var EVICT_SETTLE = 1e3;
var SHARED_TOPIC = "control4";
var GESTURE_SUFFIXES = Object.keys(GESTURES).sort((a, b) => b.length - a.length);
function commandOf(action, family) {
  const g = GESTURE_SUFFIXES.find((s) => action.endsWith(`_${s}`));
  if (!g) return action;
  return isRemote(family) && REMOTE_COMMANDS[g] || GESTURES[g];
}
function isRemote(family) {
  return family === "sr250" || family === "sr260";
}
function eventTypeOf(command, family) {
  return isRemote(family) ? remoteEventType(command) : command;
}
function eventEntityConfig(ieee, actions, family) {
  return {
    name: "Control4 events",
    unique_id: `${ieee}_control4_event`,
    state_topic: `${SHARED_TOPIC}/${ieee}/event`,
    event_types: [...new Set(actions.map((a) => eventTypeOf(commandOf(a, family), family)))],
    device_class: "button",
    icon: "mdi:gesture-double-tap",
    device: { identifiers: [`zigbee2mqtt_${ieee}`] },
    origin: { name: "control4-z2m" }
  };
}
function dataDir() {
  if (process.env.ZIGBEE2MQTT_DATA) return process.env.ZIGBEE2MQTT_DATA;
  try {
    return path2.resolve(path2.dirname(fileURLToPath2(import.meta.url)), "..");
  } catch {
    return path2.resolve(process.cwd(), "data");
  }
}
function powerSourceOf(zh) {
  const family = modelInfo(zh.modelID)?.family;
  return family === "sr250" || family === "sr260" || zh.type === "EndDevice" ? "Battery" : "Mains (single phase)";
}
function knownModel(learned, own) {
  if (isValidModel(learned)) return definitionModel(learned);
  return isValidModel(own) ? own : GENERIC_MODEL;
}
function stampModel(zh, model) {
  let changed = false;
  const put = (key, value) => {
    if (zh[key] === value) return;
    zh[key] = value;
    changed = true;
  };
  put("modelID", model);
  put("manufacturerName", MANUFACTURER);
  put("powerSource", powerSourceOf(zh));
  return changed;
}
function addOutletEndpoints(zh) {
  const family = modelInfo(zh.modelID)?.family;
  if (family !== "outlet" && family !== "outlet_dimmer") return;
  if (!zh.getEndpoint(1)) zh.createEndpoint(1);
  if (!zh.getEndpoint(OUTLET_SECOND_EP)) zh.createEndpoint(OUTLET_SECOND_EP);
}
var Control4Extension = class {
  constructor(zigbee, mqtt, state, publishEntityState, eventBus, _enableDisableExtension, _restartCallback, _addExtension, settings, logger) {
    this.zigbee = zigbee;
    this.mqtt = mqtt;
    this.state = state;
    this.publishEntityState = publishEntityState;
    this.eventBus = eventBus;
    this.settings = settings;
    this.logger = logger;
  }
  zigbee;
  mqtt;
  state;
  publishEntityState;
  eventBus;
  settings;
  logger;
  log;
  runtime;
  store;
  handoff;
  /** Devices being evicted, until Zigbee2MQTT reports their removal. */
  evictions = /* @__PURE__ */ new Map();
  controller;
  restore = [];
  /** The event entity config last published per device ("" = cleared). */
  eventEntities = /* @__PURE__ */ new Map();
  /** What the status reports as installed: the Ember receive hook, and the herdsman Device hooks. */
  radio = false;
  hooks = { interview: false, ping: false };
  statusTimer;
  /** Each Control4 device's last known network address: an announce or an address change alone doesn't say what it was. */
  addresses = /* @__PURE__ */ new Map();
  /** Network addresses a Control4 frame came from that Zigbee2MQTT didn't know (logged once each). */
  unknownSenders = /* @__PURE__ */ new Set();
  async start() {
    this.log = wrapZ2mLogger(this.logger);
    this.controller = this.zigbee.zhController;
    const adapter = this.controller?.adapter;
    let transport;
    if (EmberTransport.supports(adapter)) {
      transport = new EmberTransport(adapter, this.log);
    } else {
      this.log.error(
        "Control4: this coordinator is not driven by the 'ember' adapter. Control4 devices need an Ember (Silicon Labs EFR32) coordinator with `adapter: ember` - the frames on profiles 0xC25C/D/E cannot be received otherwise."
      );
    }
    this.radio = transport !== void 0;
    const file = path2.join(dataDir(), "control4", "control4.json");
    this.store = new Store(file, this.log);
    const store = this.store;
    const host = this.makeHost(transport, store);
    const runtime = new Runtime(host);
    this.runtime = runtime;
    globalThis[RUNTIME_KEY] = runtime;
    const left = globalThis[HOT_LOAD_KEY];
    const hotLoad = left === true || left instanceof WeakRef && this.controller !== void 0 && left.deref() === this.controller;
    this.patchHerdsman();
    for (const zh of this.c4ZhDevices()) {
      this.applyKnownModel(zh);
      this.addresses.set(String(zh.ieeeAddr).toLowerCase(), zh.networkAddress);
    }
    runtime.start(hotLoad);
    for (const zh of this.c4ZhDevices()) this.publishEventEntity(zh.ieeeAddr);
    const handoff = new Handoff(this.makeHandoffHost(store, runtime));
    this.handoff = handoff;
    handoff.seed(this.c4ZhDevices().map((zh) => String(zh.ieeeAddr).toLowerCase()));
    this.eventBus.onDeviceInterview(this, (data) => {
      const zh = data.device?.zh;
      if (!zh || !isC4Ieee(zh.ieeeAddr) || data.status !== "successful") return;
      this.noteAddress(zh);
      this.applyKnownModel(zh);
      runtime.ensureDevice(zh.ieeeAddr);
      runtime.requestStateRead(zh.ieeeAddr);
      this.publishEventEntity(zh.ieeeAddr);
      handoff.joined(zh.ieeeAddr);
    });
    this.eventBus.onDeviceAnnounce(this, (data) => {
      const zh = data.device?.zh;
      if (!zh || !isC4Ieee(zh.ieeeAddr)) return;
      this.noteAddress(zh);
      this.log.info(`Control4: ${this.nameOf(zh.ieeeAddr)} announced itself at network address ${zh.networkAddress}: it re-joined or powered up`);
      runtime.rejoined(zh.ieeeAddr);
      runtime.requestStateRead(zh.ieeeAddr);
      runtime.repaintLeds(zh.ieeeAddr);
      this.publishEventEntity(zh.ieeeAddr);
    });
    this.eventBus.onDeviceNetworkAddressChanged?.(this, (data) => {
      const zh = data.device?.zh;
      if (zh && isC4Ieee(zh.ieeeAddr)) this.noteAddress(zh);
    });
    this.eventBus.onDeviceLeave(this, (data) => {
      if (!isC4Ieee(data.ieeeAddr)) return;
      runtime.removeDevice(data.ieeeAddr);
      runtime.forgetProvisioning(data.ieeeAddr);
      this.clearEventEntity(data.ieeeAddr);
      handoff.left(String(data.ieeeAddr).toLowerCase());
    });
    this.eventBus.onExposesChanged?.(this, (data) => {
      const ieee = data.device?.zh?.ieeeAddr;
      if (isC4Ieee(ieee)) this.publishEventEntity(ieee);
    });
    this.eventBus.onEntityRemoved?.(this, (data) => {
      const ieee = data.entity?.zh?.ieeeAddr;
      if (!isC4Ieee(ieee)) return;
      const id = String(ieee).toLowerCase();
      this.clearEventEntity(id);
      runtime.removeDevice(id);
      handoff.left(id);
      this.evictions.get(id)?.();
    });
    const keepProfile = (data) => {
      const ieee = data.entity?.zh?.ieeeAddr;
      if (isC4Ieee(ieee)) handoff.keepProfile(String(ieee).toLowerCase());
    };
    this.eventBus.onEntityRenamed?.(this, keepProfile);
    this.eventBus.onEntityOptionsChanged?.(this, keepProfile);
    this.eventBus.onMQTTMessage(this, (data) => void this.onMqtt(data));
    void Promise.resolve(this.mqtt.subscribe?.(`${SHARED_TOPIC}/#`)).catch(
      (error) => this.log.warning(`Control4: could not subscribe to ${SHARED_TOPIC}/#: ${error}`)
    );
    const kind = hotLoad ? "hot-load, without the start-up identity sends, state reads, Z2IO provisioning or remote bootstrap" : "first start since Zigbee2MQTT started";
    this.log.info(`Control4: extension started: ${kind} (${transport ? "ember" : "no radio access"}, ${runtime.devices.size} devices, store ${file})`);
    this.publishDiscovery();
    this.publishStatus();
    this.statusTimer = setInterval(() => this.publishStatus(), STATUS_INTERVAL);
    this.statusTimer.unref?.();
  }
  async stop() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = void 0;
    this.eventBus.removeListeners(this);
    void Promise.resolve(this.mqtt.unsubscribe?.(`${SHARED_TOPIC}/#`)).catch(() => void 0);
    this.handoff?.stop();
    this.handoff = void 0;
    this.evictions.clear();
    this.runtime?.stop();
    this.runtime = void 0;
    for (const undo of this.restore.reverse()) undo();
    this.restore = [];
    if (globalThis[RUNTIME_KEY]) delete globalThis[RUNTIME_KEY];
    if (this.controller) globalThis[HOT_LOAD_KEY] = new WeakRef(this.controller);
    else delete globalThis[HOT_LOAD_KEY];
  }
  // -- herdsman ---------------------------------------------------------------
  c4ZhDevices() {
    const all = this.controller?.getDevices?.() ?? [];
    return all.filter((d) => isC4Ieee(d.ieeeAddr));
  }
  zhDevice(ieee) {
    return this.controller?.getDeviceByIeeeAddr?.(ieee);
  }
  z2mDevice(ieee) {
    const zh = this.zhDevice(ieee);
    return zh ? this.zigbee.resolveEntity(zh) : void 0;
  }
  nameOf(ieee) {
    const id = String(ieee).toLowerCase();
    return this.z2mDevice(id)?.name ?? id;
  }
  /**
   * Log a Control4 device's new network address (#60): it re-joined. Decimal, as
   * herdsman logs it in "Received network/route error ... for <address>", so a route
   * error can be matched to the device that held the address then.
   */
  noteAddress(zh) {
    const ieee = String(zh.ieeeAddr).toLowerCase();
    const nwk = zh.networkAddress;
    const was = this.addresses.get(ieee);
    this.addresses.set(ieee, nwk);
    if (was === void 0 || was === nwk) return;
    this.log.info(`Control4: ${this.nameOf(ieee)} (${ieee}) changed network address ${was} -> ${nwk}: it re-joined`);
  }
  /** Give a C4 device its learned model (or the generic one) and the endpoints its definition maps. */
  applyKnownModel(zh) {
    const ieee = String(zh.ieeeAddr).toLowerCase();
    const changed = stampModel(zh, knownModel(this.store?.model(ieee), zh.modelID));
    addOutletEndpoints(zh);
    if (changed) {
      zh.save?.();
      this.reresolve(ieee);
    }
  }
  reresolve(ieee) {
    const dev = this.z2mDevice(ieee);
    if (!dev) return;
    Promise.resolve(dev.resolveDefinition?.(true)).then(() => this.eventBus.emitExposesAndDevicesChanged?.(dev)).catch((error) => this.log.debug(`Control4: re-resolving ${ieee} failed: ${error}`));
  }
  /**
   * Tell Zigbee2MQTT every Control4 device's exposes changed, so Home Assistant
   * discovery follows a converter saved through its API: the save re-resolves
   * the definitions but never says so. Returns how many devices it named.
   */
  republish() {
    const devs = this.c4ZhDevices().map((zh) => this.zigbee.resolveEntity(zh)).filter(Boolean);
    for (const dev of devs) this.eventBus.emitExposesChanged?.({ device: dev });
    this.eventBus.emitDevicesChanged?.();
    return devs.length;
  }
  patchHerdsman() {
    const coordinator = this.controller?.getDevicesByType?.("Coordinator")?.[0];
    const proto = coordinator ? Object.getPrototypeOf(coordinator) : void 0;
    if (!proto) {
      this.log.warning("Control4: could not reach the herdsman Device class - interview / ping patches not installed");
      return;
    }
    const store = this.store;
    const getRuntime = () => this.runtime;
    if (typeof proto.interviewQuirks === "function") {
      const original = proto.interviewQuirks;
      proto.interviewQuirks = function() {
        if (isC4Ieee(this.ieeeAddr)) {
          stampModel(this, knownModel(store.model(String(this.ieeeAddr).toLowerCase()), this.modelID));
          return true;
        }
        return original.call(this);
      };
      this.restore.push(() => {
        proto.interviewQuirks = original;
      });
      this.hooks.interview = true;
    } else {
      this.log.warning("Control4: herdsman has no interviewQuirks hook - a Control4 device may show 'interview failed' until its model is learned");
    }
    if (typeof proto.ping === "function") {
      const original = proto.ping;
      proto.ping = async function(...args) {
        const rt = getRuntime();
        if (rt && isC4Ieee(this.ieeeAddr)) {
          const alive = await rt.honestPing(String(this.ieeeAddr).toLowerCase());
          if (alive === false) throw new Error("Control4 ping: no answer to c4.sy.fwv");
          return;
        }
        return original.apply(this, args);
      };
      this.restore.push(() => {
        proto.ping = original;
      });
      this.hooks.ping = true;
    } else {
      this.log.warning("Control4: herdsman has no ping hook - with availability on, Control4 devices may show offline (they never answer herdsman's own ping)");
    }
  }
  makeHost(transport, store) {
    return {
      log: this.log,
      store,
      transport,
      coordinatorIeee: () => this.controller?.getDevicesByType?.("Coordinator")?.[0]?.ieeeAddr,
      deviceInfo: (ieee) => {
        const zh = this.zhDevice(ieee);
        return zh ? { nwk: zh.networkAddress, type: zh.type, modelID: zh.modelID } : void 0;
      },
      ieeeByNwk: (nwk) => {
        const zh = this.controller?.getDeviceByNetworkAddress?.(nwk);
        if (zh) return zh.ieeeAddr;
        if (!this.unknownSenders.has(nwk)) {
          this.unknownSenders.add(nwk);
          this.log.info(
            `Control4: a Control4 frame came from network address ${nwk}, which Zigbee2MQTT does not know - asking it who it is (a device that re-joined under a new address?)`
          );
        }
        Promise.resolve(this.controller?.identifyUnknownDevice?.(nwk)).catch(() => void 0);
        return void 0;
      },
      c4Devices: () => this.c4ZhDevices().map((d) => String(d.ieeeAddr).toLowerCase()),
      publish: (ieee, payload) => {
        const dev = this.z2mDevice(ieee);
        if (dev) void Promise.resolve(this.publishEntityState(dev, payload)).catch((error) => this.log.debug(`Control4: publish failed: ${error}`));
      },
      publishEvent: (ieee, payload) => {
        const event = { ...payload, base: this.baseTopic() };
        const body = JSON.stringify(event);
        const fail = (error) => this.log.debug(`Control4: event publish failed: ${error}`);
        void Promise.resolve(this.mqtt.publish("control4/event", body)).catch(fail);
        void Promise.resolve(this.mqtt.publish("event", body, { baseTopic: SHARED_TOPIC })).catch(fail);
        const own = JSON.stringify({ ...event, event_type: eventTypeOf(String(event.command), modelInfo(String(event.model))?.family) });
        void Promise.resolve(this.mqtt.publish(`${ieee}/event`, own, { baseTopic: SHARED_TOPIC })).catch(fail);
      },
      state: (ieee) => {
        const dev = this.z2mDevice(ieee);
        return dev ? this.state.get(dev) ?? {} : {};
      },
      friendlyName: (ieee) => this.z2mDevice(ieee)?.name ?? ieee,
      deviceOption: (ieee, key) => this.z2mDevice(ieee)?.options?.[key],
      setModel: (ieee, model) => {
        const zh = this.zhDevice(ieee);
        if (!zh) return;
        stampModel(zh, model);
        addOutletEndpoints(zh);
        zh.save?.();
        this.reresolve(ieee);
      },
      setFirmware: (ieee, firmware) => {
        const zh = this.zhDevice(ieee);
        if (!zh || zh.softwareBuildID === firmware) return;
        zh.softwareBuildID = firmware;
        zh.save?.();
      },
      exposesChanged: (ieee) => {
        const dev = this.z2mDevice(ieee);
        if (dev) this.eventBus.emitExposesAndDevicesChanged?.(dev);
      },
      noteSeen: (ieee, lqi) => {
        const zh = this.zhDevice(ieee);
        if (!zh) return;
        zh.updateLastSeen?.();
        if (lqi !== void 0) zh.linkquality = lqi;
        this.controller?.emit?.("lastSeenChanged", { device: zh, reason: "messageNonEmitted" });
      },
      zclRead: async (ieee, ep, cluster, attrs) => {
        const zh = this.zhDevice(ieee);
        if (!zh) throw new Error(`unknown device ${ieee}`);
        const endpoint = zh.getEndpoint(ep) ?? zh.createEndpoint(ep);
        return await endpoint.read(cluster, attrs, { timeout: ZCL_READ_TIMEOUT }) ?? {};
      },
      bind: async (ieee, srcEp, cluster) => {
        const zh = this.zhDevice(ieee);
        const coordEp = this.controller?.getDevicesByType?.("Coordinator")?.[0]?.getEndpoint?.(1);
        if (!zh || !coordEp) throw new Error("device or coordinator endpoint missing");
        const ep = zh.getEndpoint(srcEp) ?? zh.createEndpoint(srcEp);
        await ep.bind(cluster, coordEp);
      },
      // Raised or cleared: tell Home Assistant now, not at the next minute.
      statusChanged: () => this.publishStatus(),
      handoffPending: (ieee) => this.handoff?.pending(ieee) ?? false,
      // herdsman's NWK_addr_req, broadcast with the device's IEEE (it waits for no answer).
      rediscover: async (ieee) => {
        await this.zhDevice(ieee)?.requestNetworkAddress?.();
      }
    };
  }
  // -- handoff (ADR 0004) ----------------------------------------------------------
  makeHandoffHost(store, runtime) {
    return {
      base: () => this.baseTopic(),
      log: this.log,
      store,
      now: () => Date.now(),
      // skipReceive off: Zigbee2MQTT would ignore this topic from every instance once it published on it.
      send: (ieee, step, body) => void Promise.resolve(this.mqtt.publish(`handoff/${ieee}/${step}`, JSON.stringify(body), { baseTopic: SHARED_TOPIC, skipReceive: false })).catch(
        (error) => this.log.warning(`Control4: handoff ${step} for ${ieee} not sent: ${error}`)
      ),
      has: (ieee) => !!this.zhDevice(ieee),
      lastSeen: (ieee) => {
        const t = this.zhDevice(ieee)?.lastSeen;
        return typeof t === "number" ? t : void 0;
      },
      profile: (ieee) => this.profileOf(ieee),
      adopt: (ieee, model, options) => {
        if (model) runtime.learnModel(ieee, model);
        runtime.forgetSettingsRead(ieee);
        runtime.rebuild(ieee);
        if (options && Object.keys(options).length) this.bridge("device/options", { id: ieee, options });
      },
      evict: (ieee) => this.evict(ieee),
      settle: (ieee, name, evicted) => this.settleHandoff(ieee, name, evicted)
    };
  }
  /** A request to this instance's own Zigbee2MQTT bridge, as its frontend sends it. */
  bridge(request, body) {
    this.eventBus.emitMQTTMessage({ topic: `${this.baseTopic()}/bridge/request/${request}`, message: JSON.stringify(body) });
  }
  /** The device's friendly name and its own Zigbee2MQTT device options here (not the instance-wide device_options). */
  profileOf(ieee) {
    const dev = this.z2mDevice(ieee);
    if (!dev) return void 0;
    const { friendly_name: _name, ID: _id, ...options } = this.settings?.getDevice?.(ieee) ?? dev.options ?? {};
    return { name: String(dev.name ?? ieee), options: JSON.parse(JSON.stringify(options)) };
  }
  /** Force-remove the device here; resolves once Zigbee2MQTT reports the removal and Home Assistant has had a moment. */
  evict(ieee) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.evictions.delete(ieee);
        reject(new Error(`Zigbee2MQTT did not remove it within ${EVICT_TIMEOUT / 1e3} s`));
      }, EVICT_TIMEOUT);
      this.evictions.set(ieee, () => {
        clearTimeout(timer);
        this.evictions.delete(ieee);
        setTimeout(resolve, EVICT_SETTLE);
      });
      this.bridge("device/remove", { id: ieee, force: true });
    });
  }
  /**
   * The handoff is over on this instance (the new one): give the device the name it
   * had, and when an old instance evicted its record, republish the discovery that
   * eviction cleared (Zigbee2MQTT keys the topics by IEEE alone).
   */
  settleHandoff(ieee, name, evicted) {
    const dev = this.z2mDevice(ieee);
    if (!dev) return;
    let renamed = false;
    if (name && name !== dev.name) {
      const other = this.zigbee.resolveEntity(name);
      if (other && String(other.ieeeAddr ?? "").toLowerCase() !== ieee) {
        this.log.info(`Control4: ${ieee} keeps the name ${dev.name}: '${name}', its name on the instance it came from, is taken here`);
      } else {
        this.bridge("device/rename", { from: ieee, to: name, homeassistant_rename: true });
        renamed = true;
      }
    }
    if (!evicted) return;
    if (!renamed) this.eventBus.emitEntityRenamed?.({ entity: dev, homeAssisantRename: true, from: dev.name, to: dev.name });
    this.eventEntities.delete(ieee);
    this.publishEventEntity(ieee);
  }
  // -- Home Assistant event entity -----------------------------------------------
  /** Zigbee2MQTT's discovery prefix, or undefined while its Home Assistant integration is off. */
  discoveryTopic() {
    const ha = this.settings?.get?.()?.homeassistant;
    if (ha !== true && !ha?.enabled) return void 0;
    return ha?.discovery_topic ?? "homeassistant";
  }
  /** The values of a device's `action` expose (none before its definition resolves). */
  actionValues(ieee) {
    let exposes = [];
    try {
      exposes = this.z2mDevice(ieee)?.exposes?.() ?? [];
    } catch {
      return [];
    }
    const action = exposes.find((x) => x?.property === "action");
    return Array.isArray(action?.values) ? action.values.map(String) : [];
  }
  /**
   * Publish (retained) the device's event entity; clear it when the device is
   * excluded from Home Assistant the way Zigbee2MQTT excludes it (device option
   * `homeassistant: false`). A device with no actions yet (its definition still
   * resolving) keeps what it has: clearing would make Home Assistant delete the
   * entity, and its name with it.
   */
  publishEventEntity(ieee) {
    const prefix = this.discoveryTopic();
    if (!prefix) return;
    const id = String(ieee).toLowerCase();
    const option = this.z2mDevice(id)?.options?.homeassistant;
    if (option !== void 0 && !option) {
      this.sendEventEntity(prefix, id, "");
      return;
    }
    const actions = this.actionValues(id);
    if (actions.length) this.sendEventEntity(prefix, id, JSON.stringify(eventEntityConfig(id, actions, modelInfo(this.zhDevice(id)?.modelID)?.family)));
  }
  clearEventEntity(ieee) {
    const prefix = this.discoveryTopic();
    if (prefix) this.sendEventEntity(prefix, String(ieee).toLowerCase(), "");
  }
  sendEventEntity(prefix, ieee, payload) {
    if (this.eventEntities.get(ieee) === payload) return;
    this.eventEntities.set(ieee, payload);
    void Promise.resolve(this.mqtt.publish(`event/${ieee}/control4_event/config`, payload, { clientOptions: { retain: true, qos: 1 }, baseTopic: prefix })).catch(
      (error) => this.log.debug(`Control4: event entity publish failed for ${ieee}: ${error}`)
    );
  }
  // -- instance status -----------------------------------------------------------
  statusTopic() {
    return `${SHARED_TOPIC}/status/${this.baseTopic()}`;
  }
  /** What the converter bundle registered when Zigbee2MQTT loaded it (read each time: a converter can be re-saved). */
  converter() {
    const info = globalThis[CONVERTER_KEY];
    return info && typeof info.api === "number" ? info : void 0;
  }
  /** The build of the two files this instance loaded, or null while either hash is unknown. */
  build() {
    const converterFile = this.converter()?.file;
    return EXTENSION_FILE && converterFile ? buildIdOf(EXTENSION_FILE, converterFile) : null;
  }
  currentStatus() {
    const rt = this.runtime;
    if (!rt) return void 0;
    const unreachable = rt.link.unreachable().map((u) => ({ ieee: u.ieee, name: rt.host.friendlyName(u.ieee), model: u.model, quiet_min: u.quietMin, ...u.rebootMin === void 0 ? {} : { reboot_min: u.rebootMin } }));
    return {
      base: this.baseTopic(),
      at: (/* @__PURE__ */ new Date()).toISOString(),
      build: this.build(),
      contract: CONTRACT,
      problems: problemsOf({
        radio: this.radio,
        interviewHook: this.hooks.interview,
        pingHook: this.hooks.ping,
        runtimeApi: RUNTIME_API,
        converterApi: this.converter()?.api,
        traffic: rt.traffic.problems(),
        unreachable: unreachable.length
      }),
      totals: { ...rt.link.totals(), route_refreshes: rt.link.summary().route_refreshes ?? 0, led_queue: rt.tx.stats().queued },
      traffic: { frame_check: rt.traffic.armed() ? "armed" : "off", last_frame_s: rt.traffic.lastFrameSeconds() },
      unreachable
    };
  }
  /** Retained, so a deploy or Home Assistant reads it without waiting for the next one. */
  publishStatus() {
    const status = this.currentStatus();
    if (!status) return;
    void Promise.resolve(this.mqtt.publish(`status/${status.base}`, JSON.stringify(status), { baseTopic: SHARED_TOPIC, clientOptions: { retain: true } })).catch(
      (error) => this.log.debug(`Control4: status publish failed: ${error}`)
    );
  }
  /** The status entities on this instance's Zigbee2MQTT Bridge device, when Home Assistant discovery is on. */
  publishDiscovery() {
    const ha = this.settings?.get?.()?.homeassistant;
    const coordinatorIeee = this.controller?.getDevicesByType?.("Coordinator")?.[0]?.ieeeAddr;
    if (ha?.enabled !== true || !coordinatorIeee) return;
    const prefix = ha.discovery_topic ?? "homeassistant";
    for (const [topic, config] of discoveryConfigs({ base: this.baseTopic(), statusTopic: this.statusTopic(), coordinatorIeee, build: this.build() })) {
      void Promise.resolve(this.mqtt.publish(topic, JSON.stringify(config), { baseTopic: prefix, clientOptions: { retain: true, qos: 1 } })).catch(
        (error) => this.log.debug(`Control4: discovery publish failed: ${error}`)
      );
    }
  }
  // -- bridge requests ----------------------------------------------------------
  baseTopic() {
    return this.settings?.get?.()?.mqtt?.base_topic ?? "zigbee2mqtt";
  }
  async onMqtt(data) {
    if (typeof data?.topic !== "string") return;
    const base = this.baseTopic();
    const prefix = `${base}/bridge/request/control4/`;
    if (data.topic.startsWith(prefix)) {
      await this.handleRequest(data.topic.slice(prefix.length), data.message, false);
      return;
    }
    if (!data.topic.startsWith(`${SHARED_TOPIC}/`)) return;
    const rest = data.topic.slice(SHARED_TOPIC.length + 1);
    const handoff = /^handoff\/(0x[0-9a-fA-F]{16})\/(request|offer|ack|done)$/.exec(rest);
    if (handoff) {
      let body;
      try {
        body = JSON.parse(String(data.message ?? ""));
      } catch {
        return;
      }
      this.handoff?.onMessage(handoff[1], handoff[2], body);
      return;
    }
    const set = /^(0x[0-9a-fA-F]{16})\/set(\/[^/]+)?$/.exec(rest);
    if (set) {
      const ieee = set[1].toLowerCase();
      if (!this.isLocal(ieee)) return;
      this.eventBus.emitMQTTMessage({ topic: `${base}/${ieee}/set${set[2] ?? ""}`, message: data.message ?? "" });
      return;
    }
    const req = /^request\/(\w+)$/.exec(rest);
    if (req) await this.handleRequest(req[1], data.message, true);
  }
  /** A device this instance has (by IEEE or friendly name). */
  isLocal(ref) {
    const ieee = this.resolveIeee(ref);
    return !!ieee && !!this.zhDevice(ieee);
  }
  async handleRequest(action, raw, shared) {
    let message = {};
    try {
      message = typeof raw === "string" && raw ? JSON.parse(raw) : {};
    } catch {
      message = {};
    }
    message = message && typeof message === "object" ? message : {};
    if (shared && (message.devices !== void 0 || message.device !== void 0)) {
      const refs = message.devices === void 0 ? [message.device] : Array.isArray(message.devices) ? message.devices : [message.devices];
      const mine = refs.filter((r) => this.isLocal(r));
      if (mine.length === 0) return;
      if (message.devices !== void 0) message = { ...message, devices: mine };
    }
    const transaction = message.transaction;
    const respond = (body) => {
      const payload = JSON.stringify({ ...body, ...shared ? { base: this.baseTopic() } : {}, ...transaction !== void 0 ? { transaction } : {} });
      return shared ? this.mqtt.publish(`response/${action}`, payload, { baseTopic: SHARED_TOPIC }) : this.mqtt.publish(`bridge/response/control4/${action}`, payload);
    };
    try {
      const result = await this.bridgeRequest(action, message);
      await respond({ status: "ok", data: result ?? {} });
    } catch (error) {
      this.log.error(`Control4: request '${action}' failed: ${error.message}`);
      await respond({ status: "error", data: {}, error: error.message });
    }
  }
  resolveIeee(ref) {
    if (typeof ref !== "string") return void 0;
    if (/^0x[0-9a-f]{16}$/i.test(ref)) return ref.toLowerCase();
    const ent = this.zigbee.resolveEntity(ref);
    return ent?.ieeeAddr?.toLowerCase();
  }
  async bridgeRequest(action, msg) {
    const rt = this.runtime;
    if (!rt) throw new Error("Control4 runtime is not running");
    const refs = msg.devices === void 0 ? msg.device === void 0 ? [] : [msg.device] : Array.isArray(msg.devices) ? msg.devices : [msg.devices];
    const everyone = msg.devices === void 0 && msg.device === void 0;
    const animators = () => {
      if (everyone) return rt.anim.all();
      return refs.map((r) => {
        const ieee = this.resolveIeee(r);
        const a = ieee ? rt.anim.get(ieee) : void 0;
        if (!a) throw new Error(`'${r}' is not a Control4 keypad / dimmer with LEDs`);
        return a;
      });
    };
    switch (action) {
      case "led_effect":
        for (const a of animators()) await ledEffect(a, msg);
        return void 0;
      case "led_status":
        for (const a of animators()) await ledStatus(a, msg);
        return void 0;
      case "led_stop":
        for (const a of animators()) await a.stop(msg.restore === void 0 ? true : Boolean(msg.restore));
        return void 0;
      case "led_refresh":
        for (const a of animators()) await a.refresh();
        return { tx: rt.tx.stats() };
      case "set_model": {
        const ieee = this.resolveIeee(msg.device);
        if (!ieee) throw new Error(`unknown device '${msg.device}'`);
        return { model: rt.seedModel(ieee, String(msg.model ?? "")) };
      }
      case "stats":
        return {
          tx: rt.tx.stats(),
          link: rt.link.summary(),
          devices: [...rt.devices.values()].map((d) => ({ ieee: d.ieee, name: d.name, model: d.model, family: d.family, ...rt.link.health(d.ieee) })),
          animators: rt.anim.all().map((a) => a.state())
        };
      case "republish":
        return { devices: this.republish() };
    }
    throw new Error(`unknown action '${action}'`);
  }
};
export {
  Control4Extension as default
};
