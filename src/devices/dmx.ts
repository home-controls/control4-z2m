/**
 * The c4.dmx.* announcement vocabulary, shared by every model that speaks it, and
 * the C4-4SF120 fan (ports of control4_fan.py and the C4ButtonCluster family in
 * c4_button_cluster.py). The Gen3 board's models (APD120, SW120277, KC120277) build
 * on it in gen3.ts.
 */

import {clickGesture, FAN_BUTTONS, type Gesture, POWER_KEYS} from "../core/constants";
import {hex2, type ParsedFrame, parseHex} from "../core/protocol";
import {C4Device, type Payload, type SetMeta, toNumber} from "./base";
import {LED_CLUSTER_COMMANDS, type LedKeys, ledClusterCommand} from "./ledkeys";
import {AMB_PROPERTY, type AmbientSensor, type PowerSensor, PWR_PROPERTY} from "./sensors";

// ---------------------------------------------------------------------------
// Base: the c4.dmx.* announcement vocabulary
// ---------------------------------------------------------------------------

export abstract class DmxDevice extends C4Device {
    protected abstract readonly buttons: Record<number, string>;
    protected amb?: AmbientSensor;
    protected pwr?: PowerSensor;
    protected led?: LedKeys;

    override get ledKeys(): LedKeys | undefined {
        return this.led;
    }

    override start(_hotLoad = false): void {
        this.amb?.start();
        this.pwr?.start();
    }

    protected buttonName(id: number): string {
        return this.buttons[id] ?? `button_${id}`;
    }

    protected fire(hex: string | undefined, gesture: Gesture, count?: number): void {
        const id = parseHex(hex);
        if (id === undefined) return;
        this.emitAction(this.buttonName(id), gesture, {action_button_id: id});
        if (count !== undefined) this.syncClick(id, count);
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        switch (ns) {
            case "c4.dmx.ls":
                this.onLightState(data);
                return;
            case "c4.dmx.dim":
                this.onPhase(data[data.length - 1]);
                return;
            case "c4.dmx.warn":
                this.onWarning(data);
                return;
            case "c4.dmx.amb":
                this.amb?.announce(data);
                return;
            case "c4.dmx.bp":
                this.fire(data[0], "press");
                return;
            case "c4.dmx.sc":
                this.fire(data[0], "release");
                return;
            case "c4.dmx.cc":
                if (data.length >= 2) this.fire(data[0], clickGesture(data[1]), parseHex(data[1]));
                return;
            case "c4.dmx.hc":
                this.fire(data[0], "hold");
                return;
            case "c4.dmx.he":
                this.fire(data[0], "hold_release");
                return;
            case "c4.dmx.tc":
                return; // transition complete: nothing a user needs
        }
        if (ns.startsWith("c4.ln.") || ns.startsWith("c4.zr.")) return;
        this.log.info(`Control4 ${this.name}: unknown namespace '${ns}' data=${data.join(" ")}`);
    }

    protected override onReply(frame: ParsedFrame): void {
        const t = frame.tokens;
        if (t.length > 3 && t[1] === "000") {
            if (t[2] === AMB_PROPERTY) this.amb?.reply(frame.seq, t.slice(3));
            else if (t[2] === PWR_PROPERTY) this.pwr?.reply(frame.seq, t.slice(3));
        }
    }

    /** `c4.dmx.ls`: field 2 is the load level in percent. */
    protected onLightState(_fields: string[]): void {}

    /** `c4.dmx.dim`: the dimming phase in use (not a level). */
    protected onPhase(hex: string | undefined): void {
        this.log.debug(`Control4 ${this.name}: dimming phase ${hex}`);
    }

    /** `c4.dmx.warn`: the warning the device announces. */
    protected onWarning(data: string[]): void {
        this.log.info(`Control4 ${this.name}: device warning ${data.join(" ")}`);
    }

