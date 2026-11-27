import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {HA_PROFILE} from "../src/core/constants";
import {Rig, tick} from "./rig";

let rig: Rig;
const APD = "0x000fff00000000a1";
const SW = "0x000fff00000000a2";
const FAN = "0x000fff00000000a3";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(APD, "C4-APD120");
    rig.add(SW, "C4-SW120277");
    rig.add(FAN, "C4-4SF120");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

const set = (ieee: string, key: string, value: unknown, message: Record<string, unknown> = {[key]: value}) => rig.runtime.set(ieee, key, value, {message});

describe("C4-APD120", () => {
    it("tracks the load level from c4.dmx.ls", () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 32 00");
        expect(rig.last(APD)).toMatchObject({state: "ON", brightness: 127});
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 00 00");
        expect(rig.last(APD).state).toBe("OFF");
    });

    it("publishes tap, release, click count and hold gestures", () => {
        for (const f of ["c4.dmx.bp 01", "c4.dmx.sc 01", "c4.dmx.cc 01 02", "c4.dmx.hc 05", "c4.dmx.he 05", "c4.dmx.tc 01"]) rig.ascii(APD, `0t0001 sa ${f}`);
        expect(rig.actions(APD)).toEqual(["top_press", "top_release", "top_double", "bottom_hold", "bottom_hold_release"]);
        const p = rig.published.find((x) => x.payload.action === "top_double")?.payload;
        expect(p).toMatchObject({action_button: "top", action_gesture: "double", action_command: "remote_button_double_press"});
    });

    it("emits the fast tap after the press window", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.bp 01");
        await tick(600);
        expect(rig.actions(APD)).toEqual(["top_press", "top_fast_single"]);
    });

    it("counts presses up to 0.55 s apart as one tap sequence", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.bp 01");
        await tick(500);
        rig.ascii(APD, "0t0002 sa c4.dmx.bp 01");
        await tick(540);
        expect(rig.actions(APD)).toEqual(["top_press", "top_press"]);
        await tick(20);
        expect(rig.actions(APD)).toEqual(["top_press", "top_press", "top_fast_double"]);
    });

    it("never takes its light state from a tap, only from its reports", () => {
        // An event-only top half leaves the load off; a toggling half may turn it either way.
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 00 00");
        rig.ascii(APD, "0t0002 sa c4.dmx.cc 01 01");
        expect(rig.last(APD).state).toBe("OFF");
        rig.ascii(APD, "0t0003 sa c4.dmx.ls 00 00 64 00");
        rig.ascii(APD, "0t0004 sa c4.dmx.cc 05 01");
        expect(rig.last(APD).state).toBe("ON");
        expect(rig.actions(APD)).toEqual(["top_single", "bottom_single"]);
    });

    it("takes power, voltage, current and energy from the reading in each c4.dmx.ls", () => {
        rig.ascii(APD, "0t5902 sa c4.dmx.ls 00 00 64 007d 013f 001c 0028 02bb 07d0 0000");
        expect(rig.last(APD)).toMatchObject({state: "ON", brightness: 254, voltage: 125, current: 0.319, power: 28, power_apparent: 40, power_factor: 0.699, energy: 2.54});
    });

    it("turns on at the last settled level with the on-fade", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 19 00"); // 25 %
        await tick(2100);
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 00 00");
        const from = rig.transport.sent.length;
        const p = set(APD, "state", "ON");
        await tick(50);
        expect(await p).toEqual({state: "ON", brightness: 64});
        const zcl = rig.transport.sent.slice(from).find((s) => s.frame.profile === HA_PROFILE);
        expect(zcl?.frame.cluster).toBe(0x0008);
        // move_to_level_with_on_off(64, 8 tenths)
        expect(zcl?.frame.data.subarray(2).toString("hex")).toBe("04400800");
    });

    it("does not remember a mid-fade level", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 50 00");
        await tick(2100);
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 10 00");
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 00 00");
        await tick(3000);
        expect(rig.store.get(APD, "last_level")).toBe(203);
    });

    const loadStates = (from: number) =>
        rig.published
            .slice(from)
            .filter((p) => p.ieee === APD && p.payload.state !== undefined)
            .map((p) => (p.payload.brightness === undefined ? String(p.payload.state) : `${p.payload.state} ${p.payload.brightness}`));

    /** Send a level command and return where its publishes start. */
    const fadeTo = async (message: Record<string, unknown>) => {
        const p = rig.runtime.set(APD, "state", message.state, {message});
        await tick(10);
        await p;
        return rig.published.length;
    };

    it("publishes no mid-fade level while its own off-fade runs", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 32 00");
        await tick(3000);
        const from = await fadeTo({state: "OFF", transition: 0.5});
        for (const pct of ["0a", "00"]) {
            rig.ascii(APD, `0t0002 sa c4.dmx.ls 00 00 ${pct} 00`);
            await tick(250);
        }
        await tick(3000);
        expect(loadStates(from)).toEqual(["OFF"]);
    });

    it("publishes the level it set, not the ramp or the whole percent that reaches it", async () => {
        // Seen on a real dimmer: a set to 199 published 199 -> 130 -> 185 -> 198.
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 19 00");
        await tick(3000);
        const from = await fadeTo({state: "ON", brightness: 199, transition: 0.5});
        for (const pct of ["33", "48", "4e"]) {
            rig.ascii(APD, `0t0002 sa c4.dmx.ls 00 00 ${pct} 00`);
            await tick(200);
        }
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 199"]);
        expect(rig.store.get(APD, "last_level")).toBe(199);
    });

    it("holds a slow fade's reports until it reaches the target's own percent", async () => {
        // Seen on a real dimmer: a 3 s fade to 30 (11 %) reported 23, 22, 18, 13, 11 %;
        // 13 % (33) is within 3 of 30 but the ramp had not arrived.
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 19 00");
        await tick(3000);
        const from = await fadeTo({state: "ON", brightness: 30, transition: 3});
        for (const pct of ["17", "16", "12", "0d", "0b"]) {
            rig.ascii(APD, `0t0002 sa c4.dmx.ls 00 00 ${pct} 00`);
            await tick(900);
        }
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 30"]);
    });

    it("keeps the level it set when the dimmer repeats its last report", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 19 00");
        await tick(3000);
        const from = await fadeTo({state: "ON", brightness: 199, transition: 0.5});
        for (const pct of ["21", "3d", "4e", "4e"]) {
            rig.ascii(APD, `0t0002 sa c4.dmx.ls 00 00 ${pct} 00`);
            await tick(200);
        }
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 199", "ON 199"]);
        // A report of another level is the load moving again.
        rig.ascii(APD, "0t0003 sa c4.dmx.ls 00 00 4d 00");
        expect(loadStates(from).at(-1)).toBe("ON 196");
    });

    it("waits out the pause at minimum brightness before the load switches off", async () => {
        // The APD120 sits at its minimum for about a second before it reports 0.
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 0b 00");
        await tick(3000);
        const from = await fadeTo({state: "OFF", transition: 0.5});
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 04 00");
        await tick(1600);
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 00 00");
        await tick(3000);
        expect(loadStates(from)).toEqual(["OFF"]);
    });

    it("publishes where the load stopped when the fade never reaches its target", async () => {
        // A max-brightness trim of 90 % ends the ramp short of 254.
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 00 00");
        await tick(3000);
        const from = await fadeTo({state: "ON", brightness: 254, transition: 0.5});
        for (const pct of ["1e", "3c", "5a"]) {
            rig.ascii(APD, `0t0002 sa c4.dmx.ls 00 00 ${pct} 00`);
            await tick(200);
        }
        expect(loadStates(from)).toEqual([]);
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 229"]);
    });

    it("publishes the paddle's state when the paddle reverses our fade", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 64 00");
        await tick(3000);
        const from = await fadeTo({state: "OFF", transition: 0.5});
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 1e 00");
        await tick(200);
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 28 00");
        await tick(3000);
        expect(loadStates(from)).toEqual(["ON 102"]);
        // Reports after the fade window go straight through.
        rig.ascii(APD, "0t0003 sa c4.dmx.ls 00 00 32 00");
        expect(loadStates(from)).toEqual(["ON 102", "ON 127"]);
    });

    it("turns off with its stored off-fade, a ZCL level command", async () => {
        const from = rig.transport.sent.length;
        const p = set(APD, "state", "OFF", {state: "OFF"});
        await tick(50);
        expect(await p).toEqual({state: "OFF"});
        expect(rig.transport.sent[from].frame.data.subarray(2).toString("hex")).toBe("04001400");
    });

    it("fades itself for a transition: one 0i c4.dm.rtl, its time this move's length", async () => {
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 64 00");
        await tick(3000);
        let from = rig.transport.sent.length;
        let p = set(APD, "state", "OFF", {state: "OFF", transition: 3});
        await tick(50);
        expect(await p).toEqual({state: "OFF"});
        expect(rig.texts(from)).toEqual([expect.stringMatching(/^0i[0-9a-f]{4} c4\.dm\.rtl 00 00 00000bb8$/)]);
        from = rig.transport.sent.length;
        p = set(APD, "brightness", 127, {state: "ON", brightness: 127, transition: 2});
        await tick(50);
        expect(await p).toEqual({state: "ON", brightness: 127});
        expect(rig.cmds(from)).toEqual(["c4.dm.rtl 00 32 000007d0"]);
        // Held to its minimum brightness (10 % from the factory).
        from = rig.transport.sent.length;
        p = set(APD, "brightness", 5, {state: "ON", brightness: 5, transition: 1});
        await tick(50);
        expect(await p).toEqual({state: "ON", brightness: 25});
        expect(rig.cmds(from)).toEqual(["c4.dm.rtl 00 0a 000003e8"]);
    });

    it("pushes fades to the dimmer's ramp table", async () => {
        const p = set(APD, "on_transition", 1.5);
        await tick(50);
        expect(await p).toEqual({on_transition: 1.5});
        expect(rig.cmds().at(-1)).toBe("c4.dm.tv 00 02 05dc");
        expect(rig.store.get(APD, "on_transition")).toBe(1.5);
    });

    it("accepts the ZHA ramp cluster commands", async () => {
        const from = rig.transport.sent.length;
        const p = set(APD, "set_on_off_ramps", {on_time_ms: 1000, off_time_ms: 3000});
        await tick(200);
        expect(await p).toEqual({on_transition: 1, off_transition: 3});
        expect(rig.cmds(from)).toEqual(["c4.dm.tv 00 02 03e8", "c4.dm.tv 00 03 0bb8"]);
    });

    it("accepts the ZHA LED cluster commands", async () => {
        let from = rig.transport.sent.length;
        let p = set(APD, "set_led_color", {button_id: 1, on_red: 255, on_green: 0, on_blue: 16, off_red: 0, off_green: 0, off_blue: 0});
        await tick(500);
        await p;
        expect(rig.cmds(from)).toEqual(["c4.dmx.led 01 03 ff0010", "c4.dmx.led 01 04 000000"]);
        from = rig.transport.sent.length;
        p = set(APD, "set_led_single_on", {button_id: 0, button_idx: 2, behavior_on: 2, behavior_others: 0});
        await tick(2000);
        await p;
        const cmds = rig.cmds(from);
        expect(cmds).toHaveLength(12);
        expect(cmds[2]).toBe("c4.dmx.led 02 01 02");
        expect(cmds[0]).toBe("c4.dmx.led 00 01 00");
        from = rig.transport.sent.length;
        p = set(APD, "set_all_led_modes", {num_buttons: 2, mode: 0, behavior: 1, color_mode: 2});
        await tick(1000);
        await p;
        expect(rig.cmds(from)).toEqual(["c4.dmx.led 00 00 00", "c4.dmx.led 00 01 01", "c4.dmx.led 00 02 02", "c4.dmx.led 01 00 00", "c4.dmx.led 01 01 01", "c4.dmx.led 01 02 02"]);
    });

    it("keeps send_raw / send_get as aliases of c4_send / c4_get", async () => {
        const from = rig.transport.sent.length;
        const p = set(APD, "send_raw", {cmd: "c4.dmx.led 00 03 ffffff", dst_ep: 1});
        await tick(100);
        await p;
        expect(rig.cmds(from)).toEqual(["c4.dmx.led 00 03 ffffff"]);
    });

    it("sends c4_send as a Set by default, any frame type letter on request, without an ack on request", async () => {
        let from = rig.transport.sent.length;
        let p = set(APD, "c4_send", {cmd: "c4.dm.rtl 00 32 000003e8", dst_ep: 1, type: "i"});
        await tick(100);
        await p;
        const sent = rig.texts(from);
        expect(sent).toEqual([expect.stringMatching(/^0i[0-9a-f]{4} c4\.dm\.rtl 00 32 000003e8$/)]);
        // The interrupt arms reply capture like the others.
        rig.ascii(APD, `0r${sent[0].slice(2, 6)} 000 c4.dm.rtl`);
        expect(rig.published.at(-1)?.payload.c4_reply).toMatchObject({status: "000", namespace: "c4.dm.rtl"});
        for (const value of ["c4.dm.rb", {cmd: "c4.dm.rb"}, {cmd: "c4.dm.rb", type: "s"}]) {
            from = rig.transport.sent.length;
            p = set(APD, "c4_send", value);
            await tick(100);
            await p;
            expect(rig.texts(from)).toEqual([expect.stringMatching(/^0s[0-9a-f]{4} c4\.dm\.rb$/)]);
        }
        from = rig.transport.sent.length;
        await expect(set(APD, "c4_send", {cmd: "c4.dm.rb", type: "xy"})).rejects.toThrow(/unknown type 'xy'/);
        await expect(set(APD, "c4_send", {cmd: "c4.dm.rb", type: "S"})).rejects.toThrow(/unknown type 'S'/);
        await tick(100);
        expect(rig.texts(from)).toEqual([]);
        // Any frame type letter, a digit in place of the leading 0, and no APS ack on request.
        for (const [type, head] of [["x", "0x"], ["1g", "1g"]]) {
            from = rig.transport.sent.length;
            p = set(APD, "c4_send", {cmd: "c4.sy.fwv", type});
            await tick(100);
            await p;
            expect(rig.texts(from)).toEqual([expect.stringMatching(new RegExp(`^${head}[0-9a-f]{4} c4\.sy\.fwv$`))]);
        }
        from = rig.transport.sent.length;
        p = set(APD, "c4_send", {cmd: "c4.sy.rb", type: "i", ack: false});
        await tick(100);
        await p;
        expect(rig.transport.sent.slice(from).map((x) => x.ack)).toEqual([false]);
        // A reply of a frame type the extension doesn't know is logged while the probe waits.
        rig.ascii(APD, "0e0123 v01");
        expect(rig.log.lines).toContainEqual(expect.stringMatching(/^warning: Control4 FRAME .*0e0123 v01/));
    });

    it("sends c4_raw bytes on a Control4 profile, and logs what the device sends back while it waits", async () => {
        const from = rig.transport.sent.length;
        const p = set(APD, "c4_raw", {profile: "0xc25d", cluster: 1, src_ep: 2, dst_ep: 2, data: "00 01 00 15 00", ack: false});
        await tick(100);
        await p;
        const sent = rig.transport.sent.slice(from);
        expect(sent.map((x) => [x.frame.profile, x.frame.cluster, x.frame.srcEp, x.frame.dstEp, x.frame.data.toString("hex"), x.ack])).toEqual([[0xc25d, 1, 2, 2, "0001001500", false]]);
        rig.inject(APD, 0xc25d, Buffer.from("18010115000028ff", "hex"), true, 2);
        expect(rig.log.lines).toContainEqual(expect.stringMatching(/^warning: Control4 RAW .*profile 0xc25d cluster 1 ep 2->1: 18010115000028ff/));
        await expect(set(APD, "c4_raw", {profile: 260, data: "00"})).rejects.toThrow(/only the Control4 profiles/);
        await expect(set(APD, "c4_raw", {data: "0g"})).rejects.toThrow(/hex bytes/);
    });

    it("writes dm.tv parameters, verifies, and shows what the device really holds", async () => {
        const p = set(APD, "min_brightness", 12);
        await tick(50);
        expect(await p).toEqual({min_brightness: 12});
        expect(rig.cmds().at(-1)).toBe("c4.dm.tv 00 08 0000000c");
        await tick(600);
        expect(rig.texts().at(-1)).toMatch(/^0g[0-9a-f]{4} c4\.dm\.tv 00 08$/);
        rig.reply(APD, "00000005", "c4.dm.tv");
        await tick(50);
        expect(rig.cmds().at(-1)).toBe("c4.dm.tv 00 08 0000000c"); // re-sent once
        await tick(1100);
        rig.reply(APD, "00000005", "c4.dm.tv");
        await tick(50);
        expect(rig.last(APD).min_brightness).toBe(5);
    });

    it("drives its two LEDs, top (slot 01) and bottom (slot 04), brightness-scaled", async () => {
        let p = set(APD, "led_top_on_color", "blue");
        await tick(1000);
        expect(await p).toEqual({led_top_on_color: "blue"});
        p = set(APD, "led_bottom_off_color", "red");
        await tick(1000);
        await p;
        const cmds = rig.cmds().filter((c) => /^c4\.dmx\.led [0-9a-f]{2} 0[34] /.test(c));
        expect(cmds).toEqual(["c4.dmx.led 01 03 0000ff", "c4.dmx.led 04 04 ff0000"]);
        p = set(APD, "led_brightness", 50);
        await tick(2000);
        expect(await p).toEqual({led_brightness: 50});
        expect(rig.cmds()).toEqual(expect.arrayContaining(["c4.dmx.led 01 03 00007f", "c4.dmx.led 04 04 7f0000"]));
    });

    it("moves the 12-slot bar's saved colours to its two LEDs", () => {
        rig.stop();
        rig = new Rig();
        rig.add(APD, "C4-APD120");
        rig.store.set(APD, "led_2_active_color", "red");
        rig.store.set(APD, "led_2_idle_color", "red");
        rig.store.set(APD, "led_idle_color", "magenta");
        rig.start();
        expect(rig.last(APD)).toMatchObject({led_top_on_color: "red", led_top_off_color: "red", led_bottom_on_color: null, led_bottom_off_color: "magenta"});
    });

    it("writes only the LEDs a brightness change changes", async () => {
        const writes = (from: number) => rig.cmds(from).filter((c) => /^c4\.dmx\.led [0-9a-f]{2} 0[34] [0-9a-f]{6}$/.test(c));
        // The night look: the bottom LED off, the top one red.
        for (const [key, colour] of [
            ["led_bottom_off_color", "off"],
            ["led_bottom_on_color", "off"],
            ["led_top_off_color", "red"],
            ["led_top_on_color", "red"],
        ]) {
            const p = set(APD, key, colour);
            await tick(2000);
            await p;
        }
        let from = rig.transport.sent.length;
        let p = set(APD, "led_brightness", 7);
        await tick(5000);
        expect(await p).toEqual({led_brightness: 7});
        // Black is black at any brightness: only the top LED's two colours change.
        expect(writes(from).sort()).toEqual(["c4.dmx.led 01 03 110000", "c4.dmx.led 01 04 110000"]);
        // The same brightness again (two automation runs at once) sends no colour.
        from = rig.transport.sent.length;
        p = set(APD, "led_brightness", 7);
        await tick(5000);
        await p;
        expect(writes(from)).toEqual([]);
    });

    it("still sends a colour a fade overtook while its write was in flight", async () => {
        // led_transition on, writes slow to land: red goes out, blue fades from it, then red again.
        let p = set(APD, "led_transition", 1);
        await tick(50);
        await p;
        rig.transport.latency = 300;
        const first = set(APD, "led_top_off_color", "red");
        await tick(10);
        const second = set(APD, "led_top_off_color", "blue");
        await tick(12_000);
        await Promise.all([first, second]);
        expect(rig.cmds().filter((c) => /^c4.dmx.led 01 04 [0-9a-f]{6}$/.test(c)).at(-1)).toBe("c4.dmx.led 01 04 0000ff");
        const from = rig.transport.sent.length;
        p = set(APD, "led_top_off_color", "red");
        await tick(12_000);
        await p;
        expect(rig.cmds(from).filter((c) => /^c4.dmx.led 01 04 [0-9a-f]{6}$/.test(c)).at(-1)).toBe("c4.dmx.led 01 04 ff0000");
    });

    it("keeps the newer colour as sent when an older write is confirmed after it", async () => {
        // The send window frees a device after 3 s, so a slow confirmation can come after a newer one's.
        const send = rig.transport.send.bind(rig.transport);
        rig.transport.send = async (nwk, frame, options) => {
            await send(nwk, frame, options);
            if (frame.data.toString("latin1").includes("c4.dmx.led 01 04 ff0000")) await new Promise((r) => setTimeout(r, 5000));
        };
        const red = set(APD, "led_top_off_color", "red");
        await tick(3200);
        const blue = set(APD, "led_top_off_color", "blue");
        await tick(5000);
        await Promise.all([red, blue]);
        // The LED shows blue (sent last); red, asked for again, must go out again.
        const from = rig.transport.sent.length;
        const again = set(APD, "led_top_off_color", "red");
        await tick(8000);
        await again;
        expect(rig.cmds(from)).toContain("c4.dmx.led 01 04 ff0000");
    });

    it("ends several different brightness sets in a row on the newest, writing no colour twice over", async () => {
        for (const [key, colour] of [
            ["led_top_on_color", "white"],
            ["led_top_off_color", "white"],
            ["led_bottom_on_color", "white"],
            ["led_bottom_off_color", "white"],
        ]) {
            const p = set(APD, key, colour);
            await tick(2000);
            await p;
        }
        rig.transport.latency = 400;
        const from = rig.transport.sent.length;
        const runs = [set(APD, "led_brightness", 20), set(APD, "led_brightness", 40), set(APD, "led_brightness", 60)];
        await tick(15_000);
        await Promise.all(runs);
        const writes = rig.cmds(from).filter((c) => /^c4\.dmx\.led [0-9a-f]{2} 0[34] [0-9a-f]{6}$/.test(c));
        // Counting writes still on their way, the three write no more than the first colour each and the rest once (not 12 frames).
        expect(writes.length).toBeLessThanOrEqual(6);
        // What the LEDs end on is the last brightness: 60 % of white.
        for (const slot of ["01 03", "01 04", "04 03", "04 04"]) expect(writes.filter((w) => w.startsWith(`c4.dmx.led ${slot}`)).at(-1)).toBe(`c4.dmx.led ${slot} 999999`);
    });

    it("moves the old bound switches of its two LEDs to their modes", () => {
        rig.stop();
        rig = new Rig();
        rig.add(APD, "C4-APD120");
        rig.store.set(APD, "led_2_bound", true);
        rig.store.set(APD, "led_5_bound", false);
        rig.start();
        expect(rig.last(APD)).toMatchObject({led_top_mode: "push_release", led_bottom_mode: "programmed"});
    });

    it("sends each colour once when brightness sets arrive back to back", async () => {
        for (const [key, colour] of [
            ["led_top_on_color", "cyan"],
            ["led_top_off_color", "magenta"],
            ["led_bottom_on_color", "cyan"],
            ["led_bottom_off_color", "magenta"],
        ]) {
            const p = set(APD, key, colour);
            await tick(2000);
            await p;
        }
        // Writes take a while to land, as on a busy mesh: three queued automation runs.
        rig.transport.latency = 400;
        const from = rig.transport.sent.length;
        const runs = [set(APD, "led_brightness", 15), set(APD, "led_brightness", 15), set(APD, "led_brightness", 15)];
        await tick(10_000);
        await Promise.all(runs);
        const writes = rig.cmds(from).filter((c) => /^c4\.dmx\.led [0-9a-f]{2} 0[34] [0-9a-f]{6}$/.test(c));
        expect(writes).toHaveLength(4);
        expect(new Set(writes).size).toBe(4);
    });

    it("sets an LED's mode and reads it back", async () => {
        const p = set(APD, "led_top_mode", "push_release");
        await tick(50);
        expect(await p).toEqual({led_top_mode: "push_release"});
        expect(rig.cmds().at(-1)).toBe("c4.dmx.led 01 01 02");
        await tick(600);
        expect(rig.texts().at(-1)).toMatch(/^0g[0-9a-f]{4} c4\.dmx\.led 01 01$/);
        await expect(set(APD, "led_top_mode", "sparkle")).rejects.toThrow(/unknown LED mode/);
    });

    it("polls ambient light and power, accepting only its own replies", async () => {
        rig.stop();
        vi.spyOn(Math, "random").mockReturnValue(0);
        rig = new Rig();
        rig.add(APD, "C4-APD120");
        rig.start();
        await tick(80_000);
        const amb = rig.texts().reverse().find((t) => t.includes("c4.dmx.amb 00")) as string;
        expect(amb).toBeDefined();
        rig.ascii(APD, `0r${amb.slice(2, 6)} 000 c4.dmx.amb ff`);
        expect(rig.last(APD).ambient_light).toBe(255);
        rig.ascii(APD, "0rffff 000 c4.dmx.amb 1e");
        expect(rig.last(APD).ambient_light).toBe(255);
        const pwr = rig.texts().reverse().find((t) => t.endsWith("c4.dmx.pwr")) as string;
        rig.ascii(APD, `0r${pwr.slice(2, 6)} 000 c4.dmx.pwr 0084 0168 001f 0030 028c 0016 0000`);
        expect(rig.last(APD)).toMatchObject({voltage: 132, current: 0.36, power: 31, power_apparent: 48, power_factor: 0.652, energy: 0.028});
        expect(rig.last(APD).device_temperature).toBeUndefined();
    });

    it("carries its energy total across a counter drop (a reboot restores its last save)", () => {
        const ls = (count: string) => rig.ascii(APD, `0t0001 sa c4.dmx.ls 00 00 64 007d 0124 0024 0024 03dd ${count} 0000`);
        ls("0b74"); // 2932
        expect(rig.last(APD).energy).toBe(3.724);
        ls("07d0"); // 2000 after the reboot
        expect(rig.last(APD).energy).toBe(3.724);
        ls("07d1");
        expect(rig.last(APD).energy).toBe(3.725);
        expect(rig.store.get(APD, "energy_offset")).toBe(932);
    });
});

