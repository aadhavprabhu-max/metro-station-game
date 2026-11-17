import { test, expect } from '@playwright/test';

// Driving the GT3 R on the street: genuine keyboard input, deterministic world updates (as in downtown.spec.js).
let page;
const errors = [];
const url = process.env.METRO_SURFACE_URL || process.env.METRO_PRODUCTION_URL || 'http://127.0.0.1:5173/app.html';

/** Hold keys for a number of 1/60 s world updates; returns telemetry and contact-patch accuracy. */
async function hold(keys, frames) {
  for (const k of keys) await page.keyboard.down(k);
  const r = await page.evaluate(frames => {
    const { world, vehicle } = metro, car = vehicle.physics, g = vehicle.ground; let worstContact = 0, minContacts = 4, maxYJump = 0, lastY = car.position.y;
    for (let i = 0; i < frames; i++) {
      world.update(1 / 60);
      let contacts = 0;
      for (const w of car.wheels) if (w.contact) { contacts++; const ground = g.heightAt(w.contactPoint.x, w.contactPoint.z); if (ground !== null) worstContact = Math.max(worstContact, Math.abs(w.hubWorld.y - w.radius - ground) - Math.max(0, (1 - w.normal.y) * w.radius)); }
      minContacts = Math.min(minContacts, contacts); maxYJump = Math.max(maxYJump, Math.abs(car.position.y - lastY)); lastY = car.position.y;
    }
    const t = car.telemetry();
    return { speedKmh: t.speedKmh, gear: t.gear, x: car.position.x, z: car.position.z, y: car.position.y, yaw: Math.atan2(car.axes.z.x, car.axes.z.z), worstContact, minContacts, maxYJump, collisions: car.collisions, finite: Number.isFinite(car.position.x + car.position.z + car.velocity.length()) };
  }, frames);
  for (const k of keys) await page.keyboard.up(k);
  return r;
}
const place = (x, z, yaw) => page.evaluate(async ({ x, z, yaw }) => { const v = metro.vehicle; if (metro.player.driving) v.exit({ silent: true });
  v.parked = { x, z, yaw }; v.placeParked(); v.physics.collisions = 0; await v.enter(); metro.world.update(1 / 60); return metro.player.driving; }, { x, z, yaw });

