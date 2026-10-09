import { test, expect } from '@playwright/test';

const lines = {
  U3: {
    ids: ['u3-schattenufer', 'station-2', 'u3-ostbahnhof', 'u3-stadtbruecke'],
    names: ['Schattenufer', 'Central', 'Ostbahnhof', 'Stadtbrücke'],
    distances: [0, 390, 630, 870], x: 1.57, startZ: 150, side: -1, color: '3e71b6', platform: '03',
  },
  U4: {
    ids: ['u4-kaiser-humboldt', 'u4-westbahnhof', 'station-2', 'u4-arabellapark'],
    names: ['Kaiser-Humboldt-Platz', 'Westbahnhof', 'Central', 'Arabellapark'],
    distances: [0, 240, 480, 720], x: -23.57, startZ: 240, side: 1, color: '8d58ac', platform: '04',
  },
};
const errorsByPage = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?line=U3');
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.services?.length === 4);
});

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page)).toEqual([]);
});

test('four services share Central while lower platforms, palettes, and original operating settings stay independent', async ({ page }) => {
  const data = await page.evaluate(() => {
    const { world } = window.metro;
    world.renderer.setAnimationLoop(null);
    const central = world.network.nodes.get('station-2');
    return {
      nodeCount: world.network.nodes.size, stationCount: world.stations.length,
      lineIds: [...world.network.lines.keys()], centralLines: [...central.lineIds],
      centralPlatforms: world.stations.filter(station => station.stationId === 'station-2').map(station => ({
        id: station.platformId, line: station.lineId, shared: station.networkNode === central,
        floorY: station.getWorldPosition(world.camera.position.clone()).y,
        level: station.level, platform: station.platformNumber,
      })),
      routes: Object.fromEntries(Object.entries(world.routes).map(([id, route]) => [id, {
        ids: route.stops.map(stop => stop.id), names: route.stops.map(stop => stop.name),
        distances: route.stops.map(stop => stop.distance),
        samples: [0, route.length / 4, route.length / 2, route.length].map(distance => ({
          distance, position: route.sample(distance).position.toArray(), yaw: route.sample(distance).yaw,
        })),
      }])),
      palettes: world.trains.map(train => ({ line: train.lineId, accent: train.materials.trainAccent.color.getHexString(), material: train.materials.trainAccent.uuid })),
      configs: world.services.slice(0, 2).map(service => ({
        line: service.lineId, maxSpeed: service.maxSpeed, acceleration: service.acceleration,
        braking: service.braking, initialDwell: service.initialDwell, dwell: service.dwellDuration,
        closing: service.closingDuration, departurePause: service.departurePause,
        stopPause: service.stopPause, deferReversal: service.deferReversal,
      })),
      snapshots: world.services.map(service => service.snapshot()),
      trainPositions: world.trains.map(train => train.position.toArray()),
    };
  });
  expect(data.nodeCount).toBe(12);
  expect(data.stationCount).toBe(15);
  expect(data.lineIds).toEqual(['U1', 'U2', 'U3', 'U4']);
  expect(data.centralLines).toEqual(data.lineIds);
  expect(data.centralPlatforms).toHaveLength(4);
  for (const platform of data.centralPlatforms) {
    expect(platform.shared).toBe(true);
    expect(platform.id).toBe(`station-2:${platform.line}`);
    expect(platform.floorY).toBe(['U1', 'U2'].includes(platform.line) ? 0 : -12);
    expect(platform.platform).toBe({ U1: '01', U2: '02', U3: '03', U4: '04' }[platform.line]);
  }
  expect(data.palettes.map(palette => palette.accent)).toEqual(['316c65', 'b4443d', '3e71b6', '8d58ac']);
  expect(new Set(data.palettes.map(palette => palette.material)).size).toBe(4);
  expect(data.configs).toEqual([
    { line: 'U1', maxSpeed: 10, acceleration: 0.9, braking: 1.1, initialDwell: 30, dwell: 20, closing: 1.5, departurePause: 1.5, stopPause: 1, deferReversal: false },
    { line: 'U2', maxSpeed: 10, acceleration: 0.9, braking: 1.1, initialDwell: 40, dwell: 20, closing: 1.5, departurePause: 1.5, stopPause: 1, deferReversal: true },
  ]);
  expect(data.routes.U1.ids).toEqual(['station-1', 'station-2', 'station-3']);
  expect(data.routes.U1.distances).toEqual([0, 240, 480]);
  expect(data.routes.U2.ids).toEqual(['u2-stadtzentrum', 'station-2', 'u2-schwarzkopf', 'u2-eisenwerk']);
  expect(data.routes.U2.distances).toEqual([0, 240, 480, 720]);
  for (const [id, definition] of Object.entries(lines)) {
    expect(data.routes[id].ids).toEqual(definition.ids);
    expect(data.routes[id].names).toEqual(definition.names);
    expect(data.routes[id].distances).toEqual(definition.distances);
    for (const sample of data.routes[id].samples) {
      expect(sample.position).toEqual([definition.x, -12, definition.startZ - sample.distance]);
      expect(sample.yaw).toBe(0);
    }
    await page.locator(`#start-${id.toLowerCase()}-button`).click();
    await expect(page.locator('#location-line')).toHaveText(id);
    await expect(page.locator('#service-label')).toHaveText(`${id} LIVE SERVICE`);
  }
  const after = await page.evaluate(() => ({ snapshots: window.metro.world.services.map(service => service.snapshot()), trainPositions: window.metro.world.trains.map(train => train.position.toArray()) }));
  expect(after.snapshots).toEqual(data.snapshots);
  expect(after.trainPositions).toEqual(data.trainPositions);
});

