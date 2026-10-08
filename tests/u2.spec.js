import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?line=U2');
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.services?.length === 2);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test('U2 shares Central, adds three stations, and line start buttons leave both trains untouched', async ({ page }) => {
  const graph = await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    const centralPlatforms = world.stations.filter(station => station.stationId === 'station-2');
    const u2First = world.stations.find(station => station.stationId === 'u2-stadtzentrum');
    return {
      nodes: world.network.nodes.size, physicalPlatforms: world.stations.length,
      lines: [...world.network.lines.keys()],
      u1Ids: world.routes.U1.stops.map(stop => stop.id),
      u2Ids: world.routes.U2.stops.map(stop => stop.id),
      u2Distances: world.routes.U2.stops.map(stop => stop.distance),
      u2RailX: u2First.localToWorld(world.camera.position.clone().set(1.57, 0, 0)).x,
      u2Samples: [0, 120, 240, 360, 480, 600, 720].map(distance => ({ distance, position: world.routes.U2.sample(distance).position.toArray(), yaw: world.routes.U2.sample(distance).yaw })),
      sameNode: world.routes.U1.stops[1].node === world.routes.U2.stops[1].node,
      physicalCentralShared: centralPlatforms.every(station => station.networkNode === world.network.nodes.get('station-2')),
      centralPlatformIds: centralPlatforms.map(station => station.platformId).sort(),
      aliases: world.train === world.trains[0] && world.service === world.services[0] && world.route === world.routes.U1,
      separate: world.trains[0] !== world.trains[1] && world.trains[0].cars.every(car => !world.trains[1].cars.includes(car)),
      accents: {
        shared: world.trains[0].materials.trainAccent === world.trains[1].materials.trainAccent,
        u1Hex: world.trains[0].materials.trainAccent.color.getHexString(),
        u2Hex: world.trains[1].materials.trainAccent.color.getHexString(),
        u2LineHex: world.routes.U2.line.color.replace('#', ''),
        u2Red: world.trains[1].materials.trainAccent.color.r > world.trains[1].materials.trainAccent.color.g && world.trains[1].materials.trainAccent.color.r > world.trains[1].materials.trainAccent.color.b,
      },
      selected: player.service.lineId, station: player.station.stationId,
      snapshots: world.services.map(service => service.snapshot()),
      trainPositions: world.trains.map(train => train.position.toArray()),
    };
  });
  expect(graph.nodes).toBe(6);
  expect(graph.physicalPlatforms).toBe(7);
  expect(graph.lines).toEqual(['U1', 'U2']);
  expect(graph.u1Ids).toEqual(['station-1', 'station-2', 'station-3']);
  expect(graph.u2Ids).toEqual(['u2-stadtzentrum', 'station-2', 'u2-schwarzkopf', 'u2-eisenwerk']);
  expect(graph.u2Distances).toEqual([0, 240, 480, 720]);
  for (const sample of graph.u2Samples) {
    expect(sample.position[0]).toBeCloseTo(graph.u2RailX, 7);
    expect(sample.position[1]).toBe(0);
    expect(sample.position[2]).toBeCloseTo(-sample.distance, 7);
    expect(sample.yaw).toBe(0);
  }
  expect(graph.sameNode).toBe(true);
  expect(graph.physicalCentralShared).toBe(true);
  expect(graph.centralPlatformIds).toEqual(['station-2:U1', 'station-2:U2']);
  expect(graph.aliases).toBe(true);
  expect(graph.separate).toBe(true);
  expect(graph.accents.shared).toBe(false);
  expect(graph.accents.u1Hex).toBe('316c65');
  expect(graph.accents.u2Hex).toBe(graph.accents.u2LineHex);
  expect(graph.accents.u2Red).toBe(true);
  expect(graph.selected).toBe('U2');
  expect(graph.station).toBe('u2-stadtzentrum');
  await expect(page.locator('#location-line')).toHaveText('U2');
  await expect(page.locator('#service-label')).toHaveText('U2 LIVE SERVICE');
  await page.locator('#start-u1-button').click();
  await expect(page.locator('#location-line')).toHaveText('U1');
  await page.locator('#start-u2-button').click();
  await expect(page.locator('#location-line')).toHaveText('U2');
  const after = await page.evaluate(() => ({
    snapshots: window.metro.world.services.map(service => service.snapshot()),
    trainPositions: window.metro.world.trains.map(train => train.position.toArray()),
    station: window.metro.player.station.stationId,
  }));
  expect(after.snapshots).toEqual(graph.snapshots);
  expect(after.trainPositions).toEqual(graph.trainPositions);
  expect(after.station).toBe('u2-stadtzentrum');
});

