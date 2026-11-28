/**
 * Wire-format helpers: the Control4 ASCII line protocol, the small slice of ZCL
 * the network profile uses, and colour arithmetic for the LEDs.
 */

import {C4_CLUSTER, PROFILE_BUTTON, PROFILE_NETWORK, PROFILE_OUTLET} from "./constants";

// ---------------------------------------------------------------------------
// ASCII frames
// ---------------------------------------------------------------------------

/** `0s<seq> c4.dmx.led 00 03 ff0000` + CRLF, latin-1 so glyph bytes pass through. */
export function buildFrame(text: string): Buffer {
    return Buffer.from(`${text}\r\n`, "latin1");
}

export function hex4(n: number): string {
    return (n & 0xffff).toString(16).padStart(4, "0");
}

export function hex2(n: number): string {
    return (n & 0xff).toString(16).padStart(2, "0");
}

/** Strip a value of the three characters that would break framing / quoting. */
export function sanitize(text: unknown): string {
    return String(text ?? "")
        .replace(/[\r\n]/g, " ")
        .replace(/"/g, "");
}

const APP_HEADER_PROFILES = [PROFILE_NETWORK, PROFILE_BUTTON, PROFILE_OUTLET].map((p) => [p & 0xff, p >> 8]);

/** Some frames carry an 8-byte C4 application header (profile LE at bytes 4-5). */
export function stripAppHeader(data: Buffer): Buffer {
    if (data.length >= 8) {
        for (const [lo, hi] of APP_HEADER_PROFILES) {
            if (data[4] === lo && data[5] === hi) return data.subarray(8);
        }
    }
    return data;
}

export type FrameKind = "announce" | "reply" | "set" | "get" | "init" | "other";

export interface ParsedFrame {
    text: string;
    tokens: string[];
    kind: FrameKind;
    /** The 4-hex sequence after the 2-char prefix (lower case), or "". */
    seq: string;
}

export function parseFrame(data: Buffer): ParsedFrame {
    // A frame's text ends at its first NUL, as a C string does: the Gen3 board pads some
    // replies with NULs and stray bytes after the value (`0r0042 000 c4.sy.fwv 4.4.16 \0\0\0`).
    const raw = stripAppHeader(data).toString("latin1");
    const nul = raw.indexOf("\0");
    const text = (nul >= 0 ? raw.slice(0, nul) : raw).trim();
    const tokens = tokenize(text);
    const head = tokens[0] ?? "";
    const prefix = head.slice(0, 2);
    const kind: FrameKind =
        prefix === "0t" ? "announce" : prefix === "0r" ? "reply" : prefix === "0s" ? "set" : prefix === "0g" ? "get" : prefix === "0i" ? "init" : "other";
    return {text, tokens, kind, seq: head.slice(2, 6).toLowerCase()};
}

/**
 * Split on whitespace, keeping a double-quoted argument (which may contain
 * spaces) as one token with its quotes.
 */
export function tokenize(text: string): string[] {
    const out: string[] = [];
    const re = /"[^"]*"|\S+/g;
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
        out.push(m[0]);
        m = re.exec(text);
    }
    return out;
}

/** The last value of a Get's reply (a reply may echo the Get's arguments first). */
export function lastValue(values: string[]): string | undefined {
    return values[values.length - 1];
}

export function parseHex(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const n = Number.parseInt(value, 16);
    return Number.isNaN(n) ? undefined : n;
}

/** Map a Control4 0-100 load level to Z2M brightness 0-254 (>= 99 % is full). */
export function pctToBrightness(pct: number): number {
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    if (pct >= 99) return 254;
    return Math.round((pct * 254) / 100);
}

// ---------------------------------------------------------------------------
// ZCL (network / outlet profile)
// ---------------------------------------------------------------------------

export interface ZclHeader {
    frameControl: number;
    manufacturerCode?: number;
    tsn: number;
    commandId: number;
    /** Offset of the payload in the frame. */
    offset: number;
}

export function parseZclHeader(data: Buffer): ZclHeader | undefined {
    if (data.length < 3) return undefined;
    const fc = data[0];
    let i = 1;
    let manufacturerCode: number | undefined;
    if (fc & 0x04) {
        if (data.length < 5) return undefined;
        manufacturerCode = data.readUInt16LE(1);
        i = 3;
    }
    return {frameControl: fc, manufacturerCode, tsn: data[i], commandId: data[i + 1], offset: i + 2};
}

