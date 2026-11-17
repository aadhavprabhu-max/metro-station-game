// A/B check of the optimised GT3 R model against the original download (same lighting, cameras, viewport).
//   node tests/vehicle-asset-compare.mjs [original scene.gltf URL path] [out dir]
// Needs the dev server (port 5173) and the original at .cache/gt3r-source (see scripts/optimize-gt3r.mjs).
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const [original = '/.cache/gt3r-source/scene.gltf', out = 'docs/driving/stage2/compare'] = process.argv.slice(2);
const base = 'http://127.0.0.1:5173';
const VIEWS = [
  ['front-three-quarter', [4.2, 1.4, 4.6], [0, 0.55, 0.2]], ['rear-three-quarter', [-4.0, 1.6, -4.8], [0, 0.6, -0.3]],
  ['side', [6.5, 0.8, 0], [0, 0.55, 0]], ['top', [0.01, 7.5, 0], [0, 0, 0]],
  ['wheel-close', [2.0, 0.45, 2.1], [0.84, 0.36, 1.3], 30], ['cockpit-through-glass', [1.5, 1.35, 0.6], [0.2, 0.75, 0.1], 45],
  // The in-game chase camera (5.9 m behind, 1.75 m up, FOV 73) and the same distance orbited to the side and front.
  ['chase-camera', [0, 1.77, -5.9], [0, 0.97, 1.6], 73], ['chase-orbit-side', [4.2, 1.77, -4.1], [0, 0.97, 0.5], 73], ['chase-orbit-front', [2.5, 1.77, 5.4], [0, 0.97, 0], 73],
];
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
await mkdir(out, { recursive: true });
const shots = async (url, opts, label) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/tests/tools/gt3r-view.html`); await page.waitForFunction(() => window.ready);
  const stats = await page.evaluate(([u, o]) => loadModel(u, o), [url, opts]); const views = {};
  for (const [name, p, t, fov] of VIEWS) { const r = await page.evaluate(([p, t, f]) => view(p, t, f), [p, t, fov]); const buf = Buffer.from(r.png.split(',')[1], 'base64'); views[name] = { buf, calls: r.calls, triangles: r.triangles }; }
  await page.close(); return { stats, views, errors };
};
const diff = async (a, b) => {
  const [x, y] = await Promise.all([a, b].map(buf => sharp(buf).removeAlpha().raw().toBuffer()));
  let sum = 0, over = 0; for (let i = 0; i < x.length; i += 3) { const d = (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])) / 3; sum += d; if (d > 24) over++; }
  return { meanAbsDiff: +(sum / (x.length / 3)).toFixed(3), pixelsOver24Pct: +(over / (x.length / 3) * 100).toFixed(3) };
};
const A = await shots(original, { scale: 100, hideLod: false }, 'original');
const B = await shots('/public/vehicles/gt3r/gt3r.glb'.replace('/public', ''), { hideLod: true }, 'optimised');
const C = await shots('/vehicles/gt3r/gt3r.glb', { showLodOnly: true }, 'optimised-exterior-lod');
const report = { original: A.stats, optimised: B.stats, exteriorLod: C.stats, views: {} };
for (const [name] of VIEWS) report.views[name] = { original: { calls: A.views[name].calls, triangles: A.views[name].triangles }, optimised: { calls: B.views[name].calls, triangles: B.views[name].triangles },
  optimisedVsOriginal: await diff(A.views[name].buf, B.views[name].buf), exteriorLodVsOriginal: await diff(A.views[name].buf, C.views[name].buf) };
// One side-by-side JPEG per view: original | optimised | optimised with the exterior cockpit LOD.
for (const [name] of VIEWS) await sharp({ create: { width: 2400, height: 500, channels: 3, background: '#000' } })
  .composite([A, B, C].map((x, i) => ({ input: x.views[name].buf, left: i * 800, top: 0 }))).jpeg({ quality: 86 }).toFile(`${out}/${name}.jpg`);
report.errors = [...A.errors, ...B.errors, ...C.errors];
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
await browser.close();
