/**
 * The Control4 runtime: owns the device handlers, routes inbound frames,
 * learns models from check-ins, answers every check-in with the controller
 * identity, and serves /set and /get from the converter.
 *
 * Independent of Zigbee2MQTT: `RuntimeHost` is the only way out, so the whole
 * runtime runs under test with a fake host and transport.
 */

import {AnimationEngine, TxPump} from "./animation";
import {
    ATTR_FIRMWARE,
    ATTR_LEVEL,
    ATTR_MODEL,
    C4_CLUSTER,
    canonicalModel,
    definitionModel,
    type DeviceFamily,
    isC4Ieee,
    isValidModel,
    type KcLayout,
    modelFromCheckin,
    modelInfo,
    PROFILE_BUTTON,
    PROFILE_NETWORK,
    PROFILE_OUTLET,
} from "./constants";
import {FastTaps} from "./fasttap";
import {isDeliveryFailure, Link, type LinkDevice, PING_PROPERTY} from "./link";
import type {Logger} from "./log";
import {
    buildIdentityFrame,
    parseFrame,
    parseReadAttributesResponse,
    parseReportAttributes,
    parseZclHeader,
    type ZclValue,
} from "./protocol";
import type {Store} from "./store";
import {TrafficWatch} from "./traffic";
import {DeliveryError, type InFrame, type OutFrame, type Transport} from "./transport";
import {C4Device, type DeviceContext, type Payload, type SetMeta, UnsupportedKey} from "../devices/base";
import {LED_DEFAULT_COLOUR, LED_DEFAULTS_KEY, LED_DEFAULTS_MIGRATION} from "./leds";
import {Dim1z, Fs1z, Outlet, SETTINGS_READ_KEY} from "../devices/dm";
import {Fan, FAN_PROVISIONED_KEY} from "../devices/dmx";
import {Apd120, Sw120277} from "../devices/gen3";
import {Kd120} from "../devices/kd120";
import {Kc120277, Keypad} from "../devices/keypad";
import {OutletDimmer} from "../devices/outlet-dimmer";
import {Remote, Sr260} from "../devices/remote";
import {Rosw120} from "../devices/rosw120";
import {Unsupported} from "../devices/unsupported";
import {Z2io} from "../devices/z2io";

export interface DeviceInfo {
    nwk: number;
    type?: string;
    modelID?: string;
}

export interface RuntimeHost {
    log: Logger;
    store: Store;
    transport: Transport | undefined;
    coordinatorIeee(): string | undefined;
    deviceInfo(ieee: string): DeviceInfo | undefined;
    /** IEEE for a network address (undefined if unknown - the host may look it up). */
    ieeeByNwk(nwk: number): string | undefined;
    /** Every Control4 device herdsman knows. */
    c4Devices(): string[];
    publish(ieee: string, payload: Payload): void;
    /** Publish an event on <base>/control4/event (optional). */
    publishEvent?(ieee: string, payload: Payload): void;
    state(ieee: string): Payload;
    friendlyName(ieee: string): string;
    deviceOption(ieee: string, key: string): unknown;
    /** Record the real model on the herdsman device and re-resolve its definition. */
    setModel(ieee: string, model: string): void;
    setFirmware(ieee: string, firmware: string): void;
    exposesChanged(ieee: string): void;
    /** Mark the device seen (last seen, availability; link quality when the frame tells it). */
    noteSeen(ieee: string, lqi?: number, rssi?: number): void;
    bind(ieee: string, srcEp: number, cluster: number): Promise<void>;
    /** ZCL Read Attributes through herdsman (standard clusters); the attribute values by name. */
    zclRead?(ieee: string, ep: number, cluster: string, attrs: string[]): Promise<Record<string, unknown>>;
    /** A traffic alarm was raised or cleared, or a device became unreachable or reachable again: the status changed. */
    statusChanged?(): void;
    /** A handoff for the device is under way (its saved settings may still arrive). */
    handoffPending?(ieee: string): boolean;
    /**
     * Ask the device for its network address (a ZDO request, broadcast, naming it): its
     * direct reply gives the coordinator a fresh route to it.
     */
    rediscover?(ieee: string): Promise<void>;
    now?(): number;
}

/** How often a new device's LED defaults look again while its handoff runs. */
const LED_DEFAULTS_RETRY = 5_000;

