import * as cheerio from 'cheerio';
import cron, { type TaskContext } from 'node-cron';
import dotenv from 'dotenv';
import express, { type Request, type Response, type Express } from 'express';
import fetch, { type Response as FetchResponse } from 'node-fetch';
import http from 'http';
import puppeteer, { type Browser, type Cookie, type LaunchOptions, type Page } from 'puppeteer';
import type { Child, Defaults, Location, Session, Time } from './models.js';

dotenv.config({ quiet: true });

const app: Express = express();
const defaults: Defaults = process.env as unknown as Defaults;
const defaultlocation: Location = { lat: defaults.DEFAULT_LAT, lon: defaults.DEFAULT_LON };
const DEV: boolean = defaults.NODE_ENV === 'development';
const port: number = 8080;
const schedule: string = DEV
  ? '15,45 * * * * *'
  : `0,30 * 7,8,9,10,11,12,13,14,15,16 * 1,2,3,4,5,8,9,10,11,12, 1,2,3,4,5`;
let healthy: boolean = true;
let session: Session | null = null;

app.use(express.json());
app.get('/', (req: Request, res: Response) => {
  const now: string = new Date().toISOString();
  let ip: string[] = req.socket.remoteAddress?.split(':') ?? [];
  console.log(`${now}: Healthcheck requested by ${ip[ip.length - 1]}, reporting ${healthy ? 'healthy' : 'unhealthy'}`);
  res.send({ healthy });
});
http.createServer(app).listen(port, () => {
  console.log('HCTB Scraper started');
  console.log(`Healthcheck available on port ${port}`);
  cron.schedule(
    schedule,
    async (ctx: TaskContext) => {
      const runs: number = 0;
      console.info('Bus location task started:', ctx.triggeredAt.toISOString());
      await task(runs);
    },
    { noOverlap: true }
  );
});

async function login(): Promise<void> {
  console.info('  Logging in');
  let browser: Browser | undefined;
  try {
    let launchoptions: LaunchOptions = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (!DEV) launchoptions.executablePath = '/usr/bin/chromium-browser';
    browser = await puppeteer.launch(launchoptions);
    const page: Page = await browser.newPage();
    await page.goto('https://login.herecomesthebus.com/Authenticate.aspx');
    await page.type('#ctl00_ctl00_cphWrapper_cphContent_tbxUserName', defaults.HCTB_USERNAME);
    await page.type('#ctl00_ctl00_cphWrapper_cphContent_tbxPassword', defaults.HCTB_PASSWORD);
    await page.type('#ctl00_ctl00_cphWrapper_cphContent_tbxAccountNumber', defaults.HCTB_SCHOOLCODE);
    await page.click('#ctl00_ctl00_cphWrapper_cphContent_btnAuthenticate');
    await page.waitForNavigation({ waitUntil: 'load' });
    const cookies: Cookie[] = await browser.cookies();
    await browser.close();
    if (cookies?.find((cookie) => cookie.name === '.ASPXFORMSAUTH')) {
      if (DEV) console.debug('--Got session cookie');
      let cookiestring: string = '';
      let children: Child[] = [];
      let time: Time | undefined;
      for (const cookie of cookies) { cookiestring += `${cookie.name}=${cookie.value}; `; }
      await fetch('https://login.herecomesthebus.com/Map.aspx', {
        headers: { cookie: cookiestring },
        method: 'GET',
      })
      .then((res: FetchResponse) => {
        if (res?.ok) {
          return res.text();
        } else {
          throw new Error(res?.status?.toString());
        };
      })
      .then((text: string) => {
        if (text) {
          if (DEV) console.debug('--Fetched Map page');
          const $ = cheerio.load(text);
          for (const option of $('#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectPassenger option')) {
            const child: Child = { name: $(option).text(), id: $(option).val() as string, active: true };
            if (DEV) console.debug(`--Found child - Name: ${child.name}, ID: ${child.id}`);
            children?.push(child);
          }
          const timeoption = $('#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectTimeOfDay option[selected="selected"]');
          time = { label: timeoption.text(), id: timeoption.val() as string };
          if (DEV) console.debug(`--Found time - Label: ${time.label}, ID: ${time.id}`);
          return text;
        } else {
          throw new Error('Failed to fetch Map page');
        };
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
    await fetch('https://login.herecomesthebus.com/Map.aspx/RefreshMap', {
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        cookie: session?.cookiestring ?? '',
      },
      body: JSON.stringify({
        legacyID: child.id,
        name: child.name,
        timeSpanId: session?.time.id ?? '',
        wait: 'true',
      }),
      method: 'POST',
    })
      .then((res: FetchResponse) => {
        if (res?.ok) {
          return res.json();
        } else if (res?.status === 401) {
          console.info('  Session expired');
          session = null;
        } else {
          throw new Error(res?.status?.toString());
        }
      })
      .then((json: any) => {
        if (json && json.d) {
          const commandstring: string = json.d;
          let scrapelocation: Location | undefined;
          console.log('--JSON Dump:', commandstring);
          if (commandstring.includes('No stops found for student')) {
            child.active = false;
            if (DEV) console.debug(`--Scrape found bus not running`);
          }
          if (commandstring === 'ClearStaticLayer();\r\nClearDynamicLayer();\r\n') {
            if (DEV) console.debug(`--Scrape found nothing`);
          }
          if (commandstring.includes('SetBusPushPin')) {
            const match: RegExpMatchArray | null = commandstring.match(/SetBusPushPin\(([-]?\d+\.?\d*),\s*([-]?\d+\.?\d*)/);
            if (match && match[1] && match[2]) {
              scrapelocation = { lat: match[1], lon: match[2] };
              if (DEV) console.debug(`--Scrape found location - Latitude: ${scrapelocation.lat}, Longitude: ${scrapelocation.lon}`);
            }
          }
          if (!scrapelocation) {
            scrapelocation = defaultlocation;
            if (DEV) console.debug(`--Scrape using default location - Latitude: ${scrapelocation.lat}, Longitude: ${scrapelocation.lon}`);
          }
          location = scrapelocation;
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
        if (res?.ok) return console.info(`Bus location sent to HomeAssistant device '${device}'`);
        return res;
      });
    } else {
      throw new Error('Device ID or Location could not be resolved');
    }
  } catch (error) {
    console.error('Sync Error:', error);
  }
}

async function task(runs = 0): Promise<void> {
  let location: Location | undefined;
  let relog: boolean = false;
  if (!session) await login();
  for (const child of session?.children || []) {
    if (child.active) {
      location = await scrape(child);
    } else {
      location = defaultlocation;
      if (DEV) console.debug(`--Using default location - Latitude: ${location.lat}, Longitude: ${location.lon}`);
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
  if (runs === 1) await task();
}
