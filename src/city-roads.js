import * as THREE from 'three';
import { box, label, seededRandom } from './geometry.js';
import { uvMesh, roofGeometry, CLUMP } from './city-buildings.js';
import { STREET_Y, CITY_ROADS, CITY_CROSSINGS } from './city-layout.js';

const PIPE = new THREE.CylinderGeometry(1, 1, 1, 10);
const PLANE = new THREE.PlaneGeometry(1, 1);
const DECAL = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const BEAD = new THREE.IcosahedronGeometry(1, 0);
const ASPHALT_TOP = STREET_Y + 0.016, PAINT_Y = STREET_Y + 0.0175;

/** Road frame helpers: `a` runs along the road, `b` across it (positive b = +z for x roads, +x for z roads). */
const frame = road => road.axis === 'x'
  ? { at: (a, b) => [a, b + road.c], size: (la, lb) => [la, lb], yaw: 0 }
  : { at: (a, b) => [b + road.c, a], size: (la, lb) => [lb, la], yaw: Math.PI / 2 };
const half = road => road.width / 2 + road.walk;
const span = (road, a) => a >= road.from && a <= road.to;

/** Intervals [a0, a1] minus a list of cuts. */
function subtract(a0, a1, cuts) {
  let parts = [[a0, a1]];
  for (const [c0, c1] of cuts) parts = parts.flatMap(([p0, p1]) => c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, Math.max(p0, c0)], [Math.min(p1, c1), p1]].filter(([x, y]) => y - x > 0.05));
  return parts;
}

/**
 * Asphalt carriageways, kerbs, square-tiled sidewalks, markings, crossings and street furniture.
 * Roads may run through a junction (crossroads) or end on another road (T-junction). Where both run
 * through, the north-south carriageway is cut so the surfaces never overlap. Everything is flush with
 * street level except kerbs (7 cm) and furniture, which always stands on a sidewalk.
 */
