// Repeatable street / driving benchmark.
//
// Same viewport, device-pixel ratio, time of day, camera poses, scripted paths and warm-up for every run,
// so results from different commits are comparable. Run it against the development server:
//
//   npm run dev -- --port 5173 --strictPort             (in another terminal)
//   node tests/surface-benchmark.mjs                     (software or default GPU, headless)
//   BENCH_GPU=1 node tests/surface-benchmark.mjs         (real GPU: visible browser window, keep it in front)
//   BENCH_GPU=1 BENCH_CHANNEL=chrome node tests/surface-benchmark.mjs   (use the installed Google Chrome)
//
// Options (environment): BENCH_URL (default http://127.0.0.1:5173/app.html), BENCH_LABEL, BENCH_OUT (JSON file),
// BENCH_VIEWPORT=1920x1080, BENCH_REPEATS (pose passes, default 2), BENCH_REALTIME_SECONDS (default 12),
// BENCH_SOAK_FRAMES (default 300), BENCH_MIN_FRAMES (realtime minimum, default 60),
// BENCH_SCENARIOS=poses,cpu,realtime,soak,drive (default: all available),
// CHROMIUM_PATH (browser executable).
//
// Notes: frame times are measured with renderer.render + gl.finish (blocking on real GPUs; partly asynchronous on
// SwiftShader). GPU time comes from EXT_disjoint_timer_query_webgl2 only where the browser exposes it; it is
// never estimated. Draw calls, triangles, shadow refreshes and CPU update times are exact on any device.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const env = process.env;
const URL_ = env.BENCH_URL || 'http://127.0.0.1:5173/app.html';
const [VW, VH] = (env.BENCH_VIEWPORT || '960x600').split('x').map(Number);
const REPEATS = Number(env.BENCH_REPEATS || 2), RT_SECONDS = Number(env.BENCH_REALTIME_SECONDS || 12), SOAK = Number(env.BENCH_SOAK_FRAMES || 300);
const MIN_FRAMES = Number(env.BENCH_MIN_FRAMES || 60);
const SCENARIOS = new Set((env.BENCH_SCENARIOS || 'poses,cpu,realtime,soak,drive').split(','));
let commit = 'unknown'; try { commit = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain -- src').toString().trim() ? '+dirty' : ''); } catch {}
const LABEL = env.BENCH_LABEL || commit;
const OUT = env.BENCH_OUT || `bench-results/${LABEL}.json`;
const gpu = env.BENCH_GPU === '1';
const args = gpu ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-precise-memory-info', '--disable-frame-rate-limit', '--disable-gpu-vsync']
  : ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'];
const browser = await chromium.launch({ headless: !gpu, channel: env.BENCH_CHANNEL || undefined, executablePath: env.BENCH_CHANNEL ? undefined : env.CHROMIUM_PATH || undefined, args });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await page.context().newCDPSession(page);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
await page.goto(`${URL_}?line=U4&station=station-2&time=14:32`, { timeout: 300000 });
await page.waitForFunction(() => window.metro?.ready, undefined, { timeout: 300000 });

// Shared in-page helpers: statistics, fixed street setup and an optional GPU timer.
await page.evaluate(() => {
  const q = (a, digits = 2) => { if (!a.length) return null; const s = [...a].sort((m, n) => m - n), at = p => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const r = x => +x.toFixed(digits); return { n: s.length, median: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(s[s.length - 1]), mean: r(s.reduce((t, x) => t + x, 0) / s.length) }; };
  const w = metro.world, gl = w.renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const gpuTime = draw => { // ms, or null when the extension is unavailable
    if (!timer) { draw(); return null; }
    const query = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, query); draw(); gl.endQuery(timer.TIME_ELAPSED_EXT); gl.finish();
    for (let i = 0; i < 200 && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE); i++) gl.finish();
    const ok = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(timer.GPU_DISJOINT_EXT);
    const ns = ok ? gl.getQueryParameter(query, gl.QUERY_RESULT) : null; gl.deleteQuery(query); return ns === null ? null : ns / 1e6; };
  const place = (x, z, yaw, pitch = -0.02, time = '14:32') => {
    const p = metro.player; w.dayClock.set(time); const minutes = w.dayClock.minutes;
    if (p.exitVehicle) p.exitVehicle?.({ silent: true });
    p.camera.position.set(x, w.surfaceWorld.streetY + 1.76, z); p.transferSurface = null; p.yaw = yaw; p.pitch = pitch; p.applyLook();
    w.update(0); w.dayClock.minutes = minutes; };
  window.__bench = { q, gpuTime, place, timerAvailable: Boolean(timer) };
  w.renderer.setAnimationLoop(null);
  metro.player.teleportToSurface(); w.update(0); w.surfaceWorld.finishBuild(); w.update(0);
});
const environment = await page.evaluate(({ gpu }) => { const w = metro.world, gl = w.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info');
  return { userAgent: navigator.userAgent, gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '', mode: gpu ? 'real GPU (headed)' : 'SwiftShader (software, headless)',
    cores: navigator.hardwareConcurrency, viewport: [innerWidth, innerHeight], canvas: [w.renderer.domElement.width, w.renderer.domElement.height], pixelRatio: w.renderer.getPixelRatio(),
    gpuTimer: __bench.timerAvailable, vehicle: Boolean(metro.vehicle) }; }, { gpu });
