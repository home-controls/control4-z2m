/**
 * Radio access for Control4 traffic.
 *
 * Stock zigbee-herdsman passes only the 0xC25C button profile up from an Ember
 * coordinator and drops 0xC25D (model check-ins, controller identity) and
 * 0xC25E (outlet) outright; it also tries to parse the ASCII frames as ZCL.
 * `EmberTransport` therefore taps the EZSP layer directly: every frame on a
 * Control4 profile is offered to the runtime first and only falls through to
 * herdsman when it is not from a Control4 device.
 *
 * Sends go out as raw APS frames on the Control4 profiles with an APS ACK
 * requested, and resolve on the stack's messageSent callback, so a frame the
 * mesh did not deliver raises `DeliveryError` (the zigpy semantics the link
 * health logic was built on).
 */

import {C4_PROFILES} from "./constants";
import type {Logger} from "./log";

export interface OutFrame {
    profile: number;
    cluster: number;
    srcEp: number;
    dstEp: number;
    data: Buffer;
}

export interface InFrame {
    nwk: number;
    profile: number;
    cluster: number;
    srcEp: number;
    dstEp: number;
    data: Buffer;
    lqi: number;
    rssi?: number;
    /** Unicast to us (a broadcast does not prove a working route). */
    unicast: boolean;
}

/**
 * Why a send failed: herdsman never confirmed it (no messageSent), the radio
 * reported it undelivered (a messageSent with a failure status), it could not
 * be queued, or the transport stopped.
 */
export type DeliveryFailure = "unconfirmed" | "failed" | "unqueued" | "stopped";

export class DeliveryError extends Error {
    constructor(
        message: string,
        readonly reason?: DeliveryFailure,
    ) {
        super(message);
        this.name = "DeliveryError";
    }
}

export interface Transport {
    readonly name: string;
    /** Install the receive hook; `onFrame` returns true when it consumed the frame. */
    start(onFrame: (frame: InFrame) => boolean): void;
    stop(): void;
    send(nwk: number, frame: OutFrame, options?: {ack?: boolean}): Promise<void>;
    /** Broadcast a many-to-one route request; false when the radio cannot. */
    mtorr(radius: number): Promise<boolean>;
}

// Ember constants (zigbee-herdsman src/adapter/ember/enums.ts).
const OUTGOING_DIRECT = 0;
const APS_RETRY = 0x0040;
const APS_ENABLE_ROUTE_DISCOVERY = 0x0100;
const APS_ENABLE_ADDRESS_DISCOVERY = 0x1000;
const SL_OK = 0x0000;
const SL_BUSY = 0x0004;
const SL_NETWORK_DOWN = 0x0016;
const SL_MAX_MESSAGE_LIMIT = 0x0c03;
const INCOMING_UNICAST = 0;
const INCOMING_UNICAST_REPLY = 1;
const HIGH_RAM_CONCENTRATOR = 0xfff9;

const SEND_ATTEMPTS = 3;
const BUSY_DEFER_MS = 500;
const NETWORK_DOWN_DEFER_MS = 1500;
/** How long a queued frame waits for its messageSent before it fails as unconfirmed. */
export const SENT_TIMEOUT_MS = 12000;
/**
 * How old a messageSent may be when it is matched to a send that had not been
 * registered yet (the callback can beat ezsp.send's own return). Message tags
 * are 7-bit and shared with herdsman's own sends, so an older status for the
 * same tag belongs to some other message.
 */
const EARLY_MAX_AGE_MS = 1000;
const EARLY_MAX = 64;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// biome-ignore lint/suspicious/noExplicitAny: zigbee-herdsman internals
type Any = any;

