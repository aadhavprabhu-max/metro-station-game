// Unit checks for the HUD map's spring physics. Run: node tests/map-physics.mjs
import assert from 'node:assert/strict';
import { MapCamera, SheetSpring, integrate, rubber, springEasing, CAMERA_PHYSICS, SHEET_PHYSICS } from '../src/map-physics.js';

const SIZE = { width: 1330, height: 1150 };
const run = (body, fps, seconds) => { let live = true; for (let i = 0; i < fps * seconds && live; i++) live = integrate(1 / fps, dt => body(dt)); return live; };

// Reference constants are preserved exactly.
assert.equal(CAMERA_PHYSICS.response, 0.62); assert.equal(CAMERA_PHYSICS.damping, 0.92);
assert.equal(CAMERA_PHYSICS.friction, 0.998); assert.equal(CAMERA_PHYSICS.velocityWindowMs, 100);
assert.equal(SHEET_PHYSICS.response, 0.46); assert.equal(SHEET_PHYSICS.damping, 0.8);
assert.equal(SHEET_PHYSICS.projection, 0.42); assert.equal(SHEET_PHYSICS.collapsed, 78);
assert.equal(rubber(0, 320), 0);
assert.ok(rubber(10000, 320) < 320 && rubber(10000, 320) > 300, 'rubber band approaches but never exceeds its dimension');

// Element-relative fit: a 284 × 240 HUD map fits the whole network inside its own box.
const camera = new MapCamera(SIZE); camera.setViewport(284, 240);
const fit = camera.fitAll(); camera.flyTo(fit, { instant: true });
assert.ok(fit.s > 0.1 && fit.s < 0.25, `small element fit scale ${fit.s}`);
const tl = camera.project(0, 0), br = camera.project(SIZE.width, SIZE.height);
assert.ok(tl.x >= 0 && tl.y >= 0 && br.x <= 284 && br.y <= 240, 'whole map inside the element');
assert.ok(camera.margin < 140 && camera.rubberDimension < 320, 'margins and rubber band scale down with the element');
const b = camera.boundsFor(camera.minScale); assert.ok(b.xmin <= b.xmax && b.ymin <= b.ymax, 'bounds stay ordered at minimum zoom');

// Cursor-centred zoom: the map point under the focus stays put while zooming.
const focus = { x: 200, y: 90 }, under = { x: (focus.x - camera.x) / camera.s, y: (focus.y - camera.y) / camera.s };
camera.zoomAbout(focus.x, focus.y, 2);
let maxDrift = 0;
run(dt => { const live = camera.step(dt); if (camera.zoom) { const p = camera.project(under.x, under.y); maxDrift = Math.max(maxDrift, Math.hypot(p.x - focus.x, p.y - focus.y)); } return live; }, 60, 3);
assert.ok(maxDrift < 0.01, `zoom keeps the cursor point fixed (drift ${maxDrift})`);
assert.ok(Math.abs(camera.s / fit.s - 2) < 0.02 || camera.goal === null, 'zoomed ×2');

// Momentum: a fast release keeps gliding with friction, then stops and settles inside bounds.
const drag = new MapCamera(SIZE); drag.setViewport(400, 300); drag.flyTo(drag.fitAll(), { instant: true }); drag.zoomAbout(200, 150, 3); run(dt => drag.step(dt), 60, 3);
drag.beginDrag(200, 150, 0); for (let t = 10; t <= 60; t += 10) drag.dragTo(200 + t * 4, 150, t); drag.endDrag();
assert.ok(drag.fvx > CAMERA_PHYSICS.flingMinSpeed, `fling velocity ${drag.fvx}`);
const released = drag.x; drag.step(1 / 120); assert.ok(drag.x > released, 'camera keeps moving after release');
run(dt => drag.step(dt), 60, 8);
const bounds = drag.boundsFor(drag.s);
assert.ok(drag.x >= bounds.xmin - 0.5 && drag.x <= bounds.xmax + 0.5, 'momentum ends inside bounds (spring back)');

