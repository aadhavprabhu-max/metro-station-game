import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// This opens the production bundle and follows the normal RAF simulation. All
// boarding, alighting, and looking use browser input; train state and timing are
// never advanced, repositioned, or changed by this inspection.
const url = process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/';
const output = process.env.METRO_NETWORK_OUTPUT || process.env.METRO_JOURNEY_OUTPUT || '/tmp/metro-u1-network';
const viewport = {
  width: Number(process.env.METRO_VIEWPORT_WIDTH || 800),
  height: Number(process.env.METRO_VIEWPORT_HEIGHT || 500),
};
await mkdir(output, { recursive: true });
const args = ['--no-sandbox', '--disable-dev-shm-usage'];
if (process.env.SOFTWARE_WEBGL) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args });
const page = await browser.newPage({ viewport });
const begun = Date.now();
const errors = [], warnings = [], failedRequests = [], captures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning') warnings.push(message.text());
});
page.on('requestfailed', request => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });

async function wait(predicate, arg = null, timeout = 600000) {
  await page.waitForFunction(predicate, arg, { polling: 100, timeout });
  assert.deepEqual(errors, [], 'Browser runtime errors while riding U1.');
}

async function dragYaw(change) {
  await page.mouse.move(200, 250);
  await page.mouse.down();
  await page.mouse.move(200 - change / 0.0028, 250, { steps: 8 });
  await page.mouse.up();
}

async function sample() {
  return page.evaluate(() => {
    const { world, player } = window.metro;
    const scratch = document.createElement('canvas'); scratch.width = scratch.height = 32;
    const ctx = scratch.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    const colors = new Set();
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) colored++;
      colors.add(`${pixels[i] >> 3},${pixels[i + 1] >> 3},${pixels[i + 2] >> 3}`);
    }
    return {
      runtime: window.metro.snapshot(), service: world.service.snapshot(),
      trainPosition: world.train.position.toArray(),
      carOffsets: world.train.cars.map(car => car.position.toArray()),
      doors: world.train.cars.map(car => ({ ...car.doorProgressBySide })),
      displays: world.train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => display.userData.destination)),
      station: player.station.stationId, riding: Boolean(player.ridingCar),
      riderCar: player.ridingCar?.carNumber, offset: player.ridingOffset.toArray(),
      timetables: world.stations.map(station => ({
        stationId: station.stationId, stationName: station.displayName,
        rows: station.departures.departures.map(row => ({ ...row })),
      })),
      hint: player.interactionHint(),
      hud: {
        location: document.querySelector('#location-name')?.textContent,
        status: document.querySelector('#train-status')?.textContent,
        detail: document.querySelector('#service-detail')?.textContent,
        destination: document.querySelector('.service-main strong')?.textContent,
        nextStop: document.querySelector('#service-next-stop')?.textContent,
        direction: document.querySelector('#location-direction')?.textContent,
      },
      colored, colors: colors.size,
      contextLost: world.renderer.getContext().isContextLost(),
      glError: world.renderer.getContext().getError(), frames: window.metro.frames,
    };
  });
}

async function capture(name) {
  const state = await sample();
  assert.equal(state.contextLost, false);
  assert.equal(state.glError, 0);
  assert(state.colored > 650 && state.colors > 12, `${name}: the canvas became almost empty.`);
  assert.equal(state.runtime.status, 'running');
  assert.equal(state.runtime.carCount, 3);
  assert.equal(state.trainPosition[0], 1.57);
  assert(Math.abs(state.trainPosition[2] + state.service.distance) < 1e-7);
  assert(state.doors.every(door => door[1] === 0), 'Track-side doors opened.');
  if (state.service.speed > 0) assert(state.doors.every(door => door[-1] === 0), 'The moving train has open doors.');
  if (captures.length) assert.deepEqual(state.carOffsets, captures[0].carOffsets);
  await page.screenshot({ path: `${output}/${name}.png` });
  const result = { name, elapsedSeconds: (Date.now() - begun) / 1000, ...state };
  captures.push(result);
  console.log(JSON.stringify({
    captured: name, elapsedSeconds: result.elapsedSeconds,
    state: state.service.state, distance: state.service.distance, speed: state.service.speed,
    currentStop: state.service.currentStop.name, nextStop: state.service.nextStop.name,
    destination: state.service.destinationStop.name, direction: state.service.directionName,
    riding: state.riding, colored: state.colored,
  }));
  return state;
}

const legs = [
  { name: 'central-northbound', from: 0, to: 240, stopId: 'station-2', terminal: 'Rosenheimer Platz', direction: 1 },
  { name: 'rosenheimer-terminus', from: 240, to: 480, stopId: 'station-3', terminal: 'Nordplatz', direction: -1 },
  { name: 'central-southbound', from: 480, to: 240, stopId: 'station-2', terminal: 'Nordplatz', direction: -1 },
  { name: 'nordplatz-terminus', from: 240, to: 0, stopId: 'station-1', terminal: 'Rosenheimer Platz', direction: 1 },
];

