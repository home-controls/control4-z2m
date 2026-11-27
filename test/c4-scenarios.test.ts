// The live scenario runner's command line. Refused cases exit before connecting;
// accepted ones fail at the connection step (port 9 is no Home Assistant), so no HA is needed and no light changes.
import {spawnSync} from "node:child_process";
import path from "node:path";

import {describe, expect, it} from "vitest";

import {FAN_BUTTONS, OUTLET_BUTTONS} from "../src/core/constants";
import {
    buttonConfig,
    checkKnownTaps,
    checkMultiTap,
    drivesLoad,
    expectedLed,
    ledNumbers,
    namedEntities,
    prepareCall,
    sceneOf,
    sceneState,
    sequences,
    starts,
    tapSource,
    towardOn,
} from "../tools/c4-scenarios.mjs";
import {showEvent} from "./contract";

const TOOL = path.resolve(__dirname, "..", "tools", "c4-scenarios.mjs");

function run(...args: string[]) {
    // Port 9 (discard) is never Home Assistant: a run that got as far as connecting fails differently.
    const r = spawnSync(process.execPath, [TOOL, "--device", "Keypad A", ...args], {
        env: {...process.env, HA_URL: "http://127.0.0.1:9", HA_TOKEN: "x"},
        encoding: "utf8",
        timeout: 20_000,
    });
    return {status: r.status, err: r.stderr};
}

describe("c4-scenarios command line", () => {
    it("refuses an unknown scenario name and lists the real ones", () => {
        const r = run("--only", "tapp");
        expect(r.status).toBe(2);
        expect(r.err).toMatch(/unknown scenario 'tapp'.*tap, known, fallback, double, triple, hold, led, idle, unknown, rename, stale/);
    });

    it("refuses an empty scenario list", () => {
        expect(run("--only", "").status).toBe(2);
    });

    it("refuses idle without tap, which it observes", () => {
        const r = run("--only", "idle");
        expect(r.status).toBe(2);
        expect(r.err).toMatch(/idle needs tap/);
    });

    it.each([
        [["--only"], /--only needs a value/],
        [["--only", "--button", "2"], /--only needs a value/],
        [["--button"], /--button needs a value/],
        [["--only=hold"], /unknown option '--only=hold'/],
        [["--buton", "2"], /unknown option '--buton'/],
        [["stray"], /unknown option 'stray'/],
    ])("refuses %j", (args, message) => {
        const r = run(...(args as string[]));
        expect(r.status).toBe(2);
        expect(r.err).toMatch(message as RegExp);
    });

    it("refuses an option given twice instead of keeping one of them", () => {
        const r = run("--only", "tap", "--only", "hold");
        expect(r.status).toBe(2);
        expect(r.err).toMatch(/--only given twice/);
    });

    // Accepted command lines get as far as connecting (and fail there: port 9 is no HA).
    it.each([
        [["--button", "6", "--only", "tap,idle"]],
        [["--button", "1"]],
        [["--only", "unknown,rename,stale"]],
        [["--only", "known,fallback"]],
        [["--only", "double,triple,led"]],
        [[]],
    ])("accepts %j", (args) => {
        const r = run(...args);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/websocket error talking to http:\/\/127\.0\.0\.1:9/);
    });

    it.each(["abc", "0", "7", "1.5"])("refuses button %s", (b) => {
        const r = run("--button", b);
        expect(r.status).toBe(2);
        expect(r.err).toMatch(/--button/);
    });
});

