import * as THREE from 'three';
import { Station } from './station.js';
import { RouteGeometry } from './route.js';
import { LOWER_FLOOR_Y } from './network.js';
import { CentralInterchange } from './interchange.js';
import { SchattenuferStation, OstbahnhofStation, StadtbrueckeStation } from './modern-stations.js';
import { KaiserHumboldtStation, WestbahnhofStation, ArabellaparkStation } from './historic-stations.js';

function createLineMaterials(materials, line) {
  const palette = { ...materials };
  for (const [name, color] of Object.entries({
    greenTile: line.color, trainAccent: line.color,
    wallTile: line.id === 'U3' ? '#d5dfe5' : '#ded8cd',
    wall: line.id === 'U3' ? '#a9b9c2' : '#b8b1a4',
    tile: line.id === 'U3' ? '#bdc9d0' : '#c3bba9',
  })) {
    palette[name] = materials[name].clone();
    palette[name].color.set(color);
  }
  return palette;
}

const STATION_TYPES = {
  'u3-schattenufer': SchattenuferStation,
  'u3-ostbahnhof': OstbahnhofStation,
  'u3-stadtbruecke': StadtbrueckeStation,
  'u4-kaiser-humboldt': KaiserHumboldtStation,
  'u4-westbahnhof': WestbahnhofStation,
  'u4-arabellapark': ArabellaparkStation,
};

/** One railway line beneath the existing platforms, using the same track units. */
export class LowerLineWorld extends RouteGeometry {
  constructor(materials, route) {
    super();
    this.route = route;
    this.lineId = route.lineId;
    this.name = `${route.lineId}LowerRouteWorld`;
    this.floorY = LOWER_FLOOR_Y;
    this.level = 'lower';
    const mirrored = route.lineId === 'U4';
    this.position.set(mirrored ? -22 : 0, LOWER_FLOOR_Y, 0);
    this.rotation.y = mirrored ? Math.PI : 0;
    this.materials = createLineMaterials(materials, route.line);
    this.stations = route.stops.map((stop, index) => {
      const northCap = mirrored ? index === 0 : index === route.stops.length - 1;
      const southCap = mirrored ? index === route.stops.length - 1 : index === 0;
      const central = stop.id === 'station-2';
      const options = {
        id: stop.id, displayName: stop.name, lineId: route.lineId,
        lineName: mirrored ? 'THE HISTORIC LINE' : 'THE MODERN LINE',
        networkName: 'AUREALIS-BAHN', platformNumber: stop.platform,
        floorY: LOWER_FLOOR_Y, level: 'lower',
        destinationName: route.getTerminus(index === route.stops.length - 1 ? -1 : 1).name,
        routeNames: route.stops.map(item => item.name),
        signageColor: route.line.color, platformSignColor: route.line.color,
        northCap, southCap,
        ...(central ? {
          backwallOpening: { z: mirrored ? 24 : -24, width: 4, height: 3.05 },
          walkableAreas: [
            { minX: mirrored ? -13.2 : -13.4, maxX: mirrored ? -8.6 : -8.8, minZ: mirrored ? 22 : -26, maxZ: mirrored ? 26 : -22 },
            ...(mirrored ? [] : [{ minX: -8.8, maxX: -2.8, minZ: -45.3, maxZ: -41.5 }]),
          ],
          ...(mirrored ? {} : { platformEndOpenings: [{ z: -44, minX: -8.8, maxX: -2.8, height: 3.05 }] }),
        } : {}),
      };
      const StationType = STATION_TYPES[stop.id] ?? Station;
      const station = new StationType(this.materials, options);
      station.position.z = mirrored ? -stop.z : stop.z;
      station.networkNode = stop.node;
      station.isTerminus = stop.isTerminus;
      station.routeDistance = stop.distance;
      this.add(station);
      return station;
    });
    this.central = this.stations.find(station => station.stationId === 'station-2');
    for (let index = 0; index < this.stations.length - 1; index++) {
      const fromStation = this.stations[index], toStation = this.stations[index + 1];
      const fromStop = { ...route.stops[index], z: fromStation.position.z };
      const toStop = { ...route.stops[index + 1], z: toStation.position.z };
      this.buildConnectingTrack(this.materials, fromStop, toStop, index);
      this.buildTunnel(this.materials, fromStop, toStop, index, {
        fromPortalOffset: fromStation.portalOffset ?? 44,
        toPortalOffset: toStation.portalOffset ?? 44,
      });
    }
  }
}

/** The two lower railways and their level pedestrian interchange at Central. */
export class LowerWorld extends THREE.Group {
  constructor(materials, routes) {
    super();
    this.name = 'LowerRailwayWorld';
    this.floorY = LOWER_FLOOR_Y;
    this.level = 'lower';
    this.u3World = new LowerLineWorld(materials, routes.U3);
    this.u4World = new LowerLineWorld(materials, routes.U4);
    this.lineWorlds = { U3: this.u3World, U4: this.u4World };
    this.add(this.u3World, this.u4World);
    this.stations = [...this.u3World.stations, ...this.u4World.stations];
    this.centralU3 = this.u3World.central;
    this.centralU4 = this.u4World.central;
    this.interchange = new CentralInterchange(this.u4World.materials, this.centralU3, this.centralU4, {
      floorY: LOWER_FLOOR_Y,
      firstLine: 'U3', secondLine: 'U4',
      firstDestinations: 'SCHATTENUFER / STADTBRÜCKE',
      secondDestinations: 'KAISER-HUMBOLDT-PLATZ / ARABELLAPARK',
      firstColor: routes.U3.line.color, secondColor: routes.U4.line.color,
    });
    this.u4World.add(this.interchange);
    this.u4World.interchange = this.interchange;
    this.u4World.interchanges = [this.interchange];
    this.interchanges = [this.interchange];
  }
}
