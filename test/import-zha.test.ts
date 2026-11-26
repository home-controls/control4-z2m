import {describe, expect, it} from "vitest";

// @ts-expect-error plain ESM tool without types
import {colourKey, convert, merge, toZ2mIeee} from "../tools/import-zha.mjs";

describe("ZHA settings import", () => {
    const zha = {
        models: {"00:0f:ff:00:00:63:6e:2a": "KPZ-3B1", "00:0f:ff:00:00:00:00:02": "C4-DIM1-Z", "00:0f:ff:00:00:00:00:03": "C4-APD120", "00:0f:ff:00:00:00:00:04": "C4-SR250B"},
        colours: {"00:0f:ff:00:00:63:6e:2a:211": 5, "00:0f:ff:00:00:63:6e:2a:221": 3, "00:0f:ff:00:00:00:00:02:17": 11, "00:0f:ff:00:00:00:00:03:9": 1},
        fades: {"00:0f:ff:00:00:00:00:02": {on: 15, off: 30}},
        flags: {"00:0f:ff:00:00:00:00:02": {ba: 0, ledbright: 40, ledfade: 15, tv_min_on: 12, last_level: 180}, "00:0f:ff:00:00:00:00:03": {ledbind2: 1, odd: 3}},
        z2io: {},
        site: {sr250_room: "Great Room"},
    };

    it("normalises IEEEs", () => {
        expect(toZ2mIeee("00:0f:ff:00:00:63:6e:2a")).toBe("0x000fff0000636e2a");
    });

    it("maps endpoints to keys per family", () => {
        expect(colourKey("kp", 210)).toBe("button_1_idle_color");
        expect(colourKey("kp", 225)).toBe("button_6_pressed_color");
        expect(colourKey("kc", 233)).toBe("led_12_pressed_color");
        expect(colourKey("dmxbar", 8)).toBe("led_idle_color");
        expect(colourKey("dim1z", 18)).toBe("led_bottom_on_color");
    });

    it("converts every store", () => {
        const out = convert(zha);
        expect(out.models["0x000fff0000636e2a"]).toBe("KPZ-3B1");
        expect(out.devices["0x000fff0000636e2a"]).toEqual({button_2_idle_color: "amber", button_2_pressed_color: "red"});
        expect(out.devices["0x000fff0000000002"]).toEqual({
            led_top_off_color: "blue",
            on_transition: 1.5,
            off_transition: 3,
            ba: 0,
            led_brightness: 40,
            led_transition: 1.5,
            min_brightness: 12,
            last_level: 180,
        });
        expect(out.devices["0x000fff0000000003"]).toEqual({led_active_color: "white", led_3_bound: true});
        expect(out.devices["0x000fff0000000004"]).toEqual({room_name: "Great Room"});
        expect(out.notes).toEqual(["flag odd on 00:0f:ff:00:00:00:00:03 not mapped"]);
    });

    it("keeps the rest of the existing file (meta, the handoff records)", () => {
        const existing = {version: 1, models: {}, devices: {}, meta: {led_defaults_migrated: true}, handoff: {had: {"0x000fff0000636e2a": 5}, profiles: {}}};
        const merged = merge(existing, convert(zha));
        expect(merged.meta).toEqual(existing.meta);
        expect(merged.handoff).toEqual(existing.handoff);
    });

    it("lets existing Zigbee2MQTT values win", () => {
        const merged = merge({models: {"0x000fff0000636e2a": "C4-KP3-Z"}, devices: {"0x000fff0000636e2a": {button_2_idle_color: "green"}}}, convert(zha));
        expect(merged.models["0x000fff0000636e2a"]).toBe("C4-KP3-Z");
        expect(merged.devices["0x000fff0000636e2a"]).toEqual({button_2_idle_color: "green", button_2_pressed_color: "red"});
    });
});