describe("C4-4SF120 provisioning", () => {
    it("provisions once, and again only after the fan left", async () => {
        const provisions = () => rig.cmds().filter((c) => c === "c4.dm.tv 00 01 00").length;
        await tick(40_000);
        expect(provisions()).toBe(1);
        expect(rig.store.get(FAN, "fan_provisioned")).toBe(true);
        // A restart (new runtime, same store) does not provision again.
        rig.stop();
        const store = rig.store;
        rig = new Rig({store});
        rig.add(FAN, "C4-4SF120");
        rig.start();
        await tick(40_000);
        expect(provisions()).toBe(0);
        // After a leave it does, when the fan is back.
        rig.runtime.forgetProvisioning(FAN);
        rig.runtime.removeDevice(FAN);
        rig.runtime.ensureDevice(FAN);
        await tick(40_000);
        expect(provisions()).toBe(1);
    });
});

describe("poll options", () => {
    it("stretches or switches off the sensor polls per device", async () => {
        rig.stop();
        vi.spyOn(Math, "random").mockReturnValue(0);
        rig = new Rig();
        const opts: Record<string, unknown> = {ambient_light_poll: 0, power_poll: 600};
        rig.add(APD, "C4-APD120", {options: opts});
        rig.start();
        await tick(30 * 60_000);
        const count = (p: string) => rig.texts().filter((t) => t.startsWith("0g") && t.endsWith(p)).length;
        expect(count("c4.dmx.amb 00")).toBe(0);
        // first poll after 20 s, then every 600 s (x0.9 jitter with random = 0)
        expect(count("c4.dmx.pwr")).toBe(4);
        // Switching it back on takes effect without a restart.
        opts.ambient_light_poll = 30;
        await tick(5 * 60_000);
        expect(count("c4.dmx.amb 00")).toBeGreaterThan(3);
    });
});