test('U2 completes its six-leg loop independently with smooth motion, safe doors, and deferred cab reversal', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { world } = window.metro;
    world.renderer.setAnimationLoop(null);
    const u1 = world.services.find(service => service.lineId === 'U1');
    const u2 = world.services.find(service => service.lineId === 'U2');
    const u1Before = JSON.stringify(u1.snapshot());
    const departureRequested = u2.requestDeparture();
    u2.update(0.25);
    const u1Unaffected = JSON.stringify(u1.snapshot()) === u1Before;
    const offsets = world.trains.map(train => train.cars.map(car => car.position.toArray()));
    const previous = world.services.map(service => ({ distance: service.distance, speed: service.speed }));
    let maxStep = 0, maxSpeedChange = 0, pauseSeconds = 0;
    const errors = [], states = new Set(), stops = [];
    let recorded = 0;
    const check = (condition, text) => { if (!condition && errors.length < 12) errors.push(text); };
    for (let frame = 0; frame < 460 * 60; frame++) {
      world.update(1 / 60);
      states.add(u2.state);
      world.services.forEach((service, index) => {
        const train = service.train;
        const sample = service.route.sample(service.distance);
        maxStep = Math.max(maxStep, Math.abs(service.distance - previous[index].distance));
        maxSpeedChange = Math.max(maxSpeedChange, Math.abs(service.speed - previous[index].speed));
        check(train.position.distanceTo(sample.position) < 1e-7 && Math.abs(train.rotation.y - sample.yaw) < 1e-7, `${service.lineId} left its rails.`);
        check(service.distance >= 0 && service.distance <= service.route.length, `${service.lineId} left the playable route.`);
        check(train.cars.every((car, carIndex) => car.position.toArray().every((value, axis) => value === offsets[index][carIndex][axis])), `${service.lineId} cars detached.`);
        if (service.speed > 0) {
          check(train.cars.every(car => Object.values(car.doorProgressBySide).every(progress => progress === 0)), `${service.lineId} moved with open doors.`);
          check(service.cabDirection === service.direction && train.direction === service.direction && !service.reversalPending, `${service.lineId} moved before its cab reversal completed.`);
        }
        previous[index] = { distance: service.distance, speed: service.speed };
      });
      check(u2.train.cars.every(car => car.doorProgressBySide[-1] === 0), 'U2 opened its track-side doors.');
      if (u2.state === 'departing' && u2.speed === 0) pauseSeconds += 1 / 60;
      if (u2.completedLegs > recorded && u2.state === 'boarding') {
        recorded = u2.completedLegs;
        stops.push({
          id: u2.currentStop.id, distance: u2.distance, direction: u2.direction,
          nextId: u2.nextStop.id, terminalId: u2.destinationStop.id,
          cabDirection: u2.cabDirection, reversalPending: u2.reversalPending,
          displayDestinations: u2.train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => ({ lineId: display.userData.lineId, destination: display.userData.destination }))),
          terminalName: u2.destinationStop.name,
        });
        if (u2.completedLegs === 6) {
          for (let step = 0; step < 120; step++) world.update(1 / 60);
          break;
        }
      }
    }
    return {
      departureRequested, u1Unaffected, errors, states: [...states], stops,
      maxStep, maxSpeedChange, pauseSeconds, u1Legs: u1.completedLegs,
      finalDistance: u2.distance, finalSpeed: u2.speed,
      finalDoors: u2.train.cars.map(car => ({ ...car.doorProgressBySide })),
      glError: world.renderer.getContext().getError(),
    };
  });
  expect(result.departureRequested).toBe(true);
  expect(result.u1Unaffected).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.states).toEqual(expect.arrayContaining(['closing', 'departing', 'travelling', 'arriving', 'stopped', 'boarding']));
  expect(result.stops.map(({ id, distance, direction, nextId, terminalId }) => ({ id, distance, direction, nextId, terminalId }))).toEqual([
    { id: 'station-2', distance: 240, direction: 1, nextId: 'u2-schwarzkopf', terminalId: 'u2-eisenwerk' },
    { id: 'u2-schwarzkopf', distance: 480, direction: 1, nextId: 'u2-eisenwerk', terminalId: 'u2-eisenwerk' },
    { id: 'u2-eisenwerk', distance: 720, direction: -1, nextId: 'u2-schwarzkopf', terminalId: 'u2-stadtzentrum' },
    { id: 'u2-schwarzkopf', distance: 480, direction: -1, nextId: 'station-2', terminalId: 'u2-stadtzentrum' },
    { id: 'station-2', distance: 240, direction: -1, nextId: 'u2-stadtzentrum', terminalId: 'u2-stadtzentrum' },
    { id: 'u2-stadtzentrum', distance: 0, direction: 1, nextId: 'station-2', terminalId: 'u2-eisenwerk' },
  ]);
  expect(result.stops.map(stop => stop.cabDirection)).toEqual([1, 1, 1, -1, -1, -1]);
  expect(result.stops.map(stop => stop.reversalPending)).toEqual([false, false, true, false, false, true]);
  for (const stop of result.stops) {
    expect(stop.displayDestinations.length).toBeGreaterThanOrEqual(8);
    expect(stop.displayDestinations.every(display => display.lineId === 'U2' && display.destination === stop.terminalName)).toBe(true);
  }
  expect(result.u1Legs).toBeGreaterThanOrEqual(4);
  expect(result.maxStep).toBeLessThanOrEqual(10 / 60 + 1e-6);
  expect(result.maxSpeedChange).toBeLessThanOrEqual(1.1 / 60 + 1e-6);
  expect(result.pauseSeconds).toBeGreaterThan(6);
  expect(result.finalDistance).toBe(0);
  expect(result.finalSpeed).toBe(0);
  expect(result.finalDoors.every(door => door[1] > 0.99 && door[-1] === 0)).toBe(true);
  expect(result.glError).toBe(0);
});

