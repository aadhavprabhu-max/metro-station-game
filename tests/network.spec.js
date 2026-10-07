import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.network && window.metro.world.service.nextStop);
});

test('U1 uses three shared station nodes and Central can support a second line without changing U1', async ({ page }) => {
  const graph = await page.evaluate(async () => {
    const { network, route } = window.metro.world;
    const { createMetroNetwork } = await import('/src/network.js');
    const node = network.nodes.get('station-2');
    const isolated = createMetroNetwork();
    const project = stop => ({ id: stop.id, name: stop.name, distance: stop.distance });
    const before = isolated.getLineStops('U1').map(project);
    const centralNode = isolated.nodes.get('station-2');
    isolated.addNode({ id: 'u2-test-stop', name: 'Test branch', position: { x: 101.57, y: 0, z: -240 } });
    isolated.addLink({ id: 'u2-test-link', from: 'station-2', to: 'u2-test-stop' });
    isolated.addLine({ id: 'U2', name: 'Test U2', color: '#5488bb', nodeIds: ['station-2', 'u2-test-stop'], linkIds: ['u2-test-link'] });
    const u2Stops = isolated.getLineStops('U2');
    return {
      stationCount: network.nodes.size,
      routeIds: route.stops.map(stop => stop.id),
      distances: route.stops.map(stop => stop.distance),
      length: route.length,
      terminalFlags: route.stops.map(stop => stop.isTerminus),
      central: { name: node.name, lineIds: [...node.lineIds], plannedLines: [...node.plannedLines], interchangeCapable: node.interchangeCapable },
      sharedCentral: route.stops[1].node === node,
      liveLines: [...network.lines.keys()],
      before, after: isolated.getLineStops('U1').map(project),
      u2Ids: u2Stops.map(stop => stop.id),
      u2CentralSameObject: u2Stops[0].node === centralNode,
      centralServedLines: [...centralNode.lineIds],
      interchange: isolated.getLineStops('U1')[1].interchange,
    };
  });
  expect(graph.stationCount).toBe(3);
  expect(graph.routeIds).toEqual(['station-1', 'station-2', 'station-3']);
  expect(graph.distances).toEqual([0, 240, 480]);
  expect(graph.length).toBe(480);
  expect(graph.terminalFlags).toEqual([true, false, true]);
  expect(graph.central).toEqual({ name: 'Central', lineIds: ['U1'], plannedLines: ['U2'], interchangeCapable: true });
  expect(graph.sharedCentral).toBe(true);
  expect(graph.liveLines).toEqual(['U1']);
  expect(graph.after).toEqual(graph.before);
  expect(graph.u2Ids).toEqual(['station-2', 'u2-test-stop']);
  expect(graph.u2CentralSameObject).toBe(true);
  expect(graph.centralServedLines).toEqual(['U1', 'U2']);
  expect(graph.interchange).toBe(true);
});

test('station departures predict both Central directions and distinguish next stops from termini', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { world } = window.metro;
    world.renderer.setAnimationLoop(null);
    const { service } = world;
    const rows = stationId => service.departuresFor(stationId).map(row => ({
      direction: row.direction, directionName: row.directionName,
      nextStation: row.nextStation, destination: row.destination,
      nextId: row.nextStop.id, terminalId: row.destinationStop.id,
      dueSeconds: row.dueSeconds, atPlatform: row.atPlatform,
    }));
    const initial = { nord: rows('station-1'), central: rows('station-2'), rosen: rows('station-3') };
    world.update(1);
    const afterSecond = rows('station-2');
    const advanceUntilBoardingAt = (id, maxSeconds = 180) => {
      for (let i = 0; i < maxSeconds * 60; i++) {
        world.update(1 / 60);
        if (service.currentStop.id === id && service.state === 'boarding') {
          for (let j = 0; j < 120; j++) world.update(1 / 60);
          return { service: service.snapshot(), rows: rows(id), boards: world.stations.map(station => ({ id: station.stationId, rows: station.departures.departures.filter(row => row.route === 'U1').map(row => ({ ...row })) })) };
        }
      }
      throw new Error(`U1 never boarded at ${id}.`);
    };
    const centralNorth = advanceUntilBoardingAt('station-2');
    const rosen = advanceUntilBoardingAt('station-3');
    const centralSouth = advanceUntilBoardingAt('station-2');
    return { initial, afterSecond, centralNorth, rosen, centralSouth };
  });
  expect(result.initial.nord).toHaveLength(1);
  expect(result.initial.central).toHaveLength(2);
  expect(result.initial.rosen).toHaveLength(1);
  expect(result.initial.nord[0]).toMatchObject({ direction: 1, directionName: 'Northbound', nextStation: 'Central', destination: 'Rosenheimer Platz', atPlatform: true });
  expect(result.initial.central.map(row => ({ direction: row.directionName, next: row.nextStation, terminal: row.destination }))).toEqual([
    { direction: 'Northbound', next: 'Rosenheimer Platz', terminal: 'Rosenheimer Platz' },
    { direction: 'Southbound', next: 'Nordplatz', terminal: 'Nordplatz' },
  ]);
  expect(result.initial.rosen[0]).toMatchObject({ direction: -1, directionName: 'Southbound', nextStation: 'Central', destination: 'Nordplatz', atPlatform: false });
  expect(result.initial.central[0].dueSeconds).toBeGreaterThan(result.initial.nord[0].dueSeconds);
  expect(result.initial.rosen[0].dueSeconds).toBeGreaterThan(result.initial.central[0].dueSeconds);
  expect(result.initial.central[1].dueSeconds).toBeGreaterThan(result.initial.rosen[0].dueSeconds);
  expect(result.afterSecond[0].dueSeconds).toBeCloseTo(result.initial.central[0].dueSeconds - 1, 3);
  expect(result.afterSecond[1].dueSeconds).toBeCloseTo(result.initial.central[1].dueSeconds - 1, 3);
  expect(result.centralNorth.service).toMatchObject({ direction: 1, directionName: 'Northbound', nextStop: { id: 'station-3' }, destinationStop: { id: 'station-3' } });
  expect(result.centralNorth.rows[0].atPlatform).toBe(true);
  expect(result.centralNorth.rows[1].atPlatform).toBe(false);
  expect(result.rosen.service).toMatchObject({ direction: -1, directionName: 'Southbound', nextStop: { id: 'station-2' }, destinationStop: { id: 'station-1' } });
  expect(result.rosen.rows[0].atPlatform).toBe(true);
  expect(result.centralSouth.service).toMatchObject({ direction: -1, directionName: 'Southbound', nextStop: { id: 'station-1' }, destinationStop: { id: 'station-1' } });
  expect(result.centralSouth.rows[0].atPlatform).toBe(false);
  expect(result.centralSouth.rows[1].atPlatform).toBe(true);
  for (const stop of [result.centralNorth, result.rosen, result.centralSouth]) {
    expect(stop.boards.map(board => board.rows.length)).toEqual([1, 2, 1]);
    expect(stop.boards[1].rows.map(row => row.destination)).toEqual(['Rosenheimer Platz', 'Nordplatz']);
  }
});