describe("C4-SW120277", () => {
    it("switches with ZCL on/off", async () => {
        const p = set(SW, "state", "ON");
        await tick(50);
        expect(await p).toEqual({state: "ON"});
        const f = rig.transport.sent.at(-1)?.frame;
        expect(f?.cluster).toBe(0x0006);
        expect(f?.data[2]).toBe(0x01);
    });

    it("takes paddle_local_control as both halves' behaviour, and then ignores click-count on/off", async () => {
        const p = set(SW, "paddle_local_control", "OFF");
        await tick(100);
        expect(await p).toEqual({top_button_behaviour: "event_only", bottom_button_behaviour: "event_only"});
        expect(rig.cmds().filter((c) => c.startsWith("c4.dmx.btn"))).toEqual(["c4.dmx.btn 01 01 03", "c4.dmx.btn 05 01 03"]);
        rig.ascii(SW, "0t0001 sa c4.dmx.ls 00 00 00 00");
        rig.ascii(SW, "0t0001 sa c4.dmx.cc 01 01");
        expect(rig.last(SW).state).toBe("OFF");
        expect(rig.actions(SW)).toContain("top_single");
    });

    it("takes a toggling half's state from the relay's report, not its tap, and leaves a momentary half's alone", async () => {
        let p = set(SW, "bottom_button_behaviour", "toggle");
        await tick(100);
        expect(await p).toEqual({bottom_button_behaviour: "toggle"});
        expect(rig.cmds().at(-1)).toBe("c4.dmx.btn 05 01 02");
        rig.ascii(SW, "0t0001 sa c4.dmx.ls 00 00 00 00");
        // The relay reports the toggle at once; the tap's count comes after the multi-click window.
        rig.ascii(SW, "0t0002 sa c4.dmx.ls 00 00 64 00");
        rig.ascii(SW, "0t0003 sa c4.dmx.cc 05 01");
        expect(rig.last(SW).state).toBe("ON");
        p = set(SW, "top_button_behaviour", "momentary");
        await tick(100);
        await p;
        rig.ascii(SW, "0t0003 sa c4.dmx.cc 01 01");
        expect(rig.last(SW).state).toBe("ON");
        await expect(set(SW, "top_button_behaviour", "disabled")).rejects.toThrow(/unknown button behaviour/);
    });

    it("keeps a decoupled paddle's halves event-only after the update", () => {
        rig.stop();
        rig = new Rig();
        rig.add(SW, "C4-SW120277");
        rig.store.set(SW, "sw_decoupled", true);
        rig.start();
        expect(rig.last(SW)).toMatchObject({top_button_behaviour: "event_only", bottom_button_behaviour: "event_only"});
    });

    it("sets multi-click timings", async () => {
        const p = set(SW, "multiclick_time_1", 300);
        await tick(50);
        expect(await p).toEqual({multiclick_time_1: 300});
        expect(rig.cmds().at(-1)).toBe("c4.dmx.bmc 00 012c");
    });

    it("tracks on/off from c4.dmx.ls and ignores the check-in status attribute", () => {
        rig.ascii(SW, "0t0001 sa c4.dmx.ls 00 00 00 00");
        expect(rig.last(SW).state).toBe("OFF");
        rig.checkin(SW, "c4:control4_switch:C4-SW120277", Buffer.from([0x00, 0x00, 0x20, 0x02]));
        expect(rig.last(SW).state).toBe("OFF");
        rig.ascii(SW, "0t0002 sa c4.dmx.ls 00 00 64 00");
        expect(rig.last(SW).state).toBe("ON");
    });
});

