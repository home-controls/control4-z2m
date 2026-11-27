/** Test rig: a Runtime wired to a fake host and a fake radio. */

import {vi} from "vitest";

import {isC4Ieee, PROFILE_BUTTON, PROFILE_NETWORK, PROFILE_OUTLET} from "../src/core/constants";
import type {Logger} from "../src/core/log";
import {buildFrame} from "../src/core/protocol";
import {Runtime, type RuntimeHost} from "../src/core/runtime";
import {Store} from "../src/core/store";
import {DeliveryError, type InFrame, type OutFrame, type Transport} from "../src/core/transport";

export const COORD = "0x00124b0024c0dc0d";

export interface Sent {
    nwk: number;
    frame: OutFrame;
    ack: boolean;
    text: string;
}

export class FakeTransport implements Transport {
    readonly name = "fake";
    sent: Sent[] = [];
    onFrame: ((f: InFrame) => boolean) | undefined;
    /** Return an error to make a send fail. */
    failWith: ((frame: OutFrame) => Error | undefined) | undefined;
    mtorrs: number[] = [];
    /** How long a send takes to be confirmed (ms). */
    latency = 0;
    inFlight = 0;
    /** Most sends awaiting confirmation at once. */
    maxInFlight = 0;

    start(onFrame: (frame: InFrame) => boolean): void {
        this.onFrame = onFrame;
    }

    stop(): void {
        this.onFrame = undefined;
    }

    async send(nwk: number, frame: OutFrame, options?: {ack?: boolean}): Promise<void> {
        const err = this.failWith?.(frame);
        if (err) throw err;
        this.sent.push({nwk, frame, ack: options?.ack !== false, text: frame.data.toString("latin1").replace(/\r\n$/, "")});
        if (!this.latency) return;
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        await new Promise((r) => setTimeout(r, this.latency));
        this.inFlight--;
    }

    async mtorr(radius: number): Promise<boolean> {
        this.mtorrs.push(radius);
        return true;
    }
}

export const silent: Logger = {debug() {}, info() {}, warning() {}, error() {}};

export function captureLogger(): Logger & {lines: string[]} {
    const lines: string[] = [];
    return {
        lines,
        debug: (m) => lines.push(`debug: ${m}`),
        info: (m) => lines.push(`info: ${m}`),
        warning: (m) => lines.push(`warning: ${m}`),
        error: (m) => lines.push(`error: ${m}`),
    };
}

export interface FakeDevice {
    nwk: number;
    type: string;
    modelID?: string;
    name: string;
    options: Record<string, unknown>;
    firmware?: string;
}

export class Rig {
    readonly transport = new FakeTransport();
    readonly store: Store;
    readonly devices = new Map<string, FakeDevice>();
    readonly states = new Map<string, Record<string, unknown>>();
    readonly published: {ieee: string; payload: Record<string, unknown>}[] = [];
    readonly events: Record<string, unknown>[] = [];
    readonly binds: {ieee: string; ep: number; cluster: number}[] = [];
    readonly exposesChanged: string[] = [];
    readonly zclReads: {ieee: string; ep: number; cluster: string; attrs: string[]; at: number}[] = [];
    /** ZCL attribute values by device, then cluster; a cluster not listed does not answer. */
    readonly zcl = new Map<string, Record<string, Record<string, unknown>>>();
    /** How long a ZCL read takes to answer. */
    zclLatency = 0;
    /** Devices whose handoff is under way. */
    readonly handoffs = new Set<string>();
    /** Every noteSeen: the device marked seen, and the link quality it came with. */
    readonly seen: {ieee: string; lqi?: number}[] = [];
    /** How often the runtime said the instance status changed. */
    statusChanges = 0;
    /** Devices the runtime asked to announce their network address (a fresh route). */
    readonly rediscovered: string[] = [];
    readonly runtime: Runtime;
    readonly log: Logger & {lines: string[]};

