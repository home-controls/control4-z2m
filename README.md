# control4-z2m

Control4 Zigbee devices on **stock Zigbee2MQTT** — a port of
control4-zha-quirks, a ZHA quirks package for the same devices, that behaves the
same way: same devices, same buttons and gestures, same LED engine, same
remote LCD menus, same settings, same Home Assistant blueprints and scripts.

It is two files dropped into the Zigbee2MQTT data directory — no fork, no
custom Docker image, so it works with the Home Assistant add-on:

| File | What it does |
|---|---|
| `dist/external_extensions/control4.mjs` | The runtime: receives the Control4 profiles (0xC25C / 0xC25D / 0xC25E) straight from the Ember stack, answers check-ins with the controller identity, learns each device's model, link health, LED engine, remote LCD, Z2IO, bridge requests. |
| `dist/external_converters/control4.mjs` | The device definitions: exposes, actions and `/set` keys for every model. Each converter hands the request to the extension. |

## Requirements

- **Zigbee2MQTT 2.x** (tested in-process against 2.14.2).
- **An Ember coordinator** (Silicon Labs EFR32: SkyConnect / ZBT-1, Sonoff
  ZBDongle-E, …) with `serial.adapter: ember`. Control4 devices speak on
  their own profiles; the extension reads and writes those through the Ember
  stack. Older EmberZNet firmware (before 7.4, e.g. EM35x NCPs on EZSP 8)
  works through the legacy `serial.adapter: ezsp` driver. zstack (TI),
  deCONZ and zigate are **not** supported — the extension logs an error and
  stays passive there.

## Install

1. Put the two files into the Zigbee2MQTT data directory, keeping the folder names:

   ```
   <data>/external_extensions/control4.mjs
   <data>/external_converters/control4.mjs
   ```

   `<data>` is the folder holding `configuration.yaml`. In the Home Assistant
   add-on that is `/config/zigbee2mqtt` (seen from the Samba / File editor
   add-ons as `config/zigbee2mqtt` or `homeassistant/zigbee2mqtt`).

   The files come from the [GitHub releases](https://github.com/home-controls/control4-z2m/releases).
   Each release is a version, tagged `v<version>` and titled "control4-z2m
   <version>"; the instance's status (below) reports that version, and the
   build its notes name, once it runs those files. A release holds:

   | Asset | |
   |---|---|
   | `control4-z2m.zip` | both files under their folder names: unzip it into `<data>` |
   | `control4-extension.mjs` | save it as `<data>/external_extensions/control4.mjs` |
   | `control4-converter.mjs` | save it as `<data>/external_converters/control4.mjs` |
   | `SHA256SUMS` | the SHA-256 of each of the three |

   The newest release is always at
   https://github.com/home-controls/control4-z2m/releases/latest/download/control4-z2m.zip.
   Copying the two files from a checkout's `dist/` works as well (they are
   committed, and CI checks they match the source).

2. Make sure `configuration.yaml` has

   ```yaml
   serial:
     adapter: ember
   advanced:
     enable_external_js: true
   ```

   With `enable_external_js` off, Zigbee2MQTT loads nothing from
   `external_extensions/` or `external_converters/`, and its API for saving
   them (`bridge/request/extension/save`, `converter/save`) is gone too; the log
   says `External JS (converters/extensions) is disabled`. A fresh install of
   Zigbee2MQTT 2.11 or later writes it off, so set it by hand. A
   `configuration.yaml` without the key has it on.

3. Restart Zigbee2MQTT. The log shows
   `Control4: extension started: first start since Zigbee2MQTT started (control4-z2m <version>, ember, N devices, store …/control4/control4.json)`,
   and the instance's status (below) shows its version and build with no `problems`.

Settings the extension keeps (learned models, LED colours, fades, paddle
options, Z2IO mode, …) live in `<data>/control4/control4.json`.

To update every instance on a site without restarting any of them, run
`tools/deploy.mjs` against that site's Home Assistant (try `--dry-run` first):

```
HA_URL=http://<ha-host>:8123 HA_TOKEN_FILE=token.txt node tools/deploy.mjs --dry-run
HA_URL=http://<ha-host>:8123 HA_TOKEN_FILE=token.txt node tools/deploy.mjs
```

It pushes both files to one instance at a time through Zigbee2MQTT's own API
(`bridge/request/converter/save`, then `extension/save`). Zigbee2MQTT loads them
in place while it and the coordinator keep running. A push counts only when the
instance's status (below) reports the new build with no new problem. One that
doesn't is undone: the instance gets back the files it had before, and the run
stops. An instance already on the build is skipped. One with
`enable_external_js` off, or without the two files, is only listed: install it
by hand as above. The run ends with a table of each instance's build before and
after.

A hot-load, whether from the tool or a save on Zigbee2MQTT's Extensions page,
leaves the radio quiet. The devices already running skip the work a restart does
for each of them: keypad identity sends, the start-up state reads, Z2IO
set-up and remote commissioning. A device that joins, rejoins or announces after
the hot-load still gets its own, and a DIM1-Z whose settings were never read
still has them read (below). The log line `Control4: extension started: …`
says which kind of start it was (`first start since Zigbee2MQTT started`, or
`hot-load, without the start-up identity sends, …`). A build that changes that
start-up work applies it at the next restart.

Copying the new files over the old ones and restarting still works. Copy both,
from one release or one checkout: the status then shows the release's build, or
the build `node tools/build-id.mjs` prints for that checkout's `dist/`.

## Pairing

Permit join in Zigbee2MQTT, then pair the device with its buttons. The tap
sequences are the same on every Control4 Zigbee wall device ("top" is the top
paddle or top-most button, "bottom" the bottom-most):

1. **13-4-13** (13 taps on top, 4 on the bottom, 13 on top) resets the device
   and takes it off the network it was on.
2. **4 taps on top** then put it in pairing mode, and it joins the network that
   is open.

A Control4 device never answers the standard Zigbee interview, so it
first shows up as **C4-Zigbee** (generic); its next check-in (seconds to a few
minutes) carries the real model and the device is re-resolved to its full
definition automatically. To skip the wait, set it by hand:
`<base>/<device>/set` (or `control4/<ieee>/set`) `{"c4_model": "C4-DIM1-Z"}` (or the bridge request
`set_model`, below).

**A model not in the table below** stays **C4-Zigbee**, and its **Reported model**
entity names what it checked in as. It is still kept on the network (its check-ins
are answered), `c4_get` / `c4_send` still reach it, the frames it sends are logged
at info (`Control4 UNSUPPORTED …`; the first 500 after each start, the rest at
debug), and about 30 s after it appears a one-time,
read-only fingerprint read logs which protocol it speaks. Those log lines are what
adding the model takes (`docs/research/unsupported-models.md`). Once a
build supports it, the device is adopted with no re-pairing.

## Supported devices

Models marked **untested** run on code written from notes, with no unit to try it on. To test one, or a model
that isn't listed, follow `docs/TESTING.md`: it says what to do and what to send back.

