// c4_device's rules, rendered from the committed blueprint as Home Assistant
// renders them (test/c4-device.ts), and the engine that stands in for HA's.
import fs from "node:fs";
import path from "node:path";

import {describe, expect, it} from "vitest";

import {FAN_BUTTONS, GESTURES, OUTLET_BUTTONS, PADDLE_BUTTONS} from "../src/core/constants";
import {readRun} from "../tools/c4-device-run.mjs";
import {sequences} from "../tools/c4-scenarios.mjs";
import {
    anyAction,
    type ButtonNumber,
    boot,
    C4TemplateError,
    c4Device,
    change,
    clock,
    deviceCount,
    event,
    fastCount,
    type Happening,
    hold,
    knownTap,
    press,
    release,
    reload,
    renderTemplate,
    type StateSpec,
    sceneApply,
} from "./c4-device";
import {c4DeviceBlueprint} from "./c4-device/blueprint";

const FIXTURES = path.resolve(__dirname, "fixtures");

describe("a button's single tap, by Tap response", () => {
    const multi = {targets: ["light.kitchen"], double: anyAction};
    const plain = {targets: ["light.kitchen"]};

    it("Auto: a button with a double-tap action commits its first known tap toward ON early", () => {
        const kp = c4Device({buttons: {2: multi}, states: {"light.kitchen": "off"}});
        expect(kp.on(knownTap(2)).does).toBe("early commit");
    });

    it("Auto: a fast count whose taps were not known runs the tap, as Fast does", () => {
        expect(c4Device({buttons: {2: multi}}).on(fastCount(2, "single", {known: false})).does).toBe("tap");
    });

    it("Auto: a fast count whose taps were known leaves the tap to the early commit, so it never runs twice", () => {
        expect(c4Device({buttons: {2: multi}}).on(fastCount(2)).does).toBe("nothing");
    });

    it("Auto: only the first known tap of a sequence commits early", () => {
        expect(c4Device({buttons: {2: multi}}).on(knownTap(2, 2)).does).toBe("nothing");
    });

    it("Auto: a button with neither targets nor a Tap action has no early commit", () => {
        expect(c4Device({buttons: {2: {double: anyAction}}}).on(knownTap(2)).does).toBe("nothing");
    });

    it("Auto: a button with a Tap action and no targets commits early", () => {
        expect(c4Device({buttons: {2: {action: anyAction, double: anyAction}}}).on(knownTap(2)).does).toBe("early commit");
    });

    it.each([
        ["triple", "triple"],
        ["quadruple", "quad"],
    ])("Auto: a %s-tap action alone makes a button commit early", (_count, input) => {
        expect(c4Device({buttons: {1: {targets: ["light.hall"], [input]: anyAction}}}).on(knownTap(1)).does).toBe("early commit");
    });

    it.each([
        ["Instant", {tap_response: "instant"}, multi],
        ["Auto with no multi-tap actions", {}, plain],
    ])("%s: a fast count whose taps were not known runs the tap, a keypad never seen releasing included", (_name, inputs, button) => {
        expect(c4Device({buttons: {1: button}, inputs}).on(fastCount(1, "single", {known: false})).does).toBe("tap");
    });

    it("Auto: a button with no multi-tap action taps on each known tap, and not again on its fast count", () => {
        const kp = c4Device({buttons: {1: plain}});
        expect([kp.on(knownTap(1)).does, kp.on(knownTap(1, 2)).does, kp.on(fastCount(1)).does]).toEqual(["tap", "tap", "nothing"]);
    });

    it("Instant: each known tap is a tap, multi-tap actions or not", () => {
        const kp = c4Device({buttons: {2: multi}, inputs: {tap_response: "instant"}});
        expect([kp.on(knownTap(2)).does, kp.on(knownTap(2, 2)).does, kp.on(fastCount(2)).does]).toEqual(["tap", "tap", "nothing"]);
    });

    it("Fast: the fast count is the tap, never a known tap", () => {
        const kp = c4Device({buttons: {1: plain}, inputs: {tap_response: "fast"}});
        expect([kp.on(knownTap(1)).does, kp.on(fastCount(1)).does, kp.on(deviceCount(1)).does]).toEqual(["nothing", "tap", "nothing"]);
    });

    it("Wait: the device's own count is the tap", () => {
        const kp = c4Device({buttons: {1: plain}, inputs: {tap_response: "wait"}});
        expect([kp.on(knownTap(1)).does, kp.on(fastCount(1)).does, kp.on(deviceCount(1)).does]).toEqual(["nothing", "nothing", "tap"]);
    });

    it("a press or a release on its own is no tap", () => {
        const kp = c4Device({buttons: {1: {...plain, hold: false}}});
        expect([kp.on(press(1)).does, kp.on(release(1)).does]).toEqual(["nothing", "nothing"]);
    });

    it("a release starts no run at all: c4_device never hears it", () => {
        expect(c4Device({buttons: {1: plain}}).runs(release(1))).toEqual([]);
    });

    it("names the button and the targets of the run that taps", () => {
        const r = c4Device({buttons: {3: {targets: ["light.den", "switch.fan"]}}}).on(knownTap(3));
        expect([r.button, r.targets]).toEqual([3, ["light.den", "switch.fan"]]);
    });
});

