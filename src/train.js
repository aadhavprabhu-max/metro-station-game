import * as THREE from 'three';
import { box, cylinder, instances, label } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

const CAR_LENGTH = 16;
const CAR_SPACING = 17;

function windowAssembly(parent, materials, side, z, width, height = 1.16, y = 1.88, x = side * 1.405) {
  box(parent, materials.rubber, [0.075, 0.065, width + 0.11], [x, y - height / 2, z]);
  box(parent, materials.rubber, [0.075, 0.065, width + 0.11], [x, y + height / 2, z]);
  for (const end of [-1, 1]) box(parent, materials.rubber, [0.075, height, 0.065], [x, y, z + end * width / 2]);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.045, height - 0.045), materials.glass);
  glass.position.set(x + side * 0.045, y, z);
  glass.rotation.y = side * Math.PI / 2;
  glass.name = 'PassengerWindow';
  parent.add(glass);
}

export class TrainCar extends THREE.Group {
  constructor(materials, { index = 0, leading = false, trailing = false } = {}) {
    super();
    this.name = `TrainCar-${index + 1}`;
    this.carNumber = 101 + index;
    this.doors = [];
    this.doorTarget = 0;
    this.doorProgress = 0;
    this.buildBody(materials, leading, trailing);
    this.buildInterior(materials);
    this.buildBogies(materials);
    this.buildRoof(materials);
    batchStaticGeometry(this);
  }

