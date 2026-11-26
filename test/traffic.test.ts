// The traffic alarms (#20): no Control4 frame through the receive hook for 30 min
// on an instance that has a router keepalive would hear from (no_frames), and sends
// that herdsman never confirms (sends_failing). Dead devices trip neither.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {TX_SLOT_HOLD_MAX} from "../src/core/link";
import {DeliveryError, SENT_TIMEOUT_MS} from "../src/core/transport";
import {Rig, tick} from "./rig";

const DIM = "0x000fff00000000d1";
const KP = "0x000fff00000000c1";
const SR = "0x000fff00000000e1";

let rig: Rig;

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const minutes = (n: number) => tick(n * 60_000);
const errors = () => rig.log.lines.filter((l) => l.startsWith("error: "));
const lastInfo = () => rig.log.lines.filter((l) => l.startsWith("info: ")).at(-1);

describe("no_frames", () => {
    it("is raised 30 min after start when no frame ever came, on an instance with a Get-capable router", async () => {
        rig.add(DIM, "C4-DIM1-Z");
        rig.start();
        await minutes(29);
        expect(rig.runtime.traffic.problems()).toEqual([]);
        await minutes(2);
        expect(rig.runtime.traffic.problems()).toEqual(["no_frames"]);
        expect(errors()).toEqual([expect.stringMatching(/^error: Control4: no Control4 frame has come through Zigbee2MQTT for 30 min/)]);
    });

    it("counts from the last frame of any kind, and clears on the next one", async () => {
        rig.add(DIM, "C4-DIM1-Z");
        rig.start();
        await minutes(20);
        rig.checkin(DIM, "c4:control4_dimmer:C4-DIM1-Z"); // a broadcast check-in counts
        await minutes(29);
        expect(rig.runtime.traffic.problems()).toEqual([]);
        await minutes(2);
        expect(rig.runtime.traffic.problems()).toEqual(["no_frames"]);
        expect(rig.runtime.traffic.lastFrameSeconds()).toBe(31 * 60);

        rig.ascii(DIM, "0t0001 sa c4.dm.cc 00 01");
        expect(rig.runtime.traffic.problems()).toEqual([]);
        expect(lastInfo()).toMatch(/^info: Control4: Control4 frames are coming through again/);
        expect(rig.runtime.traffic.lastFrameSeconds()).toBe(0);
    });

    it("stays off on an instance with no router keepalive hears from (keypads, remotes)", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.add(SR, "C4-SR250B", {type: "EndDevice"});
        rig.start();
        expect(rig.runtime.traffic.armed()).toBe(false);
        await minutes(120);
        expect(rig.runtime.traffic.problems()).toEqual([]);
        expect(errors()).toEqual([]);
    });

    it("arms once a Get-capable router appears", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.start();
        expect(rig.runtime.traffic.armed()).toBe(false);
        rig.add(DIM, "C4-DIM1-Z");
        rig.runtime.ensureDevice(DIM);
        expect(rig.runtime.traffic.armed()).toBe(true);
    });
});

describe("sends_failing", () => {
    beforeEach(() => {
        rig.add(DIM, "C4-DIM1-Z");
        rig.start();
    });
    const send = async () => {
        const sent = rig.runtime.sendIdentity(DIM, "test");
        await tick(200); // the link paces its sends
        await sent;
    };

    it("is raised after 5 sends in a row that herdsman never confirmed, and any confirmed send clears it", async () => {
        rig.transport.failWith = () => new DeliveryError("no delivery confirmation", "unconfirmed");
        for (let i = 0; i < 4; i++) await send();
        expect(rig.runtime.traffic.problems()).toEqual([]);
        await send();
        expect(rig.runtime.traffic.problems()).toEqual(["sends_failing"]);
        expect(errors()).toEqual([expect.stringMatching(/^error: Control4: the last 5 sends got no delivery confirmation/)]);

        rig.transport.failWith = undefined;
        await send();
        expect(rig.runtime.traffic.problems()).toEqual([]);
        expect(lastInfo()).toMatch(/^info: Control4: sends are confirmed again/);
    });

    it("is cleared by a send the radio reported as undelivered: herdsman's confirmation came", async () => {
        rig.transport.failWith = () => new DeliveryError("no delivery confirmation", "unconfirmed");
        for (let i = 0; i < 5; i++) await send();
        rig.transport.failWith = () => new DeliveryError("delivery failed (status 0x66)", "failed");
        await send();
        expect(rig.runtime.traffic.problems()).toEqual([]);
    });

    it("is never raised by dead devices, whose sends are confirmed as failed", async () => {
        rig.transport.failWith = () => new DeliveryError("delivery failed (status 0x66)", "failed");
        for (let i = 0; i < 20; i++) await send();
        expect(rig.runtime.traffic.problems()).toEqual([]);
    });
});

describe("sends_failing behind the send window", () => {
    const FAN = "0x000fff00000000f1";
    const set = (key: string, value: unknown) => rig.runtime.set(FAN, key, value, {message: {[key]: value}});

    // The Zigbee2MQTT harness case (#55): a load command waits for its own device's frame in flight
    // (link.ts, the send window), so the confirmation that clears the alarm can come up to
    // TX_SLOT_HOLD_MAX after the command.
    it("clears at the next confirmed send, a load command that waited for its device's unconfirmed frame", async () => {
        rig.add(FAN, "C4-4SF120");
        rig.start();
        await tick(40_000); // the fan's one-off provisioning, confirmed
        // herdsman takes each frame but never emits messageSent: EmberTransport gives up on it.
        const confirmed = rig.transport.send.bind(rig.transport);
        const unconfirmed = vi.spyOn(rig.transport, "send").mockImplementation(async (nwk, frame, options) => {
            await confirmed(nwk, frame, options);
            await new Promise((r) => setTimeout(r, SENT_TIMEOUT_MS));
            throw new DeliveryError("no delivery confirmation", "unconfirmed");
        });
        for (let speed = 1; speed <= 5; speed++) {
            void set("speed", speed % 4).catch(() => undefined);
            await tick(15_000);
        }
        expect(rig.runtime.traffic.problems()).toEqual(["sends_failing"]);

        unconfirmed.mockRestore();
        const from = rig.transport.sent.length;
        const off = set("state", "OFF");
        // The fan's frame in flight is the last speed's retry, sent a second ago: the OFF waits for it.
        await tick(1_000);
        expect(rig.cmds(from)).toEqual([]);
        expect(rig.runtime.traffic.problems()).toEqual(["sends_failing"]);
        await tick(TX_SLOT_HOLD_MAX);
        expect(rig.cmds(from)).toEqual(["c4.dmx.fsc 00 00"]);
        expect(await off).toEqual({state: "OFF"});
        expect(rig.runtime.traffic.problems()).toEqual([]);
        expect(lastInfo()).toMatch(/^info: Control4: sends are confirmed again/);
    });
});