try {
  console.log(`Opening U1 production network at ${url} (${viewport.width}×${viewport.height}).`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(() => window.metro?.ready && window.metro.world.service.nextStop, null, 120000);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
  const initial = await capture('01-nordplatz-spawn');
  assert.equal(initial.service.distance, 0);
  assert.equal(initial.service.state, 'boarding');
  assert.equal(initial.service.destinationStop.name, 'Rosenheimer Platz');
  assert.equal(initial.service.nextStop.name, 'Central');

  await page.keyboard.down('w');
  try { await wait(() => window.metro.player.interactionHint().enabled, null, 180000); }
  finally { await page.keyboard.up('w'); }
  await page.keyboard.press('e');
  await wait(() => Boolean(window.metro.player.ridingCar), null, 30000);
  const boardedCar = await page.evaluate(() => window.metro.player.ridingCar.carNumber);
  await dragYaw(-1.96);
  await capture('02-boarded-nordplatz');

  for (const [index, leg] of legs.entries()) {
    const number = index + 1;
    await wait(index => {
      const service = window.metro.world.service;
      return service.completedLegs === index && service.state === 'departing' && service.speed === 0;
    }, index);
    const closed = await capture(`${number}-a-${leg.name}-doors-closed`);
    assert(closed.doors.every(door => door[-1] === 0));
    await wait(({ index, from }) => {
      const service = window.metro.world.service;
      const travelled = Math.abs(service.distance - from);
      return service.completedLegs === index && travelled > 8 && travelled < 35;
    }, { index, from: leg.from });
    await capture(`${number}-b-${leg.name}-visible-departure`);
    await wait(({ index, from, to }) => {
      const service = window.metro.world.service;
      const travelled = Math.abs(service.distance - from);
      return service.completedLegs === index && travelled > Math.abs(to - from) * 0.42 && travelled < Math.abs(to - from) * 0.72;
    }, { index, from: leg.from, to: leg.to });
    const moving = await capture(`${number}-c-${leg.name}-tunnel`);
    assert(moving.service.speed > 0);
    assert.equal(moving.riderCar, boardedCar);
    await wait(({ index, to }) => {
      const service = window.metro.world.service;
      return service.completedLegs === index && service.state === 'arriving' && Math.abs(service.distance - to) < 30;
    }, { index, to: leg.to });
    await capture(`${number}-d-${leg.name}-arriving`);
    await wait(({ number, stopId }) => {
      const { service, train } = window.metro.world;
      return service.completedLegs === number && service.currentStop.id === stopId
        && service.state === 'boarding' && train.cars.every(car => car.doorProgress > 0.99);
    }, { number, stopId: leg.stopId });
    const stopped = await capture(`${number}-e-${leg.name}-stopped-open`);
    assert.equal(stopped.service.distance, leg.to);
    assert.equal(stopped.service.speed, 0);
    assert.equal(stopped.service.direction, leg.direction);
    assert.equal(stopped.service.destinationStop.name, leg.terminal);
    assert(stopped.displays.every(destination => destination === leg.terminal));
    assert.equal(stopped.riderCar, boardedCar);
    assert.equal(stopped.hud.destination, leg.terminal);
    assert.equal(stopped.hud.nextStop, `Next stop · ${stopped.service.nextStop.name}`);
    assert.equal(stopped.hud.direction, stopped.service.directionName);

    await page.keyboard.press('e');
    await wait(stopId => !window.metro.player.ridingCar && window.metro.player.station.stationId === stopId, leg.stopId, 30000);
    await dragYaw(Math.PI);
    const platform = await capture(`${number}-f-${leg.name}-platform`);
    const stationRows = platform.timetables.find(board => board.stationId === leg.stopId).rows.filter(row => row.route === 'U1');
    assert.equal(stationRows.length, leg.stopId === 'station-2' ? 2 : 1);
    assert.equal(platform.riding, false);
    if (index === legs.length - 1) {
      await page.getByRole('button', { name: 'Reset view' }).click();
      const returned = await capture('03-nordplatz-round-trip-complete');
      assert.deepEqual(returned.runtime.position, [-6.6, 1.76, -31.5]);
      assert.equal(returned.service.completedLegs, 4);
    } else {
      await page.locator('#interact-button').waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('#interact-button').click();
      await wait(() => Boolean(window.metro.player.ridingCar), null, 30000);
      await dragYaw(-Math.PI);
      assert.equal(await page.evaluate(() => window.metro.player.ridingCar.carNumber), boardedCar);
    }
  }
  assert(captures.at(-1).frames > captures[0].frames + 300);

  // Preserve the platform observer experience as well as the full riding test.
  // Reload normally, remain at spawn, and watch the next automatic departure.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(() => window.metro?.ready && window.metro.world.service.nextStop, null, 120000);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
  await capture('04-platform-watcher-spawn');
  await wait(() => window.metro.world.service.distance > 8 && window.metro.world.service.distance < 35);
  const watching = await capture('05-platform-watching-departure');
  assert.equal(watching.riding, false);
  assert.deepEqual(watching.runtime.position, [-6.6, 1.76, -31.5]);
  assert(watching.trainPosition[2] < -8);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await writeFile(`${output}/network-diagnostics.json`, JSON.stringify({ url, viewport, errors, warnings, failedRequests, captures }, null, 2));
  console.log(`Normal-speed U1 round trip and boarding at all three stations verified. Screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/network-diagnostics.json`, JSON.stringify({ url, viewport, errors, warnings, failedRequests, captures, failure: error.message, state: await sample().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
