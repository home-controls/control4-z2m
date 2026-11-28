/**
 * The C4-KD120 / C4-KD277 keypad dimmer: "an APD120 and a KC120277 in one device"
 * (Control4's install guide), on the APD120's firmware line (4.0.39 ... 5.0.9).
 * Its buttons are a KC120277's (a kit of 2-7, learned from the wires they send
 * from, or set with the `button_layout` option); its load is an APD120's dimmer.
 *
 * Not yet tested on a real one. What it is built on comes from bharat's KD120 work
 * (docs/research/kc-apd-sw-capability-map.md): the c4.dmx.led params,
 * the `c4.dmx.btn <wire> 01` behaviour codes (00 on, 01 off, 02 toggle, 03 event
 * only, 04 momentary), the backlight at `c4.dmx.blc 00 05`, and that out of the box
 * every button toggles its load in firmware, so a tap moves no state here: the
 * load's own c4.dmx.ls report does.
 */

import {AUX_BUTTONS, BUTTON_BEHAVIOUR_NAMES, type ButtonBehaviour, KC_POSITIONS} from "../core/constants";
import type {C4Device, Payload, SetMeta} from "./base";
import type {LoadControl, TvParams} from "./dimming";
import {behaviourRead, DimmerLoad, type SettingRead, writeBehaviour} from "./gen3";
import {Kc120277} from "./keypad";
import {PowerSensor} from "./sensors";

/** Every button toggles the load until told otherwise (Control4's install guide). */
export const KD_FACTORY_BEHAVIOUR: ButtonBehaviour = "toggle";

/** A button's behaviour, by its position from the top (wire + 1): the KC numbering options don't move it. */
export const positionBehaviourKey = (wire: number) => `button_position_${wire + 1}_behaviour`;

const POSITION_BEHAVIOUR = /^button_position_([1-7])_behaviour$/;

export class Kd120 extends Kc120277 {
    protected override readonly hasFault = true;
    /** Untested on a real one: no remote reboot until someone has watched one. */
    protected override readonly remoteReboot = false;
    readonly dimmer: DimmerLoad;

    constructor(...args: ConstructorParameters<typeof C4Device>) {
        super(...args);
        this.pwr = new PowerSensor(this);
        this.dimmer = new DimmerLoad(this);
    }

    get load(): LoadControl {
        return this.dimmer.load;
    }

    get tv(): TvParams {
        return this.dimmer.tv;
    }

    /** The wires whose behaviour is read and shown: the fitted buttons', or every position while those aren't known. */
    behaviourWires(): number[] {
        return this.fittedWires() ?? Array.from({length: KC_POSITIONS}, (_, i) => i);
    }

    /** A position's button behaviour as last read or set (its factory behaviour until then). */
    behaviour(wire: number): ButtonBehaviour {
        const stored = this.setting<string>(positionBehaviourKey(wire));
        return stored && (BUTTON_BEHAVIOUR_NAMES as string[]).includes(stored) ? (stored as ButtonBehaviour) : KD_FACTORY_BEHAVIOUR;
    }

    /** Wires 07 / 08 are an auxiliary keypad wired to it, not a fitted button (the KC numbering would call 07 button_4). */
    protected override buttonName(id: number): string {
        return AUX_BUTTONS[id] ?? super.buttonName(id);
    }

    protected override settingReads(): SettingRead[] {
        return [
            this.dimmer.tableRead(),
            ...super.settingReads(),
            ...this.behaviourWires().map((w) => behaviourRead(this, w, positionBehaviourKey(w), `its button at position ${w + 1}`)),
            this.dimmer.phaseRead(),
        ];
    }

    protected override onPhase(hex: string | undefined): void {
        this.dimmer.onPhase(hex);
    }

    /** The level, then a power reading (`c4.dmx.ls` fields 3 on), as on the APD120. */
    protected override onLightState(fields: string[]): void {
        if (!this.dimmer.onLightState(fields)) return;
        if (!this.pwr?.publishReading(fields.slice(3))) this.pwr?.pollSoon();
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (this.dimmer.handles(key)) return this.dimmer.set(key, value, meta);
        const m = POSITION_BEHAVIOUR.exec(key);
        if (m) return writeBehaviour(this, Number(m[1]) - 1, key, value);
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        const out: Payload = {...super.initialState(), ...this.dimmer.initialState()};
        for (const w of this.behaviourWires()) out[positionBehaviourKey(w)] = this.behaviour(w);
        return out;
    }
}
