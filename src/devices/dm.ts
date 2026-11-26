/**
 * The c4.dm.* ("-Z") family and the dual outlet: C4-DIM1-Z, C4-FS1-Z,
 * LOZ-5S1-W (ports of control4_dim1z.py, control4_dim_config.py,
 * control4_fs1z.py, control4_outlet.py).
 */

import {
    AUTO_REBOOT_OPTION,
    clickGesture,
    COLD_START_LEVEL_KEY,
    COLD_START_TIME_KEY,
    DIM1Z_TV_PARAMS,
    DM_BUTTONS,
    type Gesture,
    OUTLET_BUTTONS,
    REBOOT_KEY,
} from "../core/constants";
import {LED_BRIGHTNESS_KEY, LedWriter, type LedSelect} from "../core/leds";
import {hex2, hex4, type ParsedFrame, parseHex, pctToBrightness, scaleHex, type ZclValue} from "../core/protocol";
import {PALETTE_HEX, type PaletteName} from "../core/constants";
import {type GetReply, isDeliveryFailure, type StateReadResult} from "../core/link";
import {AnimationKeys} from "./animkeys";
import {C4Device, type Payload, type SetMeta, toBool} from "./base";
import {FadeHold, LoadControl, OFF_TRANSITION_KEY, ON_TRANSITION_KEY, TvParams} from "./dimming";
import {DmxDevice} from "./dmx";
import {LED_CLUSTER_COMMANDS, LedKeys, ledClusterCommand} from "./ledkeys";

/** DIM1-Z paddle LEDs: top = btn 0, bottom = btn 1; on = load-on colour. */
export const DIM1Z_LEDS: LedSelect[] = [
    {key: "led_top_on_color", slots: [0], verb: "active"},
    {key: "led_top_off_color", slots: [0], verb: "idle"},
    {key: "led_bottom_on_color", slots: [1], verb: "active"},
    {key: "led_bottom_off_color", slots: [1], verb: "idle"},
];

/** The DIM1-Z's paddle LEDs by button name: Button 1 is the top, as its events name it. */
const DIM1Z_LED_NAMES: Record<string, number[]> = {top: [0], button_1: [0], bottom: [1], button_2: [1]};

const PADDLE_NS = /^c4\.dm\.b([0-9a-f]+)([cbe])$/;

abstract class DmDevice extends C4Device {
    protected fireDm(hex: string | undefined, gesture: Gesture): void {
        const id = parseHex(hex);
        if (id === undefined) return;
        this.emitAction(DM_BUTTONS[id] ?? `button_${id + 1}`, gesture, {action_button_id: id});
    }
}

// ---------------------------------------------------------------------------
// C4-DIM1-Z
// ---------------------------------------------------------------------------

/**
 * Quiet time after the last c4.dm.t0c (or after our own fade) before the
 * paddle LEDs are repainted. Nothing may reach the dimmer while it ramps: the
 * ZHA quirk never wrote during a fade, and LED writes / reads mid-ramp can
 * leave the load glowing. The DIM1-Z reports its level through a ramp, so a
 * second without a report means it has finished.
 */
const LED_REPAINT_SETTLE = 1_000;
/** Z2M asks /get for state, then brightness: one read answers both. */
const STATE_READ_REUSE = 2_000;
/** A /get waits out a fade at most this many times (a held paddle keeps extending it). */
const STATE_READ_RAMP_WAITS = 10;
/** A read this recent answers a queued one (Z2M's own read on reconnect may just have run). */
const STATE_READ_FRESH = 10_000;
/** Store flag: when the dimmer parameters were read from the device; cleared when it may have been reset. */
export const SETTINGS_READ_KEY = "settings_read";
/** The settings read waits this long after a start, so the dimmers' load reads go first. */
export const SETTINGS_READ_DELAY = 30_000;

