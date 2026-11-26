import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {GET_TIMEOUT, STATE_READ_DELAY, STATE_READ_GAP, STATE_READ_RETRIES} from "../src/core/link";
import {SETTINGS_READ_DELAY, SETTINGS_READ_KEY} from "../src/devices/dm";
import {DeliveryError, Rig, tick} from "./rig";

let rig: Rig;
const DIM = "0x000fff00000000b1";
const FS = "0x000fff00000000b2";
const OUT = "0x000fff00000000b3";

/** A DIM1-Z whose settings were read already: its tests count only the load's traffic. */
const settingsKnown = (r: Rig, ieee: string) => r.store.set(ieee, SETTINGS_READ_KEY, 1);

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(DIM, "C4-DIM1-Z");
    settingsKnown(rig, DIM);
    rig.add(FS, "C4-FS1-Z");
    rig.add(OUT, "loz-5s1-w");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const set = (ieee: string, key: string, value: unknown, message: Record<string, unknown> = {[key]: value}, endpoint?: string) =>
    rig.runtime.set(ieee, key, value, {message, endpoint});

describe("C4-DIM1-Z", () => {
    it("turns on from off with its level command when a cold start is set, which a hardware fade would skip", async () => {
        rig.store.set(DIM, "cold_start_level", 40);
        rig.store.set(DIM, "cold_start_time", 500);
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00");
        await tick(3000);
        let from = rig.transport.sent.length;
        let p = rig.runtime.set(DIM, "brightness", 76, {message: {state: "ON", brightness: 76, transition: 3}});
        await tick(50);
        await p;
        expect(rig.transport.sent.slice(from).map((s) => s.frame.profile)).toEqual([0x0104]);
        // Already on: the cold start doesn't apply, and the dimmer fades itself.
        await tick(6000);
        rig.states.set(DIM, {...rig.last(DIM), state: "ON", brightness: 76}); // what Z2M publishes from the converter
        from = rig.transport.sent.length;
        p = rig.runtime.set(DIM, "brightness", 200, {message: {state: "ON", brightness: 200, transition: 3}});
        await tick(50);
        await p;
        expect(rig.cmds(from)[0]).toMatch(/^c4\.dm\.rtl 00 4f /);
    });

    it("times a transition sent mid-fade from where the load is, not from the target shown", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00");
        await tick(3000);
        let p = rig.runtime.set(DIM, "brightness", 254, {message: {state: "ON", brightness: 254, transition: 10}});
        await tick(50);
        await p;
        // Halfway there: it reports 50 %, while the state shown is already the target.
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 32");
        await tick(100);
        const from = rig.transport.sent.length;
        p = rig.runtime.set(DIM, "state", "OFF", {message: {state: "OFF", transition: 5}});
        await tick(50);
        await p;
        // 50 points in 5 s: a full sweep takes 10 s (from the target's 100 % it would be 5 s).
        expect(rig.cmds(from)).toEqual(["c4.dm.rtl 00 00 00002710"]);
    });

    it("fades itself for a transition: its rtl time is a full 0-100 % sweep, held to min / max", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 32"); // 50 %
        await tick(3000);
        let from = rig.transport.sent.length;
        let p = rig.runtime.set(DIM, "brightness", 254, {message: {state: "ON", brightness: 254, transition: 3}});
        await tick(50);
        expect(await p).toEqual({state: "ON", brightness: 254});
        // 50 points in 3 s: a full sweep takes 6 s.
        expect(rig.texts(from)).toEqual([expect.stringMatching(/^0i[0-9a-f]{4} c4.dm.rtl 00 64 00001770$/)]);
        await tick(5000);
        rig.store.set(DIM, "max_brightness", 80);
        rig.states.set(DIM, {...rig.last(DIM), state: "OFF"});
        from = rig.transport.sent.length;
        p = rig.runtime.set(DIM, "state", "ON", {message: {state: "ON", brightness: 254, transition: 2}});
        await tick(50);
        expect(await p).toEqual({state: "ON", brightness: 203});
        // From off to its 80 % maximum in 2 s: a full sweep takes 2.5 s.
        expect(rig.cmds(from)).toEqual(["c4.dm.rtl 00 50 000009c4"]);
    });

    it("sends nothing to the dimmer while an off-fade reports its level", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(3000);
        const from = rig.transport.sent.length;
        const p = rig.runtime.set(DIM, "state", "OFF", {message: {state: "OFF"}});
        await tick(50);
        await p;
        rig.states.set(DIM, {...rig.last(DIM), state: "OFF"}); // what Z2M publishes from the converter
        for (const pct of ["32", "14", "05", "00"]) {
            rig.ascii(DIM, `0t0002 sa c4.dm.t0c ${pct}`);
            await tick(400);
        }
        await tick(5000);
        // Only the level command itself: no LED paint, no c4.dm.is read-back.
        expect(rig.transport.sent.slice(from).map((s) => s.frame.profile)).toEqual([0x0104]);
        expect(rig.last(DIM).state).toBe("OFF");
    });

    const loadStates = (from: number) =>
        rig.published
            .slice(from)
            .filter((p) => p.ieee === DIM && p.payload.state !== undefined)
            .map((p) => (p.payload.brightness === undefined ? String(p.payload.state) : `${p.payload.state} ${p.payload.brightness}`));

    it("publishes no mid-fade level while its own off-fade runs", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(3000);
        const p = rig.runtime.set(DIM, "state", "OFF", {message: {state: "OFF", transition: 0.5}});
        await tick(10);
        await p;
        const from = rig.published.length;
        for (const pct of ["13", "00"]) {
            rig.ascii(DIM, `0t0002 sa c4.dm.t0c ${pct}`);
            await tick(250);
        }
        await tick(3000);
        expect(loadStates(from)).toEqual(["OFF"]);
    });

    it("publishes no brightness dip while its own on-fade runs", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00");
        await tick(3000);
        const p = rig.runtime.set(DIM, "state", "ON", {message: {state: "ON", brightness: 254, transition: 0.5}});
        await tick(10);
        await p;
        const from = rig.published.length;
        for (const pct of ["03", "32", "64"]) {
            rig.ascii(DIM, `0t0002 sa c4.dm.t0c ${pct}`);
            await tick(200);
        }
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 254"]);
    });

    it("publishes the level it set, not the whole percent that reaches it", async () => {
        // Seen on a real dimmer: a set to 60 published 60, then 58 (23 %) as the fade arrived.
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00");
        await tick(3000);
        const p = rig.runtime.set(DIM, "state", "ON", {message: {state: "ON", brightness: 60, transition: 3}});
        await tick(10);
        await p;
        const from = rig.published.length;
        await tick(3000);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 17");
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 60"]);
    });

    it("keeps holding while a late ramp is still reporting", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(3000);
        const p = rig.runtime.set(DIM, "state", "OFF", {message: {state: "OFF", transition: 0.5}});
        await tick(10);
        await p;
        const from = rig.published.length;
        // Seen on a busy mesh: the ramp's first report comes 1.4 s in, the last at 2.2 s.
        await tick(1400);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 5f");
        await tick(800);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 00");
        await tick(3000);
        expect(loadStates(from)).toEqual(["OFF"]);
    });

    it("starts the fade window when the level command is delivered", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(3000);
        let fails = 1;
        // A transition is a hardware fade: one c4.dm.rtl frame.
        rig.transport.failWith = (f) => (f.data.toString("latin1").includes("c4.dm.rtl") && fails-- > 0 ? Object.assign(new Error("no ack"), {name: "DeliveryError"}) : undefined);
        const p = rig.runtime.set(DIM, "state", "OFF", {message: {state: "OFF", transition: 0.5}});
        await tick(2100); // the retry goes out after RETRY_DELAY
        await p;
        rig.transport.failWith = undefined;
        const from = rig.published.length;
        await tick(300);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 30");
        await tick(300);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 00");
        await tick(3000);
        expect(loadStates(from)).toEqual(["OFF"]);
    });

    const setTv = async (key: string, value: number) => {
        const p = set(DIM, key, value);
        await tick(50);
        return p;
    };

    it("writes the cold start level to slot 09 and its time to slot 0a", async () => {
        expect(await setTv("cold_start_level", 40)).toEqual({cold_start_level: 40});
        expect(rig.cmds().at(-1)).toBe("c4.dm.tv 00 09 00000028");
        expect(await setTv("cold_start_time", 500)).toEqual({cold_start_time: 500});
        expect(rig.cmds().at(-1)).toBe("c4.dm.tv 00 0a 000001f4");
    });

    it("holds a turn-on from off through its cold start", async () => {
        rig.zcl.set(DIM, {genOnOff: {onOff: 1}, genLevelCtrl: {currentLevel: 102}});
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00");
        await setTv("cold_start_level", 40);
        await setTv("cold_start_time", 1500);
        await tick(5000);
        const p = rig.runtime.set(DIM, "state", "ON", {message: {state: "ON", brightness: 64, transition: 0.5}});
        await tick(10);
        await p;
        const from = rig.published.length;
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 28"); // the cold start level, held 1.5 s
        await tick(1800);
        rig.ascii(DIM, "0t0003 sa c4.dm.t0c 19"); // then down to the target
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 64"]);
        expect(rig.zclReads).toEqual([]);
    });

    it("reads the load when an on-fade's target report never comes", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00");
        await tick(3000);
        const p = rig.runtime.set(DIM, "state", "ON", {message: {state: "ON", brightness: 254, transition: 0.5}});
        await tick(10);
        await p;
        const from = rig.published.length;
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 03");
        await tick(5000);
        expect(rig.zclReads.map((x) => `${x.ep}/${x.cluster}`)[0]).toBe("1/genOnOff"); // the dimmer is asked
        expect(loadStates(from)).not.toContain("ON 8");
    });

    it("publishes the paddle's state when the paddle reverses our fade", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(3000);
        const p = rig.runtime.set(DIM, "state", "OFF", {message: {state: "OFF", transition: 0.5}});
        await tick(10);
        await p;
        const from = rig.published.length;
        // Someone taps the paddle back on before the fade reaches 0; no 00 ever comes.
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 1e");
        await tick(200);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 28");
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 102"]);
        // Reports after the fade window go straight through.
        rig.ascii(DIM, "0t0003 sa c4.dm.t0c 32");
        expect(loadStates(from)).toEqual(["ON 102", "ON 127"]);
    });

    it("repaints a status colour only after the load has settled", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(3000);
        const s = rig.runtime.set(DIM, "led_status", {color: "red"}, {message: {}});
        await tick(3000);
        await s;
        const from = rig.transport.sent.length;
        for (const pct of ["32", "14", "05", "00"]) {
            rig.ascii(DIM, `0t0002 sa c4.dm.t0c ${pct}`);
            await tick(400);
        }
        expect(rig.cmds(from)).toEqual([]); // nothing during the ramp
        await tick(6000);
        // After it: the repaint (and its c4.dm.is read-back) happens.
        expect(rig.cmds(from).some((c) => c.startsWith("c4.dm."))).toBe(true);
    });

    it("holds an LED status that arrives mid-fade until the fade is over", async () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(3000);
        const p = rig.runtime.set(DIM, "state", "OFF", {message: {state: "OFF", transition: 2}});
        await tick(50);
        await p;
        const from = rig.transport.sent.length;
        // HA's LED automation reacts 1 s into the 2 s fade.
        await tick(1000);
        const s = rig.runtime.set(DIM, "led_status", {color: "green"}, {message: {}});
        await tick(500);
        await s;
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 14");
        await tick(1000);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 00");
        await tick(600);
        expect(rig.cmds(from)).toEqual([]); // nothing while fading, nor right after
        await tick(3000);
        expect(rig.cmds(from).some((c) => c.startsWith("c4.dm.l"))).toBe(true);
    });

    it("tracks c4.dm.t0c and ignores the check-in status attribute", () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 63");
        expect(rig.last(DIM)).toMatchObject({state: "ON", brightness: 254});
        rig.checkin(DIM, "c4:control4_light:C4-DIM1-Z", Buffer.from([0x00, 0x00, 0x20, 0x02]));
        expect(rig.last(DIM)).toMatchObject({state: "ON", brightness: 254});
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00");
        expect(rig.last(DIM).state).toBe("OFF");
    });

    it("maps paddle-down and click counts (top = button_1)", () => {
        rig.ascii(DIM, "0t0001 sa c4.dm.b0c");
        rig.ascii(DIM, "0t0002 sa c4.dm.cc 00 03");
        rig.ascii(DIM, "0t0003 sa c4.dm.b1c");
        rig.ascii(DIM, "0t0004 sa c4.dm.cc 01 01");
        expect(rig.actions(DIM)).toEqual(["button_1_press", "button_1_tap_known", "button_1_triple", "button_2_press", "button_2_tap_known", "button_2_single"]);
    });

    // As captured from Master Stairs Top (fw 03.22.41, local control off): a hold is b<idx>b ... b<idx>e alone.
    it("maps a paddle hold and its release (top = button_1)", () => {
        for (const f of ["c4.dm.b0b", "c4.dm.b0e", "c4.dm.b1b", "c4.dm.b1e"]) rig.ascii(DIM, `0t0001 sa ${f}`);
        expect(rig.actions(DIM)).toEqual(["button_1_hold", "button_1_hold_release", "button_2_hold", "button_2_hold_release"]);
    });

    // Tested on Linen Closet and Garage Entrance on 2026-11-07: back in about 2 s, level and settings kept.
    it("reboots with an interrupt frame (0i c4.dm.rb); an unconfirmed delivery is no error", async () => {
        let p = set(DIM, "reboot", "reboot");
        await tick(50);
        await expect(p).resolves.toBeUndefined();
        expect(rig.texts().at(-1)).toMatch(/^0i[0-9a-f]{4} c4\.dm\.rb$/);
        // No APS acknowledgement asked: an APS retry would reboot it again.
        expect(rig.transport.sent.at(-1)?.ack).toBe(false);
        // It restarts on receipt, often before the delivery is confirmed.
        rig.transport.failWith = () => new DeliveryError("delivery failed", "failed");
        p = set(DIM, "reboot", "reboot");
        await tick(50);
        await expect(p).resolves.toBeUndefined();
        expect(rig.runtime.link.lastRebootAt(DIM)).toBe(Date.now() - 50);
        // A frame that never went out is a failure.
        rig.transport.failWith = () => new DeliveryError("could not queue frame", "unqueued");
        p = set(DIM, "reboot", "reboot");
        const failed = expect(p).rejects.toThrow(/could not queue/);
        await tick(50);
        await failed;
    });

    it("may be rebooted automatically unless its auto_reboot option is off (true / false or text)", () => {
        const dim = rig.runtime.get(DIM) as unknown as {autoReboot(): boolean};
        const options = (rig.devices.get(DIM) as {options: Record<string, unknown>}).options;
        expect(dim.autoReboot()).toBe(true);
        for (const [value, may] of [[false, false], ["false", false], [true, true], ["true", true], ["", true]] as const) {
            options.auto_reboot = value;
            expect(dim.autoReboot()).toBe(may);
        }
    });

    it("writes the paddle-local-control flag with one argument", async () => {
        const p = set(DIM, "paddle_local_control", "OFF");
        await tick(50);
        expect(await p).toEqual({paddle_local_control: "OFF"});
        expect(rig.cmds().at(-1)).toBe("c4.dm.ba 00");
    });

    it("writes a paddle LED colour, attaches the LEDs, then verifies from c4.dm.is", async () => {
        const p = set(DIM, "led_top_off_color", "red");
        await tick(400);
        expect(await p).toEqual({led_top_off_color: "red"});
        expect(rig.cmds().slice(-3)).toEqual(["c4.dm.l0f ff0000", "c4.dm.lm 01", "c4.dm.is"]);
    });
});

