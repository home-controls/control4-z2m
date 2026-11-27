# Plan: c4_device's response rules, tested where they live

From `/supermatt:improve-architecture` on 2026-10-29 (verdict: Localized, candidate 1 of 2). Every decision below was settled with the user. This plan is the input for `/to-spec` or `/implement`.

## Status, 2026-11-27

- **Steps 1-7 are built:** minijinja-js (an exact devDependency), the conformance probe
  (`test/fixtures/jinja-conformance.jinja` and `.expected`, `test/jinja-conformance.test.ts`, and its live step in
  `tools/ha-validate-blueprints.mjs`), `test/c4-device.ts` with its internals in `test/c4-device/`,
  `tools/c4-device-run.mjs` and its `.d.mts`, the tests at the interface (`test/c4-device*.test.ts`), and the covered
  rule pins removed from `test/blueprints.test.ts`.
- **Steps 8-9 are not built.** There is no `readTrace` or `TracedRun`, and no `test/fixtures/c4-device-trace-*.json`.
  `tools/c4-scenarios.mjs` still holds its JS copies of the rules (`tapSource`, `actsAtOnce`, `commitsEarly`,
  `LED_BUTTONS` and the rest), and `test/c4-scenarios.test.ts` still tests them.
- Below, everything that belongs to steps 8-9 is marked **not yet built**.

## Problem

- **The modules involved:**
  - `tools/gen-c4-device.mjs` builds c4_device's rules as Jinja strings, and writes them into `blueprints/c4_device.yaml`.
  - `test/blueprints.test.ts` checks that output with 66 string assertions (`toContain`, `toMatch`, `toBe` on the generated text). Those assertions check the wording, not the behaviour: rewording a rule breaks them, and a wrong rule passes them.
  - `tools/c4-scenarios.mjs` (the by-hand live runner) holds a second, JS copy of the same rules: `tapSource`, `actsAtOnce`, `commitsEarly`, `expectedLed`, `ledNumbers`, `sceneState`, `paddleLocal`, `LED_BUTTONS`, `ON_STATES`. `test/c4-scenarios.test.ts` tests that copy, not the blueprint.
- **Integration risk.** The Jinja and the JS copy can drift apart, and nothing notices. Only a live run with real lights, done by hand, exercises the Jinja's behaviour.
- **Symptoms:**
  - **Change amplification.** 7 of the generator's 14 commits also changed the JS copy. Early commit (5fcca42) took +126 lines in the generator, +85 in the text pins, +421 in the JS copy and +200 in its tests. Archived issue 22's commit message says "c4-scenarios' copy of the LED calls follows."
  - **Unknown unknowns.** A rule bug in the Jinja passes `npm run check`.

## Proposed Interface

There are two modules, so the rendering engine never leaves `test/`.

**`test/c4-device.ts`** is the deep module. It is test-only and is the only file that imports minijinja-js.

