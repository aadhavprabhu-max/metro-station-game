import * as THREE from 'three';
import { box, cylinder, label } from './geometry.js';

const REAR_Z = 1.35;
const GLASS_ANGLE = 1.2;
const BOTTOM_Y = 0.105;
const TOP_Y = 3.07;
const crossSection = [
  [0.105, 1.19, -0.27], [0.25, 1.30, -0.49],
  [0.60, 1.345, -0.645], [1.02, 1.35, -0.66],
  [1.35, 1.35, -0.575], [1.80, 1.35, -0.405],
  [2.25, 1.35, -0.175], [2.47, 1.35, -0.02],
  [2.57, 1.42, 0.065], [2.74, 1.39, 0.23],
  [2.90, 1.245, 0.43], [3.02, 1.06, 0.67],
  [3.07, 0.99, 0.80],
];

function sectionAt(y) {
  for (let index = 1; index < crossSection.length; index++) {
    const before = crossSection[index - 1], after = crossSection[index];
    if (y > after[0]) continue;
    const fraction = THREE.MathUtils.clamp((y - before[0]) / (after[0] - before[0]), 0, 1);
    return [THREE.MathUtils.lerp(before[1], after[1], fraction), THREE.MathUtils.lerp(before[2], after[2], fraction)];
  }
  return crossSection.at(-1).slice(1);
}

/** Angular profile rings create a genuinely rounded nose in all three axes. */
function surfacePoint(angle, y, offset = 0) {
  const [halfWidth, frontZ] = sectionAt(y);
  return [
    (halfWidth + offset) * Math.sin(angle), y,
    REAR_Z - (REAR_Z - frontZ + offset) * Math.cos(angle),
  ];
}

function glassBottom(angle) {
  return 1.35 + 0.085 * Math.min(1, (angle / GLASS_ANGLE) ** 2);
}

function glassTop(angle) {
  return 2.60 - 0.08 * Math.min(1, (angle / GLASS_ANGLE) ** 2);
}

function curvedGeometry(startAngle, endAngle, bottom, top, columns = 40, rows = 8, offset = 0) {
  const position = [], uv = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, u);
      const y = THREE.MathUtils.lerp(typeof bottom === 'function' ? bottom(angle) : bottom,
        typeof top === 'function' ? top(angle) : top, v);
      position.push(...surfacePoint(angle, y, offset));
      // The cab faces -Z, so viewed from outside its readable left-to-right
      // texture direction is the reverse of increasing world X.
      uv.push(1 - u, v);
      if (row === rows || column === columns) continue;
      const a = row * (columns + 1) + column, b = a + 1, d = a + columns + 1, c = d + 1;
      indices.push(a, d, b, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { curved: true, compoundCurvature: true, angularProfile: true, rearLocalZ: REAR_Z };
  return geometry;
}

