// The vehicle physics on the real street district (headless, deterministic): the same ground model and colliders
// the game uses. Complements tests/vehicle-physics.mjs (synthetic surfaces) and tests/driving.spec.js (browser).
//   node tests/vehicle-city.mjs     (exits 1 on failure)
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const context = new Proxy({}, { get: (t, k) => k in t ? t[k] : k === 'measureText' ? s => ({ width: s.length * 12 }) : () => {} });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { createMaterials } = await import('../src/materials.js');
const { createPhase6Network } = await import('../src/phase6-network.js');
const { addU10ToNetwork } = await import('../src/u10-network.js');
const { MetroRoute } = await import('../src/route.js');
const { NetworkLineWorld } = await import('../src/network-world.js');
const { SurfaceWorld } = await import('../src/surface-world.js');
const { STREET_Y } = await import('../src/city-layout.js');
const { ASPHALT_TOP, KERB_TOP } = await import('../src/city-roads.js');
const { VehicleGround } = await import('../src/vehicle/vehicle-ground.js');
const { VehiclePhysics } = await import('../src/vehicle/vehicle-physics.js');
const { GT3R } = await import('../src/vehicle/gt3r-params.js');

const network = createPhase6Network(); addU10ToNetwork(network);
const route = new MetroRoute(network, 'U4'); route.surfaceExitEnabled = true;
const u4 = new NetworkLineWorld(createMaterials(), route);
const surface = new SurfaceWorld(createMaterials(), u4.central); surface.finishBuild(); surface.updateMatrixWorld(true);
const t0 = performance.now(), ground = new VehicleGround(surface), buildMs = performance.now() - t0;
const report = { groundBuildMs: +buildMs.toFixed(1), groundTriangles: ground.triangleCount, zoneRects: ground.zoneRects.length }, failures = [];
const check = (name, ok, detail) => { if (!ok) failures.push({ name, detail }); };
const car = () => new VehiclePhysics(GT3R, ground);
/** Drive at 60 Hz; returns the worst contact error (tyre bottom vs rendered ground) and other stats. */
function drive(c, seconds, control) {
  let worst = 0, minContacts = 4, t = 0;
  for (let i = 0; i < seconds * 60; i++, t += 1 / 60) {
    c.setInput(control(t, c)); c.update(1 / 60);
    let n = 0; for (const w of c.wheels) if (w.contact) { n++; const g = ground.heightAt(w.contactPoint.x, w.contactPoint.z); if (g !== null && w.normal.y > 0.999) worst = Math.max(worst, Math.abs(w.hubWorld.y - w.radius - g)); }
    minContacts = Math.min(minContacts, n);
  }
  return { worstContactM: +worst.toFixed(4), minContacts, x: +c.position.x.toFixed(2), z: +c.position.z.toFixed(2), speedKmh: +(c.forwardSpeed * 3.6).toFixed(1), collisions: c.collisions, finite: Number.isFinite(c.position.x + c.position.z) };
}
const full = () => ({ throttle: 1, brake: 0, steer: 0 }), cruise = v => (t, c) => ({ throttle: c.forwardSpeed < v ? 0.6 : 0, brake: 0, steer: 0 });

// Ground model = rendered surfaces.
report.ground = { asphalt: ground.heightAt(140, -427) - STREET_Y, kerb: ground.heightAt(140, -436.11) - STREET_Y, canal: ground.heightAt(-60, -333.5), bridgeDeck: ground.heightAt(-227, -333.5) - STREET_Y };
check('ground: asphalt at the rendered height', Math.abs(report.ground.asphalt - (ASPHALT_TOP - STREET_Y)) < 1e-6, report.ground);
check('ground: kerb at the rendered height', Math.abs(report.ground.kerb - (KERB_TOP - STREET_Y)) < 1e-6, report.ground);
check('ground: no ground over the canal', report.ground.canal === null, report.ground);
check('ground: road bridge deck carries the asphalt', Math.abs(report.ground.bridgeDeck - (ASPHALT_TOP - STREET_Y)) < 1e-6, report.ground);

// 1. Straight along Broadway North (eastbound lane): tyres on the rendered surface throughout.
{ const c = car(); c.reset({ x: -200, z: -427, yaw: Math.PI / 2 }); report.broadway = drive(c, 8, full);
  check('broadway: straight in lane', Math.abs(report.broadway.z + 427) < 0.8, report.broadway);
  check('broadway: tyres on the rendered surface (< 5 mm)', report.broadway.worstContactM < 0.005 && report.broadway.minContacts === 4, report.broadway); }
