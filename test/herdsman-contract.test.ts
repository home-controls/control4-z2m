/**
 * EmberTransport under herdsman's real EZSP layer. The other tests call the
 * patched handler directly and fake ezsp.send; here a stand-in NCP answers at
 * the ASH boundary instead, so a frame from the radio goes through herdsman's
 * own decode and dispatch (onAshFrame, callbackDispatch, the handler property
 * we replace) and a send goes out through its real send() and settles on the
 * messageSent herdsman emits. The herdsman drift canary runs this against the
 * herdsman each Zigbee2MQTT target pins (#19).
 */

import os from "node:os";
import path from "node:path";

import {afterEach, describe, expect, it} from "vitest";
import * as emberModule from "zigbee-herdsman/dist/adapter/ember/adapter/emberAdapter.js";
import type {Ezsp} from "zigbee-herdsman/dist/adapter/ember/ezsp/ezsp.js";
import type {EmberApsFrame} from "zigbee-herdsman/dist/adapter/ember/types.js";

import {PROFILE_BUTTON, PROFILE_NETWORK} from "../src/core/constants";
import {DeliveryError, EmberTransport, type InFrame, type OutFrame} from "../src/core/transport";
import {silent} from "./rig";

// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman internals
type Any = any;
const EmberAdapter = (emberModule as Any).EmberAdapter ?? (emberModule as Any).default?.EmberAdapter;

// The radio's wire format (Silicon Labs UG100), not herdsman's: EZSP frame IDs and frame control bits.
const SEND_UNICAST = 0x0034;
const MESSAGE_SENT_HANDLER = 0x003f;
const INCOMING_MESSAGE_HANDLER = 0x0045;
const FC_RESPONSE = 0x80;
const FC_ASYNC_CALLBACK = 0x10;
const FRAME_FORMAT_V1 = 0x01;
const INCOMING_UNICAST = 0;
const INCOMING_BROADCAST = 4;
/** EZSP v13 reports an EmberStatus, v14 an SLStatus. */
const DELIVERY_FAILED = {13: 0x66, 14: 0x0c02};

type Version = 13 | 14;

/** Little-endian byte builder for EZSP frames. */
class Bytes {
    private readonly bytes: number[] = [];
    u8(v: number): this {
        this.bytes.push(v & 0xff);
        return this;
    }
    i8(v: number): this {
        return this.u8(v < 0 ? v + 0x100 : v);
    }
    u16(v: number): this {
        return this.u8(v).u8(v >> 8);
    }
    u32(v: number): this {
        return this.u16(v & 0xffff).u16(v >>> 16);
    }
    raw(b: Iterable<number>): this {
        for (const x of b) this.u8(x);
        return this;
    }
    aps(a: EmberApsFrame): this {
        return this.u16(a.profileId).u16(a.clusterId).u8(a.sourceEndpoint).u8(a.destinationEndpoint).u16(a.options).u16(a.groupId).u8(a.sequence);
    }
    payload(b: Buffer): this {
        return this.u8(b.length).raw(b);
    }
    done(): Buffer {
        return Buffer.from(this.bytes);
    }
}

class Reader {
    constructor(
        private readonly b: Buffer,
        private i: number,
    ) {}
    u8(): number {
        return this.b[this.i++];
    }
    u16(): number {
        const v = this.b.readUInt16LE(this.i);
        this.i += 2;
        return v;
    }
    aps(): EmberApsFrame {
        return {profileId: this.u16(), clusterId: this.u16(), sourceEndpoint: this.u8(), destinationEndpoint: this.u8(), options: this.u16(), groupId: this.u16(), sequence: this.u8()};
    }
    payload(): Buffer {
        const n = this.u8();
        const out = Buffer.from(this.b.subarray(this.i, this.i + n));
        this.i += n;
        return out;
    }
}

/**
 * Stands in for the radio below herdsman's Ezsp: takes the EZSP frames its ASH
 * layer would transmit, and answers through ASH's receive queue the way ASH
 * does with a decoded DATA frame.
 */
class FakeNcp {
    readonly unicasts: {nwk: number; aps: EmberApsFrame; tag: number; data: Buffer}[] = [];
    /** EZSP commands herdsman sent that this stand-in does not answer. */
    readonly unexpected: number[] = [];
    failDelivery = false;

