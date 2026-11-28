#!/usr/bin/env node
// Releases are cut on purpose, not by every change (docs/adr/0008-source-only-pull-requests.md).
// A pull request either leaves dist/ alone (a source-only change: dist/ stays the last release),
// or raises package.json's version and commits dist/ as a fresh build of src/ (a release, or a
// release candidate such as 0.4.2-rc.1). CI builds, then runs this on each pull request:
//
//   node tools/release-check.mjs <base-ref>
//
// Exit 0 when the pull request is one of those two; 1 when dist/ changed without a raised
// version, when a raised version comes with a dist/ that isn't a fresh build, or when the
// version went down. Patch for fixes, minor for features, major for a breaking change to the
// /set keys, topics or blueprints.
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/;

/** The numeric parts of a semver (pre-release and build metadata ignored), or undefined if it isn't one. */
export function parseVersion(v) {
    const m = SEMVER.exec(String(v).trim());
    return m ? m.slice(1, 4).map(Number) : undefined;
}

/** Whether a version is a pre-release, such as a release candidate (0.4.2-rc.1). */
export function isPrerelease(v) {
    return SEMVER.exec(String(v).trim())?.[4] !== undefined;
}

/** Semver's order of two pre-release tags: numeric identifiers by number and below text ones, a longer list above its prefix. */
function comparePrerelease(a, b) {
    if (a === b) return 0;
    if (a === undefined) return 1; // a release ranks above its pre-releases
    if (b === undefined) return -1;
    const [pa, pb] = [a.split("."), b.split(".")];
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        const [x, y] = [pa[i], pb[i]];
        if (x === y) continue;
        const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
        if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
        if (nx !== ny) return nx ? -1 : 1;
        return x < y ? -1 : 1;
    }
    return pa.length === pb.length ? 0 : pa.length < pb.length ? -1 : 1;
}

/** -1, 0 or 1 as `a` is lower, equal or higher than `b`; a release candidate is below its release. */
export function compareVersions(a, b) {
    const [ma, mb] = [SEMVER.exec(String(a).trim()), SEMVER.exec(String(b).trim())];
    if (!ma || !mb) throw new Error(`not a version: ${ma ? b : a}`);
    for (let i = 1; i <= 3; i++) if (Number(ma[i]) !== Number(mb[i])) return Number(ma[i]) < Number(mb[i]) ? -1 : 1;
    return comparePrerelease(ma[4], mb[4]);
}

/**
 * The version after `current`: with "rc", the next release candidate (rc.N+1 of a candidate, or
 * rc.1 of the next patch / minor / major release); with "final", the release a candidate promotes to.
 */
export function nextVersion(current, kind, level = "patch") {
    const m = SEMVER.exec(String(current).trim());
    if (!m) throw new Error(`not a version: ${current}`);
    const [maj, min, pat] = m.slice(1, 4).map(Number);
    const pre = m[4];
    const rc = pre && /^rc\.(\d+)$/.exec(pre);
    if (kind === "final") {
        if (!pre) throw new Error(`${current} is a release: there is no release candidate to promote (cut one with "rc")`);
        return `${maj}.${min}.${pat}`;
    }
    if (kind !== "rc") throw new Error(`not a release kind: ${kind} (rc or final)`);
    if (rc) return `${maj}.${min}.${pat}-rc.${Number(rc[1]) + 1}`;
    if (pre) throw new Error(`${current} is a pre-release but not rc.N: set the next version by hand`);
    const next = {patch: [maj, min, pat + 1], minor: [maj, min + 1, 0], major: [maj + 1, 0, 0]}[level];
    if (!next) throw new Error(`not a level: ${level} (patch, minor or major)`);
    return `${next.join(".")}-rc.1`;
}

/**
 * Why a pull request fails the check, or undefined when it passes. `distChanged`: its committed
 * dist/ differs from the base's; `distFresh`: its committed dist/ matches a fresh build of src/;
 * `sourceSinceCandidate`: for a release, whether src/ changed since the candidate it promotes was
 * published. A release follows its own candidate, so it ships what was tested.
 */
export function verdict({distChanged, distFresh, baseVersion, headVersion, sourceSinceCandidate = false}) {
    const order = compareVersions(headVersion, baseVersion);
    if (order < 0) return `package.json's version went down: ${baseVersion} -> ${headVersion}`;
    if (order > 0 && !isPrerelease(headVersion)) {
        const target = parseVersion(headVersion).join(".");
        if (!isPrerelease(baseVersion) || parseVersion(baseVersion).join(".") !== target) {
            return `a release follows its own release candidate: raise the version to ${target}-rc.1 first, and promote it once it is tested`;
        }
        if (sourceSinceCandidate) {
            return `src/ changed since v${baseVersion} was published, so ${headVersion} would ship code no candidate tested: cut ${nextVersion(baseVersion, "rc")} instead`;
        }
    }
    if (order > 0 && !distFresh) {
        return `this pull request raises the version to ${headVersion}, so it is a release: commit dist/ as a fresh build (npm run build)`;
    }
    if (order === 0 && distChanged) {
        return `dist/ changed but package.json's version is still ${headVersion}: dist/ changes only in a release, so leave it out (git checkout <base> -- dist), or raise the version to make this pull request a release`;
    }
    return undefined;
}

function git(args) {
    return spawnSync("git", ["-c", "safe.directory=*", ...args], {cwd: ROOT, encoding: "utf8"});
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
    // Committed dist/ against the base; and the working tree (a fresh build, in CI) against the commit.
    const distChanged = git(["diff", "--quiet", base, "HEAD", "--", "dist"]).status !== 0;
    const distFresh = git(["diff", "--quiet", "HEAD", "--", "dist"]).status === 0;
    // A release promotes the candidate on its base: compare src/ with that candidate's tag.
    let sourceSinceCandidate = false;
    if (isPrerelease(baseVersion) && !isPrerelease(headVersion) && compareVersions(headVersion, baseVersion) > 0) {
        const tag = `refs/tags/v${baseVersion}`;
        if (git(["rev-parse", "-q", "--verify", tag]).status !== 0) {
            console.error(`release check: no tag v${baseVersion}, so it can't tell whether src/ changed since that candidate (git fetch --tags)`);
            process.exit(2);
        }
        sourceSinceCandidate = git(["diff", "--quiet", tag, "HEAD", "--", "src"]).status !== 0;
    }
    const why = verdict({distChanged, distFresh, baseVersion, headVersion, sourceSinceCandidate});
    if (why) {
        console.error(`release check: ${why}`);
        process.exit(1);
    }
    const kind = compareVersions(headVersion, baseVersion) > 0 ? (isPrerelease(headVersion) ? "a release candidate" : "a release") : "source only";
    console.log(`release check: ${kind}, version ${baseVersion} -> ${headVersion}`);
}