// 2. Over the West Avenue road bridge (southbound lane).
{ const c = car(); c.reset({ x: -227, z: -290, yaw: Math.PI }); report.bridge = drive(c, 6, cruise(25));
  check('bridge: crossed the canal on the deck', report.bridge.z < -350 && report.bridge.minContacts === 4 && report.bridge.worstContactM < 0.005, report.bridge); }
// 3. Bollards close Central Avenue at the old town.
{ const c = car(); c.reset({ x: -19.2, z: -380, yaw: 0 }); report.bollards = drive(c, 5, cruise(12));
  const nose = c.position.z + c.hull.cz + c.hull.hz;
  report.bollards.noseZ = +nose.toFixed(2);
  check('bollards: the car stops at the row', c.collisions > 0 && nose < -351.0 && nose > -354, report.bollards); }
// 4. Pedestrian zone: from Via del Corso the car cannot turn into the old-town lanes.
{ const c = car(); c.reset({ x: -40, z: -123, yaw: Math.PI }); report.zone = drive(c, 4, (t, cc) => ({ throttle: 0.5, brake: 0, steer: 0 }));
  check('pedestrian zone: the car stays out of the old town', c.position.z > -130.5, report.zone); }
// 5. Kerb strike: drive diagonally over a straight kerb onto the pavement at 25 km/h; stable, no launch.
{ const c = car(); c.reset({ x: 120, z: -430, yaw: Math.PI / 2 - 0.35 }); let peak = 0, maxPitch = 0;
  for (let i = 0; i < 180; i++) { c.setInput(cruise(7)(0, c)); c.update(1 / 60); peak = Math.max(peak, Math.abs(c.acceleration.y)); maxPitch = Math.max(maxPitch, Math.acos(Math.min(1, c.axes.y.y))); }
  report.kerb = { peakVerticalG: +(peak / 9.81).toFixed(2), maxTiltDeg: +(maxPitch * 180 / Math.PI).toFixed(2), onKerbOrPavement: ground.heightAt(c.position.x, c.position.z) > STREET_Y + 0.0155 };
  check('kerb: mounting is bounded and stable', peak / 9.81 < 5 && maxPitch < 0.12, report.kerb); }
// 6. Building: straight into a facade at 15 m/s.
{ const c = car(); c.reset({ x: 150, z: -500, yaw: Math.PI }); report.building = drive(c, 6, cruise(15));
  let inside = false; ground.forEachCollider(c.position.x, c.position.z, c.position.x, c.position.z, () => { inside = true; });
  check('building: stopped at the facade, not inside it', c.collisions > 0 && !inside && report.building.finite, report.building); }
// 7. Cornering through a rounded junction (Broadway North → East Avenue, left turn) at ~35 km/h.
{ const c = car(); c.reset({ x: 150, z: -427, yaw: Math.PI / 2 }); let maxSlip = 0;
  // Test driver: follow the eastbound lane, then from x = 188 aim at the southbound East Avenue lane (x = 203).
  const follow = (t, cc) => { const p = cc.position, yaw = Math.atan2(cc.axes.z.x, cc.axes.z.z);
    const target = p.x < 188 ? [p.x + 12, -427] : [203, Math.min(p.z - 12, -440)];
    const want = Math.atan2(target[0] - p.x, target[1] - p.z), err = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
    return { ...cruise(10)(t, cc), steer: Math.max(-1, Math.min(1, err * 2.2)) }; };
  report.junction = drive(c, 9, follow);
  const yaw = Math.atan2(c.axes.z.x, c.axes.z.z);
  report.junction.headingDeg = +(yaw * 180 / Math.PI).toFixed(1);
  check('junction: turned into East Avenue without touching anything', Math.abs(Math.abs(report.junction.headingDeg) - 180) < 15 && report.junction.collisions === 0 && report.junction.x > 198 && report.junction.x < 206 && report.junction.z < -445, report.junction);
  check('junction: tyres on the rendered surface through the turn', report.junction.worstContactM < 0.005 && report.junction.minContacts === 4, report.junction); }

report.failures = failures;
if (process.env.VEHICLE_CITY_REPORT) await writeFile(process.env.VEHICLE_CITY_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) { console.error(`${failures.length} city driving check(s) failed`); process.exitCode = 1; }