    constructor(
        private readonly ezsp: Any,
        private readonly version: Version,
    ) {
        ezsp.version = version;
        Object.defineProperty(ezsp.ash, "connected", {get: () => true});
        ezsp.ash.send = (len: number, buffer: Buffer) => {
            this.onCommand(Buffer.from(buffer.subarray(0, len)));
            return 0; // EzspStatus.SUCCESS
        };
    }

    /** A frame from the mesh, as the radio reports it. */
    incoming(type: number, aps: EmberApsFrame, sender: number, lqi: number, rssi: number, data: Buffer): void {
        const b = this.header(0, true, INCOMING_MESSAGE_HANDLER).u8(type).aps(aps);
        if (this.version < 14) b.u8(lqi).i8(rssi).u16(sender).u8(0xff).u8(0xff);
        else b.u16(sender).raw(Buffer.alloc(8)).u8(0xff).u8(0xff).u8(lqi).i8(rssi).u32(0);
        this.deliver(b.payload(data).done());
    }

    private onCommand(frame: Buffer): void {
        const seq = frame[0];
        const id = frame.readUInt16LE(3);
        if (id !== SEND_UNICAST) {
            this.unexpected.push(id);
            return;
        }
        const r = new Reader(frame, 5);
        const type = r.u8();
        const nwk = r.u16();
        const aps = r.aps();
        const tag = this.version < 14 ? r.u8() : r.u16();
        const data = r.payload();
        this.unicasts.push({nwk, aps, tag, data});
        const reply = this.header(seq, false, SEND_UNICAST);
        if (this.version < 14) reply.u8(0);
        else reply.u32(0);
        // After send() has set up its response wait, as a real reply would.
        setImmediate(() => {
            this.deliver(reply.u8(42).done()); // queued, APS sequence 42
            setImmediate(() => this.messageSent(type, nwk, {...aps, sequence: 42}, tag));
        });
    }

    private messageSent(type: number, nwk: number, aps: EmberApsFrame, tag: number): void {
        const status = this.failDelivery ? DELIVERY_FAILED[this.version] : 0;
        const b = this.header(0, true, MESSAGE_SENT_HANDLER);
        if (this.version < 14) b.u8(type).u16(nwk).aps(aps).u8(tag).u8(status);
        else b.u32(status).u8(type).u16(nwk).aps(aps).u16(tag);
        this.deliver(b.payload(Buffer.alloc(0)).done());
    }

    private header(seq: number, callback: boolean, id: number): Bytes {
        return new Bytes()
            .u8(seq)
            .u8(FC_RESPONSE | (callback ? FC_ASYNC_CALLBACK : 0))
            .u8(FRAME_FORMAT_V1)
            .u16(id);
    }

    /** ASH queues the frame and signals the Ezsp, whose listener only exists after a real start(): call it directly. */
    private deliver(frame: Buffer): void {
        const ash = this.ezsp.ash;
        const buffer = ash.rxFree.allocBuffer();
        frame.copy(buffer.data);
        buffer.len = frame.length;
        ash.rxQueue.addTail(buffer);
        this.ezsp.onAshFrame();
    }
}

function makeAdapter() {
    const backup = path.join(os.tmpdir(), `c4z2m-test-${process.pid}`, "coordinator_backup.json");
    return new EmberAdapter(
        {panID: 0x1a62, extendedPanID: [1, 2, 3, 4, 5, 6, 7, 8], channelList: [25], networkKey: Array(16).fill(1), networkKeyDistribute: false},
        {path: "/dev/null", adapter: "ember"},
        backup,
        {concurrent: 4},
    );
}

const aps = (profileId: number, src = 197): EmberApsFrame => ({profileId, clusterId: 1, sourceEndpoint: src, destinationEndpoint: 1, options: 0, groupId: 0, sequence: 1});
const out: OutFrame = {profile: PROFILE_BUTTON, cluster: 1, srcEp: 1, dstEp: 197, data: Buffer.from("0s0042 c4.dmx.led 00 ff0000\r\n")};

let transport: EmberTransport | undefined;
afterEach(() => {
    transport?.stop();
    transport = undefined;
});

