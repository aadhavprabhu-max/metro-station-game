import { Station } from './station.js';
import { RouteGeometry } from './route.js';
import { RockStation } from './rock-station.js';
import { IronStation } from './iron-station.js';
import { CentralInterchange } from './interchange.js';

function createU2Materials(materials) {
  const palette = { ...materials };
  for (const [name, color] of Object.entries({
    greenTile: '#b4443d', wallTile: '#d5dce0', wall: '#a7b5bd',
    concrete: '#b7c0c2', tile: '#c2c9ca', trainAccent: '#b4443d',
  })) {
    palette[name] = materials[name].clone();
    palette[name].color.set(color);
  }
  return palette;
}

/** U2 occupies a separate track and platform while sharing Central's graph node. */
export class U2World extends RouteGeometry {
  constructor(materials, route, centralU1) {
    super();
    this.name = 'U2RouteWorld';
    this.route = route;
    this.position.x = -22;
    this.rotation.y = Math.PI;
    const palette = createU2Materials(materials);
    const common = {
      lineId: 'U2', lineName: 'THE INDUSTRIAL LINE', platformNumber: '02',
      signageColor: '#b4443d', platformSignColor: '#b4443d', routeNames: route.stops.map(stop => stop.name),
    };
    this.stations = route.stops.map((stop, index) => {
      const options = {
        ...common, id: stop.id, displayName: stop.name,
        destinationName: route.getTerminus(index === route.stops.length - 1 ? -1 : 1).name,
        northCap: index === 0, southCap: index === route.stops.length - 1,
        ...(stop.id === 'station-2' ? {
          backwallOpening: { z: 24, width: 4, height: 3.05 },
          walkableAreas: [{ minX: -13.2, maxX: -8.6, minZ: 22, maxZ: 26 }],
        } : {}),
      };
      const StationType = stop.id === 'u2-schwarzkopf' ? RockStation : stop.id === 'u2-eisenwerk' ? IronStation : Station;
      const station = new StationType(palette, options);
      station.position.z = -stop.z;
      station.networkNode = stop.node;
      station.isTerminus = stop.isTerminus;
      station.routeDistance = stop.distance;
      this.add(station);
      return station;
    });
    [this.stadtzentrum, this.central, this.schwarzkopf, this.eisenwerk] = this.stations;
    this.station2 = this.central;
    for (let index = 0; index < this.stations.length - 1; index++) {
      const fromStation = this.stations[index], toStation = this.stations[index + 1];
      const fromStop = { ...route.stops[index], z: fromStation.position.z };
      const toStop = { ...route.stops[index + 1], z: toStation.position.z };
      this.buildConnectingTrack(palette, fromStop, toStop, index);
      this.buildTunnel(palette, fromStop, toStop, index, {
        fromPortalOffset: fromStation.portalOffset ?? 44,
        toPortalOffset: toStation.portalOffset ?? 44,
      });
    }
    this.interchange = new CentralInterchange(palette, centralU1, this.central);
    this.add(this.interchange);
    this.interchanges = [this.interchange];
  }
}
