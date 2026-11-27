/**
 * End to end: the extension started against a fake Zigbee2MQTT controller that
 * wraps a REAL herdsman EmberAdapter and REAL herdsman Device objects. Frames
 * enter through the patched EZSP handler; commands enter through the
 * converter's toZigbee and leave through ezsp.send.
 */

import {EventEmitter} from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import * as emberModule from "zigbee-herdsman/dist/adapter/ember/adapter/emberAdapter.js";
import * as deviceModule from "zigbee-herdsman/dist/controller/model/device.js";
import * as entityModule from "zigbee-herdsman/dist/controller/model/entity.js";

import {buildIdOf, fileHash} from "../src/core/build";
import {CONTRACT, PROFILE_BUTTON, PROFILE_NETWORK} from "../src/core/constants";
import {setFastTapTiming} from "../src/core/fasttap";
import {HANDOFF_TIMING} from "../src/core/handoff";
import {buildDefinitions} from "../src/z2m/definitions";
import Control4Extension from "../src/z2m/extension";
import {CONVERTER_KEY, type ConverterInfo, HOT_LOAD_KEY, RUNTIME_API, RUNTIME_KEY} from "../src/z2m/global";
import {showEvent} from "./contract";

// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman / Z2M fakes
type Any = any;
const EmberAdapter = (emberModule as Any).EmberAdapter ?? (emberModule as Any).default?.EmberAdapter;
const Device = (deviceModule as Any).Device ?? (deviceModule as Any).default?.Device ?? (deviceModule as Any).default;
const Entity = (entityModule as Any).default?.default ?? (entityModule as Any).default ?? (entityModule as Any).Entity;

const COORD = "0x00124b0024c0dc0d";
const KP = "0x000fff0000006e2a";
const DIM = "0x000fff0000006e2b";
const PLUG = "0x00124b0000000009";

/** What the converter bundle registers when Zigbee2MQTT loads it (here a made-up file hash). */
const CONVERTER: ConverterInfo = {api: RUNTIME_API, file: "c".repeat(64)};
/** Run from source, the extension hashes its own module file. */
const EXTENSION_FILE = fileHash(pathToFileURL(path.resolve(__dirname, "..", "src", "z2m", "extension.ts")).href) as string;
const BUILD = buildIdOf(EXTENSION_FILE, CONVERTER.file as string);

function zhDevice(id: number, type: string, ieee: string, nwk: number, modelID?: string, manufacturerID = 0xabcd): Any {
    return new Device(
        id,
        type,
        ieee,
        nwk,
        manufacturerID,
        [],
        undefined,
        undefined,
        modelID,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "SUCCESSFUL",
        {},
        Date.now(),
        undefined,
        0,
        undefined,
        undefined,
    );
}

interface Harness {
    ext: Control4Extension;
    adapter: Any;
    /** The fake herdsman controller (Zigbee2MQTT's zigbee.zhController). */
    controller: Any;
    devices: Any[];
    published: {name: string; payload: Record<string, unknown>}[];
    states: Map<string, Record<string, unknown>>;
    sends: {apsFrame: Any; data: Buffer}[];
    /** Published topics; a shared (non-base) one is "@<baseTopic>/<topic>". */
    mqtt: {topic: string; payload: string; retain?: boolean; skipReceive?: boolean}[];
    subscribed: string[];
    emitted: {topic: string; message: string}[];
    bus: Record<string, (data: Any) => unknown>;
    z2m: Map<string, Any>;
    lastSeen: Any[];
    /** What the extension told Zigbee2MQTT changed: exposes by IEEE, and how often the device list did. */
    changed: {exposes: string[]; devices: number};
    /** The extension's info log lines. */
    info: string[];
}

let h: Harness;
let dataDir: string;

const DEFS = buildDefinitions();

/** Zigbee2MQTT's Device.exposes(): the converter's exposes for the model the device has now. */
function exposesFor(zh: Any): Any[] {
    const def = DEFS.find((d: Any) => d.model === zh.modelID || d.zigbeeModel.includes(zh.modelID));
    if (!def) return [];
    return typeof def.exposes === "function" ? def.exposes(zh, {}) : def.exposes;
}

interface HarnessOptions {
    /** Zigbee2MQTT's settings (default: base topic zigbee2mqtt, no Home Assistant). */
    settings?: Any;
    /** Runs before the extension starts. */
    tweak?: (fakes: {adapter: Any; controller: Any; devices: Any[]}) => void;
    /**
     * A hot-load: Zigbee2MQTT kept running, so the extension starts on this harness's
     * herdsman controller, adapter and devices. Without it, a new controller: a restart.
     */
    same?: Harness;
}

/** A herdsman controller as Zigbee2MQTT builds one at start, on a real EmberAdapter and real Devices. */
function newHerdsman(): Pick<Harness, "adapter" | "controller" | "devices" | "sends" | "lastSeen"> {
    const adapter = new EmberAdapter(
        {panID: 1, extendedPanID: [1, 2, 3, 4, 5, 6, 7, 8], channelList: [25], networkKey: Array(16).fill(1), networkKeyDistribute: false},
        {path: "/dev/null", adapter: "ember"},
        path.join(dataDir, "coordinator_backup.json"),
        {concurrent: 4},
    );
    const sends: Harness["sends"] = [];
    let tag = 1;
    adapter.ezsp.send = async (_type: number, _nwk: number, apsFrame: Any, data: Buffer) => {
        const t = tag++;
        sends.push({apsFrame: {...apsFrame}, data: Buffer.from(data)});
        setTimeout(() => adapter.ezsp.emit("messageSent", 0, 0, _nwk, apsFrame, t), 1);
        return [0, t];
    };
    const devices = [
        zhDevice(1, "Coordinator", COORD, 0),
        zhDevice(2, "Router", KP, 0x1234),
        zhDevice(3, "Router", DIM, 0x2345, "C4-DIM1-Z"),
        zhDevice(4, "Router", PLUG, 0x3456, "TS011F"),
    ];
    const lastSeen: Any[] = [];
    const controller = {
        adapter,
        getDevices: () => devices,
        getDeviceByIeeeAddr: (ieee: string) => devices.find((d) => d.ieeeAddr === ieee),
        getDeviceByNetworkAddress: (nwk: number) => devices.find((d) => d.networkAddress === nwk),
        getDevicesByType: (type: string) => devices.filter((d) => d.type === type),
        identifyUnknownDevice: async () => undefined,
        emit: (event: string, data: Any) => event === "lastSeenChanged" && lastSeen.push(data),
    };
    return {adapter, controller, devices, sends, lastSeen};
}

