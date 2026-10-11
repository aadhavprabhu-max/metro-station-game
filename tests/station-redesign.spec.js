import { test, expect } from '@playwright/test';

const errorsByPage = new WeakMap();
const redesignedPlatforms = [
  { lineId: 'U2', stationId: 'u2-stadtzentrum' },
  { lineId: 'U3', stationId: 'station-2' },
  { lineId: 'U4', stationId: 'station-2' },
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?line=U2');
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.services?.length === 4);
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
});

test.afterEach(async ({ page }) => { expect(errorsByPage.get(page)).toEqual([]); });

test('the approved station designs use curved glass and genuinely hollow three-dimensional coffers without obstructing trains or the upper level', async ({ page }) => {
  const result = await page.evaluate(async platforms => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { world } = window.metro;
    world.scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const box = object => new THREE.Box3().setFromObject(object);
    const dimensions = bounds => ({ min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() });
    const normals = root => {
      const geometries = new Set();
      let invalidVertices = 0, nonUnitNormals = 0;
      root.traverse(object => {
        if (!object.isMesh || geometries.has(object.geometry)) return;
        geometries.add(object.geometry);
        const positions = object.geometry.getAttribute('position'), normal = object.geometry.getAttribute('normal');
        if (!positions || !normal) { invalidVertices++; return; }
        for (let index = 0; index < positions.count; index++) {
          const values = [positions.getX(index), positions.getY(index), positions.getZ(index), normal.getX(index), normal.getY(index), normal.getZ(index)];
          if (!values.every(Number.isFinite)) invalidVertices++;
          if (Math.abs(Math.hypot(...values.slice(3)) - 1) > 1e-4) nonUnitNormals++;
        }
      });
      return { invalidVertices, nonUnitNormals, geometryCount: geometries.size };
    };
    const inspect = ({ lineId, stationId }) => {
      const station = world.stations.find(item => item.stationId === stationId && item.lineId === lineId);
      if (!station?.signatureGroup) throw new Error(`Missing actual signature architecture for ${stationId}:${lineId}.`);
      const service = world.services.find(item => item.lineId === lineId), train = service.train;
      // Measure the actual train envelope instead of assigning a new train pose
      // or assuming that the recent cab redesign has a particular height.
      const trainBounds = box(train), inverseTrain = train.matrixWorld.clone().invert();
      const localTrainBounds = new THREE.Box3().makeEmpty();
      for (const x of [trainBounds.min.x, trainBounds.max.x]) for (const y of [trainBounds.min.y, trainBounds.max.y]) for (const z of [trainBounds.min.z, trainBounds.max.z]) {
        localTrainBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inverseTrain));
      }
      const probeZ = [localTrainBounds.min.z + 0.02, ...train.cars.map(car => car.position.z), localTrainBounds.max.z - 0.02];
      const clearance = (origin, direction) => {
        ray.set(station.localToWorld(new THREE.Vector3(...origin)), new THREE.Vector3(...direction).transformDirection(station.matrixWorld));
        ray.far = 30;
        return ray.intersectObject(station.signatureGroup, true)[0]?.distance ?? null;
      };
      const overhead = probeZ.map(z => clearance([1.57, localTrainBounds.max.y + 0.01, z], [0, 1, 0]));
      const aisle = [-35, -17, 0, 17, 35].map(z => clearance([-4.8, 1.76, z], [0, 1, 0]));
      const data = { platformId: station.platformId, floorY: station.getWorldPosition(new THREE.Vector3()).y,
        normals: normals(station.signatureGroup), overhead, aisle };
      if (stationId === 'u2-stadtzentrum') {
        const roof = station.signatureRoof;
        if (!roof?.isMesh) throw new Error('Glass Cathedral has no actual glass roof mesh.');
        const localBounds = box(roof).applyMatrix4(station.matrixWorld.clone().invert());
        data.glass = {
          bounds: dimensions(localBounds), indexed: Boolean(roof.geometry.index),
          transparent: roof.material.transparent || roof.material.transmission > 0,
          depthWrite: roof.material.depthWrite,
          ribs: Boolean(station.primaryRibs?.isInstancedMesh), mullions: Boolean(station.secondaryMullions?.isInstancedMesh),
        };
      } else {
        const geometry = station.cofferGeometry, frames = station.cofferFrameMeshes;
        if (!geometry || !frames?.length || !station.ceilingGroup) throw new Error('Golden Hive has no retained real coffer geometry.');
        geometry.computeBoundingBox();
        const sideAngles = new Set(), normal = geometry.getAttribute('normal');
        for (let index = 0; index < normal.count; index++) {
          if (Math.abs(normal.getY(index)) < 1e-5) sideAngles.add(Math.round(Math.atan2(normal.getZ(index), normal.getX(index)) * 1e5));
        }
        // Isolate the actual shared frame geometry so recessed lights/louvres
        // cannot masquerade as a filled frame. The central opening must be real.
        const frame = frames.find(mesh => mesh.count > 0);
        const isolated = new THREE.Mesh(geometry, frame.material);
        isolated.updateMatrixWorld(true);
        const bounds = geometry.boundingBox, top = bounds.max.y + 1;
        ray.set(new THREE.Vector3(0, top, 0), new THREE.Vector3(0, -1, 0)); ray.far = top - bounds.min.y + 1;
        const centerHits = ray.intersectObject(isolated, false).length;
        let perimeterHit = false;
        for (let index = 1; index <= 100 && !perimeterHit; index++) {
          ray.set(new THREE.Vector3(bounds.max.x * index / 100, top, 0), new THREE.Vector3(0, -1, 0));
          perimeterHit = ray.intersectObject(isolated, false).length > 0;
        }
        const depths = [];
        for (const mesh of frames) for (let index = 0; index < mesh.count; index++) {
          const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
          const actual = bounds.clone().applyMatrix4(matrix);
          depths.push(actual.max.y - actual.min.y);
        }
        const upper = world.stations.find(item => item.stationId === 'station-2' && item.lineId === (lineId === 'U3' ? 'U1' : 'U2'));
        data.hive = { sideDirections: sideAngles.size, centerHits, perimeterHit,
          minimumDepth: Math.min(...depths), ceiling: dimensions(box(station.ceilingGroup)),
          upperSlabUnderside: box(upper.platform).min.y,
          opaqueFrames: frames.every(mesh => mesh.isInstancedMesh && !mesh.material.transparent),
          sharedNode: station.networkNode === upper.networkNode && station.networkNode === world.network.nodes.get('station-2') };
      }
      return data;
    };
    return { stations: platforms.map(inspect), glError: world.renderer.getContext().getError() };
  }, redesignedPlatforms);
  expect(result.stations.map(station => station.platformId)).toEqual(['u2-stadtzentrum:U2', 'station-2:U3', 'station-2:U4']);
  for (const station of result.stations) {
    expect(station.normals.geometryCount).toBeGreaterThan(0);
    expect(station.normals.invalidVertices).toBe(0);
    expect(station.normals.nonUnitNormals).toBe(0);
    expect(station.overhead.every(distance => distance !== null && distance > 0.05), `${station.platformId} train roof clearance`).toBe(true);
    expect(station.aisle.every(distance => distance !== null && distance > 1), `${station.platformId} walking headroom`).toBe(true);
    if (station.glass) {
      expect(station.floorY).toBe(0);
      expect(station.glass.indexed && station.glass.transparent).toBe(true);
      expect(station.glass.depthWrite).toBe(false);
      expect(station.glass.ribs && station.glass.mullions).toBe(true);
      // The canopy must genuinely span the existing railway/platform hall and
      // curve in height, rather than becoming a textured ceiling rectangle.
      expect(station.glass.bounds.size[0]).toBeGreaterThan(17);
      expect(station.glass.bounds.size[2]).toBeGreaterThanOrEqual(88);
      expect(station.glass.bounds.size[1]).toBeGreaterThan(2);
    } else {
      expect(station.floorY).toBe(-12);
      expect(station.hive.sharedNode && station.hive.opaqueFrames).toBe(true);
      expect(station.hive.sideDirections).toBe(6);
      expect(station.hive.centerHits).toBe(0);
      expect(station.hive.perimeterHit).toBe(true);
      expect(station.hive.minimumDepth).toBeGreaterThan(0.1);
      expect(station.hive.ceiling.min[1]).toBeGreaterThan(station.floorY + 3.32);
      expect(station.hive.ceiling.max[1]).toBeLessThan(station.hive.upperSlabUnderside);
    }
  }
  expect(result.glError).toBe(0);
});

