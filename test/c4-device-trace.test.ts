// readTrace (tools/c4-device-run.mjs) against real c4_device traces from Home Assistant (#25). The fixtures are
// runs of a KC120277's automation, captured on a live HA (2026-11-28) with its names and ids replaced by neutral
// ones, and its config and state noise left out: a tap that committed early, a fast count whose condition failed,
// and an LED run. No c4_device run has errored on that HA, so the errored, running and boot / reload cases below
// are a real fixture with only those fields changed, in the layout HA gives them.
import fs from "node:fs";
import path from "node:path";

import {describe, expect, it} from "vitest";

import {ledLook, readTrace} from "../tools/c4-device-run.mjs";
import {tapOwner} from "../tools/c4-scenarios.mjs";

type Trace = {state: string; script_execution: string; error?: string; trace: Record<string, {path: string; timestamp: string}[]>};

const fixture = (name: string): Trace => JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", `c4-device-trace-${name}.json`), "utf8")) as Trace;

describe("readTrace", () => {
    it("reads a known tap's run that committed early (ADR 0002): its button, targets and the event it took", () => {
        const run = readTrace(fixture("tap"));
        expect(run).toMatchObject({
            passes: true,
            does: "early commit",
            trigger: "known",
            button: 3,
            targets: ["light.one", "light.two"],
            leds: [],
            running: false,
        });
        expect(run.variables.evt).toMatchObject({gesture: "tap_known", tap_index: 1});
        // The trigger step's own `this` and `trigger` are HA's, not the blueprint's variables.
        expect(Object.keys(run.variables)).not.toEqual(expect.arrayContaining(["this", "trigger"]));
        expect(run.hears).toBeUndefined();
        expect(run.error).toBeUndefined();
    });

    it("reads a run whose condition failed as doing nothing, with the decision's variables still there", () => {
        const run = readTrace(fixture("failed"));
        expect(run).toMatchObject({passes: false, does: "nothing", trigger: "fast_tap", button: 3, leds: [], running: false});
        expect(run.variables).toMatchObject({commits_early: true, is_tap: false, early: false});
    });

    it("reads an LED run's led_status calls from the step that set them, wherever it sits", () => {
        const run = readTrace(fixture("led"));
        expect(run).toMatchObject({passes: true, does: "leds", trigger: "led", button: null});
        expect(run.leds).toEqual([
            {buttons: "1", color: "Red", brightness: 7},
            {buttons: "3,5", color: "Off", brightness: 7},
        ]);
        expect(ledLook(run.leds, "5")).toEqual({color: "Off", brightness: 7});
    });

    it("gives the runner the run that owned a traced tap", () => {
        expect(tapOwner([{t: 0, run: readTrace(fixture("tap"))}], 3)).toMatchObject({does: "early commit", trigger: "known"});
        expect(tapOwner([{t: 0, run: readTrace(fixture("failed"))}], 3)).toBeUndefined();
    });

    it("reads the error a run stopped on, from the run or from the step that raised it", () => {
        const led = fixture("led");
        expect(readTrace({...led, script_execution: "error", error: "Error rendering template"}).error).toBe("Error rendering template");
        const step = "action/0/choose/1/sequence/3/repeat/sequence/0";
        const failed = {...led, script_execution: "error", trace: {...led.trace, [step]: [{...led.trace[step][0], error: "Unable to publish"}]}};
        expect(readTrace(failed).error).toBe("Unable to publish");
    });

    it("says a run is still running, as an early commit waiting for its count is", () => {
        expect(readTrace({...fixture("tap"), state: "running"}).running).toBe(true);
    });

    it("reads whether a boot or reload run found the device's Control4 events entity", () => {
        const led = fixture("led");
        const hears = (value: boolean) => ({
            ...led,
            trace: {
                ...led.trace,
                // Where a reload run sets it on a live HA: the branch that checks the events entity.
                "action/0/choose/1/sequence/1": [
                    {path: "action/0/choose/1/sequence/1", timestamp: "2026-11-25T04:00:00.000001+00:00", changed_variables: {hears: value}},
                ],
            },
        });
        expect(readTrace(hears(true)).hears).toBe(true);
        expect(readTrace(hears(false)).hears).toBe(false);
    });

    it("refuses a trace with no trigger step, which has no variables to read", () => {
        expect(() => readTrace({trace: {"condition/0": []}})).toThrow(/no trigger step/);
        expect(() => readTrace(undefined)).toThrow(/no trigger step/);
    });
});
