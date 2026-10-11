import * as THREE from 'three';
import { Station } from './station.js';
import { box, instances, label } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

const CENTER_X = -1.1;
const HALF_WIDTH = 8.9;
const HALF_LENGTH = 44;
const SPRING_HEIGHT = 4.85;
const VAULT_RISE = 4.6;
const memberGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const columnGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
const up = new THREE.Vector3(0, 1, 0);

function cathedralMaterials(base) {
  // The inherited platform, tracks and furniture keep their exact materials.
  // Only the replacement architectural structure receives a new palette.
  return {
    ...base,
    cathedralWhite: new THREE.MeshStandardMaterial({
      color: '#e2eaf0', roughness: 0.4, metalness: 0.27,
      emissive: '#314450', emissiveIntensity: 0.12,
    }),
    cathedralGlass: new THREE.MeshStandardMaterial({
      color: '#c1dce9', roughness: 0.24, metalness: 0.13,
      transparent: true, opacity: 0.43, depthWrite: false,
      side: THREE.DoubleSide,
    }),
    cathedralCavity: new THREE.MeshStandardMaterial({
      color: '#ffffff', vertexColors: true, roughness: 0.83,
      emissive: '#264461', emissiveIntensity: 0.35, side: THREE.DoubleSide,
    }),
    cathedralBlueStrip: new THREE.MeshStandardMaterial({
      color: '#9dc7e5', emissive: '#7cadcf', emissiveIntensity: 1.1, roughness: 0.5,
    }),
  };
}

function longitudinalLift(z) {
  return Math.cos(z / HALF_LENGTH * Math.PI) * 0.22;
}

function roofPoint(angle, z, offset = 0) {
  const nx = VAULT_RISE * Math.sin(angle);
  const ny = HALF_WIDTH * Math.cos(angle);
  const length = Math.hypot(nx, ny);
  return [
    CENTER_X + HALF_WIDTH * Math.sin(angle) + offset * nx / length,
    SPRING_HEIGHT + VAULT_RISE * Math.cos(angle) + longitudinalLift(z) + offset * ny / length,
    z,
  ];
}

function roofHeight(x, z) {
  const ratio = THREE.MathUtils.clamp((x - CENTER_X) / HALF_WIDTH, -1, 1);
  return SPRING_HEIGHT + VAULT_RISE * Math.sqrt(1 - ratio * ratio) + longitudinalLift(z);
}

function beamEntry(from, to, radius) {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const orientation = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
  return {
    position: start.add(end).multiplyScalar(0.5).toArray(),
    size: [radius, direction.length(), radius],
    rotation: new THREE.Euler().setFromQuaternion(orientation).toArray().slice(0, 3),
  };
}

function addMembers(parent, material, entries, name, shadow = true) {
  const mesh = instances(parent, material, entries, memberGeometry, shadow);
  mesh.name = name;
  return mesh;
}

