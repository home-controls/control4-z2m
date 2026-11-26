/**
 * Zigbee2MQTT external extension: Control4 support on stock Zigbee2MQTT.
 *
 * Installs (and on stop removes) what the ZHA quirks did with monkeypatches:
 *   - an EZSP receive hook for the three Control4 profiles (EmberTransport);
 *   - herdsman Device.interviewQuirks: a Control4 device always completes its
 *     interview (it never answers Simple_Desc / Basic reads);
 *   - herdsman Device.ping: Z2M's availability ping becomes a real Control4 Get
 *     on Get-capable routers instead of a ZCL read the device never answers;
 *   - learns each device's model from its check-in and re-resolves its
 *     definition, answers every check-in with the controller identity, and
 *     runs link health, LED engine, remote LCD handling.
 *
 * Events (buttons, menus, wake, LED notifications) are also published as JSON on
 * <base>/control4/event with the device IEEE, so blueprints can follow them.
 * Each device that has actions also gets a Home Assistant event entity (MQTT
 * discovery, attached to the device Zigbee2MQTT created) fed from its own
 * event topic (ADR 0005).
 *
 * Several Zigbee2MQTT instances (one per coordinator) share one namespace,
 * control4/..., so Home Assistant needs no per-instance base topic:
 *   control4/event                  every instance's events (with `base`)
 *   control4/<ieee>/event           one device's events, with `event_type`
 *   control4/<ieee>/set[/<attr>]    served by the instance that has the device
 *   control4/request/<action>       every instance acts on its own devices and
 *                                   answers on control4/response/<action>
 *   control4/status/<base>          this instance's status, retained, every
 *                                   minute (status.ts)
 *   control4/handoff/<ieee>/<step>  a device that joined one instance takes its
 *                                   settings from the one that last had it
 *                                   (handoff.ts, ADR 0004)
 *
 * Bridge requests: <base>/bridge/request/control4/<action>
 *   led_effect | led_status | led_stop | led_refresh   {devices?: [...], ...}
 *   set_model  {device, model}      stats  {}      republish  {}
 */

import path from "node:path";
import {fileURLToPath} from "node:url";

import {buildIdOf, fileHash} from "../core/build";
import {CONTRACT, type Family, GENERIC_MODEL, GESTURES, type Gesture, isC4Ieee, isValidModel, MANUFACTURER, modelInfo, REMOTE_COMMANDS} from "../core/constants";
import {ledEffect, ledStatus} from "../core/animation";
import {Handoff, type HandoffHost, type HandoffStep} from "../core/handoff";
import {type Logger, wrapZ2mLogger} from "../core/log";
import {Runtime, type RuntimeHost} from "../core/runtime";
import {type Json, type Profile, Store} from "../core/store";
import {EmberTransport, type Transport} from "../core/transport";
import {remoteEventType} from "../devices/remote";
import {CONVERTER_KEY, type ConverterInfo, HOT_LOAD_KEY, RUNTIME_API, RUNTIME_KEY} from "./global";
import {discoveryConfigs, type InstanceStatus, problemsOf, STATUS_INTERVAL} from "./status";

// biome-ignore lint/suspicious/noExplicitAny: Zigbee2MQTT / herdsman internals
type Any = any;

/** This file's hash, taken while Zigbee2MQTT's copy of it still exists (it deletes the copy once imported). */
const EXTENSION_FILE = fileHash(import.meta.url);

const OUTLET_SECOND_EP = 11;
/** A state read the device does not answer must not hold the read queue for herdsman's default 10 s. */
const ZCL_READ_TIMEOUT = 5_000;
/** How long Zigbee2MQTT gets to remove an evicted device. */
const EVICT_TIMEOUT = 15_000;
/** After the removal, before the new instance is told: its Home Assistant extension is clearing the discovery. */
const EVICT_SETTLE = 1_000;

/** The namespace every instance serves, whatever its base topic. */
export const SHARED_TOPIC = "control4";

/** Longest first, so `hold_release` wins over `release` and `fast_single` over `single`. */
const GESTURE_SUFFIXES = (Object.keys(GESTURES) as Gesture[]).sort((a, b) => b.length - a.length);

/**
 * The ZHA command name an action is published with: `button_1_double` ->
 * `remote_button_double_press`, a remote's `select_press` ->
 * `remote_button_short_press`; a non-button action (`menu_select`) is its own.
 */
export function commandOf(action: string, family?: Family): string {
    const g = GESTURE_SUFFIXES.find((s) => action.endsWith(`_${s}`));
    if (!g) return action;
    return (isRemote(family) && REMOTE_COMMANDS[g]) || GESTURES[g];
}

function isRemote(family?: Family): boolean {
    return family === "sr250" || family === "sr260";
}

/**
 * The type an event has on its device's Control4 events entity: its command,
 * prefixed on a remote (`menu_select` -> `remote_menu_select`), whose non-key
 * events Zigbee2MQTT's own event entity would otherwise share.
 */
export function eventTypeOf(command: string, family?: Family): string {
    return isRemote(family) ? remoteEventType(command) : command;
}