describe("C4-DIM1-Z state reads", () => {
    const reads = (r = rig) => r.zclReads.map((x) => `${x.ep}/${x.cluster}/${x.attrs.join(",")}`);

    it("publishes the state a /get reads from genOnOff / genLevelCtrl on EP1", async () => {
        rig.zcl.set(DIM, {genOnOff: {onOff: 1}, genLevelCtrl: {currentLevel: 200}});
        const g = rig.runtime.getValue(DIM, "state");
        await tick(50);
        await g;
        expect(reads()).toEqual(["1/genOnOff/onOff", "1/genLevelCtrl/currentLevel"]);
        expect(rig.last(DIM)).toMatchObject({state: "ON", brightness: 200});
        // Z2M asks for brightness right after state: the same read answers it.
        await rig.runtime.getValue(DIM, "brightness");
        expect(rig.zclReads).toHaveLength(2);
        // The level read is the last lit level, as a reported one would be.
        await tick(2500);
        expect(rig.store.get(DIM, "last_level")).toBe(200);

        rig.zcl.set(DIM, {genOnOff: {onOff: 0}, genLevelCtrl: {currentLevel: 200}});
        const off = rig.runtime.getValue(DIM, "state");
        await tick(50);
        await off;
        expect(rig.last(DIM).state).toBe("OFF");
        expect(rig.store.get(DIM, "last_level")).toBe(200);
    });

    it("reads every dimmer once at startup, one device at a time", async () => {
        const r = new Rig();
        try {
            const ids = [1, 2, 3].map((i) => r.add(`0x000fff00000000c${i}`, "C4-DIM1-Z"));
            ids.forEach((id, i) => r.zcl.set(id, {genOnOff: {onOff: i % 2}, genLevelCtrl: {currentLevel: 100 + i}}));
            r.zclLatency = 50;
            const t0 = Date.now();
            r.start();
            await tick(STATE_READ_DELAY - 100);
            expect(r.zclReads).toEqual([]);
            await tick(3000);
            expect(r.zclReads.map((x) => x.ieee)).toEqual([ids[0], ids[0], ids[1], ids[1], ids[2], ids[2]]);
            const starts = r.zclReads.filter((x) => x.cluster === "genOnOff").map((x) => x.at - t0);
            expect(starts[0]).toBeGreaterThanOrEqual(STATE_READ_DELAY);
            // Each dimmer's two reads, then the gap, before the next dimmer's.
            expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2 * 50 + STATE_READ_GAP);
            expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(2 * 50 + STATE_READ_GAP);
            expect(r.last(ids[0]).state).toBe("OFF");
            expect(r.last(ids[1])).toMatchObject({state: "ON", brightness: 101});
            await tick(30_000);
            expect(r.zclReads).toHaveLength(6); // once
        } finally {
            r.stop();
        }
    });

    it("skips the startup read once the dimmer has reported, and never reads mid-fade", async () => {
        rig.zcl.set(DIM, {genOnOff: {onOff: 0}, genLevelCtrl: {currentLevel: 128}});
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 64");
        await tick(STATE_READ_DELAY + 3000);
        expect(rig.zclReads).toEqual([]);

        // A /get during our own 2 s fade waits for the fade and its reports to finish.
        const p = set(DIM, "state", "OFF", {state: "OFF", transition: 2});
        await tick(50);
        await p;
        const g = rig.runtime.getValue(DIM, "state");
        await tick(1000);
        rig.ascii(DIM, "0t0002 sa c4.dm.t0c 14");
        await tick(1000);
        rig.ascii(DIM, "0t0003 sa c4.dm.t0c 00");
        const lastReport = Date.now();
        await tick(500);
        expect(rig.zclReads).toEqual([]);
        await tick(2000);
        await g;
        expect(rig.zclReads).toHaveLength(2);
        expect(rig.zclReads[0].at).toBeGreaterThanOrEqual(lastReport + 1000);
        expect(rig.last(DIM).state).toBe("OFF");
    });

    it("skips a queued read whose dimmer is fading when its turn comes", async () => {
        rig.zcl.set(DIM, {genOnOff: {onOff: 1}, genLevelCtrl: {currentLevel: 128}});
        await tick(STATE_READ_DELAY - 1000);
        const p = set(DIM, "state", "ON", {state: "ON", brightness: 128, transition: 3});
        await tick(50);
        await p;
        await tick(10_000);
        expect(rig.zclReads).toEqual([]); // its own c4.dm.t0c reports tell the state
    });

    it("drops a read that a level report overtakes", async () => {
        rig.zcl.set(DIM, {genOnOff: {onOff: 0}, genLevelCtrl: {currentLevel: 0}});
        rig.zclLatency = 300;
        const g = rig.runtime.getValue(DIM, "state");
        await tick(100);
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 32"); // a paddle press while the read is out
        await tick(1000);
        await g;
        expect(rig.zclReads).toHaveLength(1); // nor is the level read sent
        expect(rig.last(DIM).state).toBe("ON");
    });

    it("reads again when asked (announce, join), but not for a device that left", async () => {
        rig.zcl.set(DIM, {genOnOff: {onOff: 1}, genLevelCtrl: {currentLevel: 90}});
        await tick(STATE_READ_DELAY + 1000);
        expect(rig.zclReads).toHaveLength(2);
        await tick(20_000);
        rig.runtime.requestStateRead(DIM);
        rig.runtime.requestStateRead(DIM); // a burst of announces queues one read
        await tick(STATE_READ_DELAY - 500);
        expect(rig.zclReads).toHaveLength(2);
        await tick(1000);
        expect(rig.zclReads).toHaveLength(4);
        await tick(20_000);
        rig.runtime.requestStateRead(DIM);
        rig.runtime.removeDevice(DIM);
        await tick(STATE_READ_DELAY * 2);
        expect(rig.zclReads).toHaveLength(4);
    });

    it("retries a read nobody answered, twice, without holding up the others", async () => {
        // Right after a restart the routes are being rebuilt: the first read gets no answer.
        await tick(STATE_READ_DELAY + 500);
        expect(rig.zclReads).toHaveLength(1); // on/off timed out: the level read is not sent
        await tick(STATE_READ_RETRIES[0]);
        expect(rig.zclReads).toHaveLength(2); // the first retry, no answer either
        // A device that joins while the queue waits for the second retry is read on time.
        await tick(10_000);
        const late = rig.add("0x000fff00000000c9", "C4-DIM1-Z");
        rig.zcl.set(late, {genOnOff: {onOff: 1}, genLevelCtrl: {currentLevel: 64}});
        rig.runtime.ensureDevice(late);
        await tick(STATE_READ_DELAY + 500);
        expect(rig.zclReads.map((x) => x.ieee)).toEqual([DIM, DIM, late, late]);
        expect(rig.last(late)).toMatchObject({state: "ON", brightness: 64});
        // The second retry finds the routes back.
        rig.zcl.set(DIM, {genOnOff: {onOff: 1}, genLevelCtrl: {currentLevel: 33}});
        await tick(STATE_READ_RETRIES[1]);
        expect(rig.zclReads.filter((x) => x.ieee === DIM)).toHaveLength(4);
        expect(rig.last(DIM)).toMatchObject({state: "ON", brightness: 33});
    });

    it("gives up after the retries", async () => {
        await tick(STATE_READ_DELAY + STATE_READ_RETRIES[0] + STATE_READ_RETRIES[1] + 10_000);
        expect(rig.zclReads).toHaveLength(3);
        await tick(600_000);
        expect(rig.zclReads).toHaveLength(3);
    });

    it("does not read the other -Z devices", async () => {
        await tick(STATE_READ_DELAY * 3);
        expect(rig.zclReads.map((x) => x.ieee)).toEqual([DIM]); // the DIM1-Z tried (no answer); FS1-Z and outlet not
    });
});