/** An indexed, curved glass surface rather than a flat ceiling or backdrop. */
export function createGlassCathedralRoofGeometry({ arcSegments = 48, lengthSegments = 44, offset = 0, colors = false } = {}) {
  const positions = [], uvs = [], indices = [], vertexColors = [];
  const edgeColor = new THREE.Color('#376389');
  const crownColor = new THREE.Color('#8aabc6');
  const color = new THREE.Color();
  for (let row = 0; row <= lengthSegments; row++) {
    const z = (row / lengthSegments * 2 - 1) * HALF_LENGTH;
    for (let column = 0; column <= arcSegments; column++) {
      const angle = column / arcSegments * Math.PI - Math.PI / 2;
      positions.push(...roofPoint(angle, z, offset));
      uvs.push(column / arcSegments, row / lengthSegments);
      if (colors) {
        color.copy(edgeColor).lerp(crownColor, Math.pow(Math.cos(angle), 0.65));
        color.multiplyScalar(0.95 + Math.cos(z / 44 * Math.PI) * 0.05);
        vertexColors.push(color.r, color.g, color.b);
      }
      if (row < lengthSegments && column < arcSegments) {
        const a = row * (arcSegments + 1) + column, b = a + 1;
        const c = a + arcSegments + 1, d = c + 1;
        // Inward normals face the occupied hall beneath the glazing.
        indices.push(a, b, c, b, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    signatureRoof: true, shape: 'elliptical-ribbed-glass-vault', arcSegments, lengthSegments,
    width: HALF_WIDTH * 2, length: HALF_LENGTH * 2, minimumHeight: 4.63, maximumHeight: 9.67,
  };
  return geometry;
}

/** A closed steel blade follows the same ellipse as the glass. One geometry is
 * reused by every transverse rib, so its sweep has no separate rod-end gaps. */
function createPrimaryRibGeometry(segments = 48) {
  const positions = [], indices = [];
  for (let index = 0; index <= segments; index++) {
    const angle = index / segments * Math.PI - Math.PI / 2;
    const nx = VAULT_RISE * Math.sin(angle), ny = HALF_WIDTH * Math.cos(angle);
    const length = Math.hypot(nx, ny);
    const x = CENTER_X + HALF_WIDTH * Math.sin(angle);
    const y = SPRING_HEIGHT + VAULT_RISE * Math.cos(angle);
    for (const [radial, z] of [[-0.13, -0.115], [0.13, -0.115], [0.13, 0.115], [-0.13, 0.115]]) {
      positions.push(x + radial * nx / length, y + radial * ny / length, z);
    }
    if (index < segments) {
      for (let side = 0; side < 4; side++) {
        const a = index * 4 + side, b = index * 4 + (side + 1) % 4;
        const c = a + 4, d = b + 4;
        indices.push(a, b, c, b, d, c);
      }
    }
  }
  indices.push(0, 2, 1, 0, 3, 2);
  const end = segments * 4;
  indices.push(end, end + 1, end + 2, end, end + 2, end + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createEndGlazing(z, segments = 48) {
  const positions = [], indices = [];
  for (let index = 0; index <= segments; index++) {
    const angle = index / segments * Math.PI - Math.PI / 2;
    const point = roofPoint(angle, z);
    positions.push(point[0], 4.05, z, point[0], point[1], z);
    if (index < segments) {
      const a = index * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Stadtzentrum's glass-and-white-steel hall retains every operational station
 * component from Station, including its original platform and railway. */
export class GlassCathedralStation extends Station {
  constructor(materials, options = {}) {
    super(cathedralMaterials(materials), {
      id: 'u2-stadtzentrum', displayName: 'Stadtzentrum', lineId: 'U2',
      lineName: 'THE INDUSTRIAL LINE', platformNumber: '02',
      signageColor: '#b4443d', platformSignColor: '#b4443d',
      ...options,
    });
    this.theme = 'glass-cathedral';
    this.portalOffset = 44;
    this.architecture = {
      theme: this.theme, signature: 'white-ribbed-glass-vault',
      roofWidth: 17.8, roofLength: 88, roofMinimum: 4.63, roofMaximum: 9.67,
      primaryRibs: 23, platformColumns: 5,
    };
    this.userData.stationTheme = this.theme;
    this.userData.architecture = { ...this.architecture };
    // Reuse the existing four-point-light pool; no new light objects or shader
    // permutations are introduced for the architectural canopy.
    this.lightingOptions = {
      fixtures: false, pointLights: 4,
      pointDefinitions: [
        { position: [-4.8, 4.55, -29], color: '#e7f1f7', intensity: 90, distance: 32 },
        { position: [3.6, 6.1, -9], color: '#d7e9f8', intensity: 95, distance: 33 },
        { position: [-4.8, 4.55, 12], color: '#e7f1f7', intensity: 90, distance: 32 },
        { position: [3.6, 6.1, 33], color: '#d7e9f8', intensity: 95, distance: 33 },
      ],
    };
  }

  buildArchitecture(m) {
    // The old rectangular ceiling is omitted entirely. Solid public-area
    // walls keep their original footprint under a real glazed clerestory.
    box(this, m.concrete, [0.35, 4.13, 90], [-10.1, 2.025, 0]);
    box(this, m.concrete, [0.4, 4.13, 90], [7.85, 2.025, 0]);
    const panels = [], lowerPanels = [];
    for (let z = -42; z <= 42; z += 3) {
      for (const x of [-9.9, 7.62]) {
        panels.push({ size: [0.07, 2.44, 2.965], position: [x, 2.33, z] });
        lowerPanels.push({ size: [0.095, 1.11, 2.965], position: [x, 0.6, z] });
      }
    }
    instances(this, m.wallTile, panels);
    instances(this, m.greenTile, lowerPanels);

    const roof = new THREE.Group();
    roof.name = 'GlassCathedralRoof';
    roof.userData.signatureArchitecture = 'glass-cathedral';
    this.add(roof);
    this.roofGroup = this.signatureGroup = roof;

    const glazing = new THREE.Mesh(createGlassCathedralRoofGeometry(), m.cathedralGlass);
    glazing.name = 'CurvedCathedralGlass';
    glazing.receiveShadow = true;
    roof.add(glazing);
    this.signatureRoof = glazing;

    // A shallow curved light cavity beyond the glazing supplies a restrained
    // blue clerestory colour without a sky asset, flat background or photo.
    const cavity = new THREE.Mesh(createGlassCathedralRoofGeometry({ offset: 0.2, colors: true }), m.cathedralCavity);
    cavity.name = 'CurvedBlueRoofLightCavity';
    roof.add(cavity);

    const ribs = [];
    for (let z = -44; z <= 44; z += 4) ribs.push({ position: [0, longitudinalLift(z), z] });
    this.primaryRibs = instances(roof, m.cathedralWhite, ribs, createPrimaryRibGeometry());
    this.primaryRibs.name = 'WhiteCathedralPrimaryRibs';

    const secondary = [], eaveLights = [], facadeMullions = [], upperWallGlass = [];
    for (let column = 0; column <= 18; column++) {
      const angle = column / 18 * Math.PI - Math.PI / 2;
      for (let z = -44; z < 44; z += 4) {
        secondary.push(beamEntry(roofPoint(angle, z, -0.045), roofPoint(angle, z + 4, -0.045), column === 9 ? 0.085 : 0.047));
      }
    }
    this.secondaryMullions = addMembers(roof, m.cathedralWhite, secondary, 'CathedralLongitudinalMullions');
    for (const x of [-9.87, 7.68]) {
      for (let z = -42; z <= 42; z += 3) {
        const top = roofHeight(x, z) - 0.04;
        upperWallGlass.push({ size: [0.045, top - 4.09, 2.94], position: [x, (top + 4.09) / 2, z] });
        facadeMullions.push({ size: [0.075, top - 4.04, 0.075], position: [x, (top + 4.04) / 2, z + 1.48] });
      }
      eaveLights.push({ size: [0.038, 0.028, 86.8], position: [x, 4.14, 0] });
      facadeMullions.push({ size: [0.12, 0.17, 89], position: [x, 4.09, 0] });
    }
    instances(roof, m.cathedralGlass, upperWallGlass, undefined, false).name = 'CathedralClerestoryPanels';
    instances(roof, m.cathedralWhite, facadeMullions).name = 'CathedralClerestoryFrames';
    instances(roof, m.cathedralBlueStrip, eaveLights, undefined, false).name = 'CathedralBlueEaveStrips';

    this.buildColumns(m, roof);
    this.buildPortals(m, roof);
    this.buildFixtures(m, roof);
    this.buildSignHangers(m, roof);
    // Batch the static primitive accents once, then retain the actual rendered
    // signature group and diagnostic references through Station's outer batch.
    batchStaticGeometry(roof);
    roof.userData.dynamic = true;
  }

  buildColumns(m, roof) {
    const columns = [], bases = [], splitSupports = [];
    for (const z of [-32, -16, 0, 16, 32]) {
      for (const x of [-8.3, 7.2]) {
        const height = x < 0 ? 6.35 : 4.68;
        columns.push({ position: [x, height / 2, z], size: [x < 0 ? 0.29 : 0.22, height, x < 0 ? 0.32 : 0.25] });
        bases.push({ size: [x < 0 ? 0.67 : 0.54, 0.15, x < 0 ? 0.77 : 0.6], position: [x, 0.075, z] });
        const targets = x < 0 ? [-9.28, -6.28] : [5.3, 7.58];
        for (const targetX of targets) {
          splitSupports.push(beamEntry([x, height - 0.22, z], [targetX, roofHeight(targetX, z) - 0.16, z], 0.16));
        }
        if (x < 0) {
          // Same location, order and dimensions as the original Station.
          this.addCollider(-8.3, z, 0.67, 0.77);
          label(this, this.platformNumber, 0.38, 0.22, [-7.97, 1.8, z], {
            rotation: [0, Math.PI / 2, 0], fontSize: 250,
            background: this.options.platformSignColor ?? '#b4443d',
          });
        }
      }
    }
    instances(roof, m.cathedralWhite, columns, columnGeometry).name = 'CathedralWhiteColumns';
    instances(roof, m.steel, bases).name = 'CathedralColumnFootplates';
    addMembers(roof, m.cathedralWhite, splitSupports, 'CathedralBranchingCapitals');
  }

  buildPortals(m, roof) {
    const facadeMembers = [];
    for (const z of [-44, 44]) {
      // Track opening and terminating caps retain the original rail envelope.
      box(this, m.wall, [10.1, 4.05, 0.4], [-5, 2.025, z]);
      box(this, m.wall, [2.9, 4.05, 0.4], [6.4, 2.025, z]);
      const hasCap = z < 0 ? this.options.northCap : this.options.southCap;
      if (hasCap) box(this, m.rubber, [4.8, 5.1, 0.1], [2.45, 1.8, z + Math.sign(z) * 4], { shadow: false });
      box(roof, m.cathedralWhite, [5.16, 0.2, 0.52], [2.45, 4.04, z]);
      for (const x of [0, 4.9]) box(roof, m.cathedralWhite, [0.17, 5.05, 0.5], [x, 1.42, z]);
      const pane = new THREE.Mesh(createEndGlazing(z), m.cathedralGlass);
      pane.name = `CathedralGlazedGable-${z}`;
      roof.add(pane);
      for (let x = -9; x <= 7; x += 1) {
        facadeMembers.push(beamEntry([x, 4.08, z], [x, roofHeight(x, z) - 0.06, z], 0.044));
      }
      facadeMembers.push(beamEntry([-9.94, 4.08, z], [7.74, 4.08, z], 0.09));
    }
    addMembers(roof, m.cathedralWhite, facadeMembers, 'CathedralGableMullions');
  }

  buildFixtures(m, roof) {
    const housings = [], lamps = [], hangers = [];
    for (let z = -40; z <= 40; z += 8) {
      for (const x of [-6.0, -1.3, 5.7]) {
        housings.push({ size: [0.2, 0.09, 4.3], position: [x, 4.93, z] });
        lamps.push({ size: [0.145, 0.025, 4.1], position: [x, 4.8725, z] });
        for (const dz of [-1.7, 1.7]) {
          const top = roofHeight(x, z + dz) - 0.12;
          hangers.push(beamEntry([x, 4.98, z + dz], [x, top, z + dz], 0.013));
        }
      }
    }
    instances(roof, m.aluminum, housings, undefined, false).name = 'CathedralPendantHousings';
    instances(roof, m.tubeLight, lamps, undefined, false).name = 'CathedralNeutralPlatformLamps';
    addMembers(roof, m.steel, hangers, 'CathedralPendantSuspensions', false);
  }

  buildSignHangers(m, roof) {
    // Extend the original board/sign rods to the taller canopy without moving
    // any text, display, interaction target or original sign component.
    const entries = [];
    const add = (x, z, bottom) => entries.push(beamEntry([x, bottom, z], [x, roofHeight(x, z) - 0.13, z], 0.017));
    for (const z of [-6, 18, 38]) for (const dx of [-1.35, 1.35]) add(-4.8 + dx, z, 5.43);
    for (const [x, z, yaw, halfWidth, bottom] of [[-3.8, -34, -2.65, 0.9, 5.51], [-2.2, -22, -2.64, 1.6, 5.52]]) {
      for (const dx of [-halfWidth, halfWidth]) add(x + Math.cos(yaw) * dx, z - Math.sin(yaw) * dx, bottom);
    }
    addMembers(roof, m.steel, entries, 'CathedralOriginalSignHangerExtensions', false);
  }
}
