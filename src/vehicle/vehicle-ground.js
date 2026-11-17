import * as THREE from 'three';
import { STREET_Y, CITY_BOUNDS, CITY_ROADS, PEDESTRIAN_ZONE } from '../city-layout.js';

/**
 * The drivable ground of the street district, built from the *rendered* static surfaces, so the physics surface and
 * what is drawn are the same triangles (asphalt, kerbs, rounded corners, pavements, bridges, squares).
 * Obstacles reuse the district's existing collider grid; only vehicle-specific limits are added here:
 * the old-town pedestrian zone (behind its bollard rows) and the district edge.
 */
const CELL = 4, KEY = (i, j) => i * 65536 + j;
const GRIP = { asphalt: 1, kerb: 0.95, sidewalk: 0.92, paving: 0.86, road: 0.86, brick: 0.85, whiteStone: 0.85, stone: 0.85, baseStone: 0.85, grass: 0.55, lawn: 0.55, durrie: 0.7 };

export class VehicleGround {
  constructor(surfaceWorld) {
    this.surface = surfaceWorld; this.stamp = 0; this.extra = [];
    this.build();
  }

  build() {
    const s = this.surface, names = new Map(Object.entries(s.materials).filter(([, v]) => v?.isMaterial).map(([k, v]) => [v, k]));
    if (s.downtown) for (const [k, v] of Object.entries(s.downtown)) if (v?.isMaterial && !names.has(v)) names.set(v, k);
    s.district.updateWorldMatrix(true, true);
    const tris = [], grips = [], v = new THREE.Vector3();
    s.district.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible && o !== s.district) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, grip = GRIP[names.get(o.material)] ?? 0.85;
      const n = idx ? idx.count : pos.count, p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let i = 0; i < n; i += 3) {
        for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld);
        const [a, b, c] = p, top = Math.max(a.y, b.y, c.y), bottom = Math.min(a.y, b.y, c.y);
        if (top > STREET_Y + 0.25 || bottom < STREET_Y - 0.5) continue;
        const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(d) < 1e-9) continue; // vertical faces
        // Upward-facing only (normal y > 0.5).
        v.set(0, 0, 0); const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (Math.abs(ny) < 0.5 * Math.hypot(nx, ny, nz)) continue;
        tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, 1 / d); grips.push(grip);
      }
    });
    this.tris = new Float64Array(tris); this.grips = new Float32Array(grips);
    const count = grips.length, cells = new Map();
    for (let t = 0; t < count; t++) {
      const o = t * 10, xs = [this.tris[o], this.tris[o + 3], this.tris[o + 6]], zs = [this.tris[o + 2], this.tris[o + 5], this.tris[o + 8]];
      for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
        for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) {
          const key = KEY(i, j); if (!cells.has(key)) cells.set(key, []); cells.get(key).push(t);
        }
    }
    this.cells = new Map([...cells].map(([k, list]) => [k, Int32Array.from(list)]));
    this.triangleCount = count;
    this.buildLimits();
  }

  /** Vehicle-only limits: district edge walls and the old-town pedestrian zone minus its through-road corridors. */
  buildLimits() {
    const b = CITY_BOUNDS, e = [];
    e.push({ minX: b.minX - 10, maxX: b.minX, minZ: b.minZ - 10, maxZ: b.maxZ + 10 }, { minX: b.maxX, maxX: b.maxX + 10, minZ: b.minZ - 10, maxZ: b.maxZ + 10 },
      { minX: b.minX - 10, maxX: b.maxX + 10, minZ: b.minZ - 10, maxZ: b.minZ }, { minX: b.minX - 10, maxX: b.maxX + 10, minZ: b.maxZ, maxZ: b.maxZ + 10 });
    // The zone edge sits 0.7 m inside the old town, so the bollard rows (0.5 m beyond each road end) stop the car first.
    const a = PEDESTRIAN_ZONE.area, zone = { minX: a.minX + 0.7, maxX: a.maxX - 0.7, minZ: a.minZ + 0.7, maxZ: a.maxZ };
    const corridors = CITY_ROADS.filter(r => PEDESTRIAN_ZONE.throughRoads.includes(r.name)).map(r => { const h = r.width / 2 + r.walk;
      return r.axis === 'x' ? { minX: r.from, maxX: r.to, minZ: r.c - h, maxZ: r.c + h } : { minX: r.c - h, maxX: r.c + h, minZ: r.from, maxZ: r.to }; });
    const xs = [...new Set([zone.minX, zone.maxX, ...corridors.flatMap(c => [c.minX, c.maxX])])].filter(x => x >= zone.minX && x <= zone.maxX).sort((p, q) => p - q);
    const zs = [...new Set([zone.minZ, zone.maxZ, ...corridors.flatMap(c => [c.minZ, c.maxZ])])].filter(z => z >= zone.minZ && z <= zone.maxZ).sort((p, q) => p - q);
    for (let j = 0; j < zs.length - 1; j++) {
      let run = null;
      for (let i = 0; i < xs.length - 1; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
        const blocked = !corridors.some(c => cx > c.minX && cx < c.maxX && cz > c.minZ && cz < c.maxZ);
        if (blocked) run = run ? { ...run, maxX: xs[i + 1] } : { minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1], zone: true };
        else if (run) { e.push(run); run = null; }
      }
      if (run) e.push(run);
    }
    this.extra = e;
    this.zoneRects = e.filter(r => r.zone);
  }

  /** Top rendered surface height at (x, z), or null where there is no ground (canal, stair shaft). */
  heightAt(x, z) {
    const list = this.cells.get(KEY(Math.floor(x / CELL), Math.floor(z / CELL))); if (!list) return null;
    let best = -Infinity; const T = this.tris;
    for (let n = 0; n < list.length; n++) {
      const o = list[n] * 10, ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8], inv = T[o + 9];
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) * inv; if (l1 < -1e-7) continue;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) * inv; if (l2 < -1e-7) continue;
      const l3 = 1 - l1 - l2; if (l3 < -1e-7) continue;
      const y = l1 * ay + l2 * by + l3 * cy; if (y > best) { best = y; this.lastTriangle = list[n]; }
    }
    return best === -Infinity ? null : best;
  }

  gripAt(x, z) { return this.heightAt(x, z) === null ? 1 : this.grips[this.lastTriangle]; }

  /** Every solid obstacle overlapping the box, each reported once. */
  forEachCollider(minX, minZ, maxX, maxZ, callback) {
    const s = this.surface, cell = 16, stamp = ++this.stamp;
    if (s.indexedCount !== s.colliders.length) s.indexColliders();
    for (let i = Math.floor(minX / cell); i <= Math.floor(maxX / cell); i++) for (let j = Math.floor(minZ / cell); j <= Math.floor(maxZ / cell); j++) {
      const list = s.colliderGrid.get(i * 4096 + j); if (!list) continue;
      for (const r of list) if (r.__vehicleStamp !== stamp && r.maxX >= minX && r.minX <= maxX && r.maxZ >= minZ && r.minZ <= maxZ) { r.__vehicleStamp = stamp; callback(r); }
    }
    for (const r of this.extra) if (r.maxX >= minX && r.minX <= maxX && r.maxZ >= minZ && r.minZ <= maxZ) callback(r);
  }

  /** True when a footprint position is legal for a parked or recovered car. */
  isClear(x, z, radius = 2.6) {
    let clear = this.heightAt(x, z) !== null;
    this.forEachCollider(x - radius, z - radius, x + radius, z + radius, () => { clear = false; });
    return clear;
  }
}
