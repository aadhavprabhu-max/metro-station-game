import * as THREE from 'three';
import { box, instances, label } from './geometry.js';
import { beam } from './u10-stations.js';
import { batchStaticGeometry } from './optimize.js';

/** Terminal, concourses, forecourt and airside landmark at the actual U10 terminus. */
export function buildInternationalAirport(station, m) {
  const group = new THREE.Group(); group.name = 'AurealisInternationalAirportComplex'; station.add(group);
  // An occupied arrivals podium supports the elevated departures hall.
  box(group, m.stone, [145, 15.2, 360], [-95, -8.1, 0]);
  box(group, m.stone, [145, 1.2, 360], [-95, -0.65, 0]);
  box(group, m.paving, [144, 0.05, 359], [-95, -0.025, 0]);
  box(group, m.stone, [3, 0.3, 28], [-22.5, -0.2, 0]);
  box(group, m.paving, [3, 0.05, 28], [-22.5, -0.025, 0]);
  for (const x of [-167, -23]) for (const z of [-180, 180]) beam(group, m.whiteSteel, [x, 0, z], [x, 15, z], 0.65);
  const roofProfile = new THREE.Shape();
  const roofY = x => 14 + 8 * Math.sin((x + 167) / 145 * Math.PI);
  for (let i = 0; i <= 48; i++) { const x = -167 + 145 * i / 48; i ? roofProfile.lineTo(x, roofY(x)) : roofProfile.moveTo(x, roofY(x)); }
  for (let i = 48; i >= 0; i--) { const x = -167 + 145 * i / 48; roofProfile.lineTo(x, roofY(x) + 0.3); } roofProfile.closePath();
  const terminalRoof = new THREE.ExtrudeGeometry(roofProfile, { depth: 17.5, bevelEnabled: false });
  for (let z = -180; z < 180; z += 18) {
    const roof = new THREE.Mesh(terminalRoof, m.canopy); roof.position.z = z; roof.name = 'TerminalLongSpanWaveRoof'; group.add(roof);
    for (const x of [-167, -23]) {
      box(group, m.glazing, [0.08, 13.8, 16.5], [x + (x < -100 ? -0.05 : 0.05), -8.2, z + 8.2]);
      box(group, m.whiteSteel, [0.18, 29.5, 0.18], [x, -1.1, z]);
    }
    for (const x of [-165, -112, -60]) {
      beam(group, m.whiteSteel, [x, 0, z], [x, roofY(x) - 0.5, z], 0.4);
      const end = Math.min(-23, x + 50);
      beam(group, m.whiteSteel, [x, roofY(x) - 0.6, z], [end, roofY(end) - 0.6, z], 0.3);
      box(group, m.glazing, [end - x, 0.05, 0.45], [(x + end) / 2, (roofY(x) + roofY(end)) / 2, z + 17.7]);
    }
  }
  label(group, 'AUREALIS INTERNATIONAL AIRPORT', 130, 5.5, [-22.65, 8, 0], { rotation: [0, Math.PI / 2, 0], background: '#123b75', fontSize: 96 });
  for (const x of [-167, -23]) for (const [a, b] of [[-180, -14], [14, 180]]) box(group, m.glazing, [0.08, 14, b - a], [x, 7, (a + b) / 2]);
  for (const z of [-180, 180]) box(group, m.glazing, [145, 14, 0.08], [-95, 7, z]);
  // Actual supported passenger concourse connects to the station's rear terrace.
  station.walkableAreas.push({ minX: -150, maxX: -20, minZ: -40, maxZ: 40 });
  for (const z of [-40, 40]) {
    box(group, m.whiteSteel, [128, 0.07, 0.08], [-86, 1.2, z]);
    box(group, m.glazing, [128, 1.15, 0.04], [-86, 0.6, z]); station.addCollider(-86, z, 128, 0.08);
  }
  box(group, m.blue, [0.15, 1.2, 80], [-150, 0.6, 0]); station.addCollider(-150, 0, 0.15, 80);
  label(group, 'SECURITY  /  AIRSIDE', 18, 1.1, [-149.9, 3.5, 0], { rotation: [0, Math.PI / 2, 0], background: '#123b75', fontSize: 96 });
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
  // Static aircraft make the airside scale legible; there is no additional flight simulation.
  const aircraftPaint = new THREE.MeshStandardMaterial({ color: '#e8ecec', roughness: 0.36, metalness: 0.2 });
  const aircraftGlass = new THREE.MeshStandardMaterial({ color: '#27465c', roughness: 0.25, metalness: 0.4 });
  for (const [x, z, direction] of [[-290, -245, 1], [-220, -245, 1], [-290, 245, -1], [-220, 245, -1]]) {
    const aircraft = new THREE.Group(); aircraft.name = 'StaticAirportAircraft'; aircraft.position.set(x, -13.8, z); if (direction < 0) aircraft.rotation.y = Math.PI; group.add(aircraft);
    const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 25, 6, 14), aircraftPaint); fuselage.rotation.x = Math.PI / 2; aircraft.add(fuselage);
    const wingShape = new THREE.Shape(); wingShape.moveTo(-1, -4); wingShape.lineTo(-17, 5); wingShape.lineTo(-17, 7); wingShape.lineTo(-1, 4); wingShape.lineTo(1, 4); wingShape.lineTo(17, 7); wingShape.lineTo(17, 5); wingShape.lineTo(1, -4); wingShape.closePath();
    const wings = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.16, bevelEnabled: false }), aircraftPaint); wings.rotation.x = Math.PI / 2; wings.position.y = -0.2; aircraft.add(wings);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(3.6, 5.5, 3), m.blue); fin.scale.z = 0.13; fin.position.set(0, 3.2, 10.5); fin.rotation.y = Math.PI / 2; aircraft.add(fin);
    box(aircraft, aircraftGlass, [1.5, 0.45, 0.25], [0, 0.6, -13.1]);
    for (const side of [-1, 1]) {
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 3.2, 14), aircraftPaint); engine.rotation.x = Math.PI / 2; engine.position.set(side * 5.4, -0.7, 0.7); aircraft.add(engine);
      for (let zz = -9; zz <= 8; zz += 1.5) box(aircraft, aircraftGlass, [0.06, 0.32, 0.4], [side * 1.24, 0.38, zz]);
      box(aircraft, m.dark, [0.15, 1.5, 0.15], [side * 1.1, -1.3, 3]);
    }
  }
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
