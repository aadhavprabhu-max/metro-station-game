import { test, expect } from '@playwright/test';

const errorsByPage = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.trains?.length === 4);
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
});

test.afterEach(async ({ page }) => { expect(errorsByPage.get(page)).toEqual([]); });

test('every three-car train has broad vertical flat cab faces and common blue/silver exterior without changing line identities', async ({ page }) => {
  const models = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { world } = window.metro;
    world.scene.updateMatrixWorld(true);
    return world.trains.map(train => {
      const usedMaterials = new Set();
      train.traverse(object => { if (object.isMesh) [object.material].flat().forEach(material => usedMaterials.add(material.uuid)); });
      const cabs = train.cars.flatMap(car => car.cabs.map(record => {
        const group = record.group ?? record.cab ?? car.getObjectByName(record.end === -1 ? 'FrontCab' : 'RearCab');
        const shell = record.shell ?? group?.getObjectByName('CurvedCabShell');
        const geometries = record.shellGeometries ?? (shell ? [shell.geometry] : []);
        if (!geometries.length) throw new Error('Cab shell is missing from the actual train.');
        let minZ = Infinity, maxZ = -Infinity, vertices = 0;
        for (const geometry of geometries) {
          const positions = geometry.getAttribute('position');
          vertices += positions.count;
          for (let index = 0; index < positions.count; index++) {
            const z = positions.getZ(index);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          }
        }
        // Measure actual triangles rather than shape metadata. The shell has a
        // physical window apertures, so include their separate glass sheet in
        // both sides of the front-area ratio. Keep their depth ranges separate:
        // the glass deliberately sits 10 mm beyond the painted face.
        const frontMetrics = parts => {
          const planarBounds = new THREE.Box3();
          let projectedArea = 0, planarArea = 0;
          for (const geometry of parts) {
            const positions = geometry.getAttribute('position'), indices = geometry.index;
            const count = indices?.count ?? positions.count;
            for (let index = 0; index < count; index += 3) {
              const [a, b, c] = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions,
                indices ? indices.getX(index + offset) : index + offset));
              const normal = b.clone().sub(a).cross(c.clone().sub(a));
              if (normal.z >= -1e-12) continue;
              const area = -normal.z / 2;
              projectedArea += area;
              if (Math.hypot(normal.x, normal.y) > -normal.z * 1e-5) continue;
              planarArea += area;
              for (const point of [a, b, c]) planarBounds.expandByPoint(point);
            }
          }
          return { projectedArea, planarArea, min: planarBounds.min.toArray(), max: planarBounds.max.toArray() };
        };
        const shellFace = frontMetrics(geometries), glassGeometry = record.windshieldMesh.geometry;
        const glassFace = frontMetrics([glassGeometry]);
        const glassBounds = new THREE.Box3().setFromBufferAttribute(glassGeometry.getAttribute('position'));
        // Find real disconnected panes through triangle connectivity. A single
        // panoramic rectangle cannot satisfy the split windows and glazed door
        // layout simply by advertising a pane count in metadata.
        const geometryComponents = geometry => {
          const positions = geometry.getAttribute('position'), indices = geometry.index;
          if (!indices) throw new Error('Cab face components must expose indexed triangles.');
          const parents = Array.from({ length: positions.count }, (_, index) => index);
          const root = index => {
            while (parents[index] !== index) {
              parents[index] = parents[parents[index]];
              index = parents[index];
            }
            return index;
          };
          const usedVertices = new Set();
          for (let index = 0; index < indices.count; index += 3) {
            const vertices = [0, 1, 2].map(offset => indices.getX(index + offset));
            for (const vertex of vertices) {
              parents[root(vertex)] = root(vertices[0]);
              usedVertices.add(vertex);
            }
          }
          const componentBounds = new Map();
          for (const vertex of usedVertices) {
            const key = root(vertex);
            if (!componentBounds.has(key)) componentBounds.set(key, new THREE.Box3());
            componentBounds.get(key).expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, vertex));
          }
          return [...componentBounds.values()].map(bounds => ({ min: bounds.min.toArray(), max: bounds.max.toArray(),
            width: bounds.max.x - bounds.min.x, height: bounds.max.y - bounds.min.y,
            centerX: (bounds.max.x + bounds.min.x) / 2, centerY: (bounds.max.y + bounds.min.y) / 2 }));
        };
        const glassPanes = geometryComponents(glassGeometry).sort((first, second) => first.min[0] - second.min[0]);
        const lampClusters = record.lamps.map(({ main }) =>
          geometryComponents(main.geometry).sort((first, second) => first.centerY - second.centerY));
        const glassNormals = glassGeometry.getAttribute('normal');
        let glassNormalDeviation = 0;
        for (let index = 0; index < glassNormals.count; index++) {
          glassNormalDeviation = Math.max(glassNormalDeviation,
            Math.hypot(glassNormals.getX(index), glassNormals.getY(index)), Math.abs(glassNormals.getZ(index) + 1));
        }
        // Include the actual batched body, animated doors and coupler, so a
        // retained source geometry reference cannot hide an oversized vehicle.
        const bounds = new THREE.Box3().setFromObject(car).applyMatrix4(new THREE.Matrix4().copy(car.matrixWorld).invert());
        return { end: record.end, vertices, depth: maxZ - minZ, shellFace,
          planarFrontCoverage: (shellFace.planarArea + glassFace.planarArea) / (shellFace.projectedArea + glassFace.projectedArea),
          glassMin: glassBounds.min.toArray(), glassMax: glassBounds.max.toArray(), glassNormalDeviation, glassPanes, lampClusters,
          min: bounds.min.toArray(), max: bounds.max.toArray(), metadata: record.shellMetadata,
          windshield: record.windshieldMesh?.geometry.userData };
      }));
      return {
        line: train.lineId, carPositions: train.cars.map(car => car.position.toArray()), cabs,
        blue: train.materials.trainBlue.color.getHexString(), silver: train.materials.trainSilver.color.getHexString(),
        accent: train.materials.trainAccent.color.getHexString(),
        blueUsed: usedMaterials.has(train.materials.trainBlue.uuid), silverUsed: usedMaterials.has(train.materials.trainSilver.uuid),
        silverMetalness: train.materials.trainSilver.metalness,
        wheels: train.cars.map(car => ({ ...car.userData.undercarriage })),
        doorPositions: train.cars.map(car => car.doorways.filter(door => door.side === train.platformSide).map(door => door.localZ)),
      };
    });
  });
  expect(models.map(model => model.line)).toEqual(['U1', 'U2', 'U3', 'U4']);
  expect(models.map(model => model.accent)).toEqual(['316c65', 'b4443d', '3e71b6', '8d58ac']);
  for (const model of models) {
    expect(model.carPositions).toEqual([[0, 0, -17], [0, 0, 0], [0, 0, 17]]);
    expect(model.blue).toBe('287fbb'); expect(model.silver).toBe('b9c1c8');
    expect(model.blueUsed && model.silverUsed).toBe(true);
    expect(model.silverMetalness).toBeGreaterThanOrEqual(0.4);
    for (const wheel of model.wheels) {
      expect(wheel.wheelCenterY - wheel.wheelRadius).toBeCloseTo(wheel.railHeadY, 8);
      expect(wheel.wheelCenterX).toBe(0.72);
      expect(wheel.wheelRadius).toBe(0.34);
    }
    expect(model.doorPositions).toEqual([[-5.5, 0, 5.5], [-5.5, 0, 5.5], [-5.5, 0, 5.5]]);
    expect(model.cabs.map(cab => cab.end)).toEqual([-1, 1]);
    for (const cab of model.cabs) {
      expect(cab.vertices).toBeGreaterThan(100);
      expect(cab.depth).toBeGreaterThan(0.7);
      expect(cab.shellFace.planarArea).toBeGreaterThan(3);
      expect(cab.shellFace.max[0] - cab.shellFace.min[0]).toBeGreaterThan(2.4);
      expect(cab.shellFace.max[1] - cab.shellFace.min[1]).toBeGreaterThan(2.4);
      expect(cab.shellFace.max[2] - cab.shellFace.min[2]).toBeLessThanOrEqual(0.001);
      expect(cab.planarFrontCoverage).toBeGreaterThan(0.7);
      expect(cab.glassMax[0] - cab.glassMin[0]).toBeGreaterThan(2.2);
      expect(cab.glassMax[1] - cab.glassMin[1]).toBeGreaterThan(1);
      expect(cab.glassMax[2] - cab.glassMin[2]).toBeLessThanOrEqual(0.001);
      expect(cab.glassNormalDeviation).toBeLessThan(1e-5);
      expect(cab.glassPanes).toHaveLength(3);
      const [leftPane, doorPane, rightPane] = cab.glassPanes;
      for (const pane of [leftPane, rightPane]) {
        expect(pane.width).toBeGreaterThan(0.6);
        expect(pane.height / pane.width).toBeGreaterThan(1.6);
      }
      expect(doorPane.width).toBeCloseTo(0.5, 2);
      expect(doorPane.height).toBeGreaterThan(1.3);
      expect(doorPane.centerX).toBeCloseTo(0, 6);
      expect(doorPane.min[0] - leftPane.max[0]).toBeGreaterThanOrEqual(0.08);
      expect(rightPane.min[0] - doorPane.max[0]).toBeGreaterThanOrEqual(0.08);
      expect(cab.lampClusters).toHaveLength(2);
      for (const cluster of cab.lampClusters) {
        expect(cluster).toHaveLength(7);
        const first = cluster[0], last = cluster.at(-1);
        expect(last.centerY - first.centerY).toBeGreaterThan(0.4);
        expect(Math.abs(last.centerX - first.centerX)).toBeGreaterThan(0.3);
        const slope = (last.centerX - first.centerX) / (last.centerY - first.centerY);
        for (const led of cluster) {
          expect(led.width).toBeGreaterThan(0.06); expect(led.width).toBeLessThan(0.07);
          expect(led.height).toBeGreaterThan(0.06); expect(led.height).toBeLessThan(0.07);
          expect(led.max[2] - led.min[2]).toBeLessThanOrEqual(0.001);
          expect(Math.abs(led.centerX - first.centerX - (led.centerY - first.centerY) * slope)).toBeLessThan(1e-5);
        }
      }
      expect(cab.min[0]).toBeGreaterThanOrEqual(-1.51);
      expect(cab.max[0]).toBeLessThanOrEqual(1.51);
      expect(cab.min[2]).toBeGreaterThanOrEqual(-8.70);
      expect(cab.max[2]).toBeLessThanOrEqual(8.70);
      expect(cab.max[1]).toBeLessThanOrEqual(3.32);
      expect(cab.windshield?.compoundCurvature).toBe(false);
      expect(cab.windshield?.opaqueBacking).toBe(false);
    }
  }
});

