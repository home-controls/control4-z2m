// Live scenarios for the Control4 event path on a real Home Assistant:
// payloads from the contract fixture (test/fixtures/control4-event.json) are
// published through HA's mqtt.publish as the extension publishes them, on
// control4/event and on the device's own control4/<ieee>/event, for one real
// device and button, and the runner reports which targets changed and how
// long after the first event its Control4 events entity saw. It CHANGES REAL
// LIGHTS (and puts them back afterwards), so it runs only by hand, never in
// `npm run check`.
//
//   HA_URL=http://host:8123 HA_TOKEN_FILE=/path/token.txt \
//     node tools/c4-scenarios.mjs --device "Keypad A" [--button 1] [--only tap,hold,...]
//
// Scenarios:
//   tap      a known tap: the run Home Assistant's trace shows owning it changed
//            the targets on the event it took the tap on (under Auto on a button
//            with multi-tap actions, the first known tap toward ON, the fast
//            count toward OFF). A Toggle / Room master button taps from all off
//            and from some on
//   known    a button that acts at once (Instant, or Auto with no multi-tap
//            actions) acts on each known tap of a double tap, with presses
//            100, 150 and 450 ms apart (judged from the targets' states: see
//            checkKnownTaps for its known limits)
//   fallback a button that acts on known taps handles a tap whose fast count
//            says it was not known (a keypad never seen releasing) as Fast: on
//            the fast count
//   double   a known double tap runs the tap where the response puts it (at the
//            first known tap, or not at all) and the double-tap action on its
//            count; Toggle / Room master from all off and from some on
//   triple   the same for a known triple tap
//   hold     a hold ramps the light targets and runs no tap
//   led      after a tap, and back, every led_status call the LED runs' traces
//            show was published to the device
//   idle     during the scenarios before it, no other c4_device automation started a run
//   unknown  an event for an IEEE with no HA device starts no c4_device run, and
//            the dispatcher (if deployed) drops it
//   rename   renaming the device (and back) leaves the dispatcher's map complete
//   stale    a map that lost the device heals on the device's next event
//
// Needs the c4_device blueprint deployed, the device's Control4 events entity
// (ADR 0005), and a c4_device automation for the device whose button has
// targets. rename and stale check the optional dispatcher package and are
// skipped without it.
//
// What c4_device decides (which run owns a tap, the LED calls) is read from
// Home Assistant's traces through readTrace (tools/c4-device-run.mjs); the
// rules themselves are tested offline against the blueprint (test/c4-device.ts).
// The runner judges what happened: the targets, the timing, what was sent.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {readTrace} from "./c4-device-run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(root, "test", "fixtures", "control4-event.json"), "utf8"));
const MAP_SENSOR = "sensor.control4_device_map";
const UNKNOWN_IEEE = "0x000fff00dead0001";
const SCENARIOS = ["tap", "known", "fallback", "double", "triple", "hold", "led", "idle", "unknown", "rename", "stale"];

/**
 * When each gesture is published, ms after the press it follows (measured
 * keypad timing): a known tap comes with its release, or with the press on a
 * DIM1-Z or FS1-Z, which have no release.
 */
const AFTER_PRESS = {release: 100, fast: 650, count: 1700, hold: 520, hold_release: 2500};
/** A second press of a multi-tap comes this long after the first. */
const SECOND_PRESS = 200;
/** The ZHA commands of the counts the runner makes up: the fixture has no triple tap. */
const COMMANDS = {fast_triple: "remote_button_fast_triple_press", triple: "remote_button_triple_press"};

// ---------------------------------------------------------------------------
// Fixture -> one device's payload sequences

/**
 * The fixture model whose sequences a device of each model (its model_id, or the
 * fixture's own model) follows.
 */
const FIXTURE_MODEL = {
    "C4-DIM1-Z": "C4-DIM1-Z",
    "C4-FS1-Z": "C4-FS1-Z",
    "C4-KC120277": "C4-KC120277",
    "C4-APD120": "C4-APD120",
    // An SW120277's paddle reports exactly as an APD120's.
    "C4-SW120277": "C4-APD120",
    // The fan and the outlet are c4.dmx devices like the KC120277: their buttons report exactly as its do.
    "C4-4SF120": "C4-KC120277",
    "LOZ-5S1-W": "C4-KC120277",
    "KPZ-3B1": "KPZ-3B1",
    "C4-KP3-Z": "KPZ-3B1",
    "C4-KP6-Z": "KPZ-3B1",
};

/** The fixture model whose sequences a device of `model` follows; a model with none is refused, never given another's events. */
function family(model) {
    const f = FIXTURE_MODEL[model];
    if (!f)
        throw new Error(
            `c4-scenarios: the contract fixture has no events for a ${model || "device with no model"} (it has them for ${Object.keys(FIXTURE_MODEL).join(", ")})`,
        );
    return f;
}

/** A paddle's halves as its events name them (src/core/constants.ts PADDLE_BUTTONS): Button 1 is the top, 2 the bottom. */
const PADDLE_HALVES = {1: {name: "top", id: 0x01}, 2: {name: "bottom", id: 0x05}};

/** The fan's buttons as its events name them (src/core/constants.ts FAN_BUTTONS): Buttons 1-6 from the top. */
const FAN_BUTTONS = {
    1: {name: "top", id: 0},
    2: {name: "high", id: 1},
    3: {name: "medium_high", id: 2},
    4: {name: "medium_low", id: 3},
    5: {name: "low", id: 4},
    6: {name: "off", id: 5},
};

/** The outlet's buttons as its events name them (src/core/constants.ts OUTLET_BUTTONS). */
const OUTLET_BUTTONS = {1: {name: "outlet_1", id: 0}, 2: {name: "outlet_2", id: 1}};

/**
 * Button `button` of a device of `model` as its events name it: its button name
 * and id. Throws for a button the model does not have.
 */
function addressOf(model, button) {
    const named = {"C4-APD120": PADDLE_HALVES, "C4-SW120277": PADDLE_HALVES, "C4-4SF120": FAN_BUTTONS, "LOZ-5S1-W": OUTLET_BUTTONS}[model];
    if (named) {
        if (!named[button]) throw new Error(`c4-scenarios: a ${model} has no Button ${button}`);
        return named[button];
    }
    // A KC120277 numbers its buttons 0, 2, 4 (top first); the others 0, 1, 2 ...
    return {name: `button_${button}`, id: model === "C4-KC120277" ? 2 * (button - 1) : button - 1};
}

/**
 * The device family's fixture sequences, re-addressed to this device and
 * button, each event with its publish offset `at`: {tap} a known single tap,
 * {double} a known double tap, {triple} that double tap with its second tap
 * once more, counted three, {unknownTap} a single tap whose taps were not
 * known (none on a DIM1-Z or FS1-Z), {hold} a hold (none on a DIM1-Z). `gap`
 * is the time between the presses of a multi-tap.
 */
export function sequences(dev, button, gap = SECOND_PRESS) {
    const evs = FIXTURE.filter((e) => e.model === family(dev.model));
    const {name, id: buttonId} = addressOf(dev.model, button);
    const mine = (e) => ({...e, ieee: dev.ieee, device: dev.name, model: dev.model, button: name, button_id: buttonId, action: `${name}_${e.gesture}`});
    // A sequence ends at the device's own count, or at a hold's release.
    const all = [];
    let cur = [];
    for (const e of evs) {
        cur.push(e);
        if (["single", "double", "triple", "quadruple", "hold_release"].includes(e.gesture)) {
            all.push(cur);
            cur = [];
        }
    }
    const timed = (seq) => {
        let presses = 0;
        let press = 0;
        let last = 0;
        return seq.map((e) => {
            const g = e.gesture;
            if (g === "press") press = gap * presses++;
            const at =
                g === "press"
                    ? press
                    : g === "tap_known"
                      ? last
                      : /^fast_/.test(g)
                        ? press + AFTER_PRESS.fast
                        : g in AFTER_PRESS
                          ? press + AFTER_PRESS[g]
                          : press + AFTER_PRESS.count;
            last = at;
            return {at, payload: mine(e)};
        });
    };
    const find = (pred) => all.find(pred) ?? [];
    const fast = (seq, g, known) => seq.some((e) => e.gesture === g && e.known_taps === known);
    const double = find((q) => fast(q, "fast_double", true));
    const second = double.findIndex((e, i) => i > 0 && e.gesture === "press");
    const counts = double.findIndex((e) => e.gesture === "fast_double");
    const third = double.slice(second, counts).map((e) => (e.gesture === "tap_known" ? {...e, tap_index: 3} : e));
    const counted = (e) => {
        const g = e.gesture === "fast_double" ? "fast_triple" : "triple";
        return {...e, gesture: g, command: COMMANDS[g]};
    };
    return {
        tap: timed(find((q) => fast(q, "fast_single", true))),
        double: timed(double),
        triple: double.length ? timed([...double.slice(0, counts), ...third, ...double.slice(counts).map(counted)]) : [],
        unknownTap: timed(find((q) => fast(q, "fast_single", false))),
        hold: timed(find((q) => q.some((e) => e.gesture === "hold"))),
    };
}

