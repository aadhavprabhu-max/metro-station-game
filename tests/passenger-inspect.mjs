import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// The live section never assigns a train/player pose or advances simulation.
// The separately labelled information section pauses RAF, advances the actual
// services in 1/60 s steps and positions an inspection camera inside a car.
const baseUrl = process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/';
const output = process.env.METRO_PASSENGER_OUTPUT || '/tmp/metro-passenger';
const mode = process.env.METRO_INSPECT_MODE || 'both';
const viewport = { width: Number(process.env.METRO_VIEWPORT_WIDTH || 640), height: Number(process.env.METRO_VIEWPORT_HEIGHT || 400) };
const routeNames = {
  U1: ['Nordplatz', 'Central', 'Rosenheimer Platz'],
  U2: ['Stadtzentrum', 'Central', 'Schwarzkopf-Tunnel', 'Eisenwerk'],
  U3: ['Schattenufer', 'Central', 'Ostbahnhof', 'Stadtbrücke'],
  U4: ['Kaiser-Humboldt-Platz', 'Westbahnhof', 'Central', 'Arabellapark'],
};
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
  assert.deepEqual(errors, [], 'Runtime errors while inspecting passenger information.');
}

async function open() {
  const url = new URL(baseUrl); url.searchParams.set('line', 'U1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(() => window.metro?.ready && window.metro.world.passengerInformation?.length === 4, null, 120000);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
}

async function sample() {
  return page.evaluate(() => {
    const { world, player } = window.metro;
    const service = player.service, index = world.services.indexOf(service);
    const information = world.passengerInformation[index], displays = world.passengerDisplays[index];
    const scratch = document.createElement('canvas'); scratch.width = scratch.height = 32;
    const ctx = scratch.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let colored = 0; const colors = new Set();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 30) colored++;
      colors.add(`${pixels[offset] >> 3},${pixels[offset + 1] >> 3},${pixels[offset + 2] >> 3}`);
    }
    const data = information.snapshot;
    return {
      runtime: window.metro.snapshot(), service: service.snapshot(),
      information: data, displays: displays.snapshot(),
      mountedScreens: [...displays.screens, ...displays.maps].map(mesh => ({ ...mesh.userData })),
      announcer: world.announcer.getStatus(),
      carLayouts: service.train.cars.map(car => car.userData.interiorLayout),
      events: information.events.map(event => ({ id: event.id, type: event.type, station: event.station.id,
        next: event.nextStation.id, distance: event.distance, speed: event.speed, lineId: event.lineId,
        from: event.leg.from.id, to: event.leg.to.id })),
      riding: Boolean(player.ridingCar), car: player.ridingCar?.carNumber,
      offset: player.ridingOffset.toArray(), localCarZ: player.ridingCar ? player.ridingOffset.z - player.ridingCar.position.z : null,
      riderError: player.ridingCar ? service.train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset) : null,
      camera: player.camera.position.toArray(), yaw: player.yaw, pitch: player.pitch,
      platform: player.station.platformId, frames: window.metro.frames,
      railError: service.train.position.distanceTo(service.route.sample(service.distance).position),
      doors: service.train.cars.map(car => ({ ...car.doorProgressBySide })),
      coloredPixels: colored, uniquePixelColors: colors.size,
      glError: world.renderer.getContext().getError(), contextLost: world.renderer.getContext().isContextLost(),
      branding: document.querySelector('.identity strong')?.textContent,
      captionText: document.querySelector('#announcement-text')?.textContent,
      soundText: document.querySelector('#sound-status')?.textContent,
    };
  });
}

