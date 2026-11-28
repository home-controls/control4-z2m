import fs from "node:fs";
import path from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parseDocument, type Scalar} from "yaml";

import {DEFAULT_TAP_WINDOW_MS, GESTURES, MAX_TAP_WINDOW_MS, MIN_TAP_WINDOW_MS, MODELS, modelInfo, TAP_WINDOW_OPTION} from "../src/core/constants";
import {buildDefinitions} from "../src/z2m/definitions";
import {commandOf, eventEntityConfig, eventTypeOf} from "../src/z2m/extension";
import {EVENTS_NOTE, FILES, port, remoteEventType, ZHA_DIR} from "../tools/port-zha-blueprints.mjs";
import {renderTemplate} from "./c4-device";
import {inputTag, kindOf, substitute} from "./c4-device/blueprint";
import {conditionPasses, type HaState, type HaWorld, haEnvironment, renderValue, renderVariables} from "./c4-device/engine";
import {CONTRACT_EVENTS, CONTRACT_FIELDS} from "./contract";
import {Rig, tick} from "./rig";

const DIR = path.resolve(__dirname, "..", "blueprints");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".yaml"));

function load(file: string) {
    const doc = parseDocument(fs.readFileSync(path.join(DIR, file), "utf8"), {customTags: [inputTag as never], uniqueKeys: true});
    expect(
        doc.errors.map((e) => e.message),
        file,
    ).toEqual([]);
    return doc.toJS() as Record<string, unknown>;
}

function declaredInputs(node: unknown, out = new Set<string>()): Set<string> {
    if (!node || typeof node !== "object") return out;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (v && typeof v === "object" && "input" in (v as object) && !("selector" in (v as object))) declaredInputs((v as {input: unknown}).input, out);
        else out.add(k);
    }
    return out;
}

/** Each declared input's default; an input with none is left out. */
function inputDefaults(node: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
    if (!node || typeof node !== "object") return out;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (v && typeof v === "object" && "input" in (v as object) && !("selector" in (v as object))) inputDefaults((v as {input: unknown}).input, out);
        else if (v && typeof v === "object" && "default" in (v as object)) out[k] = (v as {default: unknown}).default;
    }
    return out;
}

function usedInputs(node: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(node)) for (const x of node) usedInputs(x, out);
    else if (node && typeof node === "object") {
        if ("__input" in (node as object)) out.add((node as {__input: string}).__input);
        else for (const x of Object.values(node as object)) usedInputs(x, out);
    }
    return out;
}

