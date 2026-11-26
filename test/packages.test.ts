import fs from "node:fs";
import path from "node:path";

import {describe, expect, it} from "vitest";
import {parseDocument} from "yaml";

import {FAMILIES} from "../src/z2m/definitions";
import {CONTRACT_FIELDS} from "./contract";

const DIR = path.resolve(__dirname, "..", "packages");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".yaml"));
const text = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

describe("packages", () => {
    it("are all present", () => {
        expect(files.sort()).toEqual([
            "control4_dimmer_scripts.yaml",
            "control4_event_dispatcher.yaml",
            "control4_instances.yaml",
            "control4_keypad_identify.yaml",
            "control4_keypad_led.yaml",
            "control4_led_scripts.yaml",
        ]);
    });

    it.each(files)("%s parses and has no ZHA device I/O left", (file) => {
        const doc = parseDocument(text(file), {uniqueKeys: true});
        expect(doc.errors.map((e) => e.message)).toEqual([]);
        // The instance checks' own event (control4_instance_notices) is no zha_event payload.
        const own = text(file).replaceAll("trigger.event.data.raised if trigger.id == 'notices'", "");
        for (const bad of ["zha_event", "zha.", "integration: zha", "zha_c4_patch", "trigger.event.data", "cluster_id", "endpoint_id"]) expect(own.includes(bad), `${file}: ${bad}`).toBe(false);
    });

    it("send only keys some family accepts", () => {
        const all = new Set(Object.values(FAMILIES).flatMap((f) => f?.keys ?? []));
        for (const k of ["send_raw", "send_get"]) all.add(k); // COMMON_KEYS
        let n = 0;
        for (const file of files) {
            for (const m of text(file).matchAll(/\{'(\w+)': c4_params\}/g)) {
                expect(all.has(m[1]), `${file}: ${m[1]}`).toBe(true);
                n++;
            }
        }
        expect(n).toBe(33);
    });

    it("the generated packages match their porter", async () => {
        const {port, COMMANDS} = await import("../tools/port-zha-packages.mjs");
        expect(COMMANDS[64579][0]).toBe("set_led_color");
        const zha = [
            "script:",
            "  t:",
            "    fields:",
            "      target_device:",
            "        selector:",
            "          device: {integration: zha, manufacturer: Control4}",
            "    variables:",
            `      ieee: "{{ (device_attr(target_device, 'identifiers') | list)[0][1] }}"`,
            "    sequence:",
            "      - service: zha.issue_zigbee_cluster_command",
            "        data:",
            `          ieee: "{{ ieee }}"`,
            "          endpoint_id: 4",
            "          cluster_id: 64580",
            "          cluster_type: in",
            "          command: 3",
            "          command_type: server",
            "          params:",
            "            on_time_ms: 1000",
            "            off_time_ms: 2000",
            "",
        ].join("\n");
        const out = port(zha, "t.yaml").text as string;
        const doc = parseDocument(out).toJS() as {script: {t: {sequence: Array<Record<string, unknown>>; fields: Record<string, unknown>}}};
        const seq = doc.script.t.sequence;
        expect(seq[1]).toEqual({variables: {c4_params: {on_time_ms: 1000, off_time_ms: 2000}}});
        expect(seq[2]).toEqual({action: "mqtt.publish", data: {topic: "control4/{{ ieee }}/set", payload: "{{ {'set_on_off_ramps': c4_params} | to_json }}"}});
        expect(Object.keys(doc.script.t.fields)).not.toContain("base_topic");
        expect(out).toContain("integration: mqtt");
        expect(out).toContain("zigbee2mqtt_0x");
    });

    describe("the event dispatcher", () => {
        type Step = Record<string, unknown>;
        const pkg = () => parseDocument(text("control4_event_dispatcher.yaml"), {uniqueKeys: true}).toJS() as {
            automation: {id: string; mode: string; triggers: Step[]; actions: Step[]}[];
            template: {trigger: Step[]; action?: Step[]; sensor: {unique_id: string; attributes: Record<string, string>}[]}[];
        };

        it("re-fires every control4/event message as control4_event, in arrival order", () => {
            const [auto] = pkg().automation;
            expect(auto.triggers).toEqual([{trigger: "mqtt", topic: "control4/event"}]);
            expect(auto.mode).toBe("queued");
            const fire = auto.actions.filter((a) => a.event === "control4_event");
            expect(fire.length).toBe(1);
        });

        it("forwards every contract field plus the HA device_id, and reads no other field", () => {
            const [auto] = pkg().automation;
            const fire = auto.actions.find((a) => a.event === "control4_event") as {event_data: Record<string, string>};
            expect(Object.keys(fire.event_data).sort()).toEqual([...CONTRACT_FIELDS, "device_id"].sort());
            const read = [...JSON.stringify(auto).matchAll(/\bevt(?:\.get\('(\w+)'|\.(\w+))/g)].map((m) => m[1] ?? m[2]);
            expect(read.length).toBeGreaterThan(0);
            for (const f of read) expect(CONTRACT_FIELDS, f).toContain(f);
        });

        it("drops an event whose IEEE has no HA device", () => {
            const [auto] = pkg().automation;
            const at = auto.actions.findIndex((a) => a.event === "control4_event");
            const guard = auto.actions.slice(0, at).find((a) => a.condition === "template") as {value_template: string} | undefined;
            expect(guard?.value_template).toBe("{{ device_id != '' }}");
        });

        it("rebuilds the map once for an IEEE it doesn't know, and waits for that rebuild before looking again", () => {
            const [tpl] = pkg().template;
            expect(tpl.trigger).toContainEqual({trigger: "event", event_type: "control4_device_map_refresh"});
            const [auto] = pkg().automation;
            const miss = auto.actions.find((a) => typeof a.if === "string" && (a.if as string).includes("not in")) as {if: string; then: Step[]} | undefined;
            expect(miss?.if).toBe("{{ ieee not in (state_attr('sensor.control4_device_map', 'devices') or {}) }}");
            expect(miss?.then[0]).toEqual({event: "control4_device_map_refresh"});
            expect(miss?.then[1]).toMatchObject({wait_for_trigger: [{trigger: "state", entity_id: "sensor.control4_device_map", attribute: "built"}]});
            const lookup = auto.actions.indexOf(miss as Step) + 1;
            expect(JSON.stringify(auto.actions[lookup])).toContain("state_attr('sensor.control4_device_map', 'devices')");
        });

        it("keeps the IEEE -> device map in a sensor rebuilt at HA start and on device registry changes", () => {
            const [tpl] = pkg().template;
            const on = tpl.trigger.map((t) => `${t.trigger}:${t.event ?? t.event_type}`);
            expect(on).toContain("homeassistant:start");
            expect(on).toContain("event:device_registry_updated");
            expect(Object.keys(tpl.sensor[0].attributes)).toContain("devices");
            const [auto] = pkg().automation;
            expect(JSON.stringify(auto.actions)).toContain("state_attr('sensor.control4_device_map', 'devices')");
        });
    });

    // #33: one persistent notification per instance while it reports a problem or has gone quiet.
    describe("the instance checks", () => {
        type Step = Record<string, unknown>;
        const pkg = () => parseDocument(text("control4_instances.yaml"), {uniqueKeys: true}).toJS() as {
            automation: {id: string; mode: string; triggers: Step[]; actions: Step[]}[];
            template: {trigger: Step[]; action: Step[]; sensor: {unique_id: string; state: string; attributes: Record<string, string>}[]}[];
        };
        const [auto] = pkg().automation;
        const flat = (x: unknown) => JSON.stringify(x);
        const vars = () => auto.actions[0].variables as Record<string, unknown>;
        const loop = (forEach: string) => (auto.actions.find((a) => flat(a).includes(`for_each":"${forEach}"`)) as {repeat: {sequence: Step[]}}).repeat.sequence;

        it("keeps each instance's latest status in a sensor fed by the retained control4/status/+", () => {
            const [tpl] = pkg().template;
            expect(tpl.trigger).toEqual([
                {trigger: "mqtt", topic: "control4/status/+", id: "status"},
                {trigger: "event", event_type: "control4_instance_notices", id: "notices"},
            ]);
            expect(tpl.sensor).toEqual([expect.objectContaining({unique_id: "control4_z2m_instances", state: "{{ instances | count }}"})]);
            expect(Object.keys(tpl.sensor[0].attributes)).toEqual(["instances", "problems", "raised"]);
            // A payload that isn't a status (an empty retained message) forgets that instance.
            expect(flat(tpl.action)).toContain("trigger.payload_json is defined and trigger.payload_json is mapping");
            expect(flat(tpl.action)).toContain("if b != base");
        });

        // It ran every minute and on every status (~1,900 runs and ~2,000 dismisses a day on one house).
        it("checks every 5 minutes, and at once only when an instance's problems change or an instance comes or goes", () => {
            expect(auto.triggers).toEqual([
                {trigger: "state", entity_id: "sensor.control4_instances", attribute: "problems", id: "status"},
                {trigger: "time_pattern", minutes: "/5", id: "tick"},
            ]);
            // `problems` holds each instance's codes alone, not the `at` every status moves.
            expect(pkg().template[0].sensor[0].attributes.problems).not.toContain(".at");
            expect(auto.mode).toBe("queued");
            // The YAML itself, not its header comment.
            expect(flat(pkg())).not.toMatch(/control4_event\b|control4_device_map|c4_device/);
        });

        it("raises control4_instance_<base> while the instance reports a problem or its status is more than 5 minutes old", () => {
            expect(vars().stale_after).toBe(300);
            expect(flat(vars().due)).toContain("(now() - at).total_seconds() > stale_after");
            expect(flat(vars().due)).toContain("s.problems | count > 0");
            expect(loop("{{ due }}")).toContainEqual(expect.objectContaining({action: "persistent_notification.create", data: expect.objectContaining({notification_id: "control4_instance_{{ base }}"})}));
        });

        // After every restart of the house's box the broker handed over a status from before it, and this said "stopped reporting".
        it("calls no status a silence for the first 5 minutes after Home Assistant starts", () => {
            expect(flat(vars().up)).toContain("as_datetime(this.last_changed, none)");
            expect(vars().starting).toBe("{{ up < stale_after }}");
            expect(flat(vars().due)).toContain("set stale = not starting and");
            // A reported problem is no restart artefact: it is raised at once.
            expect(flat(vars().due)).toMatch(/if stale or \(s\.problems/);
        });

        it("dismisses only a notice it raised, a forgotten instance's included, and tracks them in the sensor", () => {
            expect(loop("{{ raised | reject('in', due) | list }}")).toEqual([{action: "persistent_notification.dismiss", data: {notification_id: "control4_instance_{{ repeat.item }}"}}]);
            expect(vars().raised).toBe("{{ tracked if tracked is list else instances | list }}");
            const report = auto.actions.at(-1) as {if: string; then: Step[]};
            expect(report.if).toBe("{{ tracked is not list or (tracked | sort) != (due | sort) }}");
            expect(report.then).toEqual([{event: "control4_instance_notices", event_data: {raised: "{{ due }}"}}]);
            expect(flat(pkg().template[0].action)).toContain("trigger.event.data.raised if trigger.id == 'notices'");
        });

        // Guest Bed and Garage Inside Lights were dead for hours, and the user found them by hand.
        it("names, under devices_unreachable, the devices the instance's status lists as unreachable", () => {
            expect(flat(pkg().template[0].action)).toContain("'unreachable': unreachable | map(attribute='name') | list");
            const [step, create] = loop("{{ due }}") as [{variables: Record<string, string>}, {data: {message: string}}];
            expect(step.variables.unreachable).toBe("{{ instances[base].unreachable if instances[base].unreachable is list else [] }}");
            expect(create.data.message).toContain("{%- if p == 'devices_unreachable' %}{% for name in unreachable %}\n  - {{ name }}\n{%- endfor %}{% endif %}");
        });

        // On 2026-11-04 the first real notice failed: `at` (a datetime) reached `age` as a string,
        // and `now() - at` raised a TypeError before persistent_notification.create.
        it("works out each notice's age from the status time in one template", () => {
            const [step] = loop("{{ due }}") as [{variables: Record<string, string>}];
            expect(Object.keys(step.variables)).not.toContain("at");
            expect(step.variables.age).toBe("{% set at = as_datetime(last, none) if last else none %}{{ (now() - at).total_seconds() | int if at else none }}");
        });

        it("explains every problem the extension can report", () => {
            const status = fs.readFileSync(path.resolve(__dirname, "..", "src", "z2m", "status.ts"), "utf8");
            const block = /export type Problem =([\s\S]*?);/.exec(status)?.[1] ?? "";
            const codes = [...block.matchAll(/\|\s*"(\w+)"/g)].map((m) => m[1]);
            expect(codes).toContain("no_frames");
            for (const code of codes) expect(text("control4_instances.yaml"), code).toContain(`'${code}':`);
        });
    });
});
