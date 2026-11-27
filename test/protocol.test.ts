import {describe, expect, it} from "vitest";

import {canonicalModel, isC4Ieee, modelFromCheckin, modelInfo} from "../src/core/constants";
import {
    blendHex,
    buildIdentityFrame,
    buildZclCommand,
    hueRgb,
    moveToLevelWithOnOff,
    parseFrame,
    parseReadAttributesResponse,
    parseReportAttributes,
    parseZclHeader,
    pctToBrightness,
    scaleHex,
    scaleRgb,
    stripAppHeader,
    tokenize,
} from "../src/core/protocol";

describe("ASCII frames", () => {
    it("parses an announcement", () => {
        const f = parseFrame(Buffer.from("0t0041 sa c4.dmx.cc 01 02\r\n"));
        expect(f.kind).toBe("announce");
        expect(f.seq).toBe("0041");
        expect(f.tokens).toEqual(["0t0041", "sa", "c4.dmx.cc", "01", "02"]);
    });

    it("ends a frame at its first NUL, as the Gen3 board pads some replies after the value", () => {
        // Seen on real devices, 2026-11-08: firmware, bootloader and TX power replies.
        expect(parseFrame(Buffer.from("0r0042 000 c4.sy.fwv 4.4.16 \0\0\0", "latin1")).tokens).toEqual(["0r0042", "000", "c4.sy.fwv", "4.4.16"]);
        expect(parseFrame(Buffer.from("0r0043 000 c4.sy.blv AT25DF041A-4.0.10.0 \0 \xf9", "latin1")).tokens.at(-1)).toBe("AT25DF041A-4.0.10.0");
        expect(parseFrame(Buffer.from('0r0044 000 c4.sy.ri " SW RBT"\0(\0', "latin1")).tokens.at(-1)).toBe('" SW RBT"');
        expect(parseFrame(Buffer.from("0r0045 000 c4.sy.zpw 00\0\0", "latin1")).tokens.at(-1)).toBe("00");
    });

    it("keeps quoted arguments together", () => {
        expect(tokenize('0s0040 c4.ln.ri "Living Room" ""')).toEqual(["0s0040", "c4.ln.ri", '"Living Room"', '""']);
    });

    it("strips the 8-byte C4 application header", () => {
        const body = Buffer.from("0t0001 sa c4.z2x.cts 1f");
        const hdr = Buffer.from([0xc5, 0x01, 0x01, 0x00, 0x5c, 0xc2, 0x00, 0x00]);
        expect(stripAppHeader(Buffer.concat([hdr, body])).toString()).toBe(body.toString());
        expect(stripAppHeader(body).toString()).toBe(body.toString());
    });

    it("maps percent to brightness with full scale at 99", () => {
        expect(pctToBrightness(0)).toBe(0);
        expect(pctToBrightness(50)).toBe(127);
        expect(pctToBrightness(99)).toBe(254);
        expect(pctToBrightness(100)).toBe(254);
    });
});

describe("models", () => {
    it("extracts and canonicalises the check-in model", () => {
        expect(modelFromCheckin("c4:control4_light:C4-APD120")).toBe("C4-APD120");
        expect(canonicalModel("LOZ-5S1-W")).toBe("LOZ-5S1-W");
        expect(canonicalModel("loz-5s1-w")).toBe("loz-5s1-w");
        expect(canonicalModel("c4-dim1-z")).toBe("C4-DIM1-Z");
        expect(canonicalModel("C4-KC120277-XX")).toBe("C4-KC120277");
        expect(modelInfo("KPZ-6B1")?.family).toBe("kp6");
        expect(modelInfo("KPZ-6B1-C")?.family).toBe("kc120277");
        expect(modelInfo("C4-SR250")?.family).toBe("sr250");
        expect(modelInfo("nonsense")).toBeUndefined();
    });

    it("recognises Control4 IEEEs", () => {
        expect(isC4Ieee("0x000fff0000006e2a")).toBe(true);
        expect(isC4Ieee("0x00124b0024c0dc0d")).toBe(false);
    });
});

describe("ZCL", () => {
    it("builds the controller identity like the quirk did", () => {
        // Report Attributes: 08 tsn 0a | 0800 21 0000 | 0900 f0 <eui LE> | 0a00 20 02
        const frame = buildIdentityFrame("0x00124b0024c0dc0d", 0x33);
        expect(frame.toString("hex")).toBe("08330a0800210000" + "0900f0" + "0ddcc024004b1200" + "0a002002");
        // Read Attributes Response carries a status byte per record.
        const rsp = buildIdentityFrame("0x00124b0024c0dc0d", 0x07, true);
        expect(rsp.toString("hex")).toBe("080701080000210000" + "09000" + "0f0" + "0ddcc024004b1200" + "0a00002002");
    });

    it("parses a check-in report", () => {
        const s = Buffer.from("c4:control4_light:C4-DIM1-Z");
        const data = Buffer.concat([
            Buffer.from([0x18, 0x01, 0x0a, 0x07, 0x00, 0x42, s.length]),
            s,
            Buffer.from([0x04, 0x00, 0x42, 0x08]),
            Buffer.from("03.22.41"),
            Buffer.from([0x00, 0x00, 0x20, 0x02]),
            Buffer.from([0x06, 0x00, 0x21, 0x3a, 0x00]),
        ]);
        const hdr = parseZclHeader(data);
        expect(hdr?.commandId).toBe(0x0a);
        const attrs = parseReportAttributes(data.subarray(hdr?.offset ?? 0));
        expect(attrs.get(0x0007)).toBe("c4:control4_light:C4-DIM1-Z");
        expect(attrs.get(0x0004)).toBe("03.22.41");
        expect(attrs.get(0x0000)).toBe(2);
        expect(attrs.get(0x0006)).toBe(0x3a);
    });

    it("parses a read attributes response, skipping failed records", () => {
        const payload = Buffer.from([0x07, 0x00, 0x86, 0x00, 0x00, 0x00, 0x10, 0x01]);
        const attrs = parseReadAttributesResponse(payload);
        expect(attrs.has(0x0007)).toBe(false);
        expect(attrs.get(0x0000)).toBe(true);
    });

    it("builds load commands", () => {
        expect(moveToLevelWithOnOff(5, 254, 8).toString("hex")).toBe("110504fe0800");
        expect(buildZclCommand(6, 0x01).toString("hex")).toBe("110601");
    });
});

describe("colour", () => {
    it("scales without losing a lit channel", () => {
        expect(scaleHex("ffbf00", 100)).toBe("ffbf00");
        expect(scaleHex("0000ff", 1)).toBe("000002");
        expect(scaleHex("010000", 1)).toBe("010000");
        expect(scaleRgb([255, 0, 0], 0)).toEqual([0, 0, 0]);
        expect(scaleRgb([1, 0, 0], 10)).toEqual([1, 0, 0]);
    });

    it("blends and makes hues", () => {
        expect(blendHex("000000", "ffffff", 0.5)).toBe("808080");
        expect(hueRgb(0)).toEqual([255, 0, 0]);
        expect(hueRgb(1 / 3)).toEqual([0, 255, 0]);
    });
});
