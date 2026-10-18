import * as THREE from 'three';
import { Station } from './station.js';
import { FamilyStation } from './station-families.js';
import { RouteGeometry } from './route.js';
import { GlassCathedralStation } from './glass-cathedral-station.js';
import { GoldenHiveStation } from './golden-hive-station.js';
import { RockStation } from './rock-station.js';
import { IronStation } from './iron-station.js';
import { SchattenuferStation, OstbahnhofStation, StadtbrueckeStation } from './modern-stations.js';
import { KaiserHumboldtStation, WestbahnhofStation, ArabellaparkStation } from './historic-stations.js';
import { box, instances } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

const PRESERVED_TYPES = {
  'station-1': Station, 'station-3': Station,
  'u2-stadtzentrum': GlassCathedralStation, 'u2-schwarzkopf': RockStation,
  'u2-eisenwerk': IronStation, 'u3-schattenufer': SchattenuferStation,
  'u3-ostbahnhof': OstbahnhofStation, 'u3-stadtbruecke': StadtbrueckeStation,
  'u4-kaiser-humboldt': KaiserHumboldtStation, 'u4-westbahnhof': WestbahnhofStation,
  'u4-arabellapark': ArabellaparkStation,
};

export const NEW_TRANSFERS = [
  { id: 'u4-westbahnhof', upperLine: 'U4', lowerLine: 'U5', upperEnd: -44, lowerEnd: 44 },
  { id: 'u3-ostbahnhof', upperLine: 'U3', lowerLine: 'U5', upperEnd: 44, lowerEnd: 44 },
  { id: 'u2-stadtzentrum', upperLine: 'U2', lowerLine: 'U6', upperEnd: 44, lowerEnd: 44 },
  { id: 'u4-arabellapark', upperLine: 'U4', lowerLine: 'U6', upperEnd: -44, lowerEnd: -44 },
];

function paletteFor(base, route, stop) {
  const colors = route.lineId === 'U1' ? {} : {
    greenTile: route.line.color, trainAccent: route.line.color,
    wallTile: route.lineId === 'U4' ? '#ded8cd' : route.lineId === 'U3' ? '#d5dfe5' : '#d5dce0',
    wall: route.lineId === 'U4' ? '#b8b1a4' : route.lineId === 'U3' ? '#a9b9c2' : '#a7b5bd',
    tile: route.lineId === 'U4' ? '#c3bba9' : route.lineId === 'U3' ? '#bdc9d0' : '#c2c9ca',
  };
  if (route.lineId === 'U2') colors.concrete = '#b7c0c2';
  if (stop.id === 'station-2' && route.lineId === 'U1') Object.assign(colors, {
    greenTile: '#436a85', wallTile: '#d5dde0', wall: '#a6b4bd', concrete: '#b9c2c4', tile: '#c1c9ca',
  });
  if (stop.id === 'station-3') Object.assign(colors, {
    greenTile: '#88745d', wallTile: '#ddd7cd', wall: '#b5aea1', concrete: '#bfb7aa', tile: '#c8c0b2',
  });
  const result = { ...base };
  for (const [key, color] of Object.entries(colors)) { result[key] = base[key].clone(); result[key].color.set(color); }
  return result;
}

function stationOptions(stop, route, index) {
  const mirrored = (stop.platformSide ?? (['U2', 'U4'].includes(route.lineId) ? 1 : -1)) === 1;
  const terminal = index === 0 || index === route.stops.length - 1;
  const options = {
    id: stop.id, displayName: stop.name, lineId: route.lineId, lineName: route.line.name,
    networkName: 'AUREALIS-BAHN', platformNumber: stop.platform, floorY: stop.floorY, level: stop.level,
    signageColor: route.line.color, platformSignColor: route.line.color,
    destinationName: route.getTerminus(index === route.stops.length - 1 ? -1 : 1).name,
    routeNames: route.stops.map(item => item.name),
    northCap: terminal && (mirrored ? index === 0 : index === route.stops.length - 1),
    southCap: terminal && (mirrored ? index === route.stops.length - 1 : index === 0),
    walkableAreas: [], platformEndOpenings: [],
  };
  const openEnd = z => {
    options.platformEndOpenings.push({ z, minX: -8.8, maxX: -2.8, height: 3.05 });
    options.walkableAreas.push({ minX: -8.8, maxX: -2.8,
      minZ: z < 0 ? -45.6 : 41.5, maxZ: z < 0 ? -41.5 : 45.6 });
  };
  if (stop.id === 'station-2') {
    const sign = mirrored ? 1 : -1;
    options.backwallOpening = { z: sign * 24, width: 4, height: 3.05 };
    options.walkableAreas.push({ minX: mirrored ? -13.2 : -13.4, maxX: mirrored ? -8.6 : -8.8,
      minZ: sign * 24 - 2, maxZ: sign * 24 + 2 });
    if (route.lineId === 'U1' || route.lineId === 'U3') openEnd(-44);
  }
  for (const transfer of NEW_TRANSFERS) if (stop.id === transfer.id && route.network.lines.has(transfer.lowerLine)) {
    if (route.lineId === transfer.upperLine) openEnd(transfer.upperEnd);
    if (route.lineId === transfer.lowerLine) openEnd(transfer.lowerEnd);
  }
  if (stop.id === 'station-1') { options.signageColor = '#396057'; options.platformSignColor = '#496a60'; }
  if (stop.id === 'station-2' && route.lineId === 'U1') options.signageColor = '#365c78';
  if (stop.id === 'station-3') options.signageColor = '#735e46';
  return options;
}

