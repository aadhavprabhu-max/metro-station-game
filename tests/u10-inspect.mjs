import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.METRO_U10_CAPTURE_DIR || '/tmp/metro-u10-visuals'; await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], failures = [], observations = [];
const selected = (process.env.METRO_U10_CAPTURE_NAMES || '').split(',').filter(Boolean);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => failures.push(r.url()));
  await page.goto(process.env.METRO_U10_URL || 'http://127.0.0.1:5174/app.html?line=U10', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.metro?.ready || !document.querySelector('#error').hidden, undefined, { timeout: 180000 });
  const error = await page.locator('#error-message').textContent(); if (error) throw new Error(error);
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  async function capture(name, stationId, position, target, trainView = false) {
    if (selected.length && !selected.includes(name)) return;
    const observation = await page.evaluate(({ stationId, position, target, trainView, name }) => {
      const { world, player } = window.metro, service = world.services.find(s => s.lineId === 'U10');
      const station = world.lineWorlds.U10.stations.find(s => s.stationId === stationId);
      const index = service.route.stops.findIndex(s => s.id === stationId);
      if (service.completedLegs > index) service.reset();
      while (service.completedLegs < index) service.update(0.25);
      service.update(2.5); service.dwellRemaining = 200;
      player.startAt('U10', stationId); world.update(0);
      const Vector3 = world.camera.position.constructor;
      const root = trainView ? service.train : station;
      const camera = root.localToWorld(new Vector3(...position)), look = root.localToWorld(new Vector3(...target));
      world.camera.position.copy(camera); const delta = look.sub(camera);
      player.yaw = Math.atan2(-delta.x, -delta.z); player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z)); player.applyLook();
      world.update(0.13); world.scene.updateMatrixWorld(true);
      const start = performance.now(); world.renderer.render(world.scene, world.camera);
      return { name, stationId, snapshot: window.metro.snapshot(), cpuSubmitMilliseconds: performance.now() - start,
        city: world.city.userData, botanical: world.lineWorlds.U10.stations[6].vegetation.userData, glError: world.renderer.getContext().getError() };
    }, { stationId, position, target, trainView, name });
    await page.screenshot({ path: `${directory}/${name}.png`, timeout: 180000 });
    observations.push(observation); console.log(JSON.stringify({ name, drawCalls: observation.snapshot.drawCalls, triangles: observation.snapshot.triangles, glError: observation.glError }));
  }
  await capture('01-central-express', 'station-2', [-6.6, 1.76, -31.5], [1.57, 1.5, -12]);
  await capture('02-finanzforum', 'u10-finanzforum', [-6.6, 1.76, -31.5], [1.57, 2, 0]);
  await capture('03-open-skyline-station', 'u10-skyline', [-5.5, 1.76, -32], [12, 15, 5]);
  await capture('04-express-front-three-quarter', 'u10-skyline', [-8, 2.8, -40], [0, 1.5, -21], true);
  await capture('05-express-side', 'u10-skyline', [-30, 3.5, -6], [0, 1.5, 0], true);
  await capture('06-open-metropol-station', 'u10-metropol', [-5, 1.76, -31], [18, 24, 0]);
  await capture('07-botanical-platform', 'u10-botanical', [-5.2, 1.76, -32], [7, 6, 4]);
  await capture('08-botanical-garden-path', 'u10-botanical', [-16, 1.76, -14], [-22, 5, 15]);
  await capture('09-botanical-architecture', 'u10-botanical', [-23, 6, 50], [12, 7, -20]);
  await capture('10-airport-arrival', 'u10-airport', [-6.6, 1.76, -31.5], [-16, 6, 15]);
  await capture('11-airport-terminal', 'u10-airport', [-45, 1.76, 0], [-140, 6, 0]);
  // A diagnostic exterior camera checks the complete terminal and approach.
  await capture('12-airport-complex', 'u10-airport', [90, 70, -250], [-130, 5, 0]);
  async function captureApproach(name, mode) {
    if (selected.length && !selected.includes(name)) return;
    const observation = await page.evaluate(mode => {
      const { world, player } = metro, service = world.services.find(s => s.lineId === 'U10'), route = service.route;
      let distance = route.length - 500;
      if (mode === 'transition') { distance = route.stops[3].distance; while (route.sample(distance).position.y < 12.5) distance += 2; }
      service.reset(); while (service.distance < distance) service.update(0.25);
      player.ridingCar = null; player.startAt('U10', service.currentStop.id);
      const car = service.train.cars[mode === 'transition' ? 0 : 1], Vector3 = world.camera.position.constructor;
      player.ridingCar = car; player.previousRideYaw = null; player.previousRidePitch = null;
      player.ridingLocalOffset.set(...(mode === 'transition' ? [0, 2.72, -6.9] : [-1.05, 1.85, -2.58]));
      player.ridingOffset.copy(player.ridingLocalOffset); car.localToWorld(player.ridingOffset); service.train.worldToLocal(player.ridingOffset);
      player.previousRideOffset.copy(player.ridingOffset); player.previousRidingCar = car; player.syncRide();
      const look = car.localToWorld(new Vector3(...(mode === 'transition' ? [0, 2.72, -60] : [-220, 8, -502.58]))).sub(player.camera.position);
      player.yaw = Math.atan2(-look.x, -look.z); player.pitch = Math.atan2(look.y, Math.hypot(look.x, look.z)); player.applyLook();
      world.update(0.13); world.renderer.render(world.scene, world.camera);
      return { mode, snapshot: metro.snapshot(), glError: world.renderer.getContext().getError(), diagnosticCamera: true };
    }, mode);
    await page.screenshot({ path: `${directory}/${name}.png`, timeout: 180000 }); observations.push({ name, ...observation });
    console.log(JSON.stringify({ name, drawCalls: observation.snapshot.drawCalls, triangles: observation.snapshot.triangles, glError: observation.glError }));
  }
  await captureApproach('13-driver-windscreen-transition', 'transition');
  await captureApproach('14-airport-approach-from-train', 'airport');
  await writeFile(`${directory}/inspection.json`, JSON.stringify({ errors, failures, observations }, null, 2));
  if (errors.length || failures.length || observations.some(o => o.glError)) throw new Error('Visual inspection reported a runtime, request or WebGL failure.');
} finally { await browser.close(); }
