/**
 * The handoff (ADR 0004): a Control4 device that joins an instance takes its
 * saved settings, friendly name and device options from the instance that last
 * had it, which then lets go of it. Over the shared namespace, per device:
 *
 *   control4/handoff/<ieee>/request   the new instance, on every join
 *   control4/handoff/<ieee>/offer     each instance that has had the device
 *   control4/handoff/<ieee>/ack       the new instance, to every instance that offered
 *   control4/handoff/<ieee>/done      each acked instance, once it has let go
 *
 * Every message carries `from` (the sender's base topic). Each instance hears
 * its own messages too, since Zigbee2MQTT would otherwise ignore a topic it once
 * published on, and drops them.
 *
 * Only an instance with a record of having had the device answers: a copy left
 * by the ZHA import or `move-c4-settings --copy` never does. The newest offer
 * wins, unless this instance had the device more recently itself. Every
 * instance that offered then forgets the device, and one that still has a
 * record of it (a device reset and re-paired without being removed) evicts it.
 *
 * Independent of Zigbee2MQTT: `HandoffHost` is the only way out.
 */

import type {Logger} from "./log";
import type {Json, Profile, Store} from "./store";

export type {Profile} from "./store";

export type HandoffStep = "request" | "offer" | "ack" | "done";
export const HANDOFF_STEPS: readonly HandoffStep[] = ["request", "offer", "ack", "done"];

export const HANDOFF_TIMING = {
    /** How long the new instance collects offers: past it, the device starts as new. */
    offers: 5_000,
    /** How long it waits for each done before acking again. */
    done: 5_000,
    /** Acks sent in all before it settles without the missing dones. */
    acks: 3,
};

export interface HandoffHost {
    base(): string;
    log: Logger;
    store: Store;
    now(): number;
    send(ieee: string, step: HandoffStep, body: Record<string, unknown>): void;
    /** This instance's Zigbee2MQTT has a record of the device. */
    has(ieee: string): boolean;
    lastSeen(ieee: string): number | undefined;
    /** The device's friendly name and device options here, or undefined without a record. */
    profile(ieee: string): Profile | undefined;
    /**
     * Apply what a handoff brought, once its saved settings are in the store:
     * the learned model (undefined: none), and the device options.
     */
    adopt(ieee: string, model: string | undefined, options: Record<string, Json> | undefined): void;
    /** Force-remove the device's record here; resolves once Zigbee2MQTT has removed it. */
    evict(ieee: string): Promise<void>;
    /**
     * The handoff is over: rename the device to `name` (undefined: keep it), and
     * republish its discovery if an old instance evicted its record.
     */
    settle(ieee: string, name: string | undefined, evicted: boolean): void;
}

interface Offer {
    from: string;
    had: number;
    holds: boolean;
    model?: string;
    settings: Record<string, Json>;
    profile?: Profile;
}

/** A join this instance is handing off, as the new instance. */
interface Join {
    id: string;
    /** When this instance had the device before this join. */
    prior: number | undefined;
    before: {model: string | undefined; settings: Record<string, Json>};
    offers: Offer[];
    winner?: Offer;
    /** Instances acked whose done hasn't come. */
    waiting: Set<string>;
    evicted: boolean;
    acks: number;
    timer?: NodeJS.Timeout;
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const record = (v: unknown): Record<string, Json> => (typeof v === "object" && v && !Array.isArray(v) ? (v as Record<string, Json>) : {});

export class Handoff {
    private joins = new Map<string, Join>();
    /** Devices this instance is letting go of, as an old instance. */
    private leaving = new Set<string>();
    private stopped = false;

    constructor(
        private readonly host: HandoffHost,
        private readonly timing = HANDOFF_TIMING,
    ) {}

    private get store(): Store {
        return this.host.store;
    }

    /** At start: every device Zigbee2MQTT has now has been had here; keep its name and options. */
    seed(ieees: string[]): void {
        for (const ieee of ieees) {
            this.touch(ieee, this.host.lastSeen(ieee) ?? 0);
            this.keepProfile(ieee);
        }
    }

    stop(): void {
        this.stopped = true;
        for (const join of this.joins.values()) clearTimeout(join.timer);
        this.joins.clear();
    }

    /** A handoff for the device is under way here, as the new instance. */
    pending(ieee: string): boolean {
        return this.joins.has(ieee.toLowerCase());
    }

    /** The device's name or options changed here: keep a copy, for a handoff after its removal. */
    keepProfile(ieee: string): void {
        const profile = this.host.profile(ieee);
        if (profile) this.store.setProfile(ieee, profile);
    }

    /** The device left, or was removed from, this instance: it was had until now. */
    left(ieee: string): void {
        if (!this.leaving.has(ieee.toLowerCase())) this.touch(ieee, this.host.now());
    }

    /** A successful join interview: ask whoever last had the device for what it knew. */
    joined(raw: string): void {
        const ieee = raw.toLowerCase();
        const old = this.joins.get(ieee);
        if (old) clearTimeout(old.timer);
        const join: Join = {
            id: `${this.host.base()}:${this.host.now()}`,
            prior: this.store.had(ieee),
            before: {model: this.store.model(ieee), settings: this.store.all(ieee)},
            offers: [],
            waiting: new Set(),
            evicted: false,
            acks: 0,
        };
        this.touch(ieee, this.host.now());
        this.keepProfile(ieee);
        this.joins.set(ieee, join);
        this.host.send(ieee, "request", {from: this.host.base(), id: join.id});
        join.timer = setTimeout(() => this.decide(ieee, join), this.timing.offers);
        join.timer.unref?.();
    }

