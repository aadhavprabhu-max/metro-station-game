import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Supplemental visual inspection only. Unlike u1-network-inspect.mjs, this
// pauses RAF, advances the real service in 1/60 s steps, and positions the
// inspection camera at each station's original spawn offsets. It never assigns
// train poses or route distances and does not prove normal-speed journey timing.
const url = process.env.METRO_URL || 'http://127.0.0.1:4173/metro-station-game/';
const output = process.env.METRO_STATION_OUTPUT || '/tmp/metro-station-overviews';
await mkdir(output, { recursive: true });
const args = ['--no-sandbox', '--disable-dev-shm-usage'];
if (process.env.SOFTWARE_WEBGL) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [], warnings = [], failedRequests = [], captures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning') warnings.push(message.text());
});
page.on('requestfailed', request => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.service.nextStop, null, { timeout: 120000 });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
  const look = await page.evaluate(() => {
    const { player, world } = window.metro;
    world.renderer.setAnimationLoop(null);
    return { yaw: player.yaw, pitch: player.pitch };
  });
  for (const stopId of ['station-2', 'station-3']) {
    const diagnostic = await page.evaluate(({ stopId, look }) => {
      const { player, world } = window.metro;
      const station = world.stations.find(item => item.stationId === stopId);
      if (!station) throw new Error(`Missing inspection station: ${stopId}`);
      let reached = false;
      let simulatedSeconds = 0;
      for (let frame = 0; frame < 180 * 60; frame++) {
        world.update(1 / 60);
        simulatedSeconds += 1 / 60;
        if (world.service.currentStop.id === stopId && world.service.canBoard && world.train.cars.every(car => car.doorProgress > 0.99)) {
          reached = true;
          break;
        }
      }
      if (!reached) throw new Error(`Service never reached ${stopId} with open doors.`);
      player.useStation(station);
      player.camera.position.set(-6.6 + station.position.x, 1.76 + station.position.y, -31.5 + station.position.z);
      player.yaw = look.yaw;
      player.pitch = look.pitch;
      player.applyLook();
      // Allow the modest-rate HUD to reflect the new inspection station.
      for (let frame = 0; frame < 9; frame++) world.update(1 / 60);
      world.update(0);
      world.renderer.render(world.scene, world.camera);
      const scratch = document.createElement('canvas'); scratch.width = scratch.height = 32;
      const ctx = scratch.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 32, 32);
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) colored++;
      const boardCanvas = station.departures.canvas ?? station.departures.texture?.image;
      return {
        stationId: station.stationId, stationName: station.displayName,
        simulatedSeconds, service: world.service.snapshot(),
        position: player.camera.position.toArray(), yaw: player.yaw, pitch: player.pitch,
        trainPosition: world.train.position.toArray(), carCount: world.train.cars.length,
        colored, glError: world.renderer.getContext().getError(), contextLost: world.renderer.getContext().isContextLost(),
        departures: station.departures.departures.map(row => ({ ...row })),
        hudLocation: document.querySelector('#location-name')?.textContent,
        boardDataUrl: typeof boardCanvas?.toDataURL === 'function' ? boardCanvas.toDataURL('image/png') : null,
      };
    }, { stopId, look });
    assert.equal(diagnostic.glError, 0);
    assert.equal(diagnostic.contextLost, false);
    assert.equal(diagnostic.carCount, 3);
    assert.equal(diagnostic.service.state, 'boarding');
    assert.equal(diagnostic.service.currentStop.id, stopId);
    assert(diagnostic.colored > 900);
    assert.equal(diagnostic.hudLocation, diagnostic.stationName);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${stopId}-overview.png` });
    const { boardDataUrl, ...metadata } = diagnostic;
    if (boardDataUrl) {
      await writeFile(`${output}/${stopId}-departures.png`, Buffer.from(boardDataUrl.split(',')[1], 'base64'));
    }
    captures.push(metadata);
    console.log(JSON.stringify({ captured: stopId, station: metadata.stationName, distance: metadata.service.distance, destination: metadata.service.destinationStop.name, colored: metadata.colored, boardCaptured: Boolean(boardDataUrl) }));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await writeFile(`${output}/station-diagnostics.json`, JSON.stringify({
    inspectionMode: 'Scripted service advancement and station overview camera; supplementary to the separate real-time journey.',
    url, errors, warnings, failedRequests, captures,
  }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/station-diagnostics.json`, JSON.stringify({ url, errors, warnings, failedRequests, captures, failure: error.message }, null, 2));
  throw error;
} finally {
  await browser.close();
}
