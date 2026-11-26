import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {LED_DEFAULTS_KEY, LED_DEFAULTS_MIGRATION} from "../src/core/leds";
import {Rig, tick} from "./rig";

let rig: Rig;
const OLD_KC = "0x000fff00000000d1";
const OLD_DIM = "0x000fff00000000d2";
const NEW_KC = "0x000fff00000000d3";
const NEW_DIM = "0x000fff00000000d4";
const NEW_KP3 = "0x000fff00000000d5";

const hex = (i: number) => i.toString(16).padStart(2, "0");
const ledCmds = (from: number) => rig.cmds(from).filter((c) => c.startsWith("c4.dmx.led") || /^c4\.dm\.l[01][fo] /.test(c) || /^c4\.kp\.l[fvo] /.test(c));

function pair(ieee: string, model: string): number {
    const from = rig.cmds().length;
    rig.add(ieee, model);
    rig.runtime.ensureDevice(ieee);
    return from;
}

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(OLD_KC, "C4-KC120277");
    rig.add(OLD_DIM, "C4-DIM1-Z");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

describe("LED colour defaults for new devices", () => {
    it("leaves devices paired before the feature alone", async () => {
        await tick(40_000);
        expect(rig.store.meta(LED_DEFAULTS_MIGRATION)).toBe(true);
        expect(rig.store.get(OLD_KC, LED_DEFAULTS_KEY)).toBe("existing");
        expect(rig.store.get(OLD_DIM, LED_DEFAULTS_KEY)).toBe("existing");
        expect(ledCmds(0)).toEqual([]);
        expect(rig.last(OLD_KC).led_1_idle_color).toBeNull();
    });

    it("turns every LED of a newly paired KC120277 off, once", async () => {
        const from = pair(NEW_KC, "C4-KC120277");
        await tick(35_000);
        const cmds = ledCmds(from);
        for (let i = 0; i < 12; i++) {
            expect(cmds).toContain(`c4.dmx.led ${hex(i)} 04 000000`);
            expect(cmds).toContain(`c4.dmx.led ${hex(i)} 03 000000`);
        }
        expect(rig.last(NEW_KC)).toMatchObject({led_1_idle_color: "off", led_12_pressed_color: "off"});
        expect(rig.store.get(NEW_KC, "led_7_idle_color")).toBe("off");
        expect(rig.store.get(NEW_KC, LED_DEFAULTS_KEY)).toBe("off");

        // A later start does not write them again.
        rig.stop();
        const store = rig.store;
        rig = new Rig({store});
        rig.add(OLD_KC, "C4-KC120277");
        rig.add(NEW_KC, "C4-KC120277");
        rig.start();
        await tick(40_000);
        expect(ledCmds(0)).toEqual([]); // fresh rig: every command since this start
    });

    it("turns a new DIM1-Z's paddle LEDs off", async () => {
        const from = pair(NEW_DIM, "C4-DIM1-Z");
        await tick(35_000);
        const cmds = ledCmds(from);
        for (const c of ["c4.dm.l0f 000000", "c4.dm.l0o 000000", "c4.dm.l1f 000000", "c4.dm.l1o 000000"]) expect(cmds).toContain(c);
        expect(rig.last(NEW_DIM)).toMatchObject({led_top_on_color: "off", led_top_off_color: "off", led_bottom_on_color: "off", led_bottom_off_color: "off"});
    });

    it("waits for a handoff: a device that brings its saved settings gets no defaults", async () => {
        rig.handoffs.add(NEW_KC);
        const from = pair(NEW_KC, "C4-KC120277");
        await tick(35_000);
        expect(ledCmds(from)).toEqual([]); // still waiting
        // The handoff brings the old instance's settings, LED defaults record included.
        rig.store.set(NEW_KC, LED_DEFAULTS_KEY, "existing");
        rig.store.set(NEW_KC, "led_1_idle_color", "blue");
        rig.handoffs.delete(NEW_KC);
        await tick(35_000);
        expect(ledCmds(from)).toEqual([]);
        expect(rig.store.get(NEW_KC, "led_1_idle_color")).toBe("blue");
    });

    it("writes a new device's defaults once its handoff ends without an answer", async () => {
        rig.handoffs.add(NEW_KP3);
        const from = pair(NEW_KP3, "KPZ-3B1");
        await tick(35_000);
        expect(ledCmds(from)).toEqual([]);
        rig.handoffs.delete(NEW_KP3); // no other instance had it
        await tick(10_000);
        expect(ledCmds(from)).toContain("c4.kp.lf 00 000000");
        expect(rig.store.get(NEW_KP3, LED_DEFAULTS_KEY)).toBe("off");
    });

    it("keeps a colour the new device was given before the defaults ran", async () => {
        const from = pair(NEW_KP3, "KPZ-3B1");
        const p = rig.runtime.set(NEW_KP3, "button_1_idle_color", "red", {message: {button_1_idle_color: "red"}});
        await tick(35_000);
        await p;
        expect(rig.store.get(NEW_KP3, "button_1_idle_color")).toBe("red");
        expect(rig.store.get(NEW_KP3, "button_2_idle_color")).toBe("off");
        expect(ledCmds(from)).not.toContain("c4.kp.lf 00 000000");
        expect(ledCmds(from)).toContain("c4.kp.lf 01 000000");
    });
});