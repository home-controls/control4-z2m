/**
 * C4-Z2IO-ZP IO / garage-door module (port of c4_z2io_zp.py and
 * control4_z2io_zp.py). Its ASCII frames go EP197 -> EP197.
 *
 *   c4.z2x.cts  contact bitmask (bit N = input N+1; bit set = closed)
 *   c4.z2x.rls  relay bitmask
 *   c4.z2x.rlc N / rlo N  energise / release relay N
 *   c4.z2x.opt  IO mode, c4.z2x.tmpi / tmpe (centikelvin), c4.z2x.thumi (% x100)
 */

import {Z2IO_CONTACTS_HW, Z2IO_DEFAULT_MODE, Z2IO_MODES} from "../core/constants";
import {hex4, type ParsedFrame, parseHex} from "../core/protocol";
import {C4Device, type Payload, type SetMeta, toBool, toNumber} from "./base";

export const Z2IO_EP = 197;
const TEMP_NO_PROBE = 0x5b13; // 233.15 K = -40 C: no probe connected
const DEFAULT_PULSE_MS = 500;

interface Reply {
    status: string;
    prop?: string;
    values: string[];
}

export function z2ioModeName(mode: number): string {
    return Z2IO_MODES[mode]?.name ?? Z2IO_MODES[Z2IO_DEFAULT_MODE].name;
}

export function z2ioModeFromName(name: unknown): number | undefined {
    const n = Number(name);
    if (Number.isInteger(n) && Z2IO_MODES[n]) return n;
    for (const [k, v] of Object.entries(Z2IO_MODES)) if (v.name === name) return Number(k);
    return undefined;
}

export class Z2io extends C4Device {
    private pending = new Map<string, (r: Reply | undefined) => void>();
    private provisioned = false;
    private contacts: (boolean | undefined)[] = [];
    private relays: boolean[] = [];

    get mode(): number {
        const m = Number(this.setting<number>("z2io_mode", Z2IO_DEFAULT_MODE));
        return Z2IO_MODES[m] ? m : Z2IO_DEFAULT_MODE;
    }

    get relayCount(): number {
        return Z2IO_MODES[this.mode].relays;
    }

    get contactCount(): number {
        return Z2IO_MODES[this.mode].contacts;
    }

    override sendText(text: string, dstEp = Z2IO_EP, srcEp = Z2IO_EP): Promise<void> {
        return super.sendText(text, dstEp, srcEp);
    }

    /** `0s|0g<seq> <prop> <args>` and wait for the matching `0r` (timeout from when it went out). */
    private async request(kind: "s" | "g", prop: string, args: string[] = [], timeout = 5_000): Promise<Reply | undefined> {
        const seq = hex4(this.nextSeq());
        let timer: NodeJS.Timeout | undefined;
        let finish: (r: Reply | undefined) => void = () => undefined;
        const reply = new Promise<Reply | undefined>((resolve) => {
            finish = resolve;
        });
        this.pending.set(seq, (r) => {
            this.cancel(timer);
            this.pending.delete(seq);
            finish(r);
        });
        try {
            await this.sendText([`0${kind}${seq}`, prop, ...args].join(" "));
        } catch (error) {
            this.pending.delete(seq);
            this.log.warning(`Control4 ${this.name}: ${prop} failed: ${error}`);
            return undefined;
        }
        if (this.pending.has(seq)) {
            timer = this.after(timeout, () => {
                this.pending.delete(seq);
                finish(undefined);
            });
        }
        return reply;
    }

    override start(hotLoad = false): void {
        // Provisioned on its first frame before the hot-load: not again.
        if (hotLoad) this.provisioned = true;
    }

    override stop(): void {
        super.stop();
        // Nothing may wait on a reply that can no longer arrive.
        for (const settle of [...this.pending.values()]) settle(undefined);
        this.pending.clear();
    }

    override handleAscii(frame: ParsedFrame): void {
        if (!this.provisioned) {
            this.provisioned = true;
            this.spawn(this.initialize());
        }
        super.handleAscii(frame);
    }

    protected override onReply(frame: ParsedFrame): void {
        const t = frame.tokens;
        const r: Reply = {status: t[1], prop: t[2], values: t.slice(3)};
        this.pending.get(frame.seq)?.(r);
        if (r.status === "000" && r.prop) this.update(r.prop, r.values);
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        this.update(ns, data);
    }

    private update(prop: string, values: string[]): void {
        const v = values[0];
        switch (prop) {
            case "c4.z2x.cts":
                this.updateContacts(parseHex(v));
                return;
            case "c4.z2x.rls":
                this.updateRelays(parseHex(v));
                return;
            case "c4.z2x.tmpi": {
                const raw = parseHex(v);
                if (raw !== undefined) this.publish({temperature: Math.round((raw * 0.01 - 273.15) * 100) / 100});
                return;
            }
            case "c4.z2x.tmpe": {
                const raw = parseHex(v);
                if (raw !== undefined && raw !== TEMP_NO_PROBE) this.publish({external_temperature: Math.round((raw * 0.01 - 273.15) * 100) / 100});
                return;
            }
            case "c4.z2x.thumi": {
                const raw = parseHex(v);
                if (raw !== undefined) this.publish({humidity: Math.round(raw) / 100});
                return;
            }
            case "c4.sy.fwv":
                if (v) this.publish({firmware: v});
                return;
        }
    }

