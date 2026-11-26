import {describe, expect, it} from "vitest";

import {move} from "../tools/move-c4-settings.mjs";

const A = "0x000fff0000000001";
const B = "0x000fff0000000002";

describe("move-c4-settings", () => {
    const from = {
        version: 1 as const,
        models: {[A]: "C4-DIM1-Z", [B]: "KPZ-6B1"},
        devices: {[A]: {on_transition: 1.5, led_brightness: 40}, [B]: {led_brightness: 80}},
    };

    it("moves model and settings, the target's own values winning", () => {
        const to = {version: 1 as const, models: {}, devices: {[A]: {led_brightness: 100}}};
        const r = move(from, to, ["0x000FFF0000000001"]);
        expect(r.to.models[A]).toBe("C4-DIM1-Z");
        expect(r.to.devices[A]).toEqual({on_transition: 1.5, led_brightness: 100});
        expect(r.from.models[A]).toBeUndefined();
        expect(r.from.devices[A]).toBeUndefined();
        expect(r.from.devices[B]).toEqual({led_brightness: 80}); // untouched
        expect(from.devices[A]).toBeDefined(); // inputs not mutated
    });

    it("keeps the rest of each file, and the source lets go of a moved device's handoff record", () => {
        const handoff = {had: {[A]: 1, [B]: 2}, profiles: {[A]: {name: "Hall", options: {}}}};
        const r = move({...from, meta: {led_defaults_migrated: true}, handoff}, {version: 1, models: {}, devices: {}, meta: {x: 1}}, [A]);
        expect(r.from.meta).toEqual({led_defaults_migrated: true});
        expect(r.from.handoff).toEqual({had: {[B]: 2}, profiles: {}});
        expect(r.to.meta).toEqual({x: 1});
        expect(move({...from, handoff}, {version: 1, models: {}, devices: {}}, [A], {copy: true}).from.handoff).toEqual(handoff);
    });

    it("copies with --copy and skips devices the source never saw", () => {
        const r = move(from, {version: 1, models: {}, devices: {}}, [B, "0x000fff00000000ff"], {copy: true});
        expect(r.moved.map((m) => m.ieee)).toEqual([B]);
        expect(r.from.devices[B]).toEqual({led_brightness: 80});
        expect(r.to.devices[B]).toEqual({led_brightness: 80});
    });
});
