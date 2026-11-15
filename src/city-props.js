import * as THREE from 'three';
import { instances, seededRandom } from './geometry.js';
import { POT, CLUMP, PETALS, LEAVES, uvMesh, CELL } from './city-buildings.js';

/** Instance collector: one InstancedMesh per material/geometry pair. */
export class PropKit {
  constructor() { this.sets = new Map(); }
  add(material, entry, geometry) {
    // One batch per material/geometry and per ~140 m area, so whole areas can be culled.
    const cell = `${Math.floor(entry.position[0] / CELL)},${Math.floor(entry.position[2] / CELL)}`;
    const key = material.uuid + (geometry?.uuid ?? '') + (entry.color ? '/c' : '') + '@' + cell;
    if (!this.sets.has(key)) this.sets.set(key, { material, geometry, entries: [] });
    this.sets.get(key).entries.push(entry);
  }
  flush(root) {
    for (const { material, geometry, entries } of this.sets.values()) {
      const mesh = instances(root, material, entries, geometry);
      mesh.name = 'OldTownProps';
      if (material.userData.noCast) mesh.castShadow = false;
    }
  }
}

const PIPE = new THREE.CylinderGeometry(1, 1, 1, 8);
const ROD = new THREE.CylinderGeometry(1, 1, 1, 4).rotateZ(Math.PI / 2);
const TRUNK = (() => {
  const g = new THREE.CylinderGeometry(0.17, 0.27, 1, 9, 8).translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + 0.55 * y * y); }
  g.computeVertexNormals(); return g;
})();
const PARASOL = new THREE.ConeGeometry(1, 0.42, 16, 1, true);
const FLAG = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  return g;
})();
const FRUIT = new THREE.IcosahedronGeometry(1, 0);
const CROWN = new THREE.IcosahedronGeometry(1, 1);

function frondGeometry(count, seed, droop = 0.9, dry = false) {
  const random = seededRandom(seed), position = [];
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const length = (dry ? 1.3 : 2.6) + random() * (dry ? 0.5 : 0.9), yaw = k / count * Math.PI * 2 + random() * 0.35;
    const lift = dry ? -1.15 : 0.15 + random() * 0.4 - (k % 3 === 0 ? 0 : 0.25);
    m.makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(lift));
    const spine = [], left = [], right = [], N = 10;
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = length * t, y = length * (0.42 * t - droop * t * t) * (dry ? 0.4 : 1);
      const width = (dry ? 0.22 : 0.5) * Math.sin(Math.PI * Math.min(1, t * 1.08)) * (i % 2 ? 1 : 0.55);
      spine.push([x, y, 0]); left.push([x + 0.06, y - width * 0.35, -width]); right.push([x + 0.06, y - width * 0.35, width]);
    }
    const tri = (...pts) => { for (const p of pts) { v.fromArray(p).applyMatrix4(m); position.push(v.x, v.y, v.z); } };
    for (let i = 0; i < N; i++) {
      tri(spine[i], spine[i + 1], left[i + 1]); tri(spine[i], left[i + 1], left[i]);
      tri(spine[i], right[i + 1], spine[i + 1]); tri(spine[i], right[i], right[i + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(position.length / 3 * 2), 2));
  return g;
}
const CROWNS = [frondGeometry(13, 5), frondGeometry(11, 9, 1.05)];
const SKIRT = frondGeometry(9, 21, 0.3, true);

const leanEuler = (random) => { const a = random() * Math.PI * 2, lean = 0.05 + random() * 0.12; return [Math.cos(a) * lean, random() * Math.PI * 2, Math.sin(a) * lean]; };

/** Tall fan of fronds on a ringed, gently curved trunk. Collider matches the old street tree. */
export function addPalm(kit, m, x, z, y0, seed) {
  const random = seededRandom(seed * 31 + 7), height = 6.2 + random() * 2.4, rotation = leanEuler(random);
  kit.add(m.palmBark, { size: [1, height, 1], position: [x, y0, z], rotation }, TRUNK);
  const top = new THREE.Vector3(0.55, height, 0).applyEuler(new THREE.Euler(...rotation)).add(new THREE.Vector3(x, y0, z));
  kit.add(m.palmFrond, { size: [1, 1, 1], position: top.toArray(), rotation: [0, random() * 6.28, 0] }, CROWNS[seed % 2]);
  kit.add(m.palmDry, { size: [1, 1, 1], position: [top.x, top.y - 0.15, top.z], rotation: [0, random() * 6.28, 0] }, SKIRT);
  return { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 };
}

