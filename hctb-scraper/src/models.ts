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
  lat: string;
  lon: string;
}

export interface Child {
  name: string;
  id: string;
  active: boolean;
  location: Location;
}

export interface Sessions {
  [key: string]: Session | null;
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

type GpsArray = [string, string];

export interface SyncInput {
  dev_id: string,
  gps: GpsArray,
}

export interface DeviceResponse {
  attributes: {
    latitude: number;
    longitude: number;
  }
}

export interface HCTBResponse {
  d: string;
}