for (const [lineId, definition] of Object.entries(lines)) {
  test(`${lineId} completes six continuous legs on its lower rails with synchronized cars and closed moving doors`, async ({ page }) => {
    const result = await page.evaluate(({ lineId }) => {
      const { world } = window.metro;
      world.renderer.setAnimationLoop(null);
      const service = world.services.find(item => item.lineId === lineId);
      const train = service.train;
      const otherBefore = world.services.filter(item => item !== service).map(item => JSON.stringify(item.snapshot()));
      const requested = service.requestDeparture();
      service.update(0.25);
      const independent = world.services.filter(item => item !== service).every((item, index) => JSON.stringify(item.snapshot()) === otherBefore[index]);
      const offsets = train.cars.map(car => car.position.toArray());
      const stops = [], faults = [], states = new Set();
      let previousDistance = service.distance, previousSpeed = service.speed, maxStep = 0, maxSpeedChange = 0, closedPause = 0, recorded = 0;
      const check = (value, message) => { if (!value && faults.length < 12) faults.push(message); };
      for (let frame = 0; frame < 900 * 60; frame++) {
        world.update(1 / 60);
        states.add(service.state);
        const sample = service.route.sample(service.distance);
        maxStep = Math.max(maxStep, Math.abs(service.distance - previousDistance));
        maxSpeedChange = Math.max(maxSpeedChange, Math.abs(service.speed - previousSpeed));
        check(train.position.distanceTo(sample.position) < 1e-7 && train.rotation.y === sample.yaw, 'Train left its sampled rails.');
        check(train.position.y === -12, 'Lower train changed elevation.');
        check(service.distance >= 0 && service.distance <= service.route.length, 'Train left its route.');
        check(train.cars.every((car, index) => car.position.toArray().every((value, axis) => value === offsets[index][axis])), 'Cars separated.');
        check(train.cars.every(car => car.doorProgressBySide[-service.platformSide] === 0), 'Track-side doors opened.');
        if (service.speed > 0) {
          check(train.cars.every(car => Object.values(car.doorProgressBySide).every(progress => progress === 0)), 'Moving doors opened.');
          check(train.direction === service.direction && service.cabDirection === service.direction && !service.reversalPending, 'Cab reversed while open or after movement started.');
        }
        if (service.state === 'departing' && service.speed === 0 && train.doorsClosed) closedPause += 1 / 60;
        previousDistance = service.distance; previousSpeed = service.speed;
        if (service.completedLegs > recorded && service.state === 'boarding') {
          recorded = service.completedLegs;
          stops.push({
            id: service.currentStop.id, distance: service.distance, speed: service.speed,
            direction: service.direction, terminal: service.destinationStop.id, next: service.nextStop.id,
            cabDirection: service.cabDirection, reversalPending: service.reversalPending,
            displays: train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => ({ line: display.userData.lineId, destination: display.userData.destination }))),
            destinationName: service.destinationStop.name,
          });
          if (recorded === 6) { for (let i = 0; i < 120; i++) world.update(1 / 60); break; }
        }
      }
      return { requested, independent, faults, states: [...states], offsets, maxStep, maxSpeedChange, closedPause, stops,
        finalDistance: service.distance, finalSpeed: service.speed, doors: train.cars.map(car => ({ ...car.doorProgressBySide })),
        completed: world.services.map(item => ({ line: item.lineId, legs: item.completedLegs })), glError: world.renderer.getContext().getError() };
    }, { lineId });
    expect(result.requested && result.independent).toBe(true);
    expect(result.faults).toEqual([]);
    expect(result.states).toEqual(expect.arrayContaining(['closing', 'departing', 'travelling', 'arriving', 'stopped', 'boarding']));
    expect(result.offsets.map(position => position[2])).toEqual([-17, 0, 17]);
    expect(result.maxStep).toBeLessThanOrEqual(10 / 60 + 1e-6);
    expect(result.maxSpeedChange).toBeLessThanOrEqual(1.1 / 60 + 1e-6);
    expect(result.closedPause).toBeGreaterThan(6);
    const indices = [1, 2, 3, 2, 1, 0];
    expect(result.stops.map(stop => stop.id)).toEqual(indices.map(index => definition.ids[index]));
    expect(result.stops.map(stop => stop.distance)).toEqual(indices.map(index => definition.distances[index]));
    expect(result.stops.map(stop => stop.direction)).toEqual([1, 1, -1, -1, -1, 1]);
    expect(result.stops.map(stop => stop.terminal)).toEqual([3, 3, 0, 0, 0, 3].map(index => definition.ids[index]));
    expect(result.stops.map(stop => stop.next)).toEqual([2, 3, 2, 1, 0, 1].map(index => definition.ids[index]));
    expect(result.stops.map(stop => stop.cabDirection)).toEqual([1, 1, 1, -1, -1, -1]);
    expect(result.stops.map(stop => stop.reversalPending)).toEqual([false, false, true, false, false, true]);
    for (const stop of result.stops) {
      expect(stop.speed).toBe(0);
      expect(stop.displays.length).toBeGreaterThanOrEqual(8);
      expect(stop.displays.every(display => display.line === lineId && display.destination === stop.destinationName)).toBe(true);
    }
    expect(result.doors.every(door => door[definition.side] > 0.99 && door[-definition.side] === 0)).toBe(true);
    expect(result.finalDistance).toBe(0);
    expect(result.finalSpeed).toBe(0);
    expect(result.completed.every(item => item.legs >= 4)).toBe(true);
    expect(result.glError).toBe(0);
  });

  test(`${lineId} carries a rider through all stations, permits safe alighting, and preserves reset`, async ({ page }) => {
    await page.locator(`#start-${lineId.toLowerCase()}-button`).click();
    const firstCar = await page.evaluate(() => {
      const { world, player } = window.metro;
      world.renderer.setAnimationLoop(null);
      const train = player.service.train;
      player.camera.position.set(player.service.platformSide * (1.397 + 1.3), 1.76, train.cars[0].position.z);
      train.localToWorld(player.camera.position);
      world.update(0);
      return train.cars[0].carNumber;
    });
    await page.keyboard.press('e');
    expect(await page.evaluate(() => window.metro.player.ridingCar?.carNumber)).toBe(firstCar);
    const result = await page.evaluate(({ ids }) => {
      const { world, player } = window.metro;
      const service = player.service, car = player.ridingCar;
      if (!car) throw new Error('Initial lower-platform boarding failed.');
      const stops = [];
      let transformError = 0, deniedMovingExit = false;
      for (const id of [ids[1], ids[2], ids[3], ids[2], ids[1], ids[0]]) {
        let reached = false;
        for (let frame = 0; frame < 180 * 60; frame++) {
          world.update(1 / 60);
          transformError = Math.max(transformError, service.train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset));
          if (service.speed > 2 && !deniedMovingExit) deniedMovingExit = !player.interact();
          if (service.currentStop.id === id && service.canBoard) { reached = true; break; }
        }
        if (!reached) throw new Error(`Service did not reach ${id}.`);
        const sameCar = player.ridingCar === car;
        const left = player.interact();
        const station = player.station, local = station.worldToLocal(player.camera.position.clone());
        const reboarded = player.interact();
        stops.push({ id: station.stationId, platformId: station.platformId, line: station.lineId,
          feetY: player.camera.position.y - 1.85, local: local.toArray(), bounds: { ...station.bounds },
          left, reboarded, sameCar, sameCarAfterBoard: player.ridingCar === car });
      }
      const before = world.services.map(item => item.snapshot());
      player.reset();
      return { stops, transformError, deniedMovingExit, before, after: world.services.map(item => item.snapshot()),
        resetLine: player.service.lineId, resetId: player.station.stationId,
        resetLocal: player.station.worldToLocal(player.camera.position.clone()).toArray(), riding: Boolean(player.ridingCar) };
    }, { ids: definition.ids });
    expect(result.transformError).toBeLessThan(1e-7);
    expect(result.deniedMovingExit).toBe(true);
    expect(result.stops.map(stop => stop.id)).toEqual([1, 2, 3, 2, 1, 0].map(index => definition.ids[index]));
    for (const stop of result.stops) {
      expect(stop.platformId).toBe(`${stop.id}:${lineId}`);
      expect(stop.line).toBe(lineId);
      expect(stop.feetY).toBeCloseTo(-12, 7);
      expect(stop.local[0]).toBeGreaterThan(stop.bounds.minX);
      expect(stop.local[0]).toBeLessThan(stop.bounds.maxX);
      expect(stop.local[2]).toBeGreaterThan(stop.bounds.minZ);
      expect(stop.local[2]).toBeLessThan(stop.bounds.maxZ);
      expect(stop.left && stop.reboarded && stop.sameCar && stop.sameCarAfterBoard).toBe(true);
    }
    expect(result.after).toEqual(result.before);
    expect(result.resetLine).toBe(lineId);
    expect(result.resetId).toBe(definition.ids[0]);
    [-6.6, 1.76, -31.5].forEach((value, index) => expect(result.resetLocal[index]).toBeCloseTo(value, 7));
    expect(result.riding).toBe(false);
  });
}

