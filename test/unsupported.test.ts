import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {definitionModel, GENERIC_MODEL, PROFILE_NETWORK} from "../src/core/constants";
import {GET_TIMEOUT} from "../src/core/link";
import {SETTINGS_READ_DELAY} from "../src/devices/dm";
import {FINGERPRINT_KEY, FINGERPRINT_PROPS, FRAME_LOG_LIMIT, fingerprintHint, REPORTED_MODEL_KEY} from "../src/devices/unsupported";
import {buildDefinitions} from "../src/z2m/definitions";
import {Rig, tick} from "./rig";

const UNK = "0x000fff0000000a01"; // a device whose model this build doesn't support

let rig: Rig;

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

/** Answer the newest Get with `status` (and values), as the device would. */
function answer(r: Rig, status: string, values = ""): void {
    const get = [...r.texts()].reverse().find((t) => t.startsWith("0g"));
    if (!get) throw new Error("no Get to answer");
    const [head, ...prop] = get.split(" ");
    r.ascii(UNK, `0r${head.slice(2, 6)} ${status} ${prop.join(" ")} ${values}`.trim());
}

const gets = (r: Rig, from = 0) => r.texts(from).filter((t) => t.startsWith("0g")).map((t) => t.replace(/^0g[0-9a-f]{4} /, ""));

describe("a check-in naming a model this build doesn't support", () => {
    it("keeps the device ours and generic: the identity answered, the model learned, the record left generic", async () => {
        rig.add(UNK, GENERIC_MODEL);
        rig.start();
        expect(rig.checkin(UNK, "c4:outlet_dimmer:LOZ-5D1-W")).toBe(true);
        await tick(10);
        expect(rig.transport.sent.some((s) => s.frame.profile === PROFILE_NETWORK)).toBe(true);
        expect(rig.store.model(UNK)).toBe("LOZ-5D1-W");
        expect(rig.devices.get(UNK)?.modelID).toBe(GENERIC_MODEL);
        expect(rig.runtime.get(UNK)?.family).toBe("unsupported");
        expect(rig.last(UNK)[REPORTED_MODEL_KEY]).toBe("LOZ-5D1-W");
        expect(rig.log.lines.some((l) => l.startsWith("warning:") && l.includes("LOZ-5D1-W, which this build doesn't support yet"))).toBe(true);
    });

    it("puts back the generic record on a device an older build stamped with the unsupported model", async () => {
        rig.add(UNK, "LOZ-5D1-W");
        rig.start();
        rig.checkin(UNK, "c4:outlet_dimmer:LOZ-5D1-W");
        await tick(10);
        expect(rig.devices.get(UNK)?.modelID).toBe(GENERIC_MODEL);
    });

    it("takes the generic record's c4_get and c4_send", async () => {
        rig.add(UNK, GENERIC_MODEL);
        rig.store.setModel(UNK, "LOZ-5D1-W");
        rig.start();
        const get = rig.runtime.set(UNK, "c4_get", "c4.dmx.led 00 03", {message: {}});
        await tick(100);
        await get;
        const send = rig.runtime.set(UNK, "c4_send", "c4.dmx.blc 00 05 000000", {message: {}});
        await tick(100);
        await send;
        expect(rig.cmds().slice(-2)).toEqual(["c4.dmx.led 00 03", "c4.dmx.blc 00 05 000000"]);
    });

    it("logs every frame it sends at info, up to a limit a run", () => {
        rig.add(UNK, GENERIC_MODEL);
        rig.store.setModel(UNK, "LOZ-5D1-W");
        rig.start();
        rig.ascii(UNK, "0t1234 sa c4.dmx.bp 02");
        expect(rig.log.lines).toContain("info: Control4 UNSUPPORTED dev0 (LOZ-5D1-W) <- 0t1234 sa c4.dmx.bp 02");
        for (let i = 0; i < FRAME_LOG_LIMIT + 5; i++) rig.ascii(UNK, "0t1234 sa c4.dmx.sc 02");
        expect(rig.log.lines.filter((l) => l.startsWith("info: Control4 UNSUPPORTED"))).toHaveLength(FRAME_LOG_LIMIT);
    });

    it("becomes the supported model's handler once a build knows it", async () => {
        rig.add(UNK, GENERIC_MODEL);
        rig.store.setModel(UNK, "LOZ-5D1-W");
        rig.start();
        expect(rig.runtime.get(UNK)?.family).toBe("unsupported");
        rig.checkin(UNK, "c4:control4_keypad:C4-KC120277");
        await tick(10);
        expect(rig.runtime.get(UNK)?.family).toBe("kc120277");
        expect(rig.devices.get(UNK)?.modelID).toBe("C4-KC120277");
    });
});

