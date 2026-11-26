// How tools/ha-validate-blueprints.mjs waits for Home Assistant's answer to each
// websocket call, and which render_template answers it counts as a broken template.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {caller, NO_ANSWER, templateError} from "../tools/ha-calls.mjs";

describe("a call to Home Assistant", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const open = () => {
        const sent: Record<string, unknown>[] = [];
        return {sent, ...caller((msg) => sent.push(msg))};
    };

    it("sends its payload with an id of its own", () => {
        const ha = open();
        void ha.call({type: "validate_config", actions: []});
        void ha.call({type: "render_template", template: "{{ 1 }}"});
        expect(ha.sent).toEqual([
            {type: "validate_config", actions: [], id: 1},
            {type: "render_template", template: "{{ 1 }}", id: 2},
        ]);
    });

    it("of render_template waits past its subscription's result and a warning event, for the event with the result", async () => {
        const ha = open();
        const answer = ha.call({type: "render_template", template: "{{ x }}"});
        ha.receive({id: 1, type: "result", success: true, result: null});
        ha.receive({id: 1, type: "event", event: {level: "WARNING", error: "'x' is undefined"}});
        ha.receive({id: 1, type: "event", event: {result: "", listeners: {}}});
        await expect(answer).resolves.toEqual({id: 1, type: "event", event: {result: "", listeners: {}}});
    });

    it("of render_template ends on an ERROR event, and any call on a failed result", async () => {
        const ha = open();
        const broken = ha.call({type: "render_template", template: "{{"});
        ha.receive({id: 1, type: "event", event: {level: "ERROR", error: "unexpected end of template"}});
        await expect(broken).resolves.toMatchObject({event: {level: "ERROR"}});
        const refused = ha.call({type: "render_template", template: "{{ 1 }}"});
        ha.receive({id: 2, type: "result", success: false, error: {message: "Unknown command."}});
        await expect(refused).resolves.toMatchObject({success: false});
    });

    it("of anything else takes its first result or event", async () => {
        const ha = open();
        const answer = ha.call({type: "validate_config", actions: []});
        ha.receive({id: 1, type: "result", success: true, result: {actions: {valid: true}}});
        await expect(answer).resolves.toMatchObject({result: {actions: {valid: true}}});
        const subscribed = ha.call({type: "subscribe_trigger", trigger: {}});
        ha.receive({id: 2, type: "event", event: {variables: {}}});
        ha.receive({id: 2, type: "result", success: true, result: null});
        await expect(subscribed).resolves.toMatchObject({type: "event"});
    });

    it("that no answer reaches fails after 15 s with no answer", async () => {
        const ha = open();
        const answer = ha.call({type: "render_template", template: "{{ 1 }}"});
        await vi.advanceTimersByTimeAsync(14_999);
        let settled = false;
        void answer.then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(answer).resolves.toEqual({type: "result", success: false, error: {message: NO_ANSWER}});
    });

    it("hands an answer only to the call it answers", async () => {
        const ha = open();
        const first = ha.call({type: "validate_config", actions: []});
        const second = ha.call({type: "validate_config", actions: []});
        ha.receive({id: 2, type: "result", success: true, result: "two"});
        ha.receive({id: 1, type: "result", success: true, result: "one"});
        await expect(Promise.all([first, second])).resolves.toMatchObject([{result: "one"}, {result: "two"}]);
    });
});

describe("a broken template, by its render_template answer", () => {
    it("is a syntax error, as a failed result or an ERROR event, or no answer at all", () => {
        expect(templateError({type: "result", success: false, error: {message: "TemplateSyntaxError: unexpected '}'"}})).toMatch(/unexpected/);
        expect(templateError({type: "event", event: {level: "ERROR", error: "expected token 'end of print statement'"}})).toMatch(/expected token/);
        expect(templateError({type: "result", success: false, error: {message: NO_ANSWER}})).toBe(NO_ANSWER);
    });

    it("is not an error at run time, a warning, or a result", () => {
        expect(templateError({type: "event", event: {level: "ERROR", error: "ZeroDivisionError: division by zero"}})).toBeUndefined();
        expect(templateError({type: "event", event: {level: "WARNING", error: "unexpected thing, but a warning"}})).toBeUndefined();
        expect(templateError({type: "event", event: {result: "ok"}})).toBeUndefined();
    });
});
