// Generate blueprints/c4_device.yaml - one automation per Control4 wall device
// (Zigbee2MQTT edition of control4-zha-quirks tools/gen_c4_device.py).
//
//   node tools/gen-c4-device.mjs [out]      (default: blueprints/c4_device.yaml)
//
// Differences from the ZHA blueprint, everything else is the same logic:
//   - the device is picked from the MQTT integration; its IEEE comes from the
//     HA device identifiers (zigbee2mqtt_0x...), its model from model_id;
//   - button events arrive through the device's Control4 events entity, which
//     the extension publishes (ADR 0005): a run starts on event.received aimed
//     at the device, and waits inside a run listen on the device's own topic,
//     control4/<ieee>/event; both carry the ZHA command names;
//   - LEDs are driven with {"led_status": {...}} on control4/<ieee>/set.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const N = 6;
/** The models whose buttons c4_device drives (Zigbee2MQTT's model_id); the picker offers only these. */
const PICKER_MODELS = ["C4-DIM1-Z", "C4-FS1-Z", "C4-APD120", "C4-SW120277", "C4-KC120277", "C4-KP3-Z", "C4-KP6-Z", "C4-4SF120", "LOZ-5S1-W"];
const PALETTE = ["Off", "White", "Warm White", "Red", "Orange", "Amber", "Yellow", "Lime", "Green", "Teal", "Cyan", "Blue", "Purple", "Magenta", "Pink"];
const DOMAINS = "[light, switch, fan, input_boolean, media_player, humidifier, siren, remote]";
const q = (s) => `"${s}"`;

function colourInput(key, name, def, desc, extra = []) {
    const opts = [...extra, ...PALETTE].map((o) => `                - ${q(o)}`).join("\n");
    const d = desc ? `\n          description: >-\n            ${desc}` : "";
    return `        ${key}:
          name: ${name}${d}
          default: ${q(def)}
          selector:
            select:
              options:
${opts}`;
}

/**
 * What each Button number is beside a keypad's: a paddle's halves, the fan's
 * buttons from the top (FAN_BUTTONS, src/core/constants.ts) and the outlet's two.
 */
const BUTTON_LABELS = {
    1: "Button 1 (top paddle; fan top; outlet 1)",
    2: "Button 2 (bottom paddle; fan high; outlet 2)",
    3: "Button 3 (fan medium high)",
    4: "Button 4 (fan medium low)",
    5: "Button 5 (fan low)",
    6: "Button 6 (fan off)",
};

function buttonSection(n) {
    const label = BUTTON_LABELS[n];
    const b = `b${n}`;
    return `    ${b}_section:
      name: ${label}
      icon: mdi:numeric-${n}-box
      collapsed: ${n === 1 ? "false" : "true"}
      input:
        ${b}_targets:
          name: Targets
          description: What this button controls (lights, switches, fans, ...).
          default: []
          selector:
            entity:
              multiple: true
              domain: ${DOMAINS}
        ${b}_mode:
          name: Tap does
          default: toggle
          selector:
            select:
              options:
                - label: Toggle the targets as one group
                  value: toggle
                - label: Always turn them ON
                  value: "on"
                - label: Always turn them OFF
                  value: "off"
                - label: ON, then each further tap brightens
                  value: brighten
                - label: Dim each tap, then OFF at the floor
                  value: dim
                - label: Room OFF - every button's targets + room extras
                  value: room_off
                - label: Room master - off if anything is on, else all on
                  value: room_master
                - label: Scene - the Tap action's scene.apply; LED lit while it is Active
                  value: scene
        ${b}_hold:
          name: Hold to dim
          description: >-
            Hold ramps the LIGHT targets until release: on a keypad, fan or
            outlet bright -> down, dim -> up; on a paddle the top half
            brightens and the bottom dims. Never on a paddle half that drives
            its own load: a DIM1-Z while "Paddle controls local load" is on,
            an APD120 or SW120277 half unless its button behaviour is
            event_only. A Scene's lit lights each move by the same step.
          default: true
          selector:
            boolean: {}
        ${b}_action:
          name: Tap action (optional)
          description: >-
            If set, a TAP runs this instead of the "Tap does" logic. Scene: one
            scene.apply naming the same lights as Targets.
          default: []
          selector:
            action: {}
        ${b}_double:
          name: Double-tap action
          default: []
          selector:
            action: {}
        ${b}_triple:
          name: Triple-tap action
          default: []
          selector:
            action: {}
        ${b}_quad:
          name: Quadruple-tap action
          default: []
          selector:
            action: {}
        ${b}_led:
          name: LED colour selects (optional)
          description: >-
            Leave empty: the button's own LED is found from its name (on a
            KC120277, the first LED slot of its pair, or its own slot under
            button_numbering: slots). Pick colour selects only to light other
            LEDs, such as both slots of a double-height cap - their LED numbers
            then win. On a DIM1-Z, APD120 or SW120277 leave empty: Button 1
            lights the top LED, Button 2 the bottom. An FS1-Z, fan or outlet
            has no LEDs this automation drives.
          default: []
          selector:
            entity:
              multiple: true
              filter:
                - integration: mqtt
                  domain: select
        ${b}_watch:
          name: LED watches (optional)
          description: >-
            Entities the LED shows. Empty = this button's own targets (for the
            Room modes: every button's targets + room extras).
          default: []
          selector:
            entity:
              multiple: true
${colourInput(`${b}_on`, "LED colour when ON", "Green")}
${colourInput(`${b}_off`, "LED colour when OFF", "Off")}
${colourInput(`${b}_night_on`, "Night - LED colour when ON", "(same as day)", undefined, ["(same as day)"])}
${colourInput(`${b}_night_off`, "Night - LED colour when OFF", "(same as day)", undefined, ["(same as day)"])}`;
}