/** Round citrus tree; potted ones are smaller and sit in a large terracotta pot. */
export function addCitrus(kit, m, x, z, y0, seed, potted = false) {
  const random = seededRandom(seed * 17 + 3), s = potted ? 0.75 : 1.25 + random() * 0.25;
  let base = y0;
  if (potted) {
    kit.add(m.terracotta, { size: [0.78, 0.85, 0.78], position: [x, y0 + 0.425, z] }, POT);
    kit.add(m.terracotta, { size: [0.82, 0.08, 0.82], position: [x, y0 + 0.85, z] }, PIPE);
    base = y0 + 0.85;
  }
  const trunk = (potted ? 1.0 : 1.9) * (0.9 + random() * 0.2);
  kit.add(m.timber, { size: [0.08 * s + 0.03, trunk, 0.08 * s + 0.03], position: [x, base + trunk / 2, z] }, PIPE);
  const cy = base + trunk + 0.75 * s;
  kit.add(m.foliage, { size: [1.15 * s, 0.95 * s, 1.15 * s], position: [x, cy, z], rotation: [0, random() * 6, 0] }, CROWN);
  kit.add(m.foliage, { size: [0.8 * s, 0.7 * s, 0.8 * s], position: [x + 0.45 * s, cy + 0.35 * s, z - 0.2 * s], rotation: [0, random() * 6, 0] }, CROWN);
  for (let i = 0; i < 14; i++) {
    const t = random() * Math.PI * 2, p = 0.3 + random() * 1.4, r = 1.08 * s;
    kit.add(m.lemon, { size: [0.1, 0.12, 0.1], position: [x + Math.sin(p) * Math.cos(t) * r, cy + Math.cos(p) * r * 0.82, z + Math.sin(p) * Math.sin(t) * r] }, FRUIT);
  }
  const radius = potted ? 0.5 : 0.25;
  return { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
}

/** Bougainvillea mound (magenta bracts over leaves). */
export function addBougainvillea(kit, m, x, y, z, sx, sy, sz, seed) {
  const random = seededRandom(seed);
  for (let i = 0; i < 3; i++) {
    const ox = (random() - 0.5) * sx, oz = (random() - 0.5) * sz;
    kit.add(m.leaf, { size: [sx * 0.6, sy * 0.8, sz * 0.6], position: [x + ox, y, z + oz], rotation: [0, random() * 6, 0] }, LEAVES);
    kit.add(m.petal, { size: [sx * 0.62, sy * 0.85, sz * 0.62], position: [x + ox, y + 0.08, z + oz], rotation: [0, random() * 6, 0] }, PETALS);
  }
}

/** Café table under a striped parasol, with a few chairs. */
export function addCafe(kit, m, x, z, y0, seed) {
  const random = seededRandom(seed * 13 + 1), parasol = m.parasols[seed % m.parasols.length];
  kit.add(m.cafeWood, { size: [0.045, 2.55, 0.045], position: [x, y0 + 1.27, z] }, PIPE);
  kit.add(parasol, { size: [1.75, 1, 1.75], position: [x, y0 + 2.6, z] }, PARASOL);
  kit.add(m.cafeWood, { size: [0.06, 0.12, 0.06], position: [x, y0 + 2.86, z] }, PIPE);
  kit.add(m.tablecloth, { size: [0.48, 0.04, 0.48], position: [x, y0 + 0.76, z] }, PIPE);
  kit.add(m.iron, { size: [0.035, 0.74, 0.035], position: [x, y0 + 0.37, z] }, PIPE);
  kit.add(m.iron, { size: [0.22, 0.03, 0.22], position: [x, y0 + 0.015, z] }, PIPE);
  const chairs = 2 + Math.floor(random() * 3);
  for (let i = 0; i < chairs; i++) {
    const a = i / chairs * Math.PI * 2 + random() * 0.5, cx = x + Math.cos(a) * 0.78, cz = z + Math.sin(a) * 0.78, ry = -a - Math.PI / 2;
    const back = [cx + Math.cos(a) * 0.2, cz + Math.sin(a) * 0.2];
    kit.add(m.cafeWood, { size: [0.42, 0.05, 0.42], position: [cx, y0 + 0.46, cz], rotation: [0, ry, 0] });
    kit.add(m.cafeWood, { size: [0.42, 0.42, 0.04], position: [back[0], y0 + 0.7, back[1]], rotation: [0, ry, 0] });
    for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
      const c = Math.cos(ry), s = Math.sin(ry);
      kit.add(m.iron, { size: [0.03, 0.46, 0.03], position: [cx + dx * c + dz * s, y0 + 0.23, cz - dx * s + dz * c] });
    }
  }
  return { minX: x - 1.05, maxX: x + 1.05, minZ: z - 1.05, maxZ: z + 1.05 };
}