// biome-ignore format: a byte-size table, kept in rows by type
const FIXED_SIZES: Record<number, number> = {
    0x08: 1, 0x09: 2, 0x0a: 3, 0x0b: 4,
    0x10: 1, 0x18: 1, 0x19: 2, 0x1a: 3, 0x1b: 4,
    0x20: 1, 0x21: 2, 0x22: 3, 0x23: 4, 0x24: 5, 0x25: 6, 0x26: 7, 0x27: 8,
    0x28: 1, 0x29: 2, 0x2a: 3, 0x2b: 4,
    0x30: 1, 0x31: 2,
    0x39: 4, 0xe2: 4, 0xe8: 2, 0xe9: 2, 0xea: 4, 0xf0: 8,
};

export type ZclValue = number | string | boolean | Buffer;

function readValue(type: number, buf: Buffer, i: number): [ZclValue, number] | undefined {
    if (type === 0x41 || type === 0x42) {
        if (i >= buf.length) return undefined;
        const len = buf[i];
        if (len === 0xff) return [type === 0x42 ? "" : Buffer.alloc(0), i + 1];
        const end = i + 1 + len;
        if (end > buf.length) return undefined;
        const raw = buf.subarray(i + 1, end);
        return [type === 0x42 ? raw.toString("latin1") : Buffer.from(raw), end];
    }
    const size = FIXED_SIZES[type];
    if (size === undefined || i + size > buf.length) return undefined;
    const raw = buf.subarray(i, i + size);
    let value: ZclValue;
    if (type === 0x10) value = raw[0] !== 0;
    else if (type === 0xf0) value = Buffer.from(raw);
    else if (type >= 0x28 && type <= 0x2b) value = raw.readIntLE(0, size);
    else if (size <= 6) value = raw.readUIntLE(0, size);
    else value = Buffer.from(raw);
    return [value, i + size];
}

/** Records of a Report Attributes (0x0a) payload. Stops at the first unknown type. */
export function parseReportAttributes(payload: Buffer): Map<number, ZclValue> {
    const out = new Map<number, ZclValue>();
    let i = 0;
    while (i + 3 <= payload.length) {
        const id = payload.readUInt16LE(i);
        const type = payload[i + 2];
        const r = readValue(type, payload, i + 3);
        if (!r) break;
        out.set(id, r[0]);
        i = r[1];
    }
    return out;
}

/** Records of a Read Attributes Response (0x01) payload (successful ones only). */
export function parseReadAttributesResponse(payload: Buffer): Map<number, ZclValue> {
    const out = new Map<number, ZclValue>();
    let i = 0;
    while (i + 3 <= payload.length) {
        const id = payload.readUInt16LE(i);
        const status = payload[i + 2];
        i += 3;
        if (status !== 0) continue;
        if (i >= payload.length) break;
        const type = payload[i];
        const r = readValue(type, payload, i + 1);
        if (!r) break;
        out.set(id, r[0]);
        i = r[1];
    }
    return out;
}

/** `0x00124b0024c0dc0d` -> 8 bytes little-endian. */
export function ieeeToBytesLE(ieee: string): Buffer {
    const hex = ieee
        .toLowerCase()
        .replace(/^0x/, "")
        .replace(/[^0-9a-f]/g, "")
        .padStart(16, "0");
    return Buffer.from(hex, "hex").reverse();
}

/** Attribute ids asked for by a Read Attributes (0x00) payload. */
export function parseReadAttributes(payload: Buffer): number[] {
    const ids: number[] = [];
    for (let i = 0; i + 2 <= payload.length; i += 2) ids.push(payload.readUInt16LE(i));
    return ids;
}

/** The controller identity's attributes: 0x0008, 0x0009 (coordinator EUI64) and 0x000A. */
export const IDENTITY_ATTRS: readonly number[] = [0x0008, 0x0009, 0x000a];