test.describe('Driving the GT3 R', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${url}?line=U4&station=station-2`, { timeout: 180000 });
    await page.waitForFunction(() => metro?.ready, undefined, { timeout: 180000 });
    await page.evaluate(() => metro.world.renderer.setAnimationLoop(null));
  });
  test.afterEach(() => expect(errors).toEqual([]));
  test.afterAll(async () => { await page?.close(); });

  test('the Drive button appears on the street, loads the car and hands over the camera', async () => {
    test.setTimeout(240000);
    await page.locator('#oldtown-button').click();
    await page.evaluate(() => metro.world.update(1 / 60));
    const button = page.locator('#drive-button');
    await expect(button).toBeVisible();
    await button.click();
    await page.waitForFunction(() => metro.player.driving, undefined, { timeout: 180000 });
    const s = await page.evaluate(() => { metro.world.update(1 / 60); metro.world.renderer.render(metro.world.scene, metro.world.camera);
      const v = metro.vehicle, cam = metro.player.camera.position, car = v.physics.position;
      return { surface: metro.player.surfaceExploring, paused: metro.world.surfaceSimulation.paused, visible: v.model.visible, cameraDistance: cam.distanceTo(car), cameraAbove: cam.y - car.y,
        pivots: v.model.wheelRigs.map(r => r.knuckle.position.toArray().map(n => +n.toFixed(3))), drawCalls: v.model.drawCalls }; });
    expect(s.surface).toBe(true); expect(s.paused).toBe(true); expect(s.visible).toBe(true);
    expect(s.cameraDistance).toBeGreaterThan(3); expect(s.cameraDistance).toBeLessThan(9); expect(s.cameraAbove).toBeGreaterThan(0.5);
    // Rebuilt hub pivots sit at the measured tyre centres (not at the car origin).
    for (const [x, y, z] of s.pivots) { expect(Math.abs(x)).toBeGreaterThan(0.75); expect(Math.abs(z)).toBeGreaterThan(1.1); expect(y).toBeGreaterThan(0.3); }
    expect(s.drawCalls.after).toBeLessThan(s.drawCalls.before);
    await expect(page.locator('.drive-hud')).toBeVisible();
  });

  test('standing start along Via del Corso: straight, all four tyres on the road', async () => {
    test.setTimeout(240000);
    expect(await place(-66, -118, Math.PI / 2)).toBe(true); // eastbound lane (right-hand traffic)
    const r = await hold(['w'], 240);
    expect(r.finite).toBe(true);
    expect(r.speedKmh, JSON.stringify(r)).toBeGreaterThan(60);
    expect(Math.abs(r.z + 118), JSON.stringify(r)).toBeLessThan(1.0);
    expect(r.minContacts).toBe(4);
    expect(r.worstContact, JSON.stringify(r)).toBeLessThan(0.01);
    expect(r.maxYJump).toBeLessThan(0.02);
  });

  test('holding S brakes to a stop first, and only then engages reverse', async () => {
    test.setTimeout(240000);
    await page.keyboard.down('s');
    const r = await page.evaluate(() => { const { world, vehicle } = metro, car = vehicle.physics, start = car.forwardSpeed * 3.6; let stoppedAt = null, reverseAt = null, minSpeed = Infinity;
      for (let i = 0; i < 360; i++) { world.update(1 / 60); const v = car.forwardSpeed; if (stoppedAt === null && Math.abs(v) < 0.3) stoppedAt = i; if (reverseAt === null && car.gear === -1) reverseAt = i; if (reverseAt === null) minSpeed = Math.min(minSpeed, Math.abs(v)); }
      return { start, stoppedAt, reverseAt, minSpeedBeforeReverse: minSpeed, end: car.forwardSpeed * 3.6, gear: car.gear }; });
    await page.keyboard.up('s');
    expect(r.start, JSON.stringify(r)).toBeGreaterThan(40);
    expect(r.stoppedAt, JSON.stringify(r)).not.toBeNull();
    expect(r.reverseAt - r.stoppedAt, JSON.stringify(r)).toBeGreaterThanOrEqual(15);
    expect(r.gear).toBe(-1); expect(r.end).toBeLessThan(-2);
  });

  test('turning at a junction: Broadway North into East Avenue', async () => {
    test.setTimeout(240000);
    // Eastbound on Broadway North: accelerate, coast to the junction, turn left round the rounded corner, drive on.
    expect(await place(150, -427, Math.PI / 2)).toBe(true);
    const a = await hold(['w'], 75), b = await hold([], 300), turn = await hold(['a'], 110), out = await hold(['w'], 90);
    const heading = Math.atan2(Math.sin(out.yaw - Math.PI / 2), Math.cos(out.yaw - Math.PI / 2));
    const detail = JSON.stringify({ a, b, turn, out });
    expect(Math.abs(heading), detail).toBeGreaterThan(1.0);
    expect(out.collisions, detail).toBe(0);
    expect(Math.min(a.minContacts, b.minContacts, turn.minContacts, out.minContacts), detail).toBe(4);
    expect(out.x, detail).toBeGreaterThan(190); expect(out.x, detail).toBeLessThan(210); expect(out.z, detail).toBeLessThan(-436);
  });

  test('crossing the West Avenue road bridge keeps contact with the deck', async () => {
    test.setTimeout(240000);
    expect(await place(-227, -300, Math.PI)).toBe(true);
    const r = await hold(['w'], 300);
    expect(r.z, JSON.stringify(r)).toBeLessThan(-345);
    expect(r.minContacts).toBe(4);
    expect(r.worstContact).toBeLessThan(0.01);
    expect(Math.abs(r.x + 227)).toBeLessThan(1.5);
  });

  test('bollards close the old town: the car stops at Central Avenue, pedestrians pass between them', async () => {
    test.setTimeout(240000);
    expect(await place(-19.2, -390, 0)).toBe(true);
    const r = await hold(['w'], 360);
    const nose = await page.evaluate(() => { const c = metro.vehicle.physics; return c.position.z + (c.hull.cz + c.hull.hz); });
    expect(r.collisions).toBeGreaterThan(0);
    expect(nose, JSON.stringify(r)).toBeLessThan(-351.2);
    const walk = await page.evaluate(() => { const s = metro.world.surfaceWorld; return [-16.2, -17.7, -14.7].map(x => Boolean(s.findSurface(x, -351.5, s.streetY, 0.45, 0.24))); });
    expect(walk).toEqual([true, true, true]);
  });

  test('driving into a building stops the car without passing through the facade', async () => {
    test.setTimeout(240000);
    // East along Midtown Street, then into the facade line south of it.
    expect(await place(150, -497, Math.PI / 2)).toBe(true);
    await page.evaluate(() => { const c = metro.vehicle.physics; c.reset({ x: 150, z: -497, yaw: Math.PI }); });
    const r = await hold(['w'], 300);
    const inside = await page.evaluate(() => { const v = metro.vehicle, c = v.physics; let hit = false; v.ground.forEachCollider(c.position.x - 0.1, c.position.z - 0.1, c.position.x + 0.1, c.position.z + 0.1, () => { hit = true; }); return hit; });
    expect(r.collisions).toBeGreaterThan(0); expect(inside).toBe(false); expect(r.finite).toBe(true);
  });

  test('F leaves the car beside it; walking, T and the camera work as before', async () => {
    test.setTimeout(240000);
    expect(await place(-66, -117.05, Math.PI / 2)).toBe(true);
    await page.keyboard.press('f');
    const s = await page.evaluate(() => { metro.world.update(1 / 60); const p = metro.player; return { driving: p.driving, surface: p.surfaceExploring, eye: p.camera.position.y - metro.world.surfaceWorld.floorAt(p.camera.position.x, p.camera.position.z), rotationOrder: p.camera.rotation.order }; });
    expect(s).toEqual({ driving: false, surface: true, eye: expect.any(Number), rotationOrder: 'YXZ' });
    expect(Math.abs(s.eye - 1.76)).toBeLessThan(0.01);
    await page.keyboard.down('w'); await page.evaluate(() => { for (let i = 0; i < 30; i++) metro.world.update(1 / 60); }); await page.keyboard.up('w');
    expect(await page.evaluate(() => metro.player.distanceTravelled)).toBeGreaterThan(1);
    await page.keyboard.press('t');
    await page.evaluate(() => metro.world.update(1 / 60));
    expect(await page.evaluate(() => metro.player.surfaceExploring)).toBe(false);
  });
});
