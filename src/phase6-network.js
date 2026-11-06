import * as THREE from 'three';
import { createCompleteMetroNetwork } from './network.js';
import { RailPath, createStationPath } from './expansion-path.js';
import { MetroRoute } from './route.js';

const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const line = (a, b) => new THREE.LineCurve3(a, b);
const bezier = (a, b, c, d) => new THREE.CubicBezierCurve3(a, b, c, d);
const K = 4 * (Math.sqrt(2) - 1) / 3;
const smooth = t => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** Preserve the exact original curve, including its arc-length parametrisation. */
export class PathSlice {
  constructor(path, from, to) { this.path = path; this.from = from; this.length = to - from; this.hasCurves = path.hasCurves; }
  sample(d) { return this.path.sample(this.from + THREE.MathUtils.clamp(d, 0, this.length)); }
}

/** A surveyed, genuinely three-dimensional railway. Distances include elevation. */
export class GradedPath {
  constructor(horizontal, elevation) {
    this.horizontal = horizontal; this.elevation = elevation; this.hasCurves = true;
    this.table = [{ distance: 0, horizontal: 0 }];
    let previous = this.point(0), distance = 0;
    const count = Math.ceil(horizontal.length / 0.5);
    for (let i = 1; i <= count; i++) {
      const h = horizontal.length * i / count, point = this.point(h);
      distance += previous.distanceTo(point); this.table.push({ distance, horizontal: h }); previous = point;
    }
    this.length = distance;
  }
  point(h) { const p = this.horizontal.sample(h).position; p.y = this.elevation(h); return p; }
  distanceAtHorizontal(h) {
    const index = Math.min(this.table.length - 2, Math.floor(h / this.horizontal.length * (this.table.length - 1)));
    const a = this.table[index], b = this.table[index + 1];
    return THREE.MathUtils.lerp(a.distance, b.distance, (h - a.horizontal) / (b.horizontal - a.horizontal));
  }
  sample(d) {
    d = THREE.MathUtils.clamp(d, 0, this.length);
    let low = 0, high = this.table.length - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (this.table[mid].distance < d) low = mid; else high = mid; }
    const a = this.table[low], b = this.table[high];
    const h = THREE.MathUtils.lerp(a.horizontal, b.horizontal, (d - a.distance) / (b.distance - a.distance));
    const position = this.point(h), sample = this.horizontal.sample(h);
    const dh = 0.02, from = Math.max(0, h - dh), to = Math.min(this.horizontal.length, h + dh);
    const grade = (this.elevation(to) - this.elevation(from)) / (to - from);
    const tangent = sample.tangent.clone(); tangent.y = grade; tangent.normalize();
    return { position, tangent, yaw: sample.yaw, pitch: Math.atan(grade), up: new THREE.Vector3(0, 1, 0) };
  }
}

function addStation(network, id, name, position, yaw, lineId, number, side = -1) {
  if (!network.nodes.has(id)) network.addNode({ id, name, position });
  const node = network.nodes.get(id);
  network.addPlatform(id, { lineId, number, position, yaw, floorY: position.y, platformSide: side, level: position.y < -1 ? 'lower' : 'surface' });
  if (!node.lineIds.includes(lineId)) node.lineIds.push(lineId);
  return node;
}

/** Fixed, user-approved turnout toes. Do not move these to make geometry easier. */
export const U5_JUNCTIONS = Object.freeze({
  split: Object.freeze({ id: 'u5-ja', x: 1.57, y: -24, z: -730, beforeOstbahnhof: 250 }),
  merge: Object.freeze({ id: 'u5-jb', x: 1.57, y: -24, z: -580, beforeOstbahnhof: 100 }),
});

