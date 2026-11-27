import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {AnimationEngine, type Animator, type AnimatorHost, DM_STEP_PER_LED, MIN_INTERVAL, PULSE_GAMMA, parseColour, TxPump} from "../src/core/animation";
import {Rig, silent, tick} from "./rig";

class Host implements AnimatorHost {
    ieee = "0x000fff00000000d1";
    name = "test";
    alive = true;
    sent: string[] = [];
    notifying: boolean[] = [];
    load: boolean | undefined = true;
    stored: Record<number, [string, string]> = {0: ["ff0000", "ff0000"], 1: ["0000ff", "0000ff"]};
    verify: {matches: (v: string[]) => boolean; resend: () => Promise<void>}[] = [];
    async set(cmd: string) {
        this.sent.push(cmd);
    }
    idleHex(btn: number) {
        return btn === 0 ? "000010" : "000000";
    }
    dmStored(btn: number): [string, string] {
        return this.stored[btn] ?? ["000000", "000000"];
    }
    loadOn() {
        return this.load;
    }
    onNotifying(a: boolean) {
        this.notifying.push(a);
    }
    verifyDm(matches: (v: string[]) => boolean, resend: () => Promise<void>) {
        this.verify.push({matches, resend});
    }
    quietMs?: () => number;
}

let engine: AnimationEngine;
let host: Host;

beforeEach(() => {
    vi.useFakeTimers();
    engine = new AnimationEngine(new TxPump(silent), silent);
    host = new Host();
});

afterEach(() => {
    engine.tx.stop();
    vi.useRealTimers();
});

describe("TxPump", () => {
    it("keeps other devices' frames moving while one device does not acknowledge", async () => {
        const pump = new TxPump(silent);
        const dead = {alive: true, set: () => new Promise<void>(() => undefined)}; // never confirms
        const done: string[] = [];
        const live = {alive: true, set: async (c: string) => void done.push(c)};
        for (let i = 0; i < 20; i++) pump.submit(dead, `dead ${i}`);
        for (let i = 0; i < 5; i++) pump.submit(live, `live ${i}`);
        await vi.advanceTimersByTimeAsync(1000);
        expect(done).toEqual(["live 0", "live 1", "live 2", "live 3", "live 4"]);
        expect(pump.stats()).toMatchObject({in_flight: 1, dropped: 3}); // 1 in flight + 16 queued; the rest dropped
        // A removed device's queued frames are dropped, not sent.
        dead.alive = false;
        pump.submit(live, "after");
        await vi.advanceTimersByTimeAsync(200);
        expect(done.at(-1)).toBe("after");
        pump.stop();
    });
});

describe("colours", () => {
    it("parses names, states, hex, lists and palette indexes", () => {
        expect(parseColour("amber")).toEqual([255, 191, 0]);
        expect(parseColour("unavailable")).toEqual([255, 0, 0]);
        expect(parseColour("#0f0")).toEqual([0, 255, 0]);
        expect(parseColour("ff8800")).toEqual([255, 136, 0]);
        expect(parseColour([1, 2, 300])).toEqual([1, 2, 255]);
        expect(parseColour(11)).toEqual([0, 0, 255]);
        expect(() => parseColour("nope")).toThrow();
    });

    it("steps a pulse evenly to the eye (small steps near off)", async () => {
        const kp = engine.register(host, [0], "kp");
        await kp.play({
            effect: "pulse",
            buttons: [0],
            colour: [255, 255, 255],
            colour2: [0, 0, 0],
            interval: MIN_INTERVAL,
            count: 1,
            brightness: 100,
            priority: 1,
            restore: false,
        });
        await tick(5000);
        const rise = host.sent.slice(0, 9).map((c) => Number.parseInt(c.slice(-2), 16));
        expect(rise[0]).toBe(0);
        expect([...rise].sort((a, b) => a - b)).toEqual(rise);
        expect(rise[1] - rise[0]).toBeLessThan((rise[8] - rise[7]) / 4);
        expect(PULSE_GAMMA).toBe(2.2);
    });
});

