/**
 * EmberTransport against the real zigbee-herdsman 10.10.0 EmberAdapter (built
 * offline - nothing is opened until start()). Proves the receive hook sits in
 * front of herdsman's own filter and the send path uses its real queue.
 */

import {EventEmitter} from "node:events";
import os from "node:os";
import path from "node:path";

import {afterEach, describe, expect, it, vi} from "vitest";
// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman
import * as emberModule from "zigbee-herdsman/dist/adapter/ember/adapter/emberAdapter.js";

import {PROFILE_BUTTON, PROFILE_NETWORK} from "../src/core/constants";
import {DeliveryError, EmberTransport, type InFrame} from "../src/core/transport";
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