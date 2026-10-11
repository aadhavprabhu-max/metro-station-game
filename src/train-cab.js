import * as THREE from 'three';
import { box, cylinder, label } from './geometry.js';

const REAR_Z = 1.35;
const GLASS_ANGLE = 1.2;
const BOTTOM_Y = 0.105;
const TOP_Y = 3.07;
const CROWN_Y = 2.74;
const CROWN_FRONT_Z = 0.445;
const CROWN_CONTROL_Z = 0.86;
const CROWN_END_Z = 1.08;

// Shape-preserving Hermite interpolation keeps the lower tip blunt and the
// windscreen progressively raked, without the old straight profile segments.
// Value and derivative come from the same curve for every material patch.
function profile(points, endSlope = null) {
  const steps = points.slice(1).map((point, index) => point[0] - points[index][0]);
  const secants = points.slice(1).map((point, index) => (point[1] - points[index][1]) / steps[index]);
  const slopes = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) {
      const last = index !== 0;
      const firstStep = steps[last ? steps.length - 1 : 0], nextStep = steps[last ? steps.length - 2 : 1];
      const first = secants[last ? secants.length - 1 : 0], next = secants[last ? secants.length - 2 : 1];
      let slope = ((2 * firstStep + nextStep) * first - firstStep * next) / (firstStep + nextStep);
      if (Math.sign(slope) !== Math.sign(first)) slope = 0;
      else if (Math.sign(first) !== Math.sign(next) && Math.abs(slope) > Math.abs(3 * first)) slope = 3 * first;
      return last && endSlope != null ? endSlope : slope;
    }
    const before = secants[index - 1], after = secants[index];
    if (before * after <= 0) return 0;
    const beforeWeight = 2 * steps[index] + steps[index - 1];
    const afterWeight = steps[index] + 2 * steps[index - 1];
    return (beforeWeight + afterWeight) / (beforeWeight / before + afterWeight / after);
  });
  return y => {
    let index = 0;
    while (index < points.length - 2 && y > points[index + 1][0]) index++;
    const [startY, start] = points[index], [endY, end] = points[index + 1];
    return hermite(start, end, slopes[index], slopes[index + 1], endY - startY,
      THREE.MathUtils.clamp((y - startY) / (endY - startY), 0, 1));
  };
}

function hermite(start, end, startSlope, endSlope, height, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    (2 * t3 - 3 * t2 + 1) * start + (t3 - 2 * t2 + t) * height * startSlope
      + (-2 * t3 + 3 * t2) * end + (t3 - t2) * height * endSlope,
    ((6 * t2 - 6 * t) * start + (3 * t2 - 4 * t + 1) * height * startSlope
      + (-6 * t2 + 6 * t) * end + (3 * t2 - 2 * t) * height * endSlope) / height,
  ];
}

const lowerWidth = profile([[0.105, 1.19], [0.25, 1.30], [0.60, 1.345], [0.95, 1.35], [2.47, 1.35]], 0);
const lowerFront = profile([
  [0.105, -0.27], [0.25, -0.49], [0.60, -0.70], [0.95, -0.735],
  [1.35, -0.675], [1.80, -0.425], [2.25, -0.080], [2.47, 0.110],
  [2.57, 0.245], [CROWN_Y, CROWN_FRONT_Z],
], (CROWN_CONTROL_Z - CROWN_FRONT_Z) / (TOP_Y - CROWN_Y));

function widthAt(y) {
  if (y <= 2.47) return lowerWidth(y);
  if (y < 2.57) return hermite(1.35, 1.42, 0, -0.04 / 0.84, 0.10, (y - 2.47) / 0.10);
  // The rear shoulder exactly matches buildBody's existing quadratic roof:
  // (1.42,2.57) -> control(1.40,2.99) -> (.99,3.07).
  const t = (0.84 - Math.sqrt(Math.max(0, 0.84 ** 2 - 1.36 * (y - 2.57)))) / 0.68;
  return [1.42 - 0.04 * t - 0.39 * t * t, (-0.04 - 0.78 * t) / (0.84 - 0.68 * t)];
}

function frontAt(y) {
  if (y <= CROWN_Y) return lowerFront(y);
  // The crown becomes tangent to the existing flat roof. Parameterising its
  // derivative avoids an infinite dZ/dY at the very top of the rounded nose.
  const t = 1 - Math.sqrt(Math.max(0, (TOP_Y - y) / (TOP_Y - CROWN_Y)));
  const z = (1 - t) ** 2 * CROWN_FRONT_Z + 2 * (1 - t) * t * CROWN_CONTROL_Z + t * t * CROWN_END_Z;
  return [z, 2 * ((1 - t) * (CROWN_CONTROL_Z - CROWN_FRONT_Z) + t * (CROWN_END_Z - CROWN_CONTROL_Z)),
    2 * (TOP_Y - CROWN_Y) * (1 - t)];
}

function sectionAt(y) {
  return [widthAt(y)[0], frontAt(y)[0]];
}

/** Angular profile rings create a genuinely rounded nose in all three axes. */
function surfacePoint(angle, y, offset = 0) {
  const [halfWidth, frontZ] = sectionAt(y);
  return [
    (halfWidth + offset) * Math.sin(angle), y,
    REAR_Z - (REAR_Z - frontZ + offset) * Math.cos(angle),
  ];
}