describe("multi-tap actions", () => {
    it("run on the fast count, except under Wait, where the device's count runs them", () => {
        const auto = c4Device({buttons: {2: {double: anyAction}}});
        const wait = c4Device({buttons: {2: {double: anyAction}}, inputs: {tap_response: "wait"}});
        expect([auto.on(fastCount(2, "double")).does, auto.on(deviceCount(2, "double")).does]).toEqual(["double", "nothing"]);
        expect([wait.on(fastCount(2, "double")).does, wait.on(deviceCount(2, "double")).does]).toEqual(["nothing", "double"]);
    });

    it("a triple tap runs the triple-tap action", () => {
        expect(c4Device({buttons: {1: {triple: anyAction}}}).on(fastCount(1, "triple")).does).toBe("triple");
    });

    it("a quadruple tap runs the quadruple-tap action, on the fast count or under Wait the device's", () => {
        expect(c4Device({buttons: {1: {quad: anyAction}}}).on(fastCount(1, "quadruple")).does).toBe("quadruple");
        expect(c4Device({buttons: {1: {quad: anyAction}}, inputs: {tap_response: "wait"}}).on(deviceCount(1, "quadruple")).does).toBe("quadruple");
    });
});

describe("hold to dim", () => {
    const lights = {targets: ["light.hall", "switch.fan"]};

    it("a keypad's paddle-down owns the hold that may follow, on a button whose targets have a light", () => {
        expect(c4Device({buttons: {1: lights}}).on(press(1)).does).toBe("hold");
    });

    it("a keypad's hold event starts nothing more: its paddle-down run already owns the hold", () => {
        expect(c4Device({buttons: {1: lights}}).on(hold(1)).does).toBe("nothing");
    });

    it("not with Hold to dim off, nor without a light among the targets", () => {
        expect(c4Device({buttons: {1: {...lights, hold: false}}}).on(press(1)).does).toBe("nothing");
        expect(c4Device({buttons: {1: {targets: ["switch.fan"]}}}).on(press(1)).does).toBe("nothing");
    });

    it.each(["C4-DIM1-Z", "C4-FS1-Z"])("a %s, which sends no paddle-down before a hold, starts on its hold event", (model) => {
        const dev = c4Device({model, buttons: {1: lights}});
        expect([dev.on(press(1)).does, dev.on(hold(1)).does]).toEqual(["nothing", "hold"]);
    });

    it("never on a DIM1-Z while its paddle drives its own load", () => {
        expect(c4Device({model: "C4-DIM1-Z", buttons: {1: lights}, paddleLocal: true}).on(hold(1)).does).toBe("nothing");
        expect(c4Device({model: "C4-DIM1-Z", buttons: {1: lights}, paddleLocal: false}).on(hold(1)).does).toBe("hold");
    });

    describe.each(["C4-APD120", "C4-SW120277"])("on a %s, by its halves' button behaviour", (model) => {
        const both = {1: lights, 2: lights};

        it("never on a half that drives the load: any behaviour but event_only", () => {
            for (const top of ["load_on", "load_off", "toggle", "momentary"])
                expect(c4Device({model, buttons: both, buttonBehaviour: {top}}).on(press(1)).does, top).toBe("nothing");
        });

        it("never on a half with no behaviour select yet: it drives the load, as from the factory", () => {
            expect(c4Device({model, buttons: both}).on(press(1)).does).toBe("nothing");
            expect(c4Device({model, buttons: both, buttonBehaviour: {top: "unavailable"}}).on(press(1)).does).toBe("nothing");
        });

        it("on an event_only half, like a keypad button: paddle-down owns the hold", () => {
            const dev = c4Device({model, buttons: both, buttonBehaviour: {top: "event_only", bottom: "event_only"}});
            expect([dev.on(press(1)).does, dev.on(press(2)).does, dev.on(hold(1)).does]).toEqual(["hold", "hold", "nothing"]);
        });

        it("reads each half's own select: an event_only bottom half holds while the top drives the load", () => {
            const dev = c4Device({model, buttons: both, buttonBehaviour: {top: "load_on", bottom: "event_only"}});
            expect([dev.on(press(1)).does, dev.on(press(2)).does]).toEqual(["nothing", "hold"]);
        });

        it('never reads a "Paddle controls local load" switch', () => {
            expect(c4Device({model, buttons: both, paddleLocal: false}).on(press(1)).does).toBe("nothing");
            expect(c4Device({model, buttons: both, paddleLocal: true, buttonBehaviour: {top: "event_only"}}).on(press(1)).does).toBe("hold");
        });
    });
});

describe("paddles", () => {
    it.each(["C4-APD120", "C4-SW120277"])("a %s's top half is Button 1 and its bottom half Button 2", (model) => {
        const dev = c4Device({model, buttons: {1: {targets: ["light.a"]}, 2: {targets: ["light.b"]}}});
        expect([dev.on(knownTap(1)).targets, dev.on(knownTap(2)).targets]).toEqual([["light.a"], ["light.b"]]);
    });

    it("numbers the halves as the extension names them: top is Button 1, bottom Button 2", () => {
        const apd = c4Device({model: "C4-APD120", buttons: {1: {targets: ["light.a"]}, 2: {targets: ["light.b"]}}});
        const tap = apd.runs(knownTap(1))[0].variables.evt as Record<string, unknown>;
        const halves = [...new Set(Object.values(PADDLE_BUTTONS))];
        expect(halves.map((half) => apd.on(event({...tap, button: half})).button)).toEqual([1, 2]);
    });

    it.each(["C4-APD120", "C4-SW120277", "C4-DIM1-Z", "C4-FS1-Z"])("a %s has no Button 3", (model) => {
        expect(() => c4Device({model, buttons: {3: {targets: ["light.a"]}}})).toThrow(/Button 3/);
        expect(() => c4Device({model}).on(knownTap(3))).toThrow(/Button 3/);
    });
});

