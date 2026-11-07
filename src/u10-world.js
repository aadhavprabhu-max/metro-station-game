import * as THREE from 'three';
import { box, instances } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { U10_STATIONS, U10_TRANSFERS } from './u10-network.js';
import { ExpressStation, expressMaterials, beam } from './u10-stations.js';
import { NetworkTransfer } from './network-transfers.js';
import { buildInternationalAirport } from './international-airport.js';

const rectangle = (x, y, w, h) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]];
function railPoint(route, distance, x, y) {
  const pose = route.sampleExtended(distance);
  return new THREE.Vector3(x, y, 0).applyQuaternion(pose.quaternion).add(pose.position);
}
function sweep(parent, material, route, start, end, profile, name) {
  const rows = Math.max(1, Math.ceil((end - start) / 3)), positions = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const distance = THREE.MathUtils.lerp(start, end, row / rows);
    for (const [x, y] of profile) positions.push(...railPoint(route, distance, x, y).toArray());
    if (row < rows) for (let col = 0; col < profile.length; col++) {
      const a = row * profile.length + col, b = row * profile.length + (col + 1) % profile.length;
      indices.push(a, a + profile.length, b, b, a + profile.length, b + profile.length);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material); mesh.name = name; mesh.receiveShadow = true; mesh.castShadow = false; parent.add(mesh); return mesh;
}
function poseEntry(route, d, x, y, size) {
  const pose = route.sampleExtended(d);
  return { position: railPoint(route, d, x, y).toArray(), size,
    rotation: new THREE.Euler().setFromQuaternion(pose.quaternion).toArray().slice(0, 3) };
}

