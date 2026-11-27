/**
 * EmberTransport and EzspTransport against the real zigbee-herdsman 10.10.0
 * EmberAdapter / EZSPAdapter (built offline - nothing is opened until start()). Proves the receive hook sits in
 * front of herdsman's own filter and the send path uses its real queue.
 */

import {EventEmitter} from "node:events";
import os from "node:os";
import path from "node:path";

import {afterEach, describe, expect, it, vi} from "vitest";
// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman
import * as emberModule from "zigbee-herdsman/dist/adapter/ember/adapter/emberAdapter.js";
// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman
import * as ezspModule from "zigbee-herdsman/dist/adapter/ezsp/adapter/ezspAdapter.js";

import {PROFILE_BUTTON, PROFILE_NETWORK} from "../src/core/constants";
import {DeliveryError, EmberTransport, EzspTransport, type InFrame} from "../src/core/transport";
import {silent} from "./rig";

// A test that fails part-way must not leave fake timers to the next one.
afterEach(() => {
    vi.useRealTimers();
});

// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman
const EmberAdapter = (emberModule as any).EmberAdapter ?? (emberModule as any).default?.EmberAdapter;

function makeAdapter() {
    const backup = path.join(os.tmpdir(), `c4z2m-test-${process.pid}`, "coordinator_backup.json");
    return new EmberAdapter(
        {panID: 0x1a62, extendedPanID: [1, 2, 3, 4, 5, 6, 7, 8], channelList: [25], networkKey: Array(16).fill(1), networkKeyDistribute: false},
        {path: "/dev/null", adapter: "ember"},
        backup,
        {concurrent: 4},
    );
}

const packet = (sender: number) => ({senderShortId: sender, lastHopLqi: 180, lastHopRssi: -60});
const aps = (profileId: number, src = 197) => ({profileId, clusterId: 1, sourceEndpoint: src, destinationEndpoint: 1, options: 0, groupId: 0, sequence: 1});

let transport: EmberTransport | undefined;
afterEach(() => transport?.stop());

