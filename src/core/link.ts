/**
 * Link health for Control4 devices in large meshes (port of c4_link.py).
 *
 *   waitTurn          paced transmit slots: per device and across all C4 devices
 *   transmit          the send window: a few frames awaiting delivery at once, one per device
 *   noteRx            when each device last sent us a unicast
 *   resolveReply      completes a pending get() from an inbound `0r`
 *   get               a real Get round trip (`0g` -> `0r`) with a timeout
 *   honestPing        what Z2M's availability ping does on Get-capable routers
 *   keepalive         pokes routers that have gone quiet, a few per minute
 *   sendWithRecovery  one delayed retry (after a route refresh) for load commands
 *   scheduleVerify    read-after-write check with one re-send
 *   queueStateRead    one-off state reads (startup, join, announce), one device at a time
 */

import type {Logger} from "./log";
import {hex4, type ParsedFrame} from "./protocol";
import {DeliveryError} from "./transport";

export const SEND_GAP_DEVICE = 40;
export const SEND_GAP_GLOBAL = 20;
/**
 * Most Control4 frames awaiting delivery at once, across all devices. The NCP
 * holds each unicast until its APS ack; with only the gaps above, a slow mesh
 * fills up (21:00 on a test site: ~23 dimmers repainting, "adapter has run out
 * of buffers"). A load command and the controller identity never wait for it.
 */
export const TX_WINDOW = 4;
/** A frame still unconfirmed after this long gives its window slot back (it may be retrying, or its confirmation was lost). */
export const TX_SLOT_HOLD_MAX = 3_000;
const BACKLOG_WARN = 10_000;
export const GET_TIMEOUT = 6_000;
export const KEEPALIVE_QUIET = 20 * 60_000;
export const KEEPALIVE_REPOKE = 10 * 60_000;
const KEEPALIVE_TICK = 60_000;
const KEEPALIVE_MAX_PER_TICK = 4;
const KEEPALIVE_POKE_GAP = 3_000;
const KEEPALIVE_FIRST_DELAY = 120_000;
/** Keepalives unanswered in a row before a device counts as unreachable (commands to it are lost). */
export const KEEPALIVE_WARN_AFTER = 3;
/** What to do about an unreachable device (#60: its firmware can stop answering while the radio still works). */
const REBOOT_ADVICE =
    "commands to it are lost. It may still have power, work from its own paddles and check in every hour, but a paddle press does not bring it back: reboot it (on a DIM1-Z, tap the top paddle 15 times) or cut its power.";
/** Least time between two automatic reboots of one device. */
export const AUTO_REBOOT_GAP = 60 * 60_000;
/**
 * Automatic reboots of one device within AUTO_REBOOT_WINDOW. A rolling count, not one
 * its own frames reset: a rebooted dimmer announces its level within 2 s, so a cap that
 * a direct frame cleared would let one that keeps going deaf be rebooted forever.
 */
export const AUTO_REBOOT_MAX = 3;
export const AUTO_REBOOT_WINDOW = 24 * 60 * 60_000;
/** Least time between two automatic reboots on the whole instance: a burst (a power cut) is spread out. */
export const AUTO_REBOOT_INSTANCE_GAP = 60_000;
/**
 * More devices unreachable at once than this is an instance or mesh fault (the receive
 * path, the coordinator), not one dimmer's firmware: no automatic reboots then.
 */
export const AUTO_REBOOT_MAX_UNREACHABLE = 3;
/** The same, for a device the extension reboots itself. */
const AUTO_REBOOT_ADVICE = `commands to it are lost. It may still have power, work from its own buttons and check in every hour, but a press does not bring it back. The extension reboots it remotely (up to ${AUTO_REBOOT_MAX} times a day, an hour or more apart); if it stays unreachable, press its Reboot button or reboot it by hand (on a DIM1-Z, tap the top paddle 15 times), or cut its power.`;
export const RETRY_DELAY = 2_000;
export const MTORR_MIN_GAP = 60_000;
export const MTORR_RADIUS = 5;
/** A queued state read waits this long first (the mesh is busy right after a start or a join). */
export const STATE_READ_DELAY = 5_000;
/** Pause after each state read before the next device's. */
export const STATE_READ_GAP = 250;
/**
 * A state read nobody answered is tried again this long after, once per entry:
 * right after a restart the coordinator's routes are still being rebuilt and
 * many reads fail although the devices are fine.
 */