/*
 * Re-joins (#60). A Control4 device whose check-in goes unanswered counts its controller
 * as lost and re-joins; two DIM1-Zs did so on 2026-11-04 and their firmware stayed deaf
 * until rebooted. So: never leave a check-in unanswered, and watch every re-join.
 */
/** After an undelivered check-in reply (routes refreshed, the device asked for its address): the waits before each retry. */
export const IDENTITY_RETRIES = [3_000, 10_000];
/** After a re-join: the controller identity this many times, IDENTITY_REJOIN_GAP apart, the first 2-7 s in. */
export const IDENTITY_REJOIN_SENDS = 3;
const IDENTITY_REJOIN_GAP = 4_000;
/** After a re-join: when a Get-capable router must have answered (ms after the announce); unanswered at the last, it is unreachable. */
export const REJOIN_CHECKS = [120_000, 240_000];
/**
 * A device that re-joins this many times within REJOIN_STUCK_WINDOW, since its last
 * reboot, is stuck re-joining (2026-11-06: DIM1-Zs re-joined every hour until rebooted by
 * hand): the link reboots it REJOIN_REBOOT_DELAY (plus up to REJOIN_REBOOT_JITTER) after
 * the announce, once its identity sends are done.
 */
export const REJOIN_STUCK_COUNT = 3;
export const REJOIN_STUCK_WINDOW = 3.5 * 60 * 60_000;
export const REJOIN_REBOOT_DELAY = 30_000;
export const REJOIN_REBOOT_JITTER = 30_000;

/** A check-in, or the device polling for its controller: the identity it gets back is what keeps it ours. */
const isCheckinSource = (source: string) => source === "read_attributes" || source.startsWith("model_report");

const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        t.unref?.();
    });

/** Families whose EP2 attribute 0x0000 is a constant status, not a level. */
const PADDLE_STREAM: ReadonlySet<DeviceFamily> = new Set(["apd120", "kd120", "sw120277", "dim1z", "fs1z"]);

export function createDevice(ctx: DeviceContext, ieee: string, model: string, family: DeviceFamily): C4Device {
    switch (family) {
        case "apd120":
            return new Apd120(ctx, ieee, model, family);
        case "sw120277":
            return new Sw120277(ctx, ieee, model, family);
        case "fan":
            return new Fan(ctx, ieee, model, family);
        case "dim1z":
            return new Dim1z(ctx, ieee, model, family);
        case "fs1z":
            return new Fs1z(ctx, ieee, model, family);
        case "outlet":
            return new Outlet(ctx, ieee, model, family);
        case "outlet_dimmer":
            return new OutletDimmer(ctx, ieee, model, family);
        case "rosw120":
            return new Rosw120(ctx, ieee, model, family);
        case "kp2":
        case "kp3":
        case "kp6":
            return new Keypad(ctx, ieee, model, family);
        case "kc120277":
            return new Kc120277(ctx, ieee, model, family);
        case "kd120":
            return new Kd120(ctx, ieee, model, family);
        case "z2io":
            return new Z2io(ctx, ieee, model, family);
        case "sr250":
            return new Remote(ctx, ieee, model, family);
        case "sr260":
            return new Sr260(ctx, ieee, model, family);
        case "unsupported":
            return new Unsupported(ctx, ieee, model, family);
    }
}

/** Whether herdsman confirmed a failed send (a messageSent, with a failure status); undefined when the error doesn't tell. */
function messageSentOf(error: unknown): boolean | undefined {
    if (!(error instanceof DeliveryError)) return undefined;
    if (error.reason === "unconfirmed") return false;
    return error.reason === "failed" ? true : undefined;
}

export class Runtime {
    readonly devices = new Map<string, C4Device>();
    readonly link: Link;
    readonly fast = new FastTaps();
    readonly tx: TxPump;
    readonly anim: AnimationEngine;
    readonly traffic: TrafficWatch;
    readonly ctx: DeviceContext;
    private started = false;
    /** Devices without a handler yet, for identity replies and keepalive. */
    private bare = new Map<string, LinkDevice & {tsn: number}>();
    /** Devices whose undelivered check-in reply is being retried. */
    private recovering = new Set<string>();
    /** Each device's latest re-join: a newer one supersedes the checks of an older one. */
    private rejoins = new Map<string, number>();
    /** When each device re-joined, within REJOIN_STUCK_WINDOW and since its last automatic reboot. */
    private rejoinTimes = new Map<string, number[]>();
    private readonly now: () => number;
    /** TSN for identities sent by network address (a device Zigbee2MQTT doesn't know yet). */
    private unknownTsn = 0;

