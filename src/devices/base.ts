/**
 * Base class for one Control4 device handler.
 *
 * A handler owns everything the ZHA quirk spread over synthetic clusters: it
 * parses the device's frames, publishes Z2M state / actions, and turns /set
 * requests into Control4 frames. Families subclass it (devices/*.ts).
 */

import type {AnimationEngine, TxPump} from "../core/animation";
import type {DeviceFamily, Gesture} from "../core/constants";
import {C4_CLUSTER, DEFAULT_TAP_WINDOW_MS, GESTURES, MAX_TAP_WINDOW_MS, MIN_TAP_WINDOW_MS, PROFILE_BUTTON, TAP_WINDOW_OPTION} from "../core/constants";
import type {FastTaps} from "../core/fasttap";
import type {Link, LinkDevice, StateReadResult} from "../core/link";
import type {Logger} from "../core/log";
import {buildFrame, hex4, type ParsedFrame, type ZclValue} from "../core/protocol";
import type {Store} from "../core/store";
import type {OutFrame} from "../core/transport";

export type Payload = Record<string, unknown>;

export interface DeviceContext {
    log: Logger;
    store: Store;
    link: Link;
    fast: FastTaps;
    tx: TxPump;
    anim: AnimationEngine;
    send(ieee: string, frame: OutFrame, options?: {ack?: boolean}): Promise<void>;
    /** ZCL Read Attributes on a standard cluster (herdsman names), e.g. (1, "genOnOff", ["onOff"]). */
    zclRead(ieee: string, ep: number, cluster: string, attrs: string[]): Promise<Record<string, unknown>>;
    publish(ieee: string, payload: Payload): void;
    /** A button / menu / notification event, also sent on <base>/control4/event. */
    event(ieee: string, payload: Payload): void;
    state(ieee: string): Payload;
    isRouter(ieee: string): boolean;
    friendlyName(ieee: string): string;
    coordinatorIeee(): string | undefined;
    bind(ieee: string, srcEp: number, cluster: number): Promise<void>;
    deviceOption(ieee: string, key: string): unknown;
    exposesChanged(ieee: string): void;
    sendIdentity(dev: C4Device, source: string): Promise<void>;
    now(): number;
}

export interface SetMeta {
    /** Whole /set message (other keys, e.g. transition). */
    message: Payload;
    /** Endpoint name from a suffixed key (state_l2 -> "l2"). */
    endpoint?: string;
}

export class UnsupportedKey extends Error {}

const REPLY_CAPTURE_MS = 20_000;
/** A device option written as text that is a plain decimal number ("0.8", "-1", ".5", "1.", "+1"). */
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
/** Setting: the buttons seen sending a release, so their first tap after a start is a known tap. */
const RELEASING_BUTTONS_KEY = "releasing_buttons";

export abstract class C4Device implements LinkDevice {
    private seq = 0x40;
    private tsn = 0;
    private timers = new Set<NodeJS.Timeout>();
    private sleepers = new Set<() => void>();
    protected stopped = false;
    private captureUntil = 0;
    /** False for a device whose buttons never report a hold: its press is known to be a tap at once. */
    protected readonly hasHold: boolean = true;

    constructor(
        readonly ctx: DeviceContext,
        readonly ieee: string,
        public model: string,
        readonly family: DeviceFamily,
    ) {
        for (const button of this.releasingButtons()) ctx.fast.releasers.add(this.tapKey(button));
    }

    get log(): Logger {
        return this.ctx.log;
    }

    get name(): string {
        return this.ctx.friendlyName(this.ieee);
    }

    get isRouter(): boolean {
        return this.ctx.isRouter(this.ieee);
    }

    /** Shared 16-bit C4 transport sequence (seeded 0x0040 like the Director). */
    nextSeq(): number {
        const s = this.seq;
        this.seq = (s + 1) & 0xffff;
        return s;
    }

    nextTsn(): number {
        this.tsn = (this.tsn + 1) & 0xff;
        return this.tsn;
    }

