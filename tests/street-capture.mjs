// Fixed-viewpoint street screenshots for before/after comparisons (same poses, time and viewport every run).
//   node tests/street-capture.mjs <out-dir> [url] [set]
// Sets: junction (East Ave x Broadway North kerb corners), roads (asphalt/markings), zone (bollard rows), all.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const [out = 'captures', url = 'http://127.0.0.1:5173/app.html', set = 'all'] = process.argv.slice(2);
// [name, camera x, z, look-at x, z, pitch, time]
const SETS = {
  junction: [
    ['junction-ne-corner', 209.5, -418.5, 205, -425, -0.55, '14:32'], ['junction-sw-corner', 190.5, -441.5, 195, -435, -0.55, '14:32'],
    ['junction-overview', 197, -433, 207, -422, -0.4, '14:32'], ['junction-pedestrian', 208, -420.5, 198, -436, -0.2, '14:32'],
  ],
  roads: [
    ['asphalt-close', -16.2, -425, -16.2, -440, -0.6, '14:32'], ['asphalt-avenue', -227, -300, -227, -360, -0.12, '14:32'], ['asphalt-low-sun', 196, -430, 100, -430, -0.08, '18:10'],
    ['aurealis-oneway', -29.2, -455, -29.2, -520, -0.25, '14:32'], ['terrace-street', -16.2, 26, -16.2, -14, -0.2, '14:32'], ['kiosk-east-avenue', 199, -138, 195, -150, -0.2, '14:32'],
  ],
  zone: [['bollards-central-avenue', -16.2, -362, -16.2, -345, -0.15, '14:32'], ['bollards-market-west', -180, -234, -160, -234, -0.2, '14:32']],
};
const poses = set === 'all' ? Object.values(SETS).flat() : SETS[set];
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`${url}?line=U4&station=station-2`, { timeout: 300000 });
await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 300000 });
await page.evaluate(() => { const w = metro.world; w.renderer.setAnimationLoop(null); metro.player.teleportToSurface(); w.update(0); w.surfaceWorld.finishBuild(); w.update(0); });
await mkdir(out, { recursive: true });
for (const [name, x, z, tx, tz, pitch, time] of poses) {
  const yaw = Math.atan2(-(tx - x), -(tz - z));
  const jpg = await page.evaluate(({ x, z, yaw, pitch, time }) => {
    const { world: w, player: p } = metro; w.dayClock.set(time); const minutes = w.dayClock.minutes;
    p.camera.position.set(x, w.surfaceWorld.streetY + 1.76, z); p.transferSurface = null; p.yaw = yaw; p.pitch = pitch; p.applyLook();
    w.update(0); w.dayClock.minutes = minutes; w.renderer.shadowMap.needsUpdate = true;
    for (let i = 0; i < 3; i++) w.renderer.render(w.scene, w.camera);
    return w.renderer.domElement.toDataURL('image/jpeg', 0.9);
  }, { x, z, yaw, pitch, time });
  await writeFile(`${out}/${name}.jpg`, Buffer.from(jpg.split(',')[1], 'base64'));
  console.log('captured', name);
}
await browser.close();
if (errors.length) { console.error(errors); process.exitCode = 1; }
