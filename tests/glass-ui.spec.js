import { test, expect } from '@playwright/test';
import { openMenu, closeMenu, hudSettled } from './hud.js';

// Liquid Glass HUD and interactive network map. The map is drawing-only and
// reads the live game network; the HUD calls the existing UI handlers.
const errorsByPage = new WeakMap();
async function load(page, query = '') {
  const errors = errorsByPage.get(page) ?? [];
  if (!errorsByPage.has(page)) {
    errorsByPage.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  }
  await page.goto(`/app.html${query}`, { timeout: 120000 });
  await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 120000 });
}
test.afterEach(async ({ page }) => expect(errorsByPage.get(page) ?? []).toEqual([]));

/** Opens the menu and moves the map drawer to a detent (0 collapsed, 1 half, 2 full). */
async function openMap(page, detent = 1) {
  await openMenu(page);
  await page.evaluate(index => metroHud.setDetent(index), detent);
  await hudSettled(page);
}
/** Element-relative screen point of a map station, in page coordinates. */
async function stationPoint(page, stationId) {
  return page.evaluate(id => {
    const map = metroHud.map, st = map.model.stations.get(id), p = map.camera.project(st.x, st.y), r = map.el.view.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, local: p };
  }, stationId);
}
/** Pointer events with real timing, so release velocity is measured as for a person. */
async function dragMap(page, from, to, steps = 6, interval = 16) {
  await page.evaluate(async ({ from, to, steps, interval }) => {
    const view = metroHud.map.el.view, r = view.getBoundingClientRect();
    const fire = (type, x, y) => view.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x, clientY: r.top + y, bubbles: true }));
    fire('pointerdown', from.x, from.y);
    for (let i = 1; i <= steps; i++) { await new Promise(done => setTimeout(done, interval)); fire('pointermove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); }
    fire('pointerup', to.x, to.y);
  }, { from, to, steps, interval });
}

