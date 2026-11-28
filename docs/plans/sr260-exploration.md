# SR260 exploration: what else the remote can do

**2026-11-28.** A plan to find what the C4-SR260 can do beyond what the extension drives today: the features
Control4 documents but nobody has decoded (beep, backlight, awake time, volume overlay), what its screen can draw,
and whether animation is practical. Nothing in this plan has been sent to a remote yet. The facts below come from
the repository, the sniffer, Control4's own documents and release notes, the FCC filing, and other projects; the
sources are at the end.

Tracked in GitHub issue #56 (the map), one issue per step: #57 (Step 0), #58, #59, #60, #61, #62 and #63 (Step 6).
The read fix is #55.

## What the remote is

- **One chip.** The radio and application processor are one Ember **EM357** (named in the OS 2.7.0 release notes'
  known issues; the FCC test report says EmberZNet). Unlike the SR250, which has a separate host MCU, the FCC photos
  show no second processor.
- **Screen.** A 160×128, 8-bit colour OLED, which is why the text colour is one RGB332 byte. The panel carries its own
  driver chip (most likely a SEPS525-class controller; not confirmed). An 8-pin memory chip sits next to its flex,
  most likely holding the font and icons.
- **No framebuffer is possible in the remote itself.** A frame is 160 × 128 = 20 KB and the EM357 has 12 KB of RAM.
  The firmware draws its widgets straight into the panel's own memory. Drawing arbitrary pixels from Home Assistant
  would need a firmware command that streams pixels, and none is known.
- **Sensors and parts.** A motion sensor (wakes it), an ambient light sensor (between the Control4 and Listen keys),
  a beeper, white key backlight. No IR emitter. AA cells or a LiPo pack with a charging base.
- **Debug access.** No labelled header in the FCC photos. Two 2×3 pad clusters in the battery bay and a row of about
  six pads beside the radio are the candidates for a programming port. The SR250 has a labelled 2×5 `J1`.
- **Firmware history.** 1.0.67 (OS 2.7.0, 2015) to 2.2.27 (OS 3.2.0) to **2.2.50 (OS 3.3.0, 2022)**, the one in this
  house. No later OS lists newer SR260 firmware. Control4 pushes it over the air from the controller after an OS
  upgrade.

## What the firmware has that we don't drive

From Control4's install guide, Composer help, FAQ and release notes:

| Feature | What Control4 shows | What we know of the command |
|---|---|---|
| Beep (remote finder) | "Beep until button press", "Beep for X seconds (<254)", "Stop Beep" | Nothing. A one-byte seconds argument is likely |
| Screen and keypad backlight | 0-100 each, "Set Level" | Nothing |
| Light sensor | on / off | Nothing |
| Awake duration | 15 s default, up to 90 s | Nothing |
| Wake on motion | a sensitivity level | Nothing |
| Check-in interval | "Set Timeout" | Most likely network-profile attribute `0x0001` (below) |
| Recharge station | LiPo vs alkaline | Nothing |
| Volume overlay | OS 3.2.0: volume feedback at the bottom of the screen, for rooms with discrete volume | Nothing |
| Network-state icons | OS 3.2.0: "adding to network", "lost network", "found network" | Probably shown by the firmware itself |
| Local Config menu | List > Settings > Config (or Info > Config): brightness, keypad, motion, light sensor, text colour, recharge, battery, factory defaults; "each change is saved as soon as it's made" | Unknown whether it is drawn by the firmware or served by the controller |
| Status bar | Always white; battery (turns yellow / red) and signal icons | Drawn by the firmware |

## A bug found on the way: the channel and timer reads

The sniffer shows the remote reading two attributes from the coordinator on its network profile (`0xC25D`, cluster 1,
endpoint 2): **`0x000C` and `0x0001`**, every few minutes. On the DIM1-Z (`frame-type-survey.md`) `0x000C` is the
Zigbee channel and `0x0001` is a writable timer; the SR260's own status report carries them too (`0x000C` = 25,
`0x0001` = `0x0002` = 600). So the remote is most likely asking its controller for the channel and its check-in time.