export const STATE_READ_RETRIES = [30_000, 120_000];

/** What a state read did: published a state, had nothing to do, or got no answer. */
export type StateReadResult = "read" | "skipped" | "failed";

/** Models confirmed (by probe) to answer `0g c4.sy.fwv`. */
export const GET_CAPABLE_MODELS = new Set(["C4-DIM1-Z", "C4-APD120", "C4-SW120277", "C4-KC120277"]);
export const PING_PROPERTY = "c4.sy.fwv";

export interface LinkDevice {
    readonly ieee: string;
    readonly model: string;
    readonly isRouter: boolean;
    nextSeq(): number;
    /** Send raw text (no pacing beyond waitTurn, which the device applies). */
    sendText(text: string): Promise<void>;
    /** Reboot the device remotely, on a model that can be (the DIM1-Z, KC120277, APD120). */
    reboot?(): Promise<void>;
    /** Whether the link may reboot it on its own (its auto_reboot option); absent = yes. */
    autoReboot?(): boolean;
}

export interface GetReply {
    status: string;
    prop?: string;
    values: string[];
}

export interface LinkHost {
    log: Logger;
    devices(): LinkDevice[];
    mtorr(radius: number): Promise<boolean>;
    now(): number;
    /** A device became unreachable, or is reachable again (unreachable() changed). */
    reachabilityChanged?(): void;
    /** Why automatic reboots are held on this instance now (a traffic alarm), if they are. */
    rebootsHeld?(): string | undefined;
}

/** A device keepalive cannot reach, and how long it has sent nothing direct (since the start, if never). */
export interface Unreachable {
    ieee: string;
    model: string;
    quietMin: number;
    /** Minutes since the link last rebooted it, while it has stayed silent since; absent if it hasn't. */
    rebootMin?: number;
}

const sleep = (ms: number) =>
    new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        (t as NodeJS.Timeout).unref?.();
    });

export function isDeliveryFailure(error: unknown): boolean {
    return error instanceof DeliveryError || (error as Error)?.name === "DeliveryError" || (error as Error)?.name === "TimeoutError";
}

export class Link {
    private nextDev = new Map<string, number>();
    private nextGlobal = 0;
    private backlogWarned = false;
    private lastUnicast = new Map<string, number>();
    private lastPoke = new Map<string, number>();
    private pokeFailures = new Map<string, number>();
    /** When each device's automatic reboots went out, within AUTO_REBOOT_WINDOW. */
    private autoReboots = new Map<string, number[]>();
    /** When each device was last rebooted, automatically or by its Reboot button. */
    private lastReboot = new Map<string, number>();
    private lastAutoReboot = Number.NEGATIVE_INFINITY;
    private answered = new Set<string>();
    private pending = new Map<string, (reply: GetReply) => void>();
    private lastMtorr = Number.NEGATIVE_INFINITY;
    private readonly startedAt: number;
    private keepaliveTimer: NodeJS.Timeout | undefined;
    private verifyTokens = new Map<string, number>();
    private stopped = false;
    private tx = new Map<string, {sent: number; failed: number; lastFailure?: number}>();
    private mtorrs = 0;
    private stateReads = new Map<string, {at: number; run: () => Promise<StateReadResult>; tries: number}>();
    private readsRunning = false;
    /** Ends the queue's wait for its next read early (something sooner was queued). */
    private wakeReads: (() => void) | undefined;
    /** Devices with a frame in the send window. */
    private inFlight = new Set<string>();
    private waiting: {ieee: string; urgent: boolean; go: () => void; fail: (e: Error) => void}[] = [];
    /** Devices with a load command under way (sendWithRecovery): their frames skip the window. */
    private loadCommands = new Map<string, number>();

