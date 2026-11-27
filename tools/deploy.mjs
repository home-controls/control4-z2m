#!/usr/bin/env node
// Push the build in dist/ to every Zigbee2MQTT instance on one site as a
// hot-load: Zigbee2MQTT and its coordinator keep running. Everything goes
// through Home Assistant's websocket (its MQTT integration), so it needs no
// broker credentials:
//
//   HA_URL=http://host:8123 HA_TOKEN_FILE=/path/token.txt node tools/deploy.mjs [--dry-run]
//
// It works on one instance at a time (spec: archived issues 25 and 32):
//   - Instances are found from the retained <base>/bridge/info,
//     bridge/extensions and bridge/converters. A target already has both
//     control4.mjs files. An instance with advanced.enable_external_js off, or
//     without the files, is only reported: its first install is by hand
//     (README, Install).
//   - An instance whose status (control4/status/<base>) already reports
//     dist/'s build is skipped.
//   - The converter is saved first, then the extension, through Zigbee2MQTT's
//     bridge/request/converter/save and extension/save. The new extension's
//     start-up status then already reads the new converter, so it carries the
//     final build.
//   - A push is proven only when the instance's status shows dist/'s build
//     with no problem it wasn't already reporting. Zigbee2MQTT answers a save
//     "ok" even when the new extension's start() throws, so its answer alone
//     proves nothing.
//   - After a proven push, `republish` makes Home Assistant see the new
//     exposes.
//   - A push that can't be proven is rolled back: each file it saved gets back
//     the code the instance had published before (its retained
//     bridge/extensions and bridge/converters), in the same order, and the run
//     stops.
// The run ends with a table: base, build before, build now, result.
import {randomUUID} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {buildId} from "./build-id.mjs";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const FILE = "control4.mjs";

/** The order a push saves the two files in (see the header). */
export const SAVE_ORDER = ["converter", "extension"];

export const TIMEOUTS = {
    /** A converter save re-resolves every device's definition before it answers. */
    save: 60_000,
    /** The new extension publishes its status as it starts. */
    proof: 45_000,
    /** A rollback that leaves the extension alone is proven by its next minutely status. */
    rollback: 75_000,
    republish: 15_000,
};

/** Retained messages are collected until none has come for this long (or the cap). */
const SETTLE_MS = 2_000;
const COLLECT_MAX_MS = 15_000;

/**
 * What the tool reads: every instance's bridge info, external JS lists and
 * bridge responses (base topics of one or two levels), and every status. All
 * are subscribed before anything is sent: Home Assistant batches MQTT
 * subscriptions, and an answer that came before its subscription would be
 * lost (answers aren't retained).
 */
const SUBSCRIBE_TOPICS = [
    "+/bridge/info",
    "+/+/bridge/info",
    "+/bridge/extensions",
    "+/+/bridge/extensions",
    "+/bridge/converters",
    "+/+/bridge/converters",
    "+/bridge/response/#",
    "+/+/bridge/response/#",
    "control4/status/#",
];

// ---------------------------------------------------------------------------
// Planning and judging (no I/O)

/**
 * What to do with each Zigbee2MQTT instance on the broker, from the retained
 * messages (topic -> payload text): push, skip or report. Sorted by base topic.
 */
