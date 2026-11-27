# Testing a Control4 device

Thank you for testing. Most of the devices here were built from protocol notes, and other people's code, without
a unit to try them on. A model only becomes **supported** once someone has paired one, worked through its
checklist, and reported the results. This guide covers what to install, what to try on each device, what to
record, and how to report back.

A session takes 15-30 minutes per device. You need nothing beyond Home Assistant, Zigbee2MQTT and the device.

## How a model moves forward

| Stage | Meaning | What we need from you |
|---|---|---|
| **Unsupported** | The build doesn't know the model. It pairs as a generic **C4-Zigbee** device with a **Reported model** entity, and logs everything it sends | Part A, then Part B |
| **Untested** | The build has code for it, written from notes. It may work fully, partly, or not at all | Part A, then its checklist in Part C |
| **Supported** | Someone confirmed its checklist on real hardware | Only reports of anything that breaks |

The README's device table marks every untested model. From your report we either confirm the model, fix what
was wrong, or (for an unsupported one) write it, and then publish a new release for you to check
again.

## Before you start

1. **Zigbee2MQTT 2.x on an Ember coordinator**: a Silicon Labs radio such as the SkyConnect / ZBT-1 / ZBT-2, the
   Sonoff ZBDongle-E, or the HA Yellow. `configuration.yaml` needs `serial.adapter: ember` and
   `advanced.enable_external_js: true`. zstack (TI), deCONZ / ConBee, zigate and the legacy `ezsp` driver are not
   supported (an `ezsp` transport is in review as pull request #1).
2. **Install the latest release** from the repo's
   [Releases page](https://github.com/home-controls/control4-z2m/releases). Each release is a version,
   named "control4-z2m <version>" (tag `v<version>`):
   - Download `control4-z2m.zip` from the latest one (always at
     <https://github.com/home-controls/control4-z2m/releases/latest/download/control4-z2m.zip>) and unzip it into
     the Zigbee2MQTT data folder, the one holding `configuration.yaml` (`/config/zigbee2mqtt` in the Home
     Assistant add-on). That gives `external_extensions/control4.mjs` and `external_converters/control4.mjs`.
   - Or download `control4-extension.mjs` and `control4-converter.mjs` and save each as `control4.mjs` in
     `external_extensions/` and `external_converters/` respectively.
   - `SHA256SUMS` in the same release lets you check the downloads.

   Then restart Zigbee2MQTT. The README's **Install** section has the details. Note the version: the Zigbee2MQTT log
   says `Control4: extension started: … (control4-z2m <version>, …)`, and Home Assistant shows the **Control4
   build** sensor on the Zigbee2MQTT Bridge device, whose build matches the one in the release notes.
3. **Turn on Control4 debug logging**, for this extension only. In `configuration.yaml`:

   ```yaml
   advanced:
     log_namespaced_levels:
       z2m:control4: debug
   ```

   then restart Zigbee2MQTT. Or, with no restart, set it in the Zigbee2MQTT frontend's **Settings** page, under the
   advanced settings' **Log namespaced levels**: namespace `z2m:control4`, level `debug`. This logs every frame the
   devices send (`Control4 <name> <- ...`) and every frame sent to them (`-> ...`), and leaves the rest of the log
   at its usual level.
4. **Keep a notepad open** and write down the clock time of each step as you do it. The log is timestamped, and
   your times are how we match a line to what you did.

Nothing here writes to a device on its own beyond what any paired Control4 device gets (its check-ins answered,
its LEDs set to off once). For an unsupported model the build only asks read-only questions. To undo everything,
remove the two files and restart Zigbee2MQTT.

## Part A: pair the device (every device)

1. In Zigbee2MQTT, click **Permit join**.
2. On the device, **tap the top button 13 times, the bottom button 4 times, then the top button 13 times**
   (13-4-13). This resets it and takes it off the network it was on. On a keypad "top" is the top-most button and
   "bottom" the bottom-most one; on a single-button device, use that button for all three.
3. Then **tap the top button 4 times**. This puts it in pairing mode, and it joins.
4. It appears as **C4-Zigbee**. Within a few minutes its next check-in names its model, and the device turns into
   the full model, or stays C4-Zigbee with a **Reported model** entity if this build doesn't know it.
5. Record:
   - The model shown, or the **Reported model**.
   - The log line `Control4: learned model ...` or `Control4: <name> is a ...` (or, for an unknown model, the warning
     `... reports model ..., which this build doesn't support yet`).
   - The firmware: Zigbee2MQTT's device page shows it as **Firmware build**. The KC120277, APD120, SW120277, FPD120
     and keypad dimmers (KD120 / KD277 / KD240) also have a **Firmware version** entity; the DIM1-Z, FS1-Z and the
     KP2 / KP3 / KP6 keypads don't.
   - A photo of the device's label (model / part number) and, for any keypad, of its button layout.

If it never joins: power-cycle it (the air gap, or its breaker), then do 13-4-13 and 4 taps again with Permit join
on. A device that still doesn't join may be an early unit that doesn't speak Zigbee Pro: say so in your report.

## Part B: an unsupported device

The build logs everything this device sends and asks it a short list of read-only questions. That is usually
enough for us to write it.

1. **Wait two minutes** after it appears. Look for two log lines: `... fingerprint: ...` (the answers) and a
   hint line after it (which existing device it looks closest to).
2. **Every button**, one at a time, top to bottom: tap once, wait 3 s, double-tap, wait 3 s, hold for 3 s and
   release. Write down which button and the time.
3. **Its load**, if it has one, from the device itself: turn it on, off, dim it up and down (hold), and note what
   the load did each time.
4. **Anything else** it has: a second outlet, an LED that changes, a rocker.
5. Report it with the log (below).

If we ask for a specific question to the device, it is sent like this, from Home Assistant: **Developer tools →
Actions → MQTT: Publish**, topic `zigbee2mqtt/<device friendly name>/set`, payload `{"c4_get": "c4.sy.fwv"}`. The
answer appears in the log as `Control4 REPLY <name>: ...`.

## Part C: checklists

Checklists for the untested models, and for supported ones where something is still open. For each step, record
**pass**, **fail** or **partly**, plus the time and anything odd. "From HA" means the device's entity in Home
Assistant (or the Zigbee2MQTT frontend). Every checklist starts with Part A.

The FS1-Z fireplace switch, the 4SF120 fan controller and the KP3 / KP6 keypads have no checklist here: what is
still to learn about them is collected in
[issue #16](https://github.com/home-controls/control4-z2m/issues/16). If you have one, report it with Part A and
whatever that issue asks for.

### C4-KD120 / KD277 / KD240 keypad dimmer

| # | Do | Expect |
|---|---|---|
| 1 | Wait two minutes after pairing | A log line `settings read from the device: ...` (or `..., as shown`). Copy it |
| 2 | Tap, double-tap and hold each button, top to bottom | Actions `button_N_single` / `_double` / `_hold` / `_hold_release`, a new one appearing for each button as it is first pressed. Note which physical button gave which N |
| 3 | From HA: turn the light on, off, set 50 %, then 100 % with a 5 s transition | The light does each, and HA's state matches |
| 4 | Tap the button that controls the load (out of the box, every button does) | The light changes and HA follows within about a second |
| 5 | From HA: set a button's **Position N button behaviour** to `event_only`, tap it, then set it back to `toggle` | With `event_only` the light doesn't change but the action still fires |
| 6 | From HA: set one button's LED idle colour to red | Note which physical LED turned red |
| 7 | From HA: set **Backlight colour** to blue, then off | The engraving lights blue, then goes dark |
| 8 | With the light on: read **Power**, **Voltage**, **Energy** | Plausible values for the load |
| 9 | If an auxiliary keypad (C4-KA) is wired to it: tap its top and bottom | Actions `aux_top_single` / `aux_bottom_single`. More on the C4-KA in [issue #7](https://github.com/home-controls/control4-z2m/issues/7) |
| 10 | If it has the split up/down button: tap, double-tap and hold each half | Note the actions. **We don't know what these send yet** |

### C4-FPD120 forward-phase dimmer

It runs on the APD120's code.

| # | Do | Expect |
|---|---|---|
| 1 | Wait two minutes | A `settings read from the device` line. Copy it |
| 2 | From HA: on, off, 50 %, 100 % with a 5 s transition | The light does each; HA matches |
| 3 | Paddle: tap top, tap bottom, hold top, hold bottom, double-tap top | Actions `top_single`, `bottom_single`, `top_hold`, ...; the light reacts as the paddle should |
| 4 | From HA: set **Top LED on colour** to red, turn the light on | The top LED is red while on |
| 5 | Read **Dimming phase**, **Power**, **Voltage** | Phase `forward`. Note whether the power entities have values or stay empty |

### C4-SW120277 switch

Its code comes from older protocol notes. What is still open is in
[issue #14](https://github.com/home-controls/control4-z2m/issues/14). Use a load whose wattage you know.

| # | Do | Expect |
|---|---|---|
| 1 | Wait two minutes | A `settings read from the device` line. Copy it |
| 2 | From HA: turn it on, then off | The load switches; HA matches |
| 3 | Paddle: tap top, tap bottom, hold top, hold bottom, double-tap top | Actions `top_single`, `bottom_single`, `top_hold`, ...; out of the box top turns the load on and bottom off, and nothing ramps |
| 4 | With the load on: read **Power**, **Voltage**, **Current**, **Energy**, then send `{"c4_get": "c4.dmx.pwr"}` (as in Part B) | Copy the `REPLY` line. Note whether the entities match the load's wattage and your line voltage |
| 5 | With the load off: the same | Copy the `REPLY` line |
| 6 | Send `{"c4_get": "c4.dmx.dim"}` | A `REPLY` with `00` (a relay, no dimming phase). Copy it |
| 7 | From HA: set **Top LED on colour** to red and **Bottom LED off colour** to blue, then turn the load on and off | Top LED red while on, bottom LED blue while off. Note if the colours land on the other LED |
| 8 | From HA: set **Top LED mode** to `push_release`, press and hold the top, then set it back to `follow_load` | Note what the top LED shows in each mode |
| 9 | From HA: set **Top button behaviour** to `event_only`, tap top; then `toggle`, tap top twice; then back to `load_on` | With `event_only` the load doesn't change but the action still fires; with `toggle` each tap flips it. Note whether HA's state stays right |
| 10 | Set **Bottom button behaviour** to `toggle`, tap bottom twice, then back to `load_off` | Each tap flips the load; HA follows |

### C4-V-ROSW120 receptacle outlet switch

Plug a lamp into **each** of its two outlets.

| # | Do | Expect |
|---|---|---|
| 1 | From HA: turn it on, then off | One outlet switches. **Note which: top or bottom.** HA's state matches within about 2 s |
| 2 | Tap its button once | The switched outlet changes; action `button_1_single`; HA follows within about 2 s |
| 3 | Double-tap and hold its button | Note the actions and what the outlet does |
| 4 | Note any LED and what it shows | |

### LOZ-5D1-W outlet dimmer

Plug a dimmable lamp into each outlet. In HA it has two lights, `l1` and `l2`.

| # | Do | Expect |
|---|---|---|
| 1 | From HA: `l1` on, 50 %, off; then the same for `l2` | Each outlet does it on its own; HA matches. **Note which physical outlet is `l1`** |
| 2 | From HA: `l1` to 100 % with a 5 s transition | It fades over 5 s. Note whether HA's brightness steps during the fade |
| 3 | From HA: turn `l2` off, then on (no brightness given) | It comes back at the level it had |
| 4 | Its buttons on the unit: tap, double-tap and hold each | Note the actions (`outlet_1_...` / `outlet_2_...`?) and what each outlet does. **We don't know what these send yet** |
| 5 | Restart Zigbee2MQTT with `l1` at 50 % and `l2` off | After the restart HA shows `l1` 50 %, `l2` off |

### LOZ-5S1-W switched outlet

What is still open on it is in [issue #15](https://github.com/home-controls/control4-z2m/issues/15).

| # | Do | Expect |
|---|---|---|
| 1 | From HA: `l1` on / off, then `l2` | Each outlet switches on its own; HA matches. Note which physical outlet is `l1` |
| 2 | Its buttons: tap, double-tap and hold each | Actions `outlet_1_...` / `outlet_2_...`; note what each outlet does |

### C4-KP2-Z 2-button keypad

| # | Do | Expect |
|---|---|---|
| 1 | Tap, double-tap and hold the top button, then the bottom one | `button_1_...` for the top, `button_2_...` for the bottom. If they come out the other way round, or as anything else, note it |
| 2 | From HA: set **Button 1 idle colour** to red and **Button 2 idle colour** to blue | Top LED red, bottom LED blue |
| 3 | From HA: set both **pressed colours** to green, then press each button | Each LED turns green while pressed |

### C4-Z2IO-ZP contact / relay I/O

| # | Do | Expect |
|---|---|---|
| 1 | Read **IO mode**; set it to the mode that matches your wiring | The entities change to match the mode |
| 2 | From HA: relay 1 on, off; then **Pulse relay 1** | The relay clicks each time; with pulse, on then off after **Pulse duration** |
| 3 | Open and close each wired contact | Each **Contact N** entity follows (on = open) |
| 4 | Read **Temperature** (and **External temperature** if a probe is fitted) | Plausible values |

### C4-SR260 remote (and SR250)

A remote's keys send **press**, **hold** and **release**, not taps or double-taps. How the remote's screen and
menus work is in [the SR260 research notes](research/sr260-remote.md), and setting one up as a media remote in
[the SR260 media player guide](guides/sr260-media-player.md).

| # | Do | Expect |
|---|---|---|
| 1 | Press and release a range of keys, then hold one for 2 s | Actions `<key>_press` and `<key>_release` (for example `watch_press`), and `<key>_hold` while held |
| 2 | Put the remote down, wait for its screen to go dark, then pick it up | Action `motion_wake` |
| 3 | From HA: set **LCD room** and **LCD source** | Both rows show on the screen |
| 4 | From HA: set **LCD message** (SR260 only) | The message pops up; empty clears it |
| 5 | From HA: set **Text colour** (SR260 only) to `#FF0000`, then a palette name such as `blue`, then a byte such as `224` | The text changes colour each time. A darker colour also makes the text dimmer: the colour sets its brightness too |
| 6 | Read **Battery** | A plausible percentage |

On an SR260, also try the blueprints, if you use them:

| # | Do | Expect |
|---|---|---|
| 7 | `c4_sr260_screen` with a media player: play, pause, then stop the player | The text takes the playing, paused and idle colours in turn |
| 8 | `c4_sr260_screen`: turn its "dark" entity on, then an alert entity | The colours dim to the night level; the alert colour shows at full brightness while the alert is on |
| 9 | `c4_sr260_screen` with line 2 on: pick an item in one of the remote's menus | Line 2 shows the player's app; after the pick it shows the pick for a few seconds, then the app again |
| 10 | `c4_sr260_media_player`: press Mute with a volume target that can mute, then one that can't | The first toggles mute; the second gets nothing, and no error in Home Assistant's log |
| 11 | `c4_sr260_menu_dispatcher`: show the menu and pick an item | The item's action runs. The log has `menu_select list=0x....` with a list id of `0x0002` or higher |
| 12 | `c4_sr260_menu_dispatcher`: show the menu, then press its show key again while it is up | The menu shows again at once |
| 13 | `c4_sr260_menu_dispatcher`: show the menu and press Cancel | Action `menu_cancel`; the menu goes and no item's action runs |

## How to report back

A question before or while you test (how to pair, what a step means)? Ask in
[GitHub Discussions](https://github.com/home-controls/control4-z2m/discussions). Results go in an issue:

Open an issue on <https://github.com/home-controls/control4-z2m/issues> with the **Device report** template, one
issue per device. Everything there is public, so before you post: rename devices whose friendly names name a
person or a room, or strip those names from the log. The Zigbee addresses (`0x...`) can stay.

The issue takes:

1. **The report**: the template's fields, and the result of each checklist step:

   ```markdown
   ## <model> test report

   - Model shown / Reported model:
   - Part number on the label:
   - Firmware build:
   - Control4 build (HA sensor):
   - Zigbee2MQTT version:
   - Coordinator:
   - Load (for dimmers and outlets: type and wattage):

   | # | Result (pass / fail / partly) | Time | Notes |
   |---|---|---|---|
   | 1 | | | |
   | 2 | | | |

   Anything else odd:
   ```

2. **The log** from the start of the session to the end, attached to the issue as a file. In the Home Assistant
   add-on it is in the Zigbee2MQTT data folder (`/config/zigbee2mqtt/log/<date and time>/log.log`, readable
   through the File editor or Samba add-ons). Keep only our lines, those containing `Control4` (for example
   `grep Control4 log.log > control4.txt`), and attach `control4.txt`; or attach the relevant excerpt of the
   Zigbee2MQTT log.
3. **Photos**: the device's label and, for keypads and keypad dimmers, its button layout.

A fix to the code or the docs is welcome as a pull request from a fork: see [CONTRIBUTING.md](../CONTRIBUTING.md).

After testing, set `z2m:control4` back to `info` (or remove the `log_namespaced_levels` entry), as debug grows the
log quickly.

## What happens next

| Your report says | We do |
|---|---|
| Every step passed | Mark the model supported in the README |
| Some step failed or did something unexpected | Fix it from your log, and publish a new release for you to check that step again |
| An unsupported model, with its fingerprint and button log | Add it (an alias of a model it matches, or new code) as untested, with a checklist here |
| It never paired | Look at its join from the log, and may ask for a second try with something to send it |
