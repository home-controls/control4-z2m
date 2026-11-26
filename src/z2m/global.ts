/** Where the extension publishes the runtime for the converter bundle. */
export const RUNTIME_KEY = "__control4_z2m_runtime__";
/** Where the converter bundle says what it loaded, for the extension's status. */
export const CONVERTER_KEY = "__control4_z2m_converter__";
/**
 * Left by the extension's stop(): a WeakRef to the herdsman controller it ran on.
 * A start that finds its own controller there is a hot-load, inside a Zigbee2MQTT
 * that kept running, so its devices already had their start-up work. Zigbee2MQTT
 * 2.x restarts inside the same Node process, so this outlives a restart too; but a
 * restart builds a new controller, and the start that follows finds another one.
 * Builds from before it held a controller left `true`: read as a hot-load.
 */
export const HOT_LOAD_KEY = "__control4_z2m_hot_load__";

/**
 * The runtime API the converter calls (RuntimeApi in definitions.ts). Raise it
 * when those calls change, so an extension and a converter from different
 * checkouts that can't work together report it; test/status.test.ts holds each
 * number to its calls.
 */
export const RUNTIME_API = 2;

export interface ConverterInfo {
    /** The RUNTIME_API the converter was built against. */
    api: number;
    /** The sha256 of the converter file, as it loaded. */
    file: string | undefined;
}