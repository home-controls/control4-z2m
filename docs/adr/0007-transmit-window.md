# The extension keeps at most four Control4 frames awaiting delivery

Every `c4_device` automation shares the same night window, so at 21:00 and 07:00 they all repaint their LEDs in
the same second, and the hourly LED re-check fires in that second too. On the test site the coordinator logged
"The adapter has run out of buffers" (`EzspStatus.ERROR_OVERFLOW`: the NCP dropped callbacks or incoming frames)
632 times from 2026-10-29 to 11-01, every one in the minute after 07:00:00 or 21:00:00. The extension sent 366
frames in that minute, and 296 in the next; a normal minute is 25-40. Route failures, lost writes and missed
delivery confirmations came in the same seconds.

The pacing only spaced frames (20 ms across all devices, 40 ms per device). That leaves the number in flight at
about the delivery time divided by 20 ms. A slow mesh therefore held more frames in the NCP, each until its APS
ack, which slowed the mesh further.

So `Link.transmit` (`src/core/link.ts`) now keeps at most `TX_WINDOW` (4) Control4 frames awaiting delivery, and
one per device:
- the frames of a load command (`sendWithRecovery`) and the controller identity skip the window, waiting only for
  their own device's frame, so a paddle press during a repaint acts at once;
- a frame still unconfirmed after `TX_SLOT_HOLD_MAX` (3 s) gives its slot back;
- the `stats` request shows `tx_in_flight` and `tx_waiting`.

## Consequences

- At the next 21:00 there were no overflows (26 and 96 the two nights before). The repaint now takes seconds: 310
  frames in its busiest minute, back to normal within a minute.
- A burst of LED writes queues behind the window instead of arriving at once, so a repaint of many devices
  finishes later than it used to.
- Not covered: bursts that aren't Control4 frames. On 2026-11-01 Zigbee2MQTT's own OTA check of 31 other devices
  in one second caused one.
