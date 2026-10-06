import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Production-browser evidence, captured during the real RAF journey. No train
// state, simulation clock, route distance, or service timing is advanced here.
const url = process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/';
const output = process.env.METRO_JOURNEY_OUTPUT || '/tmp/metro-journey';
await mkdir(output, { recursive: true });
const args = ['--no-sandbox', '--disable-dev-shm-usage'];
if (process.env.SOFTWARE_WEBGL) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [], warnings = [], failedRequests = [], captures = [];
const begun = Date.now();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning') warnings.push(message.text());
});
page.on('requestfailed', request => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });

async function sample() {
  return page.evaluate(() => {
    const { world, player } = window.metro;
    const scratch = document.createElement('canvas'); scratch.width = scratch.height = 32;
    const ctx = scratch.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) colored++;
    return {
      runtime: window.metro.snapshot(), state: world.service.state,
      distance: world.service.distance, speed: world.service.speed,
      trainPosition: world.train.position.toArray(),
      carOffsets: world.train.cars.map(car => car.position.toArray()),
      doorProgress: world.train.cars.map(car => car.doorProgress),
      station: player.station.stationId, riding: Boolean(player.ridingCar),
      riderCar: player.ridingCar?.carNumber, offset: player.ridingOffset?.toArray(),
      colored, contextLost: world.renderer.getContext().isContextLost(),
      glError: world.renderer.getContext().getError(), frames: window.metro.frames,
    };
  });
}

async function capture(name) {
  const state = await sample();
  assert.equal(state.contextLost, false);
  assert.equal(state.glError, 0);
  assert(state.colored > 650, `${name}: visible frame became almost empty (${state.colored}/1024 colored).`);
  assert.equal(state.runtime.carCount, 3);
  assert.equal(state.runtime.status, 'running');
  await page.screenshot({ path: `${output}/${name}.png` });
  const result = { name, elapsedSeconds: (Date.now() - begun) / 1000, ...state };
  captures.push(result);
  console.log(JSON.stringify({ captured: name, elapsedSeconds: result.elapsedSeconds, state: state.state, distance: state.distance, speed: state.speed, riding: state.riding, colored: state.colored }));
}

async function wait(predicate, timeout = 300000) {
  await page.waitForFunction(predicate, null, { polling: 100, timeout });
  assert.deepEqual(errors, [], 'Browser runtime errors during the journey.');
}

async function dragYaw(change) {
  // Start in clear canvas space; pointer capture keeps a long drag active even
  // when its destination passes the viewport edge.
  await page.mouse.move(250, 300);
  await page.mouse.down();
  await page.mouse.move(250 - change / 0.0028, 300, { steps: 8 });
  await page.mouse.up();
}

try {
  console.log(`Opening production journey: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(() => window.metro?.ready && window.metro.world.service, 60000);
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await capture('01-nordplatz-spawn');
  assert.equal(captures[0].distance, 0);
  assert.equal(captures[0].state, 'boarding');

  // Follow the real starting camera direction to an open platform-side door.
  await page.keyboard.down('w');
  try { await wait(() => window.metro.player.interactionHint().enabled, 120000); }
  finally { await page.keyboard.up('w'); }
  await capture('02-platform-open-door');
  await page.keyboard.press('e');
  await wait(() => Boolean(window.metro.player.ridingCar), 10000);
  const boardedCar = await page.evaluate(() => window.metro.player.ridingCar.carNumber);
  // Real drag input turns the rider toward the platform-facing side windows.
  await dragYaw(-1.96);
  await capture('03-boarded-nordplatz');

  await wait(() => window.metro.world.service.state === 'departing' && window.metro.world.service.speed === 0);
  await capture('04-doors-closed-before-departure');
  assert(captures.at(-1).doorProgress.every(value => value < 0.002));
  await wait(() => window.metro.world.service.distance > 15 && window.metro.world.service.distance < 50);
  await capture('05-visible-departure');
  await wait(() => window.metro.world.service.distance > 100 && window.metro.world.service.distance < 160);
  await capture('06-connecting-tunnel');
  await wait(() => window.metro.world.service.state === 'arriving' && window.metro.world.service.distance > 210);
  await capture('07-central-arrival');
  await wait(() => window.metro.world.service.distance === 240 && window.metro.world.service.state === 'boarding' && window.metro.world.train.cars.every(car => car.doorProgress > 0.99));
  await capture('08-central-stopped-doors-open');
  assert.equal(captures.at(-1).speed, 0);
  assert.equal(captures.at(-1).riderCar, boardedCar);
  await page.keyboard.press('e');
  await wait(() => !window.metro.player.ridingCar && window.metro.player.station.stationId === 'station-2', 10000);
  // Look back toward the train with real pointer input after stepping off.
  await dragYaw(Math.PI);
  await capture('09-central-platform');
  await page.locator('#interact-button').click();
  await wait(() => Boolean(window.metro.player.ridingCar), 10000);
  await dragYaw(-Math.PI);
  await wait(() => window.metro.world.service.distance < 200 && window.metro.world.service.distance > 130);
  await capture('10-return-journey');
  await wait(() => window.metro.world.service.distance === 0 && window.metro.world.service.state === 'boarding' && window.metro.world.train.cars.every(car => car.doorProgress > 0.99));
  await page.keyboard.press('e');
  await wait(() => !window.metro.player.ridingCar && window.metro.player.station.stationId === 'station-1', 10000);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await capture('11-nordplatz-returned');
  assert.equal(captures.at(-1).speed, 0);
  assert.deepEqual(captures.at(-1).runtime.position, [-6.6, 1.76, -31.5]);
  assert(captures.at(-1).frames > captures[0].frames + 200);

  // Also validate the original platform-only experience in a fresh, normal run.
  // The passenger stays at the exact spawn while the train visibly departs.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(() => window.metro?.ready && window.metro.world.service, 60000);
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await capture('12-platform-watcher-spawn');
  await wait(() => window.metro.world.service.distance > 8 && window.metro.world.service.distance < 35);
  await capture('13-platform-watching-departure');
  assert.equal(captures.at(-1).riding, false);
  assert.deepEqual(captures.at(-1).runtime.position, [-6.6, 1.76, -31.5]);
  assert(captures.at(-1).trainPosition[2] < -8);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await writeFile(`${output}/journey-diagnostics.json`, JSON.stringify({ url, errors, warnings, failedRequests, captures }, null, 2));
  console.log(`Real-time outbound and return journey verified; screenshots in ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/journey-diagnostics.json`, JSON.stringify({ url, errors, warnings, failedRequests, captures, failure: error.message, state: await sample().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