async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
    Entity.injectDatabase({update() {}, has: () => false, insert() {}, remove() {}, newID: () => 99});
    const {adapter, controller, devices, sends, lastSeen} = opts.same ?? newHerdsman();
    const z2m = new Map<string, Any>();
    for (const d of devices) {
        z2m.set(d.ieeeAddr, {
            zh: d,
            ieeeAddr: d.ieeeAddr,
            name: `name_${d.ieeeAddr.slice(-4)}`,
            options: {},
            resolveDefinition: vi.fn(async () => undefined),
            exposes: () => exposesFor(d),
        });
    }
    const zigbee = {
        zhController: controller,
        resolveEntity: (key: Any) => (typeof key === "object" ? z2m.get(key.ieeeAddr) : [...z2m.values()].find((x) => x.name === key || x.ieeeAddr === key)),
    };
    const states = new Map<string, Record<string, unknown>>();
    const published: Harness["published"] = [];
    const bus: Harness["bus"] = {};
    const emitted: Harness["emitted"] = [];
    const subscribed: string[] = [];
    const changed: Harness["changed"] = {exposes: [], devices: 0};
    const eventBus = new Proxy(
        {},
        {
            get: (_t, prop: string) => {
                if (prop.startsWith("on")) return (_key: unknown, cb: (d: Any) => unknown) => (bus[prop] = cb);
                if (prop === "removeListeners")
                    return () => {
                        for (const k of Object.keys(bus)) delete bus[k];
                    };
                if (prop === "emitExposesChanged") return (d: Any) => changed.exposes.push(d.device.ieeeAddr);
                if (prop === "emitDevicesChanged") return () => changed.devices++;
                if (prop === "emitExposesAndDevicesChanged")
                    return (dev: Any) => {
                        changed.exposes.push(dev.ieeeAddr);
                        changed.devices++;
                    };
                if (prop === "emitMQTTMessage") return (d: Any) => emitted.push(d);
                return undefined;
            },
        },
    );
    const mqtt: Harness["mqtt"] = [];
    const info: string[] = [];
    const ext = new Control4Extension(
        zigbee,
        {
            publish: async (topic: string, payload: string, options?: {baseTopic?: string; skipReceive?: boolean; clientOptions?: {retain?: boolean}}) =>
                mqtt.push({
                    topic: options?.baseTopic ? `@${options.baseTopic}/${topic}` : topic,
                    payload,
                    retain: options?.clientOptions?.retain,
                    skipReceive: options?.skipReceive,
                }),
            subscribe: async (topic: string) => subscribed.push(topic),
            unsubscribe: async () => undefined,
        },
        {get: (dev: Any) => states.get(dev.ieeeAddr) ?? {}},
        async (dev: Any, payload: Record<string, unknown>) => {
            published.push({name: dev.name, payload});
            states.set(dev.ieeeAddr, {...(states.get(dev.ieeeAddr) ?? {}), ...payload});
        },
        eventBus,
        undefined,
        undefined,
        undefined,
        {get: () => opts.settings ?? {mqtt: {base_topic: "zigbee2mqtt"}}},
        {debug() {}, info: (message: unknown) => info.push(String(message)), warning() {}, error() {}},
    );
    opts.tweak?.({adapter, controller, devices});
    await ext.start();
    return {ext, adapter, controller, devices, published, states, sends, mqtt, subscribed, emitted, bus, z2m, lastSeen, changed, info};
}

/** Whether the DIM1-Z's start-up state read is queued (cancelling it shortens the queue). */
function dimStartupReadQueued(): boolean {
    const link = (globalThis as Any)[RUNTIME_KEY].link;
    const before = link.summary().state_reads_queued;
    link.cancelStateRead(DIM);
    return link.summary().state_reads_queued < before;
}

const aps = (profileId: number, src = 197) => ({profileId, clusterId: 1, sourceEndpoint: src, destinationEndpoint: 1, options: 0, groupId: 0, sequence: 1});
const pkt = (nwk: number) => ({senderShortId: nwk, lastHopLqi: 222, lastHopRssi: -50});
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "c4z2m-ext-"));
    process.env.ZIGBEE2MQTT_DATA = dataDir;
    (globalThis as Any)[CONVERTER_KEY] = CONVERTER;
    // Each test is a fresh Zigbee2MQTT: no extension has stopped in it yet.
    delete (globalThis as Any)[HOT_LOAD_KEY];
    h = await makeHarness();
});

afterEach(async () => {
    await h.ext.stop();
    delete (globalThis as Any)[CONVERTER_KEY];
    delete process.env.ZIGBEE2MQTT_DATA;
    fs.rmSync(dataDir, {recursive: true, force: true});
});