export function buildRoads(root, kit, m, colliders) {
  const random = seededRandom(1201), rects = [], zebras = [];
  const roads = CITY_ROADS, mains = roads.filter(r => r.axis === 'x'), links = roads.filter(r => r.axis === 'z');
  const crosses = (r, o) => o.axis !== r.axis && span(r, o.c) && span(o, r.c);
  const endsOn = (r, o) => crosses(r, o) && (Math.abs(r.from - o.c) < 0.01 || Math.abs(r.to - o.c) < 0.01);
  const layout = new Map();
  for (const road of roads) {
    const w = road.width / 2, others = roads.filter(o => crosses(road, o));
    // Carriageway extents stop at the carriageway of any road this one ends on.
    let c0 = road.from, c1 = road.to;
    for (const o of others) if (endsOn(road, o)) {
      if (Math.abs(road.from - o.c) < 0.01) c0 = o.c + o.width / 2; else c1 = o.c - o.width / 2;
    }
    const carCuts = road.axis === 'z' ? others.filter(o => !endsOn(road, o) && !endsOn(o, road)).map(o => [o.c - o.width / 2, o.c + o.width / 2]) : [];
    const walk = { [-1]: [], [1]: [] }, cuts = { [-1]: [], [1]: [] }, kerbCuts = { [-1]: [], [1]: [] };
    for (const side of [-1, 1]) {
      const line = road.c + side * (w + road.walk / 2), edge = road.c + side * (w + 0.5);
      let a0 = road.from, a1 = road.to;
      if (road.axis === 'x') for (const o of others) if (endsOn(road, o)) { if (Math.abs(road.from - o.c) < 0.01) a0 = o.c + o.width / 2; else a1 = o.c - o.width / 2; }
      walk[side] = [[a0, a1]];
      for (const o of others) {
        if (road.axis === 'x' && span(o, line)) cuts[side].push([o.c - o.width / 2, o.c + o.width / 2]);
        if (road.axis === 'z' && span(o, line)) cuts[side].push([o.c - half(o), o.c + half(o)]);
        if (span(o, edge)) kerbCuts[side].push([o.c - o.width / 2, o.c + o.width / 2]);
      }
    }
    layout.set(road, { car: [c0, c1], carCuts, walk, cuts, kerbCuts, others });
  }
  const hasWalk = (road, side, a) => { const L = layout.get(road); return L.walk[side].some(([a0, a1]) => a > a0 + 0.3 && a < a1 - 0.3) && !L.cuts[side].some(([c0, c1]) => a > c0 - 0.3 && a < c1 + 0.3); };
  const onSidewalk = (x, z) => roads.some(r => { for (const side of [-1, 1]) {
    const along = r.axis === 'x' ? x : z, across = (r.axis === 'x' ? z : x) - r.c, w = r.width / 2;
    if (side * across > w + 0.25 && side * across < w + r.walk - 0.25 && hasWalk(r, side, along)) return true; } return false; });
  for (const road of roads) {
    const f = frame(road), L = layout.get(road), w = road.width / 2;
    const [c0, c1] = L.car;
    for (const [p0, p1] of subtract(c0, c1, L.carCuts)) {
      const [x, z] = f.at((p0 + p1) / 2, 0), [sx, sz] = f.size(p1 - p0, road.width);
      uvMesh(root, m.asphalt, [sx, 0.006, sz], [x, ASPHALT_TOP - 0.003, z], { tile: 6, shadow: false }).receiveShadow = true;
    }
    rects.push(road.axis === 'x' ? { minX: road.from, maxX: road.to, minZ: road.c - half(road), maxZ: road.c + half(road) }
      : { minX: road.c - half(road), maxX: road.c + half(road), minZ: road.from, maxZ: road.to });
    // Zebra crossings: beside each junction and at listed mid-block points.
    const junctions = L.others, crossings = [];
    for (const j of junctions) for (const s of [-1, 1]) {
      const a = j.c + s * (half(j) + 2.4);
      if (a > c0 + 1.5 && a < c1 - 1.5) crossings.push({ a, s });
    }
    for (const [name, a] of CITY_CROSSINGS) if (name === road.name) crossings.push({ a, s: 0 });
    // Sidewalks and kerbs, dropped flush at each crossing with tactile paving and bollards.
    const drops = crossings.map(c => [c.a - 1.6, c.a + 1.6]);
    for (const side of [-1, 1]) {
      const b = side * (w + road.walk / 2);
      for (const [a0, a1] of L.walk[side]) for (const [p0, p1] of subtract(a0, a1, L.cuts[side])) {
        const [x, z] = f.at((p0 + p1) / 2, b), [sx, sz] = f.size(p1 - p0, road.walk);
        uvMesh(root, m.sidewalk, [sx, 0.006, sz], [x, ASPHALT_TOP - 0.003, z], { tile: 4, shadow: false }).receiveShadow = true;
      }
      for (const [k0, k1] of subtract(c0, c1, [...L.kerbCuts[side], ...drops])) {
        const [kx, kz] = f.at((k0 + k1) / 2, side * (w + 0.11)), [ksx, ksz] = f.size(k1 - k0, 0.22);
        uvMesh(root, m.kerb, [ksx, 0.07, ksz], [kx, STREET_Y + 0.035, kz], { tile: 2 });
      }
      for (const c of crossings) {
        if (!hasWalk(road, side, c.a)) continue;
        const [kx, kz] = f.at(c.a, side * (w + 0.11)), [ksx, ksz] = f.size(3.2, 0.22);
        uvMesh(root, m.kerb, [ksx, 0.024, ksz], [kx, STREET_Y + 0.012, kz], { tile: 2 });
        const [tx, tz] = f.at(c.a, side * (w + 0.62)), [tsx, tsz] = f.size(2.8, 0.8);
        kit.add(m.tactile, { size: [tsx, 0.004, tsz], position: [tx, ASPHALT_TOP + 0.002, tz] });
        for (const e of [-1, 1]) {
          const [bx, bz] = f.at(c.a + e * 1.85, side * (w + 0.45));
          kit.add(m.iron, { size: [0.09, 0.85, 0.09], position: [bx, STREET_Y + 0.425, bz] }, PIPE);
          kit.add(m.iron, { size: [0.12, 0.06, 0.12], position: [bx, STREET_Y + 0.88, bz] }, PIPE);
          kit.add(m.gold, { size: [0.095, 0.05, 0.095], position: [bx, STREET_Y + 0.72, bz] }, PIPE);
          colliders.push({ minX: bx - 0.12, maxX: bx + 0.12, minZ: bz - 0.12, maxZ: bz + 0.12 });
        }
      }
    }
    // Markings: edge lines; a dashed centre line (2 lanes) or a double centre line with dashed lane lines (4 lanes).
    const wide = road.width >= 11;
    const stops = [...junctions.map(j => [j.c - j.width / 2 - 0.8, j.c + j.width / 2 + 0.8]), ...crossings.map(c => [c.a - 2.9, c.a + 2.9])];
    for (const [p0, p1] of subtract(c0 + 0.8, c1 - 0.8, stops)) {
      const line = (b, length, at) => { const [x, z] = f.at(at, b), [sx, sz] = f.size(length, 0.12); kit.add(m.paint, { size: [sx, 0.003, sz], position: [x, PAINT_Y, z] }); };
      for (const side of [-1, 1]) line(side * (w - 0.35), p1 - p0, (p0 + p1) / 2);
      if (wide) {
        for (const side of [-1, 1]) line(side * 0.14, p1 - p0, (p0 + p1) / 2);
        for (let a = p0 + 0.5; a + 3 <= p1; a += 9) for (const side of [-1, 1]) line(side * w / 2, 3, a + 1.5);
      } else for (let a = p0 + 0.5; a + 3 <= p1; a += 6) line(0, 3, a + 1.5);
    }
    // Zebra bars run with the traffic; a stop line guards the approaching lane(s).
    for (const c of crossings) {
      for (let b = -w + 0.55; b + 0.5 <= w - 0.45; b += 1.0) {
        const [x, z] = f.at(c.a, b + 0.25), [sx, sz] = f.size(3, 0.5);
        kit.add(m.paint, { size: [sx, 0.003, sz], position: [x, PAINT_Y, z] });
      }
      for (const s of c.s === 0 ? [-1, 1] : [c.s]) {
        const lane = road.axis === 'x' ? -s : s, [x, z] = f.at(c.a + s * 2.6, lane * w / 2), [sx, sz] = f.size(0.3, w - 0.2);
        kit.add(m.paint, { size: [sx, 0.003, sz], position: [x, PAINT_Y, z] });
      }
      zebras.push({ road, ...c });
    }
    // Drains along both kerbs and manholes in the lanes.
    for (let a = c0 + 9, n = 0; a < c1 - 4; a += 18, n++) {
      if (stops.some(([s0, s1]) => a > s0 - 1 && a < s1 + 1)) continue;
      for (const side of [-1, 1]) {
        const [x, z] = f.at(a, side * (w - 0.22)), [sx, sz] = f.size(0.7, 0.32);
        kit.add(m.iron, { size: [sx, 0.004, sz], position: [x, ASPHALT_TOP + 0.002, z] });
        for (let k = -2; k <= 2; k++) { const [gx, gz] = f.at(a + k * 0.12, side * (w - 0.22)), [gsx, gsz] = f.size(0.05, 0.26); kit.add(m.asphalt, { size: [gsx, 0.005, gsz], position: [gx, ASPHALT_TOP + 0.0025, gz] }); }
      }
      if (n % 2 === 0) { const [x, z] = f.at(a + 4, (random() < 0.5 ? -1 : 1) * w / 2); kit.add(m.iron, { size: [0.34, 0.004, 0.34], position: [x, ASPHALT_TOP + 0.002, z] }, PIPE); }
    }
  }
  // Traffic signals on every kerb corner that has a sidewalk; one street-name post per junction.
  for (const A of mains) for (const B of links) {
    if (!crosses(A, B)) continue;
    let named = false;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const px = B.c + sx * (B.width / 2 + 0.55), pz = A.c + sz * (A.width / 2 + 0.55);
      if (!onSidewalk(px, pz)) continue;
      addSignal(kit, m, px, pz, sx, sz);
      colliders.push({ minX: px - 0.15, maxX: px + 0.15, minZ: pz - 0.15, maxZ: pz + 0.15 });
      if (!named && sx > 0) { addStreetName(root, kit, m, px, pz, A.name, B.name); named = true; }
    }
  }
  // Signs: speed limits at the ends of the through roads, crossing signs, parking, no parking, give way.
  const sign = (kind, x, z, yaw, height = 2.4) => {
    kit.add(m.galvanised, { size: [0.045, height, 0.045], position: [x, STREET_Y + height / 2, z] }, PIPE);
    kit.add(m.signs[kind], { size: [0.62, 0.62, 1], position: [x, STREET_Y + height + 0.05, z], rotation: [0, yaw, 0] }, PLANE);
    colliders.push({ minX: x - 0.1, maxX: x + 0.1, minZ: z - 0.1, maxZ: z + 0.1 });
  };
  for (const road of mains.filter(r => r.width >= 7 && r.to - r.from > 300)) {
    sign('limit', road.from + 9, road.c + road.width / 2 + 0.5, -Math.PI / 2);
    sign('limit', road.to - 9, road.c - road.width / 2 - 0.5, Math.PI / 2);
  }
  for (const { road, a } of zebras) {
    // One sign on each approach's right-hand side, facing the oncoming traffic.
    if (road.axis === 'x') {
      if (hasWalk(road, 1, a - 2.4)) sign('crossing', a - 2.4, road.c + road.width / 2 + 0.5, -Math.PI / 2);
      if (hasWalk(road, -1, a + 2.4)) sign('crossing', a + 2.4, road.c - road.width / 2 - 0.5, Math.PI / 2);
    } else {
      if (hasWalk(road, -1, a - 2.4)) sign('crossing', road.c - road.width / 2 - 0.5, a - 2.4, Math.PI);
      if (hasWalk(road, 1, a + 2.4)) sign('crossing', road.c + road.width / 2 + 0.5, a + 2.4, 0);
    }
  }
  const corso = mains[0];
  for (const [b0, b1] of [[-80, -52], [44, 72]]) {
    for (let a = b0; a <= b1 + 0.01; a += 5.6) kit.add(m.paint, { size: [0.12, 0.003, 2.1], position: [a, PAINT_Y, corso.c + corso.width / 2 - 1.05] });
    kit.add(m.paint, { size: [b1 - b0, 0.003, 0.12], position: [(b0 + b1) / 2, PAINT_Y, corso.c + corso.width / 2 - 2.1] });
    sign('parking', b0 + 0.3, corso.c + corso.width / 2 + 0.55, -Math.PI / 2);
  }
  sign('noparking', -121, corso.c - corso.width / 2 - 0.55, Math.PI / 2);
  sign('noparking', 99, corso.c + corso.width / 2 + 0.55, -Math.PI / 2);
  for (const road of links) if (mains.some(a => endsOn(road, a) && Math.abs(road.from - a.c) < 0.01)) sign('yield', road.c + road.width / 2 + 0.5, layout.get(road).car[0] + 7, 0);
  addBusStop(root, kit, m, 18, corso, colliders, sign);
  for (const [x, z] of [[-60, -125.6], [10, -114.6], [-60, -80.8], [40, -91.4], [-99, -100], [89, -100]]) {
    kit.add(m.bin, { size: [0.28, 0.85, 0.28], position: [x, STREET_Y + 0.425, z] }, PIPE);
    kit.add(m.iron, { size: [0.3, 0.05, 0.3], position: [x, STREET_Y + 0.87, z] }, PIPE);
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
  }
  for (const [x, z] of [[-40, -126.6], [100, -113.4], [-122, -91.6]]) {
    kit.add(m.hydrant, { size: [0.14, 0.7, 0.14], position: [x, STREET_Y + 0.35, z] }, PIPE);
    kit.add(m.hydrant, { size: [0.18, 0.1, 0.18], position: [x, STREET_Y + 0.72, z] }, PIPE);
    kit.add(m.hydrant, { size: [0.42, 0.08, 0.08], position: [x, STREET_Y + 0.5, z] });
    colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 });
  }
  return rects;
}

