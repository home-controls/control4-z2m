# Control4 keypads

How a person's finger on a Control4 wall device becomes a lighting change in Home Assistant.

## Language

### Wall devices

**Paddle**:
A rocker whose top and bottom halves are each a button of their own, as on the DIM1-Z, APD120, SW120277 and FS1-Z.
_Avoid_: Rocker

**Button number**:
The position, 1 to 6, under which a c4_device automation configures one button. On a paddle, Button 1 is the top half and Button 2 the bottom.
_Avoid_: Slot, button index

**Button wire**:
The number a device reports for one physical button position, counted from the top of a layout that every fit-out of the board shares. The APD120 and SW120277 paddle halves are wires 1 and 5 of 7; a KC120277 button reports the wire of the top position it covers.
_Avoid_: Button id, slot (a Button number is what a c4_device automation calls it)

**Button behaviour**:
What one button does to its own device's load when pressed: turn it on, turn it off, toggle it, dim it only while held (momentary), or nothing, so it only sends its taps (event-only).
_Avoid_: Role, mode, decoupled (paddle local control is the DIM1-Z's on/off form of it)

**LED slot**:
One of the 13 LED positions on a KC120277, APD120 or SW120277, the same on all three. A KC120277 lights the ones beside its buttons; on an APD120 or SW120277 only the two beside the paddle are visible.
_Avoid_: Slot (on its own), segment

**LED mode**:
How an LED slot picks its colour: following its device's load (one colour on, one off), showing its pressed colour only while its button is held (push/release), or showing a colour set from outside (programmed).
_Avoid_: Bound / unbound, behaviour (that is a button's)

**Button layout**:
The positions of a KC120277 that have a button, from the top (its kit of buttons, one of 37). The device can't report it: it is learned from the button wires it sends from, or set by hand.
_Avoid_: Fit-out (on its own), kit

**Hardware fade**:
A fade the dimmer runs itself from one command, for exactly the time asked, in place of a level command that uses the dimmer's own stored fades.
_Avoid_: Ramp (a stored fade or a hold's), transition (the Home Assistant field that asks for one)

**LED re-check**:
A c4_device automation working out all its LEDs again on the clock (hourly, or every 30 minutes), besides on every change of what they watch: a backstop for a change Home Assistant missed. The extension transmits only LEDs whose colour changed, so a re-check that finds nothing new sends nothing. A lost frame does not wait for it (**LED self-repaint**).
_Avoid_: Re-sync, refresh (`led_refresh` re-sends whether or not anything changed)

**LED self-repaint**:
The extension painting a device's status LEDs again by itself, 30 s, 2 min and 10 min after a status frame that did not go out (or a DIM1-Z paint its read-back did not confirm), sending only what is still wrong. Each led_status starts its tries afresh; a device listed unreachable gets none until it is back (its announce repaints it).
_Avoid_: Retry loop, heal (in prose; the code says heal)

### Taps

**Tap**:
A short press and release of one button, known to be a tap (not a hold) once its release arrives, or at paddle-down on a device that has no hold.
_Avoid_: Click, push

**Hold**:
A press kept down long enough that the device reports it as held; it ramps brightness until release.
_Avoid_: Long press

**Tap sequence**:
One or more taps on the same button, each within the tap window of the one before.
_Avoid_: Multi-click, combo

**Tap window**:
How long after a tap the sequence stays open for another tap before its tap count is final. Each device has its own.
_Avoid_: Double-tap delay, debounce

**Tap count**:
The final number of taps in a sequence (single, double, triple, quadruple). The **fast count** is ours, closed one tap window after the last tap; the **device count** is the keypad's own, about 1.7 s later.

**Known tap**:
A tap the extension has announced (`tap_known`) the moment it was known to be a tap: on its release for a button already seen sending releases, at paddle-down on a device that has no hold. A keypad button never seen releasing has no known taps; once one tap of a sequence is not known, none of its later taps is; and a fast count says whether all its taps were known.
_Avoid_: Confirmed tap

**Tap index**:
The position of a press in its open tap sequence, 1 for the first. Its release carries the same index, even when it comes after the tap window, unless a hold came first, the sequence's fast count is already out, or the release came more than 2 s late. It is counted at the press, before the press is known to be a tap, so a press that turns into a hold has one too, and the hold starts the count again.

**Tap response**:
Which event runs a button's single tap under a c4_device automation: the device count (Wait), the fast count (Fast), each known tap (Instant), or Auto, which is Instant for a button with no multi-tap actions and otherwise an early commit toward ON and the fast count toward OFF.
_Avoid_: Single-tap mode, response mode

**Early commit**:
Running a button's single-tap action as soon as its first tap is known, before the tap count is final.
_Avoid_: Optimistic tap, speculative tap

**Direction**:
Whether a tap's action would leave its targets brighter (toward ON) or darker (toward OFF). Only taps toward ON are committed early.

**Scene**:
The level (or off) one button's tap sets each of its targets to, so a single tap recreates a whole look. Night Dim never changes it.
_Avoid_: Preset, mood; "scene" for a Home Assistant `scene.*` entity, which is an **HA scene**

**Active**:
Said of a Scene while every one of its targets sits at its level, to within 2 points; its button's LED is lit only then. One target off its level is enough to make it inactive.
_Avoid_: Matched, current

### Device health

**Unreachable**:
Said of a device that has answered none of its last 3 keepalives, or none of the checks after it re-joined: what is sent to it is lost, though it may still have power, check in and work from its own buttons.
_Avoid_: Offline, dead

**Stuck re-joining**:
Said of a device that keeps re-joining the network again and again (3 times within 3.5 hours), a sign its firmware needs a reboot.
_Avoid_: Flapping

**Remote reboot**:
Restarting a device's firmware from Home Assistant or the extension, with its load left at its level and its settings kept. On a DIM1-Z it does what 15 taps on the top paddle do.
_Avoid_: Reset (that clears settings), restart (that is an instance's)

**Reset reason**:
What a device's firmware last restarted on, as it reports it: a power-up, a software reboot, a crash on an assert, a watchdog.
_Avoid_: Boot reason, room info

### Deployment

**Instance**:
One Zigbee2MQTT running the extension on its own coordinator, named by its base topic.
_Avoid_: Bridge, coordinator (the radio, not the instance)

**Dispatcher**:
The optional Home Assistant package that re-fires every Control4 event as one house-wide event, for automations of the user's own. A c4_device automation doesn't need it: it hears its own device's events entity.

**Contract**:
The event fields an instance sends and the dispatcher and blueprint read. It changes only when a field is added, dropped or changes meaning.
_Avoid_: Version, protocol

**Build**:
One compile of the extension and converter together, from one source tree, known by its build id. Many builds share a contract.
_Avoid_: Version, release

**Push**:
Sending a build to one running instance, which hot-loads it. A push the instance does not prove, by reporting the new build as the one it runs, is rolled back to the build it ran before.
_Avoid_: Upload, install

**Hot-load**:
Replacing the extension or converter inside an instance that keeps running, coordinator included, so its devices and routes carry on untouched.
_Avoid_: Reload, hot-swap

**Restart**:
An instance's Zigbee2MQTT stopping and starting again, coordinator included.
_Avoid_: Reboot

### Moving devices

**Learned model**:
A device's real model, taken from its own check-in because it never answers the standard interview. Until it is known the device is generic C4-Zigbee.
_Avoid_: Detected model

**Unsupported model**:
A learned model this build has no family for. The device stays generic C4-Zigbee (its check-ins answered, `c4_get` / `c4_send` still reaching it), shows the model as its reported model, and has its frames logged and its fingerprint read, so it can be added.
_Avoid_: Unknown model (that is a device whose model isn't learned yet)

**Fingerprint**:
The one read-only run of Gets an unsupported model gets, asking which protocol namespaces (`c4.dmx`, `c4.dm`, `c4.kp`, `c4.sy`) its firmware answers: what says which family it is closest to.
_Avoid_: Probe (that is any hand-sent Get)

**Saved settings**:
What an instance keeps for a Control4 device that the device does not report on its own: its learned model, the values written to it from Zigbee2MQTT (a DIM1-Z's dimmer parameters as read back from it, too), and memories such as its last level or a remote's room.
_Avoid_: Device settings, store entry

**Device options**:
Zigbee2MQTT's own per-device configuration on an instance, such as the tap window or the poll intervals. Not part of the saved settings.
_Avoid_: Device settings

**Handoff**:
A device's saved settings, friendly name and device options passing to the instance it has just joined from the instance that last had it. An instance that only holds a copy (from the ZHA import, say) never hands off.
_Avoid_: Migration (that is the move from ZHA), sync, transfer

**Eviction**:
An instance removing its own record of a device that has joined another instance. A device is on one network at a time, so that record can only be stale.
_Avoid_: Cleanup, purge

## Relationships

- A **Paddle** has two halves, and each has its own **Button number** (top = 1, bottom = 2)
- Each paddle half or keypad button reports one **Button wire** and has one **Button behaviour**
- A KC120277 button covers one or two **LED slots**
- A KC120277's **Button layout** says which **Button wires** it sends from; each fitted button lights the **LED slots** of the positions it covers
- A **Hardware fade** from off skips a dimmer's cold start
- Each **LED slot** has one **LED mode**; a slot in follow-load mode follows its own device's load
- An **Unreachable** DIM1-Z, or one **Stuck re-joining**, gets a **Remote reboot**; its **Reset reason** says what it last restarted on
- A **Tap sequence** ends one **Tap window** after its last **Tap** and yields one **Tap count**
- An **Early commit** happens on the first **Tap** of a sequence, and only when its **Direction** is toward ON
- A **Hold** cancels any open **Tap sequence** on its button
- A button has at most one **Scene**; Scenes on different buttons may share targets, and each is **Active** on its own
- Each **Instance** runs one **Build**; the **Dispatcher** and the blueprint each read one **Contract**
- A **Push** hot-loads one **Build** onto one **Instance**; a failed **Push** puts back the **Build** that instance ran before
- A **Hot-load** and a **Restart** both start the extension afresh; only a **Restart** also restarts Zigbee2MQTT and its coordinator
- A device is on one **Instance** at a time; a **Handoff** happens each time it joins one, and ends with the old instance dropping its **Saved settings** and, if it still has a record of the device, an **Eviction**