#!/usr/bin/env node
// Import the ZHA quirks' persisted Control4 settings into control4-z2m.
//
//   node tools/import-zha.mjs <ha-storage-dir> <zigbee2mqtt-data-dir> [--dry-run]
//
// Reads (whichever exist) from the Home Assistant .storage directory:
//   c4_quirk_data.json      IEEE -> model           (the learned model map)
//   c4_led_colours.json     "ieee:endpoint" -> palette index
//   c4_dimmer_settings.json IEEE -> on/off fades (1/10 s)
//   c4_dimmer_flags.json    IEEE -> flags (LED brightness/fade, paddle, bmc, dm.tv, binds, last level)
//   c4_z2io_settings.json   IEEE -> IO mode
//   c4_site.json            sr250_room (string, or per-IEEE map)
// and merges them into <zigbee2mqtt-data-dir>/control4/control4.json (a
// timestamped backup of the old file is kept). Values already set on the
// Zigbee2MQTT side win. Stop Zigbee2MQTT first, or it may overwrite the file.

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const PALETTE = ["off", "white", "warm_white", "red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "blue", "purple", "magenta", "pink"];

const FAMILY = [
    [/^C4-APD120/i, "dmxbar"],
    [/^C4-SW120277/i, "dmxbar"],
    [/^C4-KC120277|^KPZ-6B1-C$/i, "kc"],
    [/^KPZ-[36]B1$|^C4-KP[36]-Z/i, "kp"],
    [/^C4-DIM1-Z|^DIMZ-1B1/i, "dim1z"],
    [/^C4-SR2[56]0/i, "remote"],
    [/^C4-Z2IO-ZP/i, "z2io"],
];

export function familyOf(model) {
    return FAMILY.find(([re]) => re.test(String(model ?? "")))?.[1];
}

/** ZHA's "00:0f:ff:00:00:00:6e:2a" -> herdsman's "0x000fff0000006e2a". */
export function toZ2mIeee(ieee) {
    return `0x${String(ieee)
        .toLowerCase()
        .replace(/^0x/, "")
        .replace(/[^0-9a-f]/g, "")}`;
}

/** The control4-z2m key for a ZHA LED-colour select endpoint, by family. */
export function colourKey(family, ep) {
    if (family === "dmxbar") {
        if (ep === 8) return "led_idle_color";
        if (ep === 9) return "led_active_color";
        if (ep >= 210 && ep < 222) return `led_${ep - 209}_idle_color`;
        if (ep >= 222 && ep < 234) return `led_${ep - 221}_active_color`;
    }
    if (family === "kc") {
        if (ep >= 210 && ep < 222) return `led_${ep - 209}_idle_color`;
        if (ep >= 222 && ep < 234) return `led_${ep - 221}_pressed_color`;
    }
    if (family === "kp") {
        if (ep >= 210 && ep < 220) return `button_${ep - 209}_idle_color`;
        if (ep >= 220 && ep < 230) return `button_${ep - 219}_pressed_color`;
    }
    if (family === "dim1z") return {16: "led_top_on_color", 17: "led_top_off_color", 18: "led_bottom_on_color", 19: "led_bottom_off_color"}[ep];
    return undefined;
}

const FLAG_KEYS = {
    ledbright: (v) => ["led_brightness", Number(v)],
    ledfade: (v) => ["led_transition", Number(v) / 10],
    ba: (v) => ["ba", Number(v) ? 1 : 0],
    sw_decoupled: (v) => ["sw_decoupled", Boolean(Number(v))],
    bmc0: (v) => ["multiclick_time_1", Number(v)],
    bmc1: (v) => ["multiclick_time_2", Number(v)],
    bmc2: (v) => ["multiclick_time_3", Number(v)],
    tv_min_on: (v) => ["min_brightness", Number(v)],
    tv_max_on: (v) => ["max_brightness", Number(v)],
    tv_default_on: (v) => ["default_on_brightness", Number(v)],
    tv_hold_up: (v) => ["hold_ramp_up", Number(v)],
    tv_hold_down: (v) => ["hold_ramp_down", Number(v)],
    last_level: (v) => ["last_level", Number(v)],
};

/** Convert the ZHA files (already parsed) into {models, devices, notes}. */
export function convert(zha) {
    const models = {};
    const devices = {};
    const notes = [];
    const put = (ieee, key, value) => {
        const id = toZ2mIeee(ieee);
        devices[id] ??= {};
        devices[id][key] = value;
    };
    for (const [ieee, model] of Object.entries(zha.models ?? {})) models[toZ2mIeee(ieee)] = model;
    const familyFor = (ieee) => familyOf(models[toZ2mIeee(ieee)]);

    for (const [k, idx] of Object.entries(zha.colours ?? {})) {
        const cut = k.lastIndexOf(":");
        const ieee = k.slice(0, cut);
        const ep = Number(k.slice(cut + 1));
        const family = familyFor(ieee);
        const key = colourKey(family, ep);
        const name = PALETTE[Number(idx)];
        if (key && name) put(ieee, key, name);
        else notes.push(`colour ${k} (${family ?? "unknown model"}) not mapped`);
    }
    for (const [ieee, s] of Object.entries(zha.fades ?? {})) {
        const on = s.on ?? s.on_off;
        const off = s.off ?? s.on_off;
        if (on !== undefined) put(ieee, "on_transition", Number(on) / 10);
        if (off !== undefined) put(ieee, "off_transition", Number(off) / 10);
    }
    for (const [ieee, flags] of Object.entries(zha.flags ?? {})) {
        for (const [flag, value] of Object.entries(flags ?? {})) {
            const bind = /^ledbind(\d+)$/.exec(flag);
            if (bind) {
                put(ieee, `led_${Number(bind[1]) + 1}_bound`, Boolean(Number(value)));
                continue;
            }
            const map = FLAG_KEYS[flag];
            if (map) {
                const [key, v] = map(value);
                put(ieee, key, v);
            } else notes.push(`flag ${flag} on ${ieee} not mapped`);
        }
    }
    for (const [ieee, s] of Object.entries(zha.z2io ?? {})) if (s?.opt_mode !== undefined) put(ieee, "z2io_mode", Number(s.opt_mode));
    const room = zha.site?.sr250_room;
    for (const id of Object.keys(models)) {
        if (familyOf(models[id]) !== "remote" || room === undefined) continue;
        const value = typeof room === "string" ? room : Object.entries(room).find(([k]) => toZ2mIeee(k) === id)?.[1];
        if (typeof value === "string" && value.trim()) put(id, "room_name", value.trim());
    }
    return {models, devices, notes};
}

/** Merge: existing control4-z2m values win over imported ones; the rest of the file (meta, handoff) is kept. */
export function merge(existing, imported) {
    const out = {...(existing ?? {}), version: 1, models: {...imported.models, ...(existing?.models ?? {})}, devices: {}};
    const ids = new Set([...Object.keys(imported.devices), ...Object.keys(existing?.devices ?? {})]);
    for (const id of ids) out.devices[id] = {...(imported.devices[id] ?? {}), ...(existing?.devices?.[id] ?? {})};
    return out;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return undefined;
    }
}

