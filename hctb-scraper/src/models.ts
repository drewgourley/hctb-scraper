export interface Defaults {
  SUPERVISOR_TOKEN: string;
  HCTB_USERNAME: string;
  HCTB_PASSWORD: string;
  HCTB_SCHOOLCODE: string;
  DEFAULT_LAT: string;
  DEFAULT_LON: string;
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

export interface Time {
  label: string;
  id: string;
}

export interface Session {
  cookiestring: string;
  children: Child[];
  time: Time;
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