    constructor(readonly host: RuntimeHost) {
        const now = () => (host.now ? host.now() : Date.now());
        this.now = now;
        this.link = new Link({
            log: host.log,
            devices: () => [...this.devices.values()],
            mtorr: (radius) => host.transport?.mtorr(radius) ?? Promise.resolve(false),
            now,
            reachabilityChanged: () => host.statusChanged?.(),
            // With no frames coming through (or sends failing), every dimmer looks unreachable.
            rebootsHeld: () => {
                const raised = this.traffic.problems();
                return raised.length ? `the instance reports ${raised.join(", ")}` : undefined;
            },
        });
        this.tx = new TxPump(host.log);
        this.anim = new AnimationEngine(this.tx, host.log);
        this.traffic = new TrafficWatch({
            log: host.log,
            now,
            // A router keepalive pokes once it is quiet: a healthy instance hears from it.
            armed: () => [...this.devices.values()].some((d) => d.isRouter && this.link.canAnswerGet(d)),
            changed: () => host.statusChanged?.(),
        });
        this.ctx = {
            log: host.log,
            store: host.store,
            link: this.link,
            fast: this.fast,
            tx: this.tx,
            anim: this.anim,
            send: (ieee, frame, options) => this.sendRaw(ieee, frame, options),
            zclRead: (ieee, ep, cluster, attrs) => this.zclRead(ieee, ep, cluster, attrs),
            publish: (ieee, payload) => host.publish(ieee, payload),
            event: (ieee, payload) => host.publishEvent?.(ieee, payload),
            state: (ieee) => host.state(ieee),
            isRouter: (ieee) => host.deviceInfo(ieee)?.type !== "EndDevice",
            friendlyName: (ieee) => host.friendlyName(ieee),
            coordinatorIeee: () => host.coordinatorIeee(),
            bind: (ieee, srcEp, cluster) => host.bind(ieee, srcEp, cluster),
            deviceOption: (ieee, key) => host.deviceOption(ieee, key),
            exposesChanged: (ieee) => host.exposesChanged(ieee),
            sendIdentity: (dev, source) => this.sendIdentity(dev.ieee, source),
            now,
        };
    }

    get log(): Logger {
        return this.host.log;
    }

    /**
     * `hotLoad`: Zigbee2MQTT kept running, so the devices it starts with already had
     * their once-per-process start-up work, and skip it. Devices that join later don't.
     */
    start(hotLoad = false): void {
        if (this.started) return;
        this.started = true;
        this.host.transport?.start((frame) => this.onFrame(frame));
        this.migrateLedDefaults();
        for (const ieee of this.host.c4Devices()) this.ensureDevice(ieee, hotLoad);
        this.link.startKeepalive();
        this.traffic.start();
    }

    stop(): void {
        this.started = false;
        this.host.transport?.stop();
        this.link.stop();
        this.traffic.stop();
        this.tx.stop();
        this.fast.clear();
        for (const dev of this.devices.values()) dev.stop();
        this.devices.clear();
        this.host.store.flushSync();
    }

    // -- devices --------------------------------------------------------------

    /** The model to use for a device: learned from a check-in, else herdsman's. */
    modelOf(ieee: string): string | undefined {
        const stored = this.host.store.model(ieee);
        if (isValidModel(stored)) return stored;
        const zh = this.host.deviceInfo(ieee)?.modelID;
        return isValidModel(zh) ? zh : undefined;
    }

    /** Create (or re-create after a model change) the handler for a device; `hotLoad` as for start(). */
    ensureDevice(ieee: string, hotLoad = false): C4Device | undefined {
        const id = ieee.toLowerCase();
        if (!isC4Ieee(id)) return undefined;
        const model = this.modelOf(id);
        const info = modelInfo(model);
        const existing = this.devices.get(id);
        if (!model) return existing;
        const family: DeviceFamily = info?.family ?? "unsupported";
        // An unsupported device that names another model is made again: what it reports is what it shows.
        if (existing && existing.family === family && (family !== "unsupported" || existing.model === model)) {
            existing.model = model;
            return existing;
        }
        if (existing) {
            existing.stop();
            this.anim.unregister(id);
        }
        const dev = createDevice(this.ctx, id, model, family);
        this.devices.set(id, dev);
        this.bare.delete(id);
        dev.start(hotLoad);
        const initial = dev.initialState();
        if (Object.keys(initial).length) this.host.publish(id, initial);
        this.scheduleLedDefaults(dev);
        if (!hotLoad) this.requestStateRead(id);
        if (info) this.log.info(`Control4: ${this.host.friendlyName(id)} is a ${model} (${family})`);
        else
            this.log.warning(
                `Control4: ${this.host.friendlyName(id)} (${id}) reports model ${model}, which this build doesn't support yet. It stays a generic Control4 device: its check-ins are answered, its frames are logged at info, and c4_get / c4_send reach it`,
            );
        return dev;
    }