    private updateContacts(cts: number | undefined): void {
        if (cts === undefined) return;
        const changes: Payload[] = [];
        const out: Payload = {};
        for (let ch = 0; ch < this.contactCount; ch++) {
            const closed = Boolean(cts & (1 << ch));
            out[`contact_${ch + 1}`] = closed;
            if (this.contacts[ch] !== closed) {
                changes.push({channel: ch + 1, state: closed ? "closed" : "open", previous: this.contacts[ch] === undefined ? "unknown" : this.contacts[ch] ? "closed" : "open"});
                this.contacts[ch] = closed;
            }
        }
        this.publish(out);
        if (changes.length) this.emitEvent("contact_state_changed", {action_changes: changes, action_cts_raw: cts});
    }

    private updateRelays(rls: number | undefined): void {
        if (rls === undefined) return;
        const changes: Payload[] = [];
        const out: Payload = {};
        for (let ch = 0; ch < this.relayCount; ch++) {
            const on = Boolean(rls & (1 << ch));
            out[`relay_${ch + 1}`] = on ? "ON" : "OFF";
            if (this.relays[ch] !== on) {
                changes.push({channel: ch + 1, on});
                this.relays[ch] = on;
            }
        }
        this.publish(out);
        if (changes.length) this.emitEvent("relay_state_changed", {action_changes: changes, action_rls_raw: rls});
    }

    /** Two-pass provisioning as the Director does it, then a state poll. */
    async initialize(): Promise<void> {
        const opt = String(this.mode);
        const step = () => this.sleep(50);
        await this.request("s", "c4.z2x.ctd", ["1", "1f4"]);
        await step();
        await this.request("s", "c4.z2x.opt", [opt]);
        await step();
        await this.request("g", "c4.z2x.cts");
        await this.request("g", "c4.z2x.rls");
        for (let ch = 1; ch <= this.relayCount; ch++) await this.request("g", "c4.z2x.rlp", [String(ch)]);
        for (const prop of ["c4.z2x.ana0", "c4.z2x.ana1"]) await this.request("g", prop, [], 2_000);
        for (const prop of ["c4.sy.fwv", "c4.sy.blv", "c4.z2x.ldm", "c4.z2x.zmac", "c4.z2x.zpid", "c4.z2x.zepid", "c4.z2x.znid", "c4.z2x.zchan"]) {
            await this.request("g", prop, [], 3_000);
            await step();
        }
        await this.request("s", "c4.sy.zpc", ["348"]);
        await this.request("s", "c4.z2x.ctd", ["1", "1f4"]);
        await this.request("s", "c4.z2x.opt", [opt]);
        await this.poll();
        this.log.info(`Control4 ${this.name}: IO module provisioned (mode ${z2ioModeName(this.mode)})`);
    }

    async poll(): Promise<void> {
        const props: string[] = [];
        if (this.contactCount > 0) props.push("c4.z2x.cts");
        if (this.relayCount > 0) props.push("c4.z2x.rls");
        props.push("c4.z2x.tmpi", "c4.z2x.tmpe", "c4.z2x.thumi");
        for (const prop of props) {
            await this.request("g", prop);
            await this.sleep(300);
        }
    }

    private relayChannel(key: string): number {
        const ch = Number(/^relay_(\d)/.exec(key)?.[1]);
        if (!(ch >= 1 && ch <= this.relayCount)) throw new Error(`relay ${ch} is not available in IO mode ${z2ioModeName(this.mode)}`);
        return ch;
    }

    private async relay(ch: number, on: boolean): Promise<boolean> {
        const r = await this.request("s", on ? "c4.z2x.rlc" : "c4.z2x.rlo", [String(ch)]);
        return r?.status === "000";
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (/^relay_[12]$/.test(key)) {
            const ch = this.relayChannel(key);
            let s = String(value).toUpperCase();
            if (s === "TOGGLE") s = this.relays[ch - 1] ? "OFF" : "ON";
            if (!(await this.relay(ch, s === "ON"))) throw new Error(`relay ${ch} did not acknowledge`);
            return {[key]: s === "ON" ? "ON" : "OFF"};
        }
        if (/^relay_[12]_pulse$/.test(key)) {
            const ch = this.relayChannel(key);
            const custom = value && typeof value === "object" ? (value as {pulse_ms?: unknown}).pulse_ms : undefined;
            const ms = Math.round(toNumber(custom ?? this.setting<number>("pulse_duration", DEFAULT_PULSE_MS), 100, 5000));
            if (!(await this.relay(ch, true))) throw new Error(`relay ${ch} did not energise`);
            await this.sleep(ms);
            if (!(await this.relay(ch, false))) {
                this.log.warning(`Control4 ${this.name}: relay ${ch} energised but release failed - it may still be on!`);
                throw new Error(`relay ${ch} did not release`);
            }
            return undefined;
        }
        switch (key) {
            case "pulse_duration": {
                const ms = Math.round(toNumber(value, 100, 5000));
                this.saveSetting(key, ms);
                return {pulse_duration: ms};
            }
            case "io_mode": {
                const mode = z2ioModeFromName(value);
                if (mode === undefined) throw new Error(`unknown IO mode '${value}'`);
                const r = await this.request("s", "c4.z2x.opt", [String(mode)]);
                this.saveSetting("z2io_mode", mode);
                this.contacts = [];
                this.relays = [];
                this.ctx.exposesChanged(this.ieee);
                this.spawn(this.poll());
                if (r?.status !== "000") this.log.warning(`Control4 ${this.name}: IO mode ${mode} not acknowledged (${r?.status ?? "no reply"})`);
                return {io_mode: z2ioModeName(mode)};
            }
            case "poll":
                await this.poll();
                return undefined;
        }
        void toBool;
        return super.setValue(key, value, meta);
    }

    override async getValue(_key: string): Promise<void> {
        await this.poll();
    }

    override initialState(): Payload {
        return {io_mode: z2ioModeName(this.mode), pulse_duration: this.setting<number>("pulse_duration", DEFAULT_PULSE_MS)};
    }
}

export {Z2IO_CONTACTS_HW};