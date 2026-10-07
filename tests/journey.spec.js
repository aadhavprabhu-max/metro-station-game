import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.service);
});

test('the connected train completes both directions continuously with doors shut before moving', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { world } = window.metro;
    const { train, service, route } = world;
    world.renderer.setAnimationLoop(null);
    const dt = 1 / 60;
    const originalCarOffsets = train.cars.map(car => car.position.toArray());
    const states = new Set([service.state]);
    let previousDistance = service.distance;
    let previousSpeed = service.speed;
    let maxStep = 0, maxSpeedChange = 0, movingSamples = 0;
    let outwardSamples = 0, returnSamples = 0;
    let centralStopped = false, rosenheimerStopped = false, nordplatzReturned = false;
    let centralDisplayDestinations = [];
    let returningCentralDisplays = [];
    let recordedLegs = 0;
    const stopSequence = [];
    let departurePause = 0;
    const failures = [];
    const check = (condition, message) => { if (!condition && failures.length < 12) failures.push(message); };
    for (let step = 0; step < 330 / dt; step++) {
      world.update(dt);
      const distance = service.distance;
      const change = distance - previousDistance;
      states.add(service.state);
      maxStep = Math.max(maxStep, Math.abs(change));
      maxSpeedChange = Math.max(maxSpeedChange, Math.abs(service.speed - previousSpeed));
      check(distance >= -1e-7 && distance <= route.length + 1e-7, 'Train left the route bounds.');
      check(Math.abs(train.position.z + distance) < 1e-7, 'The train left the sampled route.');
      check(Math.abs(train.position.x - 1.57) < 1e-7 && Math.abs(train.rotation.y) < 1e-7, 'Train lost rail alignment.');
      check(train.cars.every((car, index) => car.position.toArray().every((value, axis) => value === originalCarOffsets[index][axis])), 'A train car detached from the consist.');
      if (service.speed > 1e-5) {
        movingSamples++;
        if (change > 1e-6) outwardSamples++;
        if (change < -1e-6) returnSamples++;
        check(train.cars.every(car => car.doorTarget === 0 && Object.values(car.doorProgressBySide).every(value => value < 0.002)), 'Train moved with an open door.');
      } else if (service.state === 'departing') departurePause += dt;
      check(train.cars.every(car => car.doorProgressBySide[1] === 0), 'Track-side doors opened.');
      if (service.completedLegs > recordedLegs && service.speed === 0 && service.state === 'boarding') {
        recordedLegs = service.completedLegs;
        const displays = train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => display.userData.destination));
        stopSequence.push({
          id: service.currentStop.id, distance, direction: service.direction,
          next: service.nextStop.name, terminal: service.destinationStop.name,
        });
        if (service.currentStop.id === 'station-2') {
          centralStopped = true;
          if (service.direction === 1) centralDisplayDestinations = displays;
          else returningCentralDisplays = displays;
        }
        if (service.currentStop.id === 'station-3') rosenheimerStopped = true;
      }
      if (service.completedLegs === 4 && distance === 0 && service.speed === 0 && service.state === 'boarding') {
        nordplatzReturned = true;
        for (let i = 0; i < 120; i++) world.update(dt);
        break;
      }
      previousDistance = distance;
      previousSpeed = service.speed;
    }
    return {
      failures, states: [...states], maxStep, maxSpeedChange,
      movingSamples, outwardSamples, returnSamples, departurePause,
      centralStopped, rosenheimerStopped, nordplatzReturned, stopSequence,
      centralDisplayDestinations, returningCentralDisplays,
      finalDisplayDestinations: train.cars.flatMap(car => car.destinationDisplays.map(({ display }) => display.userData.destination)),
      stops: route.stops, finalDistance: service.distance, finalSpeed: service.speed,
      finalDoors: train.cars.map(car => ({ target: car.doorTarget, progress: car.doorProgress })),
      destinations: world.stations.map(station => station.departures.departures[0].destination),
      glError: world.renderer.getContext().getError(),
    };
  });
  expect(result.failures).toEqual([]);
  expect(result.stops.map(stop => stop.id)).toEqual(['station-1', 'station-2', 'station-3']);
  expect(result.stops.map(stop => stop.distance)).toEqual([0, 240, 480]);
  expect(result.states).toEqual(expect.arrayContaining(['boarding', 'closing', 'departing', 'travelling', 'arriving', 'stopped']));
  expect(result.centralStopped).toBe(true);
  expect(result.rosenheimerStopped).toBe(true);
  expect(result.nordplatzReturned).toBe(true);
  expect(result.stopSequence).toEqual([
    { id: 'station-2', distance: 240, direction: 1, next: 'Rosenheimer Platz', terminal: 'Rosenheimer Platz' },
    { id: 'station-3', distance: 480, direction: -1, next: 'Central', terminal: 'Nordplatz' },
    { id: 'station-2', distance: 240, direction: -1, next: 'Nordplatz', terminal: 'Nordplatz' },
    { id: 'station-1', distance: 0, direction: 1, next: 'Central', terminal: 'Rosenheimer Platz' },
  ]);
  expect(result.outwardSamples).toBeGreaterThan(1000);
  expect(result.returnSamples).toBeGreaterThan(1000);
  expect(result.maxStep).toBeLessThanOrEqual(10 / 60 + 1e-6);
  expect(result.maxSpeedChange).toBeLessThanOrEqual(1.1 / 60 + 1e-6);
  expect(result.departurePause).toBeGreaterThan(0.5);
  expect(result.finalDistance).toBe(0);
  expect(result.finalSpeed).toBe(0);
  expect(result.finalDoors.every(door => door.target === 1 && door.progress > 0.99)).toBe(true);
  expect(result.destinations).toEqual(['Rosenheimer Platz', 'Rosenheimer Platz', 'Nordplatz']);
  expect(result.centralDisplayDestinations.length).toBeGreaterThanOrEqual(8);
  expect(result.centralDisplayDestinations.every(name => name === 'Rosenheimer Platz')).toBe(true);
  expect(result.returningCentralDisplays.every(name => name === 'Nordplatz')).toBe(true);
  expect(result.finalDisplayDestinations.every(name => name === 'Rosenheimer Platz')).toBe(true);
  expect(result.glError).toBe(0);
});

