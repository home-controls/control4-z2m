# KC120277 / APD120 / SW120277 capability map

**2026-11-07, brought current 2026-11-27.** Live read-only probes, Control4's own documents and the community's
work, together, and the write tests that followed the same day with the user at each device; then the build's
findings (2026-11-08) and the remote reboot, radio power and frame types (2026-11-15). What remains is in Open
questions and in `docs/plans/device-completion.md`.

The C4-KC120277 configurable keypad, the C4-APD120 adaptive phase dimmer and the C4-SW120277 switch share one
board and one firmware family (`c4.dmx.*`). Each model fits a subset of the same hardware: the APD120 and SW120277
use two of its button wires (01 top, 05 bottom) and two of its LED slots. The KC120277 can use all of them.

Probed on 2026-11-07 through the test site's Zigbee2MQTT and this extension. Every probe was a read-only Get. The
devices are named by label: keypad A and keypad B (two KC120277s) and an APD120 on an LED load.

| Device | IEEE | Model | Firmware | Bootloader (`c4.sy.blv`) |
|---|---|---|---|---|
| Keypad A | `0x000fff0000000001` | C4-KC120277 | 4.4.16 | `AT25DF041A-2.6.0.434810` |
| Keypad B | `0x000fff0000000002` | C4-KC120277 | 4.4.16 | `AT25DF041A-4.0.10.0` |
| APD120 | `0x000fff0000000003` | C4-APD120 | 5.1.1 | `AT25DF041A-4.0.10.0` |

There is no SW120277 at the test site. Its rows below come from the ZHA-era notes
(`control4-zha-quirks/.../control4-sw120277-protocol.md`, fw 5.1.1) and are marked as such.

It builds on the ZHA-era notes for these models (`control4-kc120277-protocol.md`, `control4-apd120-dimmer-protocol.md`,
`control4-sw120277-protocol.md`), and corrects them where they disagree. Community sources:

- **bharat/homeassistant-control4-dimmers**: `RESEARCH.md`, its issues and PRs, and its herdsman-converters
  fork (C4-KD120 keypad dimmer, APD120, KC120277, SW120277). It decoded the LED behaviour selector, the button
  behaviour codes, the `ls` power fields and the backlight colour.
- **royceybaby/ha-c4-keypads**: the dual-load C4-SDAPD240.
- **pvanbaren / wmariz zha-device-handlers forks**: LDZ / LSZ / KPZ-6B1, decoded from Control4 HC-300 logs.

Control4 documents: install guides, data sheets and Composer Pro help on docs.control4.com, and the DriverWorks
proxy protocol docs. c4forums.com is behind a bot check and was not read.

## Method

Same as the DIM1-Z map (`dim1z-capability-map.md`): `{"c4_get": "<prop> [args]"}` to
`zigbee2mqtt/<name>/set` from an HA `run_sequence`, one Get every 0.40-0.45 s, and the replies read back from the
`Control4 REPLY <name>` lines in the Z2M log. Replies were paired with Gets by sequence number. The extension's
own polls (`c4.dmx.amb 00`, `c4.dmx.pwr`) take sequence numbers from the same counter and were skipped by
content. Anchor: `c4.dmx.bmc 02` (answers `0683`, never sent by the extension), every 6-12 Gets. Duplicate
replies (the same sequence number twice, after a retransmit) were counted once.

One reply was lost (keypad A, `blc 01 01`) and re-read. Once, keypad A went 22 s without
answering (20:02:23-20:02:45) and the Gets sent in that window got no reply; they were re-sent.

## What Control4 documents

From the current install guides and data sheets on docs.control4.com (APD120 rev G, SW120277 rev F.1, KC120277
rev H, keypad dimmer, auxiliary keypad, keypad buttons) and the Composer Pro help pages. **[D]** means done by the
device itself, as the documents state; **[D?]** means probably done by the device (our inference, not stated);
**[C]** means done by the Control4 controller.

**Tap sequences [D].** One-button sequences use the top button (on a KC, the top-most fitted button). Two-button
sequences use the top-most and bottom-most buttons.

| Taps | Does |
|---|---|
| 4 | Identify. On a device that has just left its network (13-4-13), pairing mode: it joins the open network |
| 7 | Show the Zigbee channel (community: the LED blinks it out; older posts say 7-4-7) |
| 15 | Reboot |
| 9-4-9 | Factory reset |
| 13-4-13 | Leave the mesh and reset: the usual way to move a device, then 4 taps to pair it |

All status LEDs light green at first power-up. The air gap turns every LED off.

**Out of the box, with no controller [D]:** APD120 top on, bottom off, a hold ramps. SW120277 top on, bottom
off. KC120277 does nothing until configured. Keypad dimmer: any button toggles.

**Hardware**

- **The SW120277 and APD120 measure energy [D]**: "continuously measures energy being used by the attached
  load". Composer shows current power (W), energy used (Wh, lifetime), energy today, minutes on and off, and
  minutes on today.
- **Ambient light sensor on all four Gen3 models [D]**, which "automatically adjusts backlight and status LED
  brightness". On the KC it sits in the clear sensor bar at the bottom.
- **Programmable RGB status LEDs**, and backlit button engraving with programmable colour (KC, keypad dimmer).
- **APD120:** forward and reverse phase, "automatically detects load type", short-circuit and overload
  protection. Works with or without neutral. Minimum load 1 W with neutral, 7 W incandescent without.
- **SW120277:** relay, 15 A at 120 V, 8 A at 277 V, ½ HP (motors, switched outlets). Neutral required.
- **KC120277 power:** 120-277 VAC, or 36-48 VDC from the wired keypad bus.
- **Auxiliary keypad C4-KA [D]:** wired to the yellow wire of an APD120, SW120277 or keypad dimmer, up to 10 per
  load. It controls the load "even without the automation system". How its presses reach Zigbee is untested
  (a wire id of their own?).

**Button kits (KC, keypad dimmer).** Two to seven buttons in four sizes (single, double and triple height, and a
split up/down pair that only fits the bottom slot): 37 layouts. Each button has its status-LED light pipe on its
right. **The device can't tell which kit is fitted**: the Composer layout "must match the physical button
configuration". The keypad dimmer (C4-KD120/277) is an APD120 and a KC120277 in one device.

