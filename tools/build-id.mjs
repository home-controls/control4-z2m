#!/usr/bin/env node
// The build an instance reports in its status (src/core/build.ts): a hash of
// the extension file and the converter file it loaded. An instance running the
// two files under <dir> reports the build this prints:
//
//   node tools/build-id.mjs [<dir>]      (default: dist/; <dir> holds external_extensions/ and external_converters/)
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** The build of an extension file and a converter file, by their contents. */
export function buildId(extension, converter) {
    return sha256(`${sha256(extension)}:${sha256(converter)}`).slice(0, 12);
}

/** The build of the two control4.mjs files under `dir`. */
export function distBuildId(dir = DIST) {
    const read = (kind) => fs.readFileSync(path.join(dir, kind, "control4.mjs"));
    return buildId(read("external_extensions"), read("external_converters"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(distBuildId(process.argv[2] ? path.resolve(process.argv[2]) : DIST));
}
