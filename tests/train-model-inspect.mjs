import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Angle photographs are explicitly scripted diagnostics: RAF is paused and
// the real services advance in small steps; only the inspection camera moves.
// The separate final journey reloads and uses normal RAF with real input.
const baseUrl = process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/';
const output = process.env.METRO_TRAIN_OUTPUT || '/tmp/metro-train-model';
const mode = process.env.METRO_INSPECT_MODE || 'both';
const viewport = { width: Number(process.env.METRO_VIEWPORT_WIDTH || 800), height: Number(process.env.METRO_VIEWPORT_HEIGHT || 500) };
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
  assert.deepEqual(errors, [], 'Runtime errors while inspecting the train model.');
}

async function open() {
  const url = new URL(baseUrl); url.searchParams.set('line', 'U1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(() => window.metro?.ready && window.metro.world.services?.length === 4, null, 120000);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
}

async function sample() {
  return page.evaluate(() => {
    const { player, world } = window.metro;
    const service = player.service, train = service.train;
    const scratch = document.createElement('canvas'); scratch.width = scratch.height = 32;
    const ctx = scratch.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let colored = 0; const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] && pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) colored++;
      colors.add(`${pixels[index] >> 3},${pixels[index + 1] >> 3},${pixels[index + 2] >> 3}`);
    }
    const geometryMeshes = [];
    train.traverse(object => { if (object.isMesh) geometryMeshes.push(object); });
    return {
      runtime: window.metro.snapshot(), service: service.snapshot(), railError: train.position.distanceTo(service.route.sample(service.distance).position),
      position: train.position.toArray(), carOffsets: train.cars.map(car => car.position.toArray()),
      colors: { blue: train.materials.trainBlue.color.getHexString(), silver: train.materials.trainSilver.color.getHexString(), accent: train.materials.trainAccent.color.getHexString() },
      blueActuallyUsed: geometryMeshes.some(mesh => [mesh.material].flat().includes(train.materials.trainBlue)),
      silverActuallyUsed: geometryMeshes.some(mesh => [mesh.material].flat().includes(train.materials.trainSilver)),
      cabs: train.cars.flatMap(car => car.cabs.map(cab => ({ end: cab.end, headlights: cab.headlights.intensity,
        metadata: cab.shellMetadata, windshield: cab.windshieldMesh?.geometry.userData,
        activeWhiteLamps: cab.lamps.every(lamp => lamp.main.material === cab.materials.warmLight) }))),
      displays: train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => ({ line: display.userData.lineId, destination: display.userData.destination }))),
      doors: train.cars.map(car => ({ ...car.doorProgressBySide })),
      camera: player.camera.position.toArray(), yaw: player.yaw, pitch: player.pitch,
      riding: Boolean(player.ridingCar), riderCar: player.ridingCar?.carNumber,
      riderError: player.ridingCar ? train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset) : null,
      platform: player.station.platformId, frames: window.metro.frames,
      branding: document.querySelector('.identity strong')?.textContent,
      coloredPixels: colored, uniquePixelColors: colors.size,
      glError: world.renderer.getContext().getError(), contextLost: world.renderer.getContext().isContextLost(),
    };
  });
}

