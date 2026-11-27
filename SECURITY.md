# Security

control4-z2m runs inside Zigbee2MQTT and talks to Control4 devices on your Zigbee network. It
opens no network ports of its own; it reads and writes MQTT topics under Zigbee2MQTT's base topic
and the shared `control4/` namespace (README, "MQTT API"), so anyone who can publish to your MQTT
broker can command your devices through it, as they can through Zigbee2MQTT itself. Keep the broker
behind authentication.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use GitHub's private vulnerability
reporting: the **Security** tab of this repo, then **Report a vulnerability**. Say what an attacker
can do, and how to reproduce it. You'll get an answer there; a fix goes out as a new release, and the
report is published once one is available.

## Supported versions

Only the newest release gets fixes. The README's "Install" section says how to update.
