// One request and its answer over Home Assistant's websocket, as
// tools/ha-validate-blueprints.mjs makes them, and which render_template answers
// show a broken template.

/** What a call that Home Assistant never answers resolves to: a failed result, which every check counts. */
export const NO_ANSWER = "no answer within 15 s";

/**
 * Whether `msg` is the answer to the call that sent `payload`: a failed result
 * ends any call. render_template answers in events: a warning comes as one of
 * its own before the result, a render error as an ERROR event. Any other call
 * takes its first event or result.
 */
function answers(payload, msg) {
    if (msg.type === "result" && !msg.success) return true;
    if (payload.type === "render_template") return msg.type === "event" && ("result" in msg.event || msg.event.level === "ERROR");
    return msg.type === "event" || msg.type === "result";
}

/**
 * Calls over `send`, each with an id of its own, settled by its answer or, after
 * 15 s, by a failed NO_ANSWER result. `receive` hands each message to the call it
 * answers; a late answer finds none and is dropped.
 */
export function caller(send) {
    let id = 0;
    const pending = new Map();
    const call = (payload) =>
        new Promise((resolve) => {
            const n = ++id;
            const done = (msg) => {
                clearTimeout(timer);
                pending.delete(n);
                resolve(msg);
            };
            const timer = setTimeout(() => done({type: "result", success: false, error: {message: NO_ANSWER}}), 15_000);
            pending.set(n, (msg) => {
                if (answers(payload, msg)) done(msg);
            });
            send({...payload, id: n});
        });
    const receive = (msg) => pending.get(msg.id)?.(msg);
    return {call, receive};
}

/** A render_template answer that shows the template broken: a syntax error, or no answer at all. */
export function templateError(r) {
    const err = r.error?.message ?? (r.event?.error && r.event.level === "ERROR" ? r.event.error : undefined);
    return err && (err === NO_ANSWER || /syntax|unexpected|expected token|TemplateSyntaxError|unknown tag/i.test(err)) ? err : undefined;
}
