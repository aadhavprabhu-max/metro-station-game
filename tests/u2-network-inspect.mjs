import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Normal RAF production inspection. This script never advances simulation time
// or assigns player/train positions. Walking, boarding, looking and the Central
// transfer use actual keyboard, pointer and UI input.
const baseUrl = process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/';
const output = process.env.METRO_U2_OUTPUT || '/tmp/metro-u2-network';
const viewport = { width: Number(process.env.METRO_VIEWPORT_WIDTH || 640), height: Number(process.env.METRO_VIEWPORT_HEIGHT || 400) };
const urlFor = lineId => { const url = new URL(baseUrl); url.searchParams.set('line', lineId); return url.href; };
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
  assert.deepEqual(errors, [], 'Browser errors during the U2 production inspection.');
}

async function lookYaw(target) {
  const current = await page.evaluate(() => window.metro.player.yaw);
  const change = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  await page.mouse.move(200, 230);
  await page.mouse.down();
  await page.mouse.move(200 - change / 0.0028, 230, { steps: 8 });
  await page.mouse.up();
}

async function walkTo(x, z) {
  const position = await page.evaluate(() => window.metro.player.camera.position.toArray());
  await lookYaw(Math.atan2(-(x - position[0]), -(z - position[2])));
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  try {
    await wait(({ x, z }) => {
      const position = window.metro.player.camera.position;
      return Math.hypot(position.x - x, position.z - z) < 0.6;
    }, { x, z }, 180000);
  } finally {
    await page.keyboard.up('w');
    await page.keyboard.up('Shift');
  }
}

async function sample() {
  return page.evaluate(() => {
    const { world, player } = window.metro;
    const service = player.service;
    const train = service.train;
    const expected = service.route.sample(service.distance);
    const scratch = document.createElement('canvas'); scratch.width = scratch.height = 32;
    const ctx = scratch.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let colored = 0; const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] && pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) colored++;
      colors.add(`${pixels[index] >> 3},${pixels[index + 1] >> 3},${pixels[index + 2] >> 3}`);
    }
    return {
      runtime: window.metro.snapshot(), activeService: service.snapshot(),
      services: world.services.map(item => item.snapshot()),
      trainPosition: train.position.toArray(), railError: train.position.distanceTo(expected.position),
      trainAccent: train.materials.trainAccent.color.getHexString(),
      u1Accent: world.train.materials.trainAccent.color.getHexString(),
      accentRed: train.materials.trainAccent.color.r > train.materials.trainAccent.color.g && train.materials.trainAccent.color.r > train.materials.trainAccent.color.b,
      carOffsets: train.cars.map(car => car.position.toArray()),
      doors: train.cars.map(car => ({ ...car.doorProgressBySide })),
      displays: train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => ({ lineId: display.userData.lineId, destination: display.userData.destination }))),
      platform: player.station.platformId, stationId: player.station.stationId, physicalLine: player.station.lineId,
      riding: Boolean(player.ridingCar), riderCar: player.ridingCar?.carNumber,
      riderLine: player.ridingCar?.lineId,
      riderTransformError: player.ridingCar ? train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset) : null,
      hint: player.interactionHint(),
      boards: world.stations.map(station => ({ platformId: station.platformId, stationId: station.stationId, lineId: station.lineId, rows: station.departures.departures.map(row => ({ ...row })) })),
      hud: {
        line: document.querySelector('#location-line')?.textContent,
        label: document.querySelector('#service-label')?.textContent,
        location: document.querySelector('#location-name')?.textContent,
        destination: document.querySelector('.service-main strong')?.textContent,
        nextStop: document.querySelector('#service-next-stop')?.textContent,
        direction: document.querySelector('#location-direction')?.textContent,
        status: document.querySelector('#train-status')?.textContent,
      },
      colored, colors: colors.size, frames: window.metro.frames,
      glError: world.renderer.getContext().getError(), contextLost: world.renderer.getContext().isContextLost(),
    };
  });
}

