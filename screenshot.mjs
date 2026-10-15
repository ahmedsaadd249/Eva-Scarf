// Usage: node screenshot.mjs <url> [label] [--width=430] [--height=932] [--viewport] [--login=email:password]
// Saves to "./temporary screenshots/screenshot-N[-label].png" (auto-incremented, never overwritten).
// Full page by default; --viewport captures only the first screen.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const [url = 'http://localhost:3000', label] = args.filter((a) => !a.startsWith('--'));

const outDir = path.resolve('temporary screenshots');
fs.mkdirSync(outDir, { recursive: true });
const used = fs.readdirSync(outDir).map((f) => Number(/^screenshot-(\d+)/.exec(f)?.[1] || 0));
const n = Math.max(0, ...used) + 1;
const file = path.join(outDir, `screenshot-${n}${label ? `-${label}` : ''}.png`);

const systemChrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

let browser;
try {
  browser = await puppeteer.launch({ headless: true });
} catch {
  browser = await puppeteer.launch({ headless: true, executablePath: systemChrome });
}

const page = await browser.newPage();
const width = Number(flags.width || 430);
await page.setViewport({ width, height: Number(flags.height || (width < 768 ? 932 : 900)), deviceScaleFactor: 1 });

if (flags.login) {
  const [email, password] = String(flags.login).split(':');
  const origin = new URL(url).origin;
  await page.goto(`${origin}/account/login`, { waitUntil: 'networkidle0' });
  await page.type('#f-email', email);
  await page.type('#f-password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form[action="/account/login"] button:not([type=button])')]);
}

await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
if (!flags.viewport) {
  // Scroll through so lazy-loaded images load before the full-page capture.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
}
await new Promise((r) => setTimeout(r, 2200)); // let the entrance animation settle
await page.screenshot({ path: file, fullPage: !flags.viewport });
await browser.close();
console.log(file);