    /**
     * Devices already paired when LED defaults were introduced keep whatever their LEDs show:
     * mark them once, so only devices paired from now on start with every colour off.
     */
    private migrateLedDefaults(): void {
        const store = this.host.store;
        if (store.meta(LED_DEFAULTS_MIGRATION)) return;
        for (const ieee of new Set([...this.host.c4Devices(), ...store.knownDevices()])) {
            if (store.get(ieee, LED_DEFAULTS_KEY) === undefined) store.set(ieee, LED_DEFAULTS_KEY, "existing");
        }
        store.setMeta(LED_DEFAULTS_MIGRATION, true);
    }

    /**
     * A newly paired device with LEDs: write the default colours once, 20-30 s after it
     * appears, and only once its handoff is over: a device that moved brings its own.
     */
    private scheduleLedDefaults(dev: C4Device): void {
        if (!dev.ledKeys || this.host.store.get(dev.ieee, LED_DEFAULTS_KEY) !== undefined) return;
        const apply = async (): Promise<void> => {
            if (this.host.store.get(dev.ieee, LED_DEFAULTS_KEY) !== undefined) return;
            if (this.host.handoffPending?.(dev.ieee)) {
                dev.after(LED_DEFAULTS_RETRY, apply);
                return;
            }
            const n = await dev.ledKeys?.applyDefaults();
            if (!dev.alive) return; // stopped mid-way: try again next start
            this.host.store.set(dev.ieee, LED_DEFAULTS_KEY, LED_DEFAULT_COLOUR);
            if (n) this.log.info(`Control4: ${dev.name} is new; its ${n} LED colours start as ${LED_DEFAULT_COLOUR}`);
        };
        dev.after(20_000 + Math.random() * 10_000, apply);
    }

    /**
     * Queue the device's one-off state read (startup, join, announce), if it has
     * one: a DIM1-Z otherwise has no state until its level next changes.
     */
    requestStateRead(ieee: string): void {
        const dev = this.get(ieee);
        const read = dev?.stateReader();
        if (dev && read) this.link.queueStateRead(dev.ieee, read);
    }

    /**
     * Back after a power cut or a reboot (it announced): its LEDs may have lost what
     * they were sent, and both LED layers skip a colour they think it already shows.
     * Forget that, and repaint its status LEDs 20-30 s later, once the network has
     * settled from everything else rejoining.
     */
    repaintLeds(ieee: string): void {
        const dev = this.get(ieee);
        if (!dev) return;
        dev.ledKeys?.writer.forget();
        const animator = this.anim.get(dev.ieee);
        if (animator) dev.after(20_000 + Math.random() * 10_000, () => animator.refresh());
    }

    /** A device that left may come back reset: provision it, and read its settings, again when it does. */
    forgetProvisioning(ieee: string): void {
        this.host.store.set(ieee, FAN_PROVISIONED_KEY, undefined);
        this.forgetSettingsRead(ieee);
    }

    /** Read the device's own settings again when its handler next starts: it may have been reset. */
    forgetSettingsRead(ieee: string): void {
        this.host.store.set(ieee, SETTINGS_READ_KEY, undefined);
    }

    removeDevice(ieee: string): void {
        const id = ieee.toLowerCase();
        this.devices.get(id)?.stop();
        this.devices.delete(id);
        this.anim.unregister(id);
        this.bare.delete(id);
        this.link.cancelStateRead(id);
    }

    get(ieee: string): C4Device | undefined {
        return this.devices.get(ieee.toLowerCase());
    }

    /** A fresh handler for the device, reading its saved settings anew (after a handoff brought them). */
    rebuild(ieee: string): C4Device | undefined {
        this.removeDevice(ieee);
        return this.ensureDevice(ieee);
    }

    /** Manually set a device's model (the ZHA c4_quirk_data.json seed). */
    seedModel(ieee: string, rawModel: string): string {
        const model = canonicalModel(rawModel);
        if (!modelInfo(model)) throw new Error(`unknown Control4 model '${rawModel}'`);
        this.host.store.setModel(ieee, model);
        this.host.setModel(ieee.toLowerCase(), model);
        this.ensureDevice(ieee);
        return model;
    }