test('Central stairs support a continuous keyboard descent and ascent with no shaft fall or level jump', async ({ page }) => {
  await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    player.startAt('U1', 'station-2');
    // Initial setup is on a legal upper platform. Every subsequent displacement
    // uses real keyboard events and the controller's transfer surface handling.
    player.camera.position.set(-7.45, 1.76, -280);
    world.update(0);
  });
  const descent = [[-7.45, -284.7], [-7.45, -288], [-7.45, -291.75], [-4.15, -291.75],
    [-4.15, -288], [-4.15, -284.1], [-7.45, -284.1], [-7.45, -288], [-7.45, -291.75],
    [-4.15, -291.75], [-4.15, -288], [-4.15, -284.1], [-4.15, -280]];
  const ascent = [[-4.15, -284.1], [-4.15, -288], [-4.15, -291.75], [-7.45, -291.75],
    [-7.45, -288], [-7.45, -284.1], [-4.15, -284.1], [-4.15, -288], [-4.15, -291.75],
    [-7.45, -291.75], [-7.45, -288], [-7.45, -284.1], [-7.45, -280]];
  const records = [], surfaces = new Set();
  let maximumHeightStep = 0, maximumPlanarStep = 0;
  for (const [direction, points] of [['down', descent], ['up', ascent]]) {
    for (const [x, z] of points) {
      await page.evaluate(({ x, z }) => {
        const player = window.metro.player;
        player.yaw = Math.atan2(-(x - player.camera.position.x), -(z - player.camera.position.z));
        player.applyLook();
      }, { x, z });
      await page.keyboard.down('w'); await page.keyboard.down('Shift');
      const segment = await page.evaluate(({ x, z }) => {
        const { player, world } = window.metro;
        let heightStep = 0, planarStep = 0, reached = false;
        const samples = [];
        for (let frame = 0; frame < 180; frame++) {
          const previous = player.camera.position.clone();
          world.update(1 / 60);
          heightStep = Math.max(heightStep, Math.abs(previous.y - player.camera.position.y));
          planarStep = Math.max(planarStep, Math.hypot(previous.x - player.camera.position.x, previous.z - player.camera.position.z));
          if (player.transferSurface) samples.push(player.transferSurface.id);
          const feetY = player.camera.position.y - 1.76;
          if (feetY < -12.001 || feetY > 0.001) throw new Error('Passenger fell out of the supported staircase.');
          if (Math.hypot(player.camera.position.x - x, player.camera.position.z - z) < 0.14) { reached = true; break; }
        }
        return { reached, samples, heightStep, planarStep, feetY: player.camera.position.y - 1.76, platform: player.station.platformId, transfer: player.transferSurface?.id };
      }, { x, z });
      await page.keyboard.up('w'); await page.keyboard.up('Shift');
      expect(segment.reached, `${direction} segment to ${x},${z} remained blocked`).toBe(true);
      maximumHeightStep = Math.max(maximumHeightStep, segment.heightStep);
      maximumPlanarStep = Math.max(maximumPlanarStep, segment.planarStep);
      segment.samples.forEach(surface => surfaces.add(surface));
      records.push({ direction, x, z, ...segment });
    }
    await expect(page.locator('#location-line')).toHaveText(direction === 'down' ? 'U3' : 'U1');
    expect(records.at(-1).platform).toBe(direction === 'down' ? 'station-2:U3' : 'station-2:U1');
    expect(records.at(-1).feetY).toBeCloseTo(direction === 'down' ? -12 : 0, 7);
  }
  expect(maximumHeightStep).toBeGreaterThan(0);
  expect(maximumHeightStep).toBeLessThanOrEqual(0.1875 + 1e-6);
  expect(maximumPlanarStep).toBeLessThanOrEqual(7 / 60 + 1e-6);
  expect([...surfaces]).toEqual(expect.arrayContaining(['flight-1', 'flight-2', 'flight-3', 'flight-4', 'far-landing-1', 'middle-landing', 'far-landing-2', 'lower-entry']));
  const safety = await page.evaluate(() => {
    const transfer = window.metro.world.verticalInterchange;
    return {
      surfaces: transfer.surfaces.length,
      unreachableOtherLanding: transfer.findSurface(-7.45, -291.75, -6, 0.45) === null,
      noShaftFloor: transfer.findSurface(-5.8, -288, -4.5, 0.45) === null,
    };
  });
  expect(safety.surfaces).toBeGreaterThanOrEqual(10);
  expect(safety.unreachableOtherLanding).toBe(true);
  expect(safety.noShaftFloor).toBe(true);
});