describe("the fan and the outlet", () => {
    const sixButtons = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, {targets: [`light.l${n}`]}]));

    it("numbers the fan's buttons 1-6 from the top, as the extension names them", () => {
        const fan = c4Device({model: "C4-4SF120", buttons: sixButtons});
        const tap = fan.runs(knownTap(1))[0].variables.evt as Record<string, unknown>;
        const wires = Object.keys(FAN_BUTTONS)
            .map(Number)
            .sort((a, b) => a - b);
        expect(wires.map((w) => fan.on(event({...tap, button: FAN_BUTTONS[w], button_id: w})).button)).toEqual([1, 2, 3, 4, 5, 6]);
        expect([1, 2, 3, 4, 5, 6].map((n) => fan.on(knownTap(n as ButtonNumber)).targets)).toEqual([1, 2, 3, 4, 5, 6].map((n) => [`light.l${n}`]));
    });

    it("numbers the outlet's buttons 1 and 2, as the extension names them, and it has no Button 3", () => {
        const outlet = c4Device({model: "LOZ-5S1-W", buttons: {1: {targets: ["light.a"]}, 2: {targets: ["light.b"]}}});
        const tap = outlet.runs(knownTap(1))[0].variables.evt as Record<string, unknown>;
        expect(Object.entries(OUTLET_BUTTONS).map(([w, name]) => outlet.on(event({...tap, button: name, button_id: Number(w)})).button)).toEqual([1, 2]);
        expect(() => outlet.on(knownTap(3))).toThrow(/LOZ-5S1-W has no Button 3/);
    });

    it.each(["C4-4SF120", "LOZ-5S1-W"])("a %s button holds as a keypad's does: its paddle-down owns the hold", (model) => {
        const dev = c4Device({model, buttons: {1: {targets: ["light.hall"]}}});
        expect(dev.play("hold", 1).map((r) => r.does)).toEqual(["hold", "nothing", "nothing"]);
    });
});

describe("the Room modes", () => {
    const room = (mode: string) => ({buttons: {1: {mode, targets: ["light.a"]}, 2: {targets: ["light.b", "light.a"]}}, inputs: {room_extra: ["switch.c"]}});

    it.each(["room_off", "room_master"])("%s acts on every button's targets and the room extras", (mode) => {
        expect(c4Device(room(mode)).on(knownTap(1)).targets.sort()).toEqual(["light.a", "light.b", "switch.c"]);
    });

    it.each(["room_off", "room_master"])("%s's LED shows the whole room: lit while anything in it is on", (mode) => {
        expect(
            c4Device({...room(mode), states: {"switch.c": "on"}})
                .on(boot())
                .led("button_1")?.color,
        ).toBe("Green");
        expect(c4Device(room(mode)).on(boot()).led("button_1")?.color).toBe("Off");
    });
});