test('the Liquid Glass HUD is the default and the original HUD remains available with ?ui=legacy', async ({ page }) => {
  await load(page);
  await expect(page.locator('#glass-hud')).toBeVisible();
  expect(await page.evaluate(() => [document.documentElement.className, document.documentElement.dataset.theme])).toEqual(['ui-glass', 'dark']);
  for (const selector of ['.topbar', '.location-card', '.service-card', '.bottom-bar']) await expect(page.locator(selector)).toBeHidden();
  await expect(page.getByText('YOU ARE HERE')).toBeHidden();
  await expect(page.locator('#gh-service-pill')).toBeVisible();
  await expect(page.locator('#gh-panel')).toBeHidden();
  const layout = await page.evaluate(() => {
    const box = s => document.querySelector(s).getBoundingClientRect().toJSON();
    const pill = getComputedStyle(document.querySelector('#gh-service-pill'));
    return { button: box('#gh-menu-button'), clock: box('#gh-clock'), pill: box('#gh-service-pill'),
      glass: { background: pill.backgroundColor, blur: pill.backdropFilter, border: pill.borderTopColor, width: pill.borderTopWidth } };
  });
  expect([layout.button.width, layout.button.height]).toEqual([44, 44]);
  expect(960 - (layout.button.x + layout.button.width)).toBeLessThanOrEqual(24);
  expect(layout.button.y).toBeLessThan(40);
  expect(layout.clock.x + layout.clock.width).toBeLessThanOrEqual(layout.button.x);
  expect(Math.abs(layout.clock.y + layout.clock.height / 2 - (layout.button.y + layout.button.height / 2))).toBeLessThan(3);
  expect(Math.abs(layout.pill.x + layout.pill.width / 2 - 480)).toBeLessThan(2);
  expect(600 - (layout.pill.y + layout.pill.height)).toBeLessThan(40);
  expect(layout.glass).toEqual({ background: 'rgba(10, 14, 18, 0.16)', blur: 'blur(22px)', border: 'rgba(255, 255, 255, 0.16)', width: '1px' });

  await load(page, '?ui=legacy');
  await expect(page.locator('#glass-hud')).toHaveCount(0);
  expect(await page.evaluate(() => [document.documentElement.className, document.documentElement.dataset.theme ?? null])).toEqual(['ui-legacy', null]);
  for (const selector of ['.topbar', '.location-card', '.service-card', '.bottom-bar']) await expect(page.locator(selector)).toBeVisible();
  await page.getByRole('button', { name: 'Show controls' }).click();
  await expect(page.locator('#help-panel')).toBeVisible();
  expect(await page.evaluate(() => metro.player.enabled)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-panel')).toBeHidden();
  expect(await page.evaluate(() => metro.player.enabled)).toBe(true);
});

test('the menu opens and closes by button and Escape, manages focus and never intercepts gameplay when closed', async ({ page }) => {
  await load(page);
  const button = page.locator('#gh-menu-button');
  // Closed: the panel area belongs to the 3D view, and drag-to-look works there.
  expect(await page.evaluate(() => document.elementFromPoint(780, 300)?.tagName)).toBe('CANVAS');
  const yaw = await page.evaluate(() => metro.player.yaw);
  await page.mouse.move(780, 300); await page.mouse.down(); await page.mouse.move(840, 300, { steps: 3 }); await page.mouse.up();
  expect(await page.evaluate(() => metro.player.yaw)).toBeLessThan(yaw);

  await button.click();
  await expect(page.locator('#gh-panel')).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toHaveAttribute('aria-label', 'Close menu');
  expect(await page.evaluate(() => document.querySelector('#gh-panel').contains(document.activeElement))).toBe(true);
  const sim = await page.evaluate(() => metro.world.services.map(s => s.stateTime));
  const frames = await page.evaluate(() => metro.frames);
  await page.waitForFunction(f => metro.frames > f + 2, frames, { timeout: 60000 });
  const later = await page.evaluate(() => metro.world.services.map(s => s.stateTime));
  expect(later.some((t, i) => t !== sim[i]), 'the railway keeps running while the menu is open').toBe(true);
  await button.click();
  await expect(page.locator('#gh-panel')).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await button.click(); await expect(page.locator('#gh-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#gh-panel')).toBeHidden();
  await expect(button).toBeFocused();
  await page.locator('#scene canvas').focus();
  await page.keyboard.down('w');
  await page.waitForFunction(() => metro.player.distanceTravelled > 0.2);
  await page.keyboard.up('w');
});

test('dark is the default theme; light mode switches tokens, persists and keeps the glass treatment', async ({ page }) => {
  await load(page);
  const tokens = () => page.evaluate(() => {
    const css = getComputedStyle(document.documentElement), panel = getComputedStyle(document.querySelector('#gh-service-pill'));
    return { theme: document.documentElement.dataset.theme, glass: css.getPropertyValue('--gh-glass').trim(), ink: css.getPropertyValue('--gh-ink').trim(),
      blur: panel.backdropFilter, cas: metroHud.map.theme.cas, text: getComputedStyle(document.querySelector('#gh-next-stop')).color };
  });
  const dark = await tokens();
  expect(dark).toMatchObject({ theme: 'dark', glass: 'rgba(10, 14, 18, .16)', ink: '#ffffff', blur: 'blur(22px)', cas: '#000', text: 'rgb(255, 255, 255)' });
  await openMenu(page);
  await page.locator('#gh-theme-button').click();
  const light = await tokens();
  expect(light).toMatchObject({ theme: 'light', ink: '#0d1114', blur: 'blur(22px)', cas: '#fff', text: 'rgb(13, 17, 20)' });
  expect(await page.evaluate(() => localStorage.getItem('aurealis-theme'))).toBe('light');
  await load(page);
  expect((await tokens()).theme).toBe('light');
  await load(page, '?theme=dark');
  expect((await tokens()).theme).toBe('dark');
  await page.evaluate(() => localStorage.removeItem('aurealis-theme'));
});

test('map drawer: grabber taps and drags move between collapsed, half-height and full-height detents', async ({ page }) => {
  await load(page);
  await openMenu(page);
  const state = () => page.evaluate(() => ({ index: metroHud.sheet.index, h: metroHud.sheet.h, detents: metroHud.sheet.detents,
    bodyInert: metroHud.drawerBody.inert, upperInert: metroHud.upper.inert, view: metroHud.map.visibleHeight, height: metroHud.drawer.offsetHeight }));
  let s = await state();
  expect(s).toMatchObject({ index: 0, h: 78, bodyInert: true, view: 0 });
  expect(Math.round(s.height)).toBe(78);
  await page.locator('#gm-grab').click(); await hudSettled(page);
  s = await state();
  expect(s.index).toBe(1); expect(s.h).toBe(s.detents[1]); expect(s.bodyInert).toBe(false); expect(s.view).toBeGreaterThan(120);
  expect(s.detents[1]).toBeGreaterThan(78); expect(s.detents[2]).toBeGreaterThan(s.detents[1]);
  await expect(page.locator('#gm-grab')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#gm-grab').click(); await hudSettled(page);
  s = await state();
  expect(s.index).toBe(2); expect(s.h).toBe(s.detents[2]); expect(s.upperInert).toBe(true);
  // A real drag upward collapses the drawer (release projected to the nearest detent).
  const grab = await page.locator('#gm-grab').boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2); await page.mouse.down();
  await page.mouse.move(grab.x + grab.width / 2, grab.y - 400, { steps: 8 }); await page.mouse.up();
  await hudSettled(page);
  s = await state();
  expect(s.index).toBe(0); expect(s.h).toBe(78);
  // Keyboard on the grabber changes detent without walking.
  const position = await page.evaluate(() => metro.player.camera.position.toArray());
  await page.locator('#gm-grab').focus();
  await page.keyboard.press('ArrowDown'); await hudSettled(page);
  expect((await state()).index).toBe(1);
  await page.keyboard.press('ArrowUp'); await hudSettled(page);
  expect((await state()).index).toBe(0);
  expect(await page.evaluate(() => metro.player.camera.position.toArray())).toEqual(position);
});

test('map physics: cursor-centred wheel zoom, momentum, rubber-band settling, double-click and tool zoom', async ({ page }) => {
  await load(page);
  await openMap(page, 1);
  // Cursor-centred zoom: the map point under the cursor stays under the cursor.
  const cursor = await stationPoint(page, 'u3-ostbahnhof');
  const before = await page.evaluate(({ x, y }) => { const c = metroHud.map.camera; return { s: c.s, mx: (x - c.x) / c.s, my: (y - c.y) / c.s }; }, cursor.local);
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -300);
  await hudSettled(page);
  const after = await page.evaluate(({ mx, my }) => { const c = metroHud.map.camera; return { s: c.s, p: c.project(mx, my) }; }, before);
  expect(after.s).toBeGreaterThan(before.s * 1.3);
  expect(Math.hypot(after.p.x - cursor.local.x, after.p.y - cursor.local.y)).toBeLessThan(1.5);

  // Momentum: a fast drag keeps gliding after release, then settles inside bounds.
  await page.evaluate(() => { metroHud.map.camera.zoomAbout(130, 80, 2); metroHud.map.changed(); }); await hudSettled(page);
  const start = await page.evaluate(() => ({ x: metroHud.map.camera.x }));
  await dragMap(page, { x: 60, y: 80 }, { x: 180, y: 80 });
  const released = await page.evaluate(() => ({ x: metroHud.map.camera.x, fvx: metroHud.map.camera.fvx }));
  expect(released.x).toBeGreaterThan(start.x + 100);
  expect(released.fvx, 'release velocity starts a glide').toBeGreaterThan(160);
  await hudSettled(page);
  const glided = await page.evaluate(() => { const c = metroHud.map.camera, b = c.boundsFor(c.s); return { x: c.x, b }; });
  expect(glided.x).toBeGreaterThan(released.x);
  expect(glided.x).toBeLessThanOrEqual(glided.b.xmax + 0.5); expect(glided.x).toBeGreaterThanOrEqual(glided.b.xmin - 0.5);

  // Rubber band: dragging far past the edge is resisted, then springs back to the bound.
  const rubber = await page.evaluate(async () => {
    const map = metroHud.map, c = map.camera, view = map.el.view, r = view.getBoundingClientRect();
    const fire = (type, x) => view.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: r.left + x, clientY: r.top + 60, bubbles: true }));
    fire('pointerdown', 10);
    for (let x = 10; x <= 2010; x += 400) fire('pointermove', x);
    const during = c.x, limit = c.boundsFor(c.s).xmax, dimension = c.rubberDimension;
    await new Promise(done => setTimeout(done, 200)); fire('pointermove', 2010); fire('pointerup', 2010);
    return { during, limit, dimension };
  });
  expect(rubber.during).toBeGreaterThan(rubber.limit);
  expect(rubber.during - rubber.limit).toBeLessThan(rubber.dimension);
  await hudSettled(page);
  expect(Math.abs(await page.evaluate(() => metroHud.map.camera.x) - rubber.limit)).toBeLessThan(0.6);

  // Double-click zooms ×2 about the pointer; the + / − / fit tools use the same springs.
  await page.evaluate(() => { metroHud.map.camera.flyTo(metroHud.map.camera.fitAll()); metroHud.map.changed(); }); await hudSettled(page);
  const fitScale = await page.evaluate(() => metroHud.map.camera.s);
  const empty = await page.evaluate(() => {
    // An empty spot (no station within 40 px), so the double-click is a pure zoom.
    const map = metroHud.map, r = map.el.view.getBoundingClientRect(), points = [...map.model.stations.values()].map(s => map.camera.project(s.x, s.y));
    for (let y = 60; y < map.visibleHeight - 10; y += 8) for (let x = 10; x < map.width - 10; x += 8)
      if (points.every(p => Math.hypot(p.x - x, p.y - y) > 40)) return { x: r.left + x, y: r.top + y };
    return null;
  });
  expect(empty).not.toBe(null);
  await page.mouse.dblclick(empty.x, empty.y); await hudSettled(page);
  await expect(page.locator('.gm-card')).toBeHidden();
  expect(await page.evaluate(() => metroHud.map.camera.s) / fitScale).toBeGreaterThan(1.9);
  await page.getByRole('button', { name: 'Show the whole network' }).click(); await hudSettled(page);
  expect(Math.abs(await page.evaluate(() => metroHud.map.camera.s) - fitScale)).toBeLessThan(0.001);
  await page.getByRole('button', { name: 'Zoom in' }).click(); await hudSettled(page);
  expect(await page.evaluate(() => metroHud.map.camera.s) / fitScale).toBeGreaterThan(1.6);
  await page.getByRole('button', { name: 'Zoom out' }).click(); await hudSettled(page);
  expect(Math.abs(await page.evaluate(() => metroHud.map.camera.s) / fitScale - 1)).toBeLessThan(0.02);
});

