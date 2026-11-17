# Roads, driving and performance — engineering record

This folder records the road, vehicle and performance work in stages, with the evidence for each stage.
Every number here comes from a run that actually happened; the raw JSON or log is next to it.

## Stage 0 — measurement tools and original baseline

Recorded on the unmodified game (commit `4222f24`) before any road or vehicle change.

### Tools
| File | What it does |
|---|---|
| `tests/road-geometry.mjs` | Headless road audit. It builds the whole street district and probes the rendered surfaces. Checks: carriageway holes, foreign surfaces on carriageways, coplanar (z-fighting) surfaces, obstacles inside carriageways, preserved cross-section heights and the road-bridge decks. Later stages add kerb-corner, bollard-row and vehicle-ground checks. Exits 1 on any failure. |
| `tests/surface-benchmark.mjs` | Repeatable benchmark. Same viewport, pixel ratio, time of day, poses, scripted paths and warm-up every run. Scenarios: `poses`, `cpu` (update cost and shadow refresh rate at walking and driving speeds), `realtime` (the game's own frame loop at 25 m/s), `soak` (update + render, heap after forced GC) and `drive` (once the car exists). Writes JSON after each scenario. |
| `tests/street-capture.mjs` | Fixed-viewpoint screenshots for before/after comparisons. |

```sh
node tests/road-geometry.mjs
npm run dev -- --port 5173 --strictPort      # in another terminal
node tests/surface-benchmark.mjs             # SwiftShader / default, headless
node tests/street-capture.mjs captures/after # screenshots
```

### Measuring on your own GPU (needed for the 60 FPS target)
This environment has no GPU; it renders with SwiftShader (software). Real GPU numbers need your machine:

```sh
npm ci
npx playwright install chromium        # once, if Playwright's browser is not installed
npm run dev -- --port 5173 --strictPort
# in a second terminal, with the browser window visible and in front:
BENCH_GPU=1 BENCH_LABEL=my-gpu node tests/surface-benchmark.mjs
# or with your installed Google Chrome:
BENCH_GPU=1 BENCH_CHANNEL=chrome BENCH_LABEL=my-gpu node tests/surface-benchmark.mjs
# optional: BENCH_VIEWPORT=1920x1080 BENCH_REALTIME_SECONDS=30
```
Results go to `bench-results/<label>.json`. `realtime.frameIntervalMs` gives the median, p95 and p99 frame intervals, and `fps1PercentLow` is derived from p99. `poses[].gpuMs` appears where the browser exposes `EXT_disjoint_timer_query_webgl2`; it is never estimated. To compare commits, run the same command on each.

### Environment of the recorded baseline
Headless Chromium 153.0.8010.12, ANGLE + SwiftShader (software Vulkan), 4 CPU cores, 960 × 600, DPR 1.

### Original baseline (run 1: `benchmarks/baseline-swiftshader-run1.json`)
Exact counters:

| Pose | Draw calls | Triangles | With shadow refresh: calls / triangles |
|---|---|---|---|
| Old town, Central square | 335 | 909,036 | 477 / 1,566,958 |
| Broadway N × Central Ave | 194 | 232,622 | 347 / 860,952 |
| Mercato × Midtown | 131 | 172,684 | 269 / 787,244 |
| West Ave road bridge | 197 | 378,932 | 326 / 1,009,384 |
| East Ave × Broadway (down Broadway) | 401 | 951,588 | 479 / 1,032,584 |
| Looking up (downtown) | 199 | 247,662 | 352 / 875,992 |
| Looking down at the road | 187 | 256,722 | 340 / 885,052 |
| Broadway N × Central Ave, 22:00 | 194 | 232,622 | 357 / 892,606 |
| Mercato × Midtown, 22:00 | 131 | 172,684 | 248 / 536,568 |

District: 773 meshes (610 instanced, 60,029 instances), 1,109,352 triangles in total, 137 canvas textures (≈ 106.8 MB GPU estimate), 2,724 pedestrian colliders.

| `world.update` on the street (ms, 120 frames) | median | p95 | Shadow-map refreshes per second |
|---|---|---|---|
| walking 1.4 m/s | 0.1 | 0.4 | 0.5 |
| sprinting 7 m/s | 0.1 | 0.4 | 3.5 |
| 25 m/s (90 km/h) | 0.1 | 0.6 | **14.5** |
| 50 m/s (180 km/h) | 0.2 | 0.5 | **24.5** |

Soak (300 frames, update + render at 20 m/s): JS heap after forced GC 75.43 → 75.52 MB; renderer geometries 189 → 191 and textures 182 → 185 as new areas came into view. No growth pattern was seen; 300 frames is too short to rule out a slow leak.

### Repeatability — what is and is not reliable here
- **Repeatable.** Run 2 (`benchmarks/baseline-swiftshader-run2-partial.log`) produced identical draw calls and triangles for every pose and identical shadow-refresh rates. CPU `world.update` medians matched (0.1 ms).
- **Not repeatable.** SwiftShader render timings vary between runs; one night pose took 16 ms in run 1 and 1,077 ms in run 2. Software rendering stalls unpredictably for hundreds of milliseconds. Run 2's realtime scenario then hit an empty sample, which the benchmark now guards against. **SwiftShader millisecond figures are therefore not used to claim improvements.** Before/after comparisons use the exact counters plus CPU timings, and both versions are benchmarked back to back under identical, otherwise idle conditions (Stage 5).
- An earlier audit hypothesis was that the slow software frames coincide with shadow refreshes. The soak data does **not** support it: median 14.9 ms with a refresh against 13.2 ms without, and similar tails. The refresh *rate* and the *triangle cost* per refresh are what matter on real GPUs.

### Initial road-geometry result (`stage0/road-geometry-before.json`)
`node tests/road-geometry.mjs` **fails on the original code with 23 failures**, detecting both known defects:
- **17 × `foreign-surface-on-carriageway`** on Terrace Street (x = −16.2, z −13…19): Terrace Park's path paving lies on the road, 44 mm above the asphalt.
- **6 × `obstacle-in-carriageway`**: red kiosks inside the East Avenue (×2, 1.9–3.3 m into the lane) and Garibaldi Avenue (×1) carriageways, plus three straddling the kerb on West Avenue (×2) and Mercato Avenue (0.1 m).

It found no holes, no coplanar surfaces, correct bridge decks, and the expected cross-section (asphalt +16 mm, kerb +70 mm, pavement +16 mm) on all four sampled roads.

Screenshots: `stage0/screens/` (baseline poses) and `captures/before/` (fixed viewpoints for the later comparisons, including the kiosk standing in East Avenue's lane).

## Stage 1 — road fixes, rounded kerbs, pedestrian zone, road surface

Pavement elevations, the street layout, walking floors and building placements are unchanged.

### Changes
| Change | Where | Evidence |
|---|---|---|
| Kiosks moved onto the pavement, 1 m behind the kerb, with consistent offsets (three stood in East / Garibaldi Avenue traffic lanes) | `src/downtown-buildings.js` | `captures/before/kiosk-east-avenue.jpg` → `captures/stage1/kiosk-east-avenue.jpg` |
| Terrace Park path no longer runs 34 m down Terrace Street; only its link from the terrace stair to the street remains | `src/downtown-buildings.js` | `terrace-street.jpg` before/after |
| **Rounded kerb corners at all 130 junction corners** (36 junctions). Radius = min(6 m, narrower pavement + 0.5 m): 4.5 m on avenues, 3.5 m on the 7 m old-town streets. The limit keeps every curve clear of the zebra crossing's dropped kerb, so crossings, centrelines and widths are unchanged. Each corner has a curved kerb (same height and material), an asphalt fillet and a reshaped pavement. Signal posts move 0.55 m behind the curved kerb on the corner diagonal. | `src/city-roads.js` | `stage1/trial-one-junction/` (trial), `captures/stage1/junction-*.jpg` |
| **Old town pedestrian zone:** bollard rows (existing bollard style, 1.5 m centres, a gap on each centreline) close the three avenue entrances at the old-town footbridges (Central, Mercato, Garibaldi). The other four road ends that open onto the zone (Market Street W/E, Canal Quay W/E) are closed the same way, because otherwise a car could drive round the avenue rows. Pedestrians walk straight through; a 2.05 m car cannot pass. | `src/city-layout.js` (`PEDESTRIAN_ZONE`), `src/city-roads.js` | `bollards-*.jpg` |
| One-way Aurealis Square roads: one stop line across both lanes on the approach side, crossing and give-way signs only for the direction that has traffic | `src/city-layout.js` (`oneWay`), `src/city-roads.js` | `aurealis-oneway.jpg` |
| Asphalt re-authored: finer, low-contrast aggregate without glitter, an 8 m repeat, a roughness map of 0.84–0.97 (never glossy) and world-space tone variation so the repeat is not visible. Road paint gets world-space wear on its top faces. Asphalt and pavement pieces now use world-aligned UVs, so neighbouring pieces continue the same texture. | `src/city-textures.js`, `src/surface-variation.js` (new), `src/city-buildings.js` | `asphalt-*.jpg` |
| Rendered surface heights exported (`ASPHALT_TOP`, `KERB_TOP`, …) and a geometry self-check for corners and bollard rows | `src/city-roads.js`, `src/surface-world.js` | below |

### Trial on one junction first
The corner design was first enabled only at East Avenue × Broadway North. On that build, `tests/road-geometry.mjs` passed with 0 failures, with the 4 corners geometrically checked (`stage1/road-geometry-trial-one-junction.json`), and screenshots were taken from the same viewpoints as before (`stage1/trial-one-junction/`). The trial also showed a defect in the new asphalt texture: a patch-repair rectangle repeated every 8 m. It was removed before the design was applied to all junctions.

### Tests (all executed)
- `node tests/road-geometry.mjs`: **0 failures** (was 23). 10,554 carriageway samples, no holes, no foreign surfaces, no coplanar surfaces, **0 obstacles in carriageways**, unchanged cross-sections (asphalt +16 mm, kerb +70 mm, pavement +16 mm). All **130 rounded corners** are checked at 7 points each for asphalt fillet, curved kerb and pavement, plus both tangent joints. All **7 bollard rows** are checked for pedestrian gap ≥ 1.0 m, vehicle gap < 1.9 m, coverage and centre gap. Report: `stage1/road-geometry-after.json`.
- `node tests/surface-geometry.mjs` (existing pedestrian geometry): 0 failures, 4,192 route samples.
- `npx playwright test tests/surface.spec.js tests/downtown.spec.js tests/rendering.spec.js`: **16 passed**, including the walk from Central square over the canal into Aurealis Square (through the new bollard row), the terrace, teleport and touch controls.
