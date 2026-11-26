# Models people have that we don't support (2026-11-25)

Replies to the Home Assistant community post
([thread](https://community.home-assistant.io/t/control4-zigbee-dimmers-keypads-and-remotes-on-stock-zigbee2mqtt-no-control4-controller-would-you-use-it/1035683))
named Control4 devices this project doesn't handle yet. This note covers what each one is, what we know about how it
talks, and what adding it takes. It goes with the branch `c4-new-models`, which adds two things:

- **Probe mode.** A device that checks in with a model this build doesn't know stays usable and tells us about itself.
- **The C4-KD120 keypad dimmer**, built from notes alone and not yet tested on hardware.

## Who has what

| Post | Who | Devices | Notes |
|---|---|---|---|
| #5 | niknam | "about 40 keypads and dimmers", no model numbers | TI coordinator now, an Ember one ordered. Will test |
| #6 | Rowch | 100+: KD120, V-FPD120, V-SW120, KC120, V-ROSW120, LSZ-3W1, KPZ-6B1, LSZ-102, LOZ-5S1, LOZ-5D1, ZIO, maybe an SR-150 and SR250 | HA Yellow (Ember), Zigbee2MQTT. Will test with guidance |
| #8 | jtela0 | SR260, Z2IO | Offered to test both |

## Model by model

"Gen3" is the board the APD120, SW120277 and KC120277 share (the `c4.dmx.*` firmware,
`2026-11-07-kc-apd-sw-capability-map.md`). "Gen1/Gen2" is the LDZ / LSZ / KPZ / DIM1-Z generation (`c4.dm.*`,
`c4.kp.*`, `2026-11-02-dim1z-capability-map.md`). No check-in string for any model below has been seen, so each
alias is a guess from the part number until a log shows the real one.

| Rowch wrote | Part number (best match) | What it is | Talks | Status on this branch | What adding it needs |
|---|---|---|---|---|---|
| KC120 | C4-KC120277 | Configurable keypad | Gen3 | **Supported** | Nothing |
| KPZ-6B1 | KPZ-6B1 / C4-KP6-Z | 6-button keypad | Gen1/2 `c4.kp` | **Supported** | Nothing |
| LOZ-5S1 | LOZ-5S1-W | Dual switched outlet (plug-in) | 0xC25E outlet profile | Supported, **never tested on hardware** | A tester: pair it, switch both outlets, press its buttons |
| ZIO | C4-Z2IO-ZP | Contact / relay I/O | `c4.z2x` | Supported, **never tested on hardware** (jtela0 has one too) | A tester, as above |
| SR250 | C4-SR250B | LCD remote | `c4.ln` / remote | **Supported** | Nothing |
| (jtela0) SR260 | C4-SR260 | LCD remote | as SR250 | Supported, **never tested on hardware** | A tester |
| KD120 | C4-KD120-xx / C4-KD277-xx | Keypad dimmer: "an APD120 and a KC120277 in one device" | Gen3, APD firmware line | **Added, untested** (below) | A tester to confirm the check-in string, button wires and LED slots |
| V-FPD120 | C4-FPD120-xx | Forward-phase dimmer, Control4's replacement for the DIM1-Z | Gen3 most likely | Probe mode | Its check-in and fingerprint. If it answers `c4.dmx`, it is an APD120 alias (forward phase only) |
| V-SW120 | C4-SW120-xx? (no public datasheet under this number) | 120 V switch | Gen3 most likely | Probe mode | As the FPD120: if `c4.dmx`, an SW120277 alias |
| V-ROSW120 | C4-V-ROSW120-xx | In-wall duplex receptacle: one always-on outlet, one switched; a repeater | Unknown: Gen3, or the LOZ outlet profile | Probe mode | Its fingerprint decides: `c4.dmx` means an SW120277 with one relay; 0xC25E reports mean the outlet family with one switched outlet |
| LOZ-5D1 | LOZ-5D1-W | Plug-in dimmer, two dimmable outlets, 700 W total | Gen1/2 `c4.dm`, two channels | Probe mode | A new "outlet dimmer" family, below |
| LSZ-102 | LSZ-102-x | Gen1 wireless switch | Gen1 `c4.dm`? | Probe mode | Its check-in, fingerprint and button frames. Probably close to the FS1-Z |
| LSZ-3W1 | LSZ-3W1-x | Gen1 three-way unit (SmartThings forum users call it a 3-way dimmer) | Gen1 `c4.dm`? | Probe mode | As the LSZ-102. Probably close to the DIM1-Z |
| SR-150 | C4-SR150 | Remote without an LCD | remote, as SR250? | Probe mode | Its button frames: every key once, to build its button map |

**Not from the thread.** One of the houses this already runs in has a **C4-KP2-Z** (2-button keypad) that nothing handles
yet. By generation it should be the `Keypad` class with two buttons, but which button ids it sends is unknown. Probe
mode logs them the first time someone presses it.

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

1. Install the build and pair the device as usual. It shows up as **C4-Zigbee**, and its **Reported model** entity
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
- the KC120277's buttons, LEDs, backlight and ambient light
- power and energy from `c4.dmx.ls`, plus the dimming phase, fault, reset reason and TX power
- **`button_position_N_behaviour`**: what each fitted button does to the load (toggle, load_on, load_off, momentary,
  event_only), written with `c4.dmx.btn <wire> 01 <code>`. Code `05` is never written. Out of the box every button
  toggles the load, so to make one a pure scene button, set it to `event_only`.

Taken on trust from bharat's KD120 work, and to check on a real one:

| Assumption | How to check |
|---|---|
| It checks in as `C4-KD120`, `C4-KD277`, `C4-KD120/277` or `C4-KD240`, with a colour suffix allowed | The learned-model log line. A different string leaves it in probe mode, with the string in the log |
| Its buttons report on wires 0-6 like a KC120277, and the default "pairs" numbering fits | Press each button and read the `action` |
| Its load reports `c4.dmx.ls` like an APD120's, with the power fields | Switch it and read the state and power |
| `c4.dm.is` is the APD120's tv table in slot order | The settings read's log line |
| Its LED slots follow the KC120277's: one per position, beside its button | Set an LED colour and look |
| A load button in toggle mode switches the load in firmware, and a held load button sends only a press | Tap and hold one, then read the actions and the state |

## Next steps

1. **Get the build to Rowch and jtela0.** Rowch's LOZ-5S1, ZIO and KD120 and jtela0's SR260 and Z2IO all run on code
   that has never met a real device. The rest of Rowch's devices are in probe mode and give us their logs.
2. **From each log, add the model.** A Gen3 fingerprint with a known shape (FPD120, SW120, maybe ROSW120) is an
   alias in `MODELS` plus a test. A new shape is a family.
3. **The LOZ-5D1 outlet dimmer** needs a family. What we know comes from a Control4 HC-300 log: `0s c4.dm.tv <ch>
   00 <pct>` sets a channel's level and is answered `sa c4.dm.tc 00 <level>`, and a fade is `0i c4.dm.rtl 00 32
   000003e8` (50 % over 1 s). It would be two light endpoints (`l1` / `l2`, as the LOZ-5S1's switches), each driven
   by its channel. Still unknown: whether channel 01 is the second outlet, whether it reports on 0xC25E like the 5S1,
   and what its buttons send.
4. **The Gen1 LSZ switches and SR-150 remote** need their button frames before anything else. Their fingerprints
   may well come back empty.
5. **Blueprints and tools.** The `c4_device` blueprint's model picker, `gen-c4-device.mjs` and `c4-scenarios.mjs`
   don't list the KD120 yet. Add it once a real one has confirmed its buttons.