/** The button's response, for a scenario that skips it: "response auto on a button with multi-tap actions". */
const responseOf = (cfg) => `response ${cfg.response}${cfg.multi ? " on a button with multi-tap actions" : ""}`;

/**
 * Whether a tap would leave the button's targets brighter (Direction toward
 * ON) while `anyOn` says whether any target is on. A copy of c4_device's
 * `toward_on` (tools/gen-c4-device.mjs): On and Brighten are toward ON,
 * Toggle and Room master while every target is off; a Scene and a custom tap
 * action are toward OFF.
 */
export function towardOn(cfg, anyOn) {
    if (cfg.custom) return false;
    if (cfg.mode === "on" || cfg.mode === "brighten") return true;
    return (cfg.mode === "toggle" || cfg.mode === "room_master") && !anyOn;
}

/**
 * The run that owned Button `button`'s single tap, among the runs a scenario
 * traced (in start order): the first that tapped, or committed early, for it.
 */
export function tapOwner(traced, button) {
    return traced.map((x) => x.run).find((r) => r && r.button === button && (r.does === "tap" || r.does === "early commit"));
}

/**
 * Whether the owner's tap ran at once, on its event: it tapped, or it
 * committed early toward ON (Direction, from `anyOn`); toward OFF an early
 * commit waits for the fast count.
 */
export function tappedAtOnce(owner, cfg, anyOn) {
    return owner !== undefined && (owner.does === "tap" || (owner.does === "early commit" && towardOn(cfg, anyOn)));
}

/** The entity ids an action list names (any entity_id in it), to see what the action changes. */
export function namedEntities(actions) {
    const out = new Set();
    const walk = (x) => {
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === "object") {
            for (const [k, v] of Object.entries(x)) {
                if (k === "entity_id") for (const e of [].concat(v)) typeof e === "string" && /^\w+\.\w+$/.test(e) && out.add(e);
                else walk(v);
            }
        }
    };
    walk(actions);
    return [...out];
}

// ---------------------------------------------------------------------------
// Home Assistant connection

