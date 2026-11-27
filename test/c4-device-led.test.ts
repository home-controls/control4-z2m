// The rules test/c4-device/led-feedback.ts runs c4_device's LED feedback by, on
// step lists of their own: the committed blueprint reaches only some of them.
import {describe, expect, it} from "vitest";

import {C4TemplateError, haEnvironment} from "./c4-device/engine";
import {ledFeedback, ledSteps} from "./c4-device/led-feedback";

const TOPIC = "control4/0x000fff0000006e2a/set";
const CALLS = [
    {buttons: "button_1", color: "Green", brightness: 75},
    {buttons: "button_2", color: "Off", brightness: 15},
];
const publish = (payload: unknown = "{{ {'led_status': repeat.item} | to_json }}", topic: unknown = "{{ set_topic }}") => ({
    action: "mqtt.publish",
    data: {topic, payload},
    continue_on_error: true,
});
/** The committed LED repeat, with this sequence. */
const send = (sequence: unknown = [publish()]) => ({repeat: {for_each: "{{ calls }}", sequence}});
const led = (steps: unknown, vars: Record<string, unknown> = {}) => ledSteps(haEnvironment(), steps, {set_topic: TOPIC, calls: CALLS, ...vars}, TOPIC);
const REFUSED = /the LED feedback has a step this harness does not model/;

describe("the LED feedback a run reaches", () => {
    const options = (...sequences: unknown[]) => sequences.map((sequence, i) => ({conditions: i === 0 ? "{{ false }}" : "{{ true }}", sequence}));
    const reach = (...sequences: unknown[]) => {
        const written = options(...sequences);
        return ledFeedback(haEnvironment(), written, {set_topic: TOPIC, calls: CALLS}, TOPIC, {written});
    };

    it("is the first option whose conditions pass", () => {
        expect(reach([send()], [send([publish("{{ {'led_status': {'second': true}} | to_json }}")])]).leds).toEqual([{second: true}, {second: true}]);
    });

    it("is the first passing option only: a later one that also passes never runs", () => {
        const both = (...sequences: unknown[]) => {
            const written = sequences.map((sequence) => ({conditions: "{{ true }}", sequence}));
            return ledFeedback(haEnvironment(), written, {set_topic: TOPIC, calls: CALLS}, TOPIC, {written});
        };
        expect(both([{action: "light.turn_on", target: {entity_id: "light.hall"}}], [send()])).toEqual({leds: []});
        expect(both([send()], [send([publish("{{ {'led_status': {'second': true}} | to_json }}")])]).leds).toEqual(CALLS);
    });

    it("is read from the options as the blueprint writes them: a publish an input brings in never makes one", () => {
        const tap = [{choose: [{conditions: "{{ true }}", sequence: [publish()]}]}];
        const options = [{conditions: "{{ true }}", sequence: tap}];
        const written = [{conditions: "{{ true }}", sequence: [{choose: [{conditions: "{{ true }}", sequence: {__input: "b1_action"}}]}]}];
        expect(ledFeedback(haEnvironment(), options, {set_topic: TOPIC}, TOPIC, {written})).toEqual({leds: []});
    });

    it("is an option that publishes, whatever its variables are called", () => {
        expect(reach([], [{repeat: {for_each: "{{ calls }}", sequence: [publish()]}}]).leds).toEqual(CALLS);
    });

    it("is none for an option that neither publishes nor makes the hears check", () => {
        expect(reach([], [{action: "light.turn_on", target: {entity_id: "light.hall"}}])).toEqual({leds: []});
        expect(reach([send()])).toEqual({leds: []});
    });
});