export function plan(retained, distBuild) {
    const json = (topic) => {
        const text = retained.get(topic);
        if (text === undefined) return undefined;
        try {
            return JSON.parse(text);
        } catch {
            return undefined;
        }
    };
    const bases = [...retained.keys()]
        .map((t) => /^(.+)\/bridge\/info$/.exec(t)?.[1])
        .filter((b) => b !== undefined && json(`${b}/bridge/info`) && typeof json(`${b}/bridge/info`) === "object")
        .sort();
    return bases.map((base) => {
        const info = json(`${base}/bridge/info`);
        const status = json(`control4/status/${base}`);
        const row = {
            base,
            version: typeof info.version === "string" ? info.version : undefined,
            before: typeof status?.build === "string" ? status.build : null,
            statusBefore: status && typeof status === "object" ? status : undefined,
            problemsBefore: Array.isArray(status?.problems) ? status.problems : [],
        };
        if (info.config?.advanced?.enable_external_js === false) {
            return {...row, action: "report", reason: "advanced.enable_external_js is off: turn it on, then install by hand (README, Install)"};
        }
        const code = (kind) => {
            const list = json(`${base}/bridge/${kind}s`);
            return Array.isArray(list) ? list.find((f) => f?.name === FILE && typeof f.code === "string")?.code : undefined;
        };
        const kept = {converter: code("converter"), extension: code("extension")};
        const missing = SAVE_ORDER.filter((kind) => kept[kind] === undefined);
        if (missing.length) {
            return {
                ...row,
                action: "report",
                reason: `no ${missing.map((k) => `external_${k}s/${FILE}`).join(" or ")}: left alone (to add Control4 to it, install by hand: README, Install)`,
            };
        }
        if (row.before === distBuild) return {...row, action: "skip", reason: `already on ${distBuild}`, kept};
        return {...row, action: "push", kept};
    });
}

/**
 * Whether a status proves its instance runs `build`: true; a string saying why
 * not; or undefined to keep waiting. Another build means keep waiting: it is
 * the old extension's minutely status from between the two saves, or a build
 * not known yet (null).
 */
export function judge(status, build, problemsBefore = []) {
    if (!status || typeof status !== "object" || status.build !== build) return undefined;
    const added = (Array.isArray(status.problems) ? status.problems : []).filter((p) => !problemsBefore.includes(p));
    return added.length ? `new problem${added.length > 1 ? "s" : ""}: ${added.join(", ")}` : true;
}

/** The request that saves `code` as control4.mjs, and the topic its answer comes on. */
export function saveRequest(base, kind, code, transaction) {
    return {
        topic: `${base}/bridge/request/${kind}/save`,
        response: `${base}/bridge/response/${kind}/save`,
        payload: JSON.stringify({name: FILE, code, transaction}),
    };
}

/** The build a rollback puts back: that of the two files the instance had published. */
export function rollbackBuild(kept) {
    return buildId(kept.extension, kept.converter);
}

/** The run's table: base, build before, build now, result. */
export function table(rows) {
    const head = ["base", "before", "now", "result"];
    const cells = rows.map((r) => [r.base, r.before ?? "-", r.now ?? "-", r.result]);
    const width = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
    const line = (c) => c.map((x, i) => (i === c.length - 1 ? x : x.padEnd(width[i]))).join("  ");
    return [line(head), ...cells.map(line)].join("\n");
}

// ---------------------------------------------------------------------------
// One instance

/**
 * Push dist's two files (`dist`: {converter, extension, build}) to one target
 * and prove it, or put back what it ran. `io` is what the tool hears and says:
 *   publish(topic, payload)               send one message
 *   mark()                                a position in what has been received so far
 *   wait(topic, since, ms, accept)        the first non-undefined accept(json, text) for a message
 *                                         on `topic` received after `since`; undefined after `ms`
 *   latest(topic)                         the last payload text received on `topic`
 * Returns the target's table row and whether the run may go on.
 */