test('map keyboard controls only work while the map has focus, and Escape steps back layer by layer', async ({ page }) => {
  await load(page);
  await openMap(page, 1);
  const camera = () => page.evaluate(() => ({ s: metroHud.map.camera.s, x: metroHud.map.camera.x, player: metro.player.camera.position.toArray(), keys: metro.player.keys.size }));
  const start = await camera();
  await page.locator('#gh-sound-button').focus();
  await page.keyboard.press('+'); await hudSettled(page);
  expect((await camera()).s).toBe(start.s);
  await page.locator('#gm-view').focus();
  await page.keyboard.press('+'); await hudSettled(page);
  const zoomed = await camera();
  expect(zoomed.s).toBeGreaterThan(start.s * 1.4);
  await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight'); await hudSettled(page);
  const panned = await camera();
  expect(panned.x).toBeLessThan(zoomed.x - 40);
  expect(panned.player).toEqual(start.player);
  expect(panned.keys).toBe(0);
  await page.evaluate(() => metroHud.map.selectStation('u4-westbahnhof')); await hudSettled(page);
  await page.locator('#gm-view').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gm-card')).toBeHidden();
  await expect(page.locator('#gh-panel')).toBeVisible();
  await page.keyboard.press('Escape'); await hudSettled(page);
  expect(await page.evaluate(() => metroHud.sheet.index)).toBe(0);
  await expect(page.locator('#gm-grab')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#gh-panel')).toBeHidden();
});

test('element-relative pointer maths: tapping a drawn station selects it, with ring, card and real transfers', async ({ page }) => {
  await load(page);
  await openMap(page, 2);
  await page.evaluate(() => { const c = metroHud.map.camera; c.zoomAbout(c.width / 2, c.visible().y1 / 2, 2.2); metroHud.map.changed(); }); await hudSettled(page);
  const point = await stationPoint(page, 'u6-ringplatz');
  await page.mouse.click(point.x, point.y); await hudSettled(page);
  await expect(page.locator('.gm-card h3')).toHaveText('Ringplatz');
  await expect(page.locator('.gm-card')).toContainText('U6 ↔ U10 · stairs and lifts');
  await expect(page.locator('.gm-ring')).not.toHaveAttribute('hidden');
  await expect(page.locator('.gm-ring .c')).toBeVisible();
  // The selected station sits in the visible map area above the card.
  const placed = await page.evaluate(() => {
    const map = metroHud.map, st = map.model.stations.get('u6-ringplatz'), p = map.camera.project(st.x, st.y), v = map.camera.visible();
    return { p, v };
  });
  expect(Math.abs(placed.p.x - (placed.v.x0 + placed.v.x1) / 2)).toBeLessThan(2);
  expect(Math.abs(placed.p.y - (placed.v.y0 + placed.v.y1) / 2)).toBeLessThan(2);
  // Line selection dims other lines, draws the line in and fits it to the visible area.
  await page.locator('#gm-lines [data-line="U9"]').click(); await hudSettled(page);
  await expect(page.locator('.gm-line-card')).toContainText('Central ↔ Waldtor');
  await expect(page.locator('#gm-lines [data-line="U9"]')).toHaveAttribute('aria-pressed', 'true');
  const fitted = await page.evaluate(() => {
    const map = metroHud.map, b = map.model.lines.get('U9').bbox, c = map.camera, v = c.visible();
    const a = c.project(b.x, b.y), z = c.project(b.x + b.w, b.y + b.h);
    return { a, z, v, dimmed: map.alphaFor(['U1']), own: map.alphaFor(['U9']) };
  });
  expect(fitted.a.x).toBeGreaterThanOrEqual(fitted.v.x0 - 1); expect(fitted.z.x).toBeLessThanOrEqual(fitted.v.x1 + 1);
  expect(fitted.a.y).toBeGreaterThanOrEqual(fitted.v.y0 - 1); expect(fitted.z.y).toBeLessThanOrEqual(fitted.v.y1 + 1);
  expect(fitted.dimmed).toBeCloseTo(0.13, 2); expect(fitted.own).toBe(1);
  // Search filters the game's stations.
  await page.locator('#gm-search').fill('brück');
  const names = await page.locator('.gm-results .nm').allTextContents();
  expect(names).toEqual(expect.arrayContaining(['Hohenbrück', 'Metropolbrücke', 'Stadtbrücke', 'Altstadtbrücke']));
  await page.keyboard.press('Enter'); await hudSettled(page);
  await expect(page.locator('.gm-card h3')).toHaveText(names[0]);
  // Tapping empty map clears the overlay.
  const empty = await page.locator('#gm-view').boundingBox();
  await page.mouse.click(empty.x + 6, empty.y + 6); await hudSettled(page);
  await expect(page.locator('.gm-card')).toBeHidden();
});

test('the map is drawn from the live game network, not from a second railway database', async ({ page }) => {
  await load(page);
  await openMap(page, 1);
  const data = await page.evaluate(() => {
    const { network } = metro.world, model = metroHud.model;
    const nodes = [...network.nodes.keys()].sort(), drawn = [...model.stations.keys()].sort();
    const names = [...model.stations.values()].every(s => s.name === network.nodes.get(s.id).name);
    const lines = [...network.lines.values()].map(l => ({ id: l.id, color: l.color, stops: l.nodeIds }));
    const mapLines = model.lineOrder.map(id => ({ id, color: model.lines.get(id).color, stops: model.lines.get(id).stops.map(s => s.id) }));
    const memberships = [...model.stations.values()].every(s => s.lines.every(id => network.lines.get(id).nodeIds.includes(s.id) || (id === 'U5' && network.phase6.branch.stations.some(b => b.id === s.id))));
    // Pixels: the canvas really shows the lines in their game colours.
    const canvas = map => map.canvas.getContext('2d').getImageData(0, 0, map.canvas.width, Math.round(map.visibleHeight * map.dpr)).data;
    const px = canvas(metroHud.map); let coloured = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200 && Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 60) coloured++;
    return { nodes, drawn, names, lines, mapLines, memberships, issues: model.issues, coloured, central: model.stations.get('station-2').levels.map(l => `${l.lines.join('/')} ${l.text}`) };
  });
  expect(data.drawn).toEqual(data.nodes);
  expect(data.names).toBe(true);
  expect(data.mapLines).toEqual(data.lines);
  expect(data.memberships).toBe(true);
  expect(data.issues).toEqual([]);
  expect(data.coloured).toBeGreaterThan(500);
  expect(data.central).toEqual(['U1/U2 0 m', 'U3/U4 −12 m', 'U9 −48 m', 'U10 −72 m']);
  expect(await page.evaluate(() => metro.world.network.nodes.size)).toBe(53);
});

