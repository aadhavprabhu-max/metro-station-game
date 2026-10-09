import * as THREE from 'three';
import { Station } from './station.js';
import { box, cylinder, instances, label } from './geometry.js';

const BLUE = '#3e71b6';
const OCULUS_CENTER_X = -1.2;
const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const up = new THREE.Vector3(0, 1, 0);

function materialsFor(base, variant) {
  const materials = { ...base };
  const colors = variant === 'bridge'
    ? { concrete: '#b6c3c9', tile: '#a9b8be', greenTile: '#526d82', wallTile: '#d1dbe0', beam: '#527084', dark: '#354854', wood: '#687980' }
    : { concrete: '#ccd1cf', tile: '#c9d0d1', greenTile: BLUE, wallTile: '#e1e6e3', beam: '#becbd1', dark: '#344852', wood: '#6f7f83' };
  for (const [key, color] of Object.entries(colors)) {
    materials[key] = base[key].clone();
    materials[key].color.set(color);
  }
  materials.tile.roughness = variant === 'landmark' ? 0.48 : 0.62;
  materials.structural = new THREE.MeshStandardMaterial({ color: variant === 'bridge' ? '#7b9bb0' : '#e6ecec', roughness: 0.44, metalness: 0.35 });
  materials.roofGlass = new THREE.MeshStandardMaterial({ color: '#c9dde5', roughness: 0.38, metalness: 0.08, transparent: true, opacity: 0.68, depthWrite: false, side: THREE.DoubleSide });
  materials.oculusLight = new THREE.MeshBasicMaterial({ color: '#fffbed', toneMapped: false, side: THREE.DoubleSide });
  return materials;
}

function beamEntry(a, b, radius) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const orientation = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
  return {
    position: start.add(end).multiplyScalar(0.5).toArray(),
    size: [radius, direction.length(), radius],
    rotation: new THREE.Euler().setFromQuaternion(orientation).toArray().slice(0, 3),
  };
}

function addBeamInstances(parent, material, entries, name, shadow = true) {
  const mesh = instances(parent, material, entries, beamGeometry, shadow);
  mesh.name = name;
  return mesh;
}

function roofPoint(fraction, angle) {
  const rx = THREE.MathUtils.lerp(6.2, 16, fraction);
  const rz = THREE.MathUtils.lerp(13, 55, fraction);
  return [
    OCULUS_CENTER_X + Math.cos(angle) * rx,
    9.75 + Math.pow(fraction, 0.62) * 4.6 + Math.cos(angle * 2) * 0.22,
    Math.sin(angle) * rz,
  ];
}

function roofHeightAt(x, z) {
  const dx = x - OCULUS_CENTER_X;
  let low = 0, high = 1;
  for (let index = 0; index < 20; index++) {
    const fraction = (low + high) / 2;
    const rx = THREE.MathUtils.lerp(6.2, 16, fraction);
    const rz = THREE.MathUtils.lerp(13, 55, fraction);
    if (dx * dx / (rx * rx) + z * z / (rz * rz) > 1) low = fraction;
    else high = fraction;
  }
  const fraction = (low + high) / 2;
  return roofPoint(fraction, Math.atan2(z / THREE.MathUtils.lerp(13, 55, fraction), dx / THREE.MathUtils.lerp(6.2, 16, fraction)))[1];
}

