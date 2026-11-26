/**
 * Keypad / dimmer LED colours (port of control4_led_select.py).
 *
 * Three wire families:
 *   kp   KP3-Z / KP6-Z   c4.kp.lf (idle, stored) / lv (live) / lo (pressed)
 *   dmx  APD120 / SW120277 / KC120277   c4.dmx.led <slot> 03|04 <rrggbb>
 *   dm   DIM1-Z          c4.dm.l<btn><o|f> <rrggbb>, then c4.dm.lm 01
 *
 * There is no brightness register or fade in the protocol: brightness scales
 * the colour, and a fade is drawn by sending the intermediate colours (idle
 * colour only - the pressed colour is not on screen unless a finger is).
 */

import {LED_MODES, type LedMode, PALETTE_HEX, PALETTE_NAMES, type PaletteName} from "./constants";
import {blendHex, hex2, lastValue, scaleHex} from "./protocol";
import type {C4Device} from "../devices/base";

export type LedProtocol = "kp" | "dmx" | "dm";
export type LedVerb = "idle" | "active";

export const FADE_STEPS = 20;
export const DM_LED_THROTTLE = 150;
export const LED_BRIGHTNESS_KEY = "led_brightness";
export const LED_TRANSITION_KEY = "led_transition";

export function paletteHex(value: unknown): string {
    if (typeof value === "number" && Number.isInteger(value)) {
        const name = PALETTE_NAMES[value];
        if (name) return PALETTE_HEX[name];
    }
    const text = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (text in PALETTE_HEX) return PALETTE_HEX[text as PaletteName];
    const hex = text.replace(/^#/, "");
    if (/^[0-9a-f]{6}$/.test(hex)) return hex;
    throw new Error(`unknown LED colour '${value}' (use one of ${PALETTE_NAMES.join(", ")})`);
}

export function normalizePalette(value: unknown): PaletteName {
    if (typeof value === "number" && PALETTE_NAMES[value]) return PALETTE_NAMES[value];
    const text = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if ((PALETTE_NAMES as readonly string[]).includes(text)) return text as PaletteName;
    throw new Error(`unknown LED colour '${value}' (use one of ${PALETTE_NAMES.join(", ")})`);
}

/** One LED colour setting: which slots, idle or active, and its state key. */
export interface LedSelect {
    key: string;
    slots: number[];
    verb: LedVerb;
}

/** Colour a newly paired device's LED slots start with (written once, then stored). */
export const LED_DEFAULT_COLOUR = "off";
/** Per-device store flag: "off" once the default colours were written, "existing" for devices paired before this feature. */
export const LED_DEFAULTS_KEY = "led_defaults";
/** Store meta flag: devices present when LED defaults were introduced have been marked "existing". */
export const LED_DEFAULTS_MIGRATION = "led_defaults_v1";

export class LedWriter {
    /** What each `<slot>:<param>` was last sent; a write of the same colour is skipped. */
    private lastSent = new Map<string, string>();
    private fadeTokens = new Map<string, number>();
    /** Keys a fade is still drawing: their lastSent is a step on the way, not where they end. */
    private fading = new Set<string>();
    /**
     * What each key's write in flight carries. A write queued behind others hasn't
     * landed yet, and a re-apply meanwhile must not send the same colour again: three
     * brightness sets back to back once re-sent every colour three times over.
     */
    private queued = new Map<string, string>();
    /** The newest write token of each key that has landed: an older write landing late doesn't overwrite it. */
    private landed = new Map<string, number>();

    constructor(
        private readonly dev: C4Device,
        readonly protocol: LedProtocol,
    ) {}

    brightness(): number {
        const v = Number(this.dev.setting<number>(LED_BRIGHTNESS_KEY, 100));
        return Number.isFinite(v) ? Math.max(1, Math.min(100, Math.trunc(v))) : 100;
    }

    fadeMs(): number {
        const v = Number(this.dev.setting<number>(LED_TRANSITION_KEY, 0));
        return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) * 1000 : 0;
    }

    /** Record what a slot shows, so the next fade starts from there. */
    noteSent(slot: number, param: string, hex: string): void {
        this.lastSent.set(`${slot}:${param}`, hex);
    }

    /** The device may have lost what it was sent (it rebooted): the next write of every slot goes out. */
    forget(): void {
        this.lastSent.clear();
    }

    /** Already showing `hex` (or a write of it is on its way) and not mid-fade: a write would change nothing. */
    private unchanged(key: string, hex: string): boolean {
        return (this.queued.get(key) ?? this.lastSent.get(key)) === hex && !this.fading.has(key);
    }

    /** A new write token for `key`: a fade still drawing it stops at its next step. */
    private bump(key: string): number {
        const token = (this.fadeTokens.get(key) ?? 0) + 1;
        this.fadeTokens.set(key, token);
        return token;
    }

    /**
     * Send one write of `hex` for `key`, counted as on its way until it lands. Only a
     * write that went out counts as sent: a lost one is sent again next time.
     */
    private async send(key: string, hex: string, write: () => Promise<boolean>): Promise<boolean> {
        const token = this.bump(key);
        this.fading.delete(key);
        this.queued.set(key, hex);
        try {
            const ok = await write();
            if (ok && token > (this.landed.get(key) ?? 0)) {
                this.lastSent.set(key, hex);
                this.landed.set(key, token);
            } else if (!ok && this.fadeTokens.get(key) === token) {
                this.lastSent.delete(key);
            }
            return ok;
        } finally {
            if (this.fadeTokens.get(key) === token) this.queued.delete(key);
        }
    }

    /** Scaled hex for a palette entry at the current LED brightness. */
    scaled(colour: unknown): string {
        return scaleHex(paletteHex(colour), this.brightness());
    }

    /**
     * Write a colour to slots. A slot already showing it is skipped. Returns how
     * many slots were written (or started fading).
     */
    async apply(slots: number[], verb: LedVerb, colour: unknown): Promise<number> {
        const hex = this.scaled(colour);
        const idle = verb === "idle";
        const fade = idle ? this.fadeMs() : 0;
        const dev = this.dev;
        const link = dev.ctx.link;

        if (this.protocol === "dmx") {
            const param = idle ? "04" : "03";
            let written = 0;
            for (const i of slots) {
                const build = (c: string) => `c4.dmx.led ${hex2(i)} ${param} ${c}`;
                const wrote = await this.crossfade(i, param, build, hex, fade, () =>
                    link.scheduleVerify(
                        dev,
                        `dmx led ${hex2(i)} ${param}`,
                        `c4.dmx.led ${hex2(i)} ${param}`,
                        (values) => values[values.length - 1].toLowerCase() === hex,
                        () => dev.trySet(build(hex)),
                    ),
                );
                if (wrote) written++;
            }
            return written;
        }

        if (this.protocol === "dm") {
            const b = slots[0] ?? 0;
            const suffix = idle ? "f" : "o";
            if (this.unchanged(`${b}:${suffix}`, hex)) return 0;
            const write = async () => {
                const ok = await dev.trySet(`c4.dm.l${b}${suffix} ${hex}`);
                await dev.sleep(DM_LED_THROTTLE);
                await dev.trySet("c4.dm.lm 01");
                return ok;
            };
            await this.send(`${b}:${suffix}`, hex, write);
            // c4.dm.is: level, default-on level, on-ramp, off-ramp, top-on, top-off, bottom-on, bottom-off, flags
            const field = 4 + 2 * b + (suffix === "o" ? 0 : 1);
            void link.scheduleVerify(dev, `dm led ${b}${suffix}`, "c4.dm.is", (values) => values[field].toLowerCase() === hex, write, DM_LED_THROTTLE);
            return 1;
        }

        // Keypad: lf stores the idle colour, lv is what shows now, lo is pressed.
        let written = 0;
        for (const i of slots) {
            if (idle) {
                const store = !this.unchanged(`${i}:lf`, hex);
                if (store) await this.send(`${i}:lf`, hex, () => dev.trySet(`c4.kp.lf ${hex2(i)} ${hex}`));
                const shown = await this.crossfade(i, "lv", (c) => `c4.kp.lv ${hex2(i)} ${c}`, hex, fade);
                if (store || shown) written++;
            } else if (!this.unchanged(`${i}:lo`, hex)) {
                await this.send(`${i}:lo`, hex, () => dev.trySet(`c4.kp.lo ${hex2(i)} ${hex}`));
                written++;
            }
        }
        return written;
    }

    /** Show `target` on a slot, fading from what it shows when `fadeMs` > 0. False when it already shows it. */
    private async crossfade(slot: number, param: string, build: (c: string) => string, target: string, fadeMs: number, onDone?: () => unknown): Promise<boolean> {
        const key = `${slot}:${param}`;
        if (this.unchanged(key, target)) return false;
        const start = this.queued.get(key) ?? this.lastSent.get(key);
        if (!start || fadeMs <= 0 || start === target) {
            // A fade still running stops at its next step.
            await this.send(key, target, () => this.dev.trySet(build(target)));
            onDone?.();
            return true;
        }
        const token = this.bump(key);
        // The fade owns the key now: a write still in flight no longer stands for what it ends on
        // (its cleanup sees a newer token and would leave it queued), and landing late it
        // must not overwrite the fade's steps.
        this.queued.delete(key);
        this.landed.set(key, token);
        const gap = fadeMs / FADE_STEPS;
        const run = async () => {
            try {
                let ok = false;
                for (let i = 1; i <= FADE_STEPS; i++) {
                    if (this.fadeTokens.get(key) !== token || !this.dev.alive) return;
                    const started = Date.now();
                    const mix = blendHex(start, target, i / FADE_STEPS);
                    ok = await this.dev.trySet(build(mix));
                    if (ok) this.lastSent.set(key, mix);
                    if (i < FADE_STEPS) await this.dev.sleep(Math.max(0, gap - (Date.now() - started)));
                }
                if (ok) this.lastSent.set(key, target);
                else this.lastSent.delete(key); // the last step was lost: the next write of this colour goes out
                onDone?.();
            } finally {
                if (this.fadeTokens.get(key) === token) this.fading.delete(key);
            }
        };
        this.fading.add(key);
        // Fire and forget: a colour change must not block for the fade's length.
        this.dev.spawn(run());
        return true;
    }

    /**
     * A slot's LED mode (`c4.dmx.led <slot> 01 <code>`): programmed, follow load or
     * push/release. Param 02 (what it follows) and param 00 stay as the device has
     * them (tested 2026-11-07). Read back after; a lost write is sent once more.
     */
    async setMode(slot: number, mode: LedMode): Promise<void> {
        const code = hex2(LED_MODES[mode]);
        const cmd = `c4.dmx.led ${hex2(slot)} 01 ${code}`;
        await this.dev.set(cmd);
        void this.dev.ctx.link.scheduleVerify(
            this.dev,
            `dmx led ${hex2(slot)} 01`,
            `c4.dmx.led ${hex2(slot)} 01`,
            (values) => lastValue(values)?.toLowerCase() === code,
            () => this.dev.trySet(cmd),
        );
    }

    /**
     * Show every stored colour at the current brightness (after a brightness
     * change): each slot once, with the colour of the last select covering it.
     * Only a slot whose scaled colour differs from what it shows is written, so
     * an off slot (black at any brightness) or a repeat of the same brightness
     * costs no frame. Returns how many slots have a stored colour and how many
     * were written.
     */
    async reapply(selects: LedSelect[]): Promise<{stored: number; written: number}> {
        const effective = new Map<string, {slot: number; verb: LedVerb; colour: string}>();
        for (const sel of selects) {
            const stored = this.dev.setting<string>(sel.key);
            if (stored === undefined) continue;
            for (const slot of sel.slots) effective.set(`${sel.verb}:${slot}`, {slot, verb: sel.verb, colour: stored});
        }
        // Each colour is scaled at the brightness of the moment, and a write already on its way
        // counts as sent: an older re-apply still running writes nothing the newest would repeat.
        let written = 0;
        for (const e of effective.values()) {
            if (!this.dev.alive) break;
            written += await this.apply([e.slot], e.verb, e.colour);
        }
        return {stored: effective.size, written};
    }
}