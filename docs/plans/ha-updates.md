# Updates from inside Home Assistant

**2026-11-27.** A plan for a Home Assistant integration that installs a control4-z2m release: the Zigbee2MQTT extension
and converter, the blueprints, and optionally the packages. It shows up as one update in Settings → Updates.

**Status, 2026-11-27.** Proposed; nothing is built yet.

## Why

Installing or updating control4-z2m is manual today. You unzip the release into the Zigbee2MQTT data folder, restart
Zigbee2MQTT, copy the blueprints into `blueprints/automation/control4-z2m/`, and repeat whenever a release comes out.
That has two costs:

- Each step is easy to skip, so a house ends up with a new extension and old blueprints, or the other way round.
- A file someone edited locally (a blueprint changed by hand, say) is quietly overwritten by the next copy, or the edit
  stops anyone from updating at all.

**Outcome:**
- A custom integration, `control4_z2m`, installed through HACS. It shows **one update entity**, "control4-z2m", with
  the release notes and an Install button.
- Install brings everything to the release, and leaves alone any file that was edited locally.
- If the new build doesn't come up healthy, it rolls back.

## What the design rests on

- **Zigbee2MQTT installs external JS over MQTT.**
  - `<base>/bridge/request/extension/save` and `converter/save` take `{name, code}`. Zigbee2MQTT writes the file into
    its own data folder, imports and loads it, and answers on `bridge/response/…/save` (`lib/extension/externalJS.ts`,
    Zigbee2MQTT 2.14).
  - It republishes the current files, code included, retained on `bridge/extensions` and `bridge/converters`.
  - So the integration needs no access to Zigbee2MQTT's files, and it works the same for the add-on, Docker,
    bare metal or Zigbee2MQTT on another machine.
  - The extension already handles being reloaded in place (the hot-load path in `src/z2m/extension.ts`), and
    `bridge/request/restart` gives a clean load.
- **The instances report what they run.**
  - Every instance publishes `control4/status/<base>`, retained, with `version`, `build` and `problems` (README,
    "Instance status").
  - Subscribing to `control4/status/+` finds every instance, so a multi-coordinator install ("Several coordinators")
    needs no setup.
  - The installed version comes from what actually runs, not from what was last copied.
- **Blueprints and packages are files in Home Assistant's config folder**, which an integration running in Core can
  write.
- **Releases already exist:** the `release` job in `.github/workflows/ci.yml` publishes `v<version>` with
  `control4-z2m.zip` and `SHA256SUMS`. The `v*` tags are protected from being moved or deleted.

## Steps

Three pull requests, then a rollout.

### 1. A release bundle with a manifest

- **A new `tools/bundle.mjs`** builds `control4-z2m-bundle.zip` and `manifest.json`. The manifest:
  ```json
  {"version": "0.4.0", "build": "<build id>", "contract": 1,
   "files": [
     {"kind": "z2m_extension", "name": "control4.mjs", "path": "dist/external_extensions/control4.mjs", "sha256": "…"},
     {"kind": "z2m_converter", "name": "control4.mjs", "path": "dist/external_converters/control4.mjs", "sha256": "…"},
     {"kind": "blueprint", "path": "blueprints/c4_device.yaml", "sha256": "…"},
     {"kind": "package", "path": "packages/control4_led_scripts.yaml", "sha256": "…"}]}
  ```
  The build id comes from `tools/build-id.mjs`. YAML is hashed as committed (LF).
- **The release job** attaches the bundle and `manifest.json` next to the current assets, and puts the manifest's
  sha256 in the release notes. The current assets stay, so manual installs don't change.
- **`tools/release-check.mjs`:** a change under `blueprints/` or `packages/` also needs a version raise, as `dist/` does
  now. Every blueprint fix then becomes a release the integration can see. Extend `test/release-check.test.ts`.
- **Releases before this one have no manifest.** The integration treats them as "no manifest" (see the modified-file
  rule).

### 2. The integration, `custom_components/control4_z2m/`

The integration is Python, lives in this repo and is released under the same tag, so one version covers the
integration and what it installs.

- **`manifest.json`:** `dependencies: ["mqtt"]`, `config_flow: true`, `iot_class: cloud_polling` (it polls GitHub).
  The release check keeps `version` equal to `package.json`'s.
- **`config_flow.py`:** one step with nothing to fill in. Its options:
  - manage packages (off by default);
  - include pre-releases (off);
  - restart Zigbee2MQTT after saving the files (on).
- **`coordinator.py`:**
  - polls `https://api.github.com/repos/home-controls/control4-z2m/releases/latest` every 6 hours with an ETag (the
    repository is fixed, not configurable);
  - holds the latest release and its manifest;
  - tracks the instances from `control4/status/+`.
- **`update.py`:** one `UpdateEntity`, with the features `INSTALL`, `PROGRESS`, `RELEASE_NOTES` and `SPECIFIC_VERSION`
  (any release with a bundle can be installed, which also covers rolling back).
  - `installed_version` is the lowest `version` the instances report. If they differ, the attributes list each
    instance, and a repair issue says so.
  - `latest_version`, `release_url` and the notes come from the release.