describe("the LEDs", () => {
    const hall = {targets: ["light.hall"]};
    const kitchen = {targets: ["light.kitchen"]};

    it("one change starts a run for each trigger list that names the entity, and only the first one paints", () => {
        const kp = c4Device({buttons: {1: hall, 2: {targets: ["light.porch"], watch: ["light.hall"]}}});
        const runs = kp.runs(change("light.hall", 200));
        expect(runs.map((r) => [r.trigger, r.passes])).toEqual([
            ["led", true],
            ["led", false],
            ["led_bri", false],
            ["led_bri", false],
        ]);
    });

    it("a change of state alone fires no brightness trigger", () => {
        const kp = c4Device({buttons: {1: {targets: ["switch.fan"]}}});
        expect(kp.runs(change("switch.fan", "on")).map((r) => r.trigger)).toEqual(["led"]);
    });

    it("a brightness change that came with an on/off change leaves the painting to that change's run, follow or not", () => {
        const kp = c4Device({buttons: {1: hall}, inputs: {led_follow: true}});
        expect(kp.runs(change("light.hall", 200)).map((r) => [r.trigger, r.passes])).toEqual([
            ["led", true],
            ["led_bri", false],
        ]);
    });

    it("a brightness change alone repaints only while the LED follows the lights", () => {
        const states = {"light.hall": 100};
        expect(c4Device({buttons: {1: hall}, states}).on(change("light.hall", 200)).does).toBe("nothing");
        expect(
            c4Device({buttons: {1: hall}, states, inputs: {led_follow: true}})
                .on(change("light.hall", 200))
                .led("button_1"),
        ).toEqual({color: "Green", brightness: 78});
    });

    it("a lit button shows its ON colour at the ON brightness, an unlit one its OFF colour at the OFF brightness", () => {
        const kp = c4Device({buttons: {1: hall, 2: kitchen}, states: {"light.kitchen": "off"}});
        expect(kp.on(change("light.hall", 200)).leds).toEqual([
            {buttons: "button_1", color: "Green", brightness: 75},
            {buttons: "button_2", color: "Off", brightness: 15},
        ]);
    });

    it("buttons that look the same share one call, and led() finds a button's look", () => {
        const kp = c4Device({buttons: {1: hall, 2: kitchen, 3: {targets: ["light.den"], on: "Blue"}}, states: {"light.den": 255}});
        const r = kp.on(change("light.hall", 200));
        expect(r.leds).toContainEqual({buttons: "button_1", color: "Green", brightness: 75});
        expect([r.led("button_3"), r.led("button_2")]).toEqual([
            {color: "Blue", brightness: 75},
            {color: "Off", brightness: 15},
        ]);
        const shared = c4Device({buttons: {1: hall, 3: {targets: ["light.den"]}}, states: {"light.den": 255}}).on(change("light.hall", 200));
        expect(shared.leds).toEqual([{buttons: "button_1,button_3", color: "Green", brightness: 75}]);
        expect(shared.led("button_3")).toEqual({color: "Green", brightness: 75});
    });

    it("picked colour selects name the LEDs they set, over the button's name", () => {
        const kp = c4Device({
            model: "C4-KC120277",
            buttons: {3: {targets: ["light.hall"], led: ["select.test_keypad_led_5_on_color", "select.test_keypad_led_6_on_color"]}},
        });
        expect(kp.on(change("light.hall", 200)).leds).toEqual([{buttons: "5,6", color: "Green", brightness: 75}]);
    });

    it.each(["C4-KP6-Z", "C4-KC120277"])("a %s names the LEDs of all six buttons", (model) => {
        const six = c4Device({model, buttons: {6: hall}});
        expect(six.on(change("light.hall", 200)).leds).toEqual([{buttons: "button_6", color: "Green", brightness: 75}]);
    });

    it("a button past the LEDs its model names, with no colour select, gets no call", () => {
        const kp = c4Device({buttons: {1: hall, 4: {targets: ["light.hall"]}}});
        expect(kp.on(change("light.hall", 200)).leds).toEqual([{buttons: "button_1", color: "Green", brightness: 75}]);
    });

    it("a DIM1-Z's paddle LEDs are button_1 (top) and button_2 (bottom)", () => {
        const dim = c4Device({model: "C4-DIM1-Z", buttons: {1: hall, 2: kitchen}});
        expect(dim.on(change("light.hall", 200)).leds).toEqual([
            {buttons: "button_1", color: "Green", brightness: 75},
            {buttons: "button_2", color: "Off", brightness: 15},
        ]);
    });

    it.each(["C4-APD120", "C4-SW120277"])("a %s's paddle LEDs are button_1 (top) and button_2 (bottom), as a DIM1-Z's", (model) => {
        const dev = c4Device({model, buttons: {1: hall, 2: kitchen}});
        expect(dev.on(change("light.hall", 200)).leds).toEqual([
            {buttons: "button_1", color: "Green", brightness: 75},
            {buttons: "button_2", color: "Off", brightness: 15},
        ]);
    });

    it.each(["C4-APD120", "C4-SW120277"])("a %s half with no targets or watches is never painted, so its LED keeps following the load", (model) => {
        const dev = c4Device({model, buttons: {2: kitchen}, buttonBehaviour: {top: "load_on", bottom: "event_only"}});
        expect(dev.on(boot()).leds).toEqual([{buttons: "button_2", color: "Off", brightness: 15}]);
    });

    it.each(["C4-FS1-Z", "C4-4SF120", "LOZ-5S1-W"])("a %s gets no LED calls, colour selects or not: it has no LEDs c4_device drives", (model) => {
        const led = ["select.test_keypad_led_1_on_color"];
        expect(c4Device({model, buttons: {1: {...hall, led}}}).on(change("light.hall", 200)).leds).toEqual([]);
    });

    it("led_match all: lit only while every watched entity is on", () => {
        const both = {buttons: {1: {targets: ["light.hall", "light.kitchen"]}}, states: {"light.kitchen": "off"}};
        expect(c4Device(both).on(change("light.hall", 200)).led("button_1")?.color).toBe("Green");
        expect(
            c4Device({...both, inputs: {led_match: "all"}})
                .on(change("light.hall", 200))
                .led("button_1")?.color,
        ).toBe("Off");
    });

    it("follow: the ON brightness is the brightest lit light's, in percent, and never under 5", () => {
        const follow = {inputs: {led_follow: true}, buttons: {1: {targets: ["light.hall", "light.lamp"]}}};
        expect(
            c4Device({...follow, states: {"light.lamp": 100}})
                .on(change("light.hall", 200))
                .led("button_1"),
        ).toEqual({color: "Green", brightness: 78});
        expect(c4Device(follow).on(change("light.hall", 5)).led("button_1")).toEqual({color: "Green", brightness: 5});
        expect(c4Device(follow).on(change("light.hall", "on")).led("button_1")).toEqual({color: "Green", brightness: 100});
    });

    it("a watched entity unavailable shows the Fault colour at the ON brightness, unless Fault is treated as off", () => {
        const fan = {buttons: {1: {targets: ["light.hall", "switch.fan"]}}, states: {"switch.fan": "unavailable"}};
        expect(c4Device(fan).on(change("light.hall", 200)).led("button_1")).toEqual({color: "Red", brightness: 75});
        expect(
            c4Device({...fan, inputs: {fault_colour: "Treat as off"}})
                .on(change("light.hall", 200))
                .led("button_1"),
        ).toEqual({color: "Green", brightness: 75});
    });

    it("so does a watched entity Home Assistant does not have", () => {
        const gone = {buttons: {1: {targets: ["light.hall", "switch.fan"]}}, states: {"switch.fan": null}};
        expect(c4Device(gone).on(change("light.hall", 200)).led("button_1")).toEqual({color: "Red", brightness: 75});
    });

    it("at night, a button's night colour at the night brightness; by day, or with Night needs dark and a room light on, its day colour", () => {
        const night = {buttons: {1: {...hall, night_on: "Blue"}}, inputs: {night_enabled: true, night_needs_dark: false}};
        expect(
            c4Device({...night, time: "22:30:00"})
                .on(change("light.hall", 200))
                .led("button_1"),
        ).toEqual({color: "Blue", brightness: 10});
        expect(
            c4Device({...night, time: "12:00:00"})
                .on(change("light.hall", 200))
                .led("button_1"),
        ).toEqual({color: "Green", brightness: 75});
        // The hourly LED re-check at night.
        expect(
            c4Device({...night, states: {"light.hall": 200}})
                .on(clock("23:00:00"))
                .led("button_1"),
        ).toEqual({color: "Blue", brightness: 10});
        const dark = {...night, inputs: {night_enabled: true}, time: "22:30:00"};
        expect(c4Device(dark).on(change("light.hall", 200)).led("button_1")).toEqual({color: "Green", brightness: 75});
    });

    it("the night starts at Night start and ends at Night end, past midnight or not", () => {
        const night = (inputs: Record<string, unknown> = {}) => ({
            buttons: {1: {...hall, night_on: "Blue"}},
            inputs: {night_enabled: true, night_needs_dark: false, ...inputs},
            states: {"light.hall": 200},
        });
        // A reload paints at whatever time it is.
        const at = (time: string, inputs?: Record<string, unknown>) =>
            c4Device({...night(inputs), time})
                .on(reload())
                .led("button_1")?.color;
        expect([at("20:59:59"), at("21:00:00"), at("05:59:59"), at("06:00:00")]).toEqual(["Green", "Blue", "Blue", "Green"]);
        const small = {night_start: "01:00:00", night_end: "05:00:00"};
        expect([at("00:59:59", small), at("01:00:00", small), at("03:00:00", small), at("04:59:59", small), at("05:00:00", small)]).toEqual([
            "Green",
            "Blue",
            "Blue",
            "Blue",
            "Green",
        ]);
        // A window that ends when it starts is empty: never night.
        const none = {night_start: "05:00:00", night_end: "05:00:00"};
        expect([at("04:59:59", none), at("05:00:00", none), at("17:00:00", none)]).toEqual(["Green", "Green", "Green"]);
        // Their time selector also takes a time written without its zeros, as the time it is (cv.time reads 9:3 as 09:03:00).
        const day = {night_start: "9:3", night_end: "17:00"};
        expect([at("09:02:59", day), at("09:03:00", day), at("16:59:59", day), at("17:00:00", day)]).toEqual(["Green", "Blue", "Blue", "Green"]);
        const overnight = {night_start: "21:00", night_end: "5:00"};
        expect([at("20:59:59", overnight), at("21:00:00", overnight), at("04:59:59", overnight), at("05:00:00", overnight)]).toEqual([
            "Green",
            "Blue",
            "Blue",
            "Green",
        ]);
    });

    it("refuses a Night start or Night end in a form of time it does not model, whatever the happening", () => {
        // Home Assistant takes 2_1:00 (Python's int() reads 2_1 as 21); the engine's int does not, so the harness refuses it by name.
        for (const night_start of ["2_1:00", "﻿21:00", "21:00:00:00", 2100]) {
            expect(() => c4Device({buttons: {1: hall}, inputs: {night_enabled: true, night_start}}), String(night_start)).toThrow(
                /night_start .* is no time of day this harness models/,
            );
        }
        expect(() => c4Device({buttons: {1: hall}, inputs: {night_end: "6"}})).toThrow(/night_end .* is no time of day this harness models/);
    });

    it("tells day from night after the LED delay: 90 s on boot, the LED delay otherwise", () => {
        const night = (inputs: Record<string, unknown> = {}) => ({
            buttons: {1: {...hall, night_on: "Blue"}},
            inputs: {night_enabled: true, night_needs_dark: false, ...inputs},
            states: {"light.hall": 200},
        });
        const colour = (time: string, h: Happening, inputs?: Record<string, unknown>) =>
            c4Device({...night(inputs), time})
                .on(h)
                .led("button_1")?.color;
        expect([colour("20:59:00", boot()), colour("20:58:29", boot()), colour("05:59:00", boot())]).toEqual(["Blue", "Green", "Green"]);
        // The delay runs past midnight into the next day's 00:00:30.
        expect(colour("23:59:00", boot(), {night_start: "00:00:00", night_end: "05:00:00"})).toBe("Blue");
        const on = change("light.hall", 200, "off");
        expect([colour("20:59:58", on, {led_delay: 3}), colour("20:59:58", on, {led_delay: 1}), colour("20:59:59", on)]).toEqual(["Blue", "Green", "Green"]);
    });

    it("fires a Night start written H:MM, as Home Assistant reads it", () => {
        expect(c4Device({buttons: {1: hall}, inputs: {night_enabled: true, night_start: "9:03"}}).runs(clock("09:03:00"))).toHaveLength(1);
    });

    it("fires a Night start or Night end written as HH:MM at that minute, as Home Assistant's time trigger does", () => {
        const kp = c4Device({
            buttons: {1: {...hall, night_on: "Blue"}},
            inputs: {night_enabled: true, night_needs_dark: false, night_start: "21:03"},
            states: {"light.hall": 200},
        });
        expect(kp.runs(clock("21:03:00")).flatMap((r) => r.leds)).toContainEqual({buttons: "button_1", color: "Blue", brightness: 10});
    });

    it("a pressed colour goes with every call, at the ON brightness (the night brightness at night)", () => {
        const kp = c4Device({buttons: {1: hall}, inputs: {pressed_colour: "White"}});
        expect(kp.on(change("light.hall", 200)).leds).toEqual([
            {buttons: "button_1", color: "Green", brightness: 75, pressed_color: "White", pressed_brightness: 75},
        ]);
        const night = c4Device({buttons: {1: hall}, inputs: {pressed_colour: "White", night_enabled: true, night_needs_dark: false}, time: "22:30:00"});
        expect(night.on(change("light.hall", 200)).led("button_1")).toMatchObject({pressed_color: "White", pressed_brightness: 10});
    });

    describe("a Scene button (ADR 0003)", () => {
        const scene = (level: number | "off" = 128) => ({buttons: {1: {mode: "scene", targets: ["light.den"], action: sceneApply({"light.den": level})}}});

        it("is lit while its Scene is Active: every target at its level, to within 2 points", () => {
            const look = (den: StateSpec) =>
                c4Device({...scene(), states: {"light.den": den}})
                    .on(boot())
                    .led("button_1")?.color;
            // 2 points of 100 are 5.1 of 255: 5 off is Active, 6 off is not.
            expect([look(128), look(133), look(123), look(134), look(122), look("off"), look("on")]).toEqual([
                "Green",
                "Green",
                "Green",
                "Off",
                "Off",
                "Off",
                "Off",
            ]);
        });

        it("is lit by its Scene alone, whatever When an LED watches several entities says", () => {
            const two = {buttons: {1: {mode: "scene", targets: ["light.den", "light.hall"], action: sceneApply({"light.den": 128, "light.hall": "off"})}}};
            expect(
                c4Device({...two, inputs: {led_match: "all"}, states: {"light.den": 128}})
                    .on(boot())
                    .led("button_1")?.color,
            ).toBe("Green");
            expect(
                c4Device({...two, states: {"light.den": 128, "light.hall": 200}})
                    .on(boot())
                    .led("button_1")?.color,
            ).toBe("Off");
        });

        it("with watches, shows them like any other button, not its Scene", () => {
            const watched = {buttons: {1: {...scene().buttons[1], watch: ["switch.fan"]}}};
            expect(
                c4Device({...watched, states: {"light.den": 128, "switch.fan": "off"}})
                    .on(boot())
                    .led("button_1")?.color,
            ).toBe("Off");
            expect(
                c4Device({...watched, states: {"light.den": 50, "switch.fan": "on"}})
                    .on(boot())
                    .led("button_1")?.color,
            ).toBe("Green");
        });

        it("is Active to within 5.1 of 255, a brightness_pct level included", () => {
            // 50.160784 % is 127.91: 133 is 5.09 off. 50.152941 % is 127.89: 133 is 5.11 off.
            const pct = (p: number) => ({
                buttons: {
                    1: {
                        mode: "scene",
                        targets: ["light.den"],
                        action: [{action: "scene.apply", data: {entities: {"light.den": {state: "on", brightness_pct: p}}}}],
                    },
                },
            });
            const look = (p: number) =>
                c4Device({...pct(p), states: {"light.den": 133}})
                    .on(boot())
                    .led("button_1")?.color;
            expect([look(50.160784), look(50.152941)]).toEqual(["Green", "Off"]);
        });

        it("an off level is Active while its light is off", () => {
            expect(
                c4Device({...scene("off"), states: {"light.den": "off"}})
                    .on(boot())
                    .led("button_1")?.color,
            ).toBe("Green");
        });

        it("may be written with the older service: key", () => {
            const service = {
                buttons: {
                    1: {
                        mode: "scene",
                        targets: ["light.den"],
                        action: [{service: "scene.apply", data: {entities: {"light.den": {state: "on", brightness: 128}}}}],
                    },
                },
            };
            expect(
                c4Device({...service, states: {"light.den": 128}})
                    .on(boot())
                    .led("button_1"),
            ).toEqual({color: "Green", brightness: 75});
        });

        it("shows the Fault colour while the Scene and Targets name different lights", () => {
            const other = {buttons: {1: {mode: "scene", targets: ["light.den"], action: sceneApply({"light.hall": 128})}}, states: {"light.den": 128}};
            expect(c4Device(other).on(boot()).led("button_1")).toEqual({color: "Red", brightness: 75});
        });

        it("repaints on its light's brightness alone, follow or not", () => {
            expect(
                c4Device({...scene(), states: {"light.den": 100}})
                    .on(change("light.den", 128))
                    .led("button_1")?.color,
            ).toBe("Green");
        });

        it("at night, a night colour wins over the Fault colour", () => {
            const other = {
                buttons: {1: {mode: "scene", targets: ["light.den"], action: sceneApply({"light.hall": 128}), night_off: "Purple"}},
                inputs: {night_enabled: true, night_needs_dark: false},
                time: "23:00:00",
            };
            expect(c4Device(other).on(boot()).led("button_1")).toEqual({color: "Purple", brightness: 10});
        });
    });
});

