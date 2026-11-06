import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCompleteMetroNetwork } from '../src/network.js';
import { createPhase6Network, createScenicU5Route } from '../src/phase6-network.js';
import { MetroRoute } from '../src/route.js';
import { Train, TrainCar } from '../src/train.js';
import { TrainService } from '../src/service.js';
import { U5JunctionProtection } from '../src/phase6-world.js';

const original = createCompleteMetroNetwork(), network = createPhase6Network();
for (const [id, node] of original.nodes) {
  const actual = network.nodes.get(id);
  assert.equal(actual.name, node.name); assert.deepEqual(actual.position, node.position);
  for (const [lineId, platform] of Object.entries(node.platforms)) assert.deepEqual(actual.platforms[lineId], platform);
}
for (const [id, line] of original.lines) assert.deepEqual(network.lines.get(id), line);
for (const [id, link] of original.links) {
  const actual = network.links.get(id);
  assert.deepEqual(actual.controlPoints, link.controlPoints); assert.equal(actual.length, link.length);
}
const direct = new MetroRoute(network, 'U5'), baseline = new MetroRoute(original, 'U5');
for (let d = 0; d < direct.length; d += 0.5) assert(direct.sample(d).position.distanceTo(baseline.sample(d).position) < 1e-9);
assert.equal(network.lines.get('U9').color, '#f7d348');
assert.deepEqual(network.lines.get('U9').nodeIds.filter(id => original.nodes.has(id)), ['station-2', 'u5-nordklinikum', 'u5-waldtor']);
const branch = network.phase6.branch, scenic = createScenicU5Route(network), u9 = new MetroRoute(network, 'U9');
assert.deepEqual(scenic.stops.filter(s => original.nodes.has(s.id)).map(s => s.name), direct.stops.map(s => s.name));
assert.equal(scenic.stops.at(-1).name, 'Ostbahnhof'); assert(scenic.stops.filter(s => s.id.startsWith('u5-') && !original.nodes.has(s.id)).every(s => !s.isTerminus));
for (const [toe, d] of [[branch.junctions.split, branch.splitDistance], [branch.junctions.merge, branch.splitDistance + branch.length]]) {
  assert(scenic.sample(d).position.distanceTo(new THREE.Vector3(toe.x, toe.y, toe.z)) < 1e-6);
  assert(scenic.sample(d - 0.001).tangent.dot(scenic.sample(d + 0.001).tangent) > 0.999999);
}
let minRadius = Infinity, maxGrade = 0, eastbound = 0, westbound = 0;
for (let d = 2; d < branch.length - 2; d += 1) {
  const pose = branch.sample(d), a = branch.sample(d - 0.5), b = branch.sample(d + 0.5);
  const turn = Math.acos(Math.min(1, a.tangent.dot(b.tangent)));
  if (turn > 1e-7) minRadius = Math.min(minRadius, 1 / turn);
  maxGrade = Math.max(maxGrade, Math.abs(Math.tan(pose.pitch)));
  assert(pose.position.distanceTo(a.position) < 0.501, 'Discontinuous arc-length sampling');
  if (pose.position.x > 1400 && pose.position.x < 1800 && Math.abs(pose.position.z + 433) < 4) {
    assert(Math.abs(pose.position.y) < 1e-8); assert(Math.abs(pose.pitch) < 1e-8);
    if (pose.tangent.x > 0) eastbound++; else westbound++;
  }
}
assert(minRadius > 290); assert(maxGrade <= 0.04); assert(eastbound >= 399 && westbound >= 399);
for (const stop of branch.stations) for (let d = -60; d <= 60; d++) assert(Math.abs(branch.sample(stop.distance + d).pitch) < 1e-8, `${stop.name}: non-level station approach`);