/**
 * A device's Home Assistant event entity: one event type per command its
 * actions are published with (eventTypeOf). Command names, never actions, so
 * it shares no button event type with Zigbee2MQTT's own event entity on the
 * same device, and a remote shares none at all.
 * No availability: Zigbee2MQTT clears, at start, any discovery config it did
 * not publish whose first availability topic is under its base topic.
 */
export function eventEntityConfig(ieee: string, actions: readonly string[], family?: Family): Record<string, unknown> {
    return {
        name: "Control4 events",
        unique_id: `${ieee}_control4_event`,
        state_topic: `${SHARED_TOPIC}/${ieee}/event`,
        event_types: [...new Set(actions.map((a) => eventTypeOf(commandOf(a, family), family)))],
        device_class: "button",
        icon: "mdi:gesture-double-tap",
        device: {identifiers: [`zigbee2mqtt_${ieee}`]},
        origin: {name: "control4-z2m"},
    };
}

function dataDir(): string {
    if (process.env.ZIGBEE2MQTT_DATA) return process.env.ZIGBEE2MQTT_DATA;
    try {
        // This file is imported from <data>/external_extensions/.
        return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    } catch {
        return path.resolve(process.cwd(), "data");
    }
}

/** The remotes run on batteries (and join as end devices); everything else is mains powered. */
function powerSourceOf(zh: Any): string {
    const family = modelInfo(zh.modelID)?.family;
    return family === "sr250" || family === "sr260" || zh.type === "EndDevice" ? "Battery" : "Mains (single phase)";
}

/** The model a Control4 device's record should carry: the learned one, else its own, else the generic one. */
function knownModel(learned: string | undefined, own: string | undefined): string {
    if (isValidModel(learned)) return learned;
    return isValidModel(own) ? own : GENERIC_MODEL;
}

/**
 * Stamp a Control4 device's herdsman record with `model` and what follows from
 * it: the manufacturer and the power source. Sets only what differs; returns
 * whether anything did.
 */
function stampModel(zh: Any, model: string): boolean {
    let changed = false;
    const put = (key: "modelID" | "manufacturerName" | "powerSource", value: string) => {
        if (zh[key] === value) return;
        zh[key] = value;
        changed = true;
    };
    put("modelID", model);
    put("manufacturerName", MANUFACTURER);
    // The device never answers the Basic read that would tell herdsman.
    put("powerSource", powerSourceOf(zh));
    return changed;
}

/** An outlet's definition maps endpoints 1 and 11; the device never answers the Simple_Desc reads that would tell herdsman. */
function addOutletEndpoints(zh: Any): void {
    if (modelInfo(zh.modelID)?.family !== "outlet") return;
    if (!zh.getEndpoint(1)) zh.createEndpoint(1);
    if (!zh.getEndpoint(OUTLET_SECOND_EP)) zh.createEndpoint(OUTLET_SECOND_EP);
}

export default class Control4Extension {
    private log!: Logger;
    private runtime: Runtime | undefined;
    private store: Store | undefined;
    private handoff: Handoff | undefined;
    /** Devices being evicted, until Zigbee2MQTT reports their removal. */
    private evictions = new Map<string, () => void>();
    private controller: Any;
    private restore: (() => void)[] = [];
    /** The event entity config last published per device ("" = cleared). */
    private eventEntities = new Map<string, string>();
    /** What the status reports as installed: the Ember receive hook, and the herdsman Device hooks. */
    private radio = false;
    private hooks = {interview: false, ping: false};
    private statusTimer: NodeJS.Timeout | undefined;
    /** Each Control4 device's last known network address: an announce or an address change alone doesn't say what it was. */
    private addresses = new Map<string, number>();
    /** Network addresses a Control4 frame came from that Zigbee2MQTT didn't know (logged once each). */
    private unknownSenders = new Set<number>();

    constructor(
        private readonly zigbee: Any,
        private readonly mqtt: Any,
        private readonly state: Any,
        private readonly publishEntityState: Any,
        private readonly eventBus: Any,
        _enableDisableExtension: Any,
        _restartCallback: Any,
        _addExtension: Any,
        private readonly settings: Any,
        private readonly logger: Any,
    ) {}