export class Dim1z extends DmDevice {
    // A hold reports b<idx>b / b<idx>e with no paddle-down before it, so a
    // paddle-down is a tap the moment it arrives.
    protected override readonly hasHold = false;
    /** Until when the load may still be ramping (ms epoch): our fade + settle, or the last c4.dm.t0c + settle. */
    private rampUntil = 0;
    /** The DIM1-Z's mid-fade c4.dm.t0c reports; one that stops short has the real level read. */
    private readonly hold = new FadeHold(this, LED_REPAINT_SETTLE, {
        apply: (level) => this.applyLoad(level > 0, level),
        stoppedShort: () => void this.refreshLoad(),
    });
    readonly load = new LoadControl(this, {
        onMove: (s, level) => {
            // A turn-on from off holds the cold start level first: the fade ends that much later.
            const fadeSeconds = s + this.coldStartMs(level) / 1000;
            this.noteRamp(fadeSeconds * 1000 + LED_REPAINT_SETTLE);
            this.hold.begin(level, fadeSeconds);
        },
        onSent: (delivered) => {
            const ms = this.hold.sent(delivered);
            if (ms !== undefined) this.noteRamp(ms);
        },
        // Its `rtl` time is a full 0-100 % sweep (tested 2026-11-07 on Linen Closet).
        hardwareFade: "sweep",
        clampPct: (pct) => this.tv.clampPct(pct),
        liveLevel: () => this.hold.current(),
        fadeAllowed: (level) => this.coldStartMs(level) === 0,
    });
    private repaintTimer: NodeJS.Timeout | undefined;
    private repaintPending = false;
    /** Bumped by every level report and every fade of ours: a read that saw it change is stale. */
    private levelEpoch = 0;
    private lastStateRead = 0;
    private stateRead: Promise<StateReadResult> | undefined;
    readonly tv = new TvParams(this, DIM1Z_TV_PARAMS);
    readonly led: LedKeys;

    override get ledKeys(): LedKeys {
        return this.led;
    }
    readonly anim: AnimationKeys;

    constructor(...args: ConstructorParameters<typeof C4Device>) {
        super(...args);
        this.led = new LedKeys(this, new LedWriter(this, "dm"), DIM1Z_LEDS, new Map(), false);
        this.anim = new AnimationKeys(
            this,
            {
                idleHex: () => "000000",
                dmStored: (btn) => this.storedPair(btn),
                loadOn: () => {
                    const s = this.state().state;
                    return s === undefined ? undefined : String(s).toUpperCase() === "ON";
                },
                verifyDm: (matches, resend) => {
                    void this.ctx.link.scheduleVerify(this, "dm led paint", "c4.dm.is", matches, resend, 1500);
                },
                quietMs: () => Math.max(0, this.rampUntil - Date.now()),
                // Button 1 is the top paddle, as its events name it.
                ledsOf: (name) => DIM1Z_LED_NAMES[name],
            },
            [0, 1],
            "dm",
        );
    }

    private noteRamp(ms: number): void {
        this.levelEpoch++;
        this.rampUntil = Math.max(this.rampUntil, Date.now() + ms);
    }

    private get ramping(): boolean {
        return this.rampUntil > Date.now();
    }

    /** Wait for the load to stop ramping (a held paddle keeps extending it): false if it never does or the handler stops. */
    private async rampDone(): Promise<boolean> {
        for (let waits = 0; this.ramping; waits++) {
            if (waits >= STATE_READ_RAMP_WAITS || this.stopped) return false;
            await this.sleep(this.rampUntil - Date.now());
        }
        return !this.stopped;
    }

    /** The settings read's place in the state-read queue (the load read has the device's own). */
    private get settingsReadKey(): string {
        return `${this.ieee}:settings`;
    }

    override start(hotLoad = false): void {
        super.start(hotLoad);
        // After a hot-load too: a dimmer whose settings were never read has them read once.
        if (this.setting(SETTINGS_READ_KEY) === undefined) this.ctx.link.queueStateRead(this.settingsReadKey, () => this.readSettings(), SETTINGS_READ_DELAY);
    }

    override stop(): void {
        this.ctx.link.cancelStateRead(this.settingsReadKey);
        super.stop();
    }