    // -- transmit ---------------------------------------------------------------

    private async sendRaw(ieee: string, frame: OutFrame, options?: {ack?: boolean}): Promise<void> {
        const transport = this.host.transport;
        if (!transport) throw new Error("Control4: no supported coordinator (an Ember adapter, or the legacy ezsp one, is required)");
        const info = this.host.deviceInfo(ieee);
        if (!info) throw new Error(`Control4: unknown device ${ieee}`);
        try {
            await transport.send(info.nwk, frame, {...options, sleepy: info.type === "EndDevice"});
            this.link.noteTx(ieee, true);
            // Without an ack the send never waits for messageSent.
            this.traffic.sent(options?.ack === false ? undefined : true);
        } catch (error) {
            this.link.noteTx(ieee, false);
            this.traffic.sent(messageSentOf(error));
            throw error;
        }
    }

    private async zclRead(ieee: string, ep: number, cluster: string, attrs: string[]): Promise<Record<string, unknown>> {
        if (!this.host.zclRead) throw new Error("Control4: this host cannot read ZCL attributes");
        try {
            const values = await this.host.zclRead(ieee, ep, cluster, attrs);
            this.link.noteTx(ieee, true);
            return values;
        } catch (error) {
            this.link.noteTx(ieee, false);
            throw error;
        }
    }

    private linkDevice(ieee: string): LinkDevice & {tsn: number} {
        const dev = this.devices.get(ieee);
        if (dev) {
            return Object.assign(Object.create(null), {
                ieee,
                tsn: dev.nextTsn(),
                get model() {
                    return dev.model;
                },
                get isRouter() {
                    return dev.isRouter;
                },
                nextSeq: () => dev.nextSeq(),
                sendText: (t: string) => dev.sendText(t),
            });
        }
        let bare = this.bare.get(ieee);
        if (!bare) {
            let seq = 0x40;
            bare = {
                ieee,
                tsn: 0,
                model: this.modelOf(ieee) ?? "",
                isRouter: this.host.deviceInfo(ieee)?.type !== "EndDevice",
                nextSeq: () => {
                    const s = seq;
                    seq = (seq + 1) & 0xffff;
                    return s;
                },
                sendText: async () => undefined,
            };
            this.bare.set(ieee, bare);
        }
        bare.tsn = (bare.tsn + 1) & 0xff;
        return bare;
    }

    /**
     * The controller identity (coordinator IEEE in attrs 8/9/A on EP2). Sent as
     * Report Attributes on every model check-in - never throttle it: a device
     * whose check-in goes unanswered treats the controller as lost and rejoins.
     * A check-in reply that isn't delivered is retried (retryIdentity).
     */
    async sendIdentity(ieee: string, source: string, readResponseTsn?: number, urgent = true): Promise<void> {
        const sent = await this.transmitIdentity(ieee, source, readResponseTsn, urgent);
        if (!(sent instanceof Error)) return;
        // Evidence for a device that stops answering (#60), and the reply must still arrive.
        const checkin = isCheckinSource(source);
        this.log.info(
            `Control4: ${this.host.friendlyName(ieee)}'s controller identity (${source}) was not delivered (${sent.message})${checkin ? " - a Control4 device whose check-in goes unanswered treats its controller as lost; refreshing routes and trying again" : ""}`,
        );
        if (checkin) void this.retryIdentity(ieee, source);
    }

    /** The coordinator's IEEE, once herdsman knows it. */
    private coordinator(source: string): string | undefined {
        const coordinator = this.host.coordinatorIeee();
        if (coordinator && !/^0x(f{16})$/i.test(coordinator)) return coordinator;
        this.log.debug(`Control4 identity (${source}): coordinator IEEE not known yet - skipped`);
        return undefined;
    }

    /** One identity frame: true when delivered, the error when not delivered, false when not sent for another reason. */
    private async transmitIdentity(ieee: string, source: string, readResponseTsn?: number, urgent = true): Promise<boolean | Error> {
        const coordinator = this.coordinator(source);
        if (!coordinator) return false;
        const tsn = readResponseTsn ?? this.linkDevice(ieee).tsn;
        const data = buildIdentityFrame(coordinator, tsn, readResponseTsn !== undefined);
        try {
            await this.link.transmit(ieee, () => this.sendRaw(ieee, {profile: PROFILE_NETWORK, cluster: C4_CLUSTER, srcEp: 2, dstEp: 2, data}), urgent);
            this.log.debug(`Control4 identity (${source}) sent to ${ieee}`);
            return true;
        } catch (error) {
            if (isDeliveryFailure(error)) return error as Error;
            this.log.debug(`Control4 identity (${source}) to ${ieee} failed: ${error}`);
            return false;
        }
    }