// Rubber band: dragging far past the bounds is resisted, then springs back.
const band = new MapCamera(SIZE); band.setViewport(400, 300); band.flyTo(band.fitAll(), { instant: true });
const limit = band.boundsFor(band.s).xmax; band.beginDrag(100, 100, 0); band.dragTo(2100, 100, 400);
assert.ok(band.x > limit && band.x - limit < band.rubberDimension, 'over-drag is rubber-banded');
band.endDrag(); run(dt => band.step(dt), 60, 4);
assert.ok(Math.abs(band.x - limit) < 0.5, 'springs back to the bound');

// flyTo is a critically-damped spring: converges without large overshoot.
const fly = new MapCamera(SIZE); fly.setViewport(400, 300); fly.flyTo({ x: 0, y: 0, s: 1 }, { instant: true });
fly.flyTo({ x: 100, y: -50, s: 2 }); let overshoot = 0;
run(dt => { const live = fly.step(dt); overshoot = Math.max(overshoot, fly.x - 100); return live; }, 60, 4);
assert.ok(Math.abs(fly.x - 100) < 0.01 && Math.abs(fly.s - 2) < 1e-6 && overshoot < 2, `flyTo settles (overshoot ${overshoot.toFixed(3)})`);

// Frame-rate independence: 30 fps and 144 fps produce the same motion.
const at = fps => { const c = new MapCamera(SIZE); c.setViewport(400, 300); c.flyTo({ x: 0, y: 0, s: 1 }, { instant: true }); c.flyTo({ x: 300, y: 100, s: 1.5 }); const frames = Math.round(fps * 0.3); for (let i = 0; i < frames; i++) integrate(0.3 / frames, dt => c.step(dt)); return c.x; };
assert.ok(Math.abs(at(30) - at(144)) < 0.5, `30 vs 144 fps: ${at(30).toFixed(2)} / ${at(144).toFixed(2)}`);

// Reduced motion: jumps straight to the end state.
const still = new MapCamera(SIZE); still.setViewport(400, 300); still.reduceMotion = true; still.flyTo({ x: 10, y: 20, s: 1.2 });
assert.deepEqual([still.x, still.y, still.s, still.goal], [10, 20, 1.2, null]);

// Sheet: drag down grows, rubber-bands past full, release projects to a detent and keeps velocity.
const sheet = new SheetSpring(); sheet.setDetents([78, 320, 560]); sheet.setDetent(0, 0, true);
sheet.beginDrag(100, 0); sheet.dragTo(300, 50); assert.equal(sheet.h, 278);
sheet.dragTo(1000, 100); assert.ok(sheet.h > 560 && sheet.h < 700, 'rubber band past full');
sheet.dragTo(320, 400); sheet.dragTo(330, 460); const release = sheet.endDrag();
assert.equal(release.index, 1, 'slow release settles on the nearest detent (half)');
sheet.beginDrag(0, 1000); sheet.dragTo(5, 1010); sheet.dragTo(40, 1040); sheet.dragTo(80, 1060); const flick = sheet.endDrag();
assert.equal(flick.index, 2, 'a downward flick projects past half to full'); assert.ok(sheet.v > 0, 'release velocity is carried');
run(dt => sheet.step(dt), 60, 3); assert.equal(sheet.h, 560);
sheet.beginDrag(10, 0); assert.deepEqual(sheet.endDrag(), { tap: true }, 'a tap is reported, not treated as a drag');

// CSS spring easing.
const spring = springEasing();
assert.ok(spring.easing.startsWith('linear(0,') && spring.easing.endsWith(',1)'));
assert.ok(spring.duration > 0.5 && spring.duration < 1.2);
console.log('map physics: camera, momentum, rubber band, cursor zoom, flyTo, sheet detents and spring easing OK');
