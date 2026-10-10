import * as THREE from 'three';
import { box, cylinder, instances, label } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { buildRoundedCab } from './train-cab.js';
import { buildPassengerInterior } from './train-interior.js';

const CAR_LENGTH = 16;
const CAR_SPACING = 17;
const gangwayGeometries = new Map();

function gangwayGeometry(depth, width, height) {
  const key = `${depth}/${width}/${height}`;
  if (gangwayGeometries.has(key)) return gangwayGeometries.get(key);
  const shape = new THREE.Shape();
  const half = width / 2, bottom = 1.51 - height / 2, top = bottom + height, radius = 0.14;
  shape.moveTo(-half + radius, bottom);
  shape.lineTo(half - radius, bottom); shape.quadraticCurveTo(half, bottom, half, bottom + radius);
  shape.lineTo(half, top - radius); shape.quadraticCurveTo(half, top, half - radius, top);
  shape.lineTo(-half + radius, top); shape.quadraticCurveTo(-half, top, -half, top - radius);
  shape.lineTo(-half, bottom + radius); shape.quadraticCurveTo(-half, bottom, -half + radius, bottom);
  const opening = new THREE.Path();
  opening.moveTo(-0.84, 0.29); opening.lineTo(-0.84, 2.63);
  opening.lineTo(0.84, 2.63); opening.lineTo(0.84, 0.29); opening.closePath();
  shape.holes.push(opening);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  gangwayGeometries.set(key, geometry);
  return geometry;
}

function buildGangway(parent, m, z) {
  const connection = new THREE.Group();
  connection.name = 'Gangway'; connection.position.z = z;
  const bellows = new THREE.Mesh(gangwayGeometry(0.87, 2.38, 2.64), m.rubber);
  bellows.position.z = -0.435; bellows.castShadow = bellows.receiveShadow = true;
  connection.add(bellows);
  for (let rib = -3; rib <= 3; rib++) {
    const ring = new THREE.Mesh(gangwayGeometry(0.026, 2.48, 2.65), m.cabCharcoal);
    ring.position.z = rib * 0.108 - 0.013;
    ring.castShadow = ring.receiveShadow = true;
    connection.add(ring);
  }
  box(connection, m.trainSilver, [2.48, 0.075, 0.9], [0, 3.0, 0]);
  box(connection, m.cabCharcoal, [0.30, 0.20, 1.1], [0, -0.18, 0]);
  cylinder(connection, m.steel, 0.09, 0.58, [0, -0.18, 0], [Math.PI / 2, 0, 0]);
  box(connection, m.dark, [0.40, 0.27, 0.31], [0, -0.18, 0]);
  box(connection, m.steel, [0.07, 0.31, 0.36], [0.19, -0.18, 0]);
  batchStaticGeometry(connection);
  parent.add(connection);
}

function windowAssembly(parent, materials, side, z, width, height = 1.16, y = 1.88, x = side * 1.405) {
  box(parent, materials.rubber, [0.075, 0.065, width + 0.11], [x, y - height / 2, z]);
  box(parent, materials.rubber, [0.075, 0.065, width + 0.11], [x, y + height / 2, z]);
  for (const end of [-1, 1]) box(parent, materials.rubber, [0.075, height, 0.065], [x, y, z + end * width / 2]);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.045, height - 0.045), materials.trainGlass);
  glass.position.set(x + side * 0.045, y, z);
  glass.rotation.y = side * Math.PI / 2;
  glass.name = 'PassengerWindow';
  parent.add(glass);
}

export class TrainCar extends THREE.Group {
  constructor(materials, { index = 0, leading = false, trailing = false, lineId = 'U1', platformSide = -1 } = {}) {
    super();
    this.name = `TrainCar-${index + 1}`;
    this.carNumber = 101 + index;
    this.lineId = lineId;
    this.platformSide = platformSide;
    this.destination = 'Central';
    this.doors = [];
    this.doorways = [];
    this.destinationDisplays = [];
    this.cabs = [];
    this.interiorColliders = [];
    this.doorProgressBySide = { '-1': 0, '1': 0 };
    this.doorTargets = { '-1': 0, '1': 0 };
    this.doorTarget = 0;
    this.doorProgress = 0;
    this.buildBody(materials, leading, trailing);
    this.buildInterior(materials, leading, trailing);
    this.buildBogies(materials);
    this.buildRoof(materials);
    batchStaticGeometry(this);
  }

