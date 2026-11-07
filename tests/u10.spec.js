import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

let page; const errors = [], requests = [];
test.describe('Phase 7 Airport Express', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(240000); page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('requestfailed', r => requests.push(r.url()));
    const url = new URL(process.env.METRO_PRODUCTION_URL || 'http://127.0.0.1:5173/app.html'); url.searchParams.set('line', 'U10');
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (process.env.METRO_PRODUCTION_URL) {
      const digest = bytes => createHash('sha256').update(bytes).digest('hex');
      const expected = digest(await readFile(new URL('../index.html', import.meta.url))), actual = digest(await response.body());
      expect(actual).toBe(expected);
      await writeFile(testInfo.outputPath('deployed-build-provenance.json'), JSON.stringify({ url: url.href, expectedSha256: expected, actualSha256: actual, sourceCommit: process.env.GITHUB_SHA ?? null }, null, 2));
    }
    await page.waitForFunction(() => window.metro?.ready || !document.querySelector('#error').hidden, undefined, { timeout: 180000 });
    expect(await page.locator('#error-message').textContent()).toBe('');
    await page.evaluate(() => { metro.world.renderer.setAnimationLoop(null); document.querySelector('#loading').hidden = true; });
  });
  test.afterEach(() => { expect(errors).toEqual([]); expect(requests).toEqual([]); });
  test.afterAll(async () => { await page?.close(); });

  test('the complete Phase 6 network is preserved alongside ten real U10 platforms', async () => {
    const baseline = JSON.parse(await readFile(new URL('./fixtures/phase6-network.json', import.meta.url), 'utf8'));
    const result = await page.evaluate(baseline => {
      const { world } = metro, failures = [];
      for (const [id, node] of baseline.nodes) {
        const actual = world.network.nodes.get(id);
        if (actual.name !== node.name || JSON.stringify(actual.position) !== JSON.stringify(node.position)) failures.push(id);
        for (const [line, platform] of Object.entries(node.platforms)) if (JSON.stringify(actual.platforms[line]) !== JSON.stringify(platform)) failures.push(`${id}:${line}`);
      }
      for (const [id, line] of baseline.lines) if (JSON.stringify(world.network.lines.get(id)) !== JSON.stringify(line)) failures.push(id);
      return { failures, nodes: world.network.nodes.size, platforms: world.stations.length, lines: world.services.map(s => s.lineId),
        outdoor: world.lineWorlds.U10.stations.filter(s => s.outdoor).length, color: world.routes.U10.line.color,
        first: world.routes.U10.stops[0].name, last: world.routes.U10.stops.at(-1).name, centralY: world.routes.U10.stops[0].floorY,
        transfers: world.networkTransfers.filter(t => t.platforms.some(s => s.lineId === 'U10')).map(t => t.platformIds) };
    }, baseline);
    expect(result.failures).toEqual([]); expect(result.nodes).toBe(53); expect(result.platforms).toBe(65);
    expect(result.lines).toEqual(['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U9', 'U10']);
    expect(result.outdoor).toBe(4); expect(result.color).toBe('#123B75'); expect(result.first).toBe('Central'); expect(result.centralY).toBe(-72);
    expect(result.last).toBe('Aurealis International Airport');
    expect(result.transfers).toEqual([['station-2:U9', 'station-2:U10'], ['u6-ringplatz:U6', 'u6-ringplatz:U10']]);
  });

  test('actual express meshes complete the return journey with measured timings, aligned bogies and working boarding', async ({}, testInfo) => {
    test.setTimeout(300000);
    const result = await page.evaluate(() => {
      const { world, player } = metro, service = world.services.find(s => s.lineId === 'U10'), train = service.train, route = service.route;
      const Vector3 = train.position.constructor, Quaternion = train.quaternion.constructor;
      service.reset(); player.ridingCar = null; player.startAt('U10');
      const failures = [], arrivals = [], timings = []; let tick = 0, departureTick = null, moving = false, lastBoard = -1, boards = 0, exits = 0, maxError = 0, maxOrientationError = 0, maxRiderError = 0;
      const check = (condition, message) => { if (!condition && failures.length < 20) failures.push(message); };
      while (service.completedLegs < 18 && tick < 200000) {
        const previousLegs = service.completedLegs; service.update(1 / 60); tick++; player.syncRide();
        if (service.speed > 0 && !moving) { departureTick = tick; moving = true; }
        if (service.completedLegs !== previousLegs) { timings.push((tick - departureTick) / 60); arrivals.push(service.currentStop.id); moving = false; }
        if (service.canBoard && lastBoard !== service.completedLegs) {
          lastBoard = service.completedLegs;
          if (player.ridingCar) { check(player.interact(), 'Could not alight'); exits++; }
          const station = world.stations.find(s => s.lineId === 'U10' && s.stationId === service.currentStop.id); player.useStation(station);
          const door = train.boardingDoors.find(d => d.carIndex === 1 && d.localZ === 0);
          const outward = new Vector3(door.side, 0, 0).transformDirection(train.cars[1].matrixWorld);
          player.camera.position.copy(door.position).addScaledVector(outward, 1.3); player.camera.position.y += 1.66;
          check(player.interact() && Boolean(player.ridingCar), `Could not board ${station.displayName}`); boards++;
        }
        if (service.speed > 0) { check(train.doorsClosed, 'Open doors while moving'); check(!player.interactionHint().enabled, 'Alighting enabled while moving'); }
        if (tick % 120) continue;
        for (const car of train.cars) {
          const pose = route.sampleExtended(service.distance - car.userData.nominalRouteOffset);
          maxError = Math.max(maxError, car.getWorldPosition(new Vector3()).distanceTo(pose.position));
          maxOrientationError = Math.max(maxOrientationError, new Vector3(0, 0, -1).applyQuaternion(car.getWorldQuaternion(new Quaternion())).distanceTo(pose.tangent));
          for (const bogie of car.bogies) maxError = Math.max(maxError, bogie.getWorldPosition(new Vector3()).distanceTo(route.sampleExtended(service.distance - car.userData.nominalRouteOffset - bogie.userData.localZ).position));
        }
        if (player.ridingCar) maxRiderError = Math.max(maxRiderError, player.camera.position.distanceTo(player.ridingCar.localToWorld(player.ridingLocalOffset.clone())));
      }
      const expectedTimings = world.u10Timetable.data.directions.flatMap(d => d.segments.map(s => s.seconds));
      return { failures, arrivals, expected: [...route.stops.slice(1).map(s => s.id), ...route.stops.slice(0, -1).reverse().map(s => s.id)], timings, expectedTimings, boards, exits, maxError, maxOrientationError, maxRiderError,
        distinctCabs: [train.cars[0], train.cars[2]].every(c => c.cabs[0].shellMetadata.aerodynamic && c.cabs[0].shellMetadata.noseLength === 4.45), dwell: world.u10Timetable.data.directions.map(d => d.passengerDwellSeconds) };
    });
    expect(result.failures).toEqual([]); expect(result.arrivals).toEqual(result.expected); expect(result.timings).toEqual(result.expectedTimings);
    expect(result.boards).toBe(18); expect(result.exits).toBe(17); expect(result.maxError).toBeLessThan(1e-7);
    expect(result.maxOrientationError).toBeLessThan(1e-7); expect(result.maxRiderError).toBeLessThan(1e-7); expect(result.distinctCabs).toBe(true); expect(result.dwell).toEqual([160, 160]);
    await testInfo.attach('measured-actual-mesh-journey', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  });

  test('Central and Ringplatz support keyboard transfers both ways and continuous lift rides', async ({}, testInfo) => {
    test.setTimeout(240000); const reports = [];
    for (const stationId of ['station-2', 'u6-ringplatz']) for (const reverse of [false, true]) {
      await page.evaluate(({ stationId, reverse }) => {
        const { world, player } = metro, transfer = world.networkTransfers.find(t => t.stationId === stationId && t.platforms.some(s => s.lineId === 'U10'));
        const station = transfer.platforms[reverse ? 1 : 0], end = stationId === 'station-2' ? -44 : 44;
        player.ridingCar = null; player.startAt(station.lineId, stationId); player.camera.position.set(-5.8, 1.76, end - Math.sign(end) * 2.2); station.localToWorld(player.camera.position);
        player.transferSurface = null; world.renderer.domElement.focus();
      }, { stationId, reverse });
      await page.keyboard.down('w');
      try {
        reports.push(await page.evaluate(({ stationId, reverse }) => {
          const { world, player } = metro, transfer = world.networkTransfers.find(t => t.stationId === stationId && t.platforms.some(s => s.lineId === 'U10'));
          const target = transfer.platforms[reverse ? 0 : 1], end = stationId === 'station-2' ? -44 : 44;
          const final = target.localToWorld(player.camera.position.clone().set(-5.8, 0, end - Math.sign(end) * 2.2));
          const path = reverse ? [...transfer.walkingPath].reverse() : [...transfer.walkingPath]; path.push({ x: final.x, y: final.y, z: final.z });
          let maxStep = 0, frames = 0;
          for (const point of path) for (let i = 0; i < 3000; i++) {
            const dx = point.x - player.camera.position.x, dz = point.z - player.camera.position.z;
            if (Math.hypot(dx, dz) < 0.12 && Math.abs(player.camera.position.y - point.y - 1.76) < 0.4) break;
            const before = player.camera.position.clone(); player.yaw = Math.atan2(-dx, -dz); player.applyLook(); player.update(1 / 60); frames++;
            maxStep = Math.max(maxStep, Math.abs(before.y - player.camera.position.y));
            if (before.distanceTo(player.camera.position) < 1e-8 || i === 2999) throw new Error(`Blocked ${transfer.name} toward ${JSON.stringify(point)} at ${player.camera.position.toArray()}`);
          }
          return { stationId, reverse, actual: player.station.platformId, expected: target.platformId, maxStep, frames, feet: player.camera.position.y - 1.76, expectedY: target.floorY };
        }, { stationId, reverse }));
      } finally { await page.keyboard.up('w'); }
    }
    for (const report of reports) { expect(report.actual).toBe(report.expected); expect(report.feet).toBeCloseTo(report.expectedY, 5); expect(report.maxStep).toBeLessThan(0.2); }
    const lifts = await page.evaluate(() => {
      const { world, player } = metro, values = [];
      for (const lift of world.networkTransfers.filter(t => t.platforms.some(s => s.lineId === 'U10')).flatMap(t => t.lifts)) {
        const start = lift.transfer.platforms[0]; player.ridingCar = null; player.startAt(start.lineId, start.stationId);
        player.camera.position.set(-5.3, lift.topY + 1.76, 12.5); lift.group.localToWorld(player.camera.position); player.update(0);
        const activated = lift.activate(player); let maxStep = 0, frames = 0;
        while (lift.rider && frames++ < 3000) { const before = player.camera.position.y; lift.update(1 / 60); maxStep = Math.max(maxStep, Math.abs(before - player.camera.position.y)); }
        values.push({ activated, floor: player.camera.position.y - 1.76, expected: lift.bottomY, enabled: player.enabled, maxStep });
      } return values;
    });
    await testInfo.attach('physical-transfers-and-lifts', { body: JSON.stringify({ reports, lifts }, null, 2), contentType: 'application/json' });
    expect(lifts).toHaveLength(3); for (const lift of lifts) { expect(lift.activated && lift.enabled).toBe(true); expect(lift.floor).toBeCloseTo(lift.expected, 5); expect(lift.maxStep).toBeLessThan(0.05); }
  });

  test('journey panel displays measured segment times, separate dwell and both waiting directions', async () => {
    await page.evaluate(() => { metro.player.ridingCar = null; metro.player.startAt('U10'); metro.world.update(0.2); });
    await page.getByRole('button', { name: 'U10 journey times', exact: true }).click();
    await expect(page.locator('#u10-timings')).toHaveAttribute('open', '');
    expect(await page.locator('.timing-segment').count()).toBe(18); expect(await page.locator('.timing-dwell').count()).toBe(16);
    await expect(page.locator('#u10-timings')).toContainText('Total one-way journey = 918.67 seconds');
    await page.getByRole('combobox', { name: 'U10 waiting-time station' }).selectOption('u10-finanzforum');
    await page.evaluate(() => metro.world.update(0.2));
    await expect(page.locator('#u10-live-wait')).toContainText('Central:'); await expect(page.locator('#u10-live-wait')).toContainText('Aurealis International Airport:');
    await expect(page.locator('#network-map [data-line="U10"]')).toContainText('open elevated');
    await page.locator('#close-help').click();
  });

  test('open platforms expose sky, the botanical collection is real 3D and the city survives switching back to Phase 6', async ({}, testInfo) => {
    test.setTimeout(300000);
    const result = await page.evaluate(() => {
      const { world, player } = metro, Vector3 = world.camera.position.constructor, values = [];
      for (const station of world.lineWorlds.U10.stations.filter(s => s.outdoor)) {
        player.startAt('U10', station.stationId); const a = station.localToWorld(new Vector3(-2, 2.5, station.definition.design === 'skyline' ? -11 : 1));
        let enclosingWalls = 0; station.architectureGroup.traverse(mesh => { if (mesh.isMesh && mesh.name === 'FamilyWaterfrontClerestory') enclosingWalls++; });
        values.push({ station: station.displayName, openSides: station.userData.architecture.actualOpenSides, enclosingWalls });
      }
      const botanical = world.lineWorlds.U10.stations.find(s => s.stationId === 'u10-botanical'); player.startAt('U10', botanical.stationId); world.update(0.2); world.renderer.render(world.scene, world.camera);
      const plants = botanical.vegetation.userData, exposed = { city: world.city.visible, far: world.camera.far, fogFar: world.scene.fog.far, calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles };
      const botanicalImage = world.renderer.domElement.toDataURL('image/png');
      player.startAt('U5', 'u5-altstadtbruecke'); world.update(0.2);
      const river = { city: world.city.visible, phase6: world.phase6World.visible, far: world.camera.far, fogFar: world.scene.fog.far };
      player.startAt('U1'); world.update(0.2);
      return { values, plants, exposed, river, originalFar: world.camera.far, originalFogFar: world.scene.fog.far, city: world.city.userData, gl: world.renderer.getContext().getError(), botanicalImage };
    });
    expect(result.values).toHaveLength(4); for (const station of result.values) { expect(station.openSides).toBe(true); expect(station.enclosingWalls).toBe(0); }
    expect(result.plants.actual3DPlants).toBe(true); expect(result.plants.treeCount).toBeGreaterThanOrEqual(40); expect(result.plants.species.length).toBeGreaterThanOrEqual(8);
    expect(result.exposed.city).toBe(true); expect(result.exposed.far).toBe(8500); expect(result.exposed.fogFar).toBe(7000);
    expect(result.river.city).toBe(false); expect(result.river.phase6).toBe(true); expect(result.river.far).toBe(2300); expect(result.river.fogFar).toBe(1900);
    expect(result.originalFar).toBe(180); expect(result.originalFogFar).toBe(125); expect(result.city.buildingCount).toBeGreaterThan(10000); expect(result.gl).toBe(0);
    await writeFile(testInfo.outputPath('phase7-botanical-render.png'), Buffer.from(result.botanicalImage.split(',')[1], 'base64')); delete result.botanicalImage;
    await testInfo.attach('botanical-city-and-regression', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  });
});
