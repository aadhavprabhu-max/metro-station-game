import assert from 'node:assert/strict';
import * as THREE from 'three';
import { writeFile } from 'node:fs/promises';
const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : key === 'measureText' ? text => ({ width: text.length * 12 }) : () => {} });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const ROOT = new URL('../src/', import.meta.url).href;
const { createMaterials } = await import(ROOT + 'materials.js');
const { createCompleteMetroNetwork } = await import(ROOT + 'network.js');
const { MetroRoute } = await import(ROOT + 'route.js');
const { NetworkLineWorld, NEW_TRANSFERS } = await import(ROOT + 'network-world.js');
const { NetworkTransfer } = await import(ROOT + 'network-transfers.js');
const material = createMaterials(), network = createCompleteMetroNetwork();
const scene = new THREE.Group();
const worlds = Object.fromEntries([...network.lines.keys()].map(line => [line, new NetworkLineWorld(material, new MetroRoute(network, line))]));
scene.add(...Object.values(worlds));
scene.updateWorldMatrix(true, true);
const stations = Object.values(worlds).flatMap(world => world.stations);
const transfers = NEW_TRANSFERS.map(def => {
  const upper = stations.find(station => station.stationId === def.id && station.lineId === def.upperLine);
  const lower = stations.find(station => station.stationId === def.id && station.lineId === def.lowerLine);
  const transfer = new NetworkTransfer(material, upper, lower, def);
  scene.add(transfer); return { def, upper, lower, transfer };
});
scene.updateWorldMatrix(true, true);
const meshRecords = [];
scene.traverse(node => {
  if (!node.isMesh) return;
  if (node.material?.isMeshBasicMaterial
    || (node.material?.emissiveIntensity > 0 && node.material?.emissive?.getHex() > 0)) return;
  let owner = node, identity = [];
  while (owner && owner !== scene) {
    if (owner.stationId) identity.push(`${owner.stationId}:${owner.lineId ?? 'transfer'}`);
    owner = owner.parent;
  }
  meshRecords.push({ mesh: node, bounds: new THREE.Box3().setFromObject(node), identity });
});
const hitsForRay = (from, to, farMargin = 0.002) => {
  const segment = to.clone().sub(from), length = segment.length();
  if (length < 0.006) return [];
  const box = new THREE.Box3().setFromPoints([from, to]).expandByScalar(0.003);
  const candidates = meshRecords.filter(record => record.bounds.intersectsBox(box));
  const records = new Map(candidates.map(record => [record.mesh, record]));
  const ray = new THREE.Raycaster(from, segment.normalize(), 0.002, length - farMargin);
  return ray.intersectObjects(candidates.map(record => record.mesh), false).map(hit => ({
    distance: hit.distance, point: hit.point.toArray(), object: hit.object.name, owners: records.get(hit.object).identity,
    material: hit.object.material.name || hit.object.material.color?.getHexString(),
  }));
};
const result = [];
for (const { def, upper, lower, transfer } of transfers) {
  const inside = (station, end) => {
    const p = station.localToWorld(new THREE.Vector3(-5.8, 0, end - Math.sign(end) * 2.2));
    return { x: p.x, y: p.y, z: p.z };
  };
  const path = [inside(upper, def.upperEnd), ...transfer.walkingPath, inside(lower, def.lowerEnd)];
  const eyePathHits = [], ceilingHits = [], supportFailures = [];
  let supports = 0, headroomProbes = 0;
  for (let segment = 0; segment < path.length - 1; segment++) {
    const a = new THREE.Vector3(path[segment].x, path[segment].y, path[segment].z);
    const b = new THREE.Vector3(path[segment + 1].x, path[segment + 1].y, path[segment + 1].z);
    const eyeHits = hitsForRay(a.clone().add(new THREE.Vector3(0, 1.76, 0)), b.clone().add(new THREE.Vector3(0, 1.76, 0)));
    if (eyeHits.length) eyePathHits.push({ segment, from: a.toArray(), to: b.toArray(), hits: eyeHits.slice(0, 4) });
    const count = Math.max(1, Math.ceil(a.distanceTo(b) / 0.3));
    for (let step = 0; step <= count; step++) {
      const p = a.clone().lerp(b, step / count);
      const support = transfer.findSurface(p.x, p.z, p.y, 0.45, 0.24);
      // The first and final 2.2m belong to the existing platform approach.
      if (segment !== 0 && segment !== path.length - 2 && !support) supportFailures.push({ segment, point: p.toArray() });
      if (support) supports++;
      const hits = hitsForRay(p.clone().add(new THREE.Vector3(0, 1.76, 0)), p.clone().add(new THREE.Vector3(0, 2.98, 0)));
      if (hits.length) ceilingHits.push({ segment, point: p.toArray(), hits: hits.slice(0, 3) });
      headroomProbes++;
    }
  }
  result.push({ station: def.id, upperPose: upper.getWorldPosition(new THREE.Vector3()).toArray(), upperYaw: Math.atan2(upper.matrixWorld.elements[8], upper.matrixWorld.elements[10]),
    lowerPose: lower.getWorldPosition(new THREE.Vector3()).toArray(), lowerYaw: Math.atan2(lower.matrixWorld.elements[8], lower.matrixWorld.elements[10]),
    towers: transfer.towers.length, flights: transfer.towers.reduce((n, tower) => n + tower.flights, 0), supports, headroomProbes,
    eyePathHits, ceilingHits, supportFailures });
}
const report = { stationNodes: network.nodes.size, platforms: stations.length, lines: Object.keys(worlds), consideredMeshes: meshRecords.length, result };
await writeFile(process.env.METRO_TRANSFER_REPORT || '/tmp/metro-transfer-geometry.json', JSON.stringify(report, null, 2));
assert.equal(report.stationNodes, 37); assert.equal(report.platforms, 44);
assert(report.consideredMeshes > 0, 'Transfer geometry check did not inspect any physical meshes.');
for (const item of result) { assert.equal(item.eyePathHits.length, 0, `${item.station}: obstructed walking path`); assert.equal(item.ceilingHits.length, 0, `${item.station}: insufficient headroom`); assert.equal(item.supportFailures.length, 0, `${item.station}: unsupported walking path`); }
console.log(JSON.stringify({ ...report, result: result.map(r => ({ ...r, eyePathHits: r.eyePathHits.slice(0, 6), ceilingHits: r.ceilingHits.slice(0, 6), supportFailures: r.supportFailures.slice(0, 6),
  eyePathHitSegments: r.eyePathHits.length, ceilingHitProbes: r.ceilingHits.length, unsupportedProbes: r.supportFailures.length })) }, null, 2));
