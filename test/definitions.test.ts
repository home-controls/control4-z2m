/**
 * The definitions against the real zigbee-herdsman-converters 26.115.1, and the
 * built bundles (dist/) loaded the way Zigbee2MQTT loads them.
 */

import {pathToFileURL} from "node:url";
import path from "node:path";

import {describe, expect, it, vi} from "vitest";
import * as zhc from "zigbee-herdsman-converters";

import {GENERIC_MODEL, MODELS} from "../src/core/constants";
import {buildDefinitions, kcExposes} from "../src/z2m/definitions";

// biome-ignore lint/suspicious/noExplicitAny: converter shapes
type Any = any;
const api: Any = (zhc as Any).addExternalDefinition ? zhc : (zhc as Any).default;

function fakeDevice(modelID: string, ieee = "0x000fff0000000001"): Any {
    return {
        ieeeAddr: ieee,
        modelID,
        manufacturerName: "Control4",
        manufacturerID: 0xabcd,
        type: "Router",
        powerSource: "Mains (single phase)",
        interviewState: "SUCCESSFUL",
        endpoints: [],
        getEndpoint: () => undefined,
        customClusters: {},
    };
}

function flatten(exposes: Any[]): Any[] {
    return exposes.flatMap((x) => [x, ...flatten(x.features ?? [])]);
}

