// The deploy tool's planning, judging and push / rollback sequence, against a
// fake Zigbee2MQTT instance that answers saves the way 2.14.2 does: it writes
// the file before importing it, answers "ok" even when the new extension's
// start() throws, and the new extension publishes its status as it starts,
// before the save is answered. No Home Assistant is needed.
import {spawnSync} from "node:child_process";
import path from "node:path";

import {describe, expect, it} from "vitest";

import {buildId} from "../tools/build-id.mjs";
import {type Files, type Io, judge, plan, pushInstance, rollbackBuild, SAVE_ORDER, saveRequest, type Target, table} from "../tools/deploy.mjs";

const TOOL = path.resolve(__dirname, "..", "tools", "deploy.mjs");
const BASE = "zigbee2mqtt";
const OLD: Files = {extension: "// old extension", converter: "// old converter"};
const NEW = {extension: "// new extension", converter: "// new converter", build: buildId("// new extension", "// new converter")};
const OLD_BUILD = buildId(OLD.extension, OLD.converter);

type Msg = [string, unknown];

interface Behaviour {
    /** A save whose import throws: answered with an error, the file still written. */
    importFails?: (kind: string, code: string) => boolean;
    /** An extension whose start() throws: answered ok, and no extension runs. */
    startFails?: (code: string) => boolean;
    /** A save nobody answers. */
    silent?: (kind: string, code: string) => boolean;
    /** An extension that publishes no status (a build from before the instance status). */
    noStatus?: (code: string) => boolean;
    problems?: (extension: string, converter: string) => string[];
    republishes?: boolean;
}

/** One Zigbee2MQTT instance running `kept`, and what it publishes in answer to each request. */
function instance(kept: Files, o: Behaviour = {}) {
    const files = {...kept};
    let converter = kept.converter;
    let extension: string | undefined = kept.extension;
    const status = (): Msg[] =>
        !extension || o.noStatus?.(extension) ? [] : [[`control4/status/${BASE}`, {base: BASE, build: buildId(extension, converter), problems: o.problems?.(extension, converter) ?? []}]];
    const list = (kind: "converter" | "extension"): Msg => [`${BASE}/bridge/${kind}s`, [{name: "control4.mjs", code: files[kind]}]];
    // biome-ignore lint/suspicious/noExplicitAny: a parsed request
    const handle = (topic: string, p: any): Msg[] => {
        const save = /^zigbee2mqtt\/bridge\/request\/(converter|extension)\/save$/.exec(topic);
        if (save) {
            const kind = save[1] as "converter" | "extension";
            if (o.silent?.(kind, p.code)) return [];
            files[kind] = p.code;
            const reply = (s: string, error?: string): Msg => [`${BASE}/bridge/response/${kind}/save`, {status: s, data: {}, transaction: p.transaction, ...(error ? {error} : {})}];
            if (o.importFails?.(kind, p.code)) return [reply("error", "control4.mjs contains invalid code: boom")];
            if (kind === "converter") {
                converter = p.code;
                // The running extension's next minutely status reads the new converter.
                return [list(kind), ...status(), reply("ok")];
            }
            extension = o.startFails?.(p.code) ? undefined : p.code;
            return [...status(), list(kind), reply("ok")];
        }
        if (topic === `${BASE}/bridge/request/control4/republish`) {
            return o.republishes === false ? [] : [[`${BASE}/bridge/response/control4/republish`, {status: "ok", data: {devices: 3}, transaction: p.transaction}]];
        }
        return [];
    };
    return {handle, files: () => files};
}

