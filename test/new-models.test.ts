/** Models built from other projects' notes, untested on hardware: C4-KP2-Z, C4-V-ROSW120, LOZ-5D1-W. */

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {GENERIC_MODEL, HA_PROFILE} from "../src/core/constants";
import {Keypad} from "../src/devices/keypad";
import {OutletDimmer} from "../src/devices/outlet-dimmer";
import {ROSW_READBACK_DELAY, Rosw120} from "../src/devices/rosw120";
import {buildDefinitions} from "../src/z2m/definitions";
import {Rig, tick} from "./rig";

let rig: Rig;
const KP2 = "0x000fff00000000e1";
const ROSW = "0x000fff00000000e2";
const LOZ = "0x000fff00000000e3";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const set = (ieee: string, key: string, value: unknown, message: Record<string, unknown> = {[key]: value}, endpoint?: string) =>
    rig.runtime.set(ieee, key, value, {message, endpoint});

const def = (model: string) => buildDefinitions().find((d: {model: string}) => d.model === model);

describe("C4-KP2-Z", () => {
    it("is adopted from its check-in", async () => {
        rig.add(KP2, GENERIC_MODEL);
        rig.start();
        rig.checkin(KP2, "c4:control4_keypad:C4-KP2-Z");
        await tick(10);
        expect(rig.runtime.get(KP2)).toBeInstanceOf(Keypad);
        expect(rig.runtime.get(KP2)?.family).toBe("kp2");
    });

    it("names ids 00 and 02 button_1 and button_2, from the c4.kp frames", () => {
        rig.add(KP2, "C4-KP2-Z");
        rig.start();
        rig.ascii(KP2, "0tfd02 sa c4.kp.cc 00 01");
        rig.ascii(KP2, "0tfd05 sa c4.kp.cc 02 02");
        expect(rig.actions(KP2)).toEqual(["button_1_single", "button_2_double"]);
    });

    it("lights button_2's LED on slot 02", async () => {
        rig.add(KP2, "C4-KP2-Z");
        rig.start();
        const from = rig.texts().length;
        const p = set(KP2, "button_2_idle_color", "red");
        await tick(500);
        await p;
        expect(rig.cmds(from)).toContain("c4.kp.lf 02 ff0000");
    });

    it("has two buttons' colours and actions", () => {
        const keys = def("C4-KP2-Z").exposes.map((x: {property?: string}) => x.property);
        expect(keys).toEqual(expect.arrayContaining(["button_1_idle_color", "button_2_pressed_color"]));
        expect(keys).not.toContain("button_3_idle_color");
    });
});

describe("C4-V-ROSW120", () => {
    beforeEach(() => {
        rig.add(ROSW, "C4-V-ROSW120");
        rig.zcl.set(ROSW, {genOnOff: {onOff: 0}});
        rig.start();
    });

    it("is a Rosw120", () => {
        expect(rig.runtime.get(ROSW)).toBeInstanceOf(Rosw120);
    });

    it("switches with ZCL On/Off on EP1, no default response, and reads its state back", async () => {
        const from = rig.transport.sent.length;
        const p = set(ROSW, "state", "ON");
        await tick(50);
        expect(await p).toEqual({state: "ON"});
        const zcl = rig.transport.sent.slice(from).find((s) => s.frame.profile === HA_PROFILE);
        expect(zcl?.frame.cluster).toBe(0x0006);
        expect(zcl?.frame.dstEp).toBe(1);
        expect(zcl?.frame.data[0]).toBe(0x11);
        expect(zcl?.frame.data[2]).toBe(0x01);
        // It never reports: the read back says what it did (here, it stayed off).
        const reads = rig.zclReads.length;
        await tick(ROSW_READBACK_DELAY + 100);
        expect(rig.zclReads.length).toBe(reads + 1);
        expect(rig.last(ROSW).state).toBe("OFF");
    });

    it("takes the state its button left from c4.dmx.tc, and its taps as button_1", async () => {
        rig.ascii(ROSW, "0t0001 sa c4.dmx.bp 00");
        rig.ascii(ROSW, "0t0002 sa c4.dmx.tc 00 64");
        expect(rig.last(ROSW).state).toBe("ON");
        rig.ascii(ROSW, "0t0003 sa c4.dmx.cc 00 01");
        expect(rig.actions(ROSW)).toEqual(expect.arrayContaining(["button_1_press", "button_1_single"]));
        rig.ascii(ROSW, "0t0004 sa c4.dmx.tc 00 00");
        expect(rig.last(ROSW).state).toBe("OFF");
    });

    it("has a switch and a button", () => {
        const d = def("C4-V-ROSW120");
        expect(d.exposes.map((x: {type: string}) => x.type)).toEqual(expect.arrayContaining(["switch"]));
        expect(d.zigbeeModel).toEqual(["C4-V-ROSW120"]);
    });
});

