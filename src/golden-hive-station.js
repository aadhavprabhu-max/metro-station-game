import * as THREE from 'three';
import { Station } from './station.js';
import { box, cylinder, instances, label, seededRandom } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

const CELL_RADIUS = 0.94;
const CELL_INNER_RADIUS = 0.84;
const CELL_TOP = 5.44;
const PILLAR_Z = [-32, -16, 0, 16, 32];

function hexagon(radius, clockwise = false) {
  const points = [];
  for (let index = 0; index < 6; index++) {
    const angle = (clockwise ? -index : index) * Math.PI / 3;
    points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  return points;
}

/** An open, six-sided physical coffer; its instance sets the real depth. */
export function createGoldenHiveCofferGeometry() {
  const shape = new THREE.Shape(hexagon(CELL_RADIUS));
  shape.holes.push(new THREE.Path(hexagon(CELL_INNER_RADIUS, true)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function hexPlate(radius, depth, bevel = 0) {
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(hexagon(radius)), {
    depth, bevelEnabled: bevel > 0, bevelSegments: 1, bevelSize: bevel,
    bevelThickness: bevel, steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function stationMaterials(base) {
  const standard = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  // Keep the existing platform, rails, furniture and line palettes intact.
  return {
    ...base,
    hiveStone: standard('#b5a58c', 0.68),
    hiveDado: standard('#938974', 0.72),
    hiveJoints: standard('#655f54', 0.9),
    hiveGold: standard('#c59a32', 0.34, 0.67),
    hiveIvory: standard('#d8d6c4', 0.4, 0.28),
    hiveDark: standard('#434749', 0.56, 0.51),
    hiveChrome: standard('#c1c5c2', 0.24, 0.81),
    hiveBronze: standard('#938050', 0.42, 0.72),
    hiveWhitePanel: new THREE.MeshStandardMaterial({ color: '#f1eee2', emissive: '#fff3d7', emissiveIntensity: 0.95, roughness: 0.66 }),
    hiveGoldPanel: new THREE.MeshStandardMaterial({ color: '#d7ad49', emissive: '#efc26a', emissiveIntensity: 0.7, roughness: 0.64 }),
    hiveDarkPanel: standard('#3b4140', 0.86, 0.18),
  };
}

function addNamedInstances(parent, material, entries, name, geometry, shadows = true) {
  const mesh = instances(parent, material, entries, geometry, shadows);
  mesh.name = name;
  return mesh;
}

function buildCeiling(station, m, parent) {
  const ceiling = new THREE.Group();
  ceiling.name = 'GoldenHiveCofferCeiling';
  parent.add(ceiling);
  const frames = [[], [], []], panels = [[], [], []], grilles = [[], []];
  const random = seededRandom(9817);
  const xSpacing = CELL_RADIUS * 1.5, zSpacing = CELL_RADIUS * Math.sqrt(3);
  const ring = createGoldenHiveCofferGeometry();
  const panelGeometry = hexPlate(CELL_INNER_RADIUS - 0.015, 0.024);
  let cells = 0;
  for (let column = 0; column < 12; column++) {
    const x = -8.91 + column * xSpacing;
    const stagger = column % 2 ? zSpacing / 2 : 0;
    for (let row = 0; row < 53; row++) {
      const z = -42.6 + row * zSpacing + stagger;
      if (z + CELL_RADIUS * Math.sqrt(3) / 2 > 43.65) continue;
      const choice = random();
      const type = choice < 0.34 ? 0 : choice < 0.81 ? 1 : 2;
      const depth = 0.27 + random() * 0.25;
      const bottom = CELL_TOP - depth;
      frames[type].push({ position: [x, bottom, z], size: [1, depth, 1] });
      panels[type].push({ position: [x, CELL_TOP - 0.09, z] });
      // Metal louvres sit below the recessed diffuser. Their ends follow the
      // hexagonal opening rather than continuing through neighbouring cells.
      const grille = grilles[type === 0 ? 0 : 1];
      for (let index = -3; index <= 3; index++) {
        const dx = index * 0.17;
        const halfLength = Math.abs(dx) <= CELL_INNER_RADIUS / 2
          ? CELL_INNER_RADIUS * Math.sqrt(3) / 2 - 0.024
          : (CELL_INNER_RADIUS - Math.abs(dx)) * Math.sqrt(3) - 0.024;
        grille.push({ size: [0.022, 0.026, halfLength * 2], position: [x + dx, CELL_TOP - 0.108, z] });
      }
      for (const dz of [-0.38, 0, 0.38]) {
        const halfLength = CELL_INNER_RADIUS - Math.abs(dz) / Math.sqrt(3) - 0.03;
        grille.push({ size: [halfLength * 2, 0.026, 0.023], position: [x, CELL_TOP - 0.107, z + dz] });
      }
      cells++;
    }
  }
  const frameMaterials = [m.hiveGold, m.hiveIvory, m.hiveDark];
  const panelMaterials = [m.hiveGoldPanel, m.hiveWhitePanel, m.hiveDarkPanel];
  station.cofferFrameMeshes = frames.map((entries, index) => addNamedInstances(ceiling, frameMaterials[index], entries,
    ['GoldenHiveGoldCofferFrames', 'GoldenHiveIvoryCofferFrames', 'GoldenHiveDarkCofferFrames'][index], ring));
  panels.forEach((entries, index) => addNamedInstances(ceiling, panelMaterials[index], entries,
    ['GoldenHiveAmberRecessedPanels', 'GoldenHiveWhiteRecessedPanels', 'GoldenHiveDarkRecessedPanels'][index], panelGeometry, false));
  grilles.forEach((entries, index) => addNamedInstances(ceiling, index === 0 ? m.hiveBronze : m.hiveChrome,
    entries, index === 0 ? 'GoldenHiveBronzeLouvres' : 'GoldenHiveSilverLouvres', undefined, false));
  station.cofferGeometry = ring;
  station.ceilingGroup = ceiling;
  ceiling.userData.architecture = { shape: 'extruded-hexagonal-coffers', cells, outerRadius: CELL_RADIUS, innerRadius: CELL_INNER_RADIUS, top: CELL_TOP };
}

function buildColumns(station, m, parent) {
  const cores = [], bases = [], capitals = [], silver = [], bronze = [], dark = [];
  // Small projecting hexagonal steel tiles form the column's surface. They are
  // real bevelled panels, not a photograph or a pattern on a flat cylinder.
  const tileGeometry = hexPlate(0.13, 0.013, 0.004);
  tileGeometry.rotateX(Math.PI / 2);
  const columnGeometry = new THREE.CylinderGeometry(0.287, 0.287, 1, 12);
  for (const z of PILLAR_Z) {
    cores.push({ position: [-8.3, 2.6, z], size: [1, 5.19, 1] });
    bases.push({ size: [0.67, 0.12, 0.77], position: [-8.3, 0.06, z] });
    bases.push({ size: [0.62, 0.09, 0.72], position: [-8.3, 0.18, z] });
    capitals.push({ size: [0.67, 0.18, 0.77], position: [-8.3, 5.18, z] });
    for (let face = 0; face < 8; face++) {
      const angle = face / 8 * Math.PI * 2;
      for (let row = 0; row < 20; row++) {
        const y = 0.37 + row * 0.234 + (face % 2 ? 0.117 : 0);
        const entry = {
          position: [-8.3 + Math.sin(angle) * 0.298, y, z + Math.cos(angle) * 0.298],
          rotation: [0, angle, 0], size: [0.83, 1, 1],
        };
        ((face + row * 2) % 11 === 0 ? bronze : (face + row) % 9 === 0 ? dark : silver).push(entry);
      }
    }
    // Exact original collision extents and order; all cladding fits inside.
    station.addCollider(-8.3, z, 0.67, 0.77);
    label(station, station.platformNumber, 0.38, 0.22, [-7.97, 1.8, z], {
      rotation: [0, Math.PI / 2, 0], fontSize: 250,
      background: station.options.platformSignColor ?? '#496a60',
    });
  }
  addNamedInstances(parent, m.hiveDark, cores, 'GoldenHiveColumnCores', columnGeometry);
  addNamedInstances(parent, m.hiveChrome, bases, 'GoldenHiveColumnPlinths');
  addNamedInstances(parent, m.hiveGold, capitals, 'GoldenHiveColumnCapitals');
  addNamedInstances(parent, m.hiveChrome, silver, 'GoldenHiveSilverColumnHexagons', tileGeometry);
  addNamedInstances(parent, m.hiveBronze, bronze, 'GoldenHiveBronzeColumnHexagons', tileGeometry);
  addNamedInstances(parent, m.hiveDark, dark, 'GoldenHiveDarkColumnHexagons', tileGeometry);
}

/** Central's lower U3/U4 halls; all railway and pedestrian coordinates survive. */
export class GoldenHiveStation extends Station {
  constructor(materials, options = {}) {
    super(stationMaterials(materials), options);
    this.theme = 'golden-hive';
    this.userData.stationTheme = this.theme;
    this.userData.architecture = { roof: 'volumetric-hexagonal-coffers', columns: 'bevelled-metal-hexagonal-cladding', roofTop: 5.67, platformPreserved: true };
    this.lightingOptions = {
      fixtures: false,
      pointLights: 4,
      pointDefinitions: [-28, -7, 14, 35].map((z, index) => ({
        position: [-2.7, 4.35, z], color: index % 2 ? '#f3eee1' : '#ffe2ac', intensity: 85, distance: 29,
      })),
    };
  }

  buildArchitecture(m) {
    const opening = this.options.backwallOpening;
    if (opening) {
      const left = opening.z - opening.width / 2, right = opening.z + opening.width / 2;
      const height = opening.height ?? 3.05;
      for (const [start, end] of [[-45, left], [right, 45]]) {
        if (end > start) box(this, m.hiveStone, [0.35, 5.7, end - start], [-10.1, 2.77, (start + end) / 2]);
      }
      box(this, m.hiveStone, [0.35, 5.62 - height, opening.width], [-10.1, (height + 5.62) / 2, opening.z]);
    } else box(this, m.hiveStone, [0.35, 5.7, 90], [-10.1, 2.77, 0]);
    box(this, m.hiveStone, [0.4, 5.7, 90], [7.85, 2.77, 0]);
    // A single backing slab above the coffers replaces the old slatted roof.
    box(this, m.hiveDark, [18.1, 0.16, 90], [-1.1, 5.59, 0]);
    for (const z of [-44, 44]) {
      this.buildPlatformEndWall(m, z);
      box(this, m.hiveStone, [2.9, 5.4, 0.4], [6.4, 2.7, z]);
      box(this, m.hiveStone, [4.9, 1.5, 0.4], [2.45, 4.7, z]);
      const cap = z < 0 ? this.options.northCap : this.options.southCap;
      if (cap) box(this, m.rubber, [4.8, 5.1, 0.1], [2.45, 1.8, z + Math.sign(z) * 4], { shadow: false });
    }
    const wallPanels = [], dadoPanels = [], joints = [], cornices = [];
    for (let z = -42; z <= 42; z += 3) {
      for (const x of [-9.9, 7.62]) {
        for (const section of this.wallPanelSections(x, z, 2.965)) {
          wallPanels.push({ size: [0.07, 2.44, section.depth], position: [x, 2.33, section.z] });
          dadoPanels.push({ size: [0.095, 1.11, section.depth], position: [x, 0.6, section.z] });
          joints.push({ size: [0.081, 0.014, section.depth], position: [x, 1.13, section.z] });
          cornices.push({ size: [0.13, 0.065, section.depth], position: [x < 0 ? x + 0.025 : x - 0.025, 3.63, section.z] });
        }
        if (opening && x < 0 && Math.abs(z - opening.z) < (opening.width + 2.965) / 2) {
          const left = Math.max(z - 2.965 / 2, opening.z - opening.width / 2);
          const right = Math.min(z + 2.965 / 2, opening.z + opening.width / 2);
          const bottom = opening.height ?? 3.05;
          if (right > left && bottom < 3.55) wallPanels.push({ size: [0.07, 3.55 - bottom, right - left], position: [x, (bottom + 3.55) / 2, (left + right) / 2] });
        }
      }
    }
    addNamedInstances(this, m.hiveStone, wallPanels, 'GoldenHiveStoneWallPanels');
    addNamedInstances(this, m.hiveDado, dadoPanels, 'GoldenHiveStoneDado');
    addNamedInstances(this, m.hiveJoints, joints, 'GoldenHiveWallJoints', undefined, false);
    addNamedInstances(this, m.hiveBronze, cornices, 'GoldenHiveBronzeWallCornices');
    for (const y of [3.93, 4.09]) cylinder(this, m.dark, 0.032, 87, [7.49, y, 0], [Math.PI / 2, 0, 0]);
    box(this, m.aluminum, [0.32, 0.19, 87.7], [7.4, 4.43, 0]);
    const vents = [];
    for (const z of [-33, -13, 10, 32]) {
      box(this, m.dark, [0.09, 0.48, 2.45], [7.53, 3.67, z]);
      for (let index = 0; index < 7; index++) vents.push({ size: [0.07, 0.035, 2.33], position: [7.475, 3.46 + index * 0.065, z] });
    }
    instances(this, m.aluminum, vents, undefined, false);
    const signature = new THREE.Group();
    signature.name = 'GoldenHiveArchitecture';
    this.add(signature);
    this.signatureGroup = signature;
    buildCeiling(this, m, signature);
    buildColumns(this, m, signature);
    // Freeze this station's static signature as its own batch, retaining the
    // real instanced coffer geometry for inspection without per-frame work.
    batchStaticGeometry(signature);
    signature.userData.dynamic = true;
    signature.userData.staticArchitecture = true;
  }
}