    async start(): Promise<void> {
        this.log = wrapZ2mLogger(this.logger);
        this.controller = this.zigbee.zhController;
        const adapter = this.controller?.adapter;
        let transport: Transport | undefined;
        if (EmberTransport.supports(adapter)) {
            transport = new EmberTransport(adapter, this.log);
        } else {
            this.log.error(
                "Control4: this coordinator is not driven by the 'ember' adapter. Control4 devices need an Ember (Silicon Labs EFR32) coordinator with `adapter: ember` - the frames on profiles 0xC25C/D/E cannot be received otherwise.",
            );
        }
        this.radio = transport !== undefined;

        const file = path.join(dataDir(), "control4", "control4.json");
        this.store = new Store(file, this.log);
        const store = this.store;
        const host = this.makeHost(transport, store);
        const runtime = new Runtime(host);
        this.runtime = runtime;
        (globalThis as Any)[RUNTIME_KEY] = runtime;

        // An extension stopped on this same controller: Zigbee2MQTT kept running, so this start
        // is a hot-load. A restart builds a new controller. `true`: an older build stopped here.
        const left = (globalThis as Any)[HOT_LOAD_KEY];
        const hotLoad = left === true || (left instanceof WeakRef && this.controller !== undefined && left.deref() === this.controller);
        this.patchHerdsman();
        for (const zh of this.c4ZhDevices()) {
            this.applyKnownModel(zh);
            this.addresses.set(String(zh.ieeeAddr).toLowerCase(), zh.networkAddress);
        }
        runtime.start(hotLoad);
        for (const zh of this.c4ZhDevices()) this.publishEventEntity(zh.ieeeAddr);
        const handoff = new Handoff(this.makeHandoffHost(store, runtime));
        this.handoff = handoff;
        handoff.seed(this.c4ZhDevices().map((zh) => String(zh.ieeeAddr).toLowerCase()));

        this.eventBus.onDeviceInterview(this, (data: Any) => {
            const zh = data.device?.zh;
            if (!zh || !isC4Ieee(zh.ieeeAddr) || data.status !== "successful") return;
            this.noteAddress(zh);
            this.applyKnownModel(zh);
            runtime.ensureDevice(zh.ieeeAddr);
            runtime.requestStateRead(zh.ieeeAddr);
            this.publishEventEntity(zh.ieeeAddr);
            handoff.joined(zh.ieeeAddr);
        });
        this.eventBus.onDeviceAnnounce(this, (data: Any) => {
            const zh = data.device?.zh;
            if (!zh || !isC4Ieee(zh.ieeeAddr)) return;
            // Zigbee2MQTT logs an announce at debug only (#60).
            this.noteAddress(zh);
            this.log.info(`Control4: ${this.nameOf(zh.ieeeAddr)} announced itself at network address ${zh.networkAddress}: it re-joined or powered up`);
            // Tell it who its controller is, and check that it answers again (#60).
            runtime.rejoined(zh.ieeeAddr);
            // Back after a power cut or a reboot: its load may be in any state, its LEDs too.
            runtime.requestStateRead(zh.ieeeAddr);
            runtime.repaintLeds(zh.ieeeAddr);
            this.publishEventEntity(zh.ieeeAddr);
        });
        // Also logged at debug only by Zigbee2MQTT: a re-join under a new address, or an address learned by a lookup.
        this.eventBus.onDeviceNetworkAddressChanged?.(this, (data: Any) => {
            const zh = data.device?.zh;
            if (zh && isC4Ieee(zh.ieeeAddr)) this.noteAddress(zh);
        });
        this.eventBus.onDeviceLeave(this, (data: Any) => {
            if (!isC4Ieee(data.ieeeAddr)) return;
            runtime.removeDevice(data.ieeeAddr);
            runtime.forgetProvisioning(data.ieeeAddr);
            this.clearEventEntity(data.ieeeAddr);
            handoff.left(String(data.ieeeAddr).toLowerCase());
        });
        // A learned model changes the actions, so the event types.
        this.eventBus.onExposesChanged?.(this, (data: Any) => {
            const ieee = data.device?.zh?.ieeeAddr;
            if (isC4Ieee(ieee)) this.publishEventEntity(ieee);
        });
        this.eventBus.onEntityRemoved?.(this, (data: Any) => {
            const ieee = data.entity?.zh?.ieeeAddr;
            if (!isC4Ieee(ieee)) return;
            const id = String(ieee).toLowerCase();
            this.clearEventEntity(id);
            runtime.removeDevice(id);
            handoff.left(id);
            this.evictions.get(id)?.();
        });
        // Keep a copy of each device's name and options, for a handoff after its removal.
        const keepProfile = (data: Any) => {
            const ieee = data.entity?.zh?.ieeeAddr;
            if (isC4Ieee(ieee)) handoff.keepProfile(String(ieee).toLowerCase());
        };
        this.eventBus.onEntityRenamed?.(this, keepProfile);
        this.eventBus.onEntityOptionsChanged?.(this, keepProfile);
        this.eventBus.onMQTTMessage(this, (data: Any) => void this.onMqtt(data));
        void Promise.resolve(this.mqtt.subscribe?.(`${SHARED_TOPIC}/#`)).catch((error: unknown) =>
            this.log.warning(`Control4: could not subscribe to ${SHARED_TOPIC}/#: ${error}`),
        );
        const kind = hotLoad
            ? "hot-load, without the start-up identity sends, state reads, Z2IO provisioning or remote bootstrap"
            : "first start since Zigbee2MQTT started";
        this.log.info(`Control4: extension started: ${kind} (${transport ? "ember" : "no radio access"}, ${runtime.devices.size} devices, store ${file})`);

        this.publishDiscovery();
        this.publishStatus();
        this.statusTimer = setInterval(() => this.publishStatus(), STATUS_INTERVAL);
        this.statusTimer.unref?.();
    }

