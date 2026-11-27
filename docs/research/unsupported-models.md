# Models people have that we don't support (2026-11-25)

Replies to the Home Assistant community post
([thread](https://community.home-assistant.io/t/control4-zigbee-dimmers-keypads-and-remotes-on-stock-zigbee2mqtt-no-control4-controller-would-you-use-it/1035683))
named Control4 devices this project doesn't handle yet. This note covers what each one is, what we know about how it
talks, and what adding it takes. It goes with the branch `c4-new-models`, which adds:

- **Probe mode.** A device that checks in with a model this build doesn't know stays usable and tells us about itself.
- **Five models built from other projects' notes**, none yet tested on hardware: the C4-KD120 keypad dimmer, the
  C4-FPD120 forward-phase dimmer (as an APD120), the C4-V-ROSW120 receptacle outlet switch, the LOZ-5D1-W outlet
  dimmer and the C4-KP2-Z keypad.

## Who has what

| Post | Who | Devices | Notes |
|---|---|---|---|
| #5 | niknam | "about 40 keypads and dimmers", no model numbers | TI coordinator now, an Ember one ordered. Will test |
| #6 | Rowch | 100+: KD120, V-FPD120, V-SW120, KC120, V-ROSW120, LSZ-3W1, KPZ-6B1, LSZ-102, LOZ-5S1, LOZ-5D1, ZIO, maybe an SR-150 and SR250 | HA Yellow (Ember), Zigbee2MQTT. Will test with guidance |
| #8 | jtela0 | SR260, Z2IO | Offered to test both |

## Model by model

"Gen3" is the board the APD120, SW120277 and KC120277 share (the `c4.dmx.*` firmware,
`kc-apd-sw-capability-map.md`). "Gen1/Gen2" is the LDZ / LSZ / KPZ / DIM1-Z generation (`c4.dm.*`,
`c4.kp.*`, `dim1z-capability-map.md`). The check-in strings and protocol notes come from other
projects' code (**What other projects found**, below). None of these models has been seen on our own networks.

| Rowch wrote | Part number (best match) | What it is | Talks | Status on this branch | What adding it needs |
|---|---|---|---|---|---|
| KC120 | C4-KC120277 | Configurable keypad | Gen3 | **Supported** | Nothing |
| KPZ-6B1 | KPZ-6B1 / C4-KP6-Z | 6-button keypad | Gen1/2 `c4.kp` | **Supported** | Nothing |
| LOZ-5S1 | LOZ-5S1-W | Dual switched outlet (plug-in) | 0xC25E outlet profile | Supported, **never tested on hardware** | A tester: pair it, switch both outlets, press its buttons |
| ZIO | C4-Z2IO-ZP | Contact / relay I/O | `c4.z2x` | Supported, **never tested on hardware** (jtela0 has one too) | A tester, as above |
| SR250 | C4-SR250B | LCD remote | `c4.ln` / remote | **Supported** | Nothing |
| (jtela0) SR260 | C4-SR260 | LCD remote | as SR250 | Supported, **never tested on hardware** | A tester |
| KD120 | C4-KD120 (checks in as `c4:control4_light:C4-KD120`) | Keypad dimmer: "an APD120 and a KC120277 in one device" | Gen3, APD firmware line | **Added, untested** (below) | A tester to confirm the button wires and LED slots on our code |
| V-FPD120 | C4-FPD120 | Forward-phase dimmer, Control4's replacement for the DIM1-Z | Gen3, as the APD120 | **Added, untested**: an APD120 under its own model | A tester. The "Essential" C4-V-FPD120 may check in differently, and stays in probe mode until one does |
| V-SW120 | Probably C4-V-SW120277 (the driver's name; nothing public under "SW120") | Switch | Gen3 | Probe mode | Its check-in. If it is `C4-SW120277` it is already supported |
| V-ROSW120 | C4-V-ROSW120 (checks in as `c4:control4_light:C4-V-ROSW120`) | In-wall duplex receptacle with one button | ZCL on/off on EP1, no reports; one button (id 00) on `c4.dmx` | **Added, untested** (`src/devices/rosw120.ts`): ZCL on/off, its state read back 1 s after each command and tap, `c4.dmx.tc` as its button's switch, the button as `button_1` | A tester: switch it, tap the button, and check which outlet it switches |
| LOZ-5D1 | LOZ-5D1-W | Plug-in dimmer, two dimmable outlets, 700 W total | Both outlets on the `c4.dm` channel protocol; both report `c4.dm.tc` | **Added, untested** (`src/devices/outlet-dimmer.ts`): lights `l1` / `l2` driven by `c4.dm.tv <ch> 00 <pct>` (as the Control4 controller drives them), fades by `0i c4.dm.rtl`, levels read with Gets at start | A tester: dim each outlet, fade one, press its buttons |
| LSZ-102 | LSZ-102 / LSZ-101 | Gen1 unit: a switch (wmariz) or a dimmer (defjam903) | Gen1 `c4.dm` dialect, ZCL on EP1 | Probe mode | Its check-in, fingerprint and button frames. 2010-era units may run Embernet and never join |
| LSZ-3W1 | LSZ-3W1-x | Gen1 three-way unit; "doesn't control the load" (pstuart) | Gen1 `c4.dm`? | Probe mode | As the LSZ-102 |
| SR-150 | C4-SR150B-Z-B (bharat's list) | Remote without an LCD | Unknown | Probe mode | Its button frames: every key once, to build its button map |

**Not from the thread.** One of the houses this already runs in has a **C4-KP2-Z** (2-button keypad). A 2014
SmartThings capture shows it checks in as `c4:control4_keypad:C4-KP2-Z` (firmware 03.22.41) and sends the KP3/KP6's
`c4.kp.bb` / `bc` / `cc` frames, on button ids 00 and 02 (top and bottom, most likely). **Added, untested**: a
`Keypad` whose `button_1` / `button_2` are ids 00 / 02, each with the LED slot of its id. To check on that one: tap
each button, read the action, and set each button's colour.

## Probe mode

A check-in that names a model this build doesn't know used to leave the device stranded. Its Zigbee2MQTT record was
stamped with that model, no definition matched it, and the generic `c4_get` / `c4_send` keys stopped reaching it.
Now:

- **Its record stays the generic C4-Zigbee** (`definitionModel()`), so its definition still serves `c4_get`,
  `c4_send` and `c4_model`. The learned model is kept in the store, and a **Reported model** diagnostic entity
  shows it.
- **Its check-ins are answered** as always, so it stays ours.
- **The extension logs a warning once a start**: `Control4: <name> (<ieee>) reports model <X>, which this build
  doesn't support yet ...`.
- **Every frame it sends is logged at info**: `Control4 UNSUPPORTED <name> (<X>) <- <frame>`. The first 500 a run
  go to info and the rest to debug.
- **A fingerprint read runs once per device**, 30 s after it appears. It sends ten read-only Gets (listed below),
  logs every reply on one line, then adds a hint line saying which family the device looks closest to. The result is
  saved (`fingerprint` in the store), so it doesn't run again at the next start. A device that leaves two Gets in a
  row unanswered ends the read: older models may not answer Gets at all.
- **Once a build adds the model**, the same device is adopted at the next check-in or start, with no re-pairing.

| Get | Answered `000` means |
|---|---|
| `c4.sy.fwv`, `c4.sy.ri` | Firmware version and reset reason (Gen2/Gen3 boards) |
| `c4.dmx.bmc 00`, `c4.dmx.btn 00 01`, `c4.dmx.led 00 01` | The Gen3 board: an APD120 / SW120277 / KC120277 relative |
| `c4.dmx.amb 00` | An ambient light sensor |
| `c4.dm.is`, `c4.dm.tv 00 00` | A `c4.dm` load (DIM1-Z, APD120, outlet dimmer) |
| `c4.dm.tv 01 00` | A second load channel (dual outlet, dual-load dimmer) |
| `c4.kp.bhp` | The KP3-Z / KP6-Z keypad protocol |

`n01` means no such name, and `e00` means the name exists but the arguments are wrong. Both still say which
namespaces the firmware has.

### What to ask a tester for

1. Install the build, permit join, and pair the device: **13-4-13** (13 taps on the top button, 4 on the bottom,
   13 on top) resets it and takes it off its old network, then **4 taps on top** put it in pairing mode. The
   sequences are the same on every Control4 Zigbee wall device. It shows up as **C4-Zigbee**, and its **Reported model** entity
   names what it said.
2. Leave it a minute for the fingerprint read.
3. Press each button once, then double-tap one and hold one. On a load device, also switch the load from the device
   itself.
4. Send the Zigbee2MQTT log lines for that device. In the add-on log, these are the lines that contain both
   `Control4` and its name or IEEE.

That is enough to write its family. For anything else, the Zigbee2MQTT dev console can send
`{"c4_get": "<prop> [args]"}` to the device and read the `Control4 REPLY` line back.

## The C4-KD120, as built

`src/devices/kd120.ts`. Control4 says the keypad dimmer is "an APD120 and a KC120277 in one device", and its
firmware is on the APD120's release line (4.0.39, 4.2.84, 4.4.23, 5.0.9). So it is a `Kc120277` (the button kit,
layout learning and numbering options, LEDs, backlight, ambient sensor) with the APD120's dimmer added. The dimmer
is now a component both share: `DimmerLoad` in `gen3.ts`, moved out of `Apd120` with no change to the APD120's
behaviour.

The KD120's entities are:

- a light (ZCL level on EP1, as the APD120), the fades, the tv parameters and cold start
- the KC120277's buttons, LEDs, backlight and ambient light, and an auxiliary keypad's presses (wires 07 / 08) as
  `aux_top` / `aux_bottom`
- power and energy from `c4.dmx.ls`, plus the dimming phase, fault, reset reason and TX power
- **`button_position_N_behaviour`**: what each fitted button does to the load (toggle, load_on, load_off, momentary,
  event_only), written with `c4.dmx.btn <wire> 01 <code>`. Code `05` is never written. Out of the box every button
  toggles the load, so to make one a pure scene button, set it to `event_only`.

Each assumption, what other projects found (2026-11-26), and how to check it on a real one:

| Assumption | What others found | How to check |
|---|---|---|
| It checks in as `C4-KD120` (`C4-KD277`, `C4-KD240` too) | **Confirmed for C4-KD120**: `c4:control4_light:C4-KD120`, five units on 5.1.1. KD277 is in bharat's converter but unseen; KD240 is a guess | The learned-model log line |
| Its buttons report wires 00-05 by their top slot, as a KC120277 | **Confirmed**: `bp 00` to `05`, a tall button by its top slot. A tap is `bp`, `sc`, `cc 00 01`; a hold `bp`, `hc`, `he` | Press each button and read the `action` |
| An auxiliary keypad reports on wires 07 / 08 | **Found**: `bp 07` / `08` from an aux keypad wired to a KD120. Named `aux_top` / `aux_bottom` here | Press an aux keypad |
| The split up/down button's ids | **Not found.** On the dual-load SDAPD240 it is 05 up / 06 down | Press it |
| Its load is ZCL level on EP1, its state `c4.dmx.ls` with the power fields | **Confirmed**: no ZCL reports; `c4.dmx.ls` is the state | Switch it and read the state and power |
| `c4.dm.is` is the APD120's tv table in slot order | **Not found**: bharat reads `c4.dm.tv 00 <slot>` one at a time. A reply of another shape is skipped | The settings read's log line |
| Cold start: `tv` 09 level, 0a time | bharat has them the other way round. Our DIM1-Z and APD120 measurements say 09 level, 0a time. Unsettled for the KD120 | Set a cold start and watch |
| LED N is beside button wire N | **Confirmed** by bharat's integration. Whether `led <n> 00` links an LED to a button is disputed (royceybaby: no) | Set an LED colour and look |
| Every button toggles the load from the factory, in firmware | **Confirmed**: Control4's guide says click any button to turn the light on; bharat removed his software toggle for it | Tap one with no controller |
| Backlight `c4.dmx.blc 00 05 <rgb>`, black = off | **Confirmed** on a KD120 (5.1.1). Its factory colour `0080ff` isn't in our palette, so it reads as unknown | Read the backlight entity |

## What other projects found (2026-11-26)

A search of the other public Control4 Zigbee projects on GitHub: bharat's `homeassistant-control4-zigbee` (once
`homeassistant-control4-dimmers`) and his zigbee-herdsman-converters fork (branch `control4-26.125.0`), royceybaby's
`ha-c4-keypads`, wmariz's and pvanbaren's zha-device-handlers (branch `control4`), lights0123's and pstuart's
SmartThings drivers, and the forum threads they link. Koenkk's upstream converters have no Control4 device.

**C4-KD120.** The table above. The main outside evidence is one owner's five KD120s on firmware 5.1.1 (bharat's
converter PR #1; his integration's issues #117 and #242 and PRs #193, #225, #226 and #252).

**C4-FPD120.** `"C4-FPD120"` in bharat's converter, on the APD120's definition (ZCL light on EP1, the text protocol
on EP197). His README calls it the APD120's twin, top and bottom paddle. No frames published. Control4's driver
files are named `C4-V-FPD120`, `C4-V-ROSW120` and `C4-V-SW120277`, so "V-" names a driver line, not always the model.

**C4-V-ROSW120** (bharat's issue #2; converter lines 553-578). It checks in as `c4:control4_light:C4-V-ROSW120`
(firmware 1.1.59). EP1 is HA but lists only Basic and Power Configuration. ZCL on/off on EP1 works anyway, with no
default response, no reports and no binds, so its state has to be read back after each command. It answers
`c4.dm.tv` but not `c4.dmx.dim`, `ls` or `amb`. Its one button sends `c4.dmx.bp 00`, `sc 00`, `tc 00 <level>` and
`cc 00 <n>`. No controllable LEDs. Which outlet the button switches isn't confirmed.

**LOZ-5D1-W** (wmariz's `control4_outlet_dimmer.py`, lights0123's SmartThings driver). Manufacturer code 0x1040.
Outlet 1 is ZCL Move to Level with On/Off on EP1. Outlet 2 is `0s<seq> c4.dm.tv 01 00 <pct>` on the text profile,
per wmariz (no endpoint of its own); lights0123 sees an EP2 for it instead. Both report `sa c4.dm.tc <outlet>
<pct>`, with intermediate values while ramping. A fade is `0i<seq> c4.dm.rtl <outlet> <pct2> <ms8>`. Its button
ids aren't captured.

**LDZ / LSZ (Gen1).** Snap One's docs give the check-in `c4:light_ip_control4:ldz-101-w:`. Manufacturer code 0xABCD,
standard clusters on EP1 plus an EP198 on 0xC25E. ZCL level on EP1. Reports are the old `c4.dm` dialect: level
`c4.dm.t0c <pct>`, clicks `c4.dm.cc <btn> <n>` (0 top, 1 bottom), press and hold `c4.dm.b<btn><c|b|e>`, LEDs
`c4.dm.l0o` / `l0f` / `l1o` / `l1f <rgb>`. wmariz treats the LSZ as a switch, defjam903 (with four LSZ-101s) as a
dimmer. An HA thread never got an LSZ-102 to pair, and suspects 2010-era units run Embernet.

**C4-SR150, LSZ-3W1, "C4-SW120".** Nothing usable.

**Also seen.** The dual-load C4-SDAPD240 (royceybaby, on hardware): load 2 by `c4.dm.tv 01 00 <pct>`, buttons 00-04
plus a rocker on 05 up / 06 down, `btn` codes 10 / 11 / 12 for load 2, and LED mode `0b` to follow load 2. An
auxiliary keypad (C4-KA) on a Gen3 load device reports as wires 07 / 08, and on a `c4.dm` device as 0 / 1. That
holds for the APD120 and SW120277 as well, which don't name those wires yet.

## Next steps

1. **Get the build to Rowch and jtela0.** Rowch's LOZ-5S1, LOZ-5D1, ROSW120, ZIO, KD120 and FPD120 and jtela0's
   SR260 and Z2IO all run on code that has never met a real device; so does the KP2-Z. The rest of Rowch's devices
   are in probe mode and give us their logs.
2. **From each log, add the model.** A Gen3 fingerprint with a known shape (the "Essential" V-FPD120, a V-SW120277)
   is an alias in `MODELS` plus a test. A new shape is a family.
3. **The LOZ-5D1's open questions.** Whether outlet 2 has an EP2 (the two sources disagree; this build doesn't
   need one, both outlets go over `c4.dm`), whether its mid-ramp `tc` reports should be held back as the APD120's
   are, and what its buttons send.
4. **The ROSW120's open question.** Which outlet its button switches, and whether `state` should name that outlet.
5. **The Gen1 LSZ switches and SR-150 remote** need their button frames before anything else. Their fingerprints
   may well come back empty.
6. **Aux keypads on the APD120 / SW120277** (wires 07 / 08) need names there too, as the KD120 has.
7. **Blueprints and tools.** The `c4_device` blueprint's model picker, `gen-c4-device.mjs` and `c4-scenarios.mjs`
   don't list the new models yet. Add each once a real one has confirmed its buttons.
