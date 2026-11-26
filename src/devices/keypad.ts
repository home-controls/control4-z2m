/**
 * Keypads: C4-KP3-Z / C4-KP6-Z (c4.kp.*) and the configurable C4-KC120277
 * (c4.dmx.*) - ports of control4_kp3z.py, control4_kp6z.py,
 * control4_scene_controller.py.
 */

import {
    buttonNumberOf,
    type Gesture,
    KC_LAYOUT_OPTION,
    KC_LED_SLOTS,
    KC_NUMBERING_OPTION,
    KC_POSITIONS,
    type KcLayout,
    kcButtonNumber,
    kcNumbering,
    kcWireOf,
    keypadButtons,
    PALETTE_HEX,
    type PaletteName,
} from "../core/constants";
import {LED_BRIGHTNESS_KEY, type LedSelect, LedWriter, normalizePalette} from "../core/leds";
import {hex2, lastValue, parseHex, scaleHex} from "../core/protocol";
import {AnimationKeys} from "./animkeys";
import {C4Device, type Payload, type SetMeta, toBool, toNumber} from "./base";
import {DmxDevice} from "./dmx";
import {Gen3Device, paletteNameOf, type SettingRead} from "./gen3";
import {LedKeys} from "./ledkeys";
import {AmbientSensor} from "./sensors";

function storedHex(dev: C4Device, key: string): string {
    const name = dev.setting<string>(key);
    const hex = name ? (PALETTE_HEX[name as PaletteName] ?? "000000") : "000000";
    return scaleHex(hex, Number(dev.setting<number>(LED_BRIGHTNESS_KEY, 100)));
}

// ---------------------------------------------------------------------------
// KP3-Z / KP6-Z
// ---------------------------------------------------------------------------

export function kpLedSelects(count: number): LedSelect[] {
    const out: LedSelect[] = [];
    for (let i = 0; i < count; i++) {
        out.push({key: `button_${i + 1}_idle_color`, slots: [i], verb: "idle"});
        out.push({key: `button_${i + 1}_pressed_color`, slots: [i], verb: "active"});
    }
    return out;
}

export class Keypad extends DmxDevice {
    protected readonly buttons: Record<number, string>;
    readonly anim: AnimationKeys;

    constructor(
        ctx: ConstructorParameters<typeof C4Device>[0],
        ieee: string,
        model: string,
        family: "kp3" | "kp6",
    ) {
        super(ctx, ieee, model, family);
        const count = family === "kp3" ? 3 : 6;
        this.buttons = keypadButtons(count);
        this.led = new LedKeys(this, new LedWriter(this, "kp"), kpLedSelects(count));
        const ids = Array.from({length: count}, (_, i) => i);
        this.anim = new AnimationKeys(
            this,
            {
                idleHex: (btn) => storedHex(this, `button_${ids.indexOf(btn) + 1}_idle_color`),
                dmStored: () => ["000000", "000000"],
                loadOn: () => undefined,
                verifyDm: () => undefined,
                // button_N is LED N.
                ledsOf: (name) => {
                    const n = buttonNumberOf(name);
                    return n !== undefined && n <= count ? [n - 1] : undefined;
                },
            },
            ids,
            "kp",
        );
    }

    override start(hotLoad = false): void {
        super.start(hotLoad);
        if (hotLoad) return;
        // Commission the keypad as ours even if it never sends a check-in. Spread over
        // 12-32 s so a restart with many keypads does not send them all at once.
        this.after(12_000 + Math.random() * 20_000, async () => {
            for (let i = 0; i < 3; i++) {
                await this.ctx.sendIdentity(this, `${this.family}_init_${i}`);
                await this.sleep(4_000);
            }
        });
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        switch (ns) {
            case "c4.kp.cc":
                if (data.length >= 2) super.onAnnounce("c4.dmx.cc", data);
                return;
            case "c4.kp.bb": // button down: the instant press
                super.onAnnounce("c4.dmx.bp", data);
                return;
            case "c4.kp.bc": // release after a tap (a hold ends with be, never bc)
                super.onAnnounce("c4.dmx.sc", data);
                return;
            case "c4.kp.bh": // hold, repeats every ~0.6 s (KPZ-3B1 fw 03.22.41)
            case "c4.kp.hc":
                super.onAnnounce("c4.dmx.hc", data);
                return;
            case "c4.kp.be":
            case "c4.kp.he":
                super.onAnnounce("c4.dmx.he", data);
                return;
        }
        super.onAnnounce(ns, data);
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (this.anim.handles(key)) return this.anim.set(key, value);
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        return {...super.initialState(), ...this.anim.initialState()};
    }
}

// ---------------------------------------------------------------------------
// KC120277 configurable keypad
// ---------------------------------------------------------------------------