  buildBody(m, leading, trailing) {
    box(this, m.dark, [2.58, 0.27, CAR_LENGTH - 0.25], [0, -0.15, 0]);
    box(this, m.interior, [2.67, 0.08, 15.6], [0, 0.055, 0]);
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
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofProfile, { depth: 15.85, bevelEnabled: false, curveSegments: 8 }), m.aluminum);
    roof.position.z = -7.925;
    roof.castShadow = true; roof.receiveShadow = true;
    this.add(roof);
    for (const side of [-1, 1]) {
      box(this, m.whitePaint, [0.095, 0.93, 15.86], [side * 1.365, 0.6, 0]);
      box(this, m.trainAccent, [0.105, 0.25, 15.94], [side * 1.377, 1.025, 0]);
      box(this, m.whitePaint, [0.085, 0.29, 15.84], [side * 1.365, 2.565, 0]);
      box(this, m.trainAccent, [0.11, 0.22, 15.93], [side * 1.375, 0.27, 0]);
      box(this, m.steel, [0.11, 0.055, 15.92], [side * 1.385, 0.08, 0]);
      // Continuous body panels surround actual window apertures.
      for (const z of [-7.86, -6.68, -4.45, -3.96, -1.15, -0.87, 0.87, 1.15, 3.96, 4.45, 6.68, 7.86]) {
        box(this, m.whitePaint, [0.095, 1.37, 0.16], [side * 1.365, 1.76, z]);
      }
      for (const z of [-2.58, 2.58]) windowAssembly(this, m, side, z, 2.55);
      for (const z of [-7.25, 7.25]) windowAssembly(this, m, side, z, 0.91);
      for (const z of [-5.5, 0, 5.5]) this.buildDoor(m, side, z);
      label(this, `U1   CENTRAL`, 1.45, 0.18, [side * 1.432, 2.58, -2.6], { background: '#102524', color: '#ead7a1', fontSize: 78, rotation: [0, side * Math.PI / 2, 0] });
      label(this, `M   ${this.carNumber}`, 0.8, 0.17, [side * 1.425, 0.68, 7.15], { background: '#d4ded6', color: '#28554e', fontSize: 94, rotation: [0, side * Math.PI / 2, 0] });
      label(this, '♿', 0.22, 0.22, [side * 1.435, 1.05, 1.03], { background: '#31534f', color: '#edf0df', fontSize: 330, rotation: [0, side * Math.PI / 2, 0] });
    }
    for (const end of [-1, 1]) {
      if ((end === -1 && leading) || (end === 1 && trailing)) this.buildCab(m, end, leading);
      else {
        box(this, m.whitePaint, [2.68, 2.56, 0.12], [0, 1.45, end * 7.88]);
        box(this, m.dark, [0.92, 2.28, 0.14], [0, 1.3, end * 7.96]);
      }
    }
  }

  buildDoor(m, side, z) {
    const assembly = new THREE.Group();
    assembly.name = 'DoorAssembly';
    assembly.position.set(side * 1.397, 0, z);
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
      box(leaf, m.aluminum, [0.06, 1.06, 0.84], [0, 0.62, 0]);
      box(leaf, m.aluminum, [0.06, 0.31, 0.84], [0, 2.27, 0]);
      for (const edge of [-1, 1]) box(leaf, m.aluminum, [0.06, 1.06, 0.1], [0, 1.63, edge * 0.369]);
      windowAssembly(leaf, m, side, 0, 0.61, 0.91, 1.69, 0);
      box(leaf, m.rubber, [0.067, 2.33, 0.016], [side * 0.01, 1.25, -direction * 0.421]);
      box(leaf, m.trainAccent, [0.065, 0.25, 0.84], [side * 0.007, 1.026, 0]);
      box(leaf, m.steel, [0.08, 0.12, 0.025], [side * 0.025, 1.07, -direction * 0.3]);
      label(leaf, '←  →', 0.26, 0.09, [side * 0.039, 0.82, 0], { background: '#9daaa6', color: '#263e38', fontSize: 180, rotation: [0, side * Math.PI / 2, 0] });
      batchStaticGeometry(leaf);
      assembly.add(leaf);
      this.doors.push(leaf);
    }
    box(assembly, m.warmLight, [0.08, 0.045, 0.08], [side * 0.04, 2.5, 0]);
  }

  buildInterior(m) {
    const seats = [], backs = [];
    for (const side of [-1, 1]) {
      for (const z of [-7.2, -3.5, -2.55, -1.6, 1.6, 2.55, 3.5, 7.2]) {
        seats.push({ position: [side * 0.95, 0.57, z], size: [0.6, 0.14, 0.78] });
        backs.push({ position: [side * 1.18, 0.96, z], size: [0.12, 0.65, 0.78] });
        box(this, m.dark, [0.07, 0.42, 0.54], [side * 1.02, 0.28, z], { shadow: false });
      }
      box(this, m.tubeLight, [0.085, 0.025, 14.8], [side * 0.83, 2.77, 0], { shadow: false });
      cylinder(this, m.steel, 0.02, 14.1, [side * 0.68, 2.44, 0], [Math.PI / 2, 0, 0]);
    }
    instances(this, m.seat, [...seats, ...backs], undefined, false);
    for (const z of [-5.5, 0, 5.5]) cylinder(this, m.steel, 0.024, 2.5, [0, 1.35, z]);
    box(this, m.interior, [2.57, 0.08, 15.65], [0, 2.82, 0], { shadow: false });
  }

  buildBogies(m) {
    for (const z of [-5.8, 5.8]) {
      box(this, m.dark, [1.75, 0.3, 2.7], [0, -0.45, z]);
      box(this, m.wheel, [2.05, 0.15, 2.2], [0, -0.57, z]);
      for (const axle of [-0.85, 0.85]) {
        cylinder(this, m.steel, 0.09, 2.15, [0, -0.77, z + axle], [0, 0, Math.PI / 2]);
        for (const side of [-1, 1]) {
          cylinder(this, m.wheel, 0.34, 0.15, [side * 0.72, -0.77, z + axle], [0, 0, Math.PI / 2], 20);
          cylinder(this, m.dark, 0.14, 0.19, [side * 0.72, -0.77, z + axle], [0, 0, Math.PI / 2]);
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
    const cab = new THREE.Group();
    cab.name = leading ? 'FrontCab' : 'RearCab';
    cab.position.z = end * 7.9;
    if (end === 1) cab.rotation.y = Math.PI;
    const profile = new THREE.Shape();
    profile.moveTo(-1.34, 0.15); profile.lineTo(1.34, 0.15); profile.lineTo(1.36, 2.34);
    profile.quadraticCurveTo(1.3, 2.91, 0.9, 2.96); profile.lineTo(-0.9, 2.96);
    profile.quadraticCurveTo(-1.3, 2.91, -1.36, 2.34); profile.closePath();
    const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.055, bevelSegments: 2 }), m.whitePaint);
    shell.position.z = -0.33; shell.castShadow = true; shell.receiveShadow = true; cab.add(shell);
    box(cab, m.trainAccent, [2.58, 0.65, 0.18], [0, 0.7, -0.405]);
    box(cab, m.dark, [2.37, 1.18, 0.08], [0, 1.99, -0.439]);
    box(cab, m.cabGlass, [2.2, 1.04, 0.018], [0, 1.99, -0.485]);
    box(cab, m.rubber, [0.035, 1.08, 0.025], [0, 1.99, -0.501]);
    box(cab, m.dark, [2.0, 0.31, 0.1], [0, 2.73, -0.433]);
    label(cab, 'U1   CENTRAL', 1.9, 0.24, [0, 2.73, -0.494], { rotation: [0, Math.PI, 0], background: '#122724', color: '#efcf80', fontSize: 93 });
    for (const side of [-1, 1]) {
      box(cab, m.dark, [0.51, 0.22, 0.08], [side * 0.85, 0.99, -0.515]);
      box(cab, leading ? m.warmLight : m.redLight, [0.36, 0.115, 0.024], [side * 0.85, 1.01, -0.568], { shadow: false });
      box(cab, leading ? m.redLight : m.warmLight, [0.13, 0.04, 0.027], [side * 1.05, 0.78, -0.543], { shadow: false });
      box(cab, m.rubber, [0.018, 0.57, 0.026], [side * 0.53, 1.79, -0.517], { rotation: [0, 0, side * -0.48] });
    }
    box(cab, m.rubber, [2.16, 0.18, 0.19], [0, 0.24, -0.48]);
    box(cab, m.dark, [0.45, 0.2, 0.49], [0, -0.06, -0.53]);
    label(cab, `M    ${this.carNumber}`, 0.86, 0.14, [0, 0.52, -0.508], { background: '#316c65', color: '#e4eada', rotation: [0, Math.PI, 0], fontSize: 104 });
    if (leading) {
      const headlights = new THREE.SpotLight('#fff0c8', 24, 15, 0.45, 0.6, 1.7);
      headlights.position.set(0, 1, -0.65);
      headlights.target.position.set(0, -0.8, -10);
      cab.add(headlights, headlights.target);
    }
    this.add(cab);
  }

  openDoors() { this.doorTarget = 1; }
  closeDoors() { this.doorTarget = 0; }
  update(delta) {
    if (this.doorProgress === this.doorTarget) return;
    this.doorProgress = THREE.MathUtils.damp(this.doorProgress, this.doorTarget, 5, delta);
    if (Math.abs(this.doorProgress - this.doorTarget) < 0.001) this.doorProgress = this.doorTarget;
    for (const leaf of this.doors) leaf.position.z = leaf.userData.closedZ + leaf.userData.direction * this.doorProgress * 0.81;
  }
}

