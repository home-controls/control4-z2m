/**
 * The traffic alarms (#20): the two silent ways Control4 traffic can stop while
 * everything else looks fine, raised as instance status problems.
 *
 * - `no_frames`: no Control4 frame of any kind has come through the receive
 *   hook for 30 min, counted from the start. Armed only while the instance has
 *   a router that keepalive pokes once it has been quiet 20 min (one that
 *   answers a Get), so a healthy instance always hears something sooner. An
 *   instance of keypads and remotes alone can be quiet for hours, and is not
 *   watched.
 * - `sends_failing`: 5 sends in a row got no messageSent from herdsman at all.
 *   Any messageSent clears it, a failure status included: a dead device's sends
 *   are confirmed as undelivered, and never trip it.
 *
 * Each raise logs one error, each clear one info line, and both tell the host,
 * which republishes the status.
 */

import type {Logger} from "./log";

/** How long without a Control4 frame is silence, on an armed instance. */
export const SILENT_AFTER = 30 * 60_000;
/** Sends in a row without a messageSent that raise sends_failing. */
export const UNCONFIRMED_LIMIT = 5;
const CHECK_EVERY = 60_000;

export type TrafficProblem = "no_frames" | "sends_failing";

export interface TrafficHost {
    log: Logger;
    now(): number;
    /** The instance has a router keepalive would hear from. */
    armed(): boolean;
    /** A problem was raised or cleared. */
    changed(): void;
}

export class TrafficWatch {
    private startedAt: number;
    private lastFrame: number | undefined;
    private unconfirmed = 0;
    private raised = new Set<TrafficProblem>();
    private timer: NodeJS.Timeout | undefined;

    constructor(private readonly host: TrafficHost) {
        this.startedAt = host.now();
    }

    start(): void {
        this.startedAt = this.host.now();
        if (this.timer) return;
        this.timer = setInterval(() => this.check(), CHECK_EVERY);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    armed(): boolean {
        return this.host.armed();
    }

    problems(): TrafficProblem[] {
        return (["no_frames", "sends_failing"] as const).filter((p) => this.raised.has(p));
    }

    /** Seconds since the last Control4 frame; null before the first. */
    lastFrameSeconds(): number | null {
        return this.lastFrame === undefined ? null : Math.round((this.host.now() - this.lastFrame) / 1000);
    }

    /** A Control4 frame came through the receive hook. */
    frame(): void {
        this.lastFrame = this.host.now();
        if (this.lower("no_frames")) this.host.log.info("Control4: Control4 frames are coming through again");
    }

    /** A send ended: `messageSent` says whether herdsman confirmed it (undefined: the outcome doesn't tell). */
    sent(messageSent: boolean | undefined): void {
        if (messageSent === undefined) return;
        if (messageSent) {
            this.unconfirmed = 0;
            if (this.lower("sends_failing")) this.host.log.info("Control4: sends are confirmed again");
            return;
        }
        this.unconfirmed++;
        if (this.unconfirmed >= UNCONFIRMED_LIMIT && this.raise("sends_failing")) {
            this.host.log.error(
                `Control4: the last ${UNCONFIRMED_LIMIT} sends got no delivery confirmation (no messageSent from herdsman): commands to Control4 devices are not getting through, or not being confirmed. A herdsman, coordinator firmware or adapter change?`,
            );
        }
    }

    check(): void {
        if (!this.host.armed()) {
            this.lower("no_frames");
            return;
        }
        const quiet = this.host.now() - (this.lastFrame ?? this.startedAt);
        if (quiet >= SILENT_AFTER && this.raise("no_frames")) {
            this.host.log.error(
                `Control4: no Control4 frame has come through Zigbee2MQTT for ${Math.round(quiet / 60_000)} min, though this instance has devices that answer keepalives: Control4 buttons here go unheard. Zigbee2MQTT has stopped handing Control4 frames to the extension - a herdsman, coordinator firmware or adapter change?`,
            );
        }
    }

    private raise(p: TrafficProblem): boolean {
        if (this.raised.has(p)) return false;
        this.raised.add(p);
        this.host.changed();
        return true;
    }

    private lower(p: TrafficProblem): boolean {
        if (!this.raised.delete(p)) return false;
        this.host.changed();
        return true;
    }
}
