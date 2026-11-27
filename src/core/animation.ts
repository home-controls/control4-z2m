/**
 * LED animation / notification / status engine (port of c4_led_animation.py).
 *
 * Control4 keypads have no on-device animation: every frame is host-driven,
 * so traffic discipline is the whole design:
 *   1. one global TX pump drains every LED frame at ~22 frames/s, bounded and
 *      dropping on overflow (an animation loses frames, the mesh does not);
 *   2. per-button diffing - only changed buttons are sent;
 *   3. at most MAX_ACTIVE_ANIMATIONS overlays at once, step floors enforced.
 *
 * Two layers per device: a persistent status layer (a colour, optionally a
 * slow effect, per button) and a preemptible overlay (notification) with a
 * priority. When the overlay ends the status layer is restored.
 */

import {type LedMode, PALETTE_HEX, PALETTE_NAMES} from "./constants";
import {DM_LED_THROTTLE} from "./leds";
import type {Logger} from "./log";
import {blendRgb, hex2, hexRgb, hueRgb, type Rgb, rgbHex, scaleRgb} from "./protocol";

export const TX_INTERVAL = 45;
export const TX_QUEUE_MAX = 32;
/** Most frames one device may hold in the queue (a dead device cannot fill it). */
export const TX_TARGET_MAX = 16;
export const MAX_ACTIVE_ANIMATIONS = 8;
export const MIN_INTERVAL = 150;
export const MIN_BASE_INTERVAL = 750;
export const DM_STEP_PER_LED = DM_LED_THROTTLE + 50;
export const DM_VERIFY_SETTLE = 1500;
export const DEFAULT_SOLID_DURATION = 3000;
export const PULSE_GAMMA = 2.2;
/**
 * After a status frame that did not go out, or a DIM1-Z paint its read-back did not
 * confirm: when the status is painted again, by the extension itself (plus up to 20 %),
 * so a lost frame is not left for Home Assistant's next led_status or LED re-check.
 * Each led_status (or refresh) starts these tries afresh; a device listed unreachable
 * gets none (a send to it costs the mesh a route discovery), and is repainted when it
 * announces or at the next led_status.
 */
export const LED_HEAL_DELAYS = [30_000, 120_000, 600_000];

export const PALETTE_RGB: Record<string, Rgb> = {black: [0, 0, 0]};
for (const name of PALETTE_NAMES) PALETTE_RGB[name] = hexRgb(PALETTE_HEX[name]);

export const STATUS_COLOURS: Record<string, string> = {
    ok: "green",
    on: "amber",
    off: "off",
    idle: "off",
    info: "blue",
    warning: "amber",
    alert: "red",
    error: "red",
    unavailable: "red",
    unknown: "purple",
};

