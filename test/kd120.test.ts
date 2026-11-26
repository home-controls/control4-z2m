/** The C4-KD120 keypad dimmer: an APD120's load and a KC120277's keypad in one device (built from notes, untested on hardware). */

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {GENERIC_MODEL, HA_PROFILE, modelInfo} from "../src/core/constants";
import {SETTINGS_READ_DELAY, SETTINGS_READ_KEY} from "../src/devices/dm";
import {Kd120} from "../src/devices/kd120";
import {buildDefinitions, kdExposes} from "../src/z2m/definitions";
import {Rig, tick} from "./rig";

let rig: Rig;
const KD = "0x000fff00000000d1";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const set = (key: string, value: unknown, message: Record<string, unknown> = {[key]: value}) => rig.runtime.set(KD, key, value, {message});

/** Answer every Get the device sends, by its property (and arguments), for `ms`. Unlisted ones answer n01. */
async function answerGets(replies: Record<string, string>, ms: number): Promise<string[]> {
    const asked: string[] = [];
    const answered = new Set<string>();
    const end = Date.now() + ms;
    while (Date.now() < end) {
        for (const t of rig.texts()) {
            if (!t.startsWith("0g") || answered.has(t.slice(0, 6))) continue;
            answered.add(t.slice(0, 6));
            const prop = t.slice(7);
            asked.push(prop);
            const value = replies[prop];
            if (value === undefined) rig.ascii(KD, `0r${t.slice(2, 6)} n01`);
            else rig.ascii(KD, `0r${t.slice(2, 6)} 000 ${prop.split(" ")[0]} ${value}`.trim());
        }
        await tick(100);
    }
    return asked;
}

describe("C4-KD120 keypad dimmer", () => {
    it("is adopted from its check-in, colour suffix and all", async () => {
        expect(modelInfo("C4-KD120-WH")?.family).toBe("kd120");
        expect(modelInfo("C4-KD277")?.family).toBe("kd120");
        rig.add(KD, GENERIC_MODEL);
        rig.start();
        rig.checkin(KD, "c4:control4_light:C4-KD120-WH");
        await tick(10);
        expect(rig.runtime.get(KD)).toBeInstanceOf(Kd120);
        expect(rig.devices.get(KD)?.modelID).toBe("C4-KD120");
    });

    describe("running", () => {
        beforeEach(() => {
            rig.add(KD, "C4-KD120");
            rig.start();
        });

        it("tracks its load and power from c4.dmx.ls, as an APD120", () => {
            rig.ascii(KD, "0t5902 sa c4.dmx.ls 00 00 64 007d 013f 001c 0028 02bb 07d0 0000");
            expect(rig.last(KD)).toMatchObject({state: "ON", brightness: 254, voltage: 125, power: 28});
            rig.ascii(KD, "0t5903 sa c4.dmx.ls 00 00 00 00");
            expect(rig.last(KD).state).toBe("OFF");
        });

        it("drives the load with a ZCL level command, as an APD120", async () => {
            const from = rig.transport.sent.length;
            const p = set("brightness", 127, {state: "ON", brightness: 127});
            await tick(50);
            await p;
            const zcl = rig.transport.sent.slice(from).find((s) => s.frame.profile === HA_PROFILE);
            expect(zcl?.frame.cluster).toBe(0x0008);
        });

        it("names its buttons as a KC120277 does, learns them, and leaves the load's state to its report", () => {
            rig.ascii(KD, "0t0001 sa c4.dmx.cc 02 01");
            expect(rig.actions(KD)).toEqual(["button_2_single"]);
            expect((rig.runtime.get(KD) as Kd120).fittedWires()).toEqual([2]);
            expect(rig.last(KD).state).toBeUndefined();
        });

        it("names an auxiliary keypad's presses (wires 07 / 08) apart from its own buttons, and learns no button from them", () => {
            rig.ascii(KD, "0t0001 sa c4.dmx.cc 07 01");
            rig.ascii(KD, "0t0002 sa c4.dmx.cc 08 02");
            expect(rig.actions(KD)).toEqual(["aux_top_single", "aux_bottom_double"]);
            expect((rig.runtime.get(KD) as Kd120).fittedWires()).toBeUndefined();
        });

        it("shows every position's button behaviour as toggle until read", () => {
            const state = rig.last(KD);
            for (let n = 1; n <= 7; n++) expect(state[`button_position_${n}_behaviour`]).toBe("toggle");
        });

        it("sets a position's button behaviour with c4.dmx.btn, never as 05", async () => {
            const from = rig.texts().length;
            const p = set("button_position_3_behaviour", "event_only");
            await tick(50);
            expect(await p).toEqual({button_position_3_behaviour: "event_only"});
            expect(rig.cmds(from)[0]).toBe("c4.dmx.btn 02 01 03");
            await expect(set("button_position_3_behaviour", "disabled")).rejects.toThrow(/unknown button behaviour/);
        });
    });

    it("reads its settings once: the APD120's tv table and phase, the KC120277's, each position's behaviour, and its fault", async () => {
        rig.add(KD, "C4-KD120");
        rig.start();
        await tick(SETTINGS_READ_DELAY - 1000);
        const replies: Record<string, string> = {
            "c4.dm.is": "00 50 01f4 01f4 1388 1388 64 01 0a 00 0000",
            "c4.dmx.blc 00 05": "000000",
            "c4.dmx.blc 00 03": "ff",
            "c4.dmx.dim": "01",
            "c4.dmx.warn 00": "00 0000",
            "c4.sy.ri": "\" SW RBT\"",
        };
        for (let w = 0; w < 7; w++) replies[`c4.dmx.btn 0${w} 01`] = w === 0 ? "02" : "03";
        const asked = await answerGets(replies, 30_000);
        expect(asked).toEqual(expect.arrayContaining(["c4.dm.is", "c4.dmx.btn 00 01", "c4.dmx.btn 06 01", "c4.dmx.blc 00 05", "c4.dmx.dim", "c4.dmx.warn 00"]));
        expect(rig.last(KD)).toMatchObject({
            default_on_brightness: 80,
            min_brightness: 10,
            dimming_phase: "forward",
            backlight_color: "off",
            button_position_1_behaviour: "toggle",
            button_position_2_behaviour: "event_only",
            fault: false,
        });
        expect(rig.store.get(KD, SETTINGS_READ_KEY)).toBeTypeOf("number");
    });
});

