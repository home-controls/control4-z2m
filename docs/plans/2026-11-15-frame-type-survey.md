# Frame-type survey: finding what else the switches can do

**2026-11-15.** A plan to find the commands these devices take that no Get shows, now that the frame type is
known to matter. It covers the KC120277, APD120 and SW120277 (the Gen3 board) first, then whatever the DIM1-Z
has left.

## Why the frame type matters

Each Control4 frame starts with a type: `0s` Set, `0g` Get, `0r` reply, `0t` announcement, and `0i`, which
Control4's controller uses for some commands. For years the remote reboot and the hardware fade looked absent: `rb` and
`rtl` answered `e00` to every Get and Set. Both were `0i` commands all along (2026-11-07). On 2026-11-15 the same idea
found the Gen3 board's reboot (`0i c4.sy.rb`, on the Kitchen Keypad and the Dining Room Hanging Light). The same session
confirmed that `c4.sy.zpw` sets its radio power for real (see the research map).

What the devices answer tells us a lot, before anything acts:

| Answer | Meaning |
|---|---|
| `n01` | No such name, on any frame type |
| `e00` | The name exists, but not this way: the wrong frame type, or the wrong number of arguments |
| `v01` | The name and argument count are right; a value is out of range. Nothing happened |
| `000` | Taken (for a command, done) |
| `0r<seq>` with no status | Seen once, from the DIM1-Z's `0i bp` with 0-1 arguments |

So a name that answers `e00` to every Get is a candidate command of some frame type. And `v01` is the safe way to
learn a command's argument count without running it.

## Where things stand

| Model | Names swept | Write-only names (`e00` to a Get) | Tried as `0i` |
|---|---|---|---|
| DIM1-Z | All 2- and 3-letter names under `c4.dm.` and `c4.sy.`, plus digit shapes and ~750 long words (the DIM1-Z map, Coverage) | `bl` `bp` `op` `rb` `tf` `tp` `frs` `rtl` | All but `bl` and `frs`. `bp`'s job is unknown |
| APD120 | Only names from the ZHA-era notes and other models | `c4.sy.rb`, `c4.dm.rb`, `c4.dm.rtl` | `c4.sy.rb` (reboots), `c4.dm.rtl` (fades) |
| KC120277 | The same | `c4.sy.rb`, `c4.dm.rb`, `c4.dmx.rbp`, `c4.dmx.bl` | `c4.sy.rb` (reboots) |
| SW120277 | None here | | |

The Gen3 board has never had a full name sweep. That's the biggest gap, and the safest place to look.

## The method

One device at a time, from the allowed list (the Kitchen Keypad and the Dining Room Hanging Light), with every write
snapshotted first and put back after.

### Step 1: find every name, by Gets (read-only)

- **What to sweep:** the shapes that found the DIM1-Z's names, under `c4.dmx.`, `c4.dm.` and `c4.sy.`:
  - every 2-character name (letters and digits);
  - 3 letters under every prefix that isn't itself a name;
  - letter-digit-letter and letter-letter-digit;
  - the ~750-word list.

  Names match by prefix (a longer probe answers as the real name it starts with), which keeps this tractable.
- **How:** a temporary Home Assistant script builds the names and sends `{"c4_get": ...}` to
  `zigbee2mqtt/<device>/set` every 0.25 s, about 230 a minute. The replies come from the `Control4 REPLY` lines in the
  Zigbee2MQTT log, paired by sequence number. Anchor every few dozen Gets with a name the extension never sends
  (`c4.dmx.bmc 02`). This is how the DIM1-Z's 17,000-name sweep ran.
- **Cost:** about 18,000 names per prefix, so about 80 minutes per prefix per device. Three prefixes on one device is
  an evening; the second device only needs the names the first one found, and a spot check.
- **Skip, as before,** the 3-letter `c4.sy` names that look like actions (reset, factory, flash, boot, erase, update,
  write, wipe, clear, program, leave, join), in case a Get of an action name acts. No Get has ever been seen to act.
- **Out:** every name that answers `000` (readable) and every one that answers `e00` (write-only).

### Step 2: each write-only name's frame type and argument count, without running it