export async function pushInstance(io, target, dist, t = TIMEOUTS) {
    const {base} = target;
    let n = 0;
    const stamp = Date.now().toString(36);
    const request = async (topic, response, payload, transaction, ms) => {
        const since = io.mark();
        await io.publish(topic, payload);
        const reply = await io.wait(response, since, ms, (p) => (p?.transaction === transaction ? p : undefined));
        return {reply, since};
    };
    const save = (kind, code) => {
        const transaction = `deploy-${stamp}-${++n}`;
        const r = saveRequest(base, kind, code, transaction);
        return request(r.topic, r.response, r.payload, transaction, t.save);
    };
    const answer = (kind, reply) =>
        !reply ? `${kind} save: no answer within ${t.save / 1000} s` : reply.status !== "ok" ? `${kind} save: ${reply.error ?? reply.status}` : undefined;

    // Zigbee2MQTT writes a file before importing it, so a save that fails still leaves the file written.
    const saved = [];
    let failure;
    let since;
    for (const kind of SAVE_ORDER) {
        const r = await save(kind, dist[kind]);
        saved.push(kind);
        failure = answer(kind, r.reply);
        if (failure) break;
        // The new extension may publish its start-up status before Zigbee2MQTT answers the save.
        since = r.since;
    }
    if (!failure) {
        const verdict = await io.wait(`control4/status/${base}`, since, t.proof, (s) => judge(s, dist.build, target.problemsBefore));
        if (verdict === true) {
            const transaction = `deploy-${stamp}-${++n}`;
            const {reply} = await request(
                `${base}/bridge/request/control4/republish`,
                `${base}/bridge/response/control4/republish`,
                JSON.stringify({transaction}),
                transaction,
                t.republish,
            );
            // The build runs either way: stale exposes in Home Assistant are no reason to undo it.
            const note = reply?.status === "ok" ? "" : `; republish ${reply ? (reply.error ?? reply.status) : "unanswered"}: send it again by hand`;
            return {row: {base, before: target.before, now: dist.build, result: `pushed${note}`}, ok: true};
        }
        failure = verdict ?? `no status with build ${dist.build} within ${t.proof / 1000} s`;
    }

    const back = await rollBack(save, answer, io, target, saved, t);
    return {row: {base, before: target.before, now: back.now, result: `failed (${failure}); ${back.result}`}, ok: false};
}

/**
 * Re-save the code the instance had published for each file the push saved,
 * in the push's order, and prove it. An instance that published a status
 * before the push must report the kept build again. One that published none
 * (a build from before the instance status) can only be checked by the save
 * answers and by its retained file lists carrying the kept code.
 */
async function rollBack(save, answer, io, target, saved, t) {
    const {base, kept} = target;
    const build = rollbackBuild(kept);
    let since;
    for (const kind of SAVE_ORDER.filter((k) => saved.includes(k))) {
        const r = await save(kind, kept[kind]);
        since ??= r.since;
        const failure = answer(kind, r.reply);
        if (failure) return {now: null, result: `rollback NOT proven (${failure}): check ${base} by hand`};
    }
    if (target.statusBefore) {
        const verdict = await io.wait(`control4/status/${base}`, since, t.rollback, (s) => judge(s, build, target.problemsBefore));
        if (verdict === true) return {now: build, result: `rolled back to ${build}`};
        return {now: null, result: `rollback NOT proven (${verdict ?? `no status with build ${build} within ${t.rollback / 1000} s`}): check ${base} by hand`};
    }
    const listed = (kind) => {
        try {
            return JSON.parse(io.latest(`${base}/bridge/${kind}s`) ?? "[]").find((f) => f?.name === FILE)?.code === kept[kind];
        } catch {
            return false;
        }
    };
    if (saved.every(listed)) return {now: null, result: "rolled back (this build publishes no status: proven by the save answers and file lists only)"};
    return {now: null, result: `rollback NOT proven (the retained file list doesn't carry the old code): check ${base} by hand`};
}

// ---------------------------------------------------------------------------
// Home Assistant connection

/** What the tool has received over MQTT, in order, with waiters for what is still to come. */
class Inbox {
    messages = [];
    waiters = new Set();
    lastAt = Date.now();

    add(topic, text) {
        const m = {topic, text, json: parseJson(text)};
        this.messages.push(m);
        this.lastAt = Date.now();
        for (const w of [...this.waiters]) w(m, this.messages.length - 1);
    }

    mark() {
        return this.messages.length;
    }