const DESC = `  name: Control4 Device (buttons + LEDs + day/night) - Zigbee2MQTT
  description: >
    ONE automation per Control4 wall device on Zigbee2MQTT (control4-z2m):
    what every button does, what its LED shows, and how the LEDs behave at
    night. Works with the paddles of the C4-DIM1-Z and C4-APD120 dimmers,
    the C4-SW120277 switch and the C4-FS1-Z fireplace switch (button 1 =
    top, 2 = bottom), the C4-KC120277 scene controller, the C4-KP3-Z /
    C4-KP6-Z keypads, the C4-4SF120 fan controller (buttons 1-6 from the
    top: top, high, medium high, medium low, low, off) and the LOZ-5S1-W
    outlet (button 1 = outlet 1, 2 = outlet 2).


    REQUIRED: the control4-z2m extension on every Zigbee2MQTT instance, with
    Zigbee2MQTT's Home Assistant integration on. It gives each Control4
    device a "Control4 events" entity, which this automation hears the
    device's buttons through. When the device has none, a notification says
    so as Home Assistant starts and when automations are reloaded.


    BUTTONS. Per button: targets and a tap mode (toggle / on / off / brighten
    / dim / room off / room master / scene), an optional custom tap action,
    double / triple / quadruple-tap actions, and hold-to-dim. A group is
    always driven to ONE state or ONE absolute brightness, so a member that
    missed a command is pulled back in line; unavailable / unknown count as
    off. A button that drives its own device's load (a paddle half that
    does, a fan or outlet button) already switches it: leave that load out
    of its Targets and give the button extra loads or multi-tap actions.


    PADDLES. Each paddle half either drives its device's own load or only
    sends its taps. A DIM1-Z's halves follow its "Paddle controls local
    load" switch. An APD120's or SW120277's halves each follow their button
    behaviour select (top_button_behaviour, bottom_button_behaviour):
    event_only drives nothing; load_on, load_off, toggle and momentary drive
    the load (factory: top load_on, bottom load_off). On an APD120 a hold on
    a load_on or load_off half ramps the load itself and a momentary half
    dims while held; the SW120277 is a relay, so nothing ramps. A half that
    drives its load gets no hold-to-dim here. An event_only half is a button
    like a keypad's: Targets, a Scene, hold-to-dim and its LED.


    SCENE. A Scene button's Tap action is one scene.apply giving each of its
    lights a state and a brightness (0-255), and Targets lists the same
    lights. A tap applies it, also while it is already Active, and Night Dim
    never changes it. Its LED is ON only while the Scene is Active: every
    target in its state and within 2 points of its brightness (colour is not
    compared), whatever "When an LED watches several entities" says. The
    FAULT colour shows while the Tap action is not one scene.apply or names
    other lights than Targets. A hold moves each lit Scene light by the same
    step, keeping the Scene's spread; its lights that are off stay off. A
    level below a dimmer's lowest level never stays Active.


    RESPONSE. A Control4 device reports "tapped N times" only after its own
    multi-tap window (~1.6-1.7 s). The extension announces every tap the
    moment it is known to be a tap (a "known" tap): on its release on a
    keypad, KC120277, APD120, SW120277, fan or outlet (~0.1 s), on
    paddle-down on a DIM1-Z or FS1-Z. It also counts
    the taps itself (the "fast" count), one tap window after the last tap.
    Each device has its own tap window, the Zigbee2MQTT device option
    tap_window (0.25-1.5 s, default 0.55 s): widen it for slow tappers.


    Auto: a button with no multi-tap actions acts on every known tap
    (Brighten steps once per tap). On a button with multi-tap actions the
    first known tap commits early when the tap would leave the targets
    brighter (toward ON: On and Brighten, and Toggle and Room master while
    every target is off): it runs at once, and a double / triple /
    quadruple-tap action then runs on top of it on the fast count. A tap
    toward OFF (Off, Dim and Room off, Toggle and Room master while any
    target is on, Scene, and every custom tap action) waits for the fast
    count and runs only if it says single, so a double tap never darkens the room
    first; with no fast count it goes by the device's own count. Fast: the
    single tap on the fast count, never early, for a button whose darker
    double-tap action must not follow a bright flash. Instant acts on every
    known tap even when the button has multi-tap actions. Wait uses the
    device's own count. A button never seen releasing (on any device but a
    DIM1-Z or FS1-Z; the extension keeps the buttons it has seen sending a
    release, through a restart) announces no known taps: that tap is
    handled as Fast. Taps on a button that acts at once less than ~0.3 s
    apart may land as one: each tap decides from the targets' state, which
    the previous tap may not have changed yet.


    LEDS. Each button's LED follows its own targets by default (or the
    entities you name): ON colour and brightness, OFF colour and brightness,
    and a shared FAULT colour when a watched entity is unavailable, unknown or
    deleted. LEDs are driven through the extension's LED status layer
    ({"led_status": ...} on control4/<ieee>/set), which takes any colour at any
    brightness PER LED - so it holds even when the paddle no longer controls
    the load, and notifications put it back when they end. Only LEDs whose
    colour changed are transmitted. Every 30 minutes (or hourly: LED
    re-check) the LEDs are worked out again in case a change was missed; a
    re-check that finds nothing new sends nothing. Optional: the ON
    brightness follows the lights' own brightness, and keypad buttons show a
    pressed colour while a finger is on them (also at night, at the night
    brightness). A DIM1-Z is never sent LED changes while its load fades -
    they wait until it settles. On a DIM1-Z, APD120 or SW120277 Button 1
    lights the top LED and Button 2 the bottom. On an APD120 or SW120277 a
    painted LED shows this automation's colours instead of following the
    load; one whose button has no Targets or watches is never painted, so
    it keeps following the load (a led_status clear gives a painted one
    back to it). An FS1-Z, fan or outlet has no LEDs this automation drives.


    NIGHT. Optional: inside the night window (and, if chosen, once the room
    lights are off) per-button night colours apply at the night brightness. A
    night colour overrides the fault colour too, so a fixed night look stays
    fixed.


    NIGHT DIM. Optional: while a chosen entity is on (e.g. a house Night
    Mode), a tap that turns lights ON brings them on at the night level, not
    their last brightness, and by day at a day level if one is set. Holding
    brightens from there as usual.


    Runs in parallel: an LED update never delays or drops a button press, and
    a light change starts one LED run however many buttons list the light. A
    hold is owned by the run its paddle-down started, so repeating hold
    events can never start a second ramp; under Auto, a tap sequence's
    single tap is owned by the run its first known tap started.


    Button events arrive through the device's Control4 events entity, which
    the control4-z2m extension publishes from whichever Zigbee2MQTT instance
    has the device, so the device can be on any coordinator and a tap wakes
    only its own automation.
  domain: automation
  input:
    device_section:
      name: Device
      input:
        c4_device:
          name: Control4 device
          selector:
            device:
              filter:
${PICKER_MODELS.map((m) => `                - integration: mqtt\n                  manufacturer: Control4\n                  model_id: ${m}`).join("\n")}
        room_extra:
          name: Room extras
          description: >-
            Extra entities for the Room OFF / Room master modes, on top of
            every button's targets.
          default: []
          selector:
            entity:
              multiple: true
              domain: ${DOMAINS}
`;