    constructor(private readonly host: LinkHost) {
        this.startedAt = host.now();
    }

    stop(): void {
        this.stopped = true;
        for (const w of this.waiting.splice(0)) w.fail(new Error("Control4: link stopped"));
        this.stateReads.clear();
        this.wakeReads?.();
        if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
        this.keepaliveTimer = undefined;
    }

    // -- pacing ---------------------------------------------------------------

    /** `waited`: how long the frame already waited for the send window. */
    async waitTurn(ieee: string, waited = 0): Promise<void> {
        const now = this.host.now();
        const slot = Math.max(now, this.nextDev.get(ieee) ?? 0, this.nextGlobal);
        this.nextDev.set(ieee, slot + SEND_GAP_DEVICE);
        this.nextGlobal = slot + SEND_GAP_GLOBAL;
        const delay = slot - now;
        this.noteBacklog(waited + delay);
        if (delay > 0) await sleep(delay);
    }

    private noteBacklog(delay: number): void {
        if (delay >= BACKLOG_WARN && !this.backlogWarned) {
            this.backlogWarned = true;
            this.host.log.warning(`Control4: transmit backlog is ${Math.round(delay / 1000)}s deep - something is sending faster than the mesh can carry`);
        } else if (delay < 1000) {
            this.backlogWarned = false;
        }
    }

    /**
     * One frame to a device through the send window, then its waitTurn slot.
     * The slot is held until `send` settles (delivered or failed), or for
     * TX_SLOT_HOLD_MAX at most. `urgent` (the controller identity), like a frame
     * of a load command under way, waits only for its own device's frame.
     */
    async transmit<T>(ieee: string, send: () => Promise<T>, urgent = false): Promise<T> {
        if (this.stopped) throw new Error("Control4: link stopped");
        const queuedAt = this.host.now();
        await new Promise<void>((go, fail) => {
            this.waiting.push({ieee, urgent, go, fail});
            this.pump();
        });
        let hold: NodeJS.Timeout | undefined;
        let held = true;
        const release = () => {
            if (!held) return;
            held = false;
            clearTimeout(hold);
            this.inFlight.delete(ieee);
            this.pump();
        };
        try {
            await this.waitTurn(ieee, this.host.now() - queuedAt);
            hold = setTimeout(release, TX_SLOT_HOLD_MAX);
            hold.unref?.();
            return await send();
        } finally {
            release();
        }
    }

    /** Starts every waiting frame that may go: FIFO, one per device, TX_WINDOW unless urgent. */
    private pump(): void {
        for (let i = 0; i < this.waiting.length; ) {
            const w = this.waiting[i];
            const mayGo = !this.inFlight.has(w.ieee) && (w.urgent || this.loadCommands.has(w.ieee) || this.inFlight.size < TX_WINDOW);
            if (!mayGo) {
                i++;
                continue;
            }
            this.waiting.splice(i, 1);
            this.inFlight.add(w.ieee);
            w.go();
        }
    }

    // -- health ------------------------------------------------------------------

    /** Every transmit to a device, delivered or not (for the stats request). */
    noteTx(ieee: string, ok: boolean): void {
        const t = this.tx.get(ieee) ?? {sent: 0, failed: 0};
        t.sent++;
        if (!ok) {
            t.failed++;
            t.lastFailure = this.host.now();
        }
        this.tx.set(ieee, t);
    }

    /** What the stats request reports about one device's link. */
    health(ieee: string): Record<string, number | undefined> {
        const now = this.host.now();
        const t = this.tx.get(ieee);
        const rx = this.lastUnicast.get(ieee);
        const secs = (ts: number | undefined) => (ts === undefined ? undefined : Math.round((now - ts) / 1000));
        return {
            sent: t?.sent ?? 0,
            failed: t?.failed ?? 0,
            last_failure_s: secs(t?.lastFailure),
            last_rx_s: secs(rx),
            keepalive_failures: this.pokeFailures.get(ieee) ?? 0,
        };
    }