/**
 * The controller-identity frame: attrs 0x0008 (uint16 0), 0x0009 (coordinator
 * EUI64) and 0x000A (uint8 2), as a Report Attributes (default), or as the Read
 * Attributes Response to a device's own read of `readAttrs` (with its TSN). A read
 * answers each attribute it asked for, in its order: one of the three with its value,
 * any other as unsupported (0x86). An SR260 reads 0x000C and 0x0001 from its
 * controller, and answering those with the identity makes it re-join over and over.
 */
export function buildIdentityFrame(coordinatorIeee: string, tsn: number, readAttrs?: readonly number[]): Buffer {
    const values = new Map<number, Buffer>([
        [0x0008, Buffer.from([0x21, 0x00, 0x00])],
        [0x0009, Buffer.concat([Buffer.from([0xf0]), ieeeToBytesLE(coordinatorIeee)])],
        [0x000a, Buffer.from([0x20, 0x02])],
    ]);
    const parts: Buffer[] = [Buffer.from([0x08, tsn & 0xff, readAttrs ? 0x01 : 0x0a])];
    for (const id of readAttrs ?? IDENTITY_ATTRS) {
        const value = values.get(id);
        const status = readAttrs ? [value ? 0x00 : 0x86] : [];
        parts.push(Buffer.from([id & 0xff, (id >> 8) & 0xff, ...status]));
        if (value) parts.push(value);
    }
    return Buffer.concat(parts);
}

/** A cluster-specific ZCL command with default response disabled. */
export function buildZclCommand(tsn: number, commandId: number, payload: number[] = []): Buffer {
    return Buffer.from([0x11, tsn & 0xff, commandId & 0xff, ...payload]);
}

export const CLUSTER_ON_OFF = 0x0006;
export const CLUSTER_LEVEL = 0x0008;

export function moveToLevelWithOnOff(tsn: number, level: number, transitionTenths: number): Buffer {
    const t = Math.max(0, Math.min(0xffff, Math.round(transitionTenths)));
    return buildZclCommand(tsn, 0x04, [Math.max(0, Math.min(254, Math.round(level))), t & 0xff, t >> 8]);
}

export {C4_CLUSTER};

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type Rgb = [number, number, number];

export function rgbHex(rgb: Rgb): string {
    return rgb
        .map((c) =>
            Math.max(0, Math.min(255, Math.round(c)))
                .toString(16)
                .padStart(2, "0"),
        )
        .join("");
}

export function hexRgb(hex: string): Rgb {
    const n = Number.parseInt(hex, 16) || 0;
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Scale a colour to pct (1-100). A lit channel never rounds to 0. */
export function scaleHex(hex: string, pct: number): string {
    const p = Math.max(1, Math.min(100, Math.trunc(pct)));
    if (p === 100) return hex;
    return rgbHex(hexRgb(hex).map((c) => (c ? Math.max(1, Math.floor((c * p) / 100)) : 0)) as Rgb);
}

/** Scale an rgb by 0-100 (0 = black, a lit channel stays >= 1 above 0). */
export function scaleRgb(rgb: Rgb, pct: number): Rgb {
    const p = Math.max(0, Math.min(100, Math.trunc(pct)));
    if (p === 100) return rgb;
    if (p === 0) return [0, 0, 0];
    return rgb.map((c) => {
        const v = Math.round((c * p) / 100);
        return c > 0 && v === 0 ? 1 : v;
    }) as Rgb;
}

export function blendRgb(a: Rgb, b: Rgb, f: number): Rgb {
    const t = Math.max(0, Math.min(1, f));
    return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

export function blendHex(a: string, b: string, f: number): string {
    return rgbHex(blendRgb(hexRgb(a), hexRgb(b), f));
}

/** Full-saturation colour at hue 0-1. */
export function hueRgb(hue: number, brightness = 100): Rgb {
    const h = (((hue % 1) + 1) % 1) * 6;
    const i = Math.floor(h);
    const f = h - i;
    const q = 1 - f;
    const table: [number, number, number][] = [
        [1, f, 0],
        [q, 1, 0],
        [0, 1, f],
        [0, q, 1],
        [f, 0, 1],
        [1, 0, q],
    ];
    const [r, g, b] = table[i % 6];
    return scaleRgb([Math.trunc(r * 255), Math.trunc(g * 255), Math.trunc(b * 255)], brightness);
}