describe("the events a model sends", () => {
    it("are only those the contract fixture records for its model: an FS1-Z sends no release", () => {
        const fs1 = c4Device({model: "C4-FS1-Z", buttons: {1: {targets: ["light.fire"]}}});
        expect(() => fs1.on(release(1))).toThrow(/no release for a C4-FS1-Z/);
        expect(() => fs1.play("unknownTap", 1)).toThrow(/no unknownTap sequence for a C4-FS1-Z/);
    });

    it("an event its entity does not declare starts no run, as Home Assistant drops it", () => {
        const fs1 = c4Device({model: "C4-FS1-Z", buttons: {1: {targets: ["light.fire"]}}, eventsEntity: [GESTURES.single]});
        expect(fs1.runs(knownTap(1))).toEqual([]);
        expect(fs1.on(deviceCount(1)).does).toBe("nothing");
    });

    it("a DIM1-Z's hold is its paddle held: the fixture has none, so it is made from its press", () => {
        expect(c4Device({model: "C4-DIM1-Z", buttons: {1: {targets: ["light.hall"]}}}).on(hold(1)).does).toBe("hold");
    });

    it("refuses a model that is not a Control4 wall device", () => {
        expect(() => c4Device({model: "C4-NOPE"})).toThrow(/C4-NOPE/);
    });

    it("taps a button whose own actions publish over MQTT: an input never makes an option the LED feedback", () => {
        const elsewhere = [{action: "mqtt.publish", data: {topic: "zigbee2mqtt/other/set", payload: "{}"}}];
        expect(c4Device({buttons: {1: {targets: ["light.hall"], action: elsewhere}}}).on(knownTap(1))).toMatchObject({does: "tap", leds: []});
        expect(c4Device({buttons: {1: {targets: ["light.hall"]}, 2: {double: elsewhere}}}).on(knownTap(1)).does).toBe("tap");
    });

    it("refuses a model the converter defines but c4_device's device selector does not offer", () => {
        for (const model of ["C4-SR260", "C4-SR250B", "C4-Z2IO-ZP"]) expect(() => c4Device({model}), model).toThrow(`'${model}'`);
    });

    it("refuses another spelling of a model: Zigbee2MQTT reports the model itself as the model_id", () => {
        for (const model of ["C4-DIM1-Z-W", "DIMZ-1B1", "c4-kp3-z", "C4-KP3-Z-xyz", " C4-KP3-Z"]) expect(() => c4Device({model}), model).toThrow(`'${model}'`);
    });
});

