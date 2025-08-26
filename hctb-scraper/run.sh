#!/usr/bin/with-contenv bashio
bashio::log.info "Starting HCTB Scraper Add-On"

export HCTB_USERNAME=$(bashio::config 'hctb_username')
export HCTB_PASSWORD=$(bashio::config 'hctb_password')
export HCTB_SCHOOLCODE=$(bashio::config 'hctb_schoolcode')
export DEFAULT_LAT=$(bashio::config 'default_lat')
export DEFAULT_LON=$(bashio::config 'default_lon')

npm run start
