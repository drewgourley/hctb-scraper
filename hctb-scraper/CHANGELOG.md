## 2026.09.10.0
* The tracker state now reflects the zone the bus is in. Because the add-on writes the entity directly through the states API, Home Assistant does not resolve zones for it, so the state was stuck at `not_home`/`Away`. The add-on now reads your zones and sets the state to `home`, the matching zone's name, or `not_home` (smallest non-passive zone wins), just like a normal device tracker.

## 2026.08.19.2
* Removed in-add-on zone computation; the tracker just publishes GPS with a static state, so the bus icon is no longer overridden by a zone. Home Assistant's `zone` triggers work off the coordinates for enter/leave alert automations (see DOCS).

## 2026.08.19.1
* Write the device tracker directly via Home Assistant's states API (with a bus icon, friendly name, and automatic home/zone/not_home state) instead of a webhook + template. No YAML or webhook setup needed.

## 2026.08.19.0
* Post the location webhook directly to Home Assistant Core (new CORE_URI) so the webhook can stay `local_only: true`. Notifications still use the Supervisor proxy.

## 2026.08.18.0
* Replace the deprecated `device_tracker.see` action (removed in Home Assistant 2027.5) with a webhook that feeds a template device tracker. See DOCS for the one-time per-child setup.

## 2026.02.26.0
* Add timeouts, as a stuck request could hold up the whole system