// The sequences the runner publishes, built from the contract fixture, with
// the measured keypad timing: release +0.1 s, fast count +0.65 s and device
// count +1.7 s after the last press, hold +0.52 s and its release +2.5 s.
describe("c4-scenarios sequences", () => {
    const dev = (model: string) => ({ieee: "0x000fff00000000aa", name: "Hall", model});
    const show = (seq: {at: number; payload: Record<string, unknown>}[]) => seq.map(({at, payload: p}) => `${showEvent(p, p.gesture)}@${at}`);

    it("builds a keypad's known tap, known double tap, not-known tap and hold", () => {
        const s = sequences(dev("KPZ-3B1"), 2);
        expect(show(s.tap)).toEqual(["press@0", "release@100", "tap_known #1@100", "fast_single known=true@650", "single@1700"]);
        expect(show(s.double)).toEqual([
            "press@0",
            "release@100",
            "tap_known #1@100",
            "press@200",
            "release@300",
            "tap_known #2@300",
            "fast_double known=true@850",
            "double@1900",
        ]);
        expect(show(s.unknownTap)).toEqual(["press@0", "release@100", "fast_single known=false@650", "single@1700"]);
        expect(show(s.hold)).toEqual(["press@0", "hold@520", "hold_release@2500"]);
    });

    it("builds a triple tap from the known double tap: its second tap once more, counted three", () => {
        expect(show(sequences(dev("KPZ-3B1"), 1).triple)).toEqual([
            "press@0",
            "release@100",
            "tap_known #1@100",
            "press@200",
            "release@300",
            "tap_known #2@300",
            "press@400",
            "release@500",
            "tap_known #3@500",
            "fast_triple known=true@1050",
            "triple@2100",
        ]);
        expect(show(sequences(dev("C4-DIM1-Z"), 2).triple)).toEqual([
            "press@0",
            "tap_known #1@0",
            "press@200",
            "tap_known #2@200",
            "press@400",
            "tap_known #3@400",
            "fast_triple known=true@1050",
            "triple@2100",
        ]);
        const counts = sequences(dev("C4-KC120277"), 2)
            .triple.slice(-2)
            .map((s) => s.payload);
        expect(counts).toMatchObject([
            {gesture: "fast_triple", command: "remote_button_fast_triple_press", action: "button_2_fast_triple"},
            {gesture: "triple", command: "remote_button_triple_press", action: "button_2_triple"},
        ]);
    });

    it("spaces a double tap's presses by the gap it is given", () => {
        expect(show(sequences(dev("KPZ-3B1"), 1, 450).double)).toEqual([
            "press@0",
            "release@100",
            "tap_known #1@100",
            "press@450",
            "release@550",
            "tap_known #2@550",
            "fast_double known=true@1100",
            "double@2150",
        ]);
    });

    it("announces a DIM1-Z's taps at paddle-down, and has no not-known tap or hold", () => {
        const s = sequences(dev("C4-DIM1-Z"), 1);
        expect(show(s.tap)).toEqual(["press@0", "tap_known #1@0", "fast_single known=true@650", "single@1700"]);
        expect(show(s.double)).toEqual(["press@0", "tap_known #1@0", "press@200", "tap_known #2@200", "fast_double known=true@850", "double@1900"]);
        expect(s.unknownTap).toEqual([]);
        expect(s.hold).toEqual([]);
    });

    // #51: an FS1-Z played the keypad's events, press, release and all.
    it("plays an FS1-Z its own events: taps announced at paddle-down, a hold with no paddle-down before it", () => {
        const s = sequences(dev("C4-FS1-Z"), 2);
        expect(show(s.tap)).toEqual(["press@0", "tap_known #1@0", "fast_single known=true@650", "single@1700"]);
        expect(show(s.double)).toEqual(["press@0", "tap_known #1@0", "press@200", "tap_known #2@200", "fast_double known=true@850", "double@1900"]);
        expect(s.unknownTap).toEqual([]);
        expect(show(s.hold)).toEqual(["hold@520", "hold_release@2500"]);
        for (const e of Object.values(s).flat()) expect(e.payload).toMatchObject({model: "C4-FS1-Z", button: "button_2", button_id: 1});
    });

    it("refuses a model the contract fixture has no events for, instead of playing it another's", () => {
        for (const model of ["C4-SR260", "C4-Z2IO-ZP", "C4-NOPE", ""])
            expect(() => sequences(dev(model), 1), model).toThrow(/the contract fixture has no events for/);
    });

    it("plays the fan and the outlet a KC120277's c4.dmx button events, a not-known tap and a hold included", () => {
        for (const model of ["C4-4SF120", "LOZ-5S1-W"]) {
            const s = sequences(dev(model), 1);
            const kc = sequences(dev("C4-KC120277"), 1);
            for (const k of ["tap", "double", "triple", "unknownTap", "hold"] as const) expect(show(s[k]), `${model} ${k}`).toEqual(show(kc[k]));
        }
    });

    it("addresses the fan's Buttons 1-6 from the top and the outlet's 1 and 2, as the extension names them", () => {
        const at = (model: string, button: number) => sequences(dev(model), button).tap[0].payload;
        expect([1, 2, 3, 4, 5, 6].map((n) => at("C4-4SF120", n))).toMatchObject(
            Object.entries(FAN_BUTTONS).map(([id, name]) => ({button: name, button_id: Number(id), action: `${name}_press`})),
        );
        expect([1, 2].map((n) => at("LOZ-5S1-W", n))).toMatchObject(
            Object.entries(OUTLET_BUTTONS).map(([id, name]) => ({button: name, button_id: Number(id)})),
        );
        expect(() => at("LOZ-5S1-W", 3)).toThrow(/LOZ-5S1-W has no Button 3/);
    });

    it("addresses every event to the device and button, numbering a KC120277's buttons 0, 2, 4", () => {
        const kc = Object.values(sequences(dev("C4-KC120277"), 3)).flat();
        expect(kc.length).toBeGreaterThan(0);
        for (const e of kc) {
            expect(e.payload).toMatchObject({
                ieee: "0x000fff00000000aa",
                device: "Hall",
                model: "C4-KC120277",
                button: "button_3",
                button_id: 4,
                action: `button_3_${e.payload.gesture}`,
            });
        }
        expect(sequences(dev("C4-KP6-Z"), 3).tap[0].payload.button_id).toBe(2);
    });

    it.each([
        ["C4-DIM1-Z", 1, {localSwitchOn: true}, true],
        ["C4-DIM1-Z", 2, {localSwitchOn: false}, false],
        ["C4-APD120", 1, {}, true],
        ["C4-APD120", 1, {behaviour: {top: "load_on"}}, true],
        ["C4-APD120", 2, {behaviour: {top: "event_only", bottom: "momentary"}}, true],
        ["C4-APD120", 1, {behaviour: {top: "event_only", bottom: "momentary"}}, false],
        ["C4-SW120277", 2, {behaviour: {bottom: "event_only"}}, false],
        ["C4-SW120277", 1, {localSwitchOn: false}, true],
        ["C4-SW120277", 1, {localSwitchOn: true, behaviour: {top: "event_only"}}, false],
        ["C4-KC120277", 1, {}, false],
        ["C4-4SF120", 2, {}, false],
    ])("knows whether a %s's Button %s (%j) drives its own load, which a hold ramps itself: %s", (model, button, read, drives) => {
        expect(drivesLoad(model as string, button as number, read as object)).toBe(drives);
    });

    it.each(["C4-APD120", "C4-SW120277"])("addresses a %s's Button 1 and 2 as its top and bottom paddle halves", (model) => {
        for (const [button, name, id] of [
            [1, "top", 1],
            [2, "bottom", 5],
        ] as const) {
            const evs = Object.values(sequences(dev(model), button)).flat();
            expect(evs.length).toBeGreaterThan(0);
            for (const e of evs) expect(e.payload).toMatchObject({model, button: name, button_id: id, action: `${name}_${e.payload.gesture}`});
        }
    });
});