function addSignal(kit, m, x, z, sx, sz) {
  kit.add(m.galvanised, { size: [0.07, 3.4, 0.07], position: [x, STREET_Y + 1.7, z] }, PIPE);
  kit.add(m.galvanised, { size: [0.16, 0.18, 0.16], position: [x, STREET_Y + 0.09, z] }, PIPE);
  // Push-button box for pedestrians.
  kit.add(m.paintYellow, { size: [0.14, 0.22, 0.1], position: [x, STREET_Y + 1.1, z - sz * 0.08] });
  // Two vehicle heads: one facing traffic along x, one along z. Main road shows green, side road red.
  for (const [yaw, green, ox, oz] of [[sx > 0 ? -Math.PI / 2 : Math.PI / 2, true, 0, 0], [sz > 0 ? 0 : Math.PI, false, 0, 0]]) {
    const dx = Math.sin(yaw) * 0.16, dz = Math.cos(yaw) * 0.16, y = STREET_Y + 3.05;
    kit.add(m.iron, { size: [0.3, 0.9, 0.22], position: [x + dx + ox, y, z + dz + oz], rotation: [0, yaw, 0] });
    for (const [k, mat] of [[1, green ? m.signalRedDim : m.signalRed], [0, m.signalAmber], [-1, green ? m.signalGreenLit : m.signalGreen]])
      kit.add(mat, { size: [0.17, 0.17, 0.03], position: [x + dx * 1.75, y + k * 0.27, z + dz * 1.75], rotation: [0, yaw, 0] });
    for (const k of [1, 0, -1]) kit.add(m.iron, { size: [0.24, 0.04, 0.12], position: [x + dx * 2.1, y + k * 0.27 + 0.11, z + dz * 2.1], rotation: [0, yaw, 0] });
  }
}

