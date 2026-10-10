import * as THREE from 'three';
import { box, canvasTexture, cylinder, instances, label, seededRandom } from './geometry.js';

const FLOOR_Y = 0.095;
const materialsCache = new WeakMap();
const sharedGeometries = new Map();
const noticeCache = new Map();
const SEAT_BANKS = [-3.5, -2.55, -1.6, 1.6, 2.55, 3.5];
const SCREEN_SLOTS = [-3.9, 3.9].map(z => ({ position: [0, 2.43, z], width: 2.1, height: 0.55 }));

function passengerLabel(parent, text, width, height, position, options) {
  const key = JSON.stringify([text, width, height, options.background, options.color, options.fontSize]);
  if (!noticeCache.has(key)) {
    const mesh = label(parent, text, width, height, position, options);
    noticeCache.set(key, { geometry: mesh.geometry, material: mesh.material });
    return mesh;
  }
  const cached = noticeCache.get(key);
  const mesh = new THREE.Mesh(cached.geometry, cached.material);
  mesh.scale.set(width, height, 1);
  mesh.position.set(...position);
  mesh.rotation.set(...(options.rotation ?? [0, 0, 0]));
  parent.add(mesh);
  return mesh;
}

/** Shared, locally generated finishes: no image downloads or additional lights. */
export function createTrainInteriorMaterials(base) {
  if (materialsCache.has(base)) return materialsCache.get(base);
  const cloth = canvasTexture(128, 128, (ctx, width, height) => {
    const random = seededRandom(381);
    ctx.fillStyle = '#245d93'; ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) {
      ctx.fillStyle = (x + y) % 6 ? '#2d6599' : '#215886';
      ctx.fillRect(x, y, 1, 2);
    }
    for (let i = 0; i < 560; i++) {
      ctx.fillStyle = random() > 0.45 ? '#4679a5' : '#184a77';
      ctx.fillRect(random() * width, random() * height, 1, 1);
    }
  });
  cloth.wrapS = cloth.wrapT = THREE.RepeatWrapping;
  const floor = canvasTexture(128, 128, (ctx, width, height) => {
    const random = seededRandom(672);
    ctx.fillStyle = '#777e84'; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 3300; i++) {
      ctx.fillStyle = random() > 0.48 ? '#949b9f' : '#616a72';
      ctx.fillRect(random() * width, random() * height, 0.8, 0.8);
    }
  });
  floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
  floor.repeat.set(2.6, 14);
  const finish = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const result = {
    upholstery: new THREE.MeshStandardMaterial({ color: '#d5e4ef', map: cloth, roughness: 0.94, metalness: 0 }),
    floor: new THREE.MeshStandardMaterial({ color: '#ffffff', map: floor, roughness: 0.93, metalness: 0 }),
    wall: finish('#dce1e2', 0.76), ceiling: finish('#e9ecea', 0.82),
    ceilingInset: finish('#c5ced2', 0.77), seatFrame: finish('#a7b1b8', 0.34, 0.63),
    stainless: finish('#c4ced3', 0.26, 0.78), dark: finish('#343e46', 0.86),
    light: new THREE.MeshStandardMaterial({ color: '#fff6e5', emissive: '#fff6e5', emissiveIntensity: 1.65, roughness: 0.46 }),
    priority: finish('#6b99bd', 0.81),
  };
  materialsCache.set(base, result);
  return result;
}

