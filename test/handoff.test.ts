// The handoff between instances (ADR 0004): a Control4 device that joins one
// instance gets its saved settings, friendly name and device options from the
// instance that last had it, which then lets go of it. Three instances on one
// in-memory broker, each with its own store and Zigbee2MQTT records.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Handoff, type HandoffHost, type HandoffStep, type Profile} from "../src/core/handoff";
import {Store} from "../src/core/store";
import {captureLogger} from "./rig";

const KP = "0x000fff0000636e2a";

interface Sent {
    ieee: string;
    step: HandoffStep;
    body: Record<string, unknown>;
}

/** Every message on the broker, and the instances listening to it. */
const broker: {sent: Sent[]; instances: Instance[]} = {sent: [], instances: []};

class Instance {
    readonly store = new Store(undefined, captureLogger());
    readonly log = captureLogger();
    /** The devices this instance's Zigbee2MQTT has a record of, with their last seen time. */
    readonly records = new Map<string, number>();
    readonly profiles = new Map<string, Profile>();
    readonly adopted: {ieee: string; model: string | undefined; options: Record<string, unknown> | undefined}[] = [];
    readonly evicted: string[] = [];
    readonly settled: {ieee: string; name: string | undefined; evicted: boolean}[] = [];
    /** Drop this instance's messages instead of sending them (a lost publish). */
    mute: HandoffStep[] = [];
    readonly handoff: Handoff;

    constructor(readonly base: string) {
        const host: HandoffHost = {
            base: () => this.base,
            log: this.log,
            store: this.store,
            now: () => Date.now(),
            send: (ieee, step, body) => {
                if (this.mute.includes(step)) return;
                broker.sent.push({ieee, step, body});
                // Every instance gets it, the sender too (it publishes with skipReceive off).
                for (const i of broker.instances) setTimeout(() => i.handoff.onMessage(ieee, step, structuredClone(body)), 5);
            },
            has: (ieee) => this.records.has(ieee),
            lastSeen: (ieee) => this.records.get(ieee),
            profile: (ieee) => (this.records.has(ieee) ? this.profiles.get(ieee) : undefined),
            adopt: (ieee, model, options) => {
                this.adopted.push({ieee, model, options});
                if (options) this.profiles.set(ieee, {...(this.profiles.get(ieee) as Profile), options});
            },
            evict: async (ieee) => {
                this.evicted.push(ieee);
                this.records.delete(ieee);
                this.handoff.left(ieee); // Zigbee2MQTT reports the removal
            },
            settle: (ieee, name, evicted) => this.settled.push({ieee, name, evicted}),
        };
        this.handoff = new Handoff(host);
        broker.instances.push(this);
    }

    /** The device pairs here (a successful join interview). */
    join(ieee: string): void {
        this.records.set(ieee, Date.now());
        this.profiles.set(ieee, {name: ieee, options: {}});
        this.handoff.joined(ieee);
    }

    /** Removed from this instance's Zigbee2MQTT by hand. */
    remove(ieee: string): void {
        this.records.delete(ieee);
        this.handoff.left(ieee);
    }

    sent(step: HandoffStep): Sent[] {
        return broker.sent.filter((s) => s.step === step && s.body.from === this.base);
    }
}

let a: Instance;
let b: Instance;
let c: Instance;

/** `a` has had the keypad: its model, two settings, a name and options; then `a` starts with it. */
function aHadIt(at = Date.now()): void {
    a.store.setModel(KP, "KPZ-3B1");
    a.store.set(KP, "button_1_idle_color", "blue");
    a.store.set(KP, "led_defaults", "existing");
    a.records.set(KP, at);
    a.profiles.set(KP, {name: "Kitchen Keypad", options: {tap_window: 0.8, homeassistant: {name: "Kitchen"}}});
    a.handoff.seed([KP]);
}

/** Let the offers come in, the new instance decide, ack, and hear done. */
const settle = () => vi.advanceTimersByTimeAsync(20_000);

beforeEach(() => {
    vi.useFakeTimers();
    broker.sent = [];
    broker.instances = [];
    a = new Instance("zigbee2mqtt_a");
    b = new Instance("zigbee2mqtt_b");
    c = new Instance("zigbee2mqtt_c");
});

afterEach(() => {
    for (const i of broker.instances) i.handoff.stop();
    vi.useRealTimers();
});

