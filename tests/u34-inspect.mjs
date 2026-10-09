import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Production journey validation uses normal RAF and real input throughout.
// There are no world.update calls or assigned player/train positions here.
const baseUrl = process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/';
const output = process.env.METRO_U34_OUTPUT || '/tmp/metro-u34-network';
const mode = process.env.METRO_INSPECT_MODE || 'both';
const selectedLines = process.env.METRO_INSPECT_LINE ? [process.env.METRO_INSPECT_LINE] : ['U3', 'U4'];
const viewport = { width: Number(process.env.METRO_VIEWPORT_WIDTH || 640), height: Number(process.env.METRO_VIEWPORT_HEIGHT || 400) };
const urlFor = line => { const url = new URL(baseUrl); url.searchParams.set('line', line); return url.href; };
await mkdir(output, { recursive: true });
const args = ['--no-sandbox', '--disable-dev-shm-usage'];
if (process.env.SOFTWARE_WEBGL) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args });
const page = await browser.newPage({ viewport });
const errors = [], warnings = [], failedRequests = [], captures = [];
const begun = Date.now();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning') warnings.push(message.text());
});
page.on('requestfailed', request => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });

async function wait(predicate, argument = null, timeout = 600000) {
  await page.waitForFunction(predicate, argument, { polling: 100, timeout });
  assert.deepEqual(errors, [], 'Runtime error during production journey.');
}

async function lookYaw(target) {
  const current = await page.evaluate(() => window.metro.player.yaw);
  const change = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  await page.mouse.move(200, 230);
  await page.mouse.down();
  await page.mouse.move(200 - change / 0.0028, 230, { steps: 1 });
  await page.mouse.up();
}

async function lookPitch(target) {
  const current = await page.evaluate(() => window.metro.player.pitch);
  await page.mouse.move(200, 230);
  await page.mouse.down();
  await page.mouse.move(200, 230 - (target - current) / 0.0028, { steps: 1 });
  await page.mouse.up();
}

async function walkTo(x, z, tolerance = 0.35) {
  const position = await page.evaluate(() => window.metro.player.camera.position.toArray());
  await lookYaw(Math.atan2(-(x - position[0]), -(z - position[2])));
  await page.keyboard.down('w'); await page.keyboard.down('Shift');
  try {
    await wait(({ x, z, tolerance }) => {
      const position = window.metro.player.camera.position;
      return Math.hypot(position.x - x, position.z - z) < tolerance;
    }, { x, z, tolerance }, 240000);
  } finally {
    await page.keyboard.up('w'); await page.keyboard.up('Shift');
  }
}

async function sample() {
  return page.evaluate(() => {
    const { world, player } = window.metro;
    const service = player.service, train = service.train;
    const scratch = document.createElement('canvas'); scratch.width = scratch.height = 32;
    const ctx = scratch.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let colored = 0; const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] && pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) colored++;
      colors.add(`${pixels[index] >> 3},${pixels[index + 1] >> 3},${pixels[index + 2] >> 3}`);
    }
    return {
      runtime: window.metro.snapshot(), service: service.snapshot(), services: world.services.map(item => item.snapshot()),
      trainPosition: train.position.toArray(), railError: train.position.distanceTo(service.route.sample(service.distance).position),
      accents: world.trains.map(item => item.materials.trainAccent.color.getHexString()),
      carOffsets: train.cars.map(car => car.position.toArray()), doors: train.cars.map(car => ({ ...car.doorProgressBySide })),
      displays: train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => ({ line: display.userData.lineId, destination: display.userData.destination }))),
      riding: Boolean(player.ridingCar), riderCar: player.ridingCar?.carNumber, riderLine: player.ridingCar?.lineId,
      riderTransformError: player.ridingCar ? train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset) : null,
      stationId: player.station.stationId, platformId: player.station.platformId, physicalLine: player.station.lineId,
      camera: player.camera.position.toArray(), feetY: player.camera.position.y - (player.ridingCar ? 1.85 : 1.76),
      transfer: player.transferSurface ? { id: player.transferSurface.id, kind: player.transferSurface.kind, floorY: player.transferSurface.floorY } : null,
      boards: world.stations.map(station => ({ platformId: station.platformId, line: station.lineId, rows: station.departures.departures.map(row => ({ ...row })) })),
      hud: { line: document.querySelector('#location-line')?.textContent,
        location: document.querySelector('#location-name')?.textContent,
        destination: document.querySelector('.service-main strong')?.textContent,
        nextStop: document.querySelector('#service-next-stop')?.textContent,
        platform: document.querySelector('#location-platform')?.textContent,
        transfer: document.querySelector('#location-transfer')?.textContent },
      colored, colors: colors.size, frames: window.metro.frames,
      drawCalls: world.renderer.info.render.calls,
      glError: world.renderer.getContext().getError(), contextLost: world.renderer.getContext().isContextLost(),
    };
  });
}

