export interface Defaults {
  NODE_ENV: string;
  HCTB_USERNAME: string;
  HCTB_PASSWORD: string;
  HCTB_SCHOOLCODE: string;
  DEFAULT_LAT: string;
  DEFAULT_LON: string;
}

export interface Child {
  name: string;
  id: string;
  active: boolean;
  current?: { lat: string; lon: string };
  previous?: { lat: string; lon: string };
}

export interface Time {
  label: string;
  id: string;
}

export interface Session {
  cookiestring: string;
  children: Child[];
  time: Time;
}

export interface Location {
  lat: string;
  lon: string;
}
