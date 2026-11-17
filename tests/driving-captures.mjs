// Day/night screenshots of the car on the street (chase view), for visual review of lighting and shadows.
//   node tests/driving-captures.mjs <out-dir> [url]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const [out = 'captures/driving', url = 'http://127.0.0.1:5173/app.html'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${url}?line=U4&station=station-2`, { timeout: 300000 });
await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 300000 });
await page.evaluate(async () => { metro.world.renderer.setAnimationLoop(null); metro.player.teleportToSurface(); metro.world.update(1 / 60);
  const v = metro.vehicle; v.parked = { x: 120, z: -427, yaw: Math.PI / 2 }; await v.load(); v.placeParked(); await v.enter(); });
await mkdir(out, { recursive: true });
for (const [name, time, yaw] of [['morning-0730', '07:30', -2.2], ['noon-1200', '12:00', -2.2], ['evening-1740', '17:40', -2.2], ['night-2200', '22:00', -2.2], ['chase-1430', '14:30', 0]]) {
  const jpg = await page.evaluate(({ time, yaw }) => { const w = metro.world; w.dayClock.set(time); const minutes = w.dayClock.minutes;
    metro.player.yaw = yaw; metro.player.pitch = yaw ? -0.22 : 0; metro.vehicle.orbit.idle = 0;
    for (let i = 0; i < 6; i++) { w.dayClock.minutes = minutes; w.update(1 / 60); metro.vehicle.orbit.idle = 0; }
    w.renderer.shadowMap.needsUpdate = true; w.renderer.render(w.scene, w.camera); return w.renderer.domElement.toDataURL('image/jpeg', 0.88); }, { time, yaw });
  await writeFile(`${out}/${name}.jpg`, Buffer.from(jpg.split(',')[1], 'base64')); console.log('captured', name);
}
console.log('errors', JSON.stringify(errors)); await browser.close();