describe("the LED feedback's steps", () => {
    it("send the LEDs the led_status of each item the repeat publishes on the device's set topic", () => {
        expect(led([{delay: {seconds: 0}}, send()]).leds).toEqual(CALLS);
    });

    it("render for_each once, as the repeat starts", () => {
        expect(led([send([{variables: {calls: "{{ [] }}"}}, publish()])]).leds).toEqual(CALLS);
    });

    it("give repeat.first, index, last and item to each pass, and repeat to nothing after it", () => {
        const look = "{{ {'led_status': {'buttons': repeat.index ~ repeat.first ~ repeat.last, 'item': repeat.item.buttons}} | to_json }}";
        expect(led([send([publish(look)])]).leds).toEqual([
            {buttons: "1TrueFalse", item: "button_1"},
            {buttons: "2FalseTrue", item: "button_2"},
        ]);
        expect(led([send(), {variables: {calls: "{{ [] if repeat is defined else calls }}"}}, send()]).leds).toEqual([...CALLS, ...CALLS]);
    });

    it("let a variables step inside an if or a repeat set what later steps see, as Home Assistant 2025.4 on does", () => {
        expect(led([{if: "{{ true }}", then: [{variables: {calls: "{{ calls[:1] }}"}}]}, send()]).leds).toEqual([CALLS[0]]);
        const counted = {repeat: {for_each: "{{ [1, 2] }}", sequence: [{variables: {n: "{{ repeat.index }}"}}]}};
        expect(led([counted, {variables: {calls: "{{ calls[:n - 1] }}"}}, send()]).leds).toEqual([CALLS[0]]);
    });

    it("read a lone step as a list of one", () => {
        expect(led(send(publish())).leds).toEqual(CALLS);
        expect(led([{if: "{{ true }}", then: send()}]).leds).toEqual(CALLS);
    });

    it("skip a disabled step, and refuse an enabled that is a template", () => {
        expect(led([{...send(), enabled: false}]).leds).toEqual([]);
        expect(led([send([{...publish(), enabled: false}])]).leds).toEqual([]);
        expect(() => led([{...send(), enabled: "{{ true }}"}])).toThrow(REFUSED);
    });

    it("make the hears check the hears variable", () => {
        expect(led([{variables: {hears: "{{ 1 > 0 }}"}}])).toEqual({leds: [], hears: true});
        expect(led([send()])).toEqual({leds: CALLS});
    });

    it("refuse a publish on another topic, which may reach the LEDs some other way", () => {
        for (const topic of ["zigbee2mqtt/0x000fff0000006e2a/set", "{{ set_topic }}/led_status", TOPIC.toUpperCase()]) {
            expect(() => led([send([publish(undefined, topic)])]), topic).toThrow(REFUSED);
        }
    });

    it("read the payload as the text its template writes: Python's dict is no JSON, and a mapping is no text", () => {
        expect(() => led([send([publish("{{ {'led_status': repeat.item} }}")])])).toThrow(/no JSON/);
        expect(() => led([send([publish({led_status: "{{ repeat.item }}"})])])).toThrow(/payload is no text/);
    });

    it("refuse a payload that holds anything beside one led_status call", () => {
        expect(() => led([send([publish("{{ {'led_status': repeat.item, 'led_effect': 'x'} | to_json }}")])])).toThrow(REFUSED);
        expect(() => led([send([publish("{{ {'led_status': 'x'} | to_json }}")])])).toThrow(REFUSED);
    });

    it("refuse a publish whose data is not one topic and one payload", () => {
        const {data, ...bare} = publish();
        for (const step of [bare, {...bare, data_template: data}, {...bare, data: "{{ none }}"}, {...bare, data: {...data, qos: 1}}]) {
            expect(() => led([send([step])]), JSON.stringify(step)).toThrow(REFUSED);
        }
    });

    it("refuse an action other than the publish and the hears notifications, one named by a template included", () => {
        expect(() => led([{...publish(), action: "{{ 'mqtt.publish' }}"}])).toThrow(REFUSED);
        expect(() => led([{action: "select.select_option", target: {entity_id: "select.kp_led_1_on_color"}}])).toThrow(REFUSED);
        expect(led([{action: "persistent_notification.dismiss", data: {notification_id: "x"}}, send()]).leds).toEqual(CALLS);
    });

    it("end the run where a notification's template fails, before the calls go out", () => {
        expect(() => led([{action: "persistent_notification.create", data: {notification_id: "x", message: "{{ 'x' | int }}"}}, send()])).toThrow(
            C4TemplateError,
        );
    });

    it("refuse a step that is no mapping", () => {
        for (const steps of [["qa"], [null], [send("qa")], [{if: "{{ true }}", then: "qa"}]]) {
            expect(() => led(steps), JSON.stringify(steps)).toThrow(REFUSED);
        }
    });

    it("refuse every other kind of step, and a step of two kinds", () => {
        const others = [
            {stop: "qa"},
            {condition: "{{ true }}"},
            {wait_template: "{{ true }}"},
            {choose: []},
            {parallel: []},
            {sequence: []},
            {service: "mqtt.publish"},
            {variables: {}, delay: 1},
        ];
        for (const step of others) expect(() => led([step, send()]), JSON.stringify(step)).toThrow(REFUSED);
    });

    it("refuse a step whose key is a name every object has", () => {
        for (const step of [{constructor: "qa"}, {valueOf: 1, alias: "x"}, {toString: "qa", qa: 1}, {}]) {
            expect(() => led([step, send()]), JSON.stringify(step)).toThrow(REFUSED);
        }
        expect(() => led([{}])).toThrow(/an empty step/);
    });

    it("take the metadata mapping the automation editor writes on an action, and refuse metadata anywhere else", () => {
        expect(led([send([{...publish(), metadata: {}}])]).leds).toEqual(CALLS);
        for (const steps of [
            [{delay: 0, metadata: {}}, send()],
            [{...send(), metadata: {}}],
            [{variables: {}, metadata: {}}, send()],
            [send([{...publish(), metadata: "qa"}])],
        ]) {
            expect(() => led(steps), JSON.stringify(steps)).toThrow(REFUSED);
        }
    });

    it("end the run where a notification's data is what its service refuses, before the calls go out", () => {
        const create = (data?: Record<string, unknown>) => ({action: "persistent_notification.create", ...(data ? {data} : {})});
        const dismiss = (data?: Record<string, unknown>) => ({action: "persistent_notification.dismiss", ...(data ? {data} : {})});
        for (const step of [
            create(),
            create({title: "t"}),
            create({message: "{{ none }}"}),
            create({message: "m", mesage: "m"}),
            dismiss(),
            dismiss({notification_id: "{{ none }}"}),
        ]) {
            expect(() => led([step, send()]), JSON.stringify(step)).toThrow(/refuses persistent_notification/);
        }
        expect(led([create({notification_id: "n", title: "t", message: "{{ 'm' }}"}), dismiss({notification_id: "n"}), send()]).leds).toEqual(CALLS);
    });

    it("end the run where a notification's text is a list or a mapping no template wrote, as cv.string refuses it", () => {
        const create = (data: Record<string, unknown>) => ({action: "persistent_notification.create", data, continue_on_error: true});
        for (const step of [create({message: ["a"]}), create({message: {a: 1}}), create({message: "m", title: ["t"]}), create({message: ["{{ 'a' }}"]})]) {
            expect(() => led([step, send()]), JSON.stringify(step)).toThrow(/refuses persistent_notification/);
        }
        expect(led([create({message: "{{ ['a'] }}", title: "{{ {'a': 1} }}"}), send()]).leds).toEqual(CALLS);
        expect(() => led([{action: "persistent_notification.dismiss", data: {notification_id: ["n"]}}, send()])).toThrow(/refuses persistent_notification/);
    });

    it("stop where a delay renders to what it does not take for a time period", () => {
        expect(() => led([{delay: "{{ 'qa' | float }}"}, send()])).toThrow(C4TemplateError);
        for (const delay of [{seconds: "{{ -1 }}"}, {seconds: "{{ nothing_here }}"}, "qa", {sekonds: 1}, {}]) {
            // Home Assistant refuses or ends the run on each, continue_on_error or not; the harness does not claim which.
            expect(() => led([{delay}, send()]), JSON.stringify(delay)).toThrow(/does not model \(delay of /);
        }
        expect(() => led([{delay: 1, continue_on_error: true}, send()])).toThrow(/does not model \(delay, continue_on_error\)/);
        for (const delay of [{seconds: "{{ 90 if false else 0 }}"}, "00:00:01", 2, "1.5", {minutes: 1, seconds: "2"}]) {
            expect(led([{delay}, send()]).leds, JSON.stringify(delay)).toEqual(CALLS);
        }
        expect(() => led([send([publish(), {delay: "{{ repeat.item.x | float }}"}])])).toThrow(/delay/);
    });

    it("refuse an if with no then, or a condition that is no template", () => {
        expect(() => led([{if: "{{ true }}", else: send()}])).toThrow(REFUSED);
        for (const condition of ["true", null, {condition: "template", value_template: "{{ true }}"}]) {
            expect(() => led([{if: condition, then: send()}]), JSON.stringify(condition)).toThrow(REFUSED);
        }
        expect(led([{if: ["{{ true }}", "{{ 1 > 0 }}"], then: send()}]).leds).toEqual(CALLS);
    });

    it("give a pass over a None item no repeat.item, as Home Assistant does", () => {
        const seen = {repeat: {for_each: "{{ [none, 'x'] }}", sequence: [publish("{{ {'led_status': {'defined': repeat.item is defined}} | to_json }}")]}};
        expect(led([seen]).leds).toEqual([{defined: false}, {defined: true}]);
    });

    it("strip what Python's str.strip strips: U+001F, not a byte order mark", () => {
        expect(led([{if: "{{ true }}\u001f", then: send()}]).leds).toEqual(CALLS);
        expect(led([{if: "{{ true }}﻿", then: send(), else: []}]).leds).toEqual([]);
        expect(led([send([publish("\u001f{{ {'led_status': repeat.item} | to_json }}\u0085")])]).leds).toEqual(CALLS);
        expect(() => led([send([publish("{{ {'led_status': repeat.item} | to_json }}﻿")])])).toThrow(/no JSON/);
    });

    it("give an outer pass its repeat back once a repeat inside it ends", () => {
        const inner = {repeat: {for_each: "{{ [1] }}", sequence: []}};
        const outer = {repeat: {for_each: "{{ ['a', 'b'] }}", sequence: [inner, publish("{{ {'led_status': {'outer': repeat.item}} | to_json }}")]}};
        expect(led([outer]).leds).toEqual([{outer: "a"}, {outer: "b"}]);
    });

    it("fail a payload where to_json meets an undefined value, as Home Assistant's does", () => {
        for (const payload of [
            "{{ {'led_status': {'buttons': repeat.item.button, 'color': 'Green'}} | to_json }}",
            "{{ {'led_status': repeat.item, 'x': nope} | to_json }}",
        ]) {
            const {continue_on_error: _, ...step} = publish(payload);
            expect(() => led([send([step])]), payload).toThrow(C4TemplateError);
        }
    });

    it("refuse a template that fails under continue_on_error: Home Assistant goes past it, but the engine's own gaps fail there too", () => {
        const calls = [{buttons: "button_1", extra: 1}, {buttons: "button_2"}];
        const failing = "{{ {'led_status': {'buttons': repeat.item.buttons, 'extra': repeat.item.extra}} | to_json }}";
        // One the engine renders no differently from HA (it fails there too), and one only the engine fails (HA rounds to 1 place).
        const gap = "{{ {'led_status': dict(repeat.item, brightness=repeat.item.brightness | round(1))} | to_json }}";
        expect(() => led([send([publish(failing)])], {calls})).toThrow(REFUSED);
        expect(() => led([send([publish(gap)])])).toThrow(REFUSED);
        const notice = {action: "persistent_notification.create", data: {message: "{{ 'x' | int }}"}, continue_on_error: true};
        expect(() => led([notice, send()])).toThrow(REFUSED);
    });

    it("take continue_on_error on an action only, as true or false", () => {
        expect(led([send([{...publish(), continue_on_error: false}])]).leds).toEqual(CALLS);
        expect(() => led([send([{...publish(), continue_on_error: "yes"}])])).toThrow(REFUSED);
        expect(() => led([{...send(), continue_on_error: true}])).toThrow(REFUSED);
        expect(() => led([{if: "{{ true }}", then: send(), continue_on_error: true}])).toThrow(REFUSED);
    });

    it("let the delays pass, one after another, on the clock that now() reads", () => {
        const waited: number[] = [];
        const delays = [{delay: {seconds: 90}}, {delay: "00:01:30"}, {delay: {minutes: 1, milliseconds: 500}}, {delay: 2}, {delay: "{{ 0.3 }}"}];
        ledSteps(haEnvironment(), delays, {}, TOPIC, (total) => waited.push(total));
        expect(waited).toEqual([90, 180, 240.5, 242.5, 242.8]);
    });

    it("refuse a repeat other than for_each over a list", () => {
        for (const repeat of [
            {count: 2, sequence: []},
            {for_each: "{{ calls }}", while: "{{ true }}", sequence: []},
            {for_each: "{{ 'ab' }}", sequence: []},
            "qa",
        ]) {
            expect(() => led([{repeat}]), JSON.stringify(repeat)).toThrow(REFUSED);
        }
    });
});