async function capture(name, inspectionMode, extra = {}) {
  const state = await sample();
  assert.equal(state.glError, 0); assert.equal(state.contextLost, false);
  assert.equal(state.runtime.status, 'running');
  assert(state.coloredPixels > 650 && state.uniquePixelColors > 12, `${name}: nearly empty rendered view.`);
  assert(state.railError < 1e-7);
  assert.deepEqual(state.carOffsets.map(position => position[2]), [-17, 0, 17]);
  assert.equal(state.colors.blue, '287fbb'); assert.equal(state.colors.silver, 'b9c1c8');
  assert(state.blueActuallyUsed && state.silverActuallyUsed);
  assert.equal(state.cabs.length, 2); assert.equal(state.cabs.filter(cab => cab.headlights > 0).length, 1);
  assert(state.cabs.every(cab => (cab.headlights > 0) === (cab.end === -state.service.cabDirection)));
  assert(state.displays.every(display => display.line === state.service.lineId && display.destination === state.service.destinationStop.name));
  assert(state.doors.every(door => door[-state.service.platformSide] === 0));
  if (state.service.speed > 0) assert(state.doors.every(door => door[state.service.platformSide] === 0));
  if (state.riding) assert(state.riderError < 1e-7);
  assert(state.branding?.includes('AUREALIS'));
  assert(!state.branding?.includes('MVG'));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/${name}.png` });
  captures.push({ name, inspectionMode, elapsedSeconds: (Date.now() - begun) / 1000, ...extra, ...state });
  console.log(JSON.stringify({ captured: name, inspectionMode, line: state.service.lineId,
    state: state.service.state, distance: state.service.distance, station: state.service.currentStop.name,
    destination: state.service.destinationStop.name, riding: state.riding, pixels: state.coloredPixels }));
  return state;
}

async function angle(line, stationId, angleName, end = -1) {
  await page.evaluate(({ line, stationId, angleName, end }) => {
    const { world, player } = window.metro;
    const service = world.services.find(item => item.lineId === line), train = service.train;
    const station = world.stations.find(item => item.lineId === line && item.stationId === stationId);
    player.ridingCar = null; player.keys.clear(); player.transferSurface = null; player.useStation(station);
    const side = service.platformSide;
    const offset = angleName === 'front' ? [0, 1.5, end * 32]
      : angleName === 'side' ? [side * 9, 1.76, -12]
        : [side * 6.5, 1.76, end * 34];
    const target = angleName === 'side' ? [0, 1.6, -12] : [0, 1.8, end * 24.8];
    player.camera.position.copy(train.position).add(player.camera.position.clone().set(...offset));
    const targetPosition = train.position.clone().add(train.position.clone().set(...target));
    const difference = targetPosition.sub(player.camera.position);
    player.yaw = Math.atan2(-difference.x, -difference.z);
    player.pitch = Math.atan2(difference.y, Math.hypot(difference.x, difference.z));
    player.applyLook();
    // The ordinary HUD refreshes at a modest rate. These explicitly scripted
    // inspection frames keep its station/line text aligned with the view.
    for (let frame = 0; frame < 9; frame++) world.update(1 / 60);
    world.update(0); world.renderer.render(world.scene, world.camera);
  }, { line, stationId, angleName, end });
}

async function advanceTo(line, stationId) {
  return page.evaluate(({ line, stationId }) => {
    const { world } = window.metro;
    const service = world.services.find(item => item.lineId === line);
    let seconds = 0;
    for (let frame = 0; frame < 900 * 60; frame++) {
      if (service.currentStop.id === stationId && service.canBoard && service.train.cars.every(car => car.doorProgressBySide[service.platformSide] > 0.99)) return seconds;
      world.update(1 / 60); seconds += 1 / 60;
    }
    throw new Error(`Train never stopped at ${line} ${stationId}.`);
  }, { line, stationId });
}

async function scriptedAngles() {
  await open();
  await capture('00-original-spawn', 'Original production spawn before scripted inspection');
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  for (const line of ['U1', 'U2', 'U3', 'U4']) {
    const stops = await page.evaluate(line => window.metro.world.routes[line].stops.map(stop => ({ id: stop.id, name: stop.name })), line);
    for (const [index, stop] of stops.entries()) {
      const advancedSeconds = await advanceTo(line, stop.id);
      await angle(line, stop.id, index === 0 ? 'front' : 'three-quarter');
      await capture(`${line}-${index}-${stop.id}-front-quarter`, 'Scripted angle camera; actual service advanced in 1/60 s steps', { advancedSeconds });
      if (index === 0) {
        await angle(line, stop.id, 'side');
        await capture(`${line}-endpoint-side`, 'Scripted inspection camera; paused service');
        await angle(line, stop.id, 'three-quarter', 1);
        await capture(`${line}-endpoint-rear-quarter`, 'Scripted inspection camera; paused service');
      }
    }
    const tunnel = await page.evaluate(line => {
      const { world } = window.metro;
      const service = world.services.find(item => item.lineId === line);
      // From the far terminus, observe a real continuous return into the first
      // connecting tunnel without assigning any route distance or train pose.
      const midpoint = (service.currentStop.distance + service.nextStop.distance) / 2;
      for (let frame = 0; frame < 180 * 60; frame++) {
        world.update(1 / 60);
        if (service.speed > 0 && Math.abs(service.distance - midpoint) < 0.1) return { stationId: service.currentStop.id, distance: service.distance };
      }
      throw new Error(`No ${line} tunnel journey reached the midpoint.`);
    }, line);
    await angle(line, tunnel.stationId, 'front', 1);
    await capture(`${line}-return-tunnel-front`, 'Scripted service advancement and inspection camera in connecting tunnel');
  }
}

async function look(yaw, pitch = 0) {
  const current = await page.evaluate(() => ({ yaw: window.metro.player.yaw, pitch: window.metro.player.pitch }));
  const yawChange = Math.atan2(Math.sin(yaw - current.yaw), Math.cos(yaw - current.yaw));
  await page.mouse.move(200, 230); await page.mouse.down();
  await page.mouse.move(200 - yawChange / 0.0028, 230 - (pitch - current.pitch) / 0.0028, { steps: 1 });
  await page.mouse.up();
}

async function liveRide() {
  await page.setViewportSize({ width: 640, height: 400 });
  await open();
  const spawn = await capture('live-01-spawn', 'Normal RAF; original player spawn');
  await page.keyboard.down('w'); await page.keyboard.down('Shift');
  try { await wait(() => window.metro.player.interactionHint().enabled, null, 240000); }
  finally { await page.keyboard.up('w'); await page.keyboard.up('Shift'); }
  await page.keyboard.press('e'); await wait(() => Boolean(window.metro.player.ridingCar), null, 30000);
  const car = await page.evaluate(() => window.metro.player.ridingCar.carNumber);
  await look(Math.PI / 2);
  await capture('live-02-boarded-interior', 'Normal RAF; real keyboard boarding and pointer look');
  await wait(() => { const service = window.metro.player.service; return service.state === 'departing' && service.speed === 0; });
  await capture('live-03-doors-closed', 'Normal RAF; genuine closed-door departure pause');
  await wait(() => { const service = window.metro.player.service; return service.completedLegs === 0 && service.distance > 8 && service.distance < 35; });
  await capture('live-04-visible-platform-departure', 'Normal RAF; actual accelerating consist');
  await wait(() => { const service = window.metro.player.service; return service.completedLegs === 0 && service.distance > 100 && service.distance < 160; });
  const tunnel = await capture('live-05-tunnel-riding', 'Normal RAF; actual tunnel journey');
  assert.equal(tunnel.riderCar, car);
  await wait(() => { const service = window.metro.player.service; return service.state === 'arriving' && service.distance > 210; });
  await capture('live-06-central-arrival', 'Normal RAF; genuine braking approach');
  await wait(() => { const service = window.metro.player.service; return service.currentStop.id === 'station-2' && service.canBoard && service.train.cars.every(car => car.doorProgressBySide[-1] > 0.99); });
  const stopped = await capture('live-07-central-open', 'Normal RAF; actual stop and doors');
  assert.equal(stopped.service.distance, 240); assert.equal(stopped.service.speed, 0); assert.equal(stopped.riderCar, car);
  await page.keyboard.press('e');
  await wait(() => !window.metro.player.ridingCar && window.metro.player.station.platformId === 'station-2:U1', null, 30000);
  const target = await page.evaluate(() => {
    const { player } = window.metro;
    const train = player.service.train;
    const end = player.camera.position.z < train.position.z ? -1 : 1;
    const dx = train.position.x - player.camera.position.x, dz = train.position.z + end * 24.8 - player.camera.position.z;
    return Math.atan2(-dx, -dz);
  });
  await look(target, -0.05);
  const alighted = await capture('live-08-central-exterior-after-alighting', 'Normal RAF; actual platform position after E alighting');
  assert.equal(alighted.riding, false); assert.equal(alighted.platform, 'station-2:U1');
  assert(alighted.frames > spawn.frames + 100);
}

try {
  if (mode !== 'ride') await scriptedAngles();
  if (mode !== 'angles') await liveRide();
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(`${output}/train-model-diagnostics.json`, JSON.stringify({ baseUrl, mode, viewport,
    inspectionModes: ['Explicit scripted angle/service diagnostics', 'Separate normal-RAF, real-input passenger journey'],
    errors, warnings, failedRequests, captures }, null, 2));
  console.log(`Train model production inspection complete: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/train-model-diagnostics.json`, JSON.stringify({ baseUrl, mode, errors, warnings, failedRequests, captures, failure: error.message, state: await sample().catch(() => null) }, null, 2));
  throw error;
} finally { await browser.close(); }
