import * as THREE from 'three';
import { Station } from './station.js';
import { box, cylinder, instances, label, canvasTexture, seededRandom } from './geometry.js';

const U4_COLOR = '#8d58ac';
const crestRing = new THREE.TorusGeometry(0.3, 0.045, 6, 24);
const ornamentGeometry = new THREE.OctahedronGeometry(1, 0);

function historicMaterials(materials, theme) {
  const palette = { ...materials };
  const brick = theme === 'railway';
  const garden = theme === 'garden';
  for (const [name, color, roughness] of [
    ['concrete', brick ? '#aa9682' : '#c7b79b', 0.88],
    ['tile', garden ? '#d1cbbb' : '#c3b69a', 0.61],
    ['grout', '#79756a', 0.93],
    ['wall', brick ? '#aa8266' : '#d9c8a7', 0.86],
    ['wallTile', garden ? '#e3dfd0' : '#decdaa', 0.64],
    ['greenTile', garden ? '#7b9b8c' : '#28666c', 0.37],
    ['wood', '#887158', 0.84],
  ]) {
    palette[name] = materials[name].clone();
    palette[name].color.set(color);
    palette[name].roughness = roughness;
  }
  const standard = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  palette.vaultStone = standard(brick ? '#b99276' : garden ? '#d6d0bb' : '#d4bc87', 0.86);
  // The underside of a curved shell remains visible from every platform angle.
  palette.vaultStone.side = THREE.DoubleSide;
  palette.cutStone = standard(brick ? '#c3ae90' : garden ? '#c1b69c' : '#c3ab7d', 0.8);
  palette.lightStone = standard(garden ? '#e2dccb' : '#dfcba2', 0.78);
  palette.ochreStone = standard(brick ? '#8f614b' : '#bca06b', 0.87);
  palette.mortar = standard(brick ? '#776e60' : '#96917e', 0.97);
  palette.ironwork = standard('#363c37', 0.65, 0.6);
  palette.brass = standard('#95784c', 0.51, 0.65);
  palette.floorInlay = standard('#625f53', 0.6);
  palette.u4Trim = standard(U4_COLOR, 0.6);
  palette.lanternGlow = new THREE.MeshStandardMaterial({
    color: brick ? '#ffe7b5' : '#ffedc8', emissive: '#ffc97e', emissiveIntensity: 1.5, roughness: 0.55,
  });
  palette.amberGlazing = new THREE.MeshStandardMaterial({
    color: '#b29b6f', emissive: '#c39754', emissiveIntensity: 0.23,
    roughness: 0.51, metalness: 0.1, side: THREE.DoubleSide,
  });
  for (const [name, material] of Object.entries(palette)) {
    if (!Object.hasOwn(materials, name)) material.name = `Historic-${theme}-${name}`;
  }
  return palette;
}

