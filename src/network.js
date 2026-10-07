/** Shared station nodes and track links are independent of any one train service. */
export class MetroNetwork {
  constructor() {
    this.nodes = new Map();
    this.links = new Map();
    this.lines = new Map();
  }

  addNode({ id, name, position, platform = '01', interchangeCapable = false, plannedLines = [] }) {
    if (this.nodes.has(id)) throw new Error(`Station node already exists: ${id}`);
    const node = { id, name, position: { ...position }, platform, interchangeCapable, plannedLines: [...plannedLines], lineIds: [] };
    this.nodes.set(id, node);
    return node;
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
      return {
        id: node.id, name: node.name, platform: node.platform, distance,
        z: node.position.z, node,
        isTerminus: index === 0 || index === line.nodeIds.length - 1,
        get interchange() { return node.lineIds.length > 1; },
        interchangeCapable: node.interchangeCapable,
        get servedLines() { return [...node.lineIds]; },
        get plannedLines() { return [...node.plannedLines]; },
      };
    });
  }
}

/** Future lines can reuse station-2's node; only U1 has track or service today. */
export function createMetroNetwork() {
  const network = new MetroNetwork();
  network.addNode({ id: 'station-1', name: 'Nordplatz', position: { x: 1.57, y: 0, z: 0 } });
  network.addNode({ id: 'station-2', name: 'Central', position: { x: 1.57, y: 0, z: -240 }, interchangeCapable: true, plannedLines: ['U2'] });
  network.addNode({ id: 'station-3', name: 'Rosenheimer Platz', position: { x: 1.57, y: 0, z: -480 } });
  network.addLink({ id: 'u1-nordplatz-central', from: 'station-1', to: 'station-2' });
  network.addLink({ id: 'u1-central-rosenheimer', from: 'station-2', to: 'station-3' });
  network.addLine({
    id: 'U1', name: 'U1', color: '#c8784d',
    nodeIds: ['station-1', 'station-2', 'station-3'],
    linkIds: ['u1-nordplatz-central', 'u1-central-rosenheimer'],
  });
  return network;
}
