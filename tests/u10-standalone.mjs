import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const html = await readFile(new URL('../index.html', import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], requests = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url())); await page.route('**/*', route => route.abort());
  await page.setContent(html.toString(), { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 180000 });
  await page.getByRole('button', { name: 'Start U10', exact: true }).click();
  const before = await page.evaluate(() => metro.snapshot()); assert.equal(before.activeLineId, 'U10'); assert.equal(before.trainCount, 8); assert.equal(before.stationCount, 53); assert.equal(before.currentStation, 'Central');
  assert(Math.abs(before.position[1] + 70.24) < 1e-8);
  await page.keyboard.down('w'); await page.waitForFunction(() => metro.player.distanceTravelled > 0.2, undefined, { timeout: 60000 }); await page.keyboard.up('w');
  const after = await page.evaluate(() => metro.snapshot()); assert.notDeepEqual(after.position, before.position);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  assert.deepEqual((await page.evaluate(() => metro.snapshot())).position, before.position);
  await page.getByRole('button', { name: 'U10 journey times', exact: true }).click();
  assert.equal(await page.locator('.timing-segment').count(), 18);
  await page.locator('#close-help').click(); await page.screenshot({ path: '/tmp/metro-u10-standalone.png', timeout: 180000 });
  const report = { sha256: createHash('sha256').update(html).digest('hex'), bytes: html.length, blockedAllExternalRequests: true,
    requests, errors, network: { lines: after.trainCount, stations: after.stationCount }, u10Selectable: true, keyboardMovement: true, reset: true,
    segmentTimingRows: 18, glError: await page.evaluate(() => metro.world.renderer.getContext().getError()) };
  await writeFile('/tmp/metro-u10-standalone.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(requests, []); assert.deepEqual(errors, []); assert.equal(report.glError, 0);
} finally { await browser.close(); }