describe("extension end to end", () => {
    it("names an unidentified Control4 device generically and leaves others alone", () => {
        const kp = h.devices[1];
        expect(kp.modelID).toBe("C4-Zigbee");
        expect(kp.manufacturerName).toBe("Control4");
        expect(h.devices[3].modelID).toBe("TS011F");
        expect((globalThis as Any)[RUNTIME_KEY]).toBeDefined();
    });

    it("learns the model from a 0xC25D check-in, re-resolves and answers with the identity", async () => {
        const s = Buffer.from("c4:control4_keypad:KPZ-3B1");
        const report = Buffer.concat([Buffer.from([0x18, 0x01, 0x0a, 0x07, 0x00, 0x42, s.length]), s]);
        h.adapter.ezsp.ezspIncomingMessageHandler(4, aps(PROFILE_NETWORK, 2), pkt(0x1234), report);
        await tick(30);
        const kp = h.devices[1];
        expect(kp.modelID).toBe("KPZ-3B1");
        expect(h.z2m.get(KP).resolveDefinition).toHaveBeenCalledWith(true);
        const identity = h.sends.find((x) => x.apsFrame.profileId === PROFILE_NETWORK);
        expect(identity?.apsFrame).toMatchObject({sourceEndpoint: 2, destinationEndpoint: 2});
        expect(identity?.data.subarray(11, 19).toString("hex")).toBe("0ddcc024004b1200"); // coordinator EUI64 LE
        // A router's check-in is a broadcast: it proves the device has power, not that it can be reached.
        expect(h.lastSeen).toEqual([]);
        expect(kp.linkquality).not.toBe(222);
        await tick(400); // the store writes on a short debounce
        const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "control4", "control4.json"), "utf8"));
        expect(stored.models[KP]).toBe("KPZ-3B1");
    });

    // A DIM1-Z, dead for a day, showed available for ~11 min after each hourly check-in.
    it("tells Zigbee2MQTT a router was seen only on a frame it sent directly, a remote on any frame", async () => {
        const kp = h.devices[1];
        const press = Buffer.from("0t0041 sa c4.dm.cc 00 02\r\n");
        const BROADCAST = 4;
        const UNICAST = 0;
        h.adapter.ezsp.ezspIncomingMessageHandler(BROADCAST, aps(PROFILE_BUTTON), pkt(0x1234), press);
        await tick(10);
        expect(h.lastSeen).toEqual([]);
        h.adapter.ezsp.ezspIncomingMessageHandler(UNICAST, aps(PROFILE_BUTTON), pkt(0x1234), press);
        await tick(10);
        expect(h.lastSeen).toHaveLength(1);
        expect(h.lastSeen[0].device).toBe(kp);
        expect(h.lastSeen[0].reason).toBe("messageNonEmitted");
        expect(kp.linkquality).toBe(222);
        kp.type = "EndDevice";
        h.adapter.ezsp.ezspIncomingMessageHandler(BROADCAST, aps(PROFILE_BUTTON), pkt(0x1234), press);
        await tick(10);
        expect(h.lastSeen).toHaveLength(2);
    });

    // #60: Zigbee2MQTT logs announces and address changes at debug only, so the night two dimmers went deaf the log showed neither.
    it("logs a Control4 device's announce and address change at info, in the decimal its route errors use", async () => {
        const dim = h.devices[2];
        const logged = () => h.info.filter((l) => /announced itself|changed network address/.test(l));
        dim.networkAddress = 0x3000;
        h.bus.onDeviceNetworkAddressChanged({device: h.z2m.get(DIM)});
        h.bus.onDeviceAnnounce({device: {zh: dim}});
        expect(logged()).toEqual([
            `Control4: name_6e2b (${DIM}) changed network address 9029 -> 12288: it re-joined`,
            "Control4: name_6e2b announced itself at network address 12288: it re-joined or powered up",
        ]);
        // The same address again is an announce and no change; a device that isn't Control4 logs nothing.
        h.bus.onDeviceAnnounce({device: {zh: dim}});
        h.bus.onDeviceAnnounce({device: {zh: h.devices[3]}});
        expect(logged()).toHaveLength(3);
        expect(logged()[2]).toBe("Control4: name_6e2b announced itself at network address 12288: it re-joined or powered up");
    });

    it("hands every Control4 announce to the runtime's re-join handling, and rediscovers through herdsman", async () => {
        const rt = (globalThis as Any)[RUNTIME_KEY];
        const rejoined = vi.spyOn(rt, "rejoined");
        h.bus.onDeviceAnnounce({device: {zh: h.devices[2]}});
        h.bus.onDeviceAnnounce({device: {zh: h.devices[3]}}); // not Control4
        expect(rejoined.mock.calls).toEqual([[DIM]]);
        h.devices[2].requestNetworkAddress = vi.fn(async () => undefined);
        await rt.host.rediscover(DIM);
        expect(h.devices[2].requestNetworkAddress).toHaveBeenCalledTimes(1);
    });

    it("logs once that a Control4 frame came from a network address Zigbee2MQTT does not know", async () => {
        const press = Buffer.from("0t0041 sa c4.dm.cc 00 02\r\n");
        h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x7777), press);
        h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x7777), press);
        await tick(10);
        expect(h.info.filter((l) => l.includes("network address 30583"))).toEqual([
            "Control4: a Control4 frame came from network address 30583, which Zigbee2MQTT does not know - asking it who it is (a device that re-joined under a new address?)",
        ]);
    });

    it("publishes button actions from 0xC25C frames", async () => {
        h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x2345), Buffer.from("0t0041 sa c4.dm.cc 00 02\r\n"));
        await tick(10);
        const action = h.published.find((p) => p.payload.action);
        expect(action?.payload).toMatchObject({action: "button_1_double", action_command: "remote_button_double_press"});
    });

    it("drives the device from the converter's toZigbee", async () => {
        const def = buildDefinitions().find((d: Any) => d.model === "C4-DIM1-Z");
        const conv = def.toZigbee.find((c: Any) => c.key.includes("brightness"));
        const result = await conv.convertSet(undefined, "brightness", 127, {device: h.devices[2], message: {brightness: 127}, state: {}});
        expect(result).toEqual({state: {state: "ON", brightness: 127}});
        const zcl = h.sends.at(-1);
        expect(zcl?.apsFrame).toMatchObject({profileId: 0x0104, clusterId: 0x0008, destinationEndpoint: 1});
        expect(zcl?.data.subarray(2).toString("hex")).toBe("047f0800");
    });

    it("reads a DIM1-Z's state through herdsman's endpoint read on /get", async () => {
        const reads: [string, string[], Any][] = [];
        const ep1 = {
            read: vi.fn(async (cluster: string, attrs: string[], options: Any) => {
                reads.push([cluster, attrs, options]);
                return cluster === "genOnOff" ? {onOff: 1} : {currentLevel: 77};
            }),
        };
        h.devices[2].getEndpoint = (id: number) => (id === 1 ? ep1 : undefined);
        const def = buildDefinitions().find((d: Any) => d.model === "C4-DIM1-Z");
        const conv = def.toZigbee.find((c: Any) => c.key.includes("state"));
        await conv.convertGet(undefined, "state", {device: h.devices[2], message: {state: ""}});
        expect(reads).toEqual([
            ["genOnOff", ["onOff"], {timeout: 5000}],
            ["genLevelCtrl", ["currentLevel"], {timeout: 5000}],
        ]);
        expect(h.states.get(DIM)).toMatchObject({state: "ON", brightness: 77});
    });

    it("queues a state read when a Control4 device announces", async () => {
        const rt = (globalThis as Any)[RUNTIME_KEY];
        const queued = () => rt.link.summary().state_reads_queued;
        expect(queued()).toBe(2); // the DIM1-Z's startup read, a few seconds out, and the read of its settings
        rt.link.cancelStateRead(DIM);
        rt.link.cancelStateRead(`${DIM}:settings`);
        h.bus.onDeviceAnnounce({device: {zh: h.devices[2]}});
        h.bus.onDeviceAnnounce({device: {zh: h.devices[3]}}); // not Control4
        h.bus.onDeviceAnnounce({device: {zh: h.devices[1]}}); // a keypad: nothing to read
        expect(queued()).toBe(1); // its load: an announce does not read the settings again
    });

    it("starts as a hot-load after a stop in the same Zigbee2MQTT: no start-up state read, but an announce or interview still queues one", async () => {
        const queued = () => (globalThis as Any)[RUNTIME_KEY].link.summary().state_reads_queued;
        const started = () => h.info.filter((l) => l.startsWith("Control4: extension started"));
        expect(started()).toEqual([expect.stringMatching(/^Control4: extension started: first start since Zigbee2MQTT started \(/)]);
        expect(queued()).toBe(2); // the DIM1-Z's start-up read, and the read of its settings

        await h.ext.stop();
        h = await makeHarness({same: h});
        expect(started()).toEqual([
            expect.stringMatching(
                /^Control4: extension started: hot-load, without the start-up identity sends, state reads, Z2IO provisioning or remote bootstrap \(/,
            ),
        ]);
        // No state read, but settings never read are read after a hot-load too.
        expect(queued()).toBe(1);
        (globalThis as Any)[RUNTIME_KEY].link.cancelStateRead(`${DIM}:settings`);
        expect(queued()).toBe(0);
        h.bus.onDeviceAnnounce({device: {zh: h.devices[2]}});
        expect(queued()).toBe(1);
        (globalThis as Any)[RUNTIME_KEY].link.cancelStateRead(DIM);
        h.bus.onDeviceInterview({device: {zh: h.devices[2]}, status: "successful"});
        expect(queued()).toBe(1);
    });

    // On the house every start since 11-02 logged a hot-load, the 11-04 19:23 restart included:
    // Zigbee2MQTT 2.x restarts inside the same Node process, so what stop() leaves survives it.
    it("starts afresh after a restart in the same process: the new herdsman controller tells it", async () => {
        await h.ext.stop();
        const before = h.controller;
        h = await makeHarness();
        expect(h.controller).not.toBe(before);
        expect(h.info.filter((l) => l.startsWith("Control4: extension started"))).toEqual([
            expect.stringMatching(/^Control4: extension started: first start since Zigbee2MQTT started \(/),
        ]);
        expect(dimStartupReadQueued()).toBe(true);
    });

    // The push that deploys this build hot-loads it over one that left `true`.
    it("reads `true`, left by an older build's stop, as a hot-load", async () => {
        await h.ext.stop();
        (globalThis as Any)[HOT_LOAD_KEY] = true;
        h = await makeHarness({same: h});
        expect(h.info.filter((l) => l.startsWith("Control4: extension started"))).toEqual([expect.stringMatching(/^Control4: extension started: hot-load/)]);
        expect(dimStartupReadQueued()).toBe(false);
    });

    describe("handoff (ADR 0004)", () => {
        const timing = {...HANDOFF_TIMING};
        beforeEach(() => Object.assign(HANDOFF_TIMING, {offers: 50, done: 200}));
        afterEach(() => Object.assign(HANDOFF_TIMING, timing));
        const sent = (ieee: string, step: string) => h.mqtt.filter((m) => m.topic === `@control4/handoff/${ieee}/${step}`);
        const message = (ieee: string, step: string, body: Record<string, unknown>) =>
            h.bus.onMQTTMessage({topic: `control4/handoff/${ieee}/${step}`, message: JSON.stringify(body)});
        const store = () => (globalThis as Any)[RUNTIME_KEY].host.store;

        it("asks on a Control4 join, takes the offer's settings, model and options, and renames once the old instance has let go", async () => {
            h.bus.onDeviceInterview({device: {zh: h.devices[1]}, status: "successful"});
            const [request] = sent(KP, "request");
            // Zigbee2MQTT would ignore this topic from every instance once it published on it.
            expect(request.skipReceive).toBe(false);
            const {id} = JSON.parse(request.payload);
            message(KP, "offer", {
                from: "zigbee2mqtt_old",
                to: "zigbee2mqtt",
                id,
                had: Date.now(),
                holds: true,
                model: "KPZ-3B1",
                settings: {button_1_idle_color: "blue", led_defaults: "existing"},
                profile: {name: "Keypad A", options: {tap_window: 0.8}},
            });
            await tick(150);

            expect(h.devices[1].modelID).toBe("KPZ-3B1");
            expect(store().all(KP)).toEqual({button_1_idle_color: "blue", led_defaults: "existing"});
            expect(h.emitted).toContainEqual({
                topic: "zigbee2mqtt/bridge/request/device/options",
                message: JSON.stringify({id: KP, options: {tap_window: 0.8}}),
            });
            expect(JSON.parse(sent(KP, "ack")[0].payload)).toEqual({from: "zigbee2mqtt", to: ["zigbee2mqtt_old"], id});
            // Not renamed while the old instance's record (and its discovery) may still be there.
            expect(h.emitted.some((e) => e.topic.endsWith("/device/rename"))).toBe(false);

            message(KP, "done", {from: "zigbee2mqtt_old", to: "zigbee2mqtt", id, evicted: true});
            expect(h.emitted).toContainEqual({
                topic: "zigbee2mqtt/bridge/request/device/rename",
                message: JSON.stringify({from: KP, to: "Keypad A", homeassistant_rename: true}),
            });
        });

        it("answers another instance's request for a device it has had, and on the ack force-removes its record and forgets it", async () => {
            store().set(DIM, "led_top_on_color", "blue");
            message(DIM, "request", {from: "zigbee2mqtt_new", id: "zigbee2mqtt_new:1"});
            expect(JSON.parse(sent(DIM, "offer")[0].payload)).toMatchObject({
                from: "zigbee2mqtt",
                to: "zigbee2mqtt_new",
                id: "zigbee2mqtt_new:1",
                holds: true,
                settings: {led_top_on_color: "blue"},
                profile: {name: `name_${DIM.slice(-4)}`, options: {}},
            });

            message(DIM, "ack", {from: "zigbee2mqtt_new", to: ["zigbee2mqtt"], id: "zigbee2mqtt_new:1"});
            expect(h.emitted).toContainEqual({topic: "zigbee2mqtt/bridge/request/device/remove", message: JSON.stringify({id: DIM, force: true})});
            expect(sent(DIM, "done")).toEqual([]); // not before Zigbee2MQTT has removed it
            h.bus.onEntityRemoved({entity: {zh: h.devices[2]}, name: `name_${DIM.slice(-4)}`});
            await tick(1_200);
            expect(JSON.parse(sent(DIM, "done")[0].payload)).toEqual({from: "zigbee2mqtt", to: "zigbee2mqtt_new", id: "zigbee2mqtt_new:1", evicted: true});
            expect(store().all(DIM)).toEqual({});
            expect(store().had(DIM)).toBeUndefined();
        });

        it("ignores its own messages, which come back from the broker", async () => {
            message(DIM, "request", {from: "zigbee2mqtt", id: "zigbee2mqtt:1"});
            expect(sent(DIM, "offer")).toEqual([]);
        });
    });

    it("seeds a model from /set c4_model", async () => {
        const def = buildDefinitions().find((d: Any) => d.model === "C4-Zigbee");
        const conv = def.toZigbee.find((c: Any) => c.key.includes("c4_model"));
        expect(await conv.convertSet(undefined, "c4_model", "c4-kp6-z", {device: h.devices[1], message: {}})).toEqual({state: {c4_model: "C4-KP6-Z"}});
        expect(h.devices[1].modelID).toBe("C4-KP6-Z");
    });

    it("gives a learned model its power source at once, not at the next start", async () => {
        const def = buildDefinitions().find((d: Any) => d.model === "C4-Zigbee");
        const conv = def.toZigbee.find((c: Any) => c.key.includes("c4_model"));
        expect(h.devices[1].powerSource).toBe("Mains (single phase)");
        await conv.convertSet(undefined, "c4_model", "C4-SR260", {device: h.devices[1], message: {}});
        expect(h.devices[1].powerSource).toBe("Battery");
    });

    it("completes a Control4 interview through the patched interviewQuirks", () => {
        const fresh = zhDevice(9, "Router", "0x000fff00000000aa", 0x4444);
        expect(fresh.interviewQuirks()).toBe(true);
        expect(fresh.modelID).toBe("C4-Zigbee");
        expect(fresh.manufacturerName).toBe("Control4");
        expect(fresh.powerSource).toBe("Mains (single phase)");
        const remote = zhDevice(11, "EndDevice", "0x000fff00000000cc", 0x6666);
        remote.interviewQuirks();
        expect(remote.powerSource).toBe("Battery");
        const plug = zhDevice(10, "Router", "0x00124b00000000bb", 0x5555, "TS011F", 0x1234);
        expect(plug.interviewQuirks()).toBe(false);
    });

    it("pings with a real Get only where the model answers one", async () => {
        // DIM1-Z answers Gets: the ping goes out as 0g c4.sy.fwv and resolves on the reply.
        const ping = h.devices[2].ping();
        await tick(60);
        const get = h.sends
            .map((x) => x.data.toString("latin1"))
            .reverse()
            .find((t) => t.startsWith("0g"));
        expect(get).toMatch(/^0g[0-9a-f]{4} c4\.sy\.fwv\r\n$/);
        h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x2345), Buffer.from(`0r${get?.slice(2, 6)} 000 c4.sy.fwv 03.22.41\r\n`));
        await expect(ping).resolves.toBeUndefined();
    });

    it("answers bridge LED requests", async () => {
        await h.bus.onMQTTMessage({topic: "zigbee2mqtt/bridge/request/control4/led_refresh", message: JSON.stringify({transaction: "t1"})});
        await tick(10);
        const rsp = h.mqtt.find((m) => m.topic === "bridge/response/control4/led_refresh");
        expect(JSON.parse(rsp?.payload ?? "{}")).toMatchObject({status: "ok", transaction: "t1"});
        await h.bus.onMQTTMessage({topic: "zigbee2mqtt/bridge/request/control4/led_effect", message: JSON.stringify({devices: ["nope"]})});
        await tick(10);
        const err = h.mqtt.find((m) => m.topic === "bridge/response/control4/led_effect");
        expect(JSON.parse(err?.payload ?? "{}").status).toBe("error");
    });

    it("republishes the exposes of every Control4 device, and of no other", async () => {
        await tick(10); // the start-up re-resolve of the keypad
        h.changed.exposes.length = 0;
        h.changed.devices = 0;
        await h.bus.onMQTTMessage({topic: "zigbee2mqtt/bridge/request/control4/republish", message: JSON.stringify({transaction: "r1"})});
        const rsp = h.mqtt.find((m) => m.topic === "bridge/response/control4/republish");
        expect(JSON.parse(rsp?.payload ?? "{}")).toEqual({status: "ok", data: {devices: 2}, transaction: "r1"});
        expect(h.changed.exposes.sort()).toEqual([KP, DIM].sort());
        expect(h.changed.devices).toBe(1); // one bridge/devices publish, not one per device
        // Through the shared namespace too, answered with the base.
        await h.bus.onMQTTMessage({topic: "control4/request/republish", message: JSON.stringify({transaction: 2})});
        const shared = h.mqtt.find((m) => m.topic === "@control4/response/republish");
        expect(JSON.parse(shared?.payload ?? "{}")).toEqual({status: "ok", data: {devices: 2}, base: "zigbee2mqtt", transaction: 2});
    });

    it("serves the shared control4/ namespace for its own devices only", async () => {
        expect(h.subscribed).toContain("control4/#");
        // /set: handed to Zigbee2MQTT under this instance's base topic; a foreign IEEE is ignored.
        await h.bus.onMQTTMessage({topic: `control4/${DIM}/set`, message: JSON.stringify({state: "ON"})});
        await h.bus.onMQTTMessage({topic: `control4/${DIM}/set/led_brightness`, message: "50"});
        await h.bus.onMQTTMessage({topic: "control4/0x000fff00000000ff/set", message: JSON.stringify({state: "ON"})});
        expect(h.emitted).toEqual([
            {topic: `zigbee2mqtt/${DIM}/set`, message: JSON.stringify({state: "ON"})},
            {topic: `zigbee2mqtt/${DIM}/set/led_brightness`, message: "50"},
        ]);
        // Requests: answered on control4/response/<action> with the base; silent when none of the devices is ours.
        await h.bus.onMQTTMessage({topic: "control4/request/stats", message: JSON.stringify({transaction: 3})});
        await h.bus.onMQTTMessage({topic: "control4/request/led_stop", message: JSON.stringify({devices: ["0x000fff00000000ff"]})});
        await tick(10);
        const stats = h.mqtt.find((m) => m.topic === "@control4/response/stats");
        const body = JSON.parse(stats?.payload ?? "{}");
        expect(body).toMatchObject({status: "ok", base: "zigbee2mqtt", transaction: 3, data: {link: {route_refreshes: 0}}});
        // Per-device link health.
        expect(body.data.devices.find((d: Any) => d.ieee === DIM)).toMatchObject({model: "C4-DIM1-Z", failed: 0, keepalive_failures: 0});
        expect(h.mqtt.some((m) => m.topic === "@control4/response/led_stop")).toBe(false);
        // Events go to both topics, with the base.
        h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x2345), Buffer.from("0t0041 sa c4.dm.b0c 00 01\r\n"));
        await tick(50);
        const shared = h.mqtt.filter((m) => m.topic === "@control4/event").map((m) => JSON.parse(m.payload));
        const local = h.mqtt.filter((m) => m.topic === "control4/event").map((m) => JSON.parse(m.payload));
        expect(shared.length).toBeGreaterThan(0);
        expect(shared).toEqual(local);
        expect(shared[0]).toMatchObject({ieee: DIM, base: "zigbee2mqtt"});
    });

    describe("Home Assistant event entity (ADR 0005)", () => {
        const CONFIG = (ieee: string) => `@homeassistant/event/${ieee}/control4_event/config`;
        const configs = (ieee: string) => h.mqtt.filter((m) => m.topic === CONFIG(ieee));
        /** Zigbee2MQTT's settings with its Home Assistant integration set to `homeassistant`. */
        const withHa = (homeassistant: unknown = {enabled: true}) => ({settings: {mqtt: {base_topic: "zigbee2mqtt"}, homeassistant}});
        const checkIn = (model: string) => {
            const s = Buffer.from(`c4:control4_keypad:${model}`);
            h.adapter.ezsp.ezspIncomingMessageHandler(
                4,
                aps(PROFILE_NETWORK, 2),
                pkt(0x1234),
                Buffer.concat([Buffer.from([0x18, 0x01, 0x0a, 0x07, 0x00, 0x42, s.length]), s]),
            );
        };

        beforeEach(async () => {
            await h.ext.stop();
            h = await makeHarness(withHa());
        });

        it("gives a Control4 device with actions one retained entity, on the Zigbee2MQTT device, fed from its own topic", () => {
            const [dim, ...again] = configs(DIM);
            expect(again).toEqual([]);
            expect(dim.retain).toBe(true);
            const cfg = JSON.parse(dim.payload);
            expect(cfg).toMatchObject({
                state_topic: `control4/${DIM}/event`,
                unique_id: `${DIM}_control4_event`,
                device: {identifiers: [`zigbee2mqtt_${DIM}`]},
                device_class: "button",
            });
            expect(cfg.event_types).toEqual(
                expect.arrayContaining([
                    "initial_switch_press",
                    "remote_button_tap_known",
                    "remote_button_fast_short_press",
                    "remote_button_long_press",
                    "led_notification_end",
                ]),
            );
            // Zigbee2MQTT clears, at start, a config it didn't publish whose first availability topic is under its base topic.
            expect(cfg).not.toHaveProperty("availability");
            expect(cfg).not.toHaveProperty("availability_topic");
            // event.received on a device skips entities that have a category.
            expect(cfg).not.toHaveProperty("entity_category");
            // Not a Control4 device; and a Control4 device whose actions aren't known yet keeps what it has.
            expect(configs(PLUG)).toEqual([]);
            expect(configs(KP)).toEqual([]);
        });

        it("publishes it once a learned model gives the device its actions", async () => {
            checkIn("KPZ-3B1");
            await tick(30);
            await h.bus.onExposesChanged({device: h.z2m.get(KP)});
            const cfg = JSON.parse(configs(KP).at(-1)?.payload ?? "{}");
            expect(cfg.event_types).toEqual(expect.arrayContaining(["initial_switch_press", "remote_button_short_release", "remote_button_tap_known"]));
        });

        it("publishes each event on the device's own topic too, with its command as event_type", async () => {
            h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x2345), Buffer.from("0t0041 sa c4.dm.b0c 00 01\r\n"));
            await tick(50);
            const shared = h.mqtt.filter((m) => m.topic === "@control4/event").map((m) => JSON.parse(m.payload));
            const own = h.mqtt.filter((m) => m.topic === `@control4/${DIM}/event`).map((m) => JSON.parse(m.payload));
            expect(shared.length).toBeGreaterThan(0);
            expect(own).toEqual(shared.map((e) => ({...e, event_type: e.command})));
            // Home Assistant drops an event whose type the entity doesn't declare.
            const types = JSON.parse(configs(DIM)[0].payload).event_types;
            for (const e of own) expect(types, e.action).toContain(e.event_type);
        });

        it("gives a remote's events their prefixed type on its own topic, as its entity declares, and leaves control4/event as it was", async () => {
            const def = buildDefinitions().find((d: Any) => d.model === "C4-Zigbee");
            const conv = def.toZigbee.find((c: Any) => c.key.includes("c4_model"));
            await conv.convertSet(undefined, "c4_model", "C4-SR250B", {device: h.devices[1], message: {}});
            await h.bus.onExposesChanged({device: h.z2m.get(KP)});
            // select (0x2a) pressed, a menu cancelled, a wake.
            for (const text of ["0t0001 sa c4.zr.bb 2a 0000 0000 00000000", "0t0002 sa c4.ln.cn 0001 0000", "0t0003 sa c4.zr.mot"]) {
                h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x1234), Buffer.from(`${text}\r\n`));
            }
            await tick(50);
            const shared = h.mqtt
                .filter((m) => m.topic === "@control4/event")
                .map((m) => JSON.parse(m.payload))
                .filter((e) => e.ieee === KP);
            const own = h.mqtt.filter((m) => m.topic === `@control4/${KP}/event`).map((m) => JSON.parse(m.payload));
            expect(shared.map((e) => e.command)).toEqual(["remote_button_short_press", "menu_cancel", "motion_wake"]);
            expect(own.map((e) => e.event_type)).toEqual(["remote_button_short_press", "remote_menu_cancel", "remote_motion_wake"]);
            expect(own).toEqual(shared.map((e, i) => ({...e, event_type: own[i].event_type})));
            const types = JSON.parse(configs(KP).at(-1)?.payload ?? "{}").event_types;
            for (const e of own) expect(types, e.action).toContain(e.event_type);
        });

        it("clears the entity when the device leaves", async () => {
            await h.bus.onDeviceLeave({ieeeAddr: DIM});
            expect(configs(DIM).at(-1)).toEqual({topic: CONFIG(DIM), payload: "", retain: true});
        });

        it("clears the entity when the device is removed from Zigbee2MQTT", async () => {
            await h.bus.onEntityRemoved({entity: h.z2m.get(DIM), name: "name_6e2b"});
            expect(configs(DIM).at(-1)).toEqual({topic: CONFIG(DIM), payload: "", retain: true});
        });

        it("clears a device excluded from Home Assistant the way Zigbee2MQTT excludes it", async () => {
            h.z2m.get(DIM).options.homeassistant = false;
            await h.bus.onExposesChanged({device: h.z2m.get(DIM)});
            expect(configs(DIM).at(-1)).toEqual({topic: CONFIG(DIM), payload: "", retain: true});
        });

        it("publishes nothing while Zigbee2MQTT's Home Assistant integration is off", async () => {
            await h.ext.stop();
            h = await makeHarness(withHa({enabled: false, discovery_topic: "homeassistant"}));
            await h.bus.onDeviceLeave({ieeeAddr: DIM});
            expect(h.mqtt.filter((m) => m.topic.startsWith("@homeassistant/"))).toEqual([]);
        });

        it("uses Zigbee2MQTT's discovery prefix", async () => {
            await h.ext.stop();
            h = await makeHarness(withHa({enabled: true, discovery_topic: "ha_discovery"}));
            expect(h.mqtt.map((m) => m.topic)).toContain(`@ha_discovery/event/${DIM}/control4_event/config`);
        });
    });

    it("restores herdsman on stop", async () => {
        const handler = h.adapter.ezsp.ezspIncomingMessageHandler;
        await h.ext.stop();
        expect(h.adapter.ezsp.ezspIncomingMessageHandler).not.toBe(handler);
        expect(Object.hasOwn(Device.prototype, "interviewQuirks")).toBe(true);
        const fresh = zhDevice(11, "Router", "0x000fff00000000cc", 0x6666, undefined, 0x1234);
        expect(fresh.interviewQuirks()).toBe(false); // original behaviour back
        expect((globalThis as Any)[RUNTIME_KEY]).toBeUndefined();
        h = await makeHarness(); // afterEach stops it
    });
});
// The instance status (src/z2m/status.ts): what a deploy and Home Assistant read
// about this instance, retained on control4/status/<base>.
describe("instance status", () => {
    const STATUS = "@control4/status/zigbee2mqtt";
    const statuses = () => h.mqtt.filter((m) => m.topic === STATUS).map((m) => ({...JSON.parse(m.payload), retained: m.retain}));
    /** herdsman Device hooks hidden by a test, put back after it. */
    const hidden: Record<string, unknown> = {};

    /** Stops the harness, runs `before`, and starts a new one with `opts`; afterEach stops it. */
    async function restart(opts: HarnessOptions, before?: () => void): Promise<void> {
        await h.ext.stop();
        before?.();
        h = await makeHarness(opts);
    }

    const hide = (hook: string) => () => {
        hidden[hook] = Device.prototype[hook];
        delete Device.prototype[hook];
    };

    afterEach(() => {
        for (const [hook, fn] of Object.entries(hidden)) {
            Device.prototype[hook] = fn;
            delete hidden[hook];
        }
    });

    it("publishes a retained status on control4/status/<base> at start", () => {
        const [first] = statuses();
        expect(first).toMatchObject({base: "zigbee2mqtt", build: BUILD, contract: CONTRACT, problems: [], retained: true});
        expect(BUILD).toMatch(/^[0-9a-f]{12}$/);
        expect(Date.parse(first.at)).not.toBeNaN();
        expect(first.totals).toEqual({sent: expect.any(Number), failed: expect.any(Number), route_refreshes: 0, led_queue: 0});
        // The DIM1-Z answers keepalives, so silence is watched here.
        expect(first.traffic).toEqual({frame_check: "armed", last_frame_s: null});
        expect(first.unreachable).toEqual([]);
    });

    // Two DIM1-Zs were dead for hours, and only the log said so.
    it("lists the devices keepalive cannot reach by name, and republishes as soon as that changes", async () => {
        const rt = (globalThis as Any)[RUNTIME_KEY];
        rt.link.cancelStateRead(DIM);
        const dim = rt.get(DIM);
        const before = statuses().length;
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        try {
            for (let i = 0; i < 3; i++) {
                const answered = rt.link.poke(dim);
                await vi.advanceTimersByTimeAsync(7_000);
                expect(await answered).toBe(false);
            }
        } finally {
            vi.useRealTimers();
        }
        // A DIM1-Z is rebooted remotely as it is listed (`0i c4.dm.rb`), and the status says how long ago.
        expect(statuses().slice(before)).toEqual([
            expect.objectContaining({
                problems: ["devices_unreachable"],
                unreachable: [{ieee: DIM, name: "name_6e2b", model: "C4-DIM1-Z", quiet_min: 0, reboot_min: 0}],
            }),
        ]);
        expect(h.sends.map((x) => x.data.toString("latin1"))).toContainEqual(expect.stringMatching(/^0i[0-9a-f]{4} c4\.dm\.rb\r\n$/));
        // A frame it sends direct (a rebooted dimmer sends one): it is reachable again.
        h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(0x2345), Buffer.from("0t0041 sa c4.dm.cc 00 02\r\n"));
        await tick(10);
        expect(statuses().at(-1)).toMatchObject({problems: [], unreachable: []});
    });

    it("republishes the status as soon as a traffic alarm is raised or cleared (#20)", () => {
        const rt = (globalThis as Any)[RUNTIME_KEY];
        const before = statuses().length;
        for (let i = 0; i < 5; i++) rt.traffic.sent(false);
        expect(statuses().slice(before)).toEqual([expect.objectContaining({problems: ["sends_failing"]})]);
        rt.traffic.sent(true);
        expect(statuses().at(-1)).toMatchObject({problems: []});
    });

    it("publishes it again every minute, with the link totals since start", async () => {
        vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
        try {
            await restart({});
            const rt = (globalThis as Any)[RUNTIME_KEY];
            const before = rt.link.totals();
            rt.link.noteTx(DIM, true);
            rt.link.noteTx(DIM, false);
            rt.link.noteTx(KP, true);
            expect(statuses()).toHaveLength(1);
            vi.advanceTimersByTime(60_000);
            expect(statuses()).toHaveLength(2);
            expect(statuses()[1].totals).toMatchObject({sent: before.sent + 3, failed: before.failed + 1});
        } finally {
            vi.useRealTimers();
        }
    });

    const cases: {name: string; tweak?: HarnessOptions["tweak"]; before?: () => void; converter?: ConverterInfo | null; problems: string[]}[] = [
        {
            name: "no Ember radio",
            tweak: ({adapter}) => {
                adapter.ezsp.ezspIncomingMessageHandler = undefined;
            },
            problems: ["no_radio"],
        },
        {name: "no interviewQuirks hook", before: hide("interviewQuirks"), problems: ["interview_hook"]},
        {name: "no ping hook", before: hide("ping"), problems: ["ping_hook"]},
        {
            name: "the herdsman Device class out of reach",
            tweak: ({controller, devices}) => {
                controller.getDevicesByType = (type: string) => (type === "Coordinator" ? [] : devices.filter((d) => d.type === type));
            },
            problems: ["interview_hook", "ping_hook"],
        },
        {name: "no converter", converter: null, problems: ["converter_missing"]},
        {name: "a converter built against another runtime API", converter: {...CONVERTER, api: RUNTIME_API + 1}, problems: ["converter_api"]},
    ];

    it.each(cases)("reports $name as a problem", async ({tweak, before, converter, problems}) => {
        if (converter === null) delete (globalThis as Any)[CONVERTER_KEY];
        else if (converter !== undefined) (globalThis as Any)[CONVERTER_KEY] = converter;
        await restart({tweak}, before);
        const [status] = statuses();
        expect(status.problems).toEqual(problems);
        // No converter, no build: it is the hash of both files.
        expect(status.build).toBe(converter === null ? null : BUILD);
    });

    it("runs on herdsman's legacy ezsp driver when the adapter has no Ember stack", async () => {
        await restart({
            tweak: ({adapter}) => {
                adapter.ezsp.ezspIncomingMessageHandler = undefined;
                const ezsp = Object.assign(new EventEmitter(), {sendUnicast: async () => ({status: 0})});
                adapter.driver = Object.assign(new EventEmitter(), {ezsp, makeApsFrame: () => ({sequence: 1})});
            },
        });
        expect(statuses()[0].problems).toEqual([]);
        expect(h.info.filter((l) => l.startsWith("Control4: extension started")).at(-1)).toMatch(/, ezsp, /);
    });

    it("puts the converter file's hash into the build", async () => {
        (globalThis as Any)[CONVERTER_KEY] = {...CONVERTER, file: "d".repeat(64)};
        await restart({});
        expect(statuses()[0].build).toBe(buildIdOf(EXTENSION_FILE, "d".repeat(64)));
        expect(statuses()[0].build).not.toBe(BUILD);
    });

    it("publishes no Home Assistant discovery while Zigbee2MQTT's Home Assistant integration is off", () => {
        expect(h.mqtt.filter((m) => m.topic.includes("/control4_"))).toEqual([]);
    });

    it("discovers the status entities on this instance's Zigbee2MQTT Bridge device", async () => {
        await restart({settings: {mqtt: {base_topic: "zigbee2mqtt"}, homeassistant: {enabled: true, discovery_topic: "ha"}}});
        // The devices' event entities (ADR 0005) aside.
        const configs = h.mqtt.filter((m) => m.topic.startsWith("@ha/") && !m.topic.startsWith("@ha/event/"));
        expect(configs.map((m) => m.topic)).toEqual(
            [
                "binary_sensor/control4_COORD/problem",
                "sensor/control4_COORD/build",
                "sensor/control4_COORD/contract",
                "sensor/control4_COORD/sent",
                "sensor/control4_COORD/failed",
                "sensor/control4_COORD/route_refreshes",
                "sensor/control4_COORD/led_queue",
            ].map((t) => `@ha/${t.replace("COORD", COORD)}/config`),
        );
        for (const m of configs) {
            const config = JSON.parse(m.payload);
            expect(m.retain, m.topic).toBe(true);
            expect(config, m.topic).toMatchObject({
                state_topic: "control4/status/zigbee2mqtt",
                expire_after: 180,
                availability_mode: "all",
                device: {identifiers: [`zigbee2mqtt_bridge_${COORD}`]},
            });
            // Zigbee2MQTT deletes, at start, a config it didn't publish whose first availability topic is under its base topic.
            expect(config.availability[0].topic, m.topic).toBe("control4/status/zigbee2mqtt");
            expect(config.availability[1].topic, m.topic).toBe("zigbee2mqtt/bridge/state");
        }
        expect(new Set(configs.map((m) => JSON.parse(m.payload).unique_id)).size).toBe(configs.length);
    });
});

