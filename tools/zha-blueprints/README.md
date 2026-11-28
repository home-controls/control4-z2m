# The ZHA originals of the ported blueprints

These eight blueprints are the ZHA versions that `tools/port-zha-blueprints.mjs` turns into the Zigbee2MQTT ones in
`blueprints/`. They come unchanged from control4-zha-quirks, branch `sr260`, commit `80f9715`
(`custom_zha_quirks/control4/blueprints/`), the commit this project was first ported from. Kept here so anyone can
regenerate the ported blueprints, and a test can check that they match (`test/blueprints.test.ts`).

control4-zha-quirks is licensed under the Apache License 2.0, as this project is; `NOTICE` credits it.

- **Don't edit these to change a ported blueprint.** A fix goes into `tools/port-zha-blueprints.mjs`; then run
  `node tools/port-zha-blueprints.mjs` (it reads this folder and writes `blueprints/`).
- **A newer original** replaces its file here, with this README's commit updated, in the same change as the
  regenerated blueprint.
