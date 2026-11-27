/**
 * The time of day the c4_device harness keeps: HH:MM:SS text, as now() shows it
 * and the night window compares it; the time and time_pattern triggers that
 * fire at one; and the clock a delay moves on.
 */

import {kindOf} from "./blueprint";
import {intOfText} from "./engine";

/** A time of day as now().strftime('%H:%M:%S') shows it. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/** now().strftime('%H:%M:%S') shows a time of day as HH:MM:SS, and the night window compares those as text. */
export function checkTime(time: string): void {
    if (!TIME_OF_DAY.test(time)) throw new Error(`c4-device: '${time}' is no time of day as now() shows it (HH:MM:SS)`);
}

/** The hours, minutes and seconds of an HH:MM:SS time of day. */
function partsOf(time: string): number[] {
    return time.split(":").map(Number);
}

const shown = (h: number, m: number, s: number) => [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");

/** The time of day `seconds` after `time`, in the whole seconds now() shows; past midnight, the next day's. */
export function later(time: string, seconds: number): string {
    const [h, m, s] = partsOf(time);
    const t = (h * 3600 + m * 60 + s + Math.floor(seconds)) % 86_400;
    return shown(Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60);
}

/**
 * A time of day as cv.time reads it (dt_util.parse_time), as a time selector and
 * a time trigger's `at` take it: H:M or H:M:S, each part an int as the engine's
 * int reads it, second 0 when left out, in range; as HH:MM:SS, or undefined. A
 * fourth part, which parse_time ignores, is not modelled.
 */
export function parseTime(at: unknown): string | undefined {
    const parts = typeof at === "string" ? at.split(":").map(intOfText) : [];
    if (parts.length < 2 || parts.length > 3 || !parts.every((p) => p !== undefined && p >= 0)) return undefined;
    const [h, m, s = 0] = parts as number[];
    return h < 24 && m < 60 && s < 60 ? shown(h, m, s) : undefined;
}

/**
 * Whether `trigger` fires at `time` (HH:MM:SS): a time trigger at its time of
 * day; a time pattern at second 0 of every n-th minute, or of its minute of every
 * hour. Any other form of either is refused; no other trigger fires on the clock.
 */
export function fires(trigger: Record<string, unknown>, time: string): boolean {
    const kind = kindOf(trigger);
    const others = (keys: string[]) => Object.keys(trigger).some((k) => !["platform", "trigger", "id", ...keys].includes(k));
    if (kind === "time") {
        const at = parseTime(trigger.at);
        if (at === undefined || others(["at"])) throw new Error(`c4-device: time trigger ${JSON.stringify(trigger)} is not modelled`);
        return at === time;
    }
    if (kind === "time_pattern") {
        // Every n-th minute (/n), or one minute of every hour (0-59).
        const [, every, at] = /^(?:\/(\d+)|(\d+))$/.exec(String(trigger.minutes)) ?? [];
        if ((every === undefined && (at === undefined || Number(at) > 59)) || others(["minutes"]))
            throw new Error(`c4-device: time pattern ${JSON.stringify(trigger)} is not modelled`);
        const [, minute, second] = partsOf(time);
        return second === 0 && (every !== undefined ? minute % Number(every) === 0 : minute === Number(at));
    }
    return false;
}