export class EmberTransport implements Transport {
    readonly name = "ember";
    private readonly ezsp: Any;
    private original: Any;
    private pending = new Map<number, {nwk: number; profile: number; resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout}>();
    private early = new Map<number, {status: number; nwk: number; profile: number | undefined; at: number}>();
    private readonly onSent = (status: number, _type: number, dst: number, aps: Any, tag: number) => {
        const p = this.pending.get(tag);
        if (p && p.nwk === dst && p.profile === aps?.profileId) {
            this.settle(tag, status);
            return;
        }
        // Not (yet) one of ours: herdsman's own send, or ours before ezsp.send returned.
        this.early.delete(tag);
        this.early.set(tag, {status, nwk: dst, profile: aps?.profileId, at: Date.now()});
        if (this.early.size > EARLY_MAX) this.early.delete(this.early.keys().next().value as number);
    };

    constructor(
        private readonly adapter: Any,
        private readonly log: Logger,
    ) {
        this.ezsp = adapter.ezsp;
    }

    static supports(adapter: Any): boolean {
        return typeof adapter?.ezsp?.ezspIncomingMessageHandler === "function" && typeof adapter?.ezsp?.send === "function";
    }

    start(onFrame: (frame: InFrame) => boolean): void {
        if (this.original) return;
        const ezsp = this.ezsp;
        this.original = ezsp.ezspIncomingMessageHandler;
        const original = this.original;
        const log = this.log;
        ezsp.ezspIncomingMessageHandler = function (type: number, apsFrame: Any, packetInfo: Any, contents: Buffer) {
            if (C4_PROFILES.has(apsFrame?.profileId)) {
                try {
                    const consumed = onFrame({
                        nwk: packetInfo.senderShortId,
                        profile: apsFrame.profileId,
                        cluster: apsFrame.clusterId,
                        srcEp: apsFrame.sourceEndpoint,
                        dstEp: apsFrame.destinationEndpoint,
                        data: Buffer.from(contents),
                        lqi: packetInfo.lastHopLqi,
                        rssi: packetInfo.lastHopRssi,
                        unicast: type === INCOMING_UNICAST || type === INCOMING_UNICAST_REPLY,
                    });
                    if (consumed) return;
                } catch (error) {
                    log.warning(`Control4 receive hook failed: ${(error as Error).stack ?? error}`);
                }
            }
            return original.call(this, type, apsFrame, packetInfo, contents);
        };
        ezsp.on?.("messageSent", this.onSent);
    }

    stop(): void {
        if (this.original) {
            this.ezsp.ezspIncomingMessageHandler = this.original;
            this.original = undefined;
        }
        this.ezsp.off?.("messageSent", this.onSent);
        for (const [tag, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new DeliveryError("transport stopped", "stopped"));
            this.pending.delete(tag);
        }
    }

    private settle(tag: number, status: number): void {
        const p = this.pending.get(tag);
        if (!p) return;
        this.pending.delete(tag);
        clearTimeout(p.timer);
        if (status === SL_OK) p.resolve();
        else p.reject(new DeliveryError(`delivery failed (status 0x${status.toString(16)})`, "failed"));
    }