// #51: a model whose declared events can't run a tap under the default response once
// passed, because nothing played that model's own events.
describe("every model the picker offers, played its own events from the contract fixture", () => {
    const PICKER = c4DeviceBlueprint().inputs.get("c4_device")?.models ?? [];
    /** What a sequence's events make c4_device do, leaving out the events that do nothing. */
    const doing = (rs: {does: string}[]) => rs.map((r) => r.does).filter((d) => d !== "nothing");
    const plain = {targets: ["light.hall"], hold: false};

    it("is every model c4_device names", () => {
        expect(PICKER).toHaveLength(9);
    });

    it.each(PICKER.flatMap((model) => ["auto", "fast", "instant", "wait"].map((response) => [model, response])))(
        "a %s's single tap runs its tap once under %s",
        (model, response) => {
            expect(doing(c4Device({model, buttons: {1: plain}, inputs: {tap_response: response}}).play("tap", 1))).toEqual(["tap"]);
        },
    );

    it.each(PICKER)("a %s's double tap, under the default response, commits its first tap toward ON early and runs the double-tap action", (model) => {
        expect(doing(c4Device({model, buttons: {1: {...plain, double: anyAction}}}).play("double", 1))).toEqual(["early commit", "double"]);
    });

    it.each(PICKER.filter((model) => sequences({model, ieee: "0x0", name: "x"}, 1).hold.length))(
        "a %s's hold starts one hold-to-dim, on a button that does not drive its own load",
        (model) => {
            const dev = c4Device({
                model,
                buttons: {1: {targets: ["light.hall"]}},
                buttonBehaviour: ["C4-APD120", "C4-SW120277"].includes(model) ? {top: "event_only"} : undefined,
            });
            expect(doing(dev.play("hold", 1))).toEqual(["hold"]);
        },
    );
});