    /**
     * A check-in reply that wasn't delivered: its route is broken. Refresh routes, ask the
     * device for its address (its direct reply gives the coordinator a fresh route), and send
     * the identity again within seconds, before the device counts its controller as lost.
     */
    private async retryIdentity(ieee: string, source: string): Promise<void> {
        if (this.recovering.has(ieee)) return;
        this.recovering.add(ieee);
        const name = () => this.host.friendlyName(ieee);
        try {
            this.link.requestRouteRefresh(`controller identity to ${ieee} not delivered`);
            await Promise.resolve(this.host.rediscover?.(ieee)).catch((error: unknown) => this.log.debug(`Control4: rediscovering ${ieee} failed: ${error}`));
            for (let i = 0; i < IDENTITY_RETRIES.length; i++) {
                await sleep(IDENTITY_RETRIES[i]);
                if (!this.started || !this.host.deviceInfo(ieee)) return;
                const sent = await this.transmitIdentity(ieee, `${source}_retry_${i + 1}`);
                if (sent === true) {
                    this.log.info(`Control4: ${name()}'s controller identity was delivered on retry ${i + 1}`);
                    return;
                }
                if (sent === false) return;
            }
            this.log.info(`Control4: ${name()}'s controller identity is still not delivered after ${IDENTITY_RETRIES.length} retries - it may count its controller as lost and re-join`);
        } finally {
            this.recovering.delete(ieee);
        }
    }

    /**
     * A check-in, or a poll for its controller, from a network address Zigbee2MQTT doesn't
     * know yet: a device that re-joined under a new address. Answer it now, by that address
     * (the identity is the same for every device), so it doesn't count its controller as lost
     * while the address is looked up.
     */
    private answerUnknown(frame: InFrame): void {
        if (frame.profile !== PROFILE_NETWORK) return;
        const hdr = parseZclHeader(frame.data);
        if (!hdr) return;
        let readResponseTsn: number | undefined;
        if (hdr.commandId === 0x00) {
            readResponseTsn = hdr.tsn;
        } else if (hdr.commandId === 0x0a) {
            const model = parseReportAttributes(frame.data.subarray(hdr.offset))?.get(ATTR_MODEL);
            if (typeof model !== "string" || !isValidModel(canonicalModel(modelFromCheckin(model)))) return;
        } else {
            return;
        }
        void this.sendIdentityTo(frame.nwk, readResponseTsn);
    }

    private async sendIdentityTo(nwk: number, readResponseTsn?: number): Promise<void> {
        const transport = this.host.transport;
        const coordinator = this.coordinator(`check-in from ${nwk}`);
        if (!transport || !coordinator) return;
        this.unknownTsn = (this.unknownTsn + 1) & 0xff;
        const data = buildIdentityFrame(coordinator, readResponseTsn ?? this.unknownTsn, readResponseTsn !== undefined);
        try {
            // Not known yet: most likely a remote that just re-joined, so sent the way a sleeping end device needs.
            await this.link.transmit(`nwk:${nwk}`, () => transport.send(nwk, {profile: PROFILE_NETWORK, cluster: C4_CLUSTER, srcEp: 2, dstEp: 2, data}, {sleepy: true}), true);
            this.traffic.sent(true);
            this.log.info(`Control4: answered a check-in from network address ${nwk}, which Zigbee2MQTT does not know yet, with the controller identity`);
        } catch (error) {
            this.traffic.sent(messageSentOf(error));
            this.log.info(`Control4: the controller identity to network address ${nwk} (not known to Zigbee2MQTT yet) was not delivered: ${(error as Error).message}`);
        }
    }