```ts
export type ButtonNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type TapCount = "single" | "double" | "triple" | "quadruple";
/** number = a light on at that brightness (0-255); string = the state; null = no such entity */
export type StateSpec = number | string | null | {state: string; attributes?: Record<string, unknown>};
export interface ButtonInputs {          // the b<N>_ inputs, without the prefix
    targets?: string[]; mode?: string; hold?: boolean; action?: unknown[]; double?: unknown[]; triple?: unknown[]; quad?: unknown[];
    led?: string[]; watch?: string[]; on?: string; off?: string; night_on?: string; night_off?: string;
}
export interface DeviceSetup {
    model?: string;                     // model_id; default "C4-KP3-Z"
    buttons?: Partial<Record<ButtonNumber, ButtonInputs>>;
    inputs?: Record<string, unknown>;   // every other input by its blueprint name: tap_response, led_follow, night_*, room_extra ...
    states?: Record<string, StateSpec>; // the world before the happening
    paddleLocal?: boolean;              // its "Paddle controls local load" switch, in that state; absent unless given
    eventsEntity?: boolean | string[];  // its Control4 events entity (ADR 0005): the model's declared event types (default), none, or these
    time?: string;                      // what now() says, "HH:MM:SS"; default "12:00:00"
}
export interface Reaction {
    does: Does; button: ButtonNumber | null; targets: string[];   // from the run that passes ("nothing" / null / [] if none)
    leds: LedCall[];                    // the led_status calls it sends; [] when none
    led(name: string): LedLook | undefined;   // "button_3" or an LED number "5"
    hears?: boolean;                    // boot / reload only
    runs: Run[];                        // every run it started, in trigger order
}
export interface C4Device {
    readonly ieee: string; readonly model: string;
    on(h: Happening): Reaction;         // throws if more than one run passes
    runs(h: Happening): Run[];          // never throws for that (led_first tests)
}
export function c4Device(setup?: DeviceSetup): C4Device;
// Happenings, built from Contract payloads (test/fixtures/control4-event.json), addressed for the model
export function knownTap(b: ButtonNumber, tapIndex?: number): Happening;
export function fastCount(b: ButtonNumber, n?: TapCount, o?: {known?: boolean}): Happening;
export function deviceCount(b: ButtonNumber, n?: TapCount): Happening;
export function press(b: ButtonNumber): Happening;
export function release(b: ButtonNumber): Happening;
export function hold(b: ButtonNumber): Happening;
export function event(payload: Record<string, unknown>): Happening;
export function change(entity: string, to: StateSpec, from?: StateSpec): Happening;  // from defaults to the setup's state
export function boot(): Happening;
export function reload(): Happening;
export function clock(time?: string): Happening;    // each time trigger due at `time` fires: Night start / end, the five-minute check
export const anyAction: unknown[];
export function sceneApply(levels: Record<string, number | "off">): unknown[];
/** The conformance probe only: the same environment, raw output as HA's render_template gives it. */
export function renderTemplate(source: string, variables?: Record<string, unknown>): string;
export class C4TemplateError extends Error { step: "variable" | "condition" | "led branch" | "hears" | "led step"; variable?: string }  // not `name`: Error has one
```

**`tools/c4-device-run.mjs` + `.d.mts`** has no dependencies. It is the decision shape that both adapters share, and the live runner imports it.

```ts
export type Does = "nothing" | "tap" | "early commit" | "hold" | "double" | "triple" | "quadruple" | "leds";  // early commit: Direction decides whether it taps at once
export interface Run {
    passes: boolean;                    // the top-level condition
    does: Does;                         // "nothing" unless passes
    trigger: string;                    // tid: known, fast_tap, fast_double, tap, press, hold, led, ...
    button: ButtonNumber | null;        // Button number (bi + 1); null for a run that is not a button's
    targets: string[];                  // tgt
    variables: Readonly<Record<string, unknown>>;   // every top-level variable by its blueprint name, typed as HA holds it
}
export interface LedCall { buttons: string; color: string; brightness: number; pressed_color?: string; pressed_brightness?: number }
export type LedLook = Omit<LedCall, "buttons">;
export function readRun(variables: Record<string, unknown>, passes: boolean): Run;  // throws when the flags say two things at once
export function ledLook(calls: LedCall[], name: string): LedLook | undefined;
// Not yet built (step 8): TracedRun and readTrace
export interface TracedRun extends Run { leds: LedCall[]; hears?: boolean; error?: string; running: boolean }
export function readTrace(traceGet: unknown): TracedRun;   // a trace/get result; steps found by content (`calls`, `hears`)
```

**Usage**

```ts
// Auto (the default), every target off (toward ON), a double-tap action: early commit (ADR 0002)
const kp = c4Device({buttons: {2: {targets: ["light.one"], double: anyAction}}, states: {"light.one": "off"}});
expect(kp.on(knownTap(2)).does).toBe("early commit");
expect(kp.on(fastCount(2)).does).toBe("nothing");                        // a known sequence's fast count leaves it to that run
expect(kp.on(fastCount(2, "single", {known: false})).does).toBe("tap");  // taps never known: handled as Fast
expect(kp.on(release(2)).does).toBe("nothing");                          // a release starts no run

// KC120277: one light change fires several state triggers; exactly one paints
const kc = c4Device({model: "C4-KC120277", buttons: {1: {targets: ["light.two"]}, 2: {targets: ["light.three"], watch: ["light.two"], on: "Blue"}}});
expect(kc.on(change("light.two", 200)).led("button_2")).toEqual({color: "Blue", brightness: 75});
```

```js
// tools/c4-scenarios.mjs, once step 8 is built (not yet): HA's real decision, read from the run's trace (the engine is never loaded here)
const owner = traces.map(readTrace).find((r) => r.button === button && ["tap", "early commit"].includes(r.does));
```

