import * as THREE from 'three';
import { Station } from './station.js';
import { box, instances, label } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { getStationArchitecture } from './station-config.js';

const PILLARS = [-32, -16, 0, 16, 32];
const UNIT_CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 12);
const DISK = new THREE.CylinderGeometry(1, 1, 0.012, 20);
const SHRUB_GEOMETRY = new THREE.IcosahedronGeometry(1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const geometryCache = new Map();
const materialCache = new WeakMap();

function material(color, roughness = 0.75, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function familyMaterials(base, architecture) {
  let cache = materialCache.get(base);
  if (!cache) { cache = new Map(); materialCache.set(base, cache); }
  const key = `${architecture.family}:${JSON.stringify(architecture.palette)}`;
  if (cache.has(key)) return cache.get(key);
  const colors = architecture.palette;
  const m = { ...base };
  for (const [name, color] of Object.entries({
    concrete: colors.wall, wall: colors.wall, wallTile: colors.wall,
    greenTile: colors.accent, tile: colors.floor, beam: colors.metal,
  })) {
    m[name] = base[name].clone();
    m[name].color.set(color);
  }
  m.tile.roughness = architecture.family === 'green' ? 0.53 : 0.67;
  m.structure = material(colors.metal, 0.6, 0.38);
  m.edgeMetal = material('#abb9b5', 0.48, 0.62);
  m.ceramic = material(colors.wall, 0.58);
  m.ceramicCool = material('#c7d6dc', 0.57);
  m.ceramicWarm = material('#ddd1b4', 0.59);
  m.centreDisk = material(colors.metal, 0.7, 0.15);
  m.timber = material('#a39474', 0.88);
  m.brick = material(colors.accent, 0.94);
  m.mortar = material('#787c70', 0.95);
  m.greenCeramic = material(colors.accent, 0.44);
  m.soffit = material('#46534f', 0.92);
  m.glazing = new THREE.MeshStandardMaterial({
    color: '#b9d0d2', roughness: 0.32, metalness: 0.08,
    transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
  });
  m.daylight = new THREE.MeshStandardMaterial({
    color: '#c7dce4', emissive: '#bfd4df', emissiveIntensity: 0.38,
    roughness: 0.9, side: THREE.DoubleSide,
  });
  m.integratedLight = new THREE.MeshStandardMaterial({
    color: colors.warmth, emissive: colors.warmth, emissiveIntensity: 1.25, roughness: 0.6,
  });
  m.warmLight = new THREE.MeshStandardMaterial({
    color: '#f5d5a3', emissive: '#eec38d', emissiveIntensity: 1.35, roughness: 0.6,
  });
  m.harbourWater = new THREE.MeshStandardMaterial({ color: '#456f73', roughness: 0.35, metalness: 0.25 });
  m.vegetation = material('#5f7960', 0.98);
  m.leafLight = material('#829178', 0.98);
  for (const [name, value] of Object.entries(m)) if (!(name in base)) value.name = `StationFamily-${name}-${key}`;
  cache.set(key, m);
  return m;
}

function namedInstances(parent, m, entries, name, geometry, shadow = true) {
  if (!entries.length) return null;
  const mesh = instances(parent, m, entries, geometry, shadow);
  mesh.name = name;
  return mesh;
}

function memberEntry(from, to, width, depth = width) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  return {
    position: a.add(b).multiplyScalar(0.5).toArray(),
    size: [width, direction.length(), depth],
    rotation: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize())).toArray().slice(0, 3),
  };
}

/** Real recessed ceramic shell: raised centre, rounded rectangular lip, downward normals. */
export function createConcaveCeilingPanelGeometry() {
  if (geometryCache.has('concave-panel')) return geometryCache.get('concave-panel');
  const positions = [0, 0.24, 0], indices = [];
  const sides = 32, rings = 5;
  for (let ring = 1; ring <= rings; ring++) {
    const r = ring / rings;
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      positions.push(Math.sign(c) * Math.pow(Math.abs(c), 0.32) * 0.5 * r,
        0.24 * Math.pow(1 - r * r, 1.15),
        Math.sign(s) * Math.pow(Math.abs(s), 0.32) * 0.5 * r);
    }
  }
  for (let side = 0; side < sides; side++) indices.push(0, 1 + side, 1 + (side + 1) % sides);
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let side = 0; side < sides; side++) {
      const a = 1 + ring * sides + side, b = 1 + ring * sides + (side + 1) % sides;
      const c = a + sides, d = b + sides;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { shape: 'concave-rounded-rectangle', depth: 0.24, rings, sides, centreDiskSeparate: true };
  geometryCache.set('concave-panel', geometry);
  return geometry;
}