function structuralMember(parent, material, from, to, width, depth = width) {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const mesh = box(parent, material, [width, direction.length(), depth], start.clone().add(end).multiplyScalar(0.5).toArray());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

/** A continuous elliptical masonry ceiling, rather than a flat ceiling texture. */
function barrelVault(parent, material, { centerX = -1.1, radius = 8.95, spring = 3.0, rise = 4.2, length = 88.4, name }) {
  const segments = 48;
  const positions = [], uvs = [], indices = [];
  for (let index = 0; index <= segments; index++) {
    const angle = index / segments * Math.PI;
    for (const z of [-length / 2, length / 2]) {
      positions.push(centerX + radius * Math.cos(angle), spring + rise * Math.sin(angle), z);
      uvs.push(index / segments * 4, z < 0 ? 0 : 12);
    }
  }
  for (let index = 0; index < segments; index++) {
    const base = index * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  // Preserve this named shell for geometry diagnostics while the many smaller
  // opaque masonry pieces still use the station's normal static batching.
  mesh.userData.dynamic = true;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** One solid wedge in a deep stone arch, with real intrados and extrados. */
function archStoneGeometry(radius, rise, startAngle, endAngle, thickness, depth) {
  const shape = new THREE.Shape();
  const points = 4;
  for (let index = 0; index <= points; index++) {
    const angle = startAngle + (endAngle - startAngle) * index / points;
    const x = radius * Math.cos(angle), y = rise * Math.sin(angle);
    if (index === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  for (let index = points; index >= 0; index--) {
    const angle = startAngle + (endAngle - startAngle) * index / points;
    shape.lineTo((radius + thickness) * Math.cos(angle), (rise + thickness) * Math.sin(angle));
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 4 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function masonryArch(parent, materials, { center, radius, rise, thickness = 0.38, depth = 0.65, segments = 23, yaw = 0, name = 'MasonryArch' }) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...center);
  group.rotation.y = yaw;
  group.userData.archGeometry = { radius, rise, thickness, depth, voussoirs: segments };
  parent.add(group);
  for (let index = 0; index < segments; index++) {
    const start = index / segments * Math.PI + 0.0015;
    const end = (index + 1) / segments * Math.PI - 0.0015;
    const geometry = archStoneGeometry(radius, rise, start, end, thickness, depth);
    const mesh = new THREE.Mesh(geometry, materials[index % materials.length]);
    mesh.name = `${name}-Voussoir-${index}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function tileWalls(parent, material, { height = 1.82, base = 0.05, width = 0.58, rowHeight = 0.3, seed = 488, alternating = false } = {}) {
  const entries = [], random = seededRandom(seed);
  for (const x of [-9.876, 7.624]) {
    for (let row = 0; row * rowHeight < height; row++) {
      for (let z = -43.6; z < 43.8; z += width + 0.012) {
        const color = material.color.clone();
        color.multiplyScalar(alternating && row % 2 === 0 ? 1.13 : 0.9 + random() * 0.19);
        entries.push({
          size: [0.095, rowHeight - 0.01, width],
          position: [x, base + rowHeight * (row + 0.5), z], color,
        });
      }
    }
  }
  instances(parent, material, entries).name = 'HistoricIndividualWallTiles';
}

function historicWalls(parent, m, height) {
  for (const x of [-10.1, 7.85]) {
    box(parent, m.mortar, [0.32, height, 88.8], [x, height / 2 - 0.02, 0]);
    // Raised dado, cornice and skirting all have their own physical depth.
    const faceX = x < 0 ? -9.85 : 7.59;
    for (const [y, h, depth] of [[0.13, 0.22, 0.15], [1.99, 0.12, 0.17], [3.16, 0.18, 0.24]]) {
      box(parent, m.cutStone, [depth, h, 88], [faceX, y, 0]);
    }
    box(parent, m.u4Trim, [0.045, 0.06, 88], [x < 0 ? -9.751 : 7.491, 2.105, 0]);
  }
}

function elegantFloor(parent, m, { inset = true } = {}) {
  const inlay = [];
  for (const x of [-9.2, -1.1]) inlay.push({ size: [0.09, 0.006, 87.6], position: [x, 0.004, 0] });
  for (let z = -42; z <= 42; z += 8) {
    inlay.push({ size: [8.1, 0.006, 0.075], position: [-5.15, 0.004, z] });
    if (inset) {
      for (const x of [-8.6, -1.7]) inlay.push({ size: [0.26, 0.006, 0.26], position: [x, 0.004, z], rotation: [0, Math.PI / 4, 0] });
    }
  }
  instances(parent, m.floorInlay, inlay, undefined, false).name = 'HistoricStoneFloorInlays';
}

function lantern(parent, m, position, roofHeight, ornate = false) {
  const [x, y, z] = position;
  cylinder(parent, m.ironwork, 0.018, roofHeight - y - 0.45, [x, (roofHeight + y + 0.45) / 2, z], [0, 0, 0], 6);
  cylinder(parent, m.brass, 0.33, 0.09, [x, y + 0.37, z], [0, 0, 0], 8);
  cylinder(parent, m.brass, 0.25, 0.08, [x, y - 0.36, z], [0, 0, 0], 8);
  box(parent, m.lanternGlow, [0.4, 0.59, 0.4], [x, y, z], { shadow: false });
  for (const dx of [-0.23, 0.23]) {
    for (const dz of [-0.23, 0.23]) cylinder(parent, m.ironwork, 0.022, 0.68, [x + dx, y, z + dz], [0, 0, 0], 6);
  }
  if (ornate) {
    for (const direction of [-1, 1]) {
      structuralMember(parent, m.ironwork, [x, y + 1.45, z], [x + direction * 0.55, y + 0.83, z], 0.023);
      structuralMember(parent, m.ironwork, [x + direction * 0.55, y + 0.83, z], [x + direction * 0.15, y + 0.61, z], 0.023);
    }
  }
}

function clock(parent, m, position, name, roofHeight) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  cylinder(group, m.ironwork, 0.52, 0.12, [0, 0, 0], [Math.PI / 2, 0, 0], 32);
  const texture = canvasTexture(512, 512, (ctx, width, height) => {
    ctx.fillStyle = '#e6debc'; ctx.fillRect(0, 0, width, height);
    const center = width / 2;
    ctx.strokeStyle = '#4c4b40'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(center, center, 232, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '34px Georgia, serif'; ctx.fillStyle = '#333d37'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    numerals.forEach((numeral, index) => {
      const angle = index / 12 * Math.PI * 2;
      ctx.fillText(numeral, center + Math.sin(angle) * 185, center - Math.cos(angle) * 185);
    });
    // A period dial is decorative; the live departures clock stays authoritative.
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(center - 96, center - 70); ctx.stroke();
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(center - 35, center + 153); ctx.stroke();
    ctx.beginPath(); ctx.arc(center, center, 12, 0, Math.PI * 2); ctx.fill();
  });
  const faceMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const faceGeometry = new THREE.CircleGeometry(0.487, 32);
  for (const side of [-1, 1]) {
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.position.z = side * 0.069;
    if (side < 0) face.rotation.y = Math.PI;
    group.add(face);
  }
  const suspension = roofHeight - position[1] - 0.54;
  box(group, m.ironwork, [0.06, suspension, 0.06], [0, 0.54 + suspension / 2, 0]);
}

function portals(station, m, height, stoneArches = true) {
  for (const z of [-44, 44]) {
    box(station, m.wall, [9.95, height, 0.34], [-5.075, height / 2, z]);
    box(station, m.wall, [2.65, height, 0.34], [6.525, height / 2, z]);
    box(station, m.wall, [5.35, height - 4.55, 0.34], [2.525, (height + 4.55) / 2, z]);
    for (const x of [-0.24, 5.22]) box(station, m.cutStone, [0.24, 4.3, 0.7], [x, 1.73, z]);
    if (stoneArches) masonryArch(station, [m.cutStone, m.lightStone], {
      center: [2.48, 2.27, z], radius: 2.66, rise: 2.24, thickness: 0.32, depth: 0.78, segments: 17, name: 'HistoricRailwayPortalArch',
    });
    else box(station, m.cutStone, [5.72, 0.24, 0.58], [2.49, 4.44, z]);
    const capped = z < 0 ? station.options.northCap : station.options.southCap;
    if (capped) {
      box(station, m.rubber, [5.27, 5.2, 0.13], [2.5, 1.7, z + Math.sign(z) * 4], { shadow: false });
      box(station, m.ironwork, [2.35, 0.19, 0.2], [1.57, -0.16, z + Math.sign(z) * 2.5]);
      for (const x of [0.85, 2.29]) box(station, m.rubber, [0.31, 0.26, 0.16], [x, -0.13, z + Math.sign(z) * 2.4]);
    }
  }
}

function stonePillar(station, m, x, z, monumental = false) {
  const group = new THREE.Group();
  group.name = monumental ? 'KaiserMonumentalCarvedPillar' : 'KaiserVaultSupportPillar';
  group.position.set(x, 0, z);
  // Named, physically load-bearing supports remain inspectable after batching.
  group.userData.dynamic = true;
  station.add(group);
  box(group, m.cutStone, [1.25, 0.22, 1.42], [0, 0.11, 0]);
  box(group, m.lightStone, [1.08, 2.56, 1.14], [0, 1.52, 0]);
  for (const [y, size, thickness] of [[0.31, 1.18, 0.12], [2.92, 1.2, 0.16], [3.13, 1.4, 0.2], [3.35, 1.56, 0.18]]) {
    box(group, y < 1 ? m.cutStone : m.ochreStone, [size, thickness, size + 0.08], [0, y, 0]);
  }
  for (const side of [-1, 1]) {
    box(group, m.cutStone, [0.07, 1.7, 0.82], [side * 0.575, 1.88, 0]);
    box(group, m.lightStone, [0.065, 1.53, 0.67], [side * 0.612, 1.88, 0]);
    if (monumental) {
      const wreath = new THREE.Mesh(crestRing, m.ochreStone);
      wreath.rotation.y = Math.PI / 2;
      wreath.position.set(side * 0.67, 2.1, 0);
      wreath.castShadow = wreath.receiveShadow = true;
      group.add(wreath);
      for (let index = 0; index < 10; index++) {
        const angle = index / 10 * Math.PI * 2;
        const leaf = new THREE.Mesh(ornamentGeometry, m.cutStone);
        leaf.scale.set(0.035, 0.11, 0.065);
        leaf.position.set(side * 0.68, 2.1 + Math.sin(angle) * 0.35, Math.cos(angle) * 0.35);
        leaf.rotation.x = angle;
        leaf.castShadow = leaf.receiveShadow = true;
        group.add(leaf);
      }
      // A small original shield and crown relief, modelled in projecting stone.
      box(group, m.ochreStone, [0.055, 0.28, 0.2], [side * 0.72, 2.1, 0]);
      for (const dz of [-0.12, 0, 0.12]) {
        box(group, m.cutStone, [0.07, dz === 0 ? 0.14 : 0.1, 0.06], [side * 0.72, 2.37, dz]);
      }
    }
  }
  station.addCollider(x, z, 1.3, 1.47);
  return group;
}

/** U4's historic showpiece: real masonry vaults, carved piers and warm lanterns. */
export class KaiserHumboldtStation extends Station {
  constructor(materials, options = {}) {
    super(historicMaterials(materials, 'imperial'), {
      id: 'u4-kaiser-humboldt', displayName: 'Kaiser-Humboldt-Platz', lineId: 'U4',
      platformNumber: '04', destinationName: 'Arabellapark', signageColor: U4_COLOR,
      platformSignColor: U4_COLOR, lineName: 'THE HISTORIC LINE', northCap: true, southCap: false,
      ...options,
    });
    this.theme = 'historic-vaulted';
    this.userData.stationTheme = this.theme;
    this.userData.historicArchitecture = {
      vaultType: 'elliptical-masonry', roofHeight: 8.3, transverseArches: 11,
      longitudinalArches: 5, platformPillars: 6, monumentalPillars: 1,
      wallTileColor: '#28666c', originalCarvedRelief: true, lanterns: 18,
    };
    this.lightingOptions = {
      fixtures: false,
      pointDefinitions: [
        { position: [-5.4, 4.35, -28], color: '#ffdfa5', intensity: 95, distance: 30 },
        { position: [-2.6, 4.35, -7], color: '#ffe8b9', intensity: 90, distance: 29 },
        { position: [-5.4, 4.35, 14], color: '#ffdfa5', intensity: 95, distance: 30 },
        { position: [-2.6, 4.35, 35], color: '#ffe8b9', intensity: 90, distance: 29 },
      ],
    };
  }

  buildArchitecture(m) {
    historicWalls(this, m, 3.35);
    tileWalls(this, m.greenTile);
    elegantFloor(this, m);
    barrelVault(this, m.vaultStone, { spring: 3.1, rise: 5.2, name: 'KaiserMasonryBarrelVault' });

    // Stone ribs and individual voussoirs form deep transverse arches.
    for (let z = -40; z <= 40; z += 8) {
      masonryArch(this, [m.cutStone, m.lightStone, m.cutStone], {
        center: [-1.1, 3.02, z], radius: 8.75, rise: 4.95, thickness: 0.29, depth: 0.7,
        segments: 27, name: 'KaiserTransverseStoneArch',
      });
      for (const x of [-9.67, 7.47]) {
        box(this, m.cutStone, [0.33, 3.15, 0.78], [x, 1.57, z]);
        box(this, m.lightStone, [0.43, 0.2, 0.94], [x, 3.03, z]);
      }
    }
    const pierZ = [-36, -20, -4, 12, 28, 40];
    pierZ.forEach(z => stonePillar(this, m, -5.2, z, z === -4));
    for (let index = 0; index < pierZ.length - 1; index++) {
      const span = (pierZ[index + 1] - pierZ[index]) / 2;
      masonryArch(this, [m.cutStone, m.ochreStone, m.lightStone], {
        center: [-5.2, 3.43, (pierZ[index + 1] + pierZ[index]) / 2],
        radius: span - 0.57, rise: 2.65, thickness: 0.33, depth: 0.84,
        segments: 19, yaw: Math.PI / 2, name: 'KaiserLongitudinalArcade',
      });
    }

    // Amber glazed vault fields sit inside the masonry shell, with an actual
    // dark iron lattice across the curved surface; they are original geometry.
    const glassMaterial = m.amberGlazing;
    for (let bay = -40; bay < 40; bay += 8) {
      for (let panel = 0; panel < 8; panel++) {
        const start = Math.PI * (0.25 + panel * 0.0625), end = start + Math.PI * 0.061;
        const radius = 8.91, rise = 5.16;
        const shape = new THREE.Shape();
        shape.moveTo(-1.1 + radius * Math.cos(start), 3.1 + rise * Math.sin(start));
        shape.lineTo(-1.1 + radius * Math.cos(end), 3.1 + rise * Math.sin(end));
        shape.lineTo(-1.1 + (radius - 0.035) * Math.cos(end), 3.1 + (rise - 0.035) * Math.sin(end));
        shape.lineTo(-1.1 + (radius - 0.035) * Math.cos(start), 3.1 + (rise - 0.035) * Math.sin(start));
        shape.closePath();
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: 7.23, bevelEnabled: false, steps: 1 });
        const glass = new THREE.Mesh(geometry, glassMaterial);
        glass.position.z = bay + 0.38;
        glass.name = 'KaiserCurvedAmberGlazing';
        this.add(glass);
      }
    }
    for (let index = 0; index <= 8; index++) {
      const angle = Math.PI * (0.25 + index * 0.0625);
      cylinder(this, m.ironwork, 0.034, 86.5, [-1.1 + 8.885 * Math.cos(angle), 3.1 + 5.13 * Math.sin(angle), 0], [Math.PI / 2, 0, 0], 6);
    }
    for (const x of [-9.78, 7.53]) {
      for (let z = -40; z <= 40; z += 8) {
        box(this, m.ochreStone, [0.1, 0.76, 6.35], [x, 2.55, z + 3.7]);
        box(this, m.lightStone, [0.16, 0.07, 6.05], [x < 0 ? x + 0.06 : x - 0.06, 2.94, z + 3.7]);
      }
    }
    for (const z of [-36, -20, -4, 12, 28, 40]) {
      for (const x of [-7.45, -2.85, 4.85]) {
        const roof = 3.1 + 5.2 * Math.sqrt(1 - ((x + 1.1) / 8.95) ** 2) - 0.1;
        lantern(this, m, [x, 4.5, z], roof, true);
      }
    }
    portals(this, m, 8.3);
  }
}

/** A quieter late nineteenth-century railway hall, distinct from the showpiece. */
export class WestbahnhofStation extends Station {
  constructor(materials, options = {}) {
    super(historicMaterials(materials, 'railway'), {
      id: 'u4-westbahnhof', displayName: 'Westbahnhof', lineId: 'U4',
      platformNumber: '04', destinationName: 'Arabellapark', signageColor: U4_COLOR,
      platformSignColor: U4_COLOR, lineName: 'THE HISTORIC LINE', northCap: false, southCap: false,
      ...options,
    });
    this.theme = 'historic-railway';
    this.userData.stationTheme = this.theme;
    this.userData.historicArchitecture = {
      vaultType: 'brick-barrel', roofHeight: 6.95, transverseArches: 11,
      ironColumns: 5, classicClocks: 2, lanterns: 18,
    };
    this.lightingOptions = {
      fixtures: false,
      pointDefinitions: [-28, -7, 14, 35].map(z => ({ position: [-2.9, 4.25, z], color: '#ffebc5', intensity: 90, distance: 29 })),
    };
  }

  buildArchitecture(m) {
    historicWalls(this, m, 3.45);
    elegantFloor(this, m, { inset: false });
    barrelVault(this, m.vaultStone, { spring: 3.3, rise: 3.65, name: 'WestbahnhofBrickBarrelVault' });
    const bricks = [], random = seededRandom(370);
    for (const x of [-9.88, 7.63]) {
      for (let row = 0; row < 16; row++) {
        for (let z = -43.6; z < 44; z += 0.81) {
          const color = new THREE.Color('#a9795b').multiplyScalar(0.88 + random() * 0.28);
          bricks.push({ size: [0.09, 0.193, 0.793], position: [x, 0.11 + row * 0.205, z + (row % 2 ? 0.4 : 0)], color });
        }
      }
    }
    instances(this, m.wall, bricks).name = 'WestbahnhofIndividualBrickwork';
    for (let z = -40; z <= 40; z += 8) {
      masonryArch(this, [m.cutStone, m.ochreStone], {
        center: [-1.1, 3.2, z], radius: 8.77, rise: 3.51, thickness: 0.24, depth: 0.5,
        segments: 23, name: 'WestbahnhofMasonryArch',
      });
      box(this, m.ironwork, [17.42, 0.12, 0.12], [-1.1, 5.41, z]);
    }
    for (const z of [-32, -16, 0, 16, 32]) {
      cylinder(this, m.ironwork, 0.145, 5.24, [-8.3, 2.66, z], [0, 0, 0], 12);
      for (const [y, radius, height] of [[0.12, 0.37, 0.24], [0.34, 0.24, 0.13], [4.98, 0.21, 0.13], [5.21, 0.37, 0.23]]) {
        cylinder(this, y > 4 ? m.brass : m.ironwork, radius, height, [-8.3, y, z], [0, 0, 0], 12);
      }
      box(this, m.ironwork, [0.84, 0.1, 0.84], [-8.3, 0.05, z]);
      this.addCollider(-8.3, z, 0.85, 0.85);
      structuralMember(this, m.ironwork, [-8.3, 4.82, z], [-6.8, 5.43, z], 0.085);
    }
    for (const z of [-36, -20, -4, 12, 28, 40]) {
      for (const x of [-6.55, -1.6, 5.0]) {
        const roof = 3.3 + 3.65 * Math.sqrt(1 - ((x + 1.1) / 8.95) ** 2) - 0.05;
        lantern(this, m, [x, 4.28, z], roof);
      }
    }
    const clockRoof = 3.3 + 3.65 * Math.sqrt(1 - (5.05 / 8.95) ** 2) - 0.05;
    clock(this, m, [-6.15, 3.87, -8], 'WestbahnhofClassicClock-North', clockRoof);
    clock(this, m, [-6.15, 3.87, 24], 'WestbahnhofClassicClock-South', clockRoof);
    for (const z of [-30, 10]) label(this, 'WESTBAHNHOF  /  STADTEISENBAHN', 5.4, 0.43, [7.53, 4.25, z], {
      rotation: [0, -Math.PI / 2, 0], background: '#645341', color: '#eadfc1', fontSize: 62,
    });
    portals(this, m, 6.95);
  }
}

/** Arabellapark is absent from this repository; this adds its first U4 platform. */
export class ArabellaparkStation extends Station {
  constructor(materials, options = {}) {
    super(historicMaterials(materials, 'garden'), {
      id: 'u4-arabellapark', displayName: 'Arabellapark', lineId: 'U4',
      platformNumber: '04', destinationName: 'Kaiser-Humboldt-Platz', signageColor: U4_COLOR,
      platformSignColor: U4_COLOR, lineName: 'THE HISTORIC LINE', northCap: false, southCap: true,
      ...options,
    });
    this.theme = 'ceramic-garden';
    this.userData.stationTheme = this.theme;
    this.userData.historicArchitecture = {
      vaultType: 'pale-segmental', roofHeight: 6.45, transverseArches: 11,
      mosaicBands: 2, platformColumns: 5, wallTileColor: '#7b9b8c',
      newStation: true,
    };
    this.lightingOptions = {
      fixtures: false,
      pointDefinitions: [-28, -7, 14, 35].map(z => ({ position: [-3.6, 4.7, z], color: '#fff1da', intensity: 85, distance: 28 })),
    };
  }

  buildArchitecture(m) {
    historicWalls(this, m, 3.5);
    tileWalls(this, m.greenTile, { height: 1.82, seed: 896, alternating: true });
    elegantFloor(this, m);
    barrelVault(this, m.vaultStone, { spring: 3.25, rise: 3.2, name: 'ArabellaparkPaleSegmentalVault' });
    const diamonds = [], frames = [], lights = [], housings = [];
    for (const x of [-9.78, 7.53]) {
      for (let z = -42; z <= 42; z += 1.2) {
        diamonds.push({ size: [0.045, 0.18, 0.18], position: [x, 1.69, z], rotation: [Math.PI / 4, 0, 0] });
        frames.push({ size: [0.065, 0.6, 0.047], position: [x, 2.53, z] });
      }
    }
    instances(this, m.lightStone, diamonds).name = 'ArabellaparkCeramicDiamondFrieze';
    instances(this, m.cutStone, frames).name = 'ArabellaparkRaisedWallPattern';
    for (let z = -40; z <= 40; z += 8) {
      masonryArch(this, [m.lightStone, m.cutStone], {
        center: [-1.1, 3.17, z], radius: 8.76, rise: 3.05, thickness: 0.23, depth: 0.45,
        segments: 21, name: 'ArabellaparkCreamStoneArch',
      });
      for (const x of [-6.0, -1.3, 5.7]) {
        housings.push({ size: [0.28, 0.14, 3.15], position: [x, 5.22, z] });
        lights.push({ size: [0.19, 0.035, 2.92], position: [x, 5.128, z] });
        const roof = 3.25 + 3.2 * Math.sqrt(1 - ((x + 1.1) / 8.95) ** 2) - 0.01;
        const suspension = roof - 5.29;
        for (const dz of [-1.31, 1.31]) cylinder(this, m.brass, 0.014, suspension, [x, 5.29 + suspension / 2, z + dz], [0, 0, 0], 6);
      }
    }
    instances(this, m.ironwork, housings, undefined, false).name = 'ArabellaparkPeriodLightHousings';
    instances(this, m.tubeLight, lights, undefined, false).name = 'ArabellaparkNeutralStripLights';
    for (const z of [-32, -16, 0, 16, 32]) {
      box(this, m.cutStone, [0.74, 0.2, 0.82], [-8.3, 0.1, z]);
      box(this, m.lightStone, [0.56, 4.8, 0.64], [-8.3, 2.6, z]);
      box(this, m.greenTile, [0.6, 1.1, 0.68], [-8.3, 1.53, z]);
      box(this, m.ochreStone, [0.82, 0.16, 0.9], [-8.3, 4.96, z]);
      this.addCollider(-8.3, z, 0.77, 0.85);
    }
    portals(this, m, 6.45);
  }
}
