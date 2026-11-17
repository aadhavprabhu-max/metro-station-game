// Road geometry audit (headless; no browser). Builds the complete street district with the
// same stubs as tests/surface-geometry.mjs, then probes the rendered road surfaces.
//
//   node tests/road-geometry.mjs            # exits 1 when any check fails
//   ROAD_REPORT=out.json node tests/road-geometry.mjs
//
// Checks: carriageway holes, foreign surfaces on carriageways, coplanar (z-fighting) surfaces,
// obstacles inside carriageways, preserved cross-section elevations, road-bridge decks and,
// when the vehicle ground model exists, agreement between rendered and drivable heights.
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const context = new Proxy({}, { get: (t, k) => k in t ? t[k] : k === 'measureText' ? s => ({ width: s.length * 12 }) : () => {} });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { createMaterials } = await import('../src/materials.js');
const { createPhase6Network } = await import('../src/phase6-network.js');
const { addU10ToNetwork } = await import('../src/u10-network.js');
const { MetroRoute } = await import('../src/route.js');
const { NetworkLineWorld } = await import('../src/network-world.js');
const { SurfaceWorld } = await import('../src/surface-world.js');
const { CITY_ROADS, STREET_Y } = await import('../src/city-layout.js');

const network = createPhase6Network(); addU10ToNetwork(network);
const materials = createMaterials(), scene = new THREE.Group();
const route = new MetroRoute(network, 'U4'); route.surfaceExitEnabled = true;
const u4 = new NetworkLineWorld(materials, route); scene.add(u4); scene.updateMatrixWorld(true);
const surface = new SurfaceWorld(materials, u4.central); surface.finishBuild(); scene.add(surface); scene.updateMatrixWorld(true);
const nameOf = new Map(Object.entries(surface.materials).filter(([, v]) => v?.isMaterial).map(([k, v]) => [v, k]));

// Upward-facing ground triangles near street level, indexed in an 8 m grid (merged batches are large).
const CELL = 8, grid = new Map(), v = new THREE.Vector3();
surface.district.traverse(o => {
  if (!o.isMesh || o.isInstancedMesh) return;
  const pos = o.geometry.attributes.position, idx = o.geometry.index, name = nameOf.get(o.material) ?? o.material.name ?? '?';
  const n = idx ? idx.count : pos.count, get = i => v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld).clone();
  for (let i = 0; i < n; i += 3) {
    const a = get(i), b = get(i + 1), c = get(i + 2);
    if (Math.max(a.y, b.y, c.y) > STREET_Y + 0.2 || Math.min(a.y, b.y, c.y) < STREET_Y - 0.5) continue;
    if (Math.abs((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)) < 1e-9) continue; // vertical faces
    const t = [a, b, c, name];
    for (let gi = Math.floor(Math.min(a.x, b.x, c.x) / CELL); gi <= Math.floor(Math.max(a.x, b.x, c.x) / CELL); gi++)
      for (let gj = Math.floor(Math.min(a.z, b.z, c.z) / CELL); gj <= Math.floor(Math.max(a.z, b.z, c.z) / CELL); gj++) {
        const k = gi * 100000 + gj; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t);
      }
  }
});
/** Rendered surfaces under (x, z), highest first. */
export function probe(x, z) {
  const out = [];
  for (const [a, b, c, m] of grid.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)) ?? []) {
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d, l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d, l3 = 1 - l1 - l2;
    if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) out.push({ y: l1 * a.y + l2 * b.y + l3 * c.y, m });
  }
  out.sort((p, q) => q.y - p.y);
  const uniq = []; for (const h of out) if (!uniq.length || Math.abs(uniq.at(-1).y - h.y) > 1e-5 || uniq.at(-1).m !== h.m) uniq.push(h);
  return uniq;
}

const failures = [], report = { checks: {} };
const fail = (check, detail) => failures.push({ check, ...detail });
const inCanal = (x, z) => z > -339 && z < -328 && !surface.bridges.some(br => x > br.minX && x < br.maxX);
const carriageway = road => { const w = road.width / 2; return road.axis === 'x'
  ? { minX: road.from, maxX: road.to, minZ: road.c - w, maxZ: road.c + w } : { minX: road.c - w, maxX: road.c + w, minZ: road.from, maxZ: road.to }; };
const ROAD_TOPS = new Set(['asphalt']);

// 1-3. Holes, foreign surfaces and coplanar overlaps on every carriageway (centre and both wheel tracks).
let samples = 0;
for (const road of CITY_ROADS) for (let a = road.from + 1; a < road.to - 1; a += 2) for (const b of [0, road.width / 2 - 0.6, -(road.width / 2 - 0.6)]) {
  const [x, z] = road.axis === 'x' ? [a, road.c + b] : [road.c + b, a];
  if (inCanal(x, z)) continue;
  samples++;
  const h = probe(x, z);
  if (!h.length) { fail('carriageway-hole', { road: road.name, x: +x.toFixed(2), z: +z.toFixed(2) }); continue; }
  if (!ROAD_TOPS.has(h[0].m)) fail('foreign-surface-on-carriageway', { road: road.name, x: +x.toFixed(2), z: +z.toFixed(2), surface: h[0].m, aboveAsphalt: +(h[0].y - STREET_Y - 0.016).toFixed(4) });
  if (h.length > 1 && h[0].y - h[1].y < 0.0015 && h[0].m !== h[1].m) fail('coplanar-surfaces', { road: road.name, x: +x.toFixed(2), z: +z.toFixed(2), a: h[0].m, b: h[1].m });
}
report.checks.carriagewaySamples = samples;