describe("EmberTransport on the real herdsman EmberAdapter", () => {
    it("recognises the adapter", () => {
        expect(EmberAdapter).toBeTypeOf("function");
        const adapter = makeAdapter();
        expect(EmberTransport.supports(adapter)).toBe(true);
        expect(EmberTransport.supports({})).toBe(false);
    });

    it("hands Control4 frames to the runtime before herdsman sees them", () => {
        const adapter = makeAdapter();
        const seen: InFrame[] = [];
        const herdsman: unknown[] = [];
        adapter.on("zclPayload", (p: unknown) => herdsman.push(p));
        transport = new EmberTransport(adapter, silent);
        transport.start((f) => {
            seen.push(f);
            return f.nwk === 0x1234;
        });
        const text = Buffer.from("0t0041 sa c4.dmx.bp 01\r\n");
        // Consumed: herdsman never parses the ASCII as ZCL.
        adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), packet(0x1234), text);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({nwk: 0x1234, profile: PROFILE_BUTTON, srcEp: 197, lqi: 180, unicast: true});
        expect(seen[0].data.toString()).toBe(text.toString());
        expect(herdsman).toHaveLength(0);
        // 0xC25D, which stock herdsman drops, reaches us too (broadcast check-in).
        adapter.ezsp.ezspIncomingMessageHandler(4, aps(PROFILE_NETWORK, 2), packet(0x1234), Buffer.from([0x18, 1, 0x0a]));
        expect(seen[1]).toMatchObject({profile: PROFILE_NETWORK, unicast: false});
        // Not ours (runtime returns false): falls through to herdsman unchanged.
        adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), packet(0x9999), text);
        expect(herdsman).toHaveLength(1);
        // Home Automation profile is never offered to the runtime.
        adapter.ezsp.ezspIncomingMessageHandler(0, aps(0x0104, 1), packet(0x1234), Buffer.from([0x18, 1, 0x0a]));
        expect(seen).toHaveLength(3); // offered (and declined) the 0x9999 frame, never the HA one
        expect(herdsman).toHaveLength(2);
    });

    it("restores herdsman's handler on stop", () => {
        const adapter = makeAdapter();
        const original = adapter.ezsp.ezspIncomingMessageHandler;
        transport = new EmberTransport(adapter, silent);
        transport.start(() => true);
        expect(adapter.ezsp.ezspIncomingMessageHandler).not.toBe(original);
        transport.stop();
        expect(adapter.ezsp.ezspIncomingMessageHandler).toBe(original);
    });

    it("never settles a send with an older or foreign status for the same 7-bit tag", async () => {
        vi.useFakeTimers();
        const ezsp = Object.assign(new EventEmitter(), {ezspIncomingMessageHandler: () => undefined, send: async () => [0, 10]});
        const t = new EmberTransport({ezsp}, silent);
        t.start(() => false);
        const frame = {profile: 0xc25c, cluster: 1, srcEp: 1, dstEp: 1, data: Buffer.from("x")};
        // herdsman's own frame with tag 10, delivered long ago
        ezsp.emit("messageSent", 0, 0, 0x9999, {profileId: 0x0104}, 10);
        await vi.advanceTimersByTimeAsync(5000);
        const p = t.send(0x1234, frame).then(() => "ok", (e: Error) => e.message);
        await vi.advanceTimersByTimeAsync(10);
        // a foreign message reusing tag 10 while ours is in flight
        ezsp.emit("messageSent", 0, 0, 0x7777, {profileId: 0x0104}, 10);
        await vi.advanceTimersByTimeAsync(10);
        // ours: really failed
        ezsp.emit("messageSent", 0x0c02, 0, 0x1234, {profileId: 0xc25c}, 10);
        expect(await p).toMatch(/delivery failed/);
        // a status that beat ezsp.send's return still counts when it is fresh and ours
        ezsp.send = async () => {
            ezsp.emit("messageSent", 0, 0, 0x1234, {profileId: 0xc25c}, 11);
            return [0, 11];
        };
        await expect(t.send(0x1234, frame)).resolves.toBeUndefined();
        t.stop();
        vi.useRealTimers();
    });

    it("sends a raw APS frame with an ACK and resolves on messageSent", async () => {
        const adapter = makeAdapter();
        const calls: unknown[][] = [];
        adapter.ezsp.send = async (...args: unknown[]) => {
            calls.push(args);
            setTimeout(() => adapter.ezsp.emit("messageSent", 0, 0, 0x1234, args[2], 77), 5);
            return [0, 77];
        };
        transport = new EmberTransport(adapter, silent);
        transport.start(() => false);
        await transport.send(0x1234, {profile: PROFILE_BUTTON, cluster: 1, srcEp: 1, dstEp: 1, data: Buffer.from("0s0040 c4.sy.fwv\r\n")});
        const [type, nwk, apsFrame, data] = calls[0] as [number, number, Record<string, number>, Buffer];
        expect(type).toBe(0);
        expect(nwk).toBe(0x1234);
        expect(apsFrame).toMatchObject({profileId: PROFILE_BUTTON, clusterId: 1, sourceEndpoint: 1, destinationEndpoint: 1});
        expect(apsFrame.options & 0x0040).toBe(0x0040); // APS retry / ACK
        expect(data.toString()).toBe("0s0040 c4.sy.fwv\r\n");
    });

    it("raises DeliveryError when the stack reports delivery failed", async () => {
        const adapter = makeAdapter();
        adapter.ezsp.send = async (...args: unknown[]) => {
            setTimeout(() => adapter.ezsp.emit("messageSent", 0x0c02, 0, 0x1234, args[2], 5), 5);
            return [0, 5];
        };
        transport = new EmberTransport(adapter, silent);
        transport.start(() => false);
        await expect(transport.send(0x1234, {profile: PROFILE_BUTTON, cluster: 1, srcEp: 1, dstEp: 1, data: Buffer.from("x")})).rejects.toBeInstanceOf(DeliveryError);
    });

    it("retries a busy stack, then gives up", async () => {
        const adapter = makeAdapter();
        let n = 0;
        adapter.ezsp.send = async () => {
            n++;
            return [0x0004, 0];
        };
        transport = new EmberTransport(adapter, silent);
        transport.start(() => false);
        await expect(transport.send(0x1234, {profile: PROFILE_BUTTON, cluster: 1, srcEp: 1, dstEp: 1, data: Buffer.from("x")}, {ack: false})).rejects.toBeInstanceOf(DeliveryError);
        expect(n).toBe(3);
    });

    it("broadcasts a many-to-one route request through ezsp", async () => {
        const adapter = makeAdapter();
        const args: number[][] = [];
        adapter.ezsp.ezspSendManyToOneRouteRequest = async (...a: number[]) => {
            args.push(a);
            return 0;
        };
        transport = new EmberTransport(adapter, silent);
        expect(await transport.mtorr(5)).toBe(true);
        expect(args).toEqual([[0xfff9, 5]]);
    });
});
// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman
const EZSPAdapter = (ezspModule as any).EZSPAdapter ?? (ezspModule as any).default?.EZSPAdapter;

