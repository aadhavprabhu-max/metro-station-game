import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import { createCompleteMetroNetwork } from '../src/network.js';
import { createPhase6Network } from '../src/phase6-network.js';
import { addU10ToNetwork, U10_STATIONS } from '../src/u10-network.js';
import { MetroRoute } from '../src/route.js';
import { TrainService } from '../src/service.js';
import { createTimingTrain, measureU10Timetable, U10_SERVICE_OPTIONS } from '../src/u10-timetable.js';

const baseline = JSON.parse(await readFile(new URL('./fixtures/phase5-network.json', import.meta.url), 'utf8'));
const phase5 = createCompleteMetroNetwork();
assert.deepEqual(JSON.parse(JSON.stringify({ nodes: [...phase5.nodes], links: [...phase5.links].map(([id, { path, ...v }]) => [id, v]), lines: [...phase5.lines] })), baseline);
const phase6Baseline = JSON.parse(await readFile(new URL('./fixtures/phase6-network.json', import.meta.url), 'utf8'));
const network = createPhase6Network();
const protectedData = { nodes: [...network.nodes], links: [...network.links].map(([id, { path, ...v }]) => [id, v]), lines: [...network.lines] };
assert.deepEqual(JSON.parse(JSON.stringify(protectedData)), phase6Baseline, 'The Phase 6 baseline changed before U10 was appended.');
const preserved = JSON.parse(JSON.stringify(protectedData));
addU10ToNetwork(network);
for (const [id, node] of preserved.nodes) {
  const next = network.nodes.get(id);
  assert.equal(next.name, node.name); assert.deepEqual(next.position, node.position);
  for (const [line, platform] of Object.entries(node.platforms)) assert.deepEqual(next.platforms[line], platform, `Moved ${id}:${line}`);
  assert.deepEqual(next.lineIds.filter(line => line !== 'U10'), node.lineIds);
}
for (const [id, line] of preserved.lines) assert.deepEqual(network.lines.get(id), line);
for (const [id, link] of preserved.links) { const { path, ...next } = network.links.get(id); assert.deepEqual(next, link); }
const route = new MetroRoute(network, 'U10');
assert.equal(network.nodes.size, 53); assert.equal(network.links.size, 54); assert.equal(network.lines.size, 8);
assert.equal([...network.nodes.values()].reduce((n, node) => n + Object.keys(node.platforms).length, 0), 65);
assert.equal(U10_STATIONS.filter(s => s.outdoor).length, 4); assert.equal(U10_STATIONS.length, 10);
assert.equal(route.stops[0].id, 'station-2'); assert.equal(route.line.color, '#123B75');
assert.deepEqual(network.nodes.get('station-2').lineIds, ['U1', 'U2', 'U3', 'U4', 'U9', 'U10']);
assert.deepEqual(network.nodes.get('u6-ringplatz').lineIds, ['U6', 'U10']);
assert.notEqual(route.stops.at(-1).id, 'u5-flughafen');
let maxGrade = 0, maxQuaternionError = 0;
for (let d = 0; d <= route.length; d += 2) {
  const pose = route.sample(d); maxGrade = Math.max(maxGrade, Math.abs(pose.grade));
  const actual = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
  maxQuaternionError = Math.max(maxQuaternionError, actual.distanceTo(pose.tangent));
  assert(pose.position.toArray().every(Number.isFinite));
}
assert(maxGrade < 0.04); assert(maxGrade > 0.03); assert(maxQuaternionError < 1e-10);
for (const stop of route.stops) for (const offset of [-40, -20, 0, 20, 40]) {
  const pose = route.sampleExtended(stop.distance + offset); assert(Math.abs(pose.position.y - stop.floorY) < 1e-8, `${stop.name}: platform approach not level.`);
}
const measured = measureU10Timetable(route);
for (const direction of measured.directions) {
  assert.equal(direction.segments.length, 9); assert.equal(direction.intermediate.length, 8);
  assert.equal(direction.runningSeconds, direction.segments.reduce((n, s) => n + s.seconds, 0));
  assert.equal(direction.passengerDwellSeconds, 160);
  assert(Math.abs(direction.totalSeconds - (direction.segments.at(-1).arrivalSeconds - direction.segments[0].departureSeconds)) < 1e-8);
}
// Independently repeat the observed controller cycle and compare every event timestamp.
const service = new TrainService(createTimingTrain(), route, U10_SERVICE_OPTIONS);
let tick = 0, departureTick = null, moving = false;
const actual = [];
while (service.completedLegs < 18) {
  const before = service.completedLegs;
  service.update(1 / 60); tick++;
  if (service.speed > 0 && !moving) { departureTick = tick; moving = true; }
  if (service.completedLegs !== before) {
    actual.push({ station: service.currentStop.id, seconds: (tick - departureTick) / 60 }); moving = false;
    assert(service.atStation); assert.equal(service.speed, 0); assert(service.train.doorsClosed);
  }
}
const expected = measured.directions.flatMap(d => d.segments);
assert.deepEqual(actual, expected.map(s => ({ station: s.toId, seconds: s.seconds })));
const report = { protectedStations: preserved.nodes.length, protectedPlatforms: 55, protectedLinks: preserved.links.length,
  nodes: network.nodes.size, platforms: 65, links: network.links.size, lengthMetres: route.length, maxGrade, maxQuaternionError,
  outdoor: 4, indoor: 6, actualStopEvents: actual.length, timetable: measured };
await writeFile('/tmp/metro-u10-mechanics.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, timetable: { directions: measured.directions.map(d => ({ direction: d.direction, runningSeconds: d.runningSeconds, totalSeconds: d.totalSeconds })), headwaySeconds: measured.headwaySeconds } }, null, 2));
