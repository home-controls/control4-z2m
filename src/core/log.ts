/** Minimal logger interface (Z2M's logger, or a test double). */
export interface Logger {
    debug(message: string): void;
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
}

export const NS = "z2m:control4";

/** Adapt Z2M's logger (`(message, namespace)`) to the interface above. */
// biome-ignore lint/suspicious/noExplicitAny: Z2M logger shape
export function wrapZ2mLogger(logger: any): Logger {
    const call = (level: string, message: string) => {
        const fn = logger?.[level] ?? logger?.[level === "warning" ? "warn" : level];
        if (typeof fn === "function") fn.call(logger, message, NS);
    };
    return {
        debug: (m) => call("debug", m),
        info: (m) => call("info", m),
        warning: (m) => call("warning", m),
        error: (m) => call("error", m),
    };
}

export const silentLogger: Logger = {debug() {}, info() {}, warning() {}, error() {}};
