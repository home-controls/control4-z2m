/**
 * The Gen3 board: the C4-KC120277 configurable keypad, the C4-APD120 dimmer and the
 * C4-SW120277 switch share one board and one firmware family (c4.dmx.*). Each model
 * fits a subset of it: the APD120 and SW120277 use button wires 01 / 05 and LED slots
 * 01 / 04, the KC120277 any of them
 * (docs/research/2026-11-07-kc-apd-sw-capability-map.md).
 *
 * What the three share lives here: the settings read from the device (multi-click
 * times, LED modes, radio power, versions), the health read at each start and
 * re-join (reset reason, fault), and the paddle models' button behaviours and LEDs.
 */

import {
    APD120_TV_PARAMS,
    BMC_DEFAULTS,
    BUTTON_BEHAVIOUR_NAMES,
    BUTTON_BEHAVIOURS,
    type ButtonBehaviour,
    HA_PROFILE,
    LED_MODE_NAMES,
    LED_MODES,
    type LedMode,
    PADDLE_BUTTONS,
    PADDLE_HALVES,
    type PaddleHalf,
    PALETTE_HEX,
    type PaletteName,
    TX_POWER_MAX,
    TX_POWER_MIN,
} from "../core/constants";
import {LED_BRIGHTNESS_KEY, type LedSelect, LedWriter} from "../core/leds";
import type {StateReadResult} from "../core/link";
import {buildZclCommand, CLUSTER_ON_OFF, hex2, lastValue, parseHex, pctToBrightness, scaleHex} from "../core/protocol";
import {AnimationKeys} from "./animkeys";
import {C4Device, type Payload, type SetMeta, toBool, toNumber} from "./base";
import {FadeHold, LoadControl, OFF_TRANSITION_KEY, ON_TRANSITION_KEY, TvParams} from "./dimming";
import {SETTINGS_READ_DELAY, SETTINGS_READ_KEY} from "./dm";
import {DmxDevice} from "./dmx";
import {LedKeys} from "./ledkeys";
import {AmbientSensor, PowerSensor} from "./sensors";

export const RESET_REASON_KEY = "reset_reason";
/** Saved setting: the reset code last read, so a change (a new crash, a reboot) is logged once. */
const RESET_CODE_KEY = "reset_reason_code";
export const TX_POWER_KEY = "tx_power";
/** Saved setting: the TX power was set from Home Assistant, so it is put back if the device loses it. */
const TX_POWER_SET_KEY = "tx_power_set";
/** Saved setting: follow-load LED slots a status colour switched to programmed mode, so a restart still gives them back. */
export const LED_BORROWED_KEY = "led_borrowed";
export const FIRMWARE_VERSION_KEY = "firmware_version";
export const BOOTLOADER_VERSION_KEY = "bootloader_version";
export const FAULT_KEY = "fault";
export const DIMMING_PHASE_KEY = "dimming_phase";


// ---------------------------------------------------------------------------
// Reset reason (c4.sy.ri)
// ---------------------------------------------------------------------------

/** EmberZNet's reset codes (Silicon Labs reset-def.h), as `c4.sy.ri` gives them: base type, then extended type. */
const RESET_BASE: Record<string, string> = {
    UNK: "unknown",
    FIB: "bootloader",
    BTL: "bootloader",
    EXT: "external reset",
    PWR: "power on",
    WDG: "watchdog",
    SW: "software",
    CRS: "crash",
    FSH: "flash failure",
    BAD: "bad image",
    FLT: "fault",
};
const RESET_EXTENDED: Record<string, string> = {
    "EXT PIN": "reset pin",
    "PWR HV": "power on",
    "PWR LV": "brown-out",
    "WDG EXP": "expired",
    "WDG LWM": "low-water mark",
    "SW RBT": "reboot",
    "SW DSL": "deep sleep",
    "CRS AST": "assert",
    "FLT HRD": "hard fault",
    "FLT MEM": "memory fault",
    "FLT BUS": "bus fault",
    "FLT USG": "usage fault",
    "FLT DBG": "debug monitor",
    "FLT DMA": "DMA fault",
    "FLT VCT": "vector table fault",
};
/** Base types worth a warning: the device restarted on its own because something went wrong. */
const RESET_ALARMING = new Set(["CRS", "WDG", "FLT", "FSH", "BAD"]);

