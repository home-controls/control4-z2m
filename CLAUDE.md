## This repo is readable by testers

Everything committed here (history included), and every issue, PR and Actions log, can be read by
the testers who have access. Never write people's or rooms' names, house names, home hosts, IP
addresses or email addresses into a file, a commit message, an issue or a PR body. Run
`node tools/privacy-check.mjs` before a commit and `node tools/privacy-check.mjs --text <body>`
before posting; CI runs it on every push. Install the pre-push hook once per clone:
`git config core.hooksPath tools/hooks`.

Issue numbers up to #118 in older docs and commits refer to the archived tracker, not this repo's.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `home-controls/control4-z2m`, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The seven default triage labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### External peers

`claude` mode: the external seat is the claude CLI on claude-opus-5-5 at high effort. See `docs/agents/cross-model.json`.
