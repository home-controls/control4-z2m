import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {PROFILE_NETWORK} from "../src/core/constants";
import {DeliveryError, Rig, tick} from "./rig";

let rig: Rig;
const KP = "0x000fff0000000001";
const APD = "0x000fff0000000002";
const OTHER = "0x00124b0000000009";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

describe("runtime: check-ins and identity", () => {
    it("learns the model from a check-in and answers with the identity", async () => {
        rig.add(KP, "C4-Zigbee");
        rig.start();
        expect(rig.runtime.get(KP)).toBeUndefined();
        expect(rig.checkin(KP, "c4:control4_keypad:KPZ-3B1")).toBe(true);
        await tick(10);
        expect(rig.store.model(KP)).toBe("KPZ-3B1");
        expect(rig.devices.get(KP)?.modelID).toBe("KPZ-3B1");
        expect(rig.runtime.get(KP)?.family).toBe("kp3");
        const identity = rig.transport.sent.find((s) => s.frame.profile === PROFILE_NETWORK);
        expect(identity?.frame.srcEp).toBe(2);
        expect(identity?.frame.dstEp).toBe(2);
        expect(identity?.frame.data.subarray(0, 1).toString("hex")).toBe("08");
        expect(identity?.frame.data[2]).toBe(0x0a);
    });

    it("answers every check-in, never throttled", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.start();
        for (let i = 0; i < 3; i++) {
            rig.checkin(KP, "c4:control4_keypad:KPZ-3B1");
            await tick(100);
        }
        expect(rig.transport.sent.filter((s) => s.frame.profile === PROFILE_NETWORK).length).toBe(3);
    });

    it("answers a Read Attributes from the device with a Read Attributes Response", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.start();
        rig.inject(KP, PROFILE_NETWORK, Buffer.from([0x00, 0x5a, 0x00, 0x08, 0x00, 0x09, 0x00]));
        await tick(10);
        const rsp = rig.transport.sent.find((s) => s.frame.profile === PROFILE_NETWORK);
        expect(rsp?.frame.data[1]).toBe(0x5a);
        expect(rsp?.frame.data[2]).toBe(0x01);
    });

    it("records the firmware from the check-in", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        const fw = Buffer.concat([Buffer.from([0x04, 0x00, 0x42, 5]), Buffer.from("5.1.1")]);
        rig.checkin(APD, "c4:control4_light:C4-APD120", fw);
        await tick(10);
        expect(rig.devices.get(APD)?.firmware).toBe("5.1.1");
    });

    it("leaves frames from non-Control4 devices to herdsman", () => {
        rig.add(OTHER, "TS0001");
        rig.start();
        expect(rig.ascii(OTHER, "0t0001 sa c4.dmx.bp 01")).toBe(false);
    });

    it("binds a handler at startup from a stored model", () => {
        rig.add(KP, "C4-Zigbee");
        rig.store.setModel(KP, "KPZ-6B1");
        rig.start();
        expect(rig.runtime.get(KP)?.family).toBe("kp6");
    });

    it("lets a model be seeded by hand", () => {
        rig.add(KP, "C4-Zigbee");
        rig.start();
        expect(rig.runtime.seedModel(KP, "c4-kp6-z")).toBe("C4-KP6-Z");
        expect(rig.runtime.get(KP)?.family).toBe("kp6");
        expect(() => rig.runtime.seedModel(KP, "bogus")).toThrow();
    });

    it("publishes persisted settings when a handler starts", () => {
        rig.add(APD, "C4-APD120");
        rig.store.set(APD, "led_idle_color", "blue");
        rig.start();
        // The 12-slot bar's all-slots colour moved to the two LEDs it has.
        expect(rig.last(APD)).toMatchObject({led_top_off_color: "blue", led_bottom_off_color: "blue"});
        expect(rig.last(APD).on_transition).toBe(0.8);
        // Its own factory minimum until it is read from the device.
        expect(rig.last(APD).min_brightness).toBe(10);
    });
});

