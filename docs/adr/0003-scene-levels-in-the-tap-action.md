# A Scene's levels live in its button's Tap action, its lights in Targets

A Scene button's LED must know each target's level to show whether its Scene is Active, but a Home Assistant `scene.*` entity exposes only its entity list, never its stored levels, and a blueprint cannot read `scenes.yaml`. So a Scene is written as one `scene.apply` in the button's existing Tap action: the tap runs it and the LED reads its levels from it. Its lights must also be the button's Targets, which give the LED its state triggers and hold and the Room modes their lights, as for every other mode. The LED shows the Fault colour while the Scene and Targets name different lights, so the two lists cannot drift apart unseen.

## Considered Options

- **HA scenes (`scene.turn_on`).** Natural in Home Assistant and editable in its scene editor, but with only an entity list the LED could track on/off, not levels, so Bright and Dinner on the same lights would both light. A Tap action like this shows the Fault colour in Scene mode.
- **Targets derived from the Scene.** One list instead of two, but a state trigger's entity list cannot be templated, so the LED would need template triggers reading every button's Tap action through `trigger_variables`. Those render as limited templates: a Tap action whose template reads state (`states()`, `is_state()`, ...) throws there, and Home Assistant then attaches none of the automation's triggers, so one such action on any button, Scene or not, stops the whole device (seen on the test HA, 2026-10-26).
- **A per-button "Scene levels" input.** Friendlier units (percent, not 0-255) and plain data a trigger could read safely, but six more inputs on a form that already has 13 per button.

## Consequences

Installers write Scenes as YAML in the action editor, with brightness in 0-255 as `scene.apply` takes it, and list the same lights in Targets. Moving the levels anywhere else later means rewriting every installed Scene button.