function addStreetName(root, kit, m, x, z, a, b) {
  kit.add(m.galvanised, { size: [0.045, 0.7, 0.045], position: [x, STREET_Y + 3.75, z] }, PIPE);
  label(root, a, 1.9, 0.26, [x, STREET_Y + 3.9, z + 0.03], { background: '#1d3f8f', color: '#ffffff', fontSize: 92, border: true });
  label(root, a, 1.9, 0.26, [x, STREET_Y + 3.9, z - 0.03], { background: '#1d3f8f', color: '#ffffff', fontSize: 92, border: true, rotation: [0, Math.PI, 0] });
  label(root, b, 1.9, 0.26, [x + 0.03, STREET_Y + 3.6, z], { background: '#1d3f8f', color: '#ffffff', fontSize: 92, border: true, rotation: [0, Math.PI / 2, 0] });
  label(root, b, 1.9, 0.26, [x - 0.03, STREET_Y + 3.6, z], { background: '#1d3f8f', color: '#ffffff', fontSize: 92, border: true, rotation: [0, -Math.PI / 2, 0] });
}

function addBusStop(root, kit, m, x, road, colliders, sign) {
  const kerb = road.c - road.width / 2, zBack = kerb - road.walk + 0.5, len = 4.2;
  // Shelter: frame, glass back and ends, cantilevered roof, bench.
  for (const dx of [-len / 2, len / 2]) for (const dz of [0, 1.25]) kit.add(m.galvanised, { size: [0.08, 2.45, 0.08], position: [x + dx, STREET_Y + 1.225, zBack + dz] });
  kit.add(m.galvanised, { size: [len + 0.3, 0.12, 1.7], position: [x, STREET_Y + 2.5, zBack + 0.65] });
  kit.add(m.paintYellow, { size: [len + 0.32, 0.06, 1.72], position: [x, STREET_Y + 2.43, zBack + 0.65] });
  box(root, m.shelterGlass, [len, 2.0, 0.03], [x, STREET_Y + 1.3, zBack], { shadow: false });
  for (const dx of [-len / 2, len / 2]) box(root, m.shelterGlass, [0.03, 2.0, 1.2], [x + dx, STREET_Y + 1.3, zBack + 0.62], { shadow: false });
  kit.add(m.cafeWood, { size: [len - 0.6, 0.06, 0.42], position: [x, STREET_Y + 0.48, zBack + 0.32] });
  for (const dx of [-1.4, 1.4]) kit.add(m.iron, { size: [0.06, 0.46, 0.36], position: [x + dx, STREET_Y + 0.23, zBack + 0.32] });
  label(root, 'CENTRALE · LINEA 4', 1.6, 0.9, [x + 1.0, STREET_Y + 1.45, zBack + 0.03], { background: '#f3efe3', color: '#1d3f8f', fontSize: 70, border: true });
  colliders.push({ minX: x - len / 2 - 0.1, maxX: x + len / 2 + 0.1, minZ: zBack - 0.1, maxZ: zBack + 1.35 });
  sign('bus', x + len / 2 + 1.2, kerb - 0.5, Math.PI / 2, 2.6);
  // Yellow zig-zag bus box along the kerb.
  const z0 = kerb + 0.35, z1 = kerb + 1.1;
  for (let a = -9; a < 9; a += 1.2) {
    const xa = x + a, xb = x + a + 0.6;
    kit.add(m.paintYellow, { size: [Math.hypot(0.6, z1 - z0), 0.003, 0.1], position: [(xa + xb) / 2 + 0.3, PAINT_Y, (z0 + z1) / 2], rotation: [0, Math.atan2(z1 - z0, 0.6), 0] });
    kit.add(m.paintYellow, { size: [Math.hypot(0.6, z1 - z0), 0.003, 0.1], position: [(xa + xb) / 2 - 0.3, PAINT_Y, (z0 + z1) / 2], rotation: [0, -Math.atan2(z1 - z0, 0.6), 0] });
  }
  kit.add(m.paintYellow, { size: [18, 0.003, 0.1], position: [x, PAINT_Y, kerb + 1.7] });
}

