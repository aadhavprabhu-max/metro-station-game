import * as THREE from 'three';
import { instances, seededRandom } from './geometry.js';

const UP = new THREE.Vector3(0, 1, 0);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
const sphere = new THREE.SphereGeometry(1, 7, 5);
const geometries = new Map();
/** Curved leaf with a raised midrib and species-specific outline: actual 3D, no image planes. */
function leafGeometry(species, rows = 9) {
  const key = `${species}-${rows}`;
  if (geometries.has(key)) return geometries.get(key);
  const vertices = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    let width = Math.pow(Math.sin(Math.PI * t), 0.8) * 0.5;
    if (species === 'oak') width *= 0.74 + 0.26 * Math.cos(t * Math.PI * 10);
    if (species === 'fern') width *= 0.32;
    if (species === 'grass') width *= 0.13;
    for (const side of [-1, 0, 1]) vertices.push(side * width, Math.sin(t * Math.PI) * (side ? 0.035 : 0.12) + t * t * 0.2, t);
    if (row < rows) { const a = row * 3; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometries.set(key, geometry); return geometry;
}
function member(a, b, radius) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
  return { position: from.add(to).multiplyScalar(0.5).toArray(), size: [radius, delta.length(), radius * 0.85],
    rotation: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, delta.normalize())).toArray().slice(0, 3) };
}
const color = (random, shade = 0) => new THREE.Color().setHSL(0.23 + random() * 0.1, 0.28 + random() * 0.24, 0.2 + shade + random() * 0.16);