const RIDES = [
  { name: 'U9 · Central', url: /\?line=U9$/, check: () => ({ line: metro.player.service.lineId, station: metro.player.station.stationId, variant: metro.world.routes.U5.variant ?? 'direct' }), expected: { line: 'U9', station: 'station-2', variant: 'direct' } },
  { name: 'U5 · River loop', url: /u5=scenic&tour=river&station=u5-altstadtbruecke$/, check: () => ({ line: metro.player.service.lineId, station: metro.player.station.stationId, variant: metro.world.routes.U5.variant ?? 'direct', stop: metro.world.services.find(s => s.lineId === 'U5').currentStop.id }), expected: { line: 'U5', station: 'u5-altstadtbruecke', variant: 'scenic', stop: 'u5-altstadtbruecke' } },
  { name: 'U5 · Original direct route', url: /\?line=U5&u5=direct$/, check: () => ({ line: metro.player.service.lineId, station: metro.player.station.stationId, variant: metro.world.routes.U5.variant ?? 'direct' }), expected: { line: 'U5', station: 'u4-westbahnhof', variant: 'direct' } },
];
for (const ride of RIDES) test(`ride button “${ride.name}” is genuinely clickable and starts the correct route`, async ({ page }) => {
  test.setTimeout(240000);
  await load(page);
  await openMenu(page);
  const link = page.getByRole('link', { name: ride.name, exact: true });
  await expect(link).toBeVisible();
  await link.scrollIntoViewIfNeeded();
  const hit = await link.evaluate(a => { const r = a.getBoundingClientRect(), el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { own: a.contains(el), pointer: getComputedStyle(a).pointerEvents }; });
  expect(hit).toEqual({ own: true, pointer: 'auto' });
  await link.click();
  await page.waitForURL(ride.url, { timeout: 120000 });
  await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 120000 });
  expect(await page.evaluate(ride.check)).toEqual(ride.expected);
});

