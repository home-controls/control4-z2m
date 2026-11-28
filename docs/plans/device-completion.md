# Device completion: everything left to make each Control4 device complete

**2026-11-07, brought current 2026-11-27.** This plan pulls together everything still open for every model the
extension supports. Sources: the two research maps (`docs/research/dim1z-capability-map.md` and
`docs/research/kc-apd-sw-capability-map.md`), the issues, the ideation doc, the live tests of 2026-11-07 and
2026-11-08, and the frame-type survey of 2026-11-15 (`docs/plans/frame-type-survey.md`). It orders the work so each
model ends complete.

**Complete** means that for each model, every capability the hardware has is one of these:
1. exposed in Home Assistant, named for what it is, and shown as the device holds it (read back, not assumed);
2. deliberately left out, with the reason written here or in the README;
3. listed below as research, with the test that would settle it.

No known bug is left open.

**Tracked in this repo's GitHub Issues:** the map is #6, the open items are #7-#16, and the canary's live drift issue
is #18. "Tracking" at the end lists them. The items already built had their own issues in an earlier tracker, now
archived and closed; they are written "archived issue N" here.

## Status, 2026-11-27

**Merged:** branch `device-completion`, as archived PR 100 (merged 2026-11-10). Its build (`0ed43578d0ac`) ran on
the test site from 2026-11-08.

- **Phase 0:** the harness test's timing was the canary failure, not herdsman. Archived issues 55, 56, 59, 63 and 65,
  like 101-111 after them, were canary noise, and are closed. The live drift issue is #18: the Zigbee2MQTT dev
  harness fails nightly on the `tools/deploy.mjs` tests and republishes the exposes a converter save changed.
