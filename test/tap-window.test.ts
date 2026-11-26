/** The tap window as a per-device Zigbee2MQTT option (`tap_window`, seconds). */

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Rig, tick} from "./rig";

/** The real clock, taken before fake timers replace `process.hrtime`. */
const realClock = process.hrtime.bigint;

let rig: Rig;
const KP6 = "0x000fff00000000c2";
const KC = "0x000fff00000000c3";
const DIM = "0x000fff00000000c4";
const APD = "0x000fff00000000c5";
const SW = "0x000fff00000000c6";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(KP6, "C4-KP6-Z");
    rig.add(KC, "C4-KC120277");
    rig.add(DIM, "C4-DIM1-Z");
    rig.add(APD, "C4-APD120");
    rig.add(SW, "C4-SW120277");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const fastCounts = (ieee: string) => rig.actions(ieee).filter((a) => a.includes("fast"));

/** One press frame; resolves with the ms until the device's next fast count. */
async function tapTiming(ieee: string, press: string): Promise<number> {
    const before = fastCounts(ieee).length;
    rig.ascii(ieee, `0t0001 sa ${press}`);
    for (let ms = 1; ms <= 3000; ms++) {
        await tick(1);
        if (fastCounts(ieee).length > before) return ms;
    }
    throw new Error("no fast count");
}

const setWindow = (ieee: string, value: unknown) => {
    (rig.devices.get(ieee) as {options: Record<string, unknown>}).options.tap_window = value;
};

describe("tap window option", () => {
    it.each([
        ["KP6", KP6, "c4.kp.bb 05"],
        ["KC120277", KC, "c4.dmx.bp 04"],
        ["DIM1-Z", DIM, "c4.dm.b0c"],
        ["APD120", APD, "c4.dmx.bp 01"],
        ["SW120277", SW, "c4.dmx.bp 05"],
    ])("closes a %s tap sequence after the device's own tap window", async (_family, ieee, press) => {
        setWindow(ieee, 1);
        expect(await tapTiming(ieee, press)).toBe(1000);
    });

    it("leaves other devices on their own window", async () => {
        setWindow(KP6, 1);
        expect(await tapTiming(KC, "c4.dmx.bp 04")).toBe(550);
    });

    it("is 0.55 s when the option is unset", async () => {
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(550);
    });

    it("clamps a window below 0.25 s up to 0.25 s", async () => {
        setWindow(KP6, 0.1);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(250);
    });

    it("clamps a window above 1.5 s down to 1.5 s", async () => {
        setWindow(KP6, 5);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(1500);
    });

    it.each([
        [Number.POSITIVE_INFINITY, 1500],
        [Number.NEGATIVE_INFINITY, 250],
        [`${"9".repeat(400)}`, 1500],
    ])("clamps an infinite window (%s) like any other out-of-range one", async (value, ms) => {
        setWindow(KP6, value);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(ms);
    });

    it.each([["slow"], [" "], ["0x1"], ["1.0 "], [false], [true], [[]], [[1]]])("ignores a value that is not a number (%j)", async (value: unknown) => {
        setWindow(KP6, value);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(550);
    });

    it.each([
        ["0.8", 800],
        ["1", 1000],
        ["-1", 250],
        [".5", 500],
        ["1.", 1000],
        ["+1", 1000],
    ])("reads a number written as text (%j)", async (value, ms) => {
        setWindow(KP6, value);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(ms);
    });

    it("reads a huge digit string without stalling the press", async () => {
        setWindow(KP6, `${"1".repeat(100_000)}x`);
        const start = realClock();
        rig.ascii(KP6, "0t0001 sa c4.kp.bb 05");
        const ms = Number(realClock() - start) / 1e6;
        expect(ms).toBeLessThan(250);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(550);
    });

    it.each([null, ""])("treats a cleared option (%j) as unset", async (cleared) => {
        setWindow(KP6, cleared);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(550);
    });

    it("applies a changed window to the next tap sequence", async () => {
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(550);
        setWindow(KP6, 1.2);
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(1200);
    });

    it("keeps an open tap sequence on the window it started with", async () => {
        setWindow(KP6, 1);
        rig.ascii(KP6, "0t0001 sa c4.kp.bb 05");
        await tick(500);
        setWindow(KP6, 0.25);
        // The second tap of the sequence still waits the 1 s it started with.
        expect(await tapTiming(KP6, "c4.kp.bb 05")).toBe(1000);
        expect(fastCounts(KP6)).toEqual(["button_6_fast_double"]);
    });
});
