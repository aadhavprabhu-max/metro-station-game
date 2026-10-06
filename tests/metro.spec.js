import { test, expect } from '@playwright/test';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.metro?.ready);
});

test('renders the train, station, and readable board at the exact spawn without runtime errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Include a fresh reload so initialization errors are caught by the listeners.
  await page.reload();
  await page.waitForFunction(() => window.metro?.ready && window.metro.frames >= 3);
  await expect(page.locator('#error')).toBeHidden();
  const result = await page.evaluate(async () => {
    const { probeSpawn } = await import('/tests/scene-probe.js');
    const { world } = window.metro;
    return {
      ...window.metro.snapshot(),
      ...probeSpawn(world),
      glError: world.renderer.getContext().getError(),
    };
  });
  expect(result.ready).toBe(true);
  expect(result.carCount).toBe(3);
  expect(result.departures).toHaveLength(5);
  expect(result.trainVisible).toEqual([true, true, true]);
  expect(result.boardVisible).toBe(true);
  expect(result.glError).toBe(0);
  expect(result.drawCalls).toBeLessThan(650);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/spawn.png' });
});

test('real keyboard events move the camera in the running game', async ({ page }) => {
  const start = await page.evaluate(() => window.metro.snapshot().position);
  await page.keyboard.down('w');
  await page.waitForFunction(([x, z]) => Math.hypot(window.metro.player.camera.position.x - x, window.metro.player.camera.position.z - z) > 0.3, [start[0], start[2]]);
  await page.keyboard.up('w');
  const end = await page.evaluate(() => window.metro.snapshot().position);
  expect(distance(start, end)).toBeGreaterThan(0.3);
  expect(end[1]).toBe(1.76);
});

test('WASD, arrows, diagonal normalization, sprint, and delta time are consistent', async ({ page }) => {
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  const run = async (keys, steps = 60, delta = 1 / 60) => {
    await page.evaluate(() => { window.metro.player.reset(); window.metro.player.yaw = 0; });
    const start = await page.evaluate(() => window.metro.snapshot().position);
    for (const key of keys) await page.keyboard.down(key);
    await page.evaluate(({ steps, delta }) => { for (let i = 0; i < steps; i++) window.metro.player.update(delta); }, { steps, delta });
    for (const key of keys) await page.keyboard.up(key);
    const end = await page.evaluate(() => window.metro.snapshot().position);
    return { length: distance(start, end), dx: end[0] - start[0], dz: end[2] - start[2] };
  };
  expect((await run(['w'])).length).toBeCloseTo(4.5, 5);
  expect((await run(['ArrowUp'])).dz).toBeCloseTo(-4.5, 5);
  expect((await run(['s'])).dz).toBeCloseTo(4.5, 5);
  expect((await run(['ArrowDown'])).dz).toBeCloseTo(4.5, 5);
  expect((await run(['a'], 15)).dx).toBeCloseTo(-1.125, 5);
  expect((await run(['ArrowLeft'], 15)).dx).toBeCloseTo(-1.125, 5);
  expect((await run(['d'])).dx).toBeCloseTo(4.5, 5);
  expect((await run(['ArrowRight'])).dx).toBeCloseTo(4.5, 5);
  expect((await run(['w', 'd'])).length).toBeCloseTo(4.5, 5);
  expect((await run(['w', 'Shift'])).length).toBeCloseTo(7, 5);
  expect((await run(['w'], 30, 1 / 30)).length).toBeCloseTo(4.5, 5);
});

test('mouse drag looks right and down naturally, clamps pitch, and releases', async ({ page }) => {
  const start = await page.evaluate(() => window.metro.snapshot());
  await page.mouse.move(500, 340);
  await page.mouse.down();
  await page.mouse.move(600, 440, { steps: 5 });
  const moved = await page.evaluate(() => window.metro.snapshot());
  expect(moved.yaw).toBeLessThan(start.yaw);
  expect(moved.pitch).toBeLessThan(start.pitch);
  expect(moved.dragging).toBe(true);
  await page.mouse.up();
  await page.mouse.move(650, 460);
  const released = await page.evaluate(() => window.metro.snapshot());
  expect(released.dragging).toBe(false);
  expect(released.pitch).toBe(moved.pitch);
  expect(released.yaw).toBe(moved.yaw);
  await page.mouse.move(500, 350);
  await page.mouse.down();
  await page.mouse.move(500, -1500);
  expect((await page.evaluate(() => window.metro.snapshot())).pitch).toBeCloseTo(1.35);
  await page.mouse.up();
  // Explicit pointer cancellation covers touch and browser interruption paths.
  await page.mouse.move(500, 350);
  await page.mouse.down();
  const cancelled = await page.evaluate(() => {
    const canvas = window.metro.player.element;
    canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.metro.player.drag.id }));
    return window.metro.snapshot().dragging;
  });
  expect(cancelled).toBe(false);
  await page.mouse.up();
});

