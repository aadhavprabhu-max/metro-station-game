import * as THREE from 'three';
import { Station } from './station.js';
import { box, cylinder, instances, label } from './geometry.js';
import { BotanicalVegetation } from './botanical-vegetation.js';

const standard = (color, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
export function expressMaterials(base) {
  return { ...base, wall: standard('#dedbd1'), stone: standard('#d6d3c7'), paving: standard('#b6b6aa'),
    blue: standard('#123b75', 0.4, 0.25), bronze: standard('#a18b64', 0.4, 0.6), whiteSteel: standard('#d9e2e2', 0.38, 0.6),
    timber: standard('#b19470'), soil: standard('#504a36', 1), water: standard('#659b9d', 0.2, 0.35),
    glazing: new THREE.MeshStandardMaterial({ color: '#bcd7dd', transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.2, side: THREE.DoubleSide }),
    canopy: standard('#c8d9d8', 0.38, 0.1), moss: standard('#6c7951', 1) };
}
export function beam(parent, material, a, b, width = 0.12, depth = width) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), d = end.clone().sub(start);
  const mesh = box(parent, material, [width, d.length(), depth], start.add(end).multiplyScalar(0.5).toArray());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return mesh;
}
function railing(parent, m, x, z0, z1, height = 1.25) {
  const posts = [];
  for (let z = z0; z <= z1; z += 2.5) posts.push({ position: [x, height / 2, z], size: [0.055, height, 0.055] });
  instances(parent, m.whiteSteel, posts);
  for (const y of [0.2, 0.65, height]) box(parent, m.whiteSteel, [0.055, 0.05, z1 - z0], [x, y, (z0 + z1) / 2]);
  const mesh = box(parent, m.glazing, [0.025, height - 0.25, z1 - z0], [x, height / 2, (z0 + z1) / 2]); mesh.name = 'LowSafetyBalustrade';
}
function archedRoof(parent, m, { left = -10, right = 8, spring = 7, rise = 3, depth = 90, glazed = false, bay = 6 } = {}) {
  const center = (left + right) / 2, half = (right - left) / 2;
  const shape = new THREE.Shape();
  for (let i = 0; i <= 40; i++) { const t = i / 40, x = center - half * Math.cos(Math.PI * t), y = spring + rise * Math.sin(Math.PI * t); i ? shape.lineTo(x, y) : shape.moveTo(x, y); }
  for (let i = 40; i >= 0; i--) { const t = i / 40; shape.lineTo(center - half * Math.cos(Math.PI * t), spring + rise * Math.sin(Math.PI * t) + 0.18); }
  shape.closePath();
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 }), glazed ? m.glazing : m.stone);
  roof.position.z = -depth / 2; roof.name = 'PhysicalCurvedRoof'; roof.receiveShadow = !glazed; roof.castShadow = !glazed; parent.add(roof);
  for (let z = -depth / 2; z <= depth / 2; z += bay) {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI, b = (i + 1) / 24 * Math.PI;
      beam(parent, m.whiteSteel, [center - half * Math.cos(a), spring + rise * Math.sin(a), z],
        [center - half * Math.cos(b), spring + rise * Math.sin(b), z], glazed ? 0.18 : 0.1, 0.24);
    }
    for (const x of [left, right]) beam(parent, m.whiteSteel, [x, 0, z], [x, spring, z], 0.2);
  }
  for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI; box(parent, m.whiteSteel, [0.06, 0.08, depth], [center - half * Math.cos(a), spring + rise * Math.sin(a), 0]); }
  return roof;
}

