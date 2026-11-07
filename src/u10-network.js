import { createExpressPath } from './u10-path.js';

export const U10_COLOR = '#123B75';
export const U10_STATIONS = Object.freeze([
  { id: 'station-2', name: 'Central', x: 1.57, y: -48, z: -240, yaw: -Math.PI / 2, outdoor: false, design: 'central' },
  { id: 'u10-finanzforum', name: 'Finanzforum', x: 480, y: -48, z: -240, yaw: -Math.PI / 2, outdoor: false, design: 'finance' },
  { id: 'u6-ringplatz', name: 'Ringplatz', x: 1056.43, y: -48, z: -720, yaw: 0, outdoor: false, design: 'ring' },
  { id: 'u10-eastend', name: 'Eastend', x: 1056.43, y: -48, z: -1700, yaw: 0, outdoor: false, design: 'eastend' },
  { id: 'u10-skyline', name: 'Skylinequartier', x: 1056.43, y: 26, z: -4000, yaw: 0, outdoor: true, design: 'skyline' },
  { id: 'u10-metropol', name: 'Metropolbrücke', x: 2200, y: 26, z: -4900, yaw: -Math.PI / 2, outdoor: true, design: 'bridge' },
  { id: 'u10-botanical', name: 'East Botanical Garden', x: 3200, y: 26, z: -4900, yaw: -Math.PI / 2, outdoor: false, design: 'botanical' },
  { id: 'u10-europa', name: 'Europaplatz', x: 4100, y: 26, z: -4900, yaw: -Math.PI / 2, outdoor: true, design: 'europa' },
  { id: 'u10-airportpark', name: 'Flughafenpark', x: 5300, y: 26, z: -4900, yaw: -Math.PI / 2, outdoor: true, design: 'airportpark' },
  { id: 'u10-airport', name: 'Aurealis International Airport', x: 6600, y: 26, z: -4900, yaw: -Math.PI / 2, outdoor: false, design: 'airport' },
]);

export const U10_TRANSFERS = Object.freeze([
  { id: 'station-2', upperLine: 'U3', lowerLine: 'U10', upperEnd: 44, lowerEnd: -44, accessible: true },
  { id: 'u6-ringplatz', upperLine: 'U6', lowerLine: 'U10', upperEnd: 44, lowerEnd: 44, accessible: true },
]);

/** Append only U10. Existing node objects, railway links and platform poses are retained. */
export function addU10ToNetwork(network) {
  if (network.lines.has('U10')) return network;
  for (const stop of U10_STATIONS) {
    const position = { x: stop.x, y: stop.y, z: stop.z };
    const node = network.nodes.get(stop.id) ?? network.addNode({ id: stop.id, name: stop.name, position, platform: '10' });
    network.addPlatform(stop.id, { lineId: 'U10', number: '10', position, yaw: stop.yaw,
      floorY: stop.y, level: stop.y < 0 ? 'express-lower' : 'elevated', platformSide: -1 });
    node.platforms.U10.outdoor = stop.outdoor;
    node.platforms.U10.design = stop.design;
  }
  const linkIds = [];
  for (let i = 0; i < U10_STATIONS.length - 1; i++) {
    const from = U10_STATIONS[i], to = U10_STATIONS[i + 1];
    const id = `u10-link-${i + 1}`;
    const path = createExpressPath({ ...from, position: { x: from.x, y: from.y, z: from.z } },
      { ...to, position: { x: to.x, y: to.y, z: to.z } });
    network.addLink({ id, from: from.id, to: to.id, path, permittedLineIds: ['U10'] }); linkIds.push(id);
  }
  network.addLine({ id: 'U10', name: 'Airport Express', color: U10_COLOR,
    nodeIds: U10_STATIONS.map(s => s.id), linkIds });
  for (const definition of U10_TRANSFERS) network.nodes.get(definition.id).interchangeCapable = true;
  return network;
}