test('sliding leaves expose physical door apertures and passengers cannot walk into either driver cab', async ({ page }) => {
  const doorResults = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { world } = window.metro;
    const raycaster = new THREE.Raycaster();
    const results = [];
    const blocked = (car, side, localZ, y) => {
      car.updateWorldMatrix(true, true);
      const origin = car.localToWorld(new THREE.Vector3(side * 1.85, y, localZ + 0.3));
      const direction = new THREE.Vector3(-side, 0, 0).transformDirection(car.matrixWorld);
      raycaster.set(origin, direction); raycaster.far = 0.65;
      return raycaster.intersectObject(car, true).some(hit => {
        const local = car.worldToLocal(hit.point.clone());
        return local.x * side >= 1.25 && local.x * side <= 1.6;
      });
    };
    for (const train of world.trains) {
      train.setDoorsOpen(train.platformSide);
      const open = train.cars.flatMap(car => car.doorways.filter(door => door.side === train.platformSide).flatMap(door => [0.6, 1.8].map(y => blocked(car, door.side, door.localZ, y))));
      const otherSide = train.cars.flatMap(car => car.doorways.filter(door => door.side === -train.platformSide).map(door => blocked(car, door.side, door.localZ, 0.6)));
      train.closeDoors(); for (let frame = 0; frame < 120; frame++) train.update(1 / 60);
      const closed = train.cars.flatMap(car => car.doorways.filter(door => door.side === train.platformSide).flatMap(door => [0.6, 1.8].map(y => blocked(car, door.side, door.localZ, y))));
      train.setDoorsOpen(train.platformSide);
      results.push({ line: train.lineId, open, otherSide, closed, leaves: train.cars.map(car => car.doors.length) });
    }
    return results;
  });
  for (const result of doorResults) {
    expect(result.leaves).toEqual([12, 12, 12]);
    expect(result.open).toHaveLength(18);
    expect(result.open.every(value => value === false)).toBe(true);
    expect(result.closed.every(Boolean)).toBe(true);
    expect(result.otherSide.every(Boolean)).toBe(true);
  }
  for (const line of ['U1', 'U2', 'U3', 'U4']) {
    for (const [carIndex, end] of [[0, -1], [1, 1], [2, 1]]) {
      const boarded = await page.evaluate(({ line, carIndex, end }) => {
        const { world, player } = window.metro;
        player.startAt(line);
        const train = player.service.train, car = train.cars[carIndex];
        const doorZ = end * 5.5;
        player.camera.position.set(train.platformSide * 2.697, 1.76, car.position.z + doorZ);
        train.localToWorld(player.camera.position);
        const success = player.interact();
        if (success) {
          // A legal position in the aisle, clear of seats and grab poles, makes
          // this specifically probe the new bulkhead rather than furniture.
          player.ridingOffset.x = 0.3;
          player.yaw = end === -1 ? 0 : Math.PI;
          player.applyLook(); player.syncRide();
        }
        return success && player.ridingCar === car;
      }, { line, carIndex, end });
      expect(boarded, `${line} car ${carIndex + 1} boarding`).toBe(true);
      await page.keyboard.down('w');
      const result = await page.evaluate(() => {
        const { player } = window.metro;
        for (let frame = 0; frame < 180; frame++) player.update(1 / 60);
        const z = player.ridingOffset.z - player.ridingCar.position.z;
        const left = player.interact();
        return { z, left, onPlatform: !player.ridingCar, local: player.station.worldToLocal(player.camera.position.clone()).toArray() };
      });
      await page.keyboard.up('w');
      expect(result.left && result.onPlatform).toBe(true);
      if (carIndex === 1) expect(result.z).toBeCloseTo(7.05, 6);
      else expect(result.z * end).toBeLessThan(6.55);
      expect(result.local[1]).toBeCloseTo(1.76, 6);
    }
  }
});

