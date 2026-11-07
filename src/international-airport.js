import * as THREE from 'three';
import { box, instances, label } from './geometry.js';
import { beam } from './u10-stations.js';
import { batchStaticGeometry } from './optimize.js';

/** Terminal, concourses, forecourt and airside landmark at the actual U10 terminus. */
export function buildInternationalAirport(station, m) {
  const group = new THREE.Group(); group.name = 'AurealisInternationalAirportComplex'; station.add(group);
  box(group, m.stone, [145, 1.2, 360], [-95, -0.65, 0]);
  box(group, m.paving, [144, 0.05, 359], [-95, -0.025, 0]);
  for (const x of [-167, -23]) for (const z of [-180, 180]) beam(group, m.whiteSteel, [x, 0, z], [x, 15, z], 0.65);
  for (let z = -180; z <= 180; z += 18) {
    for (const x of [-165, -112, -60]) {
      beam(group, m.whiteSteel, [x, 0, z], [x, 14, z], 0.4);
      beam(group, m.whiteSteel, [x, 12.5, z], [x + 50, 16, z], 0.3);
      box(group, m.canopy, [54, 0.22, 17.5], [x + 25, 16.2, z + 8.5], { rotation: [0, 0, 0.035] });
      box(group, m.glazing, [50, 0.05, 0.6], [x + 25, 16.4, z + 17.5]);
    }
  }
  for (const x of [-167, -23]) for (const [a, b] of [[-180, -14], [14, 180]]) box(group, m.glazing, [0.08, 14, b - a], [x, 7, (a + b) / 2]);
  for (const z of [-180, 180]) box(group, m.glazing, [145, 14, 0.08], [-95, 7, z]);
  // Actual supported passenger concourse connects to the station's rear terrace.
  station.walkableAreas.push({ minX: -150, maxX: -20, minZ: -40, maxZ: 40 });
  for (const z of [-29, 29]) for (let x = -145; x <= -65; x += 16) {
    box(group, m.blue, [5.2, 1.05, 1.2], [x, 0.525, z]); station.addCollider(x, z, 5.3, 1.3);
    label(group, 'CHECK-IN', 3.9, 0.34, [x, 1.8, z - Math.sign(z) * 0.8], { background: '#123b75', rotation: [0, z > 0 ? Math.PI : 0, 0], fontSize: 105 });
  }
  for (const x of [-65, -100, -135]) {
    label(group, '✈ AUREALIS INTERNATIONAL  /  DEPARTURES', 15, 1.1, [x, 8, 0], { rotation: [0, Math.PI / 2, 0], background: '#123b75', fontSize: 82 });
    for (const z of [-12, 12]) { box(group, m.timber, [0.8, 0.13, 6], [x, 0.48, z]); station.addCollider(x, z, 1.0, 6.2); }
  }
  for (const z of [-180, 180]) {
    box(group, m.stone, [160, 1, 32], [-240, -0.7, z]);
    box(group, m.glazing, [160, 6, 0.1], [-240, 3, z - 16]);
    box(group, m.glazing, [160, 6, 0.1], [-240, 3, z + 16]);
    box(group, m.canopy, [163, 0.25, 34], [-240, 6.3, z]);
    for (let x = -300; x <= -180; x += 30) {
      beam(group, m.whiteSteel, [x, 0, z - 15], [x, 6.2, z - 15], 0.18);
      box(group, m.whiteSteel, [12, 3.2, 4], [x, -1, z + Math.sign(z) * 21]);
      label(group, `GATE ${z < 0 ? 'A' : 'B'}${Math.round((x + 330) / 30)}`, 3.2, 0.45, [x, 3.7, z - 16.1], { rotation: [0, Math.PI, 0], background: '#123b75', fontSize: 110 });
    }
  }
  const apron = new THREE.MeshStandardMaterial({ color: '#a4a9a6', roughness: 1 });
  const asphalt = new THREE.MeshStandardMaterial({ color: '#505a5b', roughness: 0.96 });
  box(group, apron, [1000, 0.15, 1400], [-620, -16.08, 0], { shadow: false });
  box(group, asphalt, [55, 0.06, 2400], [-1000, -15.96, 0], { shadow: false });
  const lines = [];
  for (let z = -1150; z <= 1150; z += 45) lines.push({ size: [1, 0.02, 24], position: [-1000, -15.91, z] });
  instances(group, m.whiteSteel, lines, undefined, false).name = 'AirportRunwayMarkings';
  // Landside roads, drop-off loops, planted forecourt and a control tower.
  box(group, asphalt, [28, 0.1, 540], [68, -15.9, 0], { shadow: false });
  box(group, m.stone, [35, 0.4, 420], [40, -15.7, 0]);
  for (const z of [-200, -140, 140, 200]) box(group, m.blue, [6, 2.8, 2.2], [68, -14.5, z]);
  box(group, m.whiteSteel, [12, 45, 12], [-240, 6.5, 470]);
  box(group, m.blue, [24, 7, 24], [-240, 31.5, 470]); box(group, m.glazing, [25, 4, 25], [-240, 35, 470]);
  box(group, m.canopy, [27, 0.5, 27], [-240, 37.5, 470]);
  group.userData = { distinctAirport: true, terminalLength: 360, gates: 10, publicConcourse: true };
  batchStaticGeometry(group); return group;
}