    // -- transmit ---------------------------------------------------------------

    async sendFrame(frame: OutFrame, options?: {ack?: boolean}): Promise<void> {
        // A replaced or removed handler must not keep talking to the device.
        if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
        await this.ctx.link.transmit(this.ieee, async () => {
            if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
            await this.ctx.send(this.ieee, frame, options);
        });
    }

    sendText(text: string, dstEp = 1, srcEp = 1, options?: {ack?: boolean}): Promise<void> {
        this.log.debug(`Control4 ${this.name} -> ${text}`);
        return this.sendFrame({profile: PROFILE_BUTTON, cluster: C4_CLUSTER, srcEp, dstEp, data: buildFrame(text)}, options);
    }

    /** `0s<seq> <cmd>`. Throws on a delivery failure. */
    set(cmd: string, dstEp = 1): Promise<void> {
        return this.sendText(`0s${hex4(this.nextSeq())} ${cmd}`, dstEp);
    }

    /** `0s<seq> <cmd>`, failures logged at debug and swallowed (LED / provisioning frames). */
    async trySet(cmd: string, dstEp = 1): Promise<boolean> {
        try {
            await this.set(cmd, dstEp);
            return true;
        } catch (error) {
            this.log.debug(`Control4 ${this.name}: '${cmd}' failed: ${error}`);
            return false;
        }
    }

    get(prop: string, timeout?: number) {
        return this.ctx.link.get(this, prop, timeout);
    }

    /** A ZCL attribute read on a standard cluster, paced like every other send. Throws on no answer. */
    async zclRead(ep: number, cluster: string, attrs: string[]): Promise<Record<string, unknown>> {
        if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
        return this.ctx.link.transmit(this.ieee, async () => {
            if (this.stopped) throw new Error(`Control4 ${this.ieee}: handler stopped`);
            this.log.debug(`Control4 ${this.name} -> ZCL read ${cluster} ${attrs.join(", ")}`);
            return this.ctx.zclRead(this.ieee, ep, cluster, attrs);
        });
    }

    // -- state ------------------------------------------------------------------

    publish(payload: Payload): void {
        if (this.stopped || Object.keys(payload).length === 0) return;
        this.ctx.publish(this.ieee, payload);
    }

    state(): Payload {
        return this.ctx.state(this.ieee);
    }

    /** Whether the state published last says the load is on. */
    isOn(): boolean {
        return String(this.state().state ?? "OFF").toUpperCase() === "ON";
    }

    setting<T>(key: string, fallback: T): T;
    setting<T>(key: string): T | undefined;
    setting<T>(key: string, fallback?: T): T | undefined {
        const v = this.ctx.store.get<T>(this.ieee, key);
        return v === undefined || v === null ? fallback : v;
    }

    saveSetting(key: string, value: unknown): void {
        // biome-ignore lint/suspicious/noExplicitAny: JSON value
        this.ctx.store.set(this.ieee, key, value as any);
    }

    option(key: string): unknown {
        return this.ctx.deviceOption(this.ieee, key);
    }

    /**
     * This device's tap window (ms): its `tap_window` option (seconds, a number
     * or decimal text) clamped to the allowed range, else the default.
     */
    tapWindow(): number {
        const raw = this.option(TAP_WINDOW_OPTION);
        const seconds = typeof raw === "number" ? raw : typeof raw === "string" && DECIMAL.test(raw) ? Number(raw) : Number.NaN;
        if (Number.isNaN(seconds)) return DEFAULT_TAP_WINDOW_MS;
        return Math.min(MAX_TAP_WINDOW_MS, Math.max(MIN_TAP_WINDOW_MS, seconds * 1000));
    }

    // -- timers -----------------------------------------------------------------

    after(ms: number, fn: () => unknown): NodeJS.Timeout {
        const t = setTimeout(() => {
            this.timers.delete(t);
            if (this.stopped) return;
            this.spawn(fn());
        }, ms);
        t.unref?.();
        this.timers.add(t);
        return t;
    }