describe("kp / dmx animations", () => {
    it("blinks, diffs unchanged buttons, then restores the status layer", async () => {
        const kp = engine.register(host, [0, 1, 2], "kp");
        await kp.play({
            effect: "blink",
            buttons: [0, 1],
            colour: [255, 0, 0],
            colour2: [0, 0, 0],
            interval: 200,
            count: 1,
            brightness: 100,
            priority: 10,
            restore: true,
        });
        await tick(2000);
        expect(host.sent).toEqual([
            "c4.kp.lv 00 ff0000",
            "c4.kp.lv 01 ff0000",
            "c4.kp.lv 00 000000",
            "c4.kp.lv 01 000000",
            // restore (forced): idle colours of the two buttons the blink painted; button 3 was never painted
            "c4.kp.lv 00 000010",
            "c4.kp.lv 01 000000",
        ]);
        expect(host.notifying).toEqual([true, false]);
    });

    it("refuses a lower priority overlay and lets a higher one preempt", async () => {
        const kp = engine.register(host, [0], "kp");
        const spec = {
            effect: "blink",
            buttons: [0],
            colour: [255, 0, 0] as [number, number, number],
            colour2: [0, 0, 0] as [number, number, number],
            interval: 200,
            count: 0,
            brightness: 100,
            restore: true,
        };
        expect(await kp.play({...spec, priority: 50})).toBe(true);
        expect(await kp.play({...spec, priority: 10})).toBe(false);
        expect(await kp.play({...spec, priority: 60})).toBe(true);
        await kp.stop();
        expect(host.notifying).toEqual([true, false]);
    });

    it("writes both colours per slot on dmx", async () => {
        const a = engine.register(host, [0], "dmx");
        await a.play({
            effect: "solid",
            buttons: [0],
            colour: [0, 255, 0],
            colour2: [0, 0, 0],
            interval: 3000,
            count: 1,
            brightness: 100,
            priority: 1,
            restore: false,
        });
        await tick(500);
        expect(host.sent).toEqual(["c4.dmx.led 00 03 00ff00", "c4.dmx.led 00 04 00ff00"]);
    });

    it("keeps a status button's pressed colour apart on dmx and kp", async () => {
        const a = engine.register(host, [0, 1], "dmx");
        await a.setStatus({buttons: 1, colour: [0, 255, 255], brightness: 50, pressed: [255, 0, 0], pressedBrightness: 100});
        await a.setStatus({buttons: 2, colour: [0, 255, 0]});
        await tick(500);
        expect(host.sent).toEqual([
            "c4.dmx.led 00 03 ff0000",
            "c4.dmx.led 00 04 008080",
            // button 2 is left alone until its own status
            "c4.dmx.led 01 03 00ff00",
            "c4.dmx.led 01 04 00ff00",
        ]);
        // Same colours again: nothing re-sent. A new pressed colour alone is sent.
        host.sent = [];
        await a.setStatus({buttons: 1, colour: [0, 255, 255], brightness: 50, pressed: [255, 0, 0], pressedBrightness: 100});
        await tick(300);
        expect(host.sent).toEqual([]);
        await a.setStatus({buttons: 1, colour: [0, 255, 255], brightness: 50, pressed: [255, 0, 0], pressedBrightness: 10});
        await tick(300);
        expect(host.sent).toEqual(["c4.dmx.led 00 03 1a0000", "c4.dmx.led 00 04 008080"]);

        const h2 = new Host();
        h2.ieee = "0x000fff00000000d2";
        const kp = engine.register(h2, [0], "kp");
        await kp.setStatus({buttons: 1, colour: [0, 0, 255], pressed: [255, 0, 0]});
        await tick(300);
        expect(h2.sent).toEqual(["c4.kp.lv 00 0000ff", "c4.kp.lo 00 ff0000"]);
    });

    it("keeps status colours on buttons outside the overlay", async () => {
        const kp = engine.register(host, [0, 1, 2], "kp");
        await kp.play({
            effect: "blink",
            buttons: [2],
            colour: [255, 0, 0],
            colour2: [0, 0, 0],
            interval: 1000,
            count: 0,
            brightness: 100,
            priority: 10,
            restore: true,
        });
        await tick(100);
        host.sent = [];
        await kp.setStatus({buttons: [2, 3], colour: [0, 0, 255]}); // 1-based: ids 1 and 2
        await tick(300);
        // Button 2 outside the overlay follows the status layer; button 3 is left to the overlay, button 1 was never painted.
        expect(host.sent).toEqual(["c4.kp.lv 01 0000ff"]);
    });

    it("caps simultaneous animations", async () => {
        const hosts: Animator[] = [];
        for (let i = 0; i < 9; i++) {
            const h = new Host();
            h.ieee = `0x000fff00000001${i.toString(16).padStart(2, "0")}`;
            hosts.push(engine.register(h, [0], "kp"));
        }
        const spec = {
            effect: "blink",
            buttons: [0],
            colour: [255, 0, 0] as [number, number, number],
            colour2: [0, 0, 0] as [number, number, number],
            interval: 500,
            count: 0,
            brightness: 100,
            priority: 1,
            restore: false,
        };
        const results = [];
        for (const a of hosts) results.push(await a.play({...spec}));
        expect(results.filter(Boolean).length).toBe(8);
    });

    it("resolves 1-based button numbers", () => {
        const kp = engine.register(host, [0, 1, 2], "kp");
        expect(kp.resolveButtons("1, 3")).toEqual([0, 2]);
        expect(kp.resolveButtons(["2"])).toEqual([1]);
        expect(kp.resolveButtons("all")).toEqual([0, 1, 2]);
        expect(kp.resolveButtons(undefined)).toEqual([0, 1, 2]);
    });
});