export function addU5ScenicBranch(network) {
  if (network.phase6?.branch) return network.phase6.branch;
  const original = new MetroRoute(network, 'U5'), last = original.segments.at(-1);
  const splitDistance = original.length - 250, mergeDistance = original.length - 100;
  for (const [junction, d] of [[U5_JUNCTIONS.split, splitDistance], [U5_JUNCTIONS.merge, mergeDistance]]) {
    const expected = new THREE.Vector3(junction.x, junction.y, junction.z), actual = original.sample(d);
    if (actual.position.distanceTo(expected) > 1e-6 || Math.abs(actual.yaw - Math.PI) > 1e-6) throw new Error(`Approved ${junction.id} no longer matches the original railway.`);
    for (let offset = -28; offset <= 28; offset += 1) {
      const pose = original.sample(d + offset);
      if (Math.abs(pose.position.x - junction.x) > 1e-6 || Math.abs(pose.position.y - junction.y) > 1e-6) throw new Error(`Insufficient full-consist clearance at ${junction.id}.`);
    }
  }
  // The original mainline remains byte-for-byte the same network link and path.
  // Broad 300/320 m bends form the two bridge approaches and eastern balloon.
  const curves = [
    bezier(V(1.57, -730), V(1.57, -730 + 300 * K), V(301.57 - 300 * K, -430), V(301.57, -430)),
    line(V(301.57, -430), V(3800, -430)),
    bezier(V(3800, -430), V(3800 + 320 * K, -430), V(4120, -750 + 320 * K), V(4120, -750)),
    bezier(V(4120, -750), V(4120, -750 - 320 * K), V(3800 + 320 * K, -1070), V(3800, -1070)),
    line(V(3800, -1070), V(3300, -1070)),
    bezier(V(3300, -1070), V(2933.333, -1070), V(2566.667, -436), V(2200, -436)),
    line(V(2200, -436), V(1400, -436)),
    bezier(V(1400, -436), V(1033.8567, -436), V(667.7133, -880), V(301.57, -880)),
    bezier(V(301.57, -880), V(301.57 - 300 * K, -880), V(1.57, -580 - 300 * K), V(1.57, -580)),
  ];
  const horizontal = new RailPath(curves);
  // Keep the underground turnout/diamond throat level. Surface stations and both
  // bridge crossings are level; eased gradients stay below four percent.
  const elevation = h => h < 1250 ? -24 + 24 * smooth((h - 250) / 1000)
    : h > horizontal.length - 1250 ? -24 * smooth((h - (horizontal.length - 1250)) / 1000) : 0;
  const path = new GradedPath(horizontal, elevation);
  const stationSurvey = [
    ['u5-altstadtbruecke', 'Altstadtbrücke', 1150, -430, -Math.PI / 2, 1],
    ['u5-uferpromenade', 'Uferpromenade', 3500, -430, -Math.PI / 2, 1],
    ['u5-steinbogen', 'Steinbogen', 3550, -1070, Math.PI / 2, 4],
  ];
  const stations = stationSurvey.map(([id, name, x, z, yaw, segment]) => {
    const section = horizontal.segments[segment];
    const h = section.startDistance + Math.hypot(x - section.curve.v1.x, z - section.curve.v1.z);
    const distance = path.distanceAtHorizontal(h), position = path.sample(distance).position;
    addStation(network, id, name, position, yaw, 'U5', '05');
    return { id, name, distance, position: { x: position.x, y: position.y, z: position.z }, yaw, floorY: position.y, level: 'surface', platform: '05', platformSide: -1, node: network.nodes.get(id), isTerminus: false };
  });
  const branch = { path, horizontal, stations, original, originalLink: last.link, splitDistance, mergeDistance,
    junctions: U5_JUNCTIONS, bridge: { fromX: 1400, toX: 1800, centerZ: -433, trackZ: [-430, -436], deckY: -1.35, waterY: -14 },
    sample: d => path.sample(d), sampleExtended: d => path.sample(d), length: path.length, stops: stations, lineId: 'U5', hasCurves: true };
  const points = [{ id: 'u5-ja', distance: 0 }, ...stations, { id: 'u5-jb', distance: path.length }];
  branch.navigation = {
    junctions: new Map(Object.values(U5_JUNCTIONS).map(j => [j.id, { ...j, originalLinkId: last.id, originalRouteDistance: j.id === 'u5-ja' ? splitDistance : mergeDistance }])),
    links: points.slice(0, -1).map((a, i) => ({ id: `u5-scenic-${a.id}-${points[i + 1].id}`, from: a.id, to: points[i + 1].id, permittedLineIds: ['U5'], path: new PathSlice(path, a.distance, points[i + 1].distance) })),
  };
  network.phase6 ??= {}; network.phase6.branch = branch;
  return branch;
}

