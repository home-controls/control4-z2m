// Herdsman drift canary: our checks against the zigbee-herdsman and
// zigbee-herdsman-converters a Zigbee2MQTT target pins instead of ours, so a
// herdsman change that breaks the extension's hooks is known before the HA
// add-on auto-updates into it.
//
//   node tools/herdsman-canary.mjs dev|release
//
// Steps: install the target's pins (not saved), typecheck, the vitest suite,
// and tools/z2m-harness.mjs at the target's ref. With CANARY_TOKEN set (the
// nightly workflow, .github/workflows/herdsman-canary.yml) the result goes to
// this repo's GitHub issues: a red opens one issue per target and pin set unless
// that one is already open; a green comments on and closes the target's open
// issues. Without a token the result is only printed.
// Outside CI the repo's own pins are put back afterwards (npm ci).
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Z2M = "Koenkk/zigbee2mqtt";
const PACKAGES = ["zigbee-herdsman", "zigbee-herdsman-converters"];
const LABELS = ["bug", "needs-triage"];
const TAIL_LINES = 60;
const SUMMARY_LINES = 150;

const target = process.argv[2];
if (target !== "dev" && target !== "release") {
    console.error("usage: node tools/herdsman-canary.mjs dev|release");
    process.exit(2);
}

async function json(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? undefined : res.json();
}

const github = (p) => json(`https://api.github.com/repos/${Z2M}/${p}`, {headers: {"User-Agent": "control4-z2m-canary", Accept: "application/vnd.github+json"}});

/** The Zigbee2MQTT ref for the target, its commit, and the herdsman packages it pins there. */
async function resolveTarget() {
    const ref = target === "dev" ? "dev" : (await github("releases/latest")).tag_name;
    const sha = (await github(`commits/${ref}`)).sha;
    const pkg = await json(`https://raw.githubusercontent.com/${Z2M}/${sha}/package.json`);
    const pins = Object.fromEntries(PACKAGES.map((p) => [p, pkg.dependencies?.[p]]));
    for (const [p, v] of Object.entries(pins)) if (!v) throw new Error(`Zigbee2MQTT ${ref} does not depend on ${p}`);
    return {ref, sha, pins};
}

/** Run a shell command in the repo, streaming its output and keeping a copy. */
function run(cmd) {
    return new Promise((resolve) => {
        console.log(`\n$ ${cmd}`);
        const child = spawn(cmd, {cwd: root, shell: true, env: {...process.env, FORCE_COLOR: "0", NO_COLOR: "1"}});
        let output = "";
        const take = (chunk) => {
            output += chunk;
            process.stdout.write(chunk);
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        child.on("close", (code) => resolve({ok: code === 0, output: output.replace(/\x1b\[[0-9;]*m/g, "")}));
    });
}

const installed = (p) => JSON.parse(fs.readFileSync(path.join(root, "node_modules", p, "package.json"), "utf8")).version;

async function check({ref, pins}) {
    const steps = [];
    const install = await run(`npm install --no-save --no-audit --no-fund ${PACKAGES.map((p) => `${p}@${pins[p]}`).join(" ")}`);
    steps.push({name: "install", ...install});
    if (!install.ok) return steps;
    console.log(`\nZigbee2MQTT ${ref}: running against ${PACKAGES.map((p) => `${p} ${installed(p)}`).join(", ")}`);
    steps.push({name: "typecheck", ...(await run("npx tsc --noEmit"))});
    steps.push({name: "vitest", ...(await run("npx vitest run"))});
    steps.push({name: "harness", ...(await run(`node tools/z2m-harness.mjs ${ref}`))});
    return steps;
}

/** Failing tests (vitest, also inside the harness) and type errors, for the issue body. */
function failures(steps) {
    const lines = steps.filter((s) => !s.ok).flatMap((s) => s.output.split(/\r?\n/));
    const found = lines.map((l) => l.trim()).filter((l) => /^FAIL\s+\S+\.test\.ts\b/.test(l) || /error TS\d+:/.test(l));
    return [...new Set(found)].slice(0, 30);
}

/**
 * A failed step's output for the issue: from vitest's failure summary on (also
 * inside the harness), which the tests' own logging would otherwise push out
 * of a plain tail, else the last lines. CI annotation lines are left out.
 */
function excerpt(output) {
    const lines = output
        .trimEnd()
        .split(/\r?\n/)
        .filter((l) => !l.startsWith("::"));
    const summary = lines.findIndex((l) => /⎯ Failed Tests \d+ ⎯/.test(l));
    return (summary >= 0 ? lines.slice(summary, summary + SUMMARY_LINES) : lines.slice(-TAIL_LINES)).join("\n");
}

function issueBody(t, steps, runUrl, marker) {
    const pins = PACKAGES.map((p) => `${p} ${t.pins[p]}`).join(", ");
    const out = [
        marker,
        `The herdsman drift canary is red for Zigbee2MQTT **${target === "dev" ? "dev" : t.ref}** ([\`${t.sha.slice(0, 7)}\`](https://github.com/${Z2M}/commit/${t.sha})): ${pins}.`,
        "",
        runUrl ? `Run: ${runUrl}` : "",
        "",
        "| Step | Result |",
        "| --- | --- |",
        ...steps.map((s) => `| ${s.name} | ${s.ok ? "pass" : "**fail**"} |`),
    ];
    const failed = failures(steps);
    if (failed.length) out.push("", "### Failing", "", ...failed.map((l) => `- \`${l.replace(/`/g, "'")}\``));
    for (const s of steps.filter((x) => !x.ok)) out.push("", `### ${s.name} output`, "", "````text", excerpt(s.output), "````");
    out.push("", "The canary closes this issue once this target is green again.");
    return out.join("\n");
}