    /** Every transmit since start, summed over the devices (for the instance status). */
    totals(): {sent: number; failed: number} {
        let sent = 0;
        let failed = 0;
        for (const t of this.tx.values()) {
            sent += t.sent;
            failed += t.failed;
        }
        return {sent, failed};
    }

    /** Link-wide counters for the stats request. */
    summary(): Record<string, number | undefined> {
        const now = this.host.now();
        return {
            route_refreshes: this.mtorrs,
            last_route_refresh_s: Number.isFinite(this.lastMtorr) ? Math.round((now - this.lastMtorr) / 1000) : undefined,
            state_reads_queued: this.stateReads.size,
            tx_in_flight: this.inFlight.size,
            tx_waiting: this.waiting.length,
        };
    }

    // -- receive bookkeeping ---------------------------------------------------

    noteRx(ieee: string, unicast: boolean): void {
        if (!unicast) return;
        const now = this.host.now();
        const silentSince = this.lastUnicast.get(ieee) ?? this.startedAt;
        this.lastUnicast.set(ieee, now);
        const fails = this.pokeFailures.get(ieee) ?? 0;
        this.pokeFailures.delete(ieee);
        if (fails < KEEPALIVE_WARN_AFTER) return;
        const rebootedAt = this.lastReboot.get(ieee);
        const after = rebootedAt !== undefined && rebootedAt >= silentSince ? ` (${Math.round((now - rebootedAt) / 60_000)} min after a remote reboot)` : "";
        this.host.log.warning(`Control4: ${ieee} is reachable again${after}`);
        this.host.reachabilityChanged?.();
    }

    /** How long ago the device last sent us a unicast; undefined when it has sent none since the start. */
    sinceUnicast(ieee: string, now = this.host.now()): number | undefined {
        const at = this.lastUnicast.get(ieee);
        return at === undefined ? undefined : now - at;
    }

    /** The device was just rebooted (its Reboot button, or autoReboot): the time its re-join count and reboot_min start from. */
    noteRebooted(ieee: string, at = this.host.now()): void {
        this.lastReboot.set(ieee, at);
    }

    /** When the device was last rebooted, automatically or by its Reboot button. */
    lastRebootAt(ieee: string): number | undefined {
        return this.lastReboot.get(ieee);
    }

    /**
     * List a device as unreachable now, without waiting for KEEPALIVE_WARN_AFTER missed
     * keepalives (it re-joined and answers nothing). Its next direct frame clears it, as for those.
     */
    markUnreachable(dev: LinkDevice, why: string): void {
        if ((this.pokeFailures.get(dev.ieee) ?? 0) >= KEEPALIVE_WARN_AFTER) return;
        this.pokeFailures.set(dev.ieee, KEEPALIVE_WARN_AFTER);
        this.host.log.warning(`Control4: ${dev.ieee} (${dev.model}) ${why} - ${this.adviceFor(dev)}`);
        this.autoReboot(dev, "it is unreachable");
        this.host.reachabilityChanged?.();
    }

    private canAutoReboot(dev: LinkDevice): boolean {
        return dev.reboot !== undefined && dev.autoReboot?.() !== false;
    }

    private adviceFor(dev: LinkDevice): string {
        return this.canAutoReboot(dev) ? AUTO_REBOOT_ADVICE : REBOOT_ADVICE;
    }

