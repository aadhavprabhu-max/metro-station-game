import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(process.env.METRO_URL || 'http://127.0.0.1:5173');
await page.waitForFunction(() => window.metro?.ready, { timeout: 30000 });
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => window.metro.snapshot()), null, 2));
await page.screenshot({ path: process.env.METRO_SCREENSHOT || '/tmp/metro-spawn.png' });
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