const GLOBALS = `    response_section:
      name: Response speed
      icon: mdi:timer-fast-outline
      collapsed: true
      input:
        tap_response:
          name: Single-tap response
          default: auto
          selector:
            select:
              options:
                - label: Auto - at once; with multi-tap actions, a tap toward OFF waits the tap window
                  value: auto
                - label: Fast - the extension counts the taps, one tap window (~0.55 s) after the last one
                  value: fast
                - label: Instant - single tap at once (multi-taps also run the tap)
                  value: instant
                - label: Wait - the device's own tap count (~1.7 s)
                  value: wait

    dimming_section:
      name: Dimming
      icon: mdi:brightness-6
      collapsed: true
      input:
        hold_step:
          name: Hold step (%)
          description: Brightness change per hold tick.
          default: 6
          selector:
            number:
              min: 1
              max: 25
              unit_of_measurement: "%"
        hold_tick:
          name: Hold tick (s)
          default: 0.4
          selector:
            number:
              min: 0.1
              max: 2
              step: 0.05
              unit_of_measurement: s
        tap_step:
          name: Tap step (%)
          description: Change per tap in the brighten / dim modes.
          default: 10
          selector:
            number:
              min: 1
              max: 50
              unit_of_measurement: "%"
        dim_floor:
          name: Dim floor (%)
          description: A dim tap at or below this turns the targets off.
          default: 10
          selector:
            number:
              min: 1
              max: 50
              unit_of_measurement: "%"

    led_section:
      name: LED feedback
      icon: mdi:led-on
      collapsed: true
      input:
        led_on_brightness:
          name: Brightness when ON (%)
          description: Day brightness of an LED whose entities are on.
          default: 75
          selector:
            number:
              min: 1
              max: 100
              unit_of_measurement: "%"
        led_off_brightness:
          name: Brightness when OFF (%)
          description: Day brightness of an LED whose entities are off.
          default: 15
          selector:
            number:
              min: 1
              max: 100
              unit_of_measurement: "%"
        led_delay:
          name: LED update delay (s)
          description: >-
            How long after a light changes the LEDs are worked out, so a group
            whose members report a moment apart is painted once. Lower = faster
            LEDs; a DIM1-Z still gets nothing until its own fade is over.
          default: 0.3
          selector:
            number:
              min: 0
              max: 3
              step: 0.1
              unit_of_measurement: s
        led_resync:
          name: LED re-check
          description: >-
            Besides every change of what they watch, how often the LEDs are
            worked out again: a backstop for a change Home Assistant missed.
            The extension sends a device only LEDs whose colour changed, so a
            re-check that finds nothing new sends nothing over Zigbee; a frame
            that did not go out it sends again by itself within a minute, and
            a device that powers back up it repaints, so neither waits for this.
          default: "0"
          selector:
            select:
              options:
                - label: Every hour
                  value: "0"
                - label: Every 30 minutes
                  value: "/30"
        led_follow:
          name: ON brightness follows the lights
          description: >-
            An LED whose entities are on shows their brightness (the brightest
            one; switches and other on/off entities count as 100%), never below
            5%. Off - "Brightness when ON" is used.
          default: false
          selector:
            boolean: {}
${colourInput("pressed_colour", "Pressed colour", "(same as the LED)", "Keypads / KC120277: what a button shows while pressed - by day at Brightness when ON, at night at the night brightness (also when its night colour is Off). The DIM1-Z has no pressed colour.", ["(same as the LED)"])}
        led_match:
          name: When an LED watches several entities
          default: any
          selector:
            select:
              options:
                - label: ON if ANY is on
                  value: any
                - label: ON only if ALL are on
                  value: all
${colourInput("fault_colour", "Fault colour", "Red", "Shown when a watched entity is unavailable, unknown or deleted.", ["Treat as off"])}

    night_section:
      name: Day / night
      icon: mdi:weather-night
      collapsed: true
      input:
        night_enabled:
          name: Use a night look
          default: false
          selector:
            boolean: {}
        night_start:
          name: Night starts
          default: "21:00:00"
          selector:
            time: {}
        night_end:
          name: Night ends
          default: "06:00:00"
          selector:
            time: {}
        night_needs_dark:
          name: Only once the room lights are off
          description: >-
            On - inside the window, night applies only while every room light
            is off. Off - the clock alone decides.
          default: true
          selector:
            boolean: {}
        room_lights:
          name: Room lights
          description: Empty = every button's targets.
          default: []
          selector:
            entity:
              multiple: true
              domain: [light, switch]
        night_brightness:
          name: Night brightness (%)
          default: 10
          selector:
            number:
              min: 1
              max: 100
              unit_of_measurement: "%"

    night_dim_section:
      name: Night dim
      icon: mdi:lightbulb-night-outline
      collapsed: true
      input:
        night_dim_when:
          name: Dim while this is on
          description: >-
            An on/off entity, e.g. a house Night Mode input_boolean. While it
            is on, a tap that turns this device's lights ON brings them on at
            the night level instead of their last brightness; a hold still
            ramps from there. Empty = never.
          default: ""
          selector:
            entity:
              domain: [input_boolean, binary_sensor, switch, schedule]
        night_dim_level:
          name: Night level (%)
          default: 10
          selector:
            number:
              min: 1
              max: 100
              unit_of_measurement: "%"
        night_dim_level_from:
          name: Night level from (optional)
          description: >-
            An input_number / number whose value (%) replaces the level above,
            so one slider can set every device.
          default: ""
          selector:
            entity:
              domain: [input_number, number]
        night_dim_day_level:
          name: Day level (%)
          description: >-
            Outside the night, a tap that turns lights ON brings them on at
            this level, so the first tap of the morning is not stuck at the
            night level the lights remember. 0 = their last brightness.
          default: 0
          selector:
            number:
              min: 0
              max: 100
              unit_of_measurement: "%"
`;

// A tap sequence's counts as ZHA command names: the extension's fast count and the device's own.
const FAST_COUNTS = ["remote_button_fast_short_press", "remote_button_fast_double_press", "remote_button_fast_triple_press", "remote_button_fast_quadruple_press"];
const DEVICE_COUNTS = ["remote_button_short_press", "remote_button_double_press", "remote_button_triple_press", "remote_button_quadruple_press"];
// Every command a run can start on (tid below); a tap release is only waited for.
const STARTS = ["initial_switch_press", ...DEVICE_COUNTS, ...FAST_COUNTS, "remote_button_tap_known", "remote_button_long_press", "led_notification_end"];