async function capture(name) {
  const state = await sample();
  assert.equal(state.runtime.status, 'running');
  assert.equal(state.glError, 0); assert.equal(state.contextLost, false);
  assert(state.colored > 600 && state.colors > 12, `${name}: nearly empty rendering.`);
  assert(state.railError < 1e-7);
  assert.deepEqual(state.accents, ['316c65', 'b4443d', '3e71b6', '8d58ac']);
  assert.deepEqual(state.carOffsets.map(position => position[2]), [-17, 0, 17]);
  assert(state.doors.every(door => door[-state.service.platformSide] === 0));
  if (state.service.speed > 0) assert(state.doors.every(door => door[state.service.platformSide] === 0));
  if (state.riding) { assert.equal(state.riderLine, state.service.lineId); assert(state.riderTransformError < 1e-7); }
  await page.screenshot({ path: `${output}/${name}.png` });
  captures.push({ name, elapsedSeconds: (Date.now() - begun) / 1000, ...state });
  console.log(JSON.stringify({ captured: name, elapsedSeconds: captures.at(-1).elapsedSeconds, line: state.service.lineId,
    state: state.service.state, distance: state.service.distance, current: state.service.currentStop.name,
    next: state.service.nextStop.name, destination: state.service.destinationStop.name, riding: state.riding, feetY: state.feetY }));
  return state;
}