test('lower station signatures contain real monumental roofs and curved historic stonework', async ({ page }) => {
  const data = await page.evaluate(() => {
    const stations = window.metro.world.stations;
    const landmark = stations.find(station => station.stationId === 'u3-schattenufer');
    const historic = stations.find(station => station.stationId === 'u4-kaiser-humboldt');
    const roof = landmark.signatureRoof;
    const vault = historic.getObjectByName('KaiserMasonryBarrelVault');
    const pillar = historic.getObjectByName('KaiserMonumentalCarvedPillar');
    const geometryHeights = mesh => {
      const positions = mesh.geometry.getAttribute('position');
      const heights = [];
      for (let index = 0; index < positions.count; index++) heights.push(positions.getY(index));
      return { vertices: positions.count, variation: Math.max(...heights) - Math.min(...heights), indexed: Boolean(mesh.geometry.index) };
    };
    return {
      roof: geometryHeights(roof), roofMetadata: roof.geometry.userData,
      ribs: landmark.getObjectByName('RadialPrimaryRibs')?.count,
      diagrid: landmark.getObjectByName('WhiteSteelCrossDiagrid')?.count,
      translucent: roof.material.transparent || roof.material.transmission > 0,
      vault: geometryHeights(vault), historic: historic.userData.historicArchitecture,
      pillar: { children: pillar.children.length, realGeometry: pillar.children.some(child => child.isMesh || child.children.some(part => part.isMesh)) },
      themes: ['u3-schattenufer', 'u3-ostbahnhof', 'u3-stadtbruecke', 'u4-kaiser-humboldt', 'u4-westbahnhof', 'u4-arabellapark'].map(id => {
        const station = stations.find(item => item.stationId === id);
        return station.theme ?? station.userData.stationTheme;
      }),
      repeaterShared: stations.find(station => station.stationId === 'u3-ostbahnhof').repeaterDisplay.material.map === stations.find(station => station.stationId === 'u3-ostbahnhof').departures.texture,
    };
  });
  expect(data.roof.vertices).toBeGreaterThan(300);
  expect(data.roof.variation).toBeGreaterThan(3);
  expect(data.roofMetadata.signatureRoof).toBe(true);
  expect(data.ribs).toBeGreaterThan(100);
  expect(data.diagrid).toBeGreaterThan(300);
  expect(data.translucent).toBe(true);
  expect(data.vault.vertices).toBeGreaterThan(80);
  expect(data.vault.variation).toBeGreaterThan(2);
  expect(data.historic.vaultType).toBe('elliptical-masonry');
  expect(data.historic.monumentalPillars).toBe(1);
  expect(data.historic.originalCarvedRelief).toBe(true);
  expect(data.pillar.children).toBeGreaterThan(4);
  expect(data.pillar.realGeometry).toBe(true);
  expect(new Set(data.themes).size).toBe(6);
  expect(data.repeaterShared).toBe(true);
});