// The state triggers that repaint the LEDs, in trigger order, right after the
// event trigger: one per entity list. Brightness changes repaint only when the
// ON brightness follows the lights, or for a Scene button's lights (the
// condition drops the rest).
const LED_TRIGGERS = [];
for (let n = 1; n <= N; n++) for (const k of ["targets", "watch"]) LED_TRIGGERS.push({id: "led", input: `b${n}_${k}`});
for (let n = 1; n <= N; n++) for (const k of ["targets", "watch"]) LED_TRIGGERS.push({id: "led_bri", input: `b${n}_${k}`});
LED_TRIGGERS.push({id: "led", input: "room_extra"}, {id: "led", input: "room_lights"});
// trigger.idx of LED_TRIGGERS[0]: the event trigger comes first.
const LED_TRIGGER_IDX = 1;

let TRIGGERS = `trigger:
  # This device's Control4 events, from its Control4 events entity (ADR 0005).
  - trigger: event.received
    target:
      device_id: !input c4_device
    options:
      event_type:
${STARTS.map((c) => `        - ${c}\n`).join("")}    id: event
`;
for (const t of LED_TRIGGERS) {
    TRIGGERS += `  - platform: state
    entity_id: !input ${t.input}
    ${t.id === "led" ? "to: ~" : "attribute: brightness"}
    id: ${t.id}
`;
}
TRIGGERS += `  - platform: time
    at: !input night_start
    id: led
  - platform: time
    at: !input night_end
    id: led
  - platform: homeassistant
    event: start
    id: boot
  # Saving / reloading automations - paint the LEDs at once, not at the
  # next re-check.
  - platform: event
    event_type: automation_reloaded
    id: reload
  # The LED re-check: "0" (on the hour, the default) or "/30" (every 30 minutes).
  - platform: time_pattern
    minutes: !input led_resync
    id: led
`;

const LED_TRIGGER_VARS = LED_TRIGGERS.map((t) => `    - id: ${t.id}\n      entities: !input ${t.input}\n`).join("");

let BTN_VARS = "";
for (let n = 1; n <= N; n++) {
    BTN_VARS += `    - targets: !input b${n}_targets
      mode: !input b${n}_mode
      hold: !input b${n}_hold
      action: !input b${n}_action
      double: !input b${n}_double
      triple: !input b${n}_triple
      quad: !input b${n}_quad
      led: !input b${n}_led
      watch: !input b${n}_watch
      "on": !input b${n}_on
      "off": !input b${n}_off
      night_on: !input b${n}_night_on
      night_off: !input b${n}_night_off
`;
}