describe("C4-DIM1-Z settings read", () => {
    /** Let the next Get go out, check it is `cmd`, and answer it. */
    const answer = async (r: Rig, cmd: string, values: string) => {
        await tick(100);
        expect(r.cmds().at(-1)).toBe(cmd);
        r.reply(DIM, values);
        await tick(0);
    };
    const settingsGets = (r: Rig, from = 0) => r.texts(from).filter((t) => t.startsWith("0g") && t.includes(" c4.dm.")).map((t) => t.replace(/^0g[0-9a-f]{4} /, ""));
    /** A rig whose DIM1-Z has never had its settings read. */
    const fresh = (store?: Rig["store"]) => {
        const r = new Rig(store ? {store} : {});
        r.add(DIM, "C4-DIM1-Z");
        return r;
    };

    it("shows the DIM1-Z's own factory values until it is read", () => {
        expect(rig.last(DIM)).toMatchObject({min_brightness: 0, hold_ramp_up: 5000, hold_ramp_down: 5000, cold_start_level: 0, cold_start_time: 0});
    });

    it("reads what the device holds once, after the start-up reads, and shows it", async () => {
        const r = fresh();
        try {
            r.start();
            await tick(SETTINGS_READ_DELAY - 1000);
            expect(settingsGets(r)).toEqual([]);
            await tick(1000);
            // Level, default-on, on fade, off fade, four colours, flags (0d: the paddle does not drive the load).
            await answer(r, "c4.dm.is", "00 14 01f4 07d0 080000 080000 000000 000000 0d");
            await answer(r, "c4.dm.tv 00 08", "0014");
            await answer(r, "c4.dm.tv 00 06", "005a");
            await answer(r, "c4.dm.tv 00 04", "1388");
            await answer(r, "c4.dm.tv 00 05", "1388");
            await answer(r, "c4.dm.tv 00 09", "0028");
            await answer(r, "c4.dm.tv 00 0a", "01f4");
            expect(r.last(DIM)).toMatchObject({
                default_on_brightness: 20,
                on_transition: 0.5,
                off_transition: 2,
                paddle_local_control: "OFF",
                min_brightness: 20,
                max_brightness: 90,
                hold_ramp_up: 5000,
                hold_ramp_down: 5000,
                cold_start_level: 40,
                cold_start_time: 500,
            });
            expect(r.store.get(DIM, "ba")).toBe(0);
            expect(r.store.get(DIM, "max_brightness")).toBe(90);
            expect(r.store.get(DIM, "on_transition")).toBe(0.5);
            expect(r.store.get(DIM, SETTINGS_READ_KEY)).toBeTypeOf("number");
            // What differs from what was shown is logged; the hold ramps were shown right.
            const lines = r.log.lines.filter((l) => l.includes("settings read from the device"));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain("max_brightness 100 -> 90");
            expect(lines[0]).not.toContain("hold_ramp_up");

            const sent = r.cmds().length;
            await tick(600_000);
            expect(settingsGets(r, sent)).toEqual([]);
        } finally {
            r.stop();
        }
        // Nor after a restart.
        const again = fresh(r.store);
        try {
            again.start();
            await tick(SETTINGS_READ_DELAY * 2);
            expect(settingsGets(again)).toEqual([]);
        } finally {
            again.stop();
        }
    });

    it("keeps nothing from a read the device did not finish, and starts it over", async () => {
        const r = fresh();
        try {
            r.start();
            await tick(SETTINGS_READ_DELAY);
            await answer(r, "c4.dm.is", "00 14 01f4 07d0 080000 080000 000000 000000 0f");
            await tick(GET_TIMEOUT + 500); // c4.dm.tv 00 08 goes unanswered
            expect(r.store.get(DIM, SETTINGS_READ_KEY)).toBeUndefined();
            expect(r.store.get(DIM, "default_on_brightness")).toBeUndefined();
            await tick(STATE_READ_RETRIES[0]);
            expect(r.cmds().at(-1)).toBe("c4.dm.is");
        } finally {
            r.stop();
        }
    });

    it("leaves a property the dimmer does not have as shown, and reads the rest", async () => {
        const r = fresh();
        try {
            r.start();
            await tick(SETTINGS_READ_DELAY);
            await answer(r, "c4.dm.is", "00 50 01f4 07d0 080000 080000 000000 000000 0f");
            await tick(100);
            expect(r.cmds().at(-1)).toBe("c4.dm.tv 00 08");
            r.ascii(DIM, `0r${(r.texts().at(-1) as string).slice(2, 6)} n01`);
            await tick(0);
            for (const cmd of ["c4.dm.tv 00 06", "c4.dm.tv 00 04", "c4.dm.tv 00 05", "c4.dm.tv 00 09", "c4.dm.tv 00 0a"]) await answer(r, cmd, "0064");
            expect(r.store.get(DIM, "min_brightness")).toBeUndefined();
            expect(r.last(DIM)).toMatchObject({min_brightness: 0, default_on_brightness: 80, max_brightness: 100});
            expect(r.store.get(DIM, SETTINGS_READ_KEY)).toBeTypeOf("number");
        } finally {
            r.stop();
        }
    });

    it("is read after a hot-load too, but not while the load fades", async () => {
        const r = fresh();
        try {
            r.start(true);
            await tick(SETTINGS_READ_DELAY - 500);
            const p = r.runtime.set(DIM, "state", "ON", {message: {state: "ON", brightness: 128, transition: 3}});
            await tick(50);
            await p;
            await tick(1000);
            expect(settingsGets(r)).toEqual([]);
            await tick(4000); // the fade and its settle
            expect(r.cmds().at(-1)).toBe("c4.dm.is");
        } finally {
            r.stop();
        }
    });

    it("is read again after the device left, or came from another instance", async () => {
        await tick(SETTINGS_READ_DELAY * 2);
        expect(settingsGets(rig)).toEqual([]);
        rig.runtime.forgetProvisioning(DIM); // it left
        expect(rig.store.get(DIM, SETTINGS_READ_KEY)).toBeUndefined();
        rig.runtime.rebuild(DIM); // and joined again
        await tick(SETTINGS_READ_DELAY + 100);
        expect(settingsGets(rig)).toEqual(["c4.dm.is"]);

        const before = settingsGets(rig).length;
        rig.store.set(DIM, SETTINGS_READ_KEY, 1);
        rig.runtime.forgetSettingsRead(DIM); // a handoff brought it
        rig.runtime.rebuild(DIM);
        await tick(SETTINGS_READ_DELAY + 100);
        expect(settingsGets(rig, 0).slice(before)).toEqual(["c4.dm.is"]);
    });
});

