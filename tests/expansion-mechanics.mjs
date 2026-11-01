/** CPU checks for production route/vehicle/controller methods; no DOM or renderer. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCompleteMetroNetwork, createMetroNetwork, addU2ToNetwork, addLowerLinesToNetwork, addExpansionToNetwork, addPhase5ToNetwork } from '../src/network.js';
import { MetroRoute } from '../src/route.js';
import { Train, TrainCar } from '../src/train.js';
import { TrainService } from '../src/service.js';
import { PlayerController } from '../src/player.js';

const ORDERS = {
  U1: ['Nordplatz', 'Central', 'Rosenheimer Platz', 'Lindenallee', 'Universitätsviertel', 'Botanischer Garten', 'Ostgärten'],
  U2: ['Stadtzentrum', 'Rathausmarkt', 'Central', 'Kupfergasse', 'Schwarzkopf-Tunnel', 'Stahlhof', 'Eisenwerk'],
  U3: ['Schattenufer', 'Central', 'Ostbahnhof', 'Stadtbrücke', 'Museumsinsel', 'Kanalpark', 'Seetor'],
  U4: ['Kaiser-Humboldt-Platz', 'Westbahnhof', 'Central', 'Arabellapark'],
  U5: ['Westbahnhof', 'Südstadt', 'Stadionpark', 'Messepark', 'Technologiecampus', 'Flughafen', 'Nordklinikum', 'Waldtor', 'Hafenbogen', 'Ostbahnhof'],
  U6: ['Stadtzentrum', 'Theaterinsel', 'Südklinikum', 'Sonnenfeld', 'Ringplatz', 'Waldsee', 'Feldkirchen', 'Industriepark', 'Arabellapark'],
};
const established = createMetroNetwork(); addU2ToNetwork(established); addLowerLinesToNetwork(established);
const projectLine = (network, id) => ({ line: network.lines.get(id), stops: network.getLineStops(id).map(stop => ({ id: stop.id, position: stop.position, yaw: stop.yaw, distance: stop.distance, floorY: stop.floorY, platform: stop.platform })), links: network.lines.get(id).linkIds.map(key => network.links.get(key)) });
const before = JSON.stringify(['U1','U2','U3','U4'].map(id => projectLine(established,id)));
addExpansionToNetwork(established);
assert.equal(JSON.stringify(['U1','U2','U3','U4'].map(id => projectLine(established,id))), before, 'Expansion changed an established railway.');
const protectedLines = JSON.stringify(['U4', 'U5', 'U6'].map(id => projectLine(established, id)));
const originalNodes = [...established.nodes.values()].map(node => ({ node, name: node.name, position: { ...node.position }, platforms: JSON.stringify(node.platforms) }));
addPhase5ToNetwork(established);
assert.equal(JSON.stringify(['U4', 'U5', 'U6'].map(id => projectLine(established, id))), protectedLines, 'Phase 5 changed U4, U5 or U6.');
for (const { node, name, position, platforms } of originalNodes) {
  assert.strictEqual(established.nodes.get(node.id), node, 'Phase 5 replaced an existing shared station.');
  assert.equal(node.name, name); assert.deepEqual(node.position, position);
  assert.equal(JSON.stringify(node.platforms), platforms, 'Phase 5 moved an existing platform.');
}
const phase5Snapshot = JSON.stringify([...established.lines]);
addPhase5ToNetwork(established);
assert.equal(JSON.stringify([...established.lines]), phase5Snapshot, 'Phase 5 is not idempotent.');
assert.equal(established.nodes.size, 37);
const network = createCompleteMetroNetwork();
assert.equal(network.nodes.size, 37);
assert.equal(network.lines.size, 6);
assert.equal([...network.nodes.values()].reduce((sum, node) => sum + Object.keys(node.platforms).length, 0), 44);
assert.deepEqual(network.getLineStops('U1').map(stop => stop.distance), [0, 240, 480, 960, 1320, 1680, 2040]);
assert.deepEqual(network.getLineStops('U2').map(stop => stop.distance), [0, 120, 240, 360, 480, 600, 720]);
assert.deepEqual(network.getLineStops('U3').map(stop => stop.distance), [0, 390, 630, 870, 1230, 1590, 1950]);
assert.equal(network.links.size, 38);
assert.equal(new Set([...network.lines.values()].flatMap(line => line.linkIds)).size, network.links.size, 'Orphan/bypass link remains in the graph.');
assert.deepEqual(createMetroNetwork().getLineStops('U1').map(stop => stop.distance), [0, 240, 480]);
assert.deepEqual(network.nodes.get('station-2').lineIds, ['U1', 'U2', 'U3', 'U4']);
assert.equal(network.nodes.get('station-2').platforms.U1.floorY, 0);
assert.equal(network.nodes.get('station-2').platforms.U3.floorY, -12);

// Assetless fixtures use the production Train, TrainCar, TrainService and
// PlayerController methods. Browser tests separately exercise the actual meshes.
function makeTrain(lineId) {
  const train = new THREE.Group(); Object.setPrototypeOf(train, Train.prototype);
  Object.assign(train, { lineId, platformSide: -1, cars: [], gangways: [], poseScratch: new THREE.Vector3(), gangwayStart: new THREE.Vector3(), gangwayEnd: new THREE.Vector3() });
  for (let index = 0; index < 3; index++) {
    const car = new THREE.Group(); Object.setPrototypeOf(car, TrainCar.prototype);
    Object.assign(car, { lineId, platformSide: -1, carNumber: 101 + index, doors: [], doorways: [], destinationDisplays: [], cabs: [], interiorColliders: [], bogies: [], doorProgressBySide: { '-1': 0, '1': 0 }, doorTargets: { '-1': 0, '1': 0 } });
    car.position.z = (index - 1) * 17; car.userData.nominalRouteOffset = car.position.z;
    car.userData.interiorLayout = true;
    for (const z of [-5.8, 5.8]) {
      const bogie = new THREE.Group(); bogie.userData.localZ = z; bogie.position.z = z;
      car.bogies.push(bogie); car.add(bogie);
    }
    for (const side of [-1, 1]) for (const localZ of [-5.5, 0, 5.5]) car.doorways.push({ side, localZ });
    train.cars.push(car); train.add(car);
  }
  for (let index = 0; index < 2; index++) {
    const group = new THREE.Group(); train.add(group);
    train.gangways.push({ group, fromIndex: index, toIndex: index + 1 });
  }
  return train;
}
function makePlayer(service) {
  const stations = service.route.stops.map(stop => {
    const station = new THREE.Group(), yaw = stop.yaw + ((stop.platformSide ?? (['U2','U4'].includes(service.lineId) ? 1 : -1)) === 1 ? Math.PI : 0);
    station.rotation.y = yaw;
    station.position.set(stop.position.x - Math.cos(yaw) * 1.57, stop.floorY, stop.position.z + Math.sin(yaw) * 1.57);
    return Object.assign(station, { stationId: stop.id, lineId: service.lineId, bounds: { minX: -9.65, maxX: -0.68, minZ: -42.7, maxZ: 42.7 }, colliders: [] });
  });
  const player = Object.create(PlayerController.prototype);
  return Object.assign(player, { camera: new THREE.PerspectiveCamera(), service, services: [service], stations, station: stations[0],
    ridingCar: null, ridingLocalOffset: new THREE.Vector3(), ridingOffset: new THREE.Vector3(), previousRideOffset: new THREE.Vector3(),
    previousRidingCar: null, previousRideYaw: null, yaw: 0, pitch: 0, enabled: true, keys: new Set(), walkSpeed: 4.5, sprintSpeed: 7,
    interiorObstacles: [], radius: 0.24, distanceTravelled: 0, transferSurface: null });
}
function minimumRadius(path) {
  let radius = Infinity;
  for (const { curve, curved } of path?.segments ?? []) {
    if (!curved) continue;
    const a = curve.v1.clone().sub(curve.v0), b = curve.v2.clone().sub(curve.v1), c = curve.v3.clone().sub(curve.v2);
    for (let index = 0; index <= 200; index++) {
      const t = index / 200, s = 1 - t;
      const velocity = a.clone().multiplyScalar(3 * s * s).addScaledVector(b, 6 * s * t).addScaledVector(c, 3 * t * t);
      const acceleration = b.clone().sub(a).multiplyScalar(6 * s).addScaledVector(c.clone().sub(b), 6 * t);
      const cross = velocity.clone().cross(acceleration).length();
      if (cross > 1e-12) radius = Math.min(radius, velocity.length() ** 3 / cross);
    }
  }
  return radius;
}
function checkPose(train, route, distance, metrics) {
  train.updateWorldMatrix(true, true);
  for (const [index, car] of train.cars.entries()) {
    const carDistance = distance - car.userData.nominalRouteOffset;
    const expected = route.sampleExtended(carDistance);
    metrics.carError = Math.max(metrics.carError, car.getWorldPosition(new THREE.Vector3()).distanceTo(expected.position));
    if (!route.hasCurves) assert.deepEqual(car.position.toArray(), [0, 0, (index - 1) * 17]);
    for (const bogie of car.bogies) {
      const bogieDistance = carDistance - bogie.userData.localZ;
      metrics.bogieError = Math.max(metrics.bogieError, bogie.getWorldPosition(new THREE.Vector3()).distanceTo(route.sampleExtended(bogieDistance).position));
      for (const axle of [-0.85, 0.85]) for (const side of [-1, 1]) {
        const actual = bogie.localToWorld(new THREE.Vector3(side * 0.72, -0.684, axle));
        const sample = route.sampleExtended(bogieDistance - axle);
        const rail = sample.position.add(new THREE.Vector3(Math.cos(sample.yaw) * side * 0.7175, -0.684, -Math.sin(sample.yaw) * side * 0.7175));
        metrics.wheelError = Math.max(metrics.wheelError, actual.distanceTo(rail));
      }
    }
    for (const x of [-1.45, 1.45]) for (const z of [-8.7, 8.7]) {
      const delta = car.localToWorld(new THREE.Vector3(x, 1.6, z)).sub(route.sampleExtended(carDistance - z).position);
      const yaw = route.sampleExtended(carDistance - z).yaw;
      metrics.bodyLateral = Math.max(metrics.bodyLateral, Math.abs(delta.x * Math.cos(yaw) - delta.z * Math.sin(yaw)));
    }
    if (index > 0) {
      const spacing = car.getWorldPosition(new THREE.Vector3()).distanceTo(train.cars[index - 1].getWorldPosition(new THREE.Vector3()));
      assert(spacing > 16.98 && spacing < 17.001, 'Consist spacing exceeded the physical curve tolerance.');
    }
  }
  for (const { group, fromIndex, toIndex } of train.gangways) {
    const start = train.cars[fromIndex].localToWorld(new THREE.Vector3(0, 0, 7.925));
    const end = train.cars[toIndex].localToWorld(new THREE.Vector3(0, 0, -7.925));
    const gap = start.distanceTo(end);
    assert(gap > 1.1499 && gap < 1.18, 'Gangway end clearance changed.');
    if (route.hasCurves) {
      assert(group.getWorldPosition(new THREE.Vector3()).distanceTo(start.clone().add(end).multiplyScalar(0.5)) < 1e-8);
      assert(Math.abs(group.scale.z * 0.87 - gap) < 1e-8);
    }
  }
}
const results = [];
for (const lineId of network.lines.keys()) {
  const route = new MetroRoute(network, lineId), train = makeTrain(lineId);
  route.platformSide = ['U2','U4'].includes(lineId) ? 1 : -1;
  assert.deepEqual(route.stops.map(stop => stop.name), ORDERS[lineId]);
  assert.equal(route.hasCurves, ['U5', 'U6'].includes(lineId));
  const radius = Math.min(...route.segments.map(segment => minimumRadius(segment.path)));
  assert(radius >= 150, `${lineId}: curve radius ${radius} is too tight.`);
  route.segments.forEach((segment, index) => {
    assert(segment.link.permittedLineIds.includes(lineId));
    assert(route.stops[index].node === network.nodes.get(route.stops[index].id));
    if (index > 0 && segment.path) {
      const before = route.segments[index - 1].path.sample(route.segments[index - 1].length);
      const after = segment.path.sample(0);
      assert(before.position.distanceTo(after.position) < 1e-8 && before.tangent.distanceTo(after.tangent) < 1e-8);
    }
  });
  const metrics = { carError: 0, bogieError: 0, wheelError: 0, bodyLateral: 0, riderError: 0, publicOffsetError: 0 };
  const distances = Array.from({ length: Math.ceil(route.length / 2) + 1 }, (_, index) => Math.min(route.length, index * 2));
  distances.push(...route.stops.map(stop => stop.distance));
  for (const distance of distances) {
    const pose = route.sample(distance); train.position.copy(pose.position); train.rotation.y = pose.yaw;
    train.placeCarsOnRoute(route, distance); checkPose(train, route, distance, metrics);
  }
  const service = new TrainService(train, route, { deferReversal: true });
  const player = makePlayer(service), ids = [], directions = [], sides = [];
  let boards = 0, exits = 0, expectedRideLocal = new THREE.Vector3();
  const checkStop = () => {
    assert(service.canBoard && service.atStation && service.speed === 0);
    if (player.ridingCar) { assert(player.interact()); exits++; }
    const station = player.stations.find(item => item.stationId === service.currentStop.id); player.useStation(station);
    for (const car of train.cars) {
      player.camera.position.set(service.platformSide * 2.697, 1.76, 0); car.localToWorld(player.camera.position);
      assert(player.interact() && player.ridingCar === car, `${lineId}: boarding failed at ${service.currentStop.name}`); boards++;
      assert(player.interact() && !player.ridingCar, `${lineId}: alighting failed at ${service.currentStop.name}`); exits++;
      const local = station.worldToLocal(player.camera.position.clone());
      assert(local.x >= station.bounds.minX + player.radius && local.x <= station.bounds.maxX - player.radius);
      assert(Math.abs(local.y - 1.76) < 1e-8);
    }
    player.camera.position.set(service.platformSide * 2.697, 1.76, 0); train.cars[0].localToWorld(player.camera.position);
    assert(player.interact()); boards++;
    expectedRideLocal = player.ridingCar.worldToLocal(player.camera.position.clone());
    ids.push(service.currentStop.id); directions.push(service.direction); sides.push(service.platformSide);
  };
  checkStop();
  let previousLegs = 0, seconds = 0;
  const completeLegs = 2 * (route.stops.length - 1);
  while (service.completedLegs < completeLegs || !service.canBoard) {
    service.update(0.25); player.syncRide(); seconds += 0.25;
    if (service.speed > 0) assert(train.doorsClosed && !service.canBoard);
    if (player.ridingCar) {
      metrics.riderError = Math.max(metrics.riderError, player.ridingCar.worldToLocal(player.camera.position.clone()).distanceTo(expectedRideLocal));
      metrics.publicOffsetError = Math.max(metrics.publicOffsetError, train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset));
    }
    if (service.canBoard && service.completedLegs !== previousLegs) { previousLegs = service.completedLegs; checkStop(); }
    assert(seconds < 2000, `${lineId}: return journey exceeded the configured timing budget.`);
  }
  assert.deepEqual(ids, [...route.stops.map(stop => stop.id), ...route.stops.slice(0, -1).reverse().map(stop => stop.id)]);
  assert(metrics.carError < 1e-8 && metrics.bogieError < 1e-8 && metrics.riderError < 1e-8 && metrics.publicOffsetError < 1e-8);
  assert(metrics.wheelError < 0.01 && metrics.bodyLateral < 1.75);
  results.push({ lineId, stops: route.stops.length, visits: ids.length, boards, exits, seconds, minimumCurveRadius: Number.isFinite(radius) ? radius : null, ...metrics });
}
// A deliberately tighter 150 m analytic curve probes heading wrap and walking
// independently of the approved network's particular control points.
const curveRadius = 150;
const circlePose = distance => ({
  position: new THREE.Vector3(curveRadius * (1 - Math.cos(distance / curveRadius)), 0, -curveRadius * Math.sin(distance / curveRadius)),
  yaw: -distance / curveRadius,
});
const circleRoute = { lineId: 'TEST', hasCurves: true, length: 650,
  sample: distance => circlePose(THREE.MathUtils.clamp(distance, 0, 650)), sampleExtended: circlePose,
  stops: [0, 650].map((distance, index) => ({ id: `curve-${index}`, name: `Curve ${index}`, distance,
    position: circlePose(distance).position, yaw: circlePose(distance).yaw, floorY: 0, platformSide: -1 })),
};
const curveTrain = makeTrain('TEST'), curveService = new TrainService(curveTrain, circleRoute), curvePlayer = makePlayer(curveService);
curvePlayer.camera.position.set(-2.697, 1.76, 0); curveTrain.cars[0].localToWorld(curvePlayer.camera.position);
assert(curvePlayer.interact());
const curveLocal = curvePlayer.ridingLocalOffset.clone();
let curveRiderError = 0;
for (let distance = 0; distance <= 650; distance += 0.5) {
  curveService.distance = distance; curveService.placeTrain(); curvePlayer.syncRide();
  curveRiderError = Math.max(curveRiderError, curvePlayer.ridingCar.worldToLocal(curvePlayer.camera.position.clone()).distanceTo(curveLocal));
}
assert(curveRiderError < 1e-8);
assert(Math.abs(curvePlayer.yaw + 650 / curveRadius) < 1e-8);
curvePlayer.yaw = -(650 + 17) / curveRadius; curvePlayer.applyLook();
curvePlayer.keys.add('KeyW'); curvePlayer.update(0.05); curvePlayer.keys.clear();
assert(Math.abs(curvePlayer.ridingLocalOffset.z - (curveLocal.z - 0.225)) < 1e-8);
assert(Math.abs(curvePlayer.ridingLocalOffset.x - curveLocal.x) < 1e-8);
console.log(JSON.stringify({ stations: network.nodes.size, platforms: 44, lines: network.lines.size, results,
  analyticCurve: { radius: curveRadius, samples: 1301, riderError: curveRiderError, headingAndWalking: true } }, null, 2));