  buildBody(m, leading, trailing) {
    const minZ = leading ? -6.55 : -7.925;
    const maxZ = trailing ? 6.55 : 7.925;
    const centerZ = (minZ + maxZ) / 2;
    const bodyLength = maxZ - minZ;
    this.userData.vehicleDesign = { family: 'Aurealis C-series', carLength: CAR_LENGTH, spacing: CAR_SPACING, passengerMinZ: minZ, passengerMaxZ: maxZ };
    box(this, m.cabCharcoal, [2.58, 0.27, bodyLength - 0.1], [0, -0.15, centerZ]);
    const floorMin = leading ? -6.55 : -7.8, floorMax = trailing ? 6.55 : 7.8;
    box(this, m.interior, [2.67, 0.08, floorMax - floorMin], [0, 0.055, (floorMin + floorMax) / 2]);
    // A rounded shoulder and separate roof give the cars a real vehicle profile.
    const roofProfile = new THREE.Shape();
    roofProfile.moveTo(-1.42, 2.57);
    roofProfile.quadraticCurveTo(-1.4, 2.99, -0.99, 3.07);
    roofProfile.lineTo(0.99, 3.07);
    roofProfile.quadraticCurveTo(1.4, 2.99, 1.42, 2.57);
    roofProfile.lineTo(1.32, 2.57);
    roofProfile.quadraticCurveTo(1.29, 2.9, 0.96, 2.96);
    roofProfile.lineTo(-0.96, 2.96);
    roofProfile.quadraticCurveTo(-1.29, 2.9, -1.32, 2.57);
    roofProfile.closePath();
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofProfile, { depth: bodyLength, bevelEnabled: false, curveSegments: 8 }), m.trainSilver);
    roof.position.z = minZ;
    roof.castShadow = true; roof.receiveShadow = true;
    this.add(roof);
    for (const side of [-1, 1]) {
      // Keep real apertures behind the separate sliding door leaves.
      // Continuous lower panels would otherwise remain across an open doorway.
      for (const [start, end] of [[-7.93, -6.44], [-4.56, -0.94], [0.94, 4.56], [6.44, 7.93]]) {
        const first = Math.max(start, minZ), last = Math.min(end, maxZ);
        if (last <= first) continue;
        const length = last - first;
        const z = (first + last) / 2;
        box(this, m.trainSilver, [0.095, 0.93, length], [side * 1.365, 0.6, z]);
        box(this, m.trainBlue, [0.095, 0.28, length], [side * 1.365, 1.155, z]);
        box(this, m.trainAccent, [0.105, 0.085, length], [side * 1.375, 0.27, z]);
        box(this, m.cabCharcoal, [0.10, 0.10, length], [side * 1.372, 0.12, z]);
        box(this, m.steel, [0.11, 0.055, length], [side * 1.385, 0.08, z]);
      }
      box(this, m.trainBlue, [0.085, 0.20, bodyLength], [side * 1.365, 2.515, centerZ]);
      box(this, m.trainSilver, [0.09, 0.08, bodyLength], [side * 1.367, 2.655, centerZ]);
      // Continuous body panels surround actual window apertures.
      for (const z of [-7.86, -6.68, -4.45, -3.96, -1.15, -0.87, 0.87, 1.15, 3.96, 4.45, 6.68, 7.86]) {
        if (z - 0.08 < minZ || z + 0.08 > maxZ) continue;
        box(this, m.trainBlue, [0.095, 1.37, 0.16], [side * 1.365, 1.76, z]);
      }
      for (const z of [-2.58, 2.58]) windowAssembly(this, m, side, z, 2.55);
      for (const z of [-7.25, 7.25]) if (z >= minZ && z <= maxZ) windowAssembly(this, m, side, z, 0.91);
      for (const z of [-5.5, 0, 5.5]) this.buildDoor(m, side, z);
      this.addDestinationDisplay(this, 1.45, 0.18, [side * 1.432, 2.51, -2.6], { background: '#15212b', color: '#ead7a1', fontSize: 78, rotation: [0, side * Math.PI / 2, 0] });
      label(this, `AUREALIS  ·  ${this.carNumber}`, 1.75, 0.16, [side * 1.425, 0.64, 2.58], { background: '#b9c1c8', color: '#263a47', fontSize: 88, rotation: [0, side * Math.PI / 2, 0] });
      const identity = label(this, this.lineId, 0.32, 0.19, [side * 1.431, 0.7, -1.23], { background: `#${m.trainAccent.color.getHexString()}`, color: '#ffffff', fontSize: 245, rotation: [0, side * Math.PI / 2, 0] });
      identity.name = 'LineIdentity'; identity.userData.lineId = this.lineId;
      label(this, '♿', 0.20, 0.20, [side * 1.435, 1.12, 1.03], { background: '#287fbb', color: '#edf0df', fontSize: 330, rotation: [0, side * Math.PI / 2, 0] });
    }
    for (const end of [-1, 1]) {
      if ((end === -1 && leading) || (end === 1 && trailing)) this.buildCab(m, end, leading);
      else {
        box(this, m.trainSilver, [2.68, 2.56, 0.12], [0, 1.45, end * 7.88]);
        box(this, m.dark, [0.92, 2.28, 0.14], [0, 1.3, end * 7.96]);
      }
    }
  }

  buildDoor(m, side, z) {
    const assembly = new THREE.Group();
    assembly.name = 'DoorAssembly';
    assembly.position.set(side * 1.397, 0, z);
    this.doorways.push({ side, localZ: z, assembly });
    this.add(assembly);
    box(assembly, m.rubber, [0.065, 0.06, 1.89], [0, 2.47, 0]);
    box(assembly, m.steel, [0.13, 0.035, 1.87], [side * 0.025, 0.065, 0]);
    for (const direction of [-1, 1]) {
      box(assembly, m.rubber, [0.07, 2.37, 0.06], [0, 1.27, direction * 0.91]);
      const leaf = new THREE.Group();
      leaf.name = 'DoorLeaf';
      leaf.userData.dynamic = true;
      leaf.position.z = direction * 0.439;
      leaf.userData.closedZ = leaf.position.z;
      leaf.userData.direction = direction;
      leaf.userData.side = side;
      box(leaf, m.trainSilver, [0.06, 1.06, 0.84], [0, 0.62, 0]);
      box(leaf, m.trainBlue, [0.06, 0.31, 0.84], [0, 2.27, 0]);
      for (const edge of [-1, 1]) box(leaf, m.trainBlue, [0.06, 1.06, 0.1], [0, 1.63, edge * 0.369]);
      windowAssembly(leaf, m, side, 0, 0.61, 0.91, 1.69, 0);
      box(leaf, m.rubber, [0.067, 2.33, 0.016], [side * 0.01, 1.25, -direction * 0.421]);
      box(leaf, m.trainBlue, [0.065, 0.16, 0.84], [side * 0.007, 1.12, 0]);
      box(leaf, m.trainAccent, [0.065, 0.085, 0.84], [side * 0.007, 0.27, 0]);
      box(leaf, m.steel, [0.08, 0.12, 0.025], [side * 0.025, 1.07, -direction * 0.3]);
      label(leaf, '←  →', 0.26, 0.09, [side * 0.039, 0.82, 0], { background: '#9daaa6', color: '#263e38', fontSize: 180, rotation: [0, side * Math.PI / 2, 0] });
      batchStaticGeometry(leaf);
      assembly.add(leaf);
      this.doors.push(leaf);
    }
    box(assembly, m.warmLight, [0.08, 0.045, 0.08], [side * 0.04, 2.5, 0]);
  }

  buildInterior(m, leading, trailing) {
    buildPassengerInterior(this, m, { leading, trailing });
  }

  buildBogies(m) {
    const wheelY = -0.684;
    this.userData.undercarriage = { wheelRadius: 0.34, wheelCenterY: wheelY, wheelCenterX: 0.72, railHeadY: -1.024 };
    for (const z of [-5.8, 5.8]) {
      box(this, m.dark, [1.75, 0.3, 2.7], [0, -0.45, z]);
      box(this, m.wheel, [2.05, 0.15, 2.2], [0, -0.57, z]);
      for (const axle of [-0.85, 0.85]) {
        cylinder(this, m.steel, 0.09, 2.15, [0, wheelY, z + axle], [0, 0, Math.PI / 2]);
        for (const side of [-1, 1]) {
          cylinder(this, m.wheel, 0.34, 0.15, [side * 0.72, wheelY, z + axle], [0, 0, Math.PI / 2], 24);
          cylinder(this, m.dark, 0.14, 0.19, [side * 0.72, wheelY, z + axle], [0, 0, Math.PI / 2]);
          cylinder(this, m.wheel, 0.355, 0.022, [side * 0.645, wheelY, z + axle], [0, 0, Math.PI / 2], 24);
          cylinder(this, m.steel, 0.095, 0.028, [side * 0.82, wheelY, z + axle], [0, 0, Math.PI / 2]);
          cylinder(this, m.steel, 0.08, 0.23, [side * 0.93, -0.47, z + axle]);
          box(this, m.dark, [0.16, 0.18, 0.44], [side * 0.93, -0.58, z + axle]);
        }
      }
    }
    box(this, m.dark, [1.7, 0.42, 2.8], [0, -0.4, -1.2]);
    box(this, m.aluminum, [0.9, 0.3, 2.1], [0.15, -0.37, 2]);
  }

  buildRoof(m) {
    for (const z of [-4.5, 4.5]) {
      box(this, m.dark, [1.74, 0.06, 2.6], [0, 3.07, z]);
      box(this, m.aluminum, [1.52, 0.23, 2.32], [0, 3.19, z]);
      const slats = [];
      for (let i = 0; i < 12; i++) slats.push({ size: [1.1, 0.012, 0.038], position: [0, 3.309, z - 0.87 + i * 0.16] });
      instances(this, m.dark, slats, undefined, false);
    }
    box(this, m.aluminum, [0.85, 0.12, 2.5], [0, 3.11, 0]);
    for (const z of [-6.4, -1.6, 1.6, 6.4]) box(this, m.rubber, [2.22, 0.012, 0.024], [0, 3.075, z], { shadow: false });
  }

  buildCab(m, end, leading) {
    buildRoundedCab(this, m, end, leading);
  }

  addDestinationDisplay(parent, width, height, position, options) {
    const display = label(parent, `${this.lineId}   ${this.destination.toUpperCase()}`, width, height, position, options);
    display.name = 'DestinationDisplay';
    display.userData.dynamic = true;
    display.userData.lineId = this.lineId;
    display.userData.destination = this.destination;
    this.destinationDisplays.push({ display, options });
    return display;
  }

  setDestination(destination) {
    this.destination = destination;
    for (const { display, options } of this.destinationDisplays) {
      const texture = display.material.map;
      const canvas = texture.image;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = options.color;
      ctx.font = `600 ${options.fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${this.lineId}   ${destination.toUpperCase()}`, canvas.width / 2, canvas.height / 2, canvas.width - 50);
      texture.needsUpdate = true;
      display.userData.destination = destination;
      display.userData.lineId = this.lineId;
    }
  }

  setLineId(lineId) {
    if (this.lineId === lineId) return;
    this.lineId = lineId;
    this.setDestination(this.destination);
  }

  setPlatformSide(side) {
    if (side !== -1 && side !== 1) throw new Error('A train platform side must be -1 or 1.');
    this.platformSide = side;
    this.applyDoorPositions();
  }

  setDirection(direction) {
    for (const { end, lamps, headlights, materials } of this.cabs) {
      const leading = end === -direction;
      for (const { main, marker } of lamps) {
        main.material = leading ? materials.warmLight : materials.redLight;
        marker.material = leading ? materials.redLight : materials.warmLight;
      }
      headlights.intensity = leading ? 24 : 0;
    }
  }

  openDoors(side = this.platformSide) {
    if (side == null) { this.doorTargets[-1] = 1; this.doorTargets[1] = 1; }
    else this.doorTargets[side] = 1;
    this.doorTarget = this.doorTargets[this.platformSide];
  }

  closeDoors(side = null) {
    if (side == null) { this.doorTargets[-1] = 0; this.doorTargets[1] = 0; }
    else this.doorTargets[side] = 0;
    this.doorTarget = this.doorTargets[this.platformSide];
  }

  setDoorsOpen(side = this.platformSide) {
    this.closeDoors();
    this.doorTargets[side] = 1;
    this.doorProgressBySide[-1] = side === -1 ? 1 : 0;
    this.doorProgressBySide[1] = side === 1 ? 1 : 0;
    this.applyDoorPositions();
  }

  applyDoorPositions() {
    this.doorProgress = this.doorProgressBySide[this.platformSide];
    this.doorTarget = this.doorTargets[this.platformSide];
    for (const leaf of this.doors) {
      leaf.position.z = leaf.userData.closedZ + leaf.userData.direction * this.doorProgressBySide[leaf.userData.side] * 0.81;
    }
  }

  update(delta) {
    for (const side of [-1, 1]) {
      const target = this.doorTargets[side];
      if (this.doorProgressBySide[side] === target) continue;
      this.doorProgressBySide[side] = THREE.MathUtils.damp(this.doorProgressBySide[side], target, 5, delta);
      if (Math.abs(this.doorProgressBySide[side] - target) < 0.001) this.doorProgressBySide[side] = target;
    }
    this.applyDoorPositions();
  }
}

