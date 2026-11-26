/**
 * Load control shared by the dimmers (APD120, DIM1-Z) and the dimmer-style
 * relays (FS1-Z): ZCL Move-to-Level-with-On/Off on EP1, the on/off fade pushed
 * to the device's own ramp table (c4.dm.tv 02/03), last-lit-level memory, the
 * hold on the dimmers' mid-fade level reports and the c4.dm.tv parameter numbers.
 */

import {DM_TV_PARAMS, HA_PROFILE, RAMP_IDX_OFF, RAMP_IDX_ON, type TvParam} from "../core/constants";
import {CLUSTER_LEVEL, hex2, hex4, moveToLevelWithOnOff, parseHex, pctToBrightness} from "../core/protocol";
import {type C4Device, type Payload, type SetMeta, toBool, toNumber} from "./base";

export const DEFAULT_ON_LEVEL = 191;
const LEVEL_SETTLE = 2_000;

export const ON_TRANSITION_KEY = "on_transition";
export const OFF_TRANSITION_KEY = "off_transition";
const DEFAULT_ON_TRANSITION = 0.8;
const DEFAULT_OFF_TRANSITION = 2.0;

export class LoadControl {
    private settleTimer: NodeJS.Timeout | undefined;
    private lastOnLevel: number | undefined;

    constructor(
        private readonly dev: C4Device,
        private readonly options: {
            fixedOnLevel?: number;
            minOnTransition?: number;
            minOffTransition?: number;
            /** Called as a level command goes out, with its fade time and target level (0 = off). */
            onMove?: (transitionSeconds: number, level: number) => void;
            /** Called once that command is delivered (after any retry; the fade starts now) or has failed. */
            onSent?: (delivered: boolean) => void;
            /**
             * A `transition` the dimmer fades itself (`0i c4.dm.rtl`), and what its time
             * means there: "sweep", a full 0-100 % sweep (the DIM1-Z), or "move", this
             * move's own length (the APD120). Both tested 2026-11-07.
             */
            hardwareFade?: "sweep" | "move";
            /** The level % a fade may end at (its min / max brightness); a fade to 0 is never clamped. */
            clampPct?: (pct: number) => number;
            /** Where the load is now (0-254) while a fade of ours runs: its last report, not the published target. */
            liveLevel?: () => number | undefined;
            /**
             * False when a hardware fade must not be used for this move. A fade from off skips
             * the cold start (tested on a DIM1-Z, 2026-11-08), so a load that needs one is
             * turned on with the level command, which keeps it.
             */
            fadeAllowed?: (level: number) => boolean;
        } = {},
    ) {}

    onTransition(): number {
        return Number(this.dev.setting<number>(ON_TRANSITION_KEY, DEFAULT_ON_TRANSITION));
    }

    offTransition(): number {
        return Number(this.dev.setting<number>(OFF_TRANSITION_KEY, DEFAULT_OFF_TRANSITION));
    }

    /** A level the device reported (0-254). Commits it as "last lit" once settled. */
    noteLevel(level: number): void {
        this.dev.cancel(this.settleTimer);
        this.settleTimer = undefined;
        if (level <= 0) return; // never remember 0; a fade to off must not overwrite it
        this.settleTimer = this.dev.after(LEVEL_SETTLE, () => {
            this.lastOnLevel = level;
            this.dev.saveSetting("last_level", level);
        });
    }

    lastLevel(): number | undefined {
        return this.lastOnLevel ?? this.dev.setting<number>("last_level");
    }

    onLevel(): number {
        if (this.options.fixedOnLevel) return this.options.fixedOnLevel;
        const last = this.lastLevel();
        if (last) return last;
        const cur = Number(this.dev.state().brightness);
        return cur > 0 ? cur : DEFAULT_ON_LEVEL;
    }

    /** Send Move-to-Level-with-On/Off (recovering once from a delivery failure). */
    async moveTo(level: number, transitionSeconds: number): Promise<void> {
        const dev = this.dev;
        const tenths = Math.round(transitionSeconds * 10);
        dev.log.debug(`Control4 ${dev.name} -> ZCL move_to_level_with_on_off level=${level} transition=${tenths / 10}s`);
        this.options.onMove?.(tenths / 10, level);
        try {
            await dev.ctx.link.sendWithRecovery(
                dev.ieee,
                () =>
                    dev.sendFrame({
                        profile: HA_PROFILE,
                        cluster: CLUSTER_LEVEL,
                        srcEp: 1,
                        dstEp: 1,
                        data: moveToLevelWithOnOff(dev.nextTsn(), level, tenths),
                    }),
                "level command",
            );
        } catch (error) {
            this.options.onSent?.(false);
            throw error;
        }
        this.options.onSent?.(true);
    }

