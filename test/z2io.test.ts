import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Rig, tick} from "./rig";

let rig: Rig;
const IO = "0x000fff00000000f1";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(IO, "C4-Z2IO-ZP");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

/** Answer every outstanding request with `0r<seq> 000 [prop value]`. */
function answerAll(values: Record<string, string> = {}) {
    for (const t of rig.texts()) {
        const [head, prop] = t.split(" ");
        if (!/^0[sg]/.test(head)) continue;
        const v = values[prop];
        rig.ascii(IO, v === undefined ? `0r${head.slice(2)} 000` : `0r${head.slice(2)} 000 ${prop} ${v}`, true, 197);
    }
}

describe("C4-Z2IO-ZP", () => {
    it("talks EP197 to EP197", async () => {
        rig.ascii(IO, "0t0001 sa c4.z2x.cts 1f", true, 197);
        await tick(100);
        const s = rig.transport.sent[0];
        expect(s.frame.srcEp).toBe(197);
        expect(s.frame.dstEp).toBe(197);
    });

    it("provisions on the first frame (debounce, mode, reads)", async () => {
        rig.ascii(IO, "0t0001 sa c4.z2x.cts 00", true, 197);
        for (let i = 0; i < 40; i++) {
            await tick(200);
            answerAll({"c4.sy.fwv": "1.2.0"});
        }
        const cmds = rig.cmds();
        expect(cmds[0]).toBe("c4.z2x.ctd 1 1f4");
        expect(cmds[1]).toBe("c4.z2x.opt 2");
        expect(cmds).toContain("c4.sy.zpc 348");
        expect(cmds).toContain("c4.z2x.thumi");
    });

    it("publishes contacts (bit set = closed), temperatures and humidity", () => {
        rig.ascii(IO, "0t0001 sa c4.z2x.cts 05", true, 197);
        expect(rig.last(IO)).toMatchObject({contact_1: true, contact_2: false, contact_3: true, contact_4: false});
        expect(rig.actions(IO)).toContain("contact_state_changed");
        rig.ascii(IO, "0t0002 sa c4.z2x.tmpi 71f8", true, 197);
        rig.ascii(IO, "0t0003 sa c4.z2x.tmpe 5b13", true, 197);
        rig.ascii(IO, "0t0004 sa c4.z2x.thumi 1993", true, 197);
        expect(rig.last(IO)).toMatchObject({temperature: 18.61, humidity: 65.47});
        expect(rig.last(IO).external_temperature).toBeUndefined();
    });

    it("pulses a relay with rlc / rlo in relay mode", async () => {
        const mode = rig.runtime.set(IO, "io_mode", "relays_2_spst", {message: {}});
        await tick(50);
        answerAll();
        expect(await mode).toEqual({io_mode: "relays_2_spst"});
        expect(rig.exposesChanged).toContain(IO);
        const from = rig.transport.sent.length;
        let done = false;
        const p = rig.runtime.set(IO, "relay_1_pulse", "pulse", {message: {}}).finally(() => {
            done = true;
        });
        for (let i = 0; i < 30 && !done; i++) {
            await tick(100);
            answerAll();
        }
        await p;
        expect(rig.cmds(from).filter((c) => /^c4.z2x.rl[co] /.test(c))).toEqual(["c4.z2x.rlc 1", "c4.z2x.rlo 1"]);
    });

    it("refuses a relay the IO mode does not have", async () => {
        await expect(rig.runtime.set(IO, "relay_1", "ON", {message: {}})).rejects.toThrow(/not available/);
    });

    it("tracks relays from rls", async () => {
        const mode = rig.runtime.set(IO, "io_mode", 1, {message: {}});
        await tick(50);
        answerAll();
        await mode;
        rig.ascii(IO, "0t0005 sa c4.z2x.rls 02", true, 197);
        expect(rig.last(IO)).toMatchObject({relay_1: "OFF", relay_2: "ON"});
    });
});