test('legacy ride buttons are clickable too (pointer-events fix) and keep the legacy flag', async ({ page }) => {
  test.setTimeout(240000);
  await load(page, '?ui=legacy');
  const links = await page.locator('.phase6-routes a').evaluateAll(as => as.map(a => { const r = a.getBoundingClientRect(), el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { text: a.textContent, own: a.contains(el) }; }));
  expect(links).toEqual([{ text: 'Ride U9 · Central', own: true }, { text: 'Ride U5 · River loop', own: true }, { text: 'U5 · Original direct route', own: true }]);
  await page.getByRole('link', { name: 'Ride U5 · River loop', exact: true }).click();
  await page.waitForURL(/u5=scenic.*ui=legacy$/, { timeout: 120000 });
  await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 120000 });
  expect(await page.evaluate(() => [metro.world.routes.U5.variant, metro.player.station.stationId, document.documentElement.className])).toEqual(['scenic', 'u5-altstadtbruecke', 'ui-legacy']);
});

test('live service pill: NEXT between stops, ARRIVING within the threshold and DOORS OPEN at a station, from the service values', async ({ page }) => {
  test.setTimeout(240000);
  await load(page, '?network=original');
  // Drive the real simulation frame by frame; the HUD updates inside the same frames.
  const result = await page.evaluate(() => {
    const { world } = metro, service = world.service, threshold = metroHud.approachingThreshold;
    world.renderer.setAnimationLoop(null);
    // Read the final state sizes, not a CSS spring transition in flight.
    const still = document.createElement('style'); still.textContent = '#gh-service-pill, #gh-service-pill * { transition: none !important; }'; document.head.append(still);
    const pill = document.querySelector('#gh-service-pill'), text = id => document.querySelector(id).textContent;
    const states = [], mismatches = [], styles = {};
    const record = () => {
      const docked = Math.abs(service.distance - service.currentStop.distance) < 0.2 && service.speed < 0.01;
      const station = docked && !['travelling', 'arriving'].includes(service.state);
      const countdown = station ? service.departureSeconds : (service.measuredTimetable?.arrivalCountdown() ?? service.arrivalSeconds);
      const expected = station ? 'station' : countdown <= threshold ? 'approaching' : 'between';
      const state = pill.dataset.state;
      if (state !== expected) mismatches.push({ state, expected, countdown });
      if (text('#gh-ring-text') !== String(Math.max(0, Math.ceil(countdown)))) mismatches.push({ ring: text('#gh-ring-text'), countdown });
      if (text('#gh-next-stop') !== service.nextStop.name) mismatches.push({ next: text('#gh-next-stop') });
      if (state === 'station' && text('#gh-current-stop') !== service.currentStop.name) mismatches.push({ current: text('#gh-current-stop') });
      if (state === 'station' && service.state === 'boarding' && text('#gh-current-label') !== 'DOORS OPEN') mismatches.push({ label: text('#gh-current-label') });
      if (state !== 'station' && text('#gh-next-label') !== (state === 'approaching' ? 'ARRIVING' : 'NEXT')) mismatches.push({ label: text('#gh-next-label') });
      if (states.at(-1)?.state !== state) {
        const css = s => getComputedStyle(pill.querySelector(s));
        styles[state] ??= { next: css('.gh-pill-next strong').fontSize, current: css('.gh-pill-current strong').fontSize, ring: css('.gh-ring').width, roundel: css('.gh-roundel').width,
          progress: css('.gh-progress').height, glow: getComputedStyle(pill).boxShadow, label: text(state === 'station' ? '#gh-current-label' : '#gh-next-label'), stop: text(state === 'station' ? '#gh-current-stop' : '#gh-next-stop') };
        states.push({ state, at: service.currentStop.id, countdown: Math.ceil(countdown) });
      }
    };
    record();
    service.requestDeparture();
    let progress = [];
    for (let frame = 0; frame < 120 * 60; frame++) {
      world.update(1 / 60); record();
      if (pill.dataset.state === 'between') progress.push(document.querySelector('#gh-progress').style.transform);
      if (service.currentStop.id === 'station-2' && service.state === 'boarding') break;
    }
    return { states, mismatches: mismatches.slice(0, 5), styles, threshold, progress: [progress[0], progress.at(-1)] };
  });
  expect(result.threshold).toBe(10);
  expect(result.mismatches).toEqual([]);
  const sequence = result.states.map(s => s.state).filter((s, i, all) => s !== all[i - 1]);
  expect(sequence).toEqual(['station', 'between', 'approaching', 'station']);
  expect(result.states.at(-1).at).toBe('station-2');
  expect(result.states.find(s => s.state === 'approaching').countdown).toBeLessThanOrEqual(10);
  expect(result.styles.between).toMatchObject({ next: '18px', ring: '44px', roundel: '36px', progress: '3px', label: 'NEXT', stop: 'Central' });
  expect(result.styles.approaching).toMatchObject({ next: '24px', ring: '54px', label: 'ARRIVING', stop: 'Central' });
  expect(result.styles.approaching.glow).toContain('rgb(200, 120, 77)');
  expect(result.styles.station).toMatchObject({ current: '24px', label: 'DOORS OPEN' });
  expect(result.progress[0]).not.toBe(result.progress[1]);
});

