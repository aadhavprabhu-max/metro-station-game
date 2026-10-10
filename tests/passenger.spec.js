import { test, expect } from '@playwright/test';

const lines = {
  U1: ['Nordplatz', 'Central', 'Rosenheimer Platz'],
  U2: ['Stadtzentrum', 'Central', 'Schwarzkopf-Tunnel', 'Eisenwerk'],
  U3: ['Schattenufer', 'Central', 'Ostbahnhof', 'Stadtbrücke'],
  U4: ['Kaiser-Humboldt-Platz', 'Westbahnhof', 'Central', 'Arabellapark'],
};
const errorsByPage = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.passengerInformation?.length === 4);
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
});

test.afterEach(async ({ page }) => { expect(errorsByPage.get(page)).toEqual([]); });

test('all twelve carriages have real formed seats, grab rails, clear vestibules and source-derived passenger screens', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { world } = window.metro;
    const textureColors = texture => {
      const canvas = texture.image, pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 64) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
      return colors.size;
    };
    return world.passengerInformation.map((info, index) => {
      const train = world.trains[index], displays = world.passengerDisplays[index], data = info.snapshot;
      const cars = train.cars.map(car => {
        const seats = car.getObjectByName('FormedBluePassengerSeats');
        const rails = car.getObjectByName('StainlessPassengerGrabArches');
        const handles = car.getObjectByName('PassengerGrabHandles');
        const normals = seats?.geometry.getAttribute('normal'), directions = new Set();
        for (let vertex = 0; vertex < (normals?.count ?? 0); vertex++) directions.add(`${Math.round(normals.getX(vertex) * 10)},${Math.round(normals.getY(vertex) * 10)},${Math.round(normals.getZ(vertex) * 10)}`);
        const colliders = car.interiorColliders;
        // The usable cross-aisle path and the legacy centre aisle are sampled
        // independently of the controller's collision helper.
        const blocked = (x, z) => colliders.some(rect => x > rect.minX - 0.24 && x < rect.maxX + 0.24 && z > rect.minZ - 0.24 && z < rect.maxZ + 0.24);
        const doorBlocked = car.doorways.filter(door => door.side === train.platformSide).some(door => {
          for (let x = -1.08; x <= 1.08; x += 0.12) if (blocked(x, door.localZ)) return true;
          return false;
        });
        let aisleBlocked = false;
        const end = car.cabs.length ? 6.2 : 7.05;
        for (let z = -end; z <= end; z += 0.1) if (blocked(0.3, z)) aisleBlocked = true;
        return {
          layout: car.userData.interiorLayout,
          seats: seats?.count, seatVertices: seats?.geometry.getAttribute('position').count,
          seatDepth: seats?.geometry.boundingBox?.max.z - seats?.geometry.boundingBox?.min.z,
          normalDirections: directions.size, seatGeometry: seats?.geometry.uuid,
          seatTexture: Boolean(seats?.material.map), seatRoughness: seats?.material.roughness,
          rails: rails?.count, handles: handles?.count,
          authoritativeColliders: colliders.length, kinds: [...new Set(colliders.map(rect => rect.kind))],
          screens: car.passengerDisplays.length, maps: car.passengerMaps.length,
          screensShared: car.passengerDisplays.every(mesh => mesh.material.map === displays.textures.nextStop),
          mapsShared: car.passengerMaps.every(mesh => mesh.material.map === displays.textures.routeMap),
          actualMeshes: [...car.passengerDisplays, ...car.passengerMaps].every(mesh => mesh.parent && mesh.isMesh && mesh.material.map.image.width === 1024),
          doorBlocked, aisleBlocked,
        };
      });
      return { line: train.lineId, route: data.orderedStops.map(stop => stop.name),
        originalRoute: info.service.route.stops.map(stop => stop.name),
        destination: data.terminus.name, next: data.nextStation.name,
        maps: displays.snapshot(), screenColors: textureColors(displays.textures.nextStop), mapColors: textureColors(displays.textures.routeMap),
        conflicts: data.routeConflicts, cars };
    });
  });
  expect(result.map(item => item.line)).toEqual(Object.keys(lines));
  const seatGeometries = new Set();
  for (const item of result) {
    expect(item.route).toEqual(lines[item.line]);
    expect(item.route).toEqual(item.originalRoute);
    expect(item.destination).toBe(lines[item.line].at(-1));
    expect(item.next).toBe(lines[item.line][1]);
    expect(item.maps.route.map(stop => stop.name)).toEqual(item.route);
    expect(item.screenColors).toBeGreaterThan(8); expect(item.mapColors).toBeGreaterThan(8);
    expect(item.conflicts).toEqual([]);
    expect(item.cars.map(car => car.seats)).toEqual([14, 16, 14]);
    for (const car of item.cars) {
      seatGeometries.add(car.seatGeometry);
      expect(car.layout.actual3D).toBe(true);
      expect(car.seatVertices).toBeGreaterThan(100);
      expect(car.seatDepth).toBeGreaterThan(0.7);
      expect(car.normalDirections).toBeGreaterThan(15);
      expect(car.seatTexture).toBe(true); expect(car.seatRoughness).toBeGreaterThan(0.8);
      expect(car.rails).toBeGreaterThanOrEqual(4); expect(car.handles).toBeGreaterThanOrEqual(8);
      expect(car.kinds).toEqual(expect.arrayContaining(['longitudinal-seat', 'transverse-seat', 'grab-pole']));
      expect(car.authoritativeColliders).toBe(car.layout.colliderCount);
      expect(car.screens).toBe(4); expect(car.maps).toBe(4);
      expect(car.screensShared && car.mapsShared && car.actualMeshes).toBe(true);
      expect(car.doorBlocked || car.aisleBlocked).toBe(false);
      expect(car.layout.floorY).toBeCloseTo(0.095, 8);
    }
  }
  expect(seatGeometries.size).toBe(1);
});

