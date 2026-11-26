// How tools/ha-validate-blueprints.mjs compares a live Home Assistant's rendering
// of the conformance probe with test/fixtures/jinja-conformance.expected.
import {describe, expect, it} from "vitest";

import {compareProbe} from "../tools/jinja-conformance.mjs";

describe("the conformance probe's comparison", () => {
    it("passes a rendering that matches, whatever whitespace surrounds it", () => {
        expect(compareProbe(" a|b|c\n", "a|b|c")).toEqual({ok: true});
    });

    it("names the first |-field that differs, counted from 1", () => {
        expect(compareProbe("a|x|c", "a|b|c")).toEqual({ok: false, field: 2, got: "x", want: "b"});
    });

    it("names the first field Home Assistant has and the expected output does not", () => {
        expect(compareProbe("a|b|c|extra", "a|b|c")).toEqual({ok: false, field: 4, got: "extra", want: undefined});
    });

    it("names the first field Home Assistant left out", () => {
        expect(compareProbe("a|b", "a|b|c")).toEqual({ok: false, field: 3, got: undefined, want: "c"});
    });
});