describe("handoff", () => {
    it("gives the new instance the saved settings, name and options of the instance that last had the device, and its learned model at once", async () => {
        aHadIt();
        a.remove(KP); // removed from the old instance first, then paired on the new one
        await vi.advanceTimersByTimeAsync(1_000);
        b.join(KP);
        await settle();

        expect(b.store.model(KP)).toBe("KPZ-3B1");
        expect(b.store.all(KP)).toEqual({button_1_idle_color: "blue", led_defaults: "existing"});
        expect(b.adopted).toEqual([{ieee: KP, model: "KPZ-3B1", options: {tap_window: 0.8, homeassistant: {name: "Kitchen"}}}]);
        // The name, kept by `a` when the device was removed from it.
        expect(b.settled).toEqual([{ieee: KP, name: "Kitchen Keypad", evicted: false}]);
        expect(b.handoff.pending(KP)).toBe(false);
    });

    it("runs on every join: the received settings replace a ZHA-era entry, and a value written since the join survives", async () => {
        aHadIt();
        // `b` holds a copy from the ZHA import, and never had the device itself.
        b.store.setModel(KP, "C4-KP6-Z");
        b.store.set(KP, "button_1_idle_color", "red");
        b.store.set(KP, "button_2_idle_color", "white");
        b.join(KP);
        b.store.set(KP, "button_3_idle_color", "green"); // written from Zigbee2MQTT during the handoff
        await settle();

        expect(b.store.model(KP)).toBe("KPZ-3B1");
        expect(b.store.all(KP)).toEqual({button_1_idle_color: "blue", led_defaults: "existing", button_3_idle_color: "green"});
    });

    it("is answered only by an instance that has had the device, and the one that had it last wins", async () => {
        aHadIt(Date.now() - 60_000);
        // `c` had it more recently, with other values; it still has the record (reset and re-paired without removal).
        c.store.setModel(KP, "KPZ-3B1");
        c.store.set(KP, "button_1_idle_color", "yellow");
        c.records.set(KP, Date.now() - 1_000);
        c.profiles.set(KP, {name: "Kitchen Keypad 2", options: {}});
        c.handoff.seed([KP]);
        // `d` only holds a copy (the ZHA import ran into every instance).
        const d = new Instance("zigbee2mqtt_d");
        d.store.setModel(KP, "KPZ-3B1");
        d.store.set(KP, "button_1_idle_color", "purple");

        b.join(KP);
        await settle();

        expect(d.sent("offer")).toEqual([]);
        expect(b.store.get(KP, "button_1_idle_color")).toBe("yellow");
        expect(b.settled[0]?.name).toBe("Kitchen Keypad 2");
        d.handoff.stop();
    });

    it("ignores its own request", async () => {
        aHadIt();
        a.handoff.joined(KP); // re-interviewed where it already is
        await settle();
        expect(a.sent("offer")).toEqual([]);
        expect(a.store.get(KP, "button_1_idle_color")).toBe("blue");
    });

    it("leaves the old instance with no saved settings, and evicts a record it still has; the new instance then republishes", async () => {
        aHadIt(); // `a` keeps its record: the keypad was reset and re-paired on `b`
        b.join(KP);
        await settle();

        expect(a.store.model(KP)).toBeUndefined();
        expect(a.store.all(KP)).toEqual({});
        expect(a.evicted).toEqual([KP]);
        expect(a.sent("done")).toEqual([expect.objectContaining({body: expect.objectContaining({to: "zigbee2mqtt_b", evicted: true})})]);
        expect(b.settled).toEqual([{ieee: KP, name: "Kitchen Keypad", evicted: true}]);
        // Let go for good: a later join elsewhere is not answered by `a`.
        c.join(KP);
        await settle();
        expect(a.sent("offer")).toHaveLength(1);
    });

    it("acks again when a done is lost, and still settles", async () => {
        aHadIt();
        a.mute = ["done"];
        b.join(KP);
        await settle();
        expect(b.sent("ack").length).toBeGreaterThan(1);
        // It knew from the offer that `a` would evict.
        expect(b.settled).toEqual([{ieee: KP, name: "Kitchen Keypad", evicted: true}]);
        expect(a.evicted).toEqual([KP]);
    });

    it("keeps its own values when it had the device more recently, and the older instance still lets go", async () => {
        aHadIt(Date.now() - 60_000);
        b.store.setModel(KP, "KPZ-3B1");
        b.store.set(KP, "button_1_idle_color", "green");
        b.records.set(KP, Date.now());
        b.handoff.seed([KP]);
        b.handoff.joined(KP); // re-interviewed on `b`, where it lives
        await settle();

        expect(b.store.get(KP, "button_1_idle_color")).toBe("green");
        expect(b.adopted).toEqual([]);
        expect(a.store.all(KP)).toEqual({});
        expect(a.evicted).toEqual([KP]);
    });

    it("starts the device as new when no instance answers (the old one is down)", async () => {
        b.join(KP);
        expect(b.handoff.pending(KP)).toBe(true);
        await settle();
        expect(b.handoff.pending(KP)).toBe(false);
        expect(b.adopted).toEqual([]);
        expect(b.settled).toEqual([]);
        expect(b.store.all(KP)).toEqual({});
    });
});
