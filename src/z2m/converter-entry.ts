/** Entry of the external converter bundle (data/external_converters/control4.mjs). */
import {fileHash} from "../core/build";
import {buildDefinitions} from "./definitions";
import {CONVERTER_KEY, type ConverterInfo, RUNTIME_API} from "./global";

// Zigbee2MQTT loads converters before extensions: the extension puts this file's
// hash into its build, and reports a converter built against another runtime API.
const loaded: ConverterInfo = {api: RUNTIME_API, file: fileHash(import.meta.url)};
(globalThis as Record<string, unknown>)[CONVERTER_KEY] = loaded;

export default buildDefinitions();
