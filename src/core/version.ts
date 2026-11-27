/**
 * The control4-z2m release version (package.json's `version`). tools/build.mjs
 * stamps it into both bundles, where it already names the release in their
 * banner line; from source (the tests) it is "dev". A release on GitHub is
 * tagged `v<version>`, and the build id (src/core/build.ts) tells two bundles
 * of one version apart.
 */
declare const __C4Z2M_VERSION__: string | undefined;

export const VERSION: string = typeof __C4Z2M_VERSION__ === "string" ? __C4Z2M_VERSION__ : "dev";