- **Phases 1-4, all items:** P1.1-P1.5, P2.1-P2.6, P3.1-P3.5, P4.1 (and P4.2's README note).
- **Phase 5:** P5.1 (hardware fades). P5.2 and P5.3 were declined (below).
- **Other models:** the FS1-Z's taps and holds under c4_device (archived issue 51, closed), the fan and outlet in the
  picker (archived issue 96), and the SR250 / SR260 blueprints on the events entity (archived issue 99). Those
  blueprints are deployed on the test site since 2026-11-27.

**Since then:**
- **The Gen3 board's remote reboot is found** (frame-type survey, 2026-11-15). `0i c4.sy.rb` reboots the KC120277 and
  the APD120: `c4.sy.ri` went from `CRS AST` to `" SW RBT"`. They reply before restarting, so their APS
  acknowledgement goes out and a retry can't reboot them again. `c4.dm.rb` exists on both, untried. The SW120277 is
  untested. So #12 is now a build task (below).
- **TX power** (`c4.sy.zpw`) survives a reboot. Whether it survives a power cut is unknown. The device takes -10 to
  +2 dBm (-10 reads back as -11); the extension's `tx_power` takes -8 to +2.
- **DIM1-Z `tv` slot 07** is a 0 / 1 flag with no measurable effect.
- **SR260:**
  - **Text colour:** `text_color`, written as `c4.zr.tc`, one RGB332 byte (`src/devices/remote.ts`,
    `src/z2m/definitions.ts`).
  - **The `c4_sr260_screen` blueprint** sets the LCD colour and now playing from one form.
  - **List ids are never `0001`:** an SR260 draws list 1 as a heading.
  - **Tested on hardware at the test site** (firmware 2.2.50): commissioning, wakes, menus, text colour, and sniffer
    captures.
  - **It reads the controller identity 0.1-34 s after each wake** (the sniffer, six wakes: +34, +10, +8.4, +0.1, +3.8
    and +25.5 s). Open PR #4, which restores the screen after a wake or re-join, must handle that spread.

**Checked at the test site** (an APD120 on an LED load, keypad A, a KC120277, and a DIM1-Z, 2026-11-08):
- **APD120:**
  - **Power:** 36 W, 0.292 A and 125 V at full, from each level report.
  - **Settings read:** its tv table read in one `c4.dm.is`, as shown.
  - **Hardware fades:** to 100 % over 3 s arrived in about 3.4 s. A fade to 5 % was held at its 10 % minimum.
  - **LED status colour:** one frame on the top LED, and given back to follow load on clear (both read back).
  - **Button behaviour:** toggle, then load_off, each read back. TX power 0 dBm written and read back.
- **KC120277:** backlight colour and brightness written and read back. Layout learned as [0, 2, 4], and only those
  buttons' LEDs exposed. An LED effect on a push/release slot restored the automation's colour.
- **DIM1-Z:**
  - **The full-sweep rule holds:** 50 → 100 % in 4 s sent 8000 ms and arrived in 4.3 s.
  - **A mid-fade transition is timed from the last report:** 77 → 100 % in 2 s sent 8696 ms and arrived in 2.1 s.
  - **A fade from off skips the cold start:** with cold start at 60 %, it went 20 → 30 % and never touched 60 %. So
    a turn-on from off with a cold start set now uses the level command.
- **Found live:** the Gen3 board pads some replies with NULs and stray bytes after the value, and quotes text replies
  (`" SW RBT"`). A frame now ends at its first NUL, and text replies are unquoted.

**Declined, and why:**
- **P5.2 (`tv 00 00` as the level command):** not switched. The ZCL level command behaves, and `tv 00 00` is only
  needed to stop a hardware fade, which a new `rtl` or level command already does. #8 keeps it as research.
- **P5.3** (#9 keeps it as research):
  - **`l0v` / `l1v`:** they read only the colour on show, where `c4.dm.is` checks both stored colours of each LED,
    which is what a paint writes. Kept `is`.
  - **`c4.sy.info`:** the model already comes from every check-in.
  - **`t0s` in place of the two ZCL reads:** the load read never runs mid-fade, so there is no live failure to fix.
    `t0s` already read sensible levels mid-fade in the `rtl` tests of 2026-11-07 (the DIM1-Z map), so it stays a
    research lead, not a bug.

## Where each model stands

| Model | Done | Left |
|---|---|---|
| C4-DIM1-Z | Light, fades, ramps, limits, cold start, paddle local control, 4 LED colours, LED engine, settings read from the dimmer, Reboot button and automatic reboots (archived PR 66), one round of LED colours per change (P1.4), commands held through start-up (P1.5), hardware fades (P5.1, `src/devices/dimming.ts`) | Research only (P6: #10, #11). P5.2 and P5.3 declined (#8, #9) |
| C4-APD120 | Fully built, P1-P5.1: power and energy, settings and cold start read from the device, light state from its reports, Top / Bottom LED with LED mode and one-frame status colours, button behaviour per half, reset reason, TX power, dimming phase, fault, multi-click times, firmware, hardware fades (`src/devices/gen3.ts`, `src/devices/sensors.ts`) | Reboot button and automatic reboots (#12); research (#13) |
| C4-SW120277 | Built with the APD120 (P1-P4, `src/devices/gen3.ts`) | The check on a real unit (#14); its reboot is untested (#12); research (#13) |
| C4-KC120277 | Fully built: LED mode, backlight colour and brightness, button layout, reset reason, TX power, multi-click times, firmware (`src/devices/gen3.ts`, `src/devices/keypad.ts`) | Reboot button and automatic reboots (#12); research (#13) |
| Others | see "Other models" | |

## Phase 0: land what is built (done)

- **Done: archived PR 66 (merged 2026-11-07).** The DIM1-Z Reboot button, automatic reboots (ADR 0006), and
  `c4_send` `"type": "i"`. The test site ran it (build `342f7a3a92e1`).
- **Done: the docs branch with this plan:**
  - both research maps;
  - ADR 0006;
  - the glossary terms: button wire, button behaviour, LED mode, unreachable, stuck re-joining, remote reboot,
    reset reason;
  - the README brought current.
- **Done: the herdsman-drift triage.** Archived issues 55, 56, 59, 63 and 65 were one harness failure:
  `sends_failing` never cleared after the fan `/set` in the harness test, under Zigbee2MQTT dev pins and the 2.14.3
  release. Canary noise, all closed. The live drift issue is #18.

## Phases 1-5: what was built

**Phases 1-4 and P5.1 are built and merged** (archived PR 100, 2026-11-10). Each item keeps its finding and its
change as planned, for the record. "Bug" names what the extension did before.

## Phase 1: fix what was wrong

These needed no new device knowledge. Each was verified at the test site after a push.

**P1.1 Real power and energy (APD120, SW120277).** M. Archived issue 70. **Built.**
- **Bug:** `power` was field 4 of `c4.dmx.pwr`, the power factor × 1000, times 0.04247 (`SCALE_POWER`), so any load
  with a power factor near 1 read ~42 W. `device_temperature` was field 5, a lifetime energy counter that showed
  3698.6 °F.
- **Change:**
  - Publish field 2 as power (W), field 0 voltage (V), field 1 current (mA → A), field 3 apparent power (VA),
    field 4 power factor (÷ 1000), and field 5 as energy (`total_increasing`, ~1.27 Wh per count, so it can feed
    the Energy dashboard). Drop `device_temperature`.
  - The `c4.dmx.ls` announcement carries the same fields after the level, so update from it as well as from the
    poll.
  - **The counter drops at a reboot.** It restores its last flash save (2932 → 2000 on the APD120). HA reads any
    drop in a `total_increasing` sensor as a meter reset and would count the difference twice. So keep an offset in
    the saved settings: when the raw count falls, add what was lost, and publish raw + offset, which never falls.
- **Where:** `src/devices/sensors.ts` (`PowerSensor`, with the offset), `src/z2m/definitions.ts`,
  `src/devices/gen3.ts`. `SCALE_POWER` is gone.
- **Verify:** at full brightness the APD120 under test reads ~35 W, not ~42, and energy ticks while it is on.
  Release note: the old `device_temperature` entity becomes unavailable, and HA's statistics for it should be
  deleted.
- **Open:** the counter's exact scale, from field 2 integrated over a day against the ticks (#13).

**P1.2 The APD120's settings read from the device.** M. Archived issue 71. **Built.**
- **Bug:** it showed hold ramps 4000 ms and min 5 %, Control4's provisioning values, where it holds 5000 ms and 10 %.
- **Change:** read them as the DIM1-Z does, through the state-read queue once per start and after a re-join or
  handoff. One `c4.dm.is` Get returns slots 00-0a in order, the on and off fades included. Archived PR 58 did this
  for the DIM1-Z only. Factory values: min 10 %, ramps 5000 ms. Add cold start (slots 09 / 0a) to the APD120.
- **Where:** `src/devices/gen3.ts` (`Apd120`, `DimmerLoad`, `readSettings`), `src/devices/dimming.ts` (`TvParams`),
  `src/core/constants.ts` (`APD120_TV_PARAMS`).
- **Verify:** its entities show 5000 / 10 % after a start, and the log names what changed.

**P1.3 The APD120's light state from its reports, never from taps.** S. Archived issue 72. **Built.**
- **Bug:** `syncClick` published ON for a top tap and OFF for a bottom tap. With the top half event-only, three top
  taps left the light off and HA showed it on; a toggling bottom half flicked HA on → off → on.
- **Change:** drop the tap inference on the APD120. Its `c4.dmx.ls` reports are right and arrive within a second.
  Keep it on the SW120277 only while a half drives the load (P4.1 generalises the guard).
- **Where:** `src/devices/gen3.ts` (`Apd120`, `Sw120277.syncClick`). **Verify:** a test per button behaviour.

**P1.4 One brightness change, one round of LED colours (every model with LED colours, the DIM1-Z included).** S.
Archived issue 73. **Built.**
- **Bug:** queued runs of an LED automation each set `led_brightness` before the first had landed. The extension
  re-sent 24 of 24 colours three times and 17 once, about 90 frames for one change, because a re-apply compared
  against what was sent while writes still in flight didn't count yet.
- **Change:** compare against what is queued as well as what was sent (`LedWriter.reapply` / the tx pump). Also make
  the automation's `led_brightness` a no-op when the value is unchanged.
- **Where:** `src/core/leds.ts`, `src/core/animation.ts` (tx pump), `src/devices/ledkeys.ts`.
- **Verify:** a test where three brightness sets arrive back to back and each colour goes out at most once.

**P1.5 Commands in the first seconds after a start (every model).** S-M. Archived issue 74. **Built.**
- **Bug:** a `/set` that arrived in the ~3 s before the extension was running failed with "Control4 extension is not
  running" (archived issue 60). Home Assistant re-sends nothing, so an automation's command in that window was lost.
- **Change:** queue `/set` calls briefly (a few seconds) while the runtime starts, then run them. Refuse only after a
  timeout.
- **Where:** `src/z2m/definitions.ts` (the converter's `convertSet`), `src/z2m/extension.ts`.

## Phase 2: diagnostics (read-only, small)

All built.

**P2.1 Reset reason (KC120277, APD120, SW120277).** S. Archived issue 75.
- Read `c4.sy.ri` at start and after each re-join, and publish it as a diagnostic sensor.
- Decode the EmberZNet codes (`PWR`, ` SW RBT`, `CRS AST`, `WDG`, …) into words.
- Log a warning on a crash or watchdog. Both keypads tested last restarted on an assert.
- The DIM1-Z answers `n01`: none there.

**P2.2 Radio TX power (KC120277, APD120, SW120277).** S. Archived issue 76.
- A config number on `c4.sy.zpw`, -8 to +2 dBm in signed hex. All three devices tested ran at 0 dBm.
- The device takes -10 to +2 (-10 reads back as -11, 2026-11-15). The setting survives a reboot (`0i c4.sy.rb`,
  2026-11-15). Whether it survives a power cut is open, so the saved value is re-applied after a re-join.

**P2.3 Dimming phase (APD120).** S. Archived issue 77.
- A read-only sensor from `c4.dmx.dim`: 01 forward phase, 02 reverse (the one tested), and 00 on a relay.
- `c4.dmx.plm` is the configured mode, 00 auto. Left unsettable until a careful test, since the wrong phase can
  stress a load.

**P2.4 Fault status (APD120, SW120277).** S. Archived issue 78.
- Composer shows a Fault Detection status (short circuit, overload). `c4.dmx.warn 00` is the warning the device
  announces, read now as `00 0000`.
- Published as a problem binary sensor, from the announcement and a read at start.
- Open: Composer's "Fault Reset" command (research, P6).

**P2.5 Multi-click times on the APD120 and KC120277.** S. Archived issue 79.
- They hold the same `c4.dmx.bmc` table as the SW120277, where it was already exposed.
- Reuse the SW120277's keys, read back at start.

**P2.6 Firmware and bootloader versions.** S. Archived issue 80.
- `c4.sy.fwv` and `c4.sy.blv` as diagnostic attributes or sensors, read once.
- The two KC120277s tested differ in bootloader (2.6.0 vs 4.0.10).

## Phase 3: the LED model (APD120, SW120277, KC120277)

Every item here was tested (2026-11-07), and all are built.

**P3.1 LED mode per slot, replacing `led_N_bound`.** M. Archived issue 81.
- A select of programmed / follow load / push-release, writing `c4.dmx.led <slot> 01 <00|01|02>`. Read back at start.
- Migration: bound = push-release, unbound = programmed.
- Follow load is what Control4 sets on the paddle LEDs, and it needs no traffic from HA. On a keypad, with no
  load, it shows its load-off colour.
- Writing param 01 leaves param 02 as it was. Param 00 (the wire a push-release LED listens to) stays as the
  device has it.

**P3.2 Status colours on the APD120 / SW120277, and in one frame.** L. Archived issue 83.
- Before, `led_status` threw for these two models, and the c4_device blueprint skipped their LEDs: they had no
  animator.
- Give them one, on the two real LEDs (P3.3).
- A status colour is one frame: switch the slot to programmed and write param 05. On the APD120 and the KC120277
  it stays through load changes. In follow-load mode a param-05 write lasts only until the next load change, and in
  push-release mode it doesn't stick.
- The LED engine (`led_status`, `led_effect`) can use this on every dmx model in place of rewriting 03 / 04.
- Keep its fades: a fade is many frames, whatever the mode.
- Then add these models to c4_device's LED feedback (the blueprint's "LED follows" options).

**P3.3 Only the LEDs a model has (APD120, SW120277).** S. Archived issue 82.
- Expose "Top LED" (slot 01) and "Bottom LED" (slot 04), each with its colours and mode. The paint test confirmed
  them.
- Drop the other 10 slots × 3 entities, or put them behind a device option.
- Migration: the old `led_2_*` / `led_5_*` keys map onto the new ones.

**P3.4 Backlight colour and brightness (KC120277).** S. Archived issue 84.
- A colour entity on `c4.dmx.blc 00 05` (black = off), and a brightness number on `blc 00 03`. Both tested on
  keypad A.
- The table refuses out-of-range values (`blc 00 01` gives `v01`), so only these two for now.

**P3.5 The KC120277's fit-out.** M. Archived issue 85.
- The keypad can't report which buttons are fitted (37 layouts). Learn the layout from the button wires each keypad
  actually sends (a wire seen is a button), with a device option to name or correct it.
- Only those buttons get actions, and only those LEDs get entities.
- It replaces or extends `button_numbering`. `led_N` follows the button it lights.
- `pairSlots`, dead code from an earlier try, is removed from `src/core/animation.ts`.

## Phase 4: buttons

**P4.1 Button behaviour per paddle half (APD120, SW120277).** M. Depends on P1.3. Archived issue 86. **Built.**
- A select per half: load on / load off / toggle / momentary / event-only. It writes `c4.dmx.btn <wire> 01`, wires
  01 (top) and 05 (bottom). Never write `05`, which turns each tap into a phantom double tap.
- It replaces the SW120277's `paddle_local_control` (both halves event-only), and that key becomes an alias.
- Toggle, event-only and momentary were all tested on the APD120. Read the behaviours back at start.
- The c4_device blueprint generator assumed an APD120 paddle always ramps its own load
  (`tools/gen-c4-device.mjs`). Teach it the half's behaviour, so an event-only half can carry a scene like a keypad
  button.

**P4.2 KC120277 buttons.** S. **Done** (a README note).
- All 14 wires are event-only (`03`), and a keypad has no load, so there is nothing to expose.
- Documented in the README; the behaviour is left alone.

**P4.3 Auxiliary keypads (C4-KA).** Research. #7
- A KA wired to an APD120 / SW120277 controls the load without a controller.
- Whether its presses reach Zigbee, and as which wire, needs a KA at the test site. The KD120 notes (bharat) report
  an aux keypad on wires 07 / 08 (`docs/research/unsupported-models.md`).

## Phase 5: fades and levels

**P5.1 Hardware fades for `transition`.** M. Archived issue 88. **Built** (`src/devices/dimming.ts`).
- Send a transition as one `0i c4.dm.rtl <ch> <pct hex2> <time hex8>`, in place of a ZCL move with the device's
  stored fades. The time rule differs per family:
  - DIM1-Z: the time is a full 0-100 % sweep, so send `t × 100 / |b − a|`;
  - APD120: the time is this move's duration.
- A later level command (`0s c4.dm.tv 00 00 <pct>`) stops a fade on both.
- `FadeHold` keeps the fade window, so mid-fade reports don't bounce the brightness.
- The live tests (2026-11-08): a fade from off skips the cold start, so a turn-on from off with a cold start set
  uses the level command; the extension holds a fade to min / max itself.

**P5.2 `tv 00 00` as the level command.** Research, declined for now. #8
- It sets the level on both families, at once. It is an alternative to the ZCL level command, if it behaves better
  mid-fade.
- Not switched (see "Declined"). Open: does it use the stored fades, or jump?

**P5.3 Small DIM1-Z read-backs.** Declined for now; kept as research. #9
- `c4.dm.t0s` reads the live level in one Get, where the extension uses two ZCL reads. It read sensible levels
  mid-fade in the `rtl` tests.
- `l0v` / `l1v` read back the colour an LED shows now, a direct check of an LED paint in place of the `c4.dm.is`
  read-back (`src/core/leds.ts`).
- `c4.sy.info` names the model in one Get. Low value: every check-in already does.
- `c4.dm.is2` (found 2026-11-15) reads max, min, cold-start level and cold-start time in one Get: a shorter settings
  read, if one is ever wanted.

## Phase 6: research left

Each item needs a device write, a person at the device, or hardware the test site lacks.

**DIM1-Z** (#10, #11):
- `lt <n>`: someone at the switch, tapping and holding each half, with `lt 00` / `lt 01` = 0.
- `tv` slot 07 (`1`): Control4 never writes it. A 0 / 1 flag; at 0 nothing measurable changed (2026-11-15). Next,
  someone at the switch with it at 0.
- `0i c4.dm.bl`: takes 4 to 6 arguments and is no bootloader entry (2026-11-15); most likely an LED blink, to be read
  with someone watching the switch.
- Zigbee groups: does a DIM1-Z follow a group command? This needs one network-wide broadcast.
- `onLevel` = 255: writable (it accepts a write, 2026-11-28); whether another value is used at a turn-on is untested.
- The 5-5-5 and 13-4-13 taps: try them on one that must be re-paired anyway.
- Does `0i c4.dm.rb` cure a dimmer that is actually stuck (#11)? Watch the first automatic reboot, and keep the ZDO
  leave-and-rejoin as the fallback for a dimmer whose Control4 side won't act on it.
- Why the firmware goes deaf at all (mesh churn?, archived issue 60). Mostly outside this repo.

**KC120277 / APD120 / SW120277** (#12, #13):
- **The remote reboot is a build task now (#12).** `0i c4.sy.rb` reboots the KC120277 and the APD120 (2026-11-15).
  Build:
  - a Reboot button for those models, and the automatic reboots (ADR 0006), through `src/core/link.ts`
    (`autoReboot`) as `src/devices/dm.ts` (`reboot`) does for the DIM1-Z;
  - a reset-reason read after the reboot, since these models send no device announce, so the re-join handling
    doesn't run;
  - the frame without an APS ack, still the safe default, though they answer before restarting.

  The SW120277 is untested (#14). `c4.dm.rb` exists on both models tested, untried.
- Never `c4.dmx.bl` or `c4.dmx.rbp`: on the Gen3 board their meaning is unknown. (On the DIM1-Z, `c4.dm.bl` proved
  no bootloader entry; the Gen3 `c4.dmx.bl` is untried.)
- The Gen3 board has never had a full name sweep (the frame-type survey's Step 1).
- The rest of the `blc` table, in a dark and a lit room, and the ambient profile behind it (`amb 03` / `04`).
- Composer's Fault Reset command.
- `tv` slots 0b (5000) and 0c (1023) on the APD120.
- Whether TX power survives a power cut (it survives a reboot).
- The energy counter's exact scale (P1.1).
- Whether the 15-tap reboot works on these models as on the DIM1-Z: the README's advice assumes it.
- What LED param 00 means: bharat and royceybaby disagree, and on the keypads tested it equals the slot's own index.
- Advanced Lighting Scenes stored on the device: Control4's proxy docs push scene XML to the driver. No capture
  shows it on the wire.

**SW120277** (#14): every finding for it comes from the ZHA-era notes or other people's units. A unit on any
instance is needed to confirm P1.1, P3 and P4 on it, and whether `0i c4.sy.rb` reboots it.

## The DIM1-Z, all in one place

Its research map is `docs/research/dim1z-capability-map.md`.

**Done**
- **Light:** ZCL on / off / level. Its own on and off fades are written to the dimmer, along with the hold ramps,
  min, max, default-on and cold start.
- **Settings from the dimmer** (archived PR 58): read at start and after a re-join or handoff. Until then it shows
  the factory values.
- **Paddle:** taps, multi-taps and holds, with fast counts and known taps, and paddle local control (`c4.dm.ba`).
- **LEDs:** four colours (top / bottom × on / off), LED brightness, the LED engine (`led_effect`, `led_status`) and
  c4_device's LED feedback. One round of colours per brightness change (P1.4).
- **Availability and recovery:**
  - availability from its answering, and the unreachable listing and notice (archived PR 58);
  - the checks after a re-join (archived PR 62);
  - the Reboot button and automatic reboots (archived PR 66, ADR 0006).
- **Start-up:** a command in the first seconds after a start waits for the extension (P1.5).
- **Hardware fades** (P5.1): `transition` sent as one `0i c4.dm.rtl`, where the time is a full 0-100 % sweep (send
  `t × 100 / |b − a|`), in `src/devices/dimming.ts`.
- **Firmware:** shown from its check-in.

**Declined** (kept as research)
- **P5.2** (#8): `0s c4.dm.tv 00 00 <pct>` as the level command.
- **P5.3** (#9): `t0s`, `l0v` / `l1v`, `c4.sy.info`.

**Research (P6: #10, #11)**
- `lt <n>`;
- `tv` slot 07;
- what `0i c4.dm.bl` shows (and `0i c4.dm.bp`, a remote paddle press, which nothing needs yet);
- Zigbee groups;
- `onLevel`;
- the 5-5-5 and 13-4-13 taps;
- whether the remote reboot cures a dimmer that is actually stuck;
- why the firmware goes deaf.

**Deliberately left out, and why**
- **Zigbee scenes:** the Scenes cluster answers, but nothing stores or recalls a scene (tested 2026-11-03).
- **LED polarity** (`l0l` / `l1l`, `ll <n>`): the extension paints the LEDs itself, and an inverted LED would break
  its idea of which colour is on show.
- **LED freeze** (`lm` = 0): the extension sets `lm` 1 after each colour write. A frozen LED would make its paint
  check wrong.
- **Power, ambient light, reset reason, radio TX power:** the DIM1-Z has none of them (`n01`). No over-the-air path
  sets its radio power (frame-type survey, 2026-11-15).
- **`c4.dm.frs`:** read as a factory reset. Never written.

**Its live-test sitting** (~15 min):
- `lt 00` / `lt 01`, with someone at the switch tapping and holding each half;
- `tv 07` at 0, and `0i c4.dm.bl`, with someone watching;
- then, on a dimmer that needs a re-pair anyway, the 5-5-5 and 13-4-13 taps.

**Done when**
- P1.4, P1.5 and P5.1 are merged and checked at the test site. (Done.)
- Each P6 item is tested, or still listed with its test.
- The README's DIM1-Z row and its research map agree with what ships.

## Other models

None of these is at the test site, so each item needs a unit on some instance to verify it.

**C4-FS1-Z fireplace switch.**
- **Fixed (archived issue 51, closed):** under c4_device its taps ran only with the Wait response, and its holds
  never started. The fix:
  - emit `press` on `b<idx>c`;
  - declare `press`, the counter gestures and a `tap_window` option;
  - in the blueprint, start a hold on `hold`, and count the FS1-Z as a paddle.

  Code: `src/devices/dm.ts` (`Fs1z`), `src/z2m/definitions.ts`, `tools/gen-c4-device.mjs`. A capture from a real
  FS1-Z would still confirm it.
- **Research (#16):** `0i c4.dm.rb`. It's the same generation as the DIM1-Z, so likely, but untried.
- **Not porting:** the ZHA capture mode (README, Differences).

**C4-4SF120 fan and LOZ-5S1-W outlet.**
- **Both are in the c4_device picker** (`PICKER_MODELS` in `tools/gen-c4-device.mjs`; archived issue 96).
- Outlet: `syncClick` reads a single tap as ON and any other count as OFF. Check that on a unit (#15).
- Leads by analogy with the other c4.dmx models, untested (#16):
  - the fan's LED colours (only the raw LED-cluster keys today);
  - its ambient light, reset reason and reboot.

**KP3-Z / KP6-Z / KPZ keypads.** Nothing open in the README. Leads from the wmariz notes, untested here (#16):
- `c4.kp.rb 00` reboots a KP6-Z;
- `c4.kp.llm <btn> 00|01` sets keypad-managed push / release;
- `c4.kp.bhp` is the hold threshold (`01f4` = 500 ms).

The "a delivered ping counts as seen" availability path for these models has never run at the test site.

**C4-Z2IO-ZP.** Nothing listed as missing.

**SR250 / SR260 remotes.**
- **Their blueprints hear the remote's Control4 events entity** (`event.received`, ADR 0005; archived issue 99), and
  are deployed on the test site since 2026-11-27.
- **SR260, built and tested on hardware** (firmware 2.2.50): text colour (`text_color`, `c4.zr.tc`, one RGB332 byte;
  `src/devices/remote.ts`, `src/z2m/definitions.ts`), the `c4_sr260_screen` blueprint, and list ids that are never
  `0001`, since an SR260 draws list 1 as a heading.
- **Open: the screen after a wake.** The SR260 reads the controller identity 0.1-34 s after each wake (six wakes at
  the sniffer: +34, +10, +8.4, +0.1, +3.8 and +25.5 s). PR #4 (open) uses that read to restore the screen after a
  wake or re-join, and must allow for the whole spread.

## Open issues and where they land

| Issue | Title | Here |
|---|---|---|
| #6 | The map: every model complete | This plan |
| #7 | What a C4-KA auxiliary keypad's presses report | P4.3 |
| #8 | `c4.dm.tv 00 00` as the level command | P5.2 (declined, research) |
| #9 | DIM1-Z one-Get level read (`t0s`) and LED paint check (`l0v` / `l1v`) | P5.3 (declined, research) |
| #10 | DIM1-Z research leads | Phase 6, DIM1-Z |
| #11 | Watch: does the remote reboot cure a stuck DIM1-Z? | Phase 6, DIM1-Z |
| #12 | Remote reboot on the KC120277 / APD120 / SW120277 | Phase 6: now a build task |
| #13 | KC120277 / APD120 / SW120277 research leads | Phase 6 |
| #14 | Verify on a real SW120277 | Phase 6, SW120277 |
| #15 | The outlet's tap-state inference on a real unit | Other models |
| #16 | FS1-Z, fan and KP keypad leads | Other models |
| #18 | Herdsman drift: the canary's nightly harness failure | Phase 0 |
| PR #4 (open) | Remotes: restore the screen after a wake or re-join | Other models, SR260 |
| Archived issue 21 (closed) | c4_device works on every device its picker accepts | Other models: the fan and outlet joined the picker |
| Archived issue 60 (closed) | Its open questions | P1.5 (start-up window, built), P6 (why firmware goes deaf, the 15-tap reboot on Gen3) |

## Live test sessions

Each item that needs someone at the device is batched into one sitting per device, to keep the trips few:
- **APD120 (~20 min):** the Reboot button once built (#12), the `blc` and ambient bytes.
- **KC120277 (~15 min):** the Reboot button once built (reset reason before and after), the rest of `blc`.
- **DIM1-Z (~15 min):** `lt <n>`, `tv 07`, `0i c4.dm.bl`, then the taps on a dimmer that needs a re-pair anyway.

## Order

Phases 1-4 and P5.1 are done. Next: the Gen3 Reboot button and automatic reboots (#12), the build task the survey
opened. Phase 6 runs alongside as devices and sittings allow, and PR #4 lands the SR260's wake restore. Each item
ends with its README section, its glossary terms and its research-map entry updated in the same PR.

## Tracking

| Issue | Item |
|---|---|
| #6 | The map: every item in order, with blockers |
| #7 | C4-KA auxiliary keypad presses (P4.3) |
| #8 | `tv 00 00` as the level command (P5.2, declined, research) |
| #9 | `t0s` and `l0v` / `l1v` (P5.3, declined, research) |
| #10 | DIM1-Z research leads (Phase 6) |
| #11 | Watch: does the remote reboot cure a stuck DIM1-Z? |
| #12 | Remote reboot on the KC120277 / APD120 / SW120277: build the Reboot button and automatic reboots |
| #13 | KC120277 / APD120 / SW120277 research leads |
| #14 | Verify on a real SW120277 |
| #15 | The outlet's tap-state inference on a real unit |
| #16 | FS1-Z, fan and KP keypad leads |
| #18 | Herdsman drift (the canary) |

Archived issues 70-86, 88, 96 and 99 were built by archived PR 100 (merged 2026-11-10). Archived issues 51, 55, 56,
59, 63 and 65 are closed.

## Not doing

- **A settable dimming phase (`plm`)** until a test proves it safe: the wrong phase can stress a load.
- **Any write to `c4.dmx.bl`, `c4.dmx.rbp` or `c4.dm.frs`.**
- **`c4.dmx.btn <wire> 01 05`** ("disabled"), which makes every tap a phantom double tap.
- **Persisting the automatic-reboot counts** across restarts (ADR 0006 consequences): not worth a store change yet.

## Done when

- Phases 1-5 are merged or declined, and each built item passes its check at the test site. (Done, but for #12.)
- The Gen3 Reboot button and automatic reboots are built (#12).
- Every model's row in the README's Supported devices table names what it exposes, with nothing wrong.
- Phase 6 items are tested, or still listed with their test, and each model's research map says which.