async function capture(name) {
  const state = await sample();
  assert.equal(state.glError, 0);
  assert.equal(state.contextLost, false);
  assert.equal(state.runtime.status, 'running');
  assert(state.colored > 650 && state.colors > 12, `${name}: almost empty canvas.`);
  assert(state.railError < 1e-7);
  assert.equal(state.carOffsets.length, 3);
  assert.equal(state.u1Accent, '316c65');
  if (state.activeService.lineId === 'U2') assert(state.accentRed, 'U2 lost its red train livery.');
  const platformSide = state.activeService.platformSide;
  assert(state.doors.every(door => door[-platformSide] === 0), 'Opposite-side doors opened.');
  if (state.activeService.speed > 0) assert(state.doors.every(door => door[platformSide] === 0), 'Moving train doors opened.');
  if (state.riding) {
    assert.equal(state.riderLine, state.activeService.lineId);
    assert(state.riderTransformError < 1e-7);
  }
  await page.screenshot({ path: `${output}/${name}.png` });
  captures.push({ name, elapsedSeconds: (Date.now() - begun) / 1000, ...state });
  console.log(JSON.stringify({ captured: name, elapsedSeconds: captures.at(-1).elapsedSeconds, line: state.activeService.lineId, state: state.activeService.state, distance: state.activeService.distance, station: state.activeService.currentStop.name, next: state.activeService.nextStop.name, terminal: state.activeService.destinationStop.name, riding: state.riding, colored: state.colored }));
  return state;
}

