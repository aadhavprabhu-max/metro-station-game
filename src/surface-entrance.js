import * as THREE from 'three';
import { NetworkTransfer } from './network-transfers.js';
import { box, cylinder, label, instances } from './geometry.js';
import { archWedge } from './phase6-stations.js';
import { batchStaticGeometry } from './optimize.js';
import { STREET_Y, CENTRAL_EXIT } from './city-layout.js';

/** Uses the proven switchback support geometry, in a dedicated shaft between halls. */
export class SurfaceEntrance extends NetworkTransfer {
  constructor(materials, station) {
    const street = new THREE.Group();
    station.updateWorldMatrix(true, false);
    street.position.copy(station.getWorldPosition(new THREE.Vector3())); street.position.y = STREET_Y;
    street.quaternion.copy(station.getWorldQuaternion(new THREE.Quaternion()));
    Object.assign(street, { stationId: station.stationId, lineId: 'U4', displayName: 'Central · Old town',
      platformId: 'station-2:U4:surface', platformNumber: 'CITY', options: { signageColor: '#8d58ac' } });
    const m = { ...materials, concrete: materials.stone, wallTile: materials.stone, wall: materials.stone,
      tile: materials.pale, steel: materials.bronze, tubeLight: materials.warmLight };
    super(m, street, station, { upperEnd: CENTRAL_EXIT.end, lowerEnd: CENTRAL_EXIT.end });
    this.name = 'CentralU4SurfaceEntrance'; this.isStreetEntrance = true; this.isCityEntrance = true;
    this.streetY = STREET_Y;
    const tower = this.towers[0].group;
    this.streetPortal = tower.localToWorld(new THREE.Vector3(0, STREET_Y, -2));
    this.shaftBounds = { minX: tower.position.x - 3.4, maxX: tower.position.x + 3.4,
      minZ: tower.position.z + 14.5, maxZ: tower.position.z + 23.85 };
    this.buildFacade(materials, tower);
    // Approach overlaps the old platform's supported aperture by 1.6 m.
    this.addSurface(tower, 'platform-threshold', { minX: -3, maxX: 3, minZ: -1.6, maxZ: 0 }, () => this.lowerY,
      { floorY: this.lowerY, kind: 'entry', edges: { minZ: false, maxZ: false } });
    this.walkingPath[0].y = STREET_Y;
    this.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(this);
    this.worldBounds = { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z,
      minY: this.lowerY, maxY: bounds.max.y };
    this.userData.cityExit = { lineId: 'U4', stationId: station.stationId, rise: STREET_Y - this.lowerY,
      flights: this.towers[0].flights, streetY: STREET_Y };
    batchStaticGeometry(this);
  }

  buildApproach(m, group, y, start, end, id) {
    this.addSurface(group, id, { minX: -3, maxX: 3, minZ: start, maxZ: end }, () => y,
      { floorY: y, kind: 'entry', edges: { minZ: false, maxZ: false } });
    this.floor(group, m, { minX: -3, maxX: 3, minZ: start, maxZ: end }, y);
    for (const x of [-3.15, 3.15]) box(group, m.wallTile, [0.22, 2.35, end - start], [x, y + 1.175, (start + end) / 2]);
    archWedge(group, m.wallTile, { cx: 0, spring: y + 2.3, rx: 3.05, ry: 1.08, thickness: 0.22,
      depth: end - start, z: (start + end) / 2, name: 'CentralStoneBarrelVault' });
    for (let z = start + 0.4; z < end; z += 3.4) {
      archWedge(group, m.tile, { cx: 0, spring: y + 2.26, rx: 3.02, ry: 1.08, thickness: 0.14, depth: 0.19, z,
        name: 'CentralVaultRib' });
      for (const x of [-3.18, 3.18]) {
        cylinder(group, m.tile, 0.16, 2.25, [x, y + 1.125, z], [0, 0, 0], 12);
        box(group, m.tile, [0.45, 0.18, 0.45], [x, y + 2.2, z]);
        box(group, m.dark, [0.16, 0.38, 0.23], [x * 0.95, y + 1.88, z], { shadow: false });
        box(group, m.tubeLight, [0.12, 0.24, 0.18], [x * 0.94, y + 1.89, z], { shadow: false });
      }
    }
    const inlays = [];
    for (const x of [-2.25, 2.25]) inlays.push({ size: [0.12, 0.006, end - start], position: [x, y + 0.003, (start + end) / 2] });
    for (let z = start + 1.1; z < end; z += 2.4) inlays.push({ size: [0.65, 0.006, 0.65], position: [0, y + 0.003, z], rotation: [0, Math.PI / 4, 0] });
    instances(group, m.steel, inlays, undefined, false);
  }