    /**
     * A device announced itself: it re-joined or powered up, often because it counted its
     * controller as lost. Tell it who its controller is now, IDENTITY_REJOIN_SENDS times, and
     * check that a Get-capable router answers again: one that doesn't is listed unreachable
     * after REJOIN_CHECKS, not after three missed keepalives (about 40 minutes).
     */
    rejoined(ieee: string): void {
        const dev = this.get(ieee);
        if (!dev) return;
        const token = (this.rejoins.get(dev.ieee) ?? 0) + 1;
        this.rejoins.set(dev.ieee, token);
        const current = () => dev.alive && this.rejoins.get(dev.ieee) === token;
        // Spread, so a power cut that brings every device back at once doesn't send them all together.
        dev.after(2_000 + Math.random() * 5_000, async () => {
            for (let i = 0; i < IDENTITY_REJOIN_SENDS; i++) {
                if (i) await dev.sleep(IDENTITY_REJOIN_GAP);
                if (!current()) return;
                await this.sendIdentity(dev.ieee, `rejoin_${i + 1}`, undefined, false);
            }
        });
        this.watchStuckRejoins(dev, current);
        if (!dev.isRouter || !this.link.canAnswerGet(dev)) return;
        const check = (n: number) =>
            dev.after(REJOIN_CHECKS[n] - (n ? REJOIN_CHECKS[n - 1] : 0), async () => {
                if (!current() || (await this.link.get(dev, PING_PROPERTY)) !== undefined) return;
                if (!current()) return;
                if (n + 1 < REJOIN_CHECKS.length) check(n + 1);
                else this.link.markUnreachable(dev, `re-joined and has answered none of the ${REJOIN_CHECKS.length} checks since`);
            });
        check(0);
    }

    /**
     * Count the device's re-joins: at the REJOIN_STUCK_COUNT-th within REJOIN_STUCK_WINDOW
     * since its last reboot (by the link or its Reboot button), ask the link to reboot it;
     * the link decides whether the device can and may be. A reboot it held back leaves the
     * re-joins counted.
     */
    private watchStuckRejoins(dev: C4Device, current: () => boolean): void {
        const now = this.now();
        const rebooted = this.link.lastRebootAt(dev.ieee) ?? Number.NEGATIVE_INFINITY;
        const times = [...(this.rejoinTimes.get(dev.ieee) ?? []), now].filter((t) => now - t <= REJOIN_STUCK_WINDOW && t > rebooted);
        this.rejoinTimes.set(dev.ieee, times);
        if (times.length < REJOIN_STUCK_COUNT) return;
        const min = Math.round((now - times[0]) / 60_000);
        const span = min < 90 ? `${min} min` : `about ${Math.round(min / 60)} h`;
        dev.after(REJOIN_REBOOT_DELAY + Math.random() * REJOIN_REBOOT_JITTER, () => {
            if (!current()) return;
            if (this.link.autoReboot(dev, `it has re-joined ${times.length} times in ${span} (stuck re-joining)`)) this.rejoinTimes.delete(dev.ieee);
        });
    }

    // -- receive ----------------------------------------------------------------

    onFrame(frame: InFrame): boolean {
        // Whoever sent it: the receive hook works.
        this.traffic.frame();
        const ieee = this.host.ieeeByNwk(frame.nwk)?.toLowerCase();
        if (!ieee) {
            this.answerUnknown(frame);
            return false;
        }
        if (!isC4Ieee(ieee)) return false;
        // A router's broadcast (its hourly check-in) proves it has power, not that anything
        // sent to it gets through: its availability is the ping's call. A remote isn't
        // pinged, so any frame of its counts.
        if (frame.unicast || !this.ctx.isRouter(ieee)) this.host.noteSeen(ieee, frame.lqi, frame.rssi);
        this.link.noteRx(ieee, frame.unicast);
        try {
            if (frame.profile === PROFILE_BUTTON) this.onAscii(ieee, frame);
            else if (frame.profile === PROFILE_NETWORK) this.onNetwork(ieee, frame);
            else if (frame.profile === PROFILE_OUTLET) this.onOutlet(ieee, frame);
        } catch (error) {
            this.log.warning(`Control4: frame from ${ieee} failed: ${(error as Error).stack ?? error}`);
        }
        return true;
    }

    private onAscii(ieee: string, frame: InFrame): void {
        const parsed = parseFrame(frame.data);
        this.log.debug(`Control4 ${this.host.friendlyName(ieee)} <- ${parsed.text}`);
        this.link.resolveReply(ieee, parsed);
        const dev = this.devices.get(ieee) ?? this.ensureDevice(ieee);
        dev?.handleAscii(parsed);
    }