    /**
     * A fade the dimmer runs itself: `0i<seq> c4.dm.rtl 00 <level %> <ms>`, one frame
     * for a fade of any length, where a ZCL level command takes the dimmer's stored
     * fades. The target is held to the dimmer's min / max brightness. Returns the level
     * (0-254) it fades to.
     */
    async fadeTo(level: number, seconds: number): Promise<number> {
        const dev = this.dev;
        let pct = level <= 0 ? 0 : Math.max(1, Math.min(100, Math.round((level * 100) / 254)));
        if (pct > 0 && this.options.clampPct) {
            const held = this.options.clampPct(pct);
            if (held !== pct) {
                pct = held;
                level = pctToBrightness(pct);
            }
        }
        let ms = Math.round(seconds * 1000);
        if (this.options.hardwareFade === "sweep") {
            // Its time is a full 0-100 % sweep: a move of |b - a| points takes that share of it.
            const live = this.options.liveLevel?.();
            const from = live ?? (dev.isOn() ? Number(dev.state().brightness) || 0 : 0);
            const fromPct = Math.round((from * 100) / 254);
            const span = Math.abs(pct - fromPct);
            if (span > 0) ms = Math.round((ms * 100) / span);
        }
        ms = Math.max(0, Math.min(0x7fffffff, ms));
        const text = `c4.dm.rtl 00 ${hex2(pct)} ${ms.toString(16).padStart(8, "0")}`;
        dev.log.debug(`Control4 ${dev.name} -> hardware fade to ${pct} % over ${seconds}s (${text})`);
        this.options.onMove?.(seconds, level);
        try {
            await dev.ctx.link.sendWithRecovery(dev.ieee, () => dev.sendText(`0i${hex4(dev.nextSeq())} ${text}`), "fade command");
        } catch (error) {
            this.options.onSent?.(false);
            throw error;
        }
        this.options.onSent?.(true);
        return level;
    }

    /** /set for state / brightness / transition (one call per message). */
    async set(meta: SetMeta, dimmable: boolean): Promise<Payload> {
        const msg = meta.message;
        const transitionOverride = msg.transition !== undefined ? toNumber(msg.transition, 0, 6553) : undefined;
        let state = msg.state !== undefined ? String(msg.state).toUpperCase() : undefined;
        const brightness = dimmable && msg.brightness !== undefined ? Math.round(toNumber(msg.brightness, 0, 254)) : undefined;
        const current = String(this.dev.state().state ?? "OFF").toUpperCase();
        if (state === "TOGGLE") state = current === "ON" ? "OFF" : "ON";
        // A transition asked for: the dimmer fades itself, for exactly that long.
        const hardware = this.options.hardwareFade !== undefined && transitionOverride !== undefined && transitionOverride > 0;
        const fadeFor = (level: number) => hardware && (this.options.fadeAllowed?.(level) ?? true);

        if (state === "OFF" || (brightness === 0 && state !== "ON")) {
            if (fadeFor(0)) {
                await this.fadeTo(0, transitionOverride as number);
                return {state: "OFF"};
            }
            const t = Math.max(transitionOverride ?? this.offTransition(), this.options.minOffTransition ?? 0);
            await this.moveTo(0, t);
            return {state: "OFF"};
        }
        let level = brightness !== undefined && brightness > 0 ? brightness : this.onLevel();
        if (fadeFor(level)) level = await this.fadeTo(level, transitionOverride as number);
        else await this.moveTo(level, Math.max(transitionOverride ?? this.onTransition(), this.options.minOnTransition ?? 0));
        if (!dimmable) return {state: "ON"};
        return {state: "ON", brightness: level};
    }