    constructor(opts: {store?: Store} = {}) {
        this.log = captureLogger();
        this.store = opts.store ?? new Store(undefined, this.log);
        const host: RuntimeHost = {
            log: this.log,
            store: this.store,
            transport: this.transport,
            coordinatorIeee: () => COORD,
            deviceInfo: (ieee) => {
                const d = this.devices.get(ieee);
                return d ? {nwk: d.nwk, type: d.type, modelID: d.modelID} : undefined;
            },
            ieeeByNwk: (nwk) => [...this.devices.entries()].find(([, d]) => d.nwk === nwk)?.[0],
            c4Devices: () => [...this.devices.keys()].filter(isC4Ieee),
            publish: (ieee, payload) => {
                this.published.push({ieee, payload});
                const st = {...(this.states.get(ieee) ?? {})};
                for (const [k, v] of Object.entries(payload)) if (!k.startsWith("action")) st[k] = v;
                this.states.set(ieee, st);
            },
            publishEvent: (_ieee, payload) => {
                this.events.push(payload);
            },
            state: (ieee) => this.states.get(ieee) ?? {},
            friendlyName: (ieee) => this.devices.get(ieee)?.name ?? ieee,
            deviceOption: (ieee, key) => this.devices.get(ieee)?.options[key],
            setModel: (ieee, model) => {
                const d = this.devices.get(ieee);
                if (d) d.modelID = model;
            },
            setFirmware: (ieee, fw) => {
                const d = this.devices.get(ieee);
                if (d) d.firmware = fw;
            },
            exposesChanged: (ieee) => this.exposesChanged.push(ieee),
            noteSeen: (ieee, lqi) => {
                this.seen.push({ieee, lqi});
            },
            statusChanged: () => {
                this.statusChanges++;
            },
            bind: async (ieee, ep, cluster) => {
                this.binds.push({ieee, ep, cluster});
            },
            zclRead: async (ieee, ep, cluster, attrs) => {
                this.zclReads.push({ieee, ep, cluster, attrs, at: Date.now()});
                if (this.zclLatency) await new Promise((r) => setTimeout(r, this.zclLatency));
                const values = this.zcl.get(ieee)?.[cluster];
                if (!values) throw new Error("no response");
                return Object.fromEntries(attrs.filter((a) => a in values).map((a) => [a, values[a]]));
            },
            handoffPending: (ieee) => this.handoffs.has(ieee),
            rediscover: async (ieee) => {
                this.rediscovered.push(ieee);
            },
            now: () => Date.now(),
        };
        this.runtime = new Runtime(host);
    }

    add(ieee: string, modelID?: string, opts: Partial<FakeDevice> = {}): string {
        const id = ieee.toLowerCase();
        this.devices.set(id, {nwk: 0x1000 + this.devices.size, type: "Router", modelID, name: `dev${this.devices.size}`, options: {}, ...opts});
        return id;
    }

    /** `hotLoad`: start as the extension does after a hot-load (Zigbee2MQTT kept running). */
    start(hotLoad = false): void {
        this.runtime.start(hotLoad);
    }

    nwk(ieee: string): number {
        return (this.devices.get(ieee) as FakeDevice).nwk;
    }

    /** Inject an ASCII frame from a device on the button profile. */
    ascii(ieee: string, text: string, unicast = true, srcEp = 197): boolean {
        return this.inject(ieee, PROFILE_BUTTON, buildFrame(text), unicast, srcEp);
    }

    inject(ieee: string, profile: number, data: Buffer, unicast = true, srcEp = 2): boolean {
        if (!this.transport.onFrame) throw new Error("rig not started");
        return this.transport.onFrame({nwk: this.nwk(ieee), profile, cluster: 1, srcEp, dstEp: 1, data, lqi: 200, unicast});
    }

    /** A network-profile Report Attributes carrying the model string (a check-in). */
    checkin(ieee: string, modelString: string, extra: Buffer = Buffer.alloc(0), broadcast = true): boolean {
        const s = Buffer.from(modelString, "latin1");
        const data = Buffer.concat([Buffer.from([0x18, 0x01, 0x0a, 0x07, 0x00, 0x42, s.length]), s, extra]);
        return this.inject(ieee, PROFILE_NETWORK, data, !broadcast, 2);
    }

    outletReport(ieee: string, attrs: Buffer): boolean {
        return this.inject(ieee, PROFILE_OUTLET, Buffer.concat([Buffer.from([0x18, 0x02, 0x0a]), attrs]), true, 198);
    }

    /** ASCII sends (text), optionally only those since index `from`. */
    texts(from = 0): string[] {
        return this.transport.sent
            .slice(from)
            .filter((s) => s.frame.profile === PROFILE_BUTTON)
            .map((s) => s.text);
    }

    /** ASCII sends without the `0s1234 ` prefix. */
    cmds(from = 0): string[] {
        return this.texts(from).map((t) => t.replace(/^0[sgir][0-9a-f]{4} /, ""));
    }

    actions(ieee?: string): string[] {
        return this.published.filter((p) => (!ieee || p.ieee === ieee) && typeof p.payload.action === "string").map((p) => p.payload.action as string);
    }

    last(ieee: string): Record<string, unknown> {
        return this.states.get(ieee) ?? {};
    }

    /** Answer the newest pending `0g` with `0r<seq> 000 <prop> <values>`. */
    reply(ieee: string, values: string, prop?: string): void {
        const get = [...this.texts()].reverse().find((t) => t.startsWith("0g"));
        if (!get) throw new Error("no Get to answer");
        const seq = get.slice(2, 6);
        const p = prop ?? get.split(" ")[1];
        this.ascii(ieee, `0r${seq} 000 ${p} ${values}`.trim());
    }

    stop(): void {
        this.runtime.stop();
    }
}

export async function tick(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
}

export {DeliveryError};
