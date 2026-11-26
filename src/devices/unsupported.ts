/**
 * A Control4 device whose check-in names a model this build doesn't support yet
 * (a C4-KD120 keypad dimmer, a LOZ-5D1 outlet dimmer, an LSZ-102 switch, ...).
 *
 * It stays the generic C4-Zigbee device in Zigbee2MQTT, so `c4_get` / `c4_send`
 * still reach it, and it is kept ours: its check-ins are answered like any other.
 * What adding it needs is what it says, so its frames are logged at info, and once
 * per device a short run of read-only Gets asks which protocol namespaces it answers
 * (docs/research/2026-11-25-unsupported-models.md says how to read the result).
 */

import type {StateReadResult} from "../core/link";
import type {ParsedFrame} from "../core/protocol";
import {C4Device, type Payload} from "./base";
import {SETTINGS_READ_DELAY} from "./dm";

export const REPORTED_MODEL_KEY = "reported_model";
/** Saved setting: the fingerprint read's replies, `prop -> "status values"` (or "no reply"). */
export const FINGERPRINT_KEY = "fingerprint";

/** Frames logged at info from one device per start; the rest go to debug. */
export const FRAME_LOG_LIMIT = 500;

/**
 * Read-only Gets, each answered `000` (has it), `n01` (no such name) or `e00` (name
 * known, wrong arguments) by a device that answers Gets at all. Which namespaces it
 * has says which existing family it is closest to.
 */
export const FINGERPRINT_PROPS = [
    "c4.sy.fwv", // firmware (Gen2 / Gen3 boards)
    "c4.sy.ri", // why it last restarted
    "c4.dmx.bmc 00", // the Gen3 board (APD120 / SW120277 / KC120277 / keypad dimmer)
    "c4.dmx.btn 00 01", // a Gen3 button wire's behaviour
    "c4.dmx.led 00 01", // a Gen3 LED slot's mode
    "c4.dmx.amb 00", // an ambient light sensor
    "c4.dm.is", // a dimmer's settings (DIM1-Z, APD120)
    "c4.dm.tv 00 00", // load 1's live level
    "c4.dm.tv 01 00", // load 2's live level (dual outlet, dual-load dimmer)
    "c4.kp.bhp", // the KP-generation keypads' hold threshold
] as const;

/** Unanswered Gets in a row that end the fingerprint read (a model that never answers Gets). */
const FINGERPRINT_GIVE_UP = 2;

export class Unsupported extends C4Device {
    private framesLogged = 0;

    private get fingerprintKey(): string {
        return `${this.ieee}:fingerprint`;
    }

    override start(hotLoad = false): void {
        super.start(hotLoad);
        this.saveSetting(REPORTED_MODEL_KEY, this.model);
        if (this.setting(FINGERPRINT_KEY) === undefined) this.ctx.link.queueStateRead(this.fingerprintKey, () => this.readFingerprint(), SETTINGS_READ_DELAY);
    }

    override stop(): void {
        this.ctx.link.cancelStateRead(this.fingerprintKey);
        super.stop();
    }

    override handleAscii(frame: ParsedFrame): void {
        if (this.framesLogged < FRAME_LOG_LIMIT) {
            this.framesLogged++;
            this.log.info(`Control4 UNSUPPORTED ${this.name} (${this.model}) <- ${frame.text}`);
            if (this.framesLogged === FRAME_LOG_LIMIT) this.log.info(`Control4 ${this.name}: ${FRAME_LOG_LIMIT} frames logged; the rest of this run's go to debug`);
        }
        super.handleAscii(frame);
    }

    /** Once per device: which namespaces it answers, logged and saved. Read-only: it changes nothing on the device. */
    async readFingerprint(): Promise<StateReadResult> {
        if (this.stopped || this.setting(FINGERPRINT_KEY) !== undefined) return "skipped";
        const found: Record<string, string> = {};
        let unanswered = 0;
        for (const prop of FINGERPRINT_PROPS) {
            const reply = await this.get(prop);
            if (this.stopped) return "skipped";
            if (!reply) {
                found[prop] = "no reply";
                if (++unanswered >= FINGERPRINT_GIVE_UP) break;
                continue;
            }
            unanswered = 0;
            found[prop] = [reply.status, ...reply.values].join(" ").trim();
        }
        // Saved even when it answered nothing: a model that never answers a Get must not be asked again at every start.
        this.saveSetting(FINGERPRINT_KEY, found);
        const lines = Object.entries(found).map(([prop, r]) => `${prop} -> ${r}`);
        this.log.info(`Control4 ${this.name} (${this.model}) fingerprint: ${lines.join("; ")}`);
        this.log.info(`Control4 ${this.name} (${this.model}): ${fingerprintHint(found)}`);
        return "read";
    }

    override initialState(): Payload {
        return {[REPORTED_MODEL_KEY]: this.model};
    }
}

const answered = (found: Record<string, string>, prefix: string) => Object.entries(found).some(([prop, r]) => prop.startsWith(prefix) && r.startsWith("000"));

/** What a fingerprint suggests, in a line for the log. */
export function fingerprintHint(found: Record<string, string>): string {
    if (Object.values(found).every((r) => r === "no reply")) return "it answered no Get: an older model, or out of reach. Its button and check-in frames above are what there is to go on";
    const parts: string[] = [];
    if (answered(found, "c4.dmx.")) parts.push("it speaks c4.dmx, the Gen3 board of the APD120 / SW120277 / KC120277");
    if (answered(found, "c4.dm.")) parts.push(`it has a c4.dm load${found["c4.dm.tv 01 00"]?.startsWith("000") ? " (two channels answer)" : ""}`);
    if (answered(found, "c4.kp.")) parts.push("it speaks c4.kp, as the KP3-Z / KP6-Z keypads");
    if (!parts.length) parts.push("it answered, but none of the namespaces asked");
    return `${parts.join("; ")}. Send this log to the project to have the model added`;
}