test('U2 keyboard boarding carries the rider through all six legs and alights on the correct rotated platforms', async ({ page }) => {
  const carNumber = await page.evaluate(() => {
    const { player } = window.metro;
    const train = player.service.train;
    player.camera.position.set(1.397 + 1.3, 1.76, train.cars[0].position.z);
    train.localToWorld(player.camera.position);
    return train.cars[0].carNumber;
  });
  await page.waitForFunction(() => window.metro.player.interactionHint().enabled);
  await page.keyboard.press('e');
  await page.waitForFunction(() => Boolean(window.metro.player.ridingCar));
  expect(await page.evaluate(() => window.metro.player.ridingCar.carNumber)).toBe(carNumber);
  const result = await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    const service = player.service;
    const car = player.ridingCar;
    let transformError = 0, refusedExit = false;
    const stops = [];
    for (const id of ['station-2', 'u2-schwarzkopf', 'u2-eisenwerk', 'u2-schwarzkopf', 'station-2', 'u2-stadtzentrum']) {
      let reached = false;
      for (let frame = 0; frame < 150 * 60; frame++) {
        world.update(1 / 60);
        const localCamera = service.train.worldToLocal(player.camera.position.clone());
        transformError = Math.max(transformError, localCamera.distanceTo(player.ridingOffset));
        if (service.speed > 2 && !refusedExit) refusedExit = !player.interact();
        if (service.currentStop.id === id && service.canBoard) { reached = true; break; }
      }
      if (!reached) throw new Error(`U2 did not reach ${id}.`);
      const sameCar = player.ridingCar === car;
      const left = player.interact();
      const station = player.station;
      const local = station.worldToLocal(player.camera.position.clone());
      const boardedAgain = player.interact();
      stops.push({
        id: station.stationId, lineId: station.lineId, platformId: station.platformId,
        sameCar, left, boardedAgain, sameCarAfterBoarding: player.ridingCar === car,
        local: local.toArray(), bounds: { ...station.bounds }, selected: player.service.lineId,
      });
    }
    player.yaw = -Math.PI / 2;
    player.keys.add('KeyW'); player.keys.add('ShiftLeft');
    for (let frame = 0; frame < 120; frame++) world.update(1 / 60);
    player.keys.clear();
    const interiorPosition = player.ridingOffset.toArray();
    const beforeReset = world.services.map(item => ({ distance: item.distance, state: item.state, completedLegs: item.completedLegs }));
    player.reset();
    return {
      transformError, refusedExit, stops, interiorPosition,
      carCenterZ: car.position.z, beforeReset,
      afterReset: world.services.map(item => ({ distance: item.distance, state: item.state, completedLegs: item.completedLegs })),
      resetLine: player.service.lineId, resetStation: player.station.stationId,
      ridingAfterReset: Boolean(player.ridingCar), resetLocal: player.station.worldToLocal(player.camera.position.clone()).toArray(),
    };
  });
  expect(result.transformError).toBeLessThan(1e-7);
  expect(result.refusedExit).toBe(true);
  expect(result.stops.map(stop => stop.id)).toEqual(['station-2', 'u2-schwarzkopf', 'u2-eisenwerk', 'u2-schwarzkopf', 'station-2', 'u2-stadtzentrum']);
  for (const stop of result.stops) {
    expect(stop.lineId).toBe('U2');
    expect(stop.platformId).toBe(`${stop.id}:U2`);
    expect(stop.selected).toBe('U2');
    expect(stop.sameCar && stop.left && stop.boardedAgain && stop.sameCarAfterBoarding).toBe(true);
    expect(stop.local[0]).toBeGreaterThan(stop.bounds.minX);
    expect(stop.local[0]).toBeLessThan(stop.bounds.maxX);
    expect(stop.local[2]).toBeGreaterThan(stop.bounds.minZ);
    expect(stop.local[2]).toBeLessThan(stop.bounds.maxZ);
  }
  expect(Math.abs(result.interiorPosition[0])).toBeLessThanOrEqual(1.08 + 1e-7);
  expect(Math.abs(result.interiorPosition[2] - result.carCenterZ)).toBeLessThanOrEqual(7.05 + 1e-7);
  expect(result.afterReset).toEqual(result.beforeReset);
  expect(result.resetLine).toBe('U2');
  expect(result.resetStation).toBe('u2-stadtzentrum');
  expect(result.ridingAfterReset).toBe(false);
  expect(result.resetLocal[0]).toBeCloseTo(-6.6, 6);
  expect(result.resetLocal[1]).toBeCloseTo(1.76, 6);
  expect(result.resetLocal[2]).toBeCloseTo(-31.5, 6);
});

