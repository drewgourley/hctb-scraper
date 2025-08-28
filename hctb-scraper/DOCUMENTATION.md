# HCTB Scraper Documentation

## Device Setup
The script will find rides for each child set up within your HCTB account. For each bus, a device tracker will be added to HomeAssistant with the child's first name followed by '_bus'.

You can still use [known_devices](https://www.home-assistant.io/integrations/device_tracker/#known_devicesyaml) to extend these entities with things like a friendly name and an icon for use when adding the devices to a map on your dashboard.

## Parking the Bus
You can "park the bus" anywhere you want, but I like to set the default latitude and longitude for the bus at the school. You can use [latlong.net](https://www.latlong.net/) to find the coordinates you want to use.

## About Scheduling
Due to the nature of scraping data like this, because HCTB doesn't allow for any kind of direct API access, we basically have to poll their service to get location changes. In order to keep this process as efficient as possible, task scheduling has been implemented. This script will run every 30 seconds based on a cron schedule that you can help to provide if you wish. By default, the schedule is set to a normal school year for most kids in the US. If you need to run checks on a different schedule, you can formulate a crontab string at [crontab.guru](https://crontab.guru/). Keep in mind that you will only be providing the final four entries of a crontab, as the seconds and minutes are baked in.