function connect(url, token) {
    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/websocket`);
    let id = 0;
    const pending = new Map();
    const subs = new Map();
    return new Promise((resolve, reject) => {
        // A failed connection closes the socket, so the process can end on its own.
        const fail = (error) => {
            clearTimeout(timer);
            ws.close();
            reject(error);
        };
        const timer = setTimeout(() => fail(new Error(`no answer from ${url} within 20 s`)), 20_000);
        ws.onerror = (ev) => fail(new Error(`websocket error talking to ${url}: ${ev?.message || "connection failed"}`));
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.type === "auth_required") ws.send(JSON.stringify({type: "auth", access_token: token}));
            else if (msg.type === "auth_invalid") fail(new Error("auth failed"));
            else if (msg.type === "auth_ok") {
                clearTimeout(timer);
                resolve(ha);
            } else if (msg.type === "event" && subs.has(msg.id)) subs.get(msg.id)(msg.event);
            else if (msg.type === "result" && pending.has(msg.id)) {
                const {res, rej} = pending.get(msg.id);
                pending.delete(msg.id);
                msg.success ? res(msg.result) : rej(new Error(`${msg.error?.code}: ${msg.error?.message}`));
            }
        };
        const ha = {
            call(payload) {
                const n = ++id;
                return new Promise((res, rej) => {
                    // A call HA never answers fails, so a scenario still puts its lights back.
                    const timer = setTimeout(() => {
                        pending.delete(n);
                        rej(new Error(`${payload.type}${payload.service ? ` ${payload.domain}.${payload.service}` : ""}: no answer within 15 s`));
                    }, 15_000);
                    const done = (f) => (v) => {
                        clearTimeout(timer);
                        f(v);
                    };
                    pending.set(n, {res: done(res), rej: done(rej)});
                    ws.send(JSON.stringify({...payload, id: n}));
                });
            },
            async subscribe(event_type, cb) {
                const n = id + 1;
                subs.set(n, cb);
                await ha.call({type: "subscribe_events", event_type});
                return () => ha.call({type: "unsubscribe_events", subscription: n}).catch(() => undefined);
            },
            async rest(method, p, body) {
                const r = await fetch(`${url}${p}`, {
                    method,
                    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
                    body: body && JSON.stringify(body),
                });
                if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
                return r.json();
            },
            close: () => ws.close(),
        };
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Home Assistant's clock (ms), so trace times compare without this machine's clock skew. */
async function haNow(ha) {
    let resolve;
    const got = new Promise((r) => (resolve = r));
    const off = await ha.subscribe("c4_scenario_mark", (e) => resolve(Date.parse(e.time_fired)));
    await ha.call({type: "fire_event", event_type: "c4_scenario_mark"});
    const t = await got;
    await off();
    return t;
}

// ---------------------------------------------------------------------------
// Scenario helpers

/** c4_device's defaults for the inputs the runner reads (a copy of tools/gen-c4-device.mjs: change both together). */
const BLUEPRINT_DEFAULTS = {tap_step: 10, dim_floor: 10};

/** A c4_device input that holds a list (targets, actions), as a list. */
const inputList = (input, key) => [].concat(input[key] ?? []);

/** A copy of c4_device's room_all (tools/gen-c4-device.mjs): every button's targets plus the room extras. */
const roomOf = (input) => [...new Set([1, 2, 3, 4, 5, 6].flatMap((n) => inputList(input, `b${n}_targets`)).concat(inputList(input, "room_extra")))];

/**
 * What the runner needs of one button of a c4_device automation's inputs. A
 * Room mode's targets are the whole room.
 */
export function buttonConfig(input, button) {
    const b = `b${button}`;
    const mode = input[`${b}_mode`] ?? "toggle";
    const multiActions = Object.fromEntries(["double", "triple", "quad"].map((g) => [g, inputList(input, `${b}_${g}`)]));
    return {
        targets: mode === "room_off" || mode === "room_master" ? roomOf(input) : inputList(input, `${b}_targets`),
        mode,
        custom: inputList(input, `${b}_action`).length > 0,
        multi: Object.values(multiActions).some((a) => a.length > 0),
        multiActions,
        response: input.tap_response ?? "auto",
        hold: input[`${b}_hold`] ?? true,
        tapStep: Number(input.tap_step ?? BLUEPRINT_DEFAULTS.tap_step),
        dimFloor: Number(input.dim_floor ?? BLUEPRINT_DEFAULTS.dim_floor),
        ...(mode === "scene" ? {scene: sceneOf(inputList(input, `${b}_action`))} : {}),
    };
}

/** The device, every c4_device automation, and the one for this device. */
async function discover(ha, deviceArg, button) {
    const devices = await ha.call({type: "config/device_registry/list"});
    const d = devices.find((x) => x.id === deviceArg || x.name_by_user === deviceArg || x.name === deviceArg);
    if (!d) throw new Error(`no HA device '${deviceArg}'`);
    const ident = (d.identifiers ?? []).map((i) => i[1]).find((i) => /^zigbee2mqtt_0x/.test(i));
    if (!ident) throw new Error(`'${deviceArg}' is not a Zigbee2MQTT device`);
    const states = await ha.call({type: "get_states"});
    const entities = await ha.call({type: "config/entity_registry/list"});
    const dev = {
        id: d.id,
        ieee: ident.slice("zigbee2mqtt_".length),
        model: d.model_id ?? d.model ?? "",
        name: d.name_by_user ?? d.name,
        nameByUser: d.name_by_user,
    };
    // The entity c4_device hears the device through (its unique_id is the extension's).
    dev.events = entities.find((x) => x.device_id === d.id && x.platform === "mqtt" && x.unique_id === `${dev.ieee}_control4_event`)?.entity_id;
    if (!dev.events)
        throw new Error(
            `'${deviceArg}' has no Control4 events entity: update the extension on its Zigbee2MQTT instance, with its Home Assistant integration on`,
        );
    const autos = [];
    // The config API serves only UI-managed automations: YAML / package ones can't be read, so they aren't checked.
    const unreadable = [];
    for (const s of states.filter((x) => x.entity_id.startsWith("automation.") && x.attributes.id)) {
        const conf = await ha.rest("GET", `/api/config/automation/config/${encodeURIComponent(s.attributes.id)}`).catch(() => undefined);
        if (!conf) unreadable.push(s.entity_id);
        else if (/c4_device\.yaml$/.test(conf.use_blueprint?.path ?? ""))
            autos.push({entity: s.entity_id, id: s.attributes.id, input: conf.use_blueprint.input ?? {}});
    }
    const mine = autos.find((a) => a.input.c4_device === dev.id);
    if (!mine)
        throw new Error(
            `no c4_device automation for '${deviceArg}'${unreadable.length ? ` among those the config API can read (${unreadable.length} YAML / package automation(s) can't be read)` : ""}`,
        );
    const cfg = buttonConfig(mine.input, button);
    if (!cfg.targets.length) throw new Error(`button ${button} of '${deviceArg}' has no targets`);
    return {dev, autos, unreadable, mine, cfg};
}

/**
 * Publish a sequence at its offsets as the extension publishes it, on control4/event
 * and on the device's own topic with event_type; returns the local time of the first publish.
 */
async function publish(ha, seq) {
    const t0 = Date.now();
    const send = (topic, payload) =>
        ha.call({type: "call_service", domain: "mqtt", service: "publish", service_data: {topic, payload: JSON.stringify(payload)}});
    for (const s of seq) {
        const wait = t0 + s.at - Date.now();
        if (wait > 0) await sleep(wait);
        await send("control4/event", s.payload);
        await send(`control4/${s.payload.ieee}/event`, {...s.payload, event_type: s.payload.command});
    }
    return t0;
}

/**
 * Record what the Control4 events entities in `events` saw (`fired`, their
 * attributes as `data`), the dispatcher's control4_event (`dispatched`) and the
 * targets' state changes while `fn` runs, plus `settle` ms after. With `runs`
 * (automation entity -> Set of run ids), also collect the runs a Control4
 * event started in `autos`, polling their traces as it goes: HA keeps only the
 * last 5 traces of an automation, and every target change starts an LED run
 * that pushes older ones out.
 */
async function observe(ha, targets, fn, settle = 2500, {autos = [], runs, errors = [], label, events = [], traceOf} = {}) {
    const fired = [];
    const dispatched = [];
    const changes = [];
    const offFired = await ha.subscribe("control4_event", (e) => dispatched.push({t: Date.parse(e.time_fired), data: e.data}));
    const offState = await ha.subscribe("state_changed", (e) => {
        const {entity_id, old_state, new_state} = e.data;
        if (events.includes(entity_id)) {
            if (new_state && !["unavailable", "unknown"].includes(new_state.state)) fired.push({t: Date.parse(e.time_fired), data: new_state.attributes});
            return;
        }
        if (!targets.includes(entity_id)) return;
        const view = (s) => (s ? `${s.state}${s.attributes?.brightness != null ? ` @${s.attributes.brightness}` : ""}` : "none");
        if (view(old_state) !== view(new_state))
            changes.push({t: Date.parse(e.time_fired), entity_id, from: view(old_state), to: view(new_state), state: new_state});
    });
    const startedAt = await haNow(ha);
    const startStates = Object.fromEntries((await snapshot(ha, targets)).map((st) => [st.entity_id, st]));
    let done = false;
    // traceOf's runs since startedAt, by run id: each read again until it has stopped (its LED calls come late).
    const traces = new Map();
    // A trace read that fails stops the polling and is reported in `errors`, never thrown mid-scenario.
    const poll = async () => {
        for (let last = false; ; ) {
            try {
                for (const a of runs ? autos : []) {
                    const seen = runs.get(a.entity) ?? new Set();
                    for (const t of await eventRuns(ha, a, startedAt)) seen.add(t.run_id);
                    runs.set(a.entity, seen);
                }
                if (traceOf) await readRuns(ha, traceOf, startedAt, traces);
            } catch (e) {
                errors.push(`${label ? `${label}: ` : ""}could not read automation traces: ${e?.message ?? e}`);
                return;
            }
            if (last || (!runs && !traceOf)) return;
            // One more pass after the observation ends, for the runs its last changes started.
            last = done;
            await sleep(250);
        }
    };
    const polling = poll();
    try {
        await fn();
        await sleep(settle);
    } finally {
        done = true;
        await polling;
        await offFired();
        await offState();
    }
    const traced = [...traces.values()]
        .sort((a, b) => a.t - b.t)
        .map(({t, trace}) => {
            try {
                return {t, run: readTrace(trace)};
            } catch (e) {
                errors.push(`${label ? `${label}: ` : ""}a c4_device trace could not be read: ${e?.message ?? e}`);
                return {t, run: undefined};
            }
        });
    return {fired, dispatched, changes, startedAt, startStates, traced};
}

async function snapshot(ha, targets) {
    const states = await ha.call({type: "get_states"});
    return targets.map((e) => states.find((s) => s.entity_id === e)).filter(Boolean);
}

/**
 * Put the targets back the way `snap` saw them, and wait until they show it:
 * the next scenario's snapshot must not catch a fading light on its way.
 */
async function restore(ha, snap) {
    const failed = [];
    for (const s of snap) {
        const [domain] = s.entity_id.split(".");
        try {
            if (s.state === "on" && domain === "light" && s.attributes.brightness != null) {
                await ha.call({
                    type: "call_service",
                    domain: "light",
                    service: "turn_on",
                    service_data: {entity_id: s.entity_id, brightness: s.attributes.brightness},
                });
            } else if (s.state === "on" || s.state === "off") {
                await ha.call({type: "call_service", domain: "homeassistant", service: `turn_${s.state}`, service_data: {entity_id: s.entity_id}});
            }
        } catch (e) {
            failed.push(`${s.entity_id} (should be ${s.state}): ${e?.message ?? e}`);
        }
    }
    const want = snap
        .filter((s) => s.state === "on" || s.state === "off")
        .map((s) => [s.entity_id, {on: s.state === "on", brightness: s.state === "on" ? s.attributes.brightness : undefined}]);
    await shown(ha, new Map(want));
    if (failed.length) throw new Error(`could not put back ${failed.join("; ")} - check it by hand`);
}

/** How long shown() waits for the entities to show what was asked: a fading light reports late. */
const SHOWN_TIMEOUT = 10_000;
/** How long they must keep showing it: an APD120 turning off reports off, on, off over about 2 s. */
const SHOWN_STEADY = 2500;

/**
 * Wait until each entity of `want` (entity -> {on, brightness}) shows on /
 * off, and the brightness when one is given (within 3 steps), and keeps
 * showing it for SHOWN_STEADY; at most SHOWN_TIMEOUT. One HA can't see or
 * that is unavailable isn't waited for.
 */
async function shown(ha, want) {
    const end = Date.now() + SHOWN_TIMEOUT;
    let since;
    for (;;) {
        const states = new Map((await ha.call({type: "get_states"})).map((s) => [s.entity_id, s]));
        const done = [...want].every(([e, w]) => {
            const s = states.get(e);
            if (!s || UNJUDGED.includes(s.state)) return true;
            return isOn(s.state) === w.on && (w.brightness == null || Math.abs((s.attributes?.brightness ?? -99) - w.brightness) <= 3);
        });
        since = done ? (since ?? Date.now()) : undefined;
        if ((since !== undefined && Date.now() - since >= SHOWN_STEADY) || Date.now() > end) break;
        await sleep(250);
    }
}

/**
 * observe() - after `opts.prepare`, when given - then put the targets back the
 * way they were before both, also when either fails. A failed put-back is
 * returned as `restoreError` rather than thrown, so it never hides what was
 * observed; when preparing or observing failed too, the error names both, the
 * first failure first.
 */
async function observeRestoring(ha, targets, fn, settle, opts) {
    const before = await snapshot(ha, targets);
    let obs;
    let failure;
    try {
        await opts?.prepare?.();
        obs = await observe(ha, targets, fn, settle, opts);
    } catch (e) {
        failure = e;
    }
    const restoreError = await restore(ha, before).then(
        () => undefined,
        (e) => e?.message ?? String(e),
    );
    if (failure) throw new Error([failure.message ?? String(failure), restoreError].filter(Boolean).join("; then "));
    return {...obs, restoreError};
}

/**
 * Read `auto`'s runs since `since` into `into` (run id -> {t, trace, done}):
 * each new one with trace/get, and again until it has stopped. HA keeps only
 * the last 5 traces of an automation, so this runs while the scenario does.
 */
async function readRuns(ha, auto, since, into) {
    const list = await ha.call({type: "trace/list", domain: "automation", item_id: auto.id});
    for (const t of list) {
        const at = Date.parse(t.timestamp?.start ?? "");
        if (!(at >= since) || into.get(t.run_id)?.done) continue;
        const trace = await ha.call({type: "trace/get", domain: "automation", item_id: auto.id, run_id: t.run_id});
        into.set(t.run_id, {t: at, trace, done: trace.state !== "running"});
    }
}

/** New traces of an automation since `since`, started by a Control4 event. */
async function eventRuns(ha, auto, since) {
    const traces = await ha.call({type: "trace/list", domain: "automation", item_id: auto.id});
    // event.received describes its run as "state of event.<entity>".
    return traces.filter((t) => Date.parse(t.timestamp?.start ?? "") >= since && /control4_event|control4\/event|state of event\./.test(t.trigger ?? ""));
}

/**
 * Publish one of this device's sequences while counting the runs it starts, for
 * idle, after `prepare` (when given) has readied the targets. Watches (and puts
 * back) `entities`, the button's targets by default. Anything that keeps idle
 * from trusting those counts goes into ctx.idleBlockers.
 */
function watched(ctx, name, seq, prepare, entities = ctx.cfg.targets) {
    return observeRestoring(ctx.ha, entities, () => publish(ctx.ha, seq), 2500, {
        autos: ctx.autos,
        runs: ctx.runs,
        errors: ctx.idleBlockers,
        label: name,
        prepare,
        events: [ctx.dev.events],
        traceOf: ctx.mine,
    }).catch((e) => {
        ctx.idleBlockers.push(`${name} failed before all its runs were seen: ${e?.message ?? e}`);
        throw e;
    });
}

const ms = (t, t0) => `+${Math.round(t - t0)} ms`;

// ---------------------------------------------------------------------------
// Scenarios: each returns {ok, lines}

/** Whether any of `targets` is on in `states` (entity -> HA state), as c4_device counts it (any_on). */
const anyOnIn = (targets, states) => targets.some((e) => states[e] && isOn(states[e].state));

/** The Direction of a tap from the button's targets' `states`, for a line: "toward ON". */
const directionOf = (cfg, states) => `toward ${towardOn(cfg, anyOnIn(cfg.targets, states)) ? "ON" : "OFF"}`;

async function tapScenario(ctx) {
    const results = [];
    for (const start of starts(ctx.cfg)) results.push(await tapFrom(ctx, start));
    return merge(results);
}

/** A known single tap from `start`: the targets change first on the event the response picks. */
async function tapFrom(ctx, start) {
    const {dev, cfg, seqs} = ctx;
    const {obs, lines} = await observePrepared(ctx, `tap${start.label ? ` ${start.label}` : ""}`, seqs.tap, start.calls);
    const t0 = obs.fired[0]?.t;
    const owner = tapOwner(obs.traced, ctx.button);
    const src = owner?.variables.evt?.gesture;
    const at = src === undefined ? -1 : obs.fired.findIndex((f) => f.data.gesture === src);
    const from = obs.fired[at]?.t;
    const until = obs.fired[at + 1]?.t ?? (from ?? 0) + 2000;
    const first = obs.changes[0];
    const okEvents = obs.fired.length === seqs.tap.length && obs.fired.every((f) => f.data.ieee === dev.ieee);
    const okTiming = first != null && from != null && first.t >= from && first.t <= until;
    let ok = okEvents && okTiming && owner !== undefined;
    const direction = owner?.does === "early commit" ? `, ${directionOf(cfg, obs.startStates)}` : "";
    if (owner)
        lines.push(
            `HA's run took the tap on ${src} (${owner.does} on ${owner.trigger}; response ${cfg.response}, ${cfg.multi ? "with" : "no"} multi-tap actions${direction})`,
        );
    else lines.push("no c4_device run owned the tap (HA's traces show none that tapped or committed early for this button)");
    if (!okEvents) lines.push(`${dev.events} saw ${obs.fired.length} of ${seqs.tap.length} events for this device`);
    if (owner && !okTiming) lines.push(first ? `first change at ${ms(first.t, t0)} is outside the ${src} window` : "no target changed");
    // Toggle / Room master drive the group as one: all off while any is on, else all on.
    if (start.label && !cfg.custom) {
        const want = anyOnIn(cfg.targets, obs.startStates) ? "off" : "on";
        for (const e of cfg.targets.filter((x) => obs.startStates[x] && !UNJUDGED.includes(obs.startStates[x].state))) {
            const end = obs.changes.filter((c) => c.entity_id === e).at(-1)?.state ?? obs.startStates[e];
            if (UNJUDGED.includes(end.state) || onOff(end) !== want) {
                lines.push(`${e} ended ${end.state}, not ${want}`);
                ok = false;
            }
        }
    }
    return {label: start.label, ok, lines, restoreError: obs.restoreError};
}