test('upgraded trains keep their rails and clear platforms/tunnels while both cab light states and destinations reverse correctly', async ({ page }) => {
  test.setTimeout(180000);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { world } = window.metro;
    const offsets = world.trains.map(train => train.cars.map(car => car.position.toArray()));
    const previous = world.services.map(service => service.distance);
    const recorded = world.services.map(() => 0), midpointRecorded = new Set();
    const stops = [], tunnels = [], failures = [];
    const raycaster = new THREE.Raycaster();
    const check = (value, message) => { if (!value && failures.length < 12) failures.push(message); };
    const clearance = (service, geometryRoot) => {
      geometryRoot.updateWorldMatrix(true, true);
      service.train.updateWorldMatrix(true, true);
      const distances = [];
      for (const z of [-25, 0, 25]) {
        for (const [position, direction] of [
          [[0, 3.32, z], [0, 1, 0]], [[-1.5, 1.3, z], [-1, 0, 0]], [[1.5, 1.3, z], [1, 0, 0]],
        ]) {
          const origin = service.train.localToWorld(new THREE.Vector3(...position));
          raycaster.set(origin, new THREE.Vector3(...direction).transformDirection(service.train.matrixWorld));
          raycaster.far = 35;
          const hit = raycaster.intersectObject(geometryRoot, true)[0];
          distances.push(hit?.distance ?? null);
        }
      }
      return distances;
    };
    for (let frame = 0; frame < 900 * 60; frame++) {
      world.update(1 / 60);
      world.services.forEach((service, index) => {
        const train = service.train, sample = service.route.sample(service.distance);
        check(train.position.distanceTo(sample.position) < 1e-7, `${service.lineId} left its rails.`);
        check(Math.abs(service.distance - previous[index]) <= 10 / 60 + 1e-6, `${service.lineId} jumped along its route.`);
        check(train.cars.every((car, carIndex) => car.position.toArray().every((value, axis) => value === offsets[index][carIndex][axis])), `${service.lineId} cars separated.`);
        const cabRecords = train.cars.flatMap(car => car.cabs);
        check(cabRecords.filter(cab => cab.headlights.intensity > 0).length === 1, `${service.lineId} has the wrong number of active headlights.`);
        for (const cab of cabRecords) {
          const leading = cab.end === -service.cabDirection;
          check((cab.headlights.intensity > 0) === leading, `${service.lineId} active cab does not match its direction.`);
          check(cab.lamps.every(lamp => lamp.main.material === (leading ? cab.materials.warmLight : cab.materials.redLight)), `${service.lineId} head/tail lamp materials are wrong.`);
        }
        previous[index] = service.distance;
        if (service.speed > 0) check(train.doorsClosed, `${service.lineId} moved with open doors.`);
        const leg = service.completedLegs;
        const key = `${service.lineId}:${leg}`;
        const midpoint = (service.currentStop.distance + service.nextStop.distance) / 2;
        if (leg < service.route.stops.length - 1 && !midpointRecorded.has(key) && service.speed > 0 && Math.abs(service.distance - midpoint) < 0.1) {
          midpointRecorded.add(key);
          tunnels.push({ line: service.lineId, leg, clearance: clearance(service, world.lineWorlds[service.lineId]) });
        }
        if (service.completedLegs > recorded[index] && service.state === 'boarding') {
          recorded[index] = service.completedLegs;
          const station = world.stations.find(item => item.stationId === service.currentStop.id && item.lineId === service.lineId);
          stops.push({ line: service.lineId, id: station.stationId, leg: service.completedLegs,
            platformSide: service.platformSide,
            direction: service.direction, cabDirection: service.cabDirection, reversalPending: service.reversalPending,
            position: train.position.toArray(), floorY: station.getWorldPosition(new THREE.Vector3()).y,
            terminal: service.destinationStop.name,
            displays: train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => ({ line: display.userData.lineId, destination: display.userData.destination }))),
            clearance: clearance(service, station) });
        }
      });
      if (recorded.every((legs, index) => legs >= (index === 0 ? 4 : 6))) break;
    }
    return { failures, stops, tunnels, recorded, glError: world.renderer.getContext().getError() };
  });
  expect(result.failures).toEqual([]);
  expect(result.recorded.every((legs, index) => legs >= (index === 0 ? 4 : 6))).toBe(true);
  const expected = {
    U1: ['station-2', 'station-3', 'station-2', 'station-1'],
    U2: ['station-2', 'u2-schwarzkopf', 'u2-eisenwerk', 'u2-schwarzkopf', 'station-2', 'u2-stadtzentrum'],
    U3: ['station-2', 'u3-ostbahnhof', 'u3-stadtbruecke', 'u3-ostbahnhof', 'station-2', 'u3-schattenufer'],
    U4: ['u4-westbahnhof', 'station-2', 'u4-arabellapark', 'station-2', 'u4-westbahnhof', 'u4-kaiser-humboldt'],
  };
  for (const [line, ids] of Object.entries(expected)) {
    const stops = result.stops.filter(stop => stop.line === line).slice(0, ids.length);
    expect(stops.map(stop => stop.id)).toEqual(ids);
    for (const stop of stops) {
      expect(stop.position[1]).toBe(stop.floorY);
      expect(stop.displays.every(display => display.line === line && display.destination === stop.terminal)).toBe(true);
      // Central's existing pedestrian cross-passage intentionally removes its
      // back wall at z=-25. Only that exact lateral ray may have no wall hit;
      // overhead clearance and every other wall remain mandatory.
      const openingRay = stop.id === 'station-2' ? (stop.platformSide === -1 ? 1 : 2) : -1;
      expect(stop.clearance.every((distance, index) => index === openingRay
        ? distance === null || distance > 0.05
        : distance !== null && distance > 0.05)).toBe(true);
    }
    expect(result.tunnels.filter(tunnel => tunnel.line === line)).toHaveLength(line === 'U1' ? 2 : 3);
  }
  for (const tunnel of result.tunnels) expect(tunnel.clearance.every(distance => distance !== null && distance > 0.05)).toBe(true);
  expect(result.glError).toBe(0);
});
