import * as THREE from 'three';
import { box, instances, label } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

/** A level pedestrian connection between Central's two back-to-back platforms. */
export class CentralInterchange extends THREE.Group {
  constructor(materials, u1Platform, u2Platform) {
    super();
    this.name = 'CentralTransferPassage';
    this.stationId = 'station-2';
    this.platforms = [u1Platform, u2Platform];
    this.platformIds = this.platforms.map(station => station.platformId);
    this.worldBounds = { minX: -13.4, maxX: -8.8, minZ: -266, maxZ: -262 };
    // Geometry is in U2World's mirrored coordinates. Its world position is
    // x=-11.1, z=-264; the floor overlaps each platform with no step or track.
    this.localBounds = { minX: -13.2, maxX: -8.6, minZ: 262, maxZ: 266 };
    this.walkableAreas = [this.localBounds];
    box(this, materials.concrete, [4.6, 0.18, 4], [-10.9, -0.1, 264]);
    box(this, materials.grout, [4.6, 0.012, 4], [-10.9, -0.004, 264]);
    const tiles = [];
    for (let x = -12.9; x < -8.6; x += 0.5) for (let z = 262.25; z < 266; z += 0.5) {
      tiles.push({ size: [0.492, 0.013, 0.492], position: [x, 0.008, z] });
    }
    instances(this, materials.tile, tiles, undefined, false);
    for (const z of [261.94, 266.06]) box(this, materials.wallTile, [4.6, 3.1, 0.12], [-10.9, 1.55, z]);
    box(this, materials.concrete, [4.6, 0.22, 4.25], [-10.9, 3.24, 264]);
    box(this, materials.dark, [0.2, 0.06, 2.7], [-10.9, 3.1, 264], { shadow: false });
    box(this, materials.tubeLight, [0.15, 0.025, 2.6], [-10.9, 3.055, 264], { shadow: false });
    label(this, 'U2  →  STADTZENTRUM / EISENWERK', 3.75, 0.35, [-12.22, 3.46, 264], {
      rotation: [0, -Math.PI / 2, 0], background: '#8e3530', fontSize: 63,
    });
    label(this, 'U1  →  NORDPLATZ / ROSENHEIMER PLATZ', 3.75, 0.35, [-9.6, 3.46, 264], {
      rotation: [0, Math.PI / 2, 0], background: '#965735', fontSize: 59,
    });
    // Two floor arrows make the connection easy to find from either hall.
    label(this, 'U2  →', 1.4, 0.48, [-12.6, 0.027, 264], {
      rotation: [-Math.PI / 2, 0, Math.PI / 2], background: '#b5beb8', color: '#8e3530', fontSize: 190,
    });
    label(this, '←  U1', 1.4, 0.48, [-9.2, 0.027, 264], {
      rotation: [-Math.PI / 2, 0, Math.PI / 2], background: '#b5beb8', color: '#795336', fontSize: 190,
    });
    batchStaticGeometry(this);
  }
}