// 4. Obstacles (solid colliders) inside a carriageway, including the kerb strip, are never acceptable.
let obstacleCount = 0;
for (const r of surface.colliders) {
  if (r.maxX - r.minX > 200 || r.maxZ - r.minZ > 200) continue; // district edge walls
  for (const road of CITY_ROADS) {
    const c = carriageway(road), ox = Math.min(r.maxX, c.maxX) - Math.max(r.minX, c.minX), oz = Math.min(r.maxZ, c.maxZ) - Math.max(r.minZ, c.minZ);
    if (ox > 0.02 && oz > 0.02) { obstacleCount++; fail('obstacle-in-carriageway', { road: road.name, collider: [r.minX, r.minZ, r.maxX, r.maxZ].map(n => +n.toFixed(2)), intrusion: +Math.min(ox, oz).toFixed(2) }); }
  }
}
report.checks.obstaclesInCarriageways = obstacleCount;

// 5. Preserved cross-section: asphalt +16 mm, kerb +70 mm, sidewalk +16 mm (pavement elevations are not changed).
const profiles = [];
for (const [name, a] of [['BROADWAY NORTH', 140], ['VIA DEL CORSO', -60], ['MERCATO AVENUE', -600], ['MIDTOWN STREET', 140]]) {
  const r = CITY_ROADS.find(o => o.name === name), w = r.width / 2;
  const at = b => r.axis === 'x' ? [a, r.c + b] : [r.c + b, a], top = b => probe(...at(b))[0];
  const got = { asphalt: top(w - 1), kerb: top(w + 0.11), sidewalk: top(w + r.walk / 2) };
  const expect = { asphalt: ['asphalt', 0.016], kerb: ['kerb', 0.07], sidewalk: ['sidewalk', 0.016] };
  for (const [k, [m, y]] of Object.entries(expect)) if (!got[k] || got[k].m !== m || Math.abs(got[k].y - STREET_Y - y) > 0.0005)
    fail('cross-section', { road: name, at: a, part: k, expected: `${m}@+${y}`, got: got[k] ? `${got[k].m}@+${(got[k].y - STREET_Y).toFixed(4)}` : 'none' });
  profiles.push({ road: name, at: a, ...Object.fromEntries(Object.entries(got).map(([k, h]) => [k, h ? `${h.m}@+${(h.y - STREET_Y).toFixed(3)}` : 'none'])) });
}
report.checks.crossSections = profiles;

// 6. Road bridges: continuous asphalt across the canal on both avenues.
for (const x of [-230, 200]) for (let z = -342; z <= -325; z += 0.5) for (const dx of [-5, 0, 5]) {
  const h = probe(x + dx, z);
  if (!h.length || h[0].m !== 'asphalt') fail('bridge-deck', { x: x + dx, z, got: h[0]?.m ?? 'none' });
}

// 7. Rendered versus drivable heights (only once the vehicle ground model exists).
if (surface.vehicleGround) {
  const g = surface.vehicleGround; let n = 0, worst = 0, worstAt = null;
  for (let x = -305; x < 276; x += 1.37) for (let z = -645; z < 80; z += 1.37) {
    const h = probe(x, z)[0]; if (!h || h.y < STREET_Y - 0.01) continue;
    const y = g.heightAt(x, z); if (y === null) continue;
    n++; const e = Math.abs(y - h.y); if (e > worst) { worst = e; worstAt = { x: +x.toFixed(2), z: +z.toFixed(2), rendered: h.m, renderedY: +(h.y - STREET_Y).toFixed(4), groundY: +(y - STREET_Y).toFixed(4) }; }
    if (e > 0.002) fail('render-vs-ground-height', { x: +x.toFixed(2), z: +z.toFixed(2), rendered: h.m, error: +e.toFixed(4) });
  }
  report.checks.groundAgreement = { samples: n, worstErrorM: +worst.toFixed(4), worstAt };
}

// Extra checks registered by later stages (kerb corners, pedestrian-zone bollards) live beside the road builder.
if (surface.roadSurface?.selfCheck) for (const f of surface.roadSurface.selfCheck(probe)) fail(f.check, f);

const byCheck = {}; for (const f of failures) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
Object.assign(report, { failureCount: failures.length, failuresByCheck: byCheck, failures: failures.slice(0, 60) });
if (process.env.ROAD_REPORT) await writeFile(process.env.ROAD_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length ? 1 : 0;