describe("LOZ-5D1-W", () => {
    beforeEach(() => {
        rig.add(LOZ, "LOZ-5D1-W");
        rig.start();
    });

    it("is an OutletDimmer", () => {
        expect(rig.runtime.get(LOZ)).toBeInstanceOf(OutletDimmer);
    });

    it("sets each outlet's level with c4.dm.tv on its channel", async () => {
        const from = rig.texts().length;
        const p1 = set(LOZ, "brightness", 127, {state: "ON", brightness: 127}, "l1");
        await tick(100);
        expect(await p1).toEqual({state: "ON", brightness: 127});
        const p2 = set(LOZ, "state", "OFF", {state: "OFF"}, "l2");
        await tick(100);
        expect(await p2).toEqual({state: "OFF"});
        expect(rig.cmds(from)).toEqual(["c4.dm.tv 00 00 32", "c4.dm.tv 01 00 00"]);
    });

    it("fades with 0i c4.dm.rtl for a transition", async () => {
        const from = rig.texts().length;
        const p = set(LOZ, "brightness", 254, {brightness: 254, transition: 2}, "l2");
        await tick(100);
        await p;
        const sent = rig.texts(from);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatch(/^0i[0-9a-f]{4} c4\.dm\.rtl 01 64 000007d0$/);
    });

    it("turns on at the last level it had", async () => {
        rig.ascii(LOZ, "0t0001 sa c4.dm.tc 01 19");
        rig.ascii(LOZ, "0t0002 sa c4.dm.tc 01 00");
        const from = rig.texts().length;
        const p = set(LOZ, "state", "ON", {state: "ON"}, "l2");
        await tick(100);
        expect(await p).toEqual({state: "ON", brightness: 64});
        expect(rig.cmds(from)).toEqual(["c4.dm.tv 01 00 19"]);
    });

    it("publishes each outlet's c4.dm.tc as its light state", () => {
        rig.ascii(LOZ, "0t0001 sa c4.dm.tc 00 64");
        rig.ascii(LOZ, "0t0002 sa c4.dm.tc 01 00");
        expect(rig.last(LOZ)).toMatchObject({state_l1: "ON", brightness_l1: 254, state_l2: "OFF"});
    });

    it("reads both levels with Gets at start", async () => {
        await tick(10_000);
        const gets = () => rig.texts().filter((t) => t.startsWith("0g") && t.includes("c4.dm.tv"));
        expect(gets().at(-1)).toMatch(/c4\.dm\.tv 00 00$/);
        rig.reply(LOZ, "32");
        await tick(100);
        expect(gets().at(-1)).toMatch(/c4\.dm\.tv 01 00$/);
        rig.reply(LOZ, "00");
        await tick(100);
        expect(rig.last(LOZ)).toMatchObject({state_l1: "ON", brightness_l1: 127, state_l2: "OFF"});
    });

    it("has two lights on l1 / l2", () => {
        const d = def("LOZ-5D1-W");
        expect(d.meta).toEqual({multiEndpoint: true});
        expect(d.endpoint()).toEqual({l1: 1, l2: 11});
        expect(d.exposes.filter((x: {type: string}) => x.type === "light").map((x: {endpoint?: string}) => x.endpoint)).toEqual(["l1", "l2"]);
    });
});