// #60: a dimmer whose check-in reply never arrives treats its controller as lost; the log should say when that happens.
describe("runtime: an undelivered controller identity", () => {
    it("is logged at info, saying what an unanswered check-in does", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.start();
        rig.transport.failWith = (frame) => (frame.profile === PROFILE_NETWORK ? new DeliveryError("delivery failed", "failed") : undefined);
        rig.checkin(KP, "c4:control4_keypad:KPZ-3B1");
        await tick(100);
        expect(rig.log.lines).toContain(
            "info: Control4: dev0's controller identity (model_report_KPZ-3B1) was not delivered (delivery failed) - a Control4 device whose check-in goes unanswered treats its controller as lost; refreshing routes and trying again",
        );
    });

    it("stays at debug when it failed for another reason than delivery", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.start();
        rig.runtime.link.stop();
        await rig.runtime.sendIdentity(KP, "read_attributes");
        expect(rig.log.lines.filter((l) => l.includes("controller identity"))).toEqual([]);
        expect(rig.log.lines).toContainEqual(
            expect.stringMatching(/^debug: Control4 identity \(read_attributes\) to 0x000fff0000000001 failed: .*link stopped/),
        );
    });
});

// #60: never leave a check-in unanswered, and watch every re-join.
describe("runtime: re-joins", () => {
    const DIM = "0x000fff0000000004";
    const failNetwork = (times: number) => {
        let left = times;
        rig.transport.failWith = (frame) => (frame.profile === PROFILE_NETWORK && left-- > 0 ? new DeliveryError("delivery failed", "failed") : undefined);
    };
    const identitiesTo = (nwk: number) => rig.transport.sent.filter((s) => s.nwk === nwk && s.frame.profile === PROFILE_NETWORK);
    const checkinFrom = (nwk: number, modelString = "c4:control4_light:C4-DIM1-Z") => {
        const s = Buffer.from(modelString, "latin1");
        const data = Buffer.concat([Buffer.from([0x18, 0x01, 0x0a, 0x07, 0x00, 0x42, s.length]), s]);
        return rig.transport.onFrame?.({nwk, profile: PROFILE_NETWORK, cluster: 1, srcEp: 2, dstEp: 2, data, lqi: 200, unicast: false});
    };
    /** A DIM1-Z whose settings were read long ago, so the only Gets it gets are the ones under test. */
    const addDim = () => {
        const id = rig.add(DIM, "C4-DIM1-Z");
        rig.store.set(id, "settings_read", 1);
        return id;
    };
    const answerPing = (ieee: string) => {
        const get = [...rig.texts()].reverse().find((t) => /^0g[0-9a-f]{4} c4\.sy\.fwv$/.test(t)) as string;
        rig.ascii(ieee, `0r${get.slice(2, 6)} 000 c4.sy.fwv 03.22.41`);
    };

    it("retries an undelivered check-in reply after refreshing routes and asking the device for its address", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.start(true);
        failNetwork(2);
        rig.checkin(KP, "c4:control4_keypad:KPZ-3B1");
        await tick(1_000);
        expect(rig.transport.mtorrs).toHaveLength(1);
        expect(rig.rediscovered).toEqual([KP]);
        await tick(20_000);
        expect(identitiesTo(rig.nwk(KP))).toHaveLength(1); // the third try; the first two failed
        expect(rig.log.lines).toContain("info: Control4: dev0's controller identity was delivered on retry 2");
    });

    it("says so when every retry failed, and retries one device once at a time", async () => {
        rig.add(KP, "KPZ-3B1");
        rig.start(true);
        failNetwork(100);
        rig.checkin(KP, "c4:control4_keypad:KPZ-3B1");
        rig.checkin(KP, "c4:control4_keypad:KPZ-3B1");
        await tick(20_000);
        expect(rig.rediscovered).toEqual([KP]);
        expect(rig.log.lines.filter((l) => l.includes("still not delivered"))).toEqual([
            "info: Control4: dev0's controller identity is still not delivered after 2 retries - it may count its controller as lost and re-join",
        ]);
    });

    it("answers a check-in from an address Zigbee2MQTT does not know yet, by that address", async () => {
        rig.start(true);
        expect(checkinFrom(0x7777)).toBe(false); // herdsman still gets it, to look the address up
        await tick(100);
        const [reply] = identitiesTo(0x7777);
        expect(reply.frame).toMatchObject({profile: PROFILE_NETWORK, srcEp: 2, dstEp: 2});
        expect(reply.frame.data[2]).toBe(0x0a); // a Report Attributes, as for a known device's check-in
        expect(rig.log.lines).toContain(
            "info: Control4: answered a check-in from network address 30583, which Zigbee2MQTT does not know yet, with the controller identity",
        );
    });

    it("answers a poll for its controller from an unknown address with a read response, and nothing else", async () => {
        rig.start(true);
        const poll = Buffer.from([0x00, 0x2a, 0x00, 0x08, 0x00]);
        rig.transport.onFrame?.({nwk: 0x7778, profile: PROFILE_NETWORK, cluster: 1, srcEp: 2, dstEp: 2, data: poll, lqi: 200, unicast: true});
        // A button press, and a report that carries no model (not a check-in): no reply.
        rig.transport.onFrame?.({
            nwk: 0x7779,
            profile: 0xc25c,
            cluster: 1,
            srcEp: 197,
            dstEp: 1,
            data: Buffer.from("0t0041 sa c4.dm.cc 00 02\r\n"),
            lqi: 200,
            unicast: true,
        });
        const levelReport = Buffer.from([0x18, 0x02, 0x0a, 0x00, 0x00, 0x20, 0x05]);
        rig.transport.onFrame?.({nwk: 0x777a, profile: PROFILE_NETWORK, cluster: 1, srcEp: 2, dstEp: 2, data: levelReport, lqi: 200, unicast: false});
        await tick(100);
        const [reply] = identitiesTo(0x7778);
        expect([reply.frame.data[1], reply.frame.data[2]]).toEqual([0x2a, 0x01]); // the poll's TSN, Read Attributes Response
        expect(identitiesTo(0x7779)).toEqual([]);
        expect(identitiesTo(0x777a)).toEqual([]);
    });

    it("tells a re-joined device who its controller is, three times a few seconds apart", async () => {
        addDim();
        rig.start(true);
        rig.runtime.rejoined(DIM);
        await tick(1_500);
        expect(identitiesTo(rig.nwk(DIM))).toHaveLength(0);
        await tick(20_000);
        expect(identitiesTo(rig.nwk(DIM))).toHaveLength(3);
    });

    it("lists a re-joined router that answers none of its checks as unreachable within minutes", async () => {
        addDim();
        rig.start(true);
        rig.runtime.rejoined(DIM);
        await tick(130_000);
        expect(rig.runtime.link.unreachable()).toEqual([]);
        await tick(130_000);
        expect(rig.runtime.link.unreachable().map((u) => u.ieee)).toEqual([DIM]);
        expect(rig.statusChanges).toBe(1);
        expect(rig.log.lines).toContainEqual(
            expect.stringMatching(
                /^warning: Control4: 0x000fff0000000004 \(C4-DIM1-Z\) re-joined and has answered none of the 2 checks since - commands to it are lost\. .*15 times/,
            ),
        );
        // Its next direct frame clears it, as after missed keepalives.
        rig.ascii(DIM, "0t0001 sa c4.dm.t0c 00", true);
        expect(rig.runtime.link.unreachable()).toEqual([]);
    });

    /** A healthy dimmer otherwise: it answers every ping, so keepalive and the re-join checks pass. */
    const answersPings = (ieee: string) => {
        const send = rig.transport.send.bind(rig.transport);
        rig.transport.send = async (nwk, frame, options) => {
            await send(nwk, frame, options);
            const m = /^0g([0-9a-f]{4}) c4\.sy\.fwv/.exec(frame.data.toString("latin1"));
            if (m && nwk === rig.nwk(ieee)) setTimeout(() => rig.ascii(ieee, `0r${m[1]} 000 c4.sy.fwv 03.22.41`), 10);
        };
    };

    // 2026-11-06: DIM1-Zs re-joined every hour until each was rebooted by hand.
    it("reboots a dimmer that keeps re-joining (3 times within 3.5 h), after its identity sends", async () => {
        addDim();
        answersPings(DIM);
        const reboots = () => rig.texts().filter((t) => /^0i[0-9a-f]{4} c4\.dm\.rb$/.test(t)).length;
        rig.start(true);
        rig.runtime.rejoined(DIM);
        await tick(60 * 60_000);
        rig.runtime.rejoined(DIM);
        await tick(60 * 60_000);
        expect(reboots()).toBe(0);
        rig.runtime.rejoined(DIM);
        await tick(20_000);
        expect(reboots()).toBe(0); // not during its identity sends
        await tick(45_000); // 30-60 s after the announce
        expect(reboots()).toBe(1);
        expect(rig.log.lines).toContain(
            `warning: Control4: ${DIM} (C4-DIM1-Z): it has re-joined 3 times in about 2 h (stuck re-joining) - rebooting it remotely (1 of 3 in 24 h)`,
        );
        expect(rig.runtime.link.unreachable()).toEqual([]);
        // The count starts again after a reboot: one more re-join is not a fourth.
        await tick(60 * 60_000);
        rig.runtime.rejoined(DIM);
        await tick(60_000);
        expect(reboots()).toBe(1);
    });

    it("starts the re-join count again after a reboot from the Reboot button", async () => {
        addDim();
        answersPings(DIM);
        const reboots = () => rig.texts().filter((t) => /^0i[0-9a-f]{4} c4\.dm\.rb$/.test(t)).length;
        rig.start(true);
        rig.runtime.rejoined(DIM);
        await tick(30 * 60_000);
        rig.runtime.rejoined(DIM);
        await tick(30 * 60_000);
        await Promise.all([rig.runtime.set(DIM, "reboot", "reboot", {message: {reboot: "reboot"}}), tick(100)]);
        expect(reboots()).toBe(1);
        await tick(10 * 60_000);
        rig.runtime.rejoined(DIM); // the third within 3.5 h, but the first since the reboot
        await tick(90_000);
        expect(reboots()).toBe(1);
    });

    it("leaves a re-joined router that answers alone, and lets a newer re-join replace an older one's checks", async () => {
        addDim();
        rig.start(true);
        rig.runtime.rejoined(DIM);
        await tick(60_000);
        rig.runtime.rejoined(DIM); // a second announce: its checks run from now
        await tick(65_000); // the first re-join's check would have run here
        expect(rig.texts().filter((t) => t.endsWith("c4.sy.fwv"))).toHaveLength(0);
        await tick(60_000);
        answerPing(DIM);
        await tick(300_000);
        expect(rig.runtime.link.unreachable()).toEqual([]);
        expect(rig.texts().filter((t) => t.endsWith("c4.sy.fwv"))).toHaveLength(1);
    });
});