    cancel(t: NodeJS.Timeout | undefined): void {
        if (!t) return;
        clearTimeout(t);
        this.timers.delete(t);
    }

    /** A sleep that ends early (resolves) when the handler stops, so nothing awaits forever. */
    sleep(ms: number): Promise<void> {
        if (this.stopped) return Promise.resolve();
        return new Promise((resolve) => {
            const wake = () => {
                clearTimeout(t);
                this.timers.delete(t);
                this.sleepers.delete(wake);
                resolve();
            };
            const t = setTimeout(wake, ms);
            t.unref?.();
            this.timers.add(t);
            this.sleepers.add(wake);
        });
    }

    spawn(value: unknown): void {
        if (value && typeof (value as Promise<unknown>).catch === "function") {
            (value as Promise<unknown>).catch((error) => this.log.debug(`Control4 ${this.name}: background task failed: ${(error as Error)?.stack ?? error}`));
        }
    }

    // -- lifecycle --------------------------------------------------------------

    /**
     * Called once the handler exists (startup, join, or model learned). On a
     * hot-load (`hotLoad`) Zigbee2MQTT kept running, so the device already had its
     * once-per-process start-up work: skip it.
     */
    start(_hotLoad = false): void {}

    /** LED colour keys, for devices that have them (keypads, dimmers, LED bars). */
    get ledKeys(): {applyDefaults(): Promise<number>; readonly writer: {forget(): void}} | undefined {
        return undefined;
    }

    stop(): void {
        this.stopped = true;
        for (const t of this.timers) clearTimeout(t);
        this.timers.clear();
        for (const wake of [...this.sleepers]) wake();
        this.sleepers.clear();
    }

    /** Re-adopt a handler after a model change keeps the same family. */
    get alive(): boolean {
        return !this.stopped;
    }

    // -- actions ----------------------------------------------------------------

    /**
     * Publish a button gesture as a Z2M action (`button_1_double`) with the
     * ZHA command name alongside. The fast-tap counter sees the gesture
     * first, so its tap index is known before the gesture is published; a
     * fast count the gesture closes is published after it.
     */
    emitAction(button: string, gesture: Gesture, extra: Payload = {}, fastTaps = true): void {
        const emitFast = (fast: Gesture, allTapsKnown: boolean) => this.emitAction(button, fast, {...extra, action_known_taps: allTapsKnown}, false);
        if (fastTaps && gesture === "release") this.rememberRelease(button);
        const tap = fastTaps ? this.ctx.fast.observe(this.tapKey(button), gesture, this.tapWindow(), emitFast, this.hasHold) : {};
        const payload: Payload = {
            action: `${button}_${gesture}`,
            action_button: button,
            action_gesture: gesture,
            action_command: GESTURES[gesture],
            ...extra,
        };
        this.publish(payload);
        this.sendEvent(payload);
        if (tap.knownTapIndex !== undefined) this.emitAction(button, "tap_known", {...extra, action_tap_index: tap.knownTapIndex}, false);
        if (tap.fastCount) emitFast(tap.fastCount, tap.allTapsKnown === true);
    }

    private tapKey(button: string): string {
        return `${this.ieee}:${button}`;
    }

    /** The buttons seen sending a release, kept in the saved settings across starts. */
    private releasingButtons(): string[] {
        const stored = this.setting<unknown>(RELEASING_BUTTONS_KEY);
        return Array.isArray(stored) ? stored.filter((b): b is string => typeof b === "string") : [];
    }

    /** Keep a button's first release; one already kept writes nothing. */
    private rememberRelease(button: string): void {
        const buttons = this.releasingButtons();
        if (!buttons.includes(button)) this.saveSetting(RELEASING_BUTTONS_KEY, [...buttons, button]);
    }

    /** A non-button action (motion_wake, menu_select, led_notification_end ...). */
    emitEvent(action: string, extra: Payload = {}): void {
        const payload: Payload = {action, action_command: action, ...extra};
        this.publish(payload);
        this.sendEvent(payload);
    }

