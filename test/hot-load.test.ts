// A hot-load starts the extension again inside a Zigbee2MQTT that kept running: the
// devices it starts with already had their once-per-process start-up work, so they
// skip it. A restart, and any device that joins after the hot-load, still get it.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {PROFILE_NETWORK} from "../src/core/constants";
import {Rig, tick} from "./rig";

const KP = "0x000fff00000000c1";
const DIM = "0x000fff00000000d1";
const IO = "0x000fff00000000f1";
const SR = "0x000fff00000000e1";

let rig: Rig;

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(KP, "KPZ-3B1");
    rig.add(DIM, "C4-DIM1-Z");
    rig.add(IO, "C4-Z2IO-ZP");
    rig.add(SR, "C4-SR250B", {type: "EndDevice"});
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

/** The controller identity frames sent to a device. */
const identities = (ieee: string) => rig.transport.sent.filter((s) => s.nwk === rig.nwk(ieee) && s.frame.profile === PROFILE_NETWORK).length;
/** The ASCII commands sent to a device. */
const cmdsTo = (ieee: string) =>
    rig.transport.sent.filter((s) => s.nwk === rig.nwk(ieee) && s.frame.profile !== PROFILE_NETWORK).map((s) => s.text.replace(/^0[sgir][0-9a-f]{4} /, ""));

/** What the start-up work leaves on the radio, 45 s after a start: the keypad and remote identities, the DIM1-Z's read, the IO module's set-up. */
async function startupWork() {
    rig.ascii(IO, "0t0001 sa c4.z2x.cts 00", true, 197); // the IO module's first frame
    await tick(45_000);
    return {
        keypadIdentities: identities(KP),
        dimReads: rig.zclReads.filter((r) => r.ieee === DIM).length,
        ioProvisioned: cmdsTo(IO).includes("c4.z2x.ctd 1 1f4"),
        remoteBootstrapped: identities(SR) > 0 || cmdsTo(SR).some((c) => c.startsWith("c4.ln.ri")),
    };
}

describe("start-up work", () => {
    it("is all done on a start that is no hot-load", async () => {
        rig.start();
        const work = await startupWork();
        expect(work.keypadIdentities).toBeGreaterThanOrEqual(3);
        expect(work.dimReads).toBeGreaterThan(0);
        expect(work.ioProvisioned).toBe(true);
        expect(work.remoteBootstrapped).toBe(true);
    });

    it("is skipped on a hot-load for the devices it starts with", async () => {
        rig.start(true);
        expect(await startupWork()).toEqual({keypadIdentities: 0, dimReads: 0, ioProvisioned: false, remoteBootstrapped: false});
    });

    it("is done after a hot-load for a keypad that joins", async () => {
        rig.start(true);
        const joined = rig.add("0x000fff00000000c2", "KPZ-3B1");
        rig.runtime.ensureDevice(joined); // as the extension does on its interview
        await tick(45_000);
        expect(identities(joined)).toBeGreaterThanOrEqual(3);
        expect(identities(KP)).toBe(0);
    });

    it("is done after a hot-load for an IO module that left and joined again", async () => {
        rig.start(true);
        rig.runtime.removeDevice(IO); // as the extension does on its leave
        rig.runtime.ensureDevice(IO); // and on its interview
        rig.ascii(IO, "0t0001 sa c4.z2x.cts 00", true, 197);
        await tick(1_000);
        expect(cmdsTo(IO)).toContain("c4.z2x.ctd 1 1f4");
    });
});