test('reduced motion jumps the menu, drawer and camera straight to their end states', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page);
  await page.locator('#gh-menu-button').click();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#gh-panel')).transitionDuration.split(',').every(d => parseFloat(d) <= 0.01))).toBe(true);
  const jumps = await page.evaluate(() => {
    metroHud.setDetent(2);
    const sheet = { h: metroHud.sheet.h, target: metroHud.sheet.target };
    const c = metroHud.map.camera; c.flyTo({ x: 12, y: 34, s: 0.5 });
    const camera = { x: c.x, y: c.y, s: c.s, goal: c.goal };
    metroHud.map.selectLine('U3');
    return { sheet, camera, drawIn: metroHud.map.drawIn, dim: metroHud.map.dim.t };
  });
  expect(jumps.sheet.h).toBe(jumps.sheet.target);
  expect(jumps.camera).toEqual({ x: 12, y: 34, s: 0.5, goal: null });
  expect(jumps.drawIn).toBe(null); expect(jumps.dim).toBe(1);
  await page.locator('#gh-menu-button').click();
  await expect(page.locator('#gh-panel')).toBeHidden();
});

test('U10 journey times and the controls reference stay reachable from the menu', async ({ page }) => {
  await load(page, '?line=U10');
  await openMenu(page);
  await page.getByRole('button', { name: 'U10 journey times', exact: true }).click();
  await expect(page.locator('#gh-panel #u10-timings')).toHaveAttribute('open', '');
  await expect(page.locator('#u10-timings')).toContainText('Total one-way journey = 918.67 seconds');
  await page.locator('#gh-controls summary').click();
  await expect(page.locator('#gh-controls')).toContainText('Board / leave train');
});

