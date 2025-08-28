# HCTB Scraper Documentation

## Account Setup
You must provide your HCTB Username and Password in order for the scaper to log into your account and get location data, this is no different than logging into the HCTB frontend itself, and your credentials will not leave HomeAssistant.

You must also provide a school code which is provided by HCTB. For individuals who are tracking more than one school code, this configuration option can be given as a comma-separated list.

## Device Setup
The script will find rides for each child set up within your HCTB account. For each bus, a device tracker will be added to HomeAssistant with the child's first name followed by '_bus'.

You can still use [known_devices](https://www.home-assistant.io/integrations/device_tracker/#known_devicesyaml) to extend these entities with things like a friendly name and an icon for use when adding the devices to a map on your dashboard.

## Parking the Bus
HCTB will only show relevant rides when they are running, otherwise it just won't give any data. For these situations, HomeAssistant doesn't really have a way to "disappear" a device_tracker, so we must "park the bus" somewhere by providing a default location to fall back to.

You can park the bus anywhere you want, but for the sake of setting up notificaitons with zones in HomeAssistant, it is recommended to set the default location for the bus at the school. This must be configured by setting a default latitude and longitude in the add-on configuration.

You can use [latlong.net](https://www.latlong.net/) to find the coordinates you want to use.

## Scheduling
Due to the nature of scraping data like this, because HCTB doesn't allow for any kind of direct API access, we essentially have to poll their service to get location changes. In order to keep this process as efficient as possible, task scheduling has been implemented. This script will run every 30 seconds based on a cron schedule that you can help to provide if you wish. By default, the schedule is set to a normal school year for most kids in the US. If you need to run checks on a different schedule, you can formulate a crontab string at [crontab.guru](https://crontab.guru/). Keep in mind that you will only be providing the final four entries of a crontab, as the seconds and minutes are baked in.