describe("C4-FPD120", () => {
    it("is an APD120 under its own model", async () => {
        const FPD = "0x000fff00000000d2";
        rig.add(FPD, GENERIC_MODEL);
        rig.start();
        rig.checkin(FPD, "c4:control4_light:C4-FPD120");
        await tick(10);
        expect(rig.runtime.get(FPD)?.family).toBe("apd120");
        expect(rig.devices.get(FPD)?.modelID).toBe("C4-FPD120");
        expect(buildDefinitions().find((d: {model: string}) => d.model === "C4-FPD120")?.zigbeeModel).toEqual(["C4-FPD120"]);
    });
});

describe("C4-KD120 definition", () => {
    it("exposes a light, the keypad, power and each position's behaviour until its buttons are known", () => {
        const props = kdExposes({wires: undefined, numbering: "pairs"}).map((x) => (x as {property?: string; type?: string}).property ?? (x as {type: string}).type);
        expect(props).toEqual(expect.arrayContaining(["light", "action", "backlight_color", "power", "dimming_phase", "fault", "button_position_1_behaviour", "button_position_7_behaviour"]));
    });

    it("narrows the behaviours to the fitted buttons", () => {
        const props = kdExposes({wires: [0, 6], numbering: "pairs"}).map((x) => (x as {property?: string}).property);
        expect(props).toContain("button_position_7_behaviour");
        expect(props).not.toContain("button_position_3_behaviour");
    });

    it("has actions for an auxiliary keypad", () => {
        const action = kdExposes({wires: [0, 2], numbering: "pairs"}).find((x) => (x as {property?: string}).property === "action") as {values: string[]};
        expect(action.values).toEqual(expect.arrayContaining(["button_1_single", "button_2_hold", "aux_top_single", "aux_bottom_double"]));
    });

    it("is built for every alias", () => {
        const def = buildDefinitions().find((d: {model: string}) => d.model === "C4-KD120");
        expect(def.zigbeeModel).toEqual(["C4-KD120", "C4-KD277", "C4-KD240"]);
        expect(def.description).toContain("untested");
    });
});