test('the HUD map adds no WebGL draw calls', async ({ page }) => {
  await load(page);
  const calls = async () => page.evaluate(() => { const w = metro.world; w.renderer.render(w.scene, w.camera); return w.renderer.info.render.calls; });
  await page.evaluate(() => metro.world.renderer.setAnimationLoop(null));
  const closed = await calls();
  await openMap(page, 2);
  expect(await calls()).toBe(closed);
});

test.describe('phone-sized viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('menu, map drawer, touch taps, pinch zoom and a ride link work on a phone', async ({ page }) => {
    test.setTimeout(240000);
    await load(page);
    const panelWidth = async () => (await page.locator('#gh-panel').boundingBox()).width;
    await page.locator('#gh-menu-button').tap();
    await expect(page.locator('#gh-panel')).toBeVisible();
    expect(await panelWidth()).toBeLessThanOrEqual(366);
    await page.locator('#gm-grab').tap(); await hudSettled(page);
    expect(await page.evaluate(() => metroHud.sheet.index)).toBe(1);
    await page.evaluate(() => { const c = metroHud.map.camera; c.zoomAbout(c.width / 2, c.visible().y1 / 2, 2.4); metroHud.map.changed(); }); await hudSettled(page);
    const point = await stationPoint(page, 'u6-ringplatz');
    await page.touchscreen.tap(point.x, point.y); await hudSettled(page);
    await expect(page.locator('.gm-card h3')).toHaveText('Ringplatz');
    // Two-finger pinch, centred between the fingers.
    const pinch = await page.evaluate(async () => {
      const map = metroHud.map, view = map.el.view, r = view.getBoundingClientRect(), s0 = map.camera.s;
      const fire = (type, id, x, y) => view.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: r.left + x, clientY: r.top + y, bubbles: true }));
      map.clearCard();
      fire('pointerdown', 11, 120, 80); fire('pointerdown', 12, 160, 80);
      for (let i = 1; i <= 5; i++) { fire('pointermove', 11, 120 - i * 12, 80); fire('pointermove', 12, 160 + i * 12, 80); await new Promise(d => setTimeout(d, 16)); }
      fire('pointerup', 11, 60, 80); fire('pointerup', 12, 220, 80);
      return { s0, s1: map.camera.s };
    });
    expect(pinch.s1 / pinch.s0).toBeGreaterThan(1.5);
    await hudSettled(page);
    await page.evaluate(() => metroHud.setDetent(0)); await hudSettled(page);
    await page.getByRole('link', { name: 'U5 · River loop', exact: true }).tap();
    await page.waitForURL(/u5=scenic/, { timeout: 120000 });
    await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 120000 });
    expect(await page.evaluate(() => metro.world.routes.U5.variant)).toBe('scenic');
    await expect(page.locator('#gh-service-pill')).toBeVisible();
  });
});