    /**
     * Reboot the dimmer: `0i c4.dm.rb`, an interrupt frame (as a `0s` Set it answers e00).
     * Tested 2026-11-07: it sends no reply, its LEDs flash green then white, and it is back
     * in about 2 s with its load at the same level and every setting kept. It restarts on
     * receipt, often before its APS acknowledgement, and each APS retry then reboots it
     * again (three reboots in 3.5 s, seen by the sniffer): so the frame asks for no
     * acknowledgement and goes once. A delivery failure is no error.
     */
    async reboot(): Promise<void> {
        try {
            await this.sendText(`0i${hex4(this.nextSeq())} c4.dm.rb`, 1, 1, {ack: false});
        } catch (error) {
            // A frame that never went out (not queued, the transport stopped) is a real failure.
            const reason = (error as {reason?: string}).reason;
            if (!isDeliveryFailure(error) || reason === "unqueued" || reason === "stopped") throw error;
            this.log.debug(`Control4 ${this.name}: the reboot's delivery was not confirmed (it restarts on receipt): ${error}`);
        }
    }

    /** Whether the link may reboot it on its own: its auto_reboot option, on unless set off. */
    autoReboot(): boolean {
        const v = this.option(AUTO_REBOOT_OPTION);
        return v === undefined || v === null || v === "" || toBool(v);
    }

    /** A turn-on from off holds the cold start level this long before its own fade. */
    private coldStartMs(level: number): number {
        if (level <= 0 || String(this.state().state ?? "OFF").toUpperCase() === "ON") return 0;
        return this.tv.value(COLD_START_LEVEL_KEY) > 0 ? this.tv.value(COLD_START_TIME_KEY) : 0;
    }

    /** [load-on, load-off] colours stored for paddle LED `btn`, at LED brightness. */
    storedPair(btn: number): [string, string] {
        const pct = Number(this.setting<number>(LED_BRIGHTNESS_KEY, 100));
        const pos = btn === 0 ? "top" : "bottom";
        const hex = (k: string) => {
            const name = this.setting<string>(k);
            return scaleHex(name ? (PALETTE_HEX[name as PaletteName] ?? "000000") : "000000", pct);
        };
        return [hex(`led_${pos}_on_color`), hex(`led_${pos}_off_color`)];
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        if (ns === "c4.dm.t0c") {
            const pct = parseHex(data[0]);
            if (pct === undefined) return;
            this.noteRamp(LED_REPAINT_SETTLE);
            const level = this.hold.report(pctToBrightness(pct));
            if (level !== undefined) this.applyLoad(level > 0, level);
            return;
        }
        if (ns === "c4.dm.b0c" || ns === "c4.dm.b1c") {
            this.fireDm(ns[7], "press");
            return;
        }
        if (ns === "c4.dm.cc") {
            if (data.length >= 2) this.fireDm(data[0], clickGesture(data[1]));
            return;
        }
        // Hold begin / end (fw 03.22.41), sent whether or not the paddle drives the load.
        const m = PADDLE_NS.exec(ns);
        if (m && m[2] !== "c") {
            this.fireDm(m[1], m[2] === "b" ? "hold" : "hold_release");
            return;
        }
        super.onAnnounce(ns, data);
    }

    /** Publish the load's state, from a c4.dm.t0c report or a ZCL read. */
    private applyLoad(on: boolean, level: number | undefined): void {
        this.load.noteLevel(on ? (level ?? 0) : 0);
        const was = this.state().state;
        this.publish(on ? (level ? {state: "ON", brightness: level} : {state: "ON"}) : {state: "OFF"});
        // The paddle LEDs show the other stored slot now. If a status / animation of
        // ours is on them, repaint it - but only after the ramp has finished.
        if ((on ? "ON" : "OFF") !== was && this.anim.animator?.painting) this.repaintPending = true;
        if (this.repaintPending) {
            this.cancel(this.repaintTimer);
            this.repaintTimer = this.after(LED_REPAINT_SETTLE, () => {
                this.repaintPending = false;
                return this.anim.animator.applyStatus();
            });
        }
    }

