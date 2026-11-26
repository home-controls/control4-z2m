# A device's settings follow it at join, and the old instance evicts its record

Moving a device to another coordinator meant stopping both instances and running `move-c4-settings`, since a running extension writes its in-memory store back over the file. Now every join of a Control4 device starts a handoff over `control4/`. Only an instance that has had the device in its own Zigbee2MQTT answers, and when several have, the one that had it last wins. It sends the device's saved settings, friendly name and device options. Once the new instance acks, the old one drops its copy. If the old instance still has a record of the device, because it was reset and re-paired without being removed, it force-removes that record without checking first: a device is on one network at a time, so the record can only be stale. The new instance then republishes its Home Assistant discovery, because Zigbee2MQTT keys the discovery topic by IEEE alone and the eviction cleared it.

## Considered Options

- **Require removal first.** The old instance answers only about devices it no longer has. A plain "reset it and pair it" then gets no handoff, and the stale record goes on serving `control4/<ieee>/set` and overwriting the new instance's discovery each time it restarts.
- **Answer but keep both.** No removal, but the same conflict as above, and a second copy of the saved settings that may answer a later move.
- **Any holder answers.** Copies left by the ZHA import (run into every instance) or by `--copy` would answer alongside the live values, with nothing to tell them apart.

## Consequences

- Received values replace what the new instance held before the join, and only values it wrote since the join beat them.
- Values are stored, not written back to the device.
- With the old instance down, the device starts as new, and `move-c4-settings` stays for that case.
- Entities are new in Home Assistant, since the unique_id carries the base topic. The carried friendly name restores Zigbee2MQTT's default entity ids, but an id changed in HA must be changed again.