    async send(nwk: number, frame: OutFrame, options: {ack?: boolean} = {}): Promise<void> {
        const ack = options.ack !== false;
        const apsFrame = {
            profileId: frame.profile,
            clusterId: frame.cluster,
            sourceEndpoint: frame.srcEp,
            destinationEndpoint: frame.dstEp,
            options: APS_ENABLE_ROUTE_DISCOVERY | APS_ENABLE_ADDRESS_DISCOVERY | (ack ? APS_RETRY : 0),
            groupId: 0,
            sequence: 0,
        };
        let sent: Promise<void> | undefined;
        const run = async () => {
            for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
                let status = -1;
                let tag = -1;
                try {
                    [status, tag] = await this.ezsp.send(OUTGOING_DIRECT, nwk, apsFrame, frame.data, 0, 0);
                } catch (error) {
                    this.log.debug(`Control4 send to 0x${nwk.toString(16)} raised ${error}`);
                }
                if (status === SL_OK) {
                    if (ack) sent = this.waitSent(tag, nwk, frame.profile);
                    return;
                }
                if (attempt === SEND_ATTEMPTS) break;
                if (status === SL_BUSY || status === SL_MAX_MESSAGE_LIMIT || status === -1) await wait(BUSY_DEFER_MS);
                else if (status === SL_NETWORK_DOWN) await wait(NETWORK_DOWN_DEFER_MS);
                else break;
            }
            throw new DeliveryError(`could not queue frame to 0x${nwk.toString(16)}`, "unqueued");
        };
        const queue = this.adapter.queue;
        if (queue && typeof queue.execute === "function") await queue.execute(run, nwk);
        else await run();
        if (sent) await sent;
    }

    private waitSent(tag: number, nwk: number, profile: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(tag);
                reject(new DeliveryError("no delivery confirmation", "unconfirmed"));
            }, SENT_TIMEOUT_MS);
            timer.unref?.();
            this.pending.set(tag, {nwk, profile, resolve, reject, timer});
            const early = this.early.get(tag);
            if (early !== undefined) {
                this.early.delete(tag);
                // Only a status that just arrived for this very frame counts.
                if (early.nwk === nwk && early.profile === profile && Date.now() - early.at <= EARLY_MAX_AGE_MS) this.settle(tag, early.status);
            }
        });
    }

    async mtorr(radius: number): Promise<boolean> {
        if (typeof this.ezsp.ezspSendManyToOneRouteRequest !== "function") return false;
        try {
            const status = await this.ezsp.ezspSendManyToOneRouteRequest(HIGH_RAM_CONCENTRATOR, radius);
            return status === SL_OK;
        } catch (error) {
            this.log.warning(`Control4 route refresh failed: ${error}`);
            return false;
        }
    }
}
// Legacy EmberZNet status codes (zigbee-herdsman src/adapter/ezsp/driver/types/named.ts).
const EMBER_SUCCESS = 0x00;
const EMBER_NO_BUFFERS = 0x18;
const EMBER_NETWORK_DOWN = 0x90;
const EMBER_MAX_MESSAGE_LIMIT_REACHED = 0x72;
const EMBER_NETWORK_BUSY = 0xa1;

/**
 * The same tap for herdsman's deprecated `ezsp` driver (EmberZNet before 7.4,
 * e.g. EM35x NCPs on EZSP 8). That driver emits every incoming frame as an
 * `incomingMessage` event and its adapter drops the Control4 profiles, so the
 * hook sits on the driver's `emit`. Sends go out with `sendUnicast`, and the
 * NCP's messageSentHandler confirms them by message tag.
 */
export class EzspTransport implements Transport {
    readonly name = "ezsp";
    private readonly driver: Any;
    private originalEmit: Any;
    private pending = new Map<number, {nwk: number; resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout}>();
    private readonly onEzspFrame = (frameName: string, f: Any) => {
        if (frameName !== "messageSentHandler" || !C4_PROFILES.has(f?.apsFrame?.profileId)) return;
        const p = this.pending.get(f.messageTag);
        if (!p || p.nwk !== f.indexOrDestination) return;
        this.pending.delete(f.messageTag);
        clearTimeout(p.timer);
        if (f.status === EMBER_SUCCESS) p.resolve();
        else p.reject(new DeliveryError(`delivery failed (status 0x${Number(f.status).toString(16)})`, "failed"));
    };

    constructor(
        private readonly adapter: Any,
        private readonly log: Logger,
    ) {
        this.driver = adapter.driver;
    }

    static supports(adapter: Any): boolean {
        return typeof adapter?.driver?.emit === "function" && typeof adapter?.driver?.ezsp?.sendUnicast === "function";
    }