**What it hides:**
- Loading the committed blueprint: the `!input` tag, input declarations and their defaults, and the `{2: {mode}}` to `b2_mode` mapping.
- HA's trigger matching and fan-out:
  - the event.received `event_type` filter;
  - LED state triggers taken in YAML order, which gives `trigger.idx`;
  - `to: ~` firing on a state change and `attribute: brightness` on a brightness change;
  - the time, boot and reload triggers.
- The fake HA world: the device registry entry, entity states, and the stubs (`device_attr`, `device_entities`, `states`, `is_state`, `state_attr`, `regex_findall`, `int`/`float`/`round` (half-even)/`is_number`, `search`/`match`, `now`).
- The minijinja settings: `pycompat`, lenient undefined, and the `sum(start=)` override.
- A port of HA's `_parse_result`.
- HA's rendering order: variables one after another, the condition rendered untyped, the gate on the LED branch, and the LED and hears steps found by their content.
- The trace layout: the `trigger/<idx>` step's `changed_variables`, `condition/0`, and `script_execution` (not yet built: step 8).

## Cohesion Statement

- **Single responsibility:** tell what c4_device does when one thing happens to one device, as Home Assistant would decide it.
- **What it owns:**
  - which runs a happening starts, and which one passes;
  - each run's decision (tap, early commit, hold, multi-tap gesture, targets);
  - the led_status calls an LED run sends, and whether the device hears its buttons;
  - reading the same decision from an HA trace (`tools/c4-device-run.mjs`; not yet built, step 8).