/** Festive open-sided canopy: striped cloth roof, scalloped valance, carved poles, marigold garlands, carpet and tables. */
export function addShamiana(root, kit, m, spec, colliders, seed) {
  const { x, z, w, d } = spec, eave = 3.1, rise = 1.35, random = seededRandom(seed);
  const roof = new THREE.Mesh(roofGeometry(w, d, rise, 0.25, 'hip'), m.canopy);
  roof.position.set(x, STREET_Y + eave, z); roof.castShadow = roof.receiveShadow = true; root.add(roof);
  const W = w + 0.5, D = d + 0.5;
  for (const [len, px, pz, ry] of [[W, x, z + D / 2, 0], [W, x, z - D / 2, Math.PI], [D, x + W / 2, z, Math.PI / 2], [D, x - W / 2, z, -Math.PI / 2]])
    uvMesh(root, m.valance, [len, 0.5, 0.02], [px, STREET_Y + eave - 0.22, pz], { tile: 1.0, rotation: [0, ry, 0] });
  box(root, m.durrie, [w - 0.4, 0.006, d - 0.4], [x, STREET_Y + 0.04, z], { shadow: false }).receiveShadow = true;
  // Poles: corners and intermediate posts on the long sides, never on the centre line.
  const poles = [];
  const nx = Math.max(1, Math.round(w / 3.4)), nz = Math.max(1, Math.round(d / 3.4));
  for (let i = 0; i <= nx; i++) for (const sz of [-1, 1]) poles.push([x - w / 2 + w * i / nx, z + sz * d / 2]);
  for (let j = 1; j < nz; j++) for (const sx of [-1, 1]) poles.push([x + sx * w / 2, z - d / 2 + d * j / nz]);
  for (const [px, pz] of poles) {
    kit.add(m.poleRed, { size: [0.075, eave, 0.075], position: [px, STREET_Y + eave / 2, pz] }, PIPE);
    for (const y of [0.12, 1.0, 2.1, eave - 0.1]) kit.add(m.gold, { size: [0.105, 0.09, 0.105], position: [px, STREET_Y + y, pz] }, PIPE);
    kit.add(m.gold, { size: [0.12, 0.2, 0.12], position: [px, STREET_Y + eave + 0.1, pz] }, BEAD);
    colliders.push({ minX: px - 0.13, maxX: px + 0.13, minZ: pz - 0.13, maxZ: pz + 0.13 });
    // Hanging marigold strands at each pole.
    for (let k = 0; k < 14; k++) kit.add(k % 3 ? m.marigold : m.marigoldYellow, { size: [0.075, 0.075, 0.075], position: [px + 0.12, STREET_Y + eave - 0.5 - k * 0.11, pz + 0.12] }, BEAD);
  }
  // Swagged garlands between neighbouring perimeter poles, just under the valance.
  // Re-order so corners connect around the perimeter.
  const perimeter = [[x - w / 2, z + d / 2], [x + w / 2, z + d / 2], [x + w / 2, z - d / 2], [x - w / 2, z - d / 2]];
  const edges = [];
  for (let e = 0; e < 4; e++) {
    const [ax, az] = perimeter[e], [bx, bz] = perimeter[(e + 1) % 4], n = e % 2 ? nz : nx;
    for (let k = 0; k < n; k++) edges.push([[ax + (bx - ax) * k / n, az + (bz - az) * k / n], [ax + (bx - ax) * (k + 1) / n, az + (bz - az) * (k + 1) / n]]);
  }
  for (const [[ax, az], [bx, bz]] of edges) {
    const len = Math.hypot(bx - ax, bz - az), count = Math.round(len / 0.1);
    for (let k = 1; k < count; k++) {
      const t = k / count, sag = 0.55 * 4 * t * (1 - t);
      kit.add((k >> 2) % 2 ? m.marigold : m.marigoldYellow, { size: [0.07, 0.07, 0.07], position: [ax + (bx - ax) * t, STREET_Y + eave - 0.48 - sag, az + (bz - az) * t] }, BEAD);
    }
  }
  // Tables with white cloths and chairs beneath, and a brass lamp hanging from the ridge.
  for (const dx of [-w / 4, w / 4]) colliders.push(addCafeTable(kit, m, x + dx, z, random));
  kit.add(m.gold, { size: [0.22, 0.32, 0.22], position: [x, STREET_Y + eave + 0.2, z] }, BEAD);
  kit.add(m.lanternGlass, { size: [0.16, 0.2, 0.16], position: [x, STREET_Y + eave + 0.02, z] }, BEAD);
}

