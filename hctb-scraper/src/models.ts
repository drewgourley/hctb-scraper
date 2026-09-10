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
  alerts: AlertType[]
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

export enum AlertType {
  SUB = 'substitution',
  LAG = 'latency',
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

export interface AlertInput {
  message: string,
  title?: string,
  notification_id?: string,
}

export interface DeviceResponse {
  attributes: {
    latitude: number;
    longitude: number;
  }
}

// GET /api/states entry (used to read zone.* entities)
export interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
}

export interface Zone {
  entity_id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  passive: boolean;
  isHome: boolean;
}

export interface HCTBResponse {
  d: string;
}

// POST /api/states/device_tracker.<device> body
export interface StateInput {
  state: string;
  attributes: {
    source_type: 'gps';
    latitude: number;
    longitude: number;
    gps_accuracy: number;
    friendly_name: string;
    icon: string;
  };
}
