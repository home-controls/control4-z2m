/**
 * The build an instance runs: a hash of the extension file and the converter
 * file Zigbee2MQTT loaded, each hashed by its own bundle as it loads.
 * Zigbee2MQTT imports a byte-for-byte copy of each file and deletes the copy
 * once imported, so a bundle hashes it from its module's top level.
 *
 * Nothing is stamped into dist/, so a source change touches no committed line
 * it doesn't build into, and tools/build-id.mjs gets the same id from dist/.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** The sha256 of the file at `url` (a module's import.meta.url), or undefined when it can't be read. */
export function fileHash(url: string): string | undefined {
    try {
        return sha256(readFileSync(fileURLToPath(url)));
    } catch {
        return undefined;
    }
}

/** The build of an extension file and a converter file, by their sha256 hashes. */
export function buildIdOf(extensionHash: string, converterHash: string): string {
    return sha256(`${extensionHash}:${converterHash}`).slice(0, 12);
}