For each `e00` name, never with zero arguments first (a zero-argument command runs: that's how `rb` reboots):

1. Send it as `0i` with 6 arguments, each an out-of-range value (`ff`, or `ffffffff` for a long one).
2. Then 5, 4, 3, 2 and 1 arguments, the same way.
3. **The first count that answers `v01` is its argument count, and nothing ran.** `e00` at every count means it isn't
   an `0i` command, or it takes no arguments.
4. A `000` at any count means it ran with those values. Stop: read back everything related, and write it down.

Do the same as `0s`, for names that answer `e00` to a Get but may still be Sets taking more arguments than tried.

### Step 3: the frame types nobody has tried

- Only `s`, `g`, `i`, `r` and `t` have ever been sent. Each new type that answers is a new set of commands, as `0i` was.
- Send a harmless name (`c4.sy.fwv`) under every type letter `a`-`z`, and with `1`-`9` in place of the leading `0`.
- Note which answer (`000`, `e00`, `n01`, or silence).
- Every type that answers gets Step 2 for the write-only names.
- **This needs a small change to the extension:** `c4_send` takes only `"s"` and `"i"` today. Let it take any type
  letter, and an `"ack": false` option, for commands that may reboot.

### Step 4: what each command does

- **Read back the related table** (`led`, `btn`, `blc`, `tv`, `is`) before and after.
- **Watch the sniffer** for the frame counter, check-ins, RSSI and announcements.
- **Watch Home Assistant's state.**
- **Have a person at the device** for anything visible.
- **One command and one value at a time,** each restored after.

### Rules that hold throughout

- **Never send:** `bl`, `rbp`, `frs`, or `c4.dmx.btn <wire> 01 05`.
- **Zero arguments only once the count is known to be zero,** and with the user's go-ahead (it may reboot).
- **A command that may reboot goes without an APS ack** (the DIM1-Z reboots once per retry).
- **Stop at anything unexpected:** a device that stops answering, a load that changes, an LED that does something new.

## Radio power on the DIM1-Z: what's left

The `0i` idea has already been tried there:
- **Its write-only names:** none sets power.
- **`c4.sy.zpw`:** doesn't exist on the DIM1-Z (`n01`).
- **Control4's own provisioning:** it never set this generation's power.
- **The hardware:** its output dips about 11 dB for half of every mains cycle, which no setting would fix.

Three leads remain, in order of safety:

1. **Step 3's new frame types,** sent with `zpw` and the other power-sounding names.
2. **Write Attributes on its network-profile cluster** (`0xC25D`, cluster 1, endpoint 2). Attribute `0x0015` is an
   int8 that reads `-1` and is otherwise unexplained, which is the shape a power offset would take.
   - **The test:** write it to `3`, read it back, compare its RSSI at the sniffer over a few minutes, and put `-1`
     back.
   - **Never write** `0x0008`-`0x000c`: they hold the controller's identity and the Zigbee channel.
   - This needs the user's go-ahead, since nothing has been written to that cluster yet.
3. **`bl`:** never. It may be a bootloader entry.

The odds are low, but each test is short.

## What it would ship

- **Already found, ready to build:**
  - a **Reboot** button and the automatic reboots (ADR 0006) for the KC120277, APD120 and SW120277, using
    `0i c4.sy.rb`. Read the reset reason again after it, since these models send no announce;
  - the TX power note that the radio takes -10 to +2 dBm.
- **From the survey:** whatever Steps 1-4 find that is safe and useful, each with its research-map entry, its test and
  its README line, as in the completion plan.

## Results so far (2026-11-15)

Run on Garage Inside Lights (DIM1-Z) and the Kitchen Keypad (KC120277), the sniffer pairing each probe with its
reply by sequence number. Two probe tools were added to the extension:
- **`c4_send`** takes any frame type letter (`"type": "x"`, or a digit then a letter) and `"ack": false`.
- **`c4_raw`** sends raw bytes on a Control4 profile, cluster and endpoints.

While a probe waits, any frame the device sends back is logged (`Control4 FRAME`, `Control4 RAW`).

**Frame types (Step 3).** `c4.sy.fwv` under every letter `a`-`z`, and `1g`-`9g`:

| | `g` | `i` | `s` | `t` | Any other letter | A digit first (`1g`) |
|---|---|---|---|---|---|---|
| DIM1-Z | the value (`03.22.41`) | `e00` | `e00` | `e00` | silence | `<d>r<seq>004`, no space |
| KC120277 | the value | `e00` | `e00` | `e00` | the same letter back, with `00` | `<d>r<seq> 00` |

- **Both act on exactly four types:** `g`, `i`, `s` and `t`.
- **`0t`, the type the devices use for their own announcements, is a fourth way in,** never tried before.
- **Its names are the same table:** known names answer `e00`, unknown ones `n01`, with or without an `sa` in front.
  So it adds no names, but it may give existing ones another action, as `0i` did.

**The DIM1-Z's last two unknown names:**
- **`bp` presses the paddle remotely.**
  - **Arguments:** `0i c4.dm.bp <button> <event>`, where the button is `00` top, `01` bottom or `ff` both (`02`:
    `v01`), and the event is `00`, `01` or `02` (`03` and up: `v01`).
  - **Event `01`** turned the load on through the dimmer's own logic, as a tap does. **`02`** took it from 29 % to full
    in half a second. **`00`** did nothing visible, likely a release.
  - **It announces nothing:** no `b0c` / `cc` appears for these presses.
  - **No readable setting changed** (`lt`, `ll`, `ba`, `is`, `lm`, `tv 07`).
- **`bl` takes 4 to 6 arguments, and is no bootloader entry.** With 1-3 arguments it answers `e00`. `bl ff ff ff ff ff
  ff` answered `000`, the dimmer kept running, nothing readable changed, and its radio didn't change. The probe
  `c4.dm.blink` answers as `bl` (the prefix rule). So it's most likely an LED blink, to be read with someone watching
  the switch.

**The network-profile cluster (`0xC25D`, cluster 1, endpoint 2), through `c4_raw`:**
- **Writable:** `0x0001` (10), `0x0002` (300) and `0x0003`, tested by writing each its own value. **Refused
  (`0x86`):** `0x0000`, `0x0005`, `0x0006`, `0x000b`, `0x0012` and `0x0015`. The controller's identity (`0x0008`-`0x000a`)
  was left alone.
- **`0x0003` is a count since the last boot:** it was 4 on Garage Inside Lights and 0 on two others, and reads 0
  again after a reboot. Control4 reads it in the 90 s status report.
- **Setting `0x0003` 4 → 0 changed nothing on the radio,** before or after a reboot.
- **No discovery:** Discover Commands and Discover Attributes answer `0x82` (unsupported). Every other cluster ID on
  endpoint 2 answers attribute 0 with `0x86`.

**Name sweeps on the DIM1-Z** (read-only, about 3,300 Gets, all `n01` but the known names):
- every uppercase 2-character name (A-Z then A-Z / 0-9) under `c4.sy.` and `c4.dm.`, 1,872 in all;
- the 520 `c4.sy.` 3-letter names skipped in 2026-11 (starting `rb rs rt fr fa fl fw bt bo bl er up dl ot wd wr ee wi cl pg`);
- 134 radio, power, network and diagnostic words of 4 or more letters, under both families;
- the radio-sounding 3-character shapes with a digit (`zp0`-`zp9`, `tx0`-`tx9`, …);
- 15 radio-sounding families (`c4.zb.`, `c4.rf.`, `c4.em.`, …), each with 8 names.

### Round two (the same evening)

Everything a first pass couldn't reach, on Garage Inside Lights unless named.

**Names hidden behind real names.** A probe longer than a real name answers as that name, so no sweep could see a
3-character name that starts with one of the 13 real 2-letter names (`is`, `tv`, `rb`, …), or a 4-character name that
starts with a real 3-character one. All 936 were probed (each real name plus `a`-`z` / `0`-`9`), and again with
arguments where the real name needs them (`tv` with 2, `lt` / `ll` with 1, the write-only names with 1 and 2):
- **`c4.dm.is2` exists:** `000 c4.dm.is2 64 14 00 0000`. The table holds it before `is`, so `is2<anything>` answers
  as `is2` and every other `is<x>` as `is`.
  - **It's a second settings record:** max % (`tv` slot 06), min % (08), cold-start level % (09) and cold-start time,
    ms (0a). It matches `tv 00 06` / `08` / `09` / `0a` read straight after. One Get reads all four.
  - It answers with or without an argument, and has nothing to do with the radio.
- **Nothing else.** Every other probe answered as its real name, or `e00` for a write-only one.
- **`c4.dm.ll` with no argument answers `e0`,** two characters, the only such status seen. With an argument it reads
  as before.

**`tv` slot 07 is a flag.** `0s c4.dm.tv 00 07 00000000` stuck (read back `0000`), `00000001` stuck, `00000002`
answered `000` but read back `0001`.
- **At 0, nothing measurable changed.** RSSI at the sniffer stayed −82 / −74 dBm (weak / strong half-cycle, 40 s
  each), and a turn-on to 50 % still went to 50 %.
- **Its meaning is still unknown.** It's back at 1, as Control4 leaves it.

**`0t` takes no command.** Every known name answers `e00` with 0 to 3 arguments (`00`). Unknown names and the
announcement names (`t0c`, `b0c`, `cc`, with or without `sa`) answer `n01`. The DIM1-Z parses an `0t` name and
refuses the frame.

**The endpoints.** The interview lists four:
- **1:** Home Automation.
- **196:** 0xC25D, cluster 1.
- **197:** 0xC25C, clusters 1 and 0.
- **198:** 0xC25E, cluster 2.

The firmware ignores the destination endpoint: the extension's frames go to endpoints 1 and 2 and are answered.
- **0xC25D cluster 1:**
  - **Attributes 0x0016-0x00ff:** all unsupported.
  - **On endpoint 196:** the same attributes as on endpoint 2. A read answers 0x0000-0x0006 and 0x0008-0x000a,
    leaves out 0x0007, 0x000b and 0x000c (sent only in reports), and stops at 0x000d (unsupported).
  - **Manufacturer-specific frames** (code 0xABCD, the Silicon Labs sample default that every Control4 device here
    reports in its node descriptor) are answered as if plain. No hidden attributes.
- **The 90 s status report, decoded:**

  | Attribute | Value | Meaning |
  |---|---|---|
  | 0x0012 | `0000` (2 bytes) | Unknown |
  | 0x0013 | −52 to −62, report to report | int8, most likely the RSSI of what the dimmer hears |
  | 0x0014 | 254 | Most likely the LQI |
  | 0x0000 | 2 | Unknown |
  | 0x0001, 0x0002 | 10, 300 | The two writable timers |
  | 0x0003 | 0 | The count since boot |
  | 0x000b | 300 | Unknown, read-only |
  | 0x000c | 25 | The Zigbee channel |

  The model check-in adds 0x0005 (5 on every DIM1-Z) and 0x0006. 0x0006 is 86 on Garage Inside Lights, rising
  84 → 86 through today's reboots, and 71 on two others: most likely a lifetime boot count.
- **0xC25C cluster 0:** no answer to a text frame or a ZCL read.
- **0xC25E cluster 2 is new:**

  | Attribute | Type | Value |
  |---|---|---|
  | 0x0003 | uint32 | 0 |
  | 0x0008 | uint8 | 0 |
  | 0x000b | octet string | empty |
  | 0x000e | uint8 | 3 |

  - **Everything else to 0x00ff is unsupported,** and Discover isn't supported.
  - **Writes are refused,** status 0x81, even writing an attribute its own value.
  - **The same on Garage Inside Lights, Garage Entrance and Kitchen Cans,** and absent on the KC120277 and APD120.
  - Read-only, so 0x000e = 3 sets nothing, even if it is the radio's +3 dBm.
- **Endpoint 1, ZCL Discover Attributes** (plain and with 0xABCD) on all seven clusters: no answer at all.

**Every 3-character name with a digit, under both families (21:34-23:21).** A temporary script (since deleted)
sent one Get every 0.3 s to each of Garage Inside Lights, Garage Entrance and Kitchen Cans. Together:
- **What was sent:** about 58,000 Gets, the 36³ − 26³ names with at least one digit under `c4.dm.` and under `c4.sy.`.
- **Missed and re-sent:** 57 Gets went unanswered, found from gaps in the reply sequence numbers and named from the
  sniffer, mostly while a slow probe held up one dimmer's queue. All 57 were re-sent.
- **The result:** every answer was `n01`, except names already known (`is2`, `l0o`-`l1v`, `t0s`) and the known names
  each probe starts with (`td`, `lm` and the like).

So the DIM1-Z's whole name space of up to 3 characters is now swept: letters, digits, uppercase, and the names hidden
behind real ones. What's left is 4 characters and up beyond the ~750 words tried: about 1.7 million names a family,
about four days around the clock for both families on three dimmers at this pace.

**What this means for the DIM1-Z's radio power.** No over-the-air path sets it:
- **Names:** every command name its firmware has is now tried as a Get, Set, interrupt and announcement, including the
  names hidden behind real ones. The newer models' `zpw` doesn't exist on it in any form.
- **Network profile:** its settings hold two timers and a boot count. Nothing else on any endpoint takes a write.
- **Hardware:** its output dips about 11 dB for half of every mains cycle, which no setting would fix.

**It may already be at full power.** The Kitchen Keypad, a Gen3 radio set to 0 dBm, and Kitchen Cans, a DIM1-Z, reach the
sniffer at −62 and −56 dBm (median of each one's stronger half of frames, 21:00-21:40):
- **Kitchen Cans comes in about 6 dB hotter.** If the two sit close together, the DIM1-Z already transmits at about
  +3 dBm or more, the top of the EM250 radio its generation is built on. There would be nothing left to raise.
- **Still to confirm:** where the two sit, and the chip.

What does work for a weak DIM1-Z:
- **Its whip antenna.** It's coiled under the button and can be pulled out (the DIM1-Z map, Hardware). This is the
  one way to get more signal out of the dimmer itself.
- **A router within easy reach,** so even its weak half-cycle frames make the hop.
- **The KC120277, APD120 and SW120277 can now run at +2 dBm** (`tx_power`). That strengthens what they send a
  DIM1-Z, though not what it sends back.

## Order

1. The `c4_send` change (any type letter, `"ack": false`). Small, and needed by Steps 2 and 3.
2. Step 3 on the Kitchen Keypad (about 35 frames, minutes).
3. Step 1 on the Kitchen Keypad, then the names it finds on the APD120.
4. Step 2 for every write-only name found.
5. The DIM1-Z attribute test, with the go-ahead.
6. Build what was found.
