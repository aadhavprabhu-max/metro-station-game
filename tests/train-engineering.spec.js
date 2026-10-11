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

test('every carriage has one actual finished walking surface above its structural slab, with intact rounded cab seams', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { world } = window.metro;
    const ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0);
    world.scene.updateMatrixWorld(true);
    const cars = world.trains.flatMap(train => train.cars.map(car => {
      const inverse = new THREE.Matrix4().copy(car.matrixWorld).invert(), samples = [];
      for (const x of [-1.05, -0.31, 0.29, 1.05]) for (const z of [-6.1, -4.75, -2.15, 0.65, 2.15, 4.75, 6.1]) {
        ray.set(car.localToWorld(new THREE.Vector3(x, 0.395, z)), new THREE.Vector3(0, -1, 0).transformDirection(car.matrixWorld));
        ray.far = 0.35;
        const seen = new Set(), layers = [];
        for (const hit of ray.intersectObject(car, true)) {
          const point = hit.point.clone().applyMatrix4(inverse);
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inverse);
          if (point.y < 0.07 || point.y > 0.11 || normal.dot(up) < 0.999) continue;
          const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
          const key = `${hit.object.uuid}:${material.uuid}:${Math.round(point.y * 1e7)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          layers.push({ y: point.y, normal: normal.toArray(), materialId: material.uuid,
            isStructure: material === train.materials.interior, mapped: Boolean(material.map),
            depthTest: material.depthTest, depthWrite: material.depthWrite, transparent: material.transparent,
            polygonOffset: material.polygonOffset, roughness: material.roughness,
            castShadow: hit.object.castShadow, receiveShadow: hit.object.receiveShadow });
        }
        layers.sort((a, b) => b.y - a.y);
        samples.push({ x, z, layers, topMaterialCount: new Set(layers.filter(layer => Math.abs(layer.y - layers[0]?.y) < 1e-5).map(layer => layer.materialId)).size });
      }
      return { line: train.lineId, car: car.carNumber, samples };
    }));
    const cabs = world.trains.flatMap(train => train.cars.flatMap(car => car.cabs.map(cab => {
      const geometries = cab.shellGeometries;
      let invalidVertices = 0, nonUnitNormals = 0, reversedTriangles = 0;
      for (const geometry of [...geometries, cab.windshieldMesh.geometry]) {
        const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
        for (let index = 0; index < positions.count; index++) {
          if (![positions.getX(index), positions.getY(index), positions.getZ(index), normals.getX(index), normals.getY(index), normals.getZ(index)].every(Number.isFinite)) invalidVertices++;
          const length = Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index));
          if (Math.abs(length - 1) > 1e-5) nonUnitNormals++;
        }
        const indices = geometry.index, count = indices?.count ?? positions.count;
        for (let index = 0; index < count; index += 3) {
          const vertexIndices = [0, 1, 2].map(offset => indices ? indices.getX(index + offset) : index + offset);
          const [a, b, c] = vertexIndices.map(vertex => new THREE.Vector3().fromBufferAttribute(positions, vertex));
          const faceNormal = b.sub(a).cross(c.sub(a));
          if (faceNormal.lengthSq() < 1e-14) continue;
          const averageNormal = vertexIndices.reduce((sum, vertex) => sum.add(new THREE.Vector3().fromBufferAttribute(normals, vertex)), new THREE.Vector3());
          if (faceNormal.dot(averageNormal) <= 0) reversedTriangles++;
        }
      }
      const seams = [1.02, 2.74].map(height => {
        const vertices = new Map();
        geometries.forEach((geometry, geometryIndex) => {
          const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
          for (let index = 0; index < positions.count; index++) {
            if (Math.abs(positions.getY(index) - height) > 1e-5) continue;
            const key = `${Math.round(positions.getX(index) * 1e5)},${Math.round(positions.getY(index) * 1e5)},${Math.round(positions.getZ(index) * 1e5)}`;
            if (!vertices.has(key)) vertices.set(key, []);
            vertices.get(key).push({ geometryIndex, normal: new THREE.Vector3().fromBufferAttribute(normals, index) });
          }
        });
        let sharedVertices = 0, minimumDot = 1;
        for (const entries of vertices.values()) {
          const patches = [...new Set(entries.map(entry => entry.geometryIndex))];
          if (patches.length < 2) continue;
          sharedVertices++;
          for (const first of entries) for (const second of entries) if (first.geometryIndex !== second.geometryIndex) minimumDot = Math.min(minimumDot, first.normal.dot(second.normal));
        }
        return { height, sharedVertices, minimumDot };
      });
      return { line: train.lineId, end: cab.end, invalidVertices, nonUnitNormals, reversedTriangles, seams };
    })));
    return { cars, cabs, glError: world.renderer.getContext().getError() };
  });
  expect(result.cars).toHaveLength(12);
  for (const car of result.cars) {
    expect(car.samples).toHaveLength(28);
    for (const sample of car.samples) {
      expect(sample.topMaterialCount, `${car.line}/${car.car} floor at ${sample.x},${sample.z}`).toBe(1);
      const top = sample.layers[0], structure = sample.layers.find(layer => layer.isStructure);
      expect(top.y).toBeCloseTo(0.095, 7);
      expect(top.mapped && top.depthTest && top.depthWrite).toBe(true);
      expect(top.transparent || top.polygonOffset).toBe(false);
      expect(top.roughness).toBeGreaterThan(0.8);
      expect(top.castShadow || top.receiveShadow).toBe(false);
      expect(structure, 'The underlying actual structural slab remains present.').toBeTruthy();
      expect(structure.y).toBeCloseTo(0.084, 7);
      expect(top.y - structure.y).toBeGreaterThan(0.01);
    }
  }
  expect(result.cabs).toHaveLength(8);
  for (const cab of result.cabs) {
    expect(cab.invalidVertices).toBe(0); expect(cab.nonUnitNormals).toBe(0); expect(cab.reversedTriangles).toBe(0);
    for (const seam of cab.seams) {
      expect(seam.sharedVertices).toBeGreaterThan(3);
      expect(seam.minimumDot).toBeGreaterThan(0.995);
    }
  }
  expect(result.glError).toBe(0);
});

test('rendered train floors stay stable at stopped camera angles and hiding the covered structure cannot change their visible pixels', async ({ page }) => {
  test.setTimeout(180000);
  const results = await page.evaluate(() => {
    const { world, player } = window.metro;
    const scratch = document.createElement('canvas'); scratch.width = 160; scratch.height = 100;
    const context = scratch.getContext('2d');
    const readFloor = () => {
      const canvas = world.renderer.domElement;
      context.drawImage(canvas, canvas.width * 0.3, canvas.height * 0.55, canvas.width * 0.4, canvas.height * 0.35, 0, 0, 160, 100);
      return context.getImageData(0, 0, 160, 100).data.slice();
    };
    const finishCoverage = floor => {
      // Derive coverage from the actual finish plane before examining pixels.
      // The structural slab extends 30 mm beyond the finish at door thresholds;
      // its legitimately exposed sill is outside this occlusion diagnostic.
      floor.geometry.computeBoundingBox();
      floor.updateWorldMatrix(true, false);
      const bounds = floor.geometry.boundingBox;
      const Vector = world.camera.position.constructor, Matrix = floor.matrixWorld.constructor;
      const inverse = new Matrix().copy(floor.matrixWorld).invert();
      const origin = world.camera.position.clone().applyMatrix4(inverse);
      const matrix = floor.matrixWorld.elements, edgeMargin = 0.025;
      const marginX = edgeMargin / Math.hypot(matrix[0], matrix[1], matrix[2]);
      const marginZ = edgeMargin / Math.hypot(matrix[8], matrix[9], matrix[10]);
      const mask = new Uint8Array(scratch.width * scratch.height);
      let coveredPixels = 0;
      for (let y = 0; y < scratch.height; y++) for (let x = 0; x < scratch.width; x++) {
        const screenX = 0.3 + (x + 0.5) / scratch.width * 0.4;
        const screenY = 0.55 + (y + 0.5) / scratch.height * 0.35;
        const direction = new Vector(screenX * 2 - 1, 1 - screenY * 2, 0.5)
          .unproject(world.camera).applyMatrix4(inverse).sub(origin);
        if (Math.abs(direction.y) < 1e-12) continue;
        const distance = (bounds.max.y - origin.y) / direction.y;
        if (distance <= 0) continue;
        const point = origin.clone().addScaledVector(direction, distance);
        // A physical 25 mm border avoids the crop's bilinear/MSAA edge samples.
        // Its size is converted through the real mesh's nonuniform scale.
        if (point.x <= bounds.min.x + marginX || point.x >= bounds.max.x - marginX
          || point.z <= bounds.min.z + marginZ || point.z >= bounds.max.z - marginZ) continue;
        mask[y * scratch.width + x] = 1;
        coveredPixels++;
      }
      return { mask, coveredPixels, coverage: coveredPixels / mask.length, edgeMargin };
    };
    const differences = (first, second, mask = null) => {
      let changedPixels = 0, maximumDifference = 0;
      for (let index = 0; index < first.length; index += 4) {
        if (mask && !mask[index / 4]) continue;
        let difference = 0;
        for (let channel = 0; channel < 3; channel++) difference = Math.max(difference, Math.abs(first[index + channel] - second[index + channel]));
        if (difference > 2) changedPixels++;
        maximumDifference = Math.max(maximumDifference, difference);
      }
      return { changedPixels, maximumDifference };
    };
    const renderSettings = () => ({ shadows: world.renderer.shadowMap.enabled, shadowType: world.renderer.shadowMap.type,
      shadowAutoUpdate: world.renderer.shadowMap.autoUpdate, toneMapping: world.renderer.toneMapping,
      exposure: world.renderer.toneMappingExposure, outputColorSpace: world.renderer.outputColorSpace });
    const settings = renderSettings(), results = [];
    for (const service of world.services) {
      player.startAt(service.lineId);
      const car = service.train.cars[1];
      player.camera.position.set(service.platformSide * 2.697, 1.76, car.position.z);
      service.train.localToWorld(player.camera.position);
      if (!player.interact() || player.ridingCar !== car) throw new Error(`Cannot board ${service.lineId}'s unchanged open doorway.`);
      player.ridingOffset.set(0.29, 1.85, car.position.z + 0.65); player.syncRide();
      const structure = [];
      car.traverse(mesh => { if (mesh.isMesh && mesh.material === service.train.materials.interior) structure.push({ mesh, visible: mesh.visible }); });
      if (!structure.length) throw new Error('Actual covered structural floor geometry is missing.');
      const finish = car.getObjectByName('TexturedPassengerFloor');
      if (!finish?.isMesh) throw new Error('Actual finished passenger floor geometry is missing.');
      for (const yaw of [-0.22, 0, 0.22]) {
        player.yaw = yaw; player.pitch = -1.02; player.applyLook();
        world.update(0); world.renderer.render(world.scene, world.camera);
        const visible = readFloor();
        const coverage = finishCoverage(finish);
        world.renderer.render(world.scene, world.camera);
        const stopped = differences(visible, readFloor());
        let withoutStructure;
        try {
          // Isolated visibility diagnostic only. Keep the actual finishes,
          // lighting, renderer, depth settings and simulation untouched.
          structure.forEach(record => { record.mesh.visible = false; });
          world.renderer.render(world.scene, world.camera);
          withoutStructure = differences(visible, readFloor(), coverage.mask);
        } finally {
          structure.forEach(record => { record.mesh.visible = record.visible; });
          world.renderer.render(world.scene, world.camera);
        }
        const colors = new Set();
        for (let index = 0; index < visible.length; index += 4) colors.add(`${visible[index] >> 3},${visible[index + 1] >> 3},${visible[index + 2] >> 3}`);
        results.push({ line: service.lineId, yaw, stopped, withoutStructure, colors: colors.size,
          finishCoverage: coverage.coverage, coveredPixels: coverage.coveredPixels, edgeMargin: coverage.edgeMargin,
          restored: structure.every(record => record.mesh.visible === record.visible),
          settingsPreserved: JSON.stringify(renderSettings()) === JSON.stringify(settings),
          riderError: service.train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset),
          glError: world.renderer.getContext().getError() });
      }
      if (!player.interact()) throw new Error(`Cannot exit ${service.lineId}'s unchanged open doorway.`);
    }
    return results;
  });
  expect(results).toHaveLength(12);
  for (const result of results) {
    expect(result.colors).toBeGreaterThan(8);
    expect(result.stopped.changedPixels).toBe(0);
    expect(result.finishCoverage).toBeGreaterThan(0.95);
    expect(result.withoutStructure.changedPixels, `${result.line} at yaw ${result.yaw}: the covered slab leaked into visible floor pixels.`).toBe(0);
    expect(result.restored && result.settingsPreserved).toBe(true);
    expect(result.riderError).toBeLessThan(1e-7);
    expect(result.glError).toBe(0);
  }
});