test('live passenger events and route maps follow every exact stop in both directions without repeated frame announcements', async ({ page }) => {
  test.setTimeout(180000);
  const result = await page.evaluate(() => {
    const { world } = window.metro;
    const failures = [], stops = [], events = [], counts = world.services.map(() => 0);
    const check = (condition, text) => { if (!condition && failures.length < 16) failures.push(text); };
    const unsubscribes = world.passengerInformation.map(info => info.subscribe(event => {
      events.push({ id: event.id, type: event.type, line: event.lineId, station: event.station.id,
        next: event.nextStation.id, from: event.leg.from.id, to: event.leg.to.id,
        distance: event.distance, stationDistance: event.station.distance, speed: event.speed,
        direction: event.direction, arrivalDirection: event.arrivalDirection,
        doorSide: event.doorSide, arrivalDoorSide: event.arrivalDoorSide,
        transfers: event.interchanges.map(transfer => transfer.lineId),
        text: world.announcer.textFor(event), stationName: event.station.name,
        nextName: event.nextStation.name, terminal: event.terminus.name });
    }));
    for (let frame = 0; frame < 900 * 60; frame++) {
      world.update(1 / 60);
      world.passengerInformation.forEach((info, index) => {
        const data = info.snapshot, service = info.service, route = service.route.stops, displays = world.passengerDisplays[index];
        const current = route.indexOf(service.currentStop), next = route.indexOf(service.nextStop);
        check(data.currentStation.id === service.currentStop.id && data.nextStation.id === service.nextStop.id && data.terminus.id === service.destinationStop.id, `${data.lineId} screen departed from service data.`);
        check(data.orderedStops.every((stop, stopIndex) => stop.id === route[stopIndex].id && stop.name === route[stopIndex].name), `${data.lineId} map invented or reordered stations.`);
        const remaining = [];
        for (let stopIndex = next; stopIndex >= 0 && stopIndex < route.length; stopIndex += data.direction) remaining.push(route[stopIndex].id);
        check(JSON.stringify(data.remainingStops.map(stop => stop.id)) === JSON.stringify(remaining), `${data.lineId} remaining stops use the wrong direction.`);
        check(data.followingStation?.id === route[next + data.direction]?.id, `${data.lineId} following station is incorrect.`);
        for (let stopIndex = 0; stopIndex < route.length; stopIndex++) {
          const expected = stopIndex === next ? 'next' : stopIndex === current ? data.atStation ? 'current' : 'passed' : (stopIndex - current) * data.direction < 0 ? 'passed' : 'upcoming';
          check(data.orderedStops[stopIndex].status === expected, `${data.lineId} map marker has wrong status.`);
        }
        check(displays.data.currentStation.id === data.currentStation.id && displays.data.terminus.id === data.terminus.id && displays.data.direction === data.direction, `${data.lineId} real textures are stale.`);
        check([...displays.screens, ...displays.maps].every(mesh => mesh.userData.nextStation === data.nextStation.id && mesh.userData.destination === data.terminus.id), `${data.lineId} mounted screens are stale.`);
        if (service.speed > 0) check(data.doorState === 'closed' && !data.canBoard, `${data.lineId} screen claims boarding while moving.`);
        if (service.completedLegs > counts[index] && service.canBoard && data.doorState === 'open') {
          counts[index] = service.completedLegs;
          stops.push({ line: data.lineId, id: data.currentStation.id, names: data.orderedStops.map(stop => stop.name),
            direction: data.direction, destination: data.terminus.name,
            currentStatus: data.orderedStops[current].status, next: data.nextStation.name,
            transfers: data.currentStation.interchanges, floorY: data.floorY, platform: data.platformNumber,
            arrivalDoorSide: data.arrivalDoorSide, platformSide: data.platformSide, arrivalDirection: data.arrivalDirection,
            screenDoorSides: displays.screens.map(mesh => mesh.userData.doorSide) });
        }
      });
      if (counts.every((count, index) => count >= (index === 0 ? 4 : 6))) break;
    }
    const before = events.length;
    for (let frame = 0; frame < 30; frame++) world.passengerInformation.forEach(info => info.update(0));
    unsubscribes.forEach(unsubscribe => unsubscribe());
    return { failures, stops, events, noFrameDuplicates: before === events.length, counts,
      physicalPlatforms: world.stations.map(station => station.platformId),
      redraws: world.passengerDisplays.map(displays => displays.redraws), glError: world.renderer.getContext().getError() };
  });
  expect(result.failures).toEqual([]);
  expect(result.noFrameDuplicates).toBe(true);
  expect(new Set(result.events.map(event => event.id)).size).toBe(result.events.length);
  const sequences = {
    U1: ['station-2', 'station-3', 'station-2', 'station-1'],
    U2: ['station-2', 'u2-schwarzkopf', 'u2-eisenwerk', 'u2-schwarzkopf', 'station-2', 'u2-stadtzentrum'],
    U3: ['station-2', 'u3-ostbahnhof', 'u3-stadtbruecke', 'u3-ostbahnhof', 'station-2', 'u3-schattenufer'],
    U4: ['u4-westbahnhof', 'station-2', 'u4-arabellapark', 'station-2', 'u4-westbahnhof', 'u4-kaiser-humboldt'],
  };
  for (const [line, ids] of Object.entries(sequences)) {
    const stops = result.stops.filter(stop => stop.line === line).slice(0, ids.length);
    expect(stops.map(stop => stop.id)).toEqual(ids);
    expect(result.events.filter(event => event.line === line && event.type === 'arrival').slice(0, ids.length).map(event => event.station)).toEqual(ids);
    expect(result.events.filter(event => event.line === line && event.type === 'approaching').slice(0, ids.length).map(event => event.station)).toEqual(ids);
    for (const stop of stops) {
      expect(stop.names).toEqual(lines[line]);
      expect(stop.currentStatus).toBe('current');
      expect(stop.destination).toBe(stop.direction === 1 ? lines[line].at(-1) : lines[line][0]);
      const arrivalSide = stop.platformSide * stop.arrivalDirection < 0 ? 'left' : 'right';
      expect(stop.arrivalDoorSide).toBe(arrivalSide);
      expect(stop.screenDoorSides.every(side => side === arrivalSide)).toBe(true);
      if (stop.id === 'station-2') {
        expect(stop.transfers.map(transfer => transfer.lineId).sort()).toEqual(Object.keys(lines).filter(other => other !== line));
        for (const transfer of stop.transfers) {
          const lower = ['U3', 'U4'].includes(transfer.lineId);
          expect(transfer.floorY).toBe(lower ? -12 : 0);
          expect(transfer.platformNumber).toBe(`0${Number(transfer.lineId.slice(1))}`);
          expect(transfer.connection).toBe(transfer.floorY === stop.floorY ? 'passage' : 'stairs');
          expect(transfer.implemented).toBe(true);
          expect(transfer.path.length).toBeGreaterThan(0);
          expect(transfer.path.every(step => result.physicalPlatforms.includes(step.fromPlatformId) && result.physicalPlatforms.includes(step.toPlatformId))).toBe(true);
          if (transfer.connection === 'stairs') expect(transfer.path.some(step => step.type === 'stairs')).toBe(true);
        }
      } else expect(stop.transfers).toEqual([]);
    }
  }
  for (const event of result.events) {
    if (event.type === 'arrival' || event.type === 'terminus') {
      expect(event.speed).toBe(0); expect(event.distance).toBe(event.stationDistance);
      expect(event.station).toBe(event.to);
    }
    if (event.type === 'approaching') { expect(event.speed).toBeGreaterThan(0); expect(event.station).toBe(event.to); expect(event.text).toContain(`approaching ${event.stationName}`); }
    if (event.type === 'departure') { expect(event.speed).toBeGreaterThan(0); expect(event.station).toBe(event.from); expect(event.text).toContain(`Next station: ${event.nextName}`); }
    if (event.type === 'doors-opening') expect(event.text).toContain(`on the ${event.arrivalDoorSide}`);
    if (event.type === 'terminus') expect(event.text).toContain(`returns toward ${event.terminal}`);
  }
  for (const line of Object.keys(lines)) {
    const arrivals = result.events.filter(event => event.line === line && event.type === 'arrival');
    const termini = result.events.filter(event => event.line === line && event.type === 'terminus');
    expect(termini.slice(0, 2).map(event => event.station)).toEqual([sequences[line][line === 'U1' ? 1 : 2], sequences[line].at(-1)]);
    expect(termini.every(event => arrivals.some(arrival => arrival.to === event.to && arrival.distance === event.distance))).toBe(true);
  }
  expect(result.redraws.every(count => count < 300)).toBe(true);
  expect(result.glError).toBe(0);
});

