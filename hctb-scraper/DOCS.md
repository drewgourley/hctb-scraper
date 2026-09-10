# HCTB Scraper Documentation

## Account Setup
You must provide your HCTB Username and Password in order for the scaper to log into your account and get location data. This is no different than logging into the HCTB frontend itself, and your credentials will not leave HomeAssistant.

You must also provide a school code which is provided by HCTB. For individuals who are tracking more than one school code, this configuration option can be given as a comma-separated list.

## Device Setup
For each child in your HCTB account, the add-on creates and updates a Home Assistant `device_tracker` entity named after the child's first name followed by `_bus` (for example `device_tracker.child_bus`), with a bus icon and a friendly name, and continuously writes the bus's live GPS coordinates. It writes this directly through Home Assistant's API using the add-on's built-in access, so there is **nothing to configure** — no webhook, no template, no YAML.

Add the entity to a Map card to watch the bus live.

## Zones and Automations
The tracker's **state** reflects the zone the bus is in, just like any Home Assistant device tracker. Because the add-on writes the entity directly through Home Assistant's API, Home Assistant does not resolve zones for it automatically, so the add-on does it for you: on each update it reads your zones and sets the state to `home` (for your Home zone), the zone's name, or `not_home` when the bus is outside every zone. When the bus falls inside more than one zone, the smallest (most specific) one wins. Passive zones are ignored for the state but still work with `zone` triggers.

Create a zone for anywhere you care about (your Home zone, the bus stop, each destination school), then automate on it. You can use either a **state** trigger (the state now becomes the zone name) or a **zone** trigger:

```yaml
automation:
  - alias: "Child's bus is arriving home"
    triggers:
      - trigger: zone
        entity_id: device_tracker.child_bus
        zone: zone.home
        event: enter
    actions:
      - action: notify.notify
        data:
          message: "Child's bus is arriving home!"
```

Use `event: leave` to fire when the bus departs a zone.

Zones are cached for an hour, so if you add or move a zone it may take up to an hour (or an add-on restart) before the tracker picks it up.

If you previously ran this add-on with the old `device_tracker.see` output or the webhook/template approach, you can remove those `*_bus` entries from `known_devices.yaml` and delete the template `device_tracker` from your `configuration.yaml` — they are no longer needed.

## Parking the Bus
HCTB will only show relevant rides when they are running, otherwise it just won't give any data. For these situations, HomeAssistant doesn't really have a way to "disappear" a device_tracker, so we must "park the bus" somewhere by providing a default location to fall back to.

You can park the bus anywhere you want, but for the sake of setting up notificaitons with zones in HomeAssistant, it is recommended to set the default location for the bus at the school. This must be configured by setting a default latitude and longitude in the add-on configuration.

You can use [latlong.net](https://www.latlong.net/) to find the coordinates you want to use.

## Scheduling
Due to the nature of scraping data like this, because HCTB doesn't allow for any kind of direct API access, we essentially have to poll their service to get location changes. In order to keep this process as efficient as possible, task scheduling has been implemented. This script will run every 30 seconds based on a cron schedule that you can help to provide if you wish. By default, the schedule is set to a normal school year for most kids in the US. If you need to run checks on a different schedule, you can formulate a crontab string at [crontab.guru](https://crontab.guru/). Keep in mind that you will only be providing the final four entries of a crontab, as the seconds and minutes are baked in.
