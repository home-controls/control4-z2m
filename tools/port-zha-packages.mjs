// Port the ZHA Control4 HA script packages (ha-config/packages) that drive the
// quirks' manufacturer clusters to Zigbee2MQTT (control4-z2m). Each
// zha.issue_zigbee_cluster_command step becomes an MQTT publish of the same
// command, by its ZHA name, to control4/<ieee>/set (served by whichever
// Zigbee2MQTT instance has the device) - the extension accepts every
// LED-cluster (0xFC43) and ramp-cluster (0xFC44) command under that name:
//
//   - service: zha.issue_zigbee_cluster_command      - variables:
//     data:                                              c4_params: {<params>}
//       cluster_id: 64579                       ->     - action: mqtt.publish
//       command: 0                                       data: {topic: control4/<ieee>/set,
//       params: {<params>}                                      payload: {"set_led_color": c4_params}}
//
// control4_keypad_led.yaml and control4_keypad_identify.yaml use the ZHA
// LED-engine services / zha_event and are kept as hand-written ports in
// packages/; only the cluster-command packages are generated.
//
//   node tools/port-zha-packages.mjs <zha-packages-dir> [out-dir]
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const FILES = ["control4_led_scripts.yaml", "control4_dimmer_scripts.yaml"];

/** cluster id -> command id -> the extension's /set key (the ZHA command name). */
export const COMMANDS = {
    64579: {0: "set_led_color", 1: "set_led_mode", 2: "set_led_all_same_color", 3: "set_all_led_modes", 4: "set_led_single_on", 16: "send_raw", 17: "send_get"},
    64580: {0: "set_ramp_rate", 1: "set_on_ramp", 2: "set_off_ramp", 3: "set_on_off_ramps"},
};

const IEEE_OF = (devVar) =>
    `{{ ((device_attr(${devVar}, 'identifiers') or []) | map('last') | select('search', '^zigbee2mqtt_0x') | first | default('')) | replace('zigbee2mqtt_', '') }}`;

const indentOf = (line) => line.length - line.trimStart().length;

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

function portCalls(lines, file) {
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)- (?:action|service): zha\.issue_zigbee_cluster_command\s*$/.exec(lines[i]);
        if (!m) continue;
        const ind = m[1];
        const d = i + 1;
        if (lines[d]?.trim() !== "data:" || indentOf(lines[d]) !== ind.length + 2) fail(file, `unexpected layout after line ${i + 1}`);
        const end = blockEnd(lines, d);
        const body = lines.slice(d + 1, end);
        const field = (k) => body.find((l) => indentOf(l) === ind.length + 4 && l.trim().startsWith(`${k}:`))?.trim().slice(k.length + 1).trim();
        const cluster = Number(field("cluster_id"));
        const command = Number(field("command"));
        const key = COMMANDS[cluster]?.[command];
        if (!key) fail(file, `line ${i + 1}: no mapping for cluster ${cluster} command ${command}`);
        if (field("ieee") !== '"{{ ieee }}"') fail(file, `line ${i + 1}: unexpected ieee ${field("ieee")}`);
        const pi = body.findIndex((l) => indentOf(l) === ind.length + 4 && l.trim() === "params:");
        if (pi < 0) fail(file, `line ${i + 1}: no params block`);
        const pEnd = blockEnd(body, pi);
        // params entries sit at the same depth under `c4_params:` as they did under `params:`.
        const params = body.slice(pi + 1, pEnd);
        const out = [
            `${ind}- variables:`,
            `${ind}    c4_params:`,
            ...params,
            `${ind}- action: mqtt.publish`,
            `${ind}  data:`,
            `${ind}    topic: "control4/{{ ieee }}/set"`,
            `${ind}    payload: "{{ {'${key}': c4_params} | to_json }}"`,
        ];
        lines.splice(i, end - i, ...out);
        i += out.length - 1;
        n++;
    }
    return n;
}

export function port(text, file) {
    let s = text.replace(/\r\n/g, "\n");
    s = s.replace(/integration: zha\b/g, "integration: mqtt").replace(/Select a ZHA Control4/g, "Select a Zigbee2MQTT Control4");
    // The IEEE: ZHA's (identifiers | list)[0][1] -> the zigbee2mqtt_<ieee> identifier.
    s = s.replace(/\{\{ \(device_attr\((\w+), 'identifiers'\) \| list\)\[0\]\[1\] \}\}/g, (_m, v) => IEEE_OF(v));
    const lines = s.split("\n");
    const calls = portCalls(lines, file);
    // Every script: fail, like ZHA did, on a device Zigbee2MQTT does not know
    // (rather than publish to control4//set).
    for (let i = 0; i < lines.length; i++) {
        if (!/^    sequence:\s*$/.test(lines[i])) continue;
        const add = [
            `      - if: "{{ not ieee }}"`,
            "        then:",
            `          - stop: "Not a Zigbee2MQTT device: {{ target_device }}"`,
            "            error: true",
        ];
        lines.splice(i + 1, 0, ...add);
        i += add.length;
    }
    let out = lines.join("\n");
    out = out
        .replace(/# Each script calls zha\.issue_zigbee_cluster_command targeting the C4LEDCluster\n(\s*)# on endpoint 3, cluster 0xFC43\./, "# Each script publishes its command to control4/<ieee>/set.")
        .replace(/zha\.issue_zigbee_cluster_command/g, "an MQTT publish to control4/<ieee>/set")
        .replace(/#   - ZHA integration with Control4 device quirks loaded\n/g, "#   - Zigbee2MQTT with the control4-z2m extension\n")
        .replace(/#   - C4LEDCluster present on endpoint 3 of the target device\n/g, "")
        .replace(/driving the C4LEDCluster on EP3\n# \(cluster 0xFC43\) via/g, "driving the LED-cluster commands of\n# the control4-z2m extension via")
        .replace(/Sent via the LED cluster's send_raw passthrough on EP3\./g, "Sent via the send_raw passthrough.")
        .replace(/\(the ramp cluster mirrors them into EP1\)/g, "(the extension mirrors them into on/off_transition)")
        .replace(/created\n# by the quirk\)/g, "exposed\n# by the control4-z2m extension)")
        .replace(/ZHA/g, "Zigbee2MQTT");
    for (const bad of ["zha.", "integration: zha", "cluster_id", "endpoint_id", "[0][1]"]) {
        if (out.includes(bad)) fail(file, `still contains '${bad}'`);
    }
    return {text: out, calls};
}

function main() {
    const [src, outArg] = process.argv.slice(2);
    if (!src) {
        console.error("usage: node tools/port-zha-packages.mjs <zha-packages-dir> [out-dir]");
        process.exit(2);
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const outDir = outArg ?? path.join(root, "packages");
    fs.mkdirSync(outDir, {recursive: true});
    for (const f of FILES) {
        const p = path.join(src, f);
        if (!fs.existsSync(p)) {
            console.log(`skip ${f} (not found)`);
            continue;
        }
        const {text, calls} = port(fs.readFileSync(p, "utf8"), f);
        fs.writeFileSync(path.join(outDir, f), text, "utf8");
        console.log(`wrote ${f} (${calls} cluster calls ported)`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();