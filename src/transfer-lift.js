import * as THREE from 'three';
import { box, label } from './geometry.js';

/** A moving, supported lift cabin beside a switchback stair; no position jump between levels. */
export class TransferLift {
  constructor(transfer, tower, m) {
    this.transfer = transfer; this.tower = tower; this.floorY = tower.topY; this.targetY = this.floorY;
    this.topY = tower.topY; this.bottomY = tower.bottomY; this.rider = null; this.speed = 2.5;
    const group = new THREE.Group(); group.scale.x = tower.liftSide ?? 1; tower.group.add(group); this.group = group;
    const cabin = new THREE.Group(); cabin.name = 'AccessiblePassengerLift'; cabin.userData.dynamic = true;
    cabin.position.y = this.floorY; group.add(cabin); this.cabin = cabin;
    const glazing = new THREE.MeshStandardMaterial({ color: '#a8c8d1', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    for (const x of [-6.9, -3.7]) for (const z of [10.8, 14.2]) box(group, m.steel, [0.12, this.topY - this.bottomY + 3.2, 0.12], [x, (this.topY + this.bottomY + 3.2) / 2, z]);
    box(group, glazing, [0.035, this.topY - this.bottomY + 3.2, 3.4], [-6.9, (this.topY + this.bottomY + 3.2) / 2, 12.5]);
    box(cabin, m.steel, [3.1, 0.16, 3.2], [-5.3, -0.1, 12.5]);
    box(cabin, m.tile, [2.9, 0.025, 3], [-5.3, -0.0125, 12.5]);
    box(cabin, m.steel, [3.1, 0.12, 3.2], [-5.3, 2.85, 12.5]);
    box(cabin, m.tubeLight, [2.2, 0.025, 0.2], [-5.3, 2.77, 12.5]);
    for (const z of [10.98, 14.02]) box(cabin, glazing, [2.9, 2.7, 0.04], [-5.3, 1.35, z]);
    box(cabin, glazing, [0.04, 2.7, 3], [-6.75, 1.35, 12.5]);
    box(cabin, m.steel, [0.04, 0.045, 2.5], [-6.65, 1, 12.5]);
    label(cabin, 'LIFT  /  AUFZUG', 1.6, 0.2, [-6.7, 2.2, 12.5], { rotation: [0, Math.PI / 2, 0], background: '#123b75', fontSize: 120 });
    this.surface = transfer.addSurface(group, 'lift-cabin', { minX: -6.75, maxX: -3.85, minZ: 11, maxZ: 14 }, () => this.floorY,
      { kind: 'lift', edges: { maxX: false } });
    for (const y of [this.topY, this.bottomY]) {
      const bounds = { minX: -3.87, maxX: -2.98, minZ: 11, maxZ: 14 };
      transfer.floor(group, m, bounds, y);
      transfer.addSurface(group, 'lift-landing', bounds, () => y, { floorY: y, edges: { minX: false, maxX: false } });
      label(group, '♿  LIFT', 1.2, 0.24, [-3.17, y + 2.65, 12.5], { rotation: [0, Math.PI / 2, 0], background: '#123b75', fontSize: 150 });
    }
    group.updateWorldMatrix(true, true); this.inverse = group.matrixWorld.clone().invert();
  }
  localPlayer(player) { return player.camera.position.clone().applyMatrix4(this.inverse); }
  hint(player) {
    if (player.ridingCar) return null;
    const p = this.localPlayer(player), feet = player.camera.position.y - 1.76;
    if (p.x < -7.2 || p.x > -1.5 || p.z < 9.5 || p.z > 15.5) return null;
    const level = Math.abs(feet - this.topY) < 0.4 ? this.topY : Math.abs(feet - this.bottomY) < 0.4 ? this.bottomY : null;
    if (this.rider === player) return { text: 'Lift travelling', enabled: false };
    if (level === null) return null;
    if (Math.abs(this.targetY - this.floorY) > 0.01) return { text: 'Lift travelling', enabled: false };
    if (Math.abs(this.floorY - level) > 0.1) return { text: 'Call lift', enabled: true, level };
    if (p.x > -3.9) return { text: 'Enter lift to travel', enabled: false };
    return { text: level === this.topY ? 'Take lift down' : 'Take lift up', enabled: true, ride: true };
  }
  activate(player) {
    const hint = this.hint(player); if (!hint?.enabled) return false;
    if (hint.ride) { this.rider = player; player.setEnabled(false); this.targetY = this.floorY === this.topY ? this.bottomY : this.topY; }
    else this.targetY = hint.level;
    return true;
  }
  update(delta) {
    const difference = this.targetY - this.floorY;
    if (Math.abs(difference) < 1e-8 && !this.rider) return;
    this.floorY = Math.abs(difference) <= this.speed * delta + 1e-8 ? this.targetY
      : this.floorY + Math.sign(difference) * this.speed * delta;
    this.cabin.position.y = this.floorY;
    if (this.rider) this.rider.camera.position.y = this.floorY + 1.76;
    if (this.floorY === this.targetY && this.rider) { this.rider.setEnabled(true); this.rider = null; }
  }
}