// The known scenario's verdict: each known tap of a double tap acted once on the button's targets.
describe("c4-scenarios known-tap verdict", () => {
    /** A known double tap as HA saw it: known taps at 100 and 550 ms, the fast count at 1100. */
    const FIRED = [
        {t: 0, data: {gesture: "press"}},
        {t: 100, data: {gesture: "tap_known", tap_index: 1}},
        {t: 450, data: {gesture: "press"}},
        {t: 550, data: {gesture: "tap_known", tap_index: 2}},
        {t: 1100, data: {gesture: "fast_double", known_taps: true}},
    ];
    const view = (s: string) => {
        const [state, bri] = s.split(" @");
        return {state, attributes: bri ? {brightness: Number(bri)} : {}};
    };
    const change = (t: number, entity_id: string, from: string, to: string) => ({t, entity_id, from, to, state: view(to)});
    /** Each target's state as prepare() leaves it for the button's mode (from prepareCall); untouched targets off. */
    const prepared = (cfg: {mode: string; targets: string[]}) => {
        const call = prepareCall(cfg);
        const touched = [].concat((call?.service_data.entity_id ?? []) as never) as string[];
        const on = call?.service === "turn_on" ? `on @${call.service_data.brightness ?? 255}` : "off";
        return Object.fromEntries(cfg.targets.map((e) => [e, view(touched.includes(e) ? on : "off")]));
    };
    /** The verdict, from the targets' states when observation starts (by default, as prepare() leaves them). */
    const verdict = (cfg: Parameters<typeof checkKnownTaps>[0], fired: typeof FIRED, changes: ReturnType<typeof change>[], start = prepared(cfg)) =>
        checkKnownTaps(cfg, {fired, changes, startStates: start});
    const toggle = {mode: "toggle", targets: ["light.a", "light.b"]};

    it("leaves a room member that starts unavailable unjudged", () => {
        const cfg = {mode: "room_off", targets: ["light.a", "light.dead"]};
        const r = verdict(cfg, FIRED, [change(200, "light.a", "on @255", "off")], {"light.a": view("on @255"), "light.dead": view("unavailable")});
        expect(r.ok).toBe(true);
        expect(r.lines.join(" ")).toMatch(/light.dead is unavailable: not judged/);
    });

    it("judges Brighten from the brightest lit light's real level, as c4_device steps from it", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        const changes = [change(200, "light.a", "on @129", "on @155"), change(700, "light.a", "on @155", "on @181")];
        expect(verdict(cfg, FIRED, changes, {"light.a": view("on @129")}).ok).toBe(true);
    });

    it("does not judge a light without a brightness on Brighten", () => {
        const cfg = {mode: "brighten", targets: ["light.a", "light.relay"], tapStep: 10};
        const changes = [change(200, "light.a", "on @128", "on @154"), change(700, "light.a", "on @154", "on @180")];
        const r = verdict(cfg, FIRED, changes, {"light.a": view("on @128"), "light.relay": view("on")});
        expect(r.ok).toBe(true);
        expect(r.lines.join(" ")).toMatch(/light.relay has no brightness: not judged/);
    });

    it("counts any state but off, unavailable or unknown as on, as c4_device does", () => {
        const cfg = {mode: "on", targets: ["media_player.tv"]};
        expect(verdict(cfg, FIRED, [change(200, "media_player.tv", "off", "idle")]).ok).toBe(true);
    });

    it("waits for a Brighten light's last step to settle, like the other modes", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        const changes = [change(200, "light.a", "on @128", "on @154"), change(1300, "light.a", "on @154", "on @180")];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
    });

    it("toggles targets that start mixed as one group, as c4_device does: off while any is on, then on", () => {
        const start = {"light.a": view("on @255"), "light.b": view("off")};
        const group = [change(200, "light.a", "on @255", "off"), change(700, "light.a", "off", "on @255"), change(700, "light.b", "off", "on @255")];
        expect(verdict(toggle, FIRED, group, start).ok).toBe(true);
        expect(verdict({...toggle, mode: "room_master"}, FIRED, group, start).ok).toBe(true);
        // Each target flipped on its own: c4_device never does this.
        const apart = [
            change(200, "light.a", "on @255", "off"),
            change(700, "light.a", "off", "on @255"),
            change(200, "light.b", "off", "on @255"),
            change(700, "light.b", "on @255", "off"),
        ];
        expect(verdict(toggle, FIRED, apart, start).ok).toBe(false);
    });

    describe("on a Scene button", () => {
        const scene = {mode: "scene", targets: ["light.a", "switch.s"], scene: {"light.a": {state: "on", level: 120}, "switch.s": {state: "off", level: null}}};

        it("wants each target in its Scene state after two taps from off: the second applies the Scene again", () => {
            expect(verdict(scene, FIRED, [change(200, "light.a", "off", "on @122")]).ok).toBe(true);
            // A second tap that turned it off, as a Toggle would.
            const r = verdict(scene, FIRED, [change(200, "light.a", "off", "on @120"), change(700, "light.a", "on @120", "off")]);
            expect(r.ok).toBe(false);
            expect(r.lines.join(" ")).toMatch(/light.a ended off, not on/);
        });

        it("wants a light within 2 points of its Scene level", () => {
            const r = verdict(scene, FIRED, [change(200, "light.a", "off", "on @126")]);
            expect(r.ok).toBe(false);
            expect(r.lines.join(" ")).toMatch(/light.a ended at 126, not 120 \(the Scene's level\)/);
        });

        it("fails a target the Tap action's Scene does not name", () => {
            const r = verdict({...scene, scene: {"light.a": scene.scene["light.a"]}}, FIRED, [change(200, "light.a", "off", "on @120")]);
            expect(r.ok).toBe(false);
            expect(r.lines.join(" ")).toMatch(/switch.s is not in the Tap action's Scene/);
        });
    });

    it("passes an On target that was already on and stayed on", () => {
        const cfg = {mode: "on", targets: ["light.a", "light.b"]};
        const r = verdict(cfg, FIRED, [change(200, "light.a", "off", "on @255")], {"light.a": view("off"), "light.b": view("on @255")});
        expect(r.ok).toBe(true);
    });

    it("does not count a change after the fast count as a multi-tap button's Toggle target having changed", () => {
        const cfg = {mode: "toggle", targets: ["light.a", "light.b"], multi: true};
        const changes = [change(200, "light.a", "off", "on @255"), change(700, "light.a", "on @255", "off"), change(1300, "light.b", "off", "on @255")];
        const r = verdict(cfg, FIRED, changes);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.b never changed/);
    });

    it("leaves Brighten unjudged when no light was lit to step from", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        const r = verdict(cfg, FIRED, [change(200, "light.a", "off", "on @255")], {"light.a": view("off")});
        expect(r.ok).toBe(true);
        expect(r.lines.join(" ")).toMatch(/no light with a brightness was lit/);
    });

    it("fails a target that goes unavailable during the taps, though c4_device counts unavailable as off", () => {
        const changes = [change(200, "light.a", "off", "on @255"), change(700, "light.a", "on @255", "off"), change(200, "light.b", "off", "unavailable")];
        const r = verdict(toggle, FIRED, changes);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.b ended unavailable/);
        const dim = {mode: "dim", targets: ["light.a"], tapStep: 10, dimFloor: 45};
        expect(verdict(dim, FIRED, [change(200, "light.a", "on @128", "on @102"), change(700, "light.a", "on @102", "unavailable")]).ok).toBe(false);
    });

    it("leaves a light that is off unjudged on Brighten, even with a brightness left in its state", () => {
        const cfg = {mode: "brighten", targets: ["light.a", "light.b"], tapStep: 10};
        const changes = [change(200, "light.a", "on @128", "on @154"), change(700, "light.a", "on @154", "on @180")];
        const r = verdict(cfg, FIRED, changes, {"light.a": view("on @128"), "light.b": view("off @128")});
        expect(r.ok).toBe(true);
        expect(r.lines.join(" ")).toMatch(/light.b was off: not judged/);
    });

    it("steps every Brighten light from the brightest lit one, as c4_device's cur", () => {
        const cfg = {mode: "brighten", targets: ["light.a", "light.b"], tapStep: 10};
        const both = (t: number, from: string, to: string) =>
            ["light.a", "light.b"].map((e) => change(t, e, e === "light.a" && from === "start" ? "on @100" : from === "start" ? "on @140" : from, to));
        const changes = [...both(200, "start", "on @166"), ...both(700, "on @166", "on @192")];
        expect(verdict(cfg, FIRED, changes, {"light.a": view("on @100"), "light.b": view("on @140")}).ok).toBe(true);
    });

    it("leaves an On target that starts unavailable unjudged, where judging it would fail", () => {
        const cfg = {mode: "on", targets: ["light.a", "light.dead"]};
        const r = verdict(cfg, FIRED, [change(200, "light.a", "off", "on @255")], {"light.a": view("off"), "light.dead": view("unavailable")});
        expect(r.ok).toBe(true);
    });

    it("leaves a target HA doesn't have unjudged", () => {
        const cfg = {mode: "on", targets: ["light.a", "light.gone"]};
        const r = verdict(cfg, FIRED, [change(200, "light.a", "off", "on @255")], {"light.a": view("off")});
        expect(r.ok).toBe(true);
        expect(r.lines.join(" ")).toMatch(/light.gone is not found: not judged/);
    });

    it("says a multi-tap button is judged at the fast count", () => {
        const cfg = {mode: "toggle", targets: ["light.a"], multi: true};
        const changes = [change(200, "light.a", "off", "on @255"), change(700, "light.a", "on @255", "off")];
        expect(verdict(cfg, FIRED, changes).lines.join(" ")).toMatch(/judged at the fast count/);
    });

    it("says what a Toggle verdict cannot judge", () => {
        const changes = ["light.a", "light.b"].flatMap((e) => [change(200, e, "off", "on @255"), change(700, e, "on @255", "off")]);
        expect(verdict(toggle, FIRED, changes).lines.join(" ")).toMatch(/not judged: a tap that runs twice before the next/);
    });

    it("passes a Toggle double tap that flipped every target twice", () => {
        const changes = ["light.a", "light.b"].flatMap((e) => [change(200, e, "off", "on @255"), change(700, e, "on @255", "off")]);
        expect(verdict(toggle, FIRED, changes).ok).toBe(true);
    });

    it("fails a Toggle double tap whose taps landed as one, though each light reported its turn-on twice", () => {
        const changes = ["light.a", "light.b"].flatMap((e) => [change(200, e, "off", "on @3"), change(400, e, "on @3", "on @255")]);
        const r = verdict(toggle, FIRED, changes);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.a ended on, not off/);
    });

    it("fails a Toggle double tap that never changed one of its targets, though it ends where it started", () => {
        const changes = [change(200, "light.a", "off", "on @255"), change(700, "light.a", "on @255", "off")];
        const r = verdict(toggle, FIRED, changes);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.b never changed/);
    });

    it("fails a Toggle double tap where a tap acted twice", () => {
        const changes = ["light.a", "light.b"].flatMap((e) => [
            change(200, e, "off", "on @255"),
            change(300, e, "on @255", "off"),
            change(700, e, "off", "on @255"),
        ]);
        expect(verdict(toggle, FIRED, changes).ok).toBe(false);
    });

    it("passes a Brighten double tap that stepped each light twice, whatever its switch did", () => {
        const cfg = {mode: "brighten", targets: ["light.a", "switch.s"], tapStep: 10};
        const changes = [change(200, "light.a", "on @128", "on @154"), change(700, "light.a", "on @154", "on @180")];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
    });

    it("fails a Brighten double tap that stepped once, though the light reported a level on the way", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        const changes = [change(200, "light.a", "on @128", "on @141"), change(300, "light.a", "on @141", "on @154")];
        const r = verdict(cfg, FIRED, changes);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.a was at 154 after known tap #2, not 180/);
    });

    it("expects a Brighten light to stop at full brightness", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 50};
        expect(verdict(cfg, FIRED, [change(200, "light.a", "on @128", "on @255")]).ok).toBe(true);
    });

    it("expects a Dim light two steps down", () => {
        const cfg = {mode: "dim", targets: ["light.a"], tapStep: 10};
        const changes = [change(200, "light.a", "on @128", "on @102"), change(700, "light.a", "on @102", "on @76")];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
    });

    it("expects a Dim tap at or below the dim floor to turn the light off", () => {
        // Floor 45% is 114.75: one step takes 128 to 102, below it, so the second tap turns the light off.
        const cfg = {mode: "dim", targets: ["light.a"], tapStep: 10, dimFloor: 45};
        const changes = [change(200, "light.a", "on @128", "on @102"), change(700, "light.a", "on @102", "off")];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
        const r = verdict(cfg, FIRED, changes.slice(0, 1));
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.a was at 102 after known tap #2, not off/);
    });

    it("steps by tap_step x 2.55 rounded as Home Assistant rounds it, half to even", () => {
        // 30 x 2.55 = 76.5 -> 76: 128 -> 52, still above floor 20% (51), then down to 3.
        const cfg = {mode: "dim", targets: ["light.a"], tapStep: 30, dimFloor: 20};
        const changes = [change(200, "light.a", "on @128", "on @52"), change(700, "light.a", "on @52", "on @3")];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
    });

    it("expects a Dim light to stop at the lowest level", () => {
        const cfg = {mode: "dim", targets: ["light.a"], tapStep: 25};
        const changes = [change(200, "light.a", "on @128", "on @64"), change(700, "light.a", "on @64", "on @3")];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
    });

    it("judges a button with multi-tap actions at the fast count, before its double-tap action runs", () => {
        const toggle = {mode: "toggle", targets: ["light.a", "light.b"], multi: true};
        const changes = ["light.a", "light.b"].flatMap((e) => [
            change(200, e, "off", "on @255"),
            change(700, e, "on @255", "off"),
            change(1300, e, "off", "on @255"),
        ]);
        expect(verdict(toggle, FIRED, changes).ok).toBe(true);
    });

    it("passes a Toggle double tap on a light that bounces through on as it turns off", () => {
        const changes = [
            change(200, "light.a", "off", "on @255"),
            change(700, "light.a", "on @255", "off"),
            change(900, "light.a", "off", "on @23"),
            change(1500, "light.a", "on @23", "off"),
            change(200, "light.b", "off", "on @255"),
            change(700, "light.b", "on @255", "off"),
        ];
        expect(verdict(toggle, FIRED, changes).ok).toBe(true);
    });

    it("passes a Room off double tap on a light that bounces as it turns off", () => {
        const cfg = {mode: "room_off", targets: ["light.a", "light.b"]};
        const changes = [
            change(240, "light.a", "on @69", "off"),
            change(280, "light.a", "off", "on @66"),
            change(790, "light.a", "on @66", "off"),
            change(315, "light.b", "on @255", "off"),
        ];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
    });

    it("fails a Dim double tap whose first tap already turned the light off", () => {
        const cfg = {mode: "dim", targets: ["light.a"], tapStep: 10, dimFloor: 45};
        expect(verdict(cfg, FIRED, [change(200, "light.a", "on @128", "off")]).ok).toBe(false);
    });

    it("fails a Brighten double tap whose first tap made both steps", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        expect(verdict(cfg, FIRED, [change(200, "light.a", "on @128", "on @180")]).ok).toBe(false);
    });

    it("passes an On double tap that turned each target on once", () => {
        const cfg = {mode: "on", targets: ["light.a", "switch.s"]};
        const changes = [change(200, "light.a", "off", "on @255"), change(210, "switch.s", "off", "on"), change(400, "light.a", "on @255", "on @254")];
        expect(verdict(cfg, FIRED, changes).ok).toBe(true);
    });

    it("fails an On double tap that left one of its targets off", () => {
        const cfg = {mode: "on", targets: ["light.a", "switch.s"]};
        const r = verdict(cfg, FIRED, [change(200, "light.a", "off", "on @255")]);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/switch.s ended off, not on/);
    });

    it("passes taps whose changes land after the next known tap, as taps faster than the lights report do (#10)", () => {
        const changes = ["light.a", "light.b"].flatMap((e) => [change(600, e, "off", "on @255"), change(800, e, "on @255", "off")]);
        expect(verdict(toggle, FIRED, changes).ok).toBe(true);
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        expect(verdict(cfg, FIRED, [change(600, "light.a", "on @128", "on @154"), change(650, "light.a", "on @154", "on @180")]).ok).toBe(true);
    });

    it("fails when nothing changed after the first known tap", () => {
        const r = verdict(toggle, FIRED, []);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/nothing changed after known tap #1/);
    });

    it("fails a Brighten double tap whose taps landed as one, at any speed", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        const r = verdict(cfg, FIRED, [change(250, "light.a", "on @128", "on @154")]);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.a was at 154 after known tap #2, not 180/);
    });

    it("says which level a light never showed", () => {
        const cfg = {mode: "brighten", targets: ["light.a"], tapStep: 10};
        const r = verdict(cfg, FIRED, [change(200, "light.a", "on @128", "on @180")]);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/light.a never showed 154 after known tap #1/);
    });

    it("fails on a change before the first known tap", () => {
        const changes = ["light.a", "light.b"].flatMap((e) => [
            change(50, e, "on @255", "off"),
            change(200, e, "off", "on @255"),
            change(700, e, "on @255", "off"),
        ]);
        expect(verdict(toggle, FIRED, changes).ok).toBe(false);
    });

    it("fails unless it saw two known taps", () => {
        const changes = ["light.a", "light.b"].flatMap((e) => [change(200, e, "off", "on @255"), change(700, e, "on @255", "off")]);
        expect(
            verdict(
                toggle,
                FIRED.filter((f) => f.data.tap_index !== 2),
                changes,
            ).ok,
        ).toBe(false);
    });

    it("judges a Room master across the room like a Toggle", () => {
        const cfg = {mode: "room_master", targets: ["light.a", "light.b"]};
        const twice = ["light.a", "light.b"].flatMap((e) => [change(200, e, "off", "on @255"), change(700, e, "on @255", "off")]);
        expect(verdict(cfg, FIRED, twice).ok).toBe(true);
        expect(
            verdict(
                cfg,
                FIRED,
                twice.filter((c) => c.t < 500),
            ).ok,
        ).toBe(false);
    });
});

