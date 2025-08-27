export interface Config {
  SUPERVISOR_TOKEN: string;
  SUPERVISOR_URI: string;
  HCTB_USERNAME: string;
  HCTB_PASSWORD: string;
  HCTB_SCHOOLCODE: string;
  DEFAULT_LAT: string;
  DEFAULT_LON: string;
  SCHEDULE: string;
}

export interface Location {
  default: boolean;
  lat: string;
  lon: string;
}

export interface Child {
  name: string;
  id: string;
  active: boolean;
  current: Location;
  previous: Location;
}

export interface Session {
  cookiestring: string;
  children: Child[];
  time: string;
  expires: Date;
}

export enum TrueFalseString {
  True = 'true',
  False = 'false',
}

export interface RefreshMapInput {
  legacyID: string;
  name: string;
  timeSpanId: string | undefined;
  wait: TrueFalseString;
}
