import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
const context = new Proxy({}, { get: (t, k) => k in t ? t[k] : k === 'measureText' ? text => ({ width: text.length * 12 }) : () => {} });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { createMaterials } = await import('../src/materials.js');
const { createPhase6Network, createScenicU5Route } = await import('../src/phase6-network.js');
const { MetroRoute } = await import('../src/route.js');
const { NetworkLineWorld, PHASE6_TRANSFERS } = await import('../src/network-world.js');
const { NetworkTransfer } = await import('../src/network-transfers.js');
const { Phase6World } = await import('../src/phase6-world.js');
const { Train } = await import('../src/train.js');
const { TrainService } = await import('../src/service.js');

const network = createPhase6Network(), base = createMaterials(), scene = new THREE.Group();
const b = network.phase6.branch;
const worlds = Object.fromEntries([...network.lines.keys()].map(id => [id, new NetworkLineWorld(base, new MetroRoute(network, id), { railwayOptions: id === 'U5' ? { openIntervals: [[b.splitDistance - 35, b.mergeDistance + 35]] } : {} })]));
scene.add(...Object.values(worlds));
const scenicWorld = new Phase6World(base, network); scene.add(scenicWorld);
const stations = [...Object.values(worlds).flatMap(w => w.stations), ...scenicWorld.stations];
const transfers = PHASE6_TRANSFERS.map(def => {
  const upper = stations.find(s => s.stationId === def.id && s.lineId === def.upperLine), lower = stations.find(s => s.stationId === def.id && s.lineId === def.lowerLine);
  const transfer = new NetworkTransfer(base, upper, lower, def); scene.add(transfer); return { def, upper, lower, transfer };
});
scene.updateMatrixWorld(true);
const records = [];
scene.traverse(mesh => {
  if (!mesh.isMesh || mesh.material?.transparent || mesh.material?.isMeshBasicMaterial || (mesh.material?.emissiveIntensity > 0 && mesh.material?.emissive?.getHex() > 0)) return;
  records.push({ mesh, box: new THREE.Box3().setFromObject(mesh) });
});
const hits = (from, to, only = null) => {
  const delta = to.clone().sub(from), length = delta.length(), bounds = new THREE.Box3().setFromPoints([from, to]).expandByScalar(0.002);
  const meshes = records.filter(r => r.box.intersectsBox(bounds) && (!only || only(r.mesh))).map(r => r.mesh);
  return new THREE.Raycaster(from, delta.normalize(), 0.002, length - 0.002).intersectObjects(meshes, false);
};
const stationResults = [];
for (const station of stations.filter(s => s.userData.phase6Architecture)) {
  const point = (x, y, z) => station.localToWorld(new THREE.Vector3(x, y, z));
  let roofHits = 0, floorHits = 0;
  for (const z of [-30, -10, 10, 30]) for (const x of [-6, -4, -2]) {
    const floor = hits(point(x, 0.3, z), point(x, -0.1, z)); assert(floor.length, `${station.displayName}: missing physical floor`); floorHits++;
    const roof = hits(point(x, 3.4, z), point(x, 25, z)); assert(roof.length, `${station.displayName}: open roof at ${x},${z}`); roofHits++;
    assert.equal(hits(point(x, 1.76, z), point(x, 2.9, z)).length, 0, `${station.displayName}: insufficient walking headroom`);
  }
  stationResults.push({ station: station.displayName, line: station.lineId, floorHits, roofHits, architecture: station.userData.phase6Architecture });
}
const transferResults = [];
for (const { def, transfer, upper, lower } of transfers) {
  const inside = (s, end) => s.localToWorld(new THREE.Vector3(-5.8, 0, end - Math.sign(end) * 2.2));
  const path = [inside(upper, def.upperEnd), ...transfer.walkingPath.map(p => new THREE.Vector3(p.x, p.y, p.z)), inside(lower, def.lowerEnd)];
  let supports = 0, probes = 0; const obstructions = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], eye = new THREE.Vector3(0, 1.76, 0);
    const obstructed = hits(a.clone().add(eye), b.clone().add(eye));
    if (obstructed.length) obstructions.push({ segment: i, at: obstructed[0].point.toArray(), object: obstructed[0].object.name });
    const count = Math.max(1, Math.ceil(a.distanceTo(b) / 0.35));
    for (let j = 0; j <= count; j++) {
      const p = a.clone().lerp(b, j / count); probes++;
      if (transfer.findSurface(p.x, p.z, p.y, 0.45, 0.24)) supports++;
      else if (i !== 0 && i !== path.length - 2) throw new Error(`${def.id}: unsupported transfer at ${p.toArray()}`);
      const ceiling = hits(p.clone().add(eye), p.clone().add(new THREE.Vector3(0, 2.95, 0)));
      if (ceiling.length) obstructions.push({ headroom: true, point: p.toArray(), object: ceiling[0].object.name });
    }
  }
  transferResults.push({ station: def.id, supports, probes, obstructions });
}
// Independently raycast real rails, not just the navigation path. Samples cover
// both grades, both bridge tracks, the loop, and every station approach.
let railProbes = 0; const missingRail = [], bodyObstructions = [];
const railRoot = scenicWorld.children.find(c => c.name === 'U5ScenicContinuousRailway');
const railMeshes = new Set(); railRoot.traverse(m => { if (m.isMesh) railMeshes.add(m); }); scenicWorld.stations.forEach(s => s.traverse(m => { if (m.isMesh) railMeshes.add(m); }));
for (let d = 2; d < b.length - 2; d += 12) {
  const p = b.sample(d), rotation = new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ');
  for (const x of [-0.7175, 0.7175]) {
    const rail = p.position.clone().add(new THREE.Vector3(x, -1.04, 0).applyEuler(rotation));
    const hit = hits(rail.clone().add(new THREE.Vector3(0, 0.25, 0)), rail.clone().add(new THREE.Vector3(0, -0.1, 0)), m => railMeshes.has(m));
    railProbes++; if (!hit.length || Math.abs(hit[0].point.y - rail.y) > 0.04) missingRail.push({ d, x });
  }
  const halfWidth = b.stations.some(s => Math.abs(d - s.distance) < 52) ? 1.5 : 1.7;
  for (const x of [-halfWidth, halfWidth]) {
    const from = p.position.clone().add(new THREE.Vector3(x, -0.5, 0).applyEuler(rotation)), to = p.position.clone().add(new THREE.Vector3(x, 3.25, 0).applyEuler(rotation));
    const hit = hits(from, to); if (hit.length) bodyObstructions.push({ d, x, object: hit[0].object.name, point: hit[0].point.toArray() });
  }
}
// Sightlines go from inside the real middle carriage, through its closed glass,
// above the actual stone parapets, to the river surface on both sides.
const train = new Train(base, { lineId: 'U5', platformSide: -1 }), route = createScenicU5Route(network), service = new TrainService(train, route);
scene.add(train); train.closeDoors(); train.update(2);
const waterSightlines = [];
for (const z of [-430, -436]) {
  let best = 0, error = Infinity;
  for (let d = 0; d < b.length; d += 0.5) { const p = b.sample(d).position, e = Math.hypot(p.x - 1600, p.z - z); if (e < error) { error = e; best = d; } }
  service.distance = b.splitDistance + best; service.placeTrain(); scene.updateMatrixWorld(true);
  const eye = train.cars[1].localToWorld(new THREE.Vector3(0.4, 1.85, 2.5));
  for (const side of [-1, 1]) {
    const target = new THREE.Vector3(eye.x, b.bridge.waterY, eye.z + side * 120), delta = target.clone().sub(eye);
    const ray = new THREE.Raycaster(eye, delta.clone().normalize(), 0.01, delta.length() + 1);
    const intersections = ray.intersectObject(scene, true).filter(hit => {
      const material = hit.object.material;
      return hit.object === scenicWorld.water || !material.transparent;
    });
    waterSightlines.push({ trackZ: z, side, firstHit: intersections[0]?.object.name, waterVisible: intersections[0]?.object === scenicWorld.water });
  }
}
const report = { stations: stationResults, transfers: transferResults, railProbes, missingRail, bodyObstructions, waterSightlines };
await writeFile('/tmp/phase6-geometry.json', JSON.stringify(report, null, 2));
assert.equal(missingRail.length, 0, 'Missing rails; see /tmp/phase6-geometry.json');
assert.equal(bodyObstructions.length, 0, 'Rail loading-gauge obstruction; see /tmp/phase6-geometry.json');
for (const t of transferResults) assert.equal(t.obstructions.length, 0, `${t.station}: obstructed transfer; see /tmp/phase6-geometry.json`);
assert(waterSightlines.every(s => s.waterVisible), 'First-person river sightline blocked; see /tmp/phase6-geometry.json');
console.log(JSON.stringify({ ...report, stations: stationResults.map(s => ({ station: s.station, line: s.line, floorHits: s.floorHits, roofHits: s.roofHits })) }, null, 2));
