// biome-ignore assist/source/organizeImports: import mocks first
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import * as data from "../mocks/data";
import {mockLogger} from "../mocks/logger";
import {events as mockMQTTEvents, mockMQTTPublishAsync} from "../mocks/mqtt";
import {flushPromises} from "../mocks/utils";
import {Device, Endpoint, devices, events as mockZHEvents, mockController, returnDevices} from "../mocks/zigbeeHerdsman";

import {EventEmitter} from "node:events";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {InterviewState} from "zigbee-herdsman/dist/controller/model/device";
import {Controller} from "../../lib/controller";
import * as settings from "../../lib/util/settings";
import {stringify} from "../../lib/util/stringify";

const DIST = process.env.C4Z2M_DIST as string;
const KP = "0x000fff0000636e2a";
const DIM = "0x000fff0000636e2b";
const NEW = "0x000fff0000636e2c";
const ALL: [string, string][] = [
    ["C4-APD120", "0x000fff0000700001"],
    ["C4-SW120277", "0x000fff0000700002"],
    ["C4-FS1-Z", "0x000fff0000700003"],
    ["C4-4SF120", "0x000fff0000700004"],
    ["loz-5s1-w", "0x000fff0000700005"],
    ["C4-KC120277", "0x000fff0000700006"],
    ["KPZ-3B1", "0x000fff0000700007"],
    ["C4-Z2IO-ZP", "0x000fff0000700008"],
    ["C4-SR250B", "0x000fff0000700009"],
    ["C4-SR260", "0x000fff000070000a"],
    ["C4-KD120", "0x000fff000070000b"],
    ["C4-KP2-Z", "0x000fff000070000c"],
    ["C4-V-ROSW120", "0x000fff000070000d"],
    ["LOZ-5D1-W", "0x000fff000070000e"],
].map(([m, i]) => [i, m] as [string, string]);

// biome-ignore lint/suspicious/noExplicitAny: test fakes
type Any = any;

const ezsp: Any = new EventEmitter();
const sent: {nwk: number; aps: Any; text: string}[] = [];
let tag = 0;
ezsp.ezspIncomingMessageHandler = vi.fn();
ezsp.send = vi.fn(async (_t: number, nwk: number, aps: Any, data: Buffer) => {
    const t = ++tag;
    sent.push({nwk, aps: {...aps}, text: Buffer.from(data).toString("latin1")});
    setTimeout(() => ezsp.emit("messageSent", 0, 0, nwk, aps, t), 1);
    return [0, t];
});
ezsp.ezspSendManyToOneRouteRequest = vi.fn(async () => 0);

function c4Device(ieee: string, nwk: number, model: string): Any {
    const d: Any = new Device("Router", ieee, nwk, 0xabcd, [new Endpoint(1, [], [], ieee), new Endpoint(197, [1], [], ieee)], InterviewState.Successful, "Mains (single phase)", model, "Control4");
    d.createEndpoint = (id: number) => {
        const ep = new Endpoint(id, [], [], ieee);
        d.endpoints.push(ep);
        return ep;
    };
    d.updateLastSeen = () => {
        d.lastSeen = Date.now();
    };
    return d;
}

const frame = (nwk: number, profileId: number, text: Buffer | string, src = 197) =>
    ezsp.ezspIncomingMessageHandler(0, {profileId, clusterId: 1, sourceEndpoint: src, destinationEndpoint: 1, options: 0, groupId: 0, sequence: 0}, {senderShortId: nwk, lastHopLqi: 201, lastHopRssi: -55}, typeof text === "string" ? Buffer.from(`${text}\r\n`, "latin1") : text);

const published = (topic: string) => mockMQTTPublishAsync.mock.calls.filter((c) => c[0] === topic).map((c) => c[1] as string);

/** The status problem entity's discovery config, on Zigbee2MQTT's mock coordinator. */
const PROBLEM_CONFIG = "homeassistant/binary_sensor/control4_0x00124b00120144ae/problem/config";