/** The canopy is a curved annulus, with a genuine open elliptical centre. */
export function createSchattenuferRoofGeometry(radialSegments = 64, rings = 8) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let ring = 0; ring <= rings; ring++) {
    const fraction = ring / rings;
    for (let column = 0; column <= radialSegments; column++) {
      positions.push(...roofPoint(fraction, column / radialSegments * Math.PI * 2));
      normals.push(0, -1, 0);
      uvs.push(column / radialSegments, fraction);
      if (ring < rings && column < radialSegments) {
        const a = ring * (radialSegments + 1) + column, b = a + 1;
        const c = a + radialSegments + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { signatureRoof: true, shape: 'elliptical-oculus-diagrid', radialSegments, rings, width: 32, length: 110, minHeight: 9.53, maxHeight: 14.57 };
  return geometry;
}

function buildWallsAndPortals(station, m, height, { roof = true } = {}) {
  box(station, m.concrete, [0.35, height, 90], [-10.1, height / 2 - 0.04, 0]);
  box(station, m.concrete, [0.4, height, 90], [7.85, height / 2 - 0.04, 0]);
  if (roof) box(station, m.concrete, [18.1, 0.25, 90], [-1.1, height + 0.08, 0]);
  const panels = [], lower = [];
  for (let z = -42; z <= 42; z += 3) {
    for (const x of [-9.9, 7.62]) {
      panels.push({ size: [0.07, 2.7, 2.965], position: [x, 2.33, z] });
      lower.push({ size: [0.095, 1.1, 2.965], position: [x, 0.55, z] });
    }
  }
  instances(station, m.wallTile, panels);
  instances(station, m.greenTile, lower);
  for (const z of [-44, 44]) {
    box(station, m.wallTile, [10.1, height, 0.4], [-5, height / 2, z]);
    box(station, m.wallTile, [2.9, height, 0.4], [6.4, height / 2, z]);
    box(station, m.concrete, [4.9, height - 4.1, 0.4], [2.45, (height + 4.1) / 2, z]);
    box(station, m.structural, [5.1, 0.24, 0.65], [2.45, 4.15, z]);
    const cap = z < 0 ? station.options.northCap : station.options.southCap;
    if (cap) box(station, m.rubber, [4.8, 5.1, 0.1], [2.45, 1.8, z + Math.sign(z) * 4], { shadow: false });
  }
}

function addColumns(station, m, heightAt) {
  const columnEntries = [], bases = [], capitals = [];
  for (const z of [-32, -16, 0, 16, 32]) {
    for (const x of [-8.3, 7.2]) {
      const height = typeof heightAt === 'function' ? heightAt(x, z) : heightAt;
      columnEntries.push({ position: [x, height / 2, z], size: [0.27, height, 0.27] });
      bases.push({ size: [0.67, 0.28, 0.77], position: [x, 0.14, z] });
      capitals.push({ size: [0.83, 0.28, 0.88], position: [x, height - 0.07, z] });
      if (x < 0) {
        station.addCollider(x, z, 0.67, 0.77);
        label(station, station.platformNumber, 0.37, 0.22, [x + 0.28, 1.8, z], { rotation: [0, Math.PI / 2, 0], background: BLUE, fontSize: 240 });
      }
    }
  }
  instances(station, m.structural, columnEntries, new THREE.CylinderGeometry(1, 1, 1, 12));
  instances(station, m.steel, bases);
  instances(station, m.structural, capitals);
}

function addStripFixtures(station, m, y, { length = 4.4, step = 8, positions = [-6, -1.3, 5.7] } = {}) {
  const housings = [], lamps = [], stems = [];
  for (let z = -40; z <= 40; z += step) {
    for (const x of positions) {
      housings.push({ size: [0.22, 0.1, length + 0.2], position: [x, y, z] });
      lamps.push({ size: [0.14, 0.025, length], position: [x, y - 0.06, z] });
      stems.push({ size: [0.025, 0.4, 0.025], position: [x, y + 0.22, z] });
    }
  }
  instances(station, m.dark, housings, undefined, false);
  instances(station, m.tubeLight, lamps, undefined, false);
  instances(station, m.structural, stems, undefined, false);
}

function lineOptions(displayName, options) {
  return {
    displayName, lineId: 'U3', lineName: 'THE MODERN LINE', platformNumber: '03',
    signageColor: BLUE, platformSignColor: BLUE, northCap: false, southCap: false, ...options,
  };
}

function lightingAt(height, color = '#edf3f4', intensity = 105) {
  return {
    fixtures: false, pointLights: 4,
    pointDefinitions: [-30, -10, 12, 33].map((z, index) => ({ position: [index % 2 ? 2.8 : -4.8, height, z], color, intensity, distance: 32 })),
  };
}

export class SchattenuferStation extends Station {
  constructor(materials, options = {}) {
    super(materialsFor(materials, 'landmark'), lineOptions('Schattenufer', { id: 'u3-schattenufer', ...options }));
    this.theme = 'modern-landmark';
    this.portalOffset = 44;
    this.architecture = { theme: this.theme, signature: 'elliptical-oculus-diagrid', roofWidth: 32, roofLength: 110, roofMinimum: 9.53, roofMaximum: 15.25 };
    this.lightingOptions = lightingAt(6.1, '#eef4f6', 115);
    this.lightingOptions.pointDefinitions[1].position[1] = 8.6;
    this.lightingOptions.pointDefinitions[1].distance = 37;
  }

  buildArchitecture(m) {
    buildWallsAndPortals(this, m, 4.4, { roof: false });
    const roof = new THREE.Group();
    roof.name = 'SchattenuferOculusRoof';
    roof.userData.dynamic = true;
    roof.userData.signatureRoof = true;
    this.add(roof);
    this.roofGroup = roof;
    const geometry = createSchattenuferRoofGeometry();
    const panels = new THREE.Mesh(geometry, m.roofGlass);
    panels.name = 'TranslucentDiagridPanels';
    panels.receiveShadow = true;
    panels.userData.signatureRoof = true;
    roof.add(panels);
    this.signatureRoof = panels;

    const crossLattice = [], hoops = [], primary = [], integratedLights = [];
    const radial = 64, rings = 7;
    for (let ring = 0; ring < rings; ring++) {
      for (let column = 0; column < radial; column++) {
        const a = column / radial * Math.PI * 2, b = (column + 1) / radial * Math.PI * 2;
        crossLattice.push(beamEntry(roofPoint(ring / rings, a), roofPoint((ring + 1) / rings, b), 0.078));
        crossLattice.push(beamEntry(roofPoint(ring / rings, b), roofPoint((ring + 1) / rings, a), 0.078));
      }
    }
    for (let ring = 0; ring <= rings; ring++) {
      for (let column = 0; column < radial; column++) {
        const a = column / radial * Math.PI * 2, b = (column + 1) / radial * Math.PI * 2;
        const entry = beamEntry(roofPoint(ring / rings, a), roofPoint(ring / rings, b), ring === 0 ? 0.18 : 0.1);
        hoops.push(entry);
        if (ring === 0 || ring === 4) {
          const lowA = roofPoint(ring / rings, a), lowB = roofPoint(ring / rings, b);
          lowA[1] -= 0.11; lowB[1] -= 0.11;
          integratedLights.push(beamEntry(lowA, lowB, 0.026));
        }
      }
    }
    for (let column = 0; column < 16; column++) {
      const angle = column / 16 * Math.PI * 2;
      for (let ring = 0; ring < 9; ring++) primary.push(beamEntry(roofPoint(ring / 9, angle), roofPoint((ring + 1) / 9, angle), 0.15));
    }
    addBeamInstances(roof, m.structural, crossLattice, 'WhiteSteelCrossDiagrid');
    addBeamInstances(roof, m.structural, hoops, 'EllipticalRoofHoops');
    addBeamInstances(roof, m.structural, primary, 'RadialPrimaryRibs');
    addBeamInstances(roof, m.tubeLight, integratedLights, 'IntegratedOculusLighting', false);

    // A fluted, gently curved light well gives the oculus genuine vertical depth.
    const collarPositions = [], collarIndices = [], flutes = [], innerRings = 10;
    for (let ring = 0; ring <= innerRings; ring++) {
      const fraction = ring / innerRings;
      const rx = 6.2 - Math.sin(fraction * Math.PI / 2) * 0.48;
      const rz = 13 - Math.sin(fraction * Math.PI / 2) * 0.8;
      for (let column = 0; column <= radial; column++) {
        const angle = column / radial * Math.PI * 2;
        const bottom = roofPoint(0, angle)[1];
        const y = THREE.MathUtils.lerp(bottom, 15.15, fraction);
        collarPositions.push(OCULUS_CENTER_X + Math.cos(angle) * rx, y, Math.sin(angle) * rz);
        if (ring < innerRings && column < radial) {
          const a = ring * (radial + 1) + column, b = a + 1, c = a + radial + 1;
          collarIndices.push(a, b, c, b, c + 1, c);
          if (column % 2 === 0) {
            const next = (ring + 1) / innerRings;
            flutes.push(beamEntry(
              [OCULUS_CENTER_X + Math.cos(angle) * rx, y, Math.sin(angle) * rz],
              [OCULUS_CENTER_X + Math.cos(angle) * (6.2 - Math.sin(next * Math.PI / 2) * 0.48), THREE.MathUtils.lerp(bottom, 15.15, next), Math.sin(angle) * (13 - Math.sin(next * Math.PI / 2) * 0.8)], 0.064,
            ));
          }
        }
      }
    }
    const collarGeometry = new THREE.BufferGeometry();
    collarGeometry.setAttribute('position', new THREE.Float32BufferAttribute(collarPositions, 3));
    collarGeometry.setIndex(collarIndices); collarGeometry.computeVertexNormals();
    const collar = new THREE.Mesh(collarGeometry, new THREE.MeshStandardMaterial({ color: '#e4e9e7', roughness: 0.63, metalness: 0.16, side: THREE.DoubleSide }));
    collar.name = 'CurvedFlutedOculusCollar';
    roof.add(collar);
    addBeamInstances(roof, m.structural, flutes, 'OculusVerticalFlutes');
    const ellipse = new THREE.Shape();
    ellipse.absellipse(0, 0, 5.72, 12.2, 0, Math.PI * 2, false);
    const diffuser = new THREE.Mesh(new THREE.ShapeGeometry(ellipse, 64), m.oculusLight);
    diffuser.rotation.x = Math.PI / 2;
    diffuser.position.set(OCULUS_CENTER_X, 15.16, 0);
    diffuser.name = 'IlluminatedOvalOculus';
    roof.add(diffuser);

    addColumns(this, m, (x, z) => roofHeightAt(x, z) - 0.12);
    const glazing = [], mullions = [];
    for (const x of [-10.02, 7.76]) {
      for (let z = -42; z <= 42; z += 3) {
        const top = roofHeightAt(x, z) - 0.07;
        glazing.push({ size: [0.04, top - 4.4, 2.95], position: [x, (top + 4.4) / 2, z] });
        mullions.push({ size: [0.07, top - 4.3, 0.06], position: [x, (top + 4.3) / 2, z + 1.48] });
      }
    }
    for (const z of [-44, 44]) {
      for (let x = -8.6; x <= 6.4; x += 3) {
        const top = roofHeightAt(x, z) - 0.07;
        glazing.push({ size: [2.95, top - 4.4, 0.04], position: [x, (top + 4.4) / 2, z] });
        mullions.push({ size: [0.06, top - 4.3, 0.07], position: [x + 1.48, (top + 4.3) / 2, z] });
      }
    }
    instances(this, m.roofGlass, glazing, undefined, false);
    instances(this, m.structural, mullions);
    addStripFixtures(this, m, 4.65, { length: 5.3, step: 10, positions: [-6, 5.7] });
  }
}

export class OstbahnhofStation extends Station {
  constructor(materials, options = {}) {
    const stationMaterials = materialsFor(materials, 'hub');
    super(stationMaterials, lineOptions('Ostbahnhof', { id: 'u3-ostbahnhof', ...options }));
    this.theme = 'modern-hub';
    this.portalOffset = 44;
    this.architecture = { theme: this.theme, signature: 'deep-coffer-urban-hall', roofMaximum: 8.33 };
    this.lightingOptions = lightingAt(5.8);
    // This second physical display shares the live timetable texture instead
    // of introducing a separate clock or fictional departure information.
    const repeater = new THREE.Group();
    repeater.name = 'OstbahnhofLiveDepartureRepeater';
    repeater.position.set(7.53, 3.84, 5);
    repeater.rotation.y = -Math.PI / 2;
    box(repeater, stationMaterials.dark, [4.32, 1.88, 0.12], [0, 0, 0]);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 1.66), new THREE.MeshBasicMaterial({ map: this.departures.texture, toneMapped: false }));
    screen.position.z = 0.07;
    repeater.add(screen);
    this.add(repeater);
    this.repeaterDisplay = screen;
  }

  buildArchitecture(m) {
    buildWallsAndPortals(this, m, 8.12);
    const coffers = [], frames = [], insetLights = [];
    for (let z = -40; z <= 40; z += 8) {
      frames.push({ size: [17.7, 0.46, 0.24], position: [-1.1, 7.45, z - 4] });
      for (const x of [-7.4, -3.4, 0.6, 4.6]) {
        coffers.push({ size: [3.68, 0.12, 7.6], position: [x, 7.96, z] });
        frames.push({ size: [0.22, 0.48, 7.78], position: [x - 1.98, 7.45, z] });
        insetLights.push({ size: [0.1, 0.025, 6.9], position: [x - 1.68, 7.54, z] });
      }
    }
    instances(this, m.wallTile, coffers);
    instances(this, m.structural, frames);
    instances(this, m.tubeLight, insetLights, undefined, false);
    addColumns(this, m, 7.34);
    addStripFixtures(this, m, 5.5, { length: 4.2 });

    for (const z of [-28, 6, 28]) {
      const sign = new THREE.Group();
      sign.position.set(-4.9, 4.18, z);
      sign.rotation.y = Math.PI;
      this.add(sign);
      box(sign, m.dark, [4.7, 0.8, 0.13], [0, 0, 0]);
      label(sign, 'U3  •  OSTBAHNHOF', 4.42, 0.29, [0, 0.2, 0.073], { background: '#263d4d', color: '#edf2f4', fontSize: 87 });
      label(sign, '↑  MAIN CONCOURSE  /  AUSGANG', 4.42, 0.23, [0, -0.16, 0.073], { background: '#263d4d', color: '#d9e1e8', fontSize: 66 });
      for (const x of [-1.8, 1.8]) box(sign, m.structural, [0.045, 1.5, 0.045], [x, 1.11, 0]);
    }
    for (const z of [-31, 24]) {
      label(this, 'OSTBAHNHOF  •  URBAN TRANSPORT HUB', 6.5, 0.52, [7.54, 4.83, z], { rotation: [0, -Math.PI / 2, 0], background: BLUE, color: '#edf2f6', fontSize: 66 });
      box(this, m.steel, [0.05, 0.08, 6.8], [7.55, 4.48, z]);
    }
  }
}

