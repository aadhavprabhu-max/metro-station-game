import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = '/tmp/phase6-qa'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.METRO_PRODUCTION_URL || 'http://127.0.0.1:5173/app.html?line=U5&u5=scenic&tour=river&station=u5-altstadtbruecke', { timeout: 120000 });
await page.waitForFunction(() => window.metro?.ready, { timeout: 120000 });
await page.evaluate(() => { metro.world.renderer.setAnimationLoop(null); document.querySelector('#loading').hidden = true; document.querySelector('.service-card').style.display = 'none'; });
const identities = await page.evaluate(() => metro.world.stations.filter(s => s.userData.phase6Architecture).map(s => ({ id: s.stationId, line: s.lineId, name: s.displayName })));
for (const station of identities) {
  await page.evaluate(({ id, line }) => {
    const { player, world } = metro; player.startAt(line, id); player.pitch = 0.16; player.applyLook(); world.update(0.13); world.renderer.render(world.scene, world.camera);
  }, station);
  await page.screenshot({ path: `${out}/${station.line}-${station.id}.png` });
  console.log('Inspected station:', station.name, station.line);
}
for (const [name, x, z, face] of [['eastbound', 1600, -430, 0], ['westbound', 1600, -436, 0]]) {
  const result = await page.evaluate(({ x, z, face }) => {
    const { player, world } = metro, service = world.services.find(s => s.lineId === 'U5'), b = world.network.phase6.branch;
    let best = 0, error = Infinity;
    for (let d = 0; d < b.length; d += 1) { const p = b.sample(d).position, e = Math.hypot(p.x - x, p.z - z); if (e < error) { error = e; best = d; } }
    player.startAt('U5', 'u5-altstadtbruecke'); service.train.closeDoors(); service.train.update(2); service.distance = b.splitDistance + best; service.placeTrain();
    player.ridingCar = service.train.cars[1]; player.ridingLocalOffset.set(0.8, 1.85, 0); player.previousRidingCar = null;
    const p = player.ridingLocalOffset.clone(); player.ridingCar.localToWorld(p); service.train.worldToLocal(p); player.ridingOffset.copy(p);
    player.previousRideYaw = null; player.previousRidePitch = null; player.yaw = face; player.pitch = -0.15; player.syncRide(); player.applyLook();
    world.update(0.13); world.renderer.render(world.scene, world.camera);
    return { position: world.camera.position.toArray(), error, far: world.camera.far, waterVisible: world.phase6World.water.visible, train: service.train.position.toArray() };
  }, { x, z, face });
  await page.screenshot({ path: `${out}/bridge-${name}-first-person.png` }); console.log('Crossing:', name, JSON.stringify(result));
}
await page.evaluate(() => {
  const { world, player } = metro; player.ridingCar = null; player.camera.position.set(1540, 5, -510); player.camera.lookAt(1600, -6, -433);
  world.update(0); player.camera.lookAt(1600, -6, -433); world.renderer.render(world.scene, world.camera);
});
await page.screenshot({ path: `${out}/bridge-exterior.png` });
await writeFile(`${out}/inspection.json`, JSON.stringify({ identities, errors }, null, 2));
console.log(JSON.stringify({ identities: identities.length, errors, screenshots: out })); await browser.close();
if (errors.length) process.exitCode = 1;
