---
status: superseded by ADR-0005
---

# Keypad events reach c4_device as an HA event, not a per-device MQTT topic

Every c4_device automation listened to the shared `control4/event` topic, so one tap started a run in every keypad's automation and each rendered its full variables block before discarding itself; on a large site that is dozens of runs per tap. We re-fire each event from one package automation as an HA event carrying the HA `device_id`, and c4_device triggers on that event filtered by its device input, the same way the ZHA blueprint filters `zha_event`. The package is now a hard dependency of the blueprint: deploy it first.

## Considered Options

- **Per-device topic (`control4/<ieee>/event`).** Cheapest, since the broker filters, but a trigger topic cannot use the IEEE the blueprint derives from the chosen device, so every automation would need a hand-typed IEEE input that can drift from that device.
- **Keep the shared topic.** Harmless on a four-device site, wasteful on a large site.