function rig(version: Version) {
    const adapter = makeAdapter();
    const ncp = new FakeNcp(adapter.ezsp, version);
    const frames: InFrame[] = [];
    const herdsman: unknown[] = [];
    adapter.on("zclPayload", (p: unknown) => herdsman.push(p));
    const t = new EmberTransport(adapter, silent);
    t.start((f) => {
        frames.push(f);
        return true;
    });
    transport = t;
    return {t, ncp, frames, herdsman};
}

describe.each([13, 14] as const)("EmberTransport under herdsman's EZSP v%i dispatch", (version) => {
    it("receives the Control4 frames herdsman decodes from the radio", () => {
        const {ncp, frames, herdsman} = rig(version);
        const text = Buffer.from("0t0041 sa c4.dm.cc 00 02\r\n");
        ncp.incoming(INCOMING_UNICAST, aps(PROFILE_BUTTON), 0x1234, 180, -60, text);
        ncp.incoming(INCOMING_BROADCAST, aps(PROFILE_NETWORK, 2), 0x1234, 170, -70, Buffer.from([0x18, 1, 0x0a]));
        expect(frames).toEqual([
            {nwk: 0x1234, profile: PROFILE_BUTTON, cluster: 1, srcEp: 197, dstEp: 1, data: text, lqi: 180, rssi: -60, unicast: true},
            {nwk: 0x1234, profile: PROFILE_NETWORK, cluster: 1, srcEp: 2, dstEp: 1, data: Buffer.from([0x18, 1, 0x0a]), lqi: 170, rssi: -70, unicast: false},
        ]);
        expect(herdsman).toHaveLength(0);
    });

    it("leaves frames on other profiles to herdsman", () => {
        const {ncp, frames, herdsman} = rig(version);
        ncp.incoming(INCOMING_UNICAST, aps(0x0104, 1), 0x1234, 180, -60, Buffer.from([0x18, 1, 0x0a]));
        expect(frames).toHaveLength(0);
        expect(herdsman).toHaveLength(1);
    });

    it("sends through herdsman's send() and resolves on the messageSent herdsman emits", async () => {
        const {t, ncp} = rig(version);
        const outcome = await t.send(0x1234, out).then(
            () => "delivered",
            (error: unknown) => error,
        );
        expect(ncp.unexpected).toEqual([]);
        expect(outcome).toBe("delivered");
        expect(ncp.unicasts).toEqual([{nwk: 0x1234, aps: expect.objectContaining({profileId: PROFILE_BUTTON, clusterId: 1, sourceEndpoint: 1, destinationEndpoint: 197}), tag: expect.any(Number), data: out.data}]);
        expect(ncp.unicasts[0].aps.options & 0x0040).toBe(0x0040); // APS retry: an ACK is requested
    });

    it("raises DeliveryError when herdsman reports the delivery failed", async () => {
        const {t, ncp} = rig(version);
        ncp.failDelivery = true;
        const outcome = await t.send(0x1234, out).then(
            () => "delivered",
            (error: unknown) => error,
        );
        expect(ncp.unexpected).toEqual([]);
        expect(outcome).toBeInstanceOf(DeliveryError);
        expect((outcome as Error).message).toMatch(/^delivery failed/);
    });
});

// Compiled, never run: transport.ts reaches herdsman through `any`, so these
// are the shapes it relies on, checked by tsc against herdsman's declarations.
type Is<T extends U, U> = T;
type Receive = Parameters<Ezsp["ezspIncomingMessageHandler"]>;
export type ReceiveShape = [
    Is<Receive[0], number>,
    Is<Receive[1], {profileId: number; clusterId: number; sourceEndpoint: number; destinationEndpoint: number}>,
    Is<Receive[2], {senderShortId: number; lastHopLqi: number; lastHopRssi: number}>,
    Is<Receive[3], Buffer>,
];
export function sendShape(ezsp: Ezsp, apsFrame: EmberApsFrame): Promise<[number, number]> {
    return ezsp.send(0, 0x1234, apsFrame, Buffer.alloc(0), 0, 0);
}
export function messageSentShape(ezsp: Ezsp): void {
    ezsp.on("messageSent", (_status: number, _type: number, _dst: number, _aps: {profileId: number}, _tag: number) => undefined);
}