test('Central transfer is a continuous walk with real keyboard input and live boards for both lines', async ({ page }) => {
  await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    player.startAt('U1', 'station-2');
    // Begin on the actual U1 platform. Every transfer step below uses keyboard
    // events and the controller; no position or station assignments cross it.
    player.camera.position.set(-6, 1.76, -264);
    player.yaw = Math.PI / 2;
    player.applyLook();
  });
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  const crossing = await page.evaluate(() => {
    const { player, world } = window.metro;
    const points = [];
    let maximumStep = 0;
    for (let frame = 0; frame < 150; frame++) {
      const previous = player.camera.position.clone();
      world.update(1 / 60);
      maximumStep = Math.max(maximumStep, previous.distanceTo(player.camera.position));
      if (frame % 10 === 0) points.push({ position: player.camera.position.toArray(), line: player.station.lineId });
      if (player.station.lineId === 'U2' && player.camera.position.x < -15) break;
    }
    return { points, maximumStep, line: player.station.lineId, station: player.station.stationId, platformId: player.station.platformId, service: player.service.lineId, position: player.camera.position.toArray() };
  });
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  expect(crossing.maximumStep).toBeLessThanOrEqual(7 / 60 + 1e-6);
  expect(crossing.points.some(point => point.position[0] < -9.5 && point.position[0] > -11.2)).toBe(true);
  expect(crossing.line).toBe('U2');
  expect(crossing.station).toBe('station-2');
  expect(crossing.platformId).toBe('station-2:U2');
  expect(crossing.service).toBe('U2');
  await expect(page.locator('#location-line')).toHaveText('U2');
  const boards = await page.evaluate(() => window.metro.world.stations.filter(station => station.stationId === 'station-2').map(station => station.departures.departures.map(row => ({ route: row.route, destination: row.destination, nextStop: row.nextStop, direction: row.direction, platform: row.platform }))));
  expect(boards).toHaveLength(2);
  for (const rows of boards) {
    expect(rows).toHaveLength(4);
    expect(rows.map(row => `${row.route}:${row.direction}:${row.platform}`)).toEqual(['U1:Northbound:01', 'U1:Southbound:01', 'U2:Outbound:02', 'U2:Inbound:02']);
    expect(rows.map(row => row.destination)).toEqual(['Rosenheimer Platz', 'Nordplatz', 'Eisenwerk', 'Stadtzentrum']);
  }
  await page.evaluate(() => { const player = window.metro.player; player.yaw = -Math.PI / 2; player.applyLook(); });
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('Shift');
  const back = await page.evaluate(() => {
    const { player, world } = window.metro;
    let maximumStep = 0;
    for (let frame = 0; frame < 150; frame++) {
      const previous = player.camera.position.clone();
      world.update(1 / 60);
      maximumStep = Math.max(maximumStep, previous.distanceTo(player.camera.position));
      if (player.station.lineId === 'U1' && player.camera.position.x > -6) break;
    }
    return { line: player.station.lineId, service: player.service.lineId, maximumStep };
  });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('Shift');
  expect(back.line).toBe('U1');
  expect(back.service).toBe('U1');
  expect(back.maximumStep).toBeLessThanOrEqual(7 / 60 + 1e-6);
  await expect(page.locator('#location-line')).toHaveText('U1');
});