export class StadtbrueckeStation extends Station {
  constructor(materials, options = {}) {
    super(materialsFor(materials, 'bridge'), lineOptions('Stadtbrücke', { id: 'u3-stadtbruecke', ...options }));
    this.theme = 'modern-bridge';
    this.portalOffset = 44;
    this.architecture = { theme: this.theme, signature: 'repeating-tied-steel-arches', roofMaximum: 7.5 };
    this.lightingOptions = lightingAt(4.65, '#e9f0f5', 95);
  }

  buildArchitecture(m) {
    buildWallsAndPortals(this, m, 7.25);
    const arches = [], hangers = [], ties = [], longitudinal = [];
    for (let z = -40; z <= 40; z += 8) {
      const point = fraction => [-9.5 + fraction * 16.9, 4.62 + Math.sin(fraction * Math.PI) * 2.52, z];
      for (let segment = 0; segment < 18; segment++) arches.push(beamEntry(point(segment / 18), point((segment + 1) / 18), 0.13));
      ties.push({ size: [17.05, 0.17, 0.23], position: [-1.05, 4.59, z] });
      for (let segment = 2; segment < 18; segment += 2) {
        const top = point(segment / 18);
        hangers.push(beamEntry(top, [top[0], 4.69, z], 0.035));
      }
    }
    for (const x of [-8.4, -4.7, -1.05, 2.6, 6.3]) {
      const fraction = (x + 9.5) / 16.9;
      const y = 4.62 + Math.sin(fraction * Math.PI) * 2.52;
      longitudinal.push({ size: [0.13, 0.17, 86], position: [x, y, 0] });
    }
    addBeamInstances(this, m.structural, arches, 'RepeatedBridgeArches');
    addBeamInstances(this, m.steel, hangers, 'BridgeArchHangers');
    instances(this, m.structural, ties);
    instances(this, m.structural, longitudinal);
    addColumns(this, m, 4.52);
    addStripFixtures(this, m, 4.3, { length: 5.5 });
    for (const z of [-26, 12, 31]) {
      box(this, m.structural, [0.09, 0.8, 3.8], [7.49, 3.6, z]);
      label(this, 'U3  •  STADTBRÜCKE', 3.54, 0.42, [7.435, 3.65, z], { rotation: [0, -Math.PI / 2, 0], background: '#466478', fontSize: 85 });
    }
  }
}