    /**
     * Reboot a device that can be rebooted remotely (a DIM1-Z, KC120277, APD120). True when one went out.
     * Not when its auto_reboot option is off, it had one less than AUTO_REBOOT_GAP ago or
     * AUTO_REBOOT_MAX within AUTO_REBOOT_WINDOW, the host holds reboots (a traffic alarm),
     * more than AUTO_REBOOT_MAX_UNREACHABLE devices are unreachable at once, or another
     * device got one less than AUTO_REBOOT_INSTANCE_GAP ago. Unreachable devices ask when
     * they are listed and at each later missed keepalive; the runtime asks for a device
     * that keeps re-joining.
     */
    autoReboot(dev: LinkDevice, why: string, now = this.host.now()): boolean {
        if (!this.canAutoReboot(dev)) return false;
        const recent = (this.autoReboots.get(dev.ieee) ?? []).filter((t) => now - t < AUTO_REBOOT_WINDOW);
        this.autoReboots.set(dev.ieee, recent);
        const last = recent.at(-1);
        if (recent.length >= AUTO_REBOOT_MAX || (last !== undefined && now - last < AUTO_REBOOT_GAP)) return false;
        const unreachable = this.unreachable(now).length;
        const held = this.host.rebootsHeld?.() ?? (unreachable > AUTO_REBOOT_MAX_UNREACHABLE ? `${unreachable} devices are unreachable at once` : undefined);
        if (held) {
            this.host.log.info(`Control4: not rebooting ${dev.ieee} (${dev.model}) remotely: ${held}`);
            return false;
        }
        if (now - this.lastAutoReboot < AUTO_REBOOT_INSTANCE_GAP) {
            this.host.log.debug(`Control4: not rebooting ${dev.ieee} yet: another device was rebooted less than a minute ago`);
            return false;
        }
        recent.push(now);
        this.lastAutoReboot = now;
        const before = this.lastReboot.get(dev.ieee);
        this.noteRebooted(dev.ieee, now);
        this.host.log.warning(`Control4: ${dev.ieee} (${dev.model}): ${why} - rebooting it remotely (${recent.length} of ${AUTO_REBOOT_MAX} in 24 h)`);
        void dev.reboot?.().catch((error) => {
            // It never went out (not queued, the handler stopped): it doesn't count.
            const times = this.autoReboots.get(dev.ieee) ?? [];
            const i = times.indexOf(now);
            if (i >= 0) times.splice(i, 1);
            if (this.lastReboot.get(dev.ieee) === now) {
                if (before === undefined) this.lastReboot.delete(dev.ieee);
                else this.lastReboot.set(dev.ieee, before);
            }
            this.host.log.info(`Control4: the remote reboot of ${dev.ieee} was not sent: ${error}`);
        });
        return true;
    }

    /** The device has not answered KEEPALIVE_WARN_AFTER keepalives in a row (or was marked so), and has sent nothing direct since. */
    isUnreachable(ieee: string): boolean {
        return (this.pokeFailures.get(ieee) ?? 0) >= KEEPALIVE_WARN_AFTER;
    }

    /** The devices that have not answered KEEPALIVE_WARN_AFTER keepalives in a row, quietest first. */
    unreachable(now = this.host.now()): Unreachable[] {
        return this.host
            .devices()
            .filter((d) => (this.pokeFailures.get(d.ieee) ?? 0) >= KEEPALIVE_WARN_AFTER)
            .map((d) => {
                const out: Unreachable = {ieee: d.ieee, model: d.model, quietMin: Math.round(this.quietFor(d.ieee, now) / 60_000)};
                // A reboot since it last sent anything direct: one of this silence.
                const rebootedAt = this.lastReboot.get(d.ieee);
                if (rebootedAt !== undefined && rebootedAt >= (this.lastUnicast.get(d.ieee) ?? this.startedAt))
                    out.rebootMin = Math.round((now - rebootedAt) / 60_000);
                return out;
            })
            .sort((a, b) => b.quietMin - a.quietMin);
    }

    resolveReply(ieee: string, frame: ParsedFrame): void {
        if (frame.kind !== "reply" || frame.tokens.length < 2 || frame.seq.length < 4) return;
        this.answered.add(ieee);
        const key = `${ieee}:${frame.seq}`;
        const resolve = this.pending.get(key);
        if (!resolve) return;
        this.pending.delete(key);
        resolve({status: frame.tokens[1], prop: frame.tokens[2], values: frame.tokens.slice(3)});
    }