function profileCap(y, top) {
  const positions = [0, y, REAR_Z], uv = [0.5, 1], indices = [];
  const segments = 42;
  for (let step = 0; step <= segments; step++) {
    const angle = -Math.PI / 2 + Math.PI * step / segments;
    const point = surfacePoint(angle, y);
    positions.push(...point);
    uv.push((Math.sin(angle) + 1) / 2, Math.cos(angle));
    if (step < segments) indices.push(0, top ? step + 2 : step + 1, top ? step + 1 : step + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { curved: true, role: 'cab-profile-cap', rearLocalZ: REAR_Z };
  return geometry;
}

function panel(parent, name, material, geometry, { shadow = true, dynamic = false } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  mesh.userData.dynamic = dynamic;
  parent.add(mesh);
  return mesh;
}

function curvedLabel(parent, text, startAngle, endAngle, bottom, top, options) {
  const mesh = label(parent, text, 1.3, top - bottom, [0, 0, 0], options);
  mesh.geometry = curvedGeometry(startAngle, endAngle, bottom, top, 28, 2, 0.016);
  mesh.scale.set(1, 1, 1);
  mesh.name = 'AurealisCabBranding';
  return mesh;
}

export function buildRoundedCab(car, m, end, leading) {
  const cab = new THREE.Group();
  cab.name = leading ? 'FrontCab' : 'RearCab';
  cab.position.z = end * 7.9;
  if (end === 1) cab.rotation.y = Math.PI;
  cab.userData.end = end;
  cab.userData.geometryRole = 'rounded-aerodynamic-cab';
  const blue = m.trainBlue ?? m.whitePaint;
  const silver = m.trainSilver ?? m.aluminum;
  const charcoal = m.cabCharcoal ?? m.dark;
  const shellGeometries = [];
  const shellPart = (name, material, geometry) => {
    geometry.userData.role = 'rounded-cab-shell';
    shellGeometries.push(geometry);
    return panel(cab, name, material, geometry);
  };

  shellPart('RoundedCabLowerNose', charcoal, curvedGeometry(-Math.PI / 2, Math.PI / 2, BOTTOM_Y, 1.02, 42, 10));
  shellPart('RoundedCabBlueApron', blue, curvedGeometry(-Math.PI / 2, Math.PI / 2, 1.02, glassBottom, 42, 5));
  shellPart('RoundedCabBrow', blue, curvedGeometry(-Math.PI / 2, Math.PI / 2, glassTop, 2.74, 42, 4));
  shellPart('RoundedCabRoofShoulder', silver, curvedGeometry(-Math.PI / 2, Math.PI / 2, 2.74, TOP_Y, 42, 7));
  for (const side of [-1, 1]) {
    const from = side < 0 ? -Math.PI / 2 : GLASS_ANGLE;
    const to = side < 0 ? -GLASS_ANGLE : Math.PI / 2;
    shellPart('RoundedCabWindowPillar', blue, curvedGeometry(from, to, glassBottom, glassTop, 7, 12));
  }
  shellPart('RoundedCabRoofCap', silver, profileCap(TOP_Y, true));
  shellPart('RoundedCabFloorCap', charcoal, profileCap(BOTTOM_Y, false));

  // The shell is absent in this aperture. The glass is a separately curved
  // sheet, rather than a flat rectangle pasted over an opaque end wall.
  const windshieldGeometry = curvedGeometry(-GLASS_ANGLE + 0.055, GLASS_ANGLE - 0.055,
    angle => glassBottom(angle) + 0.043, angle => glassTop(angle) - 0.043, 40, 18, 0.010);
  windshieldGeometry.userData = { ...windshieldGeometry.userData, role: 'panoramic-windshield', opaqueBacking: false };
  const windshield = panel(cab, 'PanoramicWindshield', m.cabGlass, windshieldGeometry, { dynamic: true });
  windshield.userData.geometryRole = 'panoramic-windshield';
  windshield.userData.opaqueBacking = false;
  // Metal perimeter and an inner rubber gasket follow the exact same surface;
  // explicit offsets keep each layer separated without z-fighting.
  for (const [name, material, angleInset, heightInset, offset] of [
    ['CabSilverWindowPerimeter', silver, 0, 0, 0.006],
    ['CabRubberWindowGasket', m.rubber, 0.026, 0.020, 0.008],
  ]) {
    const edge = GLASS_ANGLE - angleInset;
    const strip = material === silver ? 0.026 : 0.030;
    for (const side of [-1, 1]) {
      const from = side < 0 ? -edge : edge - strip;
      const to = side < 0 ? -edge + strip : edge;
      panel(cab, name, material, curvedGeometry(from, to,
        angle => glassBottom(angle) + heightInset, angle => glassTop(angle) - heightInset, 2, 14, offset));
    }
    panel(cab, name, material, curvedGeometry(-edge, edge,
      angle => glassBottom(angle) + heightInset, angle => glassBottom(angle) + heightInset + strip, 40, 1, offset));
    panel(cab, name, material, curvedGeometry(-edge, edge,
      angle => glassTop(angle) - heightInset - strip, angle => glassTop(angle) - heightInset, 40, 1, offset));
  }

  panel(cab, 'CabDestinationSurround', m.rubber, curvedGeometry(-0.69, 0.69, 2.625, 2.865, 28, 3, 0.007));
  const display = car.addDestinationDisplay(cab, 1.8, 0.19, [0, 0, 0], {
    background: '#101c25', color: '#ead4a0', fontSize: 81,
  });
  display.geometry = curvedGeometry(-0.655, 0.655, 2.65, 2.84, 32, 3, 0.018);
  display.scale.set(1, 1, 1);
  display.name = 'CurvedCabDestinationDisplay';
  display.geometry.userData.role = 'curved-destination-display';

  const lamps = [];
  for (const side of [-1, 1]) {
    const center = side * 0.69;
    panel(cab, 'IntegratedCabLampSurround', m.rubber, curvedGeometry(center - 0.145, center + 0.145, 0.865, 1.075, 10, 3, 0.008));
    const main = panel(cab, 'CabHeadlightLens', leading ? m.warmLight : m.redLight,
      curvedGeometry(center - 0.108, center + 0.108, 0.905, 1.030, 8, 2, 0.017), { shadow: false, dynamic: true });
    const markerCenter = side * 0.88;
    const marker = panel(cab, 'CabMarkerLens', leading ? m.redLight : m.warmLight,
      curvedGeometry(markerCenter - 0.050, markerCenter + 0.050, 0.688, 0.728, 5, 1, 0.018), { shadow: false, dynamic: true });
    main.userData.side = marker.userData.side = side;
    lamps.push({ main, marker });
    const bottom = new THREE.Vector3(...surfacePoint(side * 0.27, 1.445, 0.028));
    const top = new THREE.Vector3(...surfacePoint(side * 0.52, 2.055, 0.028));
    const vector = top.clone().sub(bottom);
    const wiper = cylinder(cab, m.rubber, 0.010, vector.length(), bottom.add(top).multiplyScalar(0.5).toArray());
    wiper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.normalize());
    wiper.name = 'CabWindshieldWiper';
  }
  panel(cab, 'CurvedCabBumper', m.rubber, curvedGeometry(-1.04, 1.04, 0.235, 0.315, 28, 2, 0.012));
  box(cab, m.dark, [0.41, 0.16, 0.24], [0, 0.025, -0.54]);
  curvedLabel(cab, 'AUREALIS', -0.46, 0.46, 0.405, 0.555, {
    background: '#253039', color: '#d9e2e7', fontSize: 92,
  });

  const headlights = new THREE.SpotLight('#fff0c8', leading ? 24 : 0, 15, 0.45, 0.6, 1.7);
  headlights.position.set(0, 1, -0.695);
  headlights.target.position.set(0, -0.8, -10);
  cab.add(headlights, headlights.target);
  const shellMetadata = {
    curved: true, compoundCurvature: true, rearLocalZ: REAR_Z,
    rearCarZ: end * 6.55, frontLocalZ: -0.66, maxHalfWidth: 1.42, maxHeight: TOP_Y,
    doorSlideMaxHalfWidth: 1.35, doorSlideHeight: [0.06, 2.47],
    windshieldOpaqueBacking: false,
  };
  cab.userData.shellMetadata = shellMetadata;
  car.cabs.push({
    end, lamps, headlights, materials: m, group: cab,
    shellGeometries, shellMetadata, windshieldMesh: windshield, curvedDisplayMesh: display,
  });
  car.add(cab);
  return cab;
}
