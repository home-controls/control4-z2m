import fs from "node:fs";
import path from "node:path";

import {describe, expect, it} from "vitest";

import {compareVersions, parseVersion, verdict} from "../tools/release-check.mjs";

describe("release check", () => {
    it("reads a semver, with or without a v, ignoring pre-release and build metadata", () => {
        expect(parseVersion("0.2.0")).toEqual([0, 2, 0]);
        expect(parseVersion("v1.10.3")).toEqual([1, 10, 3]);
        expect(parseVersion("1.2.3-rc.1+abc")).toEqual([1, 2, 3]);
        expect(parseVersion("build-560869e87774")).toBeUndefined();
    });

    it("orders versions by number, not by text", () => {
        expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
        expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
        expect(compareVersions("0.2.0", "1.0.0")).toBe(-1);
    });

    it("passes a change that leaves dist/ alone, and one that raises the version with it; fails dist/ without a raise, and a lowered version", () => {
        expect(verdict({distChanged: false, baseVersion: "0.2.0", headVersion: "0.2.0"})).toBeUndefined();
        expect(verdict({distChanged: true, baseVersion: "0.2.0", headVersion: "0.2.1"})).toBeUndefined();
        expect(verdict({distChanged: true, baseVersion: "0.2.0", headVersion: "0.2.0"})).toMatch(/dist\/ changed but package.json's version is still 0.2.0/);
        expect(verdict({distChanged: false, baseVersion: "0.3.0", headVersion: "0.2.9"})).toMatch(/went down/);
    });

    it("the bundles carry package.json's version, in their banner and for the status", () => {
        const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")).version;
        for (const kind of ["external_extensions", "external_converters"]) {
            const text = fs.readFileSync(path.resolve(__dirname, "..", "dist", kind, "control4.mjs"), "utf8");
            expect(text.split("\n")[0], kind).toBe(
                `// control4-z2m ${version} - Zigbee2MQTT external ${kind === "external_extensions" ? "extension" : "converter"}`,
            );
        }
        expect(fs.readFileSync(path.resolve(__dirname, "..", "dist", "external_extensions", "control4.mjs"), "utf8")).toContain(`"${version}"`);
    });
});
