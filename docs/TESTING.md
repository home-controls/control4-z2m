# Testing a Control4 device

Thank you for testing. Most of the devices here were built from protocol notes, and other people's code, without
a unit to try them on. A model only becomes **supported** once someone has paired one, worked through its
checklist, and sent back the results. This guide covers what to do, what to record, and what to send.

A session takes 15-30 minutes per device. You need nothing beyond Home Assistant, Zigbee2MQTT and the device.

## How a model moves forward

| Stage | Meaning | What we need from you |
|---|---|---|
| **Unsupported** | The build doesn't know the model. It pairs as a generic **C4-Zigbee** device with a **Reported model** entity, and logs everything it sends | Part A, then Part B |
| **Untested** | The build has code for it, written from notes. It may work fully, partly, or not at all | Part A, then its checklist in Part C |
| **Supported** | Someone confirmed its checklist on real hardware | Only reports of anything that breaks |

The README's device table marks every untested model. From your report we either confirm the model, fix what
was wrong, or (for an unsupported one) write it, and then send you a new build to check again.

## Before you start

1. **An Ember coordinator** (SkyConnect / ZBT-1 / ZBT-2, Sonoff ZBDongle-E, HA Yellow or Green) with
   `serial.adapter: ember`. TI (zstack) and ConBee coordinators can't run this.
2. **Install the latest release** from the GitHub repo's Releases page, as the README's **Install** section says
   (two files into the Zigbee2MQTT data folder, `enable_external_js: true`, restart). Note the build: Home Assistant
   shows it as the **Control4 build** sensor on the Zigbee2MQTT Bridge device, and the Zigbee2MQTT log says
   `Control4: extension started ...`.
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
   - The firmware: Zigbee2MQTT's device page shows it as **Firmware build**; the dimmers, switches and keypads also
     have a **Firmware version** entity.
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
5. Send the report and the log (below).

If we ask for a specific question to the device, it is sent like this, from Home Assistant: **Developer tools →
Actions → MQTT: Publish**, topic `zigbee2mqtt/<device friendly name>/set`, payload `{"c4_get": "c4.sy.fwv"}`. The
answer appears in the log as `Control4 REPLY <name>: ...`.

## Part C: checklists for untested models

For each step, record **pass**, **fail** or **partly**, plus the time and anything odd. "From HA" means the
device's entity in Home Assistant (or the Zigbee2MQTT frontend). Every checklist starts with Part A.

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
| 9 | If an auxiliary keypad (C4-KA) is wired to it: tap its top and bottom | Actions `aux_top_single` / `aux_bottom_single` |
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

| # | Do | Expect |
|---|---|---|
| 1 | Press a range of keys: tap, double-tap and hold | Actions named for each key |
| 2 | From HA: set **LCD room** and **LCD source** | Both rows show on the screen |
| 3 | From HA: set **LCD message** (SR260 only) | The message pops up; empty clears it |
| 4 | Read **Battery** | A plausible percentage |

## What to send back

Send each device's report and its log **privately**: a direct message to **curtis8523** on the Home Assistant
Community forum or on Discord, or a private GitHub issue in the tester repo. Logs hold your device names and Zigbee
addresses, so don't post them publicly.

A forum message takes only images (JPG, PNG or GIF, up to 3 MB) as attachments, and up to 32,000 characters of
text. Paste the report into it and attach the photos, then send the log file on Discord or attached to a GitHub
issue. If the log's `Control4` lines are short enough, you can paste them into the forum message in a code block
instead.

1. **The report**, filled in from this template:

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

2. **The log** from the start of the session to the end, as a file. In the Home Assistant add-on it is in the
   Zigbee2MQTT data folder (`/config/zigbee2mqtt/log/<date and time>/log.log`, readable through the File editor or
   Samba add-ons). The whole file is fine. To send only our lines, keep those containing `Control4` (for example
   `grep Control4 log.log > control4.txt`).
3. **Photos**: the device's label and, for keypads and keypad dimmers, its button layout.

After testing, set `z2m:control4` back to `info` (or remove the `log_namespaced_levels` entry), as debug grows the
log quickly.

## What happens next

| Your report says | We do |
|---|---|
| Every step passed | Mark the model supported in the README |
| Some step failed or did something unexpected | Fix it from your log, and send you a build to check that step again |
| An unsupported model, with its fingerprint and button log | Add it (an alias of a model it matches, or new code) as untested, and send you its checklist |
| It never paired | Look at its join from the log, and may ask for a second try with something to send it |