    /**
     * Read genOnOff / genLevelCtrl on EP1 (the standard clusters ZHA read) and
     * publish what the dimmer reports. Never while the load fades: a read
     * mid-ramp can leave it glowing, and its own reports give the state then.
     */
    private async readLoad(): Promise<StateReadResult> {
        if (!(await this.rampDone())) return "skipped";
        const epoch = this.levelEpoch;
        const stale = () => this.stopped || this.levelEpoch !== epoch;
        let onOff: unknown;
        try {
            onOff = (await this.zclRead(1, "genOnOff", ["onOff"])).onOff;
        } catch (error) {
            this.log.debug(`Control4 ${this.name}: on/off read failed: ${error}`);
            return "failed";
        }
        if (stale()) return "skipped";
        let level: unknown;
        try {
            level = (await this.zclRead(1, "genLevelCtrl", ["currentLevel"])).currentLevel;
        } catch (error) {
            this.log.debug(`Control4 ${this.name}: level read failed: ${error}`);
        }
        // A report or a fade overtook the read: what it said is newer.
        if (stale()) return "skipped";
        if (typeof onOff !== "number" && typeof onOff !== "boolean") return "failed";
        this.lastStateRead = Date.now();
        const on = Boolean(onOff);
        const lvl = typeof level === "number" && level > 0 ? Math.min(254, Math.round(level)) : undefined;
        this.log.debug(`Control4 ${this.name}: read on_off=${Number(on)} level=${lvl ?? "-"}`);
        this.applyLoad(on, lvl);
        return "read";
    }

    /** One read at a time; a second caller shares the read in flight. */
    private refreshLoad(): Promise<StateReadResult> {
        this.stateRead ??= this.readLoad().finally(() => {
            this.stateRead = undefined;
        });
        return this.stateRead;
    }

    override async getValue(key: string): Promise<void> {
        if (key !== "state" && key !== "brightness") return;
        if (Date.now() - this.lastStateRead < STATE_READ_REUSE) return;
        await this.refreshLoad();
    }

    override stateReader(): () => Promise<StateReadResult> {
        const epoch = this.levelEpoch;
        return async () => {
            // A report or a fade since this was queued: the state is known, or its reports are coming.
            if (this.stopped || this.levelEpoch !== epoch || this.ramping) return "skipped";
            if (Date.now() - this.lastStateRead < STATE_READ_FRESH) return "skipped";
            return this.refreshLoad();
        };
    }

    /** A Get once the load has stopped ramping: its reply, or undefined (no answer, or it never stopped). */
    private async quietGet(prop: string): Promise<GetReply | undefined> {
        if (!(await this.rampDone())) return undefined;
        return this.get(prop);
    }