describe("link health", () => {
    it("paces sends to one device 40 ms apart", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        const dev = rig.runtime.get(APD);
        const times: number[] = [];
        const p = Promise.all(
            [0, 1, 2].map(async () => {
                await dev?.set("c4.sy.test");
                times.push(Date.now());
            }),
        );
        await tick(200);
        await p;
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(40);
        expect(times[2] - times[1]).toBeGreaterThanOrEqual(40);
    });

    it("completes a Get from its 0r reply", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        const dev = rig.runtime.get(APD);
        const reply = rig.runtime.link.get(dev as never, "c4.sy.fwv");
        await tick(5);
        rig.reply(APD, "05.01.01");
        expect(await reply).toEqual({status: "000", prop: "c4.sy.fwv", values: ["05.01.01"]});
    });

    it("ends a stopped handler's sleeps and refuses its sends", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        const dev = rig.runtime.get(APD) as NonNullable<ReturnType<typeof rig.runtime.get>>;
        const slept = dev.sleep(60_000).then(() => "woke");
        rig.runtime.removeDevice(APD);
        expect(await slept).toBe("woke");
        await expect(dev.set("c4.dmx.led 00 03 ffffff")).rejects.toThrow(/stopped/);
    });

    it("pings Get-capable routers for availability and fails on silence", async () => {
        rig.add(APD, "C4-APD120");
        rig.add(KP, "KPZ-3B1");
        rig.start();
        const ok = rig.runtime.honestPing(APD);
        await tick(5);
        rig.reply(APD, "05.01.01");
        expect(await ok).toBe(true);
        const dead = rig.runtime.honestPing(APD);
        await tick(7000);
        expect(await dead).toBe(false);
        // A model that never answers Gets is pinged by delivery: acknowledged = alive.
        const before = rig.transport.sent.length;
        let ping = rig.runtime.honestPing(KP);
        await tick(100);
        expect(await ping).toBe(true);
        expect(rig.texts(before)).toEqual([expect.stringMatching(/^0g[0-9a-f]{4} c4\.sy\.fwv$/)]);
        rig.transport.failWith = () => Object.assign(new Error("no ack"), {name: "DeliveryError"});
        ping = rig.runtime.honestPing(KP);
        await tick(100);
        expect(await ping).toBe(false);
    });

    // A DIM1-Z, dead for a day, showed available for ~11 min after each hourly check-in.
    it("marks a router seen only on a frame it sent directly; a remote on any frame", async () => {
        const SR = "0x000fff0000000003";
        rig.add(APD, "C4-APD120");
        rig.add(SR, "C4-SR250B", {type: "EndDevice"});
        rig.start();
        rig.checkin(APD, "c4:control4_light:C4-APD120"); // broadcast
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 00", false);
        expect(rig.seen).toEqual([]);
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 00", true);
        expect(rig.seen).toEqual([{ieee: APD, lqi: 200}]);
        rig.ascii(SR, "0t0003 sa c4.dm.cc 00 01", false);
        expect(rig.seen.at(-1)).toEqual({ieee: SR, lqi: 200});
    });

    it("marks a router seen on a delivered ping when it never answers Gets (its reply does that for the others)", async () => {
        rig.add(APD, "C4-APD120");
        rig.add(KP, "KPZ-3B1");
        rig.start();
        // Zigbee2MQTT calls a device available only while its last seen is recent.
        const ping = rig.runtime.honestPing(KP);
        await tick(100);
        expect(await ping).toBe(true);
        expect(rig.seen).toEqual([{ieee: KP, lqi: undefined}]);
        rig.transport.failWith = () => Object.assign(new Error("no ack"), {name: "DeliveryError"});
        expect(await Promise.all([rig.runtime.honestPing(KP), tick(100)]).then(([alive]) => alive)).toBe(false);
        expect(rig.seen).toHaveLength(1);
        rig.transport.failWith = undefined;
        // A Get-capable model: the 0r (a unicast) marks it, with its link quality, and nothing else does.
        const ok = rig.runtime.honestPing(APD);
        await tick(5);
        rig.reply(APD, "05.01.01");
        expect(await ok).toBe(true);
        expect(rig.seen.slice(1)).toEqual([{ieee: APD, lqi: 200}]);
    });

    it("counts a router unreachable after 3 keepalives in a row go unanswered, and says so when that changes", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        const dev = rig.runtime.get(APD) as NonNullable<ReturnType<typeof rig.runtime.get>>;
        const poke = async () => {
            const answered = rig.runtime.link.poke(dev);
            await tick(7_000);
            return answered;
        };
        expect([await poke(), await poke()]).toEqual([false, false]);
        expect(rig.runtime.link.unreachable()).toEqual([]);
        expect(rig.statusChanges).toBe(0);
        expect(await poke()).toBe(false);
        expect(rig.runtime.link.unreachable()).toEqual([{ieee: APD, model: "C4-APD120", quietMin: 0}]);
        expect(rig.statusChanges).toBe(1);
        // Still unreachable: no news.
        await poke();
        expect(rig.statusChanges).toBe(1);
        // A broadcast proves it has power, not that it can be reached.
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 00", false);
        expect(rig.runtime.link.unreachable()).toHaveLength(1);
        rig.ascii(APD, "0t0002 sa c4.dmx.ls 00 00 00", true);
        expect(rig.runtime.link.unreachable()).toEqual([]);
        expect(rig.statusChanges).toBe(2);
        expect(rig.log.lines).toContain(`warning: Control4: ${APD} is reachable again`);
    });

    describe("remote reboots", () => {
        const DIMS = ["0x000fff0000000005", "0x000fff0000000006", "0x000fff0000000007", "0x000fff0000000008"];
        const [DIMX, DIMY] = DIMS;
        const reboots = (ieee?: string) =>
            rig.transport.sent.filter((s) => /^0i[0-9a-f]{4} c4\.dm\.rb$/.test(s.text) && (!ieee || s.nwk === rig.nwk(ieee))).length;
        const pokeOf = (ieee: string) => async () => {
            const answered = rig.runtime.link.poke(rig.runtime.get(ieee) as NonNullable<ReturnType<typeof rig.runtime.get>>);
            await tick(7_000);
            return answered;
        };
        const addDim = (ieee: string, options: Record<string, unknown> = {}) => {
            rig.add(ieee, "C4-DIM1-Z", {options});
            rig.store.set(ieee, "settings_read", 1);
        };
        /** Three missed keepalives in a row: the device is listed. */
        const listed = async (ieee: string) => {
            for (let i = 0; i < 3; i++) await pokeOf(ieee)();
        };

        it("reboots an unreachable DIM1-Z as it is listed, then at most once an hour and 3 times in 24 h", async () => {
            addDim(DIMX);
            rig.start();
            // Other devices' frames keep coming, as on a real instance (no no_frames alarm).
            const chatter = setInterval(() => rig.runtime.traffic.frame(), 5 * 60_000);
            const poke = pokeOf(DIMX);
            await poke();
            await poke();
            expect(reboots()).toBe(0);
            await poke();
            await tick(100);
            expect(reboots()).toBe(1);
            expect(rig.runtime.link.unreachable()).toEqual([{ieee: DIMX, model: "C4-DIM1-Z", quietMin: 0, rebootMin: 0}]);
            expect(rig.log.lines).toContainEqual(
                expect.stringMatching(/has not answered 3 keepalives .* The extension reboots it remotely \(up to 3 times a day, an hour or more apart\)/),
            );
            expect(rig.log.lines).toContain(`warning: Control4: ${DIMX} (C4-DIM1-Z): it is unreachable - rebooting it remotely (1 of 3 in 24 h)`);
            // Keepalives within the hour send no second one.
            await tick(58 * 60_000);
            await poke();
            expect(reboots()).toBe(1);
            await tick(2 * 60_000);
            await poke();
            expect(reboots()).toBe(2);
            await tick(61 * 60_000);
            await poke();
            expect(reboots()).toBe(3);
            await tick(61 * 60_000);
            await poke();
            expect(reboots()).toBe(3);
            // It answers: listed no more, and the log says how long after the last reboot.
            rig.ascii(DIMX, "0t0001 sa c4.dm.t0c 00", true);
            expect(rig.runtime.link.unreachable()).toEqual([]);
            expect(rig.log.lines.filter((l) => l.startsWith(`warning: Control4: ${DIMX} is reachable again`))).toEqual([
                expect.stringMatching(/ is reachable again \(\d+ min after a remote reboot\)$/),
            ]);
            // Deaf again the same day: its own frames did not reset the count, so no fourth reboot.
            await tick(25 * 60_000);
            await listed(DIMX);
            expect(rig.runtime.link.unreachable().map((u) => u.ieee)).toEqual([DIMX]);
            expect(rig.runtime.link.unreachable()[0].rebootMin).toBeUndefined(); // no reboot during this silence
            expect(reboots()).toBe(3);
            // A day after the first, before a day after the second (about 3.5 h have passed so far): room for one.
            await tick(21 * 60 * 60_000);
            await poke();
            expect(reboots()).toBe(4);
            clearInterval(chatter);
        });

        it("leaves a DIM1-Z whose auto_reboot option is off, and a model that can't be rebooted, to be rebooted by hand", async () => {
            addDim(DIMX, {auto_reboot: false});
            rig.add(APD, "C4-APD120");
            rig.start();
            await listed(DIMX);
            await listed(APD);
            expect(
                rig.runtime.link
                    .unreachable()
                    .map((u) => u.ieee)
                    .sort(),
            ).toEqual([APD, DIMX].sort());
            expect(reboots()).toBe(0);
            expect(rig.runtime.link.unreachable().every((u) => u.rebootMin === undefined)).toBe(true);
            expect(
                rig.log.lines
                    .filter((l) => l.includes("has not answered 3 keepalives"))
                    .every((l) => l.includes("tap the top paddle 15 times") && !l.includes("reboots it remotely")),
            ).toBe(true);
        });

        // With no frames coming through, every dimmer looks unreachable, healthy or not.
        it("holds automatic reboots while the instance reports a traffic alarm", async () => {
            addDim(DIMX);
            rig.start();
            await tick(31 * 60_000);
            expect(rig.runtime.traffic.problems()).toEqual(["no_frames"]);
            await listed(DIMX);
            expect(reboots()).toBe(0);
            expect(rig.log.lines).toContain(`info: Control4: not rebooting ${DIMX} (C4-DIM1-Z) remotely: the instance reports no_frames`);
            // A frame clears it: the next missed keepalive gets the reboot.
            rig.runtime.traffic.frame();
            expect(rig.runtime.traffic.problems()).toEqual([]);
            await tick(10 * 60_000);
            await pokeOf(DIMX)();
            await tick(100);
            expect(reboots()).toBe(1);
        });

        it("holds them while more than 3 devices are unreachable at once, and spaces them a minute apart", async () => {
            for (const ieee of DIMS) addDim(ieee);
            rig.start();
            await listed(DIMX);
            await tick(100);
            expect(reboots(DIMX)).toBe(1);
            // Listed less than a minute after the first: not yet.
            await listed(DIMY);
            await tick(100);
            expect(reboots(DIMY)).toBe(0);
            await tick(60_000);
            await pokeOf(DIMY)();
            await tick(100);
            expect(reboots(DIMY)).toBe(1);
            // A third is still one dimmer's own trouble; a fourth at once is not.
            await tick(60_000);
            await listed(DIMS[2]);
            await tick(100);
            expect(reboots(DIMS[2])).toBe(1);
            await tick(60_000);
            await listed(DIMS[3]);
            await tick(60_000);
            await pokeOf(DIMS[3])();
            expect(reboots(DIMS[3])).toBe(0);
            expect(rig.log.lines).toContain(`info: Control4: not rebooting ${DIMS[3]} (C4-DIM1-Z) remotely: 4 devices are unreachable at once`);
        });
    });

    it("lists a removed device as unreachable no longer", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        const dev = rig.runtime.get(APD) as NonNullable<ReturnType<typeof rig.runtime.get>>;
        for (let i = 0; i < 3; i++) {
            const answered = rig.runtime.link.poke(dev);
            await tick(7_000);
            await answered;
        }
        expect(rig.runtime.link.unreachable()).toHaveLength(1);
        rig.runtime.removeDevice(APD);
        expect(rig.runtime.link.unreachable()).toEqual([]);
    });

    it("times a Get from when it went out, not from when it was queued", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        // Fill the device's pacing so the Get waits ~4 s before it is sent.
        for (let i = 0; i < 100; i++) void rig.runtime.ctx.link.waitTurn(APD);
        const reply = rig.runtime.get(APD)?.get("c4.sy.fwv") as Promise<unknown>;
        await tick(4100);
        const get = [...rig.texts()].reverse().find((t) => t.startsWith("0g") && t.endsWith("c4.sy.fwv")) as string;
        expect(get).toBeDefined();
        await tick(5000); // 9 s after queueing, 5 s after sending: still waiting
        rig.ascii(APD, `0r${get.slice(2, 6)} 000 c4.sy.fwv 05.01.01`);
        expect(await reply).toMatchObject({values: ["05.01.01"]});
    });

    it("retries a failed load command once after a route refresh", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        let fails = 1;
        rig.transport.failWith = () => (fails-- > 0 ? Object.assign(new Error("no ack"), {name: "DeliveryError"}) : undefined);
        const p = rig.runtime.set(APD, "state", "ON", {message: {state: "ON"}});
        await tick(2500);
        await expect(p).resolves.toEqual({state: "ON", brightness: 191});
        expect(rig.transport.mtorrs).toEqual([5]);
    });

    it("keepalive pokes routers quiet for 20 minutes", async () => {
        rig.add(APD, "C4-APD120");
        rig.start();
        expect(rig.runtime.link.keepaliveCandidates(Date.now())).toEqual([]);
        expect(rig.runtime.link.keepaliveCandidates(Date.now() + 21 * 60_000).map((d) => d.ieee)).toEqual([APD]);
        rig.ascii(APD, "0t0001 sa c4.dmx.ls 00 00 00", true);
        expect(rig.runtime.link.keepaliveCandidates(Date.now() + 19 * 60_000)).toEqual([]);
    });
});
describe("send options", () => {
    it("marks sends to end devices as sleepy, and none to routers", async () => {
        vi.useFakeTimers();
        const r = new Rig();
        const remote = r.add("0x000fff00000000e2", "C4-SR260", {type: "EndDevice"});
        const keypad = r.add("0x000fff00000000a1", "C4-KP6-Z", {type: "Router"});
        r.start();
        await tick(40_000); // the start-up identity sends (a keypad's start 12-32 s in), and the remote's commissioning
        const sleepy = (ieee: string) => [...new Set(r.transport.sent.filter((s) => s.nwk === r.nwk(ieee)).map((s) => s.sleepy))];
        expect(sleepy(remote)).toEqual([true]);
        expect(sleepy(keypad)).toEqual([false]);
        r.stop();
        vi.useRealTimers();
    });
});