    latest(topic) {
        for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].topic === topic) return this.messages[i].text;
        return undefined;
    }

    /** The latest payload text of every topic. */
    retained() {
        const out = new Map();
        for (const m of this.messages) out.set(m.topic, m.text);
        return out;
    }

    wait(topic, since, ms, accept) {
        for (const m of this.messages.slice(since)) {
            const v = m.topic === topic ? accept(m.json, m.text) : undefined;
            if (v !== undefined) return Promise.resolve(v);
        }
        return new Promise((resolve) => {
            const done = (v) => {
                clearTimeout(timer);
                this.waiters.delete(waiter);
                resolve(v);
            };
            const waiter = (m) => {
                const v = m.topic === topic ? accept(m.json, m.text) : undefined;
                if (v !== undefined) done(v);
            };
            const timer = setTimeout(() => done(undefined), ms);
            this.waiters.add(waiter);
        });
    }

    /** Resolves once nothing has arrived for `quietMs` (counted from the call at the earliest), or after `maxMs`. */
    async settled(quietMs, maxMs) {
        const start = Date.now();
        while (Date.now() - Math.max(this.lastAt, start) < quietMs && Date.now() - start < maxMs) await sleep(250);
    }
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** An MQTT payload as Home Assistant forwards it: text, or bytes as a list of numbers. */
function payloadText(p) {
    if (typeof p === "string") return p;
    if (Array.isArray(p)) return Buffer.from(p).toString("utf8");
    if (p && typeof p === "object" && Array.isArray(p.data)) return Buffer.from(p.data).toString("utf8");
    return String(p ?? "");
}