    /**
     * Read the dimmer parameters the device holds, so its entities show what it
     * does, not a default or a write it lost: once, and again after it may have
     * been reset (it left the network, or came from another instance).
     * c4.dm.is carries default-on, both fades and the paddle flag; the others are
     * single c4.dm.tv slots. All or nothing: an unanswered Get keeps nothing. One
     * the dimmer answers with an error (a variant without it) is left as shown.
     */
    private async readSettings(): Promise<StateReadResult> {
        if (this.stopped || this.setting(SETTINGS_READ_KEY) !== undefined) return "skipped";
        // Level, default-on %, on fade ms, off fade ms, four colours, flags (bit 1: the paddle drives the load).
        const isReply = await this.quietGet("c4.dm.is");
        if (!isReply) return "failed";
        const is = isReply.status === "000" ? isReply.values : [];
        const percent = (hex: string | undefined) => {
            const n = parseHex(hex);
            return n !== undefined && n <= 100 ? n : undefined;
        };
        const seconds = (hex: string | undefined) => {
            const ms = parseHex(hex);
            return ms === undefined ? undefined : Math.round(ms / 100) / 10;
        };
        const read: Payload = {};
        const put = (key: string, value: unknown) => {
            if (value !== undefined) read[key] = value;
        };
        if (is.length >= 9) {
            put("default_on_brightness", percent(is[1]));
            put(ON_TRANSITION_KEY, seconds(is[2]));
            put(OFF_TRANSITION_KEY, seconds(is[3]));
            const flags = parseHex(is[8]);
            if (flags !== undefined) put("paddle_local_control", flags & 0x02 ? "ON" : "OFF");
        }
        for (const p of DIM1Z_TV_PARAMS) {
            if (p.key in read) continue;
            const reply = await this.quietGet(`c4.dm.tv 00 ${hex2(p.index)}`);
            if (!reply) return "failed";
            if (reply.status !== "000") continue;
            const value = reply.values[reply.values.length - 1];
            put(p.key, p.kind === "percent" ? percent(value) : parseHex(value));
        }
        if (this.stopped) return "skipped";
        const shown = this.initialState();
        const changed = Object.keys(read).filter((k) => shown[k] !== read[k]);
        for (const [key, value] of Object.entries(read)) {
            if (key === "paddle_local_control") this.saveSetting("ba", value === "ON" ? 1 : 0);
            else this.saveSetting(key, value);
        }
        this.saveSetting(SETTINGS_READ_KEY, Date.now());
        this.publish(read);
        if (changed.length) this.log.info(`Control4 ${this.name}: settings read from the device: ${changed.map((k) => `${k} ${shown[k]} -> ${read[k]}`).join(", ")}`);
        else this.log.debug(`Control4 ${this.name}: settings read from the device, as shown`);
        return "read";
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === "state" || key === "brightness" || key === "transition") return this.load.set(meta, true);
        if (key === ON_TRANSITION_KEY || key === OFF_TRANSITION_KEY) return this.load.setTransition(key, value);
        if (key === "set_ramp_rate") return this.load.setRampRate(value);
        if (key === "set_on_ramp" || key === "set_off_ramp" || key === "set_on_off_ramps") return this.load.rampCommand(key, value);
        // ZHA gives the DIM1-Z the LED cluster too; it answers n01 to c4.dmx.led, kept for script parity.
        if (key in LED_CLUSTER_COMMANDS) return ledClusterCommand(this, key, value);
        if (this.tv.find(key)) return this.tv.set(key, value);
        if (key === REBOOT_KEY) {
            this.log.info(`Control4 ${this.name}: rebooting it from its Reboot button (c4.dm.rb) - back in about 2 s, its light and settings as they are`);
            await this.reboot();
            this.ctx.link.noteRebooted(this.ieee);
            return undefined;
        }
        if (key === "paddle_local_control") {
            // The first argument is the value; send exactly one (c4.dm.ba 00 01 writes 0).
            const on = toBool(value);
            await this.set(`c4.dm.ba ${on ? "01" : "00"}`);
            this.saveSetting("ba", on ? 1 : 0);
            return {paddle_local_control: on ? "ON" : "OFF"};
        }
        if (this.led.handles(key)) return this.led.set(key, value);
        if (this.anim.handles(key)) return this.anim.set(key, value);
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        const ba = this.setting<number>("ba", 1);
        return {
            ...this.led.initialState(),
            ...this.tv.initialState(),
            ...this.anim.initialState(),
            [ON_TRANSITION_KEY]: this.load.onTransition(),
            [OFF_TRANSITION_KEY]: this.load.offTransition(),
            paddle_local_control: ba ? "ON" : "OFF",
        };
    }
}

// ---------------------------------------------------------------------------
// C4-FS1-Z fireplace switch
// ---------------------------------------------------------------------------

const FS1_CONFIRM_TIMEOUT = 6_000;
const FS1_STATE_PROPS = new Set(["c4.dm.t0c", "c4.dm.ls"]);

export class Fs1z extends DmDevice {
    // Assumed to report as the DIM1-Z does, its generation (no FS1-Z capture yet, #51):
    // b<idx>c once per physical press, and a hold as b<idx>b / b<idx>e with no b<idx>c
    // before it. So a paddle-down is a tap the moment it arrives.
    protected override readonly hasHold = false;
    readonly load = new LoadControl(this, {fixedOnLevel: 254, minOnTransition: 0.8, minOffTransition: 2.0});
    private lastReport: {on: boolean; at: number} | undefined;