export class ExpressLineWorld extends THREE.Group {
  constructor(base, route) {
    super(); this.name = 'U10AirportExpressWorld'; this.lineId = 'U10'; this.route = route; this.floorY = route.stops[0].floorY; this.level = 'express-lower';
    this.materials = expressMaterials(base); const m = this.materials;
    this.stations = route.stops.map((stop, index) => {
      const definition = U10_STATIONS[index];
      const exitEnd = stop.id === 'station-2' ? -44 : 44;
      const options = { id: stop.id, displayName: stop.name, lineId: 'U10', lineName: 'Airport Express', platformNumber: '10', floorY: stop.floorY,
        level: stop.level, signageColor: '#123b75', platformSignColor: '#123b75', definition,
        destinationName: index === route.stops.length - 1 ? 'Central' : route.stops.at(-1).name,
        routeNames: route.stops.map(s => s.name), northCap: false, southCap: false,
        walkableAreas: [{ minX: -8.8, maxX: -2.8, minZ: exitEnd < 0 ? -45.6 : 41.5, maxZ: exitEnd < 0 ? -41.5 : 45.6 }],
        platformEndOpenings: [{ z: exitEnd, minX: -8.8, maxX: -2.8, height: 3.1 }] };
      const station = new ExpressStation(m, options);
      station.rotation.y = stop.yaw;
      station.position.set(stop.position.x, stop.position.y, stop.position.z).sub(new THREE.Vector3(1.57, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), stop.yaw));
      station.networkNode = stop.node; station.routeDistance = stop.distance; station.isTerminus = stop.isTerminus;
      station.updateWorldMatrix(true, true); this.add(station);
      if (definition.design === 'airport') { this.airport = buildInternationalAirport(station, m); }
      return station;
    });
    this.central = this.stations[0]; this.buildRailway();
    this.entrances = this.stations.filter(s => !U10_TRANSFERS.some(t => t.id === s.stationId)).map(station => this.buildEntrance(station));
    // Additional exits at the interchanges use their existing network circulation.
    this.userData.phase7 = true;
  }
  buildEntrance(station) {
    const ground = new THREE.Group(); ground.name = `${station.displayName}StreetEntrance`;
    ground.position.copy(station.position); ground.position.y = 10; ground.rotation.copy(station.rotation);
    Object.assign(ground, { stationId: station.stationId, displayName: station.displayName, lineId: 'U10', platformId: `${station.platformId}:street`, platformNumber: 'STREET', options: { signageColor: '#123b75' } });
    ground.updateWorldMatrix(true, true);
    const elevated = station.floorY > 10;
    const transfer = new NetworkTransfer(this.materials, elevated ? station : ground, elevated ? ground : station, { upperEnd: 44, lowerEnd: 44, accessible: true });
    transfer.name = `${station.displayName}EntranceStairs`; transfer.isStreetEntrance = true;
    const tower = transfer.towers[0].group;
    const plaza = { minX: -8, maxX: 8, minZ: -8, maxZ: 14.5 };
    transfer.addSurface(tower, 'street-forecourt', plaza, () => 10, { floorY: 10, edges: { maxZ: false } });
    transfer.floor(tower, this.materials, plaza, 10);
    this.add(transfer); return transfer;
  }
  buildRailway() {
    const m = this.materials, route = this.route;
    const farDecks = [], piers = [], foundations = [], crossbeams = [];
    let ordinal = 0;
    for (let start = -75; start < route.length + 75; start += 48) {
      const end = Math.min(route.length + 75, start + 48), center = (start + end) / 2;
      const section = new THREE.Group(); section.name = `U10RailwaySection-${ordinal++}`;
      section.userData.routeInterval = { start, end, lineId: 'U10', kind: 'express' }; this.add(section);
      // Cut physical rails at station rail boundaries to avoid coincident faces.
      const cuts = [start, end, ...route.stops.flatMap(s => [s.distance - 50, s.distance + 50]).filter(d => d > start && d < end)].sort((a, b) => a - b);
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k], b = cuts[k + 1], mid = (a + b) / 2;
        if (route.stops.some(s => Math.abs(s.distance - mid) < 50)) continue;
        sweep(section, m.trackBed, route, a, b, rectangle(0.9, -1.37, 4.98, 0.14), 'U10TrackBed');
        for (const x of [-0.7175, 0.7175]) {
          sweep(section, m.steel, route, a, b, rectangle(x, -1.1375, 0.15, 0.025), 'U10RailFoot');
          sweep(section, m.wheel, route, a, b, rectangle(x, -1.09, 0.035, 0.09), 'U10RailWeb');
          sweep(section, m.steel, route, a, b, rectangle(x, -1.04, 0.073, 0.032), 'U10RailHead');
        }
        sweep(section, m.dark, route, a, b, rectangle(2.87, -0.82, 0.27, 0.14), 'U10ProtectedThirdRail');
        const sleepers = [];
        for (let d = Math.ceil(a / 0.65) * 0.65; d < b; d += 0.65) sleepers.push(poseEntry(route, d, 0, -1.22, [2.52, 0.14, 0.21]));
        if (sleepers.length) instances(section, m.sleeper, sleepers).name = 'U10PhysicalSleepers';
      }
      const pose = route.sampleExtended(center), y = pose.position.y;
      const stationHere = route.stops.some(s => Math.abs(s.distance - center) < (s.id === 'u10-botanical' ? 65 : 47));
      if (y < 5.4) {
        const portals = [start, end, ...route.stops.flatMap(s => [s.distance - 44, s.distance + 44]).filter(d => d > start && d < end)].sort((a, b) => a - b);
        for (let i = 0; i < portals.length - 1; i++) {
          const a = portals[i], b = portals[i + 1];
          if (route.stops.some(s => Math.abs(s.distance - (a + b) / 2) < 44)) continue;
          sweep(section, m.concrete, route, a, b, rectangle(-2.3, 1.6, 0.32, 6), 'ExpressTunnelWall');
          sweep(section, m.concrete, route, a, b, rectangle(3.6, 1.6, 0.32, 6), 'ExpressTunnelWall');
          sweep(section, m.concrete, route, a, b, rectangle(0.65, 4.65, 6.2, 0.3), 'ExpressTunnelCrown');
          sweep(section, m.tubeLight, route, a, b, rectangle(0.7, 4.42, 0.1, 0.04), 'ExpressTunnelLighting');
        }
      } else if (y >= 5.4 && y < 13) {
        // Retained cutting: walls rise to street grade while the sky opens gradually.
        for (const x of [-3, 4.5]) sweep(section, m.concrete, route, start, end, rectangle(x, (10 - y) / 2, 0.4, Math.max(1, 11 - y)), 'TransitionRetainingWall');
      }
      if (y > 12) {
        const station = route.stops.find(s => Math.abs(s.distance - center) < 48);
        sweep(section, m.concrete, route, start, end, rectangle(station ? -2.5 : 0.5, -1.75, station ? 20 : 8.3, 0.6), 'SupportedViaductDeck');
        for (const x of [-2.9, 3.9]) {
          for (let i = 0; i < cuts.length - 1; i++) {
            const a = cuts[i], b = cuts[i + 1];
            if (!route.stops.some(s => Math.abs(s.distance - (a + b) / 2) < 50)) sweep(section, m.whiteSteel, route, a, b, rectangle(x, -0.85, 0.13, 1.1), 'ViaductSafetyBarrier');
          }
          sweep(section, m.concrete, route, start, end, rectangle(x, -2.25, 0.6, 0.5), 'ViaductLongitudinalBeam');
        }
        for (let d = Math.ceil(start / 32) * 32; d < end; d += 32) {
          const p = route.sampleExtended(d), height = p.position.y - 12.1;
          piers.push({ size: [2.4, height, 2.2], position: [p.position.x, 10 + height / 2, p.position.z] });
          foundations.push({ size: [5.3, 0.8, 4.1], position: [p.position.x, 10.25, p.position.z] });
          const cap = new THREE.Vector3(0.5, -2.35, 0).applyQuaternion(p.quaternion).add(p.position);
          crossbeams.push({ size: [7.8, 0.8, 1.8], position: cap.toArray(), rotation: new THREE.Euler().setFromQuaternion(p.quaternion).toArray().slice(0, 3) });
        }
      }
      batchStaticGeometry(section);
    }
    const far = new THREE.Group(); far.name = 'ContinuousDistantViaduct'; this.add(far);
    for (let d = 0; d < route.length; d += 24) {
      const p = route.sample(d + 12); if (p.position.y <= 14) continue;
      farDecks.push(poseEntry(route, d + 12, 0.5, -2.3, [8.3, 0.4, 24.1]));
    }
    for (const [entries, name] of [[farDecks, 'DistantStructuralDeck'], [piers, 'ActualViaductPiers'], [foundations, 'ViaductFoundations'], [crossbeams, 'ViaductPierCaps']]) {
      if (entries.length) instances(far, m.concrete, entries, undefined, false).name = name;
    }
    for (const d of [-68, route.length + 68]) {
      const p = route.sampleExtended(d), buffer = new THREE.Group(); buffer.position.copy(p.position); buffer.quaternion.copy(p.quaternion); buffer.name = 'U10TerminalBuffer';
      for (const x of [-0.8, 0.8]) beam(buffer, m.whiteSteel, [x, -1.1, 0], [x, 0, 0.7], 0.18);
      box(buffer, m.dark, [2.2, 0.3, 0.4], [0, 0.1, 0]); this.add(buffer);
    }
  }
}
