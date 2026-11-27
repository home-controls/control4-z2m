// Port the ZHA Control4 blueprints that talk to the remotes / LED engine to
// Zigbee2MQTT (control4-z2m), mechanically, so they can be regenerated when
// the ZHA originals change. The HA logic is untouched; only device I/O moves:
//
//   zha_event trigger / wait     -> event.received on the remote's Control4
//                                   events entity (ADR 0005), its command as
//                                   the remote's event type (remote_menu_select)
//   trigger.event.data.args.X    -> trigger.to_state.attributes.X (the event's
//                                   fields are the entity's attributes)
//   ZHA IEEE lookup              -> zigbee2mqtt_<ieee> from the HA identifiers
//   set_zigbee_cluster_attribute -> control4/<ieee>/set/<room_name|active_source|display_message>
//   issue_zigbee_cluster_command -> control4/<ieee>/set {"show_list": ...} / {"close_list": true}
//   zha_c4_patch.keypad_led_*    -> control4/request/led_*
//
// control4/... is the namespace every Zigbee2MQTT instance with the extension
// serves, so a blueprint reaches a device whichever coordinator it is on.
//
//   node tools/port-zha-blueprints.mjs <zha-blueprints-dir> [out-dir]
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const FILES = [
    "c4_sr250_room_display.yaml",
    "c4_sr250_now_playing.yaml",
    "c4_sr250_menu.yaml",
    "c4_sr250_color_menus.yaml",
    "c4_sr250_media_player.yaml",
    "c4_sr260_media_player.yaml",
    "c4_sr260_menu_dispatcher.yaml",
    "c4_kp_led_notify.yaml",
];

const IEEE_OF = (devVar) =>
    `{{ ((device_attr(${devVar}, 'identifiers') or []) | map('last') | select('search', '^zigbee2mqtt_0x')
        | first | default('')) | replace('zigbee2mqtt_', '') }}`;

const ATTRS = {0: "display_message", 2: "room_name", 3: "active_source"};

/**
 * The type a remote's event has on its Control4 events entity, as the
 * extension names it (remoteEventType in src/devices/remote.ts): its command,
 * with `remote_` in front unless it has it.
 */
export function remoteEventType(command) {
    return command.startsWith("remote_") ? command : `remote_${command}`;
}

/** The fields of the event that started the run; none on a manual run. */
const TRIGGER_FIELDS = "(trigger.to_state.attributes if trigger.to_state is defined else {})";

/** Said at the end of the description of a blueprint that hears the remote. */
export const EVENTS_NOTE = [
    'Hears the remote through its "Control4 events" entity, which the control4-z2m',
    "extension adds with Zigbee2MQTT's Home Assistant integration on: update the",
    "extension before this blueprint.",
];

const indentOf = (line) => line.length - line.trimStart().length;

/** The lines of the YAML block that starts at `i` (its own line plus deeper ones). */
function blockEnd(lines, i) {
    const ind = indentOf(lines[i]);
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || indentOf(lines[j]) > ind)) j++;
    while (j > i + 1 && lines[j - 1].trim() === "") j--;
    return j;
}

function fail(file, msg) {
    throw new Error(`${file}: ${msg}`);
}

