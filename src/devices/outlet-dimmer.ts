/**
 * The LOZ-5D1-W plug-in outlet dimmer: two dimmable outlets (700 W in all), `l1` and
 * `l2` as the LOZ-5S1-W's switches. Built from wmariz's quirk (control4_outlet_dimmer.py,
 * with a Control4 HC-300 log in its notes) and lights0123's SmartThings driver, and not
 * yet tested here.
 *
 * Each outlet is a channel of the c4.dm text protocol, driven as the Control4 controller
 * drives it: `0s c4.dm.tv <ch> 00 <pct>` sets a level, `0i c4.dm.rtl <ch> <pct> <ms>`
 * fades to one, and the outlet answers `sa c4.dm.tc <ch> <pct>` (mid-ramp too). Outlet
 * 1 also answers ZCL level on EP1 (wmariz); one path for both keeps them alike.
 */

import {OUTLET_BUTTONS} from "../core/constants";
import type {StateReadResult} from "../core/link";
import {hex2, hex4, lastValue, parseHex, pctToBrightness} from "../core/protocol";
import {type Payload, type SetMeta, toNumber} from "./base";
import {OUTLET_ENDPOINTS} from "./dm";
import {DmxDevice} from "./dmx";

const ENDPOINT_OF: Record<number, string> = {0: "l1", 1: "l2"};
const LIGHT_KEYS = new Set(["state", "brightness", "transition"]);
/** The longest fade it is sent: an hour. */
const MAX_TRANSITION_S = 3_600;

export const lastLevelKey = (ep: string) => `last_level_${ep}`;

export class OutletDimmer extends DmxDevice {
    protected readonly buttons = OUTLET_BUTTONS;

    protected override onAnnounce(ns: string, data: string[]): void {
        if (ns === "c4.dm.tc") {
            const ch = parseHex(data[0]);
            const pct = parseHex(data[1]);
            if (ch !== undefined && pct !== undefined) this.applyLevel(ch, pct);
            return;
        }
        super.onAnnounce(ns, data);
    }

    /** An outlet's level (%) as its light state; a level above 0 is remembered for a plain turn-on. */
    private applyLevel(ch: number, pct: number): void {
        const ep = ENDPOINT_OF[ch];
        if (!ep) return;
        const level = pctToBrightness(Math.min(100, pct));
        if (level > 0) this.saveSetting(lastLevelKey(ep), level);
        this.publish(level > 0 ? {[`state_${ep}`]: "ON", [`brightness_${ep}`]: level} : {[`state_${ep}`]: "OFF"});
    }

    /** Each outlet's level, read with `0g c4.dm.tv <ch> 00` (its reply carries the level last). */
    async readLevels(): Promise<StateReadResult> {
        for (const ch of [0, 1]) {
            const reply = await this.get(`c4.dm.tv ${hex2(ch)} 00`);
            if (this.stopped) return "skipped";
            if (!reply) return "failed";
            const pct = parseHex(lastValue(reply.values));
            if (reply.status === "000" && pct !== undefined) this.applyLevel(ch, pct);
        }
        return "read";
    }

    override stateReader(): () => Promise<StateReadResult> {
        return () => this.readLevels();
    }

    override async getValue(key: string): Promise<void> {
        if (key === "state" || key === "brightness") await this.readLevels();
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (!LIGHT_KEYS.has(key)) return super.setValue(key, value, meta);
        const ep = meta.endpoint ?? "l1";
        const ch = OUTLET_ENDPOINTS[ep];
        if (ch === undefined) throw new Error(`unknown outlet '${ep}'`);
        const msg = meta.message;
        let state = msg.state === undefined ? undefined : String(msg.state).toUpperCase();
        if (state === "TOGGLE") state = String(this.state()[`state_${ep}`] ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
        let level: number;
        if (state === "OFF") level = 0;
        else if (msg.brightness !== undefined) level = Math.round(toNumber(msg.brightness, 0, 254));
        else level = Number(this.setting<number>(lastLevelKey(ep), 254)) || 254;
        const pct = level <= 0 ? 0 : Math.max(1, Math.min(100, Math.round((level * 100) / 254)));
        const seconds = msg.transition === undefined ? 0 : toNumber(msg.transition, 0, MAX_TRANSITION_S);
        const ms = Math.round(seconds * 1000);
        const send =
            ms > 0
                ? () => this.sendText(`0i${hex4(this.nextSeq())} c4.dm.rtl ${hex2(ch)} ${hex2(pct)} ${ms.toString(16).padStart(8, "0")}`)
                : () => this.set(`c4.dm.tv ${hex2(ch)} 00 ${hex2(pct)}`);
        await this.ctx.link.sendWithRecovery(this.ieee, send, "outlet command");
        if (level > 0) this.saveSetting(lastLevelKey(ep), level);
        return level > 0 ? {state: "ON", brightness: level} : {state: "OFF"};
    }
}