function vaultGeometry(rise, length = 88, profile = 'arched') {
  const key = `vault-${rise}-${length}-${profile}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const positions = [], indices = [];
  for (let side = 0; side <= 32; side++) {
    const t = side / 32;
    const lift = profile === 'double-pitch' ? 1 - Math.abs(t * 2 - 1) : Math.sin(t * Math.PI);
    for (const z of [-length / 2, length / 2]) positions.push(-9.92 + t * 17.65, rise * lift, z);
    if (side < 32) { const a = side * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometryCache.set(key, geometry);
  return geometry;
}

function roofHeight(config, x) {
  const t = THREE.MathUtils.clamp((x + 9.92) / 17.65, 0, 1);
  const lift = config.glassMode === 'double-pitch' ? 1 - Math.abs(t * 2 - 1) : Math.sin(t * Math.PI);
  return config.ceilingHeight + config.roofRise * lift;
}

function buildSideWall(station, m, x, height) {
  const opening = x < 0 ? station.options.backwallOpening : null;
  const sections = opening ? [
    [-45, opening.z - opening.width / 2], [opening.z + opening.width / 2, 45],
  ] : [[-45, 45]];
  for (const [start, end] of sections) if (end > start) box(station, m.concrete, [0.3, height, end - start], [x, height / 2 - 0.04, (start + end) / 2]);
  if (opening && height > (opening.height ?? 3.05)) {
    const head = opening.height ?? 3.05;
    box(station, m.concrete, [0.3, height - head, opening.width], [x, (height + head) / 2, opening.z]);
  }
}

function buildEnds(station, m, height) {
  for (const z of [-44, 44]) {
    const opening = station.options.platformEndOpenings?.find(item => Math.abs(item.z - z) < 0.01);
    const areas = opening ? [[-10.05, opening.minX], [opening.maxX, 0.05]] : [[-10.05, 0.05]];
    for (const [from, to] of areas) if (to > from) box(station, m.wall, [to - from, height, 0.4], [(to + from) / 2, height / 2, z]);
    if (opening) {
      const head = opening.height ?? 3.05;
      box(station, m.wall, [opening.maxX - opening.minX, height - head, 0.4], [(opening.minX + opening.maxX) / 2, (height + head) / 2, z]);
    }
    box(station, m.wall, [2.9, height, 0.4], [6.4, height / 2, z]);
    box(station, m.wall, [4.9, height - 4.15, 0.4], [2.45, (height + 4.15) / 2, z]);
    box(station, m.structure, [5.1, 0.2, 0.56], [2.45, 4.15, z]);
    const cap = z < 0 ? station.options.northCap : station.options.southCap;
    if (cap) box(station, m.rubber, [4.8, 5.1, 0.1], [2.45, 1.8, z + Math.sign(z) * 4], { shadow: false });
  }
}

function buildWalls(station, m, config) {
  buildSideWall(station, m, -10.1, config.ceilingHeight);
  const glazed = ['waterfront', 'green'].includes(config.family) || config.openAir;
  const sill = config.family === 'waterfront' ? 0.55 : 1.15;
  buildSideWall(station, m, 7.85, glazed ? sill : config.ceilingHeight);
  const panels = [], bands = [], reveals = [], glass = [];
  for (let z = -43.1; z < 44; z += config.wallBay) {
    const depth = Math.min(config.wallBay - 0.035, 43.9 - z + config.wallBay / 2);
    for (const x of [-9.9, 7.62]) {
      for (const section of station.wallPanelSections(x, z, depth)) {
        const lowWall = glazed && x > 0;
        panels.push({ size: [0.065, lowWall ? sill - 0.12 : 2.4, section.depth], position: [x, lowWall ? sill / 2 : 2.32, section.z] });
        bands.push({ size: [0.085, lowWall ? sill - 0.1 : 1.05, section.depth], position: [x, lowWall ? sill / 2 : 0.58, section.z] });
        reveals.push({ size: [0.115, 0.055, section.depth], position: [x, lowWall ? sill : 1.13, section.z] });
        if (glazed && x > 0) {
          glass.push({ size: [0.05, config.ceilingHeight - sill - 0.15, section.depth], position: [7.7, (config.ceilingHeight + sill) / 2, section.z] });
          box(station, m.structure, [0.1, config.ceilingHeight - sill, 0.1], [7.67, (config.ceilingHeight + sill) / 2, section.z + section.depth / 2]);
        }
      }
    }
  }
  namedInstances(station, m.wallTile, panels, 'FamilyWallPanels');
  namedInstances(station, m.greenTile, bands, 'FamilyCeramicDado');
  namedInstances(station, m.structure, reveals, 'FamilyWallReveals', undefined, false);
  namedInstances(station, m.glazing, glass, 'FamilyWaterfrontClerestory', undefined, false);
  buildEnds(station, m, config.ceilingHeight + config.roofRise + 0.2);
}

function buildColumns(station, m, config, group) {
  const cores = [], bases = [], capitals = [];
  for (const z of PILLARS) {
    // Capitals meet the roof cavity, instead of leaving floating column ends
    // beneath the raised centres of moulded ceramic panels.
    const height = config.family === 'scandinavian' ? roofHeight(config, -8.3) + 0.23
      : ['refined', 'radial'].includes(config.family) ? config.ceilingHeight + 0.13
        : roofHeight(config, -8.3) + 0.1;
    const round = config.columnProfile === 'round';
    cores.push({ size: round ? [0.28, height, 0.28] : [0.56, height, 0.64], position: [-8.3, height / 2, z] });
    bases.push({ size: [0.67, 0.17, 0.77], position: [-8.3, 0.085, z] });
    capitals.push({ size: [0.65, 0.18, 0.74], position: [-8.3, height - 0.05, z] });
    station.addCollider(-8.3, z, 0.67, 0.77);
    label(station, station.platformNumber, 0.38, 0.22, [-7.97, 1.8, z], {
      rotation: [0, Math.PI / 2, 0], fontSize: 250,
      background: station.options.platformSignColor ?? '#496a60',
    });
  }
  namedInstances(group, m.structure, cores, 'FamilyPlatformColumns', config.columnProfile === 'round' ? UNIT_CYLINDER : undefined);
  namedInstances(group, m.edgeMetal, bases, 'FamilyColumnPlinths');
  namedInstances(group, m.structure, capitals, 'FamilyColumnCapitals');
}

function linearLights(group, m, config, positions = [-5.9, -1.15, 5.5]) {
  const channels = [], lights = [], hangers = [];
  for (const x of positions) {
    const y = Math.min(roofHeight(config, x) - 0.12, config.ceilingHeight - 0.03);
    channels.push({ size: [0.2, 0.105, 87.5], position: [x, y, 0] });
    lights.push({ size: [0.08, 0.022, 87.3], position: [x, y - 0.063, 0] });
    const top = roofHeight(config, x) + 0.02;
    if (top > y + 0.12) for (let z = -40; z <= 40; z += 8) {
      hangers.push({ size: [0.018, top - y - 0.04, 0.018], position: [x, (top + y + 0.04) / 2, z] });
    }
  }
  namedInstances(group, m.soffit, channels, 'FamilyIntegratedLightChannels', undefined, false);
  namedInstances(group, m.integratedLight, lights, 'FamilyIntegratedLightDiffusers', undefined, false);
  namedInstances(group, m.structure, hangers, 'FamilyIntegratedLightMounts', undefined, false);
}

function ceramicCeiling(station, group, m, config) {
  const ceramic = [[], [], []], disks = [];
  const geometry = createConcaveCeilingPanelGeometry();
  const nominalPitch = THREE.MathUtils.clamp(config.structuralBay / 2, 2.25, 3.6);
  const rows = Math.floor(87.2 / nominalPitch), spacing = 87.2 / rows;
  for (let column = 0; column < 8; column++) {
    const x = -8.78 + column * 2.18;
    const y = roofHeight(config, x);
    const slope = Math.atan(config.roofRise * Math.PI / 17.65 * Math.cos((x + 9.92) / 17.65 * Math.PI));
    for (let row = 0; row < rows; row++) {
      const z = -43.6 + (row + 0.5) * spacing;
      const type = config.warmPanels || column > 5 ? 2 : column < 2 ? 1 : 0;
      ceramic[type].push({ position: [x, y, z], size: [2.11, 1, spacing - 0.08], rotation: [0, 0, slope] });
      disks.push({ position: [x - Math.sin(slope) * 0.224, y + Math.cos(slope) * 0.224, z], size: [config.diskRadius ?? 0.22, 1, config.diskRadius ?? 0.22], rotation: [0, 0, slope] });
    }
  }
  const meshes = ceramic.map((entries, i) => namedInstances(group, [m.ceramic, m.ceramicCool, m.ceramicWarm][i], entries,
    ['MouldedCeramicNeutralPanels', 'MouldedCeramicCoolPanels', 'MouldedCeramicWarmPanels'][i], geometry));
  namedInstances(group, m.centreDisk, disks, 'RecessedCeramicCentreDisks', DISK, false);
  // The opaque cavity follows the actual curvature, safely behind the bowls.
  const backing = new THREE.Mesh(vaultGeometry(config.roofRise), m.soffit);
  backing.position.y = config.ceilingHeight + 0.29;
  backing.material.side = THREE.DoubleSide;
  group.add(backing);
  station.signatureRoof = meshes.find(Boolean);
  station.ceilingPanelGeometry = geometry;
  group.userData.ceiling = { shape: 'concave-rounded-rectangular-modules', cells: rows * 8, centralDisks: rows * 8, panelDepth: 0.24, modulePitch: spacing };
  linearLights(group, m, config);
}

function frameRoof(group, m, config, mode) {
  const transverse = [], braces = [], longitudinal = [];
  const roof = new THREE.Mesh(vaultGeometry(config.roofRise, 88, config.glassMode), mode === 'glass' ? m.glazing : m.soffit);
  roof.position.y = config.ceilingHeight + 0.12;
  roof.material.side = THREE.DoubleSide;
  roof.name = mode === 'glass' ? 'ContinuousGlazedCanopy' : 'ContinuousStructuralRoof';
  roof.userData.dynamic = true;
  group.add(roof);
  if (mode === 'glass') {
    const cavity = new THREE.Mesh(vaultGeometry(config.roofRise, 88, config.glassMode), m.daylight);
    cavity.position.y = config.ceilingHeight + 0.4;
    cavity.name = 'ThreeDimensionalDaylightRoofCavity'; group.add(cavity);
  }
  for (let z = -42; z <= 42; z += config.structuralBay) {
    const parts = mode === 'industrial' ? 4 : 8;
    for (let part = 0; part < parts; part++) {
      const x1 = -9.9 + part / parts * 17.6, x2 = -9.9 + (part + 1) / parts * 17.6;
      const a = [x1, roofHeight(config, x1), z], b = [x2, roofHeight(config, x2), z];
      transverse.push(memberEntry(a, b, mode === 'industrial' ? 0.22 : config.ribWidth ?? 0.13, mode === 'industrial' ? 0.28 : 0.15));
      if (mode === 'industrial' || mode === 'events') {
        const low = config.ceilingHeight - (config.trussDepth ?? 0.7);
        transverse.push(memberEntry([x1, low, z], [x2, low, z], 0.12, 0.15));
        const rising = config.bracePattern === 'pratt' ? part < parts / 2 : part % 2 === 0;
        braces.push(memberEntry([x1, rising ? low : a[1], z], [x2, rising ? b[1] : low, z], 0.065, 0.08));
        if (config.bracePattern === 'diamond') braces.push(memberEntry([x1, rising ? a[1] : low, z], [x2, rising ? low : b[1], z], 0.05, 0.06));
        if (config.bracePattern === 'fan') braces.push(memberEntry([-1.1, low - 0.18, z], b, 0.075, 0.09));
        braces.push(memberEntry([x1, low, z], a, 0.065, 0.08));
      }
    }
  }
  for (const x of [-9.65, -6.2, -1.1, 3.8, 7.55]) {
    longitudinal.push({ size: [0.1, mode === 'industrial' ? 0.27 : 0.13, 88], position: [x, roofHeight(config, x) - 0.04, 0] });
  }
  namedInstances(group, m.structure, transverse, 'FamilyTransverseRoofRibs');
  namedInstances(group, m.structure, braces, 'FamilyTriangulatedRoofBracing');
  namedInstances(group, m.structure, longitudinal, 'FamilyLongitudinalPurlins');
  if (config.glassMode === 'sawtooth') {
    const teeth = [];
    for (let z = -39; z < 42; z += 7) teeth.push({ size: [17.4, 0.12, 1.7], position: [-1.1, config.ceilingHeight + 0.45, z], rotation: [0.2, 0, 0] });
    namedInstances(group, m.daylight, teeth, 'SawtoothRoofLanterns', undefined, false);
  }
  linearLights(group, m, config);
  return roof;
}

function brickVault(station, group, m, config) {
  station.signatureRoof = frameRoof(group, m, config, 'masonry');
  station.signatureRoof.material = m.brick;
  const courses = [], arches = [];
  for (let y = 0.45; y <= 3.5; y += 0.3) for (const x of [-9.78, 7.51]) {
    // Mortar follows the same cut sections as the solid wall at a passage.
    for (const section of station.wallPanelSections(x, 0, 87.7)) courses.push({ size: [0.055, 0.018, section.depth], position: [x, y, section.z] });
  }
  // Real arch voussoirs express the masonry depth at every structural bay.
  for (let z = -41; z <= 41; z += config.structuralBay) for (let segment = 0; segment < 20; segment++) {
    const x = -9.48 + segment * 0.88;
    const slope = Math.atan(config.roofRise * Math.PI / 17.65 * Math.cos((x + 9.92) / 17.65 * Math.PI));
    arches.push({ size: [0.87, 0.22, 0.32], position: [x, roofHeight(config, x) - 0.13, z], rotation: [0, 0, slope] });
  }
  namedInstances(group, m.wallTile, arches, 'MasonryVaultVoussoirs');
  // A small number of long mortar courses, rather than thousands of tiny bricks.
  namedInstances(group, m.mortar, courses, 'BrickWallMortarCourses', undefined, false);
}

function cofferCeiling(station, group, m, config) {
  const frame = [], inset = [];
  const depth = config.cofferDepth ?? 0.45;
  for (let z = -44; z < 44; z += config.structuralBay) {
    frame.push({ size: [17.65, depth, 0.24], position: [-1.1, config.ceilingHeight - depth / 2, z] });
    const end = Math.min(z + config.structuralBay, 44), length = end - z;
    for (const x of [-8.8, -5, -1.1, 2.8, 6.6]) {
      inset.push({ size: [3.48, 0.025, Math.max(0.05, length - 0.32)], position: [x, config.ceilingHeight + 0.08, (z + end) / 2] });
    }
  }
  for (const x of [-9.9, -6.9, -3.1, 0.8, 4.7, 7.65]) frame.push({ size: [0.22, depth, 88], position: [x, config.ceilingHeight - depth / 2, 0] });
  station.signatureRoof = namedInstances(group, m.structure, frame, 'DeepBronzeStoneCeilingCoffers');
  namedInstances(group, m.ceramic, inset, 'RecessedWarmCofferPanels');
  box(group, m.soffit, [17.8, 0.12, 89], [-1.1, config.ceilingHeight + 0.2, 0]);
  linearLights(group, m, config);
}

function greenRoof(station, group, m, config) {
  station.signatureRoof = frameRoof(group, m, config, 'glass');
  const baffles = [], ceramics = [], planting = [], stems = [];
  const coverage = config.canopyCoverage ?? 0.8;
  for (let z = -43; z < 44; z += 0.8) {
    baffles.push({ size: [17.4 * coverage, 0.18, 0.055], position: [-1.1, config.ceilingHeight - 0.08, z] });
  }
  for (let z = -42; z <= 42; z += 1.8) {
    for (const x of [-9.79, 7.51]) for (const section of station.wallPanelSections(x, z, 1.72)) {
      ceramics.push({ size: [0.06, 0.42, section.depth], position: [x, 1.55, section.z] });
    }
  }
  for (let z = -35; z <= 35; z += config.planterRhythm ?? 10) {
    // Outside the public platform and train envelope, behind the far service ledge.
    box(group, m.concrete, [1.1, 0.6, 3.2], [8.65, 0.2, z]);
    for (let shrub = 0; shrub < 5; shrub++) {
      const sx = 8.5 + (shrub % 2) * 0.3, sz = z - 1.1 + shrub * 0.55;
      planting.push({ position: [sx, 0.95 + (shrub % 3) * 0.12, sz], size: [0.48, 0.68, 0.46] });
      stems.push({ position: [sx, 0.45, sz], size: [0.035, 0.8, 0.035] });
    }
  }
  namedInstances(group, m.timber, baffles, 'GreenStationTimberRoofBaffles');
  namedInstances(group, m.greenCeramic, ceramics, 'GreenStationCeramicWallReliefs');
  namedInstances(group, m.vegetation, planting, 'RestrainedServiceLedgePlanting', SHRUB_GEOMETRY);
  namedInstances(group, m.timber, stems, 'ServiceLedgePlantStems');
  if (config.calmWater) {
    box(group, m.harbourWater, [1.8, 0.025, 20], [9.1, -0.25, 0], { shadow: false });
    box(group, m.greenCeramic, [0.15, 0.45, 20.2], [10.04, -0.12, 0]);
  }
}

function harbour(group, m) {
  // Actual original harbour geometry outside the glazed hall. No image or backdrop.
  box(group, m.concrete, [4, 1.7, 88], [10.2, -1.05, 0]);
  box(group, m.harbourWater, [23, 0.05, 88], [23.6, -1.6, 0], { shadow: false });
  const girders = [], bollards = [], rails = [];
  for (let z = -37; z <= 37; z += 8) {
    bollards.push({ position: [11.2, 0.05, z], size: [0.22, 0.5, 0.22] });
    girders.push({ size: [0.22, 2.5, 0.26], position: [12.3, -0.1, z] });
  }
  for (const z of [-23, 24]) {
    for (const x of [17, 26]) girders.push({ size: [0.34, 12, 0.44], position: [x, 4.6, z] });
    girders.push({ size: [13.5, 0.55, 0.7], position: [22, 10.6, z] });
    girders.push(memberEntry([17, 10.5, z], [26, 7.8, z], 0.1));
    girders.push(memberEntry([17, 7.8, z], [26, 10.5, z], 0.1));
    rails.push({ size: [0.045, 8.5, 0.045], position: [25.3, 5.9, z] });
    box(group, m.structure, [0.55, 0.45, 0.55], [25.3, 1.5, z]);
  }
  namedInstances(group, m.structure, girders, 'HarbourQuayAndStationaryCraneGirders');
  namedInstances(group, m.dark, bollards, 'HarbourQuayBollards', UNIT_CYLINDER);
  namedInstances(group, m.dark, rails, 'HarbourCraneCables', undefined, false);
  box(group, m.structure, [4.5, 1.9, 11], [24, -0.8, 5]);
  box(group, m.wallTile, [2.6, 1.7, 4], [24, 0.9, 7]);
}

function airportRoof(station, group, m, config) {
  station.signatureRoof = frameRoof(group, m, config, 'glass');
  const fins = [];
  for (let z = -43; z <= 43; z += config.finSpacing ?? 1.35) {
    fins.push({ size: [17.5, 0.4, 0.06], position: [-1.1, config.ceilingHeight - 0.25, z] });
  }
  namedInstances(group, m.edgeMetal, fins, 'AirportContinuousLinearCeilingFins');
}

function radialRoof(station, group, m, config) {
  const spokes = [], rings = [];
  box(group, m.soffit, [17.8, 0.16, 88.5], [-1.1, config.ceilingHeight + config.roofRise + 0.2, 0]);
  for (const z0 of [-27, 0, 27]) {
    for (let i = 0; i < config.spokes; i++) {
      const a = i / config.spokes * Math.PI * 2;
      spokes.push(memberEntry([-1.1 + Math.cos(a) * 1.4, config.ceilingHeight + config.roofRise, z0 + Math.sin(a) * 2.1],
        [-1.1 + Math.cos(a) * 8.5, config.ceilingHeight, z0 + Math.sin(a) * 12.6], 0.11, 0.15));
    }
    for (const radius of [1.4, config.ringRadius ?? 5.2, 8.5]) for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2, b = (i + 1) / 48 * Math.PI * 2;
      const y = config.ceilingHeight + config.roofRise * (1 - radius / 8.5);
      rings.push(memberEntry([-1.1 + Math.cos(a) * radius, y, z0 + Math.sin(a) * radius * 1.48],
        [-1.1 + Math.cos(b) * radius, y, z0 + Math.sin(b) * radius * 1.48], 0.06, 0.08));
    }
  }
  station.signatureRoof = namedInstances(group, m.structure, spokes, 'RingplatzRadialCeilingSpokes');
  namedInstances(group, m.integratedLight, rings, 'RingplatzEllipticalRoofLightRings', undefined, false);
  linearLights(group, m, config);
}

/** New stations use the existing playable platform, railway, furniture and board. */
export class FamilyStation extends Station {
  constructor(materials, options = {}) {
    const architecture = options.architecture ?? getStationArchitecture(options.id, options.lineId);
    if (!architecture.palette || architecture.preserved) throw new Error(`Use the existing bespoke station for ${options.id}.`);
    const palette = familyMaterials(materials, architecture);
    super(palette, { ...options, architecture });
    this.theme = architecture.family;
    this.architecture = architecture;
    this.portalOffset = 44;
    this.userData.stationTheme = this.theme;
    this.userData.architecture = {
      family: architecture.family, signature: architecture.signature,
      ceilingHeight: architecture.ceilingHeight, roofRise: architecture.roofRise,
      structuralBay: architecture.structuralBay, wallBay: architecture.wallBay,
      platformPreserved: true, trackPreserved: true,
    };
    const light = architecture.lighting;
    this.lightingOptions = {
      fixtures: false, pointLights: 4,
      pointDefinitions: [-28, -7, 14, 35].map((z, index) => ({
        position: [index % 2 ? -2.3 : -5.0, Math.min(light.height, architecture.ceilingHeight - 0.7), z],
        color: light.color, intensity: light.intensity, distance: light.distance,
      })),
    };
  }

  buildArchitecture(m) {
    const config = this.options.architecture;
    buildWalls(this, m, config);
    const signature = new THREE.Group();
    signature.name = `StationFamily-${config.signature}`;
    signature.userData.signatureArchitecture = config.family;
    this.add(signature);
    this.signatureGroup = this.ceilingGroup = signature;
    buildColumns(this, m, config, signature);
    switch (config.family) {
      case 'scandinavian': ceramicCeiling(this, signature, m, config); break;
      case 'brick': brickVault(this, signature, m, config); break;
      case 'refined': cofferCeiling(this, signature, m, config); break;
      case 'green': greenRoof(this, signature, m, config); break;
      case 'airport': airportRoof(this, signature, m, config); break;
      case 'radial': radialRoof(this, signature, m, config); break;
      case 'waterfront':
        this.signatureRoof = frameRoof(signature, m, config, 'industrial'); harbour(signature, m); break;
      case 'industrial': this.signatureRoof = frameRoof(signature, m, config, 'industrial'); break;
      case 'events': this.signatureRoof = frameRoof(signature, m, config, 'events'); break;
      case 'glass': this.signatureRoof = frameRoof(signature, m, config, 'glass'); break;
      default: this.signatureRoof = frameRoof(signature, m, config, 'urban'); break;
    }
    if (config.cycleRacks) {
      const racks = [];
      for (let z = 17; z <= 27; z += 1.4) {
        racks.push({ size: [0.05, 0.8, 0.05], position: [6.8, 0.4, z] });
        racks.push({ size: [0.05, 0.8, 0.05], position: [7.35, 0.4, z] });
        racks.push({ size: [0.6, 0.05, 0.05], position: [7.075, 0.8, z] });
      }
      namedInstances(signature, m.edgeMetal, racks, 'SuburbanCycleParkingStands');
    }
    batchStaticGeometry(signature);
    signature.userData.dynamic = true;
    signature.userData.staticArchitecture = true;
  }
}
