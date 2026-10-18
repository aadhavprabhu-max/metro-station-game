import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// First section uses ordinary RAF and real keyboard/pointer input. The second
// explicitly pauses RAF for a labelled camera-only exterior curve inspection.
const out = process.env.METRO_LIVE_OUTPUT || '/tmp/metro-network-live';
const curveOnly = process.argv.includes('--curve-only');
const url = new URL(process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/');
url.searchParams.set('line', 'U5');
await mkdir(out, { recursive: true });
const args = ['--no-sandbox', '--disable-dev-shm-usage'];
if (process.env.SOFTWARE_WEBGL) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [], failedRequests = [], captures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => failedRequests.push(request.url()));
page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });
const waitLimit = Number(process.env.METRO_LIVE_TIMEOUT_MS) || (process.env.SOFTWARE_WEBGL ? 900000 : 240000);
const wait = (predicate, argument = null, timeout = waitLimit) => page.waitForFunction(predicate, argument, { timeout, polling: 100 });
let before = null, after = null;
async function capture(name, mode) {
  const state = await page.evaluate(() => ({ ...window.metro.snapshot(), frames: window.metro.frames, hidden: document.hidden, gl: window.metro.world.renderer.getContext().getError() }));
  assert.equal(state.gl, 0); assert.equal(state.status, 'running'); assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/${name}.png` }); captures.push({ name, mode, ...state });
  console.log(JSON.stringify({ captured: name, mode, station: state.currentStation, service: state.service, frames: state.frames, hidden: state.hidden }));
}
async function turnTo(yaw) {
  const current = await page.evaluate(() => window.metro.player.yaw);
  const change = Math.atan2(Math.sin(yaw - current), Math.cos(yaw - current));
  await page.mouse.move(200, 240); await page.mouse.down();
  await page.mouse.move(200 - change / 0.0028, 240, { steps: 3 }); await page.mouse.up();
}
try {
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await wait(() => window.metro?.ready && window.metro.world.services.length === 6);
  await capture('01-westbahnhof', 'normal RAF');
  if (!curveOnly) {
    const target = await page.evaluate(() => {
      const { player } = window.metro, door = player.service.train.nearestBoardingDoor(player.camera.position.x, player.camera.position.z);
      const local = player.station.worldToLocal(door.position.clone()); local.set(-1.2, 1.76, local.z); player.station.localToWorld(local);
      return { x: local.x, z: local.z, yaw: Math.atan2(-(local.x - player.camera.position.x), -(local.z - player.camera.position.z)) };
    });
    await turnTo(target.yaw); await page.keyboard.down('w');
    try { await wait(() => window.metro.player.interactionHint().enabled); }
    finally { await page.keyboard.up('w'); }
    await wait(() => window.metro.player.interactionHint().enabled);
    await page.keyboard.press('e'); await wait(() => Boolean(window.metro.player.ridingCar));
    before = await page.evaluate(() => ({ frames: window.metro.frames, position: window.metro.player.camera.position.toArray(), line: window.metro.player.service.lineId }));
    assert.equal(before.line, 'U5');
    const yaw = await page.evaluate(() => { const m = window.metro.player.ridingCar.matrixWorld.elements; return Math.atan2(m[8], m[10]) + Math.PI; });
    await turnTo(yaw); await capture('02-boarded', 'normal RAF / keyboard boarding');
    await wait(() => window.metro.player.service.speed > 1);
    await capture('03-departing', 'normal RAF');
    await wait(() => window.metro.player.service.distance > 90 && window.metro.player.service.speed > 1);
    await capture('04-riding', 'normal RAF');
    await wait(() => window.metro.player.service.currentStop.id === 'u5-suedstadt' && window.metro.player.service.canBoard);
    await capture('05-arrival', 'normal RAF');
    await page.keyboard.press('e'); await wait(() => !window.metro.player.ridingCar);
    await capture('06-alighted', 'normal RAF / keyboard alighting');
    after = await page.evaluate(() => ({ frames: window.metro.frames, station: window.metro.player.station.stationId, feetY: window.metro.player.camera.position.y - 1.76, walk: window.metro.player.distanceTravelled }));
    assert.equal(after.station, 'u5-suedstadt'); assert.equal(after.feetY, -24); assert(after.frames > before.frames + 30);
  }
  // Supplemental actual train/tunnel view, not a real-time journey claim.
  const curve = await page.evaluate(() => {
    const { world, player } = window.metro, service = player.service;
    world.renderer.setAnimationLoop(null);
    const target = service.route.stops[3].distance + 140;
    for (let i = 0; i < 900 * 60 && service.distance < target; i++) service.update(1 / 60);
    if (service.distance < target) throw new Error('Train did not reach the curve.');
    const pose = service.route.sampleExtended(service.distance + 37), look = service.train.cars[0].localToWorld(service.train.position.clone().set(0, 1.6, -8.6));
    player.camera.position.copy(pose.position); player.camera.position.x -= Math.cos(pose.yaw) * 1.7; player.camera.position.z += Math.sin(pose.yaw) * 1.7; player.camera.position.y += 1.76;
    player.camera.lookAt(look); world.visibility.update(player); world.renderer.render(world.scene, world.camera);
    return { distance: service.distance, yaw: service.train.rotation.y, carYaws: service.train.cars.map(car => car.rotation.y), gl: world.renderer.getContext().getError() };
  });
  assert.equal(curve.gl, 0); assert(new Set(curve.carYaws.map(yaw => yaw.toFixed(4))).size > 1);
  await capture('07-curve-exterior', 'scripted real-service advance / inspection camera');
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ curveOnly, before, after, curve, captures, errors, failedRequests }, null, 2));
} catch (error) {
  const state = await page.evaluate(() => ({ snapshot: window.metro?.snapshot(), frames: window.metro?.frames, hidden: document.hidden })).catch(() => null);
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.stack, state, captures, errors, failedRequests }, null, 2));
  await page.screenshot({ path: `${out}/failure.png`, timeout: 60000 }).catch(() => {});
  throw error;
} finally { await browser.close(); }