/** Batched botanical species with deterministic, individually varied branching and foliage. */
export class BotanicalVegetation extends THREE.Group {
  constructor(seed = 710) {
    super(); this.name = 'LivingBotanicalCollection'; this.random = seededRandom(seed);
    this.branches = []; this.leaves = { oak: [], magnolia: [], fern: [], grass: [] }; this.petals = []; this.flowers = []; this.species = new Set();
    this.userData.actual3DPlants = true; this.treeCount = 0;
  }
  tree(x, y, z, height = 12, species = 'oak') {
    const r = this.random; this.treeCount++; this.species.add(species === 'oak' ? 'Quercus robur' : 'Magnolia grandiflora');
    const trunkTop = height * 0.62, leanX = (r() - 0.5) * 1.1, leanZ = (r() - 0.5) * 0.8;
    this.branches.push(member([x, y, z], [x + leanX, y + trunkTop, z + leanZ], height * 0.022));
    for (let root = 0; root < 6; root++) {
      const angle = root / 6 * Math.PI * 2;
      this.branches.push(member([x + Math.cos(angle) * 0.9, y + 0.08, z + Math.sin(angle) * 0.9], [x, y + 1.0, z], 0.12));
    }
    for (let branch = 0; branch < 18; branch++) {
      const angle = branch * 2.399 + r() * 0.5, length = height * (0.2 + r() * 0.13);
      const start = [x + leanX * 0.7, y + height * (0.38 + branch / 18 * 0.24), z + leanZ * 0.7];
      const end = [x + Math.cos(angle) * length, y + height * (0.64 + r() * 0.29), z + Math.sin(angle) * length];
      this.branches.push(member(start, end, 0.06 + (18 - branch) * 0.006));
      for (let twig = 0; twig < 5; twig++) {
        const tip = [end[0] + (r() - 0.5) * 2.3, end[1] + r() * 1.6, end[2] + (r() - 0.5) * 2.3];
        this.branches.push(member(end, tip, 0.025));
        for (let leaf = 0; leaf < 32; leaf++) {
          const t = r(), spread = 2.1;
          const size = species === 'oak' ? 0.32 + r() * 0.24 : 0.4 + r() * 0.25;
          this.leaves[species].push({ position: [THREE.MathUtils.lerp(end[0], tip[0], t) + (r() - 0.5) * spread,
            THREE.MathUtils.lerp(end[1], tip[1], t) + (r() - 0.5) * spread,
            THREE.MathUtils.lerp(end[2], tip[2], t) + (r() - 0.5) * spread],
          size: [size, size, size], rotation: [(r() - 0.5) * 1.4, r() * 6.28, (r() - 0.5) * 1.2], color: color(r, 0.035) });
        }
      }
    }
  }
  conifer(x, y, z, height = 11) {
    const r = this.random; this.species.add('Picea abies'); this.treeCount++;
    this.branches.push(member([x, y, z], [x, y + height, z], 0.17));
    for (let tier = 0; tier < 13; tier++) for (let b = 0; b < 7; b++) {
      const t = tier / 13, a = b * Math.PI * 2 / 7 + tier * 0.3, reach = (1 - t) * height * 0.28;
      const start = [x, y + 1.1 + t * (height - 1.1), z];
      const end = [x + Math.cos(a) * reach, start[1] - reach * 0.22, z + Math.sin(a) * reach];
      this.branches.push(member(start, end, 0.025));
      for (let k = 0; k < 18; k++) {
        const f = k / 18; this.leaves.fern.push({ position: [THREE.MathUtils.lerp(start[0], end[0], f), THREE.MathUtils.lerp(start[1], end[1], f), THREE.MathUtils.lerp(start[2], end[2], f)],
          size: [0.45, 0.45, 0.5], rotation: [-0.3, a + (k % 2 ? -0.9 : 0.9), 0], color: color(r, -0.03) });
      }
    }
  }
  fern(x, y, z, scale = 1) {
    this.species.add('Dryopteris filix-mas');
    for (let frond = 0; frond < 9; frond++) {
      const angle = frond * 2.399, length = scale * (0.85 + this.random() * 0.45);
      const tip = [x + Math.sin(angle) * length, y + scale * 0.65, z + Math.cos(angle) * length];
      this.branches.push(member([x, y, z], tip, 0.009));
      for (let k = 1; k <= 12; k++) for (const side of [-1, 1]) {
        const t = k / 13, width = Math.sin(t * Math.PI) * scale * 0.38;
        this.leaves.fern.push({ position: [THREE.MathUtils.lerp(x, tip[0], t), y + scale * 0.65 * t, THREE.MathUtils.lerp(z, tip[2], t)],
          size: [width * 1.5, width, width], rotation: [-0.2, angle + side * 1.1, side * 0.15], color: color(this.random, 0.06) });
      }
    }
  }
  shrub(x, y, z, scale = 1, flowering = true) {
    const r = this.random; this.species.add(flowering ? 'Rhododendron' : 'Buxus sempervirens');
    for (let shoot = 0; shoot < 15; shoot++) {
      const a = r() * 6.28, reach = r() * scale * 0.65, top = [x + Math.cos(a) * reach, y + scale * (0.5 + r() * 0.6), z + Math.sin(a) * reach];
      this.branches.push(member([x, y, z], top, 0.014));
      for (let k = 0; k < 12; k++) this.leaves.magnolia.push({ position: [top[0] + (r() - 0.5) * scale * 0.5, top[1] - r() * scale * 0.5, top[2] + (r() - 0.5) * scale * 0.5],
        size: [0.2 * scale, 0.2 * scale, 0.3 * scale], rotation: [r(), r() * 6.28, r()], color: color(r) });
      if (flowering && shoot % 2 === 0) this.flower(...top, 0.13 * scale, r() > 0.5 ? '#d995b6' : '#f4e6bc');
    }
  }
  flower(x, y, z, size, tint) {
    this.species.add('Echinacea purpurea');
    for (let petal = 0; petal < 7; petal++) {
      const a = petal / 7 * 6.28;
      this.petals.push({ position: [x, y, z], size: [size * 0.65, size * 0.7, size * 1.1], rotation: [-0.1, a, 0.2], color: tint });
    }
    this.flowers.push({ position: [x, y + 0.025, z], size: [size * 0.23, size * 0.17, size * 0.23], color: '#d6aa48' });
  }
  grasses(x, y, z, scale = 1) {
    const r = this.random; this.species.add('Miscanthus sinensis');
    for (let k = 0; k < 26; k++) {
      const h = scale * (0.6 + r() * 0.8);
      this.leaves.grass.push({ position: [x + (r() - 0.5) * 0.45 * scale, y, z + (r() - 0.5) * 0.45 * scale],
        size: [h, h, h], rotation: [-1.0 - r() * 0.4, r() * 6.28, 0], color: color(r, 0.08) });
    }
  }
  vine(x, y, z, height = 9, hanging = false) {
    this.species.add('Hedera helix'); const r = this.random;
    for (let i = 0; i < height * 7; i++) {
      const t = i / (height * 7), yy = y + (hanging ? -1 : 1) * t * height;
      const xx = x + Math.sin(t * 12) * 0.3, zz = z + Math.cos(t * 12) * 0.15;
      this.branches.push(member([xx, yy, zz], [x + Math.sin((t + 1 / (height * 7)) * 12) * 0.3, yy + (hanging ? -1 : 1) / 7, zz], 0.013));
      for (const side of [-1, 1]) this.leaves.oak.push({ position: [xx + side * 0.13, yy, zz], size: [0.28, 0.28, 0.3], rotation: [-0.5, side * 1.5 + r(), r() * 0.5], color: color(r, 0.04) });
    }
  }
  finish() {
    const bark = new THREE.MeshStandardMaterial({ color: '#74634d', roughness: 1 });
    const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.86, side: THREE.DoubleSide });
    if (this.branches.length) instances(this, bark, this.branches, cylinder).name = 'TrunksBranchesPetioleGeometry';
    for (const [species, entries] of Object.entries(this.leaves)) if (entries.length) {
      // Spatially grouped LOD preserves leaf curvature even in the distant representation.
      const cells = new Map();
      for (const entry of entries) {
        const key = `${Math.floor(entry.position[0] / 22)},${Math.floor(entry.position[2] / 22)}`;
        if (!cells.has(key)) cells.set(key, []); cells.get(key).push(entry);
      }
      for (const [key, leaves] of cells) {
        const [cx, cz] = key.split(',').map(Number), center = new THREE.Vector3(cx * 22 + 11, 5, cz * 22 + 11);
        const lod = new THREE.LOD(); lod.position.copy(center); lod.name = `LivingFoliageLOD-${species}`;
        const detailed = instances(new THREE.Group(), leaf, leaves, leafGeometry(species, 7), false);
        detailed.position.copy(center).negate(); detailed.name = `Curved3DLeaves-${species}`;
        lod.addLevel(detailed, 0);
        for (const [distance, rows] of [[32, 3], [85, 2]]) {
          const mesh = new THREE.InstancedMesh(leafGeometry(species, rows), leaf, leaves.length);
          mesh.instanceMatrix = detailed.instanceMatrix; mesh.instanceColor = detailed.instanceColor;
          mesh.position.copy(detailed.position); mesh.name = `Curved3DLeaves-${species}-LOD${rows}`;
          mesh.computeBoundingSphere(); lod.addLevel(mesh, distance);
        }
        this.add(lod);
      }
    }
    if (this.petals.length) instances(this, leaf, this.petals, leafGeometry('magnolia'), false).name = 'ModelledFlowerPetals';
    if (this.flowers.length) instances(this, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), this.flowers, sphere, false).name = 'FlowerCentres';
    this.userData.species = [...this.species]; this.userData.treeCount = this.treeCount;
    this.userData.leafCount = Object.values(this.leaves).reduce((n, list) => n + list.length, 0);
    // CPU placement arrays are no longer needed once instance buffers own the data.
    this.branches = []; this.leaves = { oak: [], magnolia: [], fern: [], grass: [] }; this.petals = []; this.flowers = [];
    return this;
  }
}