    /** A click-count confirmation (cc) on a paddle half. */
    protected syncClick(_id: number, _count: number): void {}

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (this.led?.handles(key)) return this.led.set(key, value);
        if (key in LED_CLUSTER_COMMANDS) return ledClusterCommand(this, key, value);
        return super.setValue(key, value, meta);
    }

    override async getValue(key: string): Promise<void> {
        if (key === "ambient_light") await this.amb?.pollOnce();
        else if (POWER_KEYS.includes(key)) await this.pwr?.pollOnce();
    }

    override initialState(): Payload {
        return {...(this.led?.initialState() ?? {})};
    }
}

// ---------------------------------------------------------------------------
// C4-4SF120 fan
// ---------------------------------------------------------------------------

/** Click-count (cc) on a fan button -> the speed that button selects. */
const FAN_BUTTON_SPEED: Record<number, number> = {0x01: 4, 0x02: 3, 0x03: 2, 0x04: 1, 0x05: 0};

/** Store flag: this fan has had its ramps and speed LEDs provisioned. */
export const FAN_PROVISIONED_KEY = "fan_provisioned";

export class Fan extends DmxDevice {
    protected readonly buttons = FAN_BUTTONS;

    override start(): void {
        super.start();
        // Once per pairing, not on every restart: it rewrites the speed LEDs.
        if (!this.setting<boolean>(FAN_PROVISIONED_KEY, false)) this.after(20_000 + Math.random() * 10_000, () => this.provision());
    }

    /** Transition-time params (as the Director provisions) and the speed LEDs. */
    async provision(): Promise<void> {
        for (let i = 1; i <= 6; i++) {
            await this.trySet(`c4.dm.tv 00 ${hex2(i)} 00`);
            await this.sleep(50);
        }
        // Each button LED follows one speed: btn 0 -> behaviour 7 (high) ... btn 4 -> 3 (off).
        for (let btn = 0; btn <= 4; btn++) {
            for (const cmd of [`c4.dmx.led ${hex2(btn)} 00 00`, `c4.dmx.led ${hex2(btn)} 01 ${hex2(7 - btn)}`, `c4.dmx.led ${hex2(btn)} 02 00`]) {
                await this.trySet(cmd);
                await this.sleep(50);
            }
        }
        if (!this.alive) return;
        this.saveSetting(FAN_PROVISIONED_KEY, true);
        this.log.info(`Control4 ${this.name}: fan provisioned (ramps + speed LEDs)`);
    }

    private publishSpeed(speed: number): void {
        if (speed > 0) this.saveSetting("last_speed", speed);
        this.publish(speed > 0 ? {state: "ON", speed} : {state: "OFF"});
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        if (ns === "c4.dmx.fs") {
            const speed = parseHex(data[2]);
            if (speed !== undefined && speed >= 0 && speed <= 4) this.publishSpeed(speed);
            return;
        }
        super.onAnnounce(ns, data);
    }

    protected override syncClick(id: number, count: number): void {
        const speed = FAN_BUTTON_SPEED[id];
        if (count >= 1 && speed !== undefined) this.publishSpeed(speed);
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === "state" || key === "speed") {
            const msg = meta.message;
            let speed: number;
            if (msg.speed !== undefined) speed = Math.round(toNumber(msg.speed, 0, 4));
            else {
                let s = String(msg.state ?? value).toUpperCase();
                if (s === "TOGGLE") s = String(this.state().state ?? "OFF").toUpperCase() === "ON" ? "OFF" : "ON";
                speed = s === "ON" ? Number(this.setting<number>("last_speed", 4)) || 4 : 0;
            }
            await this.ctx.link.sendWithRecovery(this.ieee, () => this.set(`c4.dmx.fsc 00 ${hex2(speed)}`), "fan command");
            if (speed > 0) this.saveSetting("last_speed", speed);
            return speed > 0 ? {state: "ON", speed} : {state: "OFF"};
        }
        return super.setValue(key, value, meta);
    }
}