/** White stone kerb-planter with chunky caps, filled with flowers and bougainvillea. */
export function addPlanter(root, kit, m, x0, z0, x1, z1, y0, seed, { palm = false } = {}) {
  const random = seededRandom(seed * 7 + 5), h = 0.72, t = 0.34;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  for (const [sx, sz, px, pz] of [[w, t, cx, z0 + t / 2], [w, t, cx, z1 - t / 2], [t, d - 2 * t, x0 + t / 2, cz], [t, d - 2 * t, x1 - t / 2, cz]]) {
    uvMesh(root, m.whiteStone, [sx, h, sz], [px, y0 + h / 2, pz], { tile: 2 });
    uvMesh(root, m.whiteStone, [sx + 0.12, 0.12, sz + 0.12], [px, y0 + h + 0.06, pz], { tile: 2 });
  }
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    kit.add(m.whiteStone, { size: [0.56, h + 0.2, 0.56], position: [px + Math.sign(cx - px) * 0.24, y0 + (h + 0.2) / 2, pz + Math.sign(cz - pz) * 0.24] });
    kit.add(m.whiteStone, { size: [0.66, 0.1, 0.66], position: [px + Math.sign(cx - px) * 0.24, y0 + h + 0.25, pz + Math.sign(cz - pz) * 0.24] });
  }
  kit.add(m.timber, { size: [w - 2 * t, 0.06, d - 2 * t], position: [cx, y0 + h - 0.12, cz] });
  const along = w > d, count = Math.max(1, Math.round(Math.max(w, d) / 2.2));
  for (let i = 0; i < count; i++) {
    const f = (i + 0.5) / count, px = along ? x0 + w * f : cx, pz = along ? cz : z0 + d * f;
    if (random() < 0.6) addBougainvillea(kit, m, px, y0 + h + 0.25, pz, along ? 1.9 : 1.1, 0.7, along ? 1.1 : 1.9, seed * 10 + i);
    else kit.add(random() < 0.5 ? m.flowersRed : m.flowersPink, { size: [0.9, 0.45, 0.9], position: [px, y0 + h + 0.05, pz], rotation: [0, random() * 6, 0] }, CLUMP);
  }
  if (palm) addPalm(kit, m, cx, cz, y0 + h - 0.1, seed);
  return { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
}

const catenary = (a, b, sag, n) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
});
function addLine(kit, m, points) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0, z0] = points[i], [x1, y1, z1] = points[i + 1], dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, h = Math.hypot(dx, dz);
    kit.add(m.line, { size: [Math.hypot(h, dy), 0.012, 0.012], position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], rotation: [0, Math.atan2(-dz, dx), Math.atan2(dy, h)] }, ROD);
  }
}
const BUNTING = ['#d8262f', '#f2c230', '#1f6fd1', '#2e9c4b', '#f4f1e8', '#e8692a', '#8b3fb5'];

/** Pennant bunting strung between two anchor points. */
export function addBunting(kit, m, a, b, seed, sag = 0.7) {
  const random = seededRandom(seed), span = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(4, Math.round(span / 0.62));
  const points = catenary(a, b, sag, n); addLine(kit, m, points);
  const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
  for (let i = 1; i < n; i++) kit.add(m.bunting, { size: [0.34, 0.44, 1], position: points[i], rotation: [0, yaw + (random() - 0.5) * 0.25, 0], color: BUNTING[(i + seed) % BUNTING.length] }, FLAG);
}
const LINEN = ['#ffffff', '#f4f1e8', '#7fa7d8', '#d84a4a', '#f2d36b', '#e9a3c0', '#9fd0b5'];