    /**
     * Any ramp-table slot: `{"set_ramp_rate": {"index": 4, "time_ms": 3000}}`
     * (the ZHA ramp cluster's set_ramp_rate). Slots 2 / 3 are the on / off fade.
     */
    async setRampRate(value: unknown): Promise<Payload | undefined> {
        const v = (value && typeof value === "object" ? value : {}) as {index?: unknown; time_ms?: unknown};
        const idx = Math.round(toNumber(v.index, 1, 0x0a));
        if (![1, 2, 3, 4, 5, 6, 8, 9, 10].includes(idx)) throw new Error(`ramp index ${idx} is not one of 01-06, 08-0a`);
        const ms = Math.round(toNumber(v.time_ms, 0, 0xffff));
        await this.dev.set(`c4.dm.tv 00 ${hex2(idx)} ${ms.toString(16).padStart(4, "0")}`);
        if (idx === RAMP_IDX_ON || idx === RAMP_IDX_OFF) {
            const key = idx === RAMP_IDX_ON ? ON_TRANSITION_KEY : OFF_TRANSITION_KEY;
            const seconds = Math.round(ms / 100) / 10;
            this.dev.saveSetting(key, seconds);
            return {[key]: seconds};
        }
        return undefined;
    }

    /** The ZHA ramp cluster's commands: set_on_ramp / set_off_ramp / set_on_off_ramps ({time_ms ...}). */
    async rampCommand(key: string, value: unknown): Promise<Payload | undefined> {
        const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
        const out: Payload = {};
        const apply = async (index: number, ms: unknown) => Object.assign(out, (await this.setRampRate({index, time_ms: ms})) ?? {});
        if (key === "set_on_ramp") await apply(RAMP_IDX_ON, v.time_ms);
        else if (key === "set_off_ramp") await apply(RAMP_IDX_OFF, v.time_ms);
        else if (key === "set_on_off_ramps") {
            await apply(RAMP_IDX_ON, v.on_time_ms);
            await apply(RAMP_IDX_OFF, v.off_time_ms);
        }
        return out;
    }

    /** on_transition / off_transition: persist and push to the device ramp table. */
    async setTransition(key: string, value: unknown): Promise<Payload> {
        const seconds = Math.round(toNumber(value, 0, 60) * 10) / 10;
        const idx = key === ON_TRANSITION_KEY ? RAMP_IDX_ON : RAMP_IDX_OFF;
        const ms = Math.max(0, Math.min(0xffff, Math.round(seconds * 1000)));
        await this.dev.set(`c4.dm.tv 00 ${hex2(idx)} ${ms.toString(16).padStart(4, "0")}`);
        this.dev.saveSetting(key, seconds);
        return {[key]: seconds};
    }
}

/**
 * The level a dimmer reports once it has reached `level`: a whole percent,
 * floor(level / 2.55) (127 comes back as 49 %, published 124). A ramp's
 * reports are only 2-3 levels apart, so nothing looser tells arrival apart
 * from the step before it.
 */
function reportedLevel(level: number): number {
    return pctToBrightness(Math.floor((level * 100) / 255));
}

/**
 * Our own fade in flight. The dimmers report their level all the way through a
 * ramp, so an off-fade would publish "ON 48" after our "OFF" (and an on-fade
 * "ON 8" after our "ON 254"). Those in-between reports are held until the fade
 * reaches its target or its window ends. The window (fade time + settle) runs
 * from delivery, and every held report keeps it open another settle.
 *
 * The report that reaches the target publishes the target itself, not its
 * whole percent: a set to 60 would otherwise show 60, then 58. So does the
 * same report again (the APD120 sometimes repeats its last), until the load
 * reports another level.
 */
export class FadeHold {
    private fade: {target: number; ms: number; timer: NodeJS.Timeout | undefined; endsAt: number; held: number | undefined} | undefined;
    /** The fade that arrived last: its target and the report that said so. */
    private landed: {target: number; level: number} | undefined;

    constructor(
        private readonly dev: C4Device,
        private readonly settleMs: number,
        private readonly options: {
            /** Publish a level (0-254) as the load's state. */
            apply: (level: number) => void;
            /** The window ended on a held report on the target's side of on/off: find where the load stopped. */
            stoppedShort: (held: number) => void;
        },
    ) {}

    /** The level the load last reported (0-254) while a fade of ours runs; undefined otherwise. */
    current(): number | undefined {
        return this.fade?.held;
    }

