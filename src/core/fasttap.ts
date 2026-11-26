/**
 * Fast multi-tap: count paddle-down presses here instead of waiting out the
 * device's own ~1.6 s multi-tap window (port of c4_helpers.observe_fast_tap).
 *
 * A sequence ends one tap window after its last press (the window given with
 * the press that started it, so a change applies to the next sequence) and is
 * announced as fast_single / fast_double / fast_triple /
 * fast_quadruple. Buttons that have been seen to send a tap release are only
 * reported once the release of the last press arrives, so a hold can never be
 * mistaken for a tap. A hold (LONG_PRESS) cancels the pending sequence.
 *
 * Each tap is also announced (tap_known) the moment it is known to be a tap:
 * on its release for a button already seen releasing, at the press on a
 * device with no hold. A fast count says whether every one of its taps was
 * announced, so HA can tell a sequence it already acted on from one it didn't.
 * Once one tap of a sequence goes unannounced (a lost release, or a button
 * not yet seen releasing), none of its later taps is announced either; the
 * fast count, which then says known_taps false, handles the taps not announced.
 */

import type {Gesture} from "./constants";

export let FAST_TAP_RELEASE_TIMEOUT = 2000;

/** Test hook. */
export function setFastTapTiming(releaseTimeoutMs: number): void {
    FAST_TAP_RELEASE_TIMEOUT = releaseTimeoutMs;
}

const FAST: Record<number, Gesture> = {1: "fast_single", 2: "fast_double", 3: "fast_triple"};

/** What one gesture told the counter. */
export interface TapObservation {
    /** The position of this press, or of the press this release ends, in its open tap sequence (1 for the first). */
    tapIndex?: number;
    /** The fast count this release closed (its tap window had already ended), to publish after the release. */
    fastCount?: Gesture;
    /** Whether every tap of the sequence `fastCount` closes was announced as tap_known. */
    allTapsKnown?: boolean;
    /** The tap index of the tap this gesture made known to be a tap, to publish as tap_known after it. */
    knownTapIndex?: number;
}

interface TapState {
    count: number;
    /** The tap window given with the press that started the sequence (ms). */
    windowMs: number;
    awaitingRelease: boolean;
    expired: boolean;
    /** Every tap so far was announced as tap_known. */
    allTapsKnown: boolean;
    timer?: NodeJS.Timeout;
}

export class FastTaps {
    private taps = new Map<string, TapState>();
    /** Keys seen sending a release; devices add the ones kept in their saved settings when they start. */
    readonly releasers = new Set<string>();

    get pending(): number {
        return this.taps.size;
    }

    /**
     * Feed one gesture before it is published. A sequence's fast count comes
     * back one of two ways: `emit` fires it when a tap window ends the
     * sequence, and a release that ends it returns it as `fastCount`, which
     * the caller must publish after the release or it is lost. On a device
     * with no hold (`hasHold` false) a press is known to be a tap at once.
     */
    observe(key: string, gesture: Gesture, windowMs: number, emit: (fast: Gesture, allTapsKnown: boolean) => void, hasHold = true): TapObservation {
        const state = this.taps.get(key);

        const clear = (s?: TapState) => {
            if (s?.timer) clearTimeout(s.timer);
        };
        const end = (done: TapState): Gesture => {
            this.taps.delete(key);
            clear(done);
            return FAST[done.count] ?? "fast_quadruple";
        };
        const windowClosed = () => {
            const current = this.taps.get(key);
            if (!current) return;
            current.timer = undefined;
            if (!current.awaitingRelease) {
                emit(end(current), current.allTapsKnown);
                return;
            }
            current.expired = true;
            current.timer = setTimeout(() => this.taps.delete(key), FAST_TAP_RELEASE_TIMEOUT);
            current.timer.unref?.();
        };

        if (gesture === "hold") {
            clear(state);
            this.taps.delete(key);
            return {};
        }
        if (gesture === "release") {
            this.releasers.add(key);
            if (state) {
                // A sequence with a tap that was never announced is handled whole by its fast count.
                const knownTapIndex = state.awaitingRelease && state.allTapsKnown ? state.count : undefined;
                state.awaitingRelease = false;
                if (state.expired) return {tapIndex: state.count, fastCount: end(state), allTapsKnown: state.allTapsKnown, knownTapIndex};
                return {tapIndex: state.count, knownTapIndex};
            }
            return {};
        }
        if (gesture !== "press") return {};
        clear(state);
        // An expired sequence still waiting here lost its last release: start a new one.
        const s: TapState = state && !state.expired ? state : {count: 0, windowMs, awaitingRelease: false, expired: false, allTapsKnown: true};
        // The last press's release never came, so that tap was never announced.
        if (s.awaitingRelease) s.allTapsKnown = false;
        s.count += 1;
        s.awaitingRelease = this.releasers.has(key);
        // A press with no release to wait for is never announced: it may still turn into a hold.
        if (!s.awaitingRelease && hasHold) s.allTapsKnown = false;
        s.timer = setTimeout(windowClosed, s.windowMs);
        s.timer.unref?.();
        this.taps.set(key, s);
        return {tapIndex: s.count, knownTapIndex: hasHold ? undefined : s.count};
    }

    clear(): void {
        for (const s of this.taps.values()) if (s.timer) clearTimeout(s.timer);
        this.taps.clear();
    }
}
