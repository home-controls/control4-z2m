export type ButtonNumber = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * What a run does: nothing; a button's single tap; an early commit (ADR 0002),
 * the run of a sequence's first known tap that owns its single tap, which taps
 * at once toward ON and waits for the fast count toward OFF (Direction decides,
 * in the actions); a hold it owns if one comes; a multi-tap action, by its Tap
 * count; or the LEDs.
 */
export type Does = "nothing" | "tap" | "early commit" | "hold" | "double" | "triple" | "quadruple" | "leds";

export interface Run {
    /** The top-level condition passed. */
    passes: boolean;
    /** "nothing" unless it passes. */
    does: Does;
    /** The blueprint's trigger id for it (`tid`): known, fast_tap, fast_double, tap, press, hold, led, led_bri, boot, reload, ... */
    trigger: string;
    /** The Button number (`bi` + 1); null for a run that is not a button's. */
    button: ButtonNumber | null;
    /** `tgt`: the button's targets, or the whole room for the Room modes. */
    targets: string[];
    /** Every top-level variable under its blueprint name, typed as Home Assistant holds it. */
    variables: Readonly<Record<string, unknown>>;
}

export function readRun(variables: Record<string, unknown>, passes: boolean): Run;

/** One led_status call an LED run sends: the LEDs it names (button names or LED numbers, comma-separated) and their look. */
export interface LedCall {
    buttons: string;
    color: string;
    brightness: number;
    pressed_color?: string;
    pressed_brightness?: number;
}
export type LedLook = Omit<LedCall, "buttons">;

/** A run as Home Assistant traced it: the decision, plus what the run did and how it ended. */
export interface TracedRun extends Run {
    /** The led_status calls it sent; [] when none. */
    leds: LedCall[];
    /** Boot / reload only: whether the device has a Control4 events entity, so the automation hears its buttons. */
    hears?: boolean;
    /** The error the run stopped on, if it did. */
    error?: string;
    /** Still running when the trace was read (an early commit waiting for its count, a hold ramp). */
    running: boolean;
}

/**
 * A `trace/get` result (or a saved trace's extended_dict) read as a run. Throws when the trace has no trigger step,
 * or when a passing run's variables say two things at once (as readRun does).
 */
export function readTrace(trace: unknown): TracedRun;

/** The look one LED gets from a run's calls, by its name ("button_3") or number ("5"); undefined when no call names it. */
export function ledLook(calls: LedCall[], name: string): LedLook | undefined;
