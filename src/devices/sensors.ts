/**
 * Polled sensors of the c4.dmx family (ports of control4_amb_sensor.py and
 * control4_pwr_sensor.py). Replies are only accepted against a Get this poller
 * sent (sequence numbers collide across devices and with probe tools).
 */

import {ENERGY_WH_PER_COUNT} from "../core/constants";
import {hex4, parseHex} from "../core/protocol";
import type {C4Device} from "./base";

export const AMB_PROPERTY = "c4.dmx.amb";
export const PWR_PROPERTY = "c4.dmx.pwr";

const PENDING_TTL = 20_000;
/** Shortest poll period a device option may ask for. */
const MIN_PERIOD = 10_000;
/** While a poll is switched off, how often the option is looked at again. */
const OFF_RECHECK = 60_000;
const FAILURES_BEFORE_BACKOFF = 3;
const BACKOFF = 600_000;

abstract class Poller {
    private pending = new Map<string, number>();
    private failures = 0;
    private timer: NodeJS.Timeout | undefined;

    constructor(
        protected readonly dev: C4Device,
        private readonly periodMs: number,
        private readonly firstDelayMs: number,
        /** Device option (seconds, 0 = off) overriding periodMs. */
        private readonly optionKey: string,
    ) {}

    /** The poll period now: the device option when set, else the default; undefined = off. */
    period(): number | undefined {
        const raw = this.dev.option(this.optionKey);
        if (raw === undefined || raw === null || raw === "") return this.periodMs;
        const seconds = Number(raw);
        if (!Number.isFinite(seconds)) return this.periodMs;
        if (seconds <= 0) return undefined;
        return Math.max(MIN_PERIOD, seconds * 1000);
    }

    protected abstract request(): string;
    protected abstract accept(fields: string[]): boolean;

    start(): void {
        this.schedule(this.firstDelayMs + Math.random() * (this.period() ?? this.periodMs));
    }

    private schedule(ms: number): void {
        this.dev.cancel(this.timer);
        this.timer = this.dev.after(ms, async () => {
            const period = this.period();
            if (period === undefined) {
                this.schedule(OFF_RECHECK);
                return;
            }
            try {
                await this.pollOnce();
                this.failures = 0;
            } catch {
                this.failures++;
            }
            const base = this.failures >= FAILURES_BEFORE_BACKOFF ? Math.max(BACKOFF, period) : period;
            this.schedule(base * (0.9 + Math.random() * 0.2));
        });
    }

    async pollOnce(): Promise<void> {
        const seq = hex4(this.dev.nextSeq());
        const now = this.dev.ctx.now();
        for (const [s, ts] of this.pending) if (now - ts >= PENDING_TTL) this.pending.delete(s);
        this.pending.set(seq, now);
        await this.dev.sendText(`0g${seq} ${this.request()}`);
    }

    /** A `0r<seq> 000 <prop> <fields...>` reply; true when it was ours. */
    reply(seq: string, fields: string[]): boolean {
        const sentAt = this.pending.get(seq);
        if (sentAt === undefined) return false;
        this.pending.delete(seq);
        if (this.dev.ctx.now() - sentAt >= PENDING_TTL) return false;
        return this.accept(fields);
    }
}

export class AmbientSensor extends Poller {
    constructor(dev: C4Device) {
        super(dev, 30_000, 45_000, "ambient_light_poll");
    }

    protected request(): string {
        return `${AMB_PROPERTY} 00`;
    }

    static parse(fields: string[]): number | undefined {
        const v = parseHex(fields[0]);
        return v !== undefined && v >= 0 && v <= 0xff ? v : undefined;
    }

    protected accept(fields: string[]): boolean {
        const level = AmbientSensor.parse(fields);
        if (level === undefined) return false;
        this.dev.publish({ambient_light: level});
        return true;
    }

    /** Unsolicited `sa c4.dmx.amb <val>`. */
    announce(fields: string[]): void {
        const level = AmbientSensor.parse(fields);
        if (level !== undefined) this.dev.publish({ambient_light: level});
    }
}

const PWR_EVENT_DEBOUNCE = 2_000;
const PWR_EVENT_DELAY = 800;

/** Saved settings: the energy counter's last raw value, and what its drops have taken off it. */
export const ENERGY_RAW_KEY = "energy_raw";
export const ENERGY_OFFSET_KEY = "energy_offset";

/**
 * One `c4.dmx.pwr` reading (the same seven fields follow the level in a
 * `c4.dmx.ls` announcement): volts, mA, watts, VA, power factor x 1000, the
 * energy counter, and 0. Measured on an APD120 (fw 5.1.1, 2026-11-07):
 * V x A = VA and W / VA = PF on every reading.
 */
export interface PowerReading {
    voltage: number;
    current: number;
    power: number;
    power_apparent: number;
    power_factor: number;
    /** The raw energy counter (~1.27 Wh a count). It drops at a reboot, to its last flash save. */
    energyCount: number;
}

export class PowerSensor extends Poller {
    private lastTrigger = Number.NEGATIVE_INFINITY;

    constructor(dev: C4Device) {
        super(dev, 30_000, 20_000, "power_poll");
    }

    protected request(): string {
        return PWR_PROPERTY;
    }

    static parse(fields: string[]): PowerReading | undefined {
        if (fields.length < 6) return undefined;
        const v = fields.slice(0, 6).map((f) => parseHex(f));
        if (v.some((x) => x === undefined)) return undefined;
        const [volts, ma, watts, va, pf, count] = v as number[];
        return {voltage: volts, current: ma / 1000, power: watts, power_apparent: va, power_factor: pf / 1000, energyCount: count};
    }

    /**
     * The energy total in kWh, which never falls. The counter drops at a reboot (to
     * its last flash save: 2932 -> 2000 on the APD120), and Home Assistant reads a
     * drop in a total_increasing sensor as a meter reset, counting the difference
     * twice. So what a drop takes off goes into a saved offset, and raw + offset goes out.
     */
    energy(count: number): number {
        const last = this.dev.setting<number>(ENERGY_RAW_KEY);
        let offset = Number(this.dev.setting<number>(ENERGY_OFFSET_KEY, 0)) || 0;
        if (typeof last === "number" && count < last) {
            offset += last - count;
            this.dev.saveSetting(ENERGY_OFFSET_KEY, offset);
            this.dev.log.info(
                `Control4 ${this.dev.name}: its energy counter fell from ${last} to ${count} (a reboot restores its last save); the total carries on from ${last}`,
            );
        }
        if (last !== count) this.dev.saveSetting(ENERGY_RAW_KEY, count);
        return Math.round((count + offset) * ENERGY_WH_PER_COUNT) / 1000;
    }

    /** Publish a reading, from a poll reply or a c4.dmx.ls announcement. False when it doesn't parse. */
    publishReading(fields: string[]): boolean {
        const r = PowerSensor.parse(fields);
        if (!r) return false;
        const {energyCount, ...values} = r;
        this.dev.publish({...values, energy: this.energy(energyCount)});
        return true;
    }

    protected accept(fields: string[]): boolean {
        return this.publishReading(fields);
    }

    /** Read power right after a load change (debounced, after the ramp settles). */
    pollSoon(): void {
        const now = this.dev.ctx.now();
        if (now - this.lastTrigger < PWR_EVENT_DEBOUNCE) return;
        this.lastTrigger = now;
        this.dev.after(PWR_EVENT_DELAY, () => this.pollOnce());
    }
}