/** Washing line across a lane, with sheets and shirts pegged on. */
export function addWashing(kit, m, a, b, seed) {
  const random = seededRandom(seed), span = Math.hypot(b[0] - a[0], b[2] - a[2]), n = 8;
  const points = catenary(a, b, 0.22, n); addLine(kit, m, points);
  const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
  for (let t = 0.12 + random() * 0.1; t < 0.9; t += 0.12 + random() * 0.16) {
    const i = t * n, k = Math.min(n - 1, Math.floor(i)), f = i - k, p = points[k].map((v, j) => v + (points[k + 1][j] - v) * f);
    const width = 0.35 + random() * (span > 5 ? 0.55 : 0.3), height = 0.45 + random() * 0.55;
    kit.add(m.cloth, { size: [width, height, 0.02], position: [p[0], p[1] - height / 2, p[2]], rotation: [0, yaw, 0], color: LINEN[Math.floor(random() * LINEN.length)] });
  }
}

/** Black cast-iron lamp post with a lantern head. */
export function addLamp(kit, m, x, z, y0) {
  kit.add(m.iron, { size: [0.26, 0.6, 0.26], position: [x, y0 + 0.3, z] }, PIPE);
  kit.add(m.iron, { size: [0.08, 3.9, 0.08], position: [x, y0 + 2.4, z] }, PIPE);
  kit.add(m.iron, { size: [0.14, 0.12, 0.14], position: [x, y0 + 4.35, z] }, PIPE);
  kit.add(m.lanternGlass, { size: [0.36, 0.52, 0.36], position: [x, y0 + 4.7, z] });
  kit.add(m.iron, { size: [0.5, 0.1, 0.5], position: [x, y0 + 5.0, z] });
  kit.add(m.iron, { size: [0.3, 0.14, 0.3], position: [x, y0 + 5.11, z] });
  kit.add(m.iron, { size: [0.04, 0.24, 0.04], position: [x, y0 + 5.3, z] }, PIPE);
  for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) kit.add(m.iron, { size: [0.035, 0.56, 0.035], position: [x + dx, y0 + 4.7, z + dz] });
}

/** Slatted timber bench on iron frames, oriented along z. */
export function addBench(kit, m, x, z, y0) {
  for (const dx of [-0.2, 0, 0.2]) kit.add(m.cafeWood, { size: [0.14, 0.05, 3.3], position: [x + dx, y0 + 0.47, z] });
  kit.add(m.cafeWood, { size: [0.05, 0.36, 3.3], position: [x - 0.32, y0 + 0.78, z] });
  for (const dz of [-1.3, 1.3]) {
    kit.add(m.iron, { size: [0.6, 0.06, 0.08], position: [x, y0 + 0.43, z + dz] });
    for (const dx of [-0.24, 0.24]) kit.add(m.iron, { size: [0.06, 0.45, 0.08], position: [x + dx, y0 + 0.22, z + dz] });
    kit.add(m.iron, { size: [0.06, 0.5, 0.08], position: [x - 0.32, y0 + 0.7, z + dz], rotation: [0, 0, -0.12] });
  }
}

/** Flat-shaded potted geranium (no collider: always placed against a wall or in a planter). */
export function addPot(kit, m, x, z, y0, seed, scale = 1) {
  const random = seededRandom(seed);
  kit.add(m.terracotta, { size: [0.42 * scale, 0.55 * scale, 0.42 * scale], position: [x, y0 + 0.275 * scale, z] }, POT);
  kit.add(random() < 0.5 ? m.flowersRed : m.flowersPink, { size: [0.36 * scale, 0.34 * scale, 0.36 * scale], position: [x, y0 + 0.68 * scale, z], rotation: [0, random() * 6, 0] }, CLUMP);
  return { minX: x - 0.3 * scale, maxX: x + 0.3 * scale, minZ: z - 0.3 * scale, maxZ: z + 0.3 * scale };
}