/** The real herdsman 10.10.0 EZSPAdapter, with a fake NCP where startup() would connect one. */
function makeEzspAdapter() {
    const backup = path.join(os.tmpdir(), `c4z2m-test-${process.pid}`, "coordinator_backup.json");
    const adapter = new EZSPAdapter(
        {panID: 0x1a62, extendedPanID: [1, 2, 3, 4, 5, 6, 7, 8], channelList: [25], networkKey: Array(16).fill(1), networkKeyDistribute: false},
        {path: "/dev/null", adapter: "ezsp"},
        backup,
        {concurrent: 4},
    );
    const ncp = Object.assign(new EventEmitter(), {
        sent: [] as unknown[][],
        status: 0,
        async sendUnicast(...args: unknown[]) {
            ncp.sent.push(args);
            return {status: ncp.status};
        },
    });
    adapter.driver.ezsp = ncp;
    return {adapter, ncp};
}

const incoming = (profileId: number, sender: number, message: Buffer, messageType = 0) => ({
    messageType,
    apsFrame: aps(profileId),
    lqi: 180,
    rssi: -60,
    sender,
    message,
});

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("EzspTransport on the real herdsman EZSPAdapter", () => {
    let t: EzspTransport | undefined;
    afterEach(() => t?.stop());

    it("recognises a started ezsp adapter and nothing else", () => {
        const {adapter} = makeEzspAdapter();
        expect(EzspTransport.supports(adapter)).toBe(true);
        expect(EmberTransport.supports(adapter)).toBe(false);
        expect(EzspTransport.supports(makeAdapter())).toBe(false);
    });

    it("takes Control4 frames from the driver before the adapter drops them", () => {
        const {adapter} = makeEzspAdapter();
        const seen: InFrame[] = [];
        const herdsman: unknown[] = [];
        adapter.driver.on("incomingMessage", (m: unknown) => herdsman.push(m));
        t = new EzspTransport(adapter, silent);
        t.start((f) => {
            seen.push(f);
            return f.nwk === 0x1234;
        });
        const text = Buffer.from("0t0041 sa c4.zr.bb 01\r\n");
        adapter.driver.emit("incomingMessage", incoming(PROFILE_BUTTON, 0x1234, text));
        expect(seen[0]).toMatchObject({nwk: 0x1234, profile: PROFILE_BUTTON, srcEp: 197, lqi: 180, unicast: true});
        expect(seen[0].data.toString()).toBe(text.toString());
        expect(herdsman).toHaveLength(0);
        adapter.driver.emit("incomingMessage", incoming(PROFILE_BUTTON, 0x9999, text));
        adapter.driver.emit("incomingMessage", incoming(0x0104, 0x1234, Buffer.from([0x18, 1, 0x0a])));
        expect(seen).toHaveLength(2);
        expect(herdsman).toHaveLength(2);
        t.stop();
        adapter.driver.emit("incomingMessage", incoming(PROFILE_BUTTON, 0x1234, text));
        expect(seen).toHaveLength(2);
        expect(herdsman).toHaveLength(3);
    });

    it("asks for an APS ack and settles on messageSentHandler", async () => {
        const {adapter, ncp} = makeEzspAdapter();
        t = new EzspTransport(adapter, silent);
        t.start(() => false);
        const frame = {profile: PROFILE_BUTTON, cluster: 1, srcEp: 1, dstEp: 1, data: Buffer.from("0s0040 c4.zr.tm 0a 00 00 03\r\n")};
        const ok = t.send(0x1234, frame);
        await tick();
        const [, nwk, apsFrame, tag, data] = ncp.sent[0] as [number, number, Record<string, number>, number, Buffer];
        expect(nwk).toBe(0x1234);
        expect(apsFrame).toMatchObject({profileId: PROFILE_BUTTON, clusterId: 1, sourceEndpoint: 1, destinationEndpoint: 1, options: 0x0140}); // route discovery + APS retry
        expect(data.toString()).toBe(frame.data.toString());
        ncp.emit("frame", "messageSentHandler", {messageTag: tag, indexOrDestination: 0x1234, apsFrame, status: 0});
        await expect(ok).resolves.toBeUndefined();
        const failed = t.send(0x1234, frame);
        await tick();
        const [, , aps2, tag2] = ncp.sent[1] as [number, number, Record<string, number>, number];
        ncp.emit("frame", "messageSentHandler", {messageTag: tag2, indexOrDestination: 0x1234, apsFrame: aps2, status: 0x66});
        await expect(failed).rejects.toBeInstanceOf(DeliveryError);
    });
});

