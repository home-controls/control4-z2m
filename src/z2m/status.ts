/**
 * The instance status: one retained message per instance on
 * control4/status/<base>, at start and every minute, and the Home Assistant
 * entities that show it on that instance's own "Zigbee2MQTT Bridge" device.
 *
 * A deploy reads `build` to prove a push loaded; Home Assistant compares
 * `contract` with its own pieces; `problems` names each silent way of being
 * half-installed.
 */

/** How often each instance publishes its status. */
export const STATUS_INTERVAL = 60_000;
/** Seconds after the last status before Home Assistant marks the entities unavailable. */
export const STATUS_EXPIRE_AFTER = 180;

export type Problem =
    /** No Ember adapter: the extension cannot hear or send Control4 frames. */
    | "no_radio"
    /** herdsman's interviewQuirks hook is not installed. */
    | "interview_hook"
    /** herdsman's ping hook is not installed. */
    | "ping_hook"
    /** The converter bundle never registered. */
    | "converter_missing"
    /** The converter bundle calls another runtime API than this extension serves. */
    | "converter_api"
    /** No Control4 frame through the receive hook for 30 min, with a router keepalive hears from (traffic.ts). */
    | "no_frames"
    /** 5 sends in a row got no messageSent from herdsman (traffic.ts). */
    | "sends_failing"
    /** A router has not answered KEEPALIVE_WARN_AFTER keepalives in a row (link.ts): what is sent to it is lost. */
    | "devices_unreachable";

/** A device keepalive cannot reach. */
export interface UnreachableDevice {
    ieee: string;
    /** Its friendly name. */
    name: string;
    model: string;
    /** Minutes since it last sent anything direct (counted from the start, if it hasn't since). */
    quiet_min: number;
    /** Minutes since the extension last rebooted it (a DIM1-Z), while it has stayed unreachable; absent if it hasn't. */
    reboot_min?: number;
}

export interface StatusInputs {
    radio: boolean;
    interviewHook: boolean;
    pingHook: boolean;
    /** The runtime API this extension serves, and the one the loaded converter calls (if any). */
    runtimeApi: number;
    converterApi: number | undefined;
    /** The traffic alarms raised now. */
    traffic?: ("no_frames" | "sends_failing")[];
    /** How many devices keepalive cannot reach. */
    unreachable?: number;
}

export interface InstanceStatus {
    base: string;
    at: string;
    /** The release version of the files this instance loaded (package.json's; "dev" from source). */
    version: string;
    /** The build of the two files this instance loaded; null while either is unknown. */
    build: string | null;
    contract: number;
    problems: Problem[];
    totals: {sent: number; failed: number; route_refreshes: number; led_queue: number};
    /** Whether no_frames is watched here ("off": no router keepalive hears from), and seconds since the last Control4 frame. */
    traffic: {frame_check: "armed" | "off"; last_frame_s: number | null};
    /** The devices keepalive cannot reach, quietest first (devices_unreachable while there are any). */
    unreachable: UnreachableDevice[];
}

export function problemsOf(s: StatusInputs): Problem[] {
    const out: Problem[] = [];
    if (!s.radio) out.push("no_radio");
    if (!s.interviewHook) out.push("interview_hook");
    if (!s.pingHook) out.push("ping_hook");
    if (s.converterApi === undefined) out.push("converter_missing");
    else if (s.converterApi !== s.runtimeApi) out.push("converter_api");
    out.push(...(s.traffic ?? []));
    if (s.unreachable) out.push("devices_unreachable");
    return out;
}

interface Entity {
    component: "binary_sensor" | "sensor";
    key: string;
    name: string;
    config: Record<string, unknown>;
}

const ENTITIES: Entity[] = [
    {
        component: "binary_sensor",
        key: "problem",
        name: "Control4 problem",
        config: {
            device_class: "problem",
            value_template: "{{ 'ON' if value_json.problems | length > 0 else 'OFF' }}",
            json_attributes_template: "{{ {'problems': value_json.problems} | tojson }}",
        },
    },
    {component: "sensor", key: "build", name: "Control4 build", config: {value_template: "{{ value_json.build or 'unknown' }}", icon: "mdi:source-commit"}},
    {component: "sensor", key: "contract", name: "Control4 contract", config: {value_template: "{{ value_json.contract }}", icon: "mdi:handshake-outline"}},
    {
        component: "sensor",
        key: "sent",
        name: "Control4 messages sent",
        config: {value_template: "{{ value_json.totals.sent }}", state_class: "total_increasing", icon: "mdi:upload"},
    },
    {
        component: "sensor",
        key: "failed",
        name: "Control4 failed sends",
        config: {value_template: "{{ value_json.totals.failed }}", state_class: "total_increasing", icon: "mdi:upload-off"},
    },
    {
        component: "sensor",
        key: "route_refreshes",
        name: "Control4 route refreshes",
        config: {value_template: "{{ value_json.totals.route_refreshes }}", state_class: "total_increasing", icon: "mdi:routes"},
    },
    {
        component: "sensor",
        key: "led_queue",
        name: "Control4 LED queue",
        config: {value_template: "{{ value_json.totals.led_queue }}", state_class: "measurement", icon: "mdi:tray-full"},
    },
];

/**
 * Home Assistant discovery for the status entities: [topic under the discovery prefix, config].
 *
 * The first availability topic is the status topic itself, never one under the
 * base topic: Zigbee2MQTT clears, at start, every config on its discovery topic
 * whose first availability topic is under its base topic and which it did not
 * publish itself (lib/extension/homeassistant.ts, onMQTTMessage, in 2.14.2).
 */
export function discoveryConfigs(o: {
    base: string;
    statusTopic: string;
    coordinatorIeee: string;
    build: string | null;
    version: string;
}): [string, Record<string, unknown>][] {
    return ENTITIES.map((e) => [
        `${e.component}/control4_${o.coordinatorIeee}/${e.key}/config`,
        {
            name: e.name,
            unique_id: `control4_z2m_${o.coordinatorIeee}_${e.key}`,
            state_topic: o.statusTopic,
            ...e.config,
            entity_category: "diagnostic",
            expire_after: STATUS_EXPIRE_AFTER,
            availability: [
                {topic: o.statusTopic, value_template: "{{ 'online' }}"},
                {topic: `${o.base}/bridge/state`, value_template: "{{ value_json.state }}"},
            ],
            availability_mode: "all",
            // Only the identifier: Zigbee2MQTT's own discovery names and describes its bridge device.
            device: {identifiers: [`zigbee2mqtt_bridge_${o.coordinatorIeee}`]},
            origin: {name: "control4-z2m", sw: o.build ? `${o.version} (build ${o.build})` : o.version},
        },
    ]);
}