/**
 * A scenario's result from its runs from one start or more: each run's lines
 * under its start's label when there are several.
 */
function merge(results) {
    if (results.length === 1) return results[0];
    return {
        ok: results.every((r) => r.ok),
        lines: results.flatMap((r) => [`${r.label}:`, ...r.lines.map((l) => `  ${l}`)]),
        restoreError:
            results
                .map((r) => r.restoreError)
                .filter(Boolean)
                .join("; ") || undefined,
    };
}

/**
 * The starts a scenario taps from, each a label and the service calls that
 * make it: where one tap of the button's mode visibly changes the targets
 * (prepareCall), and for Toggle / Room master both from all off (a tap toward
 * ON) and from some on (toward OFF).
 */
export function starts(cfg) {
    const calls = [prepareCall(cfg)].filter(Boolean);
    if (cfg.mode !== "toggle" && cfg.mode !== "room_master") return [{label: "", calls}];
    return [
        {label: "from all off", calls},
        {
            label: "from some on",
            calls: [...calls, {domain: "homeassistant", service: "turn_on", service_data: {entity_id: cfg.targets.slice(0, 1)}}],
        },
    ];
}

/** Brightness a Brighten / Dim button starts from, so a step either way shows. */
const MID = 128;

/**
 * The service call that puts the button's targets where one tap of its mode
 * visibly changes them: off for On, Toggle, Room master and Scene, on for Off /
 * Room off, lit at mid brightness for Brighten / Dim; none for other modes.
 */
