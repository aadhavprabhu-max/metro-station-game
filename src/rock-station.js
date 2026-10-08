import * as THREE from 'three';
import { Station } from './station.js';
import { box, cylinder, instances, canvasTexture, seededRandom } from './geometry.js';

const HALL_PROFILE = [
  [-10.8, -1.65], [-10.85, 1.0], [-10.55, 3.65], [-9.4, 5.25],
  [-6.3, 5.9], [-2.6, 6.35], [1.5, 5.95], [5.0, 5.8],
  [7.8, 4.95], [8.6, 3.4], [8.55, 0.2], [8.6, -1.65],
  [2.5, -1.65], [-4.5, -1.65],
];
const PORTAL_PROFILE = [
  [-0.56, -1.65], [-0.56, 0.0], [-0.56, 2.5], [-0.32, 3.82],
  [0.7, 4.25], [1.65, 4.39], [2.75, 4.39], [4.0, 4.25],
  [5.08, 3.82], [5.32, 2.5], [5.32, 0.0], [5.32, -1.65],
  [3.3, -1.65], [1.0, -1.65],
];

function lattice(x, y) {
  let value = Math.imul(x ^ 0x51ed270b, 374761393) + Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const sx = x - ix, sy = y - iy;
  const ux = sx * sx * (3 - 2 * sx), uy = sy * sy * (3 - 2 * sy);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(lattice(ix, iy), lattice(ix + 1, iy), ux),
    THREE.MathUtils.lerp(lattice(ix, iy + 1), lattice(ix + 1, iy + 1), ux), uy,
  );
}

function profilePoint(profile, fraction) {
  const along = fraction * profile.length;
  const index = Math.floor(along) % profile.length;
  const next = (index + 1) % profile.length;
  return new THREE.Vector2(...profile[index]).lerp(new THREE.Vector2(...profile[next]), along - Math.floor(along));
}

