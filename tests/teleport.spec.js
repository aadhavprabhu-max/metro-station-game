import { test, expect } from '@playwright/test';
import { openMenu, closeMenu, startLine, hudSettled } from './hud.js';

const url = process.env.METRO_SURFACE_URL || process.env.METRO_PRODUCTION_URL || 'http://127.0.0.1:5173/app.html';

async function open(page, query = '?line=U4&station=station-2') {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${url}${query}`, { timeout: 180000 });
  await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 180000 });
  // Deterministic stepping: ordinary world updates, no free-running animation loop.
  await page.evaluate(() => metro.world.renderer.setAnimationLoop(null));
  await step(page);
  return errors;
}
const step = (page, n = 2) => page.evaluate(n => { const w = metro.world; for (let i = 0; i < n; i++) w.update(1 / 60); w.renderer.render(w.scene, w.camera); }, n);
const state = page => page.evaluate(() => {
  const { world: w, player: p } = metro, k = w.lighting.keyLight, h = w.scene.children.find(o => o.isHemisphereLight);
  return {
    position: p.camera.position.toArray().map(v => +v.toFixed(3)), surface: p.surfaceExploring, paused: w.surfaceSimulation.paused,
    riding: Boolean(p.ridingCar), station: `${p.station.lineId}:${p.station.stationId}`, far: w.camera.far, active: w.surfaceWorld.active,
    light: { color: k.color.getHex(), intensity: k.intensity, exposure: w.renderer.toneMappingExposure, hemi: h.color.getHex(), hemiIntensity: h.intensity },
    label: document.querySelector('#oldtown-button')?.textContent.trim(),
  };
});
const ARRIVAL = [-16.2, 11.76, -214];

test.describe('one-click old town button', () => {
  test('click goes up to Central square, freezes trains, and clicks back to the Central U4 platform', async ({ page }) => {
    test.setTimeout(240000);
    const errors = await open(page);
    const before = await state(page);
    expect(before).toMatchObject({ surface: false, paused: false, station: 'U4:station-2', far: 180, label: '↑ Old town' });
    await expect(page.locator('#oldtown-button')).toHaveAttribute('aria-label', 'Go to the old town');

    await page.locator('#oldtown-button').click(); await step(page);
    const up = await state(page);
    expect(up).toMatchObject({ position: ARRIVAL, surface: true, paused: true, active: true, far: 1100, label: '↓ Back to U4' });
    await expect(page.locator('.surface-status')).toBeVisible();
    await expect(page.locator('#oldtown-button')).toHaveAttribute('aria-label', 'Back to U4');
    // Every service is frozen while on the street.
    const frozen = await page.evaluate(() => {
      const snap = () => JSON.stringify(metro.world.services.map(s => s.snapshot()));
      const a = snap(); for (let i = 0; i < 120; i++) metro.world.update(1 / 60); return a === snap();
    });
    expect(frozen).toBe(true);

    const distances = await page.evaluate(() => metro.world.services.map(s => s.distance));
    await page.locator('#oldtown-button').click(); await step(page, 1);
    const down = await state(page);
    expect(down).toMatchObject({ surface: false, paused: false, active: false, station: 'U4:station-2', far: 180, label: '↑ Old town' });
    expect(down.light).toEqual(before.light);
    await expect(page.locator('.surface-status')).toBeHidden();
    await expect(page.locator('#gh-service-pill')).toBeVisible();
    // Services resume from where they froze, with no jump.
    const after = await page.evaluate(() => metro.world.services.map(s => s.distance));
    after.forEach((d, i) => expect(Math.abs(d - distances[i])).toBeLessThan(0.5));
    expect(errors).toEqual([]);
  });

  test('works from another line, while riding, and with the T key (but not while typing)', async ({ page }) => {
    test.setTimeout(240000);
    const errors = await open(page, '?line=U1');
    await startLine(page, 'U1'); await step(page);
    expect((await state(page)).station.startsWith('U1:')).toBe(true);
    await page.locator('#oldtown-button').click(); await step(page);
    expect(await state(page)).toMatchObject({ position: ARRIVAL, surface: true, paused: true });
    await page.locator('#oldtown-button').click(); await step(page);
    expect(await state(page)).toMatchObject({ surface: false, station: 'U4:station-2' });

    // Riding a train: the ride is cleared and the player arrives on the street.
    await page.evaluate(() => { const p = metro.player, s = p.service; p.ridingCar = s.train.cars[0]; p.ridingOffset.set(0, 1.85, s.train.cars[0].position.z); });
    expect((await state(page)).riding).toBe(true);
    await page.locator('#oldtown-button').click(); await step(page);
    expect(await state(page)).toMatchObject({ riding: false, surface: true, position: ARRIVAL });

    await page.keyboard.press('t'); await step(page);
    expect(await state(page)).toMatchObject({ surface: false, station: 'U4:station-2' });
    await page.keyboard.press('t'); await step(page);
    expect(await state(page)).toMatchObject({ surface: true, position: ARRIVAL });

    // Typing a "t" in the map search must not teleport.
    await openMenu(page); await page.evaluate(() => metroHud.setDetent(2)); await hudSettled(page);
    await page.locator('#gm-search').fill(''); await page.locator('#gm-search').type('t'); await step(page);
    expect((await state(page)).surface).toBe(true);
    await page.locator('#gm-search').fill(''); await page.evaluate(() => metroHud.setDetent(0)); await hudSettled(page);
    await closeMenu(page);
    expect(errors).toEqual([]);
  });

  test('phone: tap works, the pill never overlaps the clock, menu or touch pad, and hides under the open menu', async ({ browser }) => {
    test.setTimeout(240000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = await open(page);
    const box = s => page.locator(s).boundingBox();
    const [button, clock, menu, pad] = await Promise.all(['#oldtown-button', '#gh-clock', '#gh-menu-button', '#touch-controls'].map(box));
    const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const other of [clock, menu, pad]) expect(overlap(button, other)).toBe(false);
    expect(button.height).toBeGreaterThanOrEqual(40);
    expect(button.x + button.width).toBeLessThanOrEqual(390);

    await page.locator('#oldtown-button').tap(); await step(page);
    expect(await state(page)).toMatchObject({ surface: true, position: ARRIVAL });
    await page.locator('#gh-menu-button').tap(); await hudSettled(page);
    await expect(page.locator('#oldtown-button')).toHaveCSS('opacity', '0');
    await expect(page.locator('#oldtown-button')).toHaveCSS('pointer-events', 'none');
    await page.locator('#gh-menu-button').tap(); await hudSettled(page);
    await page.locator('#oldtown-button').tap(); await step(page);
    expect(await state(page)).toMatchObject({ surface: false, station: 'U4:station-2' });
    expect(errors).toEqual([]);
    await context.close();
  });

  test('the legacy HUD has the same working button', async ({ page }) => {
    test.setTimeout(240000);
    const errors = await open(page, '?line=U4&station=station-2&ui=legacy');
    await expect(page.locator('.top-actions #oldtown-button')).toBeVisible();
    await page.locator('#oldtown-button').click(); await step(page);
    expect(await state(page)).toMatchObject({ surface: true, position: ARRIVAL, label: '↓ Back to U4' });
    await page.locator('#oldtown-button').click(); await step(page);
    expect(await state(page)).toMatchObject({ surface: false, station: 'U4:station-2' });
    expect(errors).toEqual([]);
  });
});