    canAnswerGet(dev: LinkDevice): boolean {
        return this.answered.has(dev.ieee) || GET_CAPABLE_MODELS.has(dev.model);
    }

    // -- Get round trip -------------------------------------------------------

    /**
     * A Get round trip. The timeout runs from when the Get has gone out (paced
     * and acknowledged), not from when it was queued: on a busy mesh a queued
     * Get must not count as an unanswered one.
     */
    async get(dev: LinkDevice, prop: string, timeout = GET_TIMEOUT): Promise<GetReply | undefined> {
        const seq = hex4(dev.nextSeq());
        const key = `${dev.ieee}:${seq}`;
        let timer: NodeJS.Timeout | undefined;
        let finish: (r: GetReply | undefined) => void = () => undefined;
        const reply = new Promise<GetReply | undefined>((resolve) => {
            finish = resolve;
        });
        this.pending.set(key, (r) => {
            if (timer) clearTimeout(timer);
            finish(r);
        });
        try {
            await dev.sendText(`0g${seq} ${prop}`);
        } catch (error) {
            this.host.log.debug(`Control4: get ${prop} on ${dev.ieee} failed: ${error}`);
            this.pending.delete(key);
            return undefined;
        }
        if (this.pending.has(key)) {
            timer = setTimeout(() => {
                this.pending.delete(key);
                finish(undefined);
            }, timeout);
            timer.unref?.();
        }
        return reply;
    }

    /**
     * What Z2M's availability ping does. Models that answer a Get must answer
     * one; the others never answer, but their radio acknowledges the frame, so
     * a delivered Get proves them reachable and a failed delivery does not.
     * Sleepy devices (the remotes) are not pinged: undefined.
     */
    async honestPing(dev: LinkDevice): Promise<boolean | undefined> {
        if (!dev.isRouter) return undefined;
        if (this.canAnswerGet(dev)) {
            const reply = await this.get(dev, PING_PROPERTY);
            this.host.log.debug(`Control4: availability ping ${dev.ieee} -> ${reply ? "answered" : "no answer"}`);
            return reply !== undefined;
        }
        try {
            await dev.sendText(`0g${hex4(dev.nextSeq())} ${PING_PROPERTY}`);
            this.host.log.debug(`Control4: availability ping ${dev.ieee} -> delivered`);
            return true;
        } catch (error) {
            this.host.log.debug(`Control4: availability ping ${dev.ieee} -> ${error}`);
            return isDeliveryFailure(error) ? false : undefined;
        }
    }

    // -- route refresh ----------------------------------------------------------

    requestRouteRefresh(reason: string): void {
        const now = this.host.now();
        if (now - this.lastMtorr < MTORR_MIN_GAP) return;
        this.lastMtorr = now;
        this.mtorrs++;
        this.host.log.info(`Control4: route refresh (${reason})`);
        this.host.mtorr(MTORR_RADIUS).catch(() => undefined);
    }

    // -- keepalive ----------------------------------------------------------------

    private quietFor(ieee: string, now: number): number {
        return now - (this.lastUnicast.get(ieee) ?? this.startedAt);
    }

    keepaliveCandidates(now = this.host.now()): LinkDevice[] {
        const found: [number, LinkDevice][] = [];
        for (const dev of this.host.devices()) {
            if (!dev.isRouter || !this.canAnswerGet(dev)) continue;
            const quiet = this.quietFor(dev.ieee, now);
            if (quiet < KEEPALIVE_QUIET) continue;
            if (now - (this.lastPoke.get(dev.ieee) ?? Number.NEGATIVE_INFINITY) < KEEPALIVE_REPOKE) continue;
            found.push([quiet, dev]);
        }
        found.sort((a, b) => b[0] - a[0]);
        return found.map(([, d]) => d);
    }

