/**
 * Persistence for what a Control4 device never reports back: its model, the
 * settings written from Z2M (fades, LED colours, flags) and a few memories
 * (last lit level, remote LCD rows).
 *
 * One JSON file, written atomically (temp file + rename) and debounced. A file
 * that fails to parse is kept as `<name>.corrupt` and the store starts empty,
 * so one bad write can never silently wipe every device's settings.
 */

import fs from "node:fs";
import path from "node:path";

import type {Logger} from "./log";

export type Json = null | boolean | number | string | Json[] | {[k: string]: Json};

/** A device's friendly name and Zigbee2MQTT device options, as an instance last knew them. */
export interface Profile {
    name: string;
    options: Record<string, Json>;
}

interface FileShape {
    version: 1;
    models: Record<string, string>;
    devices: Record<string, Record<string, Json>>;
    /** Store-wide flags (one-time migrations). Older versions ignore it. */
    meta?: Record<string, Json>;
    /**
     * For the handoff (ADR 0004): when this instance last had each device in its
     * own Zigbee2MQTT (ms), and its copy of their names and device options.
     */
    handoff?: {had: Record<string, number>; profiles: Record<string, Profile>};
}

const object = <T>(v: unknown, fallback: T): T => (typeof v === "object" && v && !Array.isArray(v) ? (v as T) : fallback);

export class Store {
    private data: FileShape = {version: 1, models: {}, devices: {}, handoff: {had: {}, profiles: {}}};
    private timer: NodeJS.Timeout | undefined;
    private lastWritten = "";

    constructor(
        readonly file: string | undefined,
        private readonly log: Logger,
        private readonly debounceMs = 300,
    ) {
        this.load();
    }

    private load(): void {
        if (!this.file) return;
        let text: string;
        try {
            text = fs.readFileSync(this.file, "utf8");
        } catch {
            return; // first run
        }
        try {
            const parsed = JSON.parse(text) as Partial<FileShape>;
            const handoff = object<Partial<NonNullable<FileShape["handoff"]>>>(parsed.handoff, {});
            this.data = {
                version: 1,
                models: typeof parsed.models === "object" && parsed.models ? parsed.models : {},
                devices: typeof parsed.devices === "object" && parsed.devices ? parsed.devices : {},
                meta: typeof parsed.meta === "object" && parsed.meta ? parsed.meta : {},
                handoff: {had: object(handoff.had, {}), profiles: object(handoff.profiles, {})},
            };
            this.lastWritten = this.serialize();
        } catch (error) {
            this.log.warning(`Control4 store ${this.file} unreadable (${error}); kept as .corrupt, starting empty`);
            try {
                fs.renameSync(this.file, `${this.file}.corrupt`);
            } catch {
                // nothing to keep
            }
        }
    }

    private serialize(): string {
        return JSON.stringify(this.data, null, 1);
    }

    private schedule(): void {
        if (!this.file) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flushSync();
        }, this.debounceMs);
        this.timer.unref?.();
    }

    /** Write now if anything changed (also called on shutdown). */
    flushSync(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (!this.file) return;
        const text = this.serialize();
        if (text === this.lastWritten) return;
        const tmp = `${this.file}.${process.pid}.tmp`;
        try {
            fs.mkdirSync(path.dirname(this.file), {recursive: true});
            const fd = fs.openSync(tmp, "w");
            try {
                fs.writeSync(fd, text);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(tmp, this.file);
            this.lastWritten = text;
        } catch (error) {
            this.log.warning(`Control4 store: write failed (${error})`);
            try {
                fs.rmSync(tmp, {force: true});
            } catch {
                // ignore
            }
        }
    }

    model(ieee: string): string | undefined {
        return this.data.models[ieee.toLowerCase()];
    }

    setModel(ieee: string, model: string): void {
        const key = ieee.toLowerCase();
        if (this.data.models[key] === model) return;
        this.data.models[key] = model;
        this.schedule();
    }

    get<T = Json>(ieee: string, key: string): T | undefined {
        return this.data.devices[ieee.toLowerCase()]?.[key] as T | undefined;
    }

    set(ieee: string, key: string, value: Json | undefined): void {
        const id = ieee.toLowerCase();
        const entry = this.data.devices[id] ?? {};
        if (value === undefined) {
            if (!(key in entry)) return;
            delete entry[key];
        } else {
            if (JSON.stringify(entry[key]) === JSON.stringify(value)) return;
            entry[key] = value;
        }
        this.data.devices[id] = entry;
        this.schedule();
    }

    all(ieee: string): Record<string, Json> {
        return {...(this.data.devices[ieee.toLowerCase()] ?? {})};
    }

    /** Every device the store has seen (a model or any setting). */
    knownDevices(): string[] {
        return [...new Set([...Object.keys(this.data.models), ...Object.keys(this.data.devices)])];
    }

    meta<T = Json>(key: string): T | undefined {
        return this.data.meta?.[key] as T | undefined;
    }

    setMeta(key: string, value: Json): void {
        this.data.meta = {...(this.data.meta ?? {}), [key]: value};
        this.schedule();
    }

    // -- handoff (ADR 0004) -----------------------------------------------------

    private get handoff(): NonNullable<FileShape["handoff"]> {
        this.data.handoff ??= {had: {}, profiles: {}};
        return this.data.handoff;
    }

    /** When this instance last had the device in its own Zigbee2MQTT (ms); undefined if it never did. */
    had(ieee: string): number | undefined {
        return this.handoff.had[ieee.toLowerCase()];
    }

    setHad(ieee: string, at: number): void {
        const key = ieee.toLowerCase();
        if (this.handoff.had[key] === at) return;
        this.handoff.had[key] = at;
        this.schedule();
    }

    /** This instance's copy of the device's name and device options, kept for a handoff after its removal. */
    profile(ieee: string): Profile | undefined {
        return this.handoff.profiles[ieee.toLowerCase()];
    }

    setProfile(ieee: string, profile: Profile): void {
        const key = ieee.toLowerCase();
        if (JSON.stringify(this.handoff.profiles[key]) === JSON.stringify(profile)) return;
        this.handoff.profiles[key] = profile;
        this.schedule();
    }

    /** Replace the device's learned model and saved settings wholesale (a handoff's merge). */
    replace(ieee: string, model: string | undefined, settings: Record<string, Json>): void {
        const key = ieee.toLowerCase();
        if (model === undefined) delete this.data.models[key];
        else this.data.models[key] = model;
        if (Object.keys(settings).length) this.data.devices[key] = {...settings};
        else delete this.data.devices[key];
        this.schedule();
    }

    /** Drop everything this instance keeps about the device: it has a new home. */
    forget(ieee: string): void {
        const key = ieee.toLowerCase();
        delete this.data.models[key];
        delete this.data.devices[key];
        delete this.handoff.had[key];
        delete this.handoff.profiles[key];
        this.schedule();
    }
}
