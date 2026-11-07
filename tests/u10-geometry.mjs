import assert from 'node:assert/strict';
import * as THREE from 'three';
import { writeFile } from 'node:fs/promises';
import { createCompleteMetroNetwork } from '../src/network.js';
import { addU10ToNetwork, U10_TRANSFERS } from '../src/u10-network.js';
import { MetroRoute } from '../src/route.js';
import { ExpressLineWorld } from '../src/u10-world.js';
import { ExpressTrain } from '../src/u10-train.js';
import { NetworkLineWorld } from '../src/network-world.js';
import { NetworkTransfer } from '../src/network-transfers.js';
import { createMaterials } from '../src/materials.js';

const context = new Proxy({}, { get: (_, key) => key === 'measureText' ? s => ({ width: s.length * 12 }) : () => {} });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const network = addU10ToNetwork(createCompleteMetroNetwork()), materials = createMaterials();
const route = new MetroRoute(network, 'U10'), express = new ExpressLineWorld(materials, route), train = new ExpressTrain(materials);
const scene = new THREE.Group(); scene.add(express);
const transfers = U10_TRANSFERS.map(definition => {
  const upperWorld = new NetworkLineWorld(materials, new MetroRoute(network, definition.upperLine)); scene.add(upperWorld);
  const upper = upperWorld.stations.find(s => s.stationId === definition.id), lower = express.stations.find(s => s.stationId === definition.id);
  const transfer = new NetworkTransfer(materials, upper, lower, definition); scene.add(transfer); return transfer;
});
scene.updateMatrixWorld(true);
const records = [];
scene.traverse(mesh => {
  if (!mesh.isMesh || mesh.material?.isMeshBasicMaterial || mesh.material?.transparent || (mesh.material?.emissiveIntensity > 0 && mesh.material?.emissive?.getHex() > 0)) return;
  records.push({ mesh, bounds: new THREE.Box3().setFromObject(mesh) });
});
function hits(a, b) {
  const delta = b.clone().sub(a), length = delta.length(); if (length < 0.01) return [];
  const box = new THREE.Box3().setFromPoints([a, b]).expandByScalar(0.001);
  return new THREE.Raycaster(a, delta.normalize(), 0.003, length - 0.003).intersectObjects(records.filter(r => r.bounds.intersectsBox(box)).map(r => r.mesh), false);
}
const report = { transfers: [], entrances: express.entrances.length, railProbes: 0, trainPoseProbes: 0, maxCarError: 0, maxBogieError: 0, obstacles: [] };
for (const transfer of [...transfers, ...express.entrances]) {
  let probes = 0; const failures = [];
  for (let i = 0; i < transfer.walkingPath.length - 1; i++) {
    const a = new THREE.Vector3(...Object.values(transfer.walkingPath[i])), b = new THREE.Vector3(...Object.values(transfer.walkingPath[i + 1]));
    const headA = a.clone().add(new THREE.Vector3(0, 1.76, 0)), headB = b.clone().add(new THREE.Vector3(0, 1.76, 0));
    const collisions = hits(headA, headB);
    if (collisions.length) failures.push({ segment: i, object: collisions[0].object.name, point: collisions[0].point.toArray() });
    for (let t = 0; t <= 1; t += 0.1) {
      const p = a.clone().lerp(b, t); probes++;
      const support = hits(p.clone().add(new THREE.Vector3(0, 0.35, 0)), p.clone().add(new THREE.Vector3(0, -0.45, 0)));
      if (!support.length) failures.push({ segment: i, unsupported: p.toArray() });
      const surface = transfer.findSurface(p.x, p.z, p.y, 0.46, 0);
      if (!surface && i !== 0 && i !== transfer.walkingPath.length - 2) failures.push({ segment: i, missingNavigation: p.toArray() });
    }
  }
  report.transfers.push({ name: transfer.name, drop: transfer.upperY - transfer.lowerY, flights: transfer.towers.reduce((n, t) => n + t.flights, 0), probes, failures });
}
for (let d = -50; d <= route.length + 50; d += 11) {
  const pose = route.sampleExtended(d); train.position.copy(pose.position); train.rotation.y = pose.yaw; train.placeCarsOnRoute(route, d); train.updateWorldMatrix(true, true);
  for (const car of train.cars) {
    const cp = route.sampleExtended(d - car.userData.nominalRouteOffset);
    report.maxCarError = Math.max(report.maxCarError, car.getWorldPosition(new THREE.Vector3()).distanceTo(cp.position));
    for (const bogie of car.bogies) {
      const bp = route.sampleExtended(d - car.userData.nominalRouteOffset - bogie.userData.localZ);
      report.maxBogieError = Math.max(report.maxBogieError, bogie.getWorldPosition(new THREE.Vector3()).distanceTo(bp.position));
    }
    report.trainPoseProbes++;
  }
  for (const side of [-1, 1]) {
    const a = new THREE.Vector3(side * 0.7175, 0.15, 0).applyQuaternion(pose.quaternion).add(pose.position);
    const b = new THREE.Vector3(side * 0.7175, -1.15, 0).applyQuaternion(pose.quaternion).add(pose.position);
    const result = hits(a, b); report.railProbes++;
    if (!result.length || !/Rail|StaticBatch|Track/.test(result[0].object.name)) report.obstacles.push({ d, side, hit: result[0]?.object.name });
  }
}
const botanical = express.stations[6]; assert(botanical.vegetation.userData.treeCount >= 40); assert(botanical.vegetation.userData.species.length >= 8);
assert(express.stations.filter(s => s.outdoor).every(s => s.userData.architecture.actualOpenSides));
assert(train.cars[0].cabs[0].shellMetadata.aerodynamic); assert.equal(train.cars[0].cabs[0].shellMetadata.noseLength, 4.45);
await writeFile('/tmp/metro-u10-geometry.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, obstacles: report.obstacles.slice(0, 5), transfers: report.transfers.map(t => ({ ...t, failureCount: t.failures.length, failures: t.failures.slice(0, 5) })) }, null, 2));
assert(report.transfers.every(t => !t.failures.length), 'Physical transfer route obstructed or unsupported.');
assert.equal(report.obstacles.length, 0); assert(report.maxCarError < 1e-8); assert(report.maxBogieError < 1e-8);