// What the runner reads from a c4_device automation's inputs, and how it readies a button's targets.
describe("c4-scenarios button config", () => {
    const INPUT = {
        b1_targets: ["light.cans"],
        b1_double: [{action: "light.turn_on"}],
        b2_targets: "light.hanging",
        b2_mode: "brighten",
        b3_mode: "room_off",
        b4_mode: "room_master",
        b5_targets: ["light.cans", "switch.fan"],
        b6_targets: ["light.porch"],
        room_extra: ["light.lamp"],
        tap_response: "instant",
        tap_step: 20,
    };

    it("reads a button's targets, mode, multi-tap actions and the automation's settings", () => {
        expect(buttonConfig(INPUT, 1)).toEqual({
            targets: ["light.cans"],
            mode: "toggle",
            custom: false,
            multi: true,
            multiActions: {double: [{action: "light.turn_on"}], triple: [], quad: []},
            response: "instant",
            hold: true,
            tapStep: 20,
            dimFloor: 10,
        });
        expect(buttonConfig({b1_action: [{action: "script.x"}]}, 1)).toMatchObject({custom: true, multi: false});
        expect(buttonConfig(INPUT, 2)).toMatchObject({targets: ["light.hanging"], mode: "brighten", multi: false});
        expect(buttonConfig({}, 1)).toMatchObject({targets: [], mode: "toggle", response: "auto", tapStep: 10, dimFloor: 10});
    });

    it("gives a Room mode the whole room, as c4_device's room_all: every button's targets plus the room extras, once each", () => {
        const room = ["light.cans", "light.hanging", "switch.fan", "light.porch", "light.lamp"];
        expect(buttonConfig(INPUT, 3).targets).toEqual(room);
        expect(buttonConfig(INPUT, 4).targets).toEqual(room);
    });

    it.each([
        ["on", "homeassistant", "turn_off", {entity_id: ["light.a", "switch.s"]}],
        ["toggle", "homeassistant", "turn_off", {entity_id: ["light.a", "switch.s"]}],
        ["room_master", "homeassistant", "turn_off", {entity_id: ["light.a", "switch.s"]}],
        ["scene", "homeassistant", "turn_off", {entity_id: ["light.a", "switch.s"]}],
        ["off", "homeassistant", "turn_on", {entity_id: ["light.a", "switch.s"]}],
        ["room_off", "homeassistant", "turn_on", {entity_id: ["light.a", "switch.s"]}],
        ["brighten", "light", "turn_on", {entity_id: ["light.a"], brightness: 128}],
        ["dim", "light", "turn_on", {entity_id: ["light.a"], brightness: 128}],
    ])("readies a %s button's targets", (mode, domain, service, data) => {
        expect(prepareCall({mode, targets: ["light.a", "switch.s"]})).toEqual({domain, service, service_data: data});
    });

    it("leaves a Brighten button with no lights, and a custom mode, alone", () => {
        expect(prepareCall({mode: "brighten", targets: ["switch.s"]})).toBeUndefined();
        expect(prepareCall({mode: "custom", targets: ["light.a"]})).toBeUndefined();
    });
});