test('walls, track boundary, columns, and benches prevent penetration at sprint speed', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { player, world } = window.metro;
    world.renderer.setAnimationLoop(null);
    const run = (position, yaw, seconds = 8) => {
      player.reset(); player.camera.position.set(...position); player.yaw = yaw;
      player.keys.add('KeyW'); player.keys.add('ShiftLeft');
      for (let i = 0; i < seconds * 60; i++) player.update(1 / 60);
      player.keys.clear();
      return player.camera.position.toArray();
    };
    return {
      edge: run([-3, 1.76, -25], -Math.PI / 2),
      wall: run([-6, 1.76, -25], Math.PI / 2),
      north: run([-4, 1.76, -35], 0),
      south: run([-4, 1.76, 35], Math.PI),
      column: run([-6, 1.76, 0], Math.PI / 2, 2),
      bench: run([-5, 1.76, 3], Math.PI / 2, 2),
    };
  });
  expect(results.edge[0]).toBeCloseTo(-0.92, 5);
  expect(results.wall[0]).toBeCloseTo(-9.41, 5);
  expect(results.north[2]).toBeCloseTo(-42.46, 5);
  expect(results.south[2]).toBeCloseTo(42.46, 5);
  expect(results.column[0]).toBeGreaterThanOrEqual(-7.725);
  expect(results.bench[0]).toBeGreaterThanOrEqual(-6.545);
});

test('reset, focus loss, help, and reload leave controls in a clean state', async ({ page }) => {
  const spawn = await page.evaluate(() => window.metro.snapshot());
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.metro.player.distanceTravelled > 0.2);
  await page.keyboard.up('w');
  await page.getByRole('button', { name: 'Reset view' }).click();
  expect((await page.evaluate(() => window.metro.snapshot())).position).toEqual(spawn.position);
  await page.getByRole('button', { name: 'Show controls' }).click();
  await expect(page.locator('#help-panel')).toBeVisible();
  expect(await page.evaluate(() => window.metro.player.enabled)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-panel')).toBeHidden();
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.metro.player.keys.size)).toBe(0);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('r');
  expect((await page.evaluate(() => window.metro.snapshot())).position).toEqual(spawn.position);
  await page.reload();
  await page.waitForFunction(() => window.metro?.ready);
  expect((await page.evaluate(() => window.metro.snapshot())).position).toEqual(spawn.position);
  await expect(page.locator('#station-clock')).toHaveText('14:32');
});

test('departures and separate platform-side door leaves can be updated', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { train, station } = window.metro.world;
    // Phase 2 starts with platform doors open, so establish the closed baseline.
    window.metro.world.renderer.setAnimationLoop(null);
    train.closeDoors();
    for (let i = 0; i < 120; i++) train.update(1 / 60);
    const leaf = train.cars[0].doors[0];
    const closedZ = leaf.position.z;
    train.openDoors();
    for (let i = 0; i < 120; i++) train.update(1 / 60);
    const openZ = leaf.position.z;
    train.closeDoors();
    for (let i = 0; i < 120; i++) train.update(1 / 60);
    station.departures.setDepartures([{ route: 'U1', destination: 'Museum', minutes: 4, platform: '01', color: '#c8784d' }]);
    return { leaves: train.cars.map(car => car.doors.length), closedZ, openZ, restoredZ: leaf.position.z, destination: station.departures.departures[0].destination };
  });
  expect(result.leaves).toEqual([12, 12, 12]);
  expect(Math.abs(result.openZ - result.closedZ)).toBeGreaterThan(0.8);
  expect(result.restoredZ).toBeCloseTo(result.closedZ, 3);
  expect(result.destination).toBe('Museum');
});

test('touch movement and responsive canvas work at a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.waitForFunction(() => window.metro.world.camera.aspect === 390 / 844);
  await expect(page.locator('#touch-controls')).toBeVisible();
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  const before = await page.evaluate(() => window.metro.snapshot().position);
  const button = await page.locator('[data-move="ArrowUp"]').boundingBox();
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }] });
  const result = await page.evaluate(() => {
    const { player, world } = window.metro;
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    return { after: player.camera.position.toArray(), aspect: world.camera.aspect, canvasWidth: world.renderer.domElement.clientWidth };
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(distance(before, result.after)).toBeCloseTo(2.25, 5);
  expect(await page.evaluate(() => window.metro.player.keys.size)).toBe(0);
  expect(result.aspect).toBeCloseTo(390 / 844, 5);
  expect(result.canvasWidth).toBe(390);
});
