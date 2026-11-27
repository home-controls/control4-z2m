import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {describe as group, expect, it} from "vitest";

import {describe, hitsIn, hitsInFile, parsePatterns} from "../tools/privacy-check.mjs";

const TOOL = path.resolve(__dirname, "..", "tools", "privacy-check.mjs");
// Stand-in patterns: the real list is private (a CI secret and a file outside the repo).
const SAMPLE = "# comment\n/\\bexample-house\\b/i\n\n/secret\\.host\\.test/g\n";

group("privacy check", () => {
    it("reads one /regex/flags per line, skipping comments and blank lines, and drops g / y so a test keeps no state", () => {
        const patterns = parsePatterns(SAMPLE);
        expect(patterns.map((r) => [r.source, r.flags])).toEqual([
            ["\\bexample-house\\b", "i"],
            ["secret\\.host\\.test", ""],
        ]);
        expect(() => parsePatterns("example-house")).toThrow(/line 1 is not a \/regex\/flags literal/);
    });

    it("finds each matching line and pattern, every time it is asked", () => {
        const patterns = parsePatterns(SAMPLE);
        const text = "fine\nthe Example-House lights\nsecret.host.test and example-house\n";
        const want = [
            {line: 2, pattern: 0},
            {line: 3, pattern: 0},
            {line: 3, pattern: 1},
        ];
        expect(hitsIn(text, patterns)).toEqual(want);
        expect(hitsIn(text, patterns)).toEqual(want);
    });

    it("never prints the matched text, only where and which pattern", () => {
        expect(describe("docs/a.md", {line: 7, pattern: 1})).toBe("docs/a.md:7: matches private pattern 1");
        expect(describe("img/p.jpg", {line: 0, pattern: -1, exif: true})).toBe("img/p.jpg: photo metadata (Exif); strip it first");
    });

    it("flags a JPEG carrying Exif, and skips other binary files", () => {
        const patterns = parsePatterns(SAMPLE);
        const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0x10]), Buffer.from("Exif\0\0example-house")]);
        expect(hitsInFile("p.jpg", jpeg, patterns)).toEqual([{line: 0, pattern: -1, exif: true}]);
        expect(hitsInFile("p.png", jpeg, patterns)).toEqual([]);
        expect(hitsInFile("a.md", Buffer.from("example-house"), patterns)).toEqual([{line: 1, pattern: 0}]);
    });

    it("from the command line: clean or a hit for --text, a skip with --allow-missing, a failure without patterns", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-"));
        const pats = path.join(dir, "p.txt");
        fs.writeFileSync(pats, SAMPLE);
        const body = path.join(dir, "body.md");
        const run = (args: string[], env: Record<string, string> = {}) => {
            try {
                return {code: 0, out: execFileSync(process.execPath, [TOOL, ...args], {encoding: "utf8", env: {...process.env, HOME: dir, USERPROFILE: dir, PRIVATE_PATTERNS: "", ...env}, stdio: "pipe"})};
            } catch (e) {
                const err = e as {status: number; stdout: string; stderr: string};
                return {code: err.status, out: `${err.stdout}${err.stderr}`};
            }
        };
        fs.writeFileSync(body, "nothing here\n");
        expect(run(["--patterns", pats, "--text", body])).toMatchObject({code: 0});
        fs.writeFileSync(body, "line one\nat example-house\n");
        const hit = run(["--text", body], {PRIVATE_PATTERNS: SAMPLE});
        expect(hit.code).toBe(1);
        expect(hit.out).toContain("body.md:2: matches private pattern 0");
        expect(hit.out).not.toMatch(/example-house/i);
        expect(run(["--text", body, "--allow-missing"])).toMatchObject({code: 0, out: expect.stringContaining("skipped")});
        expect(run(["--text", body]).code).toBe(2);
        fs.rmSync(dir, {recursive: true, force: true});
    });
});