    private onNetwork(ieee: string, frame: InFrame): void {
        const hdr = parseZclHeader(frame.data);
        if (!hdr) return;
        const payload = frame.data.subarray(hdr.offset);
        if (hdr.commandId === 0x00) {
            // The device polling for its controller: answer with the identity.
            void this.sendIdentity(ieee, "read_attributes", hdr.tsn);
            return;
        }
        let attrs: Map<number, ZclValue> | undefined;
        if (hdr.commandId === 0x0a) attrs = parseReportAttributes(payload);
        else if (hdr.commandId === 0x01) attrs = parseReadAttributesResponse(payload);
        if (!attrs) return;
        this.applyAttributes(ieee, attrs, hdr.commandId === 0x0a, "network");
    }

    private onOutlet(ieee: string, frame: InFrame): void {
        const hdr = parseZclHeader(frame.data);
        if (!hdr) return;
        const payload = frame.data.subarray(hdr.offset);
        let attrs: Map<number, ZclValue> | undefined;
        if (hdr.commandId === 0x0a) attrs = parseReportAttributes(payload);
        else if (hdr.commandId === 0x01) attrs = parseReadAttributesResponse(payload);
        if (!attrs) return;
        this.applyAttributes(ieee, attrs, false, "outlet");
        this.devices.get(ieee)?.onOutletAttributes(attrs);
    }

    private applyAttributes(ieee: string, attrs: Map<number, ZclValue>, isReport: boolean, source: "network" | "outlet"): void {
        const modelRaw = attrs.get(ATTR_MODEL);
        if (typeof modelRaw === "string") {
            const model = canonicalModel(modelFromCheckin(modelRaw));
            if (isValidModel(model)) {
                this.learnModel(ieee, model);
                if (isReport && source === "network") void this.sendIdentity(ieee, `model_report_${model}`);
            }
        }
        const fw = attrs.get(ATTR_FIRMWARE);
        if (typeof fw === "string" && fw.trim()) this.host.setFirmware(ieee, fw.trim());
        const level = attrs.get(ATTR_LEVEL);
        if (source === "network" && typeof level === "number") {
            const dev = this.devices.get(ieee);
            if (dev && !PADDLE_STREAM.has(dev.family)) dev.onNetworkLevel(level);
        }
    }

    learnModel(ieee: string, model: string): void {
        const known = this.host.store.model(ieee);
        if (known !== model) {
            this.host.store.setModel(ieee, model);
            this.log.info(`Control4: learned model ${model} for ${this.host.friendlyName(ieee)}`);
        }
        // A model this build doesn't support keeps the generic record: its definition still serves c4_get / c4_send.
        const record = definitionModel(model);
        if (this.host.deviceInfo(ieee)?.modelID !== record) this.host.setModel(ieee, record);
        const dev = this.devices.get(ieee);
        if (!dev || dev.model !== model) this.ensureDevice(ieee);
    }

    // -- converter API ---------------------------------------------------------

    async set(ieee: string, key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        const dev = this.get(ieee) ?? this.ensureDevice(ieee);
        if (!dev) throw new Error(`Control4: ${ieee} has no known model yet - wait for its check-in or seed it (bridge/request/control4/set_model)`);
        try {
            return await dev.setValue(key, value, meta);
        } catch (error) {
            if (error instanceof UnsupportedKey) throw new Error(error.message);
            throw error;
        }
    }

    async getValue(ieee: string, key: string): Promise<void> {
        await this.get(ieee)?.getValue(key);
    }

    /** Z2M availability ping: true/false, or undefined when this device cannot be pinged. */
    async honestPing(ieee: string): Promise<boolean | undefined> {
        const dev = this.get(ieee);
        if (!dev) return undefined;
        const answersGet = this.link.canAnswerGet(dev);
        const alive = await this.link.honestPing(dev);
        // Zigbee2MQTT calls a device available only while its last seen is recent, and only
        // frames herdsman receives move it. A Get's reply comes in as one (a unicast); a
        // delivered Get to a model that never answers is heard as an APS ack alone.
        if (alive && !answersGet) this.host.noteSeen(dev.ieee);
        return alive;
    }

    /** The IO mode a Z2IO uses (its exposes depend on it). */
    z2ioMode(ieee: string): number | undefined {
        const dev = this.get(ieee);
        return dev instanceof Z2io ? dev.mode : undefined;
    }

    /** A KC120277's fitted buttons (if known) and numbering (its exposes depend on them). */
    kcLayout(ieee: string): KcLayout | undefined {
        const dev = this.get(ieee);
        return dev instanceof Kc120277 ? dev.layout() : undefined;
    }
}