export class ExpressStation extends Station {
  constructor(base, options) {
    super(base, options);
    const def = options.definition;
    this.definition = def; this.outdoor = def.outdoor;
    this.userData.architecture = { signature: `u10-${def.design}`, outdoor: def.outdoor, actualOpenSides: def.outdoor };
    this.lightingOptions = { fixtures: false, pointDefinitions: [-30, -10, 10, 30].map(z => ({ position: [-4.5, 4.2, z],
      color: def.outdoor ? '#f4f4e5' : '#e6eff8', intensity: def.outdoor ? 35 : 90, distance: 28 })) };
    // The physical board has its own stand, independent of canopy height.
    for (const x of [-3.7, -0.7]) { box(this, base.whiteSteel, [0.07, 4.2, 0.07], [x, 2.1, -22]); this.addCollider(x, -22, 0.09, 0.09); }
  }
  buildArchitecture(m) {
    const def = this.options.definition;
    const architecture = new THREE.Group(); architecture.name = `U10Architecture-${def.design}`; this.add(architecture);
    this.architectureGroup = architecture;
    if (def.design === 'botanical') { this.buildBotanical(m, architecture); return; }
    if (def.design === 'airport') { this.buildAirportHall(m, architecture); return; }
    if (def.outdoor) { this.buildOpenPlatform(m, architecture); return; }
    // Distinct underground halls. No changes to pre-existing station types.
    box(architecture, m.stone, [0.35, 7.7, 90], [-10.1, 3.8, 0]);
    box(architecture, m.stone, [0.35, 7.7, 90], [7.85, 3.8, 0]);
    for (const z of [-44, 44]) {
      this.buildPlatformEndWall(m, z, 7.5);
      box(architecture, m.stone, [2.9, 7.5, 0.4], [6.4, 3.75, z]);
      box(architecture, m.stone, [4.9, 3.25, 0.4], [2.45, 5.875, z]);
    }
    if (def.design === 'finance' || def.design === 'central') {
      box(architecture, m.stone, [18, 0.24, 90], [-1.1, 7.7, 0]);
      for (let z = -42; z <= 42; z += def.design === 'finance' ? 6 : 8.4) {
        box(architecture, m.bronze, [17.5, 0.7, 0.16], [-1.1, 7.25, z]);
        for (const x of [-7.8, -2.8, 2.2]) box(architecture, m.bronze, [0.13, 0.6, 5.6], [x, 7.3, z]);
      }
      for (let z = -42; z < 44; z += 1.6) for (const x of [-9.86, 7.61]) box(architecture, m.bronze, [0.06, 4.6, 0.08], [x, 3.4, z]);
    } else if (def.design === 'ring') {
      box(architecture, m.stone, [18, 0.24, 90], [-1.1, 7.7, 0]);
      for (const z of [-30, -10, 10, 30]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.13, 6, 56), m.bronze); ring.rotation.x = Math.PI / 2; ring.position.set(-1, 6.7, z); architecture.add(ring);
        for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; beam(architecture, m.whiteSteel, [-1, 7.2, z], [-1 + Math.cos(a) * 4.2, 6.7, z + Math.sin(a) * 4.2], 0.06); }
      }
    } else archedRoof(architecture, m, { spring: 5.5, rise: 2.2 });
    for (const x of [-8.3]) for (const z of [-32, -16, 0, 16, 32]) {
      cylinder(architecture, m.whiteSteel, def.design === 'central' ? 0.24 : 0.18, 7.5, [x, 3.75, z]); this.addCollider(x, z, 0.5, 0.5);
    }
    for (const x of [-5.8, -1.1, 5.4]) box(architecture, m.tubeLight, [0.06, 0.04, 85], [x, 5.8, 0]);
    box(architecture, m.blue, [0.05, 0.35, 87], [-9.87, 1.05, 0]);
  }
  buildOpenPlatform(m, group) {
    const design = this.options.definition.design;
    railing(group, m, -10, -44, 44); railing(group, m, 7.8, -44, 44);
    for (const z of [-44, 44]) for (const [a, b] of this.options.platformEndOpenings.some(o => o.z === z) ? [[-10, -8.8], [-2.8, 0]] : [[-10, 0]]) {
      beam(group, m.whiteSteel, [a, 1.25, z], [b, 1.25, z], 0.06);
      box(group, m.glazing, [b - a, 1.1, 0.025], [(a + b) / 2, 0.6, z]);
    }
    for (let z = -36; z <= 36; z += 12) {
      const x = design === 'bridge' ? -6.4 : -7.7;
      cylinder(group, design === 'europa' ? m.timber : m.whiteSteel, 0.13, 5.3, [x, 2.65, z]); this.addCollider(x, z, 0.3, 0.3);
      const material = design === 'europa' ? m.timber : m.whiteSteel;
      beam(group, material, [x, 4.3, z], [-0.8, 5.5, z], 0.13);
      beam(group, material, [x, 4.3, z], [-9.7, 5.5, z], 0.13);
    }
    const bays = design === 'skyline' ? [[-40, -15], [-9, 14], [20, 40]] : [[-40, -4], [4, 40]];
    for (const [start, end] of bays) {
      const center = (start + end) / 2;
      box(group, design === 'europa' ? m.timber : m.canopy, [8.9, 0.12, end - start], [-5.15, 5.55, center], { rotation: [0, 0, design === 'bridge' ? 0.08 : -0.035] });
      for (const x of [-9.5, -1]) box(group, m.whiteSteel, [0.1, 0.18, end - start], [x, 5.5, center]);
      box(group, m.tubeLight, [0.05, 0.025, end - start - 1], [-4, 5.43, center]);
      if (design === 'europa') for (let z = start; z < end; z += 0.45) box(group, m.timber, [8.6, 0.12, 0.07], [-5.15, 5.37, z]);
    }
    if (design === 'bridge') for (const x of [-10.2, 8.05]) for (let z = -40; z < 40; z += 10) {
      beam(group, m.whiteSteel, [x, -1.1, z], [x, 3.3, z + 10], 0.2);
      beam(group, m.whiteSteel, [x, 3.3, z], [x, -1.1, z + 10], 0.2);
    }
  }
  buildBotanical(m, group) {
    archedRoof(group, m, { left: -28, right: 38, spring: 14, rise: 10, depth: 122, glazed: true, bay: 6.1 });
    for (const x of [-28, 38]) box(group, m.glazing, [0.06, 14, 122], [x, 7, 0]);
    // End glazing has an unobstructed railway opening and a garden doorway.
    for (const z of [-61, 61]) {
      for (const [left, right] of [[-28, -9], [8, 38]]) box(group, m.glazing, [right - left, 14, 0.06], [(left + right) / 2, 7, z]);
      box(group, m.glazing, [17, 8.5, 0.06], [-0.5, 9.75, z]);
      for (let x = -28; x <= 38; x += 6) beam(group, m.whiteSteel, [x, 0, z], [x, 14, z], 0.1);
    }
    box(group, m.stone, [18, 0.4, 120], [-19, -0.25, 0]);
    box(group, m.paving, [17.8, 0.04, 119.8], [-19, -0.025, 0]);
    box(group, m.stone, [30, 0.5, 122], [23, -0.3, 0]);
    box(group, m.paving, [29.8, 0.04, 121.8], [23, -0.025, 0]);
    this.walkableAreas.push({ minX: -27, maxX: -9, minZ: -42, maxZ: 42 });
    // Stone paths meander between substantial planted beds, with small pools.
    const plants = new BotanicalVegetation(); plants.name = 'EastBotanicalGardenLivingCollection';
    for (let z = -39; z <= 39; z += 13) {
      // Rich planting at passenger height, clear of the boarding strip and main aisle.
      box(group, m.stone, [1.8, 0.55, 5], [-8.9, 0.25, z]);
      box(group, m.soil, [1.6, 0.06, 4.8], [-8.9, 0.56, z]);
      this.addCollider(-8.9, z, 1.9, 5.1);
      plants.shrub(-8.9, 0.6, z - 1, 1.45, true); plants.shrub(-8.9, 0.6, z + 1.1, 1.3, true);
      plants.fern(-8.4, 0.6, z, 0.9); plants.grasses(-9.2, 0.6, z + 1.9, 1.2);
      plants.vine(-10.5, 7.5, z, 5, true);
    }
    for (const x of [-22.8, 17, 29]) for (const [i, z] of [-43, -23, -3, 17, 37].entries()) {
      box(group, m.stone, [6.4, 0.45, 13], [x, 0.18, z]);
      box(group, m.soil, [6.12, 0.05, 12.7], [x, 0.43, z]);
      box(group, m.moss, [5.8, 0.035, 12.1], [x, 0.47, z]);
      plants.tree(x, 0.46, z, 11 + i % 3 * 1.7, i % 2 ? 'magnolia' : 'oak');
      if (x < 0) this.addCollider(x, z, 6.5, 13.1);
      for (let k = 0; k < 5; k++) {
        plants.fern(x - 2 + k, 0.48, z - 4.3, 0.8 + k % 2 * 0.3);
        plants.shrub(x - 2 + k, 0.48, z + 4.2, 1.25, true);
      }
      plants.grasses(x - 2, 0.48, z, 1.2); plants.grasses(x + 2, 0.48, z + 1, 1.0);
    }
    plants.conifer(34, 0, -49, 13); plants.conifer(34, 0, 49, 14);
    for (let z = -54; z <= 54; z += 9) for (const x of [-27.6, 37.6]) {
      plants.vine(x, 0, z, 13); plants.vine(x + (x < 0 ? 1 : -1), 13, z, 7, true);
    }
    for (const z of [-51, 51]) {
      box(group, m.stone, [8, 0.5, 5.5], [-17, 0.2, z]); box(group, m.water, [7.6, 0.04, 5.1], [-17, 0.45, z]);
      this.addCollider(-17, z, 8, 5.5);
    }
    // Outdoor garden terraces remain visible beyond the conservatory.
    for (const x of [-40, 50]) for (let z = -60; z <= 60; z += 20) {
      box(group, m.stone, [15, 1.1, 17], [x, -1.0, z]); box(group, m.soil, [14.7, 0.08, 16.7], [x, -0.4, z]);
      plants.tree(x, -0.35, z, 10 + (z + 60) / 40, 'oak'); plants.shrub(x - 4, -0.35, z - 5, 1.7); plants.conifer(x + 4, -0.35, z + 5, 9);
    }
    plants.finish(); group.add(plants); this.vegetation = plants;
    // Deep lattice ribs express a buildable long-span conservatory structure.
    for (let z = -61; z <= 61; z += 12.2) for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI, b = (i + 1) / 20 * Math.PI;
      const p = [5 - 33 * Math.cos(a), 13.25 + 10 * Math.sin(a), z];
      const q = [5 - 33 * Math.cos(b), 13.25 + 10 * Math.sin(b), z];
      beam(group, m.whiteSteel, p, q, 0.14, 0.25);
      beam(group, m.whiteSteel, p, [q[0], q[1] + 0.75, q[2]], 0.07);
    }
    for (let z = -42; z <= 42; z += 14) {
      const path = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.3, 3, 32, Math.PI * 0.55), m.paving);
      path.rotation.x = -Math.PI / 2; path.position.set(22, 0.01, z); group.add(path);
    }
    for (const z of [-34, 0, 34]) label(group, 'EAST BOTANICAL GARDEN  /  LIVING COLLECTION', 8, 0.36, [-15, 3.7, z], { rotation: [0, Math.PI / 2, 0], background: '#234e42', fontSize: 82 });
  }
  buildAirportHall(m, group) {
    archedRoof(group, m, { left: -22, right: 18, spring: 9, rise: 5, depth: 110, glazed: true, bay: 5.5 });
    box(group, m.glazing, [0.08, 9, 110], [18, 4.5, 0]);
    for (const [a, b] of [[-55, -14], [14, 55]]) box(group, m.glazing, [0.08, 9, b - a], [-22, 4.5, (a + b) / 2]);
    box(group, m.glazing, [0.08, 5.8, 28], [-22, 6.1, 0]);
    box(group, m.stone, [12, 0.4, 110], [-16, -0.25, 0]);
    this.walkableAreas.push({ minX: -21, maxX: -9, minZ: -42, maxZ: 42 });
    for (const z of [-35, -17, 1, 19, 37]) {
      box(group, m.blue, [0.18, 3.3, 1.8], [-20, 1.65, z]);
      label(group, '✈  DEPARTURES  /  TERMINALS A · B', 5.8, 0.36, [-12, 4.5, z], { background: '#123b75', rotation: [0, Math.PI, 0], fontSize: 83 });
    }
    for (const z of [-55, 55]) box(group, m.glazing, [12, 9, 0.05], [-16, 4.5, z]);
  }
  buildFurniture(m) {
    for (const z of [-14, 5, 25]) {
      box(this, m.timber, [0.62, 0.12, 2.7], [-7.0, 0.48, z]); box(this, m.timber, [0.12, 0.55, 2.7], [-7.27, 0.79, z]);
      for (const dz of [-0.95, 0.95]) box(this, m.whiteSteel, [0.08, 0.43, 0.12], [-7, 0.22, z + dz]); this.addCollider(-7.1, z, 0.8, 2.8);
      box(this, m.whiteSteel, [0.48, 0.95, 0.48], [-8.2, 0.48, z + 3]); this.addCollider(-8.2, z + 3, 0.52, 0.52);
    }
    for (const z of [-34, 34]) {
      box(this, m.blue, [0.65, 2.0, 0.45], [-8, 1, z]); this.addCollider(-8, z, 0.7, 0.5);
      label(this, 'U10  /  INFORMATION', 0.47, 0.75, [-7.66, 1.25, z], { background: '#123b75', rotation: [0, Math.PI / 2, 0], fontSize: 120 });
    }
  }
  buildSignage(m) {
    for (const z of [-30, -6, 18, 38]) {
      const sign = new THREE.Group(); sign.position.set(-4.5, 3.4, z); this.add(sign);
      box(sign, m.blue, [5.3, 0.52, 0.14], [0, 0, 0]);
      for (const side of [-1, 1]) label(sign, `U10  ${this.displayName.toUpperCase()}`, 5.15, 0.44, [0, 0, side * 0.08], { rotation: [0, side < 0 ? Math.PI : 0, 0], background: '#123b75', fontSize: 84 });
      for (const x of [-2.3, 2.3]) box(sign, m.whiteSteel, [0.045, 1.6, 0.045], [x, 1.05, 0]);
    }
    for (const exit of this.options.platformEndOpenings) { const z = Math.sign(exit.z) * 42;
      label(this, '↑  EXIT / AUSGANG  ·  STAIRS', 4.8, 0.28, [-5.8, 2.6, z], { rotation: [0, z < 0 ? 0 : Math.PI, 0], background: '#285449', fontSize: 85 }); }
    const mapStand = new THREE.Group(); mapStand.name = 'U10PhysicalRouteInformation'; mapStand.position.set(-9.5, 0, 9); mapStand.rotation.y = Math.PI / 2; this.add(mapStand);
    box(mapStand, m.blue, [2.4, 2.8, 0.15], [0, 1.4, 0]);
    const map = label(mapStand, '', 2.25, 2.35, [0, 1.55, 0.09], { background: '#edf1ef' }); map.name = 'StationRouteDiagram';
    const names = this.options.routeNames, texture = map.material.map, canvas = texture.image, ctx = canvas.getContext('2d');
    map.userData.routeStops = [...names];
    ctx.fillStyle = '#123b75'; ctx.textAlign = 'left'; ctx.font = 'bold 47px Arial'; ctx.fillText('U10  AIRPORT EXPRESS', 55, 70);
    names.forEach((name, index) => {
      const y = 140 + index * 88;
      ctx.strokeStyle = '#123b75'; ctx.lineWidth = 7;
      if (index < names.length - 1) { ctx.beginPath(); ctx.moveTo(75, y); ctx.lineTo(75, y + 88); ctx.stroke(); }
      ctx.fillStyle = name === this.displayName ? '#ba8e3e' : '#123b75'; ctx.beginPath(); ctx.arc(75, y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#18354c'; ctx.font = '500 34px Arial'; ctx.fillText(name, 110, y + 10, canvas.width - 145);
      if (index === 0 || index === 2) { ctx.font = '22px Arial'; ctx.fillText(index === 0 ? 'Change: U1 / U2 / U3 / U4' : 'Change: U6', 110, y + 37); }
    }); texture.needsUpdate = true; this.addCollider(-9.5, 9, 0.2, 2.4);
  }
}
