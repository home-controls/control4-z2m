// Validate the blueprints against a live Home Assistant, read-only:
//   - websocket validate_config on each blueprint's trigger / condition / action
//     (inputs substituted with their defaults or a placeholder per selector);
//   - websocket render_template on every template string (syntax check: an
//     undefined variable renders empty, a broken template errors);
//   - the conformance probe (test/fixtures/jinja-conformance.jinja): Home
//     Assistant must render it as its .expected says, which is what the engine
//     standing in for Home Assistant's renders in the tests (test/c4-device.ts).
// Nothing is created or changed in Home Assistant.
//
//   HA_URL=http://host:8123 HA_TOKEN_FILE=/path/token.txt node tools/ha-validate-blueprints.mjs
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {parseDocument} from "yaml";

import {caller, templateError} from "./ha-calls.mjs";
import {compareProbe} from "./jinja-conformance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "blueprints");
const url = (process.env.HA_URL ?? "").replace(/\/$/, "");
const token = process.env.HA_TOKEN ?? (process.env.HA_TOKEN_FILE ? fs.readFileSync(process.env.HA_TOKEN_FILE, "utf8").trim() : "");
if (!url || !token) {
    console.error("set HA_URL and HA_TOKEN (or HA_TOKEN_FILE)");
    process.exit(2);
}

const inputTag = {tag: "!input", resolve: (value) => ({__input: value}), identify: () => false};

function inputsOf(node, out = {}) {
    for (const [k, v] of Object.entries(node ?? {})) {
        if (v && typeof v === "object" && "input" in v && !("selector" in v)) inputsOf(v.input, out);
        else out[k] = v;
    }
    return out;
}

function placeholder(spec) {
    if (spec && "default" in spec) return spec.default;
    const sel = spec?.selector ?? {};
    const kind = Object.keys(sel)[0];
    const opts = sel[kind] ?? {};
    switch (kind) {
        case "device":
            return opts?.multiple ? ["00000000000000000000000000000000"] : "00000000000000000000000000000000";
        case "entity": {
            const domain = [].concat(opts?.domain ?? opts?.filter?.[0]?.domain ?? "light")[0];
            const id = `${domain}.c4_validation_dummy`;
            return opts?.multiple ? [id] : id;
        }
        case "area":
            return opts?.multiple ? [] : "";
        case "number":
            return opts?.min ?? 0;
        case "boolean":
            return false;
        case "time":
            return "00:00:00";
        case "duration":
            return {seconds: 10};
        case "action":
            return [];
        case "trigger":
            return [{platform: "event", event_type: "c4_validation_dummy"}];
        case "target":
            return {};
        default:
            return "x";
    }
}

function substitute(node, values) {
    if (Array.isArray(node)) return node.map((x) => substitute(x, values));
    if (node && typeof node === "object") {
        if ("__input" in node) return values[node.__input];
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v, values)]));
    }
    return node;
}