export function createScenicU5Route(network) {
  const branch = network.phase6.branch, original = branch.original;
  const route = Object.create(MetroRoute.prototype);
  Object.assign(route, original, { variant: 'scenic', hasCurves: true, hasGrades: true, branch });
  const prefix = branch.splitDistance, replaced = branch.mergeDistance - branch.splitDistance;
  route.length = original.length + branch.length - replaced;
  route.stops = original.stops.slice(0, -1).map(s => ({ ...s }));
  route.stops.push(...branch.stations.map(s => ({ ...s, distance: prefix + s.distance })));
  route.stops.push({ ...original.stops.at(-1), distance: route.length });
  route.line = { ...original.line, name: `${original.line.name} · River loop`, nodeIds: route.stops.map(s => s.id) };
  route.sample = distance => {
    const d = THREE.MathUtils.clamp(distance, 0, route.length);
    if (d <= prefix) return original.sample(d);
    if (d < prefix + branch.length) return branch.path.sample(d - prefix);
    return original.sample(branch.mergeDistance + d - prefix - branch.length);
  };
  route.segments = route.stops.slice(0, -1).map((from, i) => {
    const to = route.stops[i + 1], length = to.distance - from.distance;
    if (i < original.segments.length - 1) return original.segments[i];
    return { id: `u5-scenic-${from.id}-${to.id}`, from, to, startDistance: from.distance, endDistance: to.distance, length,
      hasCurves: true, path: { length, hasCurves: true, sample: d => route.sample(from.distance + d) } };
  });
  route.line.linkIds = route.segments.map(s => s.id);
  return route;
}

/** Approved existing U5 anchors; every original platform stays at its old pose. */
export function addU9(network) {
  if (network.lines.has('U9')) return;
  const definitions = [
    ['station-2', 'Central', 1.57, -240, 0],
    ['u9-kaiserforum', 'Kaiserforum', 1.57, -460, 0],
    ['u9-goldmarkt', 'Goldmarkt', -340, -850, Math.PI / 2],
    ['u9-sonnenviertel', 'Sonnenviertel', -700, -850, Math.PI / 2],
    ['u5-nordklinikum', 'Nordklinikum', -1080, -1080, 0],
    ['u9-hohenbrueck', 'Hohenbrück', -1440, -1900, 0],
    ['u9-kronenplatz', 'Kronenplatz', -1080, -2260, -Math.PI / 2],
    ['u5-waldtor', 'Waldtor', -720, -1080, Math.PI],
  ];
  // Deeper U9 platforms give all three interchanges protected 24 m separation.
  const poses = definitions.map(([id, name, x, z, yaw]) => ({ id, name, position: { x, y: -48, z }, yaw }));
  for (const p of poses) addStation(network, p.id, p.name, p.position, p.yaw, 'U9', '09');
  const linkIds = [];
  for (let i = 0; i < poses.length - 1; i++) {
    const a = poses[i], b = poses[i + 1], id = `u9-${a.id}-${b.id}`;
    const path = createStationPath(a, b);
    network.addLink({ id, from: a.id, to: b.id, path, permittedLineIds: ['U9'] }); linkIds.push(id);
  }
  // addStation registered identities before addLine; avoid duplicate memberships.
  for (const p of poses) network.nodes.get(p.id).lineIds = network.nodes.get(p.id).lineIds.filter(id => id !== 'U9');
  network.addLine({ id: 'U9', name: 'The Golden Southwest Line', color: '#f7d348', nodeIds: poses.map(p => p.id), linkIds });
  for (const p of poses) { const n = network.nodes.get(p.id); n.interchangeCapable ||= n.lineIds.length > 1; }
}

export function createPhase6Network() {
  const network = createCompleteMetroNetwork();
  addU5ScenicBranch(network); addU9(network);
  return network;
}