describe("hearing the device (ADR 0005)", () => {
    it("on boot or reload, says whether the device has a Control4 events entity", () => {
        expect([c4Device().on(boot()).hears, c4Device().on(reload()).hears, c4Device({eventsEntity: false}).on(reload()).hears]).toEqual([true, true, false]);
    });

    it("hears it only by an events entity that has the single-tap command among its event types", () => {
        expect(c4Device({eventsEntity: ["remote_button_long_press"]}).on(boot()).hears).toBe(false);
        expect(c4Device({eventsEntity: ["remote_button_short_press"]}).on(boot()).hears).toBe(true);
    });

    it.each(["C4-FS1-Z", "C4-4SF120", "LOZ-5S1-W"])("a %s is checked too, though it has no LEDs to paint", (model) => {
        const r = c4Device({model, buttons: {1: {targets: ["light.hall"]}}}).on(boot());
        expect([r.hears, r.leds]).toEqual([true, []]);
        expect(c4Device({model, eventsEntity: false}).on(reload()).hears).toBe(false);
    });

    it("a device with no events entity starts no run on its button events", () => {
        expect(c4Device({eventsEntity: false, buttons: {1: {targets: ["light.hall"]}}}).runs(knownTap(1))).toEqual([]);
    });

    it("the clock starts the runs Home Assistant's time triggers would: at Night start, its own and the LED re-check", () => {
        const kp = c4Device({buttons: {1: {targets: ["light.hall"]}}});
        expect(kp.runs(clock("21:00:00")).map((r) => [r.trigger, r.passes])).toEqual([
            ["led", true],
            ["led", true],
        ]);
        // The LED re-check: every hour by default, or every 30 minutes.
        const at = (time: string, k = kp) => k.runs(clock(time)).length;
        expect([at("13:00:00"), at("13:00:01"), at("12:30:00"), at("12:05:00"), at("21:02:00")]).toEqual([1, 0, 0, 0, 0]);
        const halfHourly = c4Device({buttons: {1: {targets: ["light.hall"]}}, inputs: {led_resync: "/30"}});
        expect([at("12:30:00", halfHourly), at("13:00:00", halfHourly), at("12:05:00", halfHourly)]).toEqual([1, 1, 0]);
    });

    it("an LED run that is no boot or reload says nothing about it", () => {
        const reaction = c4Device({buttons: {1: {targets: ["light.hall"]}}}).on(clock("13:00:00"));
        expect(reaction.runs).toHaveLength(1);
        expect(reaction.hears).toBeUndefined();
    });
});

