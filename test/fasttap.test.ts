import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {Gesture} from "../src/core/constants";
import {FastTaps, setFastTapTiming, type TapObservation} from "../src/core/fasttap";

let taps: FastTaps;
let fired: string[];

beforeEach(() => {
    vi.useFakeTimers();
    setFastTapTiming(300);
    taps = new FastTaps();
    fired = [];
});

afterEach(() => {
    vi.useRealTimers();
    setFastTapTiming(2000);
});

const WINDOW = 50;

/** Observe a gesture the way a device does: a fast count the gesture closes is published after it. */
const feed = (g: Gesture, key = "k", windowMs = WINDOW) => {
    const tap = taps.observe(key, g, windowMs, (f) => fired.push(`${key}:${f}`));
    if (tap.fastCount) fired.push(`${key}:${tap.fastCount}`);
    return tap;
};

async function seq(steps: [Gesture, number][], key = "k"): Promise<TapObservation[]> {
    const seen: TapObservation[] = [];
    for (const [g, wait] of steps) {
        seen.push(feed(g, key));
        await vi.advanceTimersByTimeAsync(wait);
    }
    return seen;
}

describe("fast multi-tap", () => {
    it.each([
        [1, "fast_single"],
        [2, "fast_double"],
        [3, "fast_triple"],
        [5, "fast_quadruple"],
    ])("counts %i presses within the window", async (n, expected) => {
        await seq(Array.from({length: n}, () => ["press", 10] as [Gesture, number]));
        await vi.advanceTimersByTimeAsync(150);
        expect(fired).toEqual([`k:${expected}`]);
    });

    it("treats presses further apart as separate taps", async () => {
        await seq([
            ["press", 200],
            ["press", 200],
        ]);
        expect(fired).toEqual(["k:fast_single", "k:fast_single"]);
    });

    it("cancels a pending tap on hold", async () => {
        await seq([
            ["press", 10],
            ["hold", 150],
        ]);
        expect(fired).toEqual([]);
    });

    it("counts buttons separately", async () => {
        feed("press", "top");
        feed("press", "bottom");
        await vi.advanceTimersByTimeAsync(150);
        expect(fired.sort()).toEqual(["bottom:fast_single", "top:fast_single"]);
    });

    it("closes each sequence one tap window after its last press, per call", async () => {
        feed("press", "quick", 50);
        feed("press", "slow", 200);
        await vi.advanceTimersByTimeAsync(100);
        expect(fired).toEqual(["quick:fast_single"]);
        await vi.advanceTimersByTimeAsync(150);
        expect(fired).toEqual(["quick:fast_single", "slow:fast_single"]);
    });

    it("ignores other gestures", async () => {
        await seq([
            ["single", 10],
            ["double", 150],
        ]);
        expect(fired).toEqual([]);
    });

    it("waits for the release on buttons that send one", async () => {
        taps.releasers.add("k");
        await seq([
            ["press", 100],
            ["release", 50],
        ]);
        expect(fired).toEqual(["k:fast_single"]);
    });

    it("hands back the fast count a late release closes, for the caller to publish after it", async () => {
        taps.releasers.add("k");
        feed("press");
        await vi.advanceTimersByTimeAsync(100);
        const tap = taps.observe("k", "release", WINDOW, (f) => fired.push(`k:${f}`));
        expect(tap).toEqual({tapIndex: 1, fastCount: "fast_single", allTapsKnown: true, knownTapIndex: 1});
        expect(fired).toEqual([]);
    });

    it("never counts a releaser's hold as a tap", async () => {
        taps.releasers.add("k");
        await seq([
            ["press", 150],
            ["hold", 50],
            ["hold_release", 400],
        ]);
        expect(fired).toEqual([]);
    });

    it("counts a releaser's double tap", async () => {
        taps.releasers.add("k");
        await seq([
            ["press", 10],
            ["release", 10],
            ["press", 10],
            ["release", 150],
        ]);
        expect(fired).toEqual(["k:fast_double"]);
    });

    it("drops a sequence whose release is lost", async () => {
        taps.releasers.add("k");
        await seq([["press", 500]]);
        expect(fired).toEqual([]);
        expect(taps.pending).toBe(0);
    });

    it("learns that a button sends releases", async () => {
        await seq([
            ["press", 10],
            ["release", 150],
        ]);
        expect(taps.releasers.has("k")).toBe(true);
    });
});

describe("tap index", () => {
    const index = (g: Gesture, key = "k") => feed(g, key).tapIndex;
    /** Tap indexes of gestures fed 10 ms apart. */
    const indexes = async (gestures: Gesture[]) => (await seq(gestures.map((g) => [g, 10]))).map((tap) => tap.tapIndex);

    it("numbers the presses of a 1-4 tap sequence from 1", async () => {
        expect(await indexes(["press", "press", "press", "press"])).toEqual([1, 2, 3, 4]);
    });

    it("gives a release the index of the press it ends", async () => {
        taps.releasers.add("k");
        expect(await indexes(["press", "release", "press", "release"])).toEqual([1, 1, 2, 2]);
    });

    it("starts again at 1 after a hold", async () => {
        expect(await indexes(["press", "press", "hold", "press"])).toEqual([1, 2, undefined, 1]);
    });

    it("starts again at 1 once the tap window has closed", async () => {
        expect(index("press")).toBe(1);
        await vi.advanceTimersByTimeAsync(10);
        expect(index("press")).toBe(2);
        await vi.advanceTimersByTimeAsync(100);
        expect(index("press")).toBe(1);
    });

    it("starts again at 1 when the last press's release was lost", async () => {
        taps.releasers.add("k");
        expect(await seq([["press", 100]])).toEqual([{tapIndex: 1}]);
        expect(index("press")).toBe(1);
        // Past the lost sequence's release timeout: it must not take the new one with it.
        await vi.advanceTimersByTimeAsync(260);
        expect(feed("release")).toEqual({tapIndex: 1, fastCount: "fast_single", allTapsKnown: true, knownTapIndex: 1});
    });
});