/** `CRS AST` -> `crash: assert (CRS AST)`; an unknown code comes back as itself. */
export function describeResetReason(code: string): string {
    const norm = code.trim().replace(/\s+/g, " ");
    const base = norm.split(" ")[0] ?? "";
    const baseText = RESET_BASE[base];
    if (!baseText) return norm || "unknown";
    const ext = RESET_EXTENDED[norm];
    return `${baseText}${ext && ext !== baseText ? `: ${ext}` : ""} (${norm})`;
}

/**
 * A text reply's value: the device quotes it (`" SW RBT"`, the tokenizer keeps the
 * quotes) and may pad the frame with NUL bytes after it. Unquoted, without control
 * bytes, spaces collapsed.
 */
export function textValue(values: string[]): string {
    const quoted = values.find((v) => v.startsWith('"'));
    const raw = quoted ? quoted.replace(/^"|"$/g, "") : values.join(" ");
    return raw
        .replace(/[^\x20-\x7e]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function resetAlarming(code: string): boolean {
    return RESET_ALARMING.has(code.trim().split(/\s+/)[0] ?? "");
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A button behaviour by name; "disabled" (code 05) is refused: it turns every tap into a double tap. */
export function behaviourOf(value: unknown): ButtonBehaviour {
    const text = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if ((BUTTON_BEHAVIOUR_NAMES as string[]).includes(text)) return text as ButtonBehaviour;
    throw new Error(`unknown button behaviour '${value}' (use one of ${BUTTON_BEHAVIOUR_NAMES.join(", ")})`);
}

export function behaviourFromCode(hex: string | undefined): ButtonBehaviour | undefined {
    const code = parseHex(hex);
    return BUTTON_BEHAVIOUR_NAMES.find((b) => BUTTON_BEHAVIOURS[b] === code);
}

/** The Get that reads a button wire's behaviour, saved and shown as `key`. */
export function behaviourRead(dev: C4Device, wire: number, key: string, what: string): SettingRead {
    return {
        prop: `c4.dmx.btn ${hex2(wire)} 01`,
        parse: (v) => {
            const b = behaviourFromCode(lastValue(v));
            if (!b) dev.log.info(`Control4 ${dev.name}: ${what} has a button behaviour the extension doesn't name (${lastValue(v)}); left as it is`);
            return b ? {[key]: b} : undefined;
        },
    };
}

/** A button wire's behaviour: `c4.dmx.btn <wire> 01 <code>` (never 05), saved as `key` and read back after. */
export async function writeBehaviour(dev: C4Device, wire: number, key: string, value: unknown): Promise<Payload> {
    const behaviour = behaviourOf(value);
    const code = hex2(BUTTON_BEHAVIOURS[behaviour]);
    const cmd = `c4.dmx.btn ${hex2(wire)} 01 ${code}`;
    await dev.set(cmd);
    dev.saveSetting(key, behaviour);
    void dev.ctx.link.scheduleVerify(dev, `dmx btn ${hex2(wire)}`, `c4.dmx.btn ${hex2(wire)} 01`, (v) => parseHex(lastValue(v)) === BUTTON_BEHAVIOURS[behaviour], () => dev.trySet(cmd), 500, (v) => {
        const actual = behaviourFromCode(lastValue(v));
        if (!actual) return;
        dev.saveSetting(key, actual);
        dev.publish({[key]: actual});
    });
    return {[key]: behaviour};
}

function modeFromCode(hex: string | undefined): LedMode | undefined {
    const code = parseHex(hex);
    return LED_MODE_NAMES.find((m) => LED_MODES[m] === code);
}

/** A signed byte (`f9` -> -7). */
function signedByte(hex: string | undefined): number | undefined {
    const n = parseHex(hex);
    if (n === undefined || n > 0xff) return undefined;
    return n > 0x7f ? n - 0x100 : n;
}

/** The palette name of a colour, when it is exactly one. */
export function paletteNameOf(hex: string | undefined): PaletteName | undefined {
    const h = (hex ?? "").toLowerCase();
    return (Object.keys(PALETTE_HEX) as PaletteName[]).find((n) => PALETTE_HEX[n] === h);
}

// ---------------------------------------------------------------------------
// The shared base
// ---------------------------------------------------------------------------

/** One setting the device holds: the Get that reads it, and what its reply says as state. */
export interface SettingRead {
    prop: string;
    parse(values: string[]): Payload | undefined;
}

export abstract class Gen3Device extends DmxDevice {
    /** The APD120 and SW120277 report a fault status (Composer's Fault Detection); the keypad has no load. */
    protected readonly hasFault: boolean = false;
    protected anim?: AnimationKeys;
    declare protected led: LedKeys;

    override get ledKeys(): LedKeys {
        return this.led;
    }

    /** The settings read's place in the state-read queue (the health read has the device's own). */
    private get settingsReadKey(): string {
        return `${this.ieee}:settings`;
    }

    override start(hotLoad = false): void {
        super.start(hotLoad);
        // LEDs a status colour had borrowed before a restart keep it, and go back at the next clear.
        this.anim?.animator.seedBorrowed(this.borrowedSlots());
        // After a hot-load too: a device whose settings were never read has them read once.
        if (this.setting(SETTINGS_READ_KEY) === undefined) this.ctx.link.queueStateRead(this.settingsReadKey, () => this.readSettings(), SETTINGS_READ_DELAY);
    }

    override stop(): void {
        this.ctx.link.cancelStateRead(this.settingsReadKey);
        super.stop();
    }

    // -- settings read from the device ----------------------------------------

    /** Every setting this model holds, read once (and again after it may have been reset). */
    protected settingReads(): SettingRead[] {
        const borrowed = this.borrowedSlots();
        const reads: SettingRead[] = BMC_DEFAULTS.map((_, i) => ({
            prop: `c4.dmx.bmc ${hex2(i)}`,
            parse: (v) => {
                const ms = parseHex(lastValue(v));
                return ms !== undefined && ms <= 0xffff ? {[`multiclick_time_${i + 1}`]: ms} : undefined;
            },
        }));
        for (const [key, slot] of this.led.modes) {
            // A slot borrowed for a status colour reads programmed: what it really is was saved before.
            if (borrowed.includes(slot)) continue;
            reads.push({
                prop: `c4.dmx.led ${hex2(slot)} 01`,
                parse: (v) => {
                    const mode = modeFromCode(lastValue(v));
                    if (!mode) this.log.info(`Control4 ${this.name}: LED slot ${slot} is in a mode the extension doesn't name (${lastValue(v)}); left as it is`);
                    return mode ? {[key]: mode} : undefined;
                },
            });
        }
        reads.push(
            {
                prop: "c4.sy.zpw",
                parse: (v) => {
                    const dbm = signedByte(lastValue(v));
                    return dbm === undefined ? undefined : {[TX_POWER_KEY]: dbm};
                },
            },
            {prop: "c4.sy.fwv", parse: (v) => (textValue(v) ? {[FIRMWARE_VERSION_KEY]: textValue(v)} : undefined)},
            {prop: "c4.sy.blv", parse: (v) => (textValue(v) ? {[BOOTLOADER_VERSION_KEY]: textValue(v)} : undefined)},
        );
        return reads;
    }

    /**
     * Read the settings the device holds, so its entities show what it does, not a
     * default: once, and again after it may have been reset (it left the network, or
     * came from another instance). A Get it answers with an error (a firmware without
     * that setting) is skipped. An unanswered one ends the read: what was read so far
     * is kept, and the read is tried again later.
     */
    async readSettings(): Promise<StateReadResult> {
        if (this.stopped || this.setting(SETTINGS_READ_KEY) !== undefined) return "skipped";
        const read: Payload = {};
        let complete = true;
        for (const r of this.settingReads()) {
            const reply = await this.get(r.prop);
            if (this.stopped) return "skipped";
            if (!reply) {
                complete = false;
                break;
            }
            if (reply.status !== "000") continue;
            Object.assign(read, r.parse(reply.values) ?? {});
        }
        this.applyRead(read);
        if (!complete) return "failed";
        this.saveSetting(SETTINGS_READ_KEY, Date.now());
        return "read";
    }

    /** Keep and publish what was read, and log what differed from what was shown. */
    protected applyRead(read: Payload): void {
        if (!Object.keys(read).length) return;
        const shown = this.initialState();
        const changed = Object.keys(read).filter((k) => shown[k] !== read[k]);
        for (const [key, value] of Object.entries(read)) this.saveSetting(key, value);
        this.publish(read);
        if (changed.length) this.log.info(`Control4 ${this.name}: settings read from the device: ${changed.map((k) => `${k} ${shown[k] ?? "-"} -> ${read[k]}`).join(", ")}`);
        else this.log.debug(`Control4 ${this.name}: settings read from the device, as shown`);
    }

    // -- health read at each start and re-join --------------------------------

    override stateReader(): () => Promise<StateReadResult> {
        return () => this.readHealth();
    }

    /** Why it last restarted, its fault status, and its TX power put back if it lost it. */
    private async readHealth(): Promise<StateReadResult> {
        if (this.stopped) return "skipped";
        const ri = await this.get("c4.sy.ri");
        if (this.stopped) return "skipped";
        if (!ri) return "failed";
        if (ri.status === "000") this.noteResetReason(textValue(ri.values));
        if (this.hasFault) {
            const warn = await this.get("c4.dmx.warn 00");
            if (warn?.status === "000") this.noteFault(lastValue(warn.values));
        }
        await this.restoreTxPower();
        return "read";
    }

    private noteResetReason(code: string): void {
        const norm = code.trim().replace(/\s+/g, " ");
        const text = describeResetReason(norm);
        const before = this.setting<string>(RESET_CODE_KEY);
        this.saveSetting(RESET_CODE_KEY, norm);
        this.saveSetting(RESET_REASON_KEY, text);
        this.publish({[RESET_REASON_KEY]: text});
        if (before === norm) return;
        if (resetAlarming(norm)) this.log.warning(`Control4 ${this.name}: it last restarted on a ${text}`);
        else this.log.info(`Control4 ${this.name}: it last restarted on ${text}`);
    }

    /** `c4.dmx.warn 00`: the fault status (Composer's Fault Detection, short circuit or overload); 0 = none. */
    protected noteFault(hex: string | undefined): void {
        const code = parseHex(hex);
        if (code === undefined) return;
        const fault = code !== 0;
        const was = this.setting<boolean>(FAULT_KEY);
        this.saveSetting(FAULT_KEY, fault);
        this.publish({[FAULT_KEY]: fault});
        if (fault && was !== true) this.log.warning(`Control4 ${this.name}: the device reports a fault (c4.dmx.warn 00 = ${hex}): a short circuit or overload on its load?`);
        else if (!fault && was === true) this.log.info(`Control4 ${this.name}: its fault has cleared`);
    }

    protected override onWarning(data: string[]): void {
        // `sa c4.dmx.warn 00 <code>`: only index 00 means anything.
        if (data.length >= 2 && data[0] === "00") this.noteFault(data[1]);
        else if (data.length === 1) this.noteFault(data[0]);
        else super.onWarning(data);
    }

    // -- TX power -------------------------------------------------------------

    private async setTxPower(value: unknown): Promise<Payload> {
        const dbm = Math.round(toNumber(value, TX_POWER_MIN, TX_POWER_MAX));
        const send = () => this.set(`c4.sy.zpw ${hex2(dbm & 0xff)}`);
        await send();
        this.saveSetting(TX_POWER_KEY, dbm);
        this.saveSetting(TX_POWER_SET_KEY, true);
        void this.ctx.link.scheduleVerify(this, "sy.zpw", "c4.sy.zpw", (v) => signedByte(lastValue(v)) === dbm, send, 500, (v) => {
            const actual = signedByte(lastValue(v));
            if (actual === undefined) return;
            this.saveSetting(TX_POWER_KEY, actual);
            this.publish({[TX_POWER_KEY]: actual});
        });
        return {[TX_POWER_KEY]: dbm};
    }

    /** A TX power set from Home Assistant is put back if the device has lost it (whether it survives a power cut is unknown). */
    private async restoreTxPower(): Promise<void> {
        if (!this.setting<boolean>(TX_POWER_SET_KEY, false)) return;
        const want = this.setting<number>(TX_POWER_KEY);
        if (typeof want !== "number") return;
        const reply = await this.get("c4.sy.zpw");
        if (!reply || reply.status !== "000") return;
        const have = signedByte(lastValue(reply.values));
        if (have === undefined || have === want) return;
        this.log.info(`Control4 ${this.name}: its TX power is ${have} dBm, not the ${want} dBm set: putting it back`);
        await this.trySet(`c4.sy.zpw ${hex2(want & 0xff)}`);
    }

    // -- LEDs borrowed for a status colour --------------------------------------

    private borrowedSlots(): number[] {
        const stored = this.setting<unknown>(LED_BORROWED_KEY);
        return Array.isArray(stored) ? stored.filter((s): s is number => typeof s === "number") : [];
    }

    /** The animator borrowed a follow-load LED (switched it to programmed for a status colour), or gave it back. */
    protected noteBorrow(slot: number, borrowed: boolean): void {
        const slots = new Set(this.borrowedSlots());
        if (borrowed) slots.add(slot);
        else slots.delete(slot);
        this.saveSetting(LED_BORROWED_KEY, [...slots].sort((a, b) => a - b));
    }

    // -- keys -------------------------------------------------------------------

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        const m = /^multiclick_time_([123])$/.exec(key);
        if (m) {
            const idx = Number(m[1]) - 1;
            const ms = Math.round(toNumber(value, 50, 5000));
            await this.set(`c4.dmx.bmc ${hex2(idx)} ${ms.toString(16).padStart(4, "0")}`);
            this.saveSetting(key, ms);
            return {[key]: ms};
        }
        if (key === TX_POWER_KEY) return this.setTxPower(value);
        const modeSlot = this.led.modes.get(key);
        if (modeSlot !== undefined) {
            // The user picked a mode: a slot borrowed for a status colour is theirs again.
            this.anim?.animator.forgetBorrowed(modeSlot);
            this.noteBorrow(modeSlot, false);
        }
        if (this.anim?.handles(key)) return this.anim.set(key, value);
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        const out: Payload = {...super.initialState(), ...(this.anim?.initialState() ?? {})};
        BMC_DEFAULTS.forEach((def, i) => {
            out[`multiclick_time_${i + 1}`] = this.setting<number>(`multiclick_time_${i + 1}`, def);
        });
        out[TX_POWER_KEY] = this.setting<number>(TX_POWER_KEY) ?? null;
        for (const k of [RESET_REASON_KEY, FIRMWARE_VERSION_KEY, BOOTLOADER_VERSION_KEY]) out[k] = this.setting<string>(k) ?? null;
        if (this.hasFault) out[FAULT_KEY] = this.setting<boolean>(FAULT_KEY) ?? null;
        return out;
    }
}

// ---------------------------------------------------------------------------
// The paddle models: APD120 and SW120277
// ---------------------------------------------------------------------------

/** The paddle LEDs: on = load-on colour (param 03), off = load-off colour (param 04), the DIM1-Z's key names. */
export const PADDLE_LEDS: LedSelect[] = PADDLE_HALVES.flatMap((h) => [
    {key: `led_${h.half}_on_color`, slots: [h.slot], verb: "active" as const},
    {key: `led_${h.half}_off_color`, slots: [h.slot], verb: "idle" as const},
]);
export const PADDLE_LED_MODES = new Map<string, number>(PADDLE_HALVES.map((h) => [`led_${h.half}_mode`, h.slot]));
export const behaviourKey = (half: PaddleHalf) => `${half}_button_behaviour`;

/** The keys the 12-slot LED bar had, and the new key each one's saved colour moves to. */
const LED_KEY_MIGRATION: Record<string, string[]> = {
    led_top_on_color: ["led_2_active_color", "led_active_color"],
    led_top_off_color: ["led_2_idle_color", "led_idle_color"],
    led_bottom_on_color: ["led_5_active_color", "led_active_color"],
    led_bottom_off_color: ["led_5_idle_color", "led_idle_color"],
};

/** By name: a paddle half (or its Button number) is the LED beside it. */
const PADDLE_LED_NAMES: Record<string, number[]> = {top: [0x01], button_1: [0x01], bottom: [0x04], button_2: [0x04]};

export abstract class PaddleDevice extends Gen3Device {
    protected readonly buttons = PADDLE_BUTTONS;
    protected override readonly hasFault = true;

    constructor(...args: ConstructorParameters<typeof C4Device>) {
        super(...args);
        this.amb = new AmbientSensor(this);
        this.pwr = new PowerSensor(this);
        this.migrateLedKeys();
        this.led = new LedKeys(this, new LedWriter(this, "dmx"), PADDLE_LEDS, PADDLE_LED_MODES);
        this.anim = new AnimationKeys(
            this,
            {
                idleHex: (slot) => this.shownHex(slot),
                dmStored: () => ["000000", "000000"],
                loadOn: () => this.loadOn(),
                verifyDm: () => undefined,
                ledsOf: (name) => PADDLE_LED_NAMES[name],
                // Not known until the settings read: then a status colour is painted without changing it.
                ledMode: (slot) => this.led.mode(slot),
                onBorrow: (slot, borrowed) => this.noteBorrow(slot, borrowed),
            },
            PADDLE_HALVES.map((h) => h.slot),
            "dmx",
        );
    }

    /**
     * What was saved under the 12-slot bar's keys moves to the two LEDs this model has
     * (slots 01 and 04): the colours, and `led_2_bound` / `led_5_bound` as their modes
     * (bound was push/release, unbound programmed).
     */
    private migrateLedKeys(): void {
        for (const [key, olds] of Object.entries(LED_KEY_MIGRATION)) {
            if (this.setting<string>(key) !== undefined) continue;
            const from = olds.map((o) => this.setting<string>(o)).find((v) => v !== undefined);
            if (from !== undefined) this.saveSetting(key, from);
        }
        for (const h of PADDLE_HALVES) {
            const bound = this.setting<boolean>(`led_${h.slot + 1}_bound`);
            if (typeof bound === "boolean" && this.setting<string>(`led_${h.half}_mode`) === undefined) this.saveSetting(`led_${h.half}_mode`, bound ? "push_release" : "programmed");
        }
    }

    private loadOn(): boolean | undefined {
        return this.state().state === undefined ? undefined : this.isOn();
    }

    /** The colour an LED shows when no status colour is on it: in follow-load mode, its colour for the load now. */
    private shownHex(slot: number): string {
        const half = PADDLE_HALVES.find((h) => h.slot === slot)?.half ?? "top";
        const mode = this.led.mode(slot) ?? "follow_load";
        const on = mode === "follow_load" && this.loadOn() === true;
        const name = this.setting<string>(`led_${half}_${on ? "on" : "off"}_color`);
        const hex = name ? (PALETTE_HEX[name as PaletteName] ?? "000000") : "000000";
        return scaleHex(hex, Number(this.setting<number>(LED_BRIGHTNESS_KEY, 100)));
    }

    /** A half's button behaviour as last read or set (its factory behaviour until then). */
    behaviour(half: PaddleHalf): ButtonBehaviour {
        const stored = this.setting<string>(behaviourKey(half));
        if (stored && (BUTTON_BEHAVIOUR_NAMES as string[]).includes(stored)) return stored as ButtonBehaviour;
        return PADDLE_HALVES.find((h) => h.half === half)?.factory ?? "event_only";
    }

    protected override settingReads(): SettingRead[] {
        return [...super.settingReads(), ...PADDLE_HALVES.map((h) => behaviourRead(this, h.wire, behaviourKey(h.half), `its ${h.half} half`))];
    }

    /** A half's button behaviour: `c4.dmx.btn <wire> 01 <code>` (never 05), read back after. */
    protected setBehaviour(half: PaddleHalf, value: unknown): Promise<Payload> {
        const h = PADDLE_HALVES.find((x) => x.half === half) as (typeof PADDLE_HALVES)[number];
        return writeBehaviour(this, h.wire, behaviourKey(half), value);
    }

    /** The SW120277's old paddle_local_control, as button behaviours: on = top on / bottom off, off = both event-only. */
    protected async setLocalControl(value: unknown): Promise<Payload> {
        const on = toBool(value);
        const out: Payload = {};
        for (const h of PADDLE_HALVES) Object.assign(out, await this.setBehaviour(h.half, on ? h.factory : "event_only"));
        return out;
    }

    protected override onPhase(hex: string | undefined): void {
        void hex;
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        for (const h of PADDLE_HALVES) if (key === behaviourKey(h.half)) return this.setBehaviour(h.half, value);
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        const out = super.initialState();
        for (const h of PADDLE_HALVES) out[behaviourKey(h.half)] = this.behaviour(h.half);
        return out;
    }
}

// ---------------------------------------------------------------------------
// The dimmer on the board: the APD120's load, and the keypad dimmer's
// ---------------------------------------------------------------------------

/**
 * Quiet time after the APD120's last c4.dmx.ls in our fade's window before that
 * window ends. An off-fade sits at minimum brightness for about a second before
 * the load switches off and reports 0.
 */
const APD_FADE_SETTLE = 2_000;

/** `c4.dmx.dim`: the dimming phase in use (01 forward, 02 reverse, 00 a relay), most likely. */
const PHASES: Record<number, string> = {0x00: "none", 0x01: "forward", 0x02: "reverse"};

function phaseName(hex: string | undefined): string | undefined {
    const code = parseHex(hex);
    if (code === undefined) return undefined;
    return PHASES[code] ?? "other";
}

/** The keys a Gen3 dimmer's load answers, beside its tv parameters. */
const LOAD_KEYS: ReadonlySet<string> = new Set([
    "state",
    "brightness",
    "transition",
    ON_TRANSITION_KEY,
    OFF_TRANSITION_KEY,
    "set_ramp_rate",
    "set_on_ramp",
    "set_off_ramp",
    "set_on_off_ramps",
]);

/**
 * The dimmer a Gen3 board drives: the APD120's, and the keypad dimmer's (an APD120
 * and a KC120277 in one device). Its light state comes from its own c4.dmx.ls
 * reports alone, within a second of a tap. A tap says nothing sure about the load:
 * an event-only button doesn't move it, and a toggling one may turn it either way.
 */
export class DimmerLoad {
    /**
     * The dimmer's mid-fade c4.dmx.ls reports. It reports to the end of the ramp,
     * so one that stops short (a max-brightness trim) is where the load is.
     */
    private readonly hold: FadeHold;
    readonly tv: TvParams;
    readonly load: LoadControl;

    constructor(private readonly dev: Gen3Device) {
        this.hold = new FadeHold(dev, APD_FADE_SETTLE, {
            apply: (level) => this.applyLevel(level),
            stoppedShort: (held) => this.applyLevel(held),
        });
        this.tv = new TvParams(dev, APD120_TV_PARAMS);
        this.load = new LoadControl(dev, {
            onMove: (s, level) => this.hold.begin(level, s),
            onSent: (delivered) => void this.hold.sent(delivered),
            // Its `rtl` time is this move's own length (tested on the APD120 2026-11-07).
            hardwareFade: "move",
            clampPct: (pct) => this.tv.clampPct(pct),
            liveLevel: () => this.hold.current(),
            // A turn-on from off with a cold start set keeps the cold start (as on the DIM1-Z).
            fadeAllowed: (level) => level <= 0 || dev.isOn() || this.tv.value("cold_start_level") <= 0,
        });
    }

    /** Its `c4.dm.is`: the tv table in slot order (00-0a), one Get for the lot. */
    tableRead(): SettingRead {
        return {
            prop: "c4.dm.is",
            parse: (v) => {
                if (v.length < 11) return undefined;
                const n = v.map((x) => parseHex(x));
                const out: Payload = {};
                const pct = (x: number | undefined) => (x !== undefined && x <= 100 ? x : undefined);
                const put = (key: string, x: number | undefined) => {
                    if (x !== undefined) out[key] = x;
                };
                put("default_on_brightness", pct(n[1]));
                put(ON_TRANSITION_KEY, n[2] === undefined ? undefined : Math.round(n[2] / 100) / 10);
                put(OFF_TRANSITION_KEY, n[3] === undefined ? undefined : Math.round(n[3] / 100) / 10);
                put("hold_ramp_up", n[4]);
                put("hold_ramp_down", n[5]);
                put("max_brightness", pct(n[6]));
                put("min_brightness", pct(n[8]));
                put("cold_start_level", pct(n[9]));
                put("cold_start_time", n[10]);
                return out;
            },
        };
    }

    /** `c4.dmx.dim`: the phase it dims in. */
    phaseRead(): SettingRead {
        return {
            prop: "c4.dmx.dim",
            parse: (v) => {
                const phase = phaseName(lastValue(v));
                return phase ? {[DIMMING_PHASE_KEY]: phase} : undefined;
            },
        };
    }

    onPhase(hex: string | undefined): void {
        const phase = phaseName(hex);
        if (!phase) return;
        this.dev.saveSetting(DIMMING_PHASE_KEY, phase);
        this.dev.publish({[DIMMING_PHASE_KEY]: phase});
    }

    /**
     * `c4.dmx.ls 00 00 <level %> <V> <mA> <W> <VA> <PF x 1000> <energy> 0000`: the
     * level, published as the light's state. False when it carried none.
     */
    onLightState(fields: string[]): boolean {
        const pct = parseHex(fields[2]);
        if (pct === undefined) return false;
        const level = this.hold.report(pctToBrightness(pct));
        if (level !== undefined) this.applyLevel(level);
        return true;
    }

    private applyLevel(level: number): void {
        this.load.noteLevel(level);
        this.dev.publish(level > 0 ? {state: "ON", brightness: level} : {state: "OFF"});
    }

    handles(key: string): boolean {
        return LOAD_KEYS.has(key) || this.tv.find(key) !== undefined;
    }

    async set(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === "state" || key === "brightness" || key === "transition") return this.load.set(meta, true);
        if (key === ON_TRANSITION_KEY || key === OFF_TRANSITION_KEY) return this.load.setTransition(key, value);
        if (key === "set_ramp_rate") return this.load.setRampRate(value);
        if (key === "set_on_ramp" || key === "set_off_ramp" || key === "set_on_off_ramps") return this.load.rampCommand(key, value);
        return this.tv.set(key, value);
    }

    initialState(): Payload {
        return {
            ...this.tv.initialState(),
            [ON_TRANSITION_KEY]: this.load.onTransition(),
            [OFF_TRANSITION_KEY]: this.load.offTransition(),
            [DIMMING_PHASE_KEY]: this.dev.setting<string>(DIMMING_PHASE_KEY) ?? null,
        };
    }
}

// ---------------------------------------------------------------------------
// C4-APD120
// ---------------------------------------------------------------------------

export class Apd120 extends PaddleDevice {
    readonly dimmer = new DimmerLoad(this);

    get load(): LoadControl {
        return this.dimmer.load;
    }

    get tv(): TvParams {
        return this.dimmer.tv;
    }

    protected override settingReads(): SettingRead[] {
        return [this.dimmer.tableRead(), ...super.settingReads(), this.dimmer.phaseRead()];
    }

    protected override onPhase(hex: string | undefined): void {
        this.dimmer.onPhase(hex);
    }

    /** The level, then a power reading (`c4.dmx.ls` fields 3 on). */
    protected override onLightState(fields: string[]): void {
        if (!this.dimmer.onLightState(fields)) return;
        if (!this.pwr?.publishReading(fields.slice(3))) this.pwr?.pollSoon();
    }

    // A tap moves no state here: syncClick stays the base's no-op (DimmerLoad says why).

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (this.dimmer.handles(key)) return this.dimmer.set(key, value, meta);
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        return {...super.initialState(), ...this.dimmer.initialState()};
    }
}