log('environment', JSON.stringify(environment));
const scene = await page.evaluate(() => { const w = metro.world, d = w.surfaceWorld.district; let meshes = 0, inst = 0, instances = 0, tris = 0, casters = 0; const mats = new Set(), tex = new Map();
  d.traverse(o => { if (!o.isMesh) return; meshes++; mats.add(o.material.uuid); if (o.castShadow) casters++;
    const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; if (o.isInstancedMesh) { inst++; instances += o.count; tris += t * o.count; } else tris += t;
    for (const k of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap']) { const t = o.material[k]; if (t?.image?.width) tex.set(t.uuid, t.image.width * t.image.height * 4 * 4 / 3); } });
  return { meshes, instancedMeshes: inst, instances, triangles: Math.round(tris), materials: mats.size, shadowCasters: casters, textures: tex.size,
    textureMBEstimate: +([...tex.values()].reduce((a, b) => a + b, 0) / 1048576).toFixed(1), colliders: w.surfaceWorld.colliders.length }; });
log('scene', JSON.stringify(scene));

const POSES = [
  ['oldtown-central-square', -16.2, -221, Math.PI, -0.02, '14:32'],
  ['downtown-broadway-central', -16.2, -425, 0, -0.02, '14:32'],
  ['downtown-mercato-midtown', -104, -497, 0, -0.02, '14:32'],
  ['road-bridge-west-ave', -230, -322, 0, -0.02, '14:32'],
  ['east-ave-broadway', 196, -430, Math.PI / 2, -0.02, '14:32'],
  ['downtown-look-up', -16.2, -425, 0, 0.45, '14:32'],
  ['downtown-look-down-road', -16.2, -425, 0, -0.6, '14:32'],
  ['downtown-broadway-central-night', -16.2, -425, 0, -0.02, '22:00'],
  ['downtown-mercato-midtown-night', -104, -497, 0, -0.02, '22:00'],
];
// Downtown loop used by realtime/soak runs (Central Ave → Broadway N → East Ave → Broadway S → West Ave → Broadway N).
const LOOP = [[-16.2, -400], [-16.2, -430], [200, -430], [200, -570], [-230, -570], [-230, -430], [-16.2, -430]];
const save = async () => { await mkdir(dirname(OUT), { recursive: true }); await writeFile(OUT, JSON.stringify(result, null, 2)); };
const result = { label: LABEL, commit, date: new Date().toISOString(), url: URL_, environment, scene, method: {
  poses: `${REPEATS} passes x 20 renders (+12 with forced shadow refresh) after 8 warm-up renders; renderer.render + gl.finish`,
  cpu: '120 world.update(1/60) calls with the camera moved at a fixed speed; rendering excluded',
  realtime: `${RT_SECONDS} s of the game's own animation loop with the camera moved at 25 m/s around the downtown loop`,
  soak: `${SOAK} frames of update+render at 20 m/s with forced GC before and after (CDP heap usage)`,
}, errors };

if (SCENARIOS.has('poses')) {
  result.poses = [];
  for (const [name, x, z, yaw, pitch, time] of POSES) {
    const passes = [];
    for (let r = 0; r < REPEATS; r++) passes.push(await page.evaluate(({ x, z, yaw, pitch, time }) => {
      const w = metro.world, gl = w.renderer.getContext(); __bench.place(x, z, yaw, pitch, time);
      w.renderer.shadowMap.needsUpdate = true; for (let i = 0; i < 8; i++) { w.renderer.render(w.scene, w.camera); gl.finish(); }
      const cpu = [], gpuMs = [], shadowCpu = [];
      for (let i = 0; i < 20; i++) { const t = performance.now(); const g = __bench.gpuTime(() => w.renderer.render(w.scene, w.camera)); gl.finish(); cpu.push(performance.now() - t); if (g !== null) gpuMs.push(g); }
      const info = { calls: w.renderer.info.render.calls, triangles: w.renderer.info.render.triangles };
      for (let i = 0; i < 12; i++) { w.renderer.shadowMap.needsUpdate = true; const t = performance.now(); w.renderer.render(w.scene, w.camera); gl.finish(); shadowCpu.push(performance.now() - t); }
      return { frameMs: __bench.q(cpu), gpuMs: gpuMs.length ? __bench.q(gpuMs) : null, withShadowRefreshMs: __bench.q(shadowCpu), ...info,
        shadowFrame: { calls: w.renderer.info.render.calls, triangles: w.renderer.info.render.triangles }, district: w.surfaceWorld.districtAt(x, z), surface: metro.player.surfaceExploring };
    }, { x, z, yaw, pitch, time }));
    const pose = { name, ...passes[0], repeatMedians: passes.map(p => p.frameMs.median) }; await save();
    result.poses.push(pose); log('pose', name, JSON.stringify({ calls: pose.calls, triangles: pose.triangles, frameMs: pose.frameMs.median, gpuMs: pose.gpuMs?.median ?? null, repeats: pose.repeatMedians }));
    if (env.BENCH_SCREENSHOTS) { const png = await page.evaluate(() => metro.world.renderer.domElement.toDataURL('image/jpeg', 0.85)); await mkdir(env.BENCH_SCREENSHOTS, { recursive: true }); await writeFile(`${env.BENCH_SCREENSHOTS}/${name}.jpg`, Buffer.from(png.split(',')[1], 'base64')); }
  }
}

if (SCENARIOS.has('cpu')) {
  result.cpu = await page.evaluate(() => { const { world: w, player: p } = metro; w.dayClock.set('14:32');
    const run = (speed, frames) => { __bench.place(-16.2, -380, 0); const s = []; let refreshes = 0;
      for (let i = 0; i < frames; i++) { p.camera.position.z -= speed / 60; w.renderer.shadowMap.needsUpdate = false; const t = performance.now(); w.update(1 / 60); s.push(performance.now() - t); if (w.renderer.shadowMap.needsUpdate) refreshes++; }
      return { updateMs: __bench.q(s, 3), shadowRefreshesPerSecond: +(refreshes / (frames / 60)).toFixed(1) }; };
    return { walk1_4: run(1.4, 120), sprint7: run(7, 120), drive25: run(25, 120), drive50: run(50, 120) }; });
  log('cpu', JSON.stringify(result.cpu)); await save();
}

const pathSetup = speed => page.evaluate(({ LOOP, speed }) => { const pts = [];
  for (let i = 0; i < LOOP.length - 1; i++) { const [ax, az] = LOOP[i], [bx, bz] = LOOP[i + 1], d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (speed / 60));
    for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n, Math.atan2(-(bx - ax), -(bz - az))]); }
  window.__path = pts; __bench.place(pts[0][0], pts[0][1], pts[0][2]); }, { LOOP, speed });