export function parseColour(value: unknown, fallback: Rgb = [0, 0, 0]): Rgb {
    if (value === undefined || value === null) return fallback;
    if (Array.isArray(value)) {
        if (value.length !== 3) throw new Error(`colour ${JSON.stringify(value)} needs exactly 3 components`);
        return value.map((c) => Math.max(0, Math.min(255, Math.trunc(Number(c))))) as Rgb;
    }
    if (typeof value === "boolean") throw new Error(`colour ${value} is not a colour`);
    if (typeof value === "number") {
        const name = PALETTE_NAMES[value];
        return name ? PALETTE_RGB[name] : fallback;
    }
    const text = String(value)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (!text) return fallback;
    if (text in PALETTE_RGB) return PALETTE_RGB[text];
    if (text in STATUS_COLOURS) return PALETTE_RGB[STATUS_COLOURS[text]];
    let hex = text.startsWith("#") ? text.slice(1) : text;
    if (/^[0-9a-f]{3}$/.test(hex)) hex = [...hex].map((c) => c + c).join("");
    if (/^[0-9a-f]{6}$/.test(hex)) return hexRgb(hex);
    throw new Error(`unrecognised colour '${value}'`);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface EffectSpec {
    effect: string;
    buttons: number[];
    colour: Rgb;
    colour2: Rgb;
    /** ms per step */
    interval: number;
    /** cycles; 0 = until stopped or duration */
    count: number;
    /** ms; undefined = unlimited */
    duration?: number;
    brightness: number;
    priority: number;
    restore: boolean;
}

export function resolveSpec(spec: EffectSpec): EffectSpec {
    return {
        ...spec,
        buttons: [...spec.buttons],
        colour: scaleRgb(spec.colour, spec.brightness),
        colour2: scaleRgb(spec.colour2, spec.brightness),
        interval: Math.max(MIN_INTERVAL, spec.interval),
        count: Math.max(0, Math.trunc(spec.count)),
        duration: spec.duration === undefined ? undefined : Math.max(100, spec.duration),
    };
}

type Frame = Map<number, Rgb | "stored">;

function frame(buttons: number[], pick: (b: number, i: number) => Rgb): Frame {
    const f: Frame = new Map();
    buttons.forEach((b, i) => {
        f.set(b, pick(b, i));
    });
    return f;
}

function* solid(s: EffectSpec) {
    yield frame(s.buttons, () => s.colour);
}
function* blink(s: EffectSpec) {
    yield frame(s.buttons, () => s.colour);
    yield frame(s.buttons, () => s.colour2);
}
function* pulse(s: EffectSpec) {
    const steps = 8;
    const seq = [...Array(steps).keys(), ...Array.from({length: steps}, (_, k) => steps - k)];
    for (const i of seq) {
        const c = blendRgb(s.colour2, s.colour, (i / steps) ** PULSE_GAMMA);
        yield frame(s.buttons, () => c);
    }
}
function* chase(s: EffectSpec) {
    for (const lit of s.buttons) yield frame(s.buttons, (b) => (b === lit ? s.colour : s.colour2));
}
function* bounce(s: EffectSpec) {
    const order = [...s.buttons, ...s.buttons.slice(1, -1).reverse()];
    for (const lit of order) yield frame(s.buttons, (b) => (b === lit ? s.colour : s.colour2));
}
function* fill(s: EffectSpec) {
    for (let i = 0; i <= s.buttons.length; i++) {
        const lit = new Set(s.buttons.slice(0, i));
        yield frame(s.buttons, (b) => (lit.has(b) ? s.colour : s.colour2));
    }
    for (let i = s.buttons.length; i >= 0; i--) {
        const lit = new Set(s.buttons.slice(0, i));
        yield frame(s.buttons, (b) => (lit.has(b) ? s.colour : s.colour2));
    }
}
function* alternate(s: EffectSpec) {
    for (const phase of [0, 1]) yield frame(s.buttons, (_b, i) => (i % 2 === phase ? s.colour : s.colour2));
}
function* rainbow(s: EffectSpec) {
    const steps = 12;
    const n = Math.max(1, s.buttons.length);
    for (let st = 0; st < steps; st++) yield frame(s.buttons, (_b, i) => hueRgb(i / n + st / steps, s.brightness));
}
function* strobe(s: EffectSpec) {
    for (let k = 0; k < 2; k++) {
        yield frame(s.buttons, () => s.colour);
        yield frame(s.buttons, () => s.colour2);
    }
    yield frame(s.buttons, () => s.colour2);
    yield frame(s.buttons, () => s.colour2);
}

export const EFFECTS: Record<string, (s: EffectSpec) => Generator<Frame>> = {
    solid,
    blink,
    pulse,
    breathe: pulse,
    chase,
    bounce,
    fill,
    alternate,
    rainbow,
    strobe,
};

export const EFFECT_DEFAULT_INTERVAL: Record<string, number> = {
    solid: DEFAULT_SOLID_DURATION,
    blink: 400,
    pulse: 120,
    breathe: 120,
    chase: 180,
    bounce: 180,
    fill: 150,
    alternate: 400,
    rainbow: 200,
    strobe: 120,
};

// ---------------------------------------------------------------------------
// TX pump
// ---------------------------------------------------------------------------

export interface TxTarget {
    set(cmd: string): Promise<void>;
    /** false once the device's handler is gone: its queued frames are dropped. */
    readonly alive?: boolean;
}

interface QueueItem {
    target: TxTarget;
    cmd: string;
    done?: (ok: boolean) => void;
}

const sleep = (ms: number) =>
    new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        (t as NodeJS.Timeout).unref?.();
    });

/**
 * The LED transmit pump: one frame started every TX_INTERVAL across all
 * devices, at most one in flight per device (in order), so a device that has
 * stopped acknowledging holds up only its own frames.
 */
export class TxPump {
    private queue: QueueItem[] = [];
    private busy = new Set<TxTarget>();
    private running = false;
    private stopped = false;
    sent = 0;
    dropped = 0;
    failed = 0;

    constructor(private readonly log: Logger) {}

    private queuedFor(target: TxTarget): number {
        let n = 0;
        for (const item of this.queue) if (item.target === target) n++;
        return n;
    }

    private full(target: TxTarget): boolean {
        return this.queue.length >= TX_QUEUE_MAX || this.queuedFor(target) >= TX_TARGET_MAX;
    }

    /** Queue one frame; false when dropped (queue full). `done` hears whether a queued frame went out. */
    submit(target: TxTarget, cmd: string, done?: (ok: boolean) => void): boolean {
        if (this.stopped || target.alive === false || this.full(target)) {
            this.dropped++;
            if (this.dropped % 50 === 1) this.log.debug(`Control4 LED: TX queue full - ${this.dropped} frames dropped so far`);
            return false;
        }
        this.queue.push({target, cmd, done});
        this.kick();
        return true;
    }

    /** Queue a frame and wait until it has gone out (waits for room, never drops). */
    async send(target: TxTarget, cmd: string): Promise<boolean> {
        while (this.full(target) && !this.stopped && target.alive !== false) await sleep(TX_INTERVAL);
        if (this.stopped || target.alive === false) return false;
        return new Promise<boolean>((resolve) => {
            this.queue.push({target, cmd, done: resolve});
            this.kick();
        });
    }

    private kick(): void {
        if (this.running || this.stopped) return;
        this.running = true;
        void this.drain();
    }

