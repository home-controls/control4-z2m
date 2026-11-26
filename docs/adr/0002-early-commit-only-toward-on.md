# Early commit only toward ON

A button with multi-tap actions used to wait out the tap window before acting on a single tap. Now its single tap runs at once (early commit) only when the action would leave its targets brighter; a tap toward OFF still waits the window. This applies to every tap mode, and is the default under the Auto response. A double tap almost always adds light, so an early ON is rarely visible, while an early OFF would black the room out before the double-tap action. Custom tap actions have no known direction and wait under Auto (the Instant response still runs them at once, by the installer's choice).

## Consequences

A darker double-tap action after an early ON (e.g. tap = on, double = a dim scene) flashes bright for about half a second. We accept that; a device that minds it can use the Fast response.