// The contract between the extension and Home Assistant: what lands on the
// shared control4/event topic. The fixture is what the blueprints, the
// dispatcher package and the live scenario runner are checked against.
describe("control4/event contract", () => {
    const KC = "0x000fff0000006e2c";
    const APD = "0x000fff000000d120";
    const FS1 = "0x000fff0000001001";

    beforeEach(() => setFastTapTiming(300));
    afterEach(() => setFastTapTiming(2000));

    // Real clock: 30 frame groups, each followed by 0.7 s, so about 21 s of waiting plus Ember startup.
    it("publishes taps, multi-taps and holds as the contract fixture records them", {timeout: 50_000}, async () => {
        for (const [ieee, ep, nwk, model] of [
            [KC, 5, 0x4567, "C4-KC120277"],
            [APD, 6, 0x5678, "C4-APD120"],
            [FS1, 7, 0x6789, "C4-FS1-Z"],
        ] as const) {
            const zh = zhDevice(ep, "Router", ieee, nwk, model);
            h.devices.push(zh);
            h.z2m.set(ieee, {zh, ieeeAddr: ieee, name: `name_${ieee.slice(-4)}`, options: {}, resolveDefinition: vi.fn(async () => undefined)});
        }
        const s = Buffer.from("c4:control4_keypad:KPZ-3B1");
        h.adapter.ezsp.ezspIncomingMessageHandler(
            4,
            aps(PROFILE_NETWORK, 2),
            pkt(0x1234),
            Buffer.concat([Buffer.from([0x18, 0x01, 0x0a, 0x07, 0x00, 0x42, s.length]), s]),
        );
        await tick(30);
        const before = h.mqtt.filter((m) => m.topic === "@control4/event").length;
        const frames: [number, string[]][] = [
            // A keypad's first tap: its release teaches the extension that the button releases,
            // so this tap is not announced as known and its fast count says so.
            [0x1234, ["c4.kp.bb 00", "c4.kp.bc 00"]],
            [0x1234, ["c4.kp.cc 00 01"]], // the keypad's own count
            [0x1234, ["c4.kp.bb 00", "c4.kp.bc 00"]], // a known tap, announced on its release
            [0x1234, ["c4.kp.cc 00 01"]],
            [0x1234, ["c4.kp.bb 00", "c4.kp.bc 00", "c4.kp.bb 00", "c4.kp.bc 00"]], // a known double tap
            [0x1234, ["c4.kp.cc 00 02"]],
            [0x1234, ["c4.kp.bb 01", "c4.kp.bh 01", "c4.kp.be 01"]], // keypad hold
            [0x2345, ["c4.dm.b0c"]], // DIM1-Z paddle-down: known at once (no hold)
            [0x2345, ["c4.dm.cc 00 01"]],
            [0x2345, ["c4.dm.b0c", "c4.dm.b0c"]], // DIM1-Z double tap
            [0x2345, ["c4.dm.cc 00 02"]],
            [0x4567, ["c4.dmx.bp 00", "c4.dmx.sc 00"]], // KC120277 first tap (teaches the release)
            [0x4567, ["c4.dmx.cc 00 01"]],
            [0x4567, ["c4.dmx.bp 00", "c4.dmx.sc 00"]], // KC120277 known tap
            [0x4567, ["c4.dmx.cc 00 01"]],
            [0x4567, ["c4.dmx.bp 00", "c4.dmx.sc 00", "c4.dmx.bp 00", "c4.dmx.sc 00"]], // KC120277 known double tap
            [0x4567, ["c4.dmx.cc 00 02"]],
            [0x4567, ["c4.dmx.bp 02", "c4.dmx.hc 02", "c4.dmx.he 02"]], // KC120277 hold
            [0x5678, ["c4.dmx.bp 01", "c4.dmx.sc 01"]], // APD120 top paddle, first tap (teaches the release)
            [0x5678, ["c4.dmx.cc 01 01"]],
            [0x5678, ["c4.dmx.bp 01", "c4.dmx.sc 01"]], // APD120 known tap
            [0x5678, ["c4.dmx.cc 01 01"]],
            [0x5678, ["c4.dmx.bp 01", "c4.dmx.sc 01", "c4.dmx.bp 01", "c4.dmx.sc 01"]], // APD120 known double tap
            [0x5678, ["c4.dmx.cc 01 02"]],
            [0x5678, ["c4.dmx.bp 05", "c4.dmx.hc 05", "c4.dmx.he 05"]], // APD120 bottom paddle hold
            // FS1-Z, assumed to report as the DIM1-Z does (no capture from a unit yet, #51).
            [0x6789, ["c4.dm.b0c"]], // FS1-Z paddle-down: known at once (no hold)
            [0x6789, ["c4.dm.cc 00 01"]],
            [0x6789, ["c4.dm.b0c", "c4.dm.b0c"]], // FS1-Z double tap
            [0x6789, ["c4.dm.cc 00 02"]],
            [0x6789, ["c4.dm.b1b", "c4.dm.b1e"]], // FS1-Z bottom paddle hold: no paddle-down before it
        ];
        for (const [nwk, texts] of frames) {
            for (const t of texts) h.adapter.ezsp.ezspIncomingMessageHandler(0, aps(PROFILE_BUTTON), pkt(nwk), Buffer.from(`0t0041 sa ${t}\r\n`));
            await tick(700); // past the 0.55 s tap window
        }
        const events = h.mqtt
            .filter((m) => m.topic === "@control4/event")
            .slice(before)
            .map((m) => JSON.parse(m.payload));
        expect(events.map((e: Any) => showEvent(e, e.model, e.action))).toEqual([
            "KPZ-3B1 button_1_press",
            "KPZ-3B1 button_1_release",
            "KPZ-3B1 button_1_fast_single known=false",
            "KPZ-3B1 button_1_single",
            "KPZ-3B1 button_1_press",
            "KPZ-3B1 button_1_release",
            "KPZ-3B1 button_1_tap_known #1",
            "KPZ-3B1 button_1_fast_single known=true",
            "KPZ-3B1 button_1_single",
            "KPZ-3B1 button_1_press",
            "KPZ-3B1 button_1_release",
            "KPZ-3B1 button_1_tap_known #1",
            "KPZ-3B1 button_1_press",
            "KPZ-3B1 button_1_release",
            "KPZ-3B1 button_1_tap_known #2",
            "KPZ-3B1 button_1_fast_double known=true",
            "KPZ-3B1 button_1_double",
            "KPZ-3B1 button_2_press",
            "KPZ-3B1 button_2_hold",
            "KPZ-3B1 button_2_hold_release",
            "C4-DIM1-Z button_1_press",
            "C4-DIM1-Z button_1_tap_known #1",
            "C4-DIM1-Z button_1_fast_single known=true",
            "C4-DIM1-Z button_1_single",
            "C4-DIM1-Z button_1_press",
            "C4-DIM1-Z button_1_tap_known #1",
            "C4-DIM1-Z button_1_press",
            "C4-DIM1-Z button_1_tap_known #2",
            "C4-DIM1-Z button_1_fast_double known=true",
            "C4-DIM1-Z button_1_double",
            "C4-KC120277 button_1_press",
            "C4-KC120277 button_1_release",
            "C4-KC120277 button_1_fast_single known=false",
            "C4-KC120277 button_1_single",
            "C4-KC120277 button_1_press",
            "C4-KC120277 button_1_release",
            "C4-KC120277 button_1_tap_known #1",
            "C4-KC120277 button_1_fast_single known=true",
            "C4-KC120277 button_1_single",
            "C4-KC120277 button_1_press",
            "C4-KC120277 button_1_release",
            "C4-KC120277 button_1_tap_known #1",
            "C4-KC120277 button_1_press",
            "C4-KC120277 button_1_release",
            "C4-KC120277 button_1_tap_known #2",
            "C4-KC120277 button_1_fast_double known=true",
            "C4-KC120277 button_1_double",
            "C4-KC120277 button_2_press",
            "C4-KC120277 button_2_hold",
            "C4-KC120277 button_2_hold_release",
            "C4-APD120 top_press",
            "C4-APD120 top_release",
            "C4-APD120 top_fast_single known=false",
            "C4-APD120 top_single",
            "C4-APD120 top_press",
            "C4-APD120 top_release",
            "C4-APD120 top_tap_known #1",
            "C4-APD120 top_fast_single known=true",
            "C4-APD120 top_single",
            "C4-APD120 top_press",
            "C4-APD120 top_release",
            "C4-APD120 top_tap_known #1",
            "C4-APD120 top_press",
            "C4-APD120 top_release",
            "C4-APD120 top_tap_known #2",
            "C4-APD120 top_fast_double known=true",
            "C4-APD120 top_double",
            "C4-APD120 bottom_press",
            "C4-APD120 bottom_hold",
            "C4-APD120 bottom_hold_release",
            "C4-FS1-Z button_1_press",
            "C4-FS1-Z button_1_tap_known #1",
            "C4-FS1-Z button_1_fast_single known=true",
            "C4-FS1-Z button_1_single",
            "C4-FS1-Z button_1_press",
            "C4-FS1-Z button_1_tap_known #1",
            "C4-FS1-Z button_1_press",
            "C4-FS1-Z button_1_tap_known #2",
            "C4-FS1-Z button_1_fast_double known=true",
            "C4-FS1-Z button_1_double",
            "C4-FS1-Z button_2_hold",
            "C4-FS1-Z button_2_hold_release",
        ]);
        // Every button event of every family has the same fields, plus the tap index on a
        // known tap and known_taps on a fast count.
        const FIELDS = ["action", "base", "button", "button_id", "command", "device", "gesture", "ieee", "model"];
        for (const e of events) {
            const extra = e.gesture === "tap_known" ? ["tap_index"] : /^fast_/.test(e.gesture) ? ["known_taps"] : [];
            expect(Object.keys(e).sort(), e.action).toEqual([...FIELDS, ...extra].sort());
        }
        await expect(`${JSON.stringify(events, null, 2)}\n`).toMatchFileSnapshot("fixtures/control4-event.json");
    });
});
