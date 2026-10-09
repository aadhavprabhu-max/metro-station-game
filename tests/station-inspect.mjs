import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Supplemental visual inspection only. Unlike u1-network-inspect.mjs, this
// pauses RAF, advances the real service in 1/60 s steps, and positions the
// inspection camera at every platform's original spawn offsets. It never assigns
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
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.services?.length === 4, null, { timeout: 120000 });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  const platforms = [
    { lineId: 'U1', stopId: 'station-1' },
    { lineId: 'U1', stopId: 'station-2' },
    { lineId: 'U1', stopId: 'station-3' },
    { lineId: 'U2', stopId: 'u2-stadtzentrum' },
    { lineId: 'U2', stopId: 'station-2' },
    { lineId: 'U2', stopId: 'u2-schwarzkopf' },
    { lineId: 'U2', stopId: 'u2-eisenwerk' },
    { lineId: 'U3', stopId: 'u3-schattenufer' },
    { lineId: 'U3', stopId: 'station-2' },
    { lineId: 'U3', stopId: 'u3-ostbahnhof' },
    { lineId: 'U3', stopId: 'u3-stadtbruecke' },
    { lineId: 'U4', stopId: 'u4-kaiser-humboldt' },
    { lineId: 'U4', stopId: 'u4-westbahnhof' },
    { lineId: 'U4', stopId: 'station-2' },
    { lineId: 'U4', stopId: 'u4-arabellapark' },
  ];
  for (const { lineId, stopId } of platforms) {
    const diagnostic = await page.evaluate(({ stopId, lineId }) => {
      const { player, world } = window.metro;
      const service = world.services.find(item => item.lineId === lineId);
      const station = world.stations.find(item => item.stationId === stopId && item.lineId === lineId);
      if (!station) throw new Error(`Missing inspection station: ${stopId}`);
      let reached = false;
      let simulatedSeconds = 0;
      for (let frame = 0; frame < 900 * 60; frame++) {
        if (service.currentStop.id === stopId && service.canBoard && service.train.cars.every(car => car.doorProgressBySide[service.platformSide] > 0.99)) {
          reached = true;
          break;
        }
        world.update(1 / 60);
        simulatedSeconds += 1 / 60;
      }
      if (!reached) throw new Error(`Service never reached ${stopId} with open doors.`);
      player.useStation(station);
      player.camera.position.set(-6.6, 1.76, -31.5);
      station.localToWorld(player.camera.position);
      const target = station.localToWorld(player.camera.position.clone().set(1.57, 1.76, -11.5));
      player.yaw = Math.atan2(-(target.x - player.camera.position.x), -(target.z - player.camera.position.z));
      player.pitch = -0.005;
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
        stationId: station.stationId, platformId: station.platformId, lineId: station.lineId,
        stationName: station.displayName, theme: station.theme ?? 'modern',
        simulatedSeconds, service: service.snapshot(),
        position: player.camera.position.toArray(), yaw: player.yaw, pitch: player.pitch,
        trainPosition: service.train.position.toArray(), carCount: service.train.cars.length,
        colored, glError: world.renderer.getContext().getError(), contextLost: world.renderer.getContext().isContextLost(),
        departures: station.departures.departures.map(row => ({ ...row })),
        hudLocation: document.querySelector('#location-name')?.textContent,
        hudLine: document.querySelector('#location-line')?.textContent,
        rockGeometry: station.rockShell ? { vertices: station.rockShell.geometry.attributes.position.count, ...station.rockShell.geometry.userData } : null,
        industrialArchitecture: station.userData.industrialArchitecture ?? null,
        architecture: station.architecture ?? station.userData.architecture ?? null,
        historicArchitecture: station.userData.historicArchitecture ?? null,
        floorY: station.floorY,
        drawCalls: world.renderer.info.render.calls,
        boardDataUrl: typeof boardCanvas?.toDataURL === 'function' ? boardCanvas.toDataURL('image/png') : null,
      };
    }, { stopId, lineId });
    assert.equal(diagnostic.glError, 0);
    assert.equal(diagnostic.contextLost, false);
    assert.equal(diagnostic.carCount, 3);
    assert.equal(diagnostic.service.state, 'boarding');
    assert.equal(diagnostic.service.currentStop.id, stopId);
    assert(diagnostic.colored > 900);
    assert.equal(diagnostic.hudLocation, diagnostic.stationName);
    assert.equal(diagnostic.hudLine, lineId);
    assert.deepEqual(errors, []);
    const filePrefix = `${stopId}-${lineId}`;
    await page.screenshot({ path: `${output}/${filePrefix}-overview.png` });
    const { boardDataUrl, ...metadata } = diagnostic;
    if (boardDataUrl) {
      await writeFile(`${output}/${filePrefix}-departures.png`, Buffer.from(boardDataUrl.split(',')[1], 'base64'));
    }
    captures.push(metadata);
    console.log(JSON.stringify({ captured: metadata.platformId, station: metadata.stationName, theme: metadata.theme, distance: metadata.service.distance, destination: metadata.service.destinationStop.name, colored: metadata.colored, boardCaptured: Boolean(boardDataUrl) }));
    if (['rock', 'ironworks'].includes(metadata.theme) || ['U3', 'U4'].includes(lineId)) {
      await page.evaluate(theme => {
        const { player, world } = window.metro;
        player.pitch = theme === 'modern-landmark' ? 0.45 : theme === 'historic-vaulted' ? 0.35 : 0.2;
        player.applyLook();
        world.renderer.render(world.scene, world.camera);
      }, metadata.theme);
      await page.screenshot({ path: `${output}/${filePrefix}-architecture.png` });
    }
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
