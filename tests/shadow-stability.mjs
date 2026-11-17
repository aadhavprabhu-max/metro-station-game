// Shadow popping / shimmer check for the street's shared shadow map.
//   node tests/shadow-stability.mjs [url] [label] [out-dir]
// From a fixed camera, the shadow map is re-rendered with its light positioned as the game would place it after
// the viewer moved by various distances, and each frame is compared with the reference frame. Static shadows
// that change between refreshes are visible as popping or shimmering edges while driving or walking.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const [url = 'http://127.0.0.1:5173/app.html', label = 'current', out = 'docs/driving/stage5/shadow-stability'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`${url}?line=U4&station=station-2`, { timeout: 300000 });
await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 300000 });
await page.evaluate(() => { const w = metro.world; w.renderer.setAnimationLoop(null); metro.player.teleportToSurface(); w.update(0); w.surfaceWorld.finishBuild(); w.update(0); });
await mkdir(out, { recursive: true });
const POSES = [['broadway', -60, -427, 40, -427, -0.25], ['east-avenue', 203, -470, 203, -560, -0.3], ['old-town-corso', -40, -118, 60, -118, -0.25]];
const OFFSETS = [0.9, 2.3, 4.7, 7.1, 13.7, 19.3];
const results = [];
for (const [name, x, z, tx, tz, pitch] of POSES) for (const time of ['10:00', '17:40']) {
  const frames = await page.evaluate(({ x, z, tx, tz, pitch, time, OFFSETS }) => {
    const { world: w, player: p } = metro, cam = p.camera; w.dayClock.set(time); const minutes = w.dayClock.minutes;
    const place = (px, pz) => { cam.position.set(px, w.surfaceWorld.streetY + 1.76, pz); p.transferSurface = null; p.yaw = Math.atan2(-(tx - x), -(tz - z)); p.pitch = pitch; p.applyLook(); };
    const shot = () => { w.renderer.render(w.scene, w.camera); return w.renderer.domElement.toDataURL('image/png'); };
    const refresh = (px, pz) => { place(px, pz); w.update(0); w.dayClock.minutes = minutes; place(x, z); w.renderer.shadowMap.needsUpdate = true; return shot(); };
    const frames = [refresh(x, z)];
    // The viewer moves along the street (as when walking or driving), the game repositions the shadow light,
    // and the same fixed view is rendered again.
    const dx = (tx - x) / Math.hypot(tx - x, tz - z), dz = (tz - z) / Math.hypot(tx - x, tz - z);
    for (const d of OFFSETS) frames.push(refresh(x + dx * d, z + dz * d));
    return frames;
  }, { x, z, tx, tz, pitch, time, OFFSETS });
  const bufs = frames.map(f => Buffer.from(f.split(',')[1], 'base64'));
  const raw = await Promise.all(bufs.map(b => sharp(b).removeAlpha().raw().toBuffer()));
  const diffs = raw.slice(1).map((r, k) => { let sum = 0, over = 0; for (let i = 0; i < r.length; i += 3) { const d = (Math.abs(r[i] - raw[0][i]) + Math.abs(r[i + 1] - raw[0][i + 1]) + Math.abs(r[i + 2] - raw[0][i + 2])) / 3; sum += d; if (d > 16) over++; } return { offsetM: OFFSETS[k], meanAbsDiff: +(sum / (r.length / 3)).toFixed(3), changedPixelsPct: +(over / (r.length / 3) * 100).toFixed(3) }; });
  results.push({ pose: name, time, diffs });
  await sharp(bufs[0]).jpeg({ quality: 88 }).toFile(`${out}/${label}-${name}-${time.replace(':', '')}.jpg`);
  console.log(label, name, time, JSON.stringify(diffs));
}
const all = results.flatMap(r => r.diffs);
const summary = { label, url, maxChangedPixelsPct: Math.max(...all.map(d => d.changedPixelsPct)), meanChangedPixelsPct: +(all.reduce((s, d) => s + d.changedPixelsPct, 0) / all.length).toFixed(3), results, errors };
await writeFile(`${out}/${label}.json`, JSON.stringify(summary, null, 2));
console.log(label, 'summary', summary.maxChangedPixelsPct, summary.meanChangedPixelsPct);
await browser.close();
