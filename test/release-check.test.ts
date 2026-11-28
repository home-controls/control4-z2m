import fs from "node:fs";
import path from "node:path";

import {describe, expect, it} from "vitest";

import {compareVersions, isPrerelease, nextVersion, parseVersion, verdict} from "../tools/release-check.mjs";

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

    it("orders a release candidate below its release, and candidates by number", () => {
        expect(compareVersions("0.4.2-rc.1", "0.4.1")).toBe(1);
        expect(compareVersions("0.4.2", "0.4.2-rc.1")).toBe(1);
        expect(compareVersions("0.4.2-rc.2", "0.4.2-rc.1")).toBe(1);
        expect(compareVersions("0.4.2-rc.10", "0.4.2-rc.9")).toBe(1);
        expect(compareVersions("0.4.2-rc.1", "0.4.2-rc.1")).toBe(0);
        expect(compareVersions("0.4.2-rc.1+abc", "0.4.2-rc.1")).toBe(0);
        // semver: numeric identifiers below text ones, and a longer list above its prefix.
        expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
        expect(compareVersions("1.0.0-alpha.beta", "1.0.0-alpha.1")).toBe(1);
        expect(isPrerelease("0.4.2-rc.1")).toBe(true);
        expect(isPrerelease("0.4.2")).toBe(false);
        expect(isPrerelease("0.4.2+build")).toBe(false);
    });

    it("passes a source-only change, and a release that commits a fresh dist/", () => {
        // A source-only pull request: dist/ stays the last release, even though a fresh build differs.
        expect(verdict({distChanged: false, distFresh: false, baseVersion: "0.4.1", headVersion: "0.4.1"})).toBeUndefined();
        // A release (candidate or final) raises the version and commits dist/ as a fresh build.
        expect(verdict({distChanged: true, distFresh: true, baseVersion: "0.4.1", headVersion: "0.4.2-rc.1"})).toBeUndefined();
        expect(verdict({distChanged: true, distFresh: true, baseVersion: "0.4.2-rc.1", headVersion: "0.4.2"})).toBeUndefined();
    });

    it("fails dist/ in a pull request that isn't a release, a release with a stale dist/, and a lowered version", () => {
        expect(verdict({distChanged: true, distFresh: true, baseVersion: "0.4.1", headVersion: "0.4.1"})).toMatch(
            /dist\/ changed but package.json's version is still 0.4.1/,
        );
        expect(verdict({distChanged: false, distFresh: false, baseVersion: "0.4.1", headVersion: "0.4.2-rc.1"})).toMatch(
            /raises the version to 0.4.2-rc.1, so it is a release: commit dist\/ as a fresh build/,
        );
        expect(verdict({distChanged: false, distFresh: true, baseVersion: "0.3.0", headVersion: "0.2.9"})).toMatch(/went down/);
        expect(verdict({distChanged: true, distFresh: true, baseVersion: "0.4.2", headVersion: "0.4.2-rc.1"})).toMatch(/went down/);
    });

    it("lets a release follow only its own candidate, with src/ unchanged since that candidate", () => {
        const promote = {distChanged: true, distFresh: true, baseVersion: "0.4.2-rc.2", headVersion: "0.4.2"};
        expect(verdict({...promote, sourceSinceCandidate: false})).toBeUndefined();
        expect(verdict({...promote, sourceSinceCandidate: true})).toMatch(/src\/ changed since v0.4.2-rc.2.*0.4.2-rc.3/);
        // Straight to a release, with no candidate first.
        expect(verdict({distChanged: true, distFresh: true, baseVersion: "0.4.1", headVersion: "0.4.2"})).toMatch(
            /a release follows its own release candidate: raise the version to 0.4.2-rc.1 first/,
        );
        expect(verdict({distChanged: true, distFresh: true, baseVersion: "0.4.2-rc.1", headVersion: "0.4.3"})).toMatch(/0.4.3-rc.1 first/);
    });

    it("works out the next candidate and the release it promotes to", () => {
        expect(nextVersion("0.4.1", "rc")).toBe("0.4.2-rc.1");
        expect(nextVersion("0.4.1", "rc", "minor")).toBe("0.5.0-rc.1");
        expect(nextVersion("0.4.1", "rc", "major")).toBe("1.0.0-rc.1");
        expect(nextVersion("0.4.2-rc.1", "rc")).toBe("0.4.2-rc.2");
        expect(nextVersion("0.4.2-rc.1", "final")).toBe("0.4.2");
        expect(() => nextVersion("0.4.1", "final")).toThrow(/no release candidate to promote/);
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