describe("blueprints", () => {
    it("are all present", () => {
        expect(files.sort()).toEqual(
            [
                "c4_device.yaml",
                "c4_kp_led_notify.yaml",
                "c4_sr250_color_menus.yaml",
                "c4_sr250_media_player.yaml",
                "c4_sr250_menu.yaml",
                "c4_sr250_now_playing.yaml",
                "c4_sr250_room_display.yaml",
                "c4_sr260_media_player.yaml",
                "c4_sr260_menu_dispatcher.yaml",
                "c4_sr260_screen.yaml",
            ].sort(),
        );
    });

    it.each(files)("%s parses and uses only declared inputs", (file) => {
        const bp = load(file);
        const meta = bp.blueprint as {domain: string; input: unknown; name: string};
        expect(meta.domain).toBe("automation");
        expect(meta.name).toMatch(/Zigbee2MQTT/);
        const declared = declaredInputs(meta.input);
        const {blueprint: _b, ...body} = bp;
        for (const used of usedInputs(body)) expect(declared.has(used), `${file}: !input ${used} not declared`).toBe(true);
        expect(declared.has("base_topic")).toBe(false);
    });

    // #23 / #24: the ported blueprints are generated; a hand edit, or a changed original, shows here.
    it.each(FILES)("%s is what tools/port-zha-blueprints.mjs makes of its ZHA original in tools/zha-blueprints", (file) => {
        const original = fs.readFileSync(path.join(ZHA_DIR, file), "utf8");
        expect(port(original, file).text).toBe(fs.readFileSync(path.join(DIR, file), "utf8"));
    });

    it.each(files)("%s has no ZHA device I/O left", (file) => {
        const text = fs.readFileSync(path.join(DIR, file), "utf8");
        for (const bad of ["zha_event", "zha.", "integration: zha", "zha_c4_patch", "cluster_id", "endpoint_id"])
            expect(text.includes(bad), `${file}: ${bad}`).toBe(false);
        // Event data is read only from the dispatcher's control4_event, never from a ZHA event.
        if (/trigger\.event\.data/.test(text)) expect(text, `${file}: trigger.event.data without control4_event`).toMatch(/event_type: control4_event/);
    });

    it("read a trigger's kind from trigger:, as the automation editor writes it, or platform:, never both", () => {
        expect([kindOf({trigger: "state", entity_id: "light.a"}), kindOf({platform: "state", entity_id: "light.a"}), kindOf({event: "start"})]).toEqual([
            "state",
            "state",
            undefined,
        ]);
        expect(() => kindOf({platform: "state", trigger: "state"})).toThrow(/Home Assistant refuses a trigger with both platform: and trigger:/);
    });

    describe("c4_device", () => {
        type Trigger = Record<string, unknown>;
        const flat = (s: unknown) => String(s).replace(/\s+/g, " ").trim();
        const DEVICE = {__input: "c4_device"};
        const bp = () => load("c4_device.yaml") as {trigger: Trigger[]; action: unknown};
        const text = () => fs.readFileSync(path.join(DIR, "c4_device.yaml"), "utf8");
        /** Every wait_for_trigger entry anywhere in the actions. */
        function waits(node: unknown, out: Trigger[] = []): Trigger[] {
            if (Array.isArray(node)) for (const x of node) waits(x, out);
            else if (node && typeof node === "object") {
                for (const [k, v] of Object.entries(node)) {
                    if (k === "wait_for_trigger") out.push(...(v as Trigger[]));
                    else waits(v, out);
                }
            }
            return out;
        }

        /** The ZHA command a wait waits for: its payload's last part (`{{ evt.button }}|<command>`). */
        const awaited = (w: Trigger) => String(w.payload).split("|").at(-1) as string;
        const tidMap = () => [...(load("c4_device.yaml").variables as Record<string, string>).tid.matchAll(/'(\w+)': '(\w+)'/g)].map((m) => [m[1], m[2]]);

        it("offers in its picker only the Control4 wall devices whose buttons it drives", () => {
            const input = (
                load("c4_device.yaml").blueprint as {input: {device_section: {input: {c4_device: {selector: {device: {filter: Record<string, string>[]}}}}}}}
            ).input;
            const filters = input.device_section.input.c4_device.selector.device.filter;
            for (const f of filters) expect(f).toMatchObject({integration: "mqtt", manufacturer: "Control4"});
            const models = filters.map((f) => f.model_id);
            expect(models.sort()).toEqual([
                "C4-4SF120",
                "C4-APD120",
                "C4-DIM1-Z",
                "C4-FS1-Z",
                "C4-KC120277",
                "C4-KP3-Z",
                "C4-KP6-Z",
                "C4-SW120277",
                "LOZ-5S1-W",
            ]);
            // Each is the model Zigbee2MQTT gives the device (its definition's model), so it matches model_id.
            for (const m of models)
                expect(
                    MODELS.map((x) => x.model),
                    m,
                ).toContain(m);
        });

        it("names in its description every model its picker offers", () => {
            const bpMeta = load("c4_device.yaml").blueprint as {
                description: string;
                input: {device_section: {input: {c4_device: {selector: {device: {filter: {model_id: string}[]}}}}}};
            };
            const intro = bpMeta.description.slice(0, bpMeta.description.indexOf("REQUIRED:")).replace(/\s+/g, " ");
            for (const f of bpMeta.input.device_section.input.c4_device.selector.device.filter) expect(intro, f.model_id).toContain(f.model_id);
        });

        it("hears its own device's Control4 events entity (ADR 0005), never the shared control4/event topic", () => {
            const events = bp().trigger.filter((t) => t.id === "event");
            expect(events).toEqual([{trigger: "event.received", target: {device_id: DEVICE}, options: {event_type: expect.any(Array)}, id: "event"}]);
            // Every command a run can start on; a tap release is only waited for.
            const types = (events[0].options as {event_type: string[]}).event_type;
            expect([...types].sort()).toEqual(
                tidMap()
                    .map(([c]) => c)
                    .filter((c) => c !== GESTURES.release)
                    .sort(),
            );
            expect(bp().trigger.filter((t) => t.platform === "mqtt")).toEqual([]);
            expect(text()).not.toContain("control4/event");
            expect(text()).not.toContain("control4_event");
        });

        it("starts only on event types the extension declares for the devices its picker offers", () => {
            const types = ((bp().trigger.find((t) => t.id === "event") as Trigger).options as {event_type: string[]}).event_type;
            const defs = buildDefinitions();
            const picker = (
                load("c4_device.yaml").blueprint as {input: {device_section: {input: {c4_device: {selector: {device: {filter: {model_id: string}[]}}}}}}}
            ).input;
            const all = new Set<string>();
            for (const {model_id: model} of picker.device_section.input.c4_device.selector.device.filter) {
                type Ex = {name: string; values: string[]}[];
                const def = defs.find((d: {model: string}) => d.model === model) as {exposes: Ex | ((d: unknown, o: unknown) => Ex)};
                const exposes = typeof def.exposes === "function" ? def.exposes({ieeeAddr: "0x000fff0000000001"}, {}) : def.exposes;
                const declared = eventEntityConfig("0x000fff0000000001", exposes.find((x) => x.name === "action")?.values ?? []).event_types as string[];
                for (const t of declared) all.add(t);
                // The command the boot check knows the entity by.
                expect(declared, model).toContain(GESTURES.single);
            }
            // A device with fewer gestures (a DIM1-Z or FS1-Z sends no release) declares fewer, and never sends the others.
            for (const t of types) expect([...all], t).toContain(t);
        });

        it("waits for its button events on its own device's topic", () => {
            const all = waits(bp().action);
            // hold: the hold event or the tap release; ramp: the hold release; early commit: a tap
            // toward OFF waits for its counts or a hold (9), then for a fast count after the device's (5)
            expect(all.length).toBe(3 + 9 + 5);
            for (const w of all) expect(w).toMatchObject({platform: "mqtt", topic: "control4/{{ ieee }}/event"});
        });

        it("needs the extension, not the dispatcher package", () => {
            const desc = (load("c4_device.yaml").blueprint as {description: string}).description;
            expect(desc).toMatch(/REQUIRED: the control4-z2m extension on every Zigbee2MQTT instance/);
            expect(desc).toContain('"Control4 events" entity');
            expect(desc).not.toMatch(/dispatcher|control4_event/);
        });

        // The re-check was every 5 minutes: 26 devices made ~7,500 runs a day on one house. At
        // every 30 minutes it was still ~1,700 of the ~2,900 c4_device runs a day on 35 devices,
        // and the only retry of a lost status frame; the extension now retries those itself.
        it("re-checks its LEDs hourly by default, or every 30 minutes", () => {
            expect(bp().trigger).toContainEqual({platform: "time_pattern", minutes: {__input: "led_resync"}, id: "led"});
            const leds = (
                load("c4_device.yaml").blueprint as {
                    input: {led_section: {input: Record<string, {default: unknown; selector: {select: {options: {value: string}[]}}}>}};
                }
            ).input.led_section.input;
            expect(leds.led_resync.default).toBe("0");
            // "/30" stays: an automation saved with it keeps working.
            expect(leds.led_resync.selector.select.options.map((o) => o.value)).toEqual(["0", "/30"]);
        });

        it("says so, at Home Assistant start and on reload, when its device has no Control4 events entity", () => {
            expect(bp().trigger).toContainEqual({platform: "event", event_type: "automation_reloaded", id: "reload"});
            expect(bp().trigger).toContainEqual({platform: "homeassistant", event: "start", id: "boot"});
            const led = ((bp().action as Record<string, unknown>[])[0].choose as {conditions: string; sequence: Record<string, unknown>[]}[])[1];
            // After the settle delay: 90 s after a start, by when discovery has landed.
            expect(Object.keys(led.sequence[0])).toEqual(["delay"]);
            const check = led.sequence[1] as {if: string; then: Record<string, unknown>[]};
            expect(check.if).toBe("{{ tid in ['boot', 'reload'] }}");
            const vars = (check.then[0] as {variables: {note_id: string; hears: string}}).variables;
            expect(vars.note_id).toBe("c4_device_no_events_{{ ieee }}");
            const tell = check.then[1] as {
                if: string;
                then: {action: string; data: Record<string, string>}[];
                else: {action: string; data: Record<string, string>}[];
            };
            expect(tell.if).toBe("{{ hears }}");
            expect(tell.then[0]).toEqual({action: "persistent_notification.dismiss", data: {notification_id: "{{ note_id }}"}});
            expect(tell.else[0]).toMatchObject({action: "persistent_notification.create", data: {notification_id: "{{ note_id }}"}});
            // An FS1-Z, fan or outlet skips the LED branch, so it runs the same check on its own.
            const bar = ((bp().action as Record<string, unknown>[])[0].choose as {conditions: string; sequence: Record<string, unknown>[]}[]).at(-1) as {
                conditions: string;
                sequence: Record<string, unknown>[];
            };
            expect(bar.conditions).toBe("{{ tid in ['boot', 'reload'] and ieee != '' and not paints_leds }}");
            expect(Object.keys(bar.sequence[0])).toEqual(["delay"]);
            expect(bar.sequence.slice(1)).toEqual(check.then);
        });

        it("reads only the payload fields in the contract fixture", () => {
            const contract = new Set(CONTRACT_FIELDS);
            expect(text()).not.toContain("trigger.event.data");
            const read = [...text().matchAll(/\bevt(?:\.get\('(\w+)'|\.(\w+))|wait\.trigger\.payload_json\.(\w+)|value_json\.(\w+)/g)].map(
                (m) => m[1] ?? m[2] ?? m[3] ?? m[4],
            );
            expect(read).toContain("command");
            expect(read).toContain("button");
            for (const f of read) expect(contract.has(f), f).toBe(true);
        });

        it("waits for no hold event on a DIM1-Z or FS1-Z, whose hold event itself starts its hold run", () => {
            expect(text()).toContain(`timeout: "{{ 0 if hold_on_event else 0.9 }}"`);
            expect((load("c4_device.yaml").variables as Record<string, string>).hold_on_event).toBe("{{ model in ['C4-DIM1-Z', 'C4-FS1-Z'] }}");
        });

        it("ramps an FS1-Z's hold by its half: Button 1 (the top) brightens, Button 2 dims, whatever the lights' level", () => {
            const isPaddle = (load("c4_device.yaml").variables as Record<string, string>).is_paddle;
            const dirTemplate = /\n\s+dir: >-\n\s+(\{\{[\s\S]*?\}\})/.exec(text())?.[1] as string;
            expect(dirTemplate).toBeDefined();
            const paddle = renderTemplate(isPaddle, {model: "C4-FS1-Z"}).toLowerCase() === "true";
            expect(paddle).toBe(true);
            const dir = (bi: number, base: number) => Number(renderTemplate(dirTemplate, {bi, base, is_paddle: paddle}));
            // A bright room still brightens on the top half; a dark one still dims on the bottom.
            expect([dir(0, 200), dir(0, 20), dir(1, 200), dir(1, 20)]).toEqual([1, 1, -1, -1]);
            // A keypad button instead goes the way that moves the lights furthest.
            const kp = renderTemplate(isPaddle, {model: "C4-KC120277"}).toLowerCase() === "true";
            expect([
                Number(renderTemplate(dirTemplate, {bi: 0, base: 200, is_paddle: kp})),
                Number(renderTemplate(dirTemplate, {bi: 0, base: 20, is_paddle: kp})),
            ]).toEqual([-1, 1]);
        });

        it("describes each paddle half's button behaviour for the installer", () => {
            const desc = flat((load("c4_device.yaml").blueprint as {description: string}).description);
            const paddles = desc.slice(desc.indexOf("PADDLES."), desc.indexOf("SCENE."));
            for (const s of [
                "top_button_behaviour, bottom_button_behaviour",
                "event_only drives nothing",
                "factory: top load_on, bottom load_off",
                "the SW120277 is a relay, so nothing ramps",
                "A half that drives its load gets no hold-to-dim here",
            ])
                expect(paddles).toContain(s);
            expect(desc).not.toContain("never paints it");
        });

        it("publishes to the device only from branches a model with no LEDs to paint never takes", () => {
            /** The conditions of every choose branch that publishes to the device. */
            const publishing: string[] = [];
            const walk = (node: unknown): void => {
                if (Array.isArray(node)) node.forEach(walk);
                else if (node && typeof node === "object") {
                    const o = node as Record<string, unknown>;
                    if ("conditions" in o && "sequence" in o && JSON.stringify(o.sequence).includes("set_topic")) publishing.push(flat(o.conditions));
                    Object.values(o).forEach(walk);
                }
            };
            walk(bp().action);
            expect(publishing.length).toBeGreaterThan(0);
            for (const c of publishing) expect(c).toMatch(/ and paints_leds \}\}$/);
        });

        it("ramps a paddle's targets up from its top half and down from its bottom half", () => {
            expect(flat(text())).toContain("dir: >- {{ (1 if bi == 0 else -1) if is_paddle else (-1 if base | int(0) > 127 else 1) }}");
        });

        it("understands every command in the contract fixture, as a trigger id or in a hold's wait", () => {
            const known = new Set([...tidMap().map(([c]) => c), ...waits(bp().action).map(awaited)]);
            for (const e of CONTRACT_EVENTS) expect(known.has(e.command as string), e.command as string).toBe(true);
        });

        // Early commit (ADR 0002): under Auto, a button with multi-tap actions runs its single tap at
        // once when the tap is toward ON; a tap toward OFF waits for the sequence's count.
        describe("early commit", () => {
            type Step = Record<string, unknown>;
            const flat = (s: unknown) => String(s).replace(/\s+/g, " ").trim();
            /** The steps of the buttons' branch, the early-commit block first. */
            const buttonSteps = () => ((bp().action as Step[])[0].choose as {sequence: Step[]}[])[0].sequence;
            const earlyBlock = () => buttonSteps().find((s) => s.if === "{{ early }}") as {then: Step[]};
            const towardOn = () => flat((earlyBlock().then.find((s) => s.variables) as {variables: {toward_on: string}}).variables.toward_on);
            const towardOff = () => (earlyBlock().then.find((s) => s.if === "{{ not toward_on }}") as {then: Step[]}).then;
            const commands = (w: Step) => (w.wait_for_trigger as Trigger[]).map(awaited);
            const {fast_single, fast_double, fast_triple, fast_quadruple, single, double, triple, quadruple, hold} = GESTURES;
            const FAST = [fast_single, fast_double, fast_triple, fast_quadruple];
            const DEVICE_COUNT = [single, double, triple, quadruple];

            it("decides in its run before any branch: the custom tap actions and the mode logic both take it", () => {
                expect(buttonSteps()[0].if).toBe("{{ early }}");
                const branches = (buttonSteps()[1].choose as {conditions: string}[]).map((b) => b.conditions);
                expect(branches.filter((c) => c.includes("btn.action | count > 0"))).toHaveLength(6);
                for (const c of branches.filter((x) => /btn\.action \| count > 0|tgt \| count > 0/.test(x)))
                    expect(c).toMatch(/^\{\{ \(is_tap or early\) and /);
            });

            it("takes the Direction from the mode and the targets' state now; a Scene and a custom tap action are toward OFF", () => {
                const modes = (
                    bp() as unknown as {blueprint: {input: Record<string, {input: Record<string, {selector: {select: {options: {value: string}[]}}}>}>}}
                ).blueprint.input.b1_section.input.b1_mode.selector.select.options.map((o) => o.value);
                const lists = [...towardOn().matchAll(/btn\.mode in \[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
                expect(towardOn()).toMatch(/^\{\{ btn\.action \| count == 0 and \(/);
                // Always toward ON, then toward ON only while no target is on.
                expect(lists).toEqual([
                    ["on", "brighten"],
                    ["toggle", "room_master"],
                ]);
                expect(towardOn()).toContain(
                    "btn.mode in ['toggle', 'room_master'] and expand(tgt) | rejectattr('state', 'in', ['off', 'unavailable', 'unknown']) | list | count == 0",
                );
                // Every other mode is toward OFF.
                expect(modes.filter((m) => !lists.flat().includes(m)).sort()).toEqual(["dim", "off", "room_off", "scene"]);
            });

            it("waits a tap toward OFF for this button's fast count, or failing that its device count, and runs it only on a single", () => {
                const [first, , second, decide] = towardOff();
                for (const w of [first, second]) {
                    for (const t of w.wait_for_trigger as Trigger[]) {
                        expect(t).toEqual({
                            platform: "mqtt",
                            topic: "control4/{{ ieee }}/event",
                            value_template: "{{ value_json.button }}|{{ value_json.command }}",
                            payload: `{{ evt.button }}|${awaited(t)}`,
                        });
                    }
                }
                // A hold ends the sequence, like a count that isn't single.
                expect(commands(first)).toEqual([...FAST, ...DEVICE_COUNT, hold]);
                expect(first.timeout).toBeGreaterThan(2); // a backstop: the device count comes ~1.7 s after a tap at worst
                expect(commands(second)).toEqual([...FAST, hold]);
                // The device's count can beat the fast count on a wide tap window: the fast count may still come one window later.
                const later = /^\{\{ ([\d.]+) if first_count in \[(.*)\] else 0 \}\}$/.exec(second.timeout as string);
                expect(Number(later?.[1])).toBeGreaterThanOrEqual(MAX_TAP_WINDOW_MS / 1000);
                expect([...(later?.[2] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual(DEVICE_COUNT);
                expect(flat(decide.if)).toBe(
                    `{{ (wait.trigger.payload_json.command if wait.trigger is not none else first_count) not in ['${fast_single}', '${single}'] }}`,
                );
                expect(decide.then).toEqual([{stop: "Not a single tap"}]);
            });

            it("is described with known taps and the per-device tap window as the extension has them", () => {
                const desc = flat((load("c4_device.yaml").blueprint as {description: string}).description);
                const response = desc.slice(desc.indexOf("RESPONSE."), desc.indexOf("LEDS."));
                expect(response).toContain(
                    `option ${TAP_WINDOW_OPTION} (${MIN_TAP_WINDOW_MS / 1000}-${MAX_TAP_WINDOW_MS / 1000} s, default ${DEFAULT_TAP_WINDOW_MS / 1000} s)`,
                );
                for (const s of [
                    '(a "known" tap)',
                    "commits early",
                    "toward ON: On and Brighten, and Toggle and Room master while every target is off",
                    "toward OFF (Off, Dim and Room off, Toggle and Room master while any target is on, Scene, and every custom tap action)",
                    "Fast: the single tap on the fast count, never early",
                ]) {
                    expect(response).toContain(s);
                }
            });
        });

        // A light that several buttons list fires one trigger per list: one of them paints.
        describe("LED runs", () => {
            const doc = () => load("c4_device.yaml") as {trigger: Trigger[]; variables: Record<string, unknown>};

            it("lists every LED state trigger's id and entities in trigger order, from trigger.idx 1", () => {
                const {trigger, variables} = doc();
                const states = trigger.map((t, idx) => ({t, idx})).filter(({t}) => t.platform === "state" && ["led", "led_bri"].includes(t.id as string));
                expect(trigger[0].id).toBe("event");
                expect(states.map(({idx}) => idx)).toEqual(states.map((_, i) => i + 1));
                expect(variables.led_triggers).toEqual(states.map(({t}) => ({id: t.id, entities: t.entity_id})));
                // Every button's targets and watches, on and off and in brightness, and the room's lists.
                expect(states).toHaveLength(6 * 2 * 2 + 2);
            });
        });

        // #22: a button's LED found from its name, unless colour selects are picked.
        describe("LED by button name", () => {
            const doc = () => load("c4_device.yaml") as {blueprint: {input: Record<string, {input: Record<string, {name: string; default: unknown}>}>}};

            it("offers the colour selects as an optional override", () => {
                for (let n = 1; n <= 6; n++) {
                    const input = doc().blueprint.input[`b${n}_section`].input[`b${n}_led`];
                    expect(input.name).toBe("LED colour selects (optional)");
                    expect(input.default).toEqual([]);
                }
            });
        });

        // A Scene (ADR 0003): its levels are the Tap action's scene.apply, its lights the Targets.
        describe("scene", () => {
            type Step = Record<string, unknown>;
            const flat = (s: unknown) => String(s).replace(/\s+/g, " ").trim();
            const doc = () =>
                load("c4_device.yaml") as {
                    blueprint: {input: Record<string, {input: Record<string, {selector: {select: {options: {value: string}[]}}}>}>};
                    variables: Record<string, string>;
                    condition: string[];
                    action: Step[];
                };
            const branches = () =>
                ((doc().action[0].choose as {sequence: Step[]}[])[0].sequence[1] as {choose: {conditions: string; sequence: unknown}[]}).choose;
            /** The hold branch's steps once its paddle-down is known to be a hold. */
            const holdSteps = () => {
                const sequence = branches().find((b) => b.conditions === "{{ hold_candidate }}")?.sequence as Step[] | undefined;
                if (!sequence) throw new Error("c4_device has no hold_candidate branch");
                return (sequence[1] as {then: Step[]}).then;
            };

            it("is a Tap-does value on every button", () => {
                for (let n = 1; n <= 6; n++)
                    expect(doc().blueprint.input[`b${n}_section`].input[`b${n}_mode`].selector.select.options.map((o) => o.value)).toContain("scene");
            });

            it("taps through its Tap action only: the mode logic, Night Dim included, never runs for a Scene", () => {
                const all = branches().map((b) => b.conditions);
                const mode = all.findIndex((c) => c.includes("tgt | count > 0"));
                expect(all[mode]).toBe("{{ (is_tap or early) and tgt | count > 0 and btn.mode != 'scene' }}");
                // The Tap actions come first: choose runs the first that matches.
                expect(all.findIndex((c) => c.includes("btn.action | count > 0"))).toBeLessThan(mode);
            });

            it("has a brightness trigger on every button's targets, for its LED to follow its lights' levels", () => {
                const bri = (load("c4_device.yaml") as {trigger: Record<string, unknown>[]}).trigger.filter((t) => t.id === "led_bri");
                for (let n = 1; n <= 6; n++)
                    expect(bri).toContainEqual({platform: "state", entity_id: {__input: `b${n}_targets`}, attribute: "brightness", id: "led_bri"});
            });

            it("ramps a Scene's lit lights each from its own level on a hold, any other group from its brightest", () => {
                const start = flat((holdSteps().find((s) => s.variables) as {variables: {ramp_from: string}}).variables.ramp_from);
                expect(start).toContain(
                    "{% if btn.mode != 'scene' %} {% set ns.d = dict(ns.d, **{e: base | int(0)}) %} {% elif is_state(e, 'on') %} {% set ns.d = dict(ns.d, **{e: state_attr(e, 'brightness') | int(0)}) %} {% endif %}",
                );
                expect(holdSteps().find((s) => s.condition)).toEqual({condition: "{{ ramp_from | count > 0 and (dir | int > 0 or base | int(0) > 0) }}"});
            });

            it("is described for the installer", () => {
                const desc = flat((load("c4_device.yaml").blueprint as {description: string}).description);
                for (const s of [
                    "SCENE. A Scene button's Tap action is one scene.apply",
                    "within 2 points of its brightness",
                    'whatever "When an LED watches several entities" says',
                    "names other lights than Targets",
                    "Night Dim never changes it",
                ])
                    expect(desc).toContain(s);
            });
        });
    });

    // The remotes' blueprints hear their remote as c4_device hears its device (ADR 0005, #99).
    describe("remote blueprints", () => {
        type Trigger = Record<string, unknown>;
        // biome-ignore lint/suspicious/noExplicitAny: automation shapes
        type Any = any;
        /** The blueprints that hear a remote's events, and the input that picks the remote. */
        const HEARS: Record<string, string> = {
            "c4_sr250_menu.yaml": "remote",
            "c4_sr250_color_menus.yaml": "remote",
            "c4_sr250_media_player.yaml": "remote",
            "c4_sr260_media_player.yaml": "remote",
            "c4_sr260_menu_dispatcher.yaml": "sr260_device",
            "c4_sr260_screen.yaml": "remote",
        };
        const hearing = Object.entries(HEARS);
        const text = (file: string) => fs.readFileSync(path.join(DIR, file), "utf8");

        /** Every trigger a blueprint has: its own (unless an input gives them) and what its waits wait for. */
        function triggersOf(bp: Record<string, unknown>): Trigger[] {
            const out: Trigger[] = Array.isArray(bp.trigger) ? [...(bp.trigger as Trigger[])] : [];
            const walk = (node: unknown): void => {
                if (Array.isArray(node)) node.forEach(walk);
                else if (node && typeof node === "object") {
                    for (const [k, v] of Object.entries(node)) {
                        if (k === "wait_for_trigger") out.push(...(v as Trigger[]));
                        else walk(v);
                    }
                }
            };
            walk(bp.action);
            return out;
        }
        const received = (bp: Record<string, unknown>) => triggersOf(bp).filter((t) => kindOf(t) === "event.received");
        const typesOf = (t: Trigger) => (t.options as {event_type: string[]}).event_type;

        /** The values of a model's `action` expose. */
        function actionsOf(model: string): string[] {
            const def = buildDefinitions().find((d: {model: string}) => d.model === model) as Any;
            const exposes = typeof def.exposes === "function" ? def.exposes({ieeeAddr: "0x000fff0000000001", modelID: model}, {}) : def.exposes;
            return exposes.find((x: Any) => x.name === "action")?.values ?? [];
        }

        it("are every blueprint but c4_device that hears a Control4 events entity", () => {
            expect(files.filter((f) => f !== "c4_device.yaml" && received(load(f)).length > 0).sort()).toEqual(Object.keys(HEARS).sort());
        });

        it.each(hearing)("%s hears the remote it is set up with through its Control4 events entity, never the shared control4/event topic", (file, input) => {
            const bp = load(file);
            expect(received(bp).length).toBeGreaterThan(0);
            for (const t of received(bp)) {
                const {id, ...rest} = t;
                expect(rest).toEqual({trigger: "event.received", target: {device_id: {__input: input}}, options: {event_type: [expect.any(String)]}});
                expect(["undefined", "string"]).toContain(typeof id);
            }
            expect(triggersOf(bp).filter((t) => kindOf(t) === "mqtt")).toEqual([]);
            expect(text(file)).not.toContain("control4/event");
            // The trigger is the remote's own: no IEEE filter, no MQTT payload to read.
            expect(text(file)).not.toMatch(/payload_json|value_json|trigger\.platform/);
        });

        it.each(hearing)("%s listens only for event types the extension declares for every remote its picker offers", (file) => {
            const picker = (load(file).blueprint as {input: Record<string, {selector: {device: {filter: {model_id: string}[]}}}>}).input[HEARS[file]];
            const models = picker.selector.device.filter.map((f) => f.model_id);
            expect(models.length).toBeGreaterThan(0);
            for (const model of models) {
                const declared = eventEntityConfig("0x000fff0000000001", actionsOf(model), modelInfo(model)?.family).event_types as string[];
                for (const t of received(load(file))) for (const type of typesOf(t)) expect(declared, `${model}: ${type}`).toContain(type);
            }
        });

        it.each(hearing)("%s says in its description that it needs the remote's Control4 events entity", (file) => {
            const desc = String((load(file).blueprint as {description: string}).description).replace(/\s+/g, " ");
            expect(desc).toContain(EVENTS_NOTE.join(" "));
        });

        it("are ported with the extension's names for a remote's event types", () => {
            for (const model of ["C4-SR250B", "C4-SR260"]) {
                const family = modelInfo(model)?.family;
                for (const a of actionsOf(model))
                    expect(remoteEventType(commandOf(a, family)), `${model} ${a}`).toBe(eventTypeOf(commandOf(a, family), family));
            }
        });

        it("are ported from ZHA's zha_event triggers and waits to the remote's events entity", () => {
            const zha = [
                "blueprint:",
                "  name: Test",
                "  description: >",
                "    A test.",
                "  domain: automation",
                "  input:",
                "    remote:",
                "      selector:",
                "        device:",
                "          filter:",
                "            - integration: zha",
                "              model: C4-SR250B",
                "trigger:",
                "  - platform: event",
                "    event_type: zha_event",
                "    event_data:",
                "      device_id: !input remote",
                "      command: remote_button_short_press",
                "    id: press",
                "variables:",
                '  button: "{{ trigger.event.data.args.button }}"',
                "action:",
                "  - wait_for_trigger:",
                "      - platform: event",
                "        event_type: zha_event",
                "        id: select",
                "        event_data:",
                "          device_id: !input remote",
                "          command: menu_select",
                "  - variables:",
                '      item: "{{ wait.trigger.event.data.args.item }}"',
                "",
            ].join("\n");
            const {text: out, events} = port(zha, "test.yaml");
            expect(events).toBe(2);
            const doc = parseDocument(out, {customTags: [inputTag as never]}).toJS() as Any;
            const hears = (type: string, id: string) => ({
                trigger: "event.received",
                target: {device_id: {__input: "remote"}},
                options: {event_type: [type]},
                id,
            });
            expect(doc.trigger).toEqual([hears("remote_button_short_press", "press")]);
            expect(doc.action[0].wait_for_trigger).toEqual([hears("remote_menu_select", "select")]);
            expect(doc.variables).toEqual({button: "{{ (trigger.to_state.attributes if trigger.to_state is defined else {}).button }}"});
            expect(doc.action[1].variables.item).toBe("{{ wait.trigger.to_state.attributes.item }}");
            // Nothing here publishes to the remote, and the trigger is the remote's own: no IEEE.
            expect(out).not.toContain("c4_ieee");
            expect(doc).not.toHaveProperty("condition");
            expect(doc.blueprint.description.replace(/\s+/g, " ")).toContain(EVENTS_NOTE.join(" "));
            expect(doc.blueprint.input.remote.selector.device.filter).toEqual([{integration: "mqtt", model_id: "C4-SR250B"}]);
        });

        // What the remote sends, through the event types and attributes its Control4 events
        // entity gives a run, as far as the blueprints' own templates take it.
        describe("run on what the remote sends", () => {
            const R250 = "0x000fff00000000e1";
            const R260 = "0x000fff00000000e2";
            const DEVICE: Record<string, string> = {[R250]: "d_sr250", [R260]: "d_sr260"};
            const world: HaWorld = {
                devices: {
                    d_sr250: {identifiers: [["mqtt", `zigbee2mqtt_${R250}`]], model_id: "C4-SR250B", name: "Den remote", entities: []},
                    d_sr260: {identifiers: [["mqtt", `zigbee2mqtt_${R260}`]], model_id: "C4-SR260", name: "Bedroom remote", entities: []},
                },
                states: {},
                time: "12:00:00",
            };
            const env = haEnvironment(world);
            let rig: Rig;

            beforeEach(() => {
                vi.useFakeTimers();
                rig = new Rig();
                rig.add(R250, "C4-SR250B", {type: "EndDevice"});
                rig.add(R260, "C4-SR260", {type: "EndDevice"});
                rig.start();
            });

            afterEach(() => {
                rig.stop();
                vi.useRealTimers();
            });

            /** A blueprint as an automation set up with `values`; an input with no default and no value gets a placeholder. */
            function automation(file: string, values: Record<string, unknown>): Record<string, Any> {
                const {blueprint, ...body} = load(file) as {blueprint: {input: unknown}} & Record<string, unknown>;
                const placeholders = Object.fromEntries([...declaredInputs(blueprint.input)].map((name) => [name, `test.${name}`]));
                return substitute(body, {...placeholders, ...inputDefaults(blueprint.input), ...values}) as Record<string, Any>;
            }

            /**
             * What the remote's latest event gives a run through `triggers`, null when none
             * hears it: the trigger's id, and the Control4 events entity's new state, whose
             * attributes are the fields the extension publishes on the remote's own topic.
             */
            function heard(triggers: Trigger[], ieee: string): Record<string, unknown> | null {
                const e = rig.events.at(-1) as Record<string, unknown>;
                expect(e.ieee).toBe(ieee);
                const eventType = eventTypeOf(String(e.command), modelInfo(String(e.model))?.family);
                const t = triggers.find(
                    (x) => kindOf(x) === "event.received" && (x.target as {device_id: string}).device_id === DEVICE[ieee] && typesOf(x).includes(eventType),
                );
                if (!t) return null;
                const entity = "event.remote_control4_events";
                return {
                    id: t.id,
                    entity_id: entity,
                    to_state: {entity_id: entity, state: "2026-11-07T12:00:00.000+00:00", attributes: {...e, base: "zigbee2mqtt", event_type: eventType}},
                };
            }

            /** The wait_for_trigger triggers in an automation's actions, and the choose branch whose conditions are `conditions`. */
            function find(node: unknown, pick: (o: Record<string, Any>) => boolean): Record<string, Any> | undefined {
                if (Array.isArray(node)) {
                    for (const x of node) {
                        const r = find(x, pick);
                        if (r) return r;
                    }
                } else if (node && typeof node === "object") {
                    if (pick(node as Record<string, Any>)) return node as Record<string, Any>;
                    for (const x of Object.values(node)) {
                        const r = find(x, pick);
                        if (r) return r;
                    }
                }
                return undefined;
            }
            const waitOf = (a: Record<string, Any>) => find(a.action, (o) => "wait_for_trigger" in o)?.wait_for_trigger as Trigger[];

            it("SR250 media player: a key press and its held repeats name the key; its release starts nothing", () => {
                const a = automation("c4_sr250_media_player.yaml", {remote: DEVICE[R250]});
                rig.ascii(R250, "0t0001 sa c4.zr.bb 0d 0000 0000 00000000");
                let trigger = heard(a.trigger, R250);
                expect(trigger?.id).toBe("press");
                expect(renderVariables(env, a.variables, {trigger})).toMatchObject({button: "volume_up", is_hold: false});
                rig.ascii(R250, "0t0002 sa c4.zr.bh 0d 0000 0000");
                trigger = heard(a.trigger, R250);
                expect(trigger?.id).toBe("hold");
                expect(renderVariables(env, a.variables, {trigger})).toMatchObject({button: "volume_up", is_hold: true});
                rig.ascii(R250, "0t0003 sa c4.zr.be 0d 0000 0000");
                expect(heard(a.trigger, R250)).toBeNull();
                // Another remote's keys start nothing here.
                rig.ascii(R260, "0t0004 sa c4.zr.bb 0c 0000 0000 00000000");
                expect(heard(a.trigger, R260)).toBeNull();
            });

            it("SR260 media player: a key press names the key, and a wake runs the LCD push", () => {
                const a = automation("c4_sr260_media_player.yaml", {remote: DEVICE[R260]});
                rig.ascii(R260, "0t0001 sa c4.zr.bb 10 0000 0000 00000000");
                let trigger = heard(a.trigger, R260);
                expect(trigger?.id).toBe("button_press");
                expect(renderVariables(env, a.variables, {trigger})).toMatchObject({button: "select", is_hold: false, remote_ieee: R260});
                rig.ascii(R260, "0t0002 sa c4.zr.mot");
                trigger = heard(a.trigger, R260);
                expect(trigger?.id).toBe("lcd_wake");
                const vars = renderVariables(env, a.variables, {trigger});
                expect(conditionPasses(env, a.action[0].choose[0].conditions[0], vars)).toBe(true);
            });

            it.each([
                [R250, "02"],
                [R260, "01"],
            ])("menu on %s: Watch opens the Watch menu, and the pick or cancel ends the wait", (ieee, watchKey) => {
                const a = automation("c4_sr250_menu.yaml", {remote: DEVICE[ieee], watch_player: "media_player.apple_tv"});
                rig.ascii(ieee, `0t0001 sa c4.zr.bb ${watchKey} 0000 0000 00000000`);
                const trigger = heard(a.trigger, ieee);
                expect(trigger).not.toBeNull();
                const vars = renderVariables(env, a.variables, {trigger});
                expect(vars).toMatchObject({button: "watch", title: "Watch", remote_ieee: ieee, player: "media_player.apple_tv"});
                for (const c of a.condition) expect(conditionPasses(env, c.value_template, vars)).toBe(true);
                // A key while the menu is up does not end the wait.
                rig.ascii(ieee, "0t0002 sa c4.zr.bb 0d 0000 0000 00000000");
                expect(heard(waitOf(a), ieee)).toBeNull();
                rig.ascii(ieee, "0t0003 sa c4.ln.is 0002 0002");
                const wait = {trigger: heard(waitOf(a), ieee)};
                expect(wait.trigger?.id).toBe("select");
                const pick = find(a.action, (o) => o.conditions === "{{ wait.trigger.id == 'select' }}")?.sequence[0].variables;
                expect(renderValue(env, pick.picked_index, {...vars, wait}, "variable", "picked_index")).toBe(2);
                rig.ascii(ieee, "0t0004 sa c4.ln.cn 0002 0000");
                expect(heard(waitOf(a), ieee)?.id).toBe("cancel");
            });

            it("SR260 media player: Mute mutes only a volume target that can mute", () => {
                const a = automation("c4_sr260_media_player.yaml", {remote: DEVICE[R260], volume_target: "media_player.tv"});
                const mute = find(a.action, (o) => Array.isArray(o.conditions) && o.conditions[0] === "{{ button == 'volume_mute' }}") as Record<string, Any>;
                expect(mute.sequence[0].action).toBe("media_player.volume_mute");
                const runs = (features: number | undefined) => {
                    const e = haEnvironment({
                        ...world,
                        states: {"media_player.tv": {state: "playing", attributes: features === undefined ? {} : {supported_features: features}}},
                    });
                    const vars = {button: "volume_mute", volume_target: "media_player.tv"};
                    return mute.conditions.every((c: string) => conditionPasses(e, c, vars));
                };
                // An Apple TV: volume step and set, no mute (448439 has no 8).
                expect(runs(448439)).toBe(false);
                expect(runs(undefined)).toBe(false);
                expect(runs(4 | 8 | 1024)).toBe(true);
            });

            it("SR260 menu dispatcher: a show-trigger press while the menu is up restarts the run, never queues a second menu", () => {
                const a = automation("c4_sr260_menu_dispatcher.yaml", {sr260_device: DEVICE[R260]});
                expect(a.mode).toBe("restart");
                expect(a.max).toBeUndefined();
            });

            it("SR260 menu dispatcher: the picked item's label is what it dispatches on", async () => {
                const a = automation("c4_sr260_menu_dispatcher.yaml", {sr260_device: DEVICE[R260], item_1: "Movie", item_2: "Dinner"});
                const shown = rig.runtime.set(R260, "show_list", {title: "Scenes", items: ["Movie", "Dinner"]}, {message: {}});
                await tick(100);
                await shown;
                rig.ascii(R260, "0t0001 sa c4.ln.is 0002 0001");
                const wait = {trigger: heard(waitOf(a), R260)};
                expect(wait.trigger?.id).toBe("select");
                const step = find(a.action, (o) => o.variables?.selected_item !== undefined) as Record<string, Any>;
                expect(renderValue(env, step.variables.selected_item, {wait}, "variable", "selected_item")).toBe("Dinner");
            });

            it.each(["c4_sr250_menu.yaml", "c4_sr250_media_player.yaml", "c4_sr260_media_player.yaml"])(
                "%s run by hand reads no event and names no key",
                (file) => {
                    const a = automation(file, {remote: DEVICE[file.includes("sr260") ? R260 : R250]});
                    expect(renderVariables(env, a.variables, {trigger: {platform: null}}).button).toBe("");
                },
            );
        });
    });

    describe("c4_sr260_screen", () => {
        const R260 = "0x000fff00000000e2";
        const COLOR = "text.bedroom_remote_color";
        const SOURCE = "text.bedroom_remote_active_source";
        // biome-ignore lint/suspicious/noExplicitAny: automation shapes
        type Any = Record<string, any>;
        /** The blueprint set up with `values` over the defaults, run by `trigger` in a world holding `states`. */
        function run(values: Record<string, unknown>, states: Record<string, string | HaState>, trigger: Record<string, unknown> = {platform: null}) {
            const {blueprint, ...body} = load("c4_sr260_screen.yaml") as {blueprint: {input: unknown}} & Record<string, unknown>;
            const a = substitute(body, {...inputDefaults(blueprint.input), remote: "d_sr260", ...values}) as Any;
            const world: HaWorld = {
                devices: {
                    d_sr260: {
                        identifiers: [["mqtt", `zigbee2mqtt_${R260}`]],
                        model_id: "C4-SR260",
                        name: "Bedroom remote",
                        entities: ["sensor.bedroom_remote_battery", "text.bedroom_remote_room_name", SOURCE, COLOR],
                    },
                },
                states: Object.fromEntries(Object.entries(states).map(([e, st]) => [e, typeof st === "string" ? {state: st, attributes: {}} : st])),
                time: "12:00:00",
            };
            const env = haEnvironment(world);
            const vars: Record<string, unknown> = {...renderVariables(env, a.variables, {trigger}), trigger};
            const runs = (a.condition as Any[]).every((c) => conditionPasses(env, c.value_template, vars));
            const [, pick, color, line2] = a.action as Any[];
            const sent: Record<string, unknown> = {};
            for (const step of [color, line2]) {
                if (!conditionPasses(env, step.if[0].value_template, vars)) continue;
                const topic = String(renderValue(env, step.then[0].data.topic, vars, "variable", "topic"));
                expect(topic.startsWith(`control4/${R260}/set/`)).toBe(true);
                sent[topic.replace(`control4/${R260}/set/`, "")] = renderValue(env, step.then[0].data.payload, vars, "variable", "payload");
            }
            const delay = conditionPasses(env, pick.if[0].value_template, vars) ? renderValue(env, pick.then[0].delay.seconds, vars, "variable", "delay") : 0;
            return {vars, runs, sent, delay, a};
        }
        const tv = {player: "media_player.tv"};
        const night = {...tv, dark_entity: "binary_sensor.dark"};
        const playing = (app = "YouTube"): HaState => ({state: "playing", attributes: {app_name: app}});

        it("follows the player by day: green playing, amber paused, white idle, off or with no player", () => {
            const color = (values: Record<string, unknown>, states: Record<string, string | HaState>) => {
                const {vars} = run(values, states);
                return [vars.color_hex, vars.color_byte];
            };
            expect(color(tv, {"media_player.tv": "playing"})).toEqual(["#00ff00", 0x1c]);
            expect(color(tv, {"media_player.tv": "paused"})).toEqual(["#ffc000", 0xf8]);
            expect(color(tv, {"media_player.tv": "idle"})).toEqual(["#ffffff", 0xff]);
            expect(color(tv, {"media_player.tv": "off"})).toEqual(["#ffffff", 0xff]);
            expect(color({}, {})).toEqual(["#ffffff", 0xff]);
        });

        it("dims to the night level while dark, from its number or its helper, and never to black", () => {
            const color = (values: Record<string, unknown>, states: Record<string, string | HaState>) => run(values, states).vars.color_hex;
            const dark = {"binary_sensor.dark": "on"};
            expect(color(night, {...dark, "media_player.tv": "playing"})).toBe("#006600");
            expect(color(night, {...dark, "media_player.tv": "paused"})).toBe("#664d00");
            expect(color(night, {...dark, "media_player.tv": "idle"})).toBe("#666666");
            expect(color(night, {"binary_sensor.dark": "off", "media_player.tv": "playing"})).toBe("#00ff00");
            const helper = {...night, night_level_entity: "input_number.night"};
            expect(color(helper, {...dark, "media_player.tv": "playing", "input_number.night": "80"})).toBe("#00cc00");
            // At 10 % each lit channel stays at the remote's lowest step: dim, not black.
            expect(run(helper, {...dark, "media_player.tv": "idle", "input_number.night": "10"}).vars).toMatchObject({color_hex: "#202040", color_byte: 0x25});
            // A helper with no number yet falls back to the fixed level.
            expect(color(helper, {...dark, "media_player.tv": "playing", "input_number.night": "unknown"})).toBe("#006600");
        });

        it("shows the alert colour at full brightness while an alert entity is on, open or unlocked, dark or not", () => {
            const values = {...night, alert_entities: ["lock.front", "binary_sensor.window"]};
            const base = {"binary_sensor.dark": "on", "media_player.tv": "playing", "binary_sensor.window": "off"};
            expect(run(values, {...base, "lock.front": "locked"}).vars.color_hex).toBe("#006600");
            expect(run(values, {...base, "lock.front": "unlocked"}).vars).toMatchObject({color_hex: "#ff0000", color_byte: 0xe0});
            expect(run(values, {...base, "lock.front": "locked", "binary_sensor.window": "on"}).vars.color_hex).toBe("#ff0000");
        });

        it("sends the colour only when the colour the remote would show changes, however its entity writes it", () => {
            const sentColor = (values: Record<string, unknown>, states: Record<string, string | HaState>) =>
                run(values, {...states, [SOURCE]: "YouTube"}).sent.text_color;
            const tvOn = {"media_player.tv": playing()};
            expect(sentColor(tv, tvOn)).toBe("#00ff00");
            expect(sentColor(tv, {...tvOn, [COLOR]: "#ffffff"})).toBe("#00ff00");
            expect(sentColor(tv, {...tvOn, [COLOR]: "#00ff00"})).toBeUndefined();
            expect(sentColor(tv, {...tvOn, [COLOR]: "28"})).toBeUndefined();
            // Night green goes as #006600; the remote stores the byte, which may read back as #006d00.
            const dark = {"binary_sensor.dark": "on", "media_player.tv": playing()};
            expect(sentColor(night, {...dark, [COLOR]: "#006d00"})).toBeUndefined();
            expect(sentColor(night, {...dark, [COLOR]: "#006600"})).toBeUndefined();
        });

        it("shows the player's app on line 2 while it is on, cut to its length, and clears it when off", () => {
            const line2 = (values: Record<string, unknown>, states: Record<string, string | HaState>) =>
                run(values, {[COLOR]: "#ffffff", ...states}).sent.active_source;
            expect(line2(tv, {"media_player.tv": playing(), [SOURCE]: ""})).toBe("YouTube");
            expect(line2(tv, {"media_player.tv": playing(), [SOURCE]: "YouTube"})).toBeUndefined();
            expect(line2({...tv, max_length: 7}, {"media_player.tv": playing("Paramount+ with Showtime"), [SOURCE]: ""})).toBe("Paramou");
            expect(line2(tv, {"media_player.tv": {state: "on", attributes: {source: "HDMI 2"}}, [SOURCE]: ""})).toBe("HDMI 2");
            expect(line2(tv, {"media_player.tv": "off", [SOURCE]: "YouTube"})).toBe("");
            expect(line2({...tv, show_app: false}, {"media_player.tv": playing(), [SOURCE]: "Apple"})).toBeUndefined();
        });

        it("lets a menu pick show on line 2 for its seconds, then puts the app back; 0 keeps the pick", () => {
            const pick = {id: "pick", platform: "event.received"};
            const after = run(tv, {"media_player.tv": playing(), [COLOR]: "#00ff00", [SOURCE]: "Green Lamp"}, pick);
            expect(after).toMatchObject({runs: true, delay: 5, sent: {active_source: "YouTube"}});
            expect(run({...tv, pick_return: 0}, {"media_player.tv": playing(), [SOURCE]: "Green Lamp"}, pick).runs).toBe(false);
            expect(run(tv, {"media_player.tv": playing()}, {id: "1", platform: "state"}).delay).toBe(0);
        });

        it("runs on every change of what picks the colour or line 2, on a menu pick, and at Home Assistant start", () => {
            const {a} = run({...night, alert_entities: ["lock.front"], night_level_entity: "input_number.night"}, {});
            const watched = (a.trigger as Any[]).filter((t) => kindOf(t) === "state").map((t) => [t.entity_id, t.attribute ?? null]);
            expect(watched).toEqual([
                ["media_player.tv", null],
                ["media_player.tv", "app_name"],
                ["media_player.tv", "source"],
                [["lock.front"], null],
                ["binary_sensor.dark", null],
                ["input_number.night", null],
            ]);
            expect((a.trigger as Any[]).some((t) => kindOf(t) === "homeassistant" && t.event === "start")).toBe(true);
            expect((a.trigger as Any[]).find((t) => t.id === "pick")?.options).toEqual({event_type: ["remote_menu_select"]});
        });
    });

    it.each(files)("%s talks only to the shared control4/ namespace", (file) => {
        const text = fs.readFileSync(path.join(DIR, file), "utf8");
        for (const m of text.matchAll(/topic: "?([^"\n]+)"?/g)) expect(m[1], `${file}: ${m[1]}`).toMatch(/^(control4\/|\{\{ set_topic \}\}$)/);
        expect(text.includes("base_topic"), file).toBe(false);
    });

    it("send to the extension's keys only", () => {
        const known = ["room_name", "active_source", "display_message", "text_color", "show_list", "close_list", "led_status", "led_effect", "led_stop"];
        for (const file of files) {
            const text = fs.readFileSync(path.join(DIR, file), "utf8");
            for (const m of text.matchAll(/\/set\/(\w+)"/g)) expect(known, `${file}: /set/${m[1]}`).toContain(m[1]);
            for (const m of text.matchAll(/\{'(\w+)': \{/g)) expect(known, `${file}: ${m[1]}`).toContain(m[1]);
            for (const m of text.matchAll(/control4\/request\/(led_\w+)/g)) expect(known, `${file}: ${m[1]}`).toContain(m[1]);
        }
    });

    it("the generated c4_device matches its generator", async () => {
        const {execFileSync} = await import("node:child_process");
        const tmp = path.join(require("node:os").tmpdir(), `c4_device_${process.pid}.yaml`);
        execFileSync(process.execPath, [path.resolve(__dirname, "..", "tools", "gen-c4-device.mjs"), tmp]);
        expect(fs.readFileSync(tmp, "utf8")).toBe(fs.readFileSync(path.join(DIR, "c4_device.yaml"), "utf8"));
        fs.rmSync(tmp);
    });
});

export type {Scalar};
