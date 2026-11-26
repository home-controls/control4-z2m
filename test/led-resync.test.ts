import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {SETTINGS_READ_KEY} from "../src/devices/dm";
import {DeliveryError, Rig, tick} from "./rig";

// The c4_device LED re-check sends every device its LED status again, changed or
// not. What a device was last sent is not sent again, so a re-check that finds
// nothing new costs no Zigbee frame; what was lost is sent again, and a device
// that rebooted is repainted. A lost status frame does not wait for the re-check:
// the extension paints the status again by itself (LED_HEAL_DELAYS), so the
// re-check is only a backstop and can be hourly.

let rig: Rig;
const KP3 = "0x000fff00000000c1";
const DIM = "0x000fff00000000b1";

beforeEach(async () => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(KP3, "KPZ-3B1");
    rig.add(DIM, "C4-DIM1-Z");
    rig.store.set(DIM, SETTINGS_READ_KEY, 1); // settings already read: only LED frames are counted here
    rig.start();
    await tick(35_000); // past the start-up sends
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const set = async (ieee: string, key: string, value: unknown) => {
    const p = rig.runtime.set(ieee, key, value, {message: {[key]: value}});
    await tick(500);
    return p;
};
const failing = (match: string) => {
    rig.transport.failWith = (frame) => (frame.data.toString("latin1").includes(match) ? new DeliveryError("no ack", "failed") : undefined);
};
/** The c4.dm.is reads since `from`: a DIM1-Z's LED read-back. */
const readBacks = (from: number) => rig.texts(from).filter((t) => t.startsWith("0g") && t.includes("c4.dm.is"));
const IS_RED = "00 64 02ee 07d0 ff0000 ff0000 ff0000 ff0000 03";

describe("stored LED colours (LedWriter)", () => {
    it("skips a colour a slot already shows, and a brightness change sends each colour it changes", async () => {
        await set(KP3, "button_2_idle_color", "amber");
        await set(KP3, "button_2_pressed_color", "white");
        let from = rig.transport.sent.length;
        await set(KP3, "button_2_idle_color", "amber");
        await set(KP3, "button_2_pressed_color", "white");
        expect(rig.cmds(from)).toEqual([]);
        await set(KP3, "led_brightness", 50);
        expect(rig.cmds(from)).toEqual(expect.arrayContaining(["c4.kp.lf 01 7f5f00", "c4.kp.lv 01 7f5f00", "c4.kp.lo 01 7f7f7f"]));
        from = rig.transport.sent.length;
        await set(KP3, "led_brightness", 50);
        expect(rig.cmds(from)).toEqual([]);
    });

    it("a brightness change sends a colour whose last write did not go out", async () => {
        failing("c4.kp.lo 01");
        await set(KP3, "button_2_pressed_color", "white");
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        await set(KP3, "led_brightness", 100); // the brightness it already has
        expect(rig.cmds(from)).toEqual(["c4.kp.lo 01 ffffff"]);
    });

    it("sends a colour again when its last write did not go out", async () => {
        failing("c4.kp.l");
        await set(KP3, "button_1_idle_color", "red");
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        await set(KP3, "button_1_idle_color", "red");
        expect(rig.cmds(from)).toEqual(["c4.kp.lf 00 ff0000", "c4.kp.lv 00 ff0000"]);
    });

    it("skips an unchanged DIM1-Z paddle colour", async () => {
        await set(DIM, "led_top_off_color", "blue");
        await tick(3000);
        const from = rig.transport.sent.length;
        await set(DIM, "led_top_off_color", "blue");
        await tick(3000);
        expect(rig.cmds(from)).toEqual([]);
    });
});

describe("the LED status layer (led_status)", () => {
    it("sends a keypad nothing for a status it already shows", async () => {
        await set(KP3, "led_status", {buttons: "1", color: "red"});
        const from = rig.transport.sent.length;
        await set(KP3, "led_status", {buttons: "1", color: "red"});
        expect(rig.cmds(from)).toEqual([]);
    });

    it("sends a keypad status frame again at the next paint when it did not go out", async () => {
        failing("c4.kp.lv");
        await set(KP3, "led_status", {buttons: "1", color: "green"});
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        await set(KP3, "led_status", {buttons: "1", color: "green"});
        expect(rig.cmds(from)).toEqual(["c4.kp.lv 00 00ff00"]);
    });

    it("reads a DIM1-Z back after a paint, and not after one that changes nothing", async () => {
        const start = rig.transport.sent.length;
        await set(DIM, "led_status", {color: "red"});
        await tick(3000);
        expect(readBacks(start).length).toBe(1);
        rig.reply(DIM, IS_RED);
        await tick(1000);
        const from = rig.transport.sent.length;
        await set(DIM, "led_status", {color: "red"});
        await tick(10_000);
        expect(rig.cmds(from)).toEqual([]);
    });

    it("reads a DIM1-Z back again at the next paint while its last read-back got no answer", async () => {
        await set(DIM, "led_status", {color: "red"});
        await tick(10_000); // the read-back goes unanswered
        let from = rig.transport.sent.length;
        await set(DIM, "led_status", {color: "red"});
        await tick(3000);
        expect(rig.cmds(from).filter((c) => c.startsWith("c4.dm.l"))).toEqual([]); // nothing to repaint
        expect(readBacks(from).length).toBe(1);
        rig.reply(DIM, IS_RED);
        await tick(1000);
        from = rig.transport.sent.length;
        await set(DIM, "led_status", {color: "red"});
        await tick(10_000);
        expect(readBacks(from)).toEqual([]); // confirmed now
    });

    it("rewrites a DIM1-Z slot its read-back finds lost, at the next paint after an unanswered one", async () => {
        await set(DIM, "led_status", {color: "red"});
        await tick(10_000);
        const from = rig.transport.sent.length;
        await set(DIM, "led_status", {color: "red"});
        await tick(3000);
        rig.reply(DIM, "00 64 02ee 07d0 ff0000 ff0000 ff0000 000000 03");
        await tick(1000);
        expect(rig.cmds(from)).toContain("c4.dm.l1f ff0000");
    });
});

describe("a status frame lost on the way (self-repaint, no led_status needed)", () => {
    const lv = (from: number) => rig.cmds(from).filter((c) => c.startsWith("c4.kp.lv"));
    /** Each try at a matching frame, delivered or not (a failed one is not in transport.sent). */
    const counting = (match: string) => {
        const tries = {n: 0};
        rig.transport.failWith = (frame) => {
            if (!frame.data.toString("latin1").includes(match)) return undefined;
            tries.n++;
            return new DeliveryError("no ack", "failed");
        };
        return tries;
    };
    /** Second by second until a DIM1-Z read-back has gone out since `from` (a self-repaint's is 30-36 s after the last one, plus its settle). */
    const untilReadBack = async (from: number, maxMs = 60_000) => {
        for (let t = 0; t < maxMs && readBacks(from).length === 0; t += 1000) await tick(1000);
        expect(readBacks(from).length).toBe(1);
    };

    it("sends a lost keypad status frame again by itself 30-36 s later", async () => {
        failing("c4.kp.lv");
        await set(KP3, "led_status", {buttons: "1", color: "green"});
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        await tick(29_000);
        expect(lv(from)).toEqual([]);
        await tick(8_000);
        expect(lv(from)).toEqual(["c4.kp.lv 00 00ff00"]);
        // It went out: nothing more.
        await tick(15 * 60_000);
        expect(lv(from)).toEqual(["c4.kp.lv 00 00ff00"]);
    });

    it("tries 3 times (30 s, 2 min, 10 min), then leaves it for the next led_status, which starts the tries afresh", async () => {
        const lvTries = counting("c4.kp.lv");
        await set(KP3, "led_status", {buttons: "1", color: "green"});
        expect(lvTries.n).toBe(1);
        await tick(29_000);
        expect(lvTries.n).toBe(1);
        await tick(8_000); // 37 s
        expect(lvTries.n).toBe(2);
        await tick(110_000); // 147 s: the 2-minute try comes 120-144 s after the first, at 150-180 s
        expect(lvTries.n).toBe(2);
        await tick(36_000); // 183 s
        expect(lvTries.n).toBe(3);
        await tick(560_000); // 743 s: the 10-minute one at 750-900 s
        expect(lvTries.n).toBe(3);
        await tick(160_000); // 903 s
        expect(lvTries.n).toBe(4);
        await tick(5 * 60_000);
        expect(lvTries.n).toBe(4);
        await set(KP3, "led_status", {buttons: "1", color: "green"});
        expect(lvTries.n).toBe(5);
        await tick(37_000);
        expect(lvTries.n).toBe(6);
    });

    it("paints nothing by itself when nothing was lost", async () => {
        await set(KP3, "led_status", {buttons: "1", color: "red"});
        await set(DIM, "led_status", {color: "red"});
        await tick(3000);
        rig.reply(DIM, IS_RED);
        await tick(1000);
        const from = rig.transport.sent.length;
        await tick(15 * 60_000);
        expect(rig.cmds(from).filter((c) => c.startsWith("c4.kp.") || c.startsWith("c4.dm.l") || c.startsWith("c4.dm.is"))).toEqual([]);
    });

    it("reads a DIM1-Z back again by itself while its read-back got no answer, until one confirms it", async () => {
        await set(DIM, "led_status", {color: "red"});
        await tick(10_000); // the read-back goes unanswered
        const from = rig.transport.sent.length;
        await tick(18_000);
        expect(readBacks(from)).toEqual([]);
        await untilReadBack(from);
        expect(rig.cmds(from).filter((c) => c.startsWith("c4.dm.l"))).toEqual([]); // nothing to repaint
        rig.reply(DIM, IS_RED);
        await tick(1000);
        await tick(15 * 60_000);
        expect(readBacks(from).length).toBe(1); // confirmed now
    });

    it("rewrites a DIM1-Z slot its own re-read finds lost", async () => {
        await set(DIM, "led_status", {color: "red"});
        await tick(10_000);
        const from = rig.transport.sent.length;
        await untilReadBack(from);
        rig.reply(DIM, "00 64 02ee 07d0 ff0000 ff0000 ff0000 000000 03");
        await tick(1000);
        expect(rig.cmds(from)).toContain("c4.dm.l1f ff0000");
    });

    it("reads an unanswered DIM1-Z 3 more times at most before leaving it for the next led_status", async () => {
        await set(DIM, "led_status", {color: "red"});
        await tick(10_000);
        const from = rig.transport.sent.length;
        await tick(2 * 60 * 60_000);
        expect(readBacks(from).length).toBe(3);
    });

    it("leaves an unreachable device's lost frame for its return (an announce repaints it)", async () => {
        const kp = rig.runtime.get(KP3);
        if (!kp) throw new Error("no KP3");
        rig.runtime.link.markUnreachable(kp, "answers nothing (test)");
        failing("c4.kp.lv");
        await set(KP3, "led_status", {buttons: "1", color: "green"});
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        await tick(15 * 60_000);
        expect(lv(from)).toEqual([]);
        rig.runtime.repaintLeds(KP3);
        await tick(31_000);
        expect(lv(from)).toEqual(["c4.kp.lv 00 00ff00"]);
    });
});

describe("a device that announces (back after a power cut)", () => {
    it("has its status LEDs repainted 20-30 s later, and its next stored colour sent", async () => {
        await set(KP3, "led_status", {buttons: "1", color: "red"});
        await set(KP3, "button_3_idle_color", "blue");
        const from = rig.transport.sent.length;
        rig.runtime.repaintLeds(KP3);
        await tick(15_000);
        expect(rig.cmds(from)).toEqual([]);
        await tick(16_000);
        expect(rig.cmds(from)).toEqual(["c4.kp.lv 00 ff0000"]);
        await set(KP3, "button_3_idle_color", "blue");
        expect(rig.cmds(from).slice(1)).toEqual(["c4.kp.lf 02 0000ff", "c4.kp.lv 02 0000ff"]);
    });

    it("has a DIM1-Z's status paddles repainted and attached again", async () => {
        await set(DIM, "led_status", {color: "red"});
        await tick(3000);
        rig.reply(DIM, IS_RED);
        await tick(1000);
        const from = rig.transport.sent.length;
        rig.runtime.repaintLeds(DIM);
        await tick(35_000);
        const cmds = rig.cmds(from);
        expect(cmds).toEqual(expect.arrayContaining(["c4.dm.l0o ff0000", "c4.dm.l0f ff0000", "c4.dm.l1o ff0000", "c4.dm.l1f ff0000", "c4.dm.lm 01"]));
        expect(readBacks(from).length).toBe(1);
    });
});

// 12 LEDs in push/release take 2 frames each: 24, over the TX_TARGET_MAX (16) one device
// may hold in the queue. The LED cut in half was counted as sent, so its idle colour never
// went out, and the last ones waited for Home Assistant's next led_status.
describe("a KC120277 status naming all 12 LEDs at once", () => {
    const KC = "0x000fff00000000e2";
    let kc: Rig;
    beforeEach(async () => {
        kc = new Rig();
        kc.add(KC, "C4-KC120277");
        kc.start();
        await tick(120_000); // past the settings read: the LED modes are known
    });
    afterEach(() => kc.stop());

    it("sends the LEDs that did not fit in the queue by itself 30-36 s later, both colours of each", async () => {
        const leds = (from: number) => kc.cmds(from).filter((c) => /^c4\.dmx\.led [0-9a-f]{2} 0[34] /.test(c));
        const from = kc.transport.sent.length;
        const p = kc.runtime.set(KC, "led_status", {buttons: "all", color: "red"}, {message: {}});
        await tick(5000);
        await p;
        const first = leds(from);
        expect(first.length).toBeLessThan(24);
        const rest = kc.transport.sent.length;
        await tick(40_000);
        const all = [...first, ...leds(rest)];
        for (let i = 0; i < 12; i++) {
            const id = i.toString(16).padStart(2, "0");
            expect(all, `LED ${i + 1}`).toEqual(expect.arrayContaining([`c4.dmx.led ${id} 03 ff0000`, `c4.dmx.led ${id} 04 ff0000`]));
        }
        // Nothing sent twice but the half-sent LED's pressed frame.
        expect(all.length).toBeLessThanOrEqual(25);
    });
});