async function capture(name, inspectionMode, extra = {}) {
  const state = await sample();
  assert.equal(state.glError, 0); assert.equal(state.contextLost, false);
  assert.equal(state.runtime.status, 'running');
  assert(state.coloredPixels > 650 && state.uniquePixelColors > 12, `${name}: nearly empty rendered view.`);
  assert(state.railError < 1e-7);
  assert.deepEqual(state.information.orderedStops.map(stop => stop.name), routeNames[state.service.lineId]);
  assert.equal(state.information.currentStation.id, state.service.currentStop.id);
  assert.equal(state.information.nextStation.id, state.service.nextStop.id);
  assert.equal(state.information.terminus.id, state.service.destinationStop.id);
  assert.equal(state.displays.destination, state.information.terminus.name);
  assert(state.mountedScreens.every(screen => screen.nextStation === state.information.nextStation.id && screen.destination === state.information.terminus.id));
  assert(state.doors.every(door => door[-state.service.platformSide] === 0));
  if (state.service.speed > 0) assert(state.doors.every(door => door[state.service.platformSide] === 0));
  if (state.riding) assert(state.riderError < 1e-7);
  if (!state.announcer.voiceAvailable) {
    assert.equal(state.announcer.speaking, false);
    assert(state.announcer.history.every(item => !item.spoken));
  }
  assert(state.branding?.includes('AUREALIS'));
  assert(!state.branding?.includes('MVG'));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/${name}.png` });
  captures.push({ name, inspectionMode, elapsedSeconds: (Date.now() - begun) / 1000, ...extra, ...state });
  console.log(JSON.stringify({ captured: name, inspectionMode, line: state.service.lineId,
    state: state.service.state, station: state.information.currentStation.name,
    next: state.information.nextStation.name, destination: state.information.terminus.name,
    distance: state.service.distance, riding: state.riding }));
  return state;
}

async function look(yaw, pitch = 0) {
  const current = await page.evaluate(() => ({ yaw: window.metro.player.yaw, pitch: window.metro.player.pitch }));
  const yawChange = Math.atan2(Math.sin(yaw - current.yaw), Math.cos(yaw - current.yaw));
  await page.mouse.move(200, 230); await page.mouse.down();
  await page.mouse.move(200 - yawChange / 0.0028, 230 - (pitch - current.pitch) / 0.0028, { steps: 1 });
  await page.mouse.up();
}

async function liveRide() {
  await open();
  await page.evaluate(() => {
    const { world, player } = window.metro;
    const info = world.passengerInformation[0];
    window.passengerInspection = { movement: [], events: [], unsubscribe: null };
    window.passengerInspection.unsubscribe = info.subscribe(event => window.passengerInspection.events.push({
      id: event.id, type: event.type, station: event.station.id, from: event.leg.from.id,
      to: event.leg.to.id, speed: event.speed, distance: event.distance,
    }));
    // Observation only: sample the existing render/simulation frames without
    // replacing the animation loop or changing a service/controller state.
    const observe = () => {
      if (player.ridingCar) window.passengerInspection.movement.push({
        position: player.ridingOffset.toArray(), car: player.ridingCar.carNumber,
        distance: player.service.distance, speed: player.service.speed,
      });
      if (window.passengerInspection.movement.length > 20000) window.passengerInspection.movement.shift();
      window.passengerInspection.observer = requestAnimationFrame(observe);
    };
    window.passengerInspection.observer = requestAnimationFrame(observe);
  });
  const spawn = await capture('live-01-station-spawn', 'Normal RAF; original U1 spawn');
  await page.keyboard.down('w'); await page.keyboard.down('Shift');
  try { await wait(() => window.metro.player.interactionHint().enabled, null, 240000); }
  finally { await page.keyboard.up('w'); await page.keyboard.up('Shift'); }
  await page.keyboard.press('e'); await wait(() => Boolean(window.metro.player.ridingCar), null, 30000);
  const boarded = await page.evaluate(() => ({ car: window.metro.player.ridingCar.carNumber,
    z: window.metro.player.ridingOffset.z - window.metro.player.ridingCar.position.z }));
  const walkDirection = boarded.z <= 0 ? 1 : -1;
  const interiorYaw = walkDirection > 0 ? Math.PI : 0;
  await look(interiorYaw, 0.12);
  await capture('live-02-boarded-blue-seat-interior', 'Normal RAF; keyboard boarding and pointer look');
  // Audio is explicitly enabled by its actual button. No voice is claimed if
  // the native browser has no voices; status/history record that separately.
  await page.locator('#sound-button').click();
  await wait(() => { const service = window.metro.player.service; return service.state === 'departing' && service.speed === 0; });
  await capture('live-03-closed-doors-before-departure', 'Normal RAF; actual departure pause');
  await wait(() => { const service = window.metro.player.service; return service.completedLegs === 0 && service.distance > 8 && service.distance < 35; });
  await capture('live-04-continuous-station-departure', 'Normal RAF; genuine acceleration with a rider');
  // Move from the door vestibule into the central aisle with genuine input.
  // Looking along +z reverses screen-relative strafing, so use its left key.
  const strafeKey = interiorYaw === Math.PI ? 'a' : 'd';
  await page.keyboard.down(strafeKey);
  try { await wait(() => window.metro.player.ridingOffset.x >= -0.1, null, 120000); }
  finally { await page.keyboard.up(strafeKey); }
  const targetZ = Math.abs(boarded.z) < 1 ? 2.4 : boarded.z < 0 ? -2.4 : 2.4;
  const localBeforeWalk = await page.evaluate(() => window.metro.player.ridingOffset.toArray());
  await page.keyboard.down('w');
  try { await wait(target => {
    const player = window.metro.player, z = player.ridingOffset.z - player.ridingCar.position.z;
    return target.direction > 0 ? z >= target.z : z <= target.z;
  }, { z: targetZ, direction: walkDirection }, 180000); }
  finally { await page.keyboard.up('w'); }
  const localAfterWalk = await page.evaluate(() => window.metro.player.ridingOffset.toArray());
  assert(Math.abs(localAfterWalk[2] - localBeforeWalk[2]) > 1, 'The actual keyboard interior walk did not move through the aisle.');
  assert(Math.abs(localAfterWalk[0] - localBeforeWalk[0]) < 0.15);
  await capture('live-05-walked-between-formed-seats', 'Normal RAF; genuine first-person walking while riding', { localBeforeWalk, localAfterWalk });
  await wait(() => { const service = window.metro.player.service; return service.completedLegs === 0 && service.distance > 100 && service.distance < 180; });
  // At the aisle viewing position, look back at the nearest two-sided screen.
  await look(targetZ < 0 ? 0 : Math.PI, 0.3);
  const tunnel = await capture('live-06-dynamic-screen-in-tunnel', 'Normal RAF; actual tunnel journey and live next-stop screen');
  assert.equal(tunnel.car, boarded.car); assert.equal(tunnel.information.nextStation.name, 'Central');
  await look(Math.PI / 2, 0);
  await wait(() => { const service = window.metro.player.service; return service.state === 'arriving' && service.distance > 210; });
  await capture('live-07-central-braking-platform-view', 'Normal RAF; real deceleration and approaching Central caption');
  await wait(() => { const { world, player } = window.metro; return player.service.currentStop.id === 'station-2'
    && player.service.canBoard && world.passengerInformation[0].snapshot.doorState === 'open'; });
  const stopped = await capture('live-08-central-stopped-open-doors', 'Normal RAF; exact physical stop and actual doors');
  assert.equal(stopped.service.distance, 240); assert.equal(stopped.service.speed, 0); assert.equal(stopped.car, boarded.car);
  assert.deepEqual(stopped.information.currentStation.interchanges.map(transfer => transfer.lineId), ['U2', 'U3', 'U4']);
  await page.keyboard.press('e');
  await wait(() => !window.metro.player.ridingCar && window.metro.player.station.platformId === 'station-2:U1', null, 30000);
  await look(-Math.PI / 2, 0);
  const alighted = await capture('live-09-central-platform-after-real-exit', 'Normal RAF; E alighting at the real U1 Central platform');
  assert.equal(alighted.riding, false); assert.equal(alighted.announcer.activeLineId, null);
  assert.equal(alighted.announcer.caption, ''); assert.equal(alighted.announcer.queued, 0);
  assert(alighted.frames > spawn.frames + 100);
  const observed = await page.evaluate(() => {
    cancelAnimationFrame(window.passengerInspection.observer);
    window.passengerInspection.unsubscribe();
    return { events: window.passengerInspection.events, movement: window.passengerInspection.movement };
  });
  assert(observed.movement.length > 20);
  assert(observed.movement.every(point => point.car === boarded.car));
  const arrivals = observed.events.filter(event => event.type === 'arrival');
  assert.equal(arrivals.length, 1); assert.equal(arrivals[0].station, 'station-2');
  assert.equal(arrivals[0].distance, 240); assert.equal(arrivals[0].speed, 0);
  const approach = observed.events.find(event => event.type === 'approaching');
  assert.equal(approach.station, 'station-2'); assert.equal(approach.to, 'station-2');
  assert.equal(new Set(observed.events.map(event => event.id)).size, observed.events.length);
  await writeFile(`${output}/live-input-observations.json`, JSON.stringify(observed, null, 2));
}

async function advanceTo(line, stationId, direction = null) {
  return page.evaluate(({ line, stationId, direction }) => {
    const { world } = window.metro, service = world.services.find(item => item.lineId === line);
    for (let frame = 0; frame < 1000 * 60; frame++) {
      const data = world.passengerInformation.find(info => info.service === service).snapshot;
      if (service.currentStop.id === stationId && service.canBoard && data.doorState === 'open' && (direction === null || service.direction === direction)) return;
      world.update(1 / 60);
    }
    throw new Error(`No actual ${line} stop at ${stationId}, direction ${direction}.`);
  }, { line, stationId, direction });
}

async function scriptedCamera(line, stationId) {
  await page.evaluate(({ line, stationId }) => {
    const { world, player } = window.metro, service = world.services.find(item => item.lineId === line);
    const station = world.stations.find(item => item.lineId === line && item.stationId === stationId), car = service.train.cars[1];
    player.ridingCar = null; player.transferSurface = null; player.keys.clear(); player.useStation(station);
    player.camera.position.set(0.3, 1.85, car.position.z - 1.5);
    service.train.localToWorld(player.camera.position);
    player.yaw = 0; player.pitch = 0.23; player.applyLook();
    for (let frame = 0; frame < 9; frame++) world.update(1 / 60);
    world.renderer.render(world.scene, world.camera);
  }, { line, stationId });
}

async function exportTextures(name, line) {
  const textures = await page.evaluate(line => {
    const displays = window.metro.world.passengerDisplays.find(item => item.train.lineId === line);
    return { nextStop: displays.textures.nextStop.image.toDataURL('image/png'), routeMap: displays.textures.routeMap.image.toDataURL('image/png') };
  }, line);
  for (const [kind, data] of Object.entries(textures)) await writeFile(`${output}/${name}-${kind}.png`, Buffer.from(data.split(',')[1], 'base64'));
}

async function scriptedInformation() {
  await open();
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  for (const line of Object.keys(routeNames)) {
    const stops = await page.evaluate(line => window.metro.world.routes[line].stops.map(stop => ({ id: stop.id, name: stop.name })), line);
    const shots = [{ id: stops[0].id, direction: 1, label: 'outbound-origin' },
      { id: 'station-2', direction: 1, label: 'central-outbound' },
      { id: stops.at(-1).id, direction: -1, label: 'far-terminus-reversal' },
      { id: 'station-2', direction: -1, label: 'central-return' },
      { id: stops[0].id, direction: 1, label: 'origin-return-reversal' }];
    for (const shot of shots) {
      await advanceTo(line, shot.id, shot.direction);
      await scriptedCamera(line, shot.id);
      const name = `${line}-${shot.label}`;
      const state = await capture(name, 'Supplemental scripted interior camera; actual service advanced in 1/60 s steps');
      assert.equal(state.information.direction, shot.direction);
      if (shot.id === 'station-2') assert.deepEqual(state.information.currentStation.interchanges.map(transfer => transfer.lineId).sort(), Object.keys(routeNames).filter(other => other !== line));
      await exportTextures(name, line);
    }
  }
}

try {
  if (!['maps', 'scripted'].includes(mode)) await liveRide();
  if (!['ride', 'live'].includes(mode)) await scriptedInformation();
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(`${output}/passenger-diagnostics.json`, JSON.stringify({ baseUrl, mode, viewport,
    inspectionModes: ['Normal RAF; real boarding, mouse look, walking, movement and exit', 'Separate scripted service/camera information diagnostics'],
    errors, warnings, failedRequests, captures }, null, 2));
  console.log(`Passenger production inspection complete: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/passenger-diagnostics.json`, JSON.stringify({ baseUrl, mode, errors, warnings, failedRequests, captures,
    failure: error.message, state: await sample().catch(() => null) }, null, 2));
  throw error;
} finally { await browser.close(); }