export function kcLedSelects(): LedSelect[] {
    const out: LedSelect[] = [];
    for (let i = 0; i < KC_LED_SLOTS; i++) {
        out.push({key: `led_${i + 1}_idle_color`, slots: [i], verb: "idle"});
        out.push({key: `led_${i + 1}_pressed_color`, slots: [i], verb: "active"});
    }
    return out;
}

/** `led_N_mode`: the LED mode of slot N-1. */
export function kcModeKeys(): Map<string, number> {
    return new Map(Array.from({length: KC_LED_SLOTS}, (_, i) => [`led_${i + 1}_mode`, i] as [string, number]));
}

/** Saved setting: the button wires this keypad has sent from, so far (each is a fitted button). */
export const KC_WIRES_KEY = "fitted_wires";
export const BACKLIGHT_COLOR_KEY = "backlight_color";
export const BACKLIGHT_BRIGHTNESS_KEY = "backlight_brightness";

/** `button_layout` ("1, 3, 5": the fitted buttons' positions from the top) -> their wires; undefined when not set or not valid. */
export function parseLayout(raw: unknown): number[] | undefined {
    if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
    const positions = String(raw)
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number);
    if (!positions.length || positions.some((n) => !Number.isInteger(n) || n < 1 || n > KC_POSITIONS)) return undefined;
    return [...new Set(positions.map((n) => n - 1))].sort((a, b) => a - b);
}


/**
 * The C4-KC120277. Its kit of buttons (37 layouts) can't be read from the device: it
 * is learned from the button wires it sends from (a wire seen is a button), or set
 * with the `button_layout` option. Once that is known, only the fitted buttons get
 * actions and only their LEDs get entities.
 */
export class Kc120277 extends Gen3Device {
    protected readonly buttons: Record<number, string> = {};

    constructor(...args: ConstructorParameters<typeof C4Device>) {
        super(...args);
        this.amb = new AmbientSensor(this);
        this.migrateBound();
        this.led = new LedKeys(this, new LedWriter(this, "dmx"), kcLedSelects(), kcModeKeys());
        this.seedWires();
        const slots = Array.from({length: KC_LED_SLOTS}, (_, i) => i);
        this.anim = new AnimationKeys(
            this,
            {
                idleHex: (btn) => storedHex(this, `led_${btn + 1}_idle_color`),
                dmStored: () => ["000000", "000000"],
                loadOn: () => undefined,
                verifyDm: () => undefined,
                // A button's LED is the slot of the wire it reports.
                ledsOf: (name) => {
                    const n = buttonNumberOf(name);
                    if (n === undefined) return undefined;
                    const wire = kcWireOf(n, this.layout());
                    return wire !== undefined && wire < KC_LED_SLOTS ? [wire] : undefined;
                },
                // Control4 provisions a keypad's button LEDs push/release.
                ledMode: (slot) => this.led.mode(slot) ?? "push_release",
                onBorrow: (slot, borrowed) => this.noteBorrow(slot, borrowed),
            },
            slots,
            "dmx",
        );
    }

    /** `led_N_bound` was push/release (on) or programmed (off): saved as the slot's mode. */
    private migrateBound(): void {
        for (let i = 1; i <= KC_LED_SLOTS; i++) {
            const bound = this.setting<boolean>(`led_${i}_bound`);
            if (typeof bound === "boolean" && this.setting<string>(`led_${i}_mode`) === undefined) this.saveSetting(`led_${i}_mode`, bound ? "push_release" : "programmed");
        }
    }

    /** Wires a press came from that the button_layout option doesn't list (each warned of once). */
    private unlisted = new Set<number>();

    /** The wires seen so far, or undefined while none is. */
    learnedWires(): number[] | undefined {
        const stored = this.setting<unknown>(KC_WIRES_KEY);
        const wires = Array.isArray(stored) ? stored.filter((w): w is number => typeof w === "number") : [];
        return wires.length ? [...wires].sort((a, b) => a - b) : undefined;
    }

    /** The fitted buttons' wires: the `button_layout` option, else the wires seen; undefined while not known. */
    fittedWires(): number[] | undefined {
        return parseLayout(this.option(KC_LAYOUT_OPTION)) ?? this.learnedWires();
    }

    /**
     * How its buttons are named, and what its exposes need. "fitted" numbering takes its
     * order from the `button_layout` option: while the layout is still being learned it
     * numbers as "slots", or each newly learned button would renumber the ones below it.
     */
    layout(): KcLayout {
        const set = parseLayout(this.option(KC_LAYOUT_OPTION));
        const numbering = kcNumbering(this.option(KC_NUMBERING_OPTION));
        return {wires: set ?? this.learnedWires(), numbering: numbering === "fitted" && !set ? "slots" : numbering};
    }