// Where the runner expects a known single tap to act: a copy of c4_device's Direction and early commit.
describe("c4-scenarios early commit", () => {
    const button = (mode: string, extra: Record<string, unknown> = {}) => ({
        mode,
        targets: ["light.a", "light.b"],
        custom: false,
        multi: true,
        response: "auto",
        ...extra,
    });

    it.each([
        ["on", false, true],
        ["brighten", false, true],
        ["toggle", false, true],
        ["room_master", false, true],
        ["toggle", true, false],
        ["room_master", true, false],
        ["off", false, false],
        ["dim", true, false],
        ["room_off", true, false],
    ])("takes a %s tap with targets on: %s as toward ON: %s", (mode, anyOn, want) => {
        expect(towardOn(button(mode as string), anyOn as boolean)).toBe(want);
    });

    it("takes a custom tap action as toward OFF, whatever the mode", () => {
        expect(towardOn(button("on", {custom: true}), false)).toBe(false);
    });

    it("expects a multi-tap button's tap under Auto on the first known tap toward ON, else on the fast count", () => {
        expect(tapSource(button("toggle"), false)).toBe("tap_known");
        expect(tapSource(button("toggle"), true)).toBe("fast_single");
        expect(tapSource(button("on", {custom: true}), false)).toBe("fast_single");
    });

    it("keeps Fast, Wait and Instant where they were, whatever the Direction", () => {
        for (const anyOn of [false, true]) {
            expect(tapSource(button("toggle", {response: "fast"}), anyOn)).toBe("fast_single");
            expect(tapSource(button("toggle", {response: "wait"}), anyOn)).toBe("single");
            expect(tapSource(button("toggle", {response: "instant"}), anyOn)).toBe("tap_known");
            expect(tapSource(button("off", {multi: false}), anyOn)).toBe("tap_known");
        }
    });

    it("taps a Toggle or Room master from all off and from its first target on, any other mode from its prepared start", () => {
        const off = {domain: "homeassistant", service: "turn_off", service_data: {entity_id: ["light.a", "light.b"]}};
        for (const mode of ["toggle", "room_master"]) {
            expect(starts(button(mode))).toEqual([
                {label: "from all off", calls: [off]},
                {label: "from some on", calls: [off, {domain: "homeassistant", service: "turn_on", service_data: {entity_id: ["light.a"]}}]},
            ]);
        }
        expect(starts(button("off"))).toEqual([{label: "", calls: [prepareCall(button("off"))]}]);
    });

    it("finds the entities an action names, wherever it names them", () => {
        const action = [
            {action: "light.turn_on", target: {entity_id: ["light.a", "light.hanging"]}, data: {brightness_pct: 100}},
            {action: "scene.turn_on", data: {entity_id: "scene.movie"}},
            {action: "notify.me", data: {message: "{{ states('light.a') }}"}},
            {if: [{condition: "state", entity_id: "sun.sun", state: "below_horizon"}], then: [{action: "switch.turn_on", target: {entity_id: "switch.fan"}}]},
        ];
        expect(namedEntities(action)).toEqual(["light.a", "light.hanging", "scene.movie", "sun.sun", "switch.fan"]);
        expect(namedEntities([])).toEqual([]);
    });
});