/** The tool's io over a fake instance: everything it publishes is answered at once, so a wait that finds nothing has timed out. */
function fakeIo(handle: (topic: string, payload: unknown) => Msg[]) {
    const messages: {topic: string; text: string}[] = [];
    const sent: string[] = [];
    const io: Io = {
        async publish(topic, payload) {
            sent.push(topic);
            for (const [t, v] of handle(topic, JSON.parse(payload))) messages.push({topic: t, text: JSON.stringify(v)});
        },
        mark: () => messages.length,
        async wait(topic, since, _ms, accept) {
            for (const m of messages.slice(since)) {
                const v = m.topic === topic ? accept(JSON.parse(m.text), m.text) : undefined;
                if (v !== undefined) return v;
            }
            return undefined;
        },
        latest: (topic) => [...messages].reverse().find((m) => m.topic === topic)?.text,
    };
    return {io, sent: () => sent.map((t) => t.replace(`${BASE}/bridge/request/`, ""))};
}

const target = (o: Partial<Target> = {}): Target & {kept: Files} => ({
    base: BASE,
    action: "push",
    before: OLD_BUILD,
    statusBefore: {build: OLD_BUILD, problems: []},
    problemsBefore: [],
    kept: OLD,
    ...o,
});

async function push(o: Behaviour = {}, t: Partial<Target> = {}) {
    const z = instance(OLD, o);
    const {io, sent} = fakeIo(z.handle);
    const r = await pushInstance(io, target(t), NEW);
    return {...r, sent: sent(), files: z.files()};
}

describe("deploy: one instance", () => {
    it("saves the converter, then the extension, proves the build and republishes", async () => {
        const r = await push();
        expect(r.sent).toEqual(["converter/save", "extension/save", "control4/republish"]);
        expect(r.row).toEqual({base: BASE, before: OLD_BUILD, now: NEW.build, result: "pushed"});
        expect(r.ok).toBe(true);
        expect(r.files).toEqual({extension: NEW.extension, converter: NEW.converter});
    });

    it("rolls back an extension whose start() throws, though Zigbee2MQTT answered ok", async () => {
        const r = await push({startFails: (code) => code === NEW.extension});
        expect(r.sent).toEqual(["converter/save", "extension/save", "converter/save", "extension/save"]);
        expect(r.row.result).toBe(`failed (no status with build ${NEW.build} within 45 s); rolled back to ${OLD_BUILD}`);
        expect(r.row.now).toBe(OLD_BUILD);
        expect(r.ok).toBe(false);
        expect(r.files).toEqual(OLD);
    });

    it("puts back a converter that fails to import, and never touches the extension", async () => {
        const r = await push({importFails: (kind, code) => kind === "converter" && code === NEW.converter});
        expect(r.sent).toEqual(["converter/save", "converter/save"]);
        expect(r.row.result).toBe(`failed (converter save: control4.mjs contains invalid code: boom); rolled back to ${OLD_BUILD}`);
        expect(r.files).toEqual(OLD);
    });

    it("rolls back an extension that fails to import (Zigbee2MQTT has already written it)", async () => {
        const r = await push({importFails: (kind, code) => kind === "extension" && code === NEW.extension});
        expect(r.sent).toEqual(["converter/save", "extension/save", "converter/save", "extension/save"]);
        expect(r.row.result).toMatch(/^failed \(extension save: .*invalid code.*\); rolled back to /);
        expect(r.files).toEqual(OLD);
    });

    it("rolls back a save nobody answers", async () => {
        const r = await push({silent: (_kind, code) => code === NEW.converter});
        expect(r.sent).toEqual(["converter/save", "converter/save"]);
        expect(r.row.result).toBe(`failed (converter save: no answer within 60 s); rolled back to ${OLD_BUILD}`);
    });

    it("rolls back a build that reports a problem the instance didn't have", async () => {
        const r = await push({problems: (ext) => (ext === NEW.extension ? ["converter_api"] : [])});
        expect(r.row.result).toBe(`failed (new problem: converter_api); rolled back to ${OLD_BUILD}`);
        expect(r.ok).toBe(false);
    });

    it("doesn't hold a problem the instance already had against the push", async () => {
        const r = await push({problems: () => ["no_radio"]}, {problemsBefore: ["no_radio"]});
        expect(r.row.result).toBe("pushed");
    });

    it("waits past the old extension's status between the two saves", async () => {
        // After the converter save, the old extension's minutely status shows a third build: not a verdict.
        const between = buildId(OLD.extension, NEW.converter);
        expect(judge({build: between, problems: []}, NEW.build)).toBeUndefined();
        expect((await push()).row.result).toBe("pushed");
    });

    it("checks a rollback to a build that publishes no status by the save answers and file lists", async () => {
        const r = await push({startFails: (code) => code === NEW.extension, noStatus: (code) => code === OLD.extension}, {before: null, statusBefore: undefined});
        expect(r.row.result).toBe(`failed (no status with build ${NEW.build} within 45 s); rolled back (this build publishes no status: proven by the save answers and file lists only)`);
        expect(r.row.now).toBeNull();
        expect(r.files).toEqual(OLD);
    });

    it("says so when a rollback can't be proven", async () => {
        // The old code doesn't start either: no status ever shows the old build.
        const r = await push({startFails: () => true});
        expect(r.row.result).toBe(`failed (no status with build ${NEW.build} within 45 s); rollback NOT proven (no status with build ${OLD_BUILD} within 75 s): check ${BASE} by hand`);
        expect(r.row.now).toBeNull();
    });

    it("counts a push whose republish nobody answers as pushed, with a note", async () => {
        const r = await push({republishes: false});
        expect(r.ok).toBe(true);
        expect(r.row.result).toBe("pushed; republish unanswered: send it again by hand");
    });
});

