import { test, expect } from '@playwright/test';

// Island HUD (top centre): read-only view of the followed service that swaps with the
// bottom glass pill. The software renderer used in CI draws about one frame per second,
// which would stretch every spring morph to tens of seconds, so these tests skip the
// WebGL draw call. The simulation and the UI still run every frame.
const errorsByPage = new WeakMap();
async function load(page, query = '?line=U1') {
  const errors = errorsByPage.get(page) ?? [];
  if (!errorsByPage.has(page)) {
    errorsByPage.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  }
  await page.goto(`/app.html${query}`, { timeout: 120000 });
  await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 120000 });
  await page.evaluate(() => { const r = metro.world.renderer; r.render = () => {}; });
}
test.afterEach(async ({ page }) => expect(errorsByPage.get(page) ?? []).toEqual([]));
const island = page => page.evaluate(() => ({ state: AurealisIsland.state, hidden: AurealisIsland.hidden, door: AurealisIsland.doorMode, menu: metroHud.isOpen }));
const pillGone = page => page.evaluate(() => document.querySelector('#gh-service-pill').classList.contains('gh-pill-gone'));

test('the island shows live data, swaps with the glass pill and remembers the choice', async ({ page }) => {
  await load(page);
  await expect(page.locator('#island')).toBeVisible();
  expect(await island(page)).toMatchObject({ hidden: false, state: 'split', door: 'open' }); // boarding at the platform
  expect(await pillGone(page)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#pill')).backgroundColor)).toBe('rgb(0, 0, 0)');
  const data = await page.evaluate(() => AurealisIsland.data);
  const live = await page.evaluate(() => { const s = metro.player.service ?? metro.world.service; return { line: s.lineId, next: s.nextStop.name, dest: s.destinationStop.name }; });
  expect(data).toMatchObject({ line: live.line, next: live.next, dest: live.dest, delayMin: 0 });
  await page.keyboard.press('KeyI');
  await expect.poll(() => island(page)).toMatchObject({ hidden: true });
  expect(await pillGone(page)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('aurealis-island-hidden'))).toBe('1');
  await load(page);
  expect(await island(page)).toMatchObject({ hidden: true });
  expect(await pillGone(page)).toBe(false);
  await page.keyboard.press('KeyI');
  await expect.poll(() => island(page)).toMatchObject({ hidden: false });
  expect(await pillGone(page)).toBe(true);
});

test('keyboard: O taps and holds, Esc closes the island before the glass menu', async ({ page }) => {
  await load(page);
  await page.keyboard.press('KeyO');
  await expect.poll(() => island(page)).toMatchObject({ state: 'expanded' });
  await page.keyboard.press('Escape');
  await expect.poll(() => island(page)).toMatchObject({ state: 'split' });
  // Esc order with the real menu: the island first, then the menu.
  await page.click('#gh-menu-button');
  await page.keyboard.press('KeyO');
  await expect.poll(() => island(page)).toMatchObject({ state: 'expanded', menu: true });
  await page.keyboard.press('Escape');
  await expect.poll(() => island(page)).toMatchObject({ state: 'split', menu: true });
  await page.keyboard.press('Escape');
  await expect.poll(() => island(page)).toMatchObject({ state: 'split', menu: false });
  // Hold → quick actions with the first action focused; Enter / Space activate them.
  await page.keyboard.down('KeyO'); await page.waitForTimeout(700); await page.keyboard.up('KeyO');
  await expect.poll(() => island(page)).toMatchObject({ state: 'actions' });
  expect(await page.evaluate(() => document.activeElement?.dataset?.act)).toBe('doors');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => AurealisIsland.state === 'alert' && document.querySelector('#alT').textContent)).toBe('Doors');
  await page.keyboard.press('Escape');
  await expect.poll(() => island(page)).toMatchObject({ state: 'split' });
  // Typing in the map search never reaches the island.
  await page.click('#gh-menu-button');
  await page.fill('#gm-search', 'oi');
  expect(await island(page)).toMatchObject({ hidden: false, state: 'split' });
});

test('the train on the island track only moves forward within a leg, and the arrival alert fires', async ({ page }) => {
  test.setTimeout(240000);
  await load(page);
  await page.evaluate(() => {
    window.__islandSamples = []; window.__islandStates = [];
    const prev = AurealisIsland.onState; AurealisIsland.onState = s => { window.__islandStates.push(s); prev?.(s); };
    setInterval(() => { const d = AurealisIsland.data; window.__islandSamples.push({ key: `${d.prev}>${d.next}`, p: d.progress, left: parseFloat(document.querySelector('#trainDot').style.left) }); }, 100);
  });
  await page.waitForFunction(() => (metro.player.service ?? metro.world.service).state === 'travelling', undefined, { timeout: 120000 });
  await expect.poll(() => island(page)).toMatchObject({ state: 'compact', door: null });
  await page.waitForFunction(() => AurealisIsland.doorMode === 'open', undefined, { timeout: 150000 });
  const result = await page.evaluate(() => {
    const s = window.__islandSamples;
    return { n: s.length, back: s.filter((x, i) => i && x.key === s[i - 1].key && (x.p < s[i - 1].p || x.left < s[i - 1].left)).length, alert: window.__islandStates.includes('alert'), last: s.at(-1) };
  });
  expect(result.n).toBeGreaterThan(100);
  expect(result.back).toBe(0);
  expect(result.alert).toBe(true);
  expect(result.last.p).toBe(1);
});

test('the legacy HUD has no island', async ({ page }) => {
  await load(page, '?ui=legacy');
  await expect(page.locator('#island')).toHaveCount(0);
});
