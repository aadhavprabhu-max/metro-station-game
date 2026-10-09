/** Shared station nodes and track links are independent of any one train service. */
export class MetroNetwork {
  constructor() {
    this.nodes = new Map();
    this.links = new Map();
    this.lines = new Map();
  }

  addNode({ id, name, position, platform = '01', interchangeCapable = false, plannedLines = [] }) {
    if (this.nodes.has(id)) throw new Error(`Station node already exists: ${id}`);
    const node = { id, name, position: { ...position }, platform, interchangeCapable, plannedLines: [...plannedLines], lineIds: [], platforms: {} };
    this.nodes.set(id, node);
    return node;
  }

  /** Different lines can have separate physical platforms in one shared station. */
  addPlatform(nodeId, { lineId, number = '01', position, yaw = 0, floorY = null, level = null, platformSide = null }) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown station for platform: ${nodeId}`);
    if (node.platforms[lineId]) throw new Error(`Platform already exists: ${nodeId}:${lineId}`);
    const platformPosition = { ...(position ?? node.position) };
    const elevation = floorY ?? platformPosition.y;
    const platform = {
      id: `${nodeId}:${lineId}`, lineId, number, position: platformPosition, yaw,
      floorY: elevation, level: level ?? (elevation < 0 ? 'lower' : 'upper'),
      ...(platformSide === null ? {} : { platformSide }),
    };
    node.platforms[lineId] = platform;
    return platform;
  }

  addLink({ id, from, to, length }) {
    if (this.links.has(id)) throw new Error(`Track link already exists: ${id}`);
    const origin = this.nodes.get(from), destination = this.nodes.get(to);
    if (!origin || !destination) throw new Error(`Track link ${id} references an unknown station.`);
    const distance = length ?? Math.hypot(
      destination.position.x - origin.position.x,
      destination.position.y - origin.position.y,
      destination.position.z - origin.position.z,
    );
    if (!(distance > 0)) throw new Error(`Track link ${id} must have a positive length.`);
    const link = { id, from, to, length: distance };
    this.links.set(id, link);
    return link;
  }

  addLine({ id, name = id, color, nodeIds, linkIds }) {
    if (this.lines.has(id)) throw new Error(`Metro line already exists: ${id}`);
    if (nodeIds.length < 2 || linkIds.length !== nodeIds.length - 1) throw new Error(`Line ${id} requires a link between every pair of stops.`);
    nodeIds.forEach(nodeId => {
      if (!this.nodes.has(nodeId)) throw new Error(`Line ${id} references an unknown station: ${nodeId}`);
    });
    linkIds.forEach((linkId, index) => {
      const link = this.links.get(linkId);
      const from = nodeIds[index], to = nodeIds[index + 1];
      if (!link || !((link.from === from && link.to === to) || (link.from === to && link.to === from))) {
        throw new Error(`Line ${id} has an invalid link at stop ${index}.`);
      }
    });
    const line = { id, name, color, nodeIds: [...nodeIds], linkIds: [...linkIds] };
    this.lines.set(id, line);
    nodeIds.forEach(nodeId => {
      const node = this.nodes.get(nodeId);
      node.lineIds.push(id);
      node.plannedLines = node.plannedLines.filter(lineId => lineId !== id);
    });
    return line;
  }

  getLineStops(lineId) {
    const line = this.lines.get(lineId);
    if (!line) throw new Error(`Unknown metro line: ${lineId}`);
    let distance = 0;
    return line.nodeIds.map((nodeId, index) => {
      if (index > 0) distance += this.links.get(line.linkIds[index - 1]).length;
      const node = this.nodes.get(nodeId);
      const platform = node.platforms[lineId];
      const position = platform?.position ?? node.position;
      return {
        id: node.id, name: node.name, platform: platform?.number ?? node.platform, distance,
        platformId: platform?.id ?? `${node.id}:${lineId}`,
        position, yaw: platform?.yaw,
        floorY: platform?.floorY ?? position.y,
        level: platform?.level ?? (position.y < 0 ? 'lower' : 'upper'),
        ...(platform?.platformSide === undefined ? {} : { platformSide: platform.platformSide }),
        z: position.z, node,
        isTerminus: index === 0 || index === line.nodeIds.length - 1,
        get interchange() { return node.lineIds.length > 1; },
        interchangeCapable: node.interchangeCapable,
        get servedLines() { return [...node.lineIds]; },
        get plannedLines() { return [...node.plannedLines]; },
      };
    });
  }
}

/** The original network remains available independently of the optional U2 world. */
export function createMetroNetwork() {
  const network = new MetroNetwork();
  network.addNode({ id: 'station-1', name: 'Nordplatz', position: { x: 1.57, y: 0, z: 0 } });
  network.addNode({ id: 'station-2', name: 'Central', position: { x: 1.57, y: 0, z: -240 }, interchangeCapable: true, plannedLines: ['U2'] });
  network.addNode({ id: 'station-3', name: 'Rosenheimer Platz', position: { x: 1.57, y: 0, z: -480 } });
  network.addLink({ id: 'u1-nordplatz-central', from: 'station-1', to: 'station-2' });
  network.addLink({ id: 'u1-central-rosenheimer', from: 'station-2', to: 'station-3' });
  for (const nodeId of ['station-1', 'station-2', 'station-3']) network.addPlatform(nodeId, { lineId: 'U1' });
  network.addLine({
    id: 'U1', name: 'U1', color: '#c8784d',
    nodeIds: ['station-1', 'station-2', 'station-3'],
    linkIds: ['u1-nordplatz-central', 'u1-central-rosenheimer'],
  });
  return network;
}

/** Extend the graph through Central's existing node, preserving every U1 pose. */
export function addU2ToNetwork(network) {
  if (network.lines.has('U2')) return network.lines.get('U2');
  const u2Stations = [
    { id: 'u2-stadtzentrum', name: 'Stadtzentrum', z: 0 },
    { id: 'station-2', name: 'Central', z: -240 },
    { id: 'u2-schwarzkopf', name: 'Schwarzkopf-Tunnel', z: -480 },
    { id: 'u2-eisenwerk', name: 'Eisenwerk', z: -720 },
  ];
  for (const station of u2Stations) {
    if (!network.nodes.has(station.id)) network.addNode({
      id: station.id, name: station.name, platform: '02',
      position: { x: -23.57, y: 0, z: station.z },
    });
    network.addPlatform(station.id, { lineId: 'U2', number: '02', position: { x: -23.57, y: 0, z: station.z } });
  }
  const linkIds = ['u2-stadtzentrum-central', 'u2-central-schwarzkopf', 'u2-schwarzkopf-eisenwerk'];
  for (let index = 0; index < linkIds.length; index++) network.addLink({
    id: linkIds[index], from: u2Stations[index].id, to: u2Stations[index + 1].id, length: 240,
  });
  return network.addLine({
    id: 'U2', name: 'The Industrial Line', color: '#b4443d',
    nodeIds: u2Stations.map(station => station.id), linkIds,
  });
}

export const LOWER_FLOOR_Y = -12;

/** Add both lower railway lines through the original shared Central node. */
export function addLowerLinesToNetwork(network) {
  const definitions = [
    {
      id: 'U3', name: 'The Modern Line', color: '#3e71b6', x: 1.57, platform: '03', side: -1,
      stops: [
        { id: 'u3-schattenufer', name: 'Schattenufer', z: 150 },
        { id: 'station-2', name: 'Central', z: -240 },
        { id: 'u3-ostbahnhof', name: 'Ostbahnhof', z: -480 },
        { id: 'u3-stadtbruecke', name: 'Stadtbrücke', z: -720 },
      ],
      links: ['u3-schattenufer-central', 'u3-central-ostbahnhof', 'u3-ostbahnhof-stadtbruecke'],
    },
    {
      id: 'U4', name: 'The Historic Line', color: '#8d58ac', x: -23.57, platform: '04', side: 1,
      stops: [
        { id: 'u4-kaiser-humboldt', name: 'Kaiser-Humboldt-Platz', z: 240 },
        { id: 'u4-westbahnhof', name: 'Westbahnhof', z: 0 },
        { id: 'station-2', name: 'Central', z: -240 },
        { id: 'u4-arabellapark', name: 'Arabellapark', z: -480 },
      ],
      links: ['u4-kaiser-humboldt-westbahnhof', 'u4-westbahnhof-central', 'u4-central-arabellapark'],
    },
  ];
  for (const definition of definitions) {
    if (network.lines.has(definition.id)) continue;
    for (const stop of definition.stops) {
      const position = { x: definition.x, y: LOWER_FLOOR_Y, z: stop.z };
      if (!network.nodes.has(stop.id)) network.addNode({ id: stop.id, name: stop.name, platform: definition.platform, position });
      network.addPlatform(stop.id, {
        lineId: definition.id, number: definition.platform, position,
        floorY: LOWER_FLOOR_Y, level: 'lower', platformSide: definition.side,
      });
    }
    definition.links.forEach((id, index) => network.addLink({
      id, from: definition.stops[index].id, to: definition.stops[index + 1].id,
      length: Math.abs(definition.stops[index + 1].z - definition.stops[index].z),
    }));
    network.addLine({
      id: definition.id, name: definition.name, color: definition.color,
      nodeIds: definition.stops.map(stop => stop.id), linkIds: definition.links,
    });
  }
  return { U3: network.lines.get('U3'), U4: network.lines.get('U4') };
}
