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

## Stage 2 — Porsche 911 GT3 R asset

**Licence:** CC BY-NC-SA 4.0 is applied (as identified by the project owner). The archive's own `license.txt` (which states CC-BY-4.0) is kept unchanged beside the model. Full attribution and the adaptation notice are in `public/vehicles/gt3r/ATTRIBUTION.md`.

`scripts/optimize-gt3r.mjs` is an offline pipeline. Its tools are dev dependencies only (`@gltf-transform/*`, `meshoptimizer`, `sharp`) and nothing is shipped to the browser beyond `three`'s bundled meshopt decoder.

| | Original download | `public/vehicles/gt3r/gt3r.glb` |
|---|---|---|
| Size | 38.3 MB (glTF + bin + 35 PNG) | **8.98 MB** (one GLB) |
| Scale | 1/100 (root node 0.01) | metres (verified: wheelbase 2.517 m vs 2,507 mm published) |
| Materials / textures | 89 / 35 | 55 / 30 (exact duplicates merged) |
| Texture resolution | — | unchanged (WebP; normal maps lossless) |
| Triangles drawn, full detail | 489,304 | 489,304 |
| Triangles drawn, exterior cockpit LOD | — | 324,242 (cockpit 260,263 → 95,201) |

**Visual A/B** (`tests/vehicle-asset-compare.mjs`; same lighting, cameras and viewport; `stage2/compare/*.jpg` show original | optimised | optimised with exterior LOD):
- Optimised against original: mean pixel difference 0.04–1.0 (out of 255), at most 0.16 % of pixels differ by more than 24 levels in any view. Visually identical.
- Exterior cockpit LOD from the chase-camera positions: 0.04–0.07 mean, ≤ 0.05 % of pixels. Indistinguishable.
- Exterior cockpit LOD looking straight into the cabin from 1.5 m: 2.2 mean, 1.4 % of pixels, with visible shading smears on the dashboard. **So the LOD is never used for the cockpit view or within 4 m of the car**; the full original cockpit is shown there.

## Stage 3 — vehicle physics (headless)

Before this work there was no vehicle physics in Aurealis; this is new code in `src/vehicle/`. No physics engine was added: the street is a set of rendered surfaces plus about 2,700 axis-aligned obstacles, and a raycast-suspension rigid body is the standard model for that.

| Module | Content |
|---|---|
| `gt3r-params.js` | Every parameter with its provenance: **PUBLISHED** (mass ≈1,250–1,265 kg BoP, 416 kW, 4,194 cc, six-speed sequential, RWD, wheelbase, tyre sizes), **MEASURED** from the model (hubs, tyre radii, envelope), or **ESTIMATED** (CoG, inertia, springs/dampers ≈3.2 Hz, anti-roll, tyre μ 1.7 and slip peaks, gear ratios, torque-curve shape matched to 416 kW, LSD, aero CdA 0.95 / ClA 3.1, brake capacity and bias 58 %). |
| `vehicle-physics.js` | Fixed **240 Hz** step with an accumulator and interpolated render pose. 6-DOF rigid body (semi-implicit Euler, world inertia tensor). Four independent spring/damper corners (separate bump and rebound), bump stops and anti-roll bars. The tyre contact treats the tyre as a circle along its heading, so it rolls up kerbs. Relaxation-length tyres with combined slip on a normalised Pacejka curve and load sensitivity. **Implicit** wheel-spin/slip solve (stable at any tyre stiffness). Engine curve, launch clutch, sequential box with auto/manual shifting, clutch-type LSD, brakes with bias, ABS/TC (toggleable), drag and downforce. Box collisions (SAT) against the city colliders with impulse, friction and position correction. Floor-contact safety and recovery. No allocations per step. |
| `vehicle-ground.js` | The drivable ground is built **from the rendered surface triangles themselves**, so the physics surface and what is drawn cannot differ. It reuses the district's collider grid and adds the pedestrian-zone boundary (behind the bollard rows) and the district edge. |

The physics uses the mean rear half-track: the model's rear hubs are 15 mm asymmetric, which made the car pull to one side. The visual rig keeps each wheel's measured position.

### Results (`stage3/vehicle-physics.json`, synthetic test surfaces that exist only in the test)
| Test | Result |
|---|---|
| Rest | 0.4 mm drift, no jitter; front load share 0.42 (matches CoG); settles at authored ride height |
| Standing start | 0–100 km/h **3.28 s**, 0–200 km/h **9.43 s**, 0° heading deviation |
| Braking (ABS) | 100–0 **21.2 m** (peak 1.90 g); 200–0 **73.6 m** (peak 2.45 g with downforce); straight (0° yaw). Without ABS: 23.5 m, wheels lock |
| Progressive braking | deceleration follows the pedal to the limit (0.81 → 1.92 g), then ABS holds a plateau that eases as downforce falls |
| Low-speed steering | full lock 24.9° (inner wheel, Ackermann); turning circle ≈ 12.3 m path, ≈ 14 m kerb to kerb |
| Cornering limit (25 m circle) | **1.64 g** at 107 km/h |
| Step steer at 180 km/h | 63 % yaw-rate rise in 0.067 s, 8.8 % overshoot, 1.59 g |
| Kerb strike / bumps / washboard | 0.66 g peak, recovers; 100 % tyre contact over 3 cm bumps at 60 km/h (body heave 4 mm rms); straight on washboard |
| 8 % grade | climbs; holds with the brake, 0 mm creep |
| Collisions | wall at 10 and 30 m/s and a 0.24 m bollard at 30 m/s: no tunnelling, no spin, no NaN |
| Traction (TC off) | power oversteer (rear slip 0.51, body slip 25°), recovered in 0.82 s by lift and countersteer; with TC, rear slip held at 0.10 |
| Frame-rate independence | identical results at 30, 60 and 144 Hz (0 m spread) |
| Cost | 0.014 ms per 60 Hz frame |

Two first-run failures were real physics bugs and were fixed: the collision contact point used a single box corner (a head-on wall spun the car; a bollard was missed), and the asymmetric rear track made the car pull. Three were test-design errors and were corrected: a fixed 1.8° steer limited the skid-pad test, the braking test demanded strict monotonicity past the ABS limit, and the grade-hold test included the braking distance and triggered auto-reverse. The braking envelope was widened from 24–45 m to 19–40 m, because its lower bound implied μ ≤ 1.6, contradicting the stated slick-tyre estimate. Grip was not changed.

### On the real city (`stage3/vehicle-city.json`, `tests/vehicle-city.mjs`)
- Ground model built in 95 ms from 15,464 rendered surface triangles.
- Broadway North straight (to 183 km/h): 4 tyres on the rendered surface, **0 mm** contact error.
- West Avenue road bridge: deck crossed, 0 mm error.
- Central Avenue bollards stop the car (nose at z = −351.65).
- The pedestrian-zone boundary holds from Via del Corso.
- Diagonal kerb mount at 25 km/h: 0.24 g, 1.6° tilt.
- Facade impact: stopped outside the building.
- Rounded junction Broadway North → East Avenue at 36 km/h: ends in the southbound lane, no contact, 0 mm error.
- `tests/road-geometry.mjs` check 7: drivable and rendered heights agree at **222,915** points (worst error 0 mm).
