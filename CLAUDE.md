## This repo is public

Everything committed here (history included), and every issue, PR and Actions log, is public. Never write people's or rooms' names, house names, home hosts, IP
addresses or email addresses into a file, a commit message, an issue or a PR body. Run
`node tools/privacy-check.mjs` before a commit and `node tools/privacy-check.mjs --text <body>`
before posting; CI runs it on every push and pull request. A fork's pull request gets no secrets, so
there CI skips it: before merging one, run `node tools/privacy-check.mjs --range <base>..<head>`.
Install the pre-push hook once per clone: `git config core.hooksPath tools/hooks`.

Pull requests are source-only: they don't commit `dist/` (`git checkout origin/main -- dist` after a
build). Only a release pull request raises `package.json`'s version and commits `dist/` as a fresh build
(`tools/release-check.mjs`, ADR 0008); its merge publishes `v<version>`, a candidate such as `0.4.2-rc.1`
as a pre-release first. See CONTRIBUTING.md.

Issue numbers up to #118 in older docs and commits refer to the archived tracker, not this repo's.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `home-controls/control4-z2m`, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The seven default triage labels, plus `wayfinder:map|task|research|prototype|grilling` for planned work. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### External peers

`claude` mode: the external seat is the claude CLI on claude-opus-5-5 at high effort. See `docs/agents/cross-model.json`.