function templates(node, out = []) {
    if (typeof node === "string" && /\{\{|\{%/.test(node)) out.push(node);
    else if (Array.isArray(node)) node.forEach((x) => templates(x, out));
    else if (node && typeof node === "object") Object.values(node).forEach((x) => templates(x, out));
    return out;
}

const ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/websocket`);
// Never report success without having talked to Home Assistant, every check included.
let authed = false;
let finished = false;
const connectTimer = setTimeout(() => {
    console.error(`no answer from ${url} within 20 s`);
    process.exit(1);
}, 20_000);
ws.onerror = (ev) => {
    console.error(`websocket error talking to ${url}: ${ev?.message || ev?.error?.message || "connection failed"}`);
    process.exit(1);
};
ws.onclose = () => {
    if (!authed) {
        console.error(`connection to ${url} closed before authentication`);
        process.exit(1);
    }
    // Home Assistant restarting closes the connection cleanly: the checks still waiting would never run.
    if (!finished) {
        console.error(`connection to ${url} closed before every check ran`);
        process.exit(1);
    }
};
const {call, receive} = caller((msg) => ws.send(JSON.stringify(msg)));
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "auth_required") ws.send(JSON.stringify({type: "auth", access_token: token}));
    else if (msg.type === "auth_ok") (authed = true, clearTimeout(connectTimer), main()).then(() => {
        finished = true;
        ws.close();
    }, (e) => {
        finished = true;
        console.error(e);
        ws.close();
        process.exitCode = 1;
    });
    else if (msg.type === "auth_invalid") {
        console.error("auth failed");
        process.exit(1);
    } else {
        receive(msg);
    }
};

async function main() {
    let problems = 0;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
        const doc = parseDocument(fs.readFileSync(path.join(dir, file), "utf8"), {customTags: [inputTag]}).toJS();
        const inputs = inputsOf(doc.blueprint.input);
        const values = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, placeholder(v)]));
        const body = substitute({trigger: doc.trigger, condition: doc.condition ?? [], action: doc.action}, values);
        const res = await call({type: "validate_config", triggers: body.trigger, conditions: body.condition, actions: body.action});
        if (res.success === false) {
            problems++;
            console.log(`FAIL ${file}: ${res.error?.message}`);
            continue;
        }
        const verdict = res.result ?? {};
        const bad = Object.entries(verdict).filter(([, v]) => !v.valid);
        let tplErrors = 0;
        const all = templates(substitute({v: doc.variables, tv: doc.trigger_variables, b: body}, values));
        for (const t of [...new Set(all)]) {
            const err = templateError(await call({type: "render_template", template: t, variables: {}, strict: false, report_errors: true, timeout: 3}));
            if (err) {
                tplErrors++;
                console.log(`  ${file}: template error: ${err}\n    ${t.slice(0, 160).replace(/\n/g, " ")}`);
            }
        }
        problems += bad.length + tplErrors;
        console.log(`${bad.length || tplErrors ? "FAIL" : "ok  "} ${file}: ${Object.keys(verdict).map((k) => `${k} ${verdict[k].valid ? "valid" : "INVALID"}`).join(", ")}; ${all.length} templates, ${tplErrors} syntax errors`);
        for (const [k, v] of bad) console.log(`  ${k}: ${v.error}`);
    }
    problems += await checkPackages();
    problems += await checkConformance();
    if (problems) process.exitCode = 1;
}

/** Home Assistant renders the conformance probe as the tests' stand-in engine does: neither has drifted from the other. */
async function checkConformance() {
    const fixtures = path.join(root, "test", "fixtures");
    const probe = fs.readFileSync(path.join(fixtures, "jinja-conformance.jinja"), "utf8");
    const want = fs.readFileSync(path.join(fixtures, "jinja-conformance.expected"), "utf8").trim();
    const r = await call({type: "render_template", template: probe, variables: {}, strict: false, report_errors: true, timeout: 3});
    if (r.event?.result === undefined) {
        console.log(`FAIL jinja-conformance: Home Assistant did not render the probe: ${r.event?.error ?? r.error?.message ?? "no result"}`);
        return 1;
    }
    const got = String(r.event.result).trim();
    const diff = compareProbe(got, want);
    if (diff.ok) {
        console.log("ok   jinja-conformance: rendered as test/fixtures/jinja-conformance.expected says");
        return 0;
    }
    const show = (field) => (field === undefined ? "(no such field)" : `'${field}'`);
    console.log("FAIL jinja-conformance: Home Assistant renders the probe differently from the engine the tests use (test/c4-device/engine.ts):");
    console.log(`  first difference at field ${diff.field}: Home Assistant ${show(diff.got)}, expected ${show(diff.want)}`);
    console.log(`  Home Assistant: ${got}\n  expected:       ${want}`);
    return 1;
}

/** The packages/: every script sequence, automation and trigger-based template block. */
async function checkPackages() {
    const pdir = path.join(root, "packages");
    let problems = 0;
    for (const file of fs.readdirSync(pdir).filter((f) => f.endsWith(".yaml")).sort()) {
        const doc = parseDocument(fs.readFileSync(path.join(pdir, file), "utf8")).toJS();
        const units = [];
        for (const [name, sc] of Object.entries(doc.script ?? {})) units.push({name: `script.${name}`, conf: {actions: sc.sequence}, extra: sc});
        for (const a of doc.automation ?? []) units.push({name: `automation ${a.id}`, conf: {triggers: a.triggers, conditions: a.conditions ?? [], actions: a.actions}, extra: a});
        for (const [i, t] of (doc.template ?? []).entries()) units.push({name: `template[${i}]`, conf: {triggers: t.trigger, conditions: t.condition ?? [], actions: t.action ?? []}, extra: t});
        for (const u of units) {
            const res = await call({type: "validate_config", ...u.conf});
            const verdict = res.result ?? {};
            const bad = res.success === false ? [["call", {error: res.error?.message}]] : Object.entries(verdict).filter(([, v]) => !v.valid);
            let tplErrors = 0;
            const all = templates(u.extra);
            for (const t of [...new Set(all)]) {
                const err = templateError(await call({type: "render_template", template: t, variables: {}, strict: false, report_errors: true, timeout: 3}));
                if (err) {
                    tplErrors++;
                    console.log(`  ${file} ${u.name}: template error: ${err}\n    ${t.slice(0, 160).replace(/\n/g, " ")}`);
                }
            }
            problems += bad.length + tplErrors;
            console.log(`${bad.length || tplErrors ? "FAIL" : "ok  "} ${file} ${u.name}: ${Object.keys(verdict).map((k) => `${k} ${verdict[k].valid ? "valid" : "INVALID"}`).join(", ")}; ${all.length} templates, ${tplErrors} syntax errors`);
            for (const [k, v] of bad) console.log(`  ${k}: ${v.error}`);
        }
    }
    return problems;
}