async function open(line) {
  await page.goto(urlFor(line), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(line => window.metro?.ready && window.metro.world.services?.length === 4 && window.metro.player.service.lineId === line, line, 120000);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
}

async function approachAndBoard(line) {
  await page.keyboard.down('w'); await page.keyboard.down('Shift');
  try { await wait(line => window.metro.player.service.lineId === line && window.metro.player.interactionHint().enabled, line, 240000); }
  finally { await page.keyboard.up('w'); await page.keyboard.up('Shift'); }
  await page.keyboard.press('e');
  await wait(line => Boolean(window.metro.player.ridingCar) && window.metro.player.service.lineId === line, line, 30000);
}

async function beginStairMonitor() {
  await page.evaluate(() => {
    const player = window.metro.player;
    const record = { active: true, previousY: player.camera.position.y, maximumHeightStep: 0, lowestFeetY: Infinity, highestFeetY: -Infinity, surfaces: [] };
    window.metroStairInspection = record;
    const sampleFrame = () => {
      if (!record.active) return;
      record.maximumHeightStep = Math.max(record.maximumHeightStep, Math.abs(player.camera.position.y - record.previousY));
      record.previousY = player.camera.position.y;
      const feet = player.camera.position.y - 1.76;
      record.lowestFeetY = Math.min(record.lowestFeetY, feet);
      record.highestFeetY = Math.max(record.highestFeetY, feet);
      const id = player.transferSurface?.id;
      if (id && !record.surfaces.includes(id)) record.surfaces.push(id);
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  });
}

async function endStairMonitor(direction) {
  const record = await page.evaluate(() => {
    const record = window.metroStairInspection;
    record.active = false;
    return { maximumHeightStep: record.maximumHeightStep, lowestFeetY: record.lowestFeetY, highestFeetY: record.highestFeetY, surfaces: record.surfaces };
  });
  assert(record.maximumHeightStep > 0 && record.maximumHeightStep <= 0.45, `${direction}: discontinuous stair height.`);
  assert(record.lowestFeetY >= -12.001 && record.highestFeetY <= 0.001, `${direction}: passenger left the supported staircase.`);
  assert(['flight-1', 'flight-2', 'flight-3', 'flight-4'].every(id => record.surfaces.includes(id)), `${direction}: missed a flight.`);
  captures.push({ name: `stair-monitor-${direction}`, elapsedSeconds: (Date.now() - begun) / 1000, ...record });
  console.log(JSON.stringify({ staircase: direction, ...record }));
}

async function ride(line) {
  await open(line);
  const spawn = await capture(`${line}-00-spawn`);
  assert.equal(spawn.service.distance, 0); assert.equal(spawn.service.state, 'boarding');
  assert.equal(spawn.trainPosition[1], -12);
  const definition = await page.evaluate(() => {
    const service = window.metro.player.service;
    return { side: service.platformSide, stops: service.route.stops.map(stop => ({ id: stop.id, name: stop.name, distance: stop.distance })) };
  });
  const order = [1, 2, 3, 2, 1, 0];
  await approachAndBoard(line);
  const carNumber = await page.evaluate(() => window.metro.player.ridingCar.carNumber);
  const platformYaw = -definition.side * Math.PI / 2;
  await lookYaw(platformYaw);
  await capture(`${line}-00-boarded`);
  for (const [index, targetIndex] of order.entries()) {
    const stop = definition.stops[targetIndex];
    const from = definition.stops[index === 0 ? 0 : order[index - 1]].distance;
    const number = index + 1, prefix = `${line}-${number}-${stop.id}`;
    await wait(index => { const service = window.metro.player.service; return service.completedLegs === index && service.state === 'departing' && service.speed === 0; }, index);
    const closed = await capture(`${prefix}-a-closed`);
    assert(closed.doors.every(door => door[definition.side] === 0)); assert.equal(closed.service.reversalPending, false);
    await wait(({ index, from }) => { const service = window.metro.player.service; const distance = Math.abs(service.distance - from); return service.completedLegs === index && distance > 8 && distance < 35; }, { index, from });
    await capture(`${prefix}-b-visible-departure`);
    const midpoint = Math.abs(stop.distance - from) / 2;
    await wait(({ index, from, midpoint }) => { const service = window.metro.player.service; const distance = Math.abs(service.distance - from); return service.completedLegs === index && Math.abs(distance - midpoint) < 25; }, { index, from, midpoint });
    const tunnel = await capture(`${prefix}-c-tunnel`); assert.equal(tunnel.riderCar, carNumber); assert.equal(tunnel.feetY, -12);
    await wait(({ index, to }) => { const service = window.metro.player.service; return service.completedLegs === index && service.state === 'arriving' && Math.abs(service.distance - to) < 30; }, { index, to: stop.distance });
    await capture(`${prefix}-d-arriving`);
    await wait(({ number, id, side }) => { const service = window.metro.player.service; return service.completedLegs === number && service.currentStop.id === id && service.state === 'boarding' && service.train.cars.every(car => car.doorProgressBySide[side] > 0.99); }, { number, id: stop.id, side: definition.side });
    const stopped = await capture(`${prefix}-e-open-stopped`);
    assert.equal(stopped.service.distance, stop.distance); assert.equal(stopped.service.speed, 0);
    assert.equal(stopped.service.direction, index < 2 || index === 5 ? 1 : -1);
    assert.equal(stopped.service.destinationStop.id, definition.stops[index < 2 || index === 5 ? 3 : 0].id);
    assert.equal(stopped.riderCar, carNumber);
    assert(stopped.displays.every(display => display.line === line && display.destination === stopped.service.destinationStop.name));
    assert.equal(stopped.hud.line, line); assert.equal(stopped.hud.destination, stopped.service.destinationStop.name);
    assert.equal(stopped.hud.nextStop, `Next stop · ${stopped.service.nextStop.name}`);
    assert.equal(stopped.service.reversalPending, [2, 5].includes(index));
    await page.keyboard.press('e');
    await wait(id => !window.metro.player.ridingCar && window.metro.player.station.platformId === id, `${stop.id}:${line}`, 30000);
    await lookYaw(-platformYaw);
    const platform = await capture(`${prefix}-f-platform`);
    assert.equal(platform.feetY, -12); assert.equal(platform.physicalLine, line);
    const rows = platform.boards.find(board => board.platformId === `${stop.id}:${line}`).rows;
    assert(rows.every(row => stop.id === 'station-2' ? ['U3', 'U4'].includes(row.route) : row.route === line));
    assert.equal(rows.filter(row => row.route === line).length, [0, 3].includes(targetIndex) ? 1 : 2);
    if (stop.id === 'station-2') { assert.equal(rows.length, 4); assert(platform.hud.platform.includes('Lower level')); }
    if (index < order.length - 1) {
      await page.locator('#interact-button').click();
      await wait(() => Boolean(window.metro.player.ridingCar), null, 30000);
      await lookYaw(platformYaw);
    }
  }
  const final = await capture(`${line}-07-round-trip-complete`);
  assert.equal(final.service.completedLegs, 6); assert.equal(final.service.distance, 0);
  assert(final.frames > spawn.frames + 300);
  assert(final.services.filter(service => ['U1', 'U2'].includes(service.lineId)).every(service => service.completedLegs >= 4));
}

async function transfers() {
  await open('U1');
  await approachAndBoard('U1');
  await lookYaw(Math.PI / 2);
  await wait(() => { const service = window.metro.player.service; return service.currentStop.id === 'station-2' && service.canBoard && service.train.cars.every(car => car.doorProgressBySide[-1] > 0.99); });
  await page.keyboard.press('e');
  await wait(() => !window.metro.player.ridingCar && window.metro.player.station.platformId === 'station-2:U1', null, 30000);
  const x = await page.evaluate(() => window.metro.player.camera.position.x);
  await walkTo(x, -280);
  await walkTo(-7.45, -280);
  await lookYaw(0); await lookPitch(-0.2);
  await capture('transfer-01-upper-stair-entrance');
  await lookPitch(0);
  await beginStairMonitor();
  // Four alternating flights and their landings; actual surface validation
  // below detects dropped floors or any accidental inter-level teleport.
  const descent = [[-7.45, -284.7], [-7.45, -288], [-7.45, -291.75], [-4.15, -291.75],
    [-4.15, -288], [-4.15, -284.1], [-7.45, -284.1], [-7.45, -288], [-7.45, -291.75],
    [-4.15, -291.75], [-4.15, -288], [-4.15, -284.1], [-4.15, -280]];
  for (const [index, [targetX, targetZ]] of descent.entries()) {
    await walkTo(targetX, targetZ);
    if ([2, 5, 8, 12].includes(index)) {
      await lookYaw(index === 12 ? Math.PI : index === 5 ? Math.PI / 2 : -Math.PI / 2);
      await lookPitch(index === 12 ? 0 : -0.35);
      const state = await capture(`transfer-02-${index}-stairs-down`);
      assert(Math.abs(state.feetY - [-3, -6, -9, -12][[2, 5, 8, 12].indexOf(index)]) < 0.1);
      await lookPitch(0);
    }
  }
  await wait(() => window.metro.player.station.platformId === 'station-2:U3', null, 30000);
  await endStairMonitor('down');
  const lower = await capture('transfer-03-lower-u3-platform');
  assert.equal(lower.feetY, -12); assert.equal(lower.hud.line, 'U3');
  await walkTo(-4.15, -264);
  await walkTo(-10.5, -264);
  await capture('transfer-04-lower-cross-passage');
  await walkTo(-20.3, -264);
  await wait(() => window.metro.player.station.platformId === 'station-2:U4', null, 30000);
  await walkTo(-20.3, -262.5);
  await lookYaw(Math.PI / 2);
  const u4Platform = await capture('transfer-05-lower-u4-platform');
  assert.equal(u4Platform.feetY, -12); assert.equal(u4Platform.hud.line, 'U4');
  await wait(() => window.metro.player.interactionHint().enabled);
  await page.keyboard.press('e');
  await wait(() => Boolean(window.metro.player.ridingCar) && window.metro.player.service.lineId === 'U4', null, 30000);
  await lookYaw(-Math.PI / 2);
  await capture('transfer-06-boarded-u4-after-stairs');
  // Stay aboard for one real departure and the next return to Central before
  // walking back upstairs; no service reset changes the transfer timetable.
  await wait(() => window.metro.player.service.speed > 2);
  await capture('transfer-07-riding-u4');
  await wait(() => { const service = window.metro.player.service; return service.currentStop.id === 'station-2' && service.canBoard; });
  await page.keyboard.press('e');
  await wait(() => !window.metro.player.ridingCar, null, 30000);
  const exitZ = await page.evaluate(() => window.metro.player.camera.position.z);
  await walkTo(-20.3, exitZ); await walkTo(-20.3, -264);
  await walkTo(-4.15, -264); await walkTo(-4.15, -280);
  await beginStairMonitor();
  const ascent = [[-4.15, -284.1], [-4.15, -288], [-4.15, -291.75], [-7.45, -291.75],
    [-7.45, -288], [-7.45, -284.1], [-4.15, -284.1], [-4.15, -288], [-4.15, -291.75],
    [-7.45, -291.75], [-7.45, -288], [-7.45, -284.1], [-7.45, -280]];
  for (const [index, [targetX, targetZ]] of ascent.entries()) {
    await walkTo(targetX, targetZ);
    if ([2, 5, 8, 12].includes(index)) {
      await lookYaw(index === 12 ? Math.PI : index === 5 ? -Math.PI / 2 : Math.PI / 2);
      await lookPitch(index === 12 ? 0 : -0.35);
      const state = await capture(`transfer-08-${index}-stairs-up`);
      assert(Math.abs(state.feetY - [-9, -6, -3, 0][[2, 5, 8, 12].indexOf(index)]) < 0.1);
      await lookPitch(0);
    }
  }
  await wait(() => window.metro.player.station.platformId === 'station-2:U1', null, 30000);
  await endStairMonitor('up');
  const upper = await capture('transfer-09-upper-level-return');
  assert.equal(upper.feetY, 0); assert.equal(upper.hud.line, 'U1');
}

try {
  if (mode !== 'transfer') for (const line of selectedLines) await ride(line);
  if (mode !== 'ride') await transfers();
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(`${output}/u34-diagnostics.json`, JSON.stringify({ mode: 'Normal RAF and real input; no scripted simulation advance or assigned player/train poses.', selectedLines, baseUrl, viewport, errors, warnings, failedRequests, captures }, null, 2));
  console.log(`Production journeys/interchanges inspected. Screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/u34-diagnostics.json`, JSON.stringify({ baseUrl, viewport, errors, warnings, failedRequests, captures, failure: error.message, state: await sample().catch(() => null) }, null, 2));
  throw error;
} finally { await browser.close(); }
