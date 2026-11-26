# Device completion: everything left to make each Control4 device complete

**2026-11-07.** This plan pulls together everything still open for every model the extension supports. Sources:
the two research maps (`docs/research/2026-11-02-dim1z-capability-map.md` and
`docs/research/2026-11-07-kc-apd-sw-capability-map.md`), the open Gitea issues, the ideation doc, and the live tests
of 2026-11-07. It orders the work so each model ends complete.

**Complete** means that for each model, every capability the hardware has is one of these:
1. exposed in Home Assistant, named for what it is, and shown as the device holds it (read back, not assumed);
2. deliberately left out, with the reason written here or in the README;
3. listed below as research, with the test that would settle it.

No known bug is left open.

**Tracked in Gitea:** map #69, with one issue per item (#70-#99). Each item below names its issue, and "Tracking" at the end lists the rest.

## Status, 2026-11-08

Built on branch `device-completion` and running in my house (build `0ed43578d0ac`):

- **Phase 0:** the harness test's timing was the canary failure, not herdsman (#55, #56, #59, #63, #65: one cause).
- **Phases 1-4, all items:** P1.1-P1.5, P2.1-P2.6, P3.1-P3.5, P4.1 (and P4.2's README note).
- **Phase 5:** P5.1 (hardware fades).
- **Other models:** the FS1-Z's taps and holds under c4_device (#51), the fan and outlet in the picker (#96), and the
  SR250 / SR260 blueprints on the events entity (#99).

**Checked on the house** (Dining Room Hanging Light, Kitchen Keypad, Garage Inside Lights, 2026-11-08):
- **APD120:**
  - **Power:** 36 W, 0.292 A and 125 V at full, from each level report.
  - **Settings read:** its tv table read in one `c4.dm.is`, as shown.
  - **Hardware fades:** to 100 % over 3 s arrived in about 3.4 s. A fade to 5 % was held at its 10 % minimum.
  - **LED status colour:** one frame on the top LED, and given back to follow load on clear (both read back).
  - **Button behaviour:** toggle, then load_off, each read back. TX power 0 dBm written and read back.
- **KC120277:** backlight colour and brightness written and read back. Layout learned as [0, 2, 4], and only those
  buttons' LEDs exposed. An LED effect on a push/release slot restored the automation's colour.
- **DIM1-Z** (Garage Inside Lights):
  - **The full-sweep rule holds:** 50 → 100 % in 4 s sent 8000 ms and arrived in 4.3 s.
  - **A mid-fade transition is timed from the last report:** 77 → 100 % in 2 s sent 8696 ms and arrived in 2.1 s.
  - **A fade from off skips the cold start:** with cold start at 60 %, it went 20 → 30 % and never touched 60 %. So
    a turn-on from off with a cold start set now uses the level command.
- **Found live:** the Gen3 board pads some replies with NULs and stray bytes after the value, and quotes text replies
  (`" SW RBT"`). A frame now ends at its first NUL, and text replies are unquoted.

**Not built, and why:**
- **P5.2 (`tv 00 00` as the level command):** not switched. The ZCL level command behaves, and `tv 00 00` is only
  needed to stop a hardware fade, which a new `rtl` or level command already does.
- **P5.3:**
  - **`l0v` / `l1v`:** they read only the colour on show, where `c4.dm.is` checks both stored colours of each LED,
    which is what a paint writes. Kept `is`.
  - **`c4.sy.info`:** the model already comes from every check-in.
  - **`t0s` in place of the two ZCL reads:** still needs its mid-fade check. The load read never runs mid-fade, so
    there is no live failure to fix; left as research.
- **Phase 6:** research, as listed below. #92 (does the remote reboot cure a stuck DIM1-Z) waits on a real stuck one;
  #93 (`0i` reboot on the Gen3 board) needs the user's go-ahead at the device.
- **The SR250 / SR260 blueprints aren't deployed to the house yet:** they need a remote at hand to check, and the old
  ones keep working with the new extension.

## Where each model stands

| Model | On the house | Done | Left |
|---|---|---|---|
| C4-DIM1-Z | 26 | Light, fades, ramps, limits, cold start, paddle local control, 4 LED colours, LED engine, settings read from the dimmer, Reboot button and automatic reboots (#66) | LED re-sends and start-up commands (P1.4, P1.5), hardware fades and small read-backs (P5), research (P6): all in "The DIM1-Z, all in one place" |
| C4-APD120 | 1 | Light, fades, ramp table, 12 LED slots, ambient light | Power and energy, settings read-back, tap-state bug, LED model, button behaviour, diagnostics, fades (P1-P5) |
| C4-SW120277 | 0 (none here) | Switch, paddle local control, multi-click times, 12 LED slots, ambient light | Power and energy, LED model, button behaviour, diagnostics; nothing verified on a unit since the ZHA era (P1-P4, P6) |
| C4-KC120277 | 2 | Events, 12 LED slots with idle / pressed colours, LED engine, ambient light | LED model, backlight, layout, diagnostics, multi-click times (P2-P4) |
| Others | see "Other models" | | |

## Phase 0: land what is built

- **Done: #66 (merged 2026-11-07).** The DIM1-Z Reboot button, automatic reboots (ADR 0006), and `c4_send`
  `"type": "i"`. The house runs it (build `342f7a3a92e1`).
- **The docs branch with this plan:**
  - both research maps;
  - ADR 0006;
  - the glossary terms: button wire, button behaviour, LED mode, unreachable, stuck re-joining, remote reboot,
    reset reason;
  - the README brought current.
- **Triage the herdsman-drift issues (#55, #56, #59, #63, #65).** All five are one harness failure:
  `sends_failing` never clears after the fan `/set` in the harness test, under Zigbee2MQTT dev pins and the 2.14.3
  release. Close four as duplicates and fix the one, so the nightly canary means something again. S.

## Phase 1: fix what is wrong today

These need no new device knowledge. Each is verified on the house after a push.

**P1.1 Real power and energy (APD120, SW120277).** M. #70
- **Bug:** `power` is field 4 of `c4.dmx.pwr`, the power factor × 1000, times 0.04247 (`SCALE_POWER`), so any load
  with a power factor near 1 reads ~42 W. `device_temperature` is field 5, a lifetime energy counter that showed
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
- **Where:** `src/devices/sensors.ts` (`PowerSensor.parse`), `src/core/constants.ts` (`SCALE_POWER` goes),
  `src/z2m/definitions.ts` (`powerSensors()`), `src/devices/dmx.ts` (`onLightState`).
- **Verify:** at full brightness the Dining Room Hanging Light reads ~35 W, not ~42, and energy ticks while it is
  on. Release note: the old `device_temperature` entity becomes unavailable, and HA's statistics for it should be
  deleted.
- **Open:** the counter's exact scale, from field 2 integrated over a day against the ticks.

**P1.2 The APD120's settings read from the device.** M. #71
- **Bug:** it shows hold ramps 4000 ms and min 5 %, Control4's provisioning values, where it holds 5000 ms and 10 %.
- **Change:** read them as the DIM1-Z does, through the state-read queue once per start and after a re-join or
  handoff. One `c4.dm.is` Get returns slots 00-0a in order, the on and off fades included. #58 did this for the
  DIM1-Z only. Factory values: min 10 %, ramps 5000 ms. Add cold start (slots 09 / 0a) to the APD120.
- **Where:** `src/devices/dmx.ts` (`Apd120`), `src/devices/dm.ts` (`readSettings`, to share), `src/devices/dimming.ts`
  (`TvParams`), `src/core/constants.ts` (an `APD120_TV_PARAMS`).
- **Verify:** its entities show 5000 / 10 % after a start, and the log names what changed.

**P1.3 The APD120's light state from its reports, never from taps.** S. #72
- **Bug:** `syncClick` publishes ON for a top tap and OFF for a bottom tap. With the top half event-only, three top
  taps left the light off and HA showed it on; a toggling bottom half flicked HA on → off → on.
- **Change:** drop the tap inference on the APD120. Its `c4.dmx.ls` reports are right and arrive within a second.
  Keep it on the SW120277 only while a half drives the load (P4.1 generalises the guard).
- **Where:** `src/devices/dmx.ts` (`Apd120.syncClick`, `Sw120277.syncClick`). **Verify:** a test per button behaviour.

**P1.4 One brightness change, one round of LED colours (every model with LED colours, the DIM1-Z included).** S. #73
- **Bug:** queued runs of the "LED look" automation each set `led_brightness` before the first had landed. The
  extension re-sent 24 of 24 colours three times and 17 once, about 90 frames for one change, because a re-apply
  compares against what was sent while writes still in flight don't count yet.
- **Change:** compare against what is queued as well as what was sent (`LedWriter.reapply` / the tx pump). Also make
  the automation's `led_brightness` a no-op when the value is unchanged.
- **Where:** `src/core/leds.ts`, `src/core/animation.ts` (tx pump), `src/devices/ledkeys.ts`.
- **Verify:** a test where three brightness sets arrive back to back and each colour goes out at most once.

**P1.5 Commands in the first seconds after a start (every model).** S-M. #74
- **Bug:** a `/set` that arrives in the ~3 s before the extension is running fails with "Control4 extension is not
  running" (#60). Home Assistant re-sends nothing, so an automation's command in that window is lost.
- **Change:** queue `/set` calls briefly (a few seconds) while the runtime starts, then run them. Refuse only after a
  timeout.
- **Where:** `src/z2m/definitions.ts` (the converter's `convertSet`), `src/z2m/extension.ts`.

## Phase 2: diagnostics (read-only, small)

**P2.1 Reset reason (KC120277, APD120, SW120277).** S. #75
- Read `c4.sy.ri` at start and after each re-join, and publish it as a diagnostic sensor.
- Decode the EmberZNet codes (`PWR`, ` SW RBT`, `CRS AST`, `WDG`, …) into words.
- Log a warning on a crash or watchdog. Both keypads here last restarted on an assert.
- The DIM1-Z answers `n01`: none there.

**P2.2 Radio TX power (KC120277, APD120, SW120277).** S. #76
- A config number on `c4.sy.zpw`, -8 to +2 dBm in signed hex. All three devices here run at 0 dBm.
- Open: whether it survives a power cut. Until that is known, re-apply the saved value after a re-join.

**P2.3 Dimming phase (APD120).** S. #77
- A read-only sensor from `c4.dmx.dim`: 01 forward phase, 02 reverse (this one), and 00 on a relay.
- `c4.dmx.plm` is the configured mode, 00 auto. Leave it unsettable until a careful test, since the wrong phase can
  stress a load.

**P2.4 Fault status (APD120, SW120277).** S. #78
- Composer shows a Fault Detection status (short circuit, overload). `c4.dmx.warn 00` is the warning the device
  announces, read now as `00 0000`.
- Publish it as a problem binary sensor, from the announcement and a read at start.
- Open: Composer's "Fault Reset" command (research, P6).

**P2.5 Multi-click times on the APD120 and KC120277.** S. #79
- They hold the same `c4.dmx.bmc` table as the SW120277, where it is already exposed.
- Reuse the SW120277's keys, read back at start.

**P2.6 Firmware and bootloader versions.** S. #80
- `c4.sy.fwv` and `c4.sy.blv` as diagnostic attributes or sensors, read once.
- The KC120277s here differ in bootloader (2.6.0 vs 4.0.10).

## Phase 3: the LED model (APD120, SW120277, KC120277)

Every item here is tested (2026-11-07).

**P3.1 LED mode per slot, replacing `led_N_bound`.** M. #81
- A select of programmed / follow load / push-release, writing `c4.dmx.led <slot> 01 <00|01|02>`. Read back at start.
- Migration: bound = push-release, unbound = programmed.
- Follow load is what Control4 sets on the paddle LEDs, and it needs no traffic from HA. On a keypad, with no
  load, it shows its load-off colour.
- Writing param 01 leaves param 02 as it was. Param 00 (the wire a push-release LED listens to) stays as the
  device has it.

**P3.2 Status colours on the APD120 / SW120277, and in one frame.** L. #83
- Today `led_status` throws for these two models, and the c4_device blueprint skips their LEDs. They have no
  animator (`src/z2m/extension.ts` around the LED bridge requests, `tools/gen-c4-device.mjs`).
- Give them one, on the two real LEDs (P3.3).
- A status colour is one frame: switch the slot to programmed and write param 05. On the APD120 and the KC120277
  it stays through load changes. In follow-load mode a param-05 write lasts only until the next load change, and in
  push-release mode it doesn't stick.
- The LED engine (`led_status`, `led_effect`) can use this on every dmx model in place of rewriting 03 / 04.
- Keep its fades: a fade is many frames, whatever the mode.
- Then add these models to c4_device's LED feedback (the blueprint's "LED follows" options).

**P3.3 Only the LEDs a model has (APD120, SW120277).** S. #82
- Expose "Top LED" (slot 01) and "Bottom LED" (slot 04), each with its colours and mode. The paint test confirmed
  them.
- Drop the other 10 slots × 3 entities, or put them behind a device option.
- Migration: the old `led_2_*` / `led_5_*` keys map onto the new ones.

**P3.4 Backlight colour and brightness (KC120277).** S. #84
- A colour entity on `c4.dmx.blc 00 05` (black = off), and a brightness number on `blc 00 03`. Both tested on the
  Kitchen Keypad.
- The table refuses out-of-range values (`blc 00 01` gives `v01`), so only these two for now.

**P3.5 The KC120277's fit-out.** M. #85
- The keypad can't report which buttons are fitted (37 layouts). Learn the layout from the button wires each keypad
  actually sends (a wire seen is a button), with a device option to name or correct it.
- Only those buttons get actions, and only those LEDs get entities.
- It replaces or extends `button_numbering`. `led_N` follows the button it lights.
- `pairSlots` in `src/core/animation.ts` is dead code from an earlier try: reuse it or remove it.

## Phase 4: buttons

**P4.1 Button behaviour per paddle half (APD120, SW120277).** M. Depends on P1.3. #86
- A select per half: load on / load off / toggle / momentary / event-only. It writes `c4.dmx.btn <wire> 01`, wires
  01 (top) and 05 (bottom). Never write `05`, which turns each tap into a phantom double tap.
- It replaces the SW120277's `paddle_local_control` (both halves event-only), and that key becomes an alias.
- Toggle, event-only and momentary were all tested on the APD120. Read the behaviours back at start.
- The c4_device blueprint generator assumes an APD120 paddle always ramps its own load
  (`tools/gen-c4-device.mjs`). Teach it the half's behaviour, so an event-only half can carry a scene like a keypad
  button.

**P4.2 KC120277 buttons.** S.
- All 14 wires are event-only (`03`), and a keypad has no load, so there is nothing to expose.
- Document that in the README, and leave the behaviour alone.

**P4.3 Auxiliary keypads (C4-KA).** Research. #87
- A KA wired to an APD120 / SW120277 controls the load without a controller.
- Whether its presses reach Zigbee, and as which wire, needs a KA on the house.

## Phase 5: fades and levels

**P5.1 Hardware fades for `transition`.** M. #88
- Send a transition as one `0i c4.dm.rtl <ch> <pct hex2> <time hex8>`, in place of a ZCL move with the device's
  stored fades. The time rule differs per family:
  - DIM1-Z: the time is a full 0-100 % sweep, so send `t × 100 / |b − a|`;
  - APD120: the time is this move's duration.
- A later level command (`0s c4.dm.tv 00 00 <pct>`) stops a fade on both.
- `FadeHold` keeps the fade window, so mid-fade reports don't bounce the brightness.
- Live tests first, on Linen Closet and the dining room: does `rtl` respect min / max (`tv 08` / `06`)? Does a fade
  from off take the cold start? Is it smooth over 30 s+?

**P5.2 `tv 00 00` as the level command.** Research. #89
- It sets the level on both families, at once. It is an alternative to the ZCL level command, if it behaves better
  mid-fade.
- Measure before switching. Open: does it use the stored fades, or jump?

**P5.3 Small DIM1-Z read-backs.** S each. #90
- `c4.dm.t0s` reads the live level in one Get, where today the extension uses two ZCL reads. Check mid-fade first.
- `l0v` / `l1v` read back the colour an LED shows now, a direct check of an LED paint in place of the `c4.dm.is`
  read-back (`src/core/leds.ts`).
- `c4.sy.info` names the model in one Get. Low value: every check-in already does.

## Phase 6: research left

Each item needs a device write, a person at the device, or hardware the house lacks.

**DIM1-Z:**
- `lt <n>`: someone at the switch, tapping and holding each half, with `lt 00` / `lt 01` = 0.
- `tv` slot 07 (`1`): Control4 never writes it.
- Zigbee groups: does a DIM1-Z follow a group command? This needs one network-wide broadcast.
- `onLevel` = 255: writable or not.
- The 5-5-5 and 13-4-13 taps: try them on one that must be re-paired anyway.
- Does `0i c4.dm.rb` cure a dimmer that is actually stuck? Watch the first automatic reboot, and keep the ZDO
  leave-and-rejoin as the fallback for a dimmer whose Control4 side won't act on it.
- Why the firmware goes deaf at all (mesh churn?, #60). Mostly outside this repo.

**KC120277 / APD120 / SW120277:**
- `0i` on `c4.dm.rb` and `c4.sy.rb`, one at a time, with the user's go-ahead and no APS ack. If one works, the
  Reboot button and the automatic reboots (ADR 0006) extend to these models. A reboot is visible as the reset reason
  changing to ` SW RBT`.
- Never `c4.dmx.bl` or `c4.dmx.rbp`: `bl` may be a bootloader entry.
- The rest of the `blc` table, in a dark and a lit room, and the ambient profile behind it (`amb 03` / `04`).
- Composer's Fault Reset command.
- `tv` slots 0b (5000) and 0c (1023) on the APD120.
- Whether TX power survives a power cut.
- The energy counter's exact scale (P1.1).
- Whether the 15-tap reboot works on these models as on the DIM1-Z: the README's advice assumes it.
- What LED param 00 means: bharat and royceybaby disagree, and on our keypads it equals the slot's own index.
- Advanced Lighting Scenes stored on the device: Control4's proxy docs push scene XML to the driver. No capture
  shows it on the wire.

**SW120277:** every finding for it comes from the ZHA-era notes or other people's units. A unit on any instance
(the second house?) is needed to confirm P1.1, P3 and P4 on it.

## The DIM1-Z, all in one place

The house has 26, more than any other model. Its research map is
`docs/research/2026-11-02-dim1z-capability-map.md`.

**Done**
- **Light:** ZCL on / off / level. Its own on and off fades are written to the dimmer, along with the hold ramps,
  min, max, default-on and cold start.
- **Settings from the dimmer** (#58): read at start and after a re-join or handoff. Until then it shows the factory
  values.
- **Paddle:** taps, multi-taps and holds, with fast counts and known taps, and paddle local control (`c4.dm.ba`).
- **LEDs:** four colours (top / bottom × on / off), LED brightness, the LED engine (`led_effect`, `led_status`) and
  c4_device's LED feedback.
- **Availability and recovery:**
  - availability from its answering, and the unreachable listing and notice (#58);
  - the checks after a re-join (#62);
  - the Reboot button and automatic reboots (#66, ADR 0006).
- **Firmware:** shown from its check-in.

**To build**
- **P1.4:** the LED re-send fix covers its LED writes too.
- **P1.5:** a command to a DIM1-Z in the first seconds after a start is lost today.
- **P5.1 Hardware fades:** `transition` sent as one `0i c4.dm.rtl`, where the time is a full 0-100 % sweep (send
  `t × 100 / |b − a|`). First, test min / max and cold start on Linen Closet.
- **P5.2:** `0s c4.dm.tv 00 00 <pct>` as the level command, if it behaves better than ZCL mid-fade.
- **P5.3:** read the live level with `t0s` in one Get, check an LED paint with `l0v` / `l1v`, and, optionally, read
  the model from `c4.sy.info`.

**Research (P6)**
- `lt <n>`;
- `tv` slot 07;
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
- **Power, ambient light, reset reason, radio TX power:** the DIM1-Z has none of them (`n01`).
- **`c4.dm.frs`:** read as a factory reset. Never written.

**Its live-test sitting** (Linen Closet, ~15 min):
- P5.1 fades: min / max, cold start, a 30 s fade;
- `lt 00` / `lt 01`, with someone at the switch tapping and holding each half;
- then, on a dimmer that needs a re-pair anyway, the 5-5-5 and 13-4-13 taps.

**Done when**
- P1.4, P1.5, P5.1 and P5.3 are merged and checked on the house.
- Each P6 item is tested, or still listed with its test.
- The README's DIM1-Z row and its research map agree with what ships.

## Other models

None of these is in my house, so each item needs a unit on some instance to verify it.

**C4-FS1-Z fireplace switch.**
- **Bug #51:** under c4_device its taps run only with the Wait response, and its holds never start. The fix:
  - emit `press` on `b<idx>c`;
  - declare `press`, the counter gestures and a `tap_window` option;
  - in the blueprint, start a hold on `hold`, and count the FS1-Z as a paddle.

  Code: `src/devices/dm.ts` (`Fs1z`), `src/z2m/definitions.ts`, `tools/gen-c4-device.mjs`. Add a test fixture, and
  fix the `family()` fallback in `tools/c4-scenarios.mjs`, which picks the KPZ fixture for any model it doesn't
  know. M. A capture from a real FS1-Z first would answer #51's open questions.
- **Research:** `0i c4.dm.rb`. It's the same generation as the DIM1-Z, so likely, but untried.
- **Not porting:** the ZHA capture mode (README, Differences).

**C4-4SF120 fan and LOZ-5S1-W outlet.**
- Neither is in the c4_device picker: their buttons need mapping to button numbers (#96, after #21). M, done together.
- Outlet: `syncClick` reads a single tap as ON and any other count as OFF. Check that on a unit.
- Leads by analogy with the other c4.dmx models, untested:
  - the fan's LED colours (only the raw LED-cluster keys today);
  - its ambient light, reset reason and reboot.

**KP3-Z / KP6-Z / KPZ keypads.** Nothing open in the issues or README. Leads from the wmariz notes, untested here:
- `c4.kp.rb 00` reboots a KP6-Z;
- `c4.kp.llm <btn> 00|01` sets keypad-managed push / release;
- `c4.kp.bhp` is the hold threshold (`01f4` = 500 ms).

The "a delivered ping counts as seen" availability path for these models has never run on this house.

**C4-Z2IO-ZP.** Nothing listed as missing.

**SR250 / SR260 remotes.** Their blueprints still trigger on the shared `control4/event` topic and filter by IEEE.
Move them to the Control4 events entity (ADR 0005), which first needs the remote event types prefixed. M.

## Open issues and where they land

| Issue | Title | Here |
|---|---|---|
| #51 | c4_device: an FS1-Z's taps run only under Wait, and its holds never start | Other models, FS1-Z |
| #55, #56, #59, #63, #65 | Herdsman drift (dev pins, the 2.14.3 release) | Phase 0, triage |
| #21 (closed) | c4_device works on every device its picker accepts | Other models: the fan and outlet join the picker in #96 |
| #60 (closed) | Its open questions | P1.5 (start-up window), P6 (why firmware goes deaf, the 15-tap reboot on Gen3) |

## Live test sessions

Each item that needs someone at the device is batched into one sitting per device, to keep the trips few:
- **APD120 (~20 min):** P5.1 fades (min / max, cold start, long fades), P6 `0i` reboot, the `blc` and ambient bytes.
- **KC120277 (~15 min):** P3.5 fit-out check, P6 `0i` reboot (reset reason before and after), the rest of `blc`.
- **DIM1-Z (~15 min, Linen Closet):** P5.1 fades, `lt <n>`, then the taps on a dimmer that needs a re-pair anyway.

## Order

Phase 1 first: it is what users see wrong today, and P4.1 depends on P1.3. Then Phase 2 (small, read-only). Then
Phases 3 and 4, which are tested and ready, one PR per model family. Phase 5 follows its live tests. Phase 6 runs
alongside as devices and sittings allow. Each item ends with its README section, its glossary terms and its
research-map entry updated in the same PR.

## Tracking

| Issue | Item |
|---|---|
| #69 | The map: every item in order, with blockers |
| #91 | DIM1-Z research leads (Phase 6) |
| #92 | Watch: does the remote reboot cure a stuck DIM1-Z? |
| #93 | Remote reboot on the KC120277 / APD120 / SW120277 |
| #94 | KC120277 / APD120 / SW120277 research leads |
| #95 | Verify on a real SW120277 |
| #96 | The fan and outlet in the c4_device picker |
| #97 | The outlet's tap-state inference on a real unit |
| #98 | FS1-Z, fan and KP keypad leads |
| #99 | SR250 / SR260 blueprints on the events entity |
| #51, #55, #56, #59, #63, #65 | Already open (FS1-Z, herdsman drift) |

## Not doing

- **A settable dimming phase (`plm`)** until a test proves it safe: the wrong phase can stress a load.
- **Any write to `c4.dmx.bl`, `c4.dmx.rbp` or `c4.dm.frs`.**
- **`c4.dmx.btn <wire> 01 05`** ("disabled"), which makes every tap a phantom double tap.
- **Persisting the automatic-reboot counts** across restarts (ADR 0006 consequences): not worth a store change yet.

## Done when

- Phases 1-5 are merged, and each passes its check on the house.
- Every model's row in the README's Supported devices table names what it exposes, with nothing wrong.
- Phase 6 items are tested, or still listed with their test, and each model's research map says which.
