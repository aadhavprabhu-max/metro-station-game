import { test, expect } from '@playwright/test';

let page; const errors = [];
test.describe('Phase 6 playable network', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const url = new URL(process.env.METRO_PRODUCTION_URL || 'http://127.0.0.1:5173/app.html');
    url.searchParams.set('line', 'U5'); url.searchParams.set('u5', 'scenic'); url.searchParams.set('tour', 'river'); url.searchParams.set('station', 'u5-altstadtbruecke');
    await page.goto(url.href, { timeout: 120000 });
    await page.waitForFunction(() => window.metro?.ready, { timeout: 120000 });
    await page.evaluate(() => { metro.world.renderer.setAnimationLoop(null); document.querySelector('#loading').hidden = true; });
  });
  test.afterEach(() => expect(errors).toEqual([]));
  test.afterAll(async () => { await page?.close(); });

  test('seven services, 55 physical platforms and real shared U9 interchanges', async () => {
    const result = await page.evaluate(() => ({ nodes: metro.world.network.nodes.size, platforms: metro.world.stations.length,
      services: metro.world.services.map(s => s.lineId), unique: new Set(metro.world.stations.map(s => s.platformId)).size,
      u9: metro.world.routes.U9.stops.map(s => s.name), finalU5: metro.world.routes.U5.stops.at(-1).name,
      transferIds: metro.world.networkTransfers.filter(t => t.platforms.some(s => s.lineId === 'U9')).map(t => t.stationId), gl: metro.world.renderer.getContext().getError() }));
    expect(result.nodes).toBe(45); expect(result.platforms).toBe(55); expect(result.unique).toBe(55);
    expect(result.services).toEqual(['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U9']);
    expect(result.u9).toEqual(['Central', 'Kaiserforum', 'Goldmarkt', 'Sonnenviertel', 'Nordklinikum', 'Hohenbrück', 'Kronenplatz', 'Waldtor']);
    expect(result.finalU5).toBe('Ostbahnhof'); expect(result.transferIds).toEqual(['station-2', 'u5-nordklinikum', 'u5-waldtor']); expect(result.gl).toBe(0);
    await expect(page.getByRole('link', { name: 'U5 · Original direct route', exact: true })).toBeVisible();
  });

  for (const line of ['U9', 'U5']) test(`${line}: full outbound/return journey, every stop, boarding and real car/bogie orientation`, async ({}, testInfo) => {
    test.setTimeout(180000);
    const result = await page.evaluate(line => {
      const { world, player } = metro, service = world.services.find(s => s.lineId === line), route = service.route, train = service.train;
      const Vector3 = train.position.constructor, Quaternion = train.quaternion.constructor;
      player.ridingCar = null; player.previousRidingCar = null; service.reset(); player.startAt(line);
      const visits = [], failures = []; let lastLeg = -1, boards = 0, exits = 0, seconds = 0, maxPoseError = 0, maxRiderError = 0, maxOrientationError = 0, bridgeSamples = 0;
      const check = (ok, text) => { if (!ok && failures.length < 15) failures.push(text); };
      for (let frame = 0; frame < 18000; frame++) {
        service.update(0.25); world.phase6World.authority.update(world.services.find(s => s.lineId === 'U5')); player.syncRide(); seconds += 0.25;
        if (service.canBoard && service.completedLegs !== lastLeg) {
          lastLeg = service.completedLegs; visits.push(service.currentStop.id);
          if (player.ridingCar) { check(player.interact() && !player.ridingCar, 'Cannot alight'); exits++; }
          check(service.speed === 0 && Math.abs(service.distance - service.currentStop.distance) < 1e-8, 'Incorrect stopping position');
          const station = world.stations.find(s => s.stationId === service.currentStop.id && s.lineId === line); check(Boolean(station), 'Missing real platform');
          player.useStation(station);
          const door = train.boardingDoors.find(d => d.carIndex === 1 && d.localZ === 0);
          const outward = new Vector3(door.side, 0, 0).transformDirection(train.cars[1].matrixWorld);
          player.camera.position.copy(door.position).addScaledVector(outward, 1.3); player.camera.position.y += 1.66;
          check(player.interact() && player.ridingCar === train.cars[1], `Cannot board ${station.displayName}`); boards++;
          if (service.completedLegs === (route.stops.length - 1) * 2) break;
          service.requestDeparture();
        }
        if (frame % 12 !== 0) continue;
        train.updateWorldMatrix(true, true);
        for (const car of train.cars) {
          const d = service.distance - car.userData.nominalRouteOffset, sample = route.sampleExtended(d);
          maxPoseError = Math.max(maxPoseError, car.getWorldPosition(new Vector3()).distanceTo(sample.position));
          const forward = new Vector3(0, 0, -1).applyQuaternion(car.getWorldQuaternion(new Quaternion()));
          maxOrientationError = Math.max(maxOrientationError, forward.distanceTo(sample.tangent));
          for (const bogie of car.bogies) maxPoseError = Math.max(maxPoseError, bogie.getWorldPosition(new Vector3()).distanceTo(route.sampleExtended(d - bogie.userData.localZ).position));
          check(car.doorProgressBySide[-service.platformSide] === 0, 'Wrong-side doors opened');
        }
        if (service.speed > 0) {
          check(train.doorsClosed, 'Moving with open doors'); check(!player.interact(), 'Could alight while moving');
          if (player.ridingCar) maxRiderError = Math.max(maxRiderError, player.camera.position.distanceTo(player.ridingCar.localToWorld(player.ridingLocalOffset.clone())));
          if (Math.abs(train.position.z + 433) < 4 && train.position.x > 1400 && train.position.x < 1800) bridgeSamples++;
        }
      }
      return { visits, expected: [...route.stops.map(s => s.id), ...route.stops.slice(0, -1).reverse().map(s => s.id)], failures, boards, exits, seconds, maxPoseError, maxRiderError, maxOrientationError, bridgeSamples };
    }, line);
    expect(result.failures).toEqual([]); expect(result.visits).toEqual(result.expected);
    expect(result.boards).toBe(result.expected.length); expect(result.exits).toBe(result.expected.length - 1);
    expect(result.maxPoseError).toBeLessThan(1e-7); expect(result.maxRiderError).toBeLessThan(1e-7); expect(result.maxOrientationError).toBeLessThan(1e-6);
    if (line === 'U5') expect(result.bridgeSamples).toBeGreaterThan(40);
    await testInfo.attach(`${line}-journey`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  });

  test('all three U9 interchanges support continuous walking in both directions', async ({}, testInfo) => {
    test.setTimeout(180000); const results = [];
    for (let index = 4; index < 7; index++) for (const reverse of [false, true]) {
      const result = await page.evaluate(({ index, reverse }) => {
        const { world, player } = metro, transfer = world.networkTransfers[index], start = transfer.platforms[reverse ? 1 : 0], end = index === 6 && !reverse ? -44 : 44;
        player.ridingCar = null; player.previousRidingCar = null; player.startAt(start.lineId, start.stationId);
        player.camera.position.copy(start.localToWorld(player.camera.position.clone().set(-5.8, 1.76, end - Math.sign(end) * 2.2)));
        player.transferSurface = null; player.keys.clear(); player.keys.add('KeyW'); player.keys.add('ShiftLeft');
        const target = transfer.platforms[reverse ? 0 : 1], targetEnd = index === 6 && reverse ? -44 : 44;
        const final = target.localToWorld(player.camera.position.clone().set(-5.8, 0, targetEnd - Math.sign(targetEnd) * 2.2));
        const path = [...(reverse ? [...transfer.walkingPath].reverse() : transfer.walkingPath), { x: final.x, y: final.y, z: final.z }];
        let maxStep = 0, frames = 0;
        for (const point of path) {
          let reached = false;
          for (let i = 0; i < 2000; i++) {
            player.yaw = Math.atan2(-(point.x - player.camera.position.x), -(point.z - player.camera.position.z)); player.applyLook();
            const before = player.camera.position.y; player.update(1 / 60); frames++; maxStep = Math.max(maxStep, Math.abs(player.camera.position.y - before));
            if (Math.hypot(player.camera.position.x - point.x, player.camera.position.z - point.z) < 0.14) { reached = true; break; }
          }
          if (!reached) throw new Error(`Blocked ${transfer.name}, reverse=${reverse}, toward ${point.x},${point.z}; at ${player.camera.position.toArray()}`);
        }
        player.keys.clear(); return { station: transfer.stationId, reverse, target: target.platformId, actual: player.station.platformId, feetY: player.camera.position.y - 1.76, expectedY: target.floorY, maxStep, frames };
      }, { index, reverse });
      expect(result.actual).toBe(result.target); expect(result.feetY).toBeCloseTo(result.expectedY, 5); expect(result.maxStep).toBeLessThanOrEqual(0.1875 + 1e-6); results.push(result);
    }
    await testInfo.attach('U9-walking-transfers', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  });

  test('both bridge crossings expose animated reflective water through closed train windows', async ({}, testInfo) => {
    const result = await page.evaluate(() => {
      const { world, player } = metro, service = world.services.find(s => s.lineId === 'U5'), branch = world.network.phase6.branch, values = [];
      player.ridingCar = null; player.startAt('U5', 'u5-altstadtbruecke');
      service.train.closeDoors(); service.train.update(2);
      for (const z of [-430, -436]) {
        let best = 0, error = Infinity;
        for (let d = 0; d < branch.length; d += 1) { const p = branch.sample(d).position, e = Math.hypot(p.x - 1600, p.z - z); if (e < error) { error = e; best = d; } }
        service.distance = branch.splitDistance + best; service.placeTrain();
        player.ridingCar = service.train.cars[1]; player.previousRidingCar = null; player.ridingLocalOffset.set(0.4, 1.85, 2.5);
        player.ridingOffset.copy(player.ridingLocalOffset); player.ridingCar.localToWorld(player.ridingOffset); service.train.worldToLocal(player.ridingOffset);
        player.previousRideYaw = null; player.previousRidePitch = null; player.yaw = 0; player.pitch = -0.1; player.syncRide(); player.applyLook();
        world.update(0.001); world.renderer.render(world.scene, world.camera);
        const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 50; const ctx = canvas.getContext('2d'); ctx.drawImage(world.renderer.domElement, 0, 0, 80, 50);
        const data = ctx.getImageData(0, 0, 80, 50).data; let variations = new Set(); for (let i = 0; i < data.length; i += 4) variations.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
        values.push({ z, water: world.phase6World.water.visible, eyeY: player.camera.position.y, doorsClosed: service.train.doorsClosed, colors: variations.size, waterY: branch.bridge.waterY, parapetTop: world.phase6World.bridge.userData.bridge.parapetTop });
      }
      const before = world.phase6World.water.material.uniforms.time.value; world.phase6World.update(1, player, world); return { values, animated: world.phase6World.water.material.uniforms.time.value > before, gl: world.renderer.getContext().getError() };
    });
    expect(result.animated).toBe(true); expect(result.gl).toBe(0);
    for (const view of result.values) { expect(view.water && view.doorsClosed).toBe(true); expect(view.colors).toBeGreaterThan(35); expect(view.eyeY).toBeGreaterThan(view.parapetTop + 1.5); }
    await page.screenshot({ path: testInfo.outputPath('bridge-first-person.png') });
    await testInfo.attach('bridge-views', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  });
});