export class Train extends THREE.Group {
  constructor(materials, { carCount = 3, position = [1.57, 0, 0], lineId = 'U1', platformSide = -1, accentColor = null } = {}) {
    super();
    this.name = lineId === 'U1' ? 'MetroTrain' : `${lineId}-MetroTrain`;
    this.lineId = lineId;
    this.platformSide = platformSide;
    this.direction = 1;
    this.destination = 'Central';
    if (accentColor) {
      const trainAccent = materials.trainAccent.clone();
      trainAccent.color.set(accentColor);
      materials = { ...materials, trainAccent };
    }
    this.materials = materials;
    this.position.set(...position);
    this.cars = [];
    for (let i = 0; i < carCount; i++) {
      const car = new TrainCar(materials, { index: i, leading: i === 0, trailing: i === carCount - 1, lineId, platformSide });
      car.position.z = (i - (carCount - 1) / 2) * CAR_SPACING;
      this.cars.push(car); this.add(car);
      if (i < carCount - 1) {
        const z = car.position.z + CAR_SPACING / 2;
        buildGangway(this, materials, z);
      }
    }
  }
  get doorsOpen() { return this.cars.every(car => car.doorProgressBySide[this.platformSide] >= 0.98); }
  get doorsClosed() { return this.cars.every(car => Object.values(car.doorProgressBySide).every(progress => progress === 0)); }
  get doorsMoving() { return this.cars.some(car => [-1, 1].some(side => car.doorProgressBySide[side] !== car.doorTargets[side])); }