async function open(lineId) {
  await page.goto(urlFor(lineId), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(lineId => window.metro?.ready && window.metro.world.services?.length >= 2 && window.metro.player.service.lineId === lineId, lineId, 120000);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
}

async function approachAndBoard(lineId) {
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  try { await wait(lineId => window.metro.player.service.lineId === lineId && window.metro.player.interactionHint().enabled, lineId, 180000); }
  finally { await page.keyboard.up('w'); await page.keyboard.up('Shift'); }
  await page.keyboard.press('e');
  await wait(lineId => Boolean(window.metro.player.ridingCar) && window.metro.player.service.lineId === lineId, lineId, 30000);
}

const legs = [
  { name: 'central-outbound', from: 0, to: 240, id: 'station-2', direction: 1, terminal: 'u2-eisenwerk' },
  { name: 'schwarzkopf-outbound', from: 240, to: 480, id: 'u2-schwarzkopf', direction: 1, terminal: 'u2-eisenwerk' },
  { name: 'eisenwerk-terminus', from: 480, to: 720, id: 'u2-eisenwerk', direction: -1, terminal: 'u2-stadtzentrum' },
  { name: 'schwarzkopf-inbound', from: 720, to: 480, id: 'u2-schwarzkopf', direction: -1, terminal: 'u2-stadtzentrum' },
  { name: 'central-inbound', from: 480, to: 240, id: 'station-2', direction: -1, terminal: 'u2-stadtzentrum' },
  { name: 'stadtzentrum-terminus', from: 240, to: 0, id: 'u2-stadtzentrum', direction: 1, terminal: 'u2-eisenwerk' },
];

try {
  console.log(`Opening normal-speed U2 production journey: ${urlFor('U2')}`);
  await open('U2');
  const spawn = await capture('01-stadtzentrum-spawn');
  assert.equal(spawn.activeService.distance, 0);
  assert.equal(spawn.activeService.state, 'boarding');
  assert.equal(spawn.activeService.nextStop.id, 'station-2');
  assert.equal(spawn.activeService.destinationStop.id, 'u2-eisenwerk');
  await approachAndBoard('U2');
  const boardedCar = await page.evaluate(() => window.metro.player.ridingCar.carNumber);
  await lookYaw(-Math.PI / 2); // U2's platform is on the train's right.
  await capture('02-boarded-u2');

  for (const [index, leg] of legs.entries()) {
    const number = index + 1;
    await wait(index => { const service = window.metro.player.service; return service.completedLegs === index && service.state === 'departing' && service.speed === 0; }, index);
    const closed = await capture(`${number}-a-${leg.name}-closed-before-departure`);
    assert(closed.doors.every(door => door[1] === 0));
    assert.equal(closed.activeService.reversalPending, false);
    await wait(({ index, from }) => { const service = window.metro.player.service; const travelled = Math.abs(service.distance - from); return service.completedLegs === index && travelled > 8 && travelled < 35; }, { index, from: leg.from });
    await capture(`${number}-b-${leg.name}-visible-departure`);
    await wait(({ index, from }) => { const service = window.metro.player.service; const travelled = Math.abs(service.distance - from); return service.completedLegs === index && travelled > 100 && travelled < 170; }, { index, from: leg.from });
    const tunnel = await capture(`${number}-c-${leg.name}-tunnel`);
    assert.equal(tunnel.riderCar, boardedCar);
    await wait(({ index, to }) => { const service = window.metro.player.service; return service.completedLegs === index && service.state === 'arriving' && Math.abs(service.distance - to) < 30; }, { index, to: leg.to });
    await capture(`${number}-d-${leg.name}-arrival`);
    await wait(({ number, id }) => { const { player } = window.metro; const service = player.service; return service.completedLegs === number && service.currentStop.id === id && service.state === 'boarding' && service.train.cars.every(car => car.doorProgressBySide[1] > 0.99); }, { number, id: leg.id });
    const stopped = await capture(`${number}-e-${leg.name}-stopped-open`);
    assert.equal(stopped.activeService.distance, leg.to);
    assert.equal(stopped.activeService.speed, 0);
    assert.equal(stopped.activeService.direction, leg.direction);
    assert.equal(stopped.activeService.destinationStop.id, leg.terminal);
    assert(stopped.displays.every(display => display.lineId === 'U2' && display.destination === stopped.activeService.destinationStop.name));
    assert.equal(stopped.riderCar, boardedCar);
    assert.equal(stopped.hud.line, 'U2');
    assert.equal(stopped.hud.destination, stopped.activeService.destinationStop.name);
    assert.equal(stopped.hud.nextStop, `Next stop · ${stopped.activeService.nextStop.name}`);
    assert.equal(stopped.activeService.reversalPending, [2, 5].includes(index));

    await page.keyboard.press('e');
    await wait(id => !window.metro.player.ridingCar && window.metro.player.station.platformId === `${id}:U2`, leg.id, 30000);
    await lookYaw(Math.PI / 2);
    const platform = await capture(`${number}-f-${leg.name}-platform`);
    const rows = platform.boards.find(board => board.platformId === `${leg.id}:U2`).rows.filter(row => row.route === 'U2');
    assert.equal(rows.length, ['u2-eisenwerk', 'u2-stadtzentrum'].includes(leg.id) ? 1 : 2);
    assert.equal(platform.physicalLine, 'U2');
    if (index < legs.length - 1) {
      await page.locator('#interact-button').waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('#interact-button').click();
      await wait(() => Boolean(window.metro.player.ridingCar), null, 30000);
      await lookYaw(-Math.PI / 2);
    }
  }
  const final = await capture('03-u2-six-leg-round-trip-complete');
  assert.equal(final.activeService.completedLegs, 6);
  assert.equal(final.activeService.distance, 0);
  assert(final.services.find(service => service.lineId === 'U1').completedLegs >= 4, 'U1 did not continue while U2 was ridden.');
  assert(final.frames > spawn.frames + 300);

  // A fresh ordinary U1 playthrough demonstrates a physical U1-to-U2 transfer.
  // This is a new page load; both services then run normally throughout it.
  await open('U1');
  await approachAndBoard('U1');
  await lookYaw(Math.PI / 2);
  await wait(() => { const service = window.metro.player.service; return service.currentStop.id === 'station-2' && service.canBoard && service.train.cars.every(car => car.doorProgressBySide[-1] > 0.99); });
  await page.keyboard.press('e');
  await wait(() => !window.metro.player.ridingCar && window.metro.player.station.platformId === 'station-2:U1', null, 30000);
  const currentX = await page.evaluate(() => window.metro.player.camera.position.x);
  await walkTo(currentX, -264);
  await walkTo(-10.5, -264);
  await capture('transfer-a-central-passage');
  await walkTo(-20.3, -264);
  await wait(() => window.metro.player.station.platformId === 'station-2:U2', null, 30000);
  await walkTo(-20.3, -262.5);
  await lookYaw(Math.PI / 2);
  const transferred = await capture('transfer-b-central-u2-platform');
  assert.equal(transferred.riding, false);
  assert.equal(transferred.activeService.lineId, 'U2');
  assert.equal(transferred.hud.line, 'U2');
  const centralRows = transferred.boards.find(board => board.platformId === 'station-2:U2').rows;
  assert.equal(centralRows.length, 4);
  assert.deepEqual(centralRows.map(row => row.route), ['U1', 'U1', 'U2', 'U2']);
  await wait(() => window.metro.player.interactionHint().enabled);
  await page.keyboard.press('e');
  await wait(() => Boolean(window.metro.player.ridingCar) && window.metro.player.service.lineId === 'U2', null, 30000);
  await lookYaw(-Math.PI / 2);
  await capture('transfer-c-boarded-other-line');
  await wait(() => { const service = window.metro.player.service; return service.speed > 2 && Math.abs(service.distance - 240) > 10; });
  await capture('transfer-d-riding-u2-after-walking-transfer');

  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await writeFile(`${output}/u2-diagnostics.json`, JSON.stringify({ mode: 'Normal RAF and real browser input; no manual simulation advancement or position assignment.', baseUrl, viewport, errors, warnings, failedRequests, captures }, null, 2));
  console.log(`Full U2 round trip and physical Central transfer verified. Screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/u2-diagnostics.json`, JSON.stringify({ baseUrl, viewport, errors, warnings, failedRequests, captures, failure: error.message, state: await sample().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
