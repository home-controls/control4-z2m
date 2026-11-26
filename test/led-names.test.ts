// led_status by button name (#22): a button's name, as c4_device numbers its
// buttons (button_N) or as a paddle's events name its halves (top / bottom),
// paints that button's LED, so nobody has to pick its colour selects.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Rig, tick} from "./rig";

const KP3 = "0x000fff00000000c1";
const KC = "0x000fff00000000c3";
const KC_SLOTS = "0x000fff00000000c4";
const DIM = "0x000fff00000000d1";

let rig: Rig;

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(KP3, "KPZ-3B1");
    rig.add(KC, "C4-KC120277");
    rig.add(KC_SLOTS, "C4-KC120277", {options: {button_numbering: "slots"}});
    rig.add(DIM, "C4-DIM1-Z");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

/** Paint `buttons` red, as c4_device's led_status does, and return the LEDs (device ids) the status now holds. */
async function paint(ieee: string, buttons: string): Promise<string[]> {
    const done = rig.runtime.set(ieee, "led_status", {buttons, color: "red"}, {message: {}});
    await tick(3_000);
    await done;
    return Object.keys(rig.runtime.anim.get(ieee)?.state().status ?? {});
}

describe("led_status by button name", () => {
    it("lights LED N for a keypad's button_N", async () => {
        expect(await paint(KP3, "button_2")).toEqual(["1"]);
    });

    it("lights the first slot of the pair for a KC120277's button_N under pairs numbering", async () => {
        expect(await paint(KC, "button_2")).toEqual(["2"]);
        expect(await paint(KC, "button_3")).toEqual(["2", "4"]);
    });

    it("lights slot N for a KC120277's button_N under slots numbering", async () => {
        expect(await paint(KC_SLOTS, "button_2")).toEqual(["1"]);
    });

    it("lights a DIM1-Z's top LED for button_1 or top, and its bottom LED for button_2 or bottom", async () => {
        expect(await paint(DIM, "button_2")).toEqual(["1"]);
        expect(await paint(DIM, "top")).toEqual(["0", "1"]);
    });

    it("takes LED numbers and names in one call", async () => {
        expect(await paint(KC, "button_1,4")).toEqual(["0", "3"]);
    });

    it("skips, with a warning, a name the device has no button for", async () => {
        expect(await paint(KP3, "button_5")).toEqual([]);
        expect(rig.log.lines.some((l) => /^warning: Control4 LED \[.+\]: no button 'button_5'/.test(l))).toBe(true);
    });
});