    async stop(): Promise<void> {
        if (this.statusTimer) clearInterval(this.statusTimer);
        this.statusTimer = undefined;
        this.eventBus.removeListeners(this);
        void Promise.resolve(this.mqtt.unsubscribe?.(`${SHARED_TOPIC}/#`)).catch(() => undefined);
        this.handoff?.stop();
        this.handoff = undefined;
        this.evictions.clear();
        this.runtime?.stop();
        this.runtime = undefined;
        for (const undo of this.restore.reverse()) undo();
        this.restore = [];
        if ((globalThis as Any)[RUNTIME_KEY]) delete (globalThis as Any)[RUNTIME_KEY];
        // Zigbee2MQTT stops an extension it is about to replace, and every extension before a
        // restart: the next start is a hot-load only on this same controller.
        if (this.controller) (globalThis as Any)[HOT_LOAD_KEY] = new WeakRef(this.controller);
        else delete (globalThis as Any)[HOT_LOAD_KEY];
    }

    // -- herdsman ---------------------------------------------------------------

    private c4ZhDevices(): Any[] {
        const all: Any[] = this.controller?.getDevices?.() ?? [];
        return all.filter((d) => isC4Ieee(d.ieeeAddr));
    }

    private zhDevice(ieee: string): Any {
        return this.controller?.getDeviceByIeeeAddr?.(ieee);
    }

    private z2mDevice(ieee: string): Any {
        const zh = this.zhDevice(ieee);
        return zh ? this.zigbee.resolveEntity(zh) : undefined;
    }

    private nameOf(ieee: string): string {
        const id = String(ieee).toLowerCase();
        return this.z2mDevice(id)?.name ?? id;
    }

    /**
     * Log a Control4 device's new network address (#60): it re-joined. Decimal, as
     * herdsman logs it in "Received network/route error ... for <address>", so a route
     * error can be matched to the device that held the address then.
     */
    private noteAddress(zh: Any): void {
        const ieee = String(zh.ieeeAddr).toLowerCase();
        const nwk = zh.networkAddress;
        const was = this.addresses.get(ieee);
        this.addresses.set(ieee, nwk);
        if (was === undefined || was === nwk) return;
        this.log.info(`Control4: ${this.nameOf(ieee)} (${ieee}) changed network address ${was} -> ${nwk}: it re-joined`);
    }

    /** Give a C4 device its learned model (or the generic one) and the endpoints its definition maps. */
    private applyKnownModel(zh: Any): void {
        const ieee = String(zh.ieeeAddr).toLowerCase();
        const changed = stampModel(zh, knownModel(this.store?.model(ieee), zh.modelID));
        addOutletEndpoints(zh);
        if (changed) {
            zh.save?.();
            this.reresolve(ieee);
        }
    }

    private reresolve(ieee: string): void {
        const dev = this.z2mDevice(ieee);
        if (!dev) return;
        Promise.resolve(dev.resolveDefinition?.(true))
            .then(() => this.eventBus.emitExposesAndDevicesChanged?.(dev))
            .catch((error: unknown) => this.log.debug(`Control4: re-resolving ${ieee} failed: ${error}`));
    }

    /**
     * Tell Zigbee2MQTT every Control4 device's exposes changed, so Home Assistant
     * discovery follows a converter saved through its API: the save re-resolves
     * the definitions but never says so. Returns how many devices it named.
     */
    private republish(): number {
        const devs = this.c4ZhDevices()
            .map((zh) => this.zigbee.resolveEntity(zh))
            .filter(Boolean);
        for (const dev of devs) this.eventBus.emitExposesChanged?.({device: dev});
        // One bridge/devices publish for all of them, not one per device.
        this.eventBus.emitDevicesChanged?.();
        return devs.length;
    }

    private patchHerdsman(): void {
        const coordinator = this.controller?.getDevicesByType?.("Coordinator")?.[0];
        const proto = coordinator ? Object.getPrototypeOf(coordinator) : undefined;
        if (!proto) {
            this.log.warning("Control4: could not reach the herdsman Device class - interview / ping patches not installed");
            return;
        }
        const store = this.store as Store;
        const getRuntime = () => this.runtime;

        if (typeof proto.interviewQuirks === "function") {
            const original = proto.interviewQuirks;
            proto.interviewQuirks = function (this: Any) {
                if (isC4Ieee(this.ieeeAddr)) {
                    stampModel(this, knownModel(store.model(String(this.ieeeAddr).toLowerCase()), this.modelID));
                    return true;
                }
                return original.call(this);
            };
            this.restore.push(() => {
                proto.interviewQuirks = original;
            });
            this.hooks.interview = true;
        } else {
            this.log.warning("Control4: herdsman has no interviewQuirks hook - a Control4 device may show 'interview failed' until its model is learned");
        }

        if (typeof proto.ping === "function") {
            const original = proto.ping;
            proto.ping = async function (this: Any, ...args: unknown[]) {
                const rt = getRuntime();
                if (rt && isC4Ieee(this.ieeeAddr)) {
                    const alive = await rt.honestPing(String(this.ieeeAddr).toLowerCase());
                    if (alive === false) throw new Error("Control4 ping: no answer to c4.sy.fwv");
                    // undefined: not pingable this way (sleepy / unverified model) - keep it available.
                    return;
                }
                return original.apply(this, args);
            };
            this.restore.push(() => {
                proto.ping = original;
            });
            this.hooks.ping = true;
        } else {
            this.log.warning("Control4: herdsman has no ping hook - with availability on, Control4 devices may show offline (they never answer herdsman's own ping)");
        }
    }