`runtime.ts` `onNetwork` answers every Read Attributes with the controller identity (`0x0008`-`0x000A`), whatever
was asked. Upstream's SR260 converter answers only `0x0008`-`0x000A` and returns everything else unsupported, with the
comment that answering them with the identity "makes it rejoin over and over". On 2026-11-28 this remote re-announced
itself at 07:27, 07:59 and 08:29, each a few minutes after one of these reads, and its health sensor showed 55 % of
frames sent to it lost and six times its normal traffic. Not yet proven to be the cause; Step 0 settles it.

## What other projects found

- **Zigbee2MQTT** (`zigbee-herdsman-converters`, `src/devices/control4.ts`, added 2026-11-27): keys, battery from
  `c4.zr.bl`, the identity answer above. No screen.
- **masterdownload/C4-SR260-to-HomeAssistant** (ZHA): a Latin-1 degree byte did not display (a hint the remote wants
  UTF-8); a picker with several labels per `gi` reply came back misordered, so it now sends one label per reply; the
  remote listens about 0.5 s after it transmits while asleep; 17-20 characters across. It found no backlight, beep or
  volume overlay either.
- **pvanbaren/zha-device-handlers** (`control4` branch): the capture-based protocol write-up the ZHA work started
  from. It reads `c4.zr.bl` as a backlight event; it is the battery level (`3a` = 58 %).
- **The1TrueJoe/openHC and control4-zigbee**: openHC installs on stock Control4 controllers over SSH, without opening
  the lid. control4-zigbee mined an EA-3's factory recovery image and found a firmware folder of device images
  (`700-00xxx_EM357_*.ebl`, OTA'd by the controller's `zserver2`) and the controller's Zigbee binaries. If the SR260's
  image is there, its strings name every command it takes.

## Steps

Ordered so that each step needs only what the earlier ones proved safe. Every step's result goes into
`docs/research/sr260-remote.md`.

### Step 0. Answer the channel and timer reads correctly

- **Status (2026-11-28):** the first half is written (branch `sr260-read-answers`), not yet deployed. Two days of
  captures show every read the remote sends the coordinator asks for `0x000C` and `0x0001`; it reads the identity
  (8-10) from routers around it instead.
- **Why:** most likely stops the rejoins, and it is the remote's settings channel.
- **How:** in `onNetwork`, answer `0x0008`-`0x000A` as now and every other attribute as unsupported (upstream's
  answer). Then, as a second test, answer `0x000C` with the channel and `0x0001` with a timer value, and watch what the
  remote does with it.
- **Done when:** a day of sniffer captures shows no rejoin after a read, and the health sensor's loss drops to the mesh
  baseline (about 2.5 %).
- **Risk:** low. A wrong timer value is undone by answering the old one.

### Step 1. Read Control4's own software off a retired controller

- **Why:** the cheapest way to every command name: the SR260 firmware image (strings), the controller's Zigbee
  server and the remote's driver (the commands it sends: beep, backlight, volume overlay, the `0x0001` answer).
- **How:** a retired EA-3 or EA-1 we own, on an isolated network, its Zigbee radio far from any Control4 mesh.
  Log in as openHC's flasher does, copy `/control4/firmware/` and the Zigbee and Director binaries and drivers, and
  read them on the desk with `strings` and a disassembler. Nothing is written to the controller; openHC itself is not
  installed.
- **Done when:** the SR260 image is found (or proven absent), and the controller-side `c4.zr.*` / `c4.ln.*`
  vocabulary is listed.
- **Risk:** the controller's own Zigbee network. A retired controller left on near a mesh it once ran pulled 36
  devices off it in 2026; keep it powered only where no Control4 device can hear it.
- **Rules:** no Control4 binary, firmware or decompiled code goes in this repository; findings only.

### Step 2. The glyph, Unicode and width test (existing commands only)

- **Why:** what the screen can show with commands we already send.
- **How:** six lists, sent when the remote wakes and advanced by Cancel (a temporary Home Assistant script):
  1. **Unicode:** ASCII, the same accented letters as UTF-8 and as raw Latin-1, block elements (`▁▂▃▄▅▆▇█`, `░▒▓`),
     box drawing, arrows and triangles, shapes and check marks, stars and notes, Braille (`⠁⠃⠇⡇⣿`), Chinese,
     Greek and Cyrillic, Thai, one emoji. The extension encodes frames as Latin-1, so the payload carries UTF-8 bytes
     as Latin-1 characters (`â\u0096\u0088` for `█`).
  2. **Widths:** a 32-character alphabet, `W`×25, `i`×32, a 40-digit ruler.
  3. **Icons `00`-`ff`**, four lists of 64, each item the icon byte followed by its hex, skipping `0a`, `0d` and `22`
     (they break the frame) and `00`.
