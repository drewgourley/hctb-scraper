import { parse, type HTMLElement } from 'node-html-parser';
import cron, { type TaskContext } from 'node-cron';
import fetch, { type Response as FetchResponse } from 'node-fetch';
import { TrueFalseString, type Child, type Config, type Location, type RefreshMapInput, type Session } from './models.js';

const config: Config = process.env as unknown as Config;
const defaultlocation: Location = { default: true, lat: config.DEFAULT_LAT, lon: config.DEFAULT_LON };
const schedule: string = `0,30 * ${config.SCHEDULE}`;
let session: Session | null = null;

console.log(`HCTB Scraper started`);
cron.schedule(schedule, async (ctx: TaskContext) => { await task(ctx); }, { noOverlap: true });

async function login(ctx: TaskContext): Promise<void> {
  try {
    if (session && ctx.triggeredAt.getTime() > session.expires.getTime()) {
      console.info('  Session expired');
      session = null;
    } 
    if (!session) {
      console.info('  Logging in');
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
          const root: HTMLElement = parse(text);
          viewstate = root.querySelector('#__VIEWSTATE')?.attributes.value ?? '';
          viewstategenerator = root.querySelector('#__VIEWSTATEGENERATOR')?.attributes.value ?? '';
          eventvalidation = root.querySelector('#__EVENTVALIDATION')?.attributes.value ?? '';
          return text;
        }
        throw new Error('Failed to fetch Form page');
      });
      const form: FormData = new FormData();
      form.append('__VIEWSTATE', viewstate);
      form.append('__VIEWSTATEGENERATOR', viewstategenerator);
      form.append('__EVENTVALIDATION', eventvalidation);
      form.append('ctl00$ctl00$cphWrapper$cphContent$tbxUserName', config.HCTB_USERNAME);
      form.append('ctl00$ctl00$cphWrapper$cphContent$tbxPassword', config.HCTB_PASSWORD);
      form.append('ctl00$ctl00$cphWrapper$cphContent$tbxAccountNumber', config.HCTB_SCHOOLCODE);
      form.append('ctl00$ctl00$cphWrapper$cphContent$btnAuthenticate', 'Log In');
      await fetch('https://login.herecomesthebus.com/authenticate.aspx', {
        redirect: 'manual',
        headers: { cookie: cookiestring, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form as unknown as Record<string, string>).toString(),
        method: 'POST',
      })
      .then((res: FetchResponse) => {
        if (res.status === 302) {
          const setcookie: string[] = res.headers.raw()['set-cookie'] ?? [];
          cookiestring += `; ${setcookie.map(cookie => cookie.split(';')[0]).join('; ')}`;
          return res;
        }
        throw new Error('Failed to post Form');
      });
      if (cookiestring.includes('.ASPXFORMSAUTH')) {
        let children: Child[] = [];
        let time: string | undefined;
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
            const root: HTMLElement = parse(text);
            const options: HTMLElement[] = root.querySelectorAll('#ctl00_ctl00_cphWrapper_cphControlPanel_ddlSelectPassenger option');
            for (const option of options) {
              const child: Child = {
                name: option.innerText,
                id: option.attributes.value!,
                active: true,
                current: defaultlocation,
                previous: defaultlocation,
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
          session = { cookiestring, children, time, expires: new Date(new Date().getTime() + (19*60*1000)) };
          console.info('  Session started');
        } else {
          throw new Error('Failed to establish session');
        }
      } else {
        throw new Error('Failed to log in');
      }
    }
  } catch (error) {
    console.error('Login error:', error);
  }
}

async function scrape(child: Child): Promise<void> {
  try {
    child.previous = child.current;
    if (child.active) {
      console.info(`  Scraping data for ${child.name}`);
      const input: RefreshMapInput = { legacyID: child.id, name: child.name, timeSpanId: session?.time, wait: TrueFalseString.True };
      await fetch('https://login.herecomesthebus.com/map.aspx/refreshmap', {
        headers: { cookie: session?.cookiestring ?? '', 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(input),
        method: 'POST',
      })
      .then((res: FetchResponse) => {
        if (res?.ok) return res.json();
        if (res?.status === 403) session = null;
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
              child.current = { default: false, lat: match[1], lon: match[2] };
            }
          }
        }
        return json;
      });
    } else {
      console.info(`  Skipping scrape for ${child.name}`);
      child.current = defaultlocation;
    }
  } catch (error) {
    console.error('Scrape error:', error);
  }
}

async function sync(child: Child): Promise<void> {
  try {
    if (session && (child.previous.lat !== child.current.lat && child.previous.lon !== child.current.lon)) {
      console.info(`  Syncing location for ${child.name}`);
      const firstname: string | undefined = child.name.split(' ')[0]?.toLowerCase();
      if (firstname && child.current) {
        const device: string = `${firstname}_bus`;
        await fetch(`${config.SUPERVISOR_URI}/api/services/device_tracker/see`, {
          headers: {
            Authorization: `Bearer ${config.SUPERVISOR_TOKEN}`,
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
    } else {
      console.info(`Bus location did not change for ${child.name}`);
    }
  } catch (error) {
    console.error('Sync Error:', error);
  }
}

async function task(ctx: TaskContext): Promise<void> {
  console.info('Bus location task started:', ctx.triggeredAt.toISOString());
  await login(ctx);
  for (const child of session?.children || []) {
    await scrape(child);
    await sync(child);
  }
}
