#!/usr/bin/env node
// Cuts a release pull request (docs/adr/0008-source-only-pull-requests.md):
//
//   npm run release -- rc [patch|minor|major]   the next release candidate (0.4.1 -> 0.4.2-rc.1, rc.1 -> rc.2)
//   npm run release -- final                    promote the candidate on main (0.4.2-rc.2 -> 0.4.2)
//
// From origin/main, on a new branch release/<version>: raises package.json's version (and
// package-lock.json), builds dist/, runs the checks and commits "Release <version>". It pushes
// nothing; it prints the push and pull request commands. Merging that pull request publishes the
// release, a candidate as a GitHub pre-release. "final" refuses when src/ changed since the
// candidate was published, as CI would: cut another candidate instead.
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {nextVersion} from "./release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, {quiet = false, allowFail = false} = {}) {
    const r = spawnSync(cmd, args, {cwd: ROOT, encoding: "utf8", stdio: quiet ? "pipe" : "inherit", shell: process.platform === "win32"});
    if (r.status !== 0 && !allowFail) {
        if (quiet) process.stderr.write(r.stderr ?? "");
        console.error(`release: ${cmd} ${args.join(" ")} failed`);
        process.exit(1);
    }
    return r;
}
const git = (args, opts) => run("git", ["-c", "safe.directory=*", ...args], {quiet: true, ...opts});

const [kind, level = "patch"] = process.argv.slice(2);
if (kind !== "rc" && kind !== "final") {
    console.error("usage: npm run release -- rc [patch|minor|major]   |   npm run release -- final");
    process.exit(2);
}

if (git(["status", "--porcelain"]).stdout.trim()) {
    console.error("release: the working tree has changes; commit or stash them first");
    process.exit(1);
}
git(["fetch", "--quiet", "--tags", "origin"]);
const current = JSON.parse(git(["show", "origin/main:package.json"]).stdout).version;
let version;
try {
    version = nextVersion(current, kind, level);
} catch (error) {
    console.error(`release: ${error.message}`);
    process.exit(1);
}
if (kind === "final") {
    const tag = `refs/tags/v${current}`;
    if (git(["rev-parse", "-q", "--verify", tag], {allowFail: true}).status !== 0) {
        console.error(`release: v${current} isn't published yet (no tag): merge its pull request and wait for the release job`);
        process.exit(1);
    }
    if (git(["diff", "--quiet", tag, "origin/main", "--", "src"], {allowFail: true}).status !== 0) {
        console.error(`release: src/ changed on main since v${current} was published; cut ${nextVersion(current, "rc")} (npm run release -- rc) and test it`);
        process.exit(1);
    }
}

const branch = `release/${version}`;
console.log(`release: ${current} -> ${version}, on ${branch} from origin/main`);
git(["switch", "--quiet", "-c", branch, "origin/main"]);
run("npm", ["version", version, "--no-git-tag-version"], {quiet: true});
run("npm", ["run", "check"]);
git(["add", "package.json", "package-lock.json", "dist"]);
git(["commit", "--quiet", "-m", `Release ${version}`]);
const built = run("node", ["tools/build-id.mjs"], {quiet: true}).stdout.trim();
fs.writeSync(
    1,
    `\nrelease: committed "Release ${version}" (build ${built}). Next:\n\n  git push -u origin ${branch}\n  gh pr create --base main --title "Release ${version}" --fill\n\n` +
        (kind === "rc"
            ? `Its merge publishes v${version} as a pre-release. Test it, then: npm run release -- final\n`
            : `Its merge publishes v${version} as the latest release.\n`),
);
