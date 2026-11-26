/**
 * /set keys of a device's LEDs, shared by the dmx, dm and keypad families:
 * the colour, bind, brightness and transition keys of every device with a
 * LedWriter (LedKeys), and the ZHA LED cluster's commands.
 */

import {LED_MODE_NAMES, LED_MODES, type LedMode} from "../core/constants";
import {LED_BRIGHTNESS_KEY, LED_DEFAULT_COLOUR, LED_TRANSITION_KEY, type LedSelect, type LedWriter, normalizePalette} from "../core/leds";
import {hex2} from "../core/protocol";
import {type C4Device, type Payload, toNumber} from "./base";

// ---------------------------------------------------------------------------
// The ZHA LED cluster's commands (C4LEDCluster, 0xFC43), same names and fields.
// ---------------------------------------------------------------------------

const byte = (v: unknown, fallback = 0) => {
    const n = Math.round(Number(v ?? fallback));
    return hex2(Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : fallback);
};
const rgb = (a: Record<string, unknown>, p: "on" | "off") => `${byte(a[`${p}_red`])}${byte(a[`${p}_green`])}${byte(a[`${p}_blue`])}`;
const count = (a: Record<string, unknown>) => Number.parseInt(byte(a.num_buttons, 12), 16);

export const LED_CLUSTER_COMMANDS: Record<string, (a: Record<string, unknown>) => string[]> = {
    set_led_color: (a) => [`c4.dmx.led ${byte(a.button_id)} 03 ${rgb(a, "on")}`, `c4.dmx.led ${byte(a.button_id)} 04 ${rgb(a, "off")}`],
    set_led_mode: (a) => [`c4.dmx.led ${byte(a.button_id)} 00 ${byte(a.mode)}`, `c4.dmx.led ${byte(a.button_id)} 01 ${byte(a.behavior)}`, `c4.dmx.led ${byte(a.button_id)} 02 ${byte(a.color_mode)}`],
    set_led_all_same_color: (a) => Array.from({length: count(a)}, (_, b) => [`c4.dmx.led ${hex2(b)} 03 ${rgb(a, "on")}`, `c4.dmx.led ${hex2(b)} 04 ${rgb(a, "off")}`]).flat(),
    set_all_led_modes: (a) =>
        Array.from({length: count(a)}, (_, b) => [`c4.dmx.led ${hex2(b)} 00 ${byte(a.mode)}`, `c4.dmx.led ${hex2(b)} 01 ${byte(a.behavior)}`, `c4.dmx.led ${hex2(b)} 02 ${byte(a.color_mode)}`]).flat(),
    set_led_single_on: (a) => Array.from({length: 12}, (_, i) => `c4.dmx.led ${hex2(i)} 01 ${i === Number(a.button_idx) ? byte(a.behavior_on) : byte(a.behavior_others)}`),
};

/** Run one LED-cluster command. Like ZHA: every frame is attempted, 50 ms apart; failures are counted, not fatal. */
export async function ledClusterCommand(dev: C4Device, key: string, value: unknown): Promise<undefined> {
    let failed = 0;
    for (const cmd of LED_CLUSTER_COMMANDS[key]((value && typeof value === "object" ? value : {}) as Record<string, unknown>)) {
        if (!(await dev.trySet(cmd))) failed++;
        await dev.sleep(50);
    }
    if (failed) dev.log.warning(`Control4 ${dev.name}: ${key}: ${failed} frame(s) failed`);
    return undefined;
}

/** The LED mode a value names (a mode name, or its code 0-2); throws on anything else. */
export function ledModeOf(value: unknown): LedMode {
    if (typeof value === "number" && Number.isInteger(value)) {
        const name = LED_MODE_NAMES.find((m) => LED_MODES[m] === value);
        if (name) return name;
    }
    const text = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s/-]+/g, "_");
    if ((LED_MODE_NAMES as string[]).includes(text)) return text as LedMode;
    throw new Error(`unknown LED mode '${value}' (use one of ${LED_MODE_NAMES.join(", ")})`);
}

/** Shared LED-colour key handling for every device with a LedWriter. */
export class LedKeys {
    constructor(
        private readonly dev: C4Device,
        readonly writer: LedWriter,
        readonly selects: LedSelect[],
        /** LED mode keys (`led_top_mode`, `led_3_mode`) and the slot each sets. */
        readonly modes: Map<string, number> = new Map(),
        readonly withTransition = true,
    ) {}