// The double / triple scenarios' verdict: where the single tap ran, and that the count's action ran after the count.
describe("c4-scenarios multi-tap verdict", () => {
    /** A known double tap as HA saw it: known taps at 100 and 300 ms, the fast count at 850, the device's at 1900. */
    const FIRED = [
        {t: 0, data: {gesture: "press"}},
        {t: 100, data: {gesture: "tap_known", tap_index: 1}},
        {t: 200, data: {gesture: "press"}},
        {t: 300, data: {gesture: "tap_known", tap_index: 2}},
        {t: 850, data: {gesture: "fast_double", known_taps: true}},
        {t: 1900, data: {gesture: "double"}},
    ];
    const change = (t: number, entity_id: string, to: string) => ({t, entity_id, from: "", to, state: {state: to}});
    const DOUBLE = [{action: "light.turn_on", target: {entity_id: ["light.a", "light.hanging"]}, data: {brightness_pct: 100}}];
    const cfg = (extra: Record<string, unknown> = {}) => ({mode: "toggle", targets: ["light.a"], custom: false, multi: true, response: "auto", ...extra});
    const verdict = (c: ReturnType<typeof cfg>, start: string, changes: ReturnType<typeof change>[], action: unknown[] = DOUBLE) =>
        checkMultiTap(c, {fired: FIRED, changes, startStates: {"light.a": {state: start}}}, 2, action);

    it("passes an early tap toward ON with the double-tap action on top of it", () => {
        const r = verdict(cfg(), "off", [change(250, "light.a", "on"), change(1000, "light.hanging", "on")]);
        expect(r).toEqual({ok: true, lines: ["expected the tap at known tap #1, and the double-tap action on fast_double"]});
    });

    it("fails a tap toward ON that waited for the count", () => {
        const r = verdict(cfg(), "off", [change(900, "light.a", "on"), change(1000, "light.hanging", "on")]);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/the tap changed no target between known tap #1 and fast_double/);
    });

    it("passes a tap toward OFF that never ran, and fails one that darkened the targets first", () => {
        expect(verdict(cfg(), "on", [change(1000, "light.hanging", "on")]).ok).toBe(true);
        const r = verdict(cfg(), "on", [change(250, "light.a", "off"), change(1000, "light.hanging", "on")]);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/1 target change\(s\) before fast_double: the tap ran/);
    });

    it("judges the double-tap action on the entities it names that aren't targets", () => {
        const r = verdict(cfg(), "off", [change(250, "light.a", "on"), change(1000, "light.a", "on")]);
        expect(r.ok).toBe(false);
        expect(r.lines.join(" ")).toMatch(/the double-tap action changed none of light.hanging after fast_double/);
        // An action naming only the targets is judged on them.
        expect(verdict(cfg(), "on", [change(1000, "light.a", "on")], [{action: "light.turn_on", target: {entity_id: "light.a"}}]).ok).toBe(true);
    });

    it("says when the count has no action, or one that names no entity", () => {
        expect(verdict(cfg(), "off", [change(250, "light.a", "on")], []).lines.join(" ")).toMatch(/no double-tap action: nothing to see on fast_double/);
        expect(verdict(cfg(), "off", [change(250, "light.a", "on")], [{action: "notify.me"}]).lines.join(" ")).toMatch(/names no entity: not judged/);
    });

    it("never runs the tap of a double tap under Fast or Wait, and judges Wait on the device's count", () => {
        expect(verdict(cfg({response: "fast"}), "off", [change(1000, "light.hanging", "on")]).ok).toBe(true);
        expect(verdict(cfg({response: "fast"}), "off", [change(250, "light.a", "on"), change(1000, "light.hanging", "on")]).ok).toBe(false);
        expect(verdict(cfg({response: "wait"}), "off", [change(1000, "light.hanging", "on")]).ok).toBe(false);
        expect(verdict(cfg({response: "wait"}), "off", [change(2000, "light.hanging", "on")]).ok).toBe(true);
    });

    it("runs Instant's tap at the first known tap, whatever the Direction", () => {
        expect(verdict(cfg({response: "instant"}), "on", [change(250, "light.a", "off"), change(1000, "light.hanging", "on")]).ok).toBe(true);
    });

    it("fails when the count was not dispatched", () => {
        const r = checkMultiTap(cfg(), {fired: FIRED.slice(0, 4), changes: [], startStates: {}}, 2, DOUBLE);
        expect(r).toEqual({ok: false, lines: ["fast_double was not dispatched"]});
    });
});

