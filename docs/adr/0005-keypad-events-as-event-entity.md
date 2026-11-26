# Keypad events reach c4_device through a per-device event entity

Supersedes ADR 0001, which made the dispatcher package a hard dependency of c4_device: without the package every keypad went silent, and with a stale one single taps ran twice. Now the extension publishes one HA MQTT `event` entity for each Control4 device that has actions. The entity is attached to the device Zigbee2MQTT created and fed from `control4/<ieee>/event`. c4_device triggers on `event.received` aimed at its existing device input. ADR 0001 rejected a per-device topic because the trigger had no way to know the device's IEEE; this trigger takes the device itself, so nobody types an IEEE and no automation has to be re-picked. The dispatcher package stays, as an optional house-wide `control4_event` for other automations.

## Considered Options

- **An event-entity input in place of the device input.** It hears only our entity, so event types could take any names, but every c4_device automation would have to be re-picked.
- **Zigbee2MQTT's own `experimental_event_entities`.** It builds the entity from the `action` value alone, so `tap_index` and `known_taps` are lost.
- **The shared `control4/event` topic as the entity's state topic.** No new topic, but every entity would render its IEEE filter for every event in the house, which is ADR 0001's per-tap waste as template renders.
- **Keep the dispatcher required, and detect a missing or stale package.** That only reports the failure instead of removing it.

## Consequences

- Event types are the ZHA command names (`remote_button_tap_known`), not the `action` (`button_1_tap_known`). `event.received` on a device hears every event entity on it, and Zigbee2MQTT's own event entity, if it is ever enabled, keeps `button_1_tap_known` unchanged, so shared names would run each known tap twice. Non-button events (LED notifications, menus, Z2IO changes) keep their names, which Zigbee2MQTT's entity shares; c4_device acts only on `led_notification_end`, where a second LED repaint is harmless. A remote's are prefixed: every event type on an SR250 / SR260 starts with `remote_` (`remote_menu_select`, `remote_motion_wake`; its keys' commands already did), while `command` on both topics keeps its name.
- c4_device's waits inside a run can't use `event.received`: a trigger's options are not templated, and each wait must match one button. They are MQTT triggers on `control4/{{ ieee }}/event`, filtered by button and command.
- The discovery config has no availability block. At start, Zigbee2MQTT deletes any four-level discovery config whose first availability topic is under its base topic and that it didn't publish itself (`lib/extension/homeassistant.ts`, 2.14.2). So the entity goes unavailable only when MQTT is down, and `event.received` ignores that transition.
- A blueprint newer than the extension finds no event entity on its device. c4_device checks at HA start and on automation reload, and then raises one persistent notification per device, so the device is not left silent. The check sees only that the entity exists, and its config is retained, so a coordinator rolled back to an older extension leaves the entity in place and the device silent without a notification.
- Each event is a state row on its entity, about five per tap, in the recorder and the logbook.
- The SR250/SR260 blueprints hear the remote the same way (#99): `event.received` on the chosen remote, for their triggers and their menu waits alike, since each wait matches one fixed type and needs no template. They have no missing-entity check, so a blueprint newer than the extension opens menus whose picks go unheard.
