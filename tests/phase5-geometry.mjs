/** Probe the assembled railway meshes, independently of route/controller sampling. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const context = new Proxy({}, { get: (target, key) => key in target ? target[key]
  : key === 'measureText' ? text => ({ width: text.length * 12 }) : () => {} });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { createMaterials } = await import('../src/materials.js');
const { createCompleteMetroNetwork } = await import('../src/network.js');
const { MetroRoute } = await import('../src/route.js');
const { NetworkLineWorld, NEW_TRANSFERS } = await import('../src/network-world.js');
const { NetworkTransfer } = await import('../src/network-transfers.js');
const { CentralInterchange } = await import('../src/interchange.js');
const { VerticalInterchange } = await import('../src/vertical-interchange.js');

const network = createCompleteMetroNetwork(), materials = createMaterials(), scene = new THREE.Group();
const worlds = [...network.lines.keys()].map(id => new NetworkLineWorld(materials, new MetroRoute(network, id)));
scene.add(...worlds); scene.updateWorldMatrix(true, true);
const [u1, u2, u3, u4] = worlds;
u2.add(new CentralInterchange(u2.materials, u1.central, u2.central));
u4.add(new CentralInterchange(u4.materials, u3.central, u4.central, { floorY: -12, firstLine: 'U3', secondLine: 'U4' }));
scene.add(new VerticalInterchange(materials, u1.central, u3.central));
const stations = worlds.flatMap(world => world.stations);
for (const definition of NEW_TRANSFERS) {
  const upper = stations.find(station => station.stationId === definition.id && station.lineId === definition.upperLine);
  const lower = stations.find(station => station.stationId === definition.id && station.lineId === definition.lowerLine);
  scene.add(new NetworkTransfer(materials, upper, lower, definition));
}
scene.updateWorldMatrix(true, true);
const records = [];
scene.traverse(mesh => {
  if (mesh.isMesh) records.push({ mesh, bounds: new THREE.Box3().setFromObject(mesh) });
});
const raycast = (from, to) => {
  const delta = to.clone().sub(from), length = delta.length();
  const bounds = new THREE.Box3().setFromPoints([from, to]).expandByScalar(0.002);
  const candidates = records.filter(record => record.bounds.intersectsBox(bounds)).map(record => record.mesh);
  return new THREE.Raycaster(from, delta.normalize(), 0.0001, length).intersectObjects(candidates, false);
};

const report = { lines: [], newStations: [], invalidVertices: 0, invalidNormals: 0 };
for (const world of worlds.filter(world => ['U1', 'U2', 'U3'].includes(world.lineId))) {
  const route = world.route;
  let railProbes = 0, portalProbes = 0;
  // Include every rail join, not just a regular grid that could miss a gap.
  const distances = new Set(Array.from({ length: Math.ceil(route.length / 5) + 1 }, (_, i) => Math.min(route.length, i * 5)));
  for (const stop of route.stops) for (const offset of [-50.01, -50, -49.99, 49.99, 50, 50.01]) {
    const d = stop.distance + offset;
    if (d >= 0 && d <= route.length) distances.add(d);
  }
  for (const distance of distances) for (const side of [-1, 1]) {
    const position = route.sample(distance).position;
    const start = position.clone().add(new THREE.Vector3(side * 0.7175, 0.2, 0));
    const hits = raycast(start, start.clone().add(new THREE.Vector3(0, -1.6, 0)));
    assert(hits.length && Math.abs(hits[0].point.y - (position.y - 1.024)) < 1e-5,
      `${route.lineId}: missing/obstructed physical rail at ${distance} m, side ${side}.`);
    railProbes++;
  }
  for (let index = 0; index < route.stops.length; index++) {
    const stop = route.stops[index];
    for (const direction of [-1, 1]) {
      if ((index === 0 && direction === 1) || (index === route.stops.length - 1 && direction === -1)) continue;
      for (const x of [-1.4, 0, 1.4]) for (const y of [0.3, 2, 3.3]) {
        const start = new THREE.Vector3(stop.position.x + x, stop.floorY + y, stop.z + direction * 40);
        const end = start.clone(); end.z = stop.z + direction * 54;
        const hits = raycast(start, end);
        assert.equal(hits.length, 0, `${stop.name}: train portal blocked at ${x},${y},${direction} by ${hits[0]?.object.name}.`);
        portalProbes++;
      }
    }
  }
  report.lines.push({ id: route.lineId, stops: route.stops.length, railProbes, portalProbes });
}

const newIds = ['u1-lindenallee', 'u1-universitaetsviertel', 'u1-botanischer-garten', 'u1-ostgaerten',
  'u2-rathausmarkt', 'u2-kupfergasse', 'u2-stahlhof', 'u3-museumsinsel', 'u3-kanalpark', 'u3-seetor'];
const geometries = new Set();
for (const id of newIds) {
  const station = worlds.flatMap(world => world.stations).find(station => station.stationId === id);
  assert(station?.signatureGroup && station.signatureRoof?.isMesh, `${id}: no physical station architecture.`);
  for (const z of [-35, -17, 0, 17, 35]) {
    const start = station.localToWorld(new THREE.Vector3(-4.8, 0.3, z));
    const head = station.localToWorld(new THREE.Vector3(-4.8, 2.98, z));
    assert.equal(raycast(start, head).length, 0, `${id}: obstructed platform aisle.`);
  }
  station.signatureGroup.traverse(mesh => {
    if (!mesh.isMesh || geometries.has(mesh.geometry)) return;
    geometries.add(mesh.geometry);
    const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal');
    assert(positions && normals, `${id}: missing geometry attributes.`);
    for (let index = 0; index < positions.count; index++) {
      const p = [positions.getX(index), positions.getY(index), positions.getZ(index)];
      const n = [normals.getX(index), normals.getY(index), normals.getZ(index)];
      if (!p.every(Number.isFinite)) report.invalidVertices++;
      if (!n.every(Number.isFinite) || Math.abs(Math.hypot(...n) - 1) > 1e-4) report.invalidNormals++;
    }
  });
  const bounds = new THREE.Box3().setFromObject(station.signatureGroup);
  if (station.floorY === -12) assert(bounds.max.y < -1.7, `${id}: ceiling enters the upper railway envelope.`);
  report.newStations.push({ id, signature: station.userData.architecture.signature, floorY: station.floorY, roofTop: bounds.max.y });
}
assert.equal(report.invalidVertices, 0); assert.equal(report.invalidNormals, 0);
assert.equal(new Set(report.newStations.map(station => station.signature)).size, 10);
await writeFile('/tmp/metro-phase5-geometry.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