// The led scenario's expectation: a copy of c4_device's LED colour for one button.
describe("c4-scenarios LED colour", () => {
    const INPUT = {
        b1_targets: ["light.cans"],
        b1_led: ["select.kp_led_1_idle_color", "select.kp_led_1_pressed_color"],
        b1_on: "Cyan",
        b1_off: "Yellow",
        b2_targets: ["light.hanging"],
        b3_led: ["select.kp_button_5_color"],
    };
    const states = (s: Record<string, string>) => (e: string) => (e in s ? {state: s[e], attributes: {}} : undefined);

    it("reads the LED numbers from picked colour selects, else names the button where the extension finds its LED (#22)", () => {
        expect(ledNumbers(INPUT, 1, "C4-KC120277")).toEqual(["1"]);
        expect(ledNumbers(INPUT, 3, "C4-KC120277")).toEqual(["5"]);
        expect(ledNumbers(INPUT, 2, "C4-KC120277")).toEqual(["button_2"]);
        expect(ledNumbers({}, 2, "C4-DIM1-Z")).toEqual(["button_2"]);
        expect(ledNumbers({}, 3, "C4-DIM1-Z")).toEqual([]);
        expect(ledNumbers({}, 4, "C4-KP3-Z")).toEqual([]);
        expect(ledNumbers({}, 1, "C4-FS1-Z")).toEqual([]);
    });

    it.each(["C4-APD120", "C4-SW120277"])("names a %s's top and bottom LEDs by Button 1 and 2, or by the colour selects picked", (model) => {
        expect([ledNumbers({}, 1, model), ledNumbers({}, 2, model), ledNumbers({}, 3, model)]).toEqual([["button_1"], ["button_2"], []]);
        expect(ledNumbers(INPUT, 1, model)).toEqual(["1"]);
    });

    it.each(["C4-FS1-Z", "C4-4SF120", "LOZ-5S1-W"])("gives a %s's buttons no LED, colour selects picked or not", (model) => {
        expect(ledNumbers(INPUT, 1, model)).toEqual([]);
    });

    it("shows the ON and OFF colours at their brightness by day", () => {
        expect(expectedLed(INPUT, 1, states({"light.cans": "on"}), "12:00:00")).toEqual({color: "Cyan", brightness: 75});
        expect(expectedLed(INPUT, 1, states({"light.cans": "off"}), "12:00:00")).toEqual({color: "Yellow", brightness: 15});
        expect(expectedLed({b1_targets: ["light.cans"]}, 1, states({"light.cans": "on"}), "12:00:00")).toEqual({color: "Green", brightness: 75});
    });

    it("shows the fault colour for a watched entity HA can't see, unless it counts as off", () => {
        expect(expectedLed(INPUT, 1, states({}), "12:00:00")).toEqual({color: "Red", brightness: 75});
        expect(expectedLed({...INPUT, fault_colour: "Treat as off"}, 1, states({"light.cans": "unavailable"}), "12:00:00")).toEqual({
            color: "Yellow",
            brightness: 15,
        });
    });

    it("shows a night colour inside the night window, once the room is dark when it must be", () => {
        const night = {...INPUT, night_enabled: true, night_start: "21:00:00", night_end: "07:00:00", b1_night_on: "Red", night_brightness: 7};
        expect(expectedLed(night, 1, states({"light.cans": "on"}), "22:00:00")).toEqual({color: "Cyan", brightness: 75}); // the room is lit
        const anyway = {...night, night_needs_dark: false};
        expect(expectedLed(anyway, 1, states({"light.cans": "on"}), "22:00:00")).toEqual({color: "Red", brightness: 7});
        expect(expectedLed(anyway, 1, states({"light.cans": "on"}), "06:59:59")).toEqual({color: "Red", brightness: 7});
        expect(expectedLed(anyway, 1, states({"light.cans": "on"}), "07:00:00")).toEqual({color: "Cyan", brightness: 75});
        // No night colour for OFF: the day colour stays.
        expect(expectedLed(anyway, 1, states({"light.cans": "off"}), "22:00:00")).toEqual({color: "Yellow", brightness: 15});
        // A Night start written without its zeros is the time it is, as c4_device reads it (9:3 is 09:03:00).
        const unpadded = {...anyway, night_start: "9:3", night_end: "17:00"};
        expect(["09:02:59", "09:03:00", "16:59:59", "17:00:00"].map((t) => expectedLed(unpadded, 1, states({"light.cans": "on"}), t).color)).toEqual([
            "Cyan",
            "Red",
            "Red",
            "Cyan",
        ]);
    });

    it("watches the LED's own entities when it has them, all of them when it must", () => {
        const watch = {...INPUT, b1_watch: ["light.a", "light.b"]};
        expect(expectedLed(watch, 1, states({"light.cans": "off", "light.a": "on", "light.b": "off"}), "12:00:00").color).toBe("Cyan");
        expect(expectedLed({...watch, led_match: "all"}, 1, states({"light.cans": "on", "light.a": "on", "light.b": "off"}), "12:00:00").color).toBe("Yellow");
    });

    it("leaves the ON brightness open when it follows the lights", () => {
        expect(expectedLed({...INPUT, led_follow: true}, 1, states({"light.cans": "on"}), "12:00:00")).toEqual({color: "Cyan", brightness: null});
    });
});