function main(argv) {
    const [storage, data] = argv.filter((a) => !a.startsWith("--"));
    const dry = argv.includes("--dry-run");
    if (!storage || !data) {
        console.error("usage: node tools/import-zha.mjs <ha-storage-dir> <zigbee2mqtt-data-dir> [--dry-run]");
        process.exit(2);
    }
    const zha = {
        models: readJson(path.join(storage, "c4_quirk_data.json")),
        colours: readJson(path.join(storage, "c4_led_colours.json")),
        fades: readJson(path.join(storage, "c4_dimmer_settings.json")),
        flags: readJson(path.join(storage, "c4_dimmer_flags.json")),
        z2io: readJson(path.join(storage, "c4_z2io_settings.json")),
        site: readJson(path.join(storage, "c4_site.json")),
    };
    const imported = convert(zha);
    const target = path.join(data, "control4", "control4.json");
    const existing = readJson(target);
    const merged = merge(existing, imported);
    console.log(`models: ${Object.keys(imported.models).length}, devices with settings: ${Object.keys(imported.devices).length}`);
    for (const n of imported.notes) console.log(`  note: ${n}`);
    if (dry) {
        console.log(JSON.stringify(merged, null, 1));
        return;
    }
    fs.mkdirSync(path.dirname(target), {recursive: true});
    if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(merged, null, 1));
    fs.renameSync(`${target}.tmp`, target);
    console.log(`wrote ${target}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