describe("the fingerprint read", () => {
    const fresh = () => {
        rig.add(UNK, GENERIC_MODEL);
        rig.store.setModel(UNK, "LOZ-5D1-W");
        rig.start();
    };

    it("asks once which namespaces it answers, read-only, and logs and saves what it said", async () => {
        fresh();
        await tick(SETTINGS_READ_DELAY - 1000);
        expect(gets(rig)).toEqual([]);
        await tick(1000);
        const replies: Record<string, [string, string]> = {
            "c4.sy.fwv": ["000", "5.0.9"],
            "c4.sy.ri": ["000", "SW RBT"],
            "c4.dmx.bmc 00": ["000", "0683"],
            "c4.dmx.btn 00 01": ["000", "02"],
            "c4.dmx.led 00 01": ["000", "02"],
            "c4.dmx.amb 00": ["000", "12"],
            "c4.dm.is": ["000", "0000 0064 01f4 01f4 1388 1388 0064 0001 000a 0000 0000"],
            "c4.dm.tv 00 00": ["000", "0000"],
            "c4.dm.tv 01 00": ["v01", ""],
            "c4.kp.bhp": ["n01", ""],
        };
        for (const prop of FINGERPRINT_PROPS) {
            await tick(100);
            expect(gets(rig).at(-1)).toBe(prop);
            const [status, values] = replies[prop];
            answer(rig, status, values);
            await tick(0);
        }
        await tick(1000);
        // Only Gets: nothing that changes the device.
        expect(rig.texts().every((t) => t.startsWith("0g"))).toBe(true);
        const saved = rig.store.get<Record<string, string>>(UNK, FINGERPRINT_KEY);
        expect(saved?.["c4.dmx.bmc 00"]).toBe("000 00 0683");
        expect(saved?.["c4.kp.bhp"]).toBe("n01");
        const line = rig.log.lines.find((l) => l.includes("fingerprint:"));
        expect(line).toContain("c4.sy.fwv -> 000 5.0.9");
        expect(rig.log.lines.some((l) => l.includes("it speaks c4.dmx") && l.includes("it has a c4.dm load"))).toBe(true);

        // Not again at the next start.
        rig.stop();
        const again = new Rig({store: rig.store});
        again.add(UNK, GENERIC_MODEL);
        again.start();
        await tick(SETTINGS_READ_DELAY * 2);
        expect(gets(again)).toEqual([]);
        again.stop();
    });

    it("gives up on a device that answers no Get, and doesn't ask it again", async () => {
        fresh();
        await tick(SETTINGS_READ_DELAY + 100);
        await tick(GET_TIMEOUT + 500);
        await tick(GET_TIMEOUT + 500);
        expect(gets(rig)).toEqual(["c4.sy.fwv", "c4.sy.ri"]);
        expect(rig.store.get(UNK, FINGERPRINT_KEY)).toEqual({"c4.sy.fwv": "no reply", "c4.sy.ri": "no reply"});
        expect(rig.log.lines.some((l) => l.includes("it answered no Get"))).toBe(true);
        await tick(600_000);
        expect(gets(rig)).toHaveLength(2);
    });
});

describe("fingerprintHint", () => {
    it("names the closest family by the namespaces answered", () => {
        expect(fingerprintHint({"c4.dmx.bmc 00": "n01", "c4.dm.tv 00 00": "000 0032", "c4.dm.tv 01 00": "000 0000"})).toContain("two channels answer");
        expect(fingerprintHint({"c4.kp.bhp": "000 01f4"})).toContain("KP3-Z / KP6-Z");
        expect(fingerprintHint({"c4.sy.fwv": "n01"})).toContain("none of the namespaces asked");
    });
});

describe("definitions", () => {
    it("records a supported model as itself and any other as the generic one", () => {
        expect(definitionModel("C4-KC120277-W")).toBe("C4-KC120277-W");
        expect(definitionModel("LOZ-5D1-W")).toBe(GENERIC_MODEL);
    });

    it("shows the reported model on the generic definition", () => {
        const generic = buildDefinitions().find((d: {model: string}) => d.model === GENERIC_MODEL);
        expect(generic.exposes.map((x: {property?: string}) => x.property)).toContain("reported_model");
    });
});
