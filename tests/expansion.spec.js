import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const ORDERS = {
  U1: ['Nordplatz', 'Central', 'Rosenheimer Platz', 'Lindenallee', 'Universitätsviertel', 'Botanischer Garten', 'Ostgärten'],
  U2: ['Stadtzentrum', 'Rathausmarkt', 'Central', 'Kupfergasse', 'Schwarzkopf-Tunnel', 'Stahlhof', 'Eisenwerk'],
  U3: ['Schattenufer', 'Central', 'Ostbahnhof', 'Stadtbrücke', 'Museumsinsel', 'Kanalpark', 'Seetor'],
  U4: ['Kaiser-Humboldt-Platz', 'Westbahnhof', 'Central', 'Arabellapark'],
  U5: ['Westbahnhof', 'Südstadt', 'Stadionpark', 'Messepark', 'Technologiecampus', 'Flughafen', 'Nordklinikum', 'Waldtor', 'Hafenbogen', 'Ostbahnhof'],
  U6: ['Stadtzentrum', 'Theaterinsel', 'Südklinikum', 'Sonnenfeld', 'Ringplatz', 'Waldsee', 'Feldkirchen', 'Industriepark', 'Arabellapark'],
};
let page;
const runtimeErrors = [], failedRequests = [];

test.describe('complete six-line network — scripted production-model journeys', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180000);
    page = await browser.newPage({ baseURL: testInfo.project.use.baseURL, viewport: { width: 960, height: 600 } });
    page.on('pageerror', error => runtimeErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
    page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });
    const response = await page.goto(process.env.METRO_PRODUCTION_URL || '/');
    if (process.env.METRO_PRODUCTION_URL) {
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      const built = await readFile(new URL('../dist/index.html', import.meta.url));
      expect(hash(await response.body())).toBe(hash(built));
    }
    await page.waitForFunction(() => window.metro?.ready && window.metro.world.services?.length === 6, undefined, { timeout: 120000 });
    // Explicitly scripted 1/30-second simulation. Normal RAF rendering and
    // real-time visual validation are exercised separately by the preview QA.
    await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  });
  test.afterEach(async () => {
    expect(runtimeErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
  test.afterAll(async () => { await page?.close(); });

  test('37 shared stations have 44 real platforms, six independent services and the approved orders', async () => {
    const result = await page.evaluate(() => {
      const { world } = window.metro;
      return {
        nodes: world.network.nodes.size, platforms: world.stations.length,
        trains: world.trains.length, services: world.services.map(service => service.lineId),
        orders: Object.fromEntries(Object.entries(world.routes).map(([lineId, route]) => [lineId, route.stops.map(stop => stop.name)])),
        identities: world.stations.every(station => station.networkNode === world.network.nodes.get(station.stationId)),
        uniquePlatforms: new Set(world.stations.map(station => station.platformId)).size,
        central: world.stations.filter(station => station.stationId === 'station-2').map(station => ({ line: station.lineId, floor: station.floorY })),
        shared: ['u4-westbahnhof', 'u3-ostbahnhof', 'u2-stadtzentrum', 'u4-arabellapark'].map(id => ({ id, lines: [...world.network.nodes.get(id).lineIds] })),
        attached: world.trains.every(train => train.parent && train.cars.length === 3 && train.cars.every(car => car.parent === train)),
        canvas: [world.renderer.domElement.width, world.renderer.domElement.height],
        glError: world.renderer.getContext().getError(),
      };
    });
    expect(result.nodes).toBe(37); expect(result.platforms).toBe(44);
    expect(result.trains).toBe(6); expect(result.uniquePlatforms).toBe(44);
    expect(result.services).toEqual(['U1', 'U2', 'U3', 'U4', 'U5', 'U6']);
    expect(result.orders).toEqual(ORDERS);
    expect(result.identities && result.attached).toBe(true);
    expect(result.central).toEqual([{ line: 'U1', floor: 0 }, { line: 'U2', floor: 0 }, { line: 'U3', floor: -12 }, { line: 'U4', floor: -12 }]);
    expect(result.shared).toEqual([
      { id: 'u4-westbahnhof', lines: ['U4', 'U5'] }, { id: 'u3-ostbahnhof', lines: ['U3', 'U5'] },
      { id: 'u2-stadtzentrum', lines: ['U2', 'U6'] }, { id: 'u4-arabellapark', lines: ['U4', 'U6'] },
    ]);
    expect(result.canvas.every(value => value > 0)).toBe(true);
    expect(result.glError).toBe(0);
  });

  for (const lineId of Object.keys(ORDERS)) {
    test(`${lineId}: real three-car train makes every outbound/return stop with boarding and correct displays`, async ({}, testInfo) => {
      test.setTimeout(300000);
      const result = await page.evaluate(line => {
        const { world, player } = window.metro, service = world.services.find(item => item.lineId === line);
        const train = service.train, route = service.route, Vector3 = world.camera.position.constructor;
        const info = world.passengerInformation.find(item => item.service === service);
        const screens = world.passengerDisplays.find(item => item.information === info);
        const check = (value, message) => { if (!value) throw new Error(`${line}: ${message}`); };
        player.reset(); service.reset();
        check(player.startAt(line), 'Cannot select the actual start platform.');
        world.update(0);
        let samples = 0, previousDistance = service.distance, previousState = service.state, previousLeg = 0;
        let simulatedSeconds = 0, pendingInfoTime = 0, maxRiderError = 0, maxWheelError = 0, maxCarError = 0;
        let boards = 0, exits = 0, ridingLocal = null;
        const visits = [], renderedStations = new Set(), renderedViews = [];
        const scratch = document.createElement('canvas'); scratch.width = 64; scratch.height = 40;
        const context = scratch.getContext('2d', { willReadFrequently: true });
        const checkTrain = () => {
          train.updateWorldMatrix(true, true); samples++;
          check(train.position.distanceTo(route.sample(service.distance).position) < 1e-7, 'Root left the sampled rails.');
          train.cars.forEach((car, index) => {
            const offset = car.userData.nominalRouteOffset, distance = service.distance - offset;
            maxCarError = Math.max(maxCarError, car.getWorldPosition(new Vector3()).distanceTo(route.sampleExtended(distance).position));
            check(car.bogies.length === 2 && car.bogies.every(bogie => bogie.children.some(mesh => mesh.isMesh && mesh.geometry.getAttribute('position').count > 100)), 'Actual wheel/truck meshes are missing.');
            if (!route.hasCurves) check(car.position.x === 0 && car.position.y === 0 && car.position.z === (index - 1) * 17, 'Straight-line car offsets changed.');
            for (const bogie of car.bogies) {
              const bogieDistance = distance - bogie.userData.localZ;
              check(bogie.getWorldPosition(new Vector3()).distanceTo(route.sampleExtended(bogieDistance).position) < 1e-7, 'Truck left the sampled rails.');
              const wheels = car.userData.undercarriage;
              check(Math.abs(wheels.wheelCenterY - wheels.wheelRadius - wheels.railHeadY) < 1e-8, 'Wheel/rail vertical alignment changed.');
              for (const axle of [-0.85, 0.85]) for (const side of [-1, 1]) {
                const actual = bogie.localToWorld(new Vector3(side * wheels.wheelCenterX, wheels.wheelCenterY, axle));
                const sample = route.sampleExtended(bogieDistance - axle);
                const rail = sample.position.add(new Vector3(Math.cos(sample.yaw) * side * 0.7175, wheels.wheelCenterY, -Math.sin(sample.yaw) * side * 0.7175));
                maxWheelError = Math.max(maxWheelError, actual.distanceTo(rail));
              }
            }
            if (index > 0) {
              const spacing = car.getWorldPosition(new Vector3()).distanceTo(train.cars[index - 1].getWorldPosition(new Vector3()));
              check(spacing > 16.98 && spacing < 17.001, 'The connected cars separated.');
            }
          });
          const cabs = train.cars.flatMap(car => car.cabs);
          check(cabs.length === 2 && cabs.filter(cab => cab.headlights.intensity > 0).length === 1, 'Active cab lights are wrong.');
          check(cabs.every(cab => (cab.headlights.intensity > 0) === (cab.end === -service.cabDirection)), 'Active cab disagrees with direction.');
        };
        const board = car => {
          const door = train.boardingDoors.find(item => train.cars[item.carIndex] === car && item.localZ === 0);
          check(Boolean(door), 'No real open doorway.');
          const outward = new Vector3(door.side, 0, 0).transformDirection(car.matrixWorld);
          player.camera.position.copy(door.position).addScaledVector(outward, 1.3); player.camera.position.y += 1.66;
          check(player.interactionHint().enabled && player.interact() && player.ridingCar === car, `Cannot board car ${car.carNumber}.`);
          boards++; ridingLocal = car.worldToLocal(player.camera.position.clone());
        };
        const leave = () => {
          check(player.interact() && !player.ridingCar, 'Cannot alight through an open station door.'); exits++;
          const local = player.station.worldToLocal(player.camera.position.clone());
          check(local.x >= player.station.bounds.minX + player.radius - 1e-7 && local.x <= player.station.bounds.maxX - player.radius + 1e-7, 'Alighted outside the safe platform.');
          check(Math.abs(local.y - 1.76) < 1e-7 && !player.collides(local.x, local.z, player.station.colliders), 'Alighted into station geometry.');
        };
        const atStop = () => {
          check(service.speed === 0 && service.atStation && service.canBoard, 'Doors opened away from a correctly stopped station.');
          check(Math.abs(service.distance - service.currentStop.distance) < 1e-8, 'Inaccurate station stop.');
          check(train.cars.every(car => car.doorProgressBySide[service.platformSide] >= 0.98 && car.doorProgressBySide[-service.platformSide] === 0), 'Wrong-side doors are open.');
          checkTrain();
          if (player.ridingCar) leave();
          const station = world.stations.find(item => item.stationId === service.currentStop.id && item.lineId === line);
          check(Boolean(station), 'Stop has no actual station/platform.'); player.useStation(station);
          info.update(pendingInfoTime); pendingInfoTime = 0; screens.update(); world.update(0);
          const displays = train.cars.flatMap(car => car.destinationDisplays.map(record => record.display.userData));
          check(displays.length >= 4 && displays.every(display => display.lineId === line && display.destination === service.destinationStop.name), 'Destination display is stale or assigned to another line.');
          check(screens.screens.every(mesh => mesh.userData.currentStation === service.currentStop.id && mesh.userData.destination === service.destinationStop.id && mesh.userData.nextStation === service.nextStop.id), 'Passenger displays disagree with the live service.');
          const rows = station.departures.departures.filter(row => row.route === line);
          check(rows.some(row => row.destination === service.destinationStop.name && row.nextStop === service.nextStop.name), 'Platform departures disagree with the live service.');
          let colors = null;
          if (!renderedStations.has(station.platformId)) {
            // Controlled platform viewpoint, actual scene/light/renderer. Pixel
            // checks prove rendering; a person still inspects screenshots in QA.
            player.camera.position.set(-6.6, 1.76, -31.5); station.localToWorld(player.camera.position);
            const target = train.cars[0].getWorldPosition(new Vector3());
            player.yaw = Math.atan2(-(target.x - player.camera.position.x), -(target.z - player.camera.position.z)); player.pitch = -0.04; player.applyLook();
            world.update(0); world.renderer.render(world.scene, world.camera);
            context.drawImage(world.renderer.domElement, 0, 0, 64, 40);
            const pixels = context.getImageData(0, 0, 64, 40).data, palette = new Set();
            for (let index = 0; index < pixels.length; index += 4) palette.add(`${pixels[index] >> 3},${pixels[index + 1] >> 3},${pixels[index + 2] >> 3}`);
            colors = palette.size; check(colors > 8, 'Station rendered as a blank frame.');
            check(world.renderer.getContext().getError() === 0, 'WebGL error after rendering a real stop.');
            renderedStations.add(station.platformId); renderedViews.push({ id: station.platformId, png: world.renderer.domElement.toDataURL('image/png') });
          }
          for (const car of train.cars) { board(car); leave(); }
          board(train.cars[0]);
          visits.push({ id: service.currentStop.id, name: service.currentStop.name, direction: service.direction, side: service.platformSide,
            destination: service.destinationStop.name, next: service.nextStop.name, colors });
        };
        atStop();
        const dt = 1 / 30, completeLegs = 2 * (route.stops.length - 1);
        let frame = 0;
        while (service.completedLegs < completeLegs || !service.canBoard) {
          service.update(dt); player.update(dt); simulatedSeconds += dt; pendingInfoTime += dt; frame++;
          check(Math.abs(service.distance - previousDistance) <= service.maxSpeed * dt + 1e-6, 'Train teleported along its route.');
          previousDistance = service.distance;
          if (service.speed > 0) check(train.doorsClosed && !service.canBoard && !player.interact(), 'Moving-train door interlock failed.');
          if (player.ridingCar) maxRiderError = Math.max(maxRiderError, player.ridingCar.worldToLocal(player.camera.position.clone()).distanceTo(ridingLocal));
          if (frame % 30 === 0 || previousState !== service.state || previousLeg !== service.completedLegs) {
            info.update(pendingInfoTime); pendingInfoTime = 0; screens.update(); checkTrain();
          }
          previousState = service.state;
          if (service.canBoard && service.completedLegs !== previousLeg) { previousLeg = service.completedLegs; atStop(); }
          check(simulatedSeconds < 2000, 'Full return journey exceeded 2,000 simulated seconds.');
        }
        check(maxRiderError < 1e-6 && maxCarError < 1e-6 && maxWheelError < 0.01, 'Rider/car/wheel path alignment regressed.');
        check(world.renderer.getContext().getError() === 0, 'WebGL error after completing the route.');
        player.reset();
        return { line, visits, renderedViews, renderedPlatforms: renderedStations.size, samples, boards, exits, simulatedSeconds, maxRiderError, maxCarError, maxWheelError, glError: world.renderer.getContext().getError() };
      }, lineId);
      for (const view of result.renderedViews) await writeFile(testInfo.outputPath(`${view.id.replaceAll(':', '-')}.png`), Buffer.from(view.png.split(',')[1], 'base64'));
      delete result.renderedViews;
      const order = ORDERS[lineId];
      expect(result.visits.map(visit => visit.name)).toEqual([...order, ...order.slice(0, -1).reverse()]);
      expect(result.renderedPlatforms).toBe(order.length);
      expect(result.boards).toBe(result.visits.length * 4);
      expect(result.exits).toBe(result.boards - 1);
      expect(result.maxRiderError).toBeLessThan(1e-6);
      expect(result.maxWheelError).toBeLessThan(0.01);
      expect(result.glError).toBe(0);
      if (lineId === 'U5') {
        expect(result.visits.find(visit => visit.name === 'Ostbahnhof').side).toBe(1);
        expect(result.visits.filter(visit => visit.name !== 'Ostbahnhof').every(visit => visit.side === -1)).toBe(true);
      }
      await testInfo.attach(`${lineId}-scripted-journey`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    });
  }
  test('Phase 5 landmark ceilings are visible physical geometry and restore their rendered image', async ({}, testInfo) => {
    test.setTimeout(180000);
    for (const [lineId, stationId, shape] of [
      ['U1', 'u1-universitaetsviertel', 'folded-structural-plates'],
      ['U3', 'u3-seetor', 'extruded-wave-ribs'],
    ]) {
      const result = await page.evaluate(({ lineId, stationId }) => {
        const { world, player } = window.metro;
        if (!player.startAt(lineId, stationId)) throw new Error('Missing Phase 5 platform.');
        player.pitch = 0.38; player.applyLook(); world.update(0);
        const station = player.station, signature = station.signatureGroup;
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const capture = () => {
          world.renderer.shadowMap.needsUpdate = true;
          world.renderer.render(world.scene, world.camera);
          ctx.drawImage(world.renderer.domElement, 0, 0, 96, 64);
          return ctx.getImageData(0, 0, 96, 64).data;
        };
        const difference = (a, b) => {
          let changed = 0;
          for (let i = 0; i < a.length; i += 4) if ([0, 1, 2].some(c => Math.abs(a[i + c] - b[i + c]) > 2)) changed++;
          return changed;
        };
        const before = capture(); let hidden;
        try { signature.visible = false; hidden = capture(); }
        finally { signature.visible = true; }
        const restored = capture();
        return { shape: signature.userData.ceiling?.shape, changed: difference(before, hidden), restored: difference(before, restored),
          signatureVertices: station.signatureRoof.geometry.getAttribute('position').count,
          instances: station.signatureRoof.count, activePlatform: world.lighting.currentPlatformId,
          gl: world.renderer.getContext().getError(), png: world.renderer.domElement.toDataURL('image/png') };
      }, { lineId, stationId });
      expect(result.shape).toBe(shape); expect(result.changed).toBeGreaterThan(100); expect(result.restored).toBe(0);
      expect(result.signatureVertices).toBeGreaterThan(20); expect(result.instances).toBeGreaterThan(10);
      expect(result.activePlatform).toBe(`${stationId}:${lineId}`); expect(result.gl).toBe(0);
      await writeFile(testInfo.outputPath(`${stationId}-ceiling.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    }
  });

  test('completed U1, U2 and U3 remain connected through Central with live destination and transfer information', async ({}, testInfo) => {
    test.setTimeout(180000);
    await page.evaluate(() => {
      const { world, player } = window.metro;
      player.startAt('U1', 'station-2'); player.camera.position.set(-6, 1.76, -264);
      world.update(0); world.renderer.domElement.focus();
    });
    const descent = [[-6, -276], [-7.45, -280], [-7.45, -284.7], [-7.45, -288], [-7.45, -291.75], [-4.15, -291.75],
      [-4.15, -288], [-4.15, -284.1], [-7.45, -284.1], [-7.45, -288], [-7.45, -291.75],
      [-4.15, -291.75], [-4.15, -288], [-4.15, -284.1], [-4.15, -280]];
    const ascent = [[-4.15, -284.1], [-4.15, -288], [-4.15, -291.75], [-7.45, -291.75],
      [-7.45, -288], [-7.45, -284.1], [-4.15, -284.1], [-4.15, -288], [-4.15, -291.75],
      [-7.45, -291.75], [-7.45, -288], [-7.45, -284.1], [-7.45, -280]];
    const reports = [];
    for (const [expectedLine, points] of [['U2', [[-16, -264]]], ['U1', [[-6, -264]]], ['U3', descent], ['U1', ascent]]) {
      await page.keyboard.down('w'); await page.keyboard.down('Shift');
      let report;
      try {
        report = await page.evaluate(points => {
          const { world, player } = window.metro;
          let maxHeightStep = 0, maxPlanarStep = 0; const flights = new Set();
          for (const [x, z] of points) {
            let reached = false;
            for (let frame = 0; frame < 300; frame++) {
              player.yaw = Math.atan2(-(x - player.camera.position.x), -(z - player.camera.position.z)); player.applyLook();
              const previous = player.camera.position.clone(); world.update(1 / 60);
              maxHeightStep = Math.max(maxHeightStep, Math.abs(player.camera.position.y - previous.y));
              maxPlanarStep = Math.max(maxPlanarStep, Math.hypot(player.camera.position.x - previous.x, player.camera.position.z - previous.z));
              if (player.transferSurface?.kind === 'stairs') flights.add(player.transferSurface.id);
              if (Math.hypot(player.camera.position.x - x, player.camera.position.z - z) < 0.14) { reached = true; break; }
            }
            if (!reached) throw new Error(`Central walk blocked toward ${x},${z}.`);
          }
          return { line: player.service.lineId, platform: player.station.platformId,
            feetY: player.camera.position.y - 1.76, maxHeightStep, maxPlanarStep, flights: [...flights] };
        }, points);
      } finally { await page.keyboard.up('w'); await page.keyboard.up('Shift'); }
      expect(report.line).toBe(expectedLine); expect(report.platform).toBe(`station-2:${expectedLine}`);
      expect(report.feetY).toBeCloseTo(expectedLine === 'U3' ? -12 : 0, 6);
      expect(report.maxHeightStep).toBeLessThanOrEqual(0.1875 + 1e-6);
      expect(report.maxPlanarStep).toBeLessThanOrEqual(7 / 60 + 1e-6);
      if (points === descent || points === ascent) expect(report.flights).toHaveLength(4);
      reports.push(report);
    }
    const information = await page.evaluate(() => {
      const { world } = window.metro;
      return {
        upper: world.stations.find(station => station.platformId === 'station-2:U2').departures.departures.map(row => ({ line: row.route, destination: row.destination, next: row.nextStop })),
        lower: world.stations.find(station => station.platformId === 'station-2:U3').departures.departures.map(row => ({ line: row.route, destination: row.destination })),
        hive: world.stations.filter(station => station.stationId === 'station-2' && station.floorY < 0).every(station => Boolean(station.cofferGeometry)),
        centralShared: ['U1', 'U2', 'U3'].every(id => world.routes[id].stops.find(stop => stop.id === 'station-2').node === world.network.nodes.get('station-2')),
      };
    });
    expect(information.upper).toEqual([
      { line: 'U1', destination: 'Ostgärten', next: 'Rosenheimer Platz' }, { line: 'U1', destination: 'Nordplatz', next: 'Nordplatz' },
      { line: 'U2', destination: 'Eisenwerk', next: 'Kupfergasse' }, { line: 'U2', destination: 'Stadtzentrum', next: 'Rathausmarkt' },
    ]);
    expect(information.lower).toContainEqual({ line: 'U3', destination: 'Seetor' });
    expect(information.hive && information.centralShared).toBe(true);
    await testInfo.attach('phase5-central-keyboard-transfers', { body: JSON.stringify({ reports, information }, null, 2), contentType: 'application/json' });
  });

  test('all four added interchanges support keyboard walking both ways without a level jump', async ({}, testInfo) => {
    test.setTimeout(180000);
    const reports = [];
    for (let index = 0; index < 4; index++) for (const reverse of [false, true]) {
      await page.evaluate(({ index, reverse }) => {
        const { world, player } = window.metro, transfer = world.networkTransfers[index];
        const station = transfer.platforms[reverse ? 1 : 0];
        const end = index === 0 ? (reverse ? 44 : -44) : index === 3 ? -44 : 44;
        player.startAt(station.lineId, station.stationId);
        player.camera.position.set(-5.8, 1.76, end - Math.sign(end) * 2.2); station.localToWorld(player.camera.position);
        world.update(0); world.renderer.domElement.focus();
      }, { index, reverse });
      await page.keyboard.down('w');
      let report;
      try {
        report = await page.evaluate(({ index, reverse }) => {
          const { world, player } = window.metro, transfer = world.networkTransfers[index];
          const endStation = transfer.platforms[reverse ? 0 : 1];
          const end = index === 0 ? (reverse ? -44 : 44) : index === 3 ? -44 : 44;
          const destination = endStation.localToWorld(player.camera.position.clone().set(-5.8, 0, end - Math.sign(end) * 2.2));
          const path = [...transfer.walkingPath]; if (reverse) path.reverse(); path.push({ x: destination.x, y: destination.y, z: destination.z });
          const flights = new Set(); let frames = 0, maxHeightStep = 0, capture = null;
          for (const target of path) {
            for (let step = 0; step < 3000; step++) {
              const dx = target.x - player.camera.position.x, dz = target.z - player.camera.position.z;
              if (Math.hypot(dx, dz) < 0.12 && Math.abs(target.y + 1.76 - player.camera.position.y) < 0.4) break;
              const previous = player.camera.position.clone();
              player.yaw = Math.atan2(-dx, -dz); player.pitch = -0.12; player.applyLook(); player.update(1 / 60); frames++;
              maxHeightStep = Math.max(maxHeightStep, Math.abs(previous.y - player.camera.position.y));
              if (previous.distanceTo(player.camera.position) < 1e-8) throw new Error(`${transfer.stationId}: stuck at ${player.camera.position.toArray()} toward ${JSON.stringify(target)}`);
              if (player.transferSurface?.kind === 'stairs') {
                flights.add(player.transferSurface.id);
                if (!capture && !reverse) { world.update(0); world.renderer.render(world.scene, world.camera); capture = world.renderer.domElement.toDataURL('image/png'); }
              }
              if (step === 2999) throw new Error(`${transfer.stationId}: never reached walking waypoint`);
            }
          }
          world.update(0);
          return { id: transfer.stationId, reverse, frames, maxHeightStep, flights: flights.size,
            expectedFlights: transfer.towers.reduce((n, tower) => n + tower.flights, 0), line: player.service.lineId,
            expectedLine: endStation.lineId, feetY: player.camera.position.y - 1.76, expectedY: endStation.floorY,
            riding: Boolean(player.ridingCar), capture, gl: world.renderer.getContext().getError() };
        }, { index, reverse });
      } finally { await page.keyboard.up('w'); }
      if (report.capture) await writeFile(testInfo.outputPath(`${report.id}-stairs.png`), Buffer.from(report.capture.split(',')[1], 'base64'));
      delete report.capture;
      expect(report.line).toBe(report.expectedLine); expect(report.feetY).toBeCloseTo(report.expectedY, 6);
      expect(report.flights).toBe(report.expectedFlights); expect(report.maxHeightStep).toBeLessThan(0.2);
      expect(report.riding).toBe(false); expect(report.gl).toBe(0); reports.push(report);
    }
    await testInfo.attach('physical-keyboard-transfers', { body: JSON.stringify(reports, null, 2), contentType: 'application/json' });
  });

});