// A Scene button's LED: Active while every target is at its level (ADR 0003).
describe("c4-scenarios Scene", () => {
    const DINNER = [
        {
            action: "scene.apply",
            metadata: {},
            data: {entities: {"light.island": {state: "on", brightness: 204}, "light.table": {state: "on", brightness: 77}, "switch.fan": "off"}},
        },
    ];
    const TARGETS = ["light.island", "light.table", "switch.fan"];
    const INPUT = {b1_targets: TARGETS, b1_mode: "scene", b1_action: DINNER, b1_on: "Cyan", b1_off: "Yellow", b1_led: ["select.kp_led_1_idle_color"]};
    const at =
        (island: number | "off", table: number | "off", fan = "off") =>
        (e: string) =>
            ({
                "light.island": island === "off" ? {state: "off", attributes: {}} : {state: "on", attributes: {brightness: island}},
                "light.table": table === "off" ? {state: "off", attributes: {}} : {state: "on", attributes: {brightness: table}},
                "switch.fan": {state: fan, attributes: {}},
            })[e];

    it("is Active while every target is in its state and each light within 2 points of its level", () => {
        expect(sceneState(DINNER, TARGETS, at(204, 77))).toEqual({active: true, bad: false});
        expect(sceneState(DINNER, TARGETS, at(209, 72))).toEqual({active: true, bad: false}); // 5 of 255 off
        expect(sceneState(DINNER, TARGETS, at(210, 77)).active).toBe(false); // 6 of 255: past 2 points
        expect(sceneState(DINNER, TARGETS, at(204, "off")).active).toBe(false);
        expect(sceneState(DINNER, TARGETS, at(204, 77, "on")).active).toBe(false); // a target the Scene keeps off
    });

    it("needs every target to match, whatever the device's ANY / ALL", () => {
        expect(expectedLed({...INPUT, led_match: "any"}, 1, at(204, 30), "12:00:00").color).toBe("Yellow");
        expect(expectedLed({...INPUT, led_match: "any"}, 1, at(204, 77), "12:00:00")).toEqual({color: "Cyan", brightness: 75});
    });

    it("reads an unquoted on / off, a brightness_pct, and leaves colour and non-light levels uncompared", () => {
        const yaml = [
            {action: "scene.apply", data: {entities: {"light.a": {state: true, brightness_pct: 40, color_temp_kelvin: 2700}, "switch.b": {state: false}}}},
        ];
        const s = (bri: number) => (e: string) =>
            e === "light.a" ? {state: "on", attributes: {brightness: bri, color_temp_kelvin: 5000}} : {state: "off", attributes: {}};
        expect(sceneState(yaml, ["light.a", "switch.b"], s(102))).toEqual({active: true, bad: false});
        expect(sceneState(yaml, ["light.a", "switch.b"], s(120)).active).toBe(false);
        // A light with no level in the Scene matches on its state alone.
        expect(sceneState([{action: "scene.apply", data: {entities: {"light.a": "on"}}}], ["light.a"], s(3)).active).toBe(true);
    });

    it.each([
        ["an HA scene", [{action: "scene.turn_on", target: {entity_id: "scene.dinner"}}], TARGETS],
        ["two actions", [...DINNER, {action: "light.turn_on", target: {entity_id: "light.island"}}], TARGETS],
        ["no Tap action", [], TARGETS],
        ["a light missing from Targets", DINNER, ["light.island", "light.table"]],
        ["a target missing from the Scene", DINNER, [...TARGETS, "light.extra"]],
        ["a light with no state", [{action: "scene.apply", data: {entities: {"light.island": {brightness: 204}}}}], ["light.island"]],
    ])("is misconfigured with %s, and shows the Fault colour", (_label, actions, targets) => {
        expect(sceneState(actions, targets, at(204, 77))).toEqual({active: false, bad: true});
        expect(expectedLed({...INPUT, b1_action: actions, b1_targets: targets}, 1, at(204, 77), "12:00:00")).toEqual({color: "Red", brightness: 75});
        expect(expectedLed({...INPUT, b1_action: actions, b1_targets: targets, fault_colour: "Treat as off"}, 1, at(204, 77), "12:00:00").color).toBe("Yellow");
    });

    it("gives a Scene button's config its Scene: each target's state and level", () => {
        expect(buttonConfig(INPUT, 1).scene).toEqual({
            "light.island": {state: "on", level: 204},
            "light.table": {state: "on", level: 77},
            "switch.fan": {state: "off", level: null},
        });
        expect(sceneOf([{action: "scene.apply", data: {entities: {"light.a": {state: true, brightness_pct: 40}}}}])).toEqual({
            "light.a": {state: "on", level: 102},
        });
        expect(sceneOf([{action: "scene.turn_on", target: {entity_id: "scene.dinner"}}])).toEqual({});
        expect(buttonConfig({b1_targets: TARGETS}, 1).scene).toBeUndefined();
    });

    it("reads a service: key as the older spelling of action:", () => {
        expect(sceneState([{service: "scene.apply", data: DINNER[0].data}], TARGETS, at(204, 77)).active).toBe(true);
    });

    it("shows the watches instead, when the button has its own", () => {
        expect(expectedLed({...INPUT, b1_watch: ["switch.fan"]}, 1, at(204, 77, "on"), "12:00:00").color).toBe("Cyan");
    });

    it("is toward OFF, as a custom tap action is", () => {
        expect(towardOn(buttonConfig(INPUT, 1), false)).toBe(false);
        expect(towardOn({...buttonConfig(INPUT, 1), custom: false}, false)).toBe(false);
    });
});