test('all three redesigned halls render their actual architecture with working visibility and lighting, and restore their rendered image after inspection', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  for (const platform of redesignedPlatforms) {
    const result = await page.evaluate(({ lineId, stationId }) => {
      const { world, player } = window.metro;
      if (!player.startAt(lineId, stationId)) throw new Error(`Cannot start on ${stationId}:${lineId}.`);
      player.pitch = stationId === 'u2-stadtzentrum' ? 0.43 : 0.35;
      player.applyLook();
      for (let frame = 0; frame < 9; frame++) world.update(1 / 60);
      const station = player.station, signature = station.signatureGroup;
      if (!signature) throw new Error('The playable station lacks its signature architecture.');
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
      const context = canvas.getContext('2d');
      const capture = () => {
        world.renderer.shadowMap.needsUpdate = true;
        world.renderer.render(world.scene, world.camera);
        context.drawImage(world.renderer.domElement, 0, 0, canvas.width, canvas.height);
        return new Uint8ClampedArray(context.getImageData(0, 0, canvas.width, canvas.height).data);
      };
      const differences = (a, b) => {
        let changed = 0;
        for (let index = 0; index < a.length; index += 4) if ([0, 1, 2].some(channel => Math.abs(a[index + channel] - b[index + channel]) > 2)) changed++;
        return changed;
      };
      const originalVisibility = signature.visible;
      const before = capture();
      let hidden;
      try { signature.visible = false; hidden = capture(); }
      finally { signature.visible = originalVisibility; }
      const restored = capture();
      let colored = 0;
      const colors = new Set();
      for (let index = 0; index < before.length; index += 4) {
        if (before[index + 3] && before[index] + before[index + 1] + before[index + 2] > 30) colored++;
        colors.add(`${before[index] >> 4}:${before[index + 1] >> 4}:${before[index + 2] >> 4}`);
      }
      return {
        stationVisible: station.visible, signatureVisible: signature.visible,
        signaturePixels: differences(before, hidden), restoredPixels: differences(before, restored),
        colored, pixelCount: canvas.width * canvas.height, colorVariation: colors.size,
        activePlatform: world.lighting.currentPlatformId,
        activePointLights: world.lighting.stationLights.filter(light => light.intensity > 0).length,
        glError: world.renderer.getContext().getError(), contextLost: world.renderer.getContext().isContextLost(),
        hudStation: document.querySelector('#location-name').textContent,
        hudLine: document.querySelector('#location-line').textContent,
      };
    }, platform);
    expect(result.stationVisible && result.signatureVisible).toBe(true);
    expect(result.signaturePixels, `${platform.stationId}:${platform.lineId} actual visible signature pixels`).toBeGreaterThan(0);
    expect(result.restoredPixels).toBe(0);
    expect(result.colored / result.pixelCount).toBeGreaterThan(0.9);
    expect(result.colorVariation).toBeGreaterThan(1);
    expect(result.activePlatform).toBe(`${platform.stationId}:${platform.lineId}`);
    expect(result.activePointLights).toBeGreaterThan(0);
    expect(result.hudStation).toBe(platform.stationId === 'u2-stadtzentrum' ? 'Stadtzentrum' : 'Central');
    expect(result.hudLine).toBe(platform.lineId);
    expect(result.contextLost).toBe(false);
    expect(result.glError).toBe(0);
    await page.locator('#scene canvas').screenshot({ path: testInfo.outputPath(`${platform.stationId}-${platform.lineId}-architecture.png`) });
  }
});