/** A formed seat cushion and reclining back are one closed, curved 3D shell. */
function seatGeometry() {
  if (sharedGeometries.has('seat')) return sharedGeometries.get('seat');
  const profile = new THREE.Shape();
  profile.moveTo(-0.288, 0.55);
  profile.quadraticCurveTo(-0.314, 0.592, -0.269, 0.617);
  profile.lineTo(0.082, 0.586);
  profile.quadraticCurveTo(0.155, 0.577, 0.164, 0.678);
  profile.quadraticCurveTo(0.158, 0.809, 0.203, 1.006);
  profile.lineTo(0.235, 1.247);
  profile.quadraticCurveTo(0.247, 1.304, 0.284, 1.305);
  profile.quadraticCurveTo(0.338, 1.293, 0.324, 1.232);
  profile.lineTo(0.295, 0.846);
  profile.quadraticCurveTo(0.289, 0.653, 0.213, 0.532);
  profile.quadraticCurveTo(0.174, 0.477, 0.060, 0.484);
  profile.lineTo(-0.261, 0.507);
  profile.quadraticCurveTo(-0.308, 0.514, -0.288, 0.55);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: 0.75, steps: 1, bevelEnabled: true, bevelThickness: 0.012,
    bevelSize: 0.012, bevelSegments: 2, curveSegments: 8,
  });
  geometry.translate(0, 0, -0.375);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { role: 'formed-passenger-seat', curved: true, actual3D: true, shared: true };
  sharedGeometries.set('seat', geometry);
  return geometry;
}

function archGeometry() {
  if (sharedGeometries.has('arch')) return sharedGeometries.get('arch');
  const path = new THREE.CurvePath();
  const point = (x, y) => new THREE.Vector3(x, y, 0);
  path.add(new THREE.LineCurve3(point(-0.615, 0.17), point(-0.615, 2.19)));
  path.add(new THREE.QuadraticBezierCurve3(point(-0.615, 2.19), point(-0.615, 2.48), point(-0.43, 2.48)));
  path.add(new THREE.LineCurve3(point(-0.43, 2.48), point(0.43, 2.48)));
  path.add(new THREE.QuadraticBezierCurve3(point(0.43, 2.48), point(0.615, 2.48), point(0.615, 2.19)));
  path.add(new THREE.LineCurve3(point(0.615, 2.19), point(0.615, 0.17)));
  const geometry = new THREE.TubeGeometry(path, 56, 0.021, 8, false);
  geometry.userData = { role: 'stainless-grab-arch', shared: true, curved: true };
  sharedGeometries.set('arch', geometry);
  return geometry;
}

function handleGeometry() {
  if (!sharedGeometries.has('handle')) {
    const geometry = new THREE.TorusGeometry(0.067, 0.010, 6, 16);
    geometry.userData = { role: 'passenger-grab-handle', shared: true };
    sharedGeometries.set('handle', geometry);
  }
  return sharedGeometries.get('handle');
}

function colliderForInstance(geometry, entry, kind) {
  const transform = new THREE.Object3D();
  transform.position.set(...entry.position);
  transform.scale.set(...(entry.size ?? [1, 1, 1]));
  transform.rotation.set(...(entry.rotation ?? [0, 0, 0]));
  transform.updateMatrix();
  const bounds = geometry.boundingBox.clone().applyMatrix4(transform.matrix);
  return { kind, minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z };
}

function railSegments(minZ, maxZ) {
  // A screen is a real object across the carriage, so rails stop before it.
  const segments = [];
  let cursor = minZ + 0.55;
  for (const center of [-3.9, 3.9]) {
    const first = center - 0.23, last = center + 0.23;
    if (first > cursor) segments.push([cursor, Math.min(first, maxZ - 0.55)]);
    cursor = Math.max(cursor, last);
  }
  if (cursor < maxZ - 0.55) segments.push([cursor, maxZ - 0.55]);
  return segments.filter(([first, last]) => last > first);
}

