// Bundle the two Zigbee2MQTT drop-in files.
//   dist/external_extensions/control4.mjs
//   dist/external_converters/control4.mjs
import {readFileSync} from "node:fs";
import {build} from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const banner = (what) =>
    `// control4-z2m ${pkg.version} - ${what}\n// Generated from src/ by tools/build.mjs - edit the TypeScript, not this file.\n`;

const common = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zigbee-herdsman", "zigbee-herdsman/*", "zigbee-herdsman-converters", "zigbee-herdsman-converters/*"],
    legalComments: "none",
    logLevel: "info",
};

await build({
    ...common,
    entryPoints: ["src/z2m/extension-entry.ts"],
    outfile: "dist/external_extensions/control4.mjs",
    banner: {js: banner("Zigbee2MQTT external extension")},
});

await build({
    ...common,
    entryPoints: ["src/z2m/converter-entry.ts"],
    outfile: "dist/external_converters/control4.mjs",
    banner: {js: banner("Zigbee2MQTT external converter")},
});