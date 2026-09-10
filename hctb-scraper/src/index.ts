import { parse, type HTMLElement } from 'node-html-parser';
import cron, { type TaskContext } from 'node-cron';
import fetch, { type Response as FetchResponse } from 'node-fetch';
import {
  AlertType,
  TrueFalseString,
  type AlertInput,
  type Child,
  type Config,
  type HAState,
  type HCTBResponse,
  type Location,
  type RefreshMapInput,
  type Session,
  type Sessions,
  type StateInput,
  type Zone,
} from './models.js';

const config: Config = process.env as unknown as Config;
const defaultlocation: Location = { lat: config.DEFAULT_LAT, lon: config.DEFAULT_LON };
const schools: string[] = config.HCTB_SCHOOLCODE.replace(' ', '').split(',');
let sessions: Sessions = {};
let notificationIds: string[] = [];
let zones: Zone[] = [];
let zonesExpires: number = 0;

async function ensureZones(): Promise<void> {
  if (zones.length && Date.now() < zonesExpires) return;
  try {
    const states: HAState[] = await fetch(`${config.SUPERVISOR_URI}/api/states`, {
      headers: { Authorization: `Bearer ${config.SUPERVISOR_TOKEN}` },
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    .then((res: FetchResponse) => {
      if (res?.ok) return res.json() as Promise<HAState[]>;
      throw new Error(res?.status?.toString());
    });
    const parsed: Zone[] = [];
    for (const state of states) {
      if (!state.entity_id.startsWith('zone.')) continue;
      const lat: number = Number(state.attributes.latitude);
      const lon: number = Number(state.attributes.longitude);
      const radius: number = Number(state.attributes.radius);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) continue;
      parsed.push({
        entity_id: state.entity_id,
        name: state.attributes.friendly_name ?? state.entity_id.replace(/^zone\./, ''),
        lat,
        lon,
        radius,
        passive: Boolean(state.attributes.passive),
        isHome: state.entity_id === 'zone.home',
      });
    }
    zones = parsed;
    zonesExpires = Date.now() + (60 * 60 * 1000);
  } catch (error) {
    console.error('  Zone fetch error:', error);
  }
}

// Great-circle distance in meters
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R: number = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat: number = toRad(lat2 - lat1);
  const dLon: number = toRad(lon2 - lon1);
  const a: number = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Resolve the tracker state the way Home Assistant would: smallest non-passive
// zone the point falls inside -> 'home' for the home zone, else the zone name.
function zoneStateFor(lat: number, lon: number): string {
  let best: Zone | null = null;
  for (const zone of zones) {
    if (zone.passive) continue;
    if (haversine(lat, lon, zone.lat, zone.lon) > zone.radius) continue;
    if (!best || zone.radius < best.radius) best = zone;
  }
  if (!best) return 'not_home';
  return best.isHome ? 'home' : best.name;
}

console.log(`HCTB Scraper started`);
cron.schedule(`*/10 * ${config.SCHEDULE}`, async (ctx: TaskContext) => { await task(ctx); }, { noOverlap: true });

async function login(ctx: TaskContext, school: string): Promise<void> {
  try {
    if (sessions[school] && ctx.triggeredAt.getTime() > sessions[school].expires.getTime()) {
      console.info('  Session expired');
      sessions[school] = null;
    } 
    if (!sessions[school]) {
      console.info('  Logging in');
      let cookiestring: string = '';
      let viewstate: string = '';
      let viewstategenerator: string = '';
      let eventvalidation: string = '';
      await fetch('https://login.herecomesthebus.com/authenticate.aspx', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      .then((res: FetchResponse) => {
        if (res?.ok) {
          const setcookie = res.headers.raw()['set-cookie'] ?? [];
          cookiestring += setcookie.map(cookie => cookie.split(';')[0]).join('; ');
          return res.text();
        }
        throw new Error(res?.status?.toString());
      })
      .then((text: string) => {
        if (text) {
          const root: HTMLElement = parse(text);
          viewstate = root.querySelector('#__VIEWSTATE')?.attributes.value ?? '';
          viewstategenerator = root.querySelector('#__VIEWSTATEGENERATOR')?.attributes.value ?? '';
          eventvalidation = root.querySelector('#__EVENTVALIDATION')?.attributes.value ?? '';
          return text;
        }
        throw new Error('Failed to fetch Form page');
      });
      const form: FormData = new FormData();
      form.append('__EVENTTARGET', '');
      form.append('__EVENTARGUMENT', '');
      form.append('__VIEWSTATE', viewstate);
      form.append('__VIEWSTATEENCRYPTED', '');
      form.append('__VIEWSTATEGENERATOR', viewstategenerator);
      form.append('__EVENTVALIDATION', eventvalidation);
      form.append('ctl00$ctl00$ddlLanguage', 'en');
      form.append('ctl00$ctl00$cphWrapper$cphContent$tbxUserName', config.HCTB_USERNAME);
      form.append('ctl00$ctl00$cphWrapper$cphContent$tbxPassword', config.HCTB_PASSWORD);
      form.append('ctl00$ctl00$cphWrapper$cphContent$tbxAccountNumber', school);
      form.append('ctl00$ctl00$cphWrapper$cphContent$btnAuthenticate', 'Log In');
      await fetch('https://login.herecomesthebus.com/authenticate.aspx', {
        redirect: 'manual',
        headers: { cookie: cookiestring, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form as unknown as Record<string, string>).toString(),
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      })
      .then((res: FetchResponse) => {
        if (res.status === 302) {
          const setcookie: string[] = res.headers.raw()['set-cookie'] ?? [];
          cookiestring += `; ${setcookie.map(cookie => cookie.split(';')[0]).join('; ')}`;
          return res;
        }
        throw new Error('Failed to post Form');
      });
      if (cookiestring.includes('ASP.NET_SessionId')) {
        let children: Child[] = [];
        let time: string | undefined;
        await fetch('https://login.herecomesthebus.com/map.aspx', {
          headers: { cookie: cookiestring },
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        })
        .then((res: FetchResponse) => {
          if (res?.ok) return res.text();
          throw new Error(res?.status?.toString());
        })
        .then((text: string) => {
          if (text) {
            const root: HTMLElement = parse(text);
            const options: HTMLElement[] = root.querySelectorAll('#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectPassenger option');
            for (const option of options) {
              const child: Child = {
                name: option.innerText,
                id: option.attributes.value!,
                active: true,
                alerts: [],
                location: defaultlocation,
              };
              children.push(child);
            }
            const timeoption: HTMLElement | null = 
              root.querySelector('#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectTimeOfDay option[selected="selected"]');
            if (timeoption && timeoption.attributes.value) time = timeoption.attributes.value;
            return text;
          }
          throw new Error('Failed to fetch Map page');
        });
        if (children.length && time) {
          const session: Session = {
            cookiestring,
            children,
            time,
            expires: new Date(new Date().getTime() + (19*60*1000)),
          }
          sessions[school] = session;
          console.info('  Session started');
        } else {
          throw new Error('Failed to establish session');
        }
      } else {
        throw new Error('Failed to log in');
      }
    }
  } catch (error) {
    console.error('  Login error:', error);
    sessions[school] = null;
  }
}

async function scrape(child: Child, school: string): Promise<void> {
  try {
    if (sessions[school]) {
      if (child.active) {
        console.info(`  Scraping data for ${child.name}`);
        const input: RefreshMapInput = {
          legacyID: child.id,
          name: child.name,
          timeSpanId: sessions[school].time,
          wait: TrueFalseString.True,
        };
        await fetch('https://login.herecomesthebus.com/map.aspx/refreshmap', {
          headers: { cookie: sessions[school].cookiestring, 'content-type': 'application/json; charset=UTF-8' },
          body: JSON.stringify(input),
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        })
        .then((res: FetchResponse) => {
          if (res?.ok) return res.json();
          sessions[school] = null;
          throw new Error(res?.status?.toString());
        })
        .then((json: any) => {
          if (json && json.d) {
            const jsonres: HCTBResponse = json;
            if (jsonres.d.includes('ShowMapAlerts')) {
              child.alerts = [];
              const alert = jsonres.d.match(/ShowMapAlerts\(\s*(true|false)\s*,\s*(true|false)\s*\)/i);
              if (alert) {
                if (alert[1] === 'true') child.alerts.push(AlertType.SUB);
                if (alert[2] === 'true') child.alerts.push(AlertType.LAG);
              }
            }
            if (
              jsonres.d.includes('No stops found for student') ||
              jsonres.d.includes('Vehicle Not In Service') ||
              jsonres.d.includes('The bus has completed the current route and cannot be viewed at this time')
            ) {
              child.active = false;
              console.info(`  Nothing found for ${child.name}`);
            }
            if (jsonres.d.includes('SetBusPushPin')) {
              const match: RegExpMatchArray | null = jsonres.d.match(/SetBusPushPin\(([-]?\d+\.?\d*),\s*([-]?\d+\.?\d*)/);
              if (match && match[1] && match[2]) {
                child.location = { lat: match[1], lon: match[2] };
                console.info(`  Location found for ${child.name}`);
              }
            }
          }
          return json;
        });
      } else {
        console.info(`  Skipping scrape for ${child.name}`);
        child.location = defaultlocation;
      }
    } else {
      throw new Error('Session not established');
    }
  } catch (error) {
    console.error('  Scrape error:', error);
    sessions[school] = null;
  }
}

async function sync(child: Child, school: string): Promise<void> {
  try {
    if (sessions[school]) {
      console.info(`  Syncing location for ${child.name}`);
      const firstname: string | undefined = child.name.split(' ')[0]?.toLowerCase();
      if (firstname) {
        const device: string = `${firstname}_bus`;
        const lat: number = Number(child.location.lat);
        const lon: number = Number(child.location.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          await ensureZones();
          const statebody: StateInput = {
            state: zoneStateFor(lat, lon),
            attributes: {
              source_type: 'gps',
              latitude: lat,
              longitude: lon,
              gps_accuracy: 10,
              friendly_name: `${firstname.charAt(0).toUpperCase()}${firstname.slice(1)} Bus`,
              icon: 'mdi:bus',
            },
          };
          await fetch(`${config.SUPERVISOR_URI}/api/states/device_tracker.${device}`, {
            headers: {
              Authorization: `Bearer ${config.SUPERVISOR_TOKEN}`,
              'Content-Type': `application/json`,
            },
            body: JSON.stringify(statebody),
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          })
          .then((res) => {
            if (res?.ok) {
              console.info(` Synced device_tracker.${device} (${statebody.state})`);
              return res;
            }
            throw new Error(res?.status?.toString());
          });
        } else {
          console.info(`  No valid location to sync for '${device}'`);
        }
        if (child.alerts.length) {
          for (const alert of child.alerts) {
            const name = child.name.endsWith('s') ? `${child.name}'` : `${child.name}'s`;
            const ride = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '-');
            const notification_id = `${device}_${alert}_${ride}_${sessions[school].time}`;
            const alertbody: AlertInput = {
              message: `${name} bus ${alert === AlertType.SUB
                ? 'has had a substitution, location data may not be available for this ride.'
                : 'data is experiencing high latency, you may not be able to rely on location data for this ride.'}`,
              title: 'Here Comes The Bus Alert',
              notification_id,
            };
            if (!notificationIds.includes(notification_id)) {
              await fetch(`${config.SUPERVISOR_URI}/api/services/persistent_notification/create`, {
                headers: {
                  Authorization: `Bearer ${config.SUPERVISOR_TOKEN}`,
                  'Content-Type': `application/json`,
                },
                body: JSON.stringify(alertbody),
                method: 'POST',
                signal: AbortSignal.timeout(5000),
              })
              .then((res) => {
                if (res?.ok) {
                  console.info(` Alert sent for HomeAssistant device '${device}'`);
                  notificationIds.push(notification_id);
                  return res;
                }
                throw new Error(res?.status?.toString());
              });
            }
          }
        }
      } else {
        throw new Error('Device ID could not be resolved');
      }
    } else {
      throw new Error('Session not established');
    }
  } catch (error) {
    console.error('  Sync Error:', error);
  }
}

async function task(ctx: TaskContext): Promise<void> {
  console.info('Bus location task started:', ctx.triggeredAt.toISOString());
  for (const school of schools) {
    await login(ctx, school);
    for (const child of sessions[school]?.children || []) {
      await scrape(child, school);
      await sync(child, school);
    }
  }
  console.info(`Bus location task finished in ${new Date().getTime() - ctx.triggeredAt.getTime()}ms`);
}