describe("dm painter (DIM1-Z)", () => {
    it("paints the visible slot, attaches once, then the hidden slot", async () => {
        const a = engine.register(host, [0, 1], "dm");
        await a.play({
            effect: "solid",
            buttons: [0],
            colour: [255, 0, 0],
            colour2: [0, 0, 0],
            interval: 3000,
            count: 1,
            brightness: 100,
            priority: 1,
            restore: false,
        });
        await tick(2000);
        expect(host.sent).toEqual(["c4.dm.l0o ff0000", "c4.dm.lm 01", "c4.dm.l0f ff0000"]);
    });

    it("holds a status paint until the load has stopped ramping", async () => {
        let quiet = 2000;
        host.quietMs = () => quiet;
        const a = engine.register(host, [0, 1], "dm");
        await a.setStatus({buttons: 1, colour: [0, 255, 0]});
        await tick(1000);
        expect(host.sent).toEqual([]);
        quiet = 1500; // still ramping when the first wait ends
        await tick(1200);
        expect(host.sent).toEqual([]);
        quiet = 0;
        await a.setStatus({buttons: 1, colour: [0, 0, 255]}); // the latest status is what gets painted
        await tick(3000);
        expect(host.sent[0]).toBe("c4.dm.l0o 0000ff");
        expect(host.sent).toContain("c4.dm.lm 01");
        expect(host.sent.some((c) => c.includes("00ff00"))).toBe(false);
    });

    it("paints both slots before attaching when the load state is unknown", async () => {
        host.load = undefined;
        const a = engine.register(host, [0, 1], "dm");
        await a.play({
            effect: "solid",
            buttons: [1],
            colour: [0, 0, 255],
            colour2: [0, 0, 0],
            interval: 3000,
            count: 1,
            brightness: 100,
            priority: 1,
            restore: false,
        });
        await tick(2000);
        expect(host.sent).toEqual(["c4.dm.l1o 0000ff", "c4.dm.l1f 0000ff", "c4.dm.lm 01"]);
    });

    it("clamps the step to the per-LED floor", async () => {
        const a = engine.register(host, [0, 1], "dm");
        const t0 = Date.now();
        await a.play({
            effect: "blink",
            buttons: [0, 1],
            colour: [255, 0, 0],
            colour2: [0, 0, 0],
            interval: 150,
            count: 1,
            brightness: 100,
            priority: 1,
            restore: false,
        });
        await tick(5000);
        expect(DM_STEP_PER_LED).toBe(200);
        expect(host.notifying).toEqual([true, false]);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
    });

    it("verifies the paint and rewrites lost slots", async () => {
        host.load = false;
        const a = engine.register(host, [0, 1], "dm");
        await a.setStatus({buttons: [1, 2], colour: [0, 0, 0], clear: true});
        await tick(3000);
        expect(host.verify.length).toBe(1);
        const v = host.verify[0];
        // c4.dm.is values: level max onramp offramp top-on top-off bottom-on bottom-off flags
        expect(v.matches(["00", "64", "02ee", "07d0", "ff0000", "ff0000", "0000ff", "0000ff", "03"])).toBe(true);
        expect(v.matches(["00", "64", "02ee", "07d0", "ff0000", "ff0000", "0000ff", "000000", "03"])).toBe(false);
        host.sent = [];
        const r = v.resend();
        await tick(500);
        await r;
        expect(host.sent).toEqual(["c4.dm.l1f 0000ff"]);
    });
});