// ---------------------------------------------------------------------------
// C4-SW120277
// ---------------------------------------------------------------------------

/** Old saved flag: both halves were made event-only (paddle_local_control off). */
const DECOUPLE_FLAG = "sw_decoupled";

export class Sw120277 extends PaddleDevice {
    constructor(...args: ConstructorParameters<typeof C4Device>) {
        super(...args);
        // paddle_local_control off was both halves event-only: keep that as their behaviours.
        if (this.setting<boolean>(DECOUPLE_FLAG, false)) {
            for (const h of PADDLE_HALVES) if (this.setting<string>(behaviourKey(h.half)) === undefined) this.saveSetting(behaviourKey(h.half), "event_only");
        }
    }

    protected override onLightState(fields: string[]): void {
        const pct = parseHex(fields[2]);
        if (pct === undefined) return;
        this.publish({state: pct > 0 ? "ON" : "OFF"});
        if (!this.pwr?.publishReading(fields.slice(3))) this.pwr?.pollSoon();
    }

    /**
     * A tap on a half that switches the relay one way: its state, should the relay's
     * own c4.dmx.ls report be lost. A toggling half's state comes from that report
     * alone: it arrives before the tap's count, so flipping on the count would undo it.
     * An event-only or momentary half moves nothing.
     */
    protected override syncClick(id: number, count: number): void {
        if (count < 1) return;
        const h = PADDLE_HALVES.find((x) => x.wire === id);
        if (!h) return;
        const b = this.behaviour(h.half);
        if (b === "load_on") this.publish({state: "ON"});
        else if (b === "load_off") this.publish({state: "OFF"});
    }

    private async onOff(on: boolean): Promise<void> {
        await this.ctx.link.sendWithRecovery(
            this.ieee,
            () =>
                this.sendFrame({
                    profile: HA_PROFILE,
                    cluster: CLUSTER_ON_OFF,
                    srcEp: 1,
                    dstEp: 1,
                    data: buildZclCommand(this.nextTsn(), on ? 0x01 : 0x00),
                }),
            "on/off command",
        );
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === "state") {
            let s = String(value).toUpperCase();
            if (s === "TOGGLE") s = String(this.state().state ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
            await this.onOff(s === "ON");
            return {state: s === "ON" ? "ON" : "OFF"};
        }
        if (key === "paddle_local_control") return this.setLocalControl(value);
        return super.setValue(key, value, meta);
    }
}

