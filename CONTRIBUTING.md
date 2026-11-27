# Contributing

control4-z2m is developed in this repo: code, issues, pull requests and releases. Everything in it is
public: the history, every issue and PR, and the Actions logs.

## Keep personal details out

Never put people's names, room names that identify a household, house names, home hostnames, IP
addresses or email addresses into a file, a commit message, an issue, a PR or a log you attach. Use the
device's model and a neutral name ("a DIM1-Z", "the kitchen keypad") instead.

`tools/privacy-check.mjs` enforces the list the maintainer keeps:
- CI runs it on every push and pull request. A pull request from a fork gets no secrets, so there it is
  skipped, and it runs again on `main` after the merge. Before merging a fork's PR, the maintainer runs
  it on the PR's range: `node tools/privacy-check.mjs --range <base>..<head>`.
- `tools/hooks/pre-push` runs it before a push. Install it once per clone with
  `git config core.hooksPath tools/hooks`. Without the pattern list it says so and lets the push through.
- Check an issue or PR body before posting it: `node tools/privacy-check.mjs --text body.md`.

It reports where a hit is and which pattern matched, never the text.

## Questions

Ask in [GitHub Discussions](https://github.com/home-controls/control4-z2m/discussions): how to set
something up, a setup to share, an idea not yet ready to be an issue. Issues are for bugs, device reports
and planned work.

## Reporting a device

Follow [docs/TESTING.md](docs/TESTING.md): what to do with each device, and what to put in the issue.

## Making a change

Fork the repo, push a branch to your fork, and open a pull request against `main`. For anything bigger
than a fix, open an issue first so the approach can be agreed.

```
npm install
npm run check        # lint + typecheck + unit tests + build
npm run format       # fix formatting and import order (Biome)
npm run test:z2m     # the built files inside a real Zigbee2MQTT (clones it to the temp dir)
npm run canary -- dev   # our checks against the herdsman that Zigbee2MQTT dev pins (or `release`)
```

- **`dist/` is committed.** It is what Zigbee2MQTT loads and what a release ships. Run `npm run build`
  and commit `dist/` with your change; CI fails when `dist/` doesn't match a fresh build of `src/`.
- **A `dist/` change raises the version** in `package.json` (and `npm install --package-lock-only`):
  patch for a fix, minor for a feature, major for a breaking change to the `/set` keys, topics or
  blueprints. CI checks it (`tools/release-check.mjs`); the merge to `main` then publishes that version.
- **Tests:** vitest, in `test/`. `test/rig.ts` drives a whole runtime with a fake radio; the c4_device
  blueprint is rendered as Home Assistant would (`test/c4-device.ts`), and so are the other blueprints'
  templates (`test/blueprints.test.ts`). The README's Development section lists the tools.
- **Generated files:** don't edit them by hand.
  - `blueprints/c4_device.yaml` comes from `tools/gen-c4-device.mjs` (a test checks they match).
  - The SR250 / SR260 / keypad-LED blueprints are ported from the ZHA ones by
    `tools/port-zha-blueprints.mjs`; a fix to one of them goes into that tool.
  - `blueprints/c4_sr260_screen.yaml` is written here, not ported.
- **Code style:** [docs/CODE_STYLE.md](docs/CODE_STYLE.md): formatting and lint rules (Biome, `biome.json`),
  TypeScript, where code goes, comments, tests, commits. CI fails on anything `npm run lint` reports.
- **Words:** use the terms in [GLOSSARY.md](GLOSSARY.md). A decision that would surprise a reader gets an
  ADR in `docs/adr/`.
- **Docs:** what a device does on the wire goes in `docs/research/`, plans in `docs/plans/`, how to set
  something up in `docs/guides/`. File names name the subject, not a date.

A pull request says what changed and why, names the issue it closes, and says how it was checked
(tests, and on hardware if it touches a device). CI must pass: `check` (lint, typecheck, tests, build, `dist/`,
the version raise) and `privacy`. Pushes to this repo run on the project's self-hosted runner; a fork's
pull request runs on GitHub's hosted runners, so its code never runs on project hardware; so do
Dependabot's dependency updates (`.github/dependabot.yml`), which leave zigbee-herdsman and its converters
pinned. Releases run on
the self-hosted runner too.

## Releases

A merge to `main` that raises the version publishes it: tag `v<version>`, titled "control4-z2m <version>",
with `control4-z2m.zip`, both `.mjs` files and `SHA256SUMS`. The notes give the build id, a hash of the two
files that the extension reports in its status next to the version (`tools/build-id.mjs`), and list the
commits since the last release. Releases before 0.2.0 were named `build-<id>` only. The newest is always at
`https://github.com/home-controls/control4-z2m/releases/latest/download/control4-z2m.zip`.

## Issues

- Labels: `bug`, `enhancement`, `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
  `wontfix`, and `wayfinder:map` / `wayfinder:task` / `wayfinder:research` for planned work.
- #6 is the map of what is left to make every model complete; its children list their evidence, and
  whether they need someone at a device.
- The herdsman drift canary (`.github/workflows/herdsman-canary.yml`, nightly) opens an issue when our
  checks fail against the herdsman a coming Zigbee2MQTT pins, and closes it when they pass again.
- Issue numbers up to #118 in older docs and commit messages refer to an archived tracker, not this
  repo's.

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