- **What stays out:**
  - Tap outcomes (the TAP branch's service calls), hold ramps, early-commit waits, and Direction (`toward_on`). These were settled as out of scope. c4-scenarios keeps judging them in JS (`towardOn`, `checkKnownTaps`, `checkMultiTap`), so Direction still has an independent check.
  - The generator's string building. It doesn't change; the module reads the committed YAML, which the existing test keeps equal to the generator's output.
  - c4-scenarios' Home Assistant plumbing: connecting, publishing, observing, restoring, polling traces, and the scenario setup (`starts`, `prepareCall`, `sequences`).
  - Structural text pins: the picker, the description, the trigger list, the waits on the device topic, and the Contract fields read. These are structure, not rules.
  - The per-model facts table (candidate 2). It is a separate change.
  - The other blueprints, which have no caller yet.

## Dependency Strategy

- **Category: in-process, with a local stand-in.** minijinja-js 3.0.0 stands in for HA's Jinja2, and the world is plain data.
  - Vetting found it is published by mitsuhiko, with a registry signature and SLSA provenance.
  - It is an exact-pinned devDependency, imported only by `test/c4-device.ts`. Nothing in `src/` or `tools/` imports it, so it never reaches `dist/`.
- **No renderer port and no world port.** Each would have only one adapter.
- **The one real seam is the `Run` shape.** Two adapters fill it: the local render (through `readRun`, built) and HA's trace (`readTrace`, not yet built).
- **Engine drift** is caught by the conformance probe (see Testing). Drift in the stubs is a known, accepted gap.

## Testing Strategy

- **New tests at the interface** (`test/c4-device.test.ts`):
  - Tap response:
    - every combination of Wait / Fast / Instant / Auto, with and without multi-tap actions, and with known and not-known taps;
    - known taps with tap index 1 and 2, fast counts with `known_taps` true and false, and device counts.
  - Early commit:
    - only on tap index 1, and only with an action or targets;
    - the fast count then leaves the tap to that run;
    - a release starts no run.
  - Hold ownership:
    - a keypad's paddle-down, and a DIM1-Z's hold event;
    - none while the paddle drives its own load (a DIM1-Z with the switch on, an APD120 always).
  - Paddles: top and bottom map to Button 1 and 2. Room modes take every button's targets plus the extras.
  - led_first:
    - a light named in several lists starts exactly one painting run;
    - a brightness change that came with an on/off change leaves the painting to that change's run;
    - `led_bri` paints only with follow on, or for a Scene's light.
  - LED calls:
    - day and night colours, follow, the pressed colour;
    - colour selects winning over the button's name, and `button_N` on the DIM1-Z, KP3, KP6 and KC120277;
    - no calls on an APD120 or SW120277;
    - Scene Active within 2 points, Scene inactive, Fault when the Scene names other lights than Targets, and the night colour winning over Fault.
  - Hears: boot and reload, with and without the events entity.
  - Errors: a template error throws `C4TemplateError`; an undeclared input or Button 3+ on a paddle throws at setup.
  - `readRun` throws on conflicting flags.
  - **Not yet built (step 9):** `readTrace` is tested against captured trace fixtures (`test/fixtures/c4-device-trace-*.json`): a run that passes, a failed condition, an LED run, and an errored run.
  - Conformance probe: `test/fixtures/jinja-conformance.jinja` with an expected-output file covers every construct c4_device uses, plus a dict-insertion-order case. `renderTemplate` must reproduce the expected output exactly.
- **Old tests to remove** (in their own commit, after the new ones pass):
  - the rule pins in `test/blueprints.test.ts` on `variables`, `condition` and the LED step (about 40 of the 66). The structural pins stay.
  - the tests in `test/c4-scenarios.test.ts` for the JS copies that go (not yet: they go with steps 8-9).
- **Test environment needs:**
  - minijinja-js. Its node build loads WASM synchronously; check this at step 1.
  - the Contract fixture.
  - trace fixtures captured once from the test HA (not yet captured).

## Migration Strategy

Incremental. The blueprint and the generator don't change, so nothing is deployed and the Contract doesn't change.

1. The new module and its tests land alongside the text pins, with both green.
2. The covered pins go, in their own commit.
3. c4-scenarios switches to reading traces. *(Not yet built.)*
4. Its JS copies and their tests go. *(Not yet built.)*

## Implementation Steps

Steps 1-7 are built; steps 8-9 are not.

1. **Add `minijinja-js@3.0.0`** as an exact devDependency in `package.json` and the lockfile. Re-run the dependency vetting at install, and confirm the synchronous WASM init under vitest. *(S)*
2. **Write the conformance probe** in `test/fixtures/jinja-conformance.jinja` with its expected output. Render it once on the test HA (`render_template`) to confirm the expected output; HA is the oracle. *(S)*
3. **Build `test/c4-device.ts`.** Its internals may sit in `test/c4-device/` (`engine.ts`, `world.ts`, `blueprint.ts`), with the scratch prototype's `common.mjs` as the starting point. *(M, ~400 lines)*
   - Port `_parse_result`, the sequential render, and the stubs; make `round` half-even.
   - The happening builders re-address Contract payloads through c4-scenarios' existing `sequences()`, not a new copy.
4. **Write `tools/c4-device-run.mjs` and its `.d.mts`**: `Run`, `readRun`, `ledLook`. *(S, ~120 lines)* `readTrace` and `TracedRun` moved to step 8 (decided 2026-10-29): its only caller is c4-scenarios, and a reader written against the traces captured in step 9 can't drift from HA's real trace layout, where one written now would be tested against a hand-made trace.
5. **Write `test/c4-device.test.ts`**, test-first, covering the behaviours listed above. *(L, ~400 lines)*
6. **Add the conformance test** in vitest. Give `tools/ha-validate-blueprints.mjs` a step that renders the probe on live HA and compares it with the expected output (run by hand). *(S)*
7. **Remove the covered rule pins** from `test/blueprints.test.ts`, as a test-removal commit, not a refactor commit. *(S)*
8. **Switch `tools/c4-scenarios.mjs` to read traces.** *(M; not yet built)*
   - Add `readTrace` and `TracedRun` to `tools/c4-device-run.mjs` and its `.d.mts` (moved here from step 4), finding the `calls` and `hears` steps by content.
   - It reads the run that owned the tap, and the LED calls, from traces through `readTrace`.
   - Drop `tapSource`, `actsAtOnce`, `commitsEarly`, `expectedLed`, `ledNumbers`, `sceneState`, `paddleLocal`, `LED_BUTTONS`, `ON_STATES`. Keep `sceneOf` and `roomOf` only where `buttonConfig` still needs them.
   - `checkKnownTaps` and `checkMultiTap` take the owning run instead of working it out.
   - Update `tools/c4-scenarios.d.mts`.
9. **Capture the trace fixtures** from the test HA, add the `readTrace` tests, and prune `test/c4-scenarios.test.ts`. Verify the runner by hand against real lights. *(M; not yet built)*

**Estimated scope:** about 1,000 lines added and about 700 removed. Two pieces of work:
- steps 1-7, entirely offline (built);
- steps 8-9, which need the test HA and real lights (not yet built).
