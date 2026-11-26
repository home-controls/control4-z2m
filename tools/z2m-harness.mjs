// Run test/z2m-harness/control4.test.ts inside a real Zigbee2MQTT checkout, using
// Zigbee2MQTT's own test mocks: proves the built dist/ files load through its
// external JS loaders, pass its Home Assistant discovery and handle /set.
//
//   node tools/z2m-harness.mjs [git-ref]      (default: 2.14.2)
//
// The checkout lives in the OS temp dir and is reused between runs; a ref that
// is not a version tag (a branch such as dev) is fetched again each run.
import {execSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ref = process.argv[2] ?? "2.14.2";
const dir = path.join(os.tmpdir(), `control4-z2m-harness-${ref}`);
const run = (cmd, cwd, env = {}) => execSync(cmd, {cwd, stdio: "inherit", env: {...process.env, ...env}});

const head = () => execSync("git rev-parse HEAD", {cwd: dir, encoding: "utf8"}).trim();
let moved = false;
if (!fs.existsSync(path.join(dir, "package.json"))) {
    run(`git clone --depth 1 --branch ${ref} https://github.com/Koenkk/zigbee2mqtt.git "${dir}"`, os.tmpdir());
} else if (!/^\d+\.\d+\.\d+$/.test(ref)) {
    const before = head();
    run(`git fetch --depth 1 origin ${ref}`, dir);
    run("git checkout --force --quiet FETCH_HEAD", dir);
    moved = head() !== before;
}
// The OS may clean the temp dir partially; reinstall whenever the deps are gone or the checkout moved.
if (moved || !fs.existsSync(path.join(dir, "node_modules", "vitest"))) run("npx -y pnpm install --frozen-lockfile --ignore-scripts", dir);
run("node tools/build.mjs", root);
fs.copyFileSync(path.join(root, "test", "z2m-harness", "control4.test.ts"), path.join(dir, "test", "extensions", "control4.test.ts"));
run("npx vitest run --config ./test/vitest.config.mts test/extensions/control4.test.ts", dir, {C4Z2M_DIST: path.join(root, "dist")});