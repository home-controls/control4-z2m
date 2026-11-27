# Issue tracker: GitHub Issues

Issues and specs for this repo live in GitHub Issues on `home-controls/control4-z2m`. Use the `gh` CLI (`gh auth login` once).

The repo is private but readable by testers: an issue, a comment or a PR body is as public to them as the code. Before posting, write the body to a scratch file and run `node tools/privacy-check.mjs --text body.md`; post only when it reports clean.

## Setup for every command

```bash
R=home-controls/control4-z2m
```

Write multi-line bodies to a scratch file and pass them with `--body-file`, so Markdown arrives as written.

## Conventions

- **Create an issue**: `gh issue create -R $R --title "<title>" --body-file body.md --label enhancement` (repeat `--label` for more).
- **Read an issue**: `gh issue view <n> -R $R --comments`.
- **List issues**: `gh issue list -R $R --state open --label <name> --limit 100 --json number,title,labels,body`.
- **List children**: open issues whose `## Parent` section names `#<n>`: `gh issue list -R $R --state open --limit 200 --json number,title,body --jq '.[] | select((.body // "") | test("## Parent\\s+#<n>\\b")) | "\(.number) \(.title)"'`, with each one's open blockers from **Blocking** below.
- **Comment on an issue**: `gh issue comment <n> -R $R --body-file comment.md`
- **Apply / remove labels**: `gh issue edit <n> -R $R --add-label <name>` / `--remove-label <name>`
- **Create a missing label**: `gh label create <name> -R $R --color 0075ca`
- **Close**: comment first, then `gh issue close <n> -R $R --reason completed` (or `--reason "not planned"`).

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

Contributors without write access open PRs from their forks.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the issue"

Run the **Read an issue** command above.

## Wayfinding operations

- **Map**: one issue labelled `wayfinder:map`, holding the Destination / Notes / Decisions so far / Added so far / Not yet specified / Out of scope body.
- **Child ticket**: start the child body with `## Parent` and `#<map>`, and add the child to a task list in the map body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: a `Blocked by: #<n>, #<n>` line at the top of the child body. Open blockers: read that line and check each with `gh issue view <n> -R $R --json state --jq .state`. A ticket is unblocked when every blocker is closed.
- **Frontier query**: read the map's task list in order; keep children that are open, have no open blocker and no assignee; first in map order wins.
- **Claim**: `gh issue edit <n> -R $R --add-assignee @me`, the session's first write.
- **Resolve**: comment the answer, close the ticket, then append a context pointer (gist + link) to the map's Decisions so far (`gh issue edit <map> -R $R --body-file map.md`).