test('real keyboard boarding uses authoritative furniture collisions, preserves the central aisle and permits platform exit', async ({ page }) => {
  for (const line of Object.keys(lines)) {
    const setup = await page.evaluate(line => {
      const { world, player } = window.metro;
      player.startAt(line);
      const train = player.service.train, car = train.cars[1];
      player.camera.position.set(train.platformSide * 2.697, 1.76, car.position.z);
      train.localToWorld(player.camera.position);
      return { car: car.carNumber, platform: player.station.platformId };
    }, line);
    await page.keyboard.press('e');
    expect(await page.evaluate(() => Boolean(window.metro.player.ridingCar))).toBe(true);
    const furniture = await page.evaluate(() => {
      const { player } = window.metro;
      const car = player.ridingCar;
      const seat = car.interiorColliders.find(rect => rect.kind === 'longitudinal-seat' && rect.minX > 0);
      player.ridingOffset.set(0.3, 1.85, car.position.z + (seat.minZ + seat.maxZ) / 2);
      player.yaw = -Math.PI / 2; player.applyLook(); player.syncRide();
      return { sameArray: player.interiorObstacles === car.interiorColliders, seat: { ...seat }, start: player.ridingOffset.toArray(), car: car.carNumber };
    });
    expect(furniture.sameArray).toBe(true); expect(furniture.car).toBe(setup.car);
    await page.keyboard.down('w');
    const collision = await page.evaluate(() => {
      const { player } = window.metro;
      for (let frame = 0; frame < 120; frame++) player.update(1 / 60);
      return player.ridingOffset.toArray();
    });
    await page.keyboard.up('w');
    expect(collision[0]).toBeGreaterThanOrEqual(furniture.start[0]);
    expect(collision[0]).toBeLessThanOrEqual(furniture.seat.minX - 0.24 + 1e-6);
    await page.evaluate(() => {
      const { player } = window.metro;
      // Start from a legal aisle point; subsequent motion is the real keyboard
      // controller. The middle carriage must keep its established end reach.
      player.ridingOffset.set(0.3, 1.85, player.ridingCar.position.z);
      player.yaw = Math.PI; player.applyLook(); player.syncRide();
    });
    await page.keyboard.down('ArrowUp');
    const aisle = await page.evaluate(() => {
      const { player } = window.metro;
      for (let frame = 0; frame < 180; frame++) player.update(1 / 60);
      return { z: player.ridingOffset.z - player.ridingCar.position.z, x: player.ridingOffset.x,
        riderError: player.service.train.worldToLocal(player.camera.position.clone()).distanceTo(player.ridingOffset) };
    });
    await page.keyboard.up('ArrowUp');
    expect(aisle.z).toBeCloseTo(7.05, 6); expect(aisle.x).toBeCloseTo(0.3, 6); expect(aisle.riderError).toBeLessThan(1e-7);
    await page.keyboard.press('e');
    const exit = await page.evaluate(() => {
      const { player } = window.metro;
      return { riding: Boolean(player.ridingCar), platform: player.station.platformId,
        position: player.station.worldToLocal(player.camera.position.clone()).toArray(), hint: player.interactionHint() };
    });
    expect(exit.riding).toBe(false); expect(exit.platform).toBe(setup.platform);
    expect(exit.position[1]).toBeCloseTo(1.76, 6); expect(exit.hint.enabled).toBe(true);
  }
});