describe("LED engine through a device", () => {
    let rig: Rig;
    const KP = "0x000fff00000000d9";
    beforeEach(() => {
        rig = new Rig();
        rig.add(KP, "KPZ-3B1");
        rig.start();
    });
    afterEach(() => rig.stop());

    it("plays led_effect from /set and reports led_notification", async () => {
        const p = rig.runtime.set(KP, "led_effect", {effect: "blink", color: "red", buttons: "2", count: 1, interval: 0.2}, {message: {}});
        await tick(10);
        await p;
        expect(rig.last(KP).led_notification).toBe(true);
        await tick(2000);
        expect(rig.last(KP).led_notification).toBe(false);
        expect(rig.actions(KP)).toEqual(["led_notification_start", "led_notification_end"]);
        expect(rig.cmds()).toContain("c4.kp.lv 01 ff0000");
    });

    it("sets a status colour by state name", async () => {
        const p = rig.runtime.set(KP, "led_status", {buttons: 1, state: "alert"}, {message: {}});
        await tick(500);
        await p;
        expect(rig.cmds()).toContain("c4.kp.lv 00 ff0000");
    });
});

describe.each([
    // `led`: an LED frame, capturing the LED id. LED 2 returns to blue when cleared (its idle / stored colour).
    {name: "keypad", ieee: "0x000fff00000000e1", model: "C4-KP6-Z", count: 6, led: /^c4\.kp\.l[vo] ([0-9a-f]{2}) /, idle: {button_2_idle_color: "blue"}},
    {name: "KC120277", ieee: "0x000fff00000000e2", model: "C4-KC120277", count: 12, led: /^c4\.dmx\.led ([0-9a-f]{2}) /, idle: {led_2_idle_color: "blue"}},
    {
        name: "DIM1-Z",
        ieee: "0x000fff00000000e3",
        model: "C4-DIM1-Z",
        count: 2,
        led: /^c4\.dm\.l([01])[of] /,
        idle: {led_bottom_on_color: "blue", led_bottom_off_color: "blue"},
    },
])("after a start, a $name paints only LEDs painted since the start", (d) => {
    let rig: Rig;
    const nums = Array.from({length: d.count}, (_, i) => i + 1);
    const odd = nums.filter((n) => n % 2 === 1);
    const even = nums.filter((n) => n % 2 === 0);
    /** 1-based buttons -> {LED id: colour}. */
    const paint = (buttons: number[], colour: string) => Object.fromEntries(buttons.map((n) => [n - 1, colour]));

    beforeEach(() => {
        rig = new Rig();
        rig.add(d.ieee, d.model);
        for (const [k, v] of Object.entries(d.idle)) rig.store.set(d.ieee, k, v);
        rig.start();
    });
    afterEach(() => rig.stop());

    /** Send a /set key and let its frames go out; returns where they start. */
    async function send(key: string, value: Record<string, unknown>): Promise<number> {
        const from = rig.transport.sent.length;
        const p = rig.runtime.set(d.ieee, key, value, {message: {}});
        await tick(3000);
        await p;
        return from;
    }

    /** {LED id: the colour last sent to it} since `from` ("mixed" when its slots disagree). */
    function shown(from: number): Record<number, string> {
        const last = new Map<string, [number, string]>();
        for (const c of rig.cmds(from)) {
            const m = d.led.exec(c);
            const cut = c.lastIndexOf(" ");
            if (m) last.set(c.slice(0, cut), [Number.parseInt(m[1], 16), c.slice(cut + 1)]);
        }
        const out: Record<number, string> = {};
        for (const [id, colour] of last.values()) out[id] = out[id] === undefined || out[id] === colour ? colour : "mixed";
        return out;
    }

    it("sends a led_status only to the LEDs it names, then a second only to the rest", async () => {
        let from = await send("led_status", {buttons: odd, color: "amber"});
        expect(shown(from)).toEqual(paint(odd, "ffbf00"));
        from = await send("led_status", {buttons: even, color: "off"});
        expect(shown(from)).toEqual(paint(even, "000000"));
    });

    it("paints a cleared LED back to its idle colour, painted or not", async () => {
        let from = await send("led_status", {buttons: 2, clear: true});
        expect(shown(from)).toEqual({1: "0000ff"});
        from = await send("led_status", {buttons: 1, color: "red"});
        expect(shown(from)).toEqual({0: "ff0000"});
        from = await send("led_status", {buttons: 1, clear: true});
        expect(shown(from)).toEqual({0: "000000"});
    });

    it("paints an effect's LEDs back to their status or idle colour on led_stop", async () => {
        let from = await send("led_effect", {effect: "blink", buttons: 2, color: "green", count: 0, interval: 1});
        expect(Object.keys(shown(from))).toEqual(["1"]);
        from = await send("led_stop", {restore: true});
        expect(shown(from)).toEqual({1: "0000ff"});
        await send("led_status", {buttons: 1, color: "red"});
        await send("led_effect", {effect: "blink", buttons: 1, color: "green", count: 0, interval: 1});
        from = await send("led_stop", {restore: true});
        expect(shown(from)).toEqual({0: "ff0000", 1: "0000ff"});
    });

    it("paints an effect's LEDs back when it ends, and no others", async () => {
        const from = await send("led_effect", {effect: "blink", buttons: 2, color: "green", count: 1, interval: 0.5});
        await tick(3000);
        expect(rig.last(d.ieee).led_notification).toBe(false);
        expect(shown(from)).toEqual({1: "0000ff"});
    });

    it("runs a status effect on its LEDs only", async () => {
        const from = await send("led_status", {buttons: 2, color: "green", effect: "blink", interval: 1});
        expect(Object.keys(shown(from))).toEqual(["1"]);
    });
});
// A status frame that does not go out is painted again by the extension itself
// (LED_HEAL_DELAYS), not left for Home Assistant's next led_status or LED re-check.
describe("status self-repaint", () => {
    /** Drops (submit returns false, as on a full queue) every frame `drop` matches. */
    class DroppingPump extends TxPump {
        drop: ((cmd: string) => boolean) | undefined;
        override submit(target: Parameters<TxPump["submit"]>[0], cmd: string, done?: (ok: boolean) => void): boolean {
            if (this.drop?.(cmd)) return false;
            return super.submit(target, cmd, done);
        }
    }
    let pump: DroppingPump;
    beforeEach(() => {
        engine.tx.stop();
        pump = new DroppingPump(silent);
        engine = new AnimationEngine(pump, silent);
    });

    it("counts a dmx LED whose second frame was dropped as not sent, and paints it again by itself", async () => {
        const a = engine.register(host, [0], "dmx");
        pump.drop = (c) => c.startsWith("c4.dmx.led 00 04");
        await a.setStatus({buttons: 1, colour: [0, 255, 0]});
        await tick(300);
        expect(host.sent).toEqual(["c4.dmx.led 00 03 00ff00"]);
        pump.drop = undefined;
        host.sent = [];
        await tick(29_000);
        expect(host.sent).toEqual([]);
        await tick(8_000);
        expect(host.sent).toEqual(["c4.dmx.led 00 03 00ff00", "c4.dmx.led 00 04 00ff00"]);
    });

    it("counts a keypad LED whose pressed frame was dropped as not sent", async () => {
        const a = engine.register(host, [0], "kp");
        pump.drop = (c) => c.startsWith("c4.kp.lo");
        await a.setStatus({buttons: 1, colour: [0, 255, 0], pressed: [255, 0, 0]});
        await tick(300);
        pump.drop = undefined;
        host.sent = [];
        await tick(37_000);
        expect(host.sent).toEqual(["c4.kp.lv 00 00ff00", "c4.kp.lo 00 ff0000"]);
    });

    it("does not repaint for an animation's dropped frames, nor while a status effect re-sends on its own", async () => {
        const a = engine.register(host, [0], "kp");
        pump.drop = (c) => c.startsWith("c4.kp.lv");
        await a.play({
            effect: "solid",
            buttons: [0],
            colour: [0, 0, 255],
            colour2: [0, 0, 0],
            interval: 3000,
            count: 1,
            brightness: 100,
            priority: 1,
            restore: false,
        });
        await tick(5_000);
        pump.drop = undefined;
        host.sent = [];
        await tick(15 * 60_000);
        expect(host.sent).toEqual([]);
    });

    it("leaves no self-repaint behind a device that is unregistered", async () => {
        const a = engine.register(host, [0], "kp");
        pump.drop = (c) => c.startsWith("c4.kp.lv");
        await a.setStatus({buttons: 1, colour: [0, 255, 0]});
        pump.drop = undefined;
        engine.unregister(host.ieee);
        host.sent = [];
        await tick(15 * 60_000);
        expect(host.sent).toEqual([]);
    });
});
