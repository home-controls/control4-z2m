#!/usr/bin/env node
// Every release has its own version: a change that alters dist/ must raise package.json's
// version over the base it merges into. CI runs this on each pull request:
//
//   node tools/release-check.mjs <base-ref>
//
// Exit 0 when dist/ is unchanged against <base-ref>, or when the version went up; 1 when
// dist/ changed and the version didn't go up (or went down). Patch for fixes, minor for
// features, major for a breaking change to the /set keys, topics or blueprints.
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The numeric parts of a semver (pre-release and build metadata ignored), or undefined if it isn't one. */
export function parseVersion(v) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v).trim());
    return m ? m.slice(1, 4).map(Number) : undefined;
}

/** -1, 0 or 1 as `a` is lower, equal or higher than `b`. */
export function compareVersions(a, b) {
    const [pa, pb] = [parseVersion(a), parseVersion(b)];
    if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    return 0;
}

/** Why a change fails the check, or undefined when it passes. */
export function verdict({distChanged, baseVersion, headVersion}) {
    const order = compareVersions(headVersion, baseVersion);
    if (order < 0) return `package.json's version went down: ${baseVersion} -> ${headVersion}`;
    if (distChanged && order === 0) return `dist/ changed but package.json's version is still ${headVersion}: raise it (patch for a fix, minor for a feature)`;
    return undefined;
}

function git(args) {
    const r = spawnSync("git", ["-c", "safe.directory=*", ...args], {cwd: ROOT, encoding: "utf8"});
    return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const base = process.argv[2];
    if (!base) {
        console.error("usage: node tools/release-check.mjs <base-ref>");
        process.exit(2);
    }
    const shown = git(["show", `${base}:package.json`]);
    if (shown.status !== 0) {
        console.error(`release check: can't read package.json at ${base}: ${shown.stderr.trim()}`);
        process.exit(2);
    }
    const baseVersion = JSON.parse(shown.stdout).version;
    const headVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    const distChanged = git(["diff", "--quiet", base, "--", "dist"]).status !== 0;
    const why = verdict({distChanged, baseVersion, headVersion});
    if (why) {
        console.error(`release check: ${why}`);
        process.exit(1);
    }
    console.log(`release check: ${distChanged ? `dist/ changed, version ${baseVersion} -> ${headVersion}` : `dist/ unchanged (version ${headVersion})`}`);
}
