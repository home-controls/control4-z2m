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

## Order

1. The `c4_send` change (any type letter, `"ack": false`). Small, and needed by Steps 2 and 3.
2. Step 3 on the Kitchen Keypad (about 35 frames, minutes).
3. Step 1 on the Kitchen Keypad, then the names it finds on the APD120.
4. Step 2 for every write-only name found.
5. The DIM1-Z attribute test, with the go-ahead.
6. Build what was found.