    onMessage(raw: string, step: HandoffStep, body: unknown): void {
        const msg = record(body);
        const from = typeof msg.from === "string" ? msg.from : undefined;
        // Its own messages come back too.
        if (this.stopped || !from || from === this.host.base()) return;
        const ieee = raw.toLowerCase();
        const join = this.joins.get(ieee);
        const forThisJoin = join !== undefined && msg.id === join.id && msg.to === this.host.base();
        switch (step) {
            case "request":
                this.answer(ieee, from, msg.id);
                return;
            case "offer":
                if (forThisJoin && join.timer && !join.offers.some((o) => o.from === from)) join.offers.push(this.offerOf(from, msg));
                return;
            case "ack":
                if (Array.isArray(msg.to) && msg.to.includes(this.host.base())) void this.release(ieee, from, msg.id);
                return;
            case "done":
                if (forThisJoin && join.waiting.delete(from)) {
                    if (msg.evicted === true) join.evicted = true;
                    if (join.waiting.size === 0) this.end(ieee, join);
                }
                return;
        }
    }

    private touch(ieee: string, at: number): void {
        const had = this.store.had(ieee);
        if (had === undefined || at > had) this.store.setHad(ieee, at);
    }

    // -- as an old instance ----------------------------------------------------

    private answer(ieee: string, to: string, id: unknown): void {
        if (this.leaving.has(ieee)) return;
        const holds = this.host.has(ieee);
        const stored = this.store.had(ieee);
        // Never had it here: a copy (the ZHA import, --copy), or a device it never saw.
        if (stored === undefined && !holds) return;
        const had = Math.max(stored ?? 0, holds ? (this.host.lastSeen(ieee) ?? 0) : 0);
        const profile = this.host.profile(ieee) ?? this.store.profile(ieee);
        this.host.send(ieee, "offer", {from: this.host.base(), to, id, had, holds, model: this.store.model(ieee), settings: this.store.all(ieee), ...(profile ? {profile} : {})});
    }

    /** Acked: drop the saved settings, evict a record still here, and say done. */
    private async release(ieee: string, to: string, id: unknown): Promise<void> {
        if (this.leaving.has(ieee)) return; // a repeated ack while letting go: done follows
        this.leaving.add(ieee);
        let evicted = false;
        try {
            if (this.host.has(ieee)) {
                await this.host.evict(ieee);
                evicted = true;
            }
        } catch (error) {
            this.host.log.warning(`Control4: could not remove ${ieee}, which joined ${to}: ${(error as Error).message}`);
        } finally {
            this.store.forget(ieee);
            this.leaving.delete(ieee);
        }
        if (this.stopped) return;
        this.host.log.info(`Control4: ${ieee} joined ${to}; its saved settings here are dropped${evicted ? " and its record removed" : ""}`);
        this.host.send(ieee, "done", {from: this.host.base(), to, id, evicted});
    }

    // -- as the new instance ---------------------------------------------------

    private offerOf(from: string, msg: Record<string, Json>): Offer {
        const profile = record(msg.profile);
        return {
            from,
            had: typeof msg.had === "number" ? msg.had : 0,
            holds: msg.holds === true,
            model: typeof msg.model === "string" ? msg.model : undefined,
            settings: record(msg.settings),
            profile: typeof profile.name === "string" ? {name: profile.name, options: record(profile.options)} : undefined,
        };
    }

    /** The offers are in: take the newest (unless this instance's own is newer), then ack them all. */
    private decide(ieee: string, join: Join): void {
        join.timer = undefined;
        if (!join.offers.length) {
            this.joins.delete(ieee);
            this.host.log.info(`Control4: no other instance answered for ${ieee}; it starts as a new device`);
            return;
        }
        const newest = join.offers.reduce((x, y) => (y.had > x.had ? y : x));
        if (join.prior === undefined || newest.had > join.prior) {
            join.winner = newest;
            const model = this.merge(ieee, join, newest);
            this.host.adopt(ieee, model, newest.profile?.options);
            this.host.log.info(`Control4: ${ieee} brought its saved settings${newest.profile ? `, name and options` : ""} from ${newest.from}`);
        } else {
            this.host.log.info(`Control4: ${ieee} was here more recently than on ${join.offers.map((o) => o.from).join(", ")}; it keeps the values it has`);
        }
        for (const o of join.offers) join.waiting.add(o.from);
        this.ack(ieee, join);
    }

    /**
     * The offer's saved settings replace what this instance held before the join;
     * a value written here since the join wins. Returns the learned model now kept.
     */
    private merge(ieee: string, join: Join, offer: Offer): string | undefined {
        const now = {model: this.store.model(ieee), settings: this.store.all(ieee)};
        const out: Record<string, Json> = {...offer.settings};
        for (const key of new Set([...Object.keys(now.settings), ...Object.keys(join.before.settings)])) {
            if (same(now.settings[key], join.before.settings[key])) continue;
            if (now.settings[key] === undefined) delete out[key];
            else out[key] = now.settings[key];
        }
        const model = now.model !== join.before.model ? now.model : (offer.model ?? now.model);
        this.store.replace(ieee, model, out);
        return model;
    }

    private ack(ieee: string, join: Join): void {
        join.acks++;
        this.host.send(ieee, "ack", {from: this.host.base(), to: [...join.waiting], id: join.id});
        join.timer = setTimeout(() => {
            join.timer = undefined;
            if (join.acks < this.timing.acks) this.ack(ieee, join);
            else this.end(ieee, join);
        }, this.timing.done);
        join.timer.unref?.();
    }

    private end(ieee: string, join: Join): void {
        clearTimeout(join.timer);
        if (this.joins.get(ieee) !== join) return;
        this.joins.delete(ieee);
        // An instance that offered while still holding a record evicts it, even when its done got lost.
        const evicted = join.evicted || join.offers.some((o) => o.holds);
        this.host.settle(ieee, join.winner?.profile?.name, evicted);
    }
}
