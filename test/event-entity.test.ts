// The Home Assistant event entity a Control4 device gets (ADR 0005): the event
// types it declares, against what the extension publishes.

import {describe, expect, it} from "vitest";

import {GENERIC_MODEL, GESTURES, modelInfo, REMOTE_COMMANDS} from "../src/core/constants";
import {REMOTE_EVENT_PREFIX} from "../src/devices/remote";
import {buildDefinitions} from "../src/z2m/definitions";
import {commandOf, eventEntityConfig, eventTypeOf} from "../src/z2m/extension";
import {CONTRACT_EVENTS} from "./contract";

// biome-ignore lint/suspicious/noExplicitAny: converter shapes
type Any = any;

const IEEE = "0x000fff0000000001";
const defs = buildDefinitions();

function actionsOf(def: Any): string[] {
    const exposes = typeof def.exposes === "function" ? def.exposes({ieeeAddr: IEEE, modelID: def.model}, {}) : def.exposes;
    return exposes.find((x: Any) => x.name === "action")?.values ?? [];
}

const typesOf = (def: Any): string[] => eventEntityConfig(IEEE, actionsOf(def), modelInfo(def.model)?.family).event_types as string[];
const withActions = defs.filter((d: Any) => actionsOf(d).length > 0);
const remotes = defs.filter((d: Any) => ["sr250", "sr260"].includes(modelInfo(d.model)?.family as string));

/**
 * The event type Zigbee2MQTT's own event entity gives an action
 * (lib/extension/homeassistant.ts in 2.14.2: ACTION_PATTERNS, parseActionValue):
 * the pattern's `action` group, after its `actionPrefix`; else the action as it is.
 */
const Z2M_ACTION_PATTERNS = [
    /^(?<button>(?:button_)?[a-z0-9]+)_(?<action>(?:press|hold|single|double)(?:_release)?)$/,
    /^(?<action>recall|scene)_(?<scene>[0-9]+)$/,
    /^(?<actionPrefix>region_)(?<region>[1-9]|10)_(?<action>enter|leave|occupied|unoccupied)$/,
    /^(?<action>dial_rotate)_(?<direction>left|right)_(?<speed>step|slow|fast)$/,
    /^(?<action>brightness_step|color_temperature_step|color_saturation_step|color_hue_step)(?:_(?<direction>up|down))?$/,
];
function z2mEventType(action: string): string {
    for (const p of Z2M_ACTION_PATTERNS) {
        const g = p.exec(action)?.groups;
        if (g?.action) return (g.actionPrefix ?? "") + g.action;
    }
    return action;
}

describe("event entity", () => {
    it("names each action by the command it is published with", () => {
        expect(commandOf("button_1_press")).toBe("initial_switch_press");
        expect(commandOf("button_1_release")).toBe("remote_button_short_release");
        expect(commandOf("button_1_hold_release")).toBe("remote_button_long_release");
        expect(commandOf("top_fast_single")).toBe("remote_button_fast_short_press");
        expect(commandOf("outlet_2_tap_known")).toBe("remote_button_tap_known");
        expect(commandOf("led_notification_end")).toBe("led_notification_end");
        expect(commandOf("contact_state_changed")).toBe("contact_state_changed");
        // The remotes keep the ZHA remote quirks' names.
        expect(commandOf("select_press", "sr250")).toBe("remote_button_short_press");
        expect(commandOf("volume_up_hold", "sr260")).toBe("remote_button_long_press");
        expect(commandOf("select_release", "sr250")).toBe("remote_button_short_release");
    });

    it("declares every command the contract fixture records, for that device's model", () => {
        for (const e of CONTRACT_EVENTS) {
            const def = defs.find((d: Any) => d.zigbeeModel.includes(e.model));
            expect(typesOf(def), `${e.model} ${e.action}`).toContain(e.command);
        }
    });

    it("declares a remote's keys as the commands the remote sends, and its other events prefixed", () => {
        for (const model of ["C4-SR250B", "C4-SR260"]) {
            const types = typesOf(defs.find((d: Any) => d.model === model));
            expect([...types].sort(), model).toEqual(
                ["remote_button_short_press", "remote_button_long_press", "remote_button_short_release", "remote_menu_select", "remote_menu_cancel", "remote_motion_wake"].sort(),
            );
            expect(types).not.toContain(GESTURES.press);
        }
    });

    it("prefixes only a remote's event types, and a remote's key commands not twice", () => {
        expect(eventTypeOf("menu_select", "sr250")).toBe("remote_menu_select");
        expect(eventTypeOf("motion_wake", "sr260")).toBe("remote_motion_wake");
        for (const c of Object.values(REMOTE_COMMANDS)) expect(eventTypeOf(c as string, "sr250")).toBe(c);
        // Other devices keep their command names (ADR 0005): c4_device's triggers name them.
        expect(eventTypeOf("led_notification_end", "kp6")).toBe("led_notification_end");
        expect(eventTypeOf("contact_state_changed", "z2io")).toBe("contact_state_changed");
        expect(eventTypeOf("remote_button_short_press")).toBe("remote_button_short_press");
    });

    // event.received on a remote hears Zigbee2MQTT's own event entity too, when
    // experimental_event_entities is on: it keeps menu_select, menu_cancel and
    // motion_wake as they are, and parses select_press into press.
    it("gives a remote only event types that start with the prefix, none of them one Zigbee2MQTT's own entity has", () => {
        expect(remotes.map((d: Any) => d.model).sort()).toEqual(["C4-SR250B", "C4-SR260"]);
        for (const def of remotes) {
            const types = typesOf(def);
            const theirs = new Set(actionsOf(def).map(z2mEventType));
            expect(theirs.has("menu_select") && theirs.has("press"), def.model).toBe(true);
            for (const t of types) {
                expect(t.startsWith(REMOTE_EVENT_PREFIX), `${def.model}: ${t}`).toBe(true);
                expect(theirs.has(t), `${def.model}: ${t}`).toBe(false);
            }
        }
    });

    it("exists for every model but the generic one, which has no actions until its model is known", () => {
        expect(defs.filter((d: Any) => !withActions.includes(d)).map((d: Any) => d.model)).toEqual([GENERIC_MODEL]);
    });

    // event.received on a device hears every event entity on it, Zigbee2MQTT's own
    // too when experimental_event_entities is on: it parses `button_1_double` into
    // `double` and keeps `button_1_tap_known` as it is.
    it("shares no button event type with Zigbee2MQTT's own event entity", () => {
        for (const def of withActions) {
            const actions = actionsOf(def);
            const shared = typesOf(def).filter((t) => actions.includes(t) || t in GESTURES);
            expect(shared.every((t) => commandOf(t) === t && !(t in GESTURES)), `${def.model}: ${shared}`).toBe(true);
        }
    });

    it("is attached to the Zigbee2MQTT device and fed from the device's own topic, with no availability", () => {
        const cfg = eventEntityConfig(IEEE, ["button_1_press", "button_1_single", "button_2_single"]);
        expect(cfg).toEqual({
            name: "Control4 events",
            unique_id: `${IEEE}_control4_event`,
            state_topic: `control4/${IEEE}/event`,
            event_types: ["initial_switch_press", "remote_button_short_press"],
            device_class: "button",
            icon: "mdi:gesture-double-tap",
            device: {identifiers: [`zigbee2mqtt_${IEEE}`]},
            origin: {name: "control4-z2m"},
        });
    });
});
