import * as cheerio from 'cheerio';
import cron, { type TaskContext } from 'node-cron';
import dotenv from 'dotenv';
import express, { type Request, type Response, type Express } from 'express';
import fetch, { type Response as FetchResponse } from 'node-fetch';
import http from 'http';
import { TrueFalseString, type Child, type Defaults, type Location, type RefreshMapInput, type Session, type Time } from './models.js';
dotenv.config({ quiet: true });
const app: Express = express();
const defaults: Defaults = process.env as unknown as Defaults;
const isdev: boolean = defaults.NODE_ENV === 'development';
const schedule: string = isdev ? '15,45 * * * * *' : `0,30 * 7,8,9,10,11,12,13,14,15,16 * 1,2,3,4,5,8,9,10,11,12, 1,2,3,4,5`;
let healthy: boolean = true;
let session: Session | null = null;
app.use(express.json());
app.get('/', (req: Request, res: Response) => {
  const now: string = new Date().toISOString();
  let ip: string[] = req.socket.remoteAddress?.split(':') ?? [];
  console.info(`${now}: Healthcheck requested by ${ip[ip.length - 1]}, reporting ${healthy ? 'healthy' : 'unhealthy'}`);
  res.send({ healthy });
});
http.createServer(app).listen(defaults.PORT, () => {
  console.log(`HCTB Scraper started, Healthcheck available on port ${defaults.PORT}`);
  cron.schedule(schedule, async (ctx: TaskContext) => { await task(ctx); }, { noOverlap: true });
});

async function login(): Promise<void> {
  console.info('  Logging in');
  try {
    let cookiestring: string = '';
    let viewstate: string = '';
    let viewstategenerator: string = '';
    let eventvalidation: string = '';
    await fetch('https://login.herecomesthebus.com/authenticate.aspx', {
      method: 'GET',
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
        const $ = cheerio.load(text);
        viewstate = $('#__VIEWSTATE').val() as string;
        viewstategenerator = $('#__VIEWSTATEGENERATOR').val() as string;
        eventvalidation = $('#__EVENTVALIDATION').val() as string;
        return text;
      }
      throw new Error('Failed to fetch Form page');
    });
    const form = new FormData();
    form.append('__VIEWSTATE', viewstate);
    form.append('__VIEWSTATEGENERATOR', viewstategenerator);
    form.append('__EVENTVALIDATION', eventvalidation);
    form.append('ctl00$ctl00$cphWrapper$cphContent$tbxUserName', defaults.HCTB_USERNAME);
    form.append('ctl00$ctl00$cphWrapper$cphContent$tbxPassword', defaults.HCTB_PASSWORD);
    form.append('ctl00$ctl00$cphWrapper$cphContent$tbxAccountNumber', defaults.HCTB_SCHOOLCODE);
    form.append('ctl00$ctl00$cphWrapper$cphContent$btnAuthenticate', 'Log In');
    await fetch('https://login.herecomesthebus.com/authenticate.aspx', {
      redirect: 'manual',
      headers: { cookie: cookiestring, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form as any).toString(),
      method: 'POST',
    })
    .then((res: FetchResponse) => {
      if (res.status === 302) {
        const setcookie = res.headers.raw()['set-cookie'] ?? [];
        cookiestring += `; ${setcookie.map(cookie => cookie.split(';')[0]).join('; ')}`;
        return res;
      }
      throw new Error('Failed to post Form');
    });
    if (cookiestring.includes('.ASPXFORMSAUTH')) {
      let children: Child[] = [];
      let time: Time | undefined;
      await fetch('https://login.herecomesthebus.com/map.aspx', {
        headers: { cookie: cookiestring },
        method: 'GET',
      })
      .then((res: FetchResponse) => {
        if (res?.ok) return res.text();
        throw new Error(res?.status?.toString());
      })
      .then((text: string) => {
        if (text) {
          const $ = cheerio.load(text);
          for (const option of $('#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectPassenger option')) {
            const child: Child = { name: $(option).text(), id: $(option).val() as string, active: true };
            if (isdev) console.debug(`--Found child - Name: ${child.name}, ID: ${child.id}`);
            children.push(child);
          }
          const timeoption = $('#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectTimeOfDay option[selected="selected"]');
          time = { label: timeoption.text(), id: timeoption.val() as string };
          if (isdev) console.debug(`--Found time - Label: ${time.label}, ID: ${time.id}`);
          return text;
        }
        throw new Error('Failed to fetch Map page');
      });
      if (children.length && time) {
        healthy = true;
        session = { cookiestring, children, time, expires: new Date(new Date().getTime() + (19*60*1000)) };
        console.info('  Session established');
      } else {
        throw new Error('Failed to establish session');
      }
    } else {
      throw new Error('Failed to log in');
    }
  } catch (error) {
    healthy = false;
    console.error('Login error:', error);
  }
}

