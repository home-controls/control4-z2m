import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Rig, tick} from "./rig";

let rig: Rig;
const KP3 = "0x000fff00000000c1";
const KP6 = "0x000fff00000000c2";
const KC = "0x000fff00000000c3";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(KP3, "KPZ-3B1");
    rig.add(KP6, "C4-KP6-Z");
    rig.add(KC, "C4-KC120277");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const set = (ieee: string, key: string, value: unknown) => rig.runtime.set(ieee, key, value, {message: {[key]: value}});

describe("KP3-Z / KP6-Z c4.kp.* frames", () => {
    it.each([KP3, KP6])("a tap is press, release, then the click count (%s)", (ieee) => {
        for (const f of ["c4.kp.bb 00", "c4.kp.bc 00", "c4.kp.cc 00 01"]) rig.ascii(ieee, `0t0001 sa ${f}`);
        expect(rig.actions(ieee)).toEqual(["button_1_press", "button_1_release", "button_1_single"]);
    });

    it.each([KP3, KP6])("bh repeats are holds and be is the hold release (%s)", (ieee) => {
        for (const f of ["c4.kp.bb 01", "c4.kp.bh 01", "c4.kp.bh 01", "c4.kp.be 01"]) rig.ascii(ieee, `0t0001 sa ${f}`);
        expect(rig.actions(ieee)).toEqual(["button_2_press", "button_2_hold", "button_2_hold", "button_2_hold_release"]);
    });

    it("waits for the tap release before the fast tap once releases are known", async () => {
        rig.ascii(KP6, "0t0001 sa c4.kp.bb 05");
        rig.ascii(KP6, "0t0001 sa c4.kp.bc 05");
        await tick(600);
        rig.ascii(KP6, "0t0002 sa c4.kp.bb 05");
        rig.ascii(KP6, "0t0002 sa c4.kp.bh 05");
        await tick(1000);
        expect(rig.actions(KP6).filter((a) => a.includes("fast"))).toEqual(["button_6_fast_single"]);
    });

    it("publishes a late release, then its known tap, before the fast count it closes", async () => {
        rig.ascii(KP6, "0t0001 sa c4.kp.bb 05");
        rig.ascii(KP6, "0t0001 sa c4.kp.bc 05");
        await tick(600);
        rig.ascii(KP6, "0t0002 sa c4.kp.bb 05");
        await tick(600);
        rig.ascii(KP6, "0t0002 sa c4.kp.bc 05");
        expect(rig.actions(KP6).slice(-4)).toEqual(["button_6_press", "button_6_release", "button_6_tap_known", "button_6_fast_single"]);
        expect(
            rig.events
                .filter((e) => e.ieee === KP6)
                .map((e) => e.action)
                .slice(-4),
        ).toEqual(["button_6_press", "button_6_release", "button_6_tap_known", "button_6_fast_single"]);
    });

    it("counts a tap after a lost release as a new single tap", async () => {
        rig.ascii(KP6, "0t0001 sa c4.kp.bb 05");
        rig.ascii(KP6, "0t0001 sa c4.kp.bc 05");
        await tick(600);
        rig.ascii(KP6, "0t0002 sa c4.kp.bb 05");
        await tick(1500);
        rig.ascii(KP6, "0t0003 sa c4.kp.bb 05");
        rig.ascii(KP6, "0t0003 sa c4.kp.bc 05");
        await tick(600);
        expect(rig.actions(KP6).filter((a) => a.includes("fast"))).toEqual(["button_6_fast_single", "button_6_fast_single"]);
    });

    it("writes idle (lf + live lv) and pressed (lo) colours", async () => {
        let p = set(KP3, "button_2_idle_color", "amber");
        await tick(200);
        expect(await p).toEqual({button_2_idle_color: "amber"});
        expect(rig.cmds().slice(-2)).toEqual(["c4.kp.lf 01 ffbf00", "c4.kp.lv 01 ffbf00"]);
        p = set(KP3, "button_2_pressed_color", "white");
        await tick(200);
        expect(rig.cmds().at(-1)).toBe("c4.kp.lo 01 ffffff");
    });

    it("crossfades the idle colour when a transition is set", async () => {
        await set(KP3, "led_transition", 1).then(() => undefined);
        let p = set(KP3, "button_1_idle_color", "red");
        await tick(200);
        await p;
        const from = rig.transport.sent.length;
        p = set(KP3, "button_1_idle_color", "blue");
        await tick(3000);
        await p;
        const lv = rig.cmds(from).filter((c) => c.startsWith("c4.kp.lv 00"));
        expect(lv.length).toBe(20);
        expect(lv.at(-1)).toBe("c4.kp.lv 00 0000ff");
    });

    it("sends the controller identity proactively after start", async () => {
        // 12-32 s jittered start, then three sends 4 s apart.
        await tick(45_000);
        expect(rig.transport.sent.filter((s) => s.frame.profile === 0xc25d).length).toBeGreaterThanOrEqual(6);
    });
});

describe("KC120277", () => {
    it("routes by position: ids 0, 2, 4 are buttons 1, 2, 3", () => {
        for (const f of ["c4.dmx.cc 00 01", "c4.dmx.cc 02 02", "c4.dmx.bp 04", "c4.dmx.tc 04"]) rig.ascii(KC, `0t0001 sa ${f}`);
        expect(rig.actions(KC)).toEqual(["button_1_single", "button_2_double", "button_3_press"]);
    });

    it("numbers every slot with button_numbering: slots (four singles over a double)", () => {
        rig.stop();
        rig = new Rig();
        rig.add(KC, "C4-KC120277", {options: {button_numbering: "slots"}});
        rig.start();
        for (const id of ["00", "01", "02", "03", "04"]) rig.ascii(KC, `0t0001 sa c4.dmx.bp ${id}`);
        expect(rig.actions(KC)).toEqual(["button_1_press", "button_2_press", "button_3_press", "button_4_press", "button_5_press"]);
    });

    it("writes per-slot colours on the dmx protocol", async () => {
        const p = set(KC, "led_7_pressed_color", "green");
        await tick(200);
        expect(await p).toEqual({led_7_pressed_color: "green"});
        expect(rig.cmds()).toContain("c4.dmx.led 06 03 00ff00");
    });
});
describe("initial state", () => {
    const initial = (ieee: string) => rig.published.find((p) => p.ieee === ieee && "led_brightness" in p.payload)?.payload ?? {};

    it("publishes every KC120277 LED colour key, null when never set", () => {
        const s = initial(KC);
        for (let i = 1; i <= 12; i++) {
            expect(s).toHaveProperty(`led_${i}_idle_color`, null);
            expect(s).toHaveProperty(`led_${i}_pressed_color`, null);
        }
    });

    it("publishes KP button colour keys, keeping stored ones", async () => {
        const p = set(KP3, "button_2_idle_color", "amber");
        await tick(1000);
        await p;
        rig.stop();
        rig = new Rig({store: rig.store});
        rig.add(KP3, "KPZ-3B1");
        rig.start();
        const s = initial(KP3);
        expect(s).toMatchObject({button_1_idle_color: null, button_2_idle_color: "amber", button_3_pressed_color: null});
    });
});