function addCafeTable(kit, m, x, z, random) {
  kit.add(m.tablecloth, { size: [1.6, 0.06, 0.8], position: [x, STREET_Y + 0.76, z] });
  kit.add(m.tablecloth, { size: [1.62, 0.5, 0.82], position: [x, STREET_Y + 0.5, z] });
  for (const dz of [-0.75, 0.75]) for (const dx of [-0.45, 0.45]) {
    kit.add(m.poleRed, { size: [0.42, 0.06, 0.42], position: [x + dx, STREET_Y + 0.46, z + dz] });
    kit.add(m.poleRed, { size: [0.42, 0.45, 0.05], position: [x + dx, STREET_Y + 0.72, z + dz + Math.sign(dz) * 0.2] });
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) kit.add(m.gold, { size: [0.03, 0.46, 0.03], position: [x + dx + lx, STREET_Y + 0.23, z + dz + lz] });
  }
  kit.add(random() < 0.5 ? m.marigold : m.flowersRed, { size: [0.2, 0.18, 0.2], position: [x, STREET_Y + 0.88, z] }, CLUMP);
  return { minX: x - 0.85, maxX: x + 0.85, minZ: z - 1.05, maxZ: z + 1.05 };
}

/** Ragged lawn patches and tufts on flagstone areas (flat decals; walkable). */
export function addGrassPatches(kit, m, spots, avoid) {
  const random = seededRandom(77);
  for (const [x, z, s] of spots) {
    if (avoid.some(r => x > r.minX - s / 2 && x < r.maxX + s / 2 && z > r.minZ - s / 2 && z < r.maxZ + s / 2)) continue;
    kit.add(random() < 0.5 ? m.grassPatch : m.grassPatch2, { size: [s, 1, s * (0.7 + random() * 0.5)], position: [x, STREET_Y + 0.033, z], rotation: [0, random() * Math.PI * 2, 0] }, DECAL);
  }
}