function buildClosedCab(interior, car, base, m, end, seat) {
  const z = end * 6.54;
  const passengerFace = z - end * 0.08;
  for (const side of [-1, 1]) box(interior, m.wall, [0.91, 2.68, 0.10], [side * 0.865, 1.435, z]);
  box(interior, m.wall, [0.82, 1.30, 0.10], [0, 0.755, z]);
  box(interior, m.wall, [0.82, 0.64, 0.10], [0, 2.465, z]);
  for (const side of [-1, 1]) box(interior, m.seatFrame, [0.17, 0.74, 0.12], [side * 0.325, 1.775, z]);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.70), base.trainGlass ?? base.glass);
  glass.name = 'DriverPartitionWindow';
  glass.position.set(0, 1.775, passengerFace);
  if (end === 1) glass.rotation.y = Math.PI;
  interior.add(glass);
  for (const side of [-1, 1]) box(interior, m.seatFrame, [0.026, 2.24, 0.025], [side * 0.395, 1.235, passengerFace]);
  box(interior, m.stainless, [0.024, 0.15, 0.045], [0.31, 1.18, passengerFace - end * 0.02]);
  passengerLabel(interior, 'DRIVER · ACCESS RESTRICTED', 0.73, 0.12, [0, 2.31, passengerFace - end * 0.012], {
    background: '#dce1e2', color: '#334550', fontSize: 88, rotation: [0, end === -1 ? 0 : Math.PI, 0],
  }).name = 'DriverAccessNotice';
  car.interiorColliders.push({ kind: 'cab-bulkhead', minX: -1.4, maxX: 1.4, minZ: z - 0.06, maxZ: z + 0.06 });

  // A small, physically separated driver's compartment is visible through the
  // partition window; passengers cannot enter it or touch its controls.
  const chair = instances(interior, m.upholstery, [{ position: [0, 0, end * 6.97], size: [1, 1, 0.70], rotation: [0, end * Math.PI / 2, 0] }], seat);
  chair.name = 'DriverSeat';
  box(interior, m.dark, [0.42, 0.39, 0.43], [0, 0.31, end * 6.97]);
  box(interior, m.dark, [1.02, 0.28, 0.35], [0, 1.07, end * 7.61]);
  box(interior, m.seatFrame, [1.07, 0.055, 0.38], [0, 1.237, end * 7.61]);
  box(interior, m.dark, [0.32, 0.12, 0.16], [-0.15, 1.32, end * 7.62]);
  box(interior, base.trainBlue ?? m.upholstery, [0.25, 0.026, 0.105], [-0.15, 1.394, end * 7.62]);
  cylinder(interior, m.dark, 0.018, 0.10, [0.29, 1.31, end * 7.54], [0, 0, 0], 8);
}