  get boardingDoors() {
    return this.getBoardingDoors();
  }

  getBoardingDoors(side = this.platformSide) {
    this.updateWorldMatrix(true, true);
    return this.cars.flatMap((car, carIndex) => car.doorways.filter(door => door.side === side).map(door => ({
      carIndex, localZ: door.localZ, side, width: 1.72,
      position: car.localToWorld(new THREE.Vector3(side * 1.397, 0.1, door.localZ)),
    })));
  }

  nearestBoardingDoor(worldX, worldZ) {
    let nearest = null;
    for (const door of this.boardingDoors) {
      const distance = Math.hypot(door.position.x - worldX, door.position.z - worldZ);
      if (!nearest || distance < nearest.distance) nearest = { ...door, distance };
    }
    return nearest;
  }

  cabinBounds(carIndex) {
    const car = this.cars[carIndex];
    if (!car) return null;
    const center = car.getWorldPosition(new THREE.Vector3());
    return { minX: center.x - 1.02, maxX: center.x + 1.02, minZ: center.z - 6.75, maxZ: center.z + 6.75, floorY: center.y + 0.095 };
  }

  setPlatformSide(side) {
    if (side !== -1 && side !== 1) throw new Error('A train platform side must be -1 or 1.');
    this.platformSide = side;
    this.cars.forEach(car => car.setPlatformSide(side));
  }
  setLineId(lineId) {
    this.lineId = lineId;
    this.cars.forEach(car => car.setLineId(lineId));
  }
  openDoors(side = this.platformSide) { this.cars.forEach(car => car.openDoors(side)); }
  closeDoors(side = null) { this.cars.forEach(car => car.closeDoors(side)); }
  setDoorsOpen(side = this.platformSide) { this.cars.forEach(car => car.setDoorsOpen(side)); }
  setDestination(destination) { this.destination = destination; this.cars.forEach(car => car.setDestination(destination)); }
  setDirection(direction) { this.direction = direction; this.cars.forEach(car => car.setDirection(direction)); }
  update(delta) { this.cars.forEach(car => car.update(delta)); }
}
