# The extension reboots a stuck DIM1-Z remotely, within a rolling cap and instance-wide holds

A DIM1-Z's Control4 firmware can stop answering while its radio still works: it checks in every hour and works
from its own paddles, but nothing sent to it is answered (archived issue 60). Another failure mode is re-joining every hour. On
2026-11-04 and 2026-11-06 the only cure was a reboot by hand, 15 taps on the top paddle. On 2026-11-07 the
interrupt frame `0i c4.dm.rb` turned out to reboot a DIM1-Z in about 2 s, with its load at the same level and
every setting kept. So the extension now does it on its own:
- when a DIM1-Z becomes unreachable, and at its later missed keepalives;
- when it re-joins 3 times within 3.5 h of its last reboot.

A Reboot button covers the rest by hand.

The limits are part of the decision, not tuning:
- **Per dimmer:** at most 3 reboots in any 24 h, an hour or more apart. This is a rolling count that the dimmer's
  own frames don't reset. A rebooted dimmer announces its level within 2 s, so a count reset by any direct frame
  would let one that keeps going deaf be rebooted forever.
- **Per instance:** at most one reboot a minute.
- **Held:** no reboot while `no_frames` or `sends_failing` is raised, or while more than 3 devices are unreachable at
  once. In those cases every dimmer looks dead, and the fault is the instance's or the mesh's. Rebooting healthy
  dimmers would flash every LED on the network and drop paddle presses.
- **Opting out:** a device option, `auto_reboot: false`.
- **No APS acknowledgement on the frame:** the dimmer can restart before acknowledging, and each APS retry then
  reboots it again. Three reboots in 3.5 s were seen.

## Considered Options

- **Advise only** (the notice says "tap the top paddle 15 times"). That keeps the extension from ever acting on a
  device by itself. But a stuck dimmer stays stuck, often for hours, until someone notices and walks to it.
- **Zigbee leave-and-rejoin** (ZDO Mgmt_Leave with rejoin) as the cure. It's standard and needs no Control4
  command, but it was never tried, and it may not restart the Control4 firmware at all. It stays the fallback for a
  dimmer whose Control4 side won't act on the reboot frame.
- **A cap reset when the device answers** (the first version). Rejected for the reason above: one that answers
  between deaf spells was never capped.

## Consequences

- An automatic reboot flashes the dimmer's LEDs (green, then white), and a paddle press in its ~2 s is lost.
- The counts live in memory, so a Zigbee2MQTT restart starts them again: a dimmer that stays deaf can get 3 more
  reboots after each restart.
- The KC120277 and APD120 are rebooted the same way, with the same limits and `auto_reboot` option (#12), by
  `0i c4.sy.rb` (frame-type survey, `docs/research/kc-apd-sw-capability-map.md`). They answer before restarting, so
  its APS acknowledgement goes out and no retry reboots them again; the frame still asks for none. They send no device
  announce afterwards, so the extension queues their health read (the reset reason) itself. The SW120277 and the
  KD120 are untested and aren't rebooted.