    /** The same event for blueprints: `action_` prefixes dropped, IEEE and model added. */
    private sendEvent(payload: Payload): void {
        if (this.stopped) return;
        const event: Payload = {ieee: this.ieee, device: this.name, model: this.model};
        for (const [k, v] of Object.entries(payload)) event[k === "action" ? k : k.replace(/^action_/, "")] = v;
        this.ctx.event(this.ieee, event);
    }

    // -- receive ----------------------------------------------------------------

    handleAscii(frame: ParsedFrame): void {
        const t = frame.tokens;
        if (t.length < 2) return;
        if (frame.kind === "reply") {
            this.onReply(frame);
            this.captureReply(frame);
            return;
        }
        if (t[1] === "sa" && t.length >= 3) {
            this.onAnnounce(t[2], t.slice(3));
            return;
        }
        // While a probe waits for its answer, a frame of any other type is part of it.
        if (this.ctx.now() <= this.captureUntil) this.log.warning(`Control4 FRAME ${this.name}: ${frame.text}`);
        this.onOther(frame);
    }

    protected onAnnounce(namespace: string, data: string[]): void {
        this.log.debug(`Control4 ${this.name}: unhandled announcement ${namespace} ${data.join(" ")}`);
    }

    protected onReply(_frame: ParsedFrame): void {}

    /** The device read the controller identity (0xC25D attributes 8/9/A), which it does after a re-join. */
    onIdentityRead(): void {}

    protected onOther(frame: ParsedFrame): void {
        this.log.debug(`Control4 ${this.name}: frame ${frame.text}`);
    }

    /** EP2 / EP196 attribute 0x0000 from the check-in (a level on some families). */
    onNetworkLevel(_value: number): void {}

    /** EP198 attributes (outlet profile). */
    onOutletAttributes(_attrs: Map<number, ZclValue>): void {}

    // -- reply capture (protocol probing) ---------------------------------------

    /** A probe of ours is waiting for the device's answer. */
    get capturing(): boolean {
        return this.ctx.now() <= this.captureUntil;
    }

    armCapture(ms = REPLY_CAPTURE_MS): void {
        this.captureUntil = Math.max(this.captureUntil, this.ctx.now() + ms);
    }

    private captureReply(frame: ParsedFrame): void {
        if (this.ctx.now() > this.captureUntil) return;
        const t = frame.tokens;
        const reply = {sequence: frame.seq, status: t[1], namespace: t[2], data: t.slice(3), raw_text: frame.text};
        this.log.warning(`Control4 REPLY ${this.name}: ${frame.text}`);
        this.publish({c4_reply: reply});
    }

    // -- control ----------------------------------------------------------------

    /** Handle one /set key. Returns the state to publish (optimistic), if any. */
    async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        // The ZHA LED cluster's debug passthroughs, by their old names.
        if (key === "send_raw") key = "c4_send";
        else if (key === "send_get") key = "c4_get";
        switch (key) {
            case "c4_send": {
                const {cmd, dstEp} = commandArg(value);
                const head = frameHead(value);
                this.armCapture();
                await this.sendText(`${head}${hex4(this.nextSeq())} ${cmd}`, dstEp, 1, sendAck(value) ? undefined : {ack: false});
                return undefined;
            }
            case "c4_raw": {
                // Probing: raw bytes on any Control4 profile, cluster and endpoints (a ZCL frame on
                // the network profile, say). Whatever the device sends back is logged while it waits.
                const raw = rawArg(value);
                this.armCapture();
                this.log.info(
                    `Control4 ${this.name} -> raw profile 0x${raw.profile.toString(16)} cluster ${raw.cluster} ep ${raw.srcEp}->${raw.dstEp}: ${raw.data.toString("hex")}`,
                );
                await this.sendFrame(
                    {profile: raw.profile, cluster: raw.cluster, srcEp: raw.srcEp, dstEp: raw.dstEp, data: raw.data},
                    raw.ack ? undefined : {ack: false},
                );
                return undefined;
            }
            case "c4_get": {
                const {cmd, dstEp} = commandArg(value);
                this.armCapture();
                await this.sendText(`0g${hex4(this.nextSeq())} ${cmd}`, dstEp);
                return undefined;
            }
            case "c4_identify":
                await this.ctx.sendIdentity(this, "manual");
                return undefined;
        }
        void meta;
        throw new UnsupportedKey(`'${key}' is not supported by ${this.model}`);
    }

    /** Handle a /get key (poll the device); default: nothing to read. */
    async getValue(_key: string): Promise<void> {}

    /**
     * The one-off state read to queue at startup, join and announce, for a
     * device whose state otherwise only comes from its own reports. Default: none.
     */
    stateReader(): (() => Promise<StateReadResult>) | undefined {
        return undefined;
    }

    /** The device announced itself (it re-joined or powered up, so its frame counter may have restarted). Default: nothing. */
    noteRejoined(): void {}

    /** State to publish once at startup (persisted settings). */
    initialState(): Payload {
        return {};
    }
}

