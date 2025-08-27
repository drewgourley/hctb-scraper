#!/usr/bin/with-contenv bashio
bashio::log.info "Starting Here Comes The Bus Location Scraper"

export SUPERVISOR_URI="http://supervisor/core"
export HCTB_USERNAME=$(bashio::config 'hctb_username')
export HCTB_PASSWORD=$(bashio::config 'hctb_password')
export HCTB_SCHOOLCODE=$(bashio::config 'hctb_schoolcode')
export DEFAULT_LAT=$(bashio::config 'default_lat')
export DEFAULT_LON=$(bashio::config 'default_lon')
export SCHEDULE=$(bashio::config 'schedule')

npm run start