if (SCENARIOS.has('realtime')) {
  await pathSetup(25);
  result.realtime = await page.evaluate(async ({ seconds, minFrames }) => { const { world: w, player: p } = metro, original = w.update; let i = 0; const stamps = [], updates = [], shadow = [];
    w.update = delta => { const [x, z, yaw] = __path[i++ % __path.length]; p.camera.position.x = x; p.camera.position.z = z; p.yaw = yaw; p.applyLook();
      const t = performance.now(); original(1 / 60); updates.push(performance.now() - t); shadow.push(w.renderer.shadowMap.needsUpdate); stamps.push(performance.now()); };
    w.renderer.setAnimationLoop(metro.renderFrame ?? null);
    if (!metro.renderFrame) { const loop = () => { if (!window.__stop) { w.update(1 / 60); w.renderer.render(w.scene, w.camera); requestAnimationFrame(loop); } }; requestAnimationFrame(loop); }
    // Run for the requested time, but keep going (up to 10x) until enough frames exist for percentiles.
    const started = performance.now(); while (performance.now() - started < seconds * 1000 || (stamps.length < minFrames && performance.now() - started < seconds * 10000)) await new Promise(r => setTimeout(r, 250));
    window.__stop = true; w.renderer.setAnimationLoop(null); w.update = original; await new Promise(r => setTimeout(r, 300));
    // Interval k spans update k, its render and update k+1, so it carries update k's shadow-refresh flag.
    const frames = stamps.slice(1).map((t, k) => t - stamps[k]), slowWithShadow = frames.filter((f, k) => shadow[k]), plain = frames.filter((f, k) => !shadow[k]);
    const f = __bench.q(frames); return { frames: frames.length, frameIntervalMs: f, fpsMedian: f ? +(1000 / f.median).toFixed(1) : null, fps1PercentLow: f ? +(1000 / f.p99).toFixed(1) : null,
      updateMs: __bench.q(updates, 3), shadowRefreshFrames: shadow.filter(Boolean).length, intervalWithShadowRefreshMs: __bench.q(slowWithShadow), intervalWithoutMs: __bench.q(plain) }; }, { seconds: RT_SECONDS, minFrames: MIN_FRAMES });
  log('realtime', JSON.stringify(result.realtime)); await save();
}

