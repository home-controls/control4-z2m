# Setting up an SR260 for a media player

How to make a C4-SR260 drive a TV or streamer through Home Assistant, with a lights menu on its List key
and a screen that follows what is playing. It uses three blueprints from `blueprints/`, each set up from its
form in Home Assistant, so every setting stays editable there. Copy them to
`/config/blueprints/automation/control4-z2m/` (or import them), with the extension already running.

Pair the remote first (README, "Pairing"). Once commissioned it shows the clock and its room, and Zigbee2MQTT
lists it as a C4-SR260 with a "Control4 events" entity: the blueprints hear the remote through that entity.

## 1. Keys: `c4_sr260_media_player`

Maps the keys to a Home Assistant `remote` entity (`remote.send_command`) and the volume keys to a
`media_player`. Fill in:

- **Remote**: the SR260.
- **Remote Target**: the player's `remote.*` entity.
- **Volume Target**: the `media_player.*` whose volume the Vol / Mute keys change. Mute goes only to a player
  that can mute (its `supported_features` include `VOLUME_MUTE`, 8); others ignore the key.
- One **command string** per key, in the spelling the player's integration uses. An empty string leaves the
  key unused.
- **Actions** for the keys with no command (Room Off, Watch, Listen, List, I / II / III, Prev, DVR). They run
  once per press, not on a held key's repeats.

Arrows, volume, transport, channel, page, colour and digit keys repeat while held.

### Command strings

| Key | Apple TV (`apple_tv`) | Android / Google TV (`androidtv_remote`) | Roku (the defaults) |
|---|---|---|---|
| Up / Down / Left / Right | `up` / `down` / `left` / `right` | `DPAD_UP` / `DPAD_DOWN` / `DPAD_LEFT` / `DPAD_RIGHT` | `Up` / `Down` / `Left` / `Right` |
| Select | `select` | `DPAD_CENTER` | `Select` |
| Play / Pause | `play` / `pause` | `MEDIA_PLAY` / `MEDIA_PAUSE` | `Play` (toggles) |
| Stop | `stop` | `MEDIA_STOP` | none |
| Skip ⏭ / ⏮ | `next` / `previous` | `MEDIA_NEXT` / `MEDIA_PREVIOUS` | none |
| Rewind / Fast forward | `skip_backward` / `skip_forward` | `MEDIA_REWIND` / `MEDIA_FAST_FORWARD` | `Rev` / `Fwd` |
| Cancel (back) | `menu` | `BACK` | `Back` |
| Control4 (home) | `home` | `HOME` | `Home` |
| Menu | `top_menu` | `MENU` | none |
| Info | none | `INFO` | `Info` |
| Channel + / − | `channel_up` / `channel_down` | `CHANNEL_UP` / `CHANNEL_DOWN` | `ChannelUp` / `ChannelDown` |
| Colour keys | none | `PROG_RED` / `PROG_GREEN` / `PROG_YELLOW` / `PROG_BLUE` | none |
| Digits (template) | none | `{n}` | `Lit_{n}` |

The Apple TV column was set up and checked on an SR260 (arrows, Select, play / pause). The Android TV
names are Android key codes without their `KEYCODE_` prefix, as the integration takes them; they haven't been
tried with an SR260. Its `media_player`
has no mute in Home Assistant, so Mute does nothing there; volume up / down work when the Apple TV controls
the TV's volume. For Watch, an action such as `remote.turn_on` on the TV and `media_player.turn_on` on the
player turns both on.

## 2. A menu on the List key: `c4_sr260_menu_dispatcher`

Shows a list on the remote's screen and runs the action for the item picked. Make one automation from it:

- **SR260 remote**: the remote.
- **Menu title** and up to eight **items**, each with its **action** (for a lights menu: `light.toggle` on
  each light, `fan.toggle` on a fan).
- Leave **Show menu when…** at its default (it never fires on its own), and in the media-player automation
  set the **List** action to `automation.trigger` on this automation.

The menu closes after **Selection timeout** with nothing picked, and at once on Cancel. Pressing List while it
is up shows it afresh. A pick shows on row 2 of the screen; step 3 puts the app back after a few seconds.

## 3. The screen: `c4_sr260_screen`

Colours the SR260's text by what the player is doing, and shows its app on row 2:

- **Media player**: the `media_player` to follow.
- **Colours**: one colour picker each for playing, paused and idle or off.
- **Night dimming**: a **Dark** entity (a "dark inside" binary sensor, a night-mode toggle). While it is on,
  the colours dim to the **Night level**, a percentage or an `input_number` helper. The text colour also sets
  the text's brightness; about 40 % is dim but readable. The remote has 8 levels of red and green and 4 of
  blue, so not every 5 % step shows, and a colour never dims to black.
- **Alerts**: entities whose `on`, `open` or `unlocked` turns the text the alert colour, at full brightness
  (a door left unlocked at night, a leak sensor).
- **Line 2**: show the player's app (cut to **Maximum characters**), and **Back to the app after a menu pick**
  in seconds (0 keeps the pick).

It sends only what the remote would show differently, so it costs no Zigbee frame while nothing changes. The
extension sends the colour and rows again on every wake.

To tune the night level from a dashboard: create a Number helper (Settings → Devices & services → Helpers,
10-100, step 5, unit %), pick it as **Night level helper**, and add a tile with a slider for it.

## What to expect

- Picking the remote up wakes it; the clock, rows and text colour come back within a second.
- An open menu does not come back after the remote sleeps until pull request #4 lands.
- `docs/research/sr260-remote.md` describes the frames behind all of this.
