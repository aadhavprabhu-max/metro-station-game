import * as THREE from 'three';
import { box, instances, label } from './geometry.js';
import { Station } from './station.js';
import { batchStaticGeometry } from './optimize.js';

/** Route distance is measured along the rails, independently of train state. */
export class MetroRoute {
  constructor() {
    this.length = 240;
    this.stops = [
      { id: 'station-1', name: 'Nordplatz', distance: 0, platform: '01', z: 0 },
      { id: 'station-2', name: 'Central', distance: this.length, platform: '01', z: -this.length },
    ];
  }

  sample(distance) {
    const alongTrack = THREE.MathUtils.clamp(distance, 0, this.length);
    // This is a two-way line: the cab changes direction, while the consist keeps
    // its orientation. Additional route sections can replace this sampler later.
    return { position: new THREE.Vector3(1.57, 0, -alongTrack), yaw: 0 };
  }
}

function createCentralMaterials(materials) {
  const central = { ...materials };
  for (const [name, color] of Object.entries({
    greenTile: '#436a85', wallTile: '#d5dde0', wall: '#a6b4bd',
    concrete: '#b9c2c4', tile: '#c1c9ca',
  })) {
    central[name] = materials[name].clone();
    central[name].color.set(color);
  }
  return central;
}

/** Existing Nordplatz remains in the scene; this group only adds the new world. */
export class RouteWorld extends THREE.Group {
  constructor(materials, station1, route = new MetroRoute()) {
    super();
    this.name = 'MetroRouteWorld';
    this.route = route;
    this.station2 = new Station(createCentralMaterials(materials), {
      id: route.stops[1].id,
      displayName: route.stops[1].name,
      destinationName: route.stops[0].name,
      northCap: true,
      southCap: false,
      signageColor: '#365c78',
    });
    this.station2.position.z = route.stops[1].z;
    this.stations = [station1, this.station2];
    this.add(this.station2);
    this.buildConnectingTrack(materials);
    this.buildTunnel(materials);
  }

  buildConnectingTrack(m) {
    // Both original stations already own 100 m of rail. Fill the remaining gap
    // exactly, so no duplicate rail faces or sleeper rows flicker at the joins.
    const startZ = -50;
    const endZ = this.route.stops[1].z + 50;
    const length = startZ - endZ;
    const centerZ = (startZ + endZ) / 2;
    const track = new THREE.Group();
    track.name = 'ConnectingTrack';
    this.add(track);
    box(track, m.trackBed, [4.98, 0.14, length], [2.5, -1.37, centerZ]);
    const sleepers = [], clips = [], thirdRailBrackets = [];
    for (let z = startZ - 0.3; z > endZ; z -= 0.65) {
      sleepers.push({ size: [2.52, 0.14, 0.21], position: [1.57, -1.22, z] });
      for (const x of [1.57 - 0.7175, 1.57 + 0.7175]) clips.push({ size: [0.2, 0.06, 0.12], position: [x, -1.12, z] });
    }
    instances(track, m.sleeper, sleepers);
    instances(track, m.dark, clips);
    for (const x of [1.57 - 0.7175, 1.57 + 0.7175]) {
      box(track, m.steel, [0.15, 0.025, length], [x, -1.1375, centerZ]);
      box(track, m.wheel, [0.035, 0.09, length], [x, -1.09, centerZ]);
      box(track, m.steel, [0.073, 0.032, length], [x, -1.04, centerZ]);
    }
    box(track, m.dark, [0.27, 0.14, length + 4], [4.44, -0.82, centerZ]);
    box(track, m.aluminum, [0.31, 0.03, length + 4], [4.44, -0.73, centerZ]);
    for (let z = startZ; z >= endZ; z -= 3) thirdRailBrackets.push({ size: [0.16, 0.32, 0.21], position: [4.44, -1.02, z] });
    instances(track, m.concrete, thirdRailBrackets);
    batchStaticGeometry(track);
  }

  buildTunnel(m) {
    const portalStart = -44;
    const portalEnd = this.route.stops[1].z + 44;
    const ribsMaterial = m.concrete.clone();
    ribsMaterial.color.set('#828c8d');
    const lining = m.wall.clone();
    lining.color.set('#909c9b');
    lining.roughness = 0.94;
    const totalLength = portalStart - portalEnd;
    // Small static batches let Three.js cull tunnel sections behind the camera.
    for (let offset = 0; offset < totalLength; offset += 16) {
      const sectionLength = Math.min(16, totalLength - offset);
      const centerZ = portalStart - offset - sectionLength / 2;
      const section = new THREE.Group();
      section.name = `TunnelSection-${Math.floor(offset / 16)}`;
      section.position.z = centerZ;
      this.add(section);
      box(section, lining, [0.28, 5.55, sectionLength], [-0.42, 1.52, 0]);
      box(section, lining, [0.28, 5.55, sectionLength], [5.18, 1.52, 0]);
      box(section, m.concrete, [5.9, 0.25, sectionLength], [2.38, 4.39, 0]);
      box(section, m.concrete, [0.48, 0.35, sectionLength], [4.9, -0.52, 0]);
      box(section, m.dark, [0.06, 0.08, sectionLength], [4.98, 2.6, 0]);
      box(section, m.dark, [0.06, 0.07, sectionLength], [5.01, 2.8, 0]);
      const fixtures = [];
      for (let localZ = -sectionLength / 2 + 2; localZ < sectionLength / 2; localZ += 4) {
        box(section, ribsMaterial, [0.14, 5.45, 0.19], [-0.24, 1.55, localZ]);
        box(section, ribsMaterial, [0.14, 5.45, 0.19], [5.0, 1.55, localZ]);
        box(section, ribsMaterial, [5.25, 0.14, 0.19], [2.38, 4.17, localZ]);
        box(section, m.dark, [0.24, 0.09, 1.8], [2.38, 4.08, localZ], { shadow: false });
        fixtures.push({ size: [0.18, 0.027, 1.65], position: [2.38, 4.02, localZ] });
      }
      instances(section, m.tubeLight, fixtures, undefined, false);
      // A small emergency wayfinding panel reads naturally through the windows.
      if (offset % 32 === 0) label(section, '← NORDPLATZ   •   CENTRAL →', 2.2, 0.21, [5.024, 1.72, 0], {
        rotation: [0, -Math.PI / 2, 0], background: '#285944', fontSize: 66,
      });
      batchStaticGeometry(section);
    }
  }
}