describe("definitions", () => {
    it("holds a /set that arrives before the extension is running until it is", async () => {
        const def = buildDefinitions().find((d: Any) => d.model === "C4-DIM1-Z");
        const conv = def.toZigbee.find((c: Any) => c.key.includes("led_brightness"));
        const calls: unknown[] = [];
        const g = globalThis as Any;
        const key = (await import("../src/z2m/global")).RUNTIME_KEY;
        delete g[key];
        const pending = conv.convertSet(undefined, "led_brightness", 40, {device: {ieeeAddr: "0x000FFF0000000001"}, message: {led_brightness: 40}});
        await new Promise((r) => setTimeout(r, 300));
        g[key] = {set: async (...args: unknown[]) => (calls.push(args), {led_brightness: 40})};
        try {
            await expect(pending).resolves.toEqual({state: {led_brightness: 40}});
            expect(calls).toHaveLength(1);
        } finally {
            delete g[key];
        }
    });

    it("runs the commands it held in the order they arrived, /get too, and gives up after 15 s", async () => {
        vi.useFakeTimers();
        const g = globalThis as Any;
        const key = (await import("../src/z2m/global")).RUNTIME_KEY;
        delete g[key];
        try {
            const def = buildDefinitions().find((d: Any) => d.model === "C4-DIM1-Z");
            const conv = def.toZigbee.find((c: Any) => c.key.includes("state"));
            const meta = (state: string) => ({device: {ieeeAddr: "0x000FFF0000000001"}, message: {state}});
            const order: string[] = [];
            const on = conv.convertSet(undefined, "state", "ON", meta("ON"));
            await vi.advanceTimersByTimeAsync(50);
            const off = conv.convertSet(undefined, "state", "OFF", meta("OFF"));
            const get = conv.convertGet(undefined, "state", meta("GET"));
            await vi.advanceTimersByTimeAsync(70);
            g[key] = {
                set: async (_i: string, _k: string, value: unknown) => (order.push(String(value)), undefined),
                getValue: async () => void order.push("GET"),
            };
            await vi.advanceTimersByTimeAsync(200);
            await Promise.all([on, off, get]);
            expect(order).toEqual(["ON", "OFF", "GET"]);
            delete g[key];
            const late = conv.convertSet(undefined, "state", "ON", meta("ON"));
            const result = expect(late).rejects.toThrow(/not running/);
            await vi.advanceTimersByTimeAsync(15_200);
            await result;
        } finally {
            delete g[key];
            vi.useRealTimers();
        }
    });

    const defs = buildDefinitions();

    it("cover every model plus the generic one", () => {
        expect(defs.map((d: Any) => d.model)).toEqual([...MODELS.map((m) => m.model), GENERIC_MODEL]);
    });

    it("register with zigbee-herdsman-converters and resolve by every alias", async () => {
        for (const def of defs) api.addExternalDefinition({...def, externalConverterName: "control4.mjs"});
        for (const m of MODELS) {
            for (const alias of m.aliases) {
                const found = await api.findByDevice(fakeDevice(alias), false);
                expect(found?.model, alias).toBe(m.model);
                expect(found?.vendor).toBe("Control4");
            }
        }
        expect((await api.findByDevice(fakeDevice(GENERIC_MODEL), false))?.model).toBe(GENERIC_MODEL);
        api.removeExternalDefinitions("control4.mjs");
    });

    it("have a converter for every settable expose", () => {
        for (const def of defs) {
            const exposes = typeof def.exposes === "function" ? def.exposes(fakeDevice(def.model), {}) : def.exposes;
            const keys = new Set(def.toZigbee.flatMap((c: Any) => c.key));
            for (const ex of flatten(exposes)) {
                if (!ex.property || !(ex.access & 2)) continue;
                expect(keys.has(ex.property) || keys.has(ex.property.replace(/_l[12]$/, "")), `${def.model}: ${ex.property}`).toBe(true);
            }
        }
    });

    it("give each key exactly one converter", () => {
        for (const def of defs) {
            const keys = def.toZigbee.flatMap((c: Any) => c.key);
            expect(new Set(keys).size, def.model).toBe(keys.length);
        }
    });

    it("list every published action", () => {
        const def = defs.find((d: Any) => d.model === "C4-KP6-Z");
        const action = def.exposes.find((x: Any) => x.name === "action");
        expect(action.values).toContain("button_6_fast_quadruple");
        expect(action.values).toContain("button_1_hold_release");
        expect(action.values).toContain("led_notification_end");
        const sr = defs.find((d: Any) => d.model === "C4-SR260").exposes.find((x: Any) => x.name === "action");
        expect(sr.values).toEqual(expect.arrayContaining(["select_press", "volume_up_hold", "menu_select", "motion_wake"]));
    });

    it.each([
        ["C4-KP6-Z", "button_6_tap_known"],
        ["C4-KP3-Z", "button_3_tap_known"],
        ["C4-KC120277", "button_1_tap_known"],
        ["C4-DIM1-Z", "button_2_tap_known"],
    ])("list the known tap among %s's actions", (model, known) => {
        const def = defs.find((d: Any) => d.model === model);
        const exposes = typeof def.exposes === "function" ? def.exposes(fakeDevice(model), {}) : def.exposes;
        const action = exposes.find((x: Any) => x.name === "action");
        expect(action.values).toContain(known);
    });

    it("size the IO module's exposes by its mode", () => {
        const def = defs.find((d: Any) => d.model === "C4-Z2IO-ZP");
        const names = flatten(def.exposes(fakeDevice("C4-Z2IO-ZP", "0x000fff00000000ff"), {})).map((x: Any) => x.property);
        // No runtime -> default mode (4 contacts, no relays)
        expect(names).toEqual(expect.arrayContaining(["contact_1", "contact_4", "io_mode"]));
        expect(names).not.toContain("relay_1");
    });

    it.each(["C4-KP3-Z", "C4-KP6-Z", "C4-KC120277", "C4-DIM1-Z", "C4-APD120", "C4-SW120277", "C4-FS1-Z", "C4-4SF120", "LOZ-5S1-W"])("offer %s a tap window option of 0.25-1.5 s", (model) => {
        const def = defs.find((d: Any) => d.model === model);
        const option = (def.options ?? []).find((o: Any) => o.property === "tap_window");
        expect(option, model).toMatchObject({type: "numeric", value_min: 0.25, value_max: 1.5, unit: "s"});
    });

    it("give the DIM1-Z and the APD120 cold start settings", () => {
        const props = (model: string) => flatten(defs.find((d: Any) => d.model === model).exposes).map((x: Any) => x.property);
        expect(props("C4-DIM1-Z")).toEqual(expect.arrayContaining(["min_brightness", "cold_start_level", "cold_start_time"]));
        expect(props("C4-APD120")).toEqual(expect.arrayContaining(["min_brightness", "cold_start_level", "cold_start_time"]));
    });

    it.each(["C4-APD120", "C4-SW120277"])("give the %s its two LEDs, button behaviours, real power and health", (model) => {
        const props = flatten(defs.find((d: Any) => d.model === model).exposes).map((x: Any) => x.property);
        expect(props).toEqual(
            expect.arrayContaining([
                "led_top_on_color",
                "led_top_off_color",
                "led_top_mode",
                "led_bottom_on_color",
                "led_bottom_off_color",
                "led_bottom_mode",
                "top_button_behaviour",
                "bottom_button_behaviour",
                "power",
                "voltage",
                "current",
                "power_apparent",
                "power_factor",
                "energy",
                "multiclick_time_1",
                "tx_power",
                "reset_reason",
                "fault",
            ]),
        );
        expect(props).not.toContain("device_temperature");
        expect(props).not.toContain("led_3_idle_color");
        expect(props).not.toContain("paddle_local_control");
        const behaviour = flatten(defs.find((d: Any) => d.model === model).exposes).find((x: Any) => x.property === "top_button_behaviour");
        expect(behaviour.values).toEqual(["load_on", "load_off", "toggle", "momentary", "event_only"]);
    });

    it("give the KC120277 every button and LED until its layout is known, then only the fitted ones", () => {
        const kc = defs.find((d: Any) => d.model === "C4-KC120277");
        const all = flatten(kc.exposes(fakeDevice("C4-KC120277"), {}));
        expect(all.find((x: Any) => x.name === "action").values).toContain("button_7_single");
        expect(all.map((x: Any) => x.property)).toEqual(expect.arrayContaining(["led_12_idle_color", "led_12_mode", "backlight_color", "backlight_brightness", "tx_power"]));
        // Three double-height buttons (the Kitchen Keypad).
        const fitted = flatten(kcExposes({wires: [0, 2, 4], numbering: "pairs"}));
        const actions = fitted.find((x: Any) => x.name === "action").values;
        expect(actions).toEqual(expect.arrayContaining(["button_1_single", "button_2_single", "button_3_single"]));
        expect(actions).not.toContain("button_4_single");
        const props = fitted.map((x: Any) => x.property);
        expect(props).toEqual(expect.arrayContaining(["led_1_idle_color", "led_3_idle_color", "led_5_mode"]));
        // Each LED is named for the button it lights, a double-height button's second slot too.
        expect(fitted.find((x: Any) => x.property === "led_3_idle_color").label).toBe("Button 2 LED idle colour");
        expect(fitted.find((x: Any) => x.property === "led_2_idle_color").label).toBe("Button 1 LED 2 (slot 2) idle colour");
        expect(props).not.toContain("led_8_idle_color");
        // Three single-height buttons: one slot each, nothing in between.
        const singles = flatten(kcExposes({wires: [0, 1, 2], numbering: "slots"})).map((x: Any) => x.property);
        expect(singles).toEqual(expect.arrayContaining(["led_1_mode", "led_2_mode", "led_3_mode", "led_5_mode"]));
        const byFitted = flatten(kcExposes({wires: [0, 2, 4], numbering: "fitted"})).find((x: Any) => x.name === "action").values;
        expect(byFitted).toEqual(expect.arrayContaining(["button_1_single", "button_2_single", "button_3_single"]));
    });

    it("keep the KC120277's ambient light poll option beside its tap window", () => {
        const def = defs.find((d: Any) => d.model === "C4-KC120277");
        expect(def.options.map((o: Any) => o.property)).toEqual(expect.arrayContaining(["ambient_light_poll", "tap_window"]));
    });

    it.each(["C4-APD120", "C4-SW120277"])("keep the %s's ambient light and power poll options beside its tap window", (model) => {
        const def = defs.find((d: Any) => d.model === model);
        expect(def.options.map((o: Any) => o.property)).toEqual(expect.arrayContaining(["ambient_light_poll", "power_poll", "tap_window"]));
    });

    it("offer the KC120277 a pairs / slots / fitted button numbering option and a layout option", () => {
        const def = defs.find((d: Any) => d.model === "C4-KC120277");
        const option = def.options.find((o: Any) => o.property === "button_numbering");
        expect(option).toMatchObject({type: "enum", values: ["pairs", "slots", "fitted"]});
        expect(def.options.find((o: Any) => o.property === "button_layout")).toMatchObject({type: "text"});
    });

    it("map the outlet's two endpoints", () => {
        const def = defs.find((d: Any) => d.model === "LOZ-5S1-W");
        expect(def.endpoint()).toEqual({l1: 1, l2: 11});
        expect(def.meta).toEqual({multiEndpoint: true});
    });
});

describe("built bundles", () => {
    const root = path.resolve(__dirname, "..");

    it("the converter bundle exports the definitions", async () => {
        const mod = await import(pathToFileURL(path.join(root, "dist/external_converters/control4.mjs")).href);
        expect(Array.isArray(mod.default)).toBe(true);
        expect(mod.default.length).toBe(MODELS.length + 1);
    });

    it("the extension bundle exports a constructable extension class", async () => {
        const mod = await import(pathToFileURL(path.join(root, "dist/external_extensions/control4.mjs")).href);
        expect(typeof mod.default).toBe("function");
        expect(mod.default.name).toBe("Control4Extension");
        expect(typeof mod.default.prototype.start).toBe("function");
        expect(typeof mod.default.prototype.stop).toBe("function");
    });
});