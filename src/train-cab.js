import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, label } from './geometry.js';

const REAR_Z = 1.35;
const GLASS_ANGLE = 1.2;
const BOTTOM_Y = 0.105;
const TOP_Y = 3.07;
const CROWN_Y = 2.74;
const FRONT_Z = -0.735;
const FACE_ANGLE = 1.2;
const CORNER_ANGLE = 1.4;
const SIDE_RADIUS = 0.11;
const ROOF_RADIUS = 0.17;
const ROOF_FRONT_Y = TOP_Y - ROOF_RADIUS;
const faceGeometryCache = new Map();

// Value and derivative come from the same curve for every material patch.
// Only the small lower edge and the unchanged body-width profile use Hermite.
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
  [BOTTOM_Y, -0.60], [0.18, -0.715], [0.25, FRONT_Z], [ROOF_FRONT_Y, FRONT_Z],
], 0);

function widthAt(y) {
  if (y <= 2.47) return lowerWidth(y);
  if (y < 2.57) return hermite(1.35, 1.42, 0, -0.04 / 0.84, 0.10, (y - 2.47) / 0.10);
  // The rear shoulder exactly matches buildBody's existing quadratic roof:
  // (1.42,2.57) -> control(1.40,2.99) -> (.99,3.07).
  const t = (0.84 - Math.sqrt(Math.max(0, 0.84 ** 2 - 1.36 * (y - 2.57)))) / 0.68;
  return [1.42 - 0.04 * t - 0.39 * t * t, (-0.04 - 0.78 * t) / (0.84 - 0.68 * t)];
}

function frontAt(y) {
  if (y <= ROOF_FRONT_Y) return lowerFront(y);
  // A short edge fillet joins the vertical face to the original flat roof.
  // Its parameter derivative remains finite at the horizontal roof tangent.
  const t = 1 - Math.sqrt(Math.max(0, (TOP_Y - y) / ROOF_RADIUS));
  return [FRONT_Z + ROOF_RADIUS * t * t, 2 * ROOF_RADIUS * t, 2 * ROOF_RADIUS * (1 - t)];
}

function horizontalSection(angle, width, frontZ, offset) {
  const side = angle < 0 ? -1 : 1, absolute = Math.abs(angle);
  const coreWidth = width - SIDE_RADIUS;
  if (absolute <= FACE_ANGLE) {
    // Most of the cab is one broad plane, including the whole windscreen.
    const fraction = angle / FACE_ANGLE;
    return { x: coreWidth * fraction, z: frontZ - offset,
      dx: coreWidth / FACE_ANGLE, dz: 0, widthFraction: fraction, frontFraction: 1 };
  }
  if (absolute < CORNER_ANGLE) {
    const rate = Math.PI / 2 / (CORNER_ANGLE - FACE_ANGLE);
    const turn = (absolute - FACE_ANGLE) * rate, radius = SIDE_RADIUS + offset;
    return { x: side * (coreWidth + radius * Math.sin(turn)),
      z: frontZ + SIDE_RADIUS - radius * Math.cos(turn),
      dx: radius * Math.cos(turn) * rate, dz: side * radius * Math.sin(turn) * rate,
      widthFraction: side, frontFraction: 1 };
  }
  const length = Math.PI / 2 - CORNER_ANGLE, fraction = (absolute - CORNER_ANGLE) / length;
  return { x: side * (width + offset), z: THREE.MathUtils.lerp(frontZ + SIDE_RADIUS, REAR_Z, fraction),
    dx: 0, dz: side * (REAR_Z - frontZ - SIDE_RADIUS) / length,
    widthFraction: side, frontFraction: 1 - fraction };
}

/** The existing patch layout now samples a vertical face and small edge fillets. */
function surfacePoint(angle, y, offset = 0) {
  const section = horizontalSection(angle, widthAt(y)[0], frontAt(y)[0], offset);
  return [section.x, y, section.z];
}

