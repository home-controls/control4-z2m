/** The contract, the build and the runtime API that each instance reports in its status. */

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {describe, expect, it} from "vitest";

import {buildId, distBuildId} from "../tools/build-id.mjs";
import {buildIdOf, fileHash} from "../src/core/build";
import {CONTRACT} from "../src/core/constants";
import {CONVERTER_KEY, RUNTIME_API} from "../src/z2m/global";
import {CONTRACT_FIELDS} from "./contract";

/**
 * Every contract number and its event fields. When the fixture's fields change,
 * raise CONTRACT and add its line here: never edit an existing line, since an
 * instance or a dispatcher out in a house still speaks it.
 */
const CONTRACTS: Record<number, string[]> = {
    1: ["action", "base", "button", "button_id", "command", "device", "gesture", "ieee", "known_taps", "model", "tap_index"],
};

/**
 * Every runtime API number and the runtime methods the converter calls. When
 * definitions.ts calls a method more or less, or one's arguments change, raise
 * RUNTIME_API and add its line here.
 */
const RUNTIME_APIS: Record<number, string[]> = {
    1: ["getValue", "seedModel", "set", "z2ioMode"],
    2: ["getValue", "kcLayout", "seedModel", "set", "z2ioMode"],
};

const src = (...parts: string[]) => path.resolve(__dirname, "..", "src", ...parts);
const dist = (kind: string) => path.resolve(__dirname, "..", "dist", kind, "control4.mjs");

describe("contract", () => {
    it("names the fields the contract fixture holds", () => {
        expect(CONTRACT_FIELDS, `contract ${CONTRACT}`).toEqual(CONTRACTS[CONTRACT]);
    });
});

describe("runtime API", () => {
    it("names the runtime methods the converter calls", () => {
        const calls = [...fs.readFileSync(src("z2m", "definitions.ts"), "utf8").matchAll(/(?:runtime\(\)|\brt|readyRuntime\(\)\))\??\.(\w+)/g)].map((m) => m[1]);
        expect([...new Set(calls)].sort(), `runtime API ${RUNTIME_API}`).toEqual(RUNTIME_APIS[RUNTIME_API]);
    });

    it("is registered by the converter with its file's hash", async () => {
        await import("../src/z2m/converter-entry");
        expect((globalThis as Record<string, unknown>)[CONVERTER_KEY]).toEqual({api: RUNTIME_API, file: fileHash(pathToFileURL(src("z2m", "converter-entry.ts")).href)});
    });
});

describe("build", () => {
    it("is what tools/build-id.mjs gives for dist/", () => {
        const [extension, converter] = ["external_extensions", "external_converters"].map((kind) => fileHash(pathToFileURL(dist(kind)).href) as string);
        expect(distBuildId()).toMatch(/^[0-9a-f]{12}$/);
        expect(distBuildId()).toBe(buildIdOf(extension, converter));
    });

    it("changes with either file, and tells them apart", () => {
        const id = buildId("extension", "converter");
        expect(buildId("extension", "converter")).toBe(id);
        expect(buildId("extension 2", "converter")).not.toBe(id);
        expect(buildId("extension", "converter 2")).not.toBe(id);
        expect(buildId("converter", "extension")).not.toBe(id);
    });

    it("stamps nothing into the bundles", () => {
        for (const kind of ["external_extensions", "external_converters"]) {
            expect(fs.readFileSync(dist(kind), "utf8").split("\n")[0], kind).toMatch(/^\/\/ control4-z2m \S+ - Zigbee2MQTT external (extension|converter)$/);
        }
    });
});