async function scrape(child: Child): Promise<Location> {
  console.info(`  Scraping data for ${child.name}`);
  let location: Location = { default: true, lat: defaults.DEFAULT_LAT, lon: defaults.DEFAULT_LON };
  try {
    if (child.active) {
      const input: RefreshMapInput = { legacyID: child.id, name: child.name, timeSpanId: session?.time.id, wait: TrueFalseString.True };
      await fetch('https://login.herecomesthebus.com/map.aspx/refreshmap', {
        headers: { cookie: session?.cookiestring ?? '', 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(input),
        method: 'POST',
      })
      .then((res: FetchResponse) => {
        if (res?.ok) return res.json();
        throw new Error(res?.status?.toString());
      })
      .then((json: any) => {
        if (json && json.d) {
          const data: string = json.d;
          if (
            data.includes('No stops found for student') ||
            data.includes('The bus has completed the current route and cannot be viewed at this time')
          ) {
            child.active = false;
          }
          if (data.includes('SetBusPushPin')) {
            const match: RegExpMatchArray | null = data.match(/SetBusPushPin\(([-]?\d+\.?\d*),\s*([-]?\d+\.?\d*)/);
            if (match && match[1] && match[2]) {
              location = { default: false, lat: match[1], lon: match[2] };
            }
          }
        }
        return json;
      });
    }
  } catch (error) {
    console.error('Scrape error:', error);
  } finally {
    if (isdev) console.debug(`--Scrape sending ${ location.default ? 'default' : 'location'} [${location.lat}, ${location.lon}]`);
    return location;
  }
}

async function sync(child: Child): Promise<void> {
  console.info(`  Syncing location for ${child.name}`);
  try {
    const firstname: string | undefined = child.name.split(' ')[0]?.toLowerCase();
    if (firstname && child.current) {
      const device: string = `${firstname}_bus`;
      await fetch(`${process.env.HASS_URI}/api/services/device_tracker/see`, {
        headers: {
          Authorization: `Bearer ${process.env.HASS_TOKEN}`,
          'Content-Type': `application/json`,
        },
        body: JSON.stringify({ dev_id: device, gps: [child.current.lat, child.current.lon] }),
        method: 'POST',
      }).then((res) => {
        if (res?.ok) {
          console.info(`Bus location sent to HomeAssistant device '${device}'`);
          return res;
        }
        throw new Error(res?.status?.toString());
      });
    } else {
      throw new Error('Device ID or Location could not be resolved');
    }
  } catch (error) {
    console.error('Sync Error:', error);
  }
}

async function task(ctx: TaskContext): Promise<void> {
  console.info('Bus location task started:', ctx.triggeredAt.toISOString());
  if (session && ctx.triggeredAt.getTime() > session.expires.getTime()) {
    console.info('  Session expired');
    session = null;
  } 
  if (!session) await login();
  for (const child of session?.children || []) {
    const location = await scrape(child);
    if (child.current) child.previous = child.current;
    child.current = location;
    if (child.previous?.lat !== child.current.lat && child.previous?.lon !== child.current.lon) {
      await sync(child);
    } else {
      console.info(`Bus location did not change for ${child.name}`);
    }
  }
}
