#!/usr/bin/env node
// Move Control4 devices' saved settings from one Zigbee2MQTT instance to
// another, for a device re-paired onto a different coordinator while its old
// instance is down. With the old instance running there is no need: the
// device takes its saved settings, name and device options from it by itself
// when it joins the new one (the handoff, ADR 0004).
//
//   node tools/move-c4-settings.mjs <from-data-dir> <to-data-dir> <ieee>... [--copy] [--dry-run]
//
// Reads and writes only <data>/control4/control4.json in each data directory:
// the learned model and the settings written from Zigbee2MQTT (fades, LED
// colours, paddle options, Z2IO mode, remote rows ...). Values the target
// already holds win. Without --copy the devices are removed from the source,
// handoff record included. The rest of each file is kept. A timestamped
// backup of each file that changes is kept.
//
// Stop both Zigbee2MQTT instances first: a running extension keeps its store
// in memory and would write its own copy back over the file.

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const storeFile = (data) => path.join(data, "control4", "control4.json");

function read(file) {
    try {
        const s = JSON.parse(fs.readFileSync(file, "utf8"));
        return {...s, version: 1, models: s.models ?? {}, devices: s.devices ?? {}};
    } catch (error) {
        if (error?.code === "ENOENT") return {version: 1, models: {}, devices: {}};
        throw new Error(`${file}: ${error.message}`);
    }
}

/** Pure move: returns the new {from, to} stores and what moved. */
export function move(from, to, ieees, {copy = false} = {}) {
    const src = structuredClone(from);
    const dst = structuredClone(to);
    const moved = [];
    for (const raw of ieees) {
        const ieee = raw.toLowerCase();
        const model = src.models[ieee];
        const settings = src.devices[ieee];
        if (model === undefined && settings === undefined) continue;
        if (model !== undefined && dst.models[ieee] === undefined) dst.models[ieee] = model;
        if (settings !== undefined) dst.devices[ieee] = {...settings, ...(dst.devices[ieee] ?? {})};
        if (!copy) {
            delete src.models[ieee];
            delete src.devices[ieee];
            // It has had the device for the last time: it must not answer a later handoff for it.
            delete src.handoff?.had?.[ieee];
            delete src.handoff?.profiles?.[ieee];
        }
        moved.push({ieee, model, settings: Object.keys(settings ?? {}).length});
    }
    return {from: src, to: dst, moved};
}

function write(file, data) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1));
    fs.renameSync(`${file}.tmp`, file);
}

function main(argv) {
    const args = argv.filter((a) => !a.startsWith("--"));
    const [fromDir, toDir, ...ieees] = args;
    const copy = argv.includes("--copy");
    const dry = argv.includes("--dry-run");
    if (!fromDir || !toDir || ieees.length === 0) {
        console.error("usage: node tools/move-c4-settings.mjs <from-data-dir> <to-data-dir> <ieee>... [--copy] [--dry-run]");
        process.exit(2);
    }
    const bad = ieees.filter((i) => !/^0x[0-9a-f]{16}$/i.test(i));
    if (bad.length) {
        console.error(`not an IEEE address: ${bad.join(", ")}`);
        process.exit(2);
    }
    const fromFile = storeFile(fromDir);
    const toFile = storeFile(toDir);
    if (path.resolve(fromFile) === path.resolve(toFile)) {
        console.error("source and target are the same instance");
        process.exit(2);
    }
    const result = move(read(fromFile), read(toFile), ieees, {copy});
    for (const ieee of ieees.map((i) => i.toLowerCase())) {
        const m = result.moved.find((x) => x.ieee === ieee);
        console.log(m ? `${ieee}: model ${m.model ?? "(none)"}, ${m.settings} setting(s)` : `${ieee}: nothing saved in the source`);
    }
    if (!result.moved.length || dry) {
        if (dry) console.log("dry run: nothing written");
        return;
    }
    write(toFile, result.to);
    console.log(`wrote ${toFile}`);
    if (!copy) {
        write(fromFile, result.from);
        console.log(`wrote ${fromFile}`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
