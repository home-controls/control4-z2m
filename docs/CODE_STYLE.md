# Code style

How code, tests, commits and docs are written here. CI enforces what a tool can check
(`npm run lint`, `npm run typecheck`, the tests, `dist/` matching the build, the version raise and the
privacy check); the rest is for review. `npm run format` fixes formatting and import order.

## Formatting and lint (Biome)

`biome.json` is the source of truth; `npm run lint` (`biome ci .`) fails CI on any difference.

- 4-space indent, lines up to 160 characters, LF line endings, a final newline (`.editorconfig` too).
- Double quotes, semicolons, trailing commas, no spaces inside braces: `import {a, b} from "./x";`.
- Arrow functions keep their parentheses: `(x) => x`.
- Imports are sorted by Biome: Node built-ins first, then packages, then relative imports.
- Biome's recommended lint rules, with three deliberate exceptions:
  - hex object keys stay hex (`0x0a: 3`): protocol tables read like the wire (`useSimpleNumberKeys` off);
  - `String.raw` stays where it was written (`noUselessStringRaw` off);
  - in tests, a property may be called `then` (the c4_device test language has one) and a test file may
    export helpers other tests use.
- A suppression names its rule and says why: `// biome-ignore lint/suspicious/noExplicitAny: compiled herdsman`.
  Use one only where the rule is wrong for that line; `// biome-ignore format: <why>` keeps a table in rows.

## TypeScript

- Strict mode (`tsconfig.json`), ES modules, Node 20 or later. `npm run typecheck` must pass.
- `any` only at a boundary with untyped code (compiled herdsman, Zigbee2MQTT internals, Home Assistant
  messages), with a suppression that says so. Prefer `unknown` and narrow it.
- Names: `camelCase` for functions and variables, `PascalCase` for classes and types, `UPPER_SNAKE_CASE` for
  module constants. File names are lower case, words joined by `-` (`outlet-dimmer.ts`).
- Durations are milliseconds unless the name or its comment says otherwise (`DIAG_POLL = 30 * 60_000`).
  Large numbers use separators: `60_000`.
- Protocol values are written as on the wire: hex for codes and ids (`0xc25c`), the frame text in quotes in
  comments (`0i c4.dm.rb`).
- Errors: refuse bad input from `/set` with `throw new Error("<what was wrong>")`, so Zigbee2MQTT reports it
  and nothing half-applies. Don't swallow errors silently; log them at `debug` when they're expected.
- Log levels: `info` for what a user would want to see (commissioned, rebooted, a device became
  unreachable), `warning` for something they should act on, `debug` for the rest. Every line starts with
  `Control4` (and the device's name when it is about one device).

## Where code goes

- `src/core/`: the protocol, the runtime and the parts every device shares (link health, LEDs, the
  transport, the store, traffic). Zigbee-herdsman is imported only by `src/core/transport.ts` (and for
  types in `src/core/constants.ts`).
- `src/devices/`: one family per file, each a class extending `C4Device` (`base.ts`). A device never
  imports from `src/z2m/`.
- `src/z2m/`: everything that touches Zigbee2MQTT: the extension, the definitions (exposes, `/set`
  keys), the status. Zigbee2MQTT's own modules are imported only here.
- `tools/`: Node scripts (`.mjs`). One that tests import gets a `.d.mts` beside it with its types.
- `blueprints/`, `packages/`: Home Assistant. Generated ones say so at the top; change their generator
  (`tools/gen-c4-device.mjs`, `tools/port-zha-blueprints.mjs`), never the file.
- `dist/`: built by `npm run build`, committed, never edited.

## Comments

- Every exported function, class and constant gets a `/** … */` comment that says what it is or does,
  in a sentence. Say why when the code alone doesn't: a device quirk, a measured timing, a decision.
- Name the evidence for a protocol fact (the doc in `docs/research/`, the capture, the test), not a person.
- Don't narrate the code line by line, and don't leave commented-out code.

## Tests

- Vitest, in `test/`. A change in behaviour comes with a test that fails without it.
- Test names are sentences about behaviour: `it("never uses list 0001 (an SR260 draws it as a heading), and wraps past it")`.
- Use the rig (`test/rig.ts`) and fake timers (`vi.useFakeTimers()`, `tick`) for anything with time in it;
  a test that waits on real time or on `Math.random` is flaky. Pin what you depend on.
- Blueprint templates are rendered with the test HA engine (`test/c4-device/engine.ts`), which a
  conformance probe holds to a real Home Assistant.

## Commits and pull requests

- One logical change per commit. The subject is one line saying what changed, optionally after an area or a
  type: `SR260: text colour (c4.zr.tc)` or `fix(blueprints): SR260 mutes only a target that can mute`.
- The body says why, and what was checked (tests, hardware, model and firmware).
- A pull request closes its issue (`Closes #n`), passes CI, and raises the version if `dist/` changed
  (CONTRIBUTING.md).
- Nothing personal anywhere: no names of people, household rooms or houses, no hostnames, IP addresses or
  email addresses, in code, tests, fixtures, commit messages or PR text.

## Docs

- Plain and precise: short sentences, the facts first, no marketing. British spelling, as in the code
  (`colour`, `behaviour`).
- Words from `GLOSSARY.md`; a new concept gets an entry there.
- File names name the subject, not a date. Dates go inside, next to the finding they date.
- Hardware findings in `docs/research/` say what was tested, on which model and firmware, and how.
