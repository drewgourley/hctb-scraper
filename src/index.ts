import * as cheerio from 'cheerio';
import cron, { type TaskContext } from 'node-cron';
import dotenv from 'dotenv';
import express, { type Request, type Response, type Express } from 'express';
import fetch, { type Response as FetchResponse } from 'node-fetch';
import http from 'http';
import puppeteer, { type Browser, type Cookie, type LaunchOptions, type Page } from 'puppeteer';
import { TrueFalseString, type Child, type Defaults, type Location, type RefreshMapInput, type Session, type Time } from './models.js';
dotenv.config({ quiet: true });
const app: Express = express();
const defaults: Defaults = process.env as unknown as Defaults;
const defaultlocation: Location = { lat: defaults.DEFAULT_LAT, lon: defaults.DEFAULT_LON };
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
  cron.schedule(schedule, async (ctx: TaskContext) => { await task(0, ctx); }, { noOverlap: true });
});

async function login(): Promise<void> {
  console.info('  Logging in');
  let browser: Browser | undefined;
  try {
    let launchoptions: LaunchOptions = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (!isdev) launchoptions.executablePath = '/usr/bin/chromium-browser';
    browser = await puppeteer.launch(launchoptions);
    const page: Page = await browser.newPage();
    await page.goto('https://login.herecomesthebus.com/Authenticate.aspx');
    await page.type('#ctl00_ctl00_cphWrapper_cphContent_tbxUserName', defaults.HCTB_USERNAME);
    await page.type('#ctl00_ctl00_cphWrapper_cphContent_tbxPassword', defaults.HCTB_PASSWORD);
    await page.type('#ctl00_ctl00_cphWrapper_cphContent_tbxAccountNumber', defaults.HCTB_SCHOOLCODE);
    await page.click('#ctl00_ctl00_cphWrapper_cphContent_btnAuthenticate');
    await page.waitForNavigation();
    const cookies: Cookie[] = await browser.cookies();
    await browser.close();
    if (cookies?.find((cookie) => cookie.name === '.ASPXFORMSAUTH')) {
      if (isdev) console.debug('--Got session cookie');
      let cookiestring: string = '';
      let children: Child[] = [];
      let time: Time | undefined;
      for (const cookie of cookies) { cookiestring += `${cookie.name}=${cookie.value}; `; }
      await fetch('https://login.herecomesthebus.com/Map.aspx', {
        headers: { cookie: cookiestring },
        method: 'GET',
      })
      .then((res: FetchResponse) => {
        if (res?.ok) return res.text();
        throw new Error(res?.status?.toString());
      })
      .then((text: string) => {
        if (text) {
          if (isdev) console.debug('--Fetched Map page');
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
        session = { cookiestring, children, time };
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
  } finally {
    if (browser) await browser.close();
  }
}

async function scrape(child: Child): Promise<Location | undefined> {
  console.info(`  Scraping data for ${child.name}`);
  let location: Location | undefined;
  try {
    const input: RefreshMapInput = { legacyID: child.id, name: child.name, timeSpanId: session?.time.id, wait: TrueFalseString.True };
    await fetch('https://login.herecomesthebus.com/Map.aspx/RefreshMap', {
      headers: { cookie: session?.cookiestring ?? '', 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(input),
      method: 'POST',
    })
      .then((res: FetchResponse) => {
        if (res?.ok) return res.json();
        if (res?.status === 401) {
          console.info('  Session expired');
          session = null;
          return res;
        }
        throw new Error(res?.status?.toString());
      })
      .then((json: any) => {
        if (json && json.d) {
          const commandstring: string = json.d;
          console.log('--JSON Dump:', commandstring);
          if (commandstring.includes('No stops found for student')) {
            child.active = false;
            if (isdev) console.debug(`--Scrape found bus not running`);
          }
          if (commandstring === 'ClearStaticLayer();\r\nClearDynamicLayer();\r\n') {
            if (isdev) console.debug(`--Scrape found nothing`);
          }
          if (commandstring.includes('SetBusPushPin')) {
            const match: RegExpMatchArray | null = commandstring.match(/SetBusPushPin\(([-]?\d+\.?\d*),\s*([-]?\d+\.?\d*)/);
            if (match && match[1] && match[2]) {
              location = { lat: match[1], lon: match[2] };
              if (isdev) console.debug(`--Scrape found location - Latitude: ${location.lat}, Longitude: ${location.lon}`);
            }
          }
          if (!location) {
            location = defaultlocation;
            if (isdev) console.debug(`--Using default location - Latitude: ${location.lat}, Longitude: ${location.lon}`);
          }
        }
        return json;
      });
  } catch (error) {
    console.error('Scrape error:', error);
  } finally {
    return location;
  }
}

async function sync(child: Child): Promise<void> {
  console.info(`  Syncing location for ${child.name}`);
  try {
    const firstname: string | undefined = child?.name?.split(' ')[0]?.toLowerCase();
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

async function task(runs: number, ctx?: TaskContext): Promise<void> {
  if (ctx) console.info('Bus location task started:', ctx.triggeredAt.toISOString());
  let location: Location | undefined;
  let relog: boolean = false;
  if (!session) await login();
  for (const child of session?.children || []) {
    if (child.active) {
      location = await scrape(child);
    } else {
      location = defaultlocation;
      if (isdev) console.debug(`--Using default location - Latitude: ${location.lat}, Longitude: ${location.lon}`);
    }
    if (location) {
      if (child.current) child.previous = child.current;
      child.current = location;
      if (child.previous?.lat !== child.current.lat && child.previous?.lon !== child.current.lon) {
        await sync(child);
      } else {
        console.info(`Bus location did not change for ${child.name}`);
      }
    } else if (!session) {
      relog = true;
    }
  }
  if (relog) runs++;
  if (runs === 1) await task(runs);
}