test('a passenger can board, alight, and walk with correct collisions at every U1 station', async ({ page }) => {
  const stops = await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    const dt = 1 / 60;
    player.camera.position.set(-0.92, 1.76, world.train.cars[0].position.z);
    if (!player.interact()) throw new Error('Could not board at Nordplatz.');
    const originalCar = player.ridingCar;
    const results = [];
    for (const id of ['station-2', 'station-3', 'station-2', 'station-1']) {
      let reached = false;
      for (let frame = 0; frame < 120 * 60; frame++) {
        world.update(dt);
        if (world.service.currentStop.id === id && world.service.canBoard) { reached = true; break; }
      }
      if (!reached) throw new Error(`Could not reach ${id}.`);
      const sameCar = player.ridingCar === originalCar;
      if (!player.interact()) throw new Error(`Could not leave at ${id}.`);
      const station = player.station;
      const arrivedZ = player.camera.position.z;
      const boardPosition = player.camera.position.toArray();
      const walk = (position, yaw, seconds = 4) => {
        player.camera.position.set(...position); player.yaw = yaw;
        player.keys.add('KeyW'); player.keys.add('ShiftLeft');
        for (let i = 0; i < seconds * 60; i++) player.update(dt);
        player.keys.clear();
        return player.camera.position.toArray();
      };
      const edge = walk([-3, 1.76, station.position.z - 25], -Math.PI / 2);
      const wall = walk([-6, 1.76, station.position.z - 25], Math.PI / 2);
      const column = walk([-6, 1.76, station.position.z], Math.PI / 2, 2);
      const north = walk([-4, 1.76, station.position.z - 35], 0);
      const south = walk([-4, 1.76, station.position.z + 35], Math.PI);
      player.camera.position.set(...boardPosition);
      const reboarded = player.interact();
      results.push({
        id: station.stationId, sameCar, reboarded, carAfterBoard: player.ridingCar?.carNumber,
        localArrivalZ: arrivedZ - station.position.z,
        edgeX: edge[0], wallX: wall[0], columnX: column[0],
        northZ: north[2] - station.position.z, southZ: south[2] - station.position.z,
        minZ: station.bounds.minZ, maxZ: station.bounds.maxZ,
      });
    }
    return results;
  });
  expect(stops.map(stop => stop.id)).toEqual(['station-2', 'station-3', 'station-2', 'station-1']);
  for (const stop of stops) {
    expect(stop.sameCar).toBe(true);
    expect(stop.reboarded).toBe(true);
    expect(stop.carAfterBoard).toBe(101);
    expect(stop.localArrivalZ).toBeGreaterThan(stop.minZ);
    expect(stop.localArrivalZ).toBeLessThan(stop.maxZ);
    expect(stop.edgeX).toBeCloseTo(-0.92, 5);
    expect(stop.wallX).toBeCloseTo(-9.41, 5);
    expect(stop.columnX).toBeGreaterThanOrEqual(-7.725);
    expect(stop.northZ).toBeCloseTo(stop.minZ + 0.24, 5);
    expect(stop.southZ).toBeCloseTo(stop.maxZ - 0.24, 5);
  }
});