    private makeHost(transport: Transport | undefined, store: Store): RuntimeHost {
        return {
            log: this.log,
            store,
            transport,
            coordinatorIeee: () => this.controller?.getDevicesByType?.("Coordinator")?.[0]?.ieeeAddr,
            deviceInfo: (ieee) => {
                const zh = this.zhDevice(ieee);
                return zh ? {nwk: zh.networkAddress, type: zh.type, modelID: zh.modelID} : undefined;
            },
            ieeeByNwk: (nwk) => {
                const zh = this.controller?.getDeviceByNetworkAddress?.(nwk);
                if (zh) return zh.ieeeAddr;
                if (!this.unknownSenders.has(nwk)) {
                    this.unknownSenders.add(nwk);
                    this.log.info(
                        `Control4: a Control4 frame came from network address ${nwk}, which Zigbee2MQTT does not know - asking it who it is (a device that re-joined under a new address?)`,
                    );
                }
                Promise.resolve(this.controller?.identifyUnknownDevice?.(nwk)).catch(() => undefined);
                return undefined;
            },
            c4Devices: () => this.c4ZhDevices().map((d) => String(d.ieeeAddr).toLowerCase()),
            publish: (ieee, payload) => {
                const dev = this.z2mDevice(ieee);
                if (dev) void Promise.resolve(this.publishEntityState(dev, payload)).catch((error: unknown) => this.log.debug(`Control4: publish failed: ${error}`));
            },
            publishEvent: (ieee, payload) => {
                const event: Record<string, unknown> = {...payload, base: this.baseTopic()};
                const body = JSON.stringify(event);
                const fail = (error: unknown) => this.log.debug(`Control4: event publish failed: ${error}`);
                void Promise.resolve(this.mqtt.publish("control4/event", body)).catch(fail);
                void Promise.resolve(this.mqtt.publish("event", body, {baseTopic: SHARED_TOPIC})).catch(fail);
                // The device's own topic: its event entity and c4_device's waits.
                const own = JSON.stringify({...event, event_type: eventTypeOf(String(event.command), modelInfo(String(event.model))?.family)});
                void Promise.resolve(this.mqtt.publish(`${ieee}/event`, own, {baseTopic: SHARED_TOPIC})).catch(fail);
            },
            state: (ieee) => {
                const dev = this.z2mDevice(ieee);
                return dev ? (this.state.get(dev) ?? {}) : {};
            },
            friendlyName: (ieee) => this.z2mDevice(ieee)?.name ?? ieee,
            deviceOption: (ieee, key) => this.z2mDevice(ieee)?.options?.[key],
            setModel: (ieee, model) => {
                const zh = this.zhDevice(ieee);
                if (!zh) return;
                stampModel(zh, model);
                addOutletEndpoints(zh);
                zh.save?.();
                this.reresolve(ieee);
            },
            setFirmware: (ieee, firmware) => {
                const zh = this.zhDevice(ieee);
                if (!zh || zh.softwareBuildID === firmware) return;
                zh.softwareBuildID = firmware;
                zh.save?.();
            },
            exposesChanged: (ieee) => {
                const dev = this.z2mDevice(ieee);
                if (dev) this.eventBus.emitExposesAndDevicesChanged?.(dev);
            },
            noteSeen: (ieee, lqi) => {
                const zh = this.zhDevice(ieee);
                if (!zh) return;
                zh.updateLastSeen?.();
                if (lqi !== undefined) zh.linkquality = lqi;
                // messageNonEmitted: Zigbee2MQTT publishes last_seen for it (messageEmitted
                // would tell it a state publish already carried it - not so for check-ins).
                this.controller?.emit?.("lastSeenChanged", {device: zh, reason: "messageNonEmitted"});
            },
            zclRead: async (ieee, ep, cluster, attrs) => {
                const zh = this.zhDevice(ieee);
                if (!zh) throw new Error(`unknown device ${ieee}`);
                const endpoint = zh.getEndpoint(ep) ?? zh.createEndpoint(ep);
                return (await endpoint.read(cluster, attrs, {timeout: ZCL_READ_TIMEOUT})) ?? {};
            },
            bind: async (ieee, srcEp, cluster) => {
                const zh = this.zhDevice(ieee);
                const coordEp = this.controller?.getDevicesByType?.("Coordinator")?.[0]?.getEndpoint?.(1);
                if (!zh || !coordEp) throw new Error("device or coordinator endpoint missing");
                const ep = zh.getEndpoint(srcEp) ?? zh.createEndpoint(srcEp);
                await ep.bind(cluster, coordEp);
            },
            // Raised or cleared: tell Home Assistant now, not at the next minute.
            statusChanged: () => this.publishStatus(),
            handoffPending: (ieee) => this.handoff?.pending(ieee) ?? false,
            // herdsman's NWK_addr_req, broadcast with the device's IEEE (it waits for no answer).
            rediscover: async (ieee) => {
                await this.zhDevice(ieee)?.requestNetworkAddress?.();
            },
        };
    }

    // -- handoff (ADR 0004) ----------------------------------------------------------

