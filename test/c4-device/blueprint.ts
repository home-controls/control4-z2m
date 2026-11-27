/**
 * The committed c4_device blueprint, as Home Assistant loads it: its inputs
 * and their defaults, and the automation with every `!input` substituted.
 */

import fs from "node:fs";
import path from "node:path";

import {parseDocument} from "yaml";

export interface InputDeclaration {
    default: unknown;
    /** An entity selector: the entities it names exist in the world. */
    entity: boolean;
    /** A device selector's filter: the model_ids it offers. */
    models: string[];
    /** A time selector: it takes a time of day as cv.time reads it. */
    time: boolean;
}

export interface Blueprint {
    inputs: ReadonlyMap<string, InputDeclaration>;
    /** The automation (variables, condition, trigger, action) with `!input` placeholders. */
    automation: Record<string, unknown>;
}

const FILE = path.resolve(__dirname, "..", "..", "blueprints", "c4_device.yaml");

/** HA's !input tag for the yaml package: keep the referenced name, as {__input: name}. */
export const inputTag = {tag: "!input", resolve: (value: string) => ({__input: value}), identify: () => false};

let loaded: Blueprint | undefined;

export function c4DeviceBlueprint(): Blueprint {
    if (loaded) return loaded;
    const doc = parseDocument(fs.readFileSync(FILE, "utf8"), {customTags: [inputTag as never], uniqueKeys: true});
    if (doc.errors.length) throw new Error(`${FILE}: ${doc.errors.map((e) => e.message).join("; ")}`);
    const {blueprint, ...automation} = doc.toJS() as {blueprint: {input: Record<string, unknown>}} & Record<string, unknown>;
    const inputs = new Map<string, InputDeclaration>();
    const walk = (node: Record<string, unknown>) => {
        for (const [name, decl] of Object.entries(node)) {
            const d = decl as {
                input?: Record<string, unknown>;
                selector?: {entity?: unknown; device?: {filter?: {model_id?: string}[]}; time?: unknown};
                default?: unknown;
            };
            if (d.input && !d.selector) walk(d.input);
            else {
                const models = (d.selector?.device?.filter ?? []).flatMap((f) => (f.model_id ? [f.model_id] : []));
                inputs.set(name, {default: d.default, entity: !!d.selector && "entity" in d.selector, models, time: !!d.selector && "time" in d.selector});
            }
        }
    };
    walk(blueprint.input);
    loaded = {inputs, automation};
    return loaded;
}

/** A trigger's platform, written trigger: (as the automation editor writes it) or platform:. */
export function kindOf(trigger: Record<string, unknown>): unknown {
    if ("platform" in trigger && "trigger" in trigger)
        throw new Error(`c4-device: Home Assistant refuses a trigger with both platform: and trigger: (${JSON.stringify(trigger)})`);
    return trigger.platform ?? trigger.trigger;
}

/** `node` with each `!input` replaced by a copy of that input's value. */
export function substitute(node: unknown, inputs: Record<string, unknown>): unknown {
    if (Array.isArray(node)) return node.map((x) => substitute(x, inputs));
    if (node && typeof node === "object") {
        if ("__input" in node) {
            const name = (node as {__input: string}).__input;
            if (!(name in inputs)) throw new Error(`c4_device: no value for input ${name}`);
            return structuredClone(inputs[name]);
        }
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v, inputs)]));
    }
    return node;
}
