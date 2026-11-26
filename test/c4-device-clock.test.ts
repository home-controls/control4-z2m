// The time of day test/c4-device/clock.ts keeps for c4_device's runs: the time
// and time_pattern triggers that fire at it, and the clock a delay moves on.
import {describe, expect, it} from "vitest";

import {fires, later} from "./c4-device/clock";

describe("a time trigger", () => {
    it("fires at its time of day, as cv.time reads it (dt_util.parse_time): H:M or H:M:S, each an int, second 0 when left out", () => {
        const at = (when: string, time: string) => fires({platform: "time", at: when, id: "led"}, time);
        expect([at("21:00:00", "21:00:00"), at("21:00:00", "21:00:01"), at("21:03", "21:03:00"), at("21:03", "21:03:01")]).toEqual([true, false, true, false]);
        expect([at("9:03", "09:03:00"), at("9:3", "09:03:00"), at("9:03:7", "09:03:07"), at(" 9:03", "09:03:00")]).toEqual([true, true, true, true]);
        expect([at("+9:03", "09:03:00"), at("9:03 ", "09:03:00"), at("9:03:59", "09:03:59")]).toEqual([true, true, true]);
    });

    it("is written with trigger: as the automation editor writes it, or platform:, not both", () => {
        expect(fires({trigger: "time", at: "21:00:00", id: "led"}, "21:00:00")).toBe(true);
        expect(fires({trigger: "time_pattern", minutes: "/5", id: "led"}, "12:05:00")).toBe(true);
        expect(() => fires({platform: "time", trigger: "time", at: "21:00:00"}, "21:00:00")).toThrow(/Home Assistant refuses a trigger with both platform: and trigger:/);
    });

    it("is refused at anything else, or with keys beyond its time", () => {
        for (const trigger of [
            {platform: "time", at: "9"},
            {platform: "time", at: "24:00"},
            {platform: "time", at: "9:60"},
            {platform: "time", at: "9:03:60"},
            {platform: "time", at: "-1:00"},
            // Python's int() takes no U+FEFF, so Home Assistant refuses this one.
            {platform: "time", at: "﻿9:03"},
            // parse_time ignores a fourth part; the harness does not model it.
            {platform: "time", at: "21:00:00:00"},
            {platform: "time", at: "21:00:00.5"},
            {platform: "time", at: "input_datetime.night"},
            {platform: "time", at: ["21:00:00"]},
            {platform: "time", at: "21:00:00", weekday: ["mon"]},
        ]) {
            expect(() => fires(trigger, "21:00:00"), JSON.stringify(trigger)).toThrow(/not modelled/);
        }
    });
});

describe("a time pattern", () => {
    it("fires at second 0 of every n-th minute", () => {
        const every5 = {platform: "time_pattern", minutes: "/5", id: "led"};
        expect(["12:05:00", "12:05:01", "12:06:00", "00:00:00"].map((t) => fires(every5, t))).toEqual([true, false, false, true]);
    });

    it("fires at second 0 of its minute of every hour, written as a minute", () => {
        const hourly = {platform: "time_pattern", minutes: "0", id: "led"};
        expect(["13:00:00", "13:00:01", "13:30:00", "00:00:00"].map((t) => fires(hourly, t))).toEqual([true, false, false, true]);
        expect(["12:05:00", "12:06:00"].map((t) => fires({platform: "time_pattern", minutes: 5}, t))).toEqual([true, false]);
    });

    it("is refused with anything but its minutes, or at a minute Home Assistant refuses or it does not model", () => {
        for (const trigger of [
            {platform: "time_pattern", minutes: "60"},
            {platform: "time_pattern", minutes: "*"},
            {platform: "time_pattern", minutes: "/5", seconds: "/30"},
            {platform: "time_pattern", minutes: "/5", hours: "/2"},
        ]) {
            expect(() => fires(trigger, "12:05:00"), JSON.stringify(trigger)).toThrow(/not modelled/);
        }
    });
});

describe("another trigger", () => {
    it("never fires on the clock", () => {
        expect(fires({platform: "homeassistant", event: "start"}, "12:00:00")).toBe(false);
    });
});

describe("the clock a delay moves on", () => {
    it("shows whole seconds, past midnight the next day's", () => {
        expect([later("20:59:58", 3), later("20:59:59", 0.3), later("23:59:00", 90), later("12:00:00", 0)]).toEqual(["21:00:01", "20:59:59", "00:00:30", "12:00:00"]);
    });
});