**Composer properties** (dimmers, switches, configurable keypads):

| Property | Where it lives | Our name for it |
|---|---|---|
| Preset level, click ramp up / down | [D?] | `tv` 01, 02, 03 |
| Hold ramp up / down | [D?] | `tv` 04, 05 |
| Min on, max on (max overrides the preset) | [D?] | `tv` 08, 06 |
| Cold start time and level | [D?] | `tv` 0a, 09 |
| LED colours: top and bottom, on and off; "Toggle" (the colour while held) | [D?] | `led` 03 / 04 on the follow-load slots |
| LED behaviour: Follow Load, Push/Release, Programmed, Follow Fan Speed | [D?] | `led` param 01 (fan speed: values 03-07, as the fan provisioning writes) |
| LED behaviour: Follow Bound Device | [C] | |
| Buttons Control Load, LEDs Follow Load, Use as 2 Button Keypad | [D?] | `btn` param 01, `led` param 01 |
| Fault Detection Status (green / red), Fault Reset | [D] | `c4.dmx.warn 00`? |
| Ambient Light Profiles (presets or fully customised), Backlight Color (black = off) | [D] | `c4.dmx.blc`? |
| Ambient sensing mode: Independent / Source / Follower | sensing [D], relaying [C] | |
| Dimming Mode (APD120 only): autodetect / forward / reverse | [D?] | `c4.dmx.plm` (setting), `c4.dmx.dim` (detected)? |
| Double / triple tap events (taps within about half a second) | [?] | |
| Brightness Presets (OS 3.3.0): level, ramp, active / inactive LED colours, linked to buttons | [?] | |
| Advanced Lighting scenes, "Sync This Scene" / "Sync All Scenes" | likely pushed to the device | `c4.dmx.rbp` / `bl`? |

On the dimming mode: Composer's 8-channel panel says "autodetect usually picks reverse for LEDs". This APD120 has
`plm` `00` and `dim` `02`. Of 51 APD120s reported to bharat (issue 76), 46 answer `dim 02` and one `dim 03`, so
`dim` is not a model hint, and most likely reflects the phase mode. That fits `plm` = the configured mode
(00 = autodetect) and `dim` = the phase in use (01 forward, 02 reverse, 00 a relay; 7 of 9 SW120277s answer `00`).
A forum user re-runs "auto detect dimmer phase" after outages. Not tested: forcing the wrong phase can stress a
load. The APD120 is rated 600 W incandescent / 120 W LED.

**Firmware** (Control4 dealer release notes):

| OS | APD / keypad dimmer | SW / fan | KC |
|---|---|---|---|
| 2.9.1 (2017) | 4.0.39 | | |
| 2.10.1 (2018) | 4.2.84 | 4.2.84 | 4.1.22 |
| 3.2.2 (May 2021) | 4.4.23 | 4.4.23 | **4.4.16** (both keypads here) |
| 3.3.0 (June 2022) | 5.0.9 | 5.0.9 | |

The 5.1.1 on the APD120 is in no public release notes. These Gen3 models are not part of the X4 sunset of the
Gen1/Gen2 devices.

## Status codes

`000` value follows, `n01` no such name, `e00` name exists but wrong argument count, `v01` an argument is out of
range. `v01` is what bounds each indexed table below.

## The readable namespace