- **Needs:** someone holding the remote, photographing each screenful, pressing Cancel (not Select, which would put the
  item on row 2).
- **Done when:** the icon table and character set are photographed and written up. If the lists come back misordered,
  re-run with one label per `gi` reply (`gi_max_items` = 1).
- **Risk:** none beyond a list on screen.

### Step 3. The remote's own menus

- **Why:** if the Config menu is drawn by the firmware, changing a setting there may announce it (`sa c4.zr.*`), which
  names the setting.
- **How:** with the sniffer running and the extension logging at debug, press Info and List with no list open, hold
  them, and walk the Config menu if one appears: change brightness, keypad, motion, light sensor and text colour one
  at a time.
- **Never:** Factory Defaults or the 13-4-13 sequence. Both take the remote off the network.
- **Done when:** we know whether the menu is local, and every announcement it makes is decoded.

### Step 4. Animation timing

- **Why:** how fast the screen can change while awake, and what it costs.
- **How:** while the remote is awake, send 20 text-colour changes back to back and 20 row updates, and time them from
  the sniffer: frames per second, how many are retried, how long the remote stays awake.
- **Done when:** a measured update rate for colour and for text, awake and asleep.

### Step 5. Read-only name sweeps

- **Why:** names Step 1 doesn't give (if the image isn't there).
- **How:** two-letter names under `c4.zr` and `c4.ln`, about 1,300 each, first as `0t` (on the DIM1-Z every known
  name answered `e00` and unknown ones `n01`, with no action taken), then as `0g` for the names that exist. The
  extension's probe-Get blocklist stays on. The remote must be awake, so this runs in batches per wake, faster once
  Step 0 or Step 6 finds a way to keep it awake longer.
- **Done when:** every two-letter name in both families is answered.

### Step 6. Writes, one at a time (after a backup exists)

- **Only after** Step 1 has the firmware image, so a broken remote can be restored.
- Write network-profile `0x0001` / `0x0002` (writable on the DIM1-Z): check-in and perhaps awake time.
- Try beep, backlight, keypad level and the volume overlay with the names from Steps 1, 3 and 5 and Control4's
  argument shapes (beep seconds as one byte under 254, levels 0-100). Raw Sets to remotes stay disabled in the
  extension (an SR250 once lost its firmware to a bad Set); each write is a one-off with a known name and shape.

### Not planned: custom firmware

Arbitrary drawing needs firmware that streams pixels to the panel. That would mean building an EM357 image and
loading it over Control4's OTA path or a programming port, on a spare remote, with a proven way back. Revisit only
if Steps 1 and 6 show the OTA path and a working restore.

## Animations and drawing: what to expect

- **Possible now:** colour pulses and fades (one `c4.zr.tc` per step), scrolling text (re-send a row), spinners
  (cycle a pop-up's icon), text bars and sparklines if Step 2 finds block or Braille characters.
- **Limits:** only while the remote is awake (15 s after the last motion or key, unless the awake time is found); a
  sleeping remote's screen is off and we know no way to wake it; each frame is a Zigbee message to a battery device.
- **Drawing pixels:** not with any known command (see "What the remote is").

## Sources

- Control4 SR-260 data sheet, installation and setup guide, user guide, OS 2.7 FAQ:
  `docs.control4.com/docs/product/system-remote-control-sr-260/...`
- Composer Pro help, "Configure System Remote Control SR-260".
- Control4 dealer release notes OS 2.7.0 to 3.3.0 (`docs.control4.com/docs/product/control4-software/dealer-release-notes/...`).
- FCC ID R33C4SR260 (internal photos, test report 277005-1.2) and R33C4SR250Z, via fccid.io.
- github.com/Koenkk/zigbee-herdsman-converters `src/devices/control4.ts`, `test/control4.test.ts`.
- github.com/masterdownload/C4-SR260-to-HomeAssistant `docs/features.md`, `docs/remote-commands.md`.
- github.com/pvanbaren/zha-device-handlers (`control4` branch).
- github.com/The1TrueJoe/openHC, github.com/The1TrueJoe/control4-zigbee `PROTOCOL.md`.
- c4forums.com threads 21197 and 36063 (via search snippets; the site refuses automated reads).