test('sound is opt-in and unavailable speech remains honest while captions deduplicate and clear on alighting', async ({ page }) => {
  // Model a supported browser with no installed native voices. This tests the
  // genuine fallback path without substituting a pretend successful speaker.
  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speaking: false,
    speak() { throw new Error('Speech must not be attempted without an available voice.'); },
  } }));
  await page.reload();
  await page.waitForFunction(() => window.metro?.ready && window.metro.world.announcer);
  await page.evaluate(() => {
    const { world, player } = window.metro;
    world.renderer.setAnimationLoop(null);
    const train = player.service.train, car = train.cars[1];
    player.camera.position.set(-2.697, 1.76, car.position.z);
    train.localToWorld(player.camera.position);
  });
  const before = await page.evaluate(() => ({ status: window.metro.world.announcer.getStatus(), audioCreated: Boolean(window.metro.world.announcer.audio) }));
  expect(before.status.enabled).toBe(false); expect(before.status.voiceAvailable).toBe(false); expect(before.audioCreated).toBe(false);
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('e');
  const boarded = await page.evaluate(() => {
    // RAF is paused for this test. Advance ordinary simulation frames so the
    // HUD's 8 Hz refresh can display the controller's genuine boarding caption.
    for (let frame = 0; frame < 9; frame++) window.metro.world.update(1 / 60);
    return { riding: Boolean(window.metro.player.ridingCar), caption: window.metro.world.announcer.getStatus().caption };
  });
  expect(boarded.riding).toBe(true);
  expect(boarded.caption).toContain('Next station: Central');
  await expect(page.locator('#announcement-text')).toContainText('Next station: Central');
  await page.locator('#sound-button').click();
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sound-status')).toContainText('voice unavailable', { ignoreCase: true });
  const historyBeforeLook = await page.evaluate(() => window.metro.world.announcer.getStatus().history.length);
  await page.mouse.move(250, 300); await page.mouse.down(); await page.mouse.move(285, 315); await page.mouse.up();
  await page.evaluate(() => { for (let frame = 0; frame < 20; frame++) window.metro.world.update(0); });
  expect(await page.evaluate(() => window.metro.world.announcer.getStatus().history.length)).toBe(historyBeforeLook);
  const result = await page.evaluate(() => {
    const { world, player } = window.metro;
    const info = world.passengerInformation[0], announcer = world.announcer;
    for (let frame = 0; frame < 150 * 60; frame++) {
      world.update(1 / 60);
      if (world.service.currentStop.id === 'station-2' && world.service.canBoard && info.snapshot.doorState === 'open') break;
    }
    const arrival = info.events.find(event => event.type === 'arrival');
    const beforeDuplicate = announcer.history.length;
    announcer.onEvent(info, arrival); announcer.onEvent(info, arrival);
    const status = announcer.getStatus();
    return { status, duplicateIgnored: announcer.history.length === beforeDuplicate,
      arrival: { station: arrival.station.id, distance: arrival.distance, speed: arrival.speed },
      currentStation: info.snapshot.currentStation.id,
      text: announcer.textFor(arrival), captionText: document.querySelector('#announcement-text').textContent };
  });
  expect(result.duplicateIgnored).toBe(true);
  expect(result.arrival).toEqual({ station: 'station-2', distance: 240, speed: 0 });
  expect(result.currentStation).toBe('station-2');
  expect(result.text).toContain('Central');
  expect(result.text).toContain('U2'); expect(result.text).toContain('U3'); expect(result.text).toContain('U4');
  expect(result.text).toContain('upper level'); expect(result.text).toContain('lower level');
  expect(result.status.voiceAvailable).toBe(false); expect(result.status.speaking).toBe(false);
  expect(result.status.history.every(item => item.spoken === false && item.lineId === 'U1')).toBe(true);
  expect(new Set(result.status.history.map(item => item.id)).size).toBe(result.status.history.length);
  expect(result.status.queued).toBeLessThanOrEqual(3);
  const approach = result.status.history.find(item => item.type === 'approaching');
  expect(approach.text).toContain('approaching Central'); expect(approach.stationId).toBe('station-2');
  await page.keyboard.press('e');
  await page.evaluate(() => {
    for (let frame = 0; frame < 9; frame++) window.metro.world.update(1 / 60);
  });
  const alighted = await page.evaluate(() => window.metro.world.announcer.getStatus());
  expect(alighted.activeLineId).toBe(null); expect(alighted.caption).toBe(''); expect(alighted.queued).toBe(0); expect(alighted.speaking).toBe(false);
  await expect(page.locator('#announcement-caption')).toBeHidden();
  await page.locator('#sound-button').click();
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
});
