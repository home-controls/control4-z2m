// Known taps: every tap is published as tap_known the moment it is known to be
// a tap (a keypad's release, a DIM1-Z's paddle-down), with its tap index; the
// fast count says whether its taps were all announced that way.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Store} from "../src/core/store";
import {showEvent} from "./contract";
import {Rig, silent, tick} from "./rig";

let rig: Rig;
const KP = "0x000fff00000000c1";
const KC = "0x000fff00000000c3";
const DIM = "0x000fff00000000b1";
const FS1 = "0x000fff00000000b2";
const FAN = "0x000fff00000000f1";
const OUT = "0x000fff00000000b3";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(KP, "KPZ-3B1");
    rig.add(KC, "C4-KC120277");
    rig.add(DIM, "C4-DIM1-Z");
    rig.add(FS1, "C4-FS1-Z");
    rig.add(FAN, "C4-4SF120");
    rig.add(OUT, "LOZ-5S1-W");
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

/** Feed announcements 20 ms apart. */
async function frames(ieee: string, ...texts: string[]): Promise<void> {
    for (const t of texts) {
        rig.ascii(ieee, `0t0001 sa ${t}`);
        await tick(20);
    }
}

/** The device's events from index `from`, as "gesture" plus the known-tap fields it carries. */
function seen(ieee: string, from = 0): string[] {
    return rig.events
        .filter((e) => e.ieee === ieee)
        .slice(from)
        .map((e) => showEvent(e, e.gesture));
}

const count = (ieee: string) => rig.events.filter((e) => e.ieee === ieee).length;

describe("a keypad already seen releasing", () => {
    beforeEach(async () => {
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00"); // teaches it that button_1 releases
        await tick(1000);
    });

    it("publishes tap_known with tap index 1 on a tap's release", async () => {
        const from = count(KP);
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        expect(seen(KP, from)).toEqual(["press", "release", "tap_known #1"]);
    });

    it.each([
        [1, "fast_single"],
        [2, "fast_double"],
        [3, "fast_triple"],
        [4, "fast_quadruple"],
    ])("numbers the %i known taps of a sequence, and its fast count says they were known", async (n, fast) => {
        const from = count(KP);
        for (let i = 0; i < n; i++) await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        await tick(1000);
        const taps = Array.from({length: n}, (_, i) => ["press", "release", `tap_known #${i + 1}`]).flat();
        expect(seen(KP, from)).toEqual([...taps, `${fast} known=true`]);
    });

    it("announces no known tap for a hold, and the next tap is #1 again", async () => {
        const from = count(KP);
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00", "c4.kp.bb 00", "c4.kp.bh 00", "c4.kp.bh 00", "c4.kp.be 00");
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        await tick(1000);
        expect(seen(KP, from)).toEqual(["press", "release", "tap_known #1", "press", "hold", "hold", "hold_release", "press", "release", "tap_known #1", "fast_single known=true"]);
    });

    it("announces a late release's tap before the fast count it closes, which says the taps were known", async () => {
        const from = count(KP);
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00", "c4.kp.bb 00");
        await tick(700); // past the tap window: the sequence waits for the last release
        await frames(KP, "c4.kp.bc 00");
        expect(seen(KP, from)).toEqual(["press", "release", "tap_known #1", "press", "release", "tap_known #2", "fast_double known=true"]);
    });

    it("announces no later tap of a sequence whose earlier release was lost, even on a late release", async () => {
        const from = count(KP);
        await frames(KP, "c4.kp.bb 00", "c4.kp.bb 00");
        await tick(700);
        await frames(KP, "c4.kp.bc 00");
        expect(seen(KP, from)).toEqual(["press", "press", "release", "fast_double known=false"]);
    });

    it("announces no later tap of a sequence whose earlier release was lost: its fast count handles it", async () => {
        const from = count(KP);
        await frames(KP, "c4.kp.bb 00", "c4.kp.bb 00", "c4.kp.bc 00");
        await tick(1000);
        expect(seen(KP, from)).toEqual(["press", "press", "release", "fast_double known=false"]);
    });
});

describe("a KC120277 already seen releasing", () => {
    beforeEach(async () => {
        await frames(KC, "c4.dmx.bp 02", "c4.dmx.sc 02");
        await tick(1000);
    });

    it.each([
        [1, "fast_single"],
        [2, "fast_double"],
        [3, "fast_triple"],
        [4, "fast_quadruple"],
    ])("announces each of %i taps on its release, and its fast count says they were known", async (n, fast) => {
        const from = count(KC);
        for (let i = 0; i < n; i++) await frames(KC, "c4.dmx.bp 02", "c4.dmx.sc 02");
        await tick(1000);
        const taps = Array.from({length: n}, (_, i) => ["press", "release", `tap_known #${i + 1}`]).flat();
        expect(seen(KC, from)).toEqual([...taps, `${fast} known=true`]);
        expect(rig.events.at(-2)).toMatchObject({action: "button_2_tap_known", button: "button_2", button_id: 2, tap_index: n});
    });

    it("announces no known tap for a hold", async () => {
        const from = count(KC);
        await frames(KC, "c4.dmx.bp 02", "c4.dmx.hc 02", "c4.dmx.he 02");
        await tick(1000);
        expect(seen(KC, from)).toEqual(["press", "hold", "hold_release"]);
    });
});