    private makeHandoffHost(store: Store, runtime: Runtime): HandoffHost {
        return {
            base: () => this.baseTopic(),
            log: this.log,
            store,
            now: () => Date.now(),
            // skipReceive off: Zigbee2MQTT would ignore this topic from every instance once it published on it.
            send: (ieee, step, body) =>
                void Promise.resolve(this.mqtt.publish(`handoff/${ieee}/${step}`, JSON.stringify(body), {baseTopic: SHARED_TOPIC, skipReceive: false})).catch((error: unknown) =>
                    this.log.warning(`Control4: handoff ${step} for ${ieee} not sent: ${error}`),
                ),
            has: (ieee) => !!this.zhDevice(ieee),
            lastSeen: (ieee) => {
                const t = this.zhDevice(ieee)?.lastSeen;
                return typeof t === "number" ? t : undefined;
            },
            profile: (ieee) => this.profileOf(ieee),
            adopt: (ieee, model, options) => {
                if (model) runtime.learnModel(ieee, model);
                // It was reset to pair here: what it holds may be factory values, not the settings it brought.
                runtime.forgetSettingsRead(ieee);
                // A fresh handler reads the saved settings the handoff brought.
                runtime.rebuild(ieee);
                if (options && Object.keys(options).length) this.bridge("device/options", {id: ieee, options});
            },
            evict: (ieee) => this.evict(ieee),
            settle: (ieee, name, evicted) => this.settleHandoff(ieee, name, evicted),
        };
    }

    /** A request to this instance's own Zigbee2MQTT bridge, as its frontend sends it. */
    private bridge(request: string, body: Record<string, unknown>): void {
        this.eventBus.emitMQTTMessage({topic: `${this.baseTopic()}/bridge/request/${request}`, message: JSON.stringify(body)});
    }

    /** The device's friendly name and its own Zigbee2MQTT device options here (not the instance-wide device_options). */
    private profileOf(ieee: string): Profile | undefined {
        const dev = this.z2mDevice(ieee);
        if (!dev) return undefined;
        const {friendly_name: _name, ID: _id, ...options} = this.settings?.getDevice?.(ieee) ?? dev.options ?? {};
        return {name: String(dev.name ?? ieee), options: JSON.parse(JSON.stringify(options)) as Record<string, Json>};
    }

