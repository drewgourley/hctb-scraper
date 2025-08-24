import dotenv from 'dotenv';
import express, { type Request, type Response, type Express } from 'express';
import fetch from 'node-fetch';
import http from 'http';
import puppeteer, { Browser, type Cookie, type LaunchOptions, Page } from 'puppeteer';
import cron, { type TaskContext } from 'node-cron';
import type { Child, Defaults, Location, Session, Time } from './models.ts';

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
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    const cookies: Cookie[] = await browser.cookies();
    if (cookies?.find((cookie) => cookie.name === '.ASPXFORMSAUTH')) {
      if (DEV) console.debug('--Got session cookie');
      let cookiestring: string = '';
      for (const cookie of cookies) { cookiestring += `${cookie.name}=${cookie.value}; `; };
      const children: Child[] = await page.$$eval(
        '#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectPassenger option',
        (options: HTMLOptionElement[]): Child[] => {
          return options.map((option: HTMLOptionElement): Child => {
            return { name: option.innerHTML, id: option.value, active: true };
          });
        }
      );
      const time: Time = await page.$eval(
        '#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectTimeOfDay option[selected="selected"]',
        (option: HTMLOptionElement): Time => {
          return { label: option.innerHTML, id: option.value };
        }
      );
      if (children && time) {
        if (DEV) {
          for (const child of children) {
            console.debug(`--Found child - Name: ${child.name}, ID: ${child.id}`);
          }
          console.debug(`--Found time - Label: ${time.label}, ID: ${time.id}`);
        }
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
        accept: 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
        'content-type': 'application/json; charset=UTF-8',
        'sec-ch-ua':
          '"Chromium";v="104", " Not A;Brand";v="99", "Google Chrome";v="104"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-requested-with': 'XMLHttpRequest',
        cookie: session?.cookiestring ?? '',
        Referer: 'https://login.herecomesthebus.com/Map.aspx',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
      body: JSON.stringify({
        legacyID: child.id,
        name: child.name,
        timeSpanId: session?.time.id ?? '',
        wait: 'true',
      }),
      method: 'POST',
    })
      .then((res) => {
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
