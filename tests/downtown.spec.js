import { test, expect } from '@playwright/test';

// Downtown and Aurealis Square: genuine keyboard and mouse input, deterministic world updates.
let page;
const errors = [];
const url = process.env.METRO_SURFACE_URL || process.env.METRO_PRODUCTION_URL || 'http://127.0.0.1:5173/app.html';

async function face(point) {
  const angle = await page.evaluate(p => {
    const player = metro.player, target = Math.atan2(-(p.x - player.camera.position.x), -(p.z - player.camera.position.z));
    return Math.atan2(Math.sin(target - player.yaw), Math.cos(target - player.yaw));
  }, point);
  const gestures = Math.max(1, Math.ceil(Math.abs(angle) / 0.6));
  for (let i = 0; i < gestures; i++) { await page.mouse.move(360, 230); await page.mouse.down(); await page.mouse.move(360 - angle / gestures / 0.0028, 230); await page.mouse.up(); }
}
/** Hold W (optionally Shift) until the target is reached; report the largest per-frame height change. */
async function walk(point, sprint = false, limit = 6000) {
  await face(point);
  if (sprint) await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  const result = await page.evaluate(({ p, limit }) => {
    const { player, world } = metro; let steps = 0, maxJump = 0;
    while (Math.hypot(player.camera.position.x - p.x, player.camera.position.z - p.z) > 0.13 && steps < limit) {
      const y = player.camera.position.y; world.update(1 / 60); steps++; maxJump = Math.max(maxJump, Math.abs(player.camera.position.y - y));
    }
    return { steps, maxJump, position: player.camera.position.toArray(), distance: Math.hypot(player.camera.position.x - p.x, player.camera.position.z - p.z) };
  }, { p: point, limit });
  await page.keyboard.up('w'); if (sprint) await page.keyboard.up('Shift');
  return result;
}
const status = () => page.locator('.surface-status strong').textContent();

test.describe('Downtown and Aurealis Square', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240000);
    page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${url}?line=U4&station=station-2`, { timeout: 180000 });
    await page.waitForFunction(() => metro?.ready, undefined, { timeout: 180000 });
    await page.evaluate(() => metro.world.renderer.setAnimationLoop(null));
  });
  test.afterEach(() => expect(errors).toEqual([]));
  test.afterAll(async () => { await page?.close(); });

  test('one click up, then walk from Central square over the canal into Aurealis Square', async () => {
    test.setTimeout(240000);
    await page.locator('#oldtown-button').click();
    await page.evaluate(() => { for (let i = 0; i < 400 && !metro.world.surfaceWorld.downtownReady; i++) metro.world.update(1 / 60); });
    expect(await page.evaluate(() => metro.world.surfaceWorld.downtownReady)).toBe(true);
    for (const point of [{ x: -16.2, z: -234 }, { x: -16.2, z: -320 }, { x: -16.2, z: -400 }]) {
      const r = await walk(point, true); expect(r.distance, JSON.stringify(r)).toBeLessThan(0.14); expect(r.maxJump).toBeLessThan(0.09);
    }
    await page.evaluate(() => metro.world.update(1 / 60));
    expect(await status()).toBe('Central · Downtown');
    const r = await walk({ x: -16.2, z: -470 }, true);
    expect(r.distance, JSON.stringify(r)).toBeLessThan(0.14);
    expect(await status()).toBe('Central · Aurealis Square');
    expect(await page.evaluate(() => ({ surface: metro.player.surfaceExploring, paused: metro.world.surfaceSimulation.paused }))).toEqual({ surface: true, paused: true });
  });

  test('towers are solid: walking into one stops at its facade', async () => {
    test.setTimeout(240000);
    expect((await walk({ x: -16.2, z: -400 }, true)).distance).toBeLessThan(0.14);
    await face({ x: 20, z: -400 }); await page.keyboard.down('w');
    const x = await page.evaluate(() => { for (let i = 0; i < 400; i++) metro.world.update(1 / 60); return metro.player.camera.position.x; });
    await page.keyboard.up('w');
    expect(x).toBeLessThan(-5.2);
    expect(x).toBeGreaterThan(-6.5);
  });

  test('the upper-town terrace: up the stair from Lemon square, along it and down into downtown', async () => {
    test.setTimeout(240000);
    await page.evaluate(() => { const p = metro.player; p.camera.position.set(-9, 11.76, -74); p.transferSurface = null; p.syncSurfaceContext(); metro.world.update(0); });
    let jump = 0;
    for (const point of [{ x: -9, z: -52 }, { x: -16.2, z: -52 }, { x: -16.2, z: -40 }]) { const r = await walk(point); expect(r.distance, JSON.stringify(r)).toBeLessThan(0.14); jump = Math.max(jump, r.maxJump); }
    expect(await page.evaluate(() => metro.player.camera.position.y)).toBeCloseTo(14.16, 5);
    expect(await status()).toBe('Central · Old town');
    const down = await walk({ x: -16.2, z: -18 });
    expect(down.distance, JSON.stringify(down)).toBeLessThan(0.14);
    jump = Math.max(jump, down.maxJump);
    expect(await page.evaluate(() => metro.player.camera.position.y)).toBeCloseTo(11.76, 5);
    expect(jump, 'no step is taller than the 0.45 m step limit').toBeLessThan(0.46);
    expect(await status()).toBe('Central · Downtown');
  });

  test('draw-call budgets on the street, and the underground is unchanged', async () => {
    const calls = await page.evaluate(() => {
      const { world: w, player: p } = metro, out = {};
      const measure = () => { w.renderer.shadowMap.needsUpdate = true; w.renderer.render(w.scene, w.camera); return w.renderer.info.render.calls; };
      for (const [name, x, z, yaw] of [['centralSquare', -16.2, -240, Math.PI * 0.92], ['aurealisSquare', -16.2, -437, 0], ['downtownAvenue', -16.2, -362, 0]]) {
        p.camera.position.set(x, 11.76, z); p.transferSurface = null; p.yaw = yaw; p.pitch = 0.1; p.applyLook(); w.update(0); w.update(0); out[name] = measure();
      }
      p.startAt('U4', 'station-2'); w.update(0); out.platform = measure();
      return out;
    });
    expect(calls.centralSquare, JSON.stringify(calls)).toBeLessThan(560);
    expect(calls.aurealisSquare, JSON.stringify(calls)).toBeLessThan(520);
    expect(calls.downtownAvenue, JSON.stringify(calls)).toBeLessThan(560);
    expect(calls.platform, JSON.stringify(calls)).toBeLessThanOrEqual(178);
  });

  test('the teleport button still works from downtown', async () => {
    await page.evaluate(() => { const p = metro.player; p.camera.position.set(-16.2, 11.76, -470); p.transferSurface = null; p.syncSurfaceContext(); metro.world.update(0); });
    await page.locator('#oldtown-button').click(); await page.evaluate(() => metro.world.update(1 / 60));
    expect(await page.evaluate(() => ({ surface: metro.player.surfaceExploring, station: metro.player.station.stationId, paused: metro.world.surfaceSimulation.paused })))
      .toEqual({ surface: false, station: 'station-2', paused: false });
    await page.locator('#oldtown-button').click(); await page.evaluate(() => metro.world.update(1 / 60));
    expect(await page.evaluate(() => metro.player.camera.position.toArray().map(v => +v.toFixed(2)))).toEqual([-16.2, 11.76, -214]);
  });
});