/** A single continuous, inward-facing cave shell. Its bottom is below the rail bed. */
export function createRockShellGeometry() {
  const sections = [-50, -49, -47.5, -46, -45];
  for (let z = -44; z < 44; z += 1) sections.push(z);
  sections.push(44, 45, 46, 47.5, 49, 50);
  const around = 72;
  const positions = [], colors = [], uvs = [], indices = [];
  const charcoal = new THREE.Color('#303533');
  const grey = new THREE.Color('#747b77');
  const brown = new THREE.Color('#6b5d50');
  const mineral = new THREE.Color('#b1ada0');
  const color = new THREE.Color();
  let minHallRoof = Infinity, maxHallRoof = -Infinity;
  let minHallWallX = Infinity, maxHallWallX = -Infinity;

  sections.forEach((z, row) => {
    const transition = THREE.MathUtils.smoothstep(Math.abs(z), 44, 50);
    const deformation = 1 - transition;
    for (let column = 0; column <= around; column++) {
      const fraction = (column % around) / around;
      const hall = profilePoint(HALL_PROFILE, fraction);
      const portal = profilePoint(PORTAL_PROFILE, fraction);
      const point = hall.clone().lerp(portal, transition);
      const before = profilePoint(HALL_PROFILE, (fraction + 1 - 0.005) % 1);
      const after = profilePoint(HALL_PROFILE, (fraction + 0.005) % 1);
      const tangent = after.sub(before).normalize();
      const inward = new THREE.Vector2(tangent.y, -tangent.x);
      const roof = THREE.MathUtils.smoothstep(hall.y, 3.6, 5.0);
      const broad = (noise(fraction * 9.8 + 11, z * 0.18 + 19) - 0.5) * (0.85 + roof * 1.6);
      const layerPhase = hall.y * 4.4 + hall.x * 0.12 + z * 0.09 + noise(fraction * 5, z * 0.06) * 2.1;
      const strata = Math.sin(layerPhase) * (0.2 + roof * 0.13);
      // Broad ridged lobes and their recessed joints give the rock volume. This
      // remains coherent across rings instead of scattering spiky boulders.
      const ridgeNoise = noise(fraction * 25 + 3, z * 0.55 + 6);
      const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
      const ridges = (ridge - 0.5) * (0.5 + roof * 0.48);
      const displacement = broad + strata + ridges;
      const floor = fraction >= 11 / HALL_PROFILE.length;
      if (!floor) point.addScaledVector(inward, displacement * deformation);
      // U1's preserved Rosenheimer hall is immediately east of the rock hall.
      // Keep the entire geological envelope on its own side of the wall.
      point.x = Math.max(point.x, -11.38);
      // The safe platform and train clearance stay unchanged. Upper shoulders
      // may overhang, while rock at walking height remains outside the bounds.
      if (Math.abs(z) <= 44) {
        if (hall.x < -9.5 && hall.y < 4.6) point.x = Math.min(point.x, -10.2);
        if (hall.x > 7.7 && hall.y < 4.6) point.x = Math.max(point.x, 8.1);
        if (hall.y > 4.6) point.y = Math.max(point.y, 4.7);
        if (hall.y > 4.6) {
          minHallRoof = Math.min(minHallRoof, point.y);
          maxHallRoof = Math.max(maxHallRoof, point.y);
        }
        if (hall.y < 3.8 && hall.x < -9.5) minHallWallX = Math.min(minHallWallX, point.x);
        if (hall.y < 3.8 && hall.x > 7.7) maxHallWallX = Math.max(maxHallWallX, point.x);
      }
      positions.push(point.x, point.y, z);
      const variation = noise(fraction * 19 + 7, z * 0.21 + 4);
      color.copy(charcoal).lerp(grey, 0.18 + variation * 0.73);
      color.lerp(brown, THREE.MathUtils.smoothstep(noise(fraction * 8, z * 0.12), 0.6, 0.85) * 0.3);
      const seam = Math.abs(Math.sin(layerPhase * 0.46 + noise(fraction * 11, z * 0.28) * 0.8));
      if (seam < 0.18) color.lerp(mineral, (0.18 - seam) * 2.7);
      const recess = THREE.MathUtils.clamp(-displacement, 0, 1);
      color.multiplyScalar((0.87 + ridge * 0.24) * (1 - recess * 0.42));
      colors.push(color.r, color.g, color.b);
      uvs.push(fraction * 5, z / 13);
      if (row < sections.length - 1 && column < around) {
        const a = row * (around + 1) + column;
        const b = a + 1, c = a + around + 1, d = c + 1;
        // Profile order and these windings point normals into the railway hall.
        indices.push(a, b, c, b, d, c);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The duplicated UV seam needs matching normals, while retaining its UVs.
  const normals = geometry.getAttribute('normal');
  const average = new THREE.Vector3();
  for (let row = 0; row < sections.length; row++) {
    const first = row * (around + 1), last = first + around;
    average.set(normals.getX(first) + normals.getX(last), normals.getY(first) + normals.getY(last), normals.getZ(first) + normals.getZ(last)).normalize();
    normals.setXYZ(first, average.x, average.y, average.z);
    normals.setXYZ(last, average.x, average.y, average.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { proceduralRock: true, portalOffset: 50, minHallRoof, maxHallRoof, minHallWallX, maxHallWallX, ringCount: sections.length, ringSegments: around };
  return geometry;
}

function rockMaterials(base) {
  const materials = { ...base };
  for (const [name, color] of Object.entries({ tile: '#282d2b', grout: '#171d1b', concrete: '#383e3b', greenTile: '#3d4340' })) {
    materials[name] = base[name].clone();
    materials[name].color.set(color);
  }
  materials.tile.roughness = 0.44;
  materials.rock = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.97, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  const random = seededRandom(4051);
  const grain = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#efeeea'; ctx.fillRect(0, 0, w, h);
    for (let index = 0; index < 6500; index++) {
      const shade = Math.floor(166 + random() * 78);
      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.22)`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
    for (let index = 0; index < 45; index++) {
      const x = random() * w, y = random() * h;
      ctx.strokeStyle = 'rgba(92,88,79,0.18)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + 3 + random() * 10, y + random() * 4);
      ctx.lineTo(x + 10 + random() * 15, y - 2 + random() * 5);
      ctx.stroke();
    }
  });
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  materials.rock.map = grain;
  materials.rock.bumpMap = grain;
  materials.rock.bumpScale = 0.045;
  return materials;
}

/** Flat, safe railway infrastructure surrounded by excavated natural rock. */
export class RockStation extends Station {
  constructor(materials, options = {}) {
    super(rockMaterials(materials), {
      id: 'u2-schwarzkopf', displayName: 'Schwarzkopf-Tunnel', lineId: 'U2',
      lineName: 'THE INDUSTRIAL LINE', platformNumber: '02',
      signageColor: '#845643', northCap: false, southCap: false, ...options,
    });
    this.theme = 'rock';
    this.portalOffset = 50;
    this.lightingOptions = {
      fixtures: false, pointLights: 4,
      pointDefinitions: [
        { position: [-5.5, 4.25, -29], color: '#e4e9e7', intensity: 95, distance: 27 },
        { position: [3.7, 4.3, -8], color: '#eee6d9', intensity: 95, distance: 26 },
        { position: [-5.5, 4.25, 12], color: '#e4e9e7', intensity: 95, distance: 27 },
        { position: [3.7, 4.3, 33], color: '#eee6d9', intensity: 95, distance: 26 },
      ],
    };
  }

  buildArchitecture(m) {
    const geometry = createRockShellGeometry();
    const shell = new THREE.Mesh(geometry, m.rock);
    shell.name = 'NaturalRockShell';
    // Exclude the shell from generic primitive batching: retain its vertex
    // colours, topology and metrics for visual and clearance diagnostics.
    shell.userData = { dynamic: true, proceduralRock: true, ...geometry.userData };
    shell.castShadow = true; shell.receiveShadow = true;
    this.rockShell = shell;
    this.add(shell);

    const beams = [], posts = [], plates = [], hangers = [];
    for (const z of [-36, -18, 0, 18, 36]) {
      beams.push({ size: [17.5, 0.18, 0.19], position: [-0.6, 4.5, z] });
      posts.push({ size: [0.17, 4.55, 0.17], position: [-8.75, 2.275, z] });
      plates.push({ size: [0.4, 0.06, 0.4], position: [-8.75, 0.03, z] });
      hangers.push({ size: [0.04, 0.95, 0.04], position: [-4.5, 5.02, z] });
      hangers.push({ size: [0.04, 0.85, 0.04], position: [3.2, 4.97, z] });
      this.addCollider(-8.75, z, 0.4, 0.4);
    }
    instances(this, m.dark, beams);
    instances(this, m.dark, posts);
    instances(this, m.steel, plates);
    instances(this, m.steel, hangers);

    // Long industrial strips hang on supported cable trays below the rock.
    const housings = [], neutral = [], warm = [], brackets = [];
    for (const x of [-6.0, -1.25, 5.7]) {
      box(this, m.dark, [0.12, 0.08, 83], [x, 4.56, 0], { shadow: false });
      for (let z = -38; z <= 38; z += 9.5) {
        housings.push({ size: [0.22, 0.11, 5.7], position: [x, 4.45, z] });
        const strip = { size: [0.14, 0.025, 5.5], position: [x, 4.385, z] };
        (x > 5 ? warm : neutral).push(strip);
        for (const end of [-2.6, 2.6]) brackets.push({ size: [0.025, 0.15, 0.025], position: [x, 4.51, z + end] });
      }
    }
    instances(this, m.dark, housings, undefined, false);
    instances(this, m.tubeLight, neutral, undefined, false);
    instances(this, m.warmLight, warm, undefined, false);
    instances(this, m.steel, brackets, undefined, false);

    // Small metal wall carriers explain how standard station signs and panels
    // mount to an uneven rock face without hiding it behind cladding.
    for (const z of [-27, -8, 12, 32]) {
      for (const offset of [-1.9, 1.9]) box(this, m.dark, [0.65, 0.07, 0.07], [7.98, 2.6, z + offset]);
    }
    for (const z of [-24, -5, 15, 35]) {
      for (const offset of [-1.4, 1.4]) box(this, m.dark, [0.7, 0.06, 0.06], [-10.14, 2.73, z + offset]);
    }
    for (const y of [3.35, 3.5]) cylinder(this, m.dark, 0.029, 83, [-9.8, y, 0], [Math.PI / 2, 0, 0]);
    for (const z of [-37, 36]) box(this, m.concrete, [0.42, 2.62, 1.62], [-10.15, 1.31, z]);
  }
}