if (SCENARIOS.has('soak')) {
  await pathSetup(20);
  await cdp.send('HeapProfiler.collectGarbage'); const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const mem0 = await page.evaluate(() => ({ ...metro.world.renderer.info.memory }));
  result.soak = await page.evaluate(frames => { const { world: w, player: p } = metro, gl = w.renderer.getContext(); const ms = [], refresh = [];
    for (let i = 0; i < frames; i++) { const [x, z, yaw] = __path[i % __path.length]; p.camera.position.x = x; p.camera.position.z = z; p.yaw = yaw; p.applyLook();
      const t = performance.now(); w.update(1 / 60); const r = w.renderer.shadowMap.needsUpdate; w.renderer.render(w.scene, w.camera); gl.finish(); ms.push(performance.now() - t); refresh.push(r); }
    return { frames, frameMs: __bench.q(ms), shadowRefreshFrames: refresh.filter(Boolean).length,
      frameMsWithShadowRefresh: refresh.some(Boolean) ? __bench.q(ms.filter((m, k) => refresh[k])) : null, frameMsWithout: __bench.q(ms.filter((m, k) => !refresh[k])) }; }, SOAK);
  await cdp.send('HeapProfiler.collectGarbage'); const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  result.soak.heapAfterGCMB = { before: +(heap0 / 1048576).toFixed(2), after: +(heap1 / 1048576).toFixed(2) };
  result.soak.rendererMemory = { before: mem0, after: await page.evaluate(() => ({ ...metro.world.renderer.info.memory })) };
  log('soak', JSON.stringify(result.soak)); await save();
}

// Driving scenario: exists once the vehicle is integrated (later stages). Scripted throttle/steer on Broadway.
if (SCENARIOS.has('drive') && await page.evaluate(() => Boolean(metro.vehicle?.benchmark))) {
  result.drive = await page.evaluate(async seconds => metro.vehicle.benchmark(seconds, __bench), Math.max(8, RT_SECONDS));
  log('drive', JSON.stringify(result.drive));
}

result.glError = await page.evaluate(() => metro.world.renderer.getContext().getError());
result.errors = errors;
await save();
log('written', OUT, 'errors', errors.length);
await browser.close();
if (errors.length || result.glError) process.exitCode = 1;