- **`installer.py`:** what Install does, reporting progress as it goes:
  1. **Download and verify.** Fetch that tag's bundle and `manifest.json`, check the manifest against the sha256 in the
     notes, and check every file against the manifest. Any mismatch stops before anything is touched.
  2. **Preflight.** At least one instance is online (`bridge/state`). Read each instance's current `bridge/extensions`
     and `bridge/converters` code.
  3. **Back up** the Zigbee2MQTT files and every blueprint or package about to change, to
     `config/control4_z2m/backups/<from version>/`. Keep the last three.
  4. **Blueprints and packages:** apply the modified-file rule, write the files, then reload `automation` (and
     `script`, when packages changed).
  5. **Zigbee2MQTT, for each instance:** publish `converter/save`, then `extension/save` (name `control4.mjs`), and
     wait for each `bridge/response`, treating an error as a failure. Then send `bridge/request/restart` if that
     option is on.
  6. **Verify.** Within 90 s, each instance's `control4/status/<base>` reports the manifest's `version` and `build`,
     with no problem it didn't already have.
  7. **On failure,** save the backed-up code again, restart, restore the files, and raise a repair issue that says
     what failed.
- **The modified-file rule:**
  - A file is the integration's own if its hash equals the installed release's manifest entry. The installed version
    is what the instances report, and the integration fetches that release's manifest.
  - **Its own:** replaced.
  - **Already equal to the new release:** left alone.
  - **Anything else** (edited locally, or the installed release has no manifest): not touched, listed in the entity's
    attributes, and raised as a repair issue. The issue's fix flow backs the file up and overwrites it.
  - **New in the release:** a blueprint is written; a package only if packages are managed.
  - **Dropped by the release:** reported, never deleted.
- **Also:** `repairs.py`, `diagnostics.py`, `strings.json` and `translations/en.json`, plus `hacs.json` at the repo
  root, so the repo installs as a HACS custom repository.
- **Tests** in `tests/custom_components/control4_z2m/` with `pytest-homeassistant-custom-component`:
  - the manifest check;
  - each row of the modified-file rule;
  - the installer against a fake broker and a fake GitHub: success, a save error, an unhealthy status leading to a
    rollback, and two instances;
  - the update entity's versions;
  - the flows.
- **CI:**
  - A `python` job in `ci.yml` (`actions/setup-python`; `ruff check`, `ruff format --check`, `pytest`), routed like
    `check` and added to the required checks.
  - A `pyproject.toml` for the ruff settings (160 columns, as in `docs/CODE_STYLE.md`).
  - hassfest and HACS validation are third-party actions, which the repository's GitHub-owned-only Actions setting
    blocks. They get allow-listed, pinned by commit SHA.

### 3. Docs and the decision

- **`docs/adr/0007-updates-through-a-home-assistant-integration.md`:**
  - an integration rather than an add-on, because it works on every install type and needs no Docker image;
  - MQTT `save` rather than file access;
  - the modified-file rule.
- **README, Install:** "Home Assistant (recommended): HACS → custom repository → control4-z2m", with the manual unzip
  kept as the alternative.
- **A new `docs/guides/updating.md`:** what Install does, the repair issues, rolling back with "install specific
  version", and automating it with an `update.install` action.
- **`CONTRIBUTING.md` and `docs/CODE_STYLE.md`:** the Python half (ruff, tests).

### 4. Rollout

1. Merge the three pull requests, then release the version that ships them.
2. On a test install: add the repository to HACS as a custom repository, install the integration, and add it.
3. Click Install. The previous release has no manifest, so every blueprint that differs is raised as a repair issue.
   That's expected on the first run: check each one, then overwrite it through its fix flow.
4. The next release is the first full run: Settings → Updates offers it, and Install goes through without repair
   issues.

## Verification

- **Step 1:**
  - `node tools/bundle.mjs`: the manifest's hashes match `sha256sum` of the files, and the zip holds exactly the listed
    files.
  - The release-check tests cover a blueprint-only change.
  - After the merge, the release carries `manifest.json` and the bundle.
- **Step 2:**
  - `pytest` and `ruff` pass in CI.
  - On a test install, with "include pre-releases" on, install a pre-release built from the branch:
    - the extension and converter arrive (`bridge/response/…/save` is `ok`);
    - `control4/status/<base>` shows the pre-release's version and build with `problems: []`;
    - a remote and a keypad still work.
  - Edit a blueprint by hand and check that it is skipped and raised as a repair issue.
  - Force a failure (a manifest naming a build that isn't in the bundle) and check that it rolls back.
- **After the rollout:** Settings → Updates shows control4-z2m at the release version, and "install specific version"
  back to the previous release and forward again both work.

## Choices made

- **The integration lives in this repo** and is released together with the extension, because a separate repo would
  split the versions and CI.
- **Zigbee2MQTT restarts after the saves by default:** the cleanest load, in about 3 s. Reloading in place without a
  restart is an option.
- **Packages are opt-in,** because they need `homeassistant: packages:` set up and are often customised.
- **hassfest and HACS validation are allow-listed** as the only third-party actions, pinned by SHA.
