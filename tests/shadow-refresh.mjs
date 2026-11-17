// Street shadow-map refresh rate and popping, with the day/night clock running (normal play) and frozen.
//   node tests/shadow-refresh.mjs [url] [label] [out-dir]
//   SHADOW_ASSERT=1 SHADOW_COMPARE=<other build's json> node tests/shadow-refresh.mjs ...   (fail on the checks below)
//
// A. Refresh rate: the viewer moves along Broadway North at 0, 1.4, 7, 25 and 50 m/s for 4 s at 10:00 and 22:00,
//    with the clock either running at its normal speed or held. Every street shadow-map refresh is counted.
// B. Popping: a fixed camera watches Broadway while the viewer (which places the shadow map) drives past at 25 m/s
//    for 120 frames. Each frame is compared with the previous one; frames where shadow edges visibly jump
//    (pixels changing by more than 16 levels) are counted, with and without the clock running. The animated
//    billboard tickers (driven by performance.now) are held still during this measurement only, because they change
//    the image every frame regardless of shadows; nothing else is altered.
// Checks: a running clock adds less than one refresh per second over a held clock (the sun moves in ~0.36° steps);
// with SHADOW_COMPARE, no refresh rate exceeds the other build's at the same speed, time and clock; visible changes
// happen only on frames with a shadow refresh.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const [url = 'http://127.0.0.1:5173/app.html', label = 'current', out = 'docs/driving/stage5/shadow-refresh'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${url}?line=U4&station=station-2`, { timeout: 300000 });
await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 300000 });
await page.evaluate(() => { const w = metro.world; w.renderer.setAnimationLoop(null); metro.player.teleportToSurface(); w.update(0); w.surfaceWorld.finishBuild(); w.update(0); });

const rates = await page.evaluate(() => {
  const { world: w, player: p } = metro, out = {};
  for (const time of ['10:00', '22:00']) for (const clock of ['running', 'frozen']) for (const speed of [0, 1.4, 7, 25, 50]) {
    w.dayClock.set(time); p.camera.position.set(-150, w.surfaceWorld.streetY + 1.76, -427); p.yaw = -Math.PI / 2; p.pitch = 0; p.applyLook();
    w.update(1 / 60); const held = w.dayClock.minutes; let refreshes = 0, onStreet = true;
    for (let i = 0; i < 240; i++) {
      if (clock === 'frozen') w.dayClock.minutes = held;
      p.camera.position.x += speed / 60; w.renderer.shadowMap.needsUpdate = false; w.update(1 / 60);
      if (w.renderer.shadowMap.needsUpdate) refreshes++; onStreet &&= p.surfaceExploring;
    }
    out[`${time} clock ${clock} ${speed} m/s`] = { refreshesPerSecond: +(refreshes / 4).toFixed(2), onStreet };
  }
  return out;
});

const popping = {};
for (const clock of ['running', 'frozen']) {
  popping[clock] = await page.evaluate(clock => {
    const { world: w, player: p } = metro, cam = p.camera, gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    w.dayClock.set('16:30'); const held = w.dayClock.minutes, realNow = performance.now.bind(performance), tickerTime = realNow();
    performance.now = () => tickerTime; // hold the billboard tickers (test only; restored below)
    const viewer = { x: -95, z: -427 }, fixed = () => { cam.position.set(-60, w.surfaceWorld.streetY + 1.76, -424); cam.rotation.set(-0.2, -Math.PI / 2, 0, 'YXZ'); };
    const place = () => { cam.position.set(viewer.x, w.surfaceWorld.streetY + 1.76, viewer.z); p.yaw = -Math.PI / 2; p.pitch = 0; p.applyLook(); };
    place(); w.update(1 / 60); fixed(); w.renderer.render(w.scene, w.camera);
    let prev = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prev);
    let refreshes = 0, visibleChanges = 0, changesWithoutRefresh = 0, maxChangedPct = 0, sumChangedPct = 0; const pops = [];
    for (let i = 0; i < 120; i++) {
      if (clock === 'frozen') w.dayClock.minutes = held;
      viewer.x += 25 / 60; place(); w.renderer.shadowMap.needsUpdate = false; w.update(1 / 60); const refreshed = w.renderer.shadowMap.needsUpdate; if (refreshed) refreshes++;
      fixed(); w.renderer.render(w.scene, w.camera);
      const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let changed = 0; for (let k = 0; k < px.length; k += 4) if ((Math.abs(px[k] - prev[k]) + Math.abs(px[k + 1] - prev[k + 1]) + Math.abs(px[k + 2] - prev[k + 2])) / 3 > 16) changed++;
      const pct = changed / (W * H) * 100;
      if (pct > 0.005) { visibleChanges++; if (!refreshed) changesWithoutRefresh++; pops.push(+pct.toFixed(3)); }
      maxChangedPct = Math.max(maxChangedPct, pct); sumChangedPct += pct; prev = px;
    }
    performance.now = realNow; place();
    return { frames: 120, metresDriven: 50, refreshes, framesWithVisibleShadowChange: visibleChanges, visibleChangesWithoutRefresh: changesWithoutRefresh,
      visibleChangePcts: pops, maxChangedPixelsPct: +maxChangedPct.toFixed(4), totalChangedPixelsPct: +sumChangedPct.toFixed(3) };
  }, clock);
}

const result = { label, url, rates, popping, errors };
await mkdir(out, { recursive: true }); await writeFile(`${out}/${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
await browser.close();

if (process.env.SHADOW_ASSERT === '1') {
  const fails = [], other = process.env.SHADOW_COMPARE ? JSON.parse(await import('node:fs').then(fs => fs.readFileSync(process.env.SHADOW_COMPARE, 'utf8'))) : null;
  for (const time of ['10:00', '22:00']) for (const speed of [0, 1.4, 7, 25, 50]) {
    const run = rates[`${time} clock running ${speed} m/s`].refreshesPerSecond, frozen = rates[`${time} clock frozen ${speed} m/s`].refreshesPerSecond;
    if (run > frozen + 1) fails.push(`${time} ${speed} m/s: the running clock adds ${(run - frozen).toFixed(2)} refreshes/s over a held clock (sun steps should add < 1)`);
    if (other) for (const clock of ['running', 'frozen']) { const k = `${time} clock ${clock} ${speed} m/s`, mine = rates[k].refreshesPerSecond, theirs = other.rates[k].refreshesPerSecond;
      if (mine > theirs) fails.push(`${k}: ${mine} refreshes/s, more than ${other.label} (${theirs})`); }
  }
  for (const [k, v] of Object.entries(rates)) if (!v.onStreet) fails.push(`${k}: viewer left the street (measurement invalid)`);
  for (const clock of ['running', 'frozen']) if (popping[clock].visibleChangesWithoutRefresh > 0) fails.push(`popping (${clock} clock): ${popping[clock].visibleChangesWithoutRefresh} visible changes happened without a shadow refresh`);
  if (errors.length) fails.push(...errors);
  if (fails.length) { console.error('FAILED:\n - ' + fails.join('\n - ')); process.exitCode = 1; } else console.log('shadow refresh checks passed');
}