  buildTower(m, pose, topY, bottomY, name) {
    const tower = super.buildTower(m, pose, topY, bottomY, name);
    for (let landing = 0; landing <= tower.flights; landing++) {
      const y = topY - landing * tower.drop;
      const z = landing % 2 ? 22.9 : 14.7;
      archWedge(tower.group, m.tile, { cx: 0, spring: y + 2.5, rx: 3.05, ry: 0.65, thickness: 0.17, depth: 0.22, z,
        name: 'CentralStairLandingArch' });
    }
    return tower;
  }

  buildWayfinding(m, upper, lower) {
    for (const [pose, y, text, reverse] of [[upper, STREET_Y, 'U4  ↓  CENTRAL', true], [lower, this.lowerY, '↑  OLD TOWN / ALTSTADT', true]]) {
      const group = new THREE.Group(); group.position.copy(pose.position); group.position.y = y; group.rotation.y = pose.yaw; this.add(group);
      label(group, text, 4.7, 0.3, [0, 2.65, 1.5], { rotation: [0, reverse ? Math.PI : 0, 0], background: '#554d3d', fontSize: 82 });
      label(group, text, 4.7, 0.3, [0, 2.65, 1.49], { background: '#554d3d', fontSize: 82 });
    }
  }

  buildFacade(m, tower) {
    const root = new THREE.Group(); root.name = 'CentralMedievalLoggia'; root.position.set(0, STREET_Y, 0); tower.add(root);
    // The central arch is the actual passage into the vaulted stair hall.
    for (const x of [-5.1, 5.1]) {
      box(root, m.stone, [3.4, 7.4, 5], [x, 3.7, 1.5]);
      for (const y of [0.2, 3.2, 6.9]) box(root, m.pale, [3.65, 0.24, 5.3], [x, y, 1.5]);
      for (const side of [-1, 1]) cylinder(root, m.pale, 0.24, 3, [x + side * 1.35, 1.6, -1.1], [0, 0, 0], 16);
      archWedge(root, m.pale, { cx: x, spring: 4.2, rx: 0.55, ry: 1.15, thickness: 0.2, depth: 0.17, z: -1.06 });
      box(root, m.window, [1.05, 1.7, 0.06], [x, 4.35, -1.03]);
    }
    archWedge(root, m.stone, { cx: 0, spring: 3.2, rx: 3.4, ry: 2.7, thickness: 0.85, depth: 5, z: 1.5, name: 'CentralMonumentalEntranceArch' });
    for (let i = 0; i < 18; i++) archWedge(root, i % 3 ? m.pale : m.stone,
      { cx: 0, spring: 3.2, rx: 3.4, ry: 2.7, thickness: 0.52, depth: 0.24, z: -1.13,
        from: i * Math.PI / 18 + 0.009, to: (i + 1) * Math.PI / 18 - 0.009 });
    box(root, m.stone, [13.8, 1.3, 5.3], [0, 7.6, 1.5]);
    box(root, m.pale, [14.1, 0.25, 5.55], [0, 8.3, 1.5]);
    const pedimentShape=new THREE.Shape();pedimentShape.moveTo(-7.1,0);pedimentShape.lineTo(7.1,0);pedimentShape.lineTo(0,2.5);pedimentShape.closePath();
    const pediment=new THREE.Mesh(new THREE.ExtrudeGeometry(pedimentShape,{depth:5.7,bevelEnabled:false}),m.stone);
    pediment.position.set(0,8.3,-1.35);pediment.castShadow=pediment.receiveShadow=true;root.add(pediment);
    label(root, 'C E N T R A L', 7.6, 0.65, [0, 7.55, -1.165], { rotation: [0, Math.PI, 0], background: '#cbbfa5', color: '#464e42', fontSize: 126 });
    label(root, 'U4  ·  AUREALIS-BAHN', 4.7, 0.34, [0, 6.5, -1.17], { rotation: [0, Math.PI, 0], background: '#554d3d', fontSize: 82 });
    // A low pitched slate roof and two stone lantern turrets complete the civic silhouette.
    for (const side of [-1, 1]) box(root, m.slate, [7.5, 0.24, 6.4], [side * 3.4, 9.6, 1.5], { rotation: [0, 0, -side * 0.34] });
    for (const x of [-5.1, 5.1]) {
      box(root, m.stone, [2.2, 3, 2.4], [x, 9.9, 1.5]);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.05, 3.6, 4), m.slate); roof.rotation.y = Math.PI / 4; roof.position.set(x, 13.2, 1.5); roof.castShadow = true; root.add(roof);
    }
    this.facadeColliders = [-5.1, 5.1].map(x => ({ minX: tower.position.x + x - 1.83, maxX: tower.position.x + x + 1.83,
      minZ: tower.position.z - 1.15, maxZ: tower.position.z + 4.15 }));
  }
}