    private report(on: boolean): void {
        this.lastReport = {on, at: this.ctx.now()};
        this.publish({state: on ? "ON" : "OFF"});
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        if (ns === "c4.dm.t0c") {
            const pct = parseHex(data[0]);
            if (pct !== undefined) this.report(pct > 0);
            return;
        }
        if (ns === "c4.dm.cc") {
            if (data.length >= 2) this.fireDm(data[0], clickGesture(data[1]));
            return;
        }
        const m = PADDLE_NS.exec(ns);
        if (m) {
            // Paddle-down (one per physical press), hold begin, hold end.
            this.fireDm(m[1], m[2] === "c" ? "press" : m[2] === "b" ? "hold" : "hold_release");
            return;
        }
        super.onAnnounce(ns, data);
    }

    protected override onReply(frame: ParsedFrame): void {
        const t = frame.tokens;
        if (t.length > 3 && t[1] === "000" && FS1_STATE_PROPS.has(t[2])) {
            const pct = parseHex(t[3]);
            if (pct !== undefined) this.report(pct > 0);
        }
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === "state") {
            const sentAt = this.ctx.now();
            const result = await this.load.set(meta, false);
            // Hold the state to what the hardware confirms: a dropped command
            // must not leave Z2M claiming the fireplace is on while it is cold.
            this.after(FS1_CONFIRM_TIMEOUT, () => {
                const r = this.lastReport;
                if (!r || r.at >= sentAt) return;
                this.log.warning(`Control4 ${this.name}: no c4.dm.t0c confirmation within ${FS1_CONFIRM_TIMEOUT / 1000}s - reverting to the last reported state`);
                this.publish({state: r.on ? "ON" : "OFF"});
            });
            return result;
        }
        return super.setValue(key, value, meta);
    }
}

// ---------------------------------------------------------------------------
// LOZ-5S1-W dual switched outlet
// ---------------------------------------------------------------------------

export const OUTLET_ENDPOINTS: Record<string, number> = {l1: 0, l2: 1};

export class Outlet extends DmxDevice {
    protected readonly buttons = OUTLET_BUTTONS;

    private publishOutlet(idx: number, on: boolean): void {
        if (idx === 0 || idx === 1) this.publish({[`state_l${idx + 1}`]: on ? "ON" : "OFF"});
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        if (ns === "c4.dm.tc") {
            const idx = parseHex(data[0]);
            const level = parseHex(data[1]);
            if (idx !== undefined && level !== undefined) this.publishOutlet(idx, level > 0);
            return;
        }
        super.onAnnounce(ns, data);
    }

    protected override syncClick(id: number, count: number): void {
        this.publishOutlet(id, count === 1);
    }

    override onNetworkLevel(value: number): void {
        this.publishOutlet(0, value > 0);
    }

    override onOutletAttributes(attrs: Map<number, ZclValue>): void {
        const v = attrs.get(0x0000);
        if (typeof v === "number") this.publishOutlet(0, v > 0);
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === "state") {
            const ep = meta.endpoint ?? "l1";
            const idx = OUTLET_ENDPOINTS[ep];
            if (idx === undefined) throw new Error(`unknown outlet '${ep}'`);
            let s = String(value).toUpperCase();
            if (s === "TOGGLE") s = String(this.state()[`state_${ep}`] ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
            const on = s === "ON";
            await this.ctx.link.sendWithRecovery(this.ieee, () => this.set(`c4.dm.tv ${hex2(idx)} 00 ${on ? "64" : "00"}`), "outlet command");
            return {state: on ? "ON" : "OFF"};
        }
        return super.setValue(key, value, meta);
    }

    override async getValue(key: string): Promise<void> {
        if (key.startsWith("state")) {
            for (const idx of [0, 1]) await this.sendText(`0g${hex4(this.nextSeq())} c4.dm.tv ${hex2(idx)} 00`);
        }
    }
}