    /** Force-remove the device here; resolves once Zigbee2MQTT reports the removal and Home Assistant has had a moment. */
    private evict(ieee: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.evictions.delete(ieee);
                reject(new Error(`Zigbee2MQTT did not remove it within ${EVICT_TIMEOUT / 1000} s`));
            }, EVICT_TIMEOUT);
            this.evictions.set(ieee, () => {
                clearTimeout(timer);
                this.evictions.delete(ieee);
                setTimeout(resolve, EVICT_SETTLE);
            });
            // A device is on one network at a time: this record can only be stale, so no ping first.
            this.bridge("device/remove", {id: ieee, force: true});
        });
    }

    /**
     * The handoff is over on this instance (the new one): give the device the name it
     * had, and when an old instance evicted its record, republish the discovery that
     * eviction cleared (Zigbee2MQTT keys the topics by IEEE alone).
     */
    private settleHandoff(ieee: string, name: string | undefined, evicted: boolean): void {
        const dev = this.z2mDevice(ieee);
        if (!dev) return;
        let renamed = false;
        if (name && name !== dev.name) {
            const other = this.zigbee.resolveEntity(name);
            if (other && String(other.ieeeAddr ?? "").toLowerCase() !== ieee) {
                this.log.info(`Control4: ${ieee} keeps the name ${dev.name}: '${name}', its name on the instance it came from, is taken here`);
            } else {
                // Zigbee2MQTT clears the device's Home Assistant discovery, waits, and discovers it again.
                this.bridge("device/rename", {from: ieee, to: name, homeassistant_rename: true});
                renamed = true;
            }
        }
        if (!evicted) return;
        // The same clear-wait-discover for the name it keeps, so the old entities are gone before the new ones arrive.
        if (!renamed) this.eventBus.emitEntityRenamed?.({entity: dev, homeAssisantRename: true, from: dev.name, to: dev.name});
        this.eventEntities.delete(ieee);
        this.publishEventEntity(ieee);
    }

    // -- Home Assistant event entity -----------------------------------------------

    /** Zigbee2MQTT's discovery prefix, or undefined while its Home Assistant integration is off. */
    private discoveryTopic(): string | undefined {
        const ha = this.settings?.get?.()?.homeassistant;
        if (ha !== true && !ha?.enabled) return undefined;
        return ha?.discovery_topic ?? "homeassistant";
    }

    /** The values of a device's `action` expose (none before its definition resolves). */
    private actionValues(ieee: string): string[] {
        let exposes: Any[] = [];
        try {
            exposes = this.z2mDevice(ieee)?.exposes?.() ?? [];
        } catch {
            return [];
        }
        const action = exposes.find((x) => x?.property === "action");
        return Array.isArray(action?.values) ? action.values.map(String) : [];
    }

    /**
     * Publish (retained) the device's event entity; clear it when the device is
     * excluded from Home Assistant the way Zigbee2MQTT excludes it (device option
     * `homeassistant: false`). A device with no actions yet (its definition still
     * resolving) keeps what it has: clearing would make Home Assistant delete the
     * entity, and its name with it.
     */
    private publishEventEntity(ieee: string): void {
        const prefix = this.discoveryTopic();
        if (!prefix) return;
        const id = String(ieee).toLowerCase();
        const option = this.z2mDevice(id)?.options?.homeassistant;
        if (option !== undefined && !option) {
            this.sendEventEntity(prefix, id, "");
            return;
        }
        const actions = this.actionValues(id);
        if (actions.length) this.sendEventEntity(prefix, id, JSON.stringify(eventEntityConfig(id, actions, modelInfo(this.zhDevice(id)?.modelID)?.family)));
    }

    private clearEventEntity(ieee: string): void {
        const prefix = this.discoveryTopic();
        if (prefix) this.sendEventEntity(prefix, String(ieee).toLowerCase(), "");
    }

    private sendEventEntity(prefix: string, ieee: string, payload: string): void {
        if (this.eventEntities.get(ieee) === payload) return;
        this.eventEntities.set(ieee, payload);
        void Promise.resolve(this.mqtt.publish(`event/${ieee}/control4_event/config`, payload, {clientOptions: {retain: true, qos: 1}, baseTopic: prefix})).catch(
            (error: unknown) => this.log.debug(`Control4: event entity publish failed for ${ieee}: ${error}`),
        );
    }

    // -- instance status -----------------------------------------------------------

    private statusTopic(): string {
        return `${SHARED_TOPIC}/status/${this.baseTopic()}`;
    }

    /** What the converter bundle registered when Zigbee2MQTT loaded it (read each time: a converter can be re-saved). */
    private converter(): ConverterInfo | undefined {
        const info = (globalThis as Any)[CONVERTER_KEY];
        return info && typeof info.api === "number" ? info : undefined;
    }

    /** The build of the two files this instance loaded, or null while either hash is unknown. */
    private build(): string | null {
        const converterFile = this.converter()?.file;
        return EXTENSION_FILE && converterFile ? buildIdOf(EXTENSION_FILE, converterFile) : null;
    }

    private currentStatus(): InstanceStatus | undefined {
        const rt = this.runtime;
        if (!rt) return undefined;
        const unreachable = rt.link
            .unreachable()
            .map((u) => ({ieee: u.ieee, name: rt.host.friendlyName(u.ieee), model: u.model, quiet_min: u.quietMin, ...(u.rebootMin === undefined ? {} : {reboot_min: u.rebootMin})}));
        return {
            base: this.baseTopic(),
            at: new Date().toISOString(),
            build: this.build(),
            contract: CONTRACT,
            problems: problemsOf({
                radio: this.radio,
                interviewHook: this.hooks.interview,
                pingHook: this.hooks.ping,
                runtimeApi: RUNTIME_API,
                converterApi: this.converter()?.api,
                traffic: rt.traffic.problems(),
                unreachable: unreachable.length,
            }),
            totals: {...rt.link.totals(), route_refreshes: rt.link.summary().route_refreshes ?? 0, led_queue: rt.tx.stats().queued},
            traffic: {frame_check: rt.traffic.armed() ? "armed" : "off", last_frame_s: rt.traffic.lastFrameSeconds()},
            unreachable,
        };
    }

    /** Retained, so a deploy or Home Assistant reads it without waiting for the next one. */
    private publishStatus(): void {
        const status = this.currentStatus();
        if (!status) return;
        void Promise.resolve(this.mqtt.publish(`status/${status.base}`, JSON.stringify(status), {baseTopic: SHARED_TOPIC, clientOptions: {retain: true}})).catch(
            (error: unknown) => this.log.debug(`Control4: status publish failed: ${error}`),
        );
    }

    /** The status entities on this instance's Zigbee2MQTT Bridge device, when Home Assistant discovery is on. */
    private publishDiscovery(): void {
        const ha = this.settings?.get?.()?.homeassistant;
        const coordinatorIeee = this.controller?.getDevicesByType?.("Coordinator")?.[0]?.ieeeAddr;
        if (ha?.enabled !== true || !coordinatorIeee) return;
        const prefix = ha.discovery_topic ?? "homeassistant";
        for (const [topic, config] of discoveryConfigs({base: this.baseTopic(), statusTopic: this.statusTopic(), coordinatorIeee, build: this.build()})) {
            void Promise.resolve(this.mqtt.publish(topic, JSON.stringify(config), {baseTopic: prefix, clientOptions: {retain: true, qos: 1}})).catch((error: unknown) =>
                this.log.debug(`Control4: discovery publish failed: ${error}`),
            );
        }
    }

    // -- bridge requests ----------------------------------------------------------

    private baseTopic(): string {
        return this.settings?.get?.()?.mqtt?.base_topic ?? "zigbee2mqtt";
    }

    private async onMqtt(data: Any): Promise<void> {
        if (typeof data?.topic !== "string") return;
        const base = this.baseTopic();
        const prefix = `${base}/bridge/request/control4/`;
        if (data.topic.startsWith(prefix)) {
            await this.handleRequest(data.topic.slice(prefix.length), data.message, false);
            return;
        }
        if (!data.topic.startsWith(`${SHARED_TOPIC}/`)) return;
        const rest = data.topic.slice(SHARED_TOPIC.length + 1);
        const handoff = /^handoff\/(0x[0-9a-fA-F]{16})\/(request|offer|ack|done)$/.exec(rest);
        if (handoff) {
            let body: unknown;
            try {
                body = JSON.parse(String(data.message ?? ""));
            } catch {
                return;
            }
            this.handoff?.onMessage(handoff[1], handoff[2] as HandoffStep, body);
            return;
        }
        const set = /^(0x[0-9a-fA-F]{16})\/set(\/[^/]+)?$/.exec(rest);
        if (set) {
            // Only the instance that has the device serves it: hand it to Zigbee2MQTT as its own /set.
            const ieee = set[1].toLowerCase();
            if (!this.isLocal(ieee)) return;
            this.eventBus.emitMQTTMessage({topic: `${base}/${ieee}/set${set[2] ?? ""}`, message: data.message ?? ""});
            return;
        }
        const req = /^request\/(\w+)$/.exec(rest);
        if (req) await this.handleRequest(req[1], data.message, true);
    }

    /** A device this instance has (by IEEE or friendly name). */
    private isLocal(ref: unknown): boolean {
        const ieee = this.resolveIeee(ref);
        return !!ieee && !!this.zhDevice(ieee);
    }

    private async handleRequest(action: string, raw: unknown, shared: boolean): Promise<void> {
        let message: Any = {};
        try {
            message = typeof raw === "string" && raw ? JSON.parse(raw) : {};
        } catch {
            message = {};
        }
        message = message && typeof message === "object" ? message : {};
        if (shared && (message.devices !== undefined || message.device !== undefined)) {
            // Act on this instance's share only; stay silent when none of it is ours.
            const refs: unknown[] = message.devices === undefined ? [message.device] : Array.isArray(message.devices) ? message.devices : [message.devices];
            const mine = refs.filter((r) => this.isLocal(r));
            if (mine.length === 0) return;
            if (message.devices !== undefined) message = {...message, devices: mine};
        }
        const transaction = message.transaction;
        const respond = (body: Any) => {
            const payload = JSON.stringify({...body, ...(shared ? {base: this.baseTopic()} : {}), ...(transaction !== undefined ? {transaction} : {})});
            return shared
                ? this.mqtt.publish(`response/${action}`, payload, {baseTopic: SHARED_TOPIC})
                : this.mqtt.publish(`bridge/response/control4/${action}`, payload);
        };
        try {
            const result = await this.bridgeRequest(action, message);
            await respond({status: "ok", data: result ?? {}});
        } catch (error) {
            this.log.error(`Control4: request '${action}' failed: ${(error as Error).message}`);
            await respond({status: "error", data: {}, error: (error as Error).message});
        }
    }

    private resolveIeee(ref: unknown): string | undefined {
        if (typeof ref !== "string") return undefined;
        if (/^0x[0-9a-f]{16}$/i.test(ref)) return ref.toLowerCase();
        const ent = this.zigbee.resolveEntity(ref);
        return ent?.ieeeAddr?.toLowerCase();
    }

    async bridgeRequest(action: string, msg: Any): Promise<Any> {
        const rt = this.runtime;
        if (!rt) throw new Error("Control4 runtime is not running");
        const refs: unknown[] = msg.devices === undefined ? (msg.device === undefined ? [] : [msg.device]) : Array.isArray(msg.devices) ? msg.devices : [msg.devices];
        // No `devices` / `device` at all = every keypad; an explicit empty list = none.
        const everyone = msg.devices === undefined && msg.device === undefined;
        const animators = () => {
            if (everyone) return rt.anim.all();
            return refs.map((r) => {
                const ieee = this.resolveIeee(r);
                const a = ieee ? rt.anim.get(ieee) : undefined;
                if (!a) throw new Error(`'${r}' is not a Control4 keypad / dimmer with LEDs`);
                return a;
            });
        };
        switch (action) {
            case "led_effect":
                for (const a of animators()) await ledEffect(a, msg);
                return undefined;
            case "led_status":
                for (const a of animators()) await ledStatus(a, msg);
                return undefined;
            case "led_stop":
                for (const a of animators()) await a.stop(msg.restore === undefined ? true : Boolean(msg.restore));
                return undefined;
            case "led_refresh":
                for (const a of animators()) await a.refresh();
                return {tx: rt.tx.stats()};
            case "set_model": {
                const ieee = this.resolveIeee(msg.device);
                if (!ieee) throw new Error(`unknown device '${msg.device}'`);
                return {model: rt.seedModel(ieee, String(msg.model ?? ""))};
            }
            case "stats":
                return {
                    tx: rt.tx.stats(),
                    link: rt.link.summary(),
                    devices: [...rt.devices.values()].map((d) => ({ieee: d.ieee, name: d.name, model: d.model, family: d.family, ...rt.link.health(d.ieee)})),
                    animators: rt.anim.all().map((a) => a.state()),
                };
            case "republish":
                return {devices: this.republish()};
        }
        throw new Error(`unknown action '${action}'`);
    }
}