import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Link, TX_SLOT_HOLD_MAX, TX_WINDOW} from "../src/core/link";
import {captureLogger, Rig, tick} from "./rig";

// The send window: the coordinator's NCP holds every unicast until its APS ack.
// A burst - every c4_device automation repainting at the 21:00 / 07:00 night
// switch - put ~23 frames in flight at once and ran it out of buffers. At most
// TX_WINDOW Control4 frames now wait for delivery at once, one per device; a
// load command and the controller identity never wait for the window.

let log: ReturnType<typeof captureLogger>;
let link: Link;
let started: string[];

beforeEach(() => {
    vi.useFakeTimers();
    log = captureLogger();
    link = new Link({log, devices: () => [], mtorr: async () => true, now: () => Date.now()});
    started = [];
});

afterEach(() => {
    link.stop();
    vi.useRealTimers();
});

const dev = (n: number) => `0x000fff00000000${n.toString(16).padStart(2, "0")}`;

/** A send that stays in flight until `confirm` (delivered) or `fail`. */
function send(ieee: string, label: string, urgent = false) {
    let confirm: () => void = () => undefined;
    let fail: (e: Error) => void = () => undefined;
    const delivered = new Promise<void>((resolve, reject) => {
        confirm = resolve;
        fail = reject;
    });
    const done = link.transmit(
        ieee,
        () => {
            started.push(label);
            return delivered;
        },
        urgent,
    );
    done.catch(() => undefined);
    return {confirm, fail, done};
}

describe("send window", () => {
    it(`keeps at most ${TX_WINDOW} frames waiting for delivery, across all devices`, async () => {
        const sends = Array.from({length: TX_WINDOW + 2}, (_, i) => send(dev(i), `d${i}`));
        await tick(500);
        expect(started).toEqual(["d0", "d1", "d2", "d3"]);
        sends[1].confirm();
        await tick(100);
        expect(started).toEqual(["d0", "d1", "d2", "d3", "d4"]);
        expect(link.summary()).toMatchObject({tx_in_flight: TX_WINDOW, tx_waiting: 1});
    });

    it("sends one frame per device at a time", async () => {
        const a1 = send(dev(1), "a1");
        send(dev(1), "a2");
        send(dev(2), "b1");
        await tick(500);
        expect(started).toEqual(["a1", "b1"]);
        a1.confirm();
        await tick(100);
        expect(started).toEqual(["a1", "b1", "a2"]);
    });

    it("lets a load command past a full window", async () => {
        for (let i = 0; i < TX_WINDOW; i++) send(dev(i), `led${i}`);
        send(dev(8), "led8");
        await tick(500);
        const load = link.sendWithRecovery(dev(9), () => send(dev(9), "load").done, "level command");
        await tick(100);
        expect(started).toEqual(["led0", "led1", "led2", "led3", "load"]);
        void load.catch(() => undefined);
    });

    it("lets an urgent frame (the controller identity) past a full window", async () => {
        for (let i = 0; i < TX_WINDOW; i++) send(dev(i), `led${i}`);
        send(dev(8), "led8");
        await tick(500);
        send(dev(9), "identity", true);
        await tick(100);
        expect(started).toEqual(["led0", "led1", "led2", "led3", "identity"]);
    });

    it("holds a load command only for its own device's frame in flight", async () => {
        const leds = Array.from({length: TX_WINDOW}, (_, i) => send(dev(i), `led${i}`));
        await tick(500);
        void link.sendWithRecovery(dev(0), () => send(dev(0), "load").done, "level command").catch(() => undefined);
        await tick(100);
        expect(started).not.toContain("load");
        leds[0].confirm();
        await tick(100);
        expect(started.at(-1)).toBe("load");
    });

    it(`gives a slot back after ${TX_SLOT_HOLD_MAX / 1000} s with no delivery confirmation`, async () => {
        for (let i = 0; i < TX_WINDOW; i++) send(dev(i), `lost${i}`);
        send(dev(8), "next");
        await tick(TX_SLOT_HOLD_MAX - 200);
        expect(started).not.toContain("next");
        await tick(400);
        expect(started).toContain("next");
    });

    it("frees the slot of a send that failed, and the failure reaches the caller", async () => {
        const sends = Array.from({length: TX_WINDOW}, (_, i) => send(dev(i), `d${i}`));
        send(dev(8), "next");
        await tick(500);
        sends[2].fail(new Error("no ack"));
        await expect(sends[2].done).rejects.toThrow("no ack");
        await tick(100);
        expect(started).toContain("next");
    });

    it("rejects the frames still waiting when the link stops", async () => {
        for (let i = 0; i < TX_WINDOW; i++) send(dev(i), `d${i}`);
        const waiting = send(dev(8), "never");
        await tick(500);
        link.stop();
        await expect(waiting.done).rejects.toThrow(/stopped/);
        expect(started).not.toContain("never");
    });

    it("warns once frames wait 10 s or more for the window", async () => {
        for (let i = 0; i < 24; i++) send(dev(i), `lost${i}`);
        await tick(9_000);
        expect(log.lines.some((l) => l.includes("transmit backlog"))).toBe(false);
        await tick(9_000);
        expect(log.lines.filter((l) => l.includes("transmit backlog"))).toHaveLength(1);
    });
});

describe("send window on a repaint of many dimmers", () => {
    let rig: Rig;
    const DIMS = Array.from({length: 8}, (_, i) => `0x000fff00000001${i.toString(16).padStart(2, "0")}`);

    beforeEach(async () => {
        rig = new Rig();
        for (const d of DIMS) rig.add(d, "C4-DIM1-Z");
        rig.start();
        await tick(60_000); // past the start-up reads
        rig.transport.latency = 400; // a slow mesh: at a 20 ms gap alone, ~20 frames would be in flight
    });

    afterEach(() => rig.stop());

    it(`never has more than ${TX_WINDOW} LED frames in flight, and a paddle command still goes out at once`, async () => {
        rig.transport.maxInFlight = 0;
        const from = rig.transport.sent.length;
        const paints = DIMS.map((d) => rig.runtime.set(d, "led_status", {buttons: "1,2", color: "green", brightness: 60}, {message: {}}));
        await tick(150);
        const load = rig.runtime.set(DIMS[0], "state", "OFF", {message: {state: "OFF"}});
        await tick(300);
        const isLevel = (s: {frame: {profile: number}}) => s.frame.profile === 0x0104;
        expect(rig.transport.sent.slice(from).some(isLevel)).toBe(true);
        await tick(20_000);
        await Promise.allSettled([...paints, load]);
        const after = rig.transport.sent.slice(from);
        const isLed = (s: {text: string}) => / c4\.dm\.l\d[of] /.test(s.text);
        expect(after.filter(isLed).length).toBeGreaterThanOrEqual(DIMS.length * 2);
        // The paddle command went out while LED frames were still waiting behind it.
        const lastLed = after.length - 1 - [...after].reverse().findIndex(isLed);
        expect(after.findIndex(isLevel)).toBeLessThan(lastLed);
        expect(rig.transport.maxInFlight).toBeGreaterThan(1);
        expect(rig.transport.maxInFlight).toBeLessThanOrEqual(TX_WINDOW + 1);
    });
});
