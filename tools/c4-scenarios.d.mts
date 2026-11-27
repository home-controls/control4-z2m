/** Types for tools/c4-scenarios.mjs (used by the tests). */
interface Timed {
    /** When to publish it, ms after the sequence's first event. */
    at: number;
    payload: Record<string, unknown>;
}
/** A control4_event the runner saw, and a target change it recorded (`from` / `to` as "on @128", "off"). */
interface Fired {
    t: number;
    data: Record<string, unknown>;
}
/** A Home Assistant state object, as the runner reads it. */
interface HaState {
    state: string;
    attributes?: Record<string, unknown>;
}
interface Change {
    t: number;
    entity_id: string;
    from: string;
    to: string;
    state?: HaState;
}
/** What the runner needs of one button of a c4_device automation's inputs. */
interface ButtonConfig {
    targets: string[];
    mode: string;
    /** It has a custom tap action. */
    custom: boolean;
    multi: boolean;
    multiActions: {double: unknown[]; triple: unknown[]; quad: unknown[]};
    response: string;
    hold: unknown;
    tapStep: number;
    dimFloor: number;
    /** A Scene button's Scene (sceneOf its Tap action); absent for other modes. */
    scene?: Record<string, SceneTarget>;
}
/** One entity of a Scene: its state and level of 255, null when the Scene gives none. */
interface SceneTarget {
    state: string | null;
    level: number | null;
}
/** A service call, as call_service takes it. */
interface ServiceCall {
    domain: string;
    service: string;
    service_data: Record<string, unknown>;
}
/** What observe() saw: the events, the target changes, and each target's state when it began. */
interface Observation {
    fired: Fired[];
    changes: Change[];
    startStates: Record<string, HaState>;
}
type Verdict = {ok: boolean; lines: string[]};
/** The known scenario's verdict on what a known double tap did to the button's targets. */
export function checkKnownTaps(cfg: Pick<ButtonConfig, "mode" | "targets"> & Partial<ButtonConfig>, obs: Observation): Verdict;
/** The double / triple scenarios' verdict on a known tap sequence of `taps` taps, given the button's action for that count. */
export function checkMultiTap(
    cfg: Pick<ButtonConfig, "mode" | "targets" | "custom" | "multi" | "response">,
    obs: Observation,
    taps: 2 | 3,
    action: unknown[],
): Verdict;
export function buttonConfig(input: Record<string, unknown>, button: number): ButtonConfig;
/** The service call that readies a button's targets for its mode, or undefined. */
export function prepareCall(cfg: Pick<ButtonConfig, "mode" | "targets">): ServiceCall | undefined;
/** The starts a scenario taps from: a label and the service calls that make it. */
export function starts(cfg: Pick<ButtonConfig, "mode" | "targets">): {label: string; calls: ServiceCall[]}[];
/** Whether a tap leaves the targets brighter (Direction toward ON). */
export function towardOn(cfg: Pick<ButtonConfig, "mode" | "custom">, anyOn: boolean): boolean;
/** The gesture the blueprint acts on for a known single tap. */
export function tapSource(cfg: Pick<ButtonConfig, "mode" | "custom" | "multi" | "response">, anyOn: boolean): string;
/** The entity ids an action list names. */
export function namedEntities(actions: unknown): string[];
/** The button's LED numbers. */
export function ledNumbers(input: Record<string, unknown>, button: number, model: string): string[];
/** The Scene in a Tap action that is one scene.apply: each entity's state and level; empty otherwise. */
export function sceneOf(actions: unknown[]): Record<string, SceneTarget>;
/** Whether the Tap action's Scene is Active, and whether it is misconfigured. */
export function sceneState(actions: unknown[], targets: string[], stateOf: (entity: string) => HaState | undefined): {active: boolean; bad: boolean};
/** Whether the button drives its device's own load (which a hold then ramps itself): c4_device's drives_load. */
export function drivesLoad(model: string, button: number, read?: {localSwitchOn?: boolean; behaviour?: {top?: string; bottom?: string}}): boolean;
/** The colour and brightness (null when it follows the lights) the button's LED shows. */
export function expectedLed(
    input: Record<string, unknown>,
    button: number,
    stateOf: (entity: string) => HaState | undefined,
    time: string,
): {color: string; brightness: number | null};
export function sequences(
    dev: {ieee: string; name: string; model: string},
    button: number,
    gap?: number,
): {tap: Timed[]; double: Timed[]; triple: Timed[]; unknownTap: Timed[]; hold: Timed[]};
