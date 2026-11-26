import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        // Runs inside a Zigbee2MQTT checkout (tools/z2m-harness.mjs), not here.
        exclude: ["test/z2m-harness/**", "node_modules/**"],
        environment: "node",
    },
});