/** The websocket connection, as tools/c4-scenarios.mjs opens it, with MQTT publish and subscribe. */
function connect(url, token) {
    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/websocket`);
    let id = 0;
    const pending = new Map();
    const subs = new Map();
    return new Promise((resolve, reject) => {
        // A failed connection closes the socket, so the process can end on its own.
        const fail = (error) => {
            clearTimeout(timer);
            ws.close();
            reject(error);
        };
        const timer = setTimeout(() => fail(new Error(`no answer from ${url} within 20 s`)), 20_000);
        ws.onerror = (ev) => fail(new Error(`websocket error talking to ${url}: ${ev?.message || "connection failed"}`));
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.type === "auth_required") ws.send(JSON.stringify({type: "auth", access_token: token}));
            else if (msg.type === "auth_invalid") fail(new Error("auth failed"));
            else if (msg.type === "auth_ok") {
                clearTimeout(timer);
                resolve(ha);
            } else if (msg.type === "event" && subs.has(msg.id)) subs.get(msg.id)(msg.event);
            else if (msg.type === "result" && pending.has(msg.id)) {
                const {res, rej} = pending.get(msg.id);
                pending.delete(msg.id);
                msg.success ? res(msg.result) : rej(new Error(`${msg.error?.code}: ${msg.error?.message}`));
            }
        };
        const ha = {
            call(payload) {
                const n = ++id;
                return new Promise((res, rej) => {
                    const timer = setTimeout(() => {
                        pending.delete(n);
                        rej(new Error(`${payload.type}${payload.service ? ` ${payload.domain}.${payload.service}` : ""}: no answer within 30 s`));
                    }, 30_000);
                    const done = (f) => (v) => {
                        clearTimeout(timer);
                        f(v);
                    };
                    pending.set(n, {res: done(res), rej: done(rej)});
                    ws.send(JSON.stringify({...payload, id: n}));
                });
            },
            async subscribeMqtt(topic, cb) {
                const n = id + 1;
                subs.set(n, (event) => cb(event.topic, payloadText(event.payload)));
                await ha.call({type: "mqtt/subscribe", topic, qos: 1});
            },
            publishMqtt(topic, payload) {
                return ha.call({type: "call_service", domain: "mqtt", service: "publish", service_data: {topic, payload, qos: 1, retain: false}});
            },
            close: () => ws.close(),
        };
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Home Assistant's mqtt.publish must carry each save byte for byte: a payload
 * it rendered as a template would corrupt a push and its rollback alike. So
 * before touching any instance, send each request's payload to a topic no
 * instance reads (`topic`, already subscribed), and compare what comes back.
 */
async function checkTransport(ha, inbox, topic, payloads) {
    for (const payload of payloads) {
        const since = inbox.mark();
        await ha.publishMqtt(topic, payload);
        const back = await inbox.wait(topic, since, 15_000, (_json, text) => text);
        if (back !== payload) {
            throw new Error(
                back === undefined
                    ? `the transport check got nothing back on ${topic} within 15 s`
                    : `Home Assistant changed a payload on its way through MQTT (${payload.length} bytes sent, ${back.length} back): nothing pushed`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Command line

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const url = (process.env.HA_URL ?? "").replace(/\/$/, "");
    const token = process.env.HA_TOKEN ?? (process.env.HA_TOKEN_FILE ? fs.readFileSync(process.env.HA_TOKEN_FILE, "utf8").trim() : "");
    if (!url || !token) throw new UsageError("set HA_URL and HA_TOKEN (or HA_TOKEN_FILE)");
    const read = (kind) => fs.readFileSync(path.join(DIST, `external_${kind}s`, FILE), "utf8");
    const dist = {converter: read("converter"), extension: read("extension")};
    dist.build = buildId(dist.extension, dist.converter);

    const ha = await connect(url, token);
    let failed = false;
    try {
        const inbox = new Inbox();
        const probe = `c4-deploy/probe/${randomUUID()}`;
        for (const topic of [...SUBSCRIBE_TOPICS, probe]) await ha.subscribeMqtt(topic, (tp, text) => inbox.add(tp, text));
        await inbox.settled(SETTLE_MS, COLLECT_MAX_MS);
        const rows = plan(inbox.retained(), dist.build);
        console.log(`dist/ build ${dist.build}`);
        if (!rows.length) console.log("no Zigbee2MQTT instance found (no retained <base>/bridge/info)");
        for (const r of rows) {
            const now = r.before ? `on ${r.before}` : "no status";
            const what = r.action === "push" ? (opts.dryRun ? "would push" : "push") : r.action;
            console.log(`  ${r.base} (Zigbee2MQTT ${r.version ?? "?"}, ${now}): ${what}${r.reason ? ` - ${r.reason}` : ""}`);
        }
        const targets = rows.filter((r) => r.action === "push");
        if (opts.dryRun || !targets.length) return;

        await checkTransport(
            ha,
            inbox,
            probe,
            SAVE_ORDER.map((kind) => saveRequest("probe", kind, dist[kind], "probe").payload),
        );
        const io = {
            publish: (topic, payload) => ha.publishMqtt(topic, payload),
            mark: () => inbox.mark(),
            wait: (topic, since, ms, accept) => inbox.wait(topic, since, ms, accept),
            latest: (topic) => inbox.latest(topic),
        };
        const done = [];
        for (const target of targets) {
            console.log(`${target.base}: pushing ${dist.build}...`);
            const {row, ok} = await pushInstance(io, target, dist);
            done.push(row);
            if (!ok) {
                failed = true;
                break;
            }
        }
        const untouched = rows.filter((r) => !done.some((d) => d.base === r.base));
        console.log(
            `\n${table([...done, ...untouched.map((r) => ({base: r.base, before: r.before, now: r.before, result: r.action === "push" ? "not pushed: the run stopped" : `${r.action}: ${r.reason}`}))])}`,
        );
    } finally {
        ha.close();
    }
    process.exitCode = failed ? 1 : 0;
}

/** A command-line mistake: exit 2, like a missing setting. */
class UsageError extends Error {}

/** Only --dry-run; anything else is refused, so a typo never pushes. */
function parseArgs(args) {
    const out = {dryRun: false};
    for (const a of args) {
        if (a !== "--dry-run") throw new UsageError(`unknown option '${a}': the only option is --dry-run`);
        if (out.dryRun) throw new UsageError("--dry-run given twice");
        out.dryRun = true;
    }
    return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    // Set the exit code and let the process end on its own: process.exit() while
    // the websocket is still closing aborts Node on Windows.
    main().catch((e) => {
        console.error(e?.message ?? e);
        process.exitCode = e instanceof UsageError ? 2 : 1;
    });
}