describe("deploy: judging a status", () => {
    it("keeps waiting for another build or a build not known yet", () => {
        expect(judge({build: OLD_BUILD, problems: []}, NEW.build)).toBeUndefined();
        expect(judge({build: null, problems: []}, NEW.build)).toBeUndefined();
        expect(judge(undefined, NEW.build)).toBeUndefined();
    });

    it("accepts the build with no new problem, and names new ones", () => {
        expect(judge({build: NEW.build, problems: []}, NEW.build)).toBe(true);
        expect(judge({build: NEW.build, problems: ["no_radio"]}, NEW.build, ["no_radio"])).toBe(true);
        expect(judge({build: NEW.build, problems: ["converter_api", "ping_hook"]}, NEW.build)).toBe("new problems: converter_api, ping_hook");
    });

    it("rolls back to the build of the code the instance published", () => {
        expect(rollbackBuild(OLD)).toBe(buildId(OLD.extension, OLD.converter));
    });
});

describe("deploy: plan", () => {
    const files = (code: string) => JSON.stringify([{name: "other.mjs", code: "// someone else's"}, {name: "control4.mjs", code}]);
    const info = (externalJs?: boolean) => JSON.stringify({version: "2.14.2", config: {advanced: externalJs === undefined ? {} : {enable_external_js: externalJs}}});
    const retained = new Map<string, string>([
        ["zigbee2mqtt/bridge/state", JSON.stringify({state: "online"})],
        // On the build already.
        ["z2m_a/bridge/info", info(true)],
        ["z2m_a/bridge/extensions", files(NEW.extension)],
        ["z2m_a/bridge/converters", files(NEW.converter)],
        ["control4/status/z2m_a", JSON.stringify({base: "z2m_a", build: NEW.build, problems: []})],
        // On an older one.
        ["z2m_b/bridge/info", info()],
        ["z2m_b/bridge/extensions", files(OLD.extension)],
        ["z2m_b/bridge/converters", files(OLD.converter)],
        ["control4/status/z2m_b", JSON.stringify({base: "z2m_b", build: OLD_BUILD, problems: ["no_radio"]})],
        // External JS off: no file lists at all.
        ["z2m_c/bridge/info", info(false)],
        // No converter.
        ["z2m_d/bridge/info", info(true)],
        ["z2m_d/bridge/extensions", files(OLD.extension)],
        ["z2m_d/bridge/converters", JSON.stringify([])],
        // Two levels, and no status: a build from before the instance status.
        ["site/floor2/bridge/info", info(true)],
        ["site/floor2/bridge/extensions", files(OLD.extension)],
        ["site/floor2/bridge/converters", files(OLD.converter)],
    ]);
    const rows = plan(retained, NEW.build);
    const row = (base: string) => rows.find((r) => r.base === base) as Target;

    it("finds every instance from its bridge info, sorted by base topic", () => {
        expect(rows.map((r) => r.base)).toEqual(["site/floor2", "z2m_a", "z2m_b", "z2m_c", "z2m_d"]);
    });

    it("skips an instance already on the build", () => {
        expect(row("z2m_a")).toMatchObject({action: "skip", before: NEW.build, reason: `already on ${NEW.build}`});
    });

    it("pushes to one on another build, keeping its control4.mjs code and problems", () => {
        expect(row("z2m_b")).toMatchObject({action: "push", before: OLD_BUILD, problemsBefore: ["no_radio"], kept: OLD, version: "2.14.2"});
    });

    it("pushes to one with no status, which a rollback can't check by status", () => {
        expect(row("site/floor2")).toMatchObject({action: "push", before: null, statusBefore: undefined, kept: OLD});
    });

    it("only reports one with external JS off, or without the two files", () => {
        expect(row("z2m_c")).toMatchObject({action: "report", reason: expect.stringMatching(/enable_external_js is off/)});
        expect(row("z2m_d")).toMatchObject({action: "report", reason: expect.stringMatching(/^no external_converters\/control4\.mjs: left alone/)});
    });
});