    async poke(dev: LinkDevice): Promise<boolean> {
        this.lastPoke.set(dev.ieee, this.host.now());
        if ((await this.get(dev, PING_PROPERTY)) !== undefined) return true;
        const fails = (this.pokeFailures.get(dev.ieee) ?? 0) + 1;
        this.pokeFailures.set(dev.ieee, fails);
        this.requestRouteRefresh(`keepalive got no answer from ${dev.ieee}`);
        const quietMin = Math.round(this.quietFor(dev.ieee, this.host.now()) / 60_000);
        if (fails === KEEPALIVE_WARN_AFTER) {
            this.host.log.warning(
                `Control4: ${dev.ieee} (${dev.model}) has not answered ${fails} keepalives and has sent nothing direct for ${quietMin} min - ${this.adviceFor(dev)}`,
            );
            this.autoReboot(dev, "it is unreachable");
            this.host.reachabilityChanged?.();
        } else {
            this.host.log.info(`Control4: keepalive ${dev.ieee} got no answer (${fails} in a row, quiet ${quietMin} min)`);
            // Still unreachable: another reboot, AUTO_REBOOT_GAP after the last, up to AUTO_REBOOT_MAX a day.
            if (fails > KEEPALIVE_WARN_AFTER) this.autoReboot(dev, `it is still unreachable after ${fails} keepalives`);
        }
        return false;
    }

    startKeepalive(): void {
        if (this.keepaliveTimer || this.stopped) return;
        const tick = async () => {
            try {
                const todo = this.keepaliveCandidates();
                for (const dev of todo.slice(0, KEEPALIVE_MAX_PER_TICK)) {
                    if (this.stopped) return;
                    await this.poke(dev);
                    await sleep(KEEPALIVE_POKE_GAP);
                }
            } catch (error) {
                this.host.log.debug(`Control4: keepalive pass failed: ${error}`);
            }
            schedule(KEEPALIVE_TICK + (Math.random() * 20_000 - 10_000));
        };
        const schedule = (ms: number) => {
            if (this.stopped) return;
            this.keepaliveTimer = setTimeout(() => void tick(), ms);
            this.keepaliveTimer.unref?.();
        };
        schedule(KEEPALIVE_FIRST_DELAY + Math.random() * 30_000);
    }

    // -- state reads --------------------------------------------------------------

    /**
     * A one-off state read (startup, join, announce). They run one device at a
     * time, the first `delay` after it was queued and STATE_READ_GAP after the
     * previous one, so a floor of dimmers coming up together is read in a
     * trickle, not a burst. A device already queued keeps its place; `run`
     * replaces the queued one. A read that got no answer is queued again
     * (STATE_READ_RETRIES); a skipped one needs no gap. `ieee` may carry a
     * suffix (`<ieee>:settings`) for a second read of the device with its own
     * place, retries and cancel.
     */
    queueStateRead(ieee: string, run: () => Promise<StateReadResult>, delay = STATE_READ_DELAY): void {
        if (this.stopped) return;
        const queued = this.stateReads.get(ieee);
        if (queued) queued.run = run;
        else this.stateReads.set(ieee, {at: this.host.now() + delay, run, tries: 0});
        this.wakeReads?.();
        void this.drainStateReads();
    }

    cancelStateRead(ieee: string): void {
        this.stateReads.delete(ieee);
    }

