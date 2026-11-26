/**
 * The C4-V-ROSW120 receptacle outlet switch: an in-wall duplex receptacle with one
 * switched outlet and one button. Built from bharat's converter (his issue #2, a
 * unit on firmware 1.1.59) and not yet tested here:
 *
 * - On / off is ZCL On/Off on EP1. Its descriptor doesn't list the cluster, but it
 *   works. It sends no default response, no reports, and refuses binds, so its state
 *   is read back (genOnOff onOff) after each command and each tap.
 * - Its button sends `c4.dmx.bp 00`, `sc 00`, `cc 00 <n>`, and `c4.dmx.tc 00 <level>`
 *   once it has switched the outlet itself.
 * - It answers `c4.dm.tv`, but not `c4.dmx.dim`, `ls` or `amb`; it has no LEDs to set.
 */

import {HA_PROFILE} from "../core/constants";
import type {StateReadResult} from "../core/link";
import {buildZclCommand, CLUSTER_ON_OFF, parseHex} from "../core/protocol";
import type {Payload, SetMeta} from "./base";
import {DmxDevice} from "./dmx";

/** How long after a command or a tap its state is read back: it reports nothing itself. */
export const ROSW_READBACK_DELAY = 1_000;

export class Rosw120 extends DmxDevice {
    protected readonly buttons: Record<number, string> = {0x00: "button_1"};
    private reading: Promise<StateReadResult> | undefined;
    private readback: NodeJS.Timeout | undefined;

    protected override onAnnounce(ns: string, data: string[]): void {
        if (ns === "c4.dmx.tc") {
            // `tc 00 <level>`: it switched the outlet itself, to this level.
            const level = parseHex(data[1]);
            if (level !== undefined) this.publish({state: level > 0 ? "ON" : "OFF"});
            return;
        }
        super.onAnnounce(ns, data);
    }

    /** A tap may have switched the outlet (its tc says so, but a lost one must not leave the state wrong). */
    protected override syncClick(_id: number, count: number): void {
        if (count >= 1) this.readSoon();
    }

    /** Read its on/off back once the last command or tap has settled. */
    private readSoon(): void {
        if (this.readback) clearTimeout(this.readback);
        this.readback = this.after(ROSW_READBACK_DELAY, () => {
            this.readback = undefined;
            void this.readState();
        });
    }

    /** genOnOff onOff on EP1, published as its state. One read at a time. */
    readState(): Promise<StateReadResult> {
        this.reading ??= (async (): Promise<StateReadResult> => {
            try {
                const onOff = (await this.zclRead(1, "genOnOff", ["onOff"])).onOff;
                if (this.stopped) return "skipped";
                if (typeof onOff !== "number" && typeof onOff !== "boolean") return "failed";
                this.publish({state: onOff ? "ON" : "OFF"});
                return "read";
            } catch (error) {
                this.log.debug(`Control4 ${this.name}: on/off read failed: ${error}`);
                return "failed";
            }
        })().finally(() => {
            this.reading = undefined;
        });
        return this.reading;
    }

    override stateReader(): () => Promise<StateReadResult> {
        return () => this.readState();
    }

    override async getValue(key: string): Promise<void> {
        if (key === "state") await this.readState();
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key !== "state") return super.setValue(key, value, meta);
        let s = String(value).toUpperCase();
        if (s === "TOGGLE") s = this.isOn() ? "OFF" : "ON";
        const on = s === "ON";
        // 0x11: cluster-specific, no default response (it never sends one).
        await this.ctx.link.sendWithRecovery(
            this.ieee,
            () => this.sendFrame({profile: HA_PROFILE, cluster: CLUSTER_ON_OFF, srcEp: 1, dstEp: 1, data: buildZclCommand(this.nextTsn(), on ? 0x01 : 0x00)}),
            "on/off command",
        );
        this.readSoon();
        return {state: on ? "ON" : "OFF"};
    }
}