function surfaceNormal(angle, y, offset = 0) {
  const [width, widthSlope] = widthAt(y), front = frontAt(y);
  const heightDerivative = front[2] ?? 1;
  const widthDerivative = widthSlope * heightDerivative;
  const frontDerivative = front[1];
  const w = width + offset, depth = REAR_Z - front[0] + offset;
  const sine = Math.sin(angle), cosine = Math.cos(angle);
  const normal = new THREE.Vector3(
    depth * sine * heightDerivative,
    frontDerivative * w * cosine * cosine - widthDerivative * depth * sine * sine,
    -w * cosine * heightDerivative,
  );
  // At the roof/side endpoint both crown tangents vanish. The limiting side
  // shoulder normal is finite and agrees with the passenger-car roof profile.
  if (normal.lengthSq() < 1e-20) normal.set(Math.sign(sine), -widthSlope, 0);
  return normal.normalize().toArray();
}

function glassBottom(angle) {
  return 1.28 + 0.16 * Math.min(1, (angle / GLASS_ANGLE) ** 2);
}

function glassTop(angle) {
  return 2.60 - 0.08 * Math.min(1, (angle / GLASS_ANGLE) ** 2);
}

function curvedGeometry(startAngle, endAngle, bottom, top, columns = 40, rows = 8, offset = 0, crownRows = false) {
  const position = [], normal = [], uv = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows, heightFraction = crownRows ? 1 - (1 - v) ** 2 : v;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, u);
      const y = THREE.MathUtils.lerp(typeof bottom === 'function' ? bottom(angle) : bottom,
        typeof top === 'function' ? top(angle) : top, heightFraction);
      position.push(...surfacePoint(angle, y, offset));
      normal.push(...surfaceNormal(angle, y, offset));
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
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { curved: true, compoundCurvature: true, angularProfile: true, rearLocalZ: REAR_Z,
    smoothAnalyticNormals: true, profile: 'hermite-roof-tangent' };
  return geometry;
}

function lampGeometry(centerAngle, centerY, angleRadius, heightRadius, offset, innerRadius = 0) {
  const positions = [], normals = [], uv = [], indices = [], segments = 24;
  const vertex = (radius, angle) => {
    const surfaceAngle = centerAngle + angleRadius * radius * Math.cos(angle);
    const y = centerY + heightRadius * radius * Math.sin(angle);
    positions.push(...surfacePoint(surfaceAngle, y, offset));
    normals.push(...surfaceNormal(surfaceAngle, y, offset));
    uv.push((1 + radius * Math.cos(angle)) / 2, (1 + radius * Math.sin(angle)) / 2);
  };
  if (innerRadius === 0) {
    vertex(0, 0);
    for (let step = 0; step <= segments; step++) {
      vertex(1, step * Math.PI * 2 / segments);
      if (step < segments) indices.push(0, step + 2, step + 1);
    }
  } else {
    for (let step = 0; step <= segments; step++) {
      const angle = step * Math.PI * 2 / segments;
      vertex(innerRadius, angle); vertex(1, angle);
      if (step < segments) {
        const a = step * 2, b = a + 1, d = a + 2, c = a + 3;
        indices.push(a, c, b, a, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { curved: true, compoundCurvature: true, role: 'integrated-cab-lamp',
    smoothAnalyticNormals: true, profile: 'hermite-roof-tangent' };
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
    geometry.userData.patchName = name;
    shellGeometries.push(geometry);
    return panel(cab, name, material, geometry);
  };

  shellPart('RoundedCabLowerNose', charcoal, curvedGeometry(-Math.PI / 2, Math.PI / 2, BOTTOM_Y, 1.02, 42, 10));
  shellPart('RoundedCabBlueApron', blue, curvedGeometry(-Math.PI / 2, Math.PI / 2, 1.02, glassBottom, 42, 5));
  shellPart('RoundedCabBrow', blue, curvedGeometry(-Math.PI / 2, Math.PI / 2, glassTop, 2.74, 42, 4));
  shellPart('RoundedCabRoofShoulder', silver, curvedGeometry(-Math.PI / 2, Math.PI / 2, CROWN_Y, TOP_Y, 42, 12, 0, true));
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
    const center = side * 0.77;
    panel(cab, 'IntegratedCabLampSurround', m.rubber, lampGeometry(center, 1.105, 0.185, 0.185, 0.008));
    panel(cab, 'IntegratedCabLampBezel', silver, lampGeometry(center, 1.105, 0.158, 0.158, 0.017, 0.84));
    const main = panel(cab, 'CabHeadlightLens', leading ? m.warmLight : m.redLight,
      lampGeometry(center, 1.105, 0.130, 0.130, 0.023), { shadow: false, dynamic: true });
    const markerCenter = side * 0.88;
    const marker = panel(cab, 'CabMarkerLens', leading ? m.redLight : m.warmLight,
      curvedGeometry(markerCenter - 0.050, markerCenter + 0.050, 0.688, 0.728, 5, 1, 0.018), { shadow: false, dynamic: true });
    main.userData.side = marker.userData.side = side;
    lamps.push({ main, marker });
    // The straight wiper spans the convex glass: clear the whole chord, not
    // just its endpoints, so its cylinder cannot pass through the windscreen.
    const bottom = new THREE.Vector3(...surfacePoint(side * 0.27, 1.445, 0.047));
    const top = new THREE.Vector3(...surfacePoint(side * 0.52, 2.055, 0.047));
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
    rearCarZ: end * 6.55, frontLocalZ: -0.735, maxHalfWidth: 1.421, maxHeight: TOP_Y,
    doorSlideMaxHalfWidth: 1.35, doorSlideHeight: [0.06, 2.47],
    windshieldOpaqueBacking: false,
    profile: 'hermite-roof-tangent', smoothAnalyticNormals: true,
    rearRoofProfile: 'passenger-body-quadratic', crownRoofTangent: true,
  };
  cab.userData.shellMetadata = shellMetadata;
  car.cabs.push({
    end, lamps, headlights, materials: m, group: cab,
    shellGeometries, shellMetadata, windshieldMesh: windshield, curvedDisplayMesh: display,
  });
  car.add(cab);
  return cab;
}