export class Train extends THREE.Group {
  constructor(materials, { carCount = 3, position = [1.57, 0, 0] } = {}) {
    super();
    this.name = 'MetroTrain';
    this.position.set(...position);
    this.cars = [];
    for (let i = 0; i < carCount; i++) {
      const car = new TrainCar(materials, { index: i, leading: i === 0, trailing: i === carCount - 1 });
      car.position.z = (i - (carCount - 1) / 2) * CAR_SPACING;
      this.cars.push(car); this.add(car);
      if (i < carCount - 1) {
        const z = car.position.z + CAR_SPACING / 2;
        const connection = new THREE.Group();
        connection.name = 'Gangway';
        this.add(connection);
        box(connection, materials.rubber, [2.38, 2.64, 0.87], [0, 1.51, z]);
        for (let rib = -3; rib <= 3; rib++) {
          box(connection, materials.dark, [2.48, 2.65, 0.026], [0, 1.51, z + rib * 0.108]);
        }
        box(connection, materials.dark, [0.3, 0.2, 1.1], [0, -0.18, z]);
        batchStaticGeometry(connection);
      }
    }
  }
  openDoors() { this.cars.forEach(car => car.openDoors()); }
  closeDoors() { this.cars.forEach(car => car.closeDoors()); }
  update(delta) { this.cars.forEach(car => car.update(delta)); }
}
