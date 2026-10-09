import * as THREE from 'three';
import { box, instances, label } from './geometry.js';
import { Station } from './station.js';
import { batchStaticGeometry } from './optimize.js';
import { createMetroNetwork } from './network.js';

/** Route distance is measured along the rails, independently of train state. */
export class MetroRoute {
  constructor(network = createMetroNetwork(), lineId = 'U1') {
    this.network = network;
    this.lineId = lineId;
    this.line = network.lines.get(lineId);
    this.stops = network.getLineStops(lineId);
    this.length = this.stops.at(-1).distance;
  }

  getTerminus(direction) {
    return direction > 0 ? this.stops.at(-1) : this.stops[0];
  }

  sample(distance) {
    const alongTrack = THREE.MathUtils.clamp(distance, 0, this.length);
    const nextIndex = this.stops.findIndex((stop, index) => index > 0 && stop.distance >= alongTrack);
    const end = this.stops[nextIndex < 0 ? this.stops.length - 1 : nextIndex];
    const start = this.stops[this.stops.indexOf(end) - 1];
    const origin = start.position ?? start.node.position, destination = end.position ?? end.node.position;
    const fraction = (alongTrack - start.distance) / (end.distance - start.distance);
    const position = new THREE.Vector3(origin.x, origin.y, origin.z).lerp(
      new THREE.Vector3(destination.x, destination.y, destination.z), fraction,
    );
    // Route orientation follows the track, regardless of service direction. The
    // existing straight U1 keeps yaw 0 on every leg, including the return trip.
    const heading = Math.atan2(origin.x - destination.x, origin.z - destination.z);
    return { position, yaw: start.yaw ?? (heading === 0 ? 0 : heading) };
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

function createRosenheimerMaterials(materials) {
  const rosenheimer = { ...materials };
  for (const [name, color] of Object.entries({
    greenTile: '#88745d', wallTile: '#ddd7cd', wall: '#b5aea1',
    concrete: '#bfb7aa', tile: '#c8c0b2',
  })) {
    rosenheimer[name] = materials[name].clone();
    rosenheimer[name].color.set(color);
  }
  return rosenheimer;
}

/** Reusable straight track/tunnel construction for either orientation of a line. */
export class RouteGeometry extends THREE.Group {
  buildConnectingTrack(m, fromStop, toStop, legIndex) {
    // Both original stations already own 100 m of rail. Fill the remaining gap
    // exactly, so no duplicate rail faces or sleeper rows flicker at the joins.
    const startZ = Math.max(fromStop.z, toStop.z) - 50;
    const endZ = Math.min(fromStop.z, toStop.z) + 50;
    const length = startZ - endZ;
    const centerZ = (startZ + endZ) / 2;
    const track = new THREE.Group();
    track.name = legIndex === 0 ? 'ConnectingTrack' : `ConnectingTrack-${legIndex}`;
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

  buildTunnel(m, fromStop, toStop, legIndex, { fromPortalOffset = 44, toPortalOffset = 44 } = {}) {
    const descending = fromStop.z > toStop.z;
    const portalStart = descending ? fromStop.z - fromPortalOffset : toStop.z - toPortalOffset;
    const portalEnd = descending ? toStop.z + toPortalOffset : fromStop.z + fromPortalOffset;
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
      section.name = legIndex === 0 ? `TunnelSection-${Math.floor(offset / 16)}` : `TunnelSection-${legIndex}-${Math.floor(offset / 16)}`;
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
      const leftName = descending ? fromStop.name : toStop.name;
      const rightName = descending ? toStop.name : fromStop.name;
      if (offset % 32 === 0) label(section, `← ${leftName.toUpperCase()}   •   ${rightName.toUpperCase()} →`, 2.2, 0.21, [5.024, 1.72, 0], {
        rotation: [0, -Math.PI / 2, 0], background: '#285944', fontSize: 66,
      });
      batchStaticGeometry(section);
    }
  }
}

/** Existing Nordplatz remains in the scene; this group only adds the new world. */
export class RouteWorld extends RouteGeometry {
  constructor(materials, station1, route = new MetroRoute()) {
    super();
    this.name = 'MetroRouteWorld';
    this.route = route;
    const hasU2 = route.network.lines.has('U2');
    const hasLower = route.network.lines.has('U3');
    this.station2 = new Station(createCentralMaterials(materials), {
      id: route.stops[1].id,
      displayName: route.stops[1].name,
      destinationName: route.stops.at(-1).name,
      routeNames: route.stops.map(stop => stop.name),
      northCap: false,
      southCap: false,
      signageColor: '#365c78',
      ...(hasU2 ? {
        backwallOpening: { z: -24, width: 4, height: 3.05 },
      } : {}),
      walkableAreas: [
        ...(hasU2 ? [{ minX: -13.4, maxX: -8.8, minZ: -26, maxZ: -22 }] : []),
        ...(hasLower ? [{ minX: -8.8, maxX: -2.8, minZ: -45.3, maxZ: -41.5 }] : []),
      ],
      ...(hasLower ? { platformEndOpenings: [{ z: -44, minX: -8.8, maxX: -2.8, height: 3.05 }] } : {}),
    });
    this.station2.position.z = route.stops[1].z;
    this.station3 = new Station(createRosenheimerMaterials(materials), {
      id: route.stops[2].id,
      displayName: route.stops[2].name,
      destinationName: route.stops[0].name,
      routeNames: route.stops.map(stop => stop.name),
      northCap: true,
      southCap: false,
      signageColor: '#735e46',
    });
    this.station3.position.z = route.stops[2].z;
    this.stations = [station1, this.station2, this.station3];
    this.stations.forEach((station, index) => {
      station.networkNode = route.stops[index].node;
      station.isTerminus = route.stops[index].isTerminus;
    });
    this.add(this.station2, this.station3);
    for (let index = 0; index < route.stops.length - 1; index++) {
      this.buildConnectingTrack(materials, route.stops[index], route.stops[index + 1], index);
      this.buildTunnel(materials, route.stops[index], route.stops[index + 1], index);
    }
  }
}