/** Replace zha.set_zigbee_cluster_attribute / issue_zigbee_cluster_command steps. */
function portClusterCalls(lines, file) {
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)(- )?(?:action|service): zha\.(set_zigbee_cluster_attribute|issue_zigbee_cluster_command)\s*$/.exec(lines[i]);
        if (!m) continue;
        const keyInd = m[1] + (m[2] ? "  " : "");
        const head = m[1] + (m[2] ?? "");
        // The step = this line + the sibling `data:` block (same key indent).
        let j = i + 1;
        if (!lines[j] || lines[j].trim() !== "data:" || indentOf(lines[j]) !== keyInd.length) fail(file, `unexpected layout after line ${i + 1}`);
        const end = blockEnd(lines, j);
        const data = lines.slice(j + 1, end);
        const out = [];
        if (m[3] === "set_zigbee_cluster_attribute") {
            const attrLine = data.find((l) => /^\s*attribute:\s*\d+/.test(l));
            const attr = Number(/attribute:\s*(\d+)/.exec(attrLine ?? "")?.[1]);
            const name = ATTRS[attr];
            if (!name) fail(file, `unknown display attribute ${attr} at line ${i + 1}`);
            const vi = data.findIndex((l) => /^\s*value:/.test(l));
            if (vi < 0) fail(file, `attribute write without value at line ${i + 1}`);
            const vInd = indentOf(data[vi]);
            let vEnd = vi + 1;
            while (vEnd < data.length && (data[vEnd].trim() === "" || indentOf(data[vEnd]) > vInd)) vEnd++;
            out.push(`${head}action: mqtt.publish`, `${keyInd}data:`, `${keyInd}  topic: "control4/{{ c4_ieee }}/set/${name}"`);
            out.push(data[vi].replace("value:", "payload:"), ...data.slice(vi + 1, vEnd));
        } else {
            const cmdLine = data.find((l) => /^\s*command:\s*\d+/.test(l));
            const cmd = Number(/command:\s*(\d+)/.exec(cmdLine ?? "")?.[1]);
            out.push(`${head}action: mqtt.publish`, `${keyInd}data:`, `${keyInd}  topic: "control4/{{ c4_ieee }}/set"`);
            if (cmd === 1) {
                out.push(`${keyInd}  payload: '{"close_list": true}'`);
            } else if (cmd === 0) {
                const pi = data.findIndex((l) => /^\s*params:\s*$/.test(l));
                if (pi < 0) fail(file, `show_list without params at line ${i + 1}`);
                const pInd = indentOf(data[pi]);
                const fields = [];
                for (let k = pi + 1; k < data.length && indentOf(data[k]) > pInd; k++) {
                    const kInd = indentOf(data[k]);
                    const block = /^\s*(\w+):\s*>-?\s*$/.exec(data[k]);
                    if (block) {
                        // A folded scalar holding one {{ expression }} over several lines.
                        const parts = [];
                        while (k + 1 < data.length && indentOf(data[k + 1]) > kInd) parts.push(data[++k].trim());
                        const e = /^\{\{\s*([\s\S]+?)\s*\}\}$/.exec(parts.join(" "));
                        if (!e) fail(file, `show_list param ${block[1]} is not a single expression`);
                        fields.push(`'${block[1]}': (${e[1]})`);
                        continue;
                    }
                    const f = /^\s*(\w+):\s*"\{\{\s*(.+?)\s*\}\}"\s*(#.*)?$/.exec(data[k]);
                    if (!f) fail(file, `show_list param is not a single expression: ${data[k].trim()}`);
                    fields.push(`'${f[1]}': (${f[2].replace(/"/g, "'")})`);
                }
                out.push(`${keyInd}  payload: >-`, `${keyInd}    {{ {'show_list': {${fields.join(", ")}}} | to_json }}`);
            } else {
                fail(file, `unknown display command ${cmd} at line ${i + 1}`);
            }
        }
        lines.splice(i, end - i, ...out);
        i += out.length - 1;
    }
}

/**
 * zha_event triggers (top level) and waits (anywhere else): each hears the
 * device its event_data names, through that device's Control4 events entity.
 */
function portEvents(lines, file) {
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)- platform: event\s*$/.exec(lines[i]);
        if (!m || !/event_type: zha_event/.test(lines[i + 1] ?? "")) continue;
        const ind = m[1];
        const end = blockEnd(lines, i);
        const body = lines.slice(i + 1, end).map((l) => l.trim());
        const cmd = body.find((l) => l.startsWith("command:"))?.split(":")[1].trim();
        const id = body.find((l) => l.startsWith("id:"));
        const dev = /^device_id: (!input \w+)$/.exec(body.find((l) => l.startsWith("device_id:")) ?? "")?.[1];
        if (!cmd) fail(file, `zha_event without a command at line ${i + 1}`);
        if (!dev) fail(file, `zha_event without a device_id input at line ${i + 1}`);
        const out = [
            `${ind}- trigger: event.received`,
            `${ind}  target:`,
            `${ind}    device_id: ${dev}`,
            `${ind}  options:`,
            `${ind}    event_type:`,
            `${ind}      - ${remoteEventType(cmd)}`,
        ];
        if (id) out.push(`${ind}  ${id}`);
        lines.splice(i, end - i, ...out);
        i += out.length - 1;
        n++;
    }
    return n;
}

/** End the (folded) blueprint description with EVENTS_NOTE. */
function noteEvents(lines, file) {
    const i = lines.findIndex((l) => /^  description: >-?\s*$/.test(l));
    if (i < 0) fail(file, "no folded blueprint description");
    lines.splice(blockEnd(lines, i), 0, "", ...EVENTS_NOTE.map((l) => `    ${l}`));
}