describe("C4-4SF120", () => {
    it("reports the speed from c4.dmx.fs", () => {
        rig.ascii(FAN, "0t0001 sa c4.dmx.fs 00 00 03 00 00");
        expect(rig.last(FAN)).toMatchObject({state: "ON", speed: 3});
        rig.ascii(FAN, "0t0001 sa c4.dmx.fs 00 00 00 00 00");
        expect(rig.last(FAN).state).toBe("OFF");
    });

    it("sets a speed and turns back on at the last one", async () => {
        let p = set(FAN, "speed", 2);
        await tick(50);
        expect(await p).toEqual({state: "ON", speed: 2});
        expect(rig.cmds().at(-1)).toBe("c4.dmx.fsc 00 02");
        p = set(FAN, "state", "OFF");
        await tick(50);
        expect(rig.cmds().at(-1)).toBe("c4.dmx.fsc 00 00");
        p = set(FAN, "state", "ON");
        await tick(50);
        expect(await p).toEqual({state: "ON", speed: 2});
    });

    it("provisions ramps and speed LEDs", async () => {
        await tick(40_000);
        const cmds = rig.cmds();
        expect(cmds).toContain("c4.dm.tv 00 06 00");
        expect(cmds).toContain("c4.dmx.led 00 01 07");
        expect(cmds).toContain("c4.dmx.led 04 01 03");
    });

    it("names the speed buttons", () => {
        rig.ascii(FAN, "0t0001 sa c4.dmx.cc 02 01");
        expect(rig.actions(FAN)).toEqual(["medium_high_single"]);
        expect(rig.last(FAN).speed).toBe(3);
    });
});