describe("C4-FS1-Z", () => {
    it("reports on/off from c4.dm.t0c", () => {
        rig.ascii(FS, "0t0001 sa c4.dm.t0c 64");
        expect(rig.last(FS).state).toBe("ON");
    });

    it("turns on at full level with a non-zero transition", async () => {
        const p = set(FS, "state", "ON", {state: "ON", transition: 0});
        await tick(50);
        expect(await p).toEqual({state: "ON"});
        expect(rig.transport.sent.at(-1)?.frame.data.subarray(2).toString("hex")).toBe("04fe0800");
    });

    it("reverts to the last reported state when no confirmation arrives", async () => {
        rig.ascii(FS, "0t0001 sa c4.dm.t0c 00");
        await tick(10);
        const p = set(FS, "state", "ON");
        await tick(50);
        await p;
        rig.states.set(FS, {...rig.last(FS), state: "ON"}); // what Z2M would have stored
        await tick(6500);
        expect(rig.last(FS).state).toBe("OFF");
    });

    it("keeps the commanded state when the device confirms it", async () => {
        rig.ascii(FS, "0t0001 sa c4.dm.t0c 00");
        await tick(10);
        const p = set(FS, "state", "ON");
        await tick(50);
        await p;
        rig.ascii(FS, "0t0002 sa c4.dm.t0c 64");
        await tick(6500);
        expect(rig.last(FS).state).toBe("ON");
    });

    // Assumed as on the DIM1-Z (#51): b<idx>c once per press, a hold with no b<idx>c before it.
    it("fires a press and a known tap at paddle-down (b<idx>c), its count from cc, and a hold from b<idx>b/e", () => {
        for (const f of ["c4.dm.b0c", "c4.dm.b0c", "c4.dm.cc 00 02", "c4.dm.b1b", "c4.dm.b1e"]) rig.ascii(FS, `0t0001 sa ${f}`);
        expect(rig.actions(FS)).toEqual(["button_1_press", "button_1_tap_known", "button_1_press", "button_1_tap_known", "button_1_double", "button_2_hold", "button_2_hold_release"]);
    });

    it("counts its taps itself: a fast count one tap window after the last paddle-down, every tap known", async () => {
        for (const f of ["c4.dm.b0c", "c4.dm.b0c"]) rig.ascii(FS, `0t0001 sa ${f}`);
        await tick(1000);
        expect(rig.events.filter((e) => e.ieee === FS && e.gesture === "fast_double").map((e) => e.known_taps)).toEqual([true]);
    });
});

describe("LOZ-5S1-W", () => {
    it("tracks both outlets from c4.dm.tc", () => {
        rig.ascii(OUT, "0t0001 sa c4.dm.tc 00 64");
        rig.ascii(OUT, "0t0002 sa c4.dm.tc 01 00");
        expect(rig.last(OUT)).toMatchObject({state_l1: "ON", state_l2: "OFF"});
    });

    it("switches an outlet by endpoint", async () => {
        const p = set(OUT, "state", "ON", {state: "ON"}, "l2");
        await tick(50);
        expect(await p).toEqual({state: "ON"});
        expect(rig.cmds().at(-1)).toBe("c4.dm.tv 01 00 64");
    });

    it("takes outlet 1 from the EP198 report", () => {
        rig.outletReport(OUT, Buffer.from([0x00, 0x00, 0x20, 0x02]));
        expect(rig.last(OUT).state_l1).toBe("ON");
    });
});