describe("EzspTransport sends", () => {
    let t: EzspTransport | undefined;
    afterEach(() => t?.stop());
    const frame = {profile: PROFILE_BUTTON, cluster: 1, srcEp: 1, dstEp: 197, data: Buffer.from("0s0040 c4.zr.tm 0a 00 00 03\r\n")};
    /** A fake NCP whose sendUnicast confirms each send by itself, right away or after `delay` ms. */
    const confirming = (ncp: EventEmitter & {sent: unknown[][]; status: number}, status = 0, delay = 1) =>
        Object.assign(ncp, {
            async sendUnicast(...args: unknown[]) {
                ncp.sent.push(args);
                const [, nwk, aps, tag] = args as [number, number, Record<string, number>, number];
                const confirm = () => ncp.emit("frame", "messageSentHandler", {messageTag: tag, indexOrDestination: nwk, apsFrame: aps, status});
                if (delay < 0) confirm();
                else setTimeout(confirm, delay);
                return {status: ncp.status};
            },
        });

    it("sends to a sleeping end device without APS retry", async () => {
        const {adapter, ncp} = makeEzspAdapter();
        confirming(ncp);
        t = new EzspTransport(adapter, silent);
        t.start(() => false);
        await t.send(0x1234, frame, {sleepy: true});
        expect((ncp.sent[0][2] as {options: number}).options).toBe(0x0100);
    });

    it("settles a confirmation that arrives before sendUnicast returns", async () => {
        const {adapter, ncp} = makeEzspAdapter();
        confirming(ncp, 0, -1); // messageSentHandler in the same chunk as the response
        t = new EzspTransport(adapter, silent);
        t.start(() => false);
        await expect(t.send(0x1234, frame)).resolves.toBeUndefined();
    });

    it("follows herdsman's new Ezsp after an NCP reset", async () => {
        const {adapter, ncp} = makeEzspAdapter();
        t = new EzspTransport(adapter, silent);
        t.start(() => false);
        expect(ncp.listenerCount("frame")).toBe(1);
        // Driver.reset() -> startup() makes a new Ezsp.
        const fresh = confirming(Object.assign(new EventEmitter(), {sent: [] as unknown[][], status: 0}));
        adapter.driver.ezsp = fresh;
        await expect(t.send(0x1234, frame)).resolves.toBeUndefined();
        expect(ncp.listenerCount("frame")).toBe(0);
        expect(fresh.listenerCount("frame")).toBe(1);
        t.stop();
        expect(fresh.listenerCount("frame")).toBe(0);
    });

    it("waits and retries while the network is down or busy, then gives up", async () => {
        const {adapter, ncp} = makeEzspAdapter();
        t = new EzspTransport(adapter, silent);
        t.start(() => false);
        for (const status of [0x91, 0x18, 0xa1]) {
            ncp.sent.length = 0;
            ncp.status = status;
            const started = Date.now();
            await expect(t.send(0x1234, frame, {ack: false})).rejects.toBeInstanceOf(DeliveryError);
            expect(ncp.sent).toHaveLength(3);
            expect(Date.now() - started).toBeGreaterThanOrEqual(status === 0x91 ? 2_900 : 900);
        }
        ncp.sent.length = 0;
        ncp.status = 0x70; // anything else: no retry
        await expect(t.send(0x1234, frame, {ack: false})).rejects.toBeInstanceOf(DeliveryError);
        expect(ncp.sent).toHaveLength(1);
    }, 15_000);

    it("fails a send still waiting for its confirmation when stopped", async () => {
        const {adapter} = makeEzspAdapter();
        t = new EzspTransport(adapter, silent);
        t.start(() => false);
        const p = t.send(0x1234, frame);
        await tick();
        t.stop();
        await expect(p).rejects.toMatchObject({reason: "stopped"});
    });

    it("broadcasts a many-to-one route request", async () => {
        const {adapter, ncp} = makeEzspAdapter();
        const calls: unknown[][] = [];
        Object.assign(ncp, {execCommand: async (...a: unknown[]) => (calls.push(a), {status: 0})});
        t = new EzspTransport(adapter, silent);
        expect(await t.mtorr(5)).toBe(true);
        expect(calls).toEqual([["sendManyToOneRouteRequest", {concentratorType: 0xfff9, radius: 5}]]);
    });
});
