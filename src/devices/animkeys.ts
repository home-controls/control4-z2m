/**
 * /set keys of the LED animation engine (the ZHA zha_c4_patch.keypad_led_*
 * services): led_effect, led_status, led_stop, led_refresh. Also publishes
 * `led_notification` and the led_notification_start / _end actions.
 */

import {type Animator, type AnimatorHost, ledEffect, ledStatus} from "../core/animation";
import type {C4Device, Payload} from "./base";

export const ANIMATION_KEYS = ["led_effect", "led_status", "led_stop", "led_refresh"];

export class AnimationKeys {
    readonly animator: Animator;

    constructor(dev: C4Device, host: Omit<AnimatorHost, "ieee" | "name" | "alive" | "set" | "onNotifying">, buttons: number[], protocol: "kp" | "dmx" | "dm") {
        const full: AnimatorHost = {
            get ieee() {
                return dev.ieee;
            },
            get name() {
                return dev.name;
            },
            get alive() {
                return dev.alive;
            },
            set: (cmd: string) => dev.set(cmd),
            onNotifying: (active: boolean) => {
                dev.publish({led_notification: active});
                dev.emitEvent(active ? "led_notification_start" : "led_notification_end");
            },
            idleHex: host.idleHex,
            dmStored: host.dmStored,
            loadOn: host.loadOn,
            verifyDm: host.verifyDm,
            quietMs: host.quietMs,
            ledsOf: host.ledsOf,
            ledMode: host.ledMode,
            onBorrow: host.onBorrow,
            unreachable: () => dev.ctx.link.isUnreachable(dev.ieee),
        };
        this.animator = dev.ctx.anim.register(full, buttons, protocol);
    }

    handles(key: string): boolean {
        return ANIMATION_KEYS.includes(key);
    }

    async set(key: string, value: unknown): Promise<Payload | undefined> {
        const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        switch (key) {
            case "led_effect":
                if (typeof value === "string") await ledEffect(this.animator, {effect: value});
                else await ledEffect(this.animator, data);
                return undefined;
            case "led_status":
                await ledStatus(this.animator, data);
                return undefined;
            case "led_stop":
                await this.animator.stop(data.restore === undefined ? true : Boolean(data.restore));
                return undefined;
            case "led_refresh":
                await this.animator.refresh();
                return undefined;
        }
        return undefined;
    }

    /** The device changed this button's LED by itself (a keypad's press feedback): paint its status back. */
    repaintPressed(btn: number): void {
        this.animator.repaintPressed(btn);
    }

    initialState(): Payload {
        return {led_notification: this.animator.animating};
    }
}