| Model (also matches) | Kind | Highlights |
|---|---|---|
| C4-APD120 (-B, -W) | Adaptive phase dimmer | light, on/off fades, hardware fades for a `transition`, ramp table, dm.tv limits, cold start, settings read from the dimmer, button behaviour per paddle half, multi-click times, top and bottom LEDs (colours, mode, LED engine), ambient light, power, voltage, current, energy, dimming phase, fault, reset reason, TX power, Reboot button and automatic reboots |
| C4-DIM1-Z (-B, -W, -AL), DIMZ-1B1 | Dimmer | light, fades, hardware fades for a `transition`, ramp table, dm.tv limits, cold start, paddle local control, 4 LED colours, LED engine, settings read from the dimmer, Reboot button and automatic reboots |
| C4-SW120277 (-B, -W) | Switch | on/off, button behaviour per paddle half, multi-click times, top and bottom LEDs (colours, mode, LED engine), ambient light, power, voltage, current, energy, fault, reset reason, TX power. **Untested**: built from the ZHA-era notes, no unit available to verify on (issue [#14](https://github.com/home-controls/control4-z2m/issues/14)) |
| C4-FS1-Z | Switch | on/off |
| C4-4SF120 | Fan speed controller | fan on/off + speed 1–4 |
| LOZ-5S1-W | Dual outlet | `state_l1` / `state_l2`, outlet buttons (`outlet_1` / `outlet_2`) |
| LOZ-5D1-W | Dual dimmable outlet | a light per outlet (`state_l1` / `brightness_l1`, `state_l2` / `brightness_l2`), hardware fades for a `transition`, outlet buttons (`outlet_1` / `outlet_2`). **Untested**: built from other projects' notes |
| C4-V-ROSW120 | Receptacle outlet switch | on/off (read back after each command: it never reports), its button (`button_1`). **Untested** |
| C4-KC120277 (-B, -W), KPZ-6B1-C | Configurable keypad | the fitted buttons only (learned, or the `button_layout` option), per-button idle/pressed colours and LED mode, LED engine, backlight colour and brightness, multi-click times, ambient light, reset reason, TX power, Reboot button and automatic reboots |
| C4-KD120, C4-KD277, C4-KD240 | Keypad dimmer | the APD120's light and settings plus the KC120277's keypad, each button's behaviour toward the load (`button_position_N_behaviour`; every button toggles from the factory), a wired auxiliary keypad as `aux_top` / `aux_bottom`, hardware fades for a `transition`, settings read from the device, ambient light, power, voltage, current, energy, dimming phase, fault, reset reason, TX power. **Untested**: built from other projects' notes, no unit to verify on |
| C4-FPD120 | Forward phase dimmer | as the APD120 (another project runs it on the same definition). **Untested** |
| KPZ-3B1 / C4-KP3-Z (-B, -W, -AL, -BL, -x), KPZ-6B1 / C4-KP6-Z (-B, -W, -AL, -BL, -x) | Keypads | per-button idle/pressed colours, LED engine |
| C4-KP2-Z | Keypad | as the KP3-Z, two buttons. **Untested** |
| C4-Z2IO-ZP | Contact / relay I/O | io_mode, relays, pulses, contacts, temperatures, humidity |
| C4-SR250B (C4-SR250) | LCD remote | buttons, battery, room name / active source on the LCD, list menus, display messages |
| C4-SR260 | LCD remote | as SR250 plus glyphs, `show_message` and the text colour (`text_color`) |

**SR260.** What it does on the wire (commissioning, waking, the identity read,
menus, the text colour) is in `docs/research/sr260-remote.md`. Setting one up to
drive a media player with the three SR260 blueprints, Apple TV command strings
included, is in `docs/guides/sr260-media-player.md`.

**Low-wattage loads on a DIM1-Z.** The DIM1-Z is rated for loads of 25 W and
up; a lighter LED load can flicker at the bottom of the range or fail to start
at a low level. Raise `min_brightness` until the low end stops flickering. If
the light does not come on cleanly from off, set `cold_start_level` above
`min_brightness` and `cold_start_time` to a few hundred ms (40 % for 500 ms,
with min brightness at 20 %, fixed a light LED load): turned on from off, the
dimmer starts at that level, holds it, then goes to the level asked for. Both
are 0 (off) from the factory.

**A DIM1-Z's settings come from the dimmer.** About 30 s after Zigbee2MQTT
starts (or the extension hot-loads), after the start-up state reads, each DIM1-Z
whose settings were never read has them read once: default-on brightness, both
fades and paddle local control from `c4.dm.is`, the rest from its `c4.dm.tv`
slots. Its entities then show what the dimmer holds, and the log names any value
that differs from what they showed. A dimmer that leaves the network, or arrives
from another instance, is read again: it may have been reset to pair. Until its
first read a DIM1-Z shows its factory values (min 0 %, max and default-on
100 %, hold ramps 5 s, cold start off) and the extension's default fades, 0.8 s
on and 2 s off. Those two were never measured: the dimmers read so far hold
0.5 s each.

**DIM1-Z tap sequences and radio.**
- **15 taps on the top paddle** reboot it, keeping its settings, as its Reboot
  button does.
- **13-4-13**, then 4 taps on top, resets it and pairs it again, as on every
  model (Pairing, above). **9-4-9** (9 top, 4 bottom, 9 top) also resets it to
  pair.
- **5-5-5** is the only reset Control4 documents for this generation (it
  "clears all your network connections"). It is untried here.
- **Antenna:** a DIM1-Z has a whip antenna coiled under its button. Pulling it
  out is worth trying on one that keeps dropping off, before moving routers.
- **Zigbee scenes don't work** on a DIM1-Z: it answers the Scenes cluster but
  stores and recalls nothing.

The research map has the details.

**A DIM1-Z can be rebooted remotely.** Its **Reboot** button (`/set`
`{"reboot": "reboot"}`) sends `0i c4.dm.rb`: its LEDs flash green, then white,
and it is back in about 2 s with its light at the same level and every setting
kept. It sends no reply, and Zigbee2MQTT may log the frame's delivery as failed:
it restarts on receipt. The extension also reboots a DIM1-Z on its own:
when it is listed under `devices_unreachable`, and at its later missed
keepalives; and when it re-joins 3 times within 3.5 hours of its last reboot
(stuck re-joining), 30-60 s after the third announce. A dimmer gets at most 3
of these in any 24 hours, an hour or more apart (a count in memory, which a
Zigbee2MQTT restart starts again), and the instance at most one a minute.
None goes out while the instance reports `no_frames` or `sends_failing`, or
while more than 3 devices are unreachable at once: then every dimmer looks
unreachable, and the fault is not theirs. Each one is logged at warning. The
device option `auto_reboot: false` stops them for that dimmer; its Reboot
button still works.

**A KC120277 or APD120 can be rebooted remotely too**, with `0i c4.sy.rb`
(the frame-type survey rebooted one of each). Unlike the DIM1-Z, it answers
before it restarts. It sends no device announce, so the extension reads its
reset reason again about 10 s after the reboot. An APD120's energy counter
falls to its last save; the energy total carries on from where it was. The
Reboot button, the automatic reboots, their limits and `auto_reboot` work as
for the DIM1-Z. The SW120277, the KD120 and the FPD120 are untested, so they get
neither.

**The KC120277, APD120 and SW120277 (one board).** The untested FPD120 runs
as an APD120. The untested KD120 takes the APD120's dimmer side (its `tv`
table and dimming phase read from it, fault, power and energy) and the
KC120277's keypad side (buttons, LEDs, backlight), with each position's button
behaviour read in place of the paddle halves'; health, multi-click times and TX
power as on both.
- **Settings from the device.** About 30 s after a start, each one whose
  settings were never read has them read once: multi-click times, LED modes,
  radio TX power, firmware and bootloader versions, and on an APD120 its whole
  `tv` table in one `c4.dm.is` Get (min, max, default-on, fades, hold ramps,
  cold start) and its dimming phase; on an APD120 / SW120277 each paddle half's
  button behaviour; on a KC120277 its backlight. As on the DIM1-Z, the log
  names what differed, and a device that leaves or arrives from another
  instance is read again. Until then an APD120 shows its own factory values
  (min 10 %, hold ramps 5 s).
- **Health.** At each start and re-join it reads why it last restarted
  (`reset_reason`, EmberZNet's code in brackets: `software: reboot (SW RBT)`,
  `crash: assert (CRS AST)`, `power on (PWR)`, …), logged at warning on a crash
  or watchdog. An APD120 / SW120277 / KD120 also reports a `fault` (a short
  circuit or an overload on its load).
- **Power and energy.** `power` is the load's real watts, with `voltage`,
  `current`, `power_apparent` and `power_factor`, from each level report and a
  poll. `energy` (kWh) is the device's lifetime counter, about 1.27 Wh a count,
  for the Energy dashboard (Zigbee2MQTT creates the power factor entity
  disabled; enable it in Home Assistant if you want it). The counter falls back to its last flash save when
  the device reboots, so the extension keeps an offset and the total never
  falls. **Upgrading:** the old `device_temperature` entity (it was this
  counter, shown as °C) becomes unavailable: delete it, and its statistics, in
  Home Assistant.
- **Button behaviour.** Each paddle half has a `top_button_behaviour` /
  `bottom_button_behaviour`: `load_on`, `load_off`, `toggle`, `momentary` (dims
  while held, back on release) or `event_only` (only sends its taps). Factory:
  top `load_on`, bottom `load_off`. "Disabled" is left out on purpose: it makes
  every tap a double tap. On the SW120277, `paddle_local_control` stays as a
  /set key (on = the factory behaviours, off = both event-only). An APD120's
  light state comes only from its own level reports, so a toggling or
  event-only half shows right. A KC120277 has no load: all its buttons are
  event-only, and the extension leaves them so.
- **LEDs.** An APD120 / SW120277 has two LEDs: `led_top_…` (slot 01) and
  `led_bottom_…` (slot 04), each with an on colour, an off colour and a mode.
  Their colours saved under the old 12-slot keys move to these. Each LED mode
  (`led_top_mode`, `led_N_mode` on a KC120277) is `follow_load` (on colour while
  the load is on, off colour while off; what Control4 provisions on a paddle),
  `push_release` (the pressed colour while its button is held; a keypad's) or
  `programmed` (a colour from outside). `led_N_bound` stays as a key: on =
  `push_release`, off = `programmed`. A status colour (`led_status`) on a
  follow-load LED is one frame: the LED switches to programmed for it, and back
  to follow load when the status clears. Over a restart it keeps showing the
  status colour, as every LED keeps what it shows, until the next clear. An LED
  whose mode isn't read yet gets the colour without its mode changing. There is
  no pressed colour in programmed mode.
- **The KC120277's buttons.** The keypad can't report its kit of buttons (37
  layouts). The extension learns it from the buttons it sends from, so press
  each one once after pairing, or set the `button_layout` option to their
  positions from the top (`1, 3, 5` for three double-height buttons). Once known,
  only those buttons get actions and only their LEDs get entities, each named
  for the button it lights, a double-height button's second slot too.
  `button_numbering` gains `fitted`: the buttons `button_layout` lists are
  numbered 1, 2, 3 from the top, and a button it doesn't list after them (with a
  warning to add it). Without `button_layout`, `fitted` numbers as `slots`, so
  learning a new button never renumbers the others. `backlight_color` (off
  turns it off) and `backlight_brightness` set the light behind the engraving.
- **TX power.** `tx_power`, -8 to +2 dBm (Control4 provisions 0). A value set
  here is put back after a re-join if the device has lost it.

**Hardware fades.** A `transition` sent to a DIM1-Z, APD120, FPD120 or KD120
(for example `light.turn_on` with `transition: 30`) is one `0i c4.dm.rtl` frame:
the dimmer fades itself for exactly that long, at any length. Without a
`transition` the dimmer uses its own stored fades, as before. The target is held
to the dimmer's min and max brightness, and a transition sent mid-fade is timed
from where the load has got to. One exception: a turn-on from off on a dimmer
with a cold start set uses the level command, because a hardware fade skips the
cold start (tested on a DIM1-Z). A LOZ-5D1-W fades each outlet the same way
(`0i c4.dm.rtl <outlet> …`, up to an hour); without a `transition` it is sent
the level (`c4.dm.tv`). Only the DIM1-Z and APD120 have been tested.

**A command in the first seconds.** Zigbee2MQTT takes MQTT commands a few
seconds before the extension is running. A /set or /get in that window now
waits up to 15 s for it, so an automation's command right after a restart isn't
lost.

## Status and plans

Questions, setups to share and ideas go in [GitHub Discussions](https://github.com/home-controls/control4-z2m/discussions);
bugs, device reports and planned work in [issues](https://github.com/home-controls/control4-z2m/issues).

What each model can do, what the extension exposes of it, and what is left are
written down outside this README:

| Where | What |
|---|---|
| `docs/research/dim1z-capability-map.md` | The DIM1-Z, probed and tested: every readable name, the `tv` table, setting the level with `tv 00`, hardware fades (`0i c4.dm.rtl`), the remote reboot (`0i c4.dm.rb`), and Control4's docs and other people's work for this generation |
| `docs/research/kc-apd-sw-capability-map.md` | The same for the KC120277, APD120 and SW120277 (one board, three fit-outs): button wires, LED slots and modes, button behaviours, backlight, ambient light, power telemetry, reset reason, and the write tests |
| `docs/research/sr260-remote.md` | The SR260 on the wire: commissioning, waking, the identity read, menus, the text colour |
| `docs/research/unsupported-models.md` | Models people have that aren't supported yet: what each is, what is known of how it talks, and what adding it takes |
| `docs/guides/sr260-media-player.md` | Setting up an SR260 for a media player with the three SR260 blueprints, Apple TV command strings included |
| `docs/plans/device-completion.md` | The plan that makes every model complete, phase by phase |
| `docs/plans/frame-type-survey.md` | The plan for finding the commands the devices take that no Get shows |
| `docs/plans/c4-device-rules.md` | The plan behind testing c4_device's rules where they live (Development, below) |
| `docs/plans/ha-updates.md` | The plan for installing and updating control4-z2m from inside Home Assistant: one update entity, files sent over MQTT, local edits left alone |
| `docs/TESTING.md` | Testing a device: what to try on each model and what to report |
| `docs/adr/` | Decisions that would surprise a reader, such as ADR 0006, the automatic remote reboot |
| `GLOSSARY.md` | The words used here: button wire, button behaviour, LED slot, LED mode, unreachable, remote reboot, … |

What is left is in the plan and in this repo's issues: [#6](https://github.com/home-controls/control4-z2m/issues/6) maps what each model still needs to be
complete, [#7](https://github.com/home-controls/control4-z2m/issues/7)-[#16](https://github.com/home-controls/control4-z2m/issues/16) are the research and verification items (some need a person at a device, or a
model no unit has been available to test, such as an SW120277 or an auxiliary keypad), [#18](https://github.com/home-controls/control4-z2m/issues/18) is the
herdsman drift canary, and [#19](https://github.com/home-controls/control4-z2m/issues/19) is about how to contribute. Older docs and commit messages use issue
numbers up to #118 from an archived tracker; those are not this repo's issues, and this README
calls them "archived issue N".

## MQTT API

### Actions

Button gestures are published as `action` = `<button>_<gesture>` (also on
`<base>/<device>/action`, and as Home Assistant device triggers), with the ZHA
names alongside: `action_button`, `action_gesture`, `action_command`
(`remote_button_double_press`, …) and `action_button_id`.

| Gesture | ZHA command |
|---|---|
| `press` | `initial_switch_press` |
| `release` | `remote_button_short_release` |
| `single` / `double` / `triple` / `quadruple` | `remote_button_short_press` / `_double_press` / `_triple_press` / `_quadruple_press` |
| `hold` / `hold_release` | `remote_button_long_press` / `remote_button_long_release` |
| `fast_single` … `fast_quadruple` | `remote_button_fast_short_press` … (taps counted inside the device's tap window, 0.55 s by default) |
| `tap_known` | `remote_button_tap_known` |

Buttons: `top` / `bottom` (APD120, FPD120 and SW120277 paddles), `top` `high`
`medium_high` `medium_low` `low` `off` (fan), `button_1`… (keypads, KC120277,
KD120, DIM1-Z, FS1-Z), `aux_top` / `aux_bottom` (a KD120's wired auxiliary
keypad), `button_1` (ROSW120), `outlet_1` / `outlet_2` (LOZ-5S1-W, LOZ-5D1-W),
and the SR250 / SR260 key names (`select`, `up`, `play`, `watch`, `page_up`, …;
`SR250_BUTTONS` / `SR260_BUTTONS` in `src/core/constants.ts`).

`tap_known` announces each tap the moment it is known to be a tap, not a
hold: on the tap's release for a button already seen sending releases
(keypads, KC120277, APD120 / SW120277 paddles, fan, outlet), at paddle-down
on a DIM1-Z or FS1-Z (its hold sends `hold` / `hold_release` with no
paddle-down before it; on the FS1-Z this is assumed from the DIM1-Z, its
generation, and not yet seen on a unit).
It carries `action_tap_index`, the tap's position in its tap sequence (1 for
the first). A keypad button never seen releasing announces none (the
buttons seen releasing are kept in each device's saved settings, through a
restart), and once one tap of a sequence is not announced (or its release
is lost), none of its later taps is. The
fast counts carry `action_known_taps`: true when every tap of the sequence
was announced.

Other events: `menu_select`,
`menu_cancel`, `motion_wake`, `led_notification_start` / `_end`,
`relay_state_changed`, `contact_state_changed`. On a remote's Control4 events
entity (below), the first three are `remote_menu_select`, `remote_menu_cancel`
and `remote_motion_wake`.

### The event topic

Every action and event is also published to **`control4/event`** (and to
`<base>/control4/event`) as one JSON object, for automations that follow
several devices:

```json
{"ieee": "0x000fff0000123456", "device": "name_6e2a", "model": "KPZ-6B1",
 "action": "button_1_double", "button": "button_1", "gesture": "double",
 "command": "remote_button_double_press", "button_id": 0, "base": "zigbee2mqtt"}
```

(the `action_` prefixes are dropped, so a known tap has `tap_index` and a
fast count `known_taps`; menu events carry their own fields;
`base` is the base topic of the Zigbee2MQTT instance the device is on).
This payload is the contract between the extension and Home Assistant:
`test/fixtures/control4-event.json` holds real button-event payloads, written
and checked by the extension tests, and the blueprint and packages are
checked to read only its fields.

The same payload, with `event_type` added, also goes to the device's own
topic, **`control4/<ieee>/event`**. With Zigbee2MQTT's Home
Assistant integration on, each Control4 device that has actions gets a
**Control4 events** entity (`event.*`, MQTT discovery under
`<discovery_topic>/event/<ieee>/control4_event/config`, retained, on the
device Zigbee2MQTT created) that listens there. Its event types are the
command names, and the other fields are its attributes (ADR 0005). On an
SR250 / SR260 every event type starts with `remote_`: its keys' commands
already do (`remote_button_short_press`, `remote_button_long_press`,
`remote_button_short_release`), and its other events get it
(`remote_menu_select`, `remote_menu_cancel`, `remote_motion_wake`), so none is
a type Zigbee2MQTT's own event entity has (`experimental_event_entities`
keeps `menu_select` as it is, and `event.received` on the remote would hear
both). `command` keeps its name on both topics. The
config is cleared when the device leaves or is removed, or is set to
`homeassistant: false`.

### The shared namespace

Every Zigbee2MQTT instance running the extension also serves **`control4/…`**,
whatever its own base topic, so Home Assistant can talk to a Control4 device
without knowing which coordinator it is on:

| Topic | |
|---|---|
| `control4/event` | every instance's events (above) |
| `control4/<ieee>/event` | one device's events, with `event_type` (its Control4 events entity listens here) |
| `control4/<ieee>/set`, `control4/<ieee>/set/<key>` | handled as `<base>/<ieee>/set…` by the instance that has the device; the others ignore it |
| `control4/request/<action>` | the bridge requests below; each instance acts on its own devices and answers on `control4/response/<action>` (with its `base`). An instance that has none of the named `devices` stays silent. |
| `control4/status/<base>` | each instance's status, retained (below) |
| `control4/handoff/<ieee>/request`, `…/offer`, `…/ack`, `…/done` | between instances only: a device that joined one takes its saved settings, name and options from the one that last had it (Moving a device, below) |

The blueprints and packages here use only this namespace.

### Instance status

Every instance publishes its status, retained, on **`control4/status/<base>`**
when it starts and every minute:

```json
{"base": "zigbee2mqtt", "at": "2026-10-26T20:15:00.000Z", "version": "0.2.0", "build": "bc2a0ed1fda7",
 "contract": 1, "problems": [],
 "totals": {"sent": 1520, "failed": 3, "route_refreshes": 1, "led_queue": 0},
 "traffic": {"frame_check": "armed", "last_frame_s": 4},
 "unreachable": []}
```

- `version`: the release version of the files the instance loaded (`package.json`'s;
  `dev` when run from source). Home Assistant shows it, with the build, as the
  software version of the status entities.
- `build`: a hash of the two files the instance loaded, so instances with the
  same build run the same code. `node tools/build-id.mjs [<dir>]` prints the
  build of a checkout's `dist/` (or of a data directory's two files); `null`
  while the converter isn't loaded.
- `contract`: the number of the `control4/event` payload this build sends; it
  changes only when a field is added, dropped or changes meaning.
- `problems`: empty when all is well, otherwise any of

  | Problem | |
  |---|---|
  | `no_radio` | the coordinator isn't driven by the `ember` (or legacy `ezsp`) adapter, so the extension stays passive |
  | `interview_hook`, `ping_hook` | a herdsman hook did not install (typically after a Zigbee2MQTT update): new Control4 devices may show "interview failed", or offline with availability on |
  | `converter_missing` | the converter file isn't loaded |
  | `converter_api` | the two files come from checkouts whose extension and converter can't work together: copy both from one |
  | `no_frames` | no Control4 frame has come through Zigbee2MQTT for 30 minutes, so Control4 buttons go unheard. Zigbee2MQTT has stopped handing the frames to the extension (a herdsman, coordinator firmware or adapter change?). It clears on the next frame. Watched only while the instance has a router that answers Gets (a DIM1-Z, APD120, SW120277 or KC120277, or any other router that has answered a Get since Zigbee2MQTT started, such as a KD120 or FPD120 once its settings are read): keepalive makes those answer within ~22 minutes, while keypads and remotes alone can be quiet for hours. |
  | `sends_failing` | the last 5 sends got no delivery confirmation (no `messageSent` from herdsman), so commands to Control4 devices aren't getting through, or aren't being confirmed. It clears at the next confirmation. A dead device doesn't trip it: its sends come back confirmed as undelivered. |
  | `devices_unreachable` | a router that answers Gets (as for `no_frames`: a DIM1-Z, APD120, SW120277, KC120277, or another that has answered one) has answered none of its last 3 keepalives, so commands to it are lost; `unreachable` names it. It may still have power, work from its own paddles, check in every hour and acknowledge what is sent to it at the radio level, while its Control4 firmware answers nothing. A paddle press does not bring it back; a reboot does. A DIM1-Z, KC120277 or APD120 is normally rebooted remotely as it is listed (at most 3 times a day, an hour or more apart; see "A DIM1-Z can be rebooted remotely"); otherwise, or if it stays listed, press its Reboot button, tap the top paddle 15 times, or cut its power. It clears on the first frame it sends directly. It shows about 40 minutes after the device goes silent (keepalive starts at 20 minutes quiet and pokes every 10), or about 4 minutes after it re-joins without answering (Re-joins, below). |

  Each one logs an error when it starts and an info line when it clears.

- `totals`, since Zigbee2MQTT started: messages `sent` to Control4 devices,
  `failed` sends, the `route_refreshes` the extension asked for, and the LED
  transmit queue (`led_queue`) at that moment.
- `traffic`: whether `no_frames` is watched on this instance (`frame_check`:
  `armed` or `off`), and the seconds since the last Control4 frame
  (`last_frame_s`, `null` before the first).
- `unreachable`: the devices behind `devices_unreachable`, quietest first, each
  as `{"ieee", "name", "model", "quiet_min"}`; `quiet_min` is the minutes since
  it last sent anything directly, counted from the start if it hasn't since.
  A DIM1-Z the extension has rebooted remotely since then also has
  `reboot_min`, the minutes since the last reboot.
  The status is published again as soon as a device joins or leaves the list.

With Zigbee2MQTT's Home Assistant integration on, the same numbers appear as
diagnostic entities on that instance's **Zigbee2MQTT Bridge** device: Control4
problem (the codes in its `problems` attribute), build, contract, messages sent,
failed sends, route refreshes and LED queue. They go unavailable three minutes
after the last status, so an instance whose extension stopped, or never loaded,
does not look healthy.

To be told rather than having to look, deploy `packages/control4_instances.yaml`.
It needs neither c4_device nor the dispatcher. It raises one persistent
notification per instance, `control4_instance_<base>`, while that instance
reports any of the problems above, or once its last status is more than
5 minutes old. An ordinary Zigbee2MQTT restart stays under that. The notice
names the instance and what is wrong, and it clears by itself once neither holds.

It checks every 5 minutes, and at once when an instance's problems change or an
instance comes or goes. It dismisses only a notice it raised. For the first
5 minutes after Home Assistant starts (or the automation is reloaded), no status
counts as a silence: after a restart of the whole box the broker hands over
the retained status from before it, which can be many minutes old, until
Zigbee2MQTT publishes a fresh one. A reported problem is raised at once, start
or not.

`sensor.control4_instances` holds each instance's latest status (attribute
`instances`), its problems alone (`problems`, which changes only when they do)
and the instances whose notice is up (`raised`).

**Retiring a coordinator:** publish an empty retained message to
`control4/status/<base>`. HA then forgets that instance and its notice goes:

```
mosquitto_pub -h <broker> -t control4/status/<base> -r -n
```

### `/set` keys

Everything in the exposes, plus these command keys (`<base>/<device>/set`
with `{"<key>": <value>}`):

| Key | Devices | Value |
|---|---|---|
| `on_transition`, `off_transition` | dimmers | seconds (also written to the device's ramp table) |
| `set_ramp_rate` | dimmers | `{"index": 1-6 or 8-10, "time_ms": n}` |
| `set_on_ramp`, `set_off_ramp` | dimmers | `{"time_ms": n}` |
| `set_on_off_ramps` | dimmers | `{"on_time_ms": n, "off_time_ms": n}` |
| `set_led_color` | APD120, FPD120, DIM1-Z, SW120277, 4SF120, KC120277, KD120, KP2 / KP3 / KP6 (not the outlets, ROSW120, FS1-Z, Z2IO or remotes) | `{"button_id", "on_red", "on_green", "on_blue", "off_red", "off_green", "off_blue"}` |
| `set_led_mode` | 〃 | `{"button_id", "mode", "behavior", "color_mode"}`. On the c4.dmx models these are LED params 00-02: `mode` is the button wire a push-release LED listens to, `behavior` is the LED mode (`0` programmed, `1` follow load, `2` push-release), and `color_mode` is the load it follows |
| `set_led_all_same_color` | 〃 | `{"num_buttons", "on_red", …, "off_blue"}` |
| `set_all_led_modes` | 〃 | `{"num_buttons", "mode", "behavior", "color_mode"}` |
| `set_led_single_on` | 〃 | `{"button_id", "button_idx", "behavior_on", "behavior_others"}` |
| `led_effect`, `led_status`, `led_stop`, `led_refresh` | keypads, KC120277, KD120, DIM1-Z, APD120, FPD120, SW120277 | as the bridge requests below, for this device. On an APD120 / SW120277, LED 1 (or `top`, `button_1`) is the top LED and LED 2 (`bottom`, `button_2`) the bottom |
| `relay_N_pulse` | Z2IO | any value (the Home Assistant entity sends `"pulse"`): energise relay N, then release it after `pulse_duration` ms; `{"pulse_ms": n}` sets this pulse's length. Both are clamped to 100-5000 ms (default 500) |
| `poll` | Z2IO | any value: read the contacts, relays, temperatures and humidity now |
| `reboot` | DIM1-Z, KC120277, APD120 | `"reboot"`: restart it remotely (`0i c4.dm.rb` on a DIM1-Z, `0i c4.sy.rb` on the others), the **Reboot** button |
| `paddle_local_control` | SW120277 | `ON` / `OFF`: both halves' button behaviour at once (on = top `load_on`, bottom `load_off`; off = both `event_only`) |
| `led_N_bound` | KC120277, KD120 | `true` / `false`: LED N's mode, `push_release` / `programmed` |
| `room_name`, `active_source`, `set_room_info` | remotes | the LCD's two rows (`set_room_info`: `{"room"?, "source"?}`), kept and pushed again at each wake |
| `show_list`, `close_list`, `display_message`, `display_icon`, `gi_icon`, `gi_max_items`, `gi_reply_ep`, `gi_template`, `gi_item_template` | remotes | list menus, pop-up messages and the menu format; see `src/devices/remote.ts` |
| `show_message` | SR260 | `{"message", "icon"?, "seconds"?}` (or the message alone): a pop-up message with an optional glyph, cleared after `seconds` unless a menu is up; an empty message clears it |
| `text_color` | SR260 | the text colour: one RGB332 byte (`c4.zr.tc`; red bits 7-5, green 4-2, blue 1-0), which also sets how bright the text is. Takes `#rrggbb`, `#rgb`, a palette name, `[r, g, b]`, `{"r", "g", "b"}`, or the byte as a number or a decimal string. Input that isn't a colour is refused and the saved colour kept; empty stops re-sending it, and the remote keeps the colour it last got. The published state is the `#rrggbb` the byte shows. A set colour is sent again with every push of the LCD rows |
| `c4_model` | all | the model string, when it is not learned yet |
| `c4_identify` | all | send the controller identity now |
| `c4_send` / `send_raw` | all but remotes | `"c4.dmx.led 00 03 ff0000"` or `{"cmd": …, "dst_ep": 1, "type": "s"}` — raw Set (`"type": "i"`: interrupt, `0i`), reply in `c4_reply` |
| `c4_get` / `send_get` | all | as above, as a Get. On a remote, a name that looks like a reset, reboot, firmware, factory or erase command is refused |

The `set_led_*`, `set_*ramp*`, `send_raw` and `send_get` keys are the ZHA quirks'
LED-cluster (0xFC43) and ramp-cluster (0xFC44) commands under the same names and
fields, so `zha.issue_zigbee_cluster_command` calls port one to one.

The stored LED colours in the exposes (`button_N_…_color`, `led_N_…_color`,
`led_top_…_color`, …) write only a colour the LED does not show yet. Setting
`led_brightness` rescales every stored colour and writes the ones that change:
an off LED is black at any brightness, so a keypad with one lit LED costs two
writes, not 24, and setting the brightness it already has costs nothing. A write
still on its way counts as sent, so brightness sets that arrive back to back
(queued automation runs) write each colour once. A colour whose last write did
not go out is written again either way. A device that announces gets its next
colour written whatever it was last sent.

### Bridge requests

`<base>/bridge/request/control4/<action>`, answered on
`<base>/bridge/response/control4/<action>` (`transaction` is echoed):

| Action | Payload |
|---|---|
| `led_effect` | `{"devices"?, "effect", "color", "color2"?, "buttons"?, "speed"? (ms) or "interval"? (s), "count"?, "duration"?, "brightness"?, "priority"?, "restore"?}` — effects: solid, blink, pulse, breathe, chase, bounce, fill, alternate, rainbow, strobe |
| `led_status` | `{"devices"?, "buttons"?, "state"? (ok, on, off, idle, info, warning, alert, error, unavailable, unknown) or "color"?, "effect"?, "interval"?, "brightness"?, "pressed_color"?, "pressed_brightness"?, "clear"?}` - `buttons`: LED numbers (`"1,3"`), or button names as c4_device numbers its buttons (`"button_2"`; a paddle's `top` / `bottom` too), which the extension maps to the button's LED: on a KP3 / KP6 `button_N` is LED N, on a KC120277 it is the first slot of its pair (`button_numbering: pairs`, LED 2N-1) or slot N (`slots`), on a DIM1-Z button 1 is the top paddle; both can mix in one call. `pressed_color`: what a keypad / KC120277 button shows while pressed (default: its status colour; the DIM1-Z has none). On a DIM1-Z the paint waits until the load has stopped fading. After Zigbee2MQTT starts, only LEDs a status, a clear or an effect has named since are painted; the others keep what they show. An LED is sent only when its colour changes, so a repeated status costs no Zigbee frame: a frame that did not go out is sent again with the next `led_status`, and a DIM1-Z is read back (`c4.dm.is`) after a paint that wrote something, and again at each `led_status` until a read-back confirms it. A device that announces (back after a power cut or a reboot) has its status LEDs repainted 20-30 s later. |
| `led_stop` | `{"devices"?, "restore"?}` |
| `led_refresh` | `{"devices"?}` — re-send the status colours, changed or not |
| `set_model` | `{"device", "model"}` |
| `stats` | `{}` — per device: messages `sent` / `failed`, `last_failure_s`, `last_rx_s` (seconds since its last unicast), `keepalive_failures`; link-wide: `route_refreshes` the extension asked for, frames awaiting delivery (`tx_in_flight`, at most 4 apart from load commands) and frames waiting to go (`tx_waiting`); LED transmit queue |
| `republish` | `{}` — tells Zigbee2MQTT that every Control4 device's exposes changed, so Home Assistant discovery and `bridge/devices` follow a converter saved through `bridge/request/converter/save` (the save re-resolves the definitions but sends no discovery for them; Zigbee2MQTT's dev branch republishes `bridge/devices` after it since PR 33389, but still no discovery). Answers `{"devices": n}`, the number of devices. |

`devices` takes IEEEs or friendly names. **No `devices` key means every
Control4 device with an LED engine** (the keypads, KC120277, KD120, DIM1-Z,
APD120 / FPD120 and SW120277); an explicit empty list means none. Colours are palette
names (off, white, warm_white, red, orange, amber, yellow, lime, green, teal,
cyan, blue, purple, magenta, pink), `#rrggbb` or `[r, g, b]`. Buttons are
1-based, top first: `"all"`, `3`, `"1,3"` or `[1, 3]`.

## Home Assistant

### Blueprints (`blueprints/`)

Copy to `/config/blueprints/automation/control4-z2m/`. They use the shared
`control4/…` namespace, so a device can be on any coordinator.

> **`c4_device.yaml` hears a device through its Control4 events entity.**
> Update the extension on every Zigbee2MQTT instance, with Zigbee2MQTT's
> Home Assistant integration on, before the blueprint. It triggers on
> `event.received` aimed at the chosen device, so it needs a Home Assistant
> that has that trigger (2026.10 does), and existing automations keep their
> device. A device with no Control4 events entity raises a persistent
> notification when Home Assistant starts and when automations are
> reloaded. The dispatcher package is no longer needed by it.

> **The SR250 / SR260 blueprints hear the remote through its Control4 events
> entity too.** `c4_sr250_menu`, `c4_sr250_color_menus`, `c4_sr250_media_player`,
> `c4_sr260_media_player` and `c4_sr260_menu_dispatcher` trigger, and wait for a
> menu pick, on `event.received` aimed at the chosen remote, with the
> `remote_` event types (The event topic, above); a key on another remote or a
> keypad no longer starts a run in them. `c4_sr260_screen` also triggers on
> `event.received` (`remote_menu_select`), so update the extension before it
> too. To move an automation made from an older copy:
>
> 1. Update the extension on every Zigbee2MQTT instance, with Zigbee2MQTT's
>    Home Assistant integration on. The older blueprints keep working
>    meanwhile: `control4/event` is unchanged.
> 2. Copy the new blueprint files over the old ones in
>    `/config/blueprints/automation/control4-z2m/` (or **Re-import blueprint**
>    for one imported from a URL), then reload automations.
>
> Nothing needs re-picking: the remote input is the same. In the other order,
> a menu opens but a pick or cancel is never heard (an older extension names
> them `menu_select` and `menu_cancel` on the entity), and nothing raises a
> notification for it. The room display and now-playing blueprints only send
> to the remote and are unchanged.

`c4_sr250_menu`, `c4_sr250_color_menus`, `c4_sr250_now_playing` and
`c4_sr250_room_display` take an SR250 or an SR260; `c4_sr250_media_player`
takes an SR250 only, and the `c4_sr260_*` blueprints an SR260 only.

| Blueprint | What it does |
|---|---|
| `c4_device.yaml` | Wall-device buttons → actions, per button and gesture, on the DIM1-Z, APD120, SW120277 and FS1-Z paddles (button 1 = top, 2 = bottom), the KC120277, KP3 and KP6 keypads, the 4SF120 fan (buttons 1-6 from the top: `top`, `high`, `medium_high`, `medium_low`, `low`, `off`) and the LOZ-5S1-W outlet (button 1 = `outlet_1`, 2 = `outlet_2`); its picker offers only these (generated by `tools/gen-c4-device.mjs`); each tap wakes only its own device's automation. Per paddle half, below |
| `c4_kp_led_notify.yaml` | Keypad LED notification (ported) |
| `c4_sr250_room_display.yaml`, `c4_sr250_now_playing.yaml`, `c4_sr250_menu.yaml`, `c4_sr250_color_menus.yaml`, `c4_sr250_media_player.yaml` | The SR250's LCD rows, now playing, list menus, colour-key menus and media player keys (ported) |
| `c4_sr260_media_player.yaml`, `c4_sr260_menu_dispatcher.yaml` | The SR260's media player keys and its menu dispatcher (ported; `docs/guides/sr260-media-player.md` sets one up with these and `c4_sr260_screen`) |
| `c4_sr260_screen.yaml` | SR260 LCD colour and now playing: text colour by the media player's state, night dimming to a level or an input_number helper, an alert colour, line 2 = the player's app, back to the app a set number of seconds after a menu pick; sends only what changed, comparing the colour as the RGB332 byte. Below (written here, not ported) |

**SR260 LCD colour and now playing (`c4_sr260_screen`).** One form makes
the SR260's LCD follow a media player. The text colour is a colour picker each
for playing, paused and idle or off, and the alert colour, at full brightness,
while any alert entity is on, open or unlocked. While its **Dark** entity is on
the colours dim to the night level: the remote's text colour (`c4.zr.tc`, one
RGB332 byte) also sets how bright the text is. The level is a percentage or an
input_number helper, to tune it from a dashboard. RGB332 has 8 levels of red
and green and 4 of blue, so not every step shows, and a lit channel never dims
below the remote's lowest step: the text dims, it never goes black. Line 2
(optional) shows the player's app, like `c4_sr250_now_playing`; after a pick
in one of the remote's menus it shows the pick for a few seconds (**Back to the
app after a menu pick**, 0 keeps it), then the app again. It sends only what
the remote would show differently, read from the remote's text colour and LCD
source entities (the colour as the byte, whether the entity holds `#rrggbb` or
the byte), so a run that finds nothing new costs no Zigbee frame. Use it
instead of `c4_sr250_now_playing` on an SR260, not with it.

Two fixes in the ported SR260 blueprints, made by `tools/port-zha-blueprints.mjs`
so a regeneration keeps them: `c4_sr260_media_player` sends Mute only to a
volume target that can mute, one whose `supported_features` has feature 8
(`VOLUME_MUTE`) set (an Apple TV cannot, and HA refused the call on every
press), and `c4_sr260_menu_dispatcher` restarts instead of queueing, so
pressing its show key while the menu is up shows it again at once instead of a
second time after the pick.

**Paddle halves in `c4_device`.** Each half either drives its device's own
load or only sends its taps. A DIM1-Z's halves follow its **Paddle controls
local load** switch. An APD120's or SW120277's halves each follow their button
behaviour select (`select.<device>_top_button_behaviour`,
`select.<device>_bottom_button_behaviour`): `event_only` drives nothing;
`load_on`, `load_off`, `toggle` and `momentary` drive the load (factory:
top `load_on`, bottom `load_off`; a half with no select yet counts as its
factory behaviour). On an APD120 a hold on a `load_on` or `load_off` half
ramps the load itself and a `momentary` half dims while held; the SW120277 is
a relay, so nothing ramps. A half that drives its load gets no hold-to-dim from
`c4_device`; an `event_only` half is a button like a keypad's, with targets,
a Scene, hold-to-dim and its LED. A hold on a keypad, fan or outlet button
ramps its light targets bright → down, dim → up; on a paddle the top half
brightens and the bottom dims.

**LEDs in `c4_device`.** On a DIM1-Z, APD120 or SW120277, button 1 lights the
top LED and button 2 the bottom. On an APD120 or SW120277 a painted LED shows
the automation's colours instead of following the load; a half with no targets
or watches is never painted, so its LED keeps following the load. The FS1-Z,
fan and outlet have no LEDs `c4_device` drives: it only checks that it hears
them.

Besides every change of what its LEDs watch, `c4_device` works them out again
hourly, or every 30 minutes (its **LED re-check** input), in case Home
Assistant missed a change. It sends every LED's status each time; the extension
transmits only what changed, so a re-check that finds nothing new costs no
Zigbee frame. A status frame that did not go out does not wait for the
re-check: the extension sends it again by itself 30 s, 2 min and 10 min later
(the **LED self-repaint**; a DIM1-Z whose read-back got no answer is read back
again), and a device that announces (a power cut, a reboot) is repainted 20-30 s
later. (The re-check was every 5 minutes: on a site with a few dozen devices,
mostly DIM1-Zs, that was thousands of automation runs a day and a read-back for
each DIM1-Z. Every 30 minutes it was still more than half of all `c4_device`
runs.)

The SR250/SR260/LED blueprints are generated from the ZHA ones by
`tools/port-zha-blueprints.mjs` (the HA logic is untouched; only device I/O moves:
the remote's events to its Control4 events entity, what is sent to it to MQTT),
so they can be regenerated when the originals change.

### Packages (`packages/`)

Copy to `/config/packages/` with

```yaml
homeassistant:
  packages: !include_dir_named packages
```

| Package | |
|---|---|
| `control4_event_dispatcher.yaml` | Optional, for your own automations: `c4_device.yaml` no longer needs it (ADR 0005). Re-fires every `control4/event` message as the `control4_event` HA event with the HA `device_id` added, in arrival order (a queued automation). It carries the button-event contract fields (those in `test/fixtures/control4-event.json`); fields only menu or Z2IO events have are not forwarded, so read those from `control4/event`. The IEEE → device map is `sensor.control4_device_map` (attribute `devices`), rebuilt at HA start, on device registry changes and when an unknown IEEE is heard; an event whose IEEE has no HA device is dropped. Zigbee2MQTT only. |
| `control4_instances.yaml` | Optional: one persistent notification per Zigbee2MQTT instance, `control4_instance_<base>`, while it reports a problem in its status (naming any device it can't reach) or hasn't reported for 5 minutes (not counting the first 5 minutes after Home Assistant starts). Checks every 5 minutes and on a change of problems; dismisses only a notice it raised. `sensor.control4_instances` keeps each instance's latest status (Instance status, above). Needs neither c4_device nor the dispatcher. |
| `control4_led_scripts.yaml` | LED colour / mode scripts with colour wheels (generated) |
| `control4_dimmer_scripts.yaml` | Ramp times and the experimental dimmer settings (generated) |
| `control4_keypad_led.yaml` | `script.c4_keypad_led_notify`, `_selftest`, `_all_clear` |
| `control4_keypad_identify.yaml` | `sensor.c4_last_keypad_pressed` + `input_boolean.c4_identify_mode` (pop-up notification while on); the `zigbee2mqtt` attribute names the instance the keypad is on. |

Like the blueprints, the packages talk only to `control4/…`.

## Several coordinators

A big Control4 install is easier on the devices split over several
coordinators: each network carries fewer route records, fewer broadcasts and
less polling, and the extension paces each one separately. Run one
Zigbee2MQTT instance per coordinator, each with the two files installed.

**Per instance**

- Its own `mqtt.base_topic` (`zigbee2mqtt`, `zigbee2mqtt_2`, …), its own data
  directory, and `serial.adapter: ember`.
- Its own Zigbee channel, PAN ID and extended PAN ID (Zigbee2MQTT generates
  the last two). Keep the channels apart (for example 15, 20 and 25) and clear
  of your Wi-Fi.
- Permit join on **one** instance at a time: a Control4 device joins whichever
  network is open.

**Home Assistant** needs nothing per instance: the blueprints and packages
use the shared `control4/…` namespace, and the HA devices come from each
instance's discovery as usual.

**Ember stack settings.** By default the coordinator broadcasts a
many-to-one route request after every single delivery failure (at most every
5 s). On a mesh of older Control4 routers those broadcasts are the traffic
that hurts most. A `stack_config.json` next to `configuration.yaml` changes
it (missing keys keep their defaults; the start-up log shows
`Using stack config {…}`):

```json
{
  "CONCENTRATOR_MIN_TIME": 10,
  "CONCENTRATOR_MAX_TIME": 90,
  "CONCENTRATOR_DELIVERY_FAILURE_THRESHOLD": 3,
  "CONCENTRATOR_ROUTE_ERROR_THRESHOLD": 3
}
```

Restart Zigbee2MQTT after changing it. Start with these and watch failed sends
and route refreshes (on each instance's Bridge device, or per device with
`stats`) before going further.

**Polling.** The APD120 / FPD120, SW120277 and KD120 read ambient light and
power every 30 s, and the KC120277 reads ambient light every 30 s. Per device, the options
`ambient_light_poll` and `power_poll` (seconds, minimum 10, `0` = never; `power_poll` reads power and energy)
stretch or stop that; changes apply without a restart.

**Tap window.** A tap sequence stays open 0.55 s after each tap for another
one before its `fast_*` count is published. On every model with buttons except
the remotes and the Z2IO, the device option `tap_window` (seconds, 0.25-1.5;
outside that it is clamped, and a value that isn't a number means 0.55)
widens it for a room of slow tappers or narrows it for a faster single tap.
A change applies from the next tap sequence, without a restart. Under the
c4_device blueprint's Auto response, a single tap toward OFF on a button with
multi-tap actions waits out this window; a tap toward ON runs at once (early
commit, `docs/adr/0002-early-commit-only-toward-on.md`).

**Availability.** With Zigbee2MQTT availability on, the extension answers its
pings honestly: the models known to answer a Control4 Get (DIM1-Z, APD120,
SW120277, KC120277), and any other device that has answered one since
Zigbee2MQTT started, must answer one; the other mains devices (keypads, KD120,
FPD120, fan, outlets, ROSW120, FS1-Z, Z2IO, until they have answered a Get)
count as online when the Get is delivered (acknowledged by their radio) and
offline when it is not; either success refreshes `last_seen`. The battery remotes are not pinged. A frame a mains device sends
directly to the coordinator counts as "seen" (and refreshes `last_seen`), so
quiet devices are only pinged when they really went silent. Its broadcasts,
such as the hourly check-in, don't: a device that still has power but can't be
reached keeps checking in, and would otherwise show online for ten minutes
after each one. A remote counts as seen on any frame.

**Evidence in the log.** Zigbee2MQTT logs announces and address changes at
debug level only. For Control4 devices the extension logs them at info, along
with two more things worth knowing when one stops answering (archived issue 60):

- `<name> announced itself at network address N`: it re-joined or powered up.
- `<name> (<ieee>) changed network address A -> B`: it re-joined under a new
  address.
- `a Control4 frame came from network address N, which Zigbee2MQTT does not
  know`, logged once per address.
- `<name>'s controller identity (...) was not delivered`: a Control4 device
  whose check-in goes unanswered treats its controller as lost.

The addresses are decimal, as in herdsman's `Received network/route error ...
for "N"` lines, so a burst of route errors can be matched to the device that
held that address at the time.

**Re-joins.** A Control4 device whose check-in goes unanswered counts its
controller as lost and re-joins the network, often under a new address. On
2026-11-04 two DIM1-Zs did this, and their firmware stayed deaf until rebooted
(archived issue 60). So the extension never leaves a check-in unanswered, and watches
every re-join:

- **An undelivered check-in reply is retried.** The extension refreshes routes
  and asks the device for its network address (its direct reply gives the
  coordinator a fresh route), then sends the identity again after 3 s and after
  another 10 s.
- **A check-in from an address Zigbee2MQTT doesn't know yet is answered at
  once,** by that address, while Zigbee2MQTT looks the address up.
- **A device that announces itself gets the identity** three times, 4 s apart,
  starting 2–7 s in.
- **A router that answers Gets and re-joined must answer again** (a DIM1-Z,
  APD120, SW120277, KC120277, or another that has answered a Get). It
  gets a Get 2 minutes after its announce and another at 4 minutes. If it
  answers neither, it's listed under `devices_unreachable` straight away, with
  the reboot advice, instead of after about 40 minutes of missed keepalives.
  Its next direct frame clears it. A DIM1-Z, KC120277 or APD120 is rebooted
  remotely then.
- **A DIM1-Z, KC120277 or APD120 that keeps re-joining is rebooted.** At its
  third announce within 3.5 hours, it gets its reboot frame 30-60 s later (after its identity sends),
  within the limits above. The count starts again after any reboot, its
  Reboot button's included. `auto_reboot: false` stops it.

**Moving a device** to another coordinator: pair it on the new instance,
removing it from the old one first if you can. Nothing to stop and nothing to
run. When it joins, the new instance asks the others over `control4/handoff/…`,
and the one that had the device last hands over:

- its saved settings (learned model, LED colours, fades, paddle options, Z2IO
  mode, remote rows, …), which replace whatever the new instance held for it;
  a value set on the new instance since the join wins;
- its friendly name (kept as the IEEE if that name is taken on the new instance,
  with a log line saying so);
- its whole Zigbee2MQTT device options block: `homeassistant` overrides,
  `filtered_attributes`, `tap_window` and the extension's other options.

The learned model applies at once, so the device skips the C4-Zigbee wait. A
moved device keeps its LED colours and gets no LED defaults. The old instance
then drops its saved settings. If you re-paired the device without removing
it, the old instance also force-removes its record, so it stops answering
`control4/<ieee>/set` and stops republishing discovery over the new instance's.
Values are stored only: nothing is written back into the device.

What doesn't follow: the device's Home Assistant entities are new, since
Zigbee2MQTT's `unique_id` carries the base topic. They come back under
Zigbee2MQTT's default entity ids through the carried name, so an entity id
you changed in Home Assistant has to be changed again.

Only an instance that has had the device in its own Zigbee2MQTT answers. A copy
left by the ZHA import or `--copy` never does. When the old instance is down, no
one answers within a few seconds and the device starts as new. That is the one
case left for `move-c4-settings`, with both instances stopped:

```
node tools/move-c4-settings.mjs <old-data-dir> <new-data-dir> 0x000fff0000123456 --dry-run
node tools/move-c4-settings.mjs <old-data-dir> <new-data-dir> 0x000fff0000123456
```

The import from ZHA (below) can be run into each instance; each one only uses
the entries of the devices it has.

## Moving from ZHA

1. Note what you want to keep, then stop using the devices in ZHA.
2. Pair them to Zigbee2MQTT (a different coordinator / network means
   re-joining each device).
3. Bring the quirks' settings over — learned models, LED colours, fades,
   paddle options, Z2IO mode, SR250 room — with Zigbee2MQTT stopped:

   ```
   node tools/import-zha.mjs <ha-config>/.storage <zigbee2mqtt-data> --dry-run
   node tools/import-zha.mjs <ha-config>/.storage <zigbee2mqtt-data>
   ```

   Values already set on the Zigbee2MQTT side win; a backup of the old
   `control4.json` is kept.
4. Swap ZHA blueprints / scripts for the ones here. The entities change
   names (`light.<friendly_name>`, …); automations that use device triggers
   need re-picking.

## Differences from the ZHA quirks

- No periodic many-to-one route request pump: the Ember stack's concentrator
  already sends them; the extension only adds a rate-limited one (60 s) when a
  send to a Control4 device fails.
- The FS1-Z capture mode is not ported.
- A few latent bugs in the ZHA blueprints are fixed in the ports (optional
  target inputs default to `{}`; the room display's room helper defaults to `[]`).
- `control4_keypad_identify` also creates the identify-mode notification
  automation its ZHA original only described.
- The sensor's `button` is the button name (`button_3`) rather than ZHA's
  endpoint arithmetic; `button_id` carries the raw id.
- Beyond the quirks:
  - every Control4 device's availability comes from its answering;
  - unreachable devices are listed in the instance status, with an HA notice;
  - a DIM1-Z's settings are read from it;
  - a DIM1-Z, KC120277 or APD120 has a Reboot button and is rebooted when stuck;
  - `c4_send` can send interrupt (`0i`) frames.

## Development

Contributions come as pull requests from a fork. `CONTRIBUTING.md` has the
workflow, what a pull request needs, and the privacy check: install its pre-push
hook once per clone (`git config core.hooksPath tools/hooks`), and keep people's
names, room names, hostnames and addresses out of files, commits, issues and PRs.
The repo is public, history included. Issue [#19](https://github.com/home-controls/control4-z2m/issues/19) is about how to contribute.

Building and testing needs Node.js 20 or later (CI uses 22). `dist/` is
committed, but only by a release: it is the last release's build, and a change to
`src/` leaves it out (ADR 0008). Code style: [docs/CODE_STYLE.md](docs/CODE_STYLE.md).

```
npm install
npm run check        # lint + typecheck + build + unit tests
npm run lint         # the code convention (Biome; docs/CODE_STYLE.md)
npm run format       # fix formatting and import order
npm run build        # bundle src/ into dist/
npm test             # unit tests (vitest)
npm run typecheck    # tsc --noEmit
npm run test:z2m     # the built files inside a real Zigbee2MQTT 2.14.2 (clones it to the temp dir)
npm run canary -- dev   # the checks against the herdsman Zigbee2MQTT dev pins (or `release`)
```

c4_device's rules (which event runs a tap, early commit, holds, the LED
colours) are tested where they live: `test/c4-device.ts` renders the committed
`blueprints/c4_device.yaml` as Home Assistant would, with minijinja-js standing
in for its Jinja, for one thing happening to one device
(`c4Device({...}).on(knownTap(2)).does`). A conformance probe holds that engine
to a real Home Assistant: vitest renders `test/fixtures/jinja-conformance.jinja`
with it, and `tools/ha-validate-blueprints.mjs` on a live one, both against the
same expected output.

| Tool | |
|---|---|
| `tools/build.mjs` | esbuild bundles into `dist/` (zigbee-herdsman stays external) |
| `tools/release.mjs rc [patch|minor|major] | final` | cut a release pull request: the next release candidate, or promote the tested one (`npm run release -- …`, CONTRIBUTING.md) |
| `tools/build-id.mjs [<dir>]` | the build an instance running `dist/`'s two files (or `<dir>`'s) reports in its status |
| `tools/deploy.mjs [--dry-run]` | push `dist/` to every instance on a site without a restart, **by hand only**, through its Home Assistant (`HA_URL=… HA_TOKEN_FILE=…`): finds the instances from their retained `bridge/info` and file lists, first checks that Home Assistant carries both files unchanged, then saves the converter and the extension on each one in turn, proves the push by the build in its status, sends `republish`, and rolls back and stops when a push isn't proven (Install, above) |
| `tools/z2m-harness.mjs [ref]` | runs `test/z2m-harness/control4.test.ts` inside a Zigbee2MQTT checkout with its own mocks: loading, HA discovery for every family, `/set`, model learning, events, bridge requests |
| `tools/herdsman-canary.mjs dev\|release` | the herdsman drift canary: installs the zigbee-herdsman and converters that Zigbee2MQTT `dev` or its newest release pins (not saved), runs typecheck, the unit tests and the harness at that ref, then puts the repo's pins back. Nightly in `.github/workflows/herdsman-canary.yml`, where a red opens one issue here per target and pin set and a green closes it |
| `tools/privacy-check.mjs [--range a..b] [--text f]` | keeps personal details (names, rooms, hostnames, addresses) out of the repo: checks the tracked files (and a range's commit messages, or one issue or PR body) against a pattern list the maintainer keeps, the `PRIVATE_PATTERNS` secret in CI or `~/.config/control4-z2m/private-patterns.txt` locally; it reports where and which pattern, never the text. CI runs it on every push and pull request (a fork's pull request has no secrets, so it is checked again after the merge); `tools/hooks/pre-push` runs it before a push. See `CONTRIBUTING.md` |
| `tools/port-zha-blueprints.mjs <zha-blueprints-dir>` | regenerate the ported blueprints |
| `tools/port-zha-packages.mjs <zha-packages-dir>` | regenerate the generated packages |
| `tools/gen-c4-device.mjs` | regenerate `blueprints/c4_device.yaml` |
| `tools/c4-scenarios.mjs` | live scenarios on a real Home Assistant, **by hand only** (it changes real lights, then puts them back): publishes contract-fixture payloads for one device's button on `control4/event` and the device's own topic, as the extension does, and reports what its Control4 events entity saw, which targets changed and when (a tap toward ON and toward OFF, double and triple taps, a hold), the colour its LED was sent, that other c4_device automations stay idle, that an unknown IEEE starts no run (and the dispatcher, if deployed, drops it), and that the dispatcher's device map survives a rename and heals when stale (both skipped without the package): `HA_URL=… HA_TOKEN_FILE=… node tools/c4-scenarios.mjs --device "name_6e2a" [--button 1] [--only tap,known,fallback,double,triple,hold,led,idle,unknown,rename,stale]` |
| `tools/ha-validate-blueprints.mjs` | read-only check of every blueprint and package against a live Home Assistant (`validate_config` + template syntax), and that it renders the conformance probe as the tests' engine does (`test/fixtures/jinja-conformance.*`): `HA_URL=… HA_TOKEN_FILE=… node tools/ha-validate-blueprints.mjs` |
| `tools/c4-device-run.mjs` | helper module: reads one c4_device run in the domain's words (what it does, for which button, on which targets) from its top-level variables; the local render (`test/c4-device.ts`) reads its runs through it, and so could a Home Assistant trace |
| `tools/ha-calls.mjs` | helper module: one request and its answer over Home Assistant's websocket, and which `render_template` answers show a broken template; used by `ha-validate-blueprints` and tested in `test/ha-calls.test.ts` |
| `tools/jinja-conformance.mjs` | helper module: compares a rendering of the conformance probe with Home Assistant's output; used by the tests and by `ha-validate-blueprints` |
| `tools/import-zha.mjs` | the settings importer above |
| `tools/move-c4-settings.mjs` | move devices' saved settings between instances, with both stopped: only for a device whose old instance is down (otherwise the handoff does it) |

Source layout: `src/core` (protocol, transport, link health, fast taps, LEDs,
animation engine, store, runtime), `src/devices` (one class per family),
`src/z2m` (definitions, extension, converter entry points).

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

Apache License 2.0: see `LICENSE` and `NOTICE`.

Control4 is a trademark of its respective owner. This project is not affiliated
with or endorsed by Control4.