    /** A level command of ours goes out (LoadControl's onMove): holds reports from now. */
    begin(target: number, transitionSeconds: number): void {
        this.dev.cancel(this.fade?.timer);
        this.fade = {target, ms: transitionSeconds * 1000 + this.settleMs, timer: undefined, endsAt: 0, held: undefined};
        this.landed = undefined;
    }

    /**
     * That command was delivered or has failed (LoadControl's onSent). A slow
     * mesh (or a retry) delivers it late: the ramp starts then. Returns the
     * window it opened, in ms (undefined: no fade of ours is waiting).
     */
    sent(delivered: boolean): number | undefined {
        const fade = this.fade;
        if (!fade) return undefined;
        if (!delivered) {
            // No fade of ours is coming: what the dimmer reported is its own doing.
            this.fade = undefined;
            if (fade.held !== undefined) this.options.apply(fade.held);
            return undefined;
        }
        this.arm(fade, fade.ms);
        return fade.ms;
    }

    /** The level to publish for a report (0-254); undefined while it is a step of our fade. */
    report(level: number): number | undefined {
        const fade = this.fade;
        if (!fade) {
            if (this.landed?.level === level) return this.landed.target;
            this.landed = undefined;
            return level;
        }
        const arrived = fade.target === 0 ? level === 0 : level === reportedLevel(fade.target);
        if (arrived) {
            this.dev.cancel(fade.timer);
            this.fade = undefined;
            this.landed = {target: fade.target, level};
            return fade.target;
        }
        fade.held = level;
        // Still ramping: keep holding a settle past this report (once delivered).
        if (fade.timer) this.arm(fade, this.settleMs);
        return undefined;
    }

    /** Keep the window open at least `ms` from now (never shortens it). */
    private arm(fade: NonNullable<typeof this.fade>, ms: number): void {
        const endsAt = Date.now() + ms;
        if (fade.timer && endsAt <= fade.endsAt) return;
        this.dev.cancel(fade.timer);
        fade.endsAt = endsAt;
        fade.timer = this.dev.after(ms, () => this.end(fade));
    }

    /**
     * The window ended without the target report. A held report on the other
     * side of on/off is real (the paddle reversed the fade): publish it. One on
     * the same side may be where the load stopped: the device finds out.
     */
    private end(fade: NonNullable<typeof this.fade>): void {
        if (this.fade !== fade) return;
        this.fade = undefined;
        const held = fade.held;
        if (held === undefined) return;
        if (held > 0 !== fade.target > 0) this.options.apply(held);
        else this.options.stoppedShort(held);
    }
}

/** The c4.dm.tv parameter numbers (min/max/default brightness, hold ramps, the DIM1-Z's cold start). */
export class TvParams {
    constructor(
        private readonly dev: C4Device,
        private readonly params: TvParam[] = DM_TV_PARAMS,
    ) {}

    find(key: string): TvParam | undefined {
        return this.params.find((p) => p.key === key);
    }

    /** A parameter's stored value (its factory default if never written). */
    value(key: string): number {
        const p = this.find(key) as TvParam;
        return Number(this.dev.setting<number>(p.key, p.default));
    }

    initialState(): Payload {
        const out: Payload = {};
        for (const p of this.params) out[p.key] = this.dev.setting<number>(p.key, p.default);
        return out;
    }

    /** A level % held to the dimmer's min and max brightness. */
    clampPct(pct: number): number {
        return Math.max(this.value("min_brightness"), Math.min(this.value("max_brightness"), pct));
    }

    async set(key: string, value: unknown): Promise<Payload> {
        const p = this.find(key) as TvParam;
        const v = Math.round(p.kind === "percent" ? toNumber(value, 0, 100) : toNumber(value, 0, 65535));
        const send = () => this.dev.set(`c4.dm.tv 00 ${hex2(p.index)} ${v.toString(16).padStart(8, "0")}`);
        await send();
        this.dev.saveSetting(p.key, v);
        void this.dev.ctx.link.scheduleVerify(
            this.dev,
            `dm.tv ${hex2(p.index)}`,
            `c4.dm.tv 00 ${hex2(p.index)}`,
            (values) => parseHex(values[values.length - 1]) === v,
            send,
            500,
            (values) => {
                const actual = parseHex(values[values.length - 1]);
                if (actual === undefined) return;
                this.dev.saveSetting(p.key, actual);
                this.dev.publish({[p.key]: actual});
            },
        );
        return {[p.key]: v};
    }
}

export {toBool};