    private async drainStateReads(): Promise<void> {
        if (this.readsRunning) return;
        this.readsRunning = true;
        try {
            for (;;) {
                if (this.stopped) return;
                // The earliest due (a retry waits at the back without holding up new reads).
                let next: [string, {at: number; run: () => Promise<StateReadResult>; tries: number}] | undefined;
                for (const entry of this.stateReads) if (!next || entry[1].at < next[1].at) next = entry;
                if (!next) return;
                const [ieee, job] = next;
                const wait = job.at - this.host.now();
                if (wait > 0) {
                    await new Promise<void>((resolve) => {
                        const done = () => {
                            clearTimeout(timer);
                            this.wakeReads = undefined;
                            resolve();
                        };
                        const timer = setTimeout(done, wait);
                        timer.unref?.();
                        this.wakeReads = done;
                    });
                    continue; // it may have been cancelled or overtaken meanwhile
                }
                this.stateReads.delete(ieee);
                let result: StateReadResult = "failed";
                try {
                    result = await job.run();
                } catch (error) {
                    this.host.log.debug(`Control4: state read of ${ieee} failed: ${error}`);
                }
                if (result === "failed" && job.tries < STATE_READ_RETRIES.length && !this.stateReads.has(ieee) && !this.stopped) {
                    this.stateReads.set(ieee, {at: this.host.now() + STATE_READ_RETRIES[job.tries], run: job.run, tries: job.tries + 1});
                }
                if (result !== "skipped") await sleep(STATE_READ_GAP);
            }
        } finally {
            this.readsRunning = false;
        }
    }

    // -- recovery -----------------------------------------------------------------

    async sendWithRecovery<T>(ieee: string, send: () => Promise<T>, label: string): Promise<T> {
        // A load command is someone at a switch: its frames skip the send window.
        this.loadCommands.set(ieee, (this.loadCommands.get(ieee) ?? 0) + 1);
        try {
            return await send();
        } catch (error) {
            if (!isDeliveryFailure(error)) throw error;
            this.host.log.info(`Control4: ${label} to ${ieee} failed (${(error as Error).message}) - refreshing routes, retrying in ${RETRY_DELAY / 1000}s`);
            this.requestRouteRefresh(`${label} to ${ieee} failed`);
            await sleep(RETRY_DELAY);
            const result = await send();
            this.host.log.info(`Control4: ${label} to ${ieee} succeeded on retry`);
            return result;
        } finally {
            const n = (this.loadCommands.get(ieee) ?? 1) - 1;
            if (n > 0) this.loadCommands.set(ieee, n);
            else this.loadCommands.delete(ieee);
        }
    }

    /**
     * Read `readProp` back after a write; re-send once on a mismatch. A newer
     * verify for the same (device, label) replaces an older one. A missing
     * reply ends the pass quietly - it must never become a poll loop.
     */
    scheduleVerify(
        dev: LinkDevice,
        label: string,
        readProp: string,
        matches: (values: string[]) => boolean,
        resend: () => Promise<unknown>,
        settleMs = 500,
        onMismatch?: (values: string[]) => void,
    ): Promise<void> {
        const key = `${dev.ieee}:${label}`;
        const token = (this.verifyTokens.get(key) ?? 0) + 1;
        this.verifyTokens.set(key, token);
        const current = () => this.verifyTokens.get(key) === token && !this.stopped;
        const run = async () => {
            await sleep(settleMs);
            let values: string[] = [];
            for (let attempt = 0; attempt < 2; attempt++) {
                if (!current()) return;
                const reply = await this.get(dev, readProp);
                if (reply?.status !== "000") {
                    this.host.log.debug(`Control4 verify ${label} on ${dev.ieee}: no usable reply`);
                    return;
                }
                values = reply.values;
                let good: boolean;
                try {
                    good = matches(values);
                } catch {
                    this.host.log.debug(`Control4 verify ${label}: could not parse ${values.join(" ")}`);
                    return;
                }
                if (good) return;
                if (attempt === 0) {
                    if (!current()) return;
                    this.host.log.info(`Control4 verify ${label} on ${dev.ieee}: device reports ${values.join(" ")} - write was lost, re-sending`);
                    await resend();
                    await sleep(Math.max(settleMs, 1000));
                }
            }
            if (!current()) return;
            this.host.log.warning(`Control4 verify ${label} on ${dev.ieee}: still ${values.join(" ")} after a re-send`);
            try {
                onMismatch?.(values);
            } catch {
                // a hook must not break verification
            }
        };
        return run().catch((error) => this.host.log.debug(`Control4 verify ${label} failed: ${error}`));
    }
}