describe("a DIM1-Z, which has no hold", () => {
    it.each([
        [1, "fast_single"],
        [2, "fast_double"],
        [3, "fast_triple"],
        [4, "fast_quadruple"],
    ])("announces each of %i taps at paddle-down, and its fast count says they were known", async (n, fast) => {
        await frames(DIM, ...Array.from({length: n}, () => "c4.dm.b0c"));
        await tick(1000);
        const taps = Array.from({length: n}, (_, i) => ["press", `tap_known #${i + 1}`]).flat();
        expect(seen(DIM)).toEqual([...taps, `${fast} known=true`]);
    });
});

// Assumed to report as the DIM1-Z does (no capture from a unit yet, #51).
describe("an FS1-Z, which has no hold", () => {
    it.each([
        [1, "fast_single"],
        [2, "fast_double"],
    ])("announces each of %i taps at paddle-down, and its fast count says they were known", async (n, fast) => {
        await frames(FS1, ...Array.from({length: n}, () => "c4.dm.b1c"));
        await tick(1000);
        const taps = Array.from({length: n}, (_, i) => ["press", `tap_known #${i + 1}`]).flat();
        expect(seen(FS1)).toEqual([...taps, `${fast} known=true`]);
        expect(rig.events.filter((e) => e.ieee === FS1).every((e) => e.button === "button_2")).toBe(true);
    });

    it("announces no known tap for a hold, which comes with no paddle-down", async () => {
        await frames(FS1, "c4.dm.b0b", "c4.dm.b0e");
        await tick(1000);
        expect(seen(FS1)).toEqual(["hold", "hold_release"]);
    });
});

// c4-scenarios plays the fan and the outlet the KC120277's contract events.
describe("the fan and the outlet, c4.dmx devices like the KC120277", () => {
    /** The KC120277's contract fixture frames, on button wire `wire`: a first tap, a known tap, a known double tap, a hold. */
    async function contract(ieee: string, wire: string): Promise<void> {
        const on = (...verbs: string[]) => verbs.map((v) => `c4.dmx.${v} ${wire}`);
        const cc = (n: string) => [`c4.dmx.cc ${wire} ${n}`];
        for (const group of [on("bp", "sc"), cc("01"), on("bp", "sc"), cc("01"), on("bp", "sc", "bp", "sc"), cc("02"), on("bp", "hc", "he")]) {
            await frames(ieee, ...group);
            await tick(1000);
        }
    }

    it.each([
        [FAN, "03", "medium_low"],
        [OUT, "01", "outlet_2"],
    ])("%s publishes its button events exactly as a KC120277 does", async (ieee, wire, name) => {
        await contract(KC, "00");
        await contract(ieee, wire);
        expect(seen(ieee)).toEqual(seen(KC));
        expect(seen(ieee)).toContain("tap_known #2");
        expect(rig.events.filter((e) => e.ieee === ieee).every((e) => e.button === name && e.button_id === Number(wire))).toBe(true);
    });
});

describe("a keypad never seen releasing", () => {
    it("announces no known tap, and its fast count says the taps were not known", async () => {
        await frames(KP, "c4.kp.bb 00", "c4.kp.bb 00");
        await tick(1000);
        expect(seen(KP)).toEqual(["press", "press", "fast_double known=false"]);
    });

    it("announces none of a first double tap's taps, though its first release teaches the button releases", async () => {
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00", "c4.kp.bb 00", "c4.kp.bc 00");
        await tick(1000);
        expect(seen(KP)).toEqual(["press", "release", "press", "release", "fast_double known=false"]);
    });
});

describe("a keypad across a new start", () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "c4z2m-taps-"));
        file = path.join(dir, "control4.json");
        rig.stop();
        rig = new Rig({store: new Store(file, silent)});
        rig.add(KP, "KPZ-3B1");
        rig.start();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    /** A new start on the saved settings: after a stop (a hot-load, a restart) or with none (a power cut). */
    async function startAgain(how: "stop" | "power cut"): Promise<void> {
        await tick(1000); // the settings are written
        const old = rig;
        if (how === "stop") old.stop();
        rig = new Rig({store: new Store(file, silent)});
        rig.add(KP, "KPZ-3B1");
        rig.start();
        if (how === "power cut") old.stop(); // only to clean up: the new start has already read the file
    }

    /** Writes of the settings file from now on. */
    function storeWrites() {
        const rename = vi.spyOn(fs, "renameSync");
        return () => rename.mock.calls.filter(([, to]) => to === file).length;
    }

    it.each(["stop", "power cut"] as const)("announces the first tap after a %s as tap_known, for a button that released before it", async (how) => {
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        await startAgain(how);
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        await tick(1000);
        expect(seen(KP)).toEqual(["press", "release", "tap_known #1", "fast_single known=true"]);
    });

    it("announces no known tap for a button never seen releasing, though another button of the keypad was", async () => {
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        await startAgain("stop");
        await frames(KP, "c4.kp.bb 01", "c4.kp.bc 01");
        await tick(1000);
        expect(seen(KP)).toEqual(["press", "release", "fast_single known=false"]);
    });

    it("writes nothing for a release already stored, and once for a button's first release", async () => {
        await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        await startAgain("stop");
        const writes = storeWrites();
        for (let i = 0; i < 3; i++) await frames(KP, "c4.kp.bb 00", "c4.kp.bc 00");
        await tick(1000);
        expect(writes()).toBe(0);
        for (let i = 0; i < 3; i++) await frames(KP, "c4.kp.bb 01", "c4.kp.bc 01");
        await tick(1000);
        expect(writes()).toBe(1);
    });
});