test('Schwarzkopf has a continuous irregular rock shell and Eisenwerk has real industrial structure', async ({ page }) => {
  const architecture = await page.evaluate(() => {
    const { world } = window.metro;
    const rock = world.stations.find(station => station.stationId === 'u2-schwarzkopf');
    const iron = world.stations.find(station => station.stationId === 'u2-eisenwerk');
    const shell = rock.rockShell;
    const geometry = shell.geometry;
    geometry.computeBoundingBox();
    const positions = geometry.getAttribute('position');
    const roofHeights = [];
    // Sample the upper arc of each indexed shell ring, rather than filtering
    // by height; a collapsed ceiling must remain visible to this assertion.
    const ringWidth = geometry.userData.ringSegments + 1;
    const firstRoofColumn = Math.ceil(geometry.userData.ringSegments * 3 / 14);
    const lastRoofColumn = Math.floor(geometry.userData.ringSegments * 8 / 14);
    for (let index = 0; index < positions.count; index++) {
      const column = index % ringWidth;
      if (Math.abs(positions.getZ(index)) < 40 && column >= firstRoofColumn && column <= lastRoofColumn) roofHeights.push(positions.getY(index));
    }
    const rivets = iron.getObjectByName('IronworksRivets');
    const corrugations = iron.getObjectByName('IronworksRoofCorrugations');
    const metallicMaterials = new Set();
    iron.traverse(object => {
      if (!object.isMesh) return;
      for (const material of [object.material].flat()) if (material.metalness >= 0.4 && material.roughness >= 0.5) metallicMaterials.add(material.uuid);
    });
    return {
      rockTheme: rock.theme, vertices: positions.count, triangles: geometry.index.count / 3,
      indexed: Boolean(geometry.index), normalCount: geometry.getAttribute('normal').count,
      vertexColorCount: geometry.getAttribute('color').count, uvCount: geometry.getAttribute('uv').count,
      roofVariation: Math.max(...roofHeights) - Math.min(...roofHeights), minimumRoof: Math.min(...roofHeights),
      reportedMinimumRoof: geometry.userData.minHallRoof,
      material: { roughness: shell.material.roughness, metalness: shell.material.metalness },
      ironTheme: iron.theme, roofHeight: iron.userData.industrialArchitecture.roofHeight,
      rivets: { instanced: rivets.isInstancedMesh, count: rivets.count, geometryType: rivets.geometry.type },
      corrugations: { instanced: corrugations.isInstancedMesh, count: corrugations.count },
      metallicMaterials: metallicMaterials.size,
      lines: [rock.lineId, iron.lineId], platforms: [rock.platformNumber, iron.platformNumber],
    };
  });
  expect(architecture.rockTheme).toBe('rock');
  expect(architecture.indexed).toBe(true);
  expect(architecture.vertices).toBeGreaterThan(1000);
  expect(architecture.triangles).toBeGreaterThan(3000);
  expect(architecture.normalCount).toBe(architecture.vertices);
  expect(architecture.vertexColorCount).toBe(architecture.vertices);
  expect(architecture.uvCount).toBe(architecture.vertices);
  expect(architecture.roofVariation).toBeGreaterThan(1.2);
  expect(architecture.minimumRoof).toBeGreaterThan(4.5);
  expect(architecture.reportedMinimumRoof).toBeGreaterThan(4.5);
  expect(architecture.material.roughness).toBeGreaterThan(0.85);
  expect(architecture.material.metalness).toBe(0);
  expect(architecture.ironTheme).toBe('ironworks');
  expect(architecture.roofHeight).toBeGreaterThan(8);
  expect(architecture.rivets.instanced).toBe(true);
  expect(architecture.rivets.count).toBeGreaterThan(100);
  expect(architecture.rivets.geometryType).toBe('CylinderGeometry');
  expect(architecture.corrugations.instanced).toBe(true);
  expect(architecture.corrugations.count).toBeGreaterThan(80);
  expect(architecture.metallicMaterials).toBeGreaterThanOrEqual(2);
  expect(architecture.lines).toEqual(['U2', 'U2']);
  expect(architecture.platforms).toEqual(['02', '02']);
});