const VARIABLES =
    String.raw`variables:
  dev: !input c4_device
  # Zigbee2MQTT names the HA device zigbee2mqtt_<ieee>; commands go to control4/<ieee>/set,
  # which the instance that has the device serves.
  ieee: >-
    {{ (device_attr(dev, 'identifiers') | map('last') | select('search', '^zigbee2mqtt_0x')
        | first | default('')) | replace('zigbee2mqtt_', '') }}
  set_topic: "control4/{{ ieee }}/set"
  model: "{{ device_attr(dev, 'model_id') or '' }}"
  # A DIM1-Z or FS1-Z sends no paddle-down before a hold: its hold event starts the hold run.
  hold_on_event: "{{ model in ['C4-DIM1-Z', 'C4-FS1-Z'] }}"
  # A paddle's halves are Button 1 (top) and Button 2 (bottom): a hold on the top brightens.
  is_paddle: "{{ model in ['C4-DIM1-Z', 'C4-APD120', 'C4-SW120277', 'C4-FS1-Z'] }}"
  # How many of its buttons have an LED the extension can find by the button's name
  # (on a paddle, Button 1 the top LED and Button 2 the bottom).
  led_buttons: "{{ {'C4-DIM1-Z': 2, 'C4-APD120': 2, 'C4-SW120277': 2, 'C4-KP3-Z': 3, 'C4-KP6-Z': 6, 'C4-KC120277': 6}.get(model, 0) }}"
  # A model with none (FS1-Z, fan, outlet) takes no led_status: this automation never paints it.
  paints_leds: "{{ led_buttons | int > 0 }}"
  response: !input tap_response
  hold_step: !input hold_step
  hold_tick: !input hold_tick
  tap_step: !input tap_step
  dim_floor: !input dim_floor
  room_extra: !input room_extra
  follow: !input led_follow
  led_delay: !input led_delay
  dim_when: !input night_dim_when
  dim_level: !input night_dim_level
  dim_level_from: !input night_dim_level_from
  dim_day: !input night_dim_day_level
  buttons:
` +
    BTN_VARS +
    String.raw`  # Every button's targets + extras: what the Room modes act on.
  room_all: >-
    {{ (buttons | map(attribute='targets') | sum(start=[]) + room_extra)
       | unique | list }}
  # The Scene buttons' lights: a brightness change alone can make a Scene Active or not.
  scene_lights: >-
    {{ buttons | selectattr('mode', 'eq', 'scene') | map(attribute='targets')
       | sum(start=[]) | unique | list }}
  # Each LED state trigger's id and entities, in trigger order from trigger.idx ${LED_TRIGGER_IDX}.
  led_triggers:
` +
    LED_TRIGGER_VARS +
    String.raw`  # A light that several buttons list fires one trigger per list on each change: only
  # the first trigger of its kind that lists it paints, so a change starts one LED run.
  # A brightness change that came with an on/off change leaves it to that change's run.
  led_first: >-
    {% if trigger.platform != 'state' or trigger.id not in ['led', 'led_bri'] %}{{ true }}
    {%- elif trigger.id == 'led_bri'
          and (trigger.from_state.state if trigger.from_state else none)
              != (trigger.to_state.state if trigger.to_state else none) %}{{ false }}
    {%- else %}
      {%- set f = namespace(i=-1) %}
      {%- for t in led_triggers %}
        {%- if f.i < 0 and t.id == trigger.id and trigger.entity_id in t.entities %}{% set f.i = loop.index0 %}{% endif %}
      {%- endfor %}
      {{- f.i + ${LED_TRIGGER_IDX} == trigger.idx | int(-1) }}
    {%- endif %}
  # --- this device's event (button events only) ---
  evt: "{{ trigger.to_state.attributes if trigger.id == 'event' else {} }}"
  mine: "{{ trigger.id == 'event' }}"
  # The ZHA command names -> the trigger ids the ZHA blueprint used.
  tid: >-
    {% set m = {'initial_switch_press': 'press', 'remote_button_short_release': 'release',
                'remote_button_short_press': 'tap', 'remote_button_double_press': 'double',
                'remote_button_triple_press': 'triple', 'remote_button_quadruple_press': 'quad',
                'remote_button_fast_short_press': 'fast_tap', 'remote_button_fast_double_press': 'fast_double',
                'remote_button_fast_triple_press': 'fast_triple', 'remote_button_fast_quadruple_press': 'fast_quad',
                'remote_button_tap_known': 'known', 'remote_button_long_press': 'hold',
                'led_notification_end': 'led'} %}
    {{ m.get(evt.get('command'), 'other') if mine else trigger.id }}
  # The Button number of the button the event names, less one: a paddle's top half is
  # Button 1 and its bottom half Button 2; a fan's buttons are 1-6 from the top (top,
  # high, medium_high, medium_low, low, off); an outlet's are outlet_1 and outlet_2; the
  # rest are button_N.
  bi: >-
    {% set b = evt.get('button', '') %}
    {% set named = {'top': 1, 'bottom': 2, 'high': 2, 'medium_high': 3, 'medium_low': 4, 'low': 5, 'off': 6,
                    'outlet_1': 1, 'outlet_2': 2} %}
    {{ ((named.get(b) or (b | regex_findall('^button_([0-9]+)$') | first | default(0) | int)) - 1)
       if mine else -1 }}
  btn: "{{ buttons[bi] if 0 <= bi < (buttons | count) else none }}"
  # The button drives its device's own load, which a hold then ramps itself: a DIM1-Z's
  # halves while "Paddle controls local load" is on; an APD120 or SW120277 half unless
  # its button behaviour select reads event_only (one it does not have yet counts as its
  # factory load_on / load_off).
  drives_load: >-
    {% if model in ['C4-APD120', 'C4-SW120277'] %}
      {% set half = {0: 'top', 1: 'bottom'}.get(bi | int(-1), '') %}
      {{ half != '' and device_entities(dev) | select('search', '^select\\..*_' ~ half ~ '_button_behaviour$')
         | select('is_state', 'event_only') | list | count == 0 }}
    {%- else %}
      {{ device_entities(dev) | select('search', '^switch\\..*_paddle_local_control$')
         | select('is_state', 'on') | list | count > 0 }}
    {%- endif %}
  multi: >-
    {{ btn is not none and (btn.double | count + btn.triple | count
                            + btn.quad | count) > 0 }}
  # Acting at once: every known tap (a keypad's release, a DIM1-Z's paddle-down).
  acts_at_once: "{{ response == 'instant' or (response == 'auto' and not multi) }}"
  # Early commit: the run of a sequence's first known tap decides its single tap.
  commits_early: "{{ response == 'auto' and multi }}"
  # Which event counts as THE single tap, so a tap never runs twice: the device
  # count (wait), the fast count, or each known tap (instant). A fast count whose
  # taps were not known (a keypad never seen releasing) runs the tap as Fast does;
  # one whose taps were known leaves an early-commit button's tap to that run.
  is_tap: >-
    {{ btn is not none
       and (tid == 'tap' if response == 'wait'
            else (tid == 'known' or (tid == 'fast_tap' and evt.get('known_taps') != true))
                 if acts_at_once
            else (tid == 'fast_tap' and evt.get('known_taps') != true) if commits_early
            else tid == 'fast_tap') }}
  # Multi-taps: the device's count on Wait, otherwise the fast count.
  gesture: >-
    {% if response == 'wait' %}{{ tid if tid in ['double', 'triple', 'quad'] else '' }}
    {%- else %}{{ tid[5:] if tid in ['fast_double', 'fast_triple', 'fast_quad'] else '' }}{% endif %}
  tgt: >-
    {{ [] if btn is none else
       (room_all if btn.mode in ['room_off', 'room_master'] else btn.targets) }}
  tgt_lights: "{{ tgt | select('match', '^light\\.') | list }}"
  # A hold starts with paddle-down on a button that has hold-to-dim here and does
  # not drive its own load; a DIM1-Z or FS1-Z sends no paddle-down for a hold, so
  # its hold event starts it.
  hold_candidate: >-
    {{ (tid == 'hold' if hold_on_event else tid == 'press') and not drives_load
       and btn is not none and btn.hold and tgt_lights | count > 0 }}
  # The run a sequence's first known tap starts owns its single tap, as a
  # paddle-down run owns a hold (ADR 0002).
  early: >-
    {{ commits_early and tid == 'known' and evt.get('tap_index') | int(0) == 1
       and (btn.action | count > 0 or tgt | count > 0) }}

# Drop every run that has nothing to do before it starts.
condition:
  - >-
    {{ tid in ['boot', 'reload'] or (tid == 'led' and led_first)
       or (tid == 'led_bri' and (follow or trigger.entity_id in scene_lights) and led_first)
       or is_tap or early or hold_candidate
       or (btn is not none and gesture in ['double', 'triple', 'quad']) }}

mode: parallel
max: 30
max_exceeded: silent
`;

function gestureBranches() {
    let out = "";
    for (let n = 1; n <= N; n++) {
        out += `              - conditions: "{{ (is_tap or early) and bi == ${n - 1} and btn.action | count > 0 }}"
                sequence: !input b${n}_action
`;
    }
    for (const g of ["double", "triple", "quad"]) {
        for (let n = 1; n <= N; n++) {
            out += `              - conditions: "{{ gesture == '${g}' and bi == ${n - 1} }}"
                sequence: !input b${n}_${g}
`;
        }
    }
    return out;
}

/**
 * A wait_for_trigger entry: an event with one ZHA command name on this
 * device's own topic (an event.received trigger can't be templated to one
 * button); with `ownButton`, only from the button that started the run.
 */
const waitFor = (command, indent, ownButton = false) => {
    const p = " ".repeat(indent);
    return `${p}- platform: mqtt
${p}  topic: "control4/{{ ieee }}/event"
${p}  value_template: "${ownButton ? "{{ value_json.button }}|" : ""}{{ value_json.command }}"
${p}  payload: ${ownButton ? `"{{ evt.button }}|${command}"` : command}
`;
};

// How long a tap toward OFF waits for its sequence's count: a backstop only,
// the device's own count comes about a second after the last tap.
const COUNT_TIMEOUT = 6;
// A fast count comes at most one tap window after the last press (the widest
// is MAX_TAP_WINDOW_MS, src/core/constants.ts), so after the device count.
const FAST_AFTER_DEVICE = 1.5;
const jinjaList = (xs) => `[${xs.map((x) => `'${x}'`).join(", ")}]`;

/**
 * The steps that say when this automation can't hear its device (ADR 0005):
 * a notification while the device has no Control4 events entity, dismissed
 * once it has one.
 */