test('keyboard boarding and the action button work only at a stopped open door', async ({ page }) => {
  await page.evaluate(() => {
    const { player, world } = window.metro;
    // A valid platform position at the existing first car's centre door.
    player.camera.position.set(-0.92, 1.76, world.train.position.z + world.train.cars[0].position.z);
    player.yaw = -Math.PI / 2;
    player.applyLook();
  });
  await page.waitForFunction(() => window.metro.player.interactionHint().enabled);
  await expect(page.locator('#interact-button')).toBeVisible();
  await page.keyboard.press('e');
  await page.waitForFunction(() => Boolean(window.metro.player.ridingCar));
  expect(await page.evaluate(() => window.metro.player.ridingCar.carNumber)).toBe(101);
  await expect(page.locator('#interact-button')).toBeVisible();
  await page.locator('#interact-button').click();
  await page.waitForFunction(() => !window.metro.player.ridingCar);
  expect(await page.evaluate(() => window.metro.player.station.stationId)).toBe('station-1');
  await page.locator('#interact-button').click();
  await page.waitForFunction(() => Boolean(window.metro.player.ridingCar));
  const travel = await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    const car = player.ridingCar;
    const startingLocal = player.ridingOffset.toArray();
    const steps = seconds => { for (let i = 0; i < seconds * 60; i++) world.update(1 / 60); };
    let blockedWhileMoving = false;
    let movingHint = '';
    for (let frame = 0; frame < 90 * 60; frame++) {
      world.update(1 / 60);
      if (world.service.speed > 2 && !blockedWhileMoving) {
        movingHint = player.interactionHint().text;
        blockedWhileMoving = !player.interact();
      }
      if (world.service.currentStop.id === 'station-2' && world.service.distance === 240 && world.service.state === 'boarding') break;
    }
    steps(2);
    const arrived = {
      distance: world.service.distance, speed: world.service.speed,
      sameCar: player.ridingCar === car,
      local: player.ridingOffset.toArray(),
      relativeZ: player.camera.position.z - world.train.position.z,
      expectedZ: startingLocal[2],
      exitEnabled: player.interactionHint().enabled,
    };
    const leftAtCentral = player.interact();
    return {
      blockedWhileMoving, movingHint, startingLocal, arrived, leftAtCentral,
      ridingAfterExit: Boolean(player.ridingCar), stationAfterExit: player.station.stationId,
      positionAfterExit: player.camera.position.toArray(),
      centralBounds: { ...world.stations[1].bounds }, centralZ: world.stations[1].position.z,
    };
  });
  expect(travel.blockedWhileMoving).toBe(true);
  expect(travel.movingHint).toContain('Next stop Central');
  expect(travel.arrived.distance).toBe(240);
  expect(travel.arrived.speed).toBe(0);
  expect(travel.arrived.sameCar).toBe(true);
  expect(travel.arrived.local).toEqual(travel.startingLocal);
  expect(travel.arrived.relativeZ).toBeCloseTo(travel.arrived.expectedZ, 6);
  expect(travel.arrived.exitEnabled).toBe(true);
  expect(travel.leftAtCentral).toBe(true);
  expect(travel.ridingAfterExit).toBe(false);
  expect(travel.stationAfterExit).toBe('station-2');
  expect(travel.positionAfterExit[0]).toBeLessThan(0);
  expect(travel.positionAfterExit[2] - travel.centralZ).toBeGreaterThan(travel.centralBounds.minZ);
  expect(travel.positionAfterExit[2] - travel.centralZ).toBeLessThan(travel.centralBounds.maxZ);
});

test('rider controls, collisions, reset, and resizing remain valid during a journey', async ({ page }) => {
  const state = await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    for (let i = 0; i < 120; i++) world.update(1 / 60);
    player.camera.position.set(-0.92, 1.76, world.train.cars[0].position.z);
    player.interact();
    player.yaw = -Math.PI / 2;
    player.keys.add('KeyW'); player.keys.add('ShiftLeft');
    for (let i = 0; i < 120; i++) world.update(1 / 60);
    player.keys.clear();
    const constrained = player.ridingOffset.toArray();
    // Reset exits the train to the original platform; route operation continues.
    const trainBeforeReset = world.train.position.toArray();
    player.reset();
    return {
      constrained, afterReset: player.camera.position.toArray(),
      riding: Boolean(player.ridingCar), station: player.station.stationId,
      trainBeforeReset, trainAfterReset: world.train.position.toArray(),
    };
  });
  expect(Math.abs(state.constrained[0])).toBeLessThan(1.2);
  expect(state.afterReset).toEqual([-6.6, 1.76, -31.5]);
  expect(state.riding).toBe(false);
  expect(state.station).toBe('station-1');
  expect(state.trainAfterReset).toEqual(state.trainBeforeReset);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.metro.world.camera.aspect === 390 / 844);
  await expect(page.locator('#error')).toBeHidden();
  expect(await page.locator('#scene canvas').evaluate(canvas => canvas.clientWidth)).toBe(390);
});