/** Drop the old IEEE lookups; c4_ieee replaces them. */
function dropIeeeVars(lines) {
    for (let i = 0; i < lines.length; i++) {
        if (/^  remote_ieee: >-\s*$/.test(lines[i])) {
            const end = blockEnd(lines, i);
            lines.splice(i, end - i, "  remote_ieee: \"{{ c4_ieee }}\"");
        }
    }
}

/** text.replace that fails the port when the original no longer has what it replaces. */
function mustReplace(text, re, by, file) {
    if (!re.test(text)) fail(file, `nothing matching ${re}`);
    return text.replace(re, by);
}

function insertAfter(lines, re, add, file) {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) fail(file, `no line matching ${re}`);
    lines.splice(i + 1, 0, ...add);
}

export function port(text, file) {
    let s = text.replace(/\r\n/g, "\n");
    // Device selectors.
    s = s.replace(/integration: zha\b/g, "integration: mqtt").replace(/(\n\s*)model: (C4-SR2\d0B?)/g, "$1model_id: $2");
    // Event payloads: ZHA put arguments in args / params; the event carries them
    // flat, as the attributes of the Control4 events entity's new state.
    s = s
        .replace(/trigger\.event\.data if trigger\.event is defined else \{\}/g, "trigger.to_state.attributes if trigger.to_state is defined else {}")
        .replace(/wait\.trigger\.event\.data\.args/g, "wait.trigger.to_state.attributes")
        .replace(/trigger\.event\.data\.args/g, TRIGGER_FIELDS)
        .replace(/trigger\.event\.data/g, TRIGGER_FIELDS)
        .replace(/\bd\.args\b/g, "d")
        .replace(/\bd\.params\b/g, "d");
    // Descriptions.
    s = s
        .replace(/ZHA quirk \(control4_sr250\.py\)/g, "control4-z2m Zigbee2MQTT extension")
        .replace(/Requires the C4-SR250B control4-z2m Zigbee2MQTT extension with\s+C4SR250DisplayCluster on EP1\./g, "Requires the control4-z2m Zigbee2MQTT extension.")
        .replace(/the quirk's SR250 display cluster \(0xFC47,\s+attribute (\w+)\)/g, "the remote's $1 (control4-z2m)")
        .replace(/The quirk caches/g, "The extension caches")
        .replace(/the quirk caches/g, "the extension caches")
        .replace(/The quirk puts/g, "The extension puts")
        .replace(/the quirk closes/g, "the extension closes");
    s = s.replace(/^(  name: .+?)\s*$/m, "$1 (Zigbee2MQTT)");
    // Latent bugs in the ZHA originals: an unset optional input must still
    // validate. A target selector defaults to {} (not []), and the optional
    // room helper of the room display is a state-trigger entity, so it
    // defaults to [] (an empty list is a valid, inert trigger; "" is not).
    s = s.replace(/(\n(\s+)default: )\[\](\n\2selector:\n\2  target:)/g, "$1{}$3");
    if (file === "c4_sr250_room_display.yaml") s = s.replace(/(\n    room_helper:[\s\S]*?\n      default: )""/, "$1[]");
    // Mute only a volume target that can mute: HA refuses media_player.volume_mute on one
    // without MediaPlayerEntityFeature.VOLUME_MUTE (8), an Apple TV for one, and each press
    // of the key then ends the run in an error.
    if (file === "c4_sr260_media_player.yaml") {
        s = mustReplace(
            s,
            /\n(\s+)- conditions: "\{\{ button == 'volume_mute' \}\}"\n/,
            (_m, ind) =>
                `\n${ind}- conditions:\n${ind}    - "{{ button == 'volume_mute' }}"\n${ind}    # A player without mute (feature 8) gets nothing: HA refuses volume_mute on it.\n${ind}    - "{{ ((state_attr(volume_target, 'supported_features') | int(0)) // 8) % 2 == 1 }}"\n`,
            file,
        );
    }
    // A press of the show key while the menu is up shows it again at once. Queued, that
    // press waited behind the open menu and showed it a second time after the pick.
    if (file === "c4_sr260_menu_dispatcher.yaml") {
        s = mustReplace(s, /\nmode: queued\nmax: 5\n/, "\nmode: restart\n", file);
        s = mustReplace(
            s,
            /instead of blocking until selection_timeout — otherwise the\n(\s+)# {4}next show-trigger press would queue behind a stuck run for up\n\s+# {4}to selection_timeout seconds\./,
            "instead of blocking until selection_timeout (a show-trigger\n$1#    press meanwhile restarts the run and shows the menu afresh).",
            file,
        );
    }

    const lines = s.split("\n");
    // The device input the blueprint addresses (remote, sr260_device ...).
    const devInput = /device_id: !input (\w+)/.exec(s)?.[1] ?? (/!input remote\b/.test(s) ? "remote" : undefined);

    const events = portEvents(lines, file);
    if (events) noteEvents(lines, file);
    portClusterCalls(lines, file);
    dropIeeeVars(lines);

    // The IEEE, for the blueprints that publish to the device: the events need none.
    const vars = [];
    if (devInput && lines.some((l) => /\bc4_ieee\b/.test(l))) vars.push(`  c4_dev: !input ${devInput}`, `  c4_ieee: >-\n    ${IEEE_OF("c4_dev")}`);
    insertAfter(lines, /^variables:\s*$/, vars, file);
    let out = lines.join("\n");

    // The LED notification blueprint: several keypads at once -> the bridge request.
    if (/zha_c4_patch\.keypad_led/.test(out)) {
        // After `kps:` - HA renders variables in order.
        out = out.replace(
            /^(  kps: !input \w+)\n/m,
            `$1\n  kp_ieees: >-\n    {% set ns = namespace(l=[]) %}\n    {% for d in (kps if kps is list else [kps]) %}\n      {% set i = ((device_attr(d, 'identifiers') or []) | map('last') | select('search', '^zigbee2mqtt_0x') | first | default('')) | replace('zigbee2mqtt_', '') %}\n      {% if i %}{% set ns.l = ns.l + [i] %}{% endif %}\n    {% endfor %}\n    {{ ns.l }}\n`,
        );
        out = out.replace(
            /^(\s*)- action: zha_c4_patch\.keypad_led_effect\n\1  data: "\{\{ payload \}\}"/gm,
            (_m, ind) =>
                `${ind}- if: "{{ kp_ieees | count > 0 }}"\n${ind}  then:\n${ind}    - action: mqtt.publish\n${ind}      data:\n${ind}        topic: control4/request/led_effect\n${ind}        payload: "{{ dict(payload, devices=kp_ieees) | to_json }}"`,
        );
        out = out.replace(
            /^(\s*)- action: zha_c4_patch\.keypad_led_stop\n\1  data:\n\1    device_id: "\{\{ kps \}\}"\n\1    restore: true/gm,
            (_m, ind) =>
                `${ind}- if: "{{ kp_ieees | count > 0 }}"\n${ind}  then:\n${ind}    - action: mqtt.publish\n${ind}      data:\n${ind}        topic: control4/request/led_stop\n${ind}        payload: "{{ {'devices': kp_ieees, 'restore': true} | to_json }}"`,
        );
    }

    // What is left is prose in comments.
    out = out
        .replace(/zha\.set_zigbee_cluster_attribute/g, "the control4/<ieee>/set topic")
        .replace(/zha\.issue_zigbee_cluster_command/g, "the control4/<ieee>/set topic")
        .replace(/Writing cluster 0xFC47\n(\s*)# \(=64583\) attribute 0 via/g, "Publishing display_message\n$1# via")
        .replace(/\bzha_events?\b/g, "Control4 event")
        .replace(/ZHA quirk/g, "control4-z2m extension")
        .replace(/before ZHA has loaded the remote/g, "before the remote is known")
        .replace(/Wait until ZHA has it\./g, "Wait until it is.")
        .replace(/# ZHA stores the IEEE[^\n]*\n(\s*#[^\n]*\n)*/g, "# The IEEE comes from the zigbee2mqtt_<ieee> identifier (c4_ieee).\n");
    for (const bad of ["zha_event", "zha.", "integration: zha", "zha_c4_patch", "trigger.event.data"]) {
        if (out.includes(bad)) fail(file, `still contains '${bad}'`);
    }
    return {text: out, events};
}

function main() {
    const [src, outArg] = process.argv.slice(2);
    if (!src) {
        console.error("usage: node tools/port-zha-blueprints.mjs <zha-blueprints-dir> [out-dir]");
        process.exit(2);
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const outDir = outArg ?? path.join(root, "blueprints");
    fs.mkdirSync(outDir, {recursive: true});
    for (const f of FILES) {
        const p = path.join(src, f);
        if (!fs.existsSync(p)) {
            console.log(`skip ${f} (not found)`);
            continue;
        }
        const {text, events} = port(fs.readFileSync(p, "utf8"), f);
        fs.writeFileSync(path.join(outDir, f), text, "utf8");
        console.log(`wrote ${f} (${events} event triggers ported)`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();