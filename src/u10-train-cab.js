import * as THREE from 'three';
import { box, label } from './geometry.js';

const REAR = -6.55, NOSE = 4.45;
function surface(t, angle, offset = 0) {
  const taper = Math.pow(Math.max(0, 1 - t * t), 0.64);
  const w = 1.42 * taper + 0.025;
  const top = 3.07 - 2.12 * Math.pow(t, 1.45);
  const bottom = 0.1 + 0.48 * t * t;
  const c = Math.cos(angle), s = Math.sin(angle);
  return new THREE.Vector3(Math.sign(c) * Math.pow(Math.abs(c), 0.56) * (w + offset),
    (top + bottom) / 2 + Math.sign(s) * Math.pow(Math.abs(s), 0.56) * ((top - bottom) / 2 + offset), REAR - NOSE * t);
}
function patch(t0, t1, a0, a1, offset = 0, rows = 32, columns = 48) {
  const positions = [], uv = [], indices = [];
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const t = THREE.MathUtils.lerp(t0, t1, row / rows), a = THREE.MathUtils.lerp(a0, a1, col / columns);
    positions.push(...surface(t, a, offset).toArray()); uv.push(col / columns, row / rows);
    if (row < rows && col < columns) { const i = row * (columns + 1) + col; indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
export function buildExpressCab(car, m, end) {
  const group = new THREE.Group(); group.name = 'U10AerodynamicCab'; group.userData.dynamic = true;
  if (end === 1) group.rotation.y = Math.PI;
  car.add(group);
  for (const [t0, t1, a0, a1] of [[0, 1, 0, 0.64], [0, 1, Math.PI - 0.64, Math.PI * 2], [0, 0.025, 0.64, Math.PI - 0.64], [0.49, 1, 0.64, Math.PI - 0.64]]) {
    const shell = new THREE.Mesh(patch(t0, t1, a0, a1), m.whitePaint);
    shell.name = 'ExpressCompoundNose'; shell.castShadow = shell.receiveShadow = true; group.add(shell);
  }
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12), m.whitePaint);
  tip.scale.set(0.5, 1.4, 0.8); tip.position.set(0, 0.77, -10.98); group.add(tip);
  for (const [t0, t1, a0, a1] of [[0.025, 0.49, 0.64, 0.75], [0.025, 0.49, Math.PI - 0.75, Math.PI - 0.64], [0.025, 0.07, 0.75, Math.PI - 0.75], [0.43, 0.49, 0.75, Math.PI - 0.75]]) {
    const surround = new THREE.Mesh(patch(t0, t1, a0, a1, 0.012, 8, 20), m.cabCharcoal);
    surround.name = 'PanoramicWindscreenSurround'; group.add(surround);
  }
  const glass = new THREE.Mesh(patch(0.07, 0.43, 0.75, Math.PI - 0.75, 0.025, 20, 32), m.cabGlass);
  glass.name = 'ExpressPanoramicWindscreen'; group.add(glass);
  for (const side of [-1, 1]) {
    const a = side === 1 ? -0.08 : Math.PI + 0.08;
    const stripe = new THREE.Mesh(patch(0, 0.96, a - 0.085, a + 0.085, 0.018, 32, 3), m.trainAccent);
    stripe.name = 'AurealisExpressBlueSweep'; group.add(stripe);
  }
  box(group, m.rubber, [0.045, 0.035, 0.79], [0.08, 2.55, -7.58], { rotation: [0.33, 0.12, -0.3] });
  const lamps = [];
  for (const side of [-1, 1]) {
    const housing = new THREE.Group(); housing.position.set(side * 0.64, 1.0, -10.22); housing.rotation.x = -0.22;
    group.add(housing); box(housing, m.cabCharcoal, [0.45, 0.24, 0.07], [0, 0, 0]);
    const main = box(housing, m.warmLight, [0.28, 0.075, 0.02], [0, 0.035, -0.045]);
    const marker = box(housing, m.redLight, [0.17, 0.035, 0.02], [0, -0.055, -0.045]); lamps.push({ main, marker });
  }
  box(group, m.cabCharcoal, [0.56, 0.18, 0.1], [0, 0.56, -10.76]);
  const brand = label(group, 'AUREALIS', 0.58, 0.12, [0, 1.22, -10.12], { background: '#e4e8e9', color: '#123b75', rotation: [-0.65, Math.PI, 0], fontSize: 110 });
  brand.name = 'OriginalAurealisBranding';
  const headlights = new THREE.PointLight('#eef5ff', 24, 13, 2); headlights.position.set(0, 1.1, -11.3); group.add(headlights);
  car.cabs.push({ end, lamps, headlights, materials: m, windshieldMesh: glass,
    shellMetadata: { family: 'Aurealis E10', aerodynamic: true, noseLength: NOSE, tipLocalZ: -11, proprietaryBranding: false } });
}