function surfaceNormal(angle, y, offset = 0) {
  const [width, widthSlope] = widthAt(y), front = frontAt(y);
  const heightDerivative = front[2] ?? 1;
  const widthDerivative = widthSlope * heightDerivative;
  const frontDerivative = front[1];
  const section = horizontalSection(angle, width, front[0], offset);
  const normal = new THREE.Vector3(
    section.dz * heightDerivative,
    frontDerivative * section.frontFraction * section.dx - widthDerivative * section.widthFraction * section.dz,
    -section.dx * heightDerivative,
  );
  // At the roof/side endpoint both crown tangents vanish. The limiting side
  // shoulder normal is finite and agrees with the passenger-car roof profile.
  if (normal.lengthSq() < 1e-20) normal.set(Math.sign(angle), -widthSlope, 0);
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
  geometry.userData = { curved: true, compoundCurvature: false, flatFront: true, angularProfile: true, rearLocalZ: REAR_Z,
    smoothAnalyticNormals: true, profile: 'vertical-face-edge-fillets' };
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

function faceOutline(inset = 0) {
  const bottom = 0.25 + inset, top = ROOF_FRONT_Y - inset;
  const heights = [bottom, 0.45, 0.60, 0.95, 1.02, 1.30, 1.80, 2.10, 2.47, 2.57, 2.64, 2.74, 2.82, top]
    .filter((y, index, values) => y >= bottom && y <= top && values.indexOf(y) === index).sort((a, b) => a - b);
  const edge = y => widthAt(y)[0] - SIDE_RADIUS - inset;
  const points = heights.map(y => new THREE.Vector2(edge(y), y));
  points.push(...heights.slice().reverse().map(y => new THREE.Vector2(-edge(y), y)));
  return new THREE.Shape(points);
}

function roundedRectangle(width, bottom, top, radius) {
  const shape = new THREE.Shape(), half = width / 2;
  shape.moveTo(-half + radius, bottom); shape.lineTo(half - radius, bottom);
  shape.quadraticCurveTo(half, bottom, half, bottom + radius);
  shape.lineTo(half, top - radius); shape.quadraticCurveTo(half, top, half - radius, top);
  shape.lineTo(-half + radius, top); shape.quadraticCurveTo(-half, top, -half, top - radius);
  shape.lineTo(-half, bottom + radius); shape.quadraticCurveTo(-half, bottom, -half + radius, bottom);
  return shape;
}

function planeGeometry(shape, offset = 0) {
  const geometry = new THREE.ShapeGeometry(shape, 12);
  geometry.rotateY(Math.PI); geometry.translate(0, 0, FRONT_Z - offset);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { flatFront: true, compoundCurvature: false, opaqueBacking: false };
  return geometry;
}

function faceGeometry(key, create) {
  if (!faceGeometryCache.has(key)) faceGeometryCache.set(key, create());
  return faceGeometryCache.get(key);
}

/** Original Nordplatz face, with a real opening around its broad glazing. */
function originalFaceGeometries() {
  const pane = roundedRectangle(2.20, 1.47, 2.51, 0.04);
  return {
    white: faceGeometry('original-white-face', () => {
      const outline = faceOutline();
      outline.holes.push(new THREE.Path(pane.getPoints(12)));
      return planeGeometry(outline);
    }),
    glass: faceGeometry('original-windshield', () => planeGeometry(pane, 0.010)),
    gasket: faceGeometry('original-window-gasket', () => {
      const frame = roundedRectangle(2.37, 1.40, 2.58, 0.055);
      frame.holes.push(new THREE.Path(pane.getPoints(12)));
      return planeGeometry(frame, 0.007);
    }),
  };
}

/** Restore the original flat Nordplatz front without moving the car or rear seam. */
export function buildRoundedCab(car, m, end, leading) {
  const cab = new THREE.Group();
  cab.name = leading ? 'FrontCab' : 'RearCab';
  cab.position.z = end * 7.9;
  if (end === 1) cab.rotation.y = Math.PI;
  cab.userData.end = end;
  cab.userData.geometryRole = 'original-nordplatz-flat-cab';
  const white = m.whitePaint;
  const teal = m.trainTeal;
  const silver = m.trainSilver ?? m.aluminum;
  const charcoal = m.cabCharcoal ?? m.dark;
  const shellGeometries = [];
  const shellPart = (name, material, geometry) => {
    geometry.userData.role = 'cab-shell';
    geometry.userData.patchName = name;
    shellGeometries.push(geometry);
    return panel(cab, name, material, geometry);
  };

  // Keep the proven shoulder, roof tangents and rear join at car Z=+/-6.55.
  // The short historical cab alone would leave a gap beside today's interior.
  shellPart('CabLowerEdge', charcoal, curvedGeometry(-Math.PI / 2, Math.PI / 2, BOTTOM_Y, 0.25, 42, 3));
  for (const side of [-1, 1]) {
    const from = side < 0 ? -Math.PI / 2 : FACE_ANGLE;
    const to = side < 0 ? -FACE_ANGLE : Math.PI / 2;
    shellPart('CabLowerSide', white, curvedGeometry(from, to, 0.25, 1.02, 8, 8));
    shellPart('CabSideApron', white, curvedGeometry(from, to, 1.02, glassBottom, 8, 5));
    shellPart('CabSidePillar', white, curvedGeometry(from, to, glassBottom, glassTop, 8, 12));
    shellPart('CabSideBrow', white, curvedGeometry(from, to, glassTop, CROWN_Y, 8, 4));
    shellPart('CabSideRoofShoulder', silver, curvedGeometry(from, to, CROWN_Y, ROOF_FRONT_Y, 8, 6));
  }
  shellPart('CabRoofEdge', silver, curvedGeometry(-Math.PI / 2, Math.PI / 2, ROOF_FRONT_Y, TOP_Y, 42, 10, 0, true));
  shellPart('CabRoofCap', silver, profileCap(TOP_Y, true));
  shellPart('CabFloorCap', charcoal, profileCap(BOTTOM_Y, false));

  const face = originalFaceGeometries();
  shellPart('OriginalWhiteCabFace', white, face.white);
  panel(cab, 'OriginalWindshieldGasket', m.rubber, face.gasket);
  const windshield = panel(cab, 'OriginalBroadWindshield', m.cabGlass, face.glass, { dynamic: true });
  windshield.geometry.userData = { flatFront: true, compoundCurvature: false,
    role: 'original-broad-cab-glazing', opaqueBacking: false };
  windshield.userData.geometryRole = 'original-broad-cab-glazing';
  windshield.userData.opaqueBacking = false;

  // The shallow front plate is embedded in the white shell, rather than
  // floating ahead of it. Its width/height match the original 0651a61 model.
  box(cab, teal, [2.58, 0.65, 0.10], [0, 0.7, FRONT_Z + 0.032]);
  box(cab, m.rubber, [0.035, 1.04, 0.012], [0, 1.99, FRONT_Z - 0.020]);
  box(cab, charcoal, [2.0, 0.31, 0.034], [0, 2.73, FRONT_Z - 0.009]);
  const display = car.addDestinationDisplay(cab, 1.9, 0.24, [0, 2.73, FRONT_Z - 0.030], {
    rotation: [0, Math.PI, 0], background: '#122724', color: '#efcf80', fontSize: 93,
  });
  display.name = 'OriginalCabDestinationDisplay';

  const lamps = [];
  for (const side of [-1, 1]) {
    box(cab, charcoal, [0.51, 0.22, 0.035], [side * 0.85, 0.99, FRONT_Z - 0.024]);
    const main = box(cab, leading ? m.warmLight : m.redLight, [0.36, 0.115, 0.012],
      [side * 0.85, 1.01, FRONT_Z - 0.050], { shadow: false });
    const marker = box(cab, leading ? m.redLight : m.warmLight, [0.13, 0.04, 0.012],
      [side * 1.05, 0.78, FRONT_Z - 0.023], { shadow: false });
    main.name = 'OriginalRectangularHeadlight'; marker.name = 'OriginalCabMarker';
    main.userData.dynamic = marker.userData.dynamic = true;
    main.userData.side = marker.userData.side = side;
    lamps.push({ main, marker });
    const wiper = box(cab, m.rubber, [0.018, 0.57, 0.026],
      [side * 0.53, 1.79, FRONT_Z - 0.022], { rotation: [0, 0, side * -0.48] });
    wiper.name = 'CabWindshieldWiper';
  }
  box(cab, m.rubber, [2.16, 0.18, 0.07], [0, 0.24, FRONT_Z - 0.016]);
  box(cab, m.dark, [0.45, 0.33, 0.22], [0, -0.25, -0.63]);
  box(cab, silver, [0.43, 0.29, 0.05], [0, -0.25, -0.758]);
  const couplingSocket = faceGeometry('coupling-socket', () => {
    const socket = new THREE.CircleGeometry(0.078, 24); socket.rotateY(Math.PI);
    socket.translate(0, -0.25, -0.795);
    return socket;
  });
  panel(cab, 'OriginalCouplingSocket', m.dark, couplingSocket);
  box(cab, m.steel, [0.48, 0.065, 0.09], [0, -0.43, -0.74]);
  label(cab, `AB    ${car.carNumber}`, 0.86, 0.14, [0, 0.52, FRONT_Z - 0.025], {
    rotation: [0, Math.PI, 0], background: '#316c65', color: '#e4eada', fontSize: 104,
  });

  const headlights = new THREE.SpotLight('#fff0c8', leading ? 24 : 0, 15, 0.45, 0.6, 1.7);
  headlights.position.set(...surfacePoint(0, 1, 0.065));
  headlights.target.position.set(0, -0.8, -10);
  cab.add(headlights, headlights.target);
  const shellMetadata = {
    curved: true, compoundCurvature: false, flatFront: true, rearLocalZ: REAR_Z,
    rearCarZ: end * 6.55, frontLocalZ: FRONT_Z, maxHalfWidth: 1.421, maxHeight: TOP_Y,
    doorSlideMaxHalfWidth: 1.35, doorSlideHeight: [0.06, 2.47],
    windshieldOpaqueBacking: false,
    profile: 'original-nordplatz-flat-face', smoothAnalyticNormals: true,
    rearRoofProfile: 'passenger-body-quadratic', crownRoofTangent: true,
  };
  cab.userData.shellMetadata = shellMetadata;
  car.cabs.push({ end, lamps, headlights, materials: m, group: cab,
    shellGeometries, shellMetadata, windshieldMesh: windshield, curvedDisplayMesh: display });
  car.add(cab);
  return cab;
}