/** Build one reusable, collision-aware car without changing exterior or doors. */
export function buildPassengerInterior(car, base, { leading = false, trailing = false } = {}) {
  const m = createTrainInteriorMaterials(base);
  const minZ = leading ? -6.55 : -7.825, maxZ = trailing ? 6.55 : 7.825;
  const centerZ = (minZ + maxZ) / 2, length = maxZ - minZ;
  const interior = new THREE.Group();
  interior.name = 'PassengerInterior';
  interior.userData.role = 'explorable-passenger-interior';
  car.add(interior);
  car.interiorColliders = [];
  const seat = seatGeometry(), seatEntries = [], mounts = [], feet = [];
  let longitudinalCount = 0, transverseCount = 0;

  for (const side of [-1, 1]) {
    for (const z of SEAT_BANKS) {
      const entry = { position: [side * 0.95, 0, z], rotation: [0, side < 0 ? Math.PI : 0, 0] };
      seatEntries.push(entry);
      car.interiorColliders.push(colliderForInstance(seat, entry, 'longitudinal-seat'));
      mounts.push({ position: [side * 1.08, 0.315, z], size: [0.095, 0.43, 0.59] });
      feet.push({ position: [side * 1.08, 0.121, z], size: [0.22, 0.025, 0.53] });
      longitudinalCount++;
    }
    for (const end of [-1, 1]) {
      if ((end === -1 && leading) || (end === 1 && trailing)) continue;
      const entry = { position: [side * 0.98, 0, end * 7.2], size: [1, 1, 0.70], rotation: [0, -end * Math.PI / 2, 0] };
      seatEntries.push(entry);
      car.interiorColliders.push(colliderForInstance(seat, entry, 'transverse-seat'));
      mounts.push({ position: [side * 0.98, 0.315, end * 7.30], size: [0.48, 0.43, 0.10] });
      feet.push({ position: [side * 0.98, 0.121, end * 7.30], size: [0.43, 0.025, 0.22] });
      transverseCount++;
    }
  }
  const seating = instances(interior, m.upholstery, seatEntries, seat);
  seating.name = 'FormedBluePassengerSeats';
  seating.userData = { role: 'passenger-seating', longitudinalCount, transverseCount, seatCount: seatEntries.length, curved: true };
  instances(interior, m.seatFrame, mounts).name = 'SilverSeatSupports';
  instances(interior, m.dark, feet, undefined, false).name = 'SeatSupportFeet';

  // Cover the existing structural slab exactly; its top remains at 0.095 m.
  box(interior, m.floor, [2.61, 0.011, length - 0.025], [0, FLOOR_Y - 0.0055, centerZ], { shadow: false }).name = 'TexturedPassengerFloor';
  for (let z = Math.ceil(minZ / 2) * 2; z < maxZ; z += 2) {
    box(interior, m.dark, [2.60, 0.001, 0.005], [0, FLOOR_Y + 0.0005, z], { shadow: false });
  }

  for (const side of [-1, 1]) {
    for (const [first, last] of [[-7.82, -6.445], [-4.555, -0.945], [0.945, 4.555], [6.445, 7.82]]) {
      const start = Math.max(minZ, first), end = Math.min(maxZ, last);
      if (end <= start) continue;
      box(interior, m.wall, [0.022, 1.16, end - start], [side * 1.307, 0.703, (start + end) / 2], { shadow: false });
      box(interior, m.dark, [0.026, 0.10, end - start], [side * 1.301, 0.15, (start + end) / 2], { shadow: false });
      box(interior, m.stainless, [0.025, 0.045, end - start], [side * 1.30, 1.302, (start + end) / 2], { shadow: false });
    }
    box(interior, m.wall, [0.025, 0.245, length], [side * 1.304, 2.627, centerZ], { shadow: false });
    for (const z of [-2.58, 2.58]) {
      box(interior, m.wall, [0.036, 0.034, 2.65], [side * 1.299, 2.454, z], { shadow: false });
      for (const edge of [-1, 1]) box(interior, m.wall, [0.035, 1.14, 0.032], [side * 1.30, 1.886, z + edge * 1.293], { shadow: false });
    }
    for (const z of [-5.5, 0, 5.5]) {
      // These stationary trims sit outside the actual 1.88-m doorway opening.
      for (const edge of [-1, 1]) box(interior, m.wall, [0.046, 2.34, 0.055], [side * 1.315, 1.287, z + edge * 0.958], { shadow: false });
      passengerLabel(interior, 'KEEP DOORS CLEAR', 0.64, 0.08, [side * 1.283, 2.528, z], {
        background: '#dce1e2', color: '#425560', fontSize: 104, rotation: [0, -side * Math.PI / 2, 0],
      }).name = 'DoorSafetyNotice';
    }
    passengerLabel(interior, 'PRIORITY SEATING  ♿', 0.88, 0.13, [side * 1.286, 1.334, -2.55], {
      background: '#285f91', color: '#eef4f5', fontSize: 102, rotation: [0, -side * Math.PI / 2, 0],
    }).name = 'PrioritySeatingNotice';
    passengerLabel(interior, 'EMERGENCY · CALL DRIVER', 1.05, 0.105, [side * 1.285, 2.593, 2.55], {
      background: '#dce1e2', color: '#884136', fontSize: 92, rotation: [0, -side * Math.PI / 2, 0],
    }).name = 'EmergencyInstruction';
    box(interior, m.dark, [0.035, 0.15, 0.105], [side * 1.286, 1.52, 4.35]);
    box(interior, base.redLight, [0.036, 0.035, 0.035], [side * 1.262, 1.52, 4.35], { shadow: false });
  }

  box(interior, m.ceiling, [2.57, 0.08, length], [0, 2.82, centerZ], { shadow: false }).name = 'PassengerCeiling';
  box(interior, m.ceilingInset, [1.12, 0.024, length - 0.10], [0, 2.765, centerZ], { shadow: false });
  for (const side of [-1, 1]) {
    box(interior, m.stainless, [0.12, 0.018, length - 0.22], [side * 0.82, 2.766, centerZ], { shadow: false });
    box(interior, m.light, [0.075, 0.025, length - 0.28], [side * 0.82, 2.745, centerZ], { shadow: false }).name = 'ContinuousInteriorLED';
    for (const [first, last] of railSegments(minZ, maxZ)) {
      cylinder(interior, m.stainless, 0.020, last - first, [side * 0.69, 2.445, (first + last) / 2], [Math.PI / 2, 0, 0]);
    }
  }
  for (let z = Math.ceil(minZ / 2.2) * 2.2; z < maxZ; z += 2.2) {
    box(interior, m.ceilingInset, [2.55, 0.009, 0.016], [0, 2.777, z], { shadow: false });
  }
  const archEntries = [-4.3, -1.07, 1.07, 4.3].map(z => ({ position: [0, 0, z] }));
  const arches = instances(interior, m.stainless, archEntries, archGeometry());
  arches.name = 'StainlessPassengerGrabArches';
  for (const { position } of archEntries) for (const side of [-1, 1]) {
    car.interiorColliders.push({ kind: 'grab-pole', minX: side * 0.615 - 0.021, maxX: side * 0.615 + 0.021, minZ: position[2] - 0.021, maxZ: position[2] + 0.021 });
    cylinder(interior, m.dark, 0.048, 0.055, [side * 0.615, 0.135, position[2]], [0, 0, 0], 10);
  }
  const handles = [], straps = [];
  for (const side of [-1, 1]) for (const z of [-2.9, -2.0, 2.0, 2.9]) {
    handles.push({ position: [side * 0.69, 2.153, z] });
    straps.push({ position: [side * 0.69, 2.338, z], size: [0.018, 0.215, 0.025] });
  }
  instances(interior, m.dark, straps, undefined, false).name = 'PassengerHandleStraps';
  instances(interior, m.stainless, handles, handleGeometry(), false).name = 'PassengerGrabHandles';

  if (leading) buildClosedCab(interior, car, base, m, -1, seat);
  if (trailing) buildClosedCab(interior, car, base, m, 1, seat);
  car.userData.interiorLayout = {
    version: 1, actual3D: true, floorY: FLOOR_Y, eyeY: 1.85,
    passengerMinZ: minZ, passengerMaxZ: maxZ, longitudinalSeatCount: longitudinalCount,
    transverseSeatCount: transverseCount, passengerSeatCount: seatEntries.length,
    grabPoleCount: archEntries.length * 2, grabHandleCount: handles.length,
    screenSlots: SCREEN_SLOTS.map(slot => ({ ...slot, position: [...slot.position] })),
    doorCenters: [-5.5, 0, 5.5], clearDoorHalfWidth: 0.94,
    aisleInnerSeatEdge: 0.95 + seat.boundingBox.min.x,
    aisleTestX: 0.3, cabBulkheadZ: [...(leading ? [-6.54] : []), ...(trailing ? [6.54] : [])],
    finishes: { upholstery: { color: '#245d93', roughness: m.upholstery.roughness, textured: true }, floor: { roughness: m.floor.roughness, textured: true }, stainless: { roughness: m.stainless.roughness, metalness: m.stainless.metalness } },
  };
  car.userData.interiorLayout.colliderCount = car.interiorColliders.length;
  car.userData.interiorLayout.sharedSeatGeometry = true;
  return interior;
}
