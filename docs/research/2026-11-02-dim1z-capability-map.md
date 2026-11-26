# C4-DIM1-Z capability map

Probed on Furn (`0x000fff000024d595`, Furnace Room, firmware `03.22.41`) on 2026-11-02, through the
house's Zigbee2MQTT and this extension. It builds on the ZHA-era research in
`control4-zha-quirks/custom_zha_quirks/control4/documentation/control4-dim1z-protocol.md`, and corrects it
where the two disagree.

What Control4's documents and the community add (tap sequences, Composer's names for the settings, the `0i`
frame type and the fade, level and reboot leads it opens) is under "What outside sources add (2026-11-07)".
The KC120277 / APD120 / SW120277 have their own map, `2026-11-07-kc-apd-sw-capability-map.md`.

## What a DIM1-Z can do

- Switch and dim one load (one channel), with its own on fade, off fade, hold ramps up and down, min,
  max, default-on level and cold start (level + time).
- Report its level as it changes (`c4.dm.t0c`), and its paddle as taps, multi-taps and hold begin / end.
- Let the paddle drive the load, or only report taps (`ba`).
- Show a colour on each of two LEDs, from four stored colours (each LED's on and off colour), and:
  - read back the colour each LED shows right now (`l0v`, `l1v`);
  - invert which colour an LED shows for the load's state, per LED (`l0l`, `l1l`, or `ll <n>`);
  - freeze both LEDs on what they show (`lm` = 0).
- Be a member of Zigbee groups (it takes a group-add command; a command sent to the group is untested).
  **Not** Zigbee scenes: the Scenes cluster's attributes are there, but no scene can be stored or recalled
  (tested 2026-11-03, below).
- Say what it is: `c4.sy.fwv` (firmware) and `c4.sy.info` (`c4:light_ip_control4:C4-DIM1-Z:`, which looks
  like the Composer driver type and the model).

That is the whole readable surface found. Nothing else answered, on either the Zigbee or the Control4 side,
in about 25,000 Control4 Gets (see Coverage).

## Method

- **Control4 Gets**: `zigbee2mqtt/Furn/set` `{"c4_get": "<prop> [args]"}`. Within 20 s of a `c4_get` the
  extension logs every reply as `Control4 REPLY Furn: 0r<seq> <status> …` (warning level), so the Z2M log
  file is the read-back. Status `000` echoes the property name. `n01` (no such name) and `e00` (wrong args)
  carry no name, so replies are matched to Gets by sequence number. A `c4.sy.fwv` anchor every 20 Gets
  proves the alignment. Paced at one Get per 0.3-0.45 s, the run produced no transmit backlog. Driven
  from HA with `repeat` / `for_each` over a Jinja-built name list (one `run_sequence` per ~340 names).
- **Long sweeps** (the `c4.sy` ones, ~23,000 Gets) ran from a temporary HA script that built each name
  from a spec, one Get per 0.25 s (~230 a minute). It was deleted afterwards. The anchor was `c4.dm.td`,
  because the extension pings devices with `c4.sy.fwv` itself. A matching generator on the HA side paired
  replies with names by arrival order. It skipped the extension's own frames (Set acks, `is` read-backs) and
  listed each name whose block came back short; those were re-probed. Once, at 22:12-22:13, Furn
  reported many-to-one route failures for 20 s under the sustained load, and 10 Gets went unanswered. The
  coordinator never ran out of buffers.
- **ZCL reads**: Zigbee2MQTT's generic converter, `{"read": {"cluster": …, "attributes": [one]}}` on the
  same topic, logged as `Read result of '<cluster>'` at info. One attribute per read: zigbee-herdsman fails
  the whole read when any attribute in it is unsupported.
- **Writes**, each restored straight after and checked against a `c4.dm.is` snapshot: the LED colour
  slots and `l0l` / `l1l` / `lt 00` / `ll 00` by raw `c4_send`; max and default-on brightness through
  Furn's own HA number entities. The load was cycled twice (on at 50 %, then off), and is off.

## Zigbee (ZCL), endpoint 1

| Cluster | Answers | `UNSUPPORTED_ATTRIBUTE` |
|---|---|---|
| genBasic | nothing | zclVersion, appVersion, stackVersion, hwVersion, manufacturerName, modelId, dateCode, powerSource, swBuildId, locationDesc, physicalEnv, deviceEnabled, alarmMask, disableLocalConfig |
| genIdentify | nothing | identifyTime |
| genGroups | nameSupport = 0 | |
| genScenes | count 0, currentScene 0, currentGroup 0, sceneValid 1, nameSupport 0, lastCfgBy 0 | |
| genOnOff | onOff | globalSceneCtrl, onTime, offWaitTime, startUpOnOff |
| genLevelCtrl | currentLevel, onLevel = 255 | remainingTime, minLevel, maxLevel, options, onOffTransitionTime, onTransitionTime, offTransitionTime, defaultMoveRate, startUpCurrentLevel |
| genTime | nothing | time, timeStatus, timeZone, localTime, lastSetTime, dstStart, standardTime |

An empty Basic cluster is why a standard interview cannot name the model. Nothing on the ZCL side
configures power-on behaviour, fades or limits: all of that lives in `c4.dm.tv`.

### Zigbee scenes do not work (tested 2026-11-03)

| Step | Result |
|---|---|
| Store the current 60 % as scene 1, group 0 (Z2M `scene_store`) | `INVALID_FIELD`; nothing stored |
| Recall scene 1, group 0 | No reply at all (Z2M timed out after 10 s); level unchanged |
| Remove all scenes, group 0 (Z2M `scene_remove_all`) | A reply too short to parse ("offset … must be <= 2") |
| Add Furn to group 999 (raw `genGroups.add`), store the current 30 % as scene 1 there | Sent; `count` stays 0 |
| Set 70 %, recall group 999 scene 1 (with, then without, the optional transition time) | Level stays at 69 % |
| Add scene 2 under group 999 with explicit level 25 % and a 3 s fade, recall it | `count` stays 0; level stays at 69 % |

`sceneValid` read 1 with the load off and 0 once it was on, and nothing else in the cluster ever changed. The
cluster answers reads, but nothing sets a level from a scene. Z2M's `zclcommand` `check_status` can't
help here: herdsman checks `statusCode`, which only default responses have, so it passes every
cluster-specific reply. Group 999 and anything under it were removed afterwards, and Z2M's database holds
no scene for Furn.

What this rules out: one Zigbee "recall" setting several DIM1-Zs to different levels. A look across DIM1-Zs
still needs one level command per dimmer (or a group command, which sets them all to the same level).

## Control4 (`c4.dm.*`, `c4.sy.*`), the complete readable namespace

Names are case-sensitive (`c4.sy.FWV` is `n01`), families match exactly, and there is no wildcard or
listing: `c4.`, `c4.sy.`, `*` and `?` are all `n01`.

| Get | Furn | Meaning |
|---|---|---|
| `c4.dm.is` | `00 64 01f4 01f4 080000 080000 000000 000000 0f` | Settings record, see below |
| `c4.dm.td` | `64` | **Default-on level %**, the same value as `tv 00 01` (default-on set to 80 → `td` = `50`). Not the live level. |
| `c4.dm.t0s` | `00` off, `31` at 50 % | **New.** Live level of load 0, % (= `tv 00 00` = `is` field 0) |
| `c4.dm.tv <ch> <slot>` | see the table below | Dimmer parameters. `e00` with fewer than 2 args |
| `c4.dm.lm` | `1` | LEDs follow the stored colours. 0 freezes them |
| `c4.dm.ba` | `1` | Paddle drives the load. 0 = taps only |
| `c4.dm.l0o` `l0f` `l1o` `l1f` | `080000` `080000` `000000` `000000` | Stored colours: top / bottom × load on / off. **Readable**, not write-only |
| `c4.dm.l0v` `l1v` | `080000` `000000` | **New.** The colour the LED shows right now: writing `l0f` with the load off changed `l0v` at once; writing `l0o` did not |
| `c4.dm.l0l` `l1l` | `1` `1` | **New.** LED polarity. 1: on-colour while the load is on. 0: inverted (off: shows the on-colour; on: shows the off-colour) |
| `c4.dm.ll <n>` | `1` | The same polarity flag, indexed: `ll 00 00` did exactly what `l0l 00` did; `ll 01` stayed 1 |
| `c4.dm.lt <n>` | `1` | Per-index flag (`lt 00` = 0 left `lt 01` at 1). Changes neither LED nor the flags byte. Meaning unknown |
| `c4.sy.fwv` | `03.22.41` | Firmware |
| `c4.sy.info` | `c4:light_ip_control4:C4-DIM1-Z:` | **New.** Identity: `c4`, what looks like the Composer driver type, the model, then an empty field. The model, from a Get. |

Write-only (from the ZHA research, not touched today): `bl` `bp` `op` `rb` `tf` `tp` `frs` `rtl` answer `e00` to
every Get, and no Set shape tried there was accepted. Every Set tried was a `0s` frame. Sent as `0i` frames on
2026-11-07, `rtl` fades and `rb` reboots (see "What outside sources add"); the Reboot button uses `rb` (#66).
**Never write `frs`** (read as factory reset).

### `c4.dm.is`

| Field | Furn | Meaning |
|---|---|---|
| 0 | `00` | Live level % |
| 1 | `64` | **Default-on level %**, not max: max set to 90 left it at `64`; default-on set to 80 made it `50` |
| 2, 3 | `01f4` `01f4` | On fade, off fade (ms) |
| 4-7 | colours | Top on, top off, bottom on, bottom off |
| 8 | `0f` | Flags: bit 0 `lm`, bit 1 `ba`, bit 2 `l0l` (= `ll 00`), bit 3 `l1l` (= `ll 01`). Bit 3 was "unmapped" before |

### `c4.dm.tv 00 <slot>`

| Slot | Furn | Meaning | Extension setting |
|---|---|---|---|
| 00 | `0000` off, `0031` at 50 % | Live level % | |
| 01 | `0064` | Default-on level % | `default_on_brightness` |
| 02 | `01f4` | On fade, ms | `on_transition` |
| 03 | `01f4` | Off fade, ms | `off_transition` |
| 04 | `1388` | Hold ramp up, ms (5000) | `hold_ramp_up`, which shows 4000 |
| 05 | `1388` | Hold ramp down, ms (5000) | `hold_ramp_down`, which shows 4000 |
| 06 | `0064` | Max level % | `max_brightness` |
| 07 | `0001` | Unknown. The same on every channel, so likely device-wide | |
| 08 | `0014` | Min level % | `min_brightness` |
| 09 | `0028` | Cold-start level % | `cold_start_level` |
| 0a | `01f4` | Cold-start time, ms | `cold_start_time` |
| 0b-3f | `00ff` | Past the end of the table | |

The table has 11 slots. The ZHA notes' "slot 00 = 100 ms" and "slot 0b = 255 ms" were a lit load's
level and the past-the-end filler.

The first argument is the load channel. Every channel other than `00` (01-05, 08, 10, 7f, 80, fe tried)
gives filler: `0018` in the % slots, `00ff` in the ms slots, `0001` in slot 07. The DIM1-Z has one channel.

## Not on this model (`n01`)

- `c4.sy.blv`, `zpc`, `zpw` (Z2IO and APD120 names), and every other `c4.sy` name of 2 or 3 characters
  (the keypad's 2-character `c4.sy.ri` and `rb` included).
- Every other family tried: `c4.dmx.*` (`dim` `pwr` `amb` `ls` `bmc`), `c4.kp.*` (`lv` `bc`),
  `c4.z2x.*` (`opt` `cts` `zchan` `zpid` `zmac` `znid` `zepid` `tmpi` `ldm`), `c4.zr.*` (`bl` `tm` `loc`),
  `c4.ln.*` (`ri` `sl`). Every name known from those families, under `c4.dm.` and `c4.sy.`, too.
- The announcement names: `t0c`, `b0c`, `b1c`, `b0b`, `b0e`, `cc`, and the outlet's `tc`, `ls`. They are
  sent by the device, not readable.
- A third LED: `l2o`, `l2f`.

## Coverage

Names match by prefix: a probe longer than a real name returns that name, and a shorter one is `n01`.
So a sweep of one length only finds names of that length. The flip side is that a long probe covers every
real name it starts with: `c4.sy.information` answers as `c4.sy.info`.

| Under `c4.dm.` | Probed | Found |
|---|---|---|
| 2 letters | 676 (ZHA research) | `is` `td` `tv` `lm` `lt` `ll` `ba` + `e00`-only `bl` `bp` `op` `rb` `tf` `tp` |
| 3 letters, under the 663 prefixes that are not names | 17,238 (ZHA research) | `e00`-only `frs` `rtl` |
| 2 characters with a digit | all 620 | none |
| letter, 0-1, letter | all 1,352 | `l0o` `l0f` `l0v` `l0l` `l1o` `l1f` `l1v` `l1l` `t0s` |
| letter, letter, 0-1 (minus the 13 real 2-letter prefixes) | all 1,326 | none |
| Long words (see below) and longer names from other families | ~390 | none new (only known names answering longer probes: `options` → `op`, `backlight` → `ba`) |

| Under `c4.sy.` | Probed | Found |
|---|---|---|
| 2 characters, a-z 0-9 | all 1,296 | none |
| 3 letters | 17,056 (all but the 20 skipped prefixes below) | none |
| Long words and house-style abbreviations | ~360 | `info` |

| Families | Probed | Found |
|---|---|---|
| `c4.<xx>.information`, `status`, `version`, `level`, `count` for every 2-letter `xx` | 3,380 | only `c4.sy` (via `info`) |
| Names known on other models: `c4.dmx`, `c4.kp`, `c4.z2x`, `c4.zr`, `c4.ln` | 24 | none |

The long-word list was about 360 words: identity, versions, network, radio, diagnostics, timing, dimming,
load, LED and sensor vocabulary, each probed in its longest form (`serialnumber`, `temperature`,
`dimmingcurve`, ...), plus house-style abbreviations (`hwv`, `zch`, `uptm`, ...).

**Skipped on purpose.** These were left out in case a Get of an action name does something:
- 3-letter `c4.sy` names starting `rb rs rt fr fa fl fw bt bo bl er up dl ot wd wr ee wi cl pg` (520 names,
  covering reboot, reset, factory, flash, firmware, boot, erase, update, OTA, watchdog, write, EEPROM, wipe,
  clear and program). `fwv` is the one known name among them.
- Words that are, or start with, an action: boot, default, leave, join, sleep, standby, test, lock, disable, bind,
  calibrate, and the abbreviations `zjn`, `zrj`, `zpj`, `ers`.

No Get has ever been seen to do anything, but `c4.sy` is where such commands would live.

Not swept: index digits 2-9 in the 3-character `c4.dm` shapes (~10,700 names), 3-character names that
start with a digit, 4-character names beyond the word list (457,000 per family), and families of 3+ letters.

## What outside sources add (2026-11-07)

Checked against Control4's dealer documentation and the community projects that publish Control4 work (sources
at the end). Only one of them captured a DIM1-Z (bharat's herdsman-converters fork, PR #2). The rest covers the
same generation (the LDZ-101 "Wireless Dimmer", the LOZ-5D1-W outlet dimmer, the KP keypads) or the newer
`c4.dmx` models. So most items below are leads to test on Furn, not facts about the DIM1-Z.

### Generation

The DIM1-Z, FS1-Z, KP2/KP3/KP6-Z and the LDZ / LSZ / KPZ models are Control4's Gen1/Gen2 wireless lighting.
Composer OS 4.0 is their last supported build (Snap One's X4 sunset table). They have run ZigBee Pro since OS 1.8
(August 2009); from OS 2.6.0 an Embernet-era device can no longer be upgraded. Control4's migration sheet
replaces the DIM1-Z with the FPD120 (forward phase). The `03.xx` firmware numbering matches the Panelized Lighting
builds, and no release notes for 03.22.41 are public. One DIM1-Z reported 03.06.16 in 2014 (SmartThings thread
3563).

### Tap sequences

| Taps | Does | Source |
|---|---|---|
| 15 on top | Reboot; keeps programming | Control4 Composer help, "Troubleshooting dimmers, switches, and keypads" |
| 5 top, 5 bottom, 5 top | "Clears all your network connections"; re-identify the device after | Same page |
| 4 on top | Identify (green / white flash). On a device that has just left its network (13-4-13), pairing mode: it joins the open network | Community; the owner, on every model |
| 9-9-9 | Factory reset | Community, 2008 |
| 7-4-7 | Show the Zigbee channel | Community, 2008 |
| 13-4-13 | Reset and leave the network it was on: the usual first step to re-pair, then 4 on top | Community, on an LSZ-102; the owner, on every model |

The newer models' install guides (APD120, SW120277, KC120277) print 4 identify, 7 channel, 15 reboot, 9-4-9
factory reset and 13-4-13 leave-and-reset. The sequences are common across the devices: 13-4-13 is the one to use
to move a device, resetting it and taking it off its old network, and 4 more taps on top then put it in pairing
mode. 15 (reboot) and 9-4-9 (reset to re-pair) work on this house's DIM1-Zs too. 5-5-5 is the only reset Control4
documents for this generation, and it is untried on a DIM1-Z.

### Hardware

- The blue wire is a switched hot through the air gap, only for powering another Control4 keypad. It is not a
  traveler, so a DIM1-Z has no wired 3-way companion.
- A whip antenna is coiled under the button and can be pulled out. Worth trying on a DIM1-Z that keeps dropping
  off, before moving routers.
- The 25 W minimum load comes from the sibling C4-6NDIM1-Z's guide (200-00143), not the DIM1-Z's own
  (200-00035 Rev D, which could not be fetched).

### Composer's names for the settings

Control4's dimmer help ("device settings for dimmers") and Control4's own 2013 HC-800 boot log (quoted in
bharat's `RESEARCH.md`) name the `tv` slots:

| Slot | Composer setting | What Control4 provisions (2013 log) |
|---|---|---|
| 01 | Preset level | 100 % |
| 02 | Click rate, ramp up | 1000 ms |
| 03 | Click rate, ramp down | 2000 ms |
| 04 | Hold ramp rate, up | 4000 ms |
| 05 | Hold ramp rate, down | 4000 ms |
| 06 | Max On | 100 % |
| 08 | Min On | 5 % |
| 09, 0a | Cold start | 0, 0 |

- The log writes the slots in the order 02 03 01 04 05 08 06 09 0a, as 32-bit values
  (`0s5227 c4.dm.tv 00 02 000003e8`), and **never writes 07**. Slot 07 is not a Composer setting.
- bharat labels 09 "Cold Start Time" and 0a "Cold Start Level" from that log alone. Furn measured the reverse
  (09 caps a write at 100, so it is the level). Composer's help names three cold-start values (%, time, level);
  the third looks like the target level, not a slot.
- **The extension's shared defaults (min 5 %, hold ramps 4000 ms, max and default-on 100 %) are exactly these
  provisioning values**, not anything a device holds from the factory. A factory DIM1-Z holds min 0 % (Composer's
  help also gives Min On's default as 0) and 5000 ms ramps. The APD120 read on 2026-11-07 holds 10 % and
  5000 ms (`2026-11-07-kc-apd-sw-capability-map.md`).
- `c4.dm.ba <0|1>` and `c4.dm.lm <0|1>` are Composer's SET_BUTTON_ATTACHED and SET_LED_ATTACHED, from an
  LDZ-101's HC-300 log (wmariz), shown in Composer as "Buttons Control Load" and "LEDs Follow Load". Both take one
  decimal digit. That matches this map: `ba` is the extension's `paddle_local_control`. The LDZ-101 notes say
  colour writes only take while `lm` is 0. Furn showed the reverse (`lm` 1 shows the stored colours, 0 freezes
  them), and that direct test stands for the DIM1-Z.
- Composer spaces its colour writes out: in one log, bursts lost three of four writes until the steps were 5 s
  apart.

### A fifth frame type, `0i`, and what it may unlock

Control4's controller sends some commands as `0i<seq>` ("interrupt") frames instead of `0s` Sets: `c4.dm.rtl`
(an HC-300 driver log, LOZ-5D1-W outlet dimmer) and `c4.dmx.off` (an APD120 provisioning capture). The DIM1-Z
refused `rtl` in `0g` and `0s` frames; `0i` was never tried.

- **Ramp to level**: `0i<seq> c4.dm.rtl <ch> <level % hex2> <time ms hex8>`, as in Control4's log
  `0if088 c4.dm.rtl 00 32 000003e8`. royceybaby confirmed it fades a C4-SDAPD240 load linearly. There is no stop
  verb: a later level command supersedes the fade. **It works on the DIM1-Z (tested 2026-11-07 on Linen Closet,
  build 4ac162f47c2f):**

  | Sent | Read back (`t0s`) |
  |---|---|
  | `0i c4.dm.rtl 00 32 000003e8` from off | `000`; 50 % 2.5 s later |
  | `rtl 00 64 00001770` (6000) from 50 % | 75 % at ~1.5 s, 100 % by ~3 s |
  | `rtl 00 00 00002710` (10 000) from 100 % | 69 % at 3 s |
  | then `0s c4.dm.tv 00 00 28` mid-fade | 40 % at once, and still 40 % 3 s later: the fade stops |
  | `rtl 00 32 00001f40` (8000) from off | 25 % at ~2 s, 50 % at ~4 s, then held |

  **The time is the length of a full 0-100 % sweep, not of this move.** A 50-point fade takes half the time
  given. To fade from level `a` to `b` in `t` ms, send `t × 100 / |b − a|`. **The APD120 (fw 5.1.1) differs:**
  there the time is this move's own duration (0→50 % in 5 s, 50→0 % in 10 s, read from its power draw on
  2026-11-07; `2026-11-07-kc-apd-sw-capability-map.md`). Fade code needs a rule per family. Readings are against the log's
  1-second timestamps, and the extension's own LED writes (the Linen Closet LED automation) shared the link.
- **Set the level now**: `0s c4.dm.tv <ch> 00 <level %>`, answered by `sa c4.dm.tc 00 <level>` on the LOZ-5D1-W
  (same HC-300 log). It also drives the SDAPD240's second load. **It works on the DIM1-Z (tested 2026-11-07):**
  on Linen Closet (off, fades `tv 02` / `03` = 500 ms), `0s c4.dm.tv 00 00 32` answered `000`, turned the light
  on (`t0s` read `32`) and Home Assistant showed it on. `tv 00 00 00` turned it off. Furn took `tv 00 00 64` and
  `tv 00 00 0064` (2- and 4-digit values) at the level it already had, with no change. Furn was not dimmed
  because its load powers a Hue bulb.
- **Reboot: `0i c4.dm.rb` reboots a DIM1-Z (tested 2026-11-07).** On 2026-11-06, `c4.dm.rb`, `rb 00` and
  `rb 01` sent as `0s` frames all got `e00` on Office Cans: the frame type was wrong, not the name. Sent as
  `0i<seq> c4.dm.rb` with no arguments, it rebooted Linen Closet (twice) and Garage Entrance:
  - **No reply.** The dimmer restarts before or just after acknowledging the frame, so Zigbee2MQTT may report
    `delivery failed (status 0xc20)`. That still means it rebooted.
  - **Send it once, without an APS acknowledgement.** When it restarts before its APS ack, the coordinator's APS
    retries each reach the freshly booted dimmer and reboot it again. The first Reboot-button press on Linen
    Closet (build 1fc0cf7567fc, frame `0i0042 c4.dm.rb` sent three times) rebooted it three times in 3.5 s: its
    frame counter stepped 0x4D000, 0x4E000, 0x4F000. From build 342f7a3a92e1 the frame asks for no APS ack.
  - **The user watched Garage Entrance:** the LEDs flashed green, then white, then went back to their own
    colours.
  - **Back in about 2 s.** The sniffer shows ~1.7 s of silence after the acknowledgement. Then the dimmer
    broadcasts Link Status and a route request, then its Control4 identity (`c4:light_ip_control4:C4-DIM1-Z`)
    on profile 0xC25D, then announces its level (`0t… sa c4.dm.t0c <level>`). No ZDO announce, and nothing at
    info level in the Z2M log.
  - **The NWK frame counter jumps to the next multiple of 0x1000** (Linen Closet: 300631 to 0x4B000, then
    307309 to 0x4C000 = 311296), as a Silicon Labs EmberZNet device does at boot. The sniffer can prove a
    reboot this way.
  - **Nothing is lost.** The load stays at its level through the reboot (30 % on Linen Closet, 99 % on Garage
    Entrance), so the Hue bulbs on Garage Entrance's load never went unavailable. Every setting read back the
    same afterwards: `is`, `tv` 01 / 04-0a, `lm`, `ba` (Garage Entrance's paddle stayed decoupled), `lt` and
    the LED colours.

  The same-generation KP6-Z reboots on `c4.kp.rb 00` (wmariz). The DIM1-Z answers `n01` to every `c4.kp.*`
  name. Still never write `frs`.
- **Sending a `0i` frame:** `{"c4_send": {"cmd": "...", "type": "i"}}` (#66). Before that, `c4_send` could frame
  only `0s`.

### Other community findings

- bharat's herdsman-converters fork, PR #2 (DIM1-Z captures, by aksondhi), agrees with the extension: `c4.dm.b<n>c`
  is a tap, `b<n>b` / `b<n>e` hold begin / end (wire 0 top, 1 bottom), `t0c <pct>` the level while ramping, and
  `cc <n> <count>` comes about 1.5-2 s after a tap, with none after a hold. pstuart's 2014 reading of `t0c` /
  `b0c` as top / bottom was wrong.
- Same-generation KP keypads: `c4.kp.llm <btn> <00|01>` (keypad managed: push / release colours, or on / off
  colours) and `c4.kp.bhp` (hold threshold, `01f4` = 500 ms).
- **Where a full verb list lives.** wmariz read Control4's wire verbs from the printable strings in Control4 driver
  binaries: `outlet_ip_control4.c4w` from a Composer install, and the unstripped `.c4l` files on an HC-1000
  controller's recovery partition (`control4_keypad.c4l`). The DIM1-Z's driver is `light_ip_control4` (its own
  `c4.sy.info`). That driver's strings would list every `c4.dm.*` verb it sends, including a reboot verb if one
  exists. Only an option for someone with a Composer install or an old controller.

### Not found anywhere public

The DIM1-Z's own guide text, the LED / CFL loads it supports, its behaviour after a power loss, and any meaning
for `lt` or slot 07.

### Sources

- Control4 dealer Composer help (docs.control4.com): "Troubleshooting dimmers, switches, and keypads",
  "Device settings for dimmers"; the APD120, SW120277 and KC120277 installation guides; Snap One's X4 sunset
  table and migration sheet.
- bharat/homeassistant-control4-dimmers, `RESEARCH.md` (the 2013 HC-800 log); bharat/zigbee-herdsman-converters
  PR #2.
- wmariz/zha-device-handlers, branch `control4`: `c4_ramp_cluster.py`, `c4_attached_switch.py`,
  `control4_outlet_dimmer.py`, `documentation/control4-kpz6b1-keypad-protocol.md`.
- royceybaby/ha-c4-keypads, `quirks/zz_c4_local_models.py`.
- SmartThings community thread 3563 (pstuart, 2014).

## Open questions

- **`lt <n>`**: per-index and writable, but it changes nothing a Get can see. Next test: someone at the
  switch while `lt 00` = 0 (top paddle) and `lt 01` = 0 (bottom), tapping and holding each half.
- **`tv` slot 07** (`1`, device-wide).
- **Zigbee groups**: the DIM1-Z takes a group-add command, but whether it then follows a command sent to the
  group is untested. Testing it needs a Z2M group (the coordinator has one spare group slot) and one
  network-wide broadcast.
- **`onLevel` = 255** (ZCL "use the previous level"): writable or not, untested.
- **`0i` frames** (each needs the frame-type option first):
  - ~~`0i c4.dm.rtl`~~: works, and its time is a full-sweep rate (tested 2026-11-07, above). **A fade from off
    skips the cold start** (Garage Inside Lights, 2026-11-08). With `tv 09` at 60 % for 1 s, `rtl 00 1e 00002710` from
    off reported 20 % (its minimum), then 30 %, never 60 %, and arrived in 2.1 s of the 3 s asked. The extension now
    holds a fade to min / max itself, and turns on from off with the ZCL level command when a cold start is set. So
    whether `rtl` respects min / max no longer matters. The full-sweep rule held again: 50 → 100 % with 8000 ms took
    4.3 s, and a fade sent mid-fade from 77 % (8696 ms for 2 s) took 2.1 s.
  - ~~`0s c4.dm.tv 00 00 <pct>`~~: sets the level (tested 2026-11-07, above). Still open: does it use the stored
    on / off fades, or jump?
  - ~~`0i c4.dm.rb`~~: reboots the dimmer, keeping its level and settings (tested 2026-11-07, above). Still open:
    does it cure a dimmer that is stuck re-joining, or whose Control4 side has gone deaf while ZDO still
    answers? A deaf firmware may not act on the frame at all; the ZDO leave-and-rejoin stays the fallback there.
    Does `rb` take an argument on this model (`0i c4.dm.rb 00` / `01`)? Untried, and not needed.
- **5-5-5** taps: what they do on a DIM1-Z. Try them on one that has to be re-paired anyway.

## What this means for the extension

Done (#58):

- **The entities show what the dimmer holds.** Each DIM1-Z's settings are read once: `c4.dm.is` for
  default-on, both fades and the paddle flag, `tv 00 08 06 04 05 09 0a` for the rest. That's 7 Gets, 30 s after a
  start (a hot-load too), through the paced state-read queue and never mid-fade. They're read again after the
  dimmer leaves the network or arrives from another instance. Before this, `hold_ramp_up` / `hold_ramp_down`
  showed 4000 while Furn held 5000, and `min_brightness` showed 5 where the factory value is 0.
- **Until that read, a DIM1-Z shows its own factory values:** min 0 %, hold ramps 5000 ms. The APD120 keeps the
  shared defaults (Control4's own provisioning values, see "Composer's names for the settings"). Its slots, read
  on 2026-11-07, hold 10 % and 5000 ms (`2026-11-07-kc-apd-sw-capability-map.md`).
- **Cold start** (`tv 09` / `0a`, `cold_start_level` / `cold_start_time`) ships, with the fade window
  stretched by the cold-start hold.
- `src/core/leds.ts` names `is` field 1 as the default-on level, not "max".

Not done:

- `c4.sy.info` names the model in one Get. The model already comes reliably from every check-in, so this
  would only confirm it.
- `c4.dm.t0s` (or `tv 00 00`) reads the live level over the Control4 channel in one Get, where the
  extension uses two ZCL reads. Untested: whether a Control4 Get is any safer mid-fade.
- `l0v` / `l1v` read back what an LED shows now: a direct check of an LED paint, where `is` only shows
  the stored slots.
- The LED polarity flags (`l0l` / `l1l`) are not exposed: the extension paints the LEDs itself, and an
  inverted LED would break its idea of which colour is showing.
- `rtl` works, so a `transition` could be one frame and a true fade of any length. The extension knows the
  current level, so it can turn the wanted duration into the sweep rate `rtl` takes.
- The README could give this generation's reboot (15 taps on top) and documented reset (5-5-5) next to the newer
  models' 9-4-9 / 13-4-13, and suggest pulling out the antenna for a DIM1-Z that keeps dropping off.

Done (#66, 2026-11-07):

- **`c4_send` takes `"type": "i"`**, which sends an interrupt frame (`0i<seq> <cmd>`).
- **A Reboot button per DIM1-Z** (`/set` `reboot`), which sends `0i c4.dm.rb`. A delivery failure on that
  frame is no error, since the dimmer restarts on receipt.
- **Automatic reboots.** A DIM1-Z is rebooted when it is listed unreachable (3 missed keepalives, or a re-join
  that answers neither check), and at later missed keepalives. It is also rebooted 30-60 s after its 3rd re-join
  within 3.5 h of its last reboot.
  - **Per dimmer:** at most 3 in any 24 h, an hour or more apart. It's a rolling count, so its own frames can't
    reset it: a rebooted dimmer announces its level within 2 s. The count lives in memory, so a restart starts it
    again.
  - **Per instance:** at most one a minute. None goes out while `no_frames` or `sends_failing` is raised, or while
    more than 3 devices are unreachable at once, since then every dimmer looks unreachable through no fault of
    its own.
  - **Opting out:** the device option `auto_reboot: false` stops them.
  - **Status:** the `unreachable` entries carry `reboot_min`, and the HA notice says a DIM1-Z is normally
    rebooted remotely.