    start(onFrame: (frame: InFrame) => boolean): void {
        if (this.originalEmit) return;
        const original = this.driver.emit;
        this.originalEmit = original;
        const log = this.log;
        this.driver.emit = function (event: string, frame: Any, ...rest: unknown[]) {
            if (event === "incomingMessage" && C4_PROFILES.has(frame?.apsFrame?.profileId)) {
                try {
                    const consumed = onFrame({
                        nwk: frame.sender,
                        profile: frame.apsFrame.profileId,
                        cluster: frame.apsFrame.clusterId,
                        srcEp: frame.apsFrame.sourceEndpoint,
                        dstEp: frame.apsFrame.destinationEndpoint,
                        data: Buffer.from(frame.message),
                        lqi: frame.lqi,
                        rssi: frame.rssi,
                        unicast: frame.messageType === INCOMING_UNICAST || frame.messageType === INCOMING_UNICAST_REPLY,
                    });
                    if (consumed) return true;
                } catch (error) {
                    log.warning(`Control4 receive hook failed: ${(error as Error).stack ?? error}`);
                }
            }
            return original.call(this, event, frame, ...rest);
        };
        this.driver.ezsp.on("frame", this.onEzspFrame);
    }

    stop(): void {
        if (this.originalEmit) {
            this.driver.emit = this.originalEmit;
            this.originalEmit = undefined;
        }
        this.driver.ezsp.off?.("frame", this.onEzspFrame);
        for (const [tag, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new DeliveryError("transport stopped", "stopped"));
            this.pending.delete(tag);
        }
    }

    async send(nwk: number, frame: OutFrame, options: {ack?: boolean} = {}): Promise<void> {
        const ack = options.ack !== false;
        let sent: Promise<void> | undefined;
        const run = async () => {
            for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
                // makeApsFrame takes the driver's own sequence, so the tag never repeats one in flight.
                const aps = this.driver.makeApsFrame(frame.cluster, !ack);
                aps.profileId = frame.profile;
                aps.sourceEndpoint = frame.srcEp;
                aps.destinationEndpoint = frame.dstEp;
                // No APS retry: EmberZNet 6.x gives up on the APS ack from a sleeping
                // end device (DELIVERY_FAILED, 0x66) before it next polls, and the
                // remote then counts its controller as lost. herdsman's own ezsp
                // sends use route discovery only; messageSent still confirms the
                // (indirect) delivery.
                aps.options = APS_ENABLE_ROUTE_DISCOVERY;
                const tag = aps.sequence & 0xff;
                let status = -1;
                try {
                    status = (await this.driver.ezsp.sendUnicast(OUTGOING_DIRECT, nwk, aps, tag, frame.data)).status;
                } catch (error) {
                    this.log.debug(`Control4 send to 0x${nwk.toString(16)} raised ${error}`);
                }
                if (status === EMBER_SUCCESS) {
                    if (ack) sent = this.waitSent(tag, nwk);
                    return;
                }
                if (attempt === SEND_ATTEMPTS) break;
                if ([EMBER_NO_BUFFERS, EMBER_MAX_MESSAGE_LIMIT_REACHED, EMBER_NETWORK_BUSY, -1].includes(status)) await wait(BUSY_DEFER_MS);
                else if (status === EMBER_NETWORK_DOWN) await wait(NETWORK_DOWN_DEFER_MS);
                else break;
            }
            throw new DeliveryError(`could not queue frame to 0x${nwk.toString(16)}`, "unqueued");
        };
        const queue = this.adapter.queue;
        if (queue && typeof queue.execute === "function") await queue.execute(run, nwk);
        else await run();
        if (sent) await sent;
    }

    private waitSent(tag: number, nwk: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(tag);
                reject(new DeliveryError("no delivery confirmation", "unconfirmed"));
            }, SENT_TIMEOUT_MS);
            timer.unref?.();
            this.pending.set(tag, {nwk, resolve, reject, timer});
        });
    }

    async mtorr(radius: number): Promise<boolean> {
        try {
            const res = await this.driver.ezsp.execCommand("sendManyToOneRouteRequest", {concentratorType: HIGH_RAM_CONCENTRATOR, radius});
            return res?.status === EMBER_SUCCESS;
        } catch (error) {
            this.log.warning(`Control4 route refresh failed: ${error}`);
            return false;
        }
    }
}