describe("Control4 bundles inside Zigbee2MQTT", () => {
    let controller: Controller;
    /** What Zigbee2MQTT published back on the configs echoed during its start-up sweep. */
    const swept: {ours: unknown[]; control: unknown[]} = {ours: [], control: []};

    beforeAll(async () => {
        vi.useFakeTimers();
        (devices as Any).c4_kp = c4Device(KP, 0x6e2a, "KPZ-6B1");
        (devices as Any).c4_dim = c4Device(DIM, 0x6e2b, "C4-DIM1-Z");
        // The DIM1-Z answers ZCL reads of its standard clusters on EP1.
        (devices as Any).c4_dim.endpoints[0].read.mockImplementation(async (cluster: string) => (cluster === "genOnOff" ? {onOff: 1} : {currentLevel: 180}));
        (devices as Any).c4_new = c4Device(NEW, 0x6e2c, "C4-Zigbee");
        ALL.forEach(([ieee, model], i) => {
            (devices as Any)[`c4_all_${i}`] = c4Device(ieee, 0x7000 + i, model);
        });
        returnDevices.length = 0;
        (mockController as Any).adapter = {ezsp, queue: {execute: (fn: () => Promise<unknown>) => fn()}};
        (mockController as Any).emit = vi.fn();
        (mockController as Any).identifyUnknownDevice = vi.fn(async () => undefined);
        mockController.getDevices.mockImplementation(() => [...mockController.getDevicesIterator()] as Any);

        data.writeDefaultConfiguration();
        settings.reRead();
        settings.set(["homeassistant"], {enabled: true});
        for (const kind of ["external_extensions", "external_converters"]) {
            fs.mkdirSync(path.join(data.mockDir, kind), {recursive: true});
            fs.copyFileSync(path.join(DIST, kind, "control4.mjs"), path.join(data.mockDir, kind, "control4.mjs"));
        }
        controller = new Controller(vi.fn(), vi.fn());
        await controller.start();
        await flushPromises();
        // For its first seconds Zigbee2MQTT listens on its discovery topic, where the broker hands back
        // every retained config, and clears those it takes for its own stale ones. Echo ours, and as a
        // control the same config with Zigbee2MQTT's availability topic first.
        const ours = published(PROBLEM_CONFIG).at(-1) as string;
        const control = JSON.parse(ours);
        control.availability.reverse();
        const controlTopic = PROBLEM_CONFIG.replace("/problem/", "/problem_control/");
        const before = mockMQTTPublishAsync.mock.calls.length;
        await mockMQTTEvents.message(PROBLEM_CONFIG, ours);
        await mockMQTTEvents.message(controlTopic, stringify(control));
        await flushPromises();
        const after = mockMQTTPublishAsync.mock.calls.slice(before);
        swept.ours = after.filter((c) => c[0] === PROBLEM_CONFIG).map((c) => c[1]);
        swept.control = after.filter((c) => c[0] === controlTopic).map((c) => c[1]);
        await vi.advanceTimersByTimeAsync(10_000);
    });

    afterAll(async () => {
        await controller?.stop();
        vi.useRealTimers();
    });

    it("loads both files without errors", () => {
        const errors = mockLogger.error.mock.calls.map((c) => String(c[0]));
        expect(errors.filter((m) => /control4|external|Failed/i.test(m))).toEqual([]);
        expect(fs.existsSync(path.join(data.mockDir, "external_extensions", "control4.mjs"))).toBe(true);
        expect(fs.existsSync(path.join(data.mockDir, "external_converters", "control4.mjs"))).toBe(true);
    });

    it("resolves the Control4 definitions", () => {
        expect((controller.zigbee.resolveEntity(KP) as Any).definition.model).toBe("C4-KP6-Z");
        expect((controller.zigbee.resolveEntity(DIM) as Any).definition.model).toBe("C4-DIM1-Z");
        expect((controller.zigbee.resolveEntity(NEW) as Any).definition.model).toBe("C4-Zigbee");
    });

    it("publishes Home Assistant discovery for the exposes", () => {
        const topics = mockMQTTPublishAsync.mock.calls.map((c) => c[0] as string);
        expect(topics).toContain(`homeassistant/select/${KP}/button_1_idle_color/config`);
        expect(topics).toContain(`homeassistant/number/${KP}/led_brightness/config`);
        expect(topics).toContain(`homeassistant/binary_sensor/${KP}/led_notification/config`);
        expect(topics).toContain(`homeassistant/light/${DIM}/light/config`);
        expect(topics).toContain(`homeassistant/switch/${DIM}/switch_paddle_local_control/config`);
        expect(topics).toContain(`homeassistant/number/${DIM}/on_transition/config`);
    });

    it("discovers every family in Home Assistant", () => {
        const topics = mockMQTTPublishAsync.mock.calls.map((c) => c[0] as string);
        for (const [ieee, model] of ALL) {
            const mine = topics.filter((t) => t.startsWith("homeassistant/") && t.includes(`/${ieee}/`));
            expect(mine.length, model).toBeGreaterThan(1);
        }
        const id = (m: string) => (ALL.find(([, x]) => x === m) as [string, string])[0];
        expect(topics).toContain(`homeassistant/fan/${id("C4-4SF120")}/fan/config`);
        expect(topics).toContain(`homeassistant/switch/${id("loz-5s1-w")}/switch_l1/config`);
        expect(topics).toContain(`homeassistant/switch/${id("loz-5s1-w")}/switch_l2/config`);
        expect(topics).toContain(`homeassistant/switch/${id("C4-FS1-Z")}/switch/config`);
        expect(topics).toContain(`homeassistant/sensor/${id("C4-APD120")}/power/config`);
        expect(topics).toContain(`homeassistant/select/${id("C4-KC120277")}/led_12_mode/config`);
        expect(topics).toContain(`homeassistant/light/${id("C4-KD120")}/light/config`);
        expect(topics).toContain(`homeassistant/select/${id("C4-KD120")}/button_position_1_behaviour/config`);
        expect(topics).toContain(`homeassistant/select/${id("C4-KP2-Z")}/button_2_idle_color/config`);
        expect(topics).toContain(`homeassistant/switch/${id("C4-V-ROSW120")}/switch/config`);
        expect(topics).toContain(`homeassistant/light/${id("LOZ-5D1-W")}/light_l1/config`);
        expect(topics).toContain(`homeassistant/light/${id("LOZ-5D1-W")}/light_l2/config`);
        expect(topics).toContain(`homeassistant/select/${id("C4-Z2IO-ZP")}/io_mode/config`);
        expect(topics).toContain(`homeassistant/text/${id("C4-SR260")}/display_message/config`);
        expect(topics).toContain(`homeassistant/sensor/${id("C4-SR250B")}/battery/config`);
        const errors = mockLogger.error.mock.calls.map((c) => String(c[0]));
        expect(errors).toEqual([]);
    });

    it("drives the fan and the outlet through Zigbee2MQTT", async () => {
        const id = (m: string) => (ALL.find(([, x]) => x === m) as [string, string])[0];
        const before = sent.length;
        await mockMQTTEvents.message(`zigbee2mqtt/${id("C4-4SF120")}/set`, stringify({state: "ON", speed: 3}));
        await mockMQTTEvents.message(`zigbee2mqtt/${id("loz-5s1-w")}/set`, stringify({state_l2: "ON"}));
        await vi.advanceTimersByTimeAsync(300);
        const texts = sent.slice(before).map((s) => s.text.trim().replace(/^0s[0-9a-f]{4} /, ""));
        expect(texts).toContain("c4.dmx.fsc 00 03");
        expect(texts).toContain("c4.dm.tv 01 00 64");
        expect(JSON.parse(published(`zigbee2mqtt/${id("loz-5s1-w")}`).at(-1) as string)).toMatchObject({state_l2: "ON"});
        expect(JSON.parse(published(`zigbee2mqtt/${id("C4-4SF120")}`).at(-1) as string)).toMatchObject({state: "ON", speed: 3});
    });

    it("dims each of the outlet dimmer's outlets by its own endpoint", async () => {
        const id = (m: string) => (ALL.find(([, x]) => x === m) as [string, string])[0];
        const before = sent.length;
        await mockMQTTEvents.message(`zigbee2mqtt/${id("LOZ-5D1-W")}/set`, stringify({state_l2: "ON", brightness_l2: 127}));
        await vi.advanceTimersByTimeAsync(300);
        const texts = sent.slice(before).map((s) => s.text.trim().replace(/^0s[0-9a-f]{4} /, ""));
        expect(texts).toContain("c4.dm.tv 01 00 32");
        expect(JSON.parse(published(`zigbee2mqtt/${id("LOZ-5D1-W")}`).at(-1) as string)).toMatchObject({state_l2: "ON", brightness_l2: 127});
    });

    it("turns a keypad frame into an action and a device trigger", async () => {
        frame(0x6e2a, 0xc25c, "0t0041 sa c4.kp.cc 00 02");
        await vi.advanceTimersByTimeAsync(50);
        const states = published(`zigbee2mqtt/${KP}`).map((p) => JSON.parse(p));
        expect(states.some((s) => s.action === "button_1_double" && s.action_command === "remote_button_double_press")).toBe(true);
        expect(published(`zigbee2mqtt/${KP}/action`)).toContain("button_1_double");
        const topics = mockMQTTPublishAsync.mock.calls.map((c) => c[0] as string);
        expect(topics).toContain(`homeassistant/device_automation/${KP}/action_button_1_double/config`);
        // The blueprint event stream.
        const events = published("zigbee2mqtt/control4/event").map((p) => JSON.parse(p));
        expect(events).toContainEqual(expect.objectContaining({ieee: KP, model: "KPZ-6B1", action: "button_1_double", button: "button_1", gesture: "double", command: "remote_button_double_press"}));
        // The device's own topic, which its event entity listens on.
        const own = published(`control4/${KP}/event`).map((p) => JSON.parse(p));
        expect(own).toContainEqual(expect.objectContaining({ieee: KP, action: "button_1_double", event_type: "remote_button_double_press"}));
    });

    it("gives each Control4 device a Control4 events entity, which Zigbee2MQTT's own discovery leaves alone", async () => {
        const topic = `homeassistant/event/${KP}/control4_event/config`;
        const cfg = published(topic).at(-1) as string;
        expect(JSON.parse(cfg)).toMatchObject({state_topic: `control4/${KP}/event`, device: {identifiers: [`zigbee2mqtt_${KP}`]}});
        expect(JSON.parse(cfg).event_types).toContain("remote_button_tap_known");
        // At start Zigbee2MQTT clears retained discovery configs it didn't publish. Its MQTT client
        // skips topics it published itself, so hand ours to it as a start meets it: retained from
        // the last run, before this run publishes it again.
        const bus = (controller as Any).eventBus;
        const before = published(topic).length;
        bus.emitMQTTMessage({topic, message: cfg});
        await vi.advanceTimersByTimeAsync(100);
        expect(published(topic).length).toBe(before);
        // The same config with Zigbee2MQTT's availability would be cleared.
        bus.emitMQTTMessage({topic, message: stringify({...JSON.parse(cfg), availability: [{topic: "zigbee2mqtt/bridge/state"}]})});
        await vi.advanceTimersByTimeAsync(100);
        expect(published(topic).at(-1)).toBe("");
    });

    it("accepts the ZHA LED-cluster commands on /set", async () => {
        const before = sent.length;
        await mockMQTTEvents.message(`zigbee2mqtt/0x000fff0000700001/set`, stringify({set_led_color: {button_id: 1, on_red: 255, on_green: 0, on_blue: 0, off_red: 0, off_green: 0, off_blue: 8}}));
        await vi.advanceTimersByTimeAsync(500);
        const texts = sent.slice(before).map((s) => s.text.trim().replace(/^0s[0-9a-f]{4} /, ""));
        expect(texts).toEqual(["c4.dmx.led 01 03 ff0000", "c4.dmx.led 01 04 000008"]);
    });

    it("handles /set through the converter and runtime", async () => {
        const before = sent.length;
        await mockMQTTEvents.message(`zigbee2mqtt/${KP}/set`, stringify({button_1_idle_color: "red", led_brightness: 50}));
        await vi.advanceTimersByTimeAsync(2000);
        const texts = sent.slice(before).map((s) => s.text.trim().replace(/^0s[0-9a-f]{4} /, ""));
        expect(texts).toContain("c4.kp.lf 00 ff0000");
        expect(texts).toContain("c4.kp.lf 00 7f0000"); // brightness re-applied
        const last = JSON.parse(published(`zigbee2mqtt/${KP}`).at(-1) as string);
        expect(last).toMatchObject({button_1_idle_color: "red", led_brightness: 50});
    });

    it("reads the light's real state at startup and on /get", async () => {
        const ep1 = (devices as Any).c4_dim.endpoints[0];
        expect(ep1.read.mock.calls.map((c: Any[]) => [c[0], c[1]])).toEqual([
            ["genOnOff", ["onOff"]],
            ["genLevelCtrl", ["currentLevel"]],
        ]);
        const states = published(`zigbee2mqtt/${DIM}`).map((p) => JSON.parse(p));
        expect(states.some((s) => s.state === "ON" && s.brightness === 180)).toBe(true);
        ep1.read.mockImplementation(async (cluster: string) => (cluster === "genOnOff" ? {onOff: 0} : {currentLevel: 180}));
        await mockMQTTEvents.message(`zigbee2mqtt/${DIM}/get`, stringify({state: ""}));
        await vi.advanceTimersByTimeAsync(200);
        expect(ep1.read).toHaveBeenCalledTimes(4);
        expect(JSON.parse(published(`zigbee2mqtt/${DIM}`).at(-1) as string)).toMatchObject({state: "OFF"});
    });

    it("dims the light with ZCL on the Home Automation profile", async () => {
        const before = sent.length;
        await mockMQTTEvents.message(`zigbee2mqtt/${DIM}/set`, stringify({state: "ON", brightness: 100}));
        await vi.advanceTimersByTimeAsync(200);
        const zcl = sent.slice(before).find((s) => s.aps.profileId === 0x0104);
        expect(zcl?.aps).toMatchObject({clusterId: 8, destinationEndpoint: 1});
        const last = JSON.parse(published(`zigbee2mqtt/${DIM}`).at(-1) as string);
        expect(last).toMatchObject({state: "ON", brightness: 100});
    });

    it("learns a new device's model from its check-in and rediscovers it", async () => {
        const s = Buffer.from("c4:control4_remote:C4-SR250B");
        frame(0x6e2c, 0xc25d, Buffer.concat([Buffer.from([0x18, 0x01, 0x0a, 0x07, 0x00, 0x42, s.length]), s]), 2);
        await vi.advanceTimersByTimeAsync(500);
        expect((devices as Any).c4_new.modelID).toBe("C4-SR250B");
        expect((controller.zigbee.resolveEntity(NEW) as Any).definition.model).toBe("C4-SR250B");
        const topics = mockMQTTPublishAsync.mock.calls.map((c) => c[0] as string);
        expect(topics).toContain(`homeassistant/sensor/${NEW}/battery/config`);
        expect(topics).toContain(`homeassistant/text/${NEW}/room_name/config`);
        expect(sent.some((x) => x.aps.profileId === 0xc25d && x.nwk === 0x6e2c)).toBe(true);
    });

    it("serves the shared control4/ namespace", async () => {
        const before = sent.length;
        await mockMQTTEvents.message(`control4/${DIM}/set`, stringify({state: "OFF"}));
        await vi.advanceTimersByTimeAsync(200);
        expect(sent.slice(before).some((s) => s.aps.profileId === 0x0104 && s.nwk === 0x6e2b)).toBe(true);
        expect(JSON.parse(published(`zigbee2mqtt/${DIM}`).at(-1) as string)).toMatchObject({state: "OFF"});
        await mockMQTTEvents.message("control4/request/stats", stringify({transaction: 9}));
        await vi.advanceTimersByTimeAsync(10);
        const rsp = JSON.parse(published("control4/response/stats").at(-1) as string);
        expect(rsp).toMatchObject({status: "ok", base: "zigbee2mqtt", transaction: 9});
        const events = published("control4/event").map((p) => JSON.parse(p));
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].base).toBe("zigbee2mqtt");
    });

    it("publishes the instance status, with the build of the files it loaded", async () => {
        const status = JSON.parse(published("control4/status/zigbee2mqtt").find((p) => JSON.parse(p).build) as string);
        // Zigbee2MQTT imported temporary copies of the two files: the build is still dist/'s.
        const {distBuildId} = await import(pathToFileURL(path.join(DIST, "..", "tools", "build-id.mjs")).href);
        expect(status).toMatchObject({base: "zigbee2mqtt", build: distBuildId(DIST), contract: 1});
        // Zigbee2MQTT's herdsman mock has no interviewQuirks, and its ping is per instance, so neither
        // hook can be installed here; on a real herdsman both are (test/extension.test.ts).
        expect(status.problems).toEqual(["interview_hook", "ping_hook"]);
    });

    it("keeps the status entities through Zigbee2MQTT's start-up discovery sweep", () => {
        expect(JSON.parse(published(PROBLEM_CONFIG)[0])).toMatchObject({device: {identifiers: ["zigbee2mqtt_bridge_0x00124b00120144ae"]}});
        expect(swept.ours).toEqual([]);
        // The control: with Zigbee2MQTT's availability topic first, the same config is cleared.
        expect(swept.control).toEqual([""]);
    });

    it("answers bridge requests", async () => {
        await mockMQTTEvents.message("zigbee2mqtt/bridge/request/control4/stats", stringify({transaction: 7}));
        await vi.advanceTimersByTimeAsync(10);
        const rsp = JSON.parse(published("zigbee2mqtt/bridge/response/control4/stats").at(-1) as string);
        expect(rsp.status).toBe("ok");
        expect(rsp.transaction).toBe(7);
        expect(rsp.data.devices.map((d: Any) => d.model)).toEqual(expect.arrayContaining(["C4-DIM1-Z", "C4-SR250B", "KPZ-6B1", "C4-SR260"]));
    });

    it("republishes the exposes a converter save changed", async () => {
        const converters = controller.getExtension("ExternalConverters") as Any;
        const save = async (code: string) => {
            await converters.onMQTTMessage({topic: "zigbee2mqtt/bridge/request/converter/save", message: stringify({name: "control4.mjs", code})});
            expect(JSON.parse(published("zigbee2mqtt/bridge/response/converter/save").at(-1) as string)).toMatchObject({status: "ok"});
            await vi.advanceTimersByTimeAsync(100);
        };
        const republish = async (transaction: number) => {
            await mockMQTTEvents.message("zigbee2mqtt/bridge/request/control4/republish", stringify({transaction}));
            await vi.advanceTimersByTimeAsync(100);
            return JSON.parse(published("zigbee2mqtt/bridge/response/control4/republish").at(-1) as string);
        };
        const probe = `homeassistant/sensor/${DIM}/republish_probe/config`;
        const bridgeExposes = () =>
            (JSON.parse(published("zigbee2mqtt/bridge/devices").at(-1) as string) as Any[]).find((d) => d.ieee_address === DIM).definition.exposes.map((x: Any) => x.name ?? x.type);
        // The build under test, with one more sensor on the DIM1-Z.
        const original = fs.readFileSync(path.join(DIST, "external_converters", "control4.mjs"), "utf8");
        const entry = "var converter_entry_default = buildDefinitions();";
        expect(original).toContain(entry);
        const edited = original.replace(entry, `${entry}\nfor (const d of converter_entry_default) if (d.model === "C4-DIM1-Z") d.exposes = [...d.exposes, e.numeric("republish_probe", ea.STATE)];`);

        await save(edited);
        // Zigbee2MQTT re-resolved the definition, but published none of it.
        expect((controller.zigbee.resolveEntity(DIM) as Any).exposes().map((x: Any) => x.name)).toContain("republish_probe");
        expect(published(probe)).toEqual([]);
        expect(bridgeExposes()).not.toContain("republish_probe");

        expect(await republish(11)).toMatchObject({status: "ok", data: {devices: 3 + ALL.length}, transaction: 11});
        expect(published(probe)).toHaveLength(1);
        expect(bridgeExposes()).toContain("republish_probe");

        // Back to the build under test: the next republish takes the sensor away again.
        await save(original);
        await republish(12);
        expect(published(probe).at(-1)).toBe("");
        expect(bridgeExposes()).not.toContain("republish_probe");
    });

    describe("tools/deploy.mjs against this Zigbee2MQTT", () => {
        const tool = (name: string) => import(pathToFileURL(path.join(DIST, "..", "tools", name)).href);
        const read = (kind: string) => fs.readFileSync(path.join(DIST, `external_${kind}s`, "control4.mjs"), "utf8");
        /** What the tool would read as retained: the last of each of this instance's messages. */
        const retained = () =>
            new Map(
                ["zigbee2mqtt/bridge/info", "zigbee2mqtt/bridge/extensions", "zigbee2mqtt/bridge/converters", "control4/status/zigbee2mqtt"].map(
                    (t) => [t, published(t).at(-1) as string] as [string, string],
                ),
            );
        /**
         * The tool's io on this Zigbee2MQTT: a save goes to its external JS extension (awaited, as the
         * broker would deliver it), anything else through its MQTT; a wait advances the fake clock
         * until what it waits for has been published, or until its timeout.
         */
        const io = () => ({
            async publish(topic: string, payload: string) {
                const kind = /\/bridge\/request\/(converter|extension)\/save$/.exec(topic)?.[1];
                if (kind) await (controller.getExtension(kind === "converter" ? "ExternalConverters" : "ExternalExtensions") as Any).onMQTTMessage({topic, message: payload});
                else await mockMQTTEvents.message(topic, payload);
            },
            mark: () => mockMQTTPublishAsync.mock.calls.length,
            async wait(topic: string, since: number, ms: number, accept: (json: Any, text: string) => unknown) {
                for (let waited = 0; ; waited += 1000) {
                    for (const c of mockMQTTPublishAsync.mock.calls.slice(since)) {
                        if (c[0] !== topic) continue;
                        let json: Any;
                        try {
                            json = JSON.parse(c[1] as string);
                        } catch {
                            json = undefined;
                        }
                        const v = accept(json, c[1] as string);
                        if (v !== undefined) return v;
                    }
                    if (waited >= ms) return undefined;
                    await vi.advanceTimersByTimeAsync(1000);
                }
            },
            latest: (topic: string) => published(topic).at(-1),
        });

        it("keeps the code this instance runs, and proves a push of the converter then the extension by its status", async () => {
            const {plan, pushInstance} = await tool("deploy.mjs");
            const {buildId, distBuildId} = await tool("build-id.mjs");
            const dist = {extension: read("extension"), converter: read("converter")};
            const target = plan(retained(), "another build").find((r: Any) => r.base === "zigbee2mqtt");
            // The retained file lists carry dist/'s code, so that is what a rollback would put back.
            expect(target).toMatchObject({action: "push", before: distBuildId(DIST), kept: dist});

            const next = {extension: `${dist.extension}\n// pushed by the harness\n`, converter: `${dist.converter}\n// pushed by the harness\n`};
            const build = buildId(next.extension, next.converter);
            const since = mockMQTTPublishAsync.mock.calls.length;
            const r = await pushInstance(io(), target, {...next, build});
            expect(r).toMatchObject({ok: true, row: {before: distBuildId(DIST), now: build, result: "pushed"}});
            const saves = mockMQTTPublishAsync.mock.calls
                .slice(since)
                .map((c) => c[0] as string)
                .filter((t) => /\/bridge\/response\/(converter|extension)\/save$/.test(t));
            expect(saves).toEqual(["zigbee2mqtt/bridge/response/converter/save", "zigbee2mqtt/bridge/response/extension/save"]);
            expect(JSON.parse(published("control4/status/zigbee2mqtt").at(-1) as string).build).toBe(build);

            // And back to the build under test, the same way.
            const back = plan(retained(), distBuildId(DIST)).find((r: Any) => r.base === "zigbee2mqtt");
            expect(back).toMatchObject({action: "push", before: build, kept: next});
            expect(await pushInstance(io(), back, {...dist, build: distBuildId(DIST)})).toMatchObject({ok: true, row: {now: distBuildId(DIST)}});
        });

        it("rolls back an extension whose start() throws, though Zigbee2MQTT answered its save ok", async () => {
            const {plan, pushInstance} = await tool("deploy.mjs");
            const {buildId, distBuildId} = await tool("build-id.mjs");
            const dist = {extension: read("extension"), converter: read("converter")};
            const start = "  async start() {\n";
            expect(dist.extension.split(start)).toHaveLength(2);
            const broken = {converter: dist.converter, extension: dist.extension.replace(start, `${start}    throw new Error("harness: a build whose start() throws");\n`)};
            const target = plan(retained(), "another build").find((r: Any) => r.base === "zigbee2mqtt");
            const since = mockMQTTPublishAsync.mock.calls.length;

            const r = await pushInstance(io(), target, {...broken, build: buildId(broken.extension, broken.converter)});
            const answers = mockMQTTPublishAsync.mock.calls
                .slice(since)
                .filter((c) => c[0] === "zigbee2mqtt/bridge/response/extension/save")
                .map((c) => JSON.parse(c[1] as string).status);
            // The broken build's save, then the rollback's.
            expect(answers).toEqual(["ok", "ok"]);
            expect(mockLogger.error.mock.calls.some((c) => /harness: a build whose start\(\) throws/.test(String(c[0])))).toBe(true);
            expect(r.ok).toBe(false);
            expect(r.row.result).toMatch(new RegExp(`^failed \\(no status with build \\w+ within 45 s\\); rolled back to ${distBuildId(DIST)}$`));
            expect(JSON.parse(published("control4/status/zigbee2mqtt").at(-1) as string).build).toBe(distBuildId(DIST));
            expect(JSON.parse(published("zigbee2mqtt/bridge/extensions").at(-1) as string)).toContainEqual({name: "control4.mjs", code: dist.extension});
        });
    });

    it("starts an extension saved through bridge/request/extension/save as a hot-load, with no keypad identity sends", async () => {
        const started = () => mockLogger.info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("Control4: extension started"));
        // Zigbee2MQTT's own start was the first start; each save since stopped the running extension first.
        expect(started()[0]).toMatch(/^Control4: extension started: first start since Zigbee2MQTT started \(/);
        const before = started().length;
        const from = sent.length;
        const code = fs.readFileSync(path.join(DIST, "external_extensions", "control4.mjs"), "utf8");
        await (controller.getExtension("ExternalExtensions") as Any).onMQTTMessage({topic: "zigbee2mqtt/bridge/request/extension/save", message: stringify({name: "control4.mjs", code})});
        await flushPromises();
        expect(started().slice(before)).toEqual([expect.stringMatching(/^Control4: extension started: hot-load, /)]);
        // A keypad's start-up identity sends come 12-32 s after a start that is no hot-load.
        await vi.advanceTimersByTimeAsync(45_000);
        expect(sent.slice(from).filter((s) => s.nwk === 0x6e2a && s.aps.profileId === 0xc25d)).toEqual([]);
    });

    describe("traffic alarms (#20)", () => {
        const status = () => JSON.parse(published("control4/status/zigbee2mqtt").at(-1) as string);

        it("raises no_frames when no Control4 frame comes through for 30 min, and clears it on the next one", async () => {
            expect(status().traffic.frame_check).toBe("armed");
            await vi.advanceTimersByTimeAsync(31 * 60_000);
            expect(status().problems).toContain("no_frames");
            expect(mockLogger.error.mock.calls.some((c) => /no Control4 frame has come through Zigbee2MQTT for 30 min/.test(String(c[0])))).toBe(true);
            frame(0x6e2b, 0xc25c, "0t0041 sa c4.dm.cc 00 01");
            await flushPromises();
            expect(status().problems).not.toContain("no_frames");
            expect(status().traffic.last_frame_s).toBe(0);
        });

        it("raises sends_failing when herdsman confirms none of 5 sends, and clears it at the next confirmation", async () => {
            const i = ALL.findIndex(([, m]) => m === "C4-4SF120");
            const [fan] = ALL[i];
            const fanNwk = 0x7000 + i;
            const confirming = ezsp.send.getMockImplementation() as Any;
            // herdsman takes the frames but never emits messageSent for them.
            ezsp.send.mockImplementation(async (_t: number, nwk: number, aps: Any, data: Buffer) => {
                sent.push({nwk, aps: {...aps}, text: Buffer.from(data).toString("latin1")});
                return [0, ++tag];
            });
            for (let speed = 1; speed <= 5; speed++) {
                await mockMQTTEvents.message(`zigbee2mqtt/${fan}/set`, stringify({state: "ON", speed: speed % 4}));
                await vi.advanceTimersByTimeAsync(15_000);
            }
            expect(status().problems).toContain("sends_failing");

            // herdsman confirms again. What the status said when the fan's OFF reached herdsman, before its messageSent:
            let atOff: string[] | undefined;
            ezsp.send.mockImplementation(async (t: number, nwk: number, aps: Any, data: Buffer) => {
                if (nwk === fanNwk && Buffer.from(data).toString("latin1").includes("c4.dmx.fsc 00 00")) atOff ??= status().problems;
                return confirming(t, nwk, aps, data);
            });
            await mockMQTTEvents.message(`zigbee2mqtt/${fan}/set`, stringify({state: "OFF"}));
            // The send window (link.ts) gives a device one frame in flight at a time. The fan's is the last
            // speed's retry, which herdsman never confirms: the OFF goes out once that frame gives its slot
            // back, TX_SLOT_HOLD_MAX (3 s) after it was sent at most.
            await vi.advanceTimersByTimeAsync(4_000);
            expect(atOff).toEqual(expect.arrayContaining(["sends_failing"]));
            expect(status().problems).not.toContain("sends_failing");
            ezsp.send.mockImplementation(confirming);
        });
    });

    // Last: the old-instance side removes the DIM1-Z from this Zigbee2MQTT.
    describe("handoff (ADR 0004) through Zigbee2MQTT's own bridge", () => {
        const handoff = (ieee: string, step: string) => `control4/handoff/${ieee}/${step}`;
        const last = (topic: string) => {
            const p = published(topic).at(-1);
            return p === undefined ? undefined : JSON.parse(p);
        };

        it("gives a device that joined here the options and name it had on the old instance, and rediscovers it once that one let go", async () => {
            await mockZHEvents.deviceInterview({device: (devices as Any).c4_new, status: "successful"});
            await flushPromises();
            const {id} = last(handoff(NEW, "request"));
            await mockMQTTEvents.message(
                handoff(NEW, "offer"),
                stringify({from: "zigbee2mqtt_old", to: "zigbee2mqtt", id, had: Date.now(), holds: true, model: "KPZ-3B1", settings: {button_1_idle_color: "blue"}, profile: {name: "Hall Keypad", options: {tap_window: 0.8}}}),
            );
            await vi.advanceTimersByTimeAsync(6_000);
            expect((devices as Any).c4_new.modelID).toBe("KPZ-3B1");
            expect(settings.getDevice(NEW)).toMatchObject({tap_window: 0.8});
            expect(last(handoff(NEW, "ack"))).toEqual({from: "zigbee2mqtt", to: ["zigbee2mqtt_old"], id});

            const since = mockMQTTPublishAsync.mock.calls.length;
            await mockMQTTEvents.message(handoff(NEW, "done"), stringify({from: "zigbee2mqtt_old", to: "zigbee2mqtt", id, evicted: true}));
            await vi.advanceTimersByTimeAsync(5_000);
            expect(settings.getDevice(NEW)?.friendly_name).toBe("Hall Keypad");
            // Zigbee2MQTT cleared the device's discovery, then published it again under the new name.
            // (The Control4 events entity is the extension's own: it republishes that itself.)
            const ours = (topic: string) => topic.endsWith("/control4_event/config");
            const configs = mockMQTTPublishAsync.mock.calls.slice(since).filter((c) => new RegExp(`^homeassistant/\\w+/${NEW}/[^/]+/config$`).test(c[0] as string) && !ours(c[0] as string));
            expect(mockMQTTPublishAsync.mock.calls.slice(since).some((c) => ours(c[0] as string) && c[1] !== "")).toBe(true);
            const firstFull = configs.findIndex((c) => c[1] !== "");
            expect(configs.slice(0, firstFull).length).toBeGreaterThan(0);
            expect(configs.slice(0, firstFull).every((c) => c[1] === "")).toBe(true);
            expect(JSON.parse(configs[firstFull][1] as string).device.name).toBe("Hall Keypad");
        });

        it("on an ack, force-removes a device it still has from Zigbee2MQTT, forgets it, and says done", async () => {
            await mockMQTTEvents.message(handoff(DIM, "request"), stringify({from: "zigbee2mqtt_new", id: "zigbee2mqtt_new:1"}));
            await flushPromises();
            expect(last(handoff(DIM, "offer"))).toMatchObject({from: "zigbee2mqtt", to: "zigbee2mqtt_new", holds: true});

            await mockMQTTEvents.message(handoff(DIM, "ack"), stringify({from: "zigbee2mqtt_new", to: ["zigbee2mqtt"], id: "zigbee2mqtt_new:1"}));
            await vi.advanceTimersByTimeAsync(2_000);
            // Removed without a ping: from herdsman's database (a stub here), and through Zigbee2MQTT's bridge.
            expect((devices as Any).c4_dim.removeFromDatabase).toHaveBeenCalled();
            expect(last("zigbee2mqtt/bridge/response/device/remove")).toMatchObject({status: "ok", data: {id: DIM, force: true}});
            expect(last(handoff(DIM, "done"))).toEqual({from: "zigbee2mqtt", to: "zigbee2mqtt_new", id: "zigbee2mqtt_new:1", evicted: true});
            const store = JSON.parse(fs.readFileSync(path.join(data.mockDir, "control4", "control4.json"), "utf8"));
            expect(store.models[DIM]).toBeUndefined();
            expect(store.handoff.had[DIM]).toBeUndefined();
        });
    });
});