export function prepareCall(cfg) {
    const lights = cfg.targets.filter((e) => e.startsWith("light."));
    if (["on", "toggle", "room_master", "scene"].includes(cfg.mode))
        return {domain: "homeassistant", service: "turn_off", service_data: {entity_id: cfg.targets}};
    if (cfg.mode === "off" || cfg.mode === "room_off") return {domain: "homeassistant", service: "turn_on", service_data: {entity_id: cfg.targets}};
    if ((cfg.mode === "brighten" || cfg.mode === "dim") && lights.length)
        return {domain: "light", service: "turn_on", service_data: {entity_id: lights, brightness: MID}};
    return undefined;
}

/** Make the service `calls` and wait until each entity a turn_on / turn_off names shows it (the last call naming it wins). */
async function prepare(ha, calls) {
    if (!calls.length) return;
    for (const call of calls) await ha.call({type: "call_service", ...call});
    const want = calls.flatMap((c) =>
        ["turn_on", "turn_off"].includes(c.service)
            ? [].concat(c.service_data.entity_id ?? []).map((e) => [e, {on: c.service === "turn_on", brightness: c.service_data.brightness}])
            : [],
    );
    await shown(ha, new Map(want));
}

/**
 * Publish `seq` from targets prepared by the service `calls` (for the button's
 * mode by default), watching `entities` (the targets by default), then put
 * them back the way they were before the preparation (once). Returns the
 * observation and `between(i, until)`: the changes from event i up to the
 * first later event that `until` accepts (any event by default).
 */
async function observePrepared(ctx, name, seq, calls = [prepareCall(ctx.cfg)].filter(Boolean), entities = ctx.cfg.targets) {
    const obs = await watched(ctx, name, seq, () => prepare(ctx.ha, calls), entities);
    const t0 = obs.fired[0]?.t;
    const lines = [
        ...obs.fired.map((f) => `event ${f.data.gesture}${f.data.tap_index != null ? ` #${f.data.tap_index}` : ""} ${t0 == null ? "" : ms(f.t, t0)}`),
        ...obs.changes.map((c) => `${c.entity_id}: ${c.from} -> ${c.to} ${t0 == null ? "" : ms(c.t, t0)}`),
    ];
    const between = (i, until = () => true) => {
        const end = obs.fired.find((f, j) => j > i && until(f))?.t ?? Number.POSITIVE_INFINITY;
        return obs.changes.filter((c) => c.t >= obs.fired[i].t && c.t < end);
    };
    return {obs, lines, between};
}

/** Python's round(), which Home Assistant's templates use: a half goes to the even neighbour. */
const pyRound = (x) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));

/** States that say nothing about a target: it is not judged in them. */
const UNJUDGED = ["unavailable", "unknown"];

/** On as c4_device counts it (any_on): any state but off, unavailable or unknown. */
const isOn = (state) => state !== "off" && !UNJUDGED.includes(state);

/** A recorded HA state as "on" or "off", the way c4_device reads it. */
const onOff = (st) => (isOn(st.state) ? "on" : "off");

/**
 * The known scenario's verdict on a known double tap: each known tap acted once
 * on the button's targets, the first at once. Judged from the targets' states,
 * starting from the observation's `startStates` (the targets' states when it
 * began, after prepare()), not from how many reports a light sent. A target that starts
 * unavailable or unknown is not judged; like c4_device, any other state but
 * off counts as on. By mode:
 * - On, Off, Room off, Toggle, Room master (Room modes' targets are the whole
 *   room): each target ends on (On), off (Off, Room off), or where the group's
 *   toggles leave it (Toggle, Room master: c4_device turns them all off while
 *   any is on, else all on, once per tap), so a tap that landed with another,
 *   or acted twice, ends it wrong.
 * - Scene: each target ends in its state in the Tap action's Scene, a light
 *   within 2 points of its level (c4_device applies the Scene on every tap,
 *   also while it is Active); a target the Scene does not name fails.
 * - Brighten, Dim: each light with a brightness shows c4_device's level after
 *   each tap, in order, and ends at the last one; the levels step from the
 *   brightest lit light (c4_device's cur): Brighten up to 255; Dim down to 3
 *   while above the dim floor, off at or below it.
 * A tap's change may land after the next known tap (taps faster than the
 * lights report, issue #10), so no change is tied to the next tap's time. A
 * light that bounces on its way is judged once settled: at the end of the
 * observation, or at the fast count when a double-tap action may run after it.
 *
 * Known limits (issue #5, judged from light states, which a bouncing light
 * blurs), also printed with the verdict: a Toggle / Room master tap that runs
 * twice before the next tap ends where a correct double tap ends, so it
 * passes; and on a button with multi-tap actions the end state is read at the
 * fast count, which a light still bouncing from a turn-off can outlast.
 */
export function checkKnownTaps(cfg, {fired, changes, startStates: start}) {
    const lines = [];
    const known = fired.map((f, i) => [f, i]).filter(([f]) => f.data.gesture === "tap_known");
    if (known.length !== 2) return {ok: false, lines: [`saw ${known.length} known taps, not 2`]};
    const [[first, firstIndex]] = known;
    let ok = true;
    const early = changes.filter((c) => c.t < first.t);
    if (early.length) {
        lines.push(`${early.length} change(s) before the first known tap`);
        ok = false;
    }
    if (!changes.some((c) => c.t >= first.t)) {
        lines.push("nothing changed after known tap #1");
        ok = false;
    }
    const fastAt = fired.find((f, i) => i > firstIndex && /^fast_/.test(f.data.gesture))?.t ?? Number.POSITIVE_INFINITY;
    // Settled: after the observation, unless a double-tap action may follow the fast count.
    const settled = cfg.multi ? fastAt : Number.POSITIVE_INFINITY;
    if (cfg.multi) lines.push("(judged at the fast count, before the double-tap action: a light still bouncing then may fail)");
    /** A target's last recorded state before `t`, or its state at the start when it hadn't changed. */
    const stateAt = (e, t) => changes.filter((c) => c.entity_id === e && c.t < t).at(-1)?.state ?? start[e];
    const judged = cfg.targets.filter((e) => {
        const st = start[e]?.state;
        if (st !== undefined && !UNJUDGED.includes(st)) return true;
        lines.push(`(${e} is ${st ?? "not found"}: not judged)`);
        return false;
    });
    if (cfg.mode === "brighten" || cfg.mode === "dim") {
        // A light that went unavailable / unknown reads as that state, so it never passes for off.
        const level = (st) => (UNJUDGED.includes(st.state) ? st.state : isOn(st.state) ? st.attributes?.brightness : "off");
        const lights = judged.filter((e) => {
            if (!e.startsWith("light.")) return false;
            if (isOn(start[e].state) && typeof start[e].attributes?.brightness === "number") return true;
            lines.push(`(${e} ${isOn(start[e].state) ? "has no brightness" : "was off"}: not judged)`);
            return false;
        });
        // A copy of c4_device's tap branch (tools/gen-c4-device.mjs): change both together.
        const step = pyRound(Number(cfg.tapStep ?? BLUEPRINT_DEFAULTS.tap_step) * 2.55);
        const lit = lights.map((e) => level(start[e])).filter((l) => l !== "off");
        const from = lit.length ? Math.max(...lit) : "off";
        if (from === "off") {
            lines.push(`(no light with a brightness was lit to ${cfg.mode} from: not judged)`);
            return {ok, lines};
        }
        // The level after each known tap, in order.
        const wants = [];
        for (let n = 0, l = from; n < known.length; n++) {
            if (cfg.mode === "brighten") l = Math.min(l + step, 255);
            else l = l > Number(cfg.dimFloor ?? BLUEPRINT_DEFAULTS.dim_floor) * 2.55 ? Math.max(l - step, 3) : "off";
            wants.push(l);
        }
        const tapNo = (n) => known[n][0].data.tap_index ?? n + 1;
        for (const e of lights) {
            // Each level must show, in order; the same level twice running shows once.
            const seen = changes.filter((c) => c.entity_id === e && c.t >= first.t && c.t < settled).map((c) => level(c.state));
            let at = 0;
            for (const [n, want] of wants.entries()) {
                while (at < seen.length && seen[at] !== want) at++;
                if (at === seen.length && n < wants.length - 1) {
                    lines.push(`${e} never showed ${want} after known tap #${tapNo(n)} (${cfg.mode} from ${from})`);
                    ok = false;
                    break;
                }
            }
            const end = level(stateAt(e, settled));
            if (end !== wants.at(-1)) {
                lines.push(`${e} was at ${end} after known tap #${tapNo(wants.length - 1)}, not ${wants.at(-1)} (${cfg.mode} from ${from})`);
                ok = false;
            }
        }
        return {ok, lines};
    }
    const flipping = cfg.mode === "toggle" || cfg.mode === "room_master";
    if (flipping) lines.push("(not judged: a tap that runs twice before the next known tap; see checkKnownTaps)");
    else lines.push(`(a second ${cfg.mode} tap changes nothing visible: each target is checked for its end state)`);
    // Toggle / Room master act on the targets as one group (c4_device): all off while any is on, else
    // all on. The two known taps toggle it twice, so every target ends where the group began.
    const groupStart = judged.some((e) => onOff(start[e]) === "on") ? "on" : "off";
    for (const e of judged) {
        const began = flipping ? groupStart : onOff(start[e]);
        const scene = cfg.mode === "scene" ? cfg.scene?.[e] : undefined;
        if (cfg.mode === "scene" && !scene) {
            lines.push(`${e} is not in the Tap action's Scene`);
            ok = false;
            continue;
        }
        const want = flipping ? groupStart : scene ? onOff({state: scene.state ?? "off"}) : cfg.mode === "on" ? "on" : "off";
        const moved = changes.some((c) => c.entity_id === e && c.t >= first.t && c.t < settled);
        // An even number of Toggle flips ends where it began: a target that never changed must not pass as one.
        if (flipping && !moved) {
            lines.push(`${e} never changed (${known.length} ${cfg.mode} taps)`);
            ok = false;
            continue;
        }
        const last = stateAt(e, settled);
        // c4_device counts unavailable as off, but a target that dropped out never showed the tap.
        if (UNJUDGED.includes(last.state)) {
            lines.push(`${e} ended ${last.state} (${known.length} ${cfg.mode} taps)`);
            ok = false;
            continue;
        }
        const end = onOff(last);
        if (end !== want) {
            lines.push(`${e} ended ${end}, not ${want} (${known.length} ${cfg.mode} taps from ${began})`);
            ok = false;
        } else if (scene?.level != null && want === "on" && e.startsWith("light.")) {
            const bri = last.attributes?.brightness;
            if (typeof bri !== "number" || Math.abs(bri - scene.level) > SCENE_SLACK) {
                lines.push(`${e} ended at ${bri ?? "no brightness"}, not ${Math.round(scene.level)} (the Scene's level)`);
                ok = false;
            }
        }
    }
    return {ok, lines};
}