/** Same platform/track primitives and bespoke stations; all placement comes from the network. */
export class NetworkLineWorld extends RouteGeometry {
  constructor(materials, route) {
    super();
    this.name = `${route.lineId}RouteWorld`;
    this.lineId = route.lineId; this.route = route;
    this.floorY = route.stops[0].floorY;
    this.level = route.stops[0].level;
    this.materials = paletteFor(materials, route, route.stops[0]);
    // Keep the original mirrored coordinate frames for U2/U4 and Central's passages.
    const legacy = ['U1', 'U2', 'U3', 'U4'].includes(route.lineId);
    const mirrored = route.lineId === 'U2' || route.lineId === 'U4';
    if (legacy) { this.position.set(mirrored ? -22 : 0, this.floorY, 0); this.rotation.y = mirrored ? Math.PI : 0; }
    this.stations = route.stops.map((stop, index) => {
      const options = stationOptions(stop, route, index);
      const StationType = stop.id === 'station-2'
        ? (stop.floorY < 0 ? GoldenHiveStation : Station)
        : PRESERVED_TYPES[stop.id] ?? FamilyStation;
      const station = new StationType(paletteFor(materials, route, stop), options);
      if (legacy) station.position.z = mirrored ? -stop.position.z : stop.position.z;
      else {
        const yaw = stop.yaw + (stop.platformSide === 1 ? Math.PI : 0);
        station.rotation.y = yaw;
        station.position.copy(new THREE.Vector3(stop.position.x, stop.position.y, stop.position.z))
          .sub(new THREE.Vector3(1.57, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      }
      station.networkNode = stop.node; station.isTerminus = stop.isTerminus; station.routeDistance = stop.distance;
      this.add(station); return station;
    });
    this.central = this.stations.find(item => item.stationId === 'station-2');
    this.station2 = this.central;
    this.station3 = this.stations.find(item => item.stationId === 'station-3');
    for (const [key, id] of Object.entries({ stadtzentrum: 'u2-stadtzentrum', schwarzkopf: 'u2-schwarzkopf', eisenwerk: 'u2-eisenwerk' })) {
      this[key] = this.stations.find(item => item.stationId === id);
    }
    if (legacy) for (let index = 0; index < this.stations.length - 1; index++) {
      const from = this.stations[index], to = this.stations[index + 1];
      const a = { ...route.stops[index], z: from.position.z }, b = { ...route.stops[index + 1], z: to.position.z };
      this.buildConnectingTrack(this.materials, a, b, index);
      this.buildTunnel(this.materials, a, b, index, { fromPortalOffset: from.portalOffset ?? 44, toPortalOffset: to.portalOffset ?? 44 });
    }
    else buildSampledRailway(this, materials, route);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
function pointAt(route, distance, x, y) {
  const pose = route.sampleExtended(distance);
  return pose.position.add(new THREE.Vector3(x, y, 0).applyAxisAngle(UP, pose.yaw));
}

/** Sweep actual cross-sections along the same arc-length path used by the trains. */
function sweep(parent, material, route, start, end, profile, name, step = 1.5) {
  const divisions = Math.max(1, Math.ceil((end - start) / step));
  const positions = [], indices = [];
  for (let row = 0; row <= divisions; row++) {
    const distance = THREE.MathUtils.lerp(start, end, row / divisions);
    for (const [x, y] of profile) positions.push(...pointAt(route, distance, x, y).toArray());
    if (row < divisions) for (let column = 0; column < profile.length; column++) {
      const a = row * profile.length + column, b = row * profile.length + (column + 1) % profile.length;
      const c = a + profile.length, d = b + profile.length;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
const rectangle = (x, y, w, h) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]];

export function buildSampledRailway(root, m, route) {
  const intervals = [];
  let previous = -75;
  for (const stop of route.stops) {
    if (stop.distance - 50 > previous) intervals.push([previous, stop.distance - 50, 'track']);
    previous = stop.distance + 50;
  }
  intervals.push([previous, route.length + 75, 'track']);
  let portal = -75;
  for (const stop of route.stops) {
    intervals.push([portal, stop.distance - 44, 'tunnel']); portal = stop.distance + 44;
  }
  intervals.push([portal, route.length + 75, 'tunnel']);
  let ordinal = 0;
  for (const [from, to, kind] of intervals) for (let start = from; start < to - 0.001; start += 24) {
    const end = Math.min(to, start + 24), section = new THREE.Group();
    section.name = `${route.lineId}-${kind}-${ordinal++}`;
    section.userData.routeInterval = { start, end, lineId: route.lineId, kind };
    root.add(section);
    if (kind === 'track') {
      sweep(section, m.trackBed, route, start, end, rectangle(0.93, -1.37, 4.98, 0.14), 'ContinuousTrackBed');
      for (const x of [-0.7175, 0.7175]) {
        sweep(section, m.steel, route, start, end, rectangle(x, -1.1375, 0.15, 0.025), 'RailFoot');
        sweep(section, m.wheel, route, start, end, rectangle(x, -1.09, 0.035, 0.09), 'RailWeb');
        sweep(section, m.steel, route, start, end, rectangle(x, -1.04, 0.073, 0.032), 'RailHead');
      }
      sweep(section, m.dark, route, start, end, rectangle(2.87, -0.82, 0.27, 0.14), 'ProtectedThirdRail');
      const sleepers = [], clips = [];
      for (let d = Math.ceil(start / 0.65) * 0.65; d < end; d += 0.65) {
        const pose = route.sampleExtended(d);
        sleepers.push({ size: [2.52, 0.14, 0.21], position: pointAt(route, d, 0, -1.22).toArray(), rotation: [0, pose.yaw, 0] });
        for (const x of [-0.7175, 0.7175]) clips.push({ size: [0.2, 0.06, 0.12], position: pointAt(route, d, x, -1.12).toArray(), rotation: [0, pose.yaw, 0] });
      }
      if (sleepers.length) instances(section, m.sleeper, sleepers);
      if (clips.length) instances(section, m.dark, clips);
    } else {
      sweep(section, m.concrete, route, start, end, rectangle(-1.99, 1.52, 0.28, 5.65), 'TunnelLeftWall');
      sweep(section, m.concrete, route, start, end, rectangle(3.61, 1.52, 0.28, 5.65), 'TunnelRightWall');
      sweep(section, m.concrete, route, start, end, rectangle(0.81, 4.39, 5.9, 0.25), 'TunnelCrown');
      const ribs = [], lights = [];
      for (let d = Math.ceil(start / 4) * 4; d < end; d += 4) {
        const pose = route.sampleExtended(d);
        for (const x of [-1.81, 3.43]) ribs.push({ size: [0.14, 5.45, 0.19], position: pointAt(route, d, x, 1.55).toArray(), rotation: [0, pose.yaw, 0] });
        ribs.push({ size: [5.25, 0.14, 0.19], position: pointAt(route, d, 0.81, 4.17).toArray(), rotation: [0, pose.yaw, 0] });
        lights.push({ size: [0.18, 0.027, 1.65], position: pointAt(route, d, 0.81, 4.02).toArray(), rotation: [0, pose.yaw, 0] });
      }
      if (ribs.length) instances(section, m.beam, ribs);
      if (lights.length) instances(section, m.tubeLight, lights, undefined, false);
    }
    batchStaticGeometry(section);
  }
  for (const d of [-75, route.length + 75]) {
    const pose = route.sampleExtended(d), cap = new THREE.Group(); cap.name = `${route.lineId}TerminalSafetyWall`;
    cap.position.copy(pose.position); cap.rotation.y = pose.yaw;
    box(cap, m.concrete, [5.9, 5.65, 0.25], [0.81, 1.52, 0]);
    root.add(cap);
  }
}