describe("a template that fails", () => {
    it("fails the happening loudly, as Home Assistant aborts the run", () => {
        const kp = c4Device({inputs: {led_on_brightness: "bright"}, buttons: {1: {targets: ["light.hall"]}}});
        expect(() => kp.on(change("light.hall", 200))).toThrow(C4TemplateError);
        expect(() => kp.on(change("light.hall", 200))).toThrow(/led step calls: .*'bright'/);
    });
});

describe("Home Assistant's typing of rendered variables", () => {
    const btnAction = (action: unknown[]) =>
        (c4Device({buttons: {1: {targets: ["light.hall"], action}}}).runs(knownTap(1))[0].variables.btn as {action: unknown}).action;

    it("gives back a Tap action's text as written, quotes and backslashes included", () => {
        const action = [{action: "notify.notify", data: {message: `it's a "quoted" \\ path`}}];
        expect(btnAction(action)).toEqual(action);
    });

    it("gives back line breaks, tabs and other control characters in a Tap action's text", () => {
        const action = [{action: "notify.notify", data: {message: "line 1\r\nline 2\tend\u0007"}}];
        expect(btnAction(action)).toEqual(action);
    });

    it("leaves text with no template in it as it is: not typed, not trimmed", () => {
        const action = [{action: "light.turn_on", data: {brightness: "50", flash: "True", name: "  padded  "}}];
        expect(btnAction(action)).toEqual(action);
    });
});

describe("a run read in the domain's words (tools/c4-device-run.mjs)", () => {
    it("refuses a passing run whose variables say two things at once, or nothing", () => {
        expect(() => readRun({tid: "known", bi: 0, is_tap: true, early: true}, true)).toThrow(/tap and early commit/);
        expect(() => readRun({tid: "known", bi: 0}, true)).toThrow(/nothing to do/);
    });

    it("reads a run whose condition failed as doing nothing, whatever its variables say", () => {
        expect(readRun({tid: "known", bi: 0, is_tap: true, early: true}, false)).toMatchObject({does: "nothing", button: 1});
    });
});

describe("a device set up", () => {
    it("refuses an input the blueprint does not declare", () => {
        expect(() => c4Device({inputs: {tap_responce: "fast"}})).toThrow(/tap_responce/);
        expect(() => c4Device({buttons: {1: {target: ["light.a"]} as never}})).toThrow(/b1_target/);
    });

    it("refuses to pick the device: it is always the one set up", () => {
        expect(() => c4Device({inputs: {c4_device: "another"}})).toThrow(/c4_device/);
    });

    it("refuses a button input given both under buttons and by its blueprint name", () => {
        expect(() => c4Device({buttons: {1: {targets: ["light.a"]}}, inputs: {b1_targets: ["light.b"]}})).toThrow(/b1_targets/);
    });

    it("refuses a time that is not HH:MM:SS, as now() would never show it", () => {
        expect(() => c4Device({time: "7:30:00"})).toThrow(/7:30:00/);
        expect(() => c4Device().on(clock("25:00:00"))).toThrow(/25:00:00/);
    });
});

describe("the template engine standing in for Home Assistant's", () => {
    it("renders every Jinja construct c4_device relies on as HA 2026.10.4 rendered it", () => {
        // tools/ha-validate-blueprints.mjs renders the same template on a live HA, by hand.
        const probe = fs.readFileSync(path.join(FIXTURES, "jinja-conformance.jinja"), "utf8");
        const ha = fs.readFileSync(path.join(FIXTURES, "jinja-conformance.expected"), "utf8");
        expect(renderTemplate(probe).trim()).toBe(ha.trim());
    });

    it("reads a number as Python's int and float do: ASCII and Unicode spaces around it, not U+001C-U+001F or a byte order mark", () => {
        // As HA 2026.10.4 rendered the same values: [0, 0, 0, 5, 5, 0, 2.5, 0, 2.5, 7].
        const v = ["5\u001f", "\u001c5", "5﻿", "5\u0085", " 5\t", "5.5\u001f", "2.5\u0085", "2.5﻿", "2.5　", "7 "];
        const filters = ["int", "int", "int", "int", "int", "int", "float", "float", "float", "int"];
        const source = `[${filters.map((f, i) => `v[${i}] | ${f}(0)`).join(", ")}]`;
        expect(renderTemplate(`{{ ${source} }}`, {v})).toBe("[0, 0, 0, 5, 5, 0, 2.5, 0, 2.5, 7]");
    });
});