async function report(t, steps) {
    const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
    const repo = process.env.GITHUB_REPOSITORY;
    const api = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}`;
    const headers = {
        Authorization: `Bearer ${process.env.CANARY_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "control4-z2m-canary",
        "Content-Type": "application/json",
    };
    const gh = (p, init = {}) => json(`${api}/${p}`, {...init, headers});
    const runUrl = process.env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;

    // Markers in the body tie an issue to its target and pin set; the title and
    // labels are for people (triage may change them).
    const targetMarker = `herdsman-canary target=${target} `;
    const marker = `<!-- ${targetMarker}pins=${PACKAGES.map((p) => t.pins[p]).join("/")} -->`;
    const open = [];
    for (let page = 1; ; page++) {
        // GitHub lists pull requests among the issues: leave them out.
        const batch = await gh(`issues?state=open&per_page=100&page=${page}`);
        open.push(...batch.filter((i) => !i.pull_request && (i.body ?? "").includes(targetMarker)));
        if (batch.length < 100) break;
    }
    const red = steps.some((s) => !s.ok);

    if (red) {
        const same = open.find((i) => i.body.includes(marker));
        if (same) {
            console.log(`\nred again with the same pins: #${same.number} already open`);
            return;
        }
        const title = `Herdsman drift: Z2M ${target === "dev" ? "dev" : t.ref} (herdsman ${t.pins["zigbee-herdsman"]}, converters ${t.pins["zigbee-herdsman-converters"]})`;
        // GitHub takes label names (and makes any that don't exist yet).
        const issue = await gh("issues", {method: "POST", body: JSON.stringify({title, body: issueBody(t, steps, runUrl, marker), labels: LABELS})});
        console.log(`\nopened #${issue.number}: ${title}`);
        return;
    }
    for (const i of open) {
        const pins = PACKAGES.map((p) => `${p} ${t.pins[p]}`).join(", ");
        const body = `Green again at Zigbee2MQTT ${target === "dev" ? "dev" : t.ref} (\`${t.sha.slice(0, 7)}\`): ${pins}.${runUrl ? ` Run: ${runUrl}` : ""}`;
        await gh(`issues/${i.number}/comments`, {method: "POST", body: JSON.stringify({body})});
        await gh(`issues/${i.number}`, {method: "PATCH", body: JSON.stringify({state: "closed", state_reason: "completed"})});
        console.log(`\nclosed #${i.number}`);
    }
}

let steps = [];
try {
    const t = await resolveTarget();
    console.log(`Zigbee2MQTT ${target}: ${t.ref} at ${t.sha}, pins ${PACKAGES.map((p) => `${p} ${t.pins[p]}`).join(", ")}`);
    steps = await check(t);
    console.log(`\n${steps.map((s) => `${s.ok ? "PASS" : "FAIL"} ${s.name}`).join("\n")}`);
    process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
    if (process.env.CANARY_TOKEN) await report(t, steps);
} catch (e) {
    console.error(e?.stack ?? e);
    process.exitCode = 2;
} finally {
    if (!process.env.CI && steps.length) await run("npm ci --no-audit --no-fund");
}