/**
 * The gaps between a known double tap's presses that the known scenario taps
 * with (issue #10): 100 ms stands in for lights that report slower than the
 * taps come (a busy mesh), 150 ms is a fast double tap, 450 ms is late in the
 * tap window.
 */
const KNOWN_GAPS = [100, 150, 450];

async function knownScenario(ctx) {
    const {cfg} = ctx;
    if (!ctx.seqs.double.length) return {skip: "the contract fixture has no known double tap for this device"};
    const results = [];
    for (const gap of KNOWN_GAPS) {
        const label = `presses ${gap} ms apart`;
        const {obs, lines} = await observePrepared(ctx, `known ${label}`, sequences(ctx.dev, ctx.button, gap).double);
        // Home Assistant decides which taps act: a response that acts on no known tap skips the scenario.
        if (!obs.traced.some((x) => x.run?.does === "tap" && x.run.trigger === "known"))
            return {skip: `${responseOf(cfg)}: HA ran no tap on a known tap${obs.restoreError ? ` (${obs.restoreError})` : ""}`};
        const verdict = checkKnownTaps(cfg, obs);
        results.push({label, ok: verdict.ok, lines: [...lines, ...verdict.lines], restoreError: obs.restoreError});
    }
    return merge(results);
}

async function fallbackScenario(ctx) {
    const {cfg, seqs} = ctx;
    if (!seqs.unknownTap.length) return {skip: "this device always knows its taps (no release to wait for)"};
    const {obs, lines, between} = await observePrepared(ctx, "fallback", seqs.unknownTap);
    const owner = tapOwner(obs.traced, ctx.button);
    // A response that acts on the device's own count anyway has nothing to fall back from.
    if (owner && owner.trigger !== "fast_tap") return {skip: `${responseOf(cfg)}: HA ran the tap on ${owner.trigger}, not on the fast count`};
    const at = obs.fired.findIndex((f) => f.data.gesture === "fast_single");
    const ok = at >= 0 && between(at).length > 0 && obs.changes.every((c) => c.t >= obs.fired[at].t);
    lines.push(`expected the tap on the fast count (known_taps ${obs.fired[at]?.data.known_taps})`);
    if (!ok) lines.push(at < 0 ? "the fast count was not dispatched" : "the targets did not change on the fast count alone");
    return {ok, lines, restoreError: obs.restoreError};
}

/** A count's name by its number of taps. */
const COUNT = {2: "double", 3: "triple"};

/**
 * The double / triple scenarios' verdict on a known tap sequence of `taps`
 * taps, given the action the button runs for that count: the single tap ran
 * at the first known tap when the button acts at once or commits early toward
 * ON (judged from the targets' states when the observation began), and never
 * before the count otherwise; the count's action changed an entity it names
 * after the count (the device's own count under Wait, else the fast count),
 * judged on those that aren't the button's targets when it names any.
 */
export function checkMultiTap(cfg, {fired, changes, startStates}, taps, action, owner) {
    const lines = [];
    const count = cfg.response === "wait" ? COUNT[taps] : `fast_${COUNT[taps]}`;
    const at = fired.find((f) => f.data.gesture === count);
    if (!at) return {ok: false, lines: [`${count} was not dispatched`]};
    const first = fired.find((f) => f.data.gesture === "tap_known" && Number(f.data.tap_index) === 1);
    const early = tappedAtOnce(owner, cfg, anyOnIn(cfg.targets, startStates));
    const before = changes.filter((c) => cfg.targets.includes(c.entity_id) && c.t < at.t);
    let ok = true;
    lines.push(`expected the tap ${early ? "at known tap #1" : "not to run"}, and the ${COUNT[taps]}-tap action on ${count}`);
    if (early && !(first && before.some((c) => c.t >= first.t))) {
        lines.push(first ? `the tap changed no target between known tap #1 and ${count}` : "known tap #1 was not dispatched");
        ok = false;
    } else if (!early && before.length) {
        lines.push(`${before.length} target change(s) before ${count}: the tap ran`);
        ok = false;
    }
    const named = namedEntities(action);
    const others = named.filter((e) => !cfg.targets.includes(e));
    const judged = others.length ? others : named;
    if (!action.length) lines.push(`(no ${COUNT[taps]}-tap action: nothing to see on ${count})`);
    else if (!judged.length) lines.push(`(the ${COUNT[taps]}-tap action names no entity: not judged)`);
    else if (!changes.some((c) => judged.includes(c.entity_id) && c.t >= at.t)) {
        lines.push(`the ${COUNT[taps]}-tap action changed none of ${judged.join(", ")} after ${count}`);
        ok = false;
    }
    return {ok, lines};
}

/**
 * A known double or triple tap from each start; the entities the count's
 * action names that aren't targets are turned off first (lights, switches,
 * fans, input booleans), so the action shows.
 */
async function multiTapScenario(ctx, taps) {
    const {cfg} = ctx;
    if (!cfg.multi) return {skip: "the button has no multi-tap actions"};
    const seq = ctx.seqs[COUNT[taps]];
    if (!seq.length) return {skip: `the contract fixture has no known double tap to build a ${COUNT[taps]} tap from`};
    const action = cfg.multiActions[COUNT[taps]];
    const others = namedEntities(action).filter((e) => !cfg.targets.includes(e));
    const off = others.filter((e) => /^(light|switch|fan|input_boolean)\./.test(e));
    const results = [];
    for (const start of starts(cfg)) {
        const calls = [...(off.length ? [{domain: "homeassistant", service: "turn_off", service_data: {entity_id: off}}] : []), ...start.calls];
        const {obs, lines} = await observePrepared(ctx, `${COUNT[taps]}${start.label ? ` ${start.label}` : ""}`, seq, calls, [...cfg.targets, ...others]);
        // The run that owned known tap #1, if one did: HA's decision, read from its trace.
        const owner = obs.traced
            .map((x) => x.run)
            .find(
                (r) =>
                    r?.button === ctx.button && r.trigger === "known" && Number(r.variables.evt?.tap_index) === 1 && ["tap", "early commit"].includes(r.does),
            );
        const verdict = checkMultiTap(cfg, obs, taps, action, owner);
        results.push({label: start.label, ok: verdict.ok, lines: [...lines, ...verdict.lines], restoreError: obs.restoreError});
    }
    return merge(results);
}

async function holdScenario(ctx) {
    const {cfg, seqs, button} = ctx;
    if (!seqs.hold.length) return {skip: "this device reports no hold"};
    if (cfg.hold === false) return {skip: "hold-to-dim is off for this button"};
    const lights = cfg.targets.filter((e) => e.startsWith("light."));
    if (!lights.length) return {skip: "the button has no light targets"};
    const obs = await watched(ctx, "hold", seqs.hold);
    // A button that drives its own load (c4_device's drives_load, as HA rendered it) leaves the ramp to the device.
    const mine = obs.traced.map((x) => x.run).filter((r) => r?.button === button);
    if (!mine.some((r) => r.does === "hold") && mine.some((r) => r.variables.drives_load === true))
        return {skip: `the button drives its own load, which a hold ramps itself${obs.restoreError ? ` (${obs.restoreError})` : ""}`};
    const t0 = obs.fired[0]?.t;
    const holdAt = obs.fired.find((f) => f.data.gesture === "hold")?.t;
    const lines = obs.changes.map((c) => `${c.entity_id}: ${c.from} -> ${c.to} ${t0 == null ? "" : ms(c.t, t0)}`);
    const levels = new Set(obs.changes.filter((c) => lights.includes(c.entity_id)).map((c) => c.state?.attributes?.brightness));
    const early = obs.changes.filter((c) => holdAt == null || c.t < holdAt);
    if (early.length) lines.push(`${early.length} change(s) before the hold event: a tap ran`);
    if (levels.size < 2) lines.push("the lights did not ramp");
    return {ok: levels.size >= 2 && early.length === 0, lines, restoreError: obs.restoreError};
}

/** How far (of 255) a Scene light may be from its level and still count: c4_device's 2 points. */
const SCENE_SLACK = 5.1;

/**
 * The Scene in a button's Tap action (`actions`, one scene.apply): each
 * entity's state (null when it has none) and level of 255 (null when it has
 * none). Empty when the Tap action is not one scene.apply.
 */
export function sceneOf(actions) {
    const a = actions.length === 1 && actions[0] && typeof actions[0] === "object" ? actions[0] : {};
    const raw = (a.action ?? a.service) === "scene.apply" ? a.data?.entities : undefined;
    const scene = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(
        Object.entries(scene).map(([e, spec]) => {
            const d = spec && typeof spec === "object" ? spec : {state: spec};
            // YAML reads an unquoted on / off as a boolean, as scene.apply allows.
            const st = d.state === true ? "on" : d.state === false ? "off" : d.state;
            const level = d.brightness != null ? Number(d.brightness) : d.brightness_pct != null ? Number(d.brightness_pct) * 2.55 : null;
            return [e, {state: st == null ? null : String(st), level}];
        }),
    );
}

/** How long after the targets change the LED scenario reads the LED: c4_device's LED delay, then time for a DIM1-Z's fade. */
const LED_SETTLE = 3000;

/** Two led_status calls are the same call: the same LEDs and look. */
const sameCall = (a, b) =>
    ["buttons", "color", "brightness", "pressed_color", "pressed_brightness"].every((k) => String(a?.[k] ?? "") === String(b?.[k] ?? ""));

/** A led_status call for a line: "1,5 Cyan 75%". */
const showCall = (c) => `${c.buttons} ${c.color}${c.brightness == null ? "" : ` ${c.brightness}%`}${c.pressed_color ? `, pressed ${c.pressed_color}` : ""}`;

/**
 * The LED scenario's verdict: every led_status call each LED run decided on (its
 * trace's calls, read by readTrace) was published to the device after the run
 * began. `ledRuns` are {t, run} in start order; `sent` the led_status payloads
 * seen on the device's set topic, each with its time `t`.
 */
export function checkLedCalls(ledRuns, sent) {
    const lines = [];
    let ok = true;
    for (const {t, run} of ledRuns) {
        for (const call of run.leds) {
            const seen = sent.some((x) => x.t >= t && sameCall(x.call, call));
            if (!seen) ok = false;
            lines.push(`${seen ? "sent" : "NOT sent"}: ${showCall(call)} (HA's LED run on ${run.trigger})`);
        }
    }
    return {ok, lines};
}

async function ledScenario(ctx) {
    const {ha, dev, cfg, mine, button, seqs} = ctx;
    if (!seqs.tap.length) return {skip: "the contract fixture has no known tap for this device"};
    const topic = `control4/${dev.ieee}/set`;
    const sent = [];
    const off = await ha.subscribe("call_service", (e) => {
        const {domain, service, service_data: data} = e.data;
        if (domain !== "mqtt" || service !== "publish" || data?.topic !== topic) return;
        // HA renders the blueprint's JSON payload to an object; a string is parsed.
        const payload = (() => {
            try {
                return typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
            } catch {
                return undefined;
            }
        })();
        if (payload?.led_status) sent.push({t: Date.parse(e.time_fired), call: payload.led_status});
    });
    const [start] = starts(cfg);
    let obs;
    try {
        const entities = [...new Set([...cfg.targets, ...inputList(mine.input, `b${button}_watch`)])];
        obs = await observeRestoring(
            ha,
            entities,
            async () => {
                await publish(ha, seqs.tap);
                await sleep(LED_SETTLE);
                await prepare(ha, start.calls);
                await sleep(LED_SETTLE);
            },
            0,
            {
                traceOf: mine,
                prepare: async () => {
                    await prepare(ha, start.calls);
                    await sleep(LED_SETTLE);
                },
            },
        );
    } finally {
        await off();
    }
    const ledRuns = obs.traced.filter((x) => x.run?.does === "leds" && x.run.leds.length > 0);
    if (!ledRuns.length) return {skip: `c4_device sent no LED calls for this device${obs.restoreError ? ` (${obs.restoreError})` : ""}`};
    const verdict = checkLedCalls(ledRuns, sent);
    return {ok: verdict.ok, lines: verdict.lines, restoreError: obs.restoreError};
}

async function idleScenario(ctx) {
    const {autos, unreadable, mine, runs} = ctx;
    const others = autos.filter((a) => a !== mine);
    const lines = [];
    if (unreadable.length) lines.push(`${unreadable.length} automation(s) not readable through the config API (YAML / packages), not checked`);
    if (!others.length) return {skip: ["no other c4_device automation to check", ...lines].join("; ")};
    if (ctx.idleBlockers.length) return {ok: false, lines: [...lines, ...ctx.idleBlockers]};
    let ok = true;
    for (const a of autos) {
        const n = runs.get(a.entity)?.size ?? 0;
        if (a === mine) {
            lines.push(`${a.entity} (this device): ${n} run(s) from Control4 events`);
            if (!n) ok = false;
        } else if (n) {
            ok = false;
            lines.push(`${a.entity}: ${n} run(s) from Control4 events - should be idle`);
        }
    }
    lines.push(`${others.length} other c4_device automation(s) checked over the scenarios that ran before this one`);
    return {ok, lines};
}