    keys(): string[] {
        const k = [...this.selects.map((s) => s.key), ...this.modes.keys(), LED_BRIGHTNESS_KEY];
        if (this.withTransition) k.push(LED_TRANSITION_KEY);
        return k;
    }

    handles(key: string): boolean {
        return this.keys().includes(key);
    }

    /** The mode key of a slot, if it has one. */
    modeKey(slot: number): string | undefined {
        for (const [key, s] of this.modes) if (s === slot) return key;
        return undefined;
    }

    /** A slot's LED mode as last read from the device or set (undefined: not known yet). */
    mode(slot: number): LedMode | undefined {
        const key = this.modeKey(slot);
        const stored = key ? this.dev.setting<string>(key) : undefined;
        return stored && (LED_MODE_NAMES as string[]).includes(stored) ? (stored as LedMode) : undefined;
    }

    async set(key: string, value: unknown): Promise<Payload> {
        const sel = this.selects.find((s) => s.key === key);
        if (sel) {
            const name = normalizePalette(value);
            this.dev.saveSetting(key, name);
            const out: Payload = {[key]: name};
            // Last write wins: an all-slots colour replaces the per-slot colours it covers,
            // or a later re-apply (brightness change) would bring the old ones back.
            if (sel.slots.length > 1) {
                for (const other of this.selects) {
                    if (other === sel || other.verb !== sel.verb || !other.slots.every((s) => sel.slots.includes(s))) continue;
                    this.dev.saveSetting(other.key, name);
                    out[other.key] = name;
                }
            }
            await this.writer.apply(sel.slots, sel.verb, name);
            return out;
        }
        const slot = this.modes.get(key);
        if (slot !== undefined) {
            const mode = ledModeOf(value);
            await this.writer.setMode(slot, mode);
            this.dev.saveSetting(key, mode);
            return {[key]: mode};
        }
        if (key === LED_BRIGHTNESS_KEY) {
            const pct = Math.round(toNumber(value, 1, 100));
            this.dev.saveSetting(key, pct);
            const {stored, written} = await this.writer.reapply(this.selects);
            this.dev.log.info(`Control4 ${this.dev.name}: LED brightness ${pct}% (${written} of ${stored} colours changed)`);
            return {[key]: pct};
        }
        if (key === LED_TRANSITION_KEY) {
            const s = Math.round(toNumber(value, 0, 10) * 10) / 10;
            this.dev.saveSetting(key, s);
            return {[key]: s};
        }
        throw new Error(`unknown LED key ${key}`);
    }

    /**
     * Give a newly paired device its default colours: every slot that has no stored colour
     * is written LED_DEFAULT_COLOUR once (each slot/verb once, even under an all-slots key)
     * and the keys are stored and published. Returns how many keys were set.
     */
    async applyDefaults(): Promise<number> {
        const unset = this.selects.filter((s) => this.dev.setting<string>(s.key) === undefined);
        if (!unset.length) return 0;
        const written = new Set<string>();
        for (const sel of unset) {
            const todo = sel.slots.filter((slot) => !written.has(`${sel.verb}:${slot}`));
            if (!todo.length) continue;
            await this.writer.apply(todo, sel.verb, LED_DEFAULT_COLOUR);
            for (const slot of todo) written.add(`${sel.verb}:${slot}`);
        }
        if (!this.dev.alive) return 0;
        const out: Payload = {};
        for (const sel of unset) {
            this.dev.saveSetting(sel.key, LED_DEFAULT_COLOUR);
            out[sel.key] = LED_DEFAULT_COLOUR;
        }
        this.dev.publish(out);
        return unset.length;
    }

    initialState(): Payload {
        const out: Payload = {};
        // Publish every colour key, null when never set: Home Assistant renders each exposed
        // key from every state message and warns about the missing ones on every update.
        for (const s of this.selects) out[s.key] = this.dev.setting<string>(s.key) ?? null;
        // A mode is shown once read from the device (or set): null until then.
        for (const [k, slot] of this.modes) out[k] = this.mode(slot) ?? null;
        out[LED_BRIGHTNESS_KEY] = this.dev.setting<number>(LED_BRIGHTNESS_KEY, 100);
        if (this.withTransition) out[LED_TRANSITION_KEY] = this.dev.setting<number>(LED_TRANSITION_KEY, 0);
        return out;
    }
}