    private async drain(): Promise<void> {
        while (!this.stopped) {
            const idx = this.queue.findIndex((i) => !this.busy.has(i.target));
            if (idx < 0) break; // everything queued waits on a device already in flight
            const item = this.queue.splice(idx, 1)[0];
            if (item.target.alive === false) {
                item.done?.(false);
                continue;
            }
            this.busy.add(item.target);
            void item.target.set(item.cmd).then(
                () => this.finish(item, true),
                (error: unknown) => {
                    this.log.debug(`Control4 LED: frame '${item.cmd}' failed: ${error}`);
                    this.finish(item, false);
                },
            );
            await sleep(TX_INTERVAL);
        }
        this.running = false;
    }

    private finish(item: QueueItem, ok: boolean): void {
        if (ok) this.sent++;
        else this.failed++;
        this.busy.delete(item.target);
        item.done?.(ok);
        if (this.queue.length) this.kick();
    }

    stop(): void {
        this.stopped = true;
        for (const item of this.queue) item.done?.(false);
        this.queue = [];
    }

    stats() {
        return {sent: this.sent, dropped: this.dropped, failed: this.failed, queued: this.queue.length, in_flight: this.busy.size};
    }
}

// ---------------------------------------------------------------------------
// Animator
// ---------------------------------------------------------------------------

export interface AnimatorHost extends TxTarget {
    readonly ieee: string;
    readonly name: string;
    readonly alive: boolean;
    /** kp / dmx: the configured idle colour of a button, already brightness-scaled. */
    idleHex(btn: number): string;
    /** dm: [load-on, load-off] colours stored for a paddle LED, brightness-scaled. */
    dmStored(btn: number): [string, string];
    /** dm: is the load on? (undefined = unknown, paint both slots) */
    loadOn(): boolean | undefined;
    onNotifying(active: boolean): void;
    /** dm: read c4.dm.is back once a paint settles and rewrite lost slots. */
    verifyDm(matches: (values: string[]) => boolean, resend: () => Promise<void>): void;
    /** dm: ms until the load stops ramping; status paints wait until then (nothing may reach a fading dimmer). */
    quietMs?(): number;
    /** The LEDs (of `buttons`) a button name covers (`button_3`, a paddle's `top`); undefined: the device has no such button. */
    ledsOf?(name: string): number[] | undefined;
    /** dmx: an LED slot's mode (undefined: not known yet, painted as push/release). */
    ledMode?(btn: number): LedMode | undefined;
    /** dmx: a follow-load LED was borrowed for a status colour (switched to programmed), or given back. */
    onBorrow?(btn: number, borrowed: boolean): void;
    /** The link lists the device unreachable (keepalives unanswered): a lost status frame waits for it to come back. */
    unreachable?(): boolean;
}

interface Run {
    cancelled: boolean;
}

export class Animator {
    private status = new Map<number, Rgb>();
    /**
     * Buttons a status, a clear or an effect has named since this start. The status
     * layer leaves every other LED alone: it keeps what the device last showed, so
     * a start does not repaint LEDs the next led_status call puts back.
     */
    private painted = new Set<number>();
    /** kp / dmx: the colour a status button shows while pressed (else the status colour). */
    private pressed = new Map<number, Rgb>();
    private deferTimer: NodeJS.Timeout | undefined;
    private deferForce = false;
    private statusEffect: EffectSpec | undefined;
    private statusRun: Run | undefined;
    private overlay: Run | undefined;
    private overlayPriority = -1;
    private overlayButtons: number[] = [];
    private lastSent = new Map<number, string>();
    /** dmx: follow-load LEDs switched to programmed mode for a status colour, to give back when it clears. */
    private borrowed = new Set<number>();
    private dmWant = new Map<number, [string, string] | undefined>();
    private dmShown = new Map<number, [string | undefined, string | undefined]>();
    private dmPainting = false;
    private dmAttach = true;
    private dmLost: [number, number, string][] = [];
    /**
     * dm: bumped by every slot written. A read-back follows a paint only while the
     * latest writes are unconfirmed (dmConfirmed behind dmWrites), so a paint that
     * changes nothing costs no Zigbee read, and one whose read-back got no answer is
     * checked again at the next paint.
     */
    private dmWrites = 0;
    private dmConfirmed = 0;
    /** The next self-repaint of the status (LED_HEAL_DELAYS), while one is due. */
    private healTimer: NodeJS.Timeout | undefined;
    /** Self-repaints since the last led_status or refresh. */
    private healTries = 0;
    /** A status frame did not go out since the last self-repaint. */
    private healLost = false;

    constructor(
        public host: AnimatorHost,
        public buttons: number[],
        public protocol: "kp" | "dmx" | "dm",
        private readonly engine: AnimationEngine,
    ) {}

    get animating(): boolean {
        return this.overlay !== undefined;
    }

    /** A status colour / effect or an animation is on the LEDs (else the device shows its own stored colours). */
    get painting(): boolean {
        return this.status.size > 0 || this.statusEffect !== undefined || this.animating;
    }

    state() {
        return {
            ieee: this.host.ieee,
            buttons: [...this.buttons],
            protocol: this.protocol,
            animating: this.animating,
            priority: this.animating ? this.overlayPriority : null,
            status: Object.fromEntries([...this.status].sort((a, b) => a[0] - b[0]).map(([b, c]) => [b, rgbHex(c)])),
            status_pressed: Object.fromEntries([...this.pressed].sort((a, b) => a[0] - b[0]).map(([b, c]) => [b, rgbHex(c)])),
            status_effect: this.statusEffect?.effect ?? null,
        };
    }

    /**
     * 1-based LED numbers (as printed), button names (`button_3`, a paddle's `top`),
     * "all", "1,3", "button_1,4" or [1, 3] -> device ids.
     */
    resolveButtons(buttons?: unknown): number[] {
        if (buttons === undefined || buttons === null) return [...this.buttons];
        const list = Array.isArray(buttons) ? buttons : [buttons];
        if (list.length === 0) return [...this.buttons];
        const tokens = list.flatMap((raw) => String(raw).replace(/,/g, " ").split(/\s+/)).filter(Boolean);
        const out = new Set<number>();
        for (const t of tokens.map((x) => x.trim().toLowerCase())) {
            if (t === "all" || t === "*") return [...this.buttons];
            if (/^\d+$/.test(t)) {
                const n = Number(t);
                if (n >= 1 && n <= this.buttons.length) out.add(this.buttons[n - 1]);
                else this.engine.log.warning(`Control4 LED [${this.host.name}]: button ${t} out of range (1-${this.buttons.length})`);
                continue;
            }
            const leds = this.host.ledsOf?.(t);
            if (leds) for (const b of leds) out.add(b);
            else this.engine.log.warning(`Control4 LED [${this.host.name}]: no button '${t}'`);
        }
        return this.buttons.filter((b) => out.has(b));
    }

    // -- transmission -------------------------------------------------------