describe("deploy: requests and table", () => {
    it("saves the converter first", () => {
        expect(SAVE_ORDER).toEqual(["converter", "extension"]);
    });

    it("saves control4.mjs on the instance's own bridge topics", () => {
        const r = saveRequest("site/floor2", "extension", "// code", "t1");
        expect(r.topic).toBe("site/floor2/bridge/request/extension/save");
        expect(r.response).toBe("site/floor2/bridge/response/extension/save");
        expect(JSON.parse(r.payload)).toEqual({name: "control4.mjs", code: "// code", transaction: "t1"});
    });

    it("lines the table up", () => {
        expect(table([{base: "zigbee2mqtt", before: "aaa", now: "bbb", result: "pushed"}, {base: "z2", before: null, now: null, result: "report: x"}]).split("\n")).toEqual([
            "base         before  now  result",
            "zigbee2mqtt  aaa     bbb  pushed",
            "z2           -       -    report: x",
        ]);
    });
});

// Refused command lines exit before connecting; accepted ones fail at the
// connection step (port 9 is no Home Assistant), so nothing is pushed.
describe("deploy command line", () => {
    const run = (args: string[], env: Record<string, string> = {HA_URL: "http://127.0.0.1:9", HA_TOKEN: "x"}) => {
        const r = spawnSync(process.execPath, [TOOL, ...args], {env: {...process.env, HA_URL: "", HA_TOKEN: "", HA_TOKEN_FILE: "", ...env}, encoding: "utf8", timeout: 20_000});
        return {status: r.status, err: r.stderr};
    };

    it.each([
        [["--dry"], /unknown option '--dry': the only option is --dry-run/],
        [["--dry-run", "now"], /unknown option 'now'/],
        [["--dry-run", "--dry-run"], /--dry-run given twice/],
    ])("refuses %j", (args, message) => {
        const r = run(args as string[]);
        expect(r.status).toBe(2);
        expect(r.err).toMatch(message as RegExp);
    });

    it("refuses to run without Home Assistant settings", () => {
        const r = run([], {});
        expect(r.status).toBe(2);
        expect(r.err).toMatch(/set HA_URL and HA_TOKEN/);
    });

    it.each([[[]], [["--dry-run"]]])("accepts %j", (args) => {
        const r = run(args);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/websocket error talking to http:\/\/127\.0\.0\.1:9/);
    });
});