    /** Buttons seen sending a release before wires were learned: their wires, under the numbering in use now. */
    private seedWires(): void {
        if (this.learnedWires()) return;
        const releasing = this.setting<unknown>("releasing_buttons");
        if (!Array.isArray(releasing)) return;
        const wires = new Set<number>();
        for (const name of releasing) {
            const n = typeof name === "string" ? buttonNumberOf(name) : undefined;
            if (n === undefined) continue;
            const wire = kcWireOf(n, {wires: undefined, numbering: kcNumbering(this.option(KC_NUMBERING_OPTION)) === "pairs" ? "pairs" : "slots"});
            if (wire !== undefined && wire < KC_POSITIONS) wires.add(wire);
        }
        if (wires.size) this.saveSetting(KC_WIRES_KEY, [...wires].sort((a, b) => a - b));
    }

    /** A press from a wire not seen before: a fitted button. Its actions and LED are exposed from now on. */
    private learnWire(wire: number): void {
        if (wire >= KC_POSITIONS) return;
        const set = parseLayout(this.option(KC_LAYOUT_OPTION));
        if (set && !set.includes(wire) && !this.unlisted.has(wire)) {
            this.unlisted.add(wire);
            this.log.warning(`Control4 ${this.name}: a button at position ${wire + 1} is missing from its button_layout option (${this.option(KC_LAYOUT_OPTION)}): add it there`);
        }
        const known = this.learnedWires() ?? [];
        if (known.includes(wire)) return;
        this.saveSetting(KC_WIRES_KEY, [...known, wire].sort((a, b) => a - b));
        this.log.info(`Control4 ${this.name}: a button at position ${wire + 1} (wire ${wire}); its actions and LED are exposed`);
        if (parseLayout(this.option(KC_LAYOUT_OPTION)) === undefined) this.ctx.exposesChanged(this.ieee);
    }

    protected override fire(hex: string | undefined, gesture: Gesture, count?: number): void {
        const id = parseHex(hex);
        if (id !== undefined) this.learnWire(id);
        super.fire(hex, gesture, count);
    }

    /** Button N by the numbering option: pairs (default), slots, or fitted (the Nth fitted button from the top). */
    protected override buttonName(id: number): string {
        return `button_${kcButtonNumber(id, this.layout())}`;
    }

    protected override settingReads(): SettingRead[] {
        return [
            ...super.settingReads(),
            {
                prop: "c4.dmx.blc 00 05",
                parse: (v) => {
                    const name = paletteNameOf(lastValue(v));
                    if (!name) this.log.info(`Control4 ${this.name}: its backlight colour ${lastValue(v)} is not a palette colour; shown as unknown`);
                    return name ? {[BACKLIGHT_COLOR_KEY]: name} : undefined;
                },
            },
            {
                prop: "c4.dmx.blc 00 03",
                parse: (v) => {
                    const n = parseHex(lastValue(v));
                    return n !== undefined && n <= 0xff ? {[BACKLIGHT_BRIGHTNESS_KEY]: Math.round((n * 100) / 255)} : undefined;
                },
            },
        ];
    }

    /** The backlight (`c4.dmx.blc 00 05`, black = off) and its brightness (`blc 00 03`), both tested on the Kitchen Keypad 2026-11-07. */
    private async setBacklight(key: string, value: unknown): Promise<Payload> {
        let cmd: string;
        let shown: unknown;
        let matches: (v: string[]) => boolean;
        if (key === BACKLIGHT_COLOR_KEY) {
            const name = normalizePalette(value);
            const hex = PALETTE_HEX[name];
            cmd = `c4.dmx.blc 00 05 ${hex}`;
            shown = name;
            matches = (v) => lastValue(v)?.toLowerCase() === hex;
        } else {
            const pct = Math.round(toNumber(value, 0, 100));
            const byte = Math.round((pct * 255) / 100);
            cmd = `c4.dmx.blc 00 03 ${hex2(byte)}`;
            shown = pct;
            matches = (v) => parseHex(lastValue(v)) === byte;
        }
        await this.set(cmd);
        this.saveSetting(key, shown);
        void this.ctx.link.scheduleVerify(this, `dmx ${key}`, cmd.split(" ").slice(0, 3).join(" "), matches, () => this.trySet(cmd));
        return {[key]: shown};
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === BACKLIGHT_COLOR_KEY || key === BACKLIGHT_BRIGHTNESS_KEY) return this.setBacklight(key, value);
        // The old bind switch: on = push/release, off = programmed.
        const bound = /^led_(\d+)_bound$/.exec(key);
        if (bound) {
            await super.setValue(`led_${bound[1]}_mode`, toBool(value) ? "push_release" : "programmed", meta);
            return {[`led_${bound[1]}_mode`]: toBool(value) ? "push_release" : "programmed"};
        }
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        return {
            ...super.initialState(),
            [BACKLIGHT_COLOR_KEY]: this.setting<string>(BACKLIGHT_COLOR_KEY) ?? null,
            [BACKLIGHT_BRIGHTNESS_KEY]: this.setting<number>(BACKLIGHT_BRIGHTNESS_KEY) ?? null,
        };
    }
}

export {parseHex};