async function unknownScenario(ctx) {
    const {ha, autos, seqs} = ctx;
    const ghost = seqs.tap.map((s) => ({...s, payload: {...s.payload, ieee: UNKNOWN_IEEE, device: "c4-scenario-ghost"}}));
    const seen = new Map();
    const errors = [];
    const obs = await observe(ha, [], () => publish(ha, ghost), 3000, {autos, runs: seen, errors});
    const got = obs.dispatched.filter((f) => f.data.ieee === UNKNOWN_IEEE);
    const runs = [...seen.values()].reduce((n, s) => n + s.size, 0);
    const lines = [`${got.length} control4_event(s) for ${UNKNOWN_IEEE}`, ...(errors.length ? errors : [`${runs} c4_device run(s) from Control4 events`])];
    return {ok: got.length === 0 && runs === 0 && !errors.length, lines};
}

async function mapNow(ha) {
    const s = (await ha.call({type: "get_states"})).find((x) => x.entity_id === MAP_SENSOR);
    return {devices: s?.attributes?.devices ?? {}, built: s?.attributes?.built};
}

/** Wait for the map sensor to be rebuilt after `built`. */
async function rebuilt(ha, built, timeout = 10_000) {
    const end = Date.now() + timeout;
    for (;;) {
        const m = await mapNow(ha);
        if (m.built !== built || Date.now() > end) return m;
        await sleep(250);
    }
}

/** rename and stale check the dispatcher package, which c4_device no longer needs (ADR 0005). */
const NO_DISPATCHER = {skip: `${MAP_SENSOR} not found: the dispatcher package (optional) is not deployed`};
const hasDispatcher = async (ha) => (await ha.call({type: "get_states"})).some((x) => x.entity_id === MAP_SENSOR);

async function renameScenario(ctx) {
    const {ha, dev} = ctx;
    if (!(await hasDispatcher(ha))) return NO_DISPATCHER;
    const before = await mapNow(ha);
    const lines = [`map before: ${Object.keys(before.devices).length} device(s)`];
    const same = (m) => JSON.stringify(Object.entries(m.devices).sort()) === JSON.stringify(Object.entries(before.devices).sort());
    if (before.devices[dev.ieee] !== dev.id) return {ok: false, lines: [...lines, `${dev.ieee} missing from the map before the rename`]};
    let renamed;
    try {
        await ha.call({type: "config/device_registry/update", device_id: dev.id, name_by_user: `${dev.name} (c4 scenario)`});
        renamed = await rebuilt(ha, before.built);
    } finally {
        await ha.call({type: "config/device_registry/update", device_id: dev.id, name_by_user: dev.nameByUser ?? null});
    }
    const back = await rebuilt(ha, renamed.built);
    lines.push(`after the rename: ${renamed.built !== before.built ? "rebuilt" : "NOT rebuilt"}, ${same(renamed) ? "complete" : "CHANGED"}`);
    lines.push(`after renaming back: ${back.built !== renamed.built ? "rebuilt" : "NOT rebuilt"}, ${same(back) ? "complete" : "CHANGED"}`);
    return {ok: renamed.built !== before.built && same(renamed) && back.built !== renamed.built && same(back), lines};
}

async function staleScenario(ctx) {
    const {ha, dev, cfg, seqs} = ctx;
    const real = (await ha.call({type: "get_states"})).find((x) => x.entity_id === MAP_SENSOR);
    if (!real) return NO_DISPATCHER;
    const lost = Object.fromEntries(Object.entries(real.attributes.devices ?? {}).filter(([k]) => k !== dev.ieee));
    // Overwrite the sensor's state (until its next rebuild) with a map that lost the device.
    await ha.rest("POST", `/api/states/${MAP_SENSOR}`, {
        state: String(Object.keys(lost).length),
        attributes: {...real.attributes, devices: lost, built: "c4-scenario-stale"},
    });
    const obs = await observeRestoring(ha, cfg.targets, () => publish(ha, seqs.tap.slice(0, 1)), 3000);
    const healed = (await mapNow(ha)).devices[dev.ieee] === dev.id;
    const got = obs.dispatched.filter((f) => f.data.device_id === dev.id).length;
    const lines = [`${got} control4_event(s) for the device after the map lost it`, `map ${healed ? "has" : "does NOT have"} the device again`];
    return {ok: got === 1 && healed, lines, restoreError: obs.restoreError};
}

const RUN = {
    tap: tapScenario,
    known: knownScenario,
    fallback: fallbackScenario,
    double: (ctx) => multiTapScenario(ctx, 2),
    triple: (ctx) => multiTapScenario(ctx, 3),
    hold: holdScenario,
    led: ledScenario,
    idle: idleScenario,
    unknown: unknownScenario,
    rename: renameScenario,
    stale: staleScenario,
};

// ---------------------------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const url = (process.env.HA_URL ?? "").replace(/\/$/, "");
    const token = process.env.HA_TOKEN ?? (process.env.HA_TOKEN_FILE ? fs.readFileSync(process.env.HA_TOKEN_FILE, "utf8").trim() : "");
    const deviceArg = opts.device;
    const buttonArg = opts.button ?? "1";
    const only = (opts.only ?? SCENARIOS.join(",")).split(",");
    if (!url || !token || !deviceArg) throw new UsageError('set HA_URL and HA_TOKEN (or HA_TOKEN_FILE), and pass --device "<HA device name or id>"');
    if (!/^[1-6]$/.test(buttonArg)) throw new UsageError(`--button takes a button number 1-6, not '${buttonArg}'`);
    const unknown = only.find((s) => !SCENARIOS.includes(s));
    if (unknown !== undefined) throw new UsageError(`unknown scenario '${unknown}': pick from ${SCENARIOS.join(", ")}`);
    if (only.includes("idle") && !only.includes("tap")) throw new UsageError("idle needs tap: it watches the other automations while tap (and hold) run");
    const button = Number(buttonArg);
    const ha = await connect(url, token);
    let failed = 0;
    try {
        const found = await discover(ha, deviceArg, button);
        // runs: automation entity -> ids of runs a Control4 event started during the scenarios that watch them (for idle).
        const ctx = {ha, ...found, button, seqs: sequences(found.dev, button), runs: new Map(), idleBlockers: []};
        console.log(
            `${found.dev.name} (${found.dev.model}, ${found.dev.ieee}) button ${button}: ${found.cfg.mode}, response ${found.cfg.response}, targets ${found.cfg.targets.join(", ")}`,
        );
        for (const name of SCENARIOS.filter((s) => only.includes(s))) {
            const r = await RUN[name](ctx).catch((e) => ({ok: false, lines: [String(e?.message ?? e)]}));
            // A scenario that couldn't put its targets back fails, whatever it saw.
            if (r.restoreError) Object.assign(r, {ok: false, lines: [...r.lines, r.restoreError]});
            if (r.skip) {
                console.log(`SKIP ${name}: ${r.skip}`);
                continue;
            }
            if (!r.ok) failed++;
            console.log(`${r.ok ? "PASS" : "FAIL"} ${name}`);
            for (const l of r.lines) console.log(`     ${l}`);
        }
    } finally {
        ha.close();
    }
    process.exitCode = failed ? 1 : 0;
}

/** A command-line mistake: exit 2, like a missing setting. */
class UsageError extends Error {}

/** `--name value` pairs; anything else is refused, so a typo never runs scenarios it didn't name. */
function parseArgs(args) {
    const out = {};
    for (let i = 0; i < args.length; i += 2) {
        const name = /^--(device|button|only)$/.exec(args[i])?.[1];
        if (!name) throw new UsageError(`unknown option '${args[i]}': use --device, --button, --only`);
        const value = args[i + 1];
        if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
        if (name in out) throw new UsageError(`--${name} given twice`);
        out[name] = value;
    }
    return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    // Set the exit code and let the process end on its own: process.exit() while
    // the websocket is still closing aborts Node on Windows.
    main().catch((e) => {
        console.error(e?.message ?? e);
        process.exitCode = e instanceof UsageError ? 2 : 1;
    });
}