    /**
     * `pressed`: per-button pressed colours (kp / dmx); a button without one shows its colour pressed too.
     * `heal`: a status paint - a frame of it that does not go out is painted again by itself
     * (LED_HEAL_DELAYS). An animation's frames drop by design and are not.
     */
    private emit(colours: Frame, force = false, pressed?: Map<number, Rgb>, heal = false): void {
        if (this.protocol === "dm") {
            this.dmEmit(colours, force);
            return;
        }
        for (const [btn, val] of colours) {
            if (val === "stored") {
                if (this.protocol === "dmx") this.giveBack(btn, force, heal);
                continue;
            }
            const hex = rgbHex(val);
            const press = pressed?.get(btn);
            const pressHex = press ? rgbHex(press) : hex;
            const key = pressHex === hex ? hex : `${hex}/${pressHex}`;
            if (!force && this.lastSent.get(btn) === key) continue;
            // A frame that does not go out is forgotten, so the next paint of this LED
            // (a self-repaint, or an LED re-check finding nothing new) sends it again.
            const lost = (ok: boolean) => {
                if (ok || this.lastSent.get(btn) !== key) return;
                this.lastSent.delete(btn);
                if (heal) this.noteLost();
            };
            let queued: boolean;
            if (this.protocol === "dmx" && this.dmxMode(btn) !== "push_release") {
                this.paintProgrammed(btn, hex, force, heal);
                continue;
            }
            // Both frames of the pair, or the LED counts as not sent: a second frame dropped
            // from a full queue left the first counted as everything.
            if (this.protocol === "dmx") {
                queued =
                    this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 03 ${pressHex}`, lost) &&
                    this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 04 ${hex}`, lost);
            } else {
                queued = this.engine.tx.submit(this.host, `c4.kp.lv ${hex2(btn)} ${hex}`, lost);
                if (press && queued) queued = this.engine.tx.submit(this.host, `c4.kp.lo ${hex2(btn)} ${pressHex}`, lost);
            }
            if (queued) this.lastSent.set(btn, key);
            else if (heal) this.noteLost();
        }
    }

    /**
     * dmx, a slot not in push/release mode: one frame per colour. A programmed LED shows
     * its param 05; a follow-load one is switched to programmed first, so the colour
     * stays through load changes (tested 2026-11-07), and given back when it clears.
     * There is no pressed colour in programmed mode.
     */
    private paintProgrammed(btn: number, hex: string, force: boolean, heal = false): void {
        const key = `p:${hex}`;
        if (!force && this.lastSent.get(btn) === key) return;
        const lost = (ok: boolean) => {
            if (ok || this.lastSent.get(btn) !== key) return;
            this.lastSent.delete(btn);
            if (heal) this.noteLost();
        };
        // Only a slot known to follow the load is borrowed: one whose mode isn't known yet
        // (before the settings read) keeps it, and gets the colour as param 05 alone.
        if (this.dmxMode(btn) === "follow_load" && !this.borrowed.has(btn)) {
            const borrowLost = (ok: boolean) => {
                if (ok || !this.borrowed.has(btn)) return;
                this.borrowed.delete(btn);
                this.host.onBorrow?.(btn, false);
                this.lastSent.delete(btn);
                if (heal) this.noteLost();
            };
            if (!this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 01 00`, borrowLost)) {
                if (heal) this.noteLost();
                return;
            }
            this.borrowed.add(btn);
            this.host.onBorrow?.(btn, true);
        }
        if (this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 05 ${hex}`, lost)) this.lastSent.set(btn, key);
        else if (heal) this.noteLost();
    }

    /** dmx: a slot's LED mode; undefined while not known (a host that names no modes: push/release). */
    private dmxMode(btn: number): LedMode | undefined {
        return this.host.ledMode ? this.host.ledMode(btn) : "push_release";
    }

    /**
     * dmx: give a borrowed follow-load LED back. Its mode goes back to follow load, and
     * its param 05 to the colour that shows for the load now (on a follow-load slot 05
     * is the colour on show), whether or not the mode change repaints it.
     */
    private giveBack(btn: number, force: boolean, heal = false): void {
        if (!this.borrowed.has(btn)) return;
        if (!force && this.lastSent.get(btn) === "stored") return;
        // A lost frame leaves it borrowed (and saved so), so the next clear, refresh or self-repaint tries again.
        const lost = (ok: boolean) => {
            if (ok || this.borrowed.has(btn)) return;
            this.borrowed.add(btn);
            this.host.onBorrow?.(btn, true);
            if (this.lastSent.get(btn) === "stored") this.lastSent.delete(btn);
            if (heal) this.noteLost();
        };
        if (!this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 01 01`, lost)) {
            if (heal) this.noteLost();
            return;
        }
        this.engine.tx.submit(this.host, `c4.dmx.led ${hex2(btn)} 05 ${this.host.idleHex(btn)}`);
        this.borrowed.delete(btn);
        this.host.onBorrow?.(btn, false);
        this.lastSent.set(btn, "stored");
    }

    /**
     * dmx: slots a status colour had borrowed before a restart (saved by the host). They
     * keep showing that colour, as every LED keeps what it shows over a start, and are
     * given back at the next clear.
     */
    seedBorrowed(slots: number[]): void {
        for (const s of slots) if (this.buttons.includes(s)) this.borrowed.add(s);
    }

    /** dmx: the slot's mode was set from outside: it is no longer borrowed, and its next paint goes out. */
    forgetBorrowed(btn: number): void {
        this.borrowed.delete(btn);
        this.lastSent.delete(btn);
    }

    /** The status pressed colours, minus the buttons an effect frame is drawing. */
    private pressedOutside(f: Frame): Map<number, Rgb> {
        const p = new Map(this.pressed);
        for (const b of f.keys()) p.delete(b);
        return p;
    }

    // -- dm painter (C4-DIM1-Z) --------------------------------------------

    private dmEmit(colours: Frame, force: boolean): void {
        for (const [btn, val] of colours) {
            if (val === "stored") this.dmWant.set(btn, undefined);
            else {
                const hex = rgbHex(val);
                this.dmWant.set(btn, [hex, hex]);
            }
        }
        if (force) {
            this.dmShown.clear();
            this.dmAttach = true;
        }
        if (!this.dmPainting) {
            this.dmPainting = true;
            void this.dmPaint().finally(() => {
                this.dmPainting = false;
            });
        }
    }

    private dmTarget(btn: number): [string, string] {
        return this.dmWant.get(btn) ?? this.host.dmStored(btn);
    }

    private dmVisible(): number[] {
        const on = this.host.loadOn();
        if (on === undefined) return [0, 1];
        return on ? [0] : [1];
    }

    private async dmSend(cmd: string): Promise<void> {
        await this.engine.tx.send(this.host, cmd);
        await sleep(DM_LED_THROTTLE);
    }

    private shown(btn: number): [string | undefined, string | undefined] {
        let s = this.dmShown.get(btn);
        if (!s) {
            s = [undefined, undefined];
            this.dmShown.set(btn, s);
        }
        return s;
    }

    private async dmPaint(): Promise<void> {
        try {
            for (;;) {
                if (!this.host.alive) return;
                const vis = this.dmVisible();
                const todo: [number, number, string][] = [];
                for (const b of this.dmWant.keys()) {
                    for (const i of vis) {
                        const t = this.dmTarget(b)[i];
                        if (this.shown(b)[i] !== t) todo.push([b, i, t]);
                    }
                }
                if (todo.length) {
                    for (const [b, i, hex] of todo) {
                        await this.dmSend(`c4.dm.l${b}${i === 0 ? "o" : "f"} ${hex}`);
                        this.shown(b)[i] = hex;
                        this.dmWrites++;
                    }
                    if (this.dmAttach) {
                        this.dmAttach = false;
                        await this.dmSend("c4.dm.lm 01");
                    }
                    continue;
                }
                const hidden: [number, number, string][] = [];
                for (const b of this.dmWant.keys()) {
                    for (const i of [0, 1]) {
                        if (vis.includes(i)) continue;
                        const t = this.dmTarget(b)[i];
                        if (this.shown(b)[i] !== t) hidden.push([b, i, t]);
                    }
                }
                if (!hidden.length) {
                    if (this.dmConfirmed !== this.dmWrites) this.dmScheduleVerify();
                    return;
                }
                for (const [b, i, hex] of hidden) {
                    await this.dmSend(`c4.dm.l${b}${i === 0 ? "o" : "f"} ${hex}`);
                    this.shown(b)[i] = hex;
                    this.dmWrites++;
                }
            }
        } catch (error) {
            this.engine.log.debug(`Control4 LED [${this.host.name}]: dm paint failed: ${error}`);
        }
    }

    private dmScheduleVerify(): void {
        if (this.animating || this.dmWant.size === 0) return;
        if (this.statusRun && !this.statusRun.cancelled) return;
        const writes = this.dmWrites;
        this.host.verifyDm(
            (values) => {
                const got = values.slice(-5, -1).map((v) => v.toLowerCase());
                this.dmLost = [];
                for (const b of this.dmWant.keys()) {
                    if (b !== 0 && b !== 1) continue;
                    for (const i of [0, 1]) {
                        const t = this.dmTarget(b)[i];
                        if (got[2 * b + i] !== t.toLowerCase()) this.dmLost.push([b, i, t]);
                    }
                }
                // What it shows matches: the writes up to this read-back are confirmed.
                if (this.dmLost.length === 0) this.dmConfirmed = Math.max(this.dmConfirmed, writes);
                return this.dmLost.length === 0;
            },
            async () => {
                for (const [b, i, hex] of [...this.dmLost]) {
                    await this.dmSend(`c4.dm.l${b}${i === 0 ? "o" : "f"} ${hex}`);
                    this.shown(b)[i] = hex;
                }
            },
        );
        // A read-back that gets no answer, or still finds a slot wrong after its re-send,
        // leaves the paint unconfirmed: the self-repaint reads it back again, a full delay
        // after this read-back (not one an earlier paint's timer leaves running into it).
        this.scheduleHeal(true);
    }

    // -- self-repaint ---------------------------------------------------------

    /** A status frame did not go out: paint the status again by itself (LED_HEAL_DELAYS). */
    private noteLost(): void {
        this.healLost = true;
        this.scheduleHeal();
    }

    /** What a self-repaint has to do: a lost status frame, or a DIM1-Z paint not confirmed yet. */
    private needsHeal(): boolean {
        return this.healLost || (this.protocol === "dm" && this.dmWant.size > 0 && this.dmConfirmed !== this.dmWrites);
    }

    /** `restart`: from now, even while one is due (a DIM1-Z read-back has just started). */
    private scheduleHeal(restart = false): void {
        if (restart && this.healTimer) {
            clearTimeout(this.healTimer);
            this.healTimer = undefined;
        }
        if (this.healTimer || !this.host.alive || this.healTries >= LED_HEAL_DELAYS.length) return;
        const delay = LED_HEAL_DELAYS[this.healTries];
        this.healTimer = setTimeout(
            () => {
                this.healTimer = undefined;
                if (!this.host.alive || !this.needsHeal()) return;
                // A status effect sends its frame again at every step; an unreachable device waits.
                if (this.statusRun && !this.statusRun.cancelled) {
                    this.healLost = false;
                    return;
                }
                if (this.host.unreachable?.()) return;
                this.healTries++;
                this.healLost = false;
                this.engine.log.debug(
                    `Control4 LED [${this.host.name}]: a status frame was lost or is unconfirmed; painting the status again (${this.healTries}/${LED_HEAL_DELAYS.length})`,
                );
                void this.applyStatus();
            },
            delay + Math.random() * delay * 0.2,
        );
        this.healTimer.unref?.();
    }

    /** The device is going (unregistered): no self-repaint is left behind. */
    cancelHeal(): void {
        if (this.healTimer) clearTimeout(this.healTimer);
        this.healTimer = undefined;
        this.healLost = false;
        this.healTries = 0;
    }

    // -- status layer ---------------------------------------------------------

    private fallback(btn: number): Rgb | "stored" {
        if (this.protocol === "dm") return "stored";
        // A follow-load LED shows its load again: given back, not painted.
        if (this.protocol === "dmx" && (this.borrowed.has(btn) || this.dmxMode(btn) === "follow_load")) return "stored";
        return hexRgb(this.host.idleHex(btn));
    }

    /** Status colours of the buttons painted since the start (their idle colour when they have none). */
    private statusFrame(): Frame {
        const f: Frame = new Map();
        for (const b of this.buttons) if (this.painted.has(b)) f.set(b, this.status.get(b) ?? this.fallback(b));
        return f;
    }

    async setStatus(options: {
        buttons?: unknown;
        colour?: Rgb;
        effect?: string;
        interval?: number;
        brightness?: number;
        clear?: boolean;
        /** kp / dmx: colour while the button is pressed (default: the status colour). */
        pressed?: Rgb;
        pressedBrightness?: number;
    }): Promise<void> {
        const brightness = options.brightness ?? 100;
        const targets = this.resolveButtons(options.buttons);
        for (const b of targets) this.painted.add(b);
        // A status from outside: its frames get the self-repaint tries afresh.
        this.healTries = 0;
        if (options.clear) {
            for (const b of targets) {
                this.status.delete(b);
                this.pressed.delete(b);
            }
        } else if (options.colour) {
            const rgb = scaleRgb(options.colour, brightness);
            const press = options.pressed ? scaleRgb(options.pressed, options.pressedBrightness ?? brightness) : undefined;
            for (const b of targets) {
                this.status.set(b, rgb);
                if (press) this.pressed.set(b, press);
                else this.pressed.delete(b);
            }
        }
        const effect = options.effect;
        if (effect && effect !== "none" && effect !== "solid") {
            if (!(effect in EFFECTS)) throw new Error(`unknown effect '${effect}'`);
            const step = options.interval ?? (EFFECT_DEFAULT_INTERVAL[effect] ?? 600) * 3;
            const colour = options.colour ?? (targets.length ? this.status.get(targets[0]) : undefined) ?? [255, 255, 255];
            this.statusEffect = {
                effect,
                buttons: targets.length ? targets : [...this.buttons],
                colour,
                colour2: [0, 0, 0],
                interval: Math.max(MIN_BASE_INTERVAL, step),
                count: 0,
                brightness,
                priority: 0,
                restore: false,
            };
            for (const b of this.statusEffect.buttons) this.painted.add(b);
        } else if (effect !== undefined) {
            this.statusEffect = undefined;
        }
        await this.applyStatus();
    }

    async applyStatus(force = false): Promise<void> {
        // A fading DIM1-Z gets nothing until its load has settled (the latest status wins).
        const wait = this.protocol === "dm" ? (this.host.quietMs?.() ?? 0) : 0;
        if (wait > 0) {
            this.deferForce ||= force;
            if (this.deferTimer) clearTimeout(this.deferTimer);
            this.deferTimer = setTimeout(() => {
                const f = this.deferForce;
                this.deferForce = false;
                this.deferTimer = undefined;
                void this.applyStatus(f);
            }, wait);
            this.deferTimer.unref?.();
            return;
        }
        this.cancelStatus();
        if (this.animating) {
            const rest: Frame = new Map();
            for (const [b, c] of this.statusFrame()) if (!this.overlayButtons.includes(b)) rest.set(b, c);
            if (rest.size) this.emit(rest, force, this.pressed, true);
            return;
        }
        if (this.statusEffect) {
            const spec = resolveSpec(this.statusEffect);
            spec.interval = Math.max(MIN_BASE_INTERVAL, spec.interval);
            this.emit(this.statusFrame(), force, this.pressed, true);
            const run: Run = {cancelled: false};
            this.statusRun = run;
            void this.loop(spec, run, false, true);
            return;
        }
        this.emit(this.statusFrame(), force, this.pressed, true);
    }

    private cancelStatus(): void {
        if (this.statusRun) this.statusRun.cancelled = true;
        this.statusRun = undefined;
    }

    async refresh(): Promise<void> {
        this.lastSent.clear();
        this.healTries = 0;
        await this.applyStatus(true);
    }

    // -- overlays ---------------------------------------------------------------

    async play(input: EffectSpec): Promise<boolean> {
        if (!(input.effect in EFFECTS)) throw new Error(`unknown effect '${input.effect}'`);
        const spec = resolveSpec(input);
        if (!spec.buttons.length) spec.buttons = [...this.buttons];
        if (this.protocol === "dm") spec.interval = Math.max(DM_STEP_PER_LED * Math.max(1, spec.buttons.length), spec.interval);
        if (!spec.buttons.length) return false;

        const wasAnimating = this.animating;
        if (this.overlay) {
            if (spec.priority < this.overlayPriority) {
                this.engine.log.debug(`Control4 LED [${this.host.name}]: ${spec.effect} (priority ${spec.priority}) refused - ${this.overlayPriority} running`);
                return false;
            }
            this.overlay.cancelled = true; // preempted; it must not restore
            this.overlay = undefined;
        } else if (this.engine.activeCount() >= MAX_ACTIVE_ANIMATIONS) {
            this.engine.log.warning(
                `Control4 LED [${this.host.name}]: refused ${spec.effect} - ${MAX_ACTIVE_ANIMATIONS} devices already animating (protects the coordinator TX path)`,
            );
            return false;
        }
        this.cancelStatus();
        const run: Run = {cancelled: false};
        this.overlay = run;
        this.overlayPriority = spec.priority;
        this.overlayButtons = [...spec.buttons];
        for (const b of spec.buttons) this.painted.add(b);
        if (!wasAnimating) this.host.onNotifying(true);
        void this.loop(spec, run, spec.restore);
        return true;
    }

    async stop(restore = true): Promise<void> {
        const run = this.overlay;
        this.overlay = undefined;
        this.overlayPriority = -1;
        if (run) {
            run.cancelled = true;
            this.host.onNotifying(false);
        }
        if (restore) await this.applyStatus(true);
    }

    private async loop(spec: EffectSpec, run: Run, restore: boolean, mergeStatus = false): Promise<void> {
        const generator = EFFECTS[spec.effect];
        const deadline = spec.duration === undefined ? undefined : Date.now() + spec.duration;
        let cycles = 0;
        try {
            outer: for (;;) {
                for (const f of generator(spec)) {
                    if (run.cancelled || !this.host.alive) break outer;
                    let out = f;
                    if (mergeStatus) {
                        out = this.statusFrame();
                        for (const [b, c] of f) out.set(b, c);
                    }
                    this.emit(out, false, mergeStatus ? this.pressedOutside(f) : undefined);
                    await sleep(spec.interval);
                    if (run.cancelled) break outer;
                    if (deadline !== undefined && Date.now() >= deadline) break outer;
                }
                cycles++;
                if (spec.count && cycles >= spec.count) break;
            }
        } finally {
            if (this.overlay === run) {
                this.overlay = undefined;
                this.overlayPriority = -1;
                this.host.onNotifying(false);
                if (restore) await this.applyStatus(true);
            }
        }
    }
}

export class AnimationEngine {
    readonly animators = new Map<string, Animator>();

    constructor(
        readonly tx: TxPump,
        readonly log: Logger,
    ) {}

    register(host: AnimatorHost, buttons: number[], protocol: "kp" | "dmx" | "dm"): Animator {
        let a = this.animators.get(host.ieee);
        if (!a) {
            a = new Animator(host, buttons, protocol, this);
            this.animators.set(host.ieee, a);
        } else {
            a.host = host;
            a.buttons = [...buttons];
            a.protocol = protocol;
        }
        return a;
    }

    unregister(ieee: string): void {
        const a = this.animators.get(ieee);
        if (a) {
            a.cancelHeal();
            void a.stop(false);
        }
        this.animators.delete(ieee);
    }

    get(ieee: string): Animator | undefined {
        return this.animators.get(ieee.toLowerCase());
    }

    all(): Animator[] {
        return [...this.animators.values()];
    }

    activeCount(): number {
        let n = 0;
        for (const a of this.animators.values()) if (a.animating) n++;
        return n;
    }
}

// ---------------------------------------------------------------------------
// /set payload helpers (mirror the ZHA zha_c4_patch.keypad_led_* services)
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: user payload
type Obj = Record<string, any>;

function num(v: unknown, min: number, max: number, fallback: number): number {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`'${v}' is not a number`);
    return Math.max(min, Math.min(max, n));
}

export async function ledEffect(animator: Animator, data: Obj): Promise<boolean> {
    const effect = String(data.effect ?? "blink");
    if (!(effect in EFFECTS)) throw new Error(`unknown effect '${effect}' (one of ${Object.keys(EFFECTS).join(", ")})`);
    let interval: number | undefined = data.interval !== undefined ? num(data.interval, 0.05, 10, 0.4) * 1000 : undefined;
    if (interval === undefined && data.speed !== undefined) interval = num(data.speed, 50, 10000, 400);
    if (interval === undefined) interval = EFFECT_DEFAULT_INTERVAL[effect] ?? 400;
    let duration: number | undefined = data.duration !== undefined ? num(data.duration, 0.1, 3600, 1) * 1000 : undefined;
    let count = Math.trunc(num(data.count, 0, 255, 3));
    if (effect === "solid" && count === 0 && !duration) {
        interval = 30_000; // hold until stopped
    } else if (effect === "solid") {
        duration = duration ?? DEFAULT_SOLID_DURATION;
        interval = duration;
        count = 1;
    }
    const colour = parseColour(data.color ?? data.colour, [255, 255, 255]);
    const colour2Raw = data.color2 ?? data.colour2;
    return animator.play({
        effect,
        buttons: animator.resolveButtons(data.buttons),
        colour,
        colour2: colour2Raw === undefined ? [0, 0, 0] : parseColour(colour2Raw),
        interval,
        count,
        duration,
        brightness: Math.trunc(num(data.brightness, 0, 100, 100)),
        priority: Math.trunc(num(data.priority, 0, 255, 10)),
        restore: data.restore === undefined ? true : Boolean(data.restore),
    });
}

export async function ledStatus(animator: Animator, data: Obj): Promise<void> {
    let colour: Rgb | undefined;
    const raw = data.color ?? data.colour;
    if (raw !== undefined) colour = parseColour(raw);
    else if (data.state !== undefined) {
        const st = String(data.state);
        if (!(st in STATUS_COLOURS)) throw new Error(`unknown state '${st}' (one of ${Object.keys(STATUS_COLOURS).join(", ")})`);
        colour = parseColour(STATUS_COLOURS[st]);
    }
    const effect = data.effect === undefined ? undefined : String(data.effect);
    if (effect !== undefined && effect !== "none" && !(effect in EFFECTS)) throw new Error(`unknown effect '${effect}'`);
    const pressedRaw = data.pressed_color ?? data.pressed_colour;
    const pressed = pressedRaw === undefined || pressedRaw === null || pressedRaw === "" ? undefined : parseColour(pressedRaw);
    const clear = Boolean(data.clear);
    if (colour === undefined && effect === undefined && !clear) throw new Error("led_status needs at least one of: state, color, effect, clear");
    await animator.setStatus({
        buttons: data.buttons,
        colour,
        effect,
        interval: data.interval !== undefined ? num(data.interval, 0.5, 30, 1) * 1000 : undefined,
        brightness: Math.trunc(num(data.brightness, 0, 100, 100)),
        clear,
        pressed,
        pressedBrightness: data.pressed_brightness === undefined ? undefined : Math.trunc(num(data.pressed_brightness, 0, 100, 100)),
    });
}