function trainFixture(lineId) {
  const train = new THREE.Group(); Object.setPrototypeOf(train, Train.prototype);
  Object.assign(train, { lineId, platformSide: -1, cars: [], gangways: [], poseScratch: new THREE.Vector3(), gangwayStart: new THREE.Vector3(), gangwayEnd: new THREE.Vector3() });
  for (let i = 0; i < 3; i++) {
    const car = new THREE.Group(); Object.setPrototypeOf(car, TrainCar.prototype);
    Object.assign(car, { lineId, platformSide: -1, doors: [], doorways: [], destinationDisplays: [], cabs: [], interiorColliders: [], bogies: [], doorProgressBySide: { '-1': 0, '1': 0 }, doorTargets: { '-1': 0, '1': 0 } });
    car.position.z = (i - 1) * 17; car.userData.nominalRouteOffset = car.position.z;
    for (const z of [-5.8, 5.8]) { const bogie = new THREE.Group(); bogie.userData.localZ = z; car.add(bogie); car.bogies.push(bogie); }
    train.cars.push(car); train.add(car);
  }
  for (let i = 0; i < 2; i++) { const group = new THREE.Group(); train.add(group); train.gangways.push({ group, fromIndex: i, toIndex: i + 1 }); }
  return train;
}
const journeys = [];
for (const route of [u9, scenic]) {
  const train = trainFixture(route.lineId), service = new TrainService(train, route, { deferReversal: true });
  const authority = route.lineId === 'U5' ? new U5JunctionProtection(branch) : null; service.authority = authority;
  const visits = [service.currentStop.id]; let last = 0, maxCarError = 0, maxBogieError = 0, maxOrientationError = 0;
  for (let time = 0; time < 5000 && service.completedLegs < (route.stops.length - 1) * 2; time += 0.25) {
    if (service.canBoard) service.requestDeparture();
    service.update(0.25); authority?.update(service);
    if (service.completedLegs !== last) { visits.push(service.currentStop.id); last = service.completedLegs; }
    if (Math.round(time * 4) % 12 !== 0) continue;
    train.updateWorldMatrix(true, true);
    for (const car of train.cars) {
      const expected = route.sampleExtended(service.distance - car.userData.nominalRouteOffset);
      maxCarError = Math.max(maxCarError, car.getWorldPosition(new THREE.Vector3()).distanceTo(expected.position));
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(car.getWorldQuaternion(new THREE.Quaternion()));
      maxOrientationError = Math.max(maxOrientationError, forward.distanceTo(expected.tangent));
      for (const bogie of car.bogies) maxBogieError = Math.max(maxBogieError, bogie.getWorldPosition(new THREE.Vector3()).distanceTo(route.sampleExtended(service.distance - car.userData.nominalRouteOffset - bogie.userData.localZ).position));
    }
  }
  assert.deepEqual(visits, [...route.stops.map(s => s.id), ...route.stops.slice(0, -1).reverse().map(s => s.id)]);
  assert(maxCarError < 1e-8 && maxBogieError < 1e-8 && maxOrientationError < 1e-6);
  journeys.push({ line: route.lineId, variant: route.variant ?? 'regular', visitedStops: visits.length, maxCarError, maxBogieError, maxOrientationError });
}
// A conflicting request must stop before the protected throat, then accelerate
// normally when released. The existing train timing is used throughout.
const authority = new U5JunctionProtection(branch), owner = { lineId: 'test-occupant', route: direct };
authority.reserve(owner);
const blocked = new TrainService(trainFixture('U5'), direct); blocked.authority = authority;
blocked.distance = branch.splitDistance - 155; blocked.stopIndex = 8; blocked.currentStop = direct.stops[8]; blocked.nextStop = direct.stops[9]; blocked.speed = 10; blocked.state = 'travelling';
for (let i = 0; i < 2000; i++) blocked.move(1 / 60);
assert(blocked.waitingForSignal); assert(blocked.distance <= branch.splitDistance - 98 + 0.001); assert(blocked.speed < 0.01);
authority.release(owner); blocked.move(1 / 60); assert(blocked.speed > 0);
const result = { preservedOriginalStations: original.nodes.size, preservedOriginalLines: original.lines.size, preservedPlatforms: 44, phase6Stations: network.nodes.size, branchLength: branch.length, minRadius, maxGradePercent: maxGrade * 100, bridgeSamples: { eastbound, westbound }, junctionProtection: 'conflicting train stopped before home signal; resumed after release', journeys };
console.log(JSON.stringify(result, null, 2));