function commandArg(value: unknown): {cmd: string; dstEp: number} {
    if (value && typeof value === "object") {
        const v = value as {cmd?: unknown; dst_ep?: unknown};
        return {cmd: String(v.cmd ?? "").trim(), dstEp: Number(v.dst_ep ?? 1) || 1};
    }
    return {cmd: String(value ?? "").trim(), dstEp: 1};
}

/**
 * `c4_send`'s frame head: `"type"` is the frame type letter ("s", a Set, the default; "i", an
 * interrupt), so `0<type><seq> <cmd>`. Any letter goes, for probing the frame types nobody has
 * tried, and so does a digit then a letter ("1g") in place of the leading 0.
 */
function frameHead(value: unknown): string {
    const type = value && typeof value === "object" ? (value as {type?: unknown}).type : undefined;
    if (type === undefined || type === null || type === "") return "0s";
    const t = String(type).trim();
    if (/^[a-z]$/.test(t)) return `0${t}`;
    if (/^[0-9][a-z]$/.test(t)) return t;
    throw new Error(`c4_send: unknown type '${type}' (a frame type letter, "s" or "i", or a digit then a letter)`);
}

/** `c4_raw`'s frame: {"profile", "cluster", "src_ep", "dst_ep", "data": hex, "ack"}; only the Control4 profiles. */
function rawArg(value: unknown): {profile: number; cluster: number; srcEp: number; dstEp: number; data: Buffer; ack: boolean} {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const num = (x: unknown, fallback: number) => {
        if (x === undefined || x === null || x === "") return fallback;
        const n = typeof x === "string" && /^0x/i.test(x) ? Number.parseInt(x, 16) : Number(x);
        if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`c4_raw: '${x}' is not a number`);
        return n;
    };
    const profile = num(v.profile, 0xc25d);
    if (![0xc25c, 0xc25d, 0xc25e].includes(profile)) throw new Error("c4_raw: only the Control4 profiles (0xc25c, 0xc25d, 0xc25e)");
    const hex = String(v.data ?? "").replace(/\s+/g, "");
    if (!/^([0-9a-fA-F]{2})+$/.test(hex)) throw new Error("c4_raw: data must be hex bytes");
    return {profile, cluster: num(v.cluster, 1), srcEp: num(v.src_ep, 2), dstEp: num(v.dst_ep, 2), data: Buffer.from(hex, "hex"), ack: sendAck(value)};
}

/** `c4_send`'s `"ack": false`: send without an APS acknowledgement (a command that may reboot the device). */
function sendAck(value: unknown): boolean {
    const ack = value && typeof value === "object" ? (value as {ack?: unknown}).ack : undefined;
    return ack === undefined || ack === null || toBool(ack);
}

export function toBool(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const s = String(value).trim().toLowerCase();
    return s === "on" || s === "true" || s === "1" || s === "yes";
}

export function toNumber(value: unknown, min: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`'${value}' is not a number`);
    return Math.max(min, Math.min(max, n));
}