const noEventsCheck = (indent) =>
    String.raw`- variables:
    note_id: "c4_device_no_events_{{ ieee }}"
    hears: >-
      {% set ns = namespace(n=0) %}
      {% for e in device_entities(dev) if e.startswith('event.')
         and 'remote_button_short_press' in (state_attr(e, 'event_types') or []) %}
        {% set ns.n = ns.n + 1 %}
      {% endfor %}
      {{ ns.n > 0 }}
- if: "{{ hears }}"
  then:
    - action: persistent_notification.dismiss
      data:
        notification_id: "{{ note_id }}"
  else:
    - action: persistent_notification.create
      data:
        notification_id: "{{ note_id }}"
        title: "Control4: {{ device_attr(dev, 'name_by_user') or device_attr(dev, 'name') }} hears no buttons"
        message: >-
          This device has no Control4 events entity, so its
          c4_device automation hears none of its buttons.
          Update the control4-z2m extension on the Zigbee2MQTT
          instance that has the device, and keep Zigbee2MQTT's
          Home Assistant integration on there.
`.replace(/^(?=.)/gm, " ".repeat(indent));

const ACTIONS =
    String.raw`action:
  - choose:
      # ============================ BUTTONS ============================
      - conditions: "{{ tid not in ['led', 'boot', 'reload', 'led_bri'] }}"
        sequence:
          # ---- EARLY COMMIT: this run owns its tap sequence's single tap (ADR 0002) ----
          # Toward ON, the tap runs now and the sequence's fast_single is ignored.
          # Toward OFF, it runs only if this button's fast count says single, so
          # a double tap never darkens the targets first.
          - if: "{{ early }}"
            then:
              - variables:
                  # Direction, from the targets' state now. A custom tap action's
                  # effect can't be known: it counts as toward OFF.
                  toward_on: >-
                    {{ btn.action | count == 0
                       and (btn.mode in ['on', 'brighten']
                            or (btn.mode in ['toggle', 'room_master']
                                and expand(tgt) | rejectattr('state', 'in', ['off', 'unavailable', 'unknown'])
                                    | list | count == 0)) }}
              - if: "{{ not toward_on }}"
                then:
                  # The fast count; the device's own count when it comes first (a
                  # tap window wider than the device's); a hold ends the sequence.
                  - wait_for_trigger:
` +
    [...FAST_COUNTS, ...DEVICE_COUNTS, "remote_button_long_press"].map((c) => waitFor(c, 22, true)).join("") +
    String.raw`                    timeout: ${COUNT_TIMEOUT}
                  - variables:
                      first_count: "{{ wait.trigger.payload_json.command if wait.trigger is not none else '' }}"
                  # After the device's count, the fast count still decides if it comes.
                  - wait_for_trigger:
` +
    [...FAST_COUNTS, "remote_button_long_press"].map((c) => waitFor(c, 22, true)).join("") +
    String.raw`                    timeout: "{{ ${FAST_AFTER_DEVICE} if first_count in ${jinjaList(DEVICE_COUNTS)} else 0 }}"
                  - if: >-
                      {{ (wait.trigger.payload_json.command if wait.trigger is not none else first_count)
                         not in ['remote_button_fast_short_press', 'remote_button_short_press'] }}
                    then:
                      - stop: Not a single tap
          - choose:
` +
    gestureBranches() +
    String.raw`              # ---- HOLD: this run owns the whole ramp (a paddle-down, or a DIM1-Z's or FS1-Z's hold) ----
              - conditions: "{{ hold_candidate }}"
                sequence:
                  # A paddle-down is a hold once its hold event beats the tap release.
                  - wait_for_trigger:
` +
    waitFor("remote_button_long_press", 22) +
    waitFor("remote_button_short_release", 22) +
    String.raw`                    timeout: "{{ 0 if hold_on_event else 0.9 }}"
                  - if:
                      - >-
                        {{ hold_on_event or (wait.trigger is not none
                           and wait.trigger.payload_json.command == 'remote_button_long_press') }}
                    then:
                      - variables:
                          base: >-
                            {{ (expand(tgt_lights) | selectattr('state', 'eq', 'on')
                                | map(attribute='attributes.brightness') | reject('none')
                                | list | max | default(0)) | int(0) }}
                          dir: >-
                            {{ (1 if bi == 0 else -1) if is_paddle
                               else (-1 if base | int(0) > 127 else 1) }}
                          step: "{{ (hold_step | float * 2.55) | round(0) | int }}"
                          # zigbee2mqtt lights get no fade time: Tuya dimmers
                          # (Moes etc.) reject the whole set with a transition.
                          step_lights: >-
                            {{ tgt_lights | select('in', integration_entities('mqtt'))
                               | list }}
                          fade_lights: >-
                            {{ tgt_lights | reject('in', integration_entities('mqtt'))
                               | list }}
                          # Where each light ramps from: the whole group from its brightest,
                          # so one level pulls a straggler in line; a Scene's lit lights each
                          # from their own level, keeping its spread (the off ones stay off).
                          ramp_from: >-
                            {% set ns = namespace(d={}) %}
                            {% for e in tgt_lights %}
                              {% if btn.mode != 'scene' %}
                                {% set ns.d = dict(ns.d, **{e: base | int(0)}) %}
                              {% elif is_state(e, 'on') %}
                                {% set ns.d = dict(ns.d, **{e: state_attr(e, 'brightness') | int(0)}) %}
                              {% endif %}
                            {% endfor %}
                            {{ ns.d }}
                      # Dimming lights that are all off would turn them on at the floor.
                      - condition: "{{ ramp_from | count > 0 and (dir | int > 0 or base | int(0) > 0) }}"
                      - repeat:
                          sequence:
                            # One ABSOLUTE level per light per tick, one call per level.
                            - variables:
                                moves: >-
                                  {% set ns = namespace(g={}) %}
                                  {% for e, f in ramp_from.items() %}
                                    {% set l = [[f | int + (dir | int) * (step | int) * repeat.index,
                                                 3] | max, 255] | min %}
                                    {% set k = l ~ '|' ~ (e in fade_lights) %}
                                    {% set ns.g = dict(ns.g, **{k: ns.g.get(k, []) + [e]}) %}
                                  {% endfor %}
                                  {% set out = namespace(l=[]) %}
                                  {% for k, es in ns.g.items() %}
                                    {% set p = k.split('|') %}
                                    {% set out.l = out.l + [{'lights': es, 'brightness': p[0] | int, 'fade': p[1] == 'True'}] %}
                                  {% endfor %}
                                  {{ out.l }}
                            - repeat:
                                for_each: "{{ moves }}"
                                sequence:
                                  - if: "{{ repeat.item.fade }}"
                                    then:
                                      - action: light.turn_on
                                        target:
                                          entity_id: "{{ repeat.item.lights }}"
                                        data:
                                          brightness: "{{ repeat.item.brightness }}"
                                          transition: "{{ hold_tick }}"
                                    else:
                                      - action: light.turn_on
                                        target:
                                          entity_id: "{{ repeat.item.lights }}"
                                        data:
                                          brightness: "{{ repeat.item.brightness }}"
                            - wait_for_trigger:
` +
    waitFor("remote_button_long_release", 32) +
    String.raw`                              timeout: "{{ hold_tick }}"
                          until:
                            # Stop on the release; full / minimum brightness for every
                            # light is the backstop when the release frame is lost.
                            - >-
                              {% set starts = ramp_from.values() | list %}
                              {% set raw = (starts | min if dir | int > 0 else starts | max) | int
                                 + (dir | int) * (step | int) * repeat.index %}
                              {{ wait.trigger is not none or raw <= 3 or raw >= 255
                                 or repeat.index >= 60 }}
              # ---- TAP: this button's mode, driving the group as one ----
              # (A Scene's tap is its Tap action, above: without one it does nothing.)
              - conditions: "{{ (is_tap or early) and tgt | count > 0 and btn.mode != 'scene' }}"
                sequence:
                  - variables:
                      any_on: >-
                        {{ expand(tgt) | rejectattr('state', 'in', ['off', 'unavailable', 'unknown'])
                           | list | count > 0 }}
                      lit: >-
                        {{ expand(tgt_lights) | selectattr('state', 'eq', 'on')
                           | map(attribute='entity_id') | list }}
                      cur: >-
                        {{ (expand(tgt_lights) | selectattr('state', 'eq', 'on')
                            | map(attribute='attributes.brightness') | reject('none')
                            | list | max | default(0)) | int(0) }}
                      step: "{{ (tap_step | float * 2.55) | round(0) | int }}"
                  - choose:
                      - conditions: "{{ btn.mode == 'brighten' and lit | count > 0 }}"
                        sequence:
                          - action: light.turn_on
                            target:
                              entity_id: "{{ tgt_lights }}"
                            data:
                              brightness: "{{ [cur | int + step | int, 255] | min }}"
                      - conditions: >-
                          {{ btn.mode == 'dim' and lit | count > 0
                             and cur | int > (dim_floor | float * 2.55) }}
                        sequence:
                          - action: light.turn_on
                            target:
                              entity_id: "{{ tgt_lights }}"
                            data:
                              brightness: "{{ [cur | int - step | int, 3] | max }}"
                    default:
                      - variables:
                          want: >-
                            {%- if btn.mode in ['on', 'brighten'] -%}on
                            {%- elif btn.mode in ['off', 'dim', 'room_off'] -%}off
                            {%- else -%}{{ 'off' if any_on else 'on' }}{%- endif -%}
                          # Night dim: lights come on at the night level (by day at the
                          # day level, if set); 0 = their last brightness. The rest just on.
                          on_pct: >-
                            {%- if want != 'on' or tgt_lights | count == 0 -%}0
                            {%- elif dim_when not in ['', none] and is_state(dim_when, 'on') -%}
                            {{ (states(dim_level_from) | float(dim_level)
                                if dim_level_from not in ['', none] else dim_level) | int(10) }}
                            {%- else -%}{{ dim_day | int(0) }}{%- endif -%}
                      - if: "{{ on_pct | int(0) > 0 }}"
                        then:
                          - action: light.turn_on
                            target:
                              entity_id: "{{ tgt_lights }}"
                            data:
                              brightness_pct: "{{ on_pct }}"
                          - if: "{{ tgt | reject('in', tgt_lights) | list | count > 0 }}"
                            then:
                              - action: homeassistant.turn_on
                                target:
                                  entity_id: "{{ tgt | reject('in', tgt_lights) | list }}"
                        else:
                          - action: "homeassistant.turn_{{ want }}"
                            target:
                              entity_id: "{{ tgt }}"

      # ========================= LED FEEDBACK =========================
      - conditions: "{{ tid in ['led', 'boot', 'reload', 'led_bri'] and ieee != '' and paints_leds }}"
        sequence:
          # Settle: a group moves several entities inside a few hundred ms and
          # each is its own trigger. Every run decides from the state AFTER the
          # delay, so parallel runs agree and their writes are identical.
          - delay:
              seconds: "{{ 90 if tid == 'boot' else led_delay | float(0.3) }}"
          # This automation hears the device's buttons through its Control4
          # events entity (ADR 0005); say so when the device has none, e.g. its
          # Zigbee2MQTT instance runs an older extension.
          - if: "{{ tid in ['boot', 'reload'] }}"
            then:
${noEventsCheck(14)}          - variables:
              night_on_cfg: !input night_enabled
              night_brightness: !input night_brightness
              n_start: !input night_start
              n_end: !input night_end
              needs_dark: !input night_needs_dark
              rl_in: !input room_lights
              rl: "{{ rl_in if rl_in | count > 0 else room_all }}"
              in_window: >-
                {% set t = now().strftime('%H:%M:%S') %}
                {# A time selector also takes 9:03: pad each part of both, so they compare with t as text. #}
                {% set w = namespace(l=[]) %}
                {% for v in [n_start, n_end] %}
                  {% set p = (v | string).split(':') + ['0'] %}
                  {% set w.l = w.l + [('0' ~ (p[0] | int(0)))[-2:] ~ ':' ~ ('0' ~ (p[1] | int(0)))[-2:] ~ ':' ~ ('0' ~ (p[2] | int(0)))[-2:]] %}
                {% endfor %}
                {% set s = w.l[0] %}{% set e = w.l[1] %}
                {{ (s <= t < e) if s <= e else (t >= s or t < e) }}
              rl_on: >-
                {% set c = namespace(n=0) %}
                {% for e in rl %}{% if is_state(e, 'on') %}{% set c.n = c.n + 1 %}{% endif %}{% endfor %}
                {{ c.n > 0 }}
              is_night: "{{ night_on_cfg and in_window and not (needs_dark and rl_on) }}"
              fault_c: !input fault_colour
              match: !input led_match
              on_states: >-
                {{ ['on', 'open', 'opening', 'closing', 'unlocked', 'unlocking',
                    'playing', 'buffering', 'home', 'heat', 'cool', 'heat_cool',
                    'auto', 'dry', 'fan_only', 'armed_home', 'armed_away',
                    'armed_night', 'armed_vacation', 'armed_custom_bypass',
                    'triggered', 'pending', 'arming', 'cleaning', 'active'] }}
              on_bri: !input led_on_brightness
              off_bri: !input led_off_brightness
              press_c: !input pressed_colour
              # One led_status call per (colour, brightness, pressed), naming the LEDs
              # it applies to: the N in each picked colour select (led_N_... /
              # button_N_...); with none picked, the button's name (button_N), which
              # the extension maps to that button's LED for the model and its numbering.
              calls: >-
                {% set ns = namespace(groups={}) %}
                {% for b in buttons %}
                  {% set i = loop.index0 %}
                  {% set nums = namespace(l=[]) %}
                  {% for e in b.led %}
                    {% set m = e | regex_findall('(?:button|led)_([0-9]+)_') %}
                    {% if m %}{% set nums.l = nums.l + [m[0]] %}{% endif %}
                  {% endfor %}
                  {% if nums.l | count == 0 and i < led_buttons %}{% set nums.l = ['button_' ~ (i + 1)] %}{% endif %}
                  {% set w = b.watch if b.watch | count > 0 else
                       (room_all if b.mode in ['room_off', 'room_master'] else b.targets) %}
                  {# A Scene button's LED shows whether its Scene is Active, unless it has watches. #}
                  {% set scene = b.mode == 'scene' and b.watch | count == 0 %}
                  {% if nums.l | count > 0 and (w | count > 0 or scene) %}
                    {% set sts = w | map('states') | list %}
                    {% set faulted = sts | select('in', ['unavailable', 'unknown']) | list | count > 0 %}
                    {% if scene %}
                      {# The Scene: the entities of a Tap action that is one scene.apply. #}
                      {% set a = b.action[0] if b.action | count == 1 and b.action[0] is mapping else {} %}
                      {% set sc = ((a.get('data') or {}).get('entities') or {})
                         if a.get('action', a.get('service')) == 'scene.apply' else {} %}
                      {% set sc = sc if sc is mapping else {} %}
                      {# A Fault while it is no Scene, or names other lights than Targets. #}
                      {% set s = namespace(bad=sc | count == 0 or (sc | list | sort) != (w | unique | sort | list), ok=true) %}
                      {% for e, spec in sc.items() %}
                        {% set d = spec if spec is mapping else {'state': spec} %}
                        {# YAML reads an unquoted on / off as a boolean, as scene.apply allows. #}
                        {% set st = d.get('state') %}
                        {% set st = 'on' if st is sameas true else 'off' if st is sameas false else st %}
                        {% if st is none %}{% set s.bad = true %}{% endif %}
                        {% set lvl = d.get('brightness') if d.get('brightness') is not none
                           else (d.get('brightness_pct') | float * 2.55) if d.get('brightness_pct') is not none
                           else none %}
                        {% set v = state_attr(e, 'brightness') %}
                        {# Active: every target in its state, a light within 2 points (5.1 of 255) of its level. #}
                        {% if states(e) != st | string
                              or (lvl is not none and st == 'on' and e.startswith('light.')
                                  and (v is none or (v | float - lvl | float) | abs > 5.1)) %}
                          {% set s.ok = false %}
                        {% endif %}
                      {% endfor %}
                      {% set faulted = faulted or s.bad %}
                      {% set lit = s.ok and not s.bad %}
                    {% else %}
                      {% set c = namespace(n=0) %}
                      {% for st in sts %}
                        {% if st in on_states or (st | is_number and st | float > 0) %}{% set c.n = c.n + 1 %}{% endif %}
                      {% endfor %}
                      {% set lit = (c.n > 0) if match == 'any' else (c.n == sts | count) %}
                    {% endif %}
                    {% set nightc = b.night_on if lit else b.night_off %}
                    {# A night colour, once set, wins over everything - fault included. #}
                    {% if is_night and nightc != '(same as day)' %}
                      {% set want = [nightc, night_brightness | int] %}
                    {% elif faulted and fault_c != 'Treat as off' %}
                      {% set want = [fault_c, on_bri | int] %}
                    {% elif lit %}
                      {% set bri = on_bri | int %}
                      {% if follow %}
                        {% set lv = namespace(l=[]) %}
                        {% for e in w | select('is_state', 'on') %}
                          {% set v = state_attr(e, 'brightness') %}
                          {% set lv.l = lv.l + [100 if v is none else ((v | float(255)) / 2.55) | round(0) | int] %}
                        {% endfor %}
                        {% set bri = [lv.l | max | default(100), 5] | max %}
                      {% endif %}
                      {% set want = [b['on'], bri] %}
                    {% else %}
                      {% set want = [b['off'], off_bri | int] %}
                    {% endif %}
                    {% set pc = '' if press_c == '(same as the LED)' else press_c %}
                    {% set pb = (night_brightness if is_night else on_bri) | int %}
                    {% set key = want[0] ~ '|' ~ want[1] ~ '|' ~ pc ~ '|' ~ (pb if pc else 0) %}
                    {% set ns.groups = dict(ns.groups, **{key: (ns.groups.get(key, []) + nums.l) | unique | list}) %}
                  {% endif %}
                {% endfor %}
                {% set out = namespace(l=[]) %}
                {% for key, nums in ns.groups.items() %}
                  {% set parts = key.split('|') %}
                  {% set call = {'buttons': nums | sort | join(','), 'color': parts[0], 'brightness': parts[1] | int} %}
                  {% if parts[2] %}
                    {% set call = dict(call, pressed_color=parts[2], pressed_brightness=parts[3] | int) %}
                  {% endif %}
                  {% set out.l = out.l + [call] %}
                {% endfor %}
                {{ out.l }}
          - repeat:
              for_each: "{{ calls }}"
              sequence:
                - action: mqtt.publish
                  data:
                    topic: "{{ set_topic }}"
                    payload: "{{ {'led_status': repeat.item} | to_json }}"
                  continue_on_error: true

      # An FS1-Z, fan or outlet gets no LED feedback (it has no LEDs this
      # automation drives), but the same check that this automation hears it.
      - conditions: "{{ tid in ['boot', 'reload'] and ieee != '' and not paints_leds }}"
        sequence:
          - delay:
              seconds: "{{ 90 if tid == 'boot' else 0 }}"
${noEventsCheck(10)}`;

const doc = `blueprint:\n${DESC}${Array.from({length: N}, (_, i) => buttonSection(i + 1)).join("\n")}\n\n${GLOBALS}\n${VARIABLES}\n${TRIGGERS}\n${ACTIONS}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? path.join(root, "blueprints", "c4_device.yaml");
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, doc, "utf8");
console.log(`wrote ${out} ${doc.split("\n").length} lines`);