| Get | Keypad A | Keypad B | APD120 | Meaning |
|---|---|---|---|---|
| `c4.sy.fwv` | `4.4.16` | `4.4.16` | `5.1.1` | Firmware |
| `c4.sy.blv` | `AT25DF041A-2.6.0.434810` | `AT25DF041A-4.0.10.0` | `AT25DF041A-4.0.10.0` | Bootloader / external flash version |
| `c4.sy.zpw` | `00` | `00` | `00` | Radio TX power, signed dBm. All three at 0 dBm (factory value is `f9`, -7 dBm; Control4 writes `00` at provisioning) |
| `c4.sy.ri` | `CRS AST` | `CRS AST` | ` SW RBT` | **New: last reset reason**, EmberZNet's codes (see below). The ZHA notes read it as an empty "room info"; room info is `c4.ln.ri`, on the remotes |
| `c4.sy.zpc`, `c4.sy.info` | `n01` | | `n01` | |
| `c4.dmx.dim` | `n01` | | `02` | Phase in use, most likely: 01 forward, 02 reverse, 00 relay (see What Control4 documents) |
| `c4.dmx.plm` | `n01` | | `00` | Phase load mode setting, most likely 00 = autodetect |
| `c4.dmx.off` | `n01` | | `0000` | |
| `c4.dmx.pmti` | `n01` | | `0064 0064` | Power-monitor intervals (100, 100). Control4 writes `0002 0002` at provisioning |
| `c4.dmx.pwr` | `n01` | | `007d 0000 0000 0000 0000 07f5 0000` (load off) | V, mA, W, VA, PF × 1000, energy counter, 0 (see below) |
| `c4.dmx.warn <n>` | `n01` | | `00 0000`, then any index answers | `00` is the fault status the device also announces (Composer's Fault Detection). Higher indexes read past the table |
| `c4.dmx.bmc <0-2>` | `01a1 03e8 0683` | | `01a1 03e8 0683` | Multi-click thresholds, ms (417 / 1000 / 1667) |
| `c4.dmx.fsc 00` | `n01` | | `05` | Fan speed, vestigial on a dimmer |
| `c4.dmx.blc <ch> <i>` | see below | same | same | Backlight table: `00 05` is the backlight colour; the rest is untested |
| `c4.dmx.btn <wire> 01` | `03` × 14 | `03` × 14 | `00 00 03 03 03 01 03` | Button behaviour per wire, see below |
| `c4.dmx.btn <wire> 00` | `00` × 9 | | `00` × 7 | Always `00` |
| `c4.dmx.led <slot> <p>` | see below | see below | see below | LED engine |
| `c4.dmx.amb <0-6>` | `12 00 00 1e 00001388 ff 12 12` | `00 00 00 1e 00001388 ff` | `30 00 00 1e 00001388 ff 31 31` | Ambient light, see below |
| `c4.dm.is` | `n01` | | `00 64 01f4 01f4 1388 1388 64 01 0a 00 0000` | **New layout**: the `tv` table, slots 00-0a in order |
| `c4.dm.tv 00 <slot>` | `n01` | | see below | Dimmer parameters |
| `c4.dmx.rbp`, `c4.dmx.bl` (0-2 args) | `e00` | | | Write-only (as before) |

`c4.dmx.ls`, `lm`, `br`, `c4.dm.td`, `t0s`, `lm`, `ba` are `n01` on the APD120. `ls` is an announcement, not a
readable property. The other four are DIM1-Z names. `ledx` / `ledxy` / `blcx` are prefix matches of
`led` / `blc` (a longer probe answers as the shorter real name).

### Wires and slots: one board, three fit-outs

`c4.dmx.btn` bounds the button wires. The APD120 has 7 (wires 00-06, `v01` from 07). The KC120277 answers all
14 tried (00-0d). On the APD120 the behaviours are:

| Wire | 00 | 01 | 02 | 03 | 04 | 05 | 06 |
|---|---|---|---|---|---|---|---|
| APD120 | load on | load on (**top half**) | programmable | programmable | programmable | load off (**bottom half**) | programmable |

So the paddle sits on wires 01 and 05 of a 7-position layout, the 2nd and 6th positions, and the positions in
between carry no button. The KC120277 has all its wires programmable (`03`): a pure keypad drives no load.

`c4.dmx.led` has 13 slots (00-0c). On the APD120 the Control4-provisioned **follow-load** LEDs are slots
`01` and `04` (the extension's old "LED 2" and "LED 5", now "Top LED" and "Bottom LED"); the other slots are in
programmed mode. The paint test confirmed them: slot 01 is the top LED and 04 the bottom, at positions 2 and 5 of the layout, the button wires' 1
and 5 counted from 0.

### LED engine: `c4.dmx.led <slot> <param>`

Params `00`-`05` all answer a Get on these firmwares. bharat's decoding (on a KD120) fits every reading here:

| Param | Meaning (bharat) | What we read |
|---|---|---|
| `00` | The wire whose press drives this LED (push/release) | KC slots 0-5: their own index (`00`-`05`). APD: `00` everywhere |
| `01` | **Behaviour**: `00` programmed, `01` follow load, `02` push/release | KC slots 0-5: `02`. KC slots 6-0c: `00`. APD slots 01 and 04: `01`; all others `00` |
| `02` | Connection / load the LED follows (`00` = own load) | APD slot 01: `01`, slot 04: `02`. Everything else `00` |
| `03` | Colour: pressed (push/release) or load-on (follow load) | |
| `04` | Colour: idle (push/release) or load-off (follow load) | |
| `05` | bharat: persistent override, the colour shown in programmed mode; `e00` on their KD120 | **Readable here.** See below |

This **reinterprets the extension's old "bound" switch** (`led_N_bound`, which wrote param `01` as `02` / `00`).
"Bound" is push/release mode, and "unbound" is programmed mode, where the LED shows its param-05 colour instead
of 03/04. Follow load (`01`), which the APD120 uses out of the box, had no switch at all. **Fixed by archived PR
100:** an LED mode select per slot (programmed / follow load / push-release) replaces `led_N_bound`
(`src/z2m/definitions.ts`), and the APD120 and SW120277 expose only their two real LEDs.

Param 05 looks like the colour the LED is showing right now:

| Device / slot | Mode | 03 | 04 | 05 |
|---|---|---|---|---|
| Keypad B slots 0-5 | push/release, at rest | `ff0000` | `660066` | `660066` (= idle) |
| Keypad A slots 0, 2, 4 | push/release, at rest | `260026` | `260026` | `260026` |
| APD slots 01, 04 | follow load, load off | `002626` | `260026` | `260026` (= load-off colour) |
| APD slots 00, 02, 03, 05 | programmed | `002626` | `260026` | `000000` |
| APD slots 06-0b | programmed | `002626` | `260026` | `002626` |

The programmed slots' 05 values (`000000` on 00-05, `002626` on 06-0b) don't follow from 03/04, so in programmed
mode 05 is its own register, as bharat found. The extension had never written param 05 then (its status colours use
it now), so something before it did.
Write tests to tell "live colour" from "override register" are in Open questions.

What others found on the same commands:

- **APD120 bottom half:** the rocker presses on wire 05 but its LED is slot 04 (bharat PR 228). The probe here
  agrees: buttons on wires 01 / 05, follow-load LEDs on slots 01 / 04.
- **The firmware redraws an LED from 03 / 04 each time its own load changes**, which overwrites a param-05
  colour. bharat writes a tracked colour into 03, 04 and 05 so it sticks.
- **Param 05 Get:** `e00` on bharat's KD120 and on royceybaby's SDAPD240 (both fw 5.x). It answers on all three
  devices here, so the firmwares differ.
- **Param 00:** royceybaby found it is *not* an LED-to-button link, which contradicts bharat's "wire that drives
  push/release". On our keypads it equals the slot's own index on every push/release slot, so the two readings
  can't be told apart here.
- **Param 01 takes more than three values.** The fan provisioning writes speed + 3 (`03`-`07`, Composer's
  "Follow Fan Speed"). On the dual-load SDAPD240, `0b` follows load 2. So the value may encode a level band or a
  load index, not just a mode.
- **A Get needs the full address.** `led <slot>` and `btn <wire>` without the parameter answer `e00`.

Slot `0c` read `00 00 00 000000 000000 000000` on keypad A, and `00 00 00 002626 000000 000000` on the
APD120. The ZHA notes saw varying junk there. Not used.

### Button behaviour: `c4.dmx.btn <wire> 01 <v>`

bharat set each value on a KD120 button and watched the result. That matches the SW120277 decouple the extension
used then (`paddle_local_control`, `03` on both halves; now an alias of the per-half button behaviour):

| Value | Behaviour | Events | Load |
|---|---|---|---|
| `00` | Load on | yes | on only |
| `01` | Load off | yes | off only |
| `02` | **Toggle** | yes | toggles |
| `03` | Programmable | press, hold, release | none |
| `04` | **Momentary**: hold dims off, release restores | yes | |
| `05` | Disabled. **Never write it**: with some firmware state it fires a press on both edges, so every tap reads as a double tap | | |

Param `00` reads `00` on every wire. bharat found every value of it rejected (`v01`) by a Set.

On the dual-load SDAPD240 (royceybaby), the value's high nibble picks the load: `10` / `11` / `12` are load 2 on /
off / toggle. bharat reports a KD120 load button in toggle mode switches its load in firmware, and a held load button
sends only a press, with no scene frame.

### `c4.dmx.blc <ch> <i>`: the backlight table

Identical on both keypads and the dimmer, so these are factory values that no load or fit-out changed:

| | i=00 | 01 | 02 | 03 | 04 | 05 | 06+ |
|---|---|---|---|---|---|---|---|
| ch 00 | `00` | `ff` | `00` | `ff` | `fe` | `0000ff` (3 bytes) | `v01` |
| ch 01 | `00` | `ff` | `fe` | `ff` | `v01` | | |
| ch 02 | `v01` | | | | | | |

The ZHA notes call it a "button-to-load level map" from what the Control4 controller wrote at provisioning
(ch 00: `1e e7 1e d2 55 000000`, ch 01: `1e c8 1e d2 55`). A keypad with no load holds the same table, so
that reading is doubtful.

More likely it is the **backlight / ambient-light table**:

- All four Gen3 models "automatically adjust backlight and status LED brightness depending on the light level"
  (data sheets).
- Composer's Advanced properties have Ambient Light Profiles (presets, or each brightness level set by hand) and
  a Backlight Color where black means off.
- Control4 bug 35499 ("custom ambient profiles below 25 broke on firmware 4.1.21") says the profile is applied
  in the device firmware.
- **`ch 00 i 05` is the backlight colour: confirmed** by bharat (PR 226) on a KD120 fw 5.1.1. It is written as
  `c4.dmx.blc 00 05 <rrggbb>`, read back the same way, and `000000` turns the backlight off. It is the table's
  one 3-byte entry: `0000ff` (blue) from the factory, and Control4 writes `000000` at provisioning.
- The `1e` (30) Control4 wrote also matches `c4.dmx.amb 03` = `1e`.

The single-byte entries, from the keypad A test (2026-11-07, below): **`ch 00 i 03` sets the backlight
brightness** (it dimmed at `40`, came back at `ff`). `ch 00 i 04` took `55` with no visible effect on the backlight.
`ch 00 i 01` refuses (`v01`) every value tried below `ff` (`20`, `80`, `40`), even with i 03 and i 04 lowered first,
so its rule is unknown. ch 00 i 00 / i 02 and ch 01 are untested. The table validates its values, so it isn't
free-form.

### Ambient light: `c4.dmx.amb <p>`

| Param | Keypad A | Keypad B | APD120 | Reading |
|---|---|---|---|---|
| 00 | `12` | `00` | `30` | Light level 0-255 (confirmed in the ZHA notes) |
| 01, 02 | `00` | `00` | `00` | |
| 03 | `1e` | `1e` | `1e` | 30. A threshold? Matches `blc` values |
| 04 | `00001388` | `00001388` | `00001388` | 5000, likely the sample interval in ms |
| 05 | `ff` | `ff` | `ff` | Full scale |
| 06 | `12 12` | | `31 31` | The live level, twice (royceybaby: `ff ff` under a torch, about `0d` covered). The device samples about every 5 s to set its LED brightness |
| 07 | `v01` | | `v01` | |

### Dimmer parameters on the APD120

`c4.dm.is` here is the `tv` table in slot order, one Get for the lot. The DIM1-Z's `is` has a different
layout (level, default-on, fades, colours, flags).

| Slot | APD120 | Meaning | Extension showed (before archived PR 100) |
|---|---|---|---|
| 00 | `0000` | Live level % | |
| 01 | `0064` | Default-on % (100) | 100 |
| 02 | `01f4` | On fade, ms (500) | 0.5 s |
| 03 | `01f4` | Off fade, ms (500) | 0.5 s |
| 04 | `1388` | Hold ramp up, ms (5000) | **4000** |
| 05 | `1388` | Hold ramp down, ms (5000) | **4000** |
| 06 | `0064` | Max % (100) | 100 |
| 07 | `0001` | Unknown. Also `0001` on the DIM1-Z, where it is a 0 / 1 flag with no measurable effect (2026-11-15) | |
| 08 | `000a` | Min % (10) | **5** |
| 09 | `0000` | Cold-start level % | not exposed |
| 0a | `0000` | Cold-start time, ms | not exposed |
| 0b | `1388` | **New**, 5000. The DIM1-Z has filler (`00ff`) here | |
| 0c | `03ff` | **New**, 1023 | |
| 0d, 0e, 10 | `00ff` | Filler, past the end | |

Channel `01` answers `v01` (the DIM1-Z answers filler for a missing channel instead).

**Fixed by archived PR 100:** the APD120's settings are read from the device in one `c4.dm.is`, and cold start
(slots 09 / 0a) is exposed (`src/devices/gen3.ts`).

**Setting a level and fading to it** (others' findings; tested here on 2026-11-07, below):

- `c4.dm.tv <ch> 00 <pct>` sets the level at once. Slot 00 is the live level, writable (LOZ-5D1-W from a Control4
  HC-300 log; royceybaby on the SDAPD240).
- **Hardware fade:** `0i<seq> c4.dm.rtl <ch> <target % hex2> <time ms hex8>`, e.g. `0if088 c4.dm.rtl 00 32
  000003e8` (50 % over 1 s). It goes in the `0i` (interrupt) frame type, not `0s`. No stop verb is known; a
  `tv 00` level stops it.
- Control4's 2013 boot log writes `tv` slots 02 03 01 04 05 08 06 09 0a as 32-bit values and never writes 07.

`c4.dm.rtl` answered `e00` to every Get and Set shape tried on the DIM1-Z, but those went as `0g` / `0s`
frames.

### Power telemetry: `c4.dmx.pwr`, the power that isn't, and the temperature that isn't

Seven fields. With the load off the APD120 reads `007d 0000 0000 0000 0000 07f5 0000`. The SW120277 in the ZHA
notes read `0084 0168 001f 0030 028c 0016 0000` on and `0084 0000 0000 0000 0000 0016 0000` off.

**The fields are volts, mA, W, VA, power factor × 1000, an energy counter, and 0.** bharat's PR 225 decodes
the same values in the `c4.dmx.ls` announcement (level, then V, mA, W, VA, PF × 1000). The SW120277's reading
checks out against itself:

| Field | SW120277, load on | Meaning | Check |
|---|---|---|---|
| 0 | `0084` = 132 | Line voltage, V | |
| 1 | `0168` = 360 | Current, mA | 132 V × 0.360 A = 47.5 VA ≈ field 3 |
| 2 | `001f` = 31 | Real power, W | |
| 3 | `0030` = 48 | Apparent power, VA | |
| 4 | `028c` = 652 | Power factor × 1000 | 31 W / 48 VA = 0.646 ≈ 0.652 |
| 5 | `0016` = 22 | Energy counter, see below | |
| 6 | `0000` | | |

The APD120's 125 V in field 0 matches its line. The "device model `007c`" in the ZHA notes' `ls` table is line
voltage too.

**So the extension's `power` sensor was not watts.** It took field 4, the power factor, × 0.04247
(`SCALE_POWER`, "42 W at 989"). A load with a power factor near 1 read about 42 "W" whatever it drew. That is
why the APD120's history sat at 41.3-41.8 every evening. **Fixed by archived PR 100** (merged 2026-11-10): power,
voltage, current, apparent power, power factor and energy now come from their own fields (`src/devices/sensors.ts`),
and `SCALE_POWER` is gone.

**Field 5 is not a temperature.** The extension published it as `device_temperature` in °C, until archived PR 100
made it the energy sensor (`src/devices/sensors.ts`, with an offset that carries the total over a reboot's drop). Its recorded history on
the APD120 (2026-10-28 to 2026-11-07, 608 points):

- it climbs by exactly 1 about every 2 minutes while the load is on (polled every 30 s, so seen every 120-150 s);
- it doesn't move at all while the load is off (21:46 to 07:06 overnight: no change);
- it went from 2380 to 2932 over nine days, then dropped to **exactly 2000** a few minutes after the dimmer
  re-joined on 2026-11-06 19:38 (whose `c4.sy.ri` now reads ` SW RBT`), and climbs from there.

So it's an accumulator, and the drop to a round 2000 looks like a reboot restoring the last value saved to
flash, if the firmware saves every 1000 counts. HA showed it as 3698.6 °F that day. The SW120277's `0016` reading in
the ZHA notes was the same field: a counter that didn't tick during a short test.

**It is lifetime energy.** Control4's data sheets say the SW120277 and APD120 "continuously measure energy", and
Composer shows Energy Used (Wh, lifetime) for them. HA's own record of the APD120 from 2026-10-28 21:46 to
2026-11-06 19:42 already ruled out minutes on: 545 ticks over 1323.5 minutes on.

**Confirmed on the APD120 (2026-11-07, light at 100 % then 30 %, `pwr` every 10 s):**

| | 100 % | 30 % | Off |
|---|---|---|---|
| Field 0, V | `007d` = 125 | 125 | 125 |
| Field 1, mA | `011b`-`0124` ≈ 290 | `00ab`-`00af` ≈ 173 | 0 |
| Field 2, W | `0023`-`0024` = 35-36 | `000b` = 11 | 0 |
| Field 3, VA | `0024` = 36 | `0016` = 22 | 0 |
| Field 4, PF × 1000 | `03d9`-`03de` ≈ 0.987 | `0204`-`0215` ≈ 0.525 | 0 |
| Field 5, energy counter | ticks every ~130 s | no tick in 4 min | holds |
| What the extension's `power` showed | ~42 "W" | ~22 "W" | 0 |

V × A = VA and W / VA = PF on every reading, so the layout holds on fw 5.1.1. The counter ticked at 20:58:53,
21:01:03 and 21:03:56. The middle interval spanned 100 % then 30 %, and it held through the four minutes at 30 %:
**it counts energy, not time**. One tick is about 4.6 kJ: 35.5 W × 130 s, and 35.5 W × 102 s + 11 W × 71 s
both come to 4.4-4.6 kJ. That is ~1.27 Wh per tick, not 1 Wh. Field 2 is a whole number of watts, so a day's
reading against the counter would pin the factor down better. The fixture draws 35-36 W at full.

There is no temperature in `pwr` at all.

### Last reset reason: `c4.sy.ri`

Both keypads read `CRS AST` and the APD120 ` SW RBT`. These are EmberZNet's reset codes, character for character
(Silicon Labs `reset-def.h`: base type then extended type, and " SW" carries its leading space there too):

| Base | Extended codes |
|---|---|
| `UNK` unknown, `FIB`, `BTL` bootloader | `BTL`: `GO`, `BTL`, `BAD`, `FTL`, `FRC`, `OTA`, `DSL` |
| `EXT` external | `PIN` (reset pin) |
| `PWR` power on | `HV`, `LV` (brown-out) |
| `WDG` watchdog | `EXP`, `LWM` |
| ` SW` software | `RBT` reboot, `DSL` deep sleep |
| `CRS` crash | `AST` assert |
| `FSH` flash, `BAD`, `FLT` fault | `FLT`: `HRD`, `MEM`, `BUS`, `USG`, `DBG`, `DMA`, `VCT` |

So both keypads last restarted on a firmware assert, and the APD120 on a software reboot. That reboot came with
its re-join on 2026-11-06 19:38. bharat's issue tracker reports that these devices restart themselves after about
4-20 minutes without reaching the coordinator, so a self-restart would read ` SW RBT` too. A power cut would read
`PWR`. The DIM1-Z answers `n01`.

### `c4.dmx.warn <n>` reads past its table

The APD120 answers every index tried, `ff` included, with no `v01`: `00 0000`, `01 5924`, `02 3deb`, `03 0013`,
`04 0000`, `05 0303`, `06 0103`, `07 0003`, `08 0301`, `0f 4000`, `10 0001`, `ff 0338`. Nothing changed over 9
minutes. Only index 00 (the warning the device announces) means anything. The rest look like whatever memory
follows the table.

## Bugs in the extension found by this (all fixed)

Each was fixed by archived PR 100 (merged 2026-11-10). The findings stand; "Fixed" says where.

1. **APD120 / SW120277 `power` is not watts.** It is field 4 of `c4.dmx.pwr`, the power factor × 1000, scaled by
   0.04247. Any load with a power factor near 1 reads about 42 W. Real watts are field 2. **Fixed:** power and energy
   from their own fields (`src/devices/sensors.ts`).
2. **APD120 / SW120277 `device_temperature` is the energy counter** (field 5), shown as °C: 3698.6 °F on the
   APD120 that day, and it jumps when the device reboots. There is no temperature in `pwr`. **Fixed:** it is the
   energy sensor, carried over a reboot's drop (`src/devices/sensors.ts`).
3. **APD120 settings are never read from the device.** It shows hold ramps 4000 ms (the device holds 5000) and
   min 5 % (the device holds 10 %). The values it shows are Control4's provisioning defaults, from its 2013 boot
   log, not this device's. The DIM1-Z got a read-back on 2026-11-02, and the APD120 can do it in one Get
   (`c4.dm.is`). **Fixed:** read from the device, with cold start exposed (`src/devices/gen3.ts`).
4. **`led_N_bound`** is named for a misreading: it switches between push/release and programmed mode, and can't
   set follow load. **Fixed:** an LED mode select per slot (`src/z2m/definitions.ts`).

5. **The APD120 sets HA's light state from taps whatever the paddle does.** `syncClick` publishes ON for a top-half
   tap and OFF for a bottom-half tap. Tested with the top half set to programmable: three top taps left the light
   off, and HA showed it on. With the bottom half on toggle, HA flicked on → off → on at the first tap. The SW120277
   skips this while decoupled; the APD120 has no such guard. The light's own `c4.dmx.ls` reports are right, and
   should be the only source of its state. **Fixed:** the APD120's state comes from its reports alone, and the
   SW120277 infers it only while a half drives the load (`src/devices/gen3.ts`).
6. **A brightness change re-applies every LED colour several times over.** An LED automation's queued
   runs each called `led_brightness` before the first one's state came back. The extension then re-sent 24 of 24
   colours three times and 17 of 24 once (2026-11-07 20:39:09): about 90 frames for one change. Each re-apply
   compares against what was last sent, but the writes still in flight hadn't counted yet. **Fixed:** a re-apply
   compares against what is queued too (`src/core/leds.ts`).

## Write tests on the APD120 (2026-11-07, user at the switch)

Each change was snapshotted first and restored after. The restore was verified by reading every touched value
back: both paddle wires, and `led` params 01-05 on slots 00-05.

| Test | Done | Result |
|---|---|---|
| Which slot is which LED | Slots 00-05 painted six distinct colours at once (override on programmed slots, 04 on the follow-load ones) | **The two physical LEDs are slots 01 (top, position 2) and 04 (bottom, position 5).** No light from 00, 02, 03, 05. All writes `000` |
| Param 05 on a follow-load slot | Changed slot 01's / 04's off colour (04) with the load off | Param 05 changed to the new colour by itself: **on a follow-load slot, 05 reads back the colour on show** |
| Override in programmed mode | Slot 01 to programmed (`led 01 01 00`), `led 01 05 ff0000` | **Top LED red.** An override drives a programmed LED, and it stayed red through every load change after |
| Override in follow-load mode | `led 04 05 ff00ff` with the load off | **Bottom LED pink at once.** The next load change repainted it from 03 / 04 (white, the test's off colour), as bharat reported |
| Toggle | Bottom half `btn 05 01 02` | Each bottom tap toggled the load. Events still fire (press, release, single, fast single) |
| Scene-only | Top half `btn 01 01 03` | Top taps left the load alone and fired their events (single, double, triple) |
| Momentary | Bottom half `btn 05 01 04` | **Holding dims the light down; releasing returns it to the level it had.** |

Writing param 01 alone (`led 01 01 00`, then `01`) left param 02 (`01`) as it was.

### Hardware fade on the APD120 (2026-11-07, build 4ac162f47c2f)

Sent with `{"c4_send": {"cmd": "c4.dm.rtl ...", "type": "i"}}`, timed by the extension's own `pwr` reads after each
level report (at 30 % the light draws 11 W, at 50 % about 24 W):

| Command | Result |
|---|---|
| `0i c4.dm.rtl 00 32 00001388` (to 50 %, 5000 ms), from off | `000`. 3 W at 1 s, 5 W at 2 s, 20 W at 4 s, 24 W at ~5 s, then held: **50 % in ~5 s** |
| `0i c4.dm.rtl 00 00 00002710` (to 0 %, 10 000 ms), from 50 % | `000`. 19 W at 2 s, 9 W at 5 s, 4 W at 7 s, 1 W at 10 s: **off in ~10 s** |
| `0i c4.dm.rtl 00 64 00004e20` (to 100 %, 20 000 ms), then 4 s later `0s c4.dm.tv 00 00 28` | `000`, `000`. 5 W at 3 s (~20 %), then **held at 40 %** (18 W), and `tv 00 00` reads `0028` |

**On the APD120 the time argument is the length of this fade.** On a DIM1-Z it is the time a full 0-100 % sweep
would take (the DIM1-Z map), so the two firmwares read it differently. `c4.dm.tv 00 00 <pct>` sets the level at
once on the APD120 too, and stops a running fade. HA showed the light's state changing about once a second through
each fade (the APD120's level reports).

## Write tests on keypad A (2026-11-07, user at the keypad)

Snapshotted first, restored after, and the restore read back: `led` params 00-05 on slots 00, 02, 04, and
`blc 00 00`-`05`. Keypad B's backlight was set green for the first round (to tell which keypad the user was
at) and put back to `0000ff` straight after, also read back.

| Test | Done | Result |
|---|---|---|
| Backlight colour | `blc 00 05 ff0000` (from `0000ff`) | **The backlight turned red.** It shows behind these buttons, if faintly |
| Backlight brightness | `blc 00 03 40`, `blc 00 04 55`, then 03 back to `ff` | **03 is the backlight brightness**: dimmer at `40`, brighter again at `ff` with 04 still at `55` |
| `blc 00 01` | `20`, `80`, `40` | `v01` every time; it stays `ff` |
| Override in programmed mode | Slot 00 (button 1) to programmed, `led 00 05 00ff00` | **Green.** Same as on the APD120 |
| Override in push/release mode | `led 02 05 ff0000` on slot 02 (button 2) | Accepted, but reads back `260026` (the idle colour) at once, and the LED stayed purple. **In push/release mode 05 is the colour on show and a write to it doesn't stick** |
| Follow load on a keypad | Slot 04 (button 3): 03 = blue, 04 = yellow, then `led 04 01 01` | **Yellow**: with no load, follow load shows its load-off colour, and a press didn't change it |

The keypad's ambient reading moved between `0e` and `ff` during the test (the user's hand and the room lights), so
the backlight brightness test ran in changing light.

## What the build found at the test site (2026-11-08)

The extension now reads and writes these settings (build `0ed43578d0ac`). What it met there:

- **Replies padded after the value.** Some replies carry NULs and stray bytes after the value:
  `0r0042 000 c4.sy.fwv 4.4.16 \0\0\0`, `c4.sy.blv AT25DF041A-4.0.10.0 \0 ù`, and sometimes `c4.sy.zpw 00` padded too.
  The extension ends a frame at its first NUL.
- **Text replies come quoted.** `c4.sy.ri` answers `" SW RBT"` (the leading space is EmberZNet's), and both keypads
  answer `"CRS AST"`.
- **A Get's reply carries the bare value.** `c4.dmx.led 01 01` answers `01`, `c4.dmx.blc 00 05` answers `0000ff`, and
  `c4.dmx.bmc 00` answers `01a1`, with no arguments echoed.
- **`c4.sy.zpw 00` as a Set answers `000`** on the APD120, and reads back `00`.
- **APD120 `rtl` again:**
  - 100 % over 3000 ms arrived about 3.4 s after the frame.
  - 10 % over 2000 ms arrived in about 2.6 s.
  - Off over 4000 ms from its 10 % minimum went off at once: there is nothing to fade through below the minimum.
- **APD120 LED status colour:** `led 01 01 00` then `led 01 05 ff0000` painted the top LED. `led 01 01 01` then
  `led 01 05 260026` gave it back. Read back after: mode `01`, param 05 `260026`, the load-off colour on show.
- **The KC120277's layout, learned:** keypad A's buttons send from wires 0, 2 and 4 (three double-height
  buttons), and their LEDs are slots 0, 2 and 4.

## Remote reboot and radio power, tested (2026-11-15)

On keypad A and the APD120, at the user's request. The sniffer measured radio power from
the keypad's own frames (by MAC source); the keypad talks straight to the coordinator.

**`0i c4.sy.rb` reboots both models.**

| | Keypad A (KC120277) | APD120 |
|---|---|---|
| Reply | `000`, then a reboot | `000`, then a reboot |
| Proof | `c4.sy.ri` went from `CRS AST` to `" SW RBT"`. Its APS counter fell from 128 to 95, and its boot check-in (the model string, broadcast) came 4 s after the reply | Its energy counter fell from 2476 to its last save, 2000, and its APS counter started again at 11. It was already ` SW RBT` |
| After | No device announce. Its ambient reading went from `ff` to `00` | The light stayed off; the extension carried the energy total on from 2476 |

- **Unlike the DIM1-Z, it answers before it restarts.** So its APS acknowledgement goes out, and no retry reboots it
  again. Sending without an ack is still the safe default.
- **It sends no device announce.** The extension's re-join handling (its health read, the LED repaint) doesn't run
  after this reboot, so the Reboot button and the automatic reboots, built for these two models in #12, queue the
  health read (the reset reason) themselves. The SW120277 is untested and isn't rebooted.
- **`c4.dm.rb` exists too** (`e00` to a Get on both), and was left untried. So were `c4.dmx.bl` and `c4.dmx.rbp`,
  for the reason above.
- **Names that don't exist** (`n01`): `c4.dmx.rb` and `c4.kp.rb` on the keypad. The DIM1-Z's other `0i` verbs (`op`,
  `tf`, `tp`, `bp`, `bl`) under `c4.dm` on both models, and under `c4.dmx` on the keypad.

**`c4.sy.zpw` sets the radio's transmit power, and the radio follows it.**

| Set | Reply | Reads back |
|---|---|---|
| `03` to `7f` (+3 dBm and up) | `v01` | unchanged |
| `02`, `01`, `00` (+2 to 0) | `000` | the same |
| `f7`, `f8` (-9, -8) | `000` | the same |
| `f6` (-10) | `000` | **`f5` (-11)** |
| `f5` (-11) | `v01` | unchanged |
| `f4`, `f0`, `e0` (-12 and below) | `v01` | unchanged |

| Keypad set to | Frames | RSSI at the sniffer (mean / median) | Against 0 dBm |
|---|---|---|---|
| 0 dBm (19:30-19:55) | 183 | -63.2 / -63 | |
| +2 dBm (19:57-20:01) | 68 | -59.5 / -60 | +3.7 dB |
| -9 dBm (20:03-20:07) | 21 | -70.7 / -71 | -7.5 dB |

- **The range is -10 to +2 dBm,** and -10 reads back as -11, a step of the radio's own. The extension's `tx_power`
  takes -8 to +2.
- **From +2 down to -9 the signal moved 11.2 dB,** against the 11 asked for.
- **The power survived a reboot:** it read `02` after the `0i c4.sy.rb`. Whether it survives a power cut is still
  open.
- **Restored to `00`** after the test.

**Frame types (keypad A, 2026-11-15).**
- **What it acts on:** `0g`, `0i`, `0s` and `0t` (`c4.sy.fwv` answered as a Get, and `e00` to the other three).
- **Any other letter:** it sends that same letter back with `00` (`0x005e 00`).
- **A digit first:** it answers `<d>r<seq> 00`.
- **The plan:** `docs/plans/frame-type-survey.md`.

## Open questions and the tests they need

Still open. Each needs a write (restored after), the light switched, or someone at the device:

- **The energy counter's exact scale**: field 5 against field 2 integrated over a day (now ~1.27 Wh per tick).
- **The rest of the `blc` table**: what `ch 00 i 01` accepts, what i 00 / i 02 / i 04 do, and ch 01 (status LED
  brightness?), in a dark and a lit room.
- **Aux keypad (C4-KA) presses**: what wire id they report, if any.
- ~~**A remote reboot**~~: answered. `0i c4.sy.rb` reboots the KC120277 and the APD120 (2026-11-15, above). Still
  open: whether it reboots a SW120277 (#14), and what `c4.dm.rb` does on these models (exists, untried).
- **Leave `c4.dmx.bl` and `c4.dmx.rbp` alone:** their meaning is unknown. On the DIM1-Z, `c4.dm.bl` turned out to
  take 4-6 arguments and be no bootloader entry (2026-11-15), but the Gen3 `c4.dmx.bl` is untried.
- **Whether TX power survives a power cut.** It survives a reboot (above).
- **The rest of the namespace:** no full name sweep has been run on these models, as one was on the DIM1-Z. The frame
  types are known (`0g`, `0i`, `0s`, `0t`, above). See `docs/plans/frame-type-survey.md`; tracked in #13.

## What this could mean in Home Assistant

Ranked by value for effort, as planned on 2026-11-07. **Items 1-11 were built by archived PR 100** (merged
2026-11-10): power and energy in `src/devices/sensors.ts`; the settings read, cold start, reset reason, TX power and
button behaviour in `src/devices/gen3.ts`; the LED mode in `src/z2m/definitions.ts`; the backlight in
`src/devices/keypad.ts`; hardware fades in `src/devices/dimming.ts`. Item 12 is still research (#13), and item 13 is
the next build (#12).

1. **Real power and energy on the APD120 and SW120277** (bugs 1 and 2). Publish field 2 as power (W), field 0 as
   voltage, field 1 as current, field 3 as apparent power and field 4 as power factor. Publish field 5 as
   energy (`total_increasing`, ~1.27 Wh per count, tested), so both models feed HA's Energy dashboard. Drop
   `device_temperature`. The field layout is confirmed on the APD120 fw 5.1.1.
2. **Read the APD120's settings from the device** (bug 3), as the DIM1-Z does: one `c4.dm.is` Get gives every
   slot. Add **cold start** (slots 09 / 0a) to the APD120, as on the DIM1-Z.
3. **Hardware fades**: `light.turn_on` with a `transition` sent as one `0i c4.dm.rtl`, so the dimmer fades
   itself at any duration instead of using its stored on/off fades. Tested on the APD120 (below): the time is this
   fade's duration there, but a full-sweep rate on the DIM1-Z, so the code needs a rule per family. A
   `c4.dm.tv 00 00 <pct>` stops a fade where you want it.
4. **Button behaviour per paddle half** on the APD120 / SW120277: a select of load on / load off / toggle /
   programmable / momentary (never "disabled"), writing `c4.dmx.btn <wire> 01`. It generalises
   `paddle_local_control`. Example: the bottom half toggles the load and the top half becomes a scene button.
   Toggle, programmable and momentary all tested on the APD120. It needs bug 5 fixed first: the light's state
   must come from its `c4.dmx.ls` reports alone, never from which half was tapped.
5. **LED mode per slot**: programmed / follow load / push-release, replacing `led_N_bound` (with a migration:
   bound = push/release). Follow load is what Control4 uses on the paddle LEDs and needs no traffic from
   Home Assistant. **A status colour is one frame:** switch the LED to programmed and write its param 05. Tested:
   it stays through load changes. In follow-load mode an override only lasts until the next load change.
6. **Show only the LEDs a model has.** The APD120 and SW120277 each expose 12 slots × 3 entities for 2
   physical LEDs. Name the two real ones ("Top LED", slot 01, and "Bottom LED", slot 04, confirmed by the paint
   test) and leave the rest out, or behind an option.
7. **Backlight colour and brightness** on the KC120277 (and the keypad dimmer): a colour entity on
   `blc 00 05` (black = off) and a brightness number on `blc 00 03`. Both tested on keypad A.
8. **Last reset reason** (`c4.sy.ri`) as a diagnostic sensor, read at start and after each re-join, with a log
   line on `CRS` (crash) or `WDG` (watchdog). Both keypads here last restarted on an assert.
9. **Radio TX power** (`c4.sy.zpw`, -8 to +2 dBm) as a config number. All three devices here run at 0 dBm.
   +2 dBm could help weak spots in the mesh.
10. **Multi-click thresholds** (`c4.dmx.bmc`) on the APD120 and KC120277 too. They hold the same table as the
    SW120277, where it is already exposed.
11. **Dimming mode** on the APD120: a read-only "phase in use" sensor (`dim`) first. A settable mode (`plm`)
    only after a careful test, since the wrong phase can stress a load.
12. **The rest of the ambient light profile** (the other `blc` bytes), once a test maps them. The table refuses
    out-of-range values, so writes need its rules first.
13. **A Reboot button and automatic reboots** on the KC120277 and APD120 (and the SW120277, once tested), using
    `0i c4.sy.rb`, with the reset reason read again after it (#12).

## DIM1-Z

The DIM1-Z (the older `c4.dm.*` generation) has its own map: `dim1z-capability-map.md`.
