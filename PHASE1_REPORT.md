# Central U4 surface district — Phase 1

## Provenance and preservation

- Working branch: `codex/u4-surface-phase1`.
- Exact starting commit: `b2dc18bedb31e7c072c5673ef095d8360a8b21e9`.
- The original `work` branch remains at `f434dedaafc24df70698b65b900f052531ff1329`.
- No commits, pushes, merges, publication or destructive Git operations were performed.
- Dependencies were installed with `npm ci --cache /tmp/aurealis-npm-cache`; `package.json` and `package-lock.json` are unchanged. The first install failed because the default npm cache was not writable; the writable-cache retry succeeded.
- All original reference-library files and Claude's glass HUD, map, layout, model and physics modules remain byte-for-byte unchanged.
- Network definitions, route sampling, service physics, train models, repaired train floors, station architecture, existing transfer/lift modules and U5/U10 environmental modules remain unchanged. Integration only adds one explicitly enabled U4 Central platform-end aperture.
- The default network still contains 53 station nodes, 65 physical railway platforms and eight services: U1, U2, U3, U4, U5, U6, U9 and U10. Historical `original`, `phase5` and `phase6` fixtures retain their existing geometry.

## Completed milestone

The public district occupies x = −148…120 m, z = −352…−92 m at street elevation +10 m. U4's existing track anchor remains at x = −23.57 m and its platform at −12 m. The 268 m transverse extent and actual pedestrian loop extend substantially beyond the U4 corridor.

Sixty-one original modular houses use varied plaster, half-timber frames, stone plinths, window bays, shutters, cornices, pitched roofs and chimneys. Narrow surveyed frontages form continuous street edges, with quieter western infill and a separate northern row. Connected streets lead through Central square, the western market and basin, northern lanes, an eastern planted court and a southern canal promenade. Three guarded crossings connect both banks. Closed façades, solid obstacles, water guards and visible perimeter walls correspond to the supported walking area. No NPCs are present.

Central's new entrance is a stone civic loggia with a monumental voussoir arch, engaged columns, recessed windows, a slate roof and two stone turrets. It continues into a ribbed barrel-vaulted access hall, stone stair enclosure and arched landings, with warm fixtures and bronze floor detailing. The existing Golden Hive U4 platform and all other Central platforms retain their identities.

The new north-end U4 connection climbs 22 m through eight switchback flights and 128 physical treads. It reuses the production transfer support system. Its dedicated shaft lies between the retained Central and Rathausmarkt halls. The street has an actual shaft opening; its paving does not cover the stairs or duplicate the upper access floor. Both ends meet supported floors without a teleport.

The district geometry is constructed on first surface approach. Opaque pieces are batched, and repeated windows/frames share instance buffers grouped by spatial row so they remain independently cullable. Existing underground viewing distance, textures, lights, shadow quality and rendering settings are retained.

## Simulation transition

`SurfaceSimulation` gates the actual updates of the existing services, doors, lifts, passenger information and U10 timetable. It retains the live objects rather than serializing and reconstructing them. The new surface mode requires supported public city floor and an unboarded player; riding an elevated U10 or surface U5 train does not activate it.

While paused, service distance, speed, direction, dwell/state timers, cab/reversal state, door progress/targets, passenger events and timetable phase remain in place. Junction authority updates and unnecessary passenger-display/announcement work are also suspended. The renderer, input and glass menu/map continue working. The transport and HUD clocks consume the same per-frame delta, including threshold crossings. Surface duration is never accumulated for catch-up.

## Validation

Completed CPU checks:

- `node tests/expansion-mechanics.mjs`: all six U1–U6 round trips and preserved route/platform data.
- `node tests/phase6-mechanics.mjs`: U9 and scenic U5 round trips, grades and junction protection.
- `node tests/u10-mechanics.mjs`: protected network, all U10 stops, grades and measured timetable.
- `node tests/phase5-geometry.mjs`: existing rails, portals, station geometry and floors.
- `node tests/transfer-geometry-check.mjs`: all four established U5/U6 transfers.
- `node tests/phase6-geometry.mjs`: U9, river-loop stations, bridge and associated transfers.
- `node tests/u10-geometry.mjs`: U10 rail/train geometry, all existing stair paths and lift openings.
- `node tests/map-physics.mjs` and `node tests/network-map-data.mjs`: preserved glass-map behaviour/data, 53 stations and eight lines.
- `node tests/surface-geometry.mjs`: 602 path-support samples, 602 headroom probes and 2,890 district-route samples; bridge support, building/water/perimeter collision boundaries, an uncapped shaft and a single exposed upper access floor. No failures.

The focused keyboard/mouse checks completed the entire ascent, district loop and descent. They drive genuine input through deterministic ordinary production update steps; they are not normal-speed journey evidence. They also verify exact suspension/restoration across all eight services in boarding, closing, departure, travel, arrival, stopped and terminal-reversal scenarios. Captures include train/car poses, door progress/targets, dwell/state timers, passenger events, the measured timetable and a held junction reservation.

Browser results:

- The full 85-case browser run on a frozen feature snapshot finished with **84 passed, one failed** in 51 minutes. The failure was the existing keyboard-boarding test's five-second wait for the interaction button to become visible after its boarding hint was already enabled. It was not skipped or counted as a pass.
- The unchanged failed test and all seven strengthened surface tests were rerun against current source: **8 passed** in 2.3 minutes.
- After the final bridge-floor correction, all seven surface tests passed again in 1.8 minutes. They cover network preservation, the entire eight-flight ascent/descent, a district loop spanning more than 180 m laterally, house collision, glass menu/search/map, exact suspension/resumption, rendering restoration and real CDP touch input at 390 × 844.
- The full suite's existing glass/map tests, U9/U10, railway journeys, transfers, rendering, floors and models passed. The entire 85-case suite was not rerun after the final focused refinements; relevant final surface checks and geometry checks were rerun.
- The first unchanged-baseline browser attempt was interrupted after 13 passes when concurrent software-rendering sessions produced shader errors and a page crash. A complete clean browser-baseline run is therefore not claimed. Baseline CPU mechanics and geometry checks passed; subsequent browsers ran sequentially.

Normal-animation inspection uses the generated standalone build, ordinary production animation and real mouse/keyboard input, with no manual `world.update` calls or player repositioning during the walk. This run uses a 640 × 400 viewport; the matched performance benchmark remains at 960 × 600. A first 960 × 600 inspection attempt exceeded its 45-second waypoint wait without captured JavaScript errors. The retry uses bounded segments and longer waits.

The retry's waypoint driver encountered `12.000000000000009` m at a nominal 12 m split, causing repeated subdivision without movement input. Its threshold was corrected to include a small tolerance in the running driver and source, retaining the same browser, player and trace. No game code, service state or player position was changed. Wall-clock inspection duration includes that driver stall and must not be interpreted as gameplay timing. Deterministic input tests above likewise do not establish real-time rendering performance.

The supplementary normal-animation run completed the platform approach, **all eight ascending flights**, upper access, entrance, Central square and about 55 m of westward street exploration. It was intentionally stopped for the final handoff following the user's direction to finish and avoid further non-essential checks. It is **not counted as a complete passed normal-animation round trip**. Its market return, descent and final exact-state comparison were not reached. Those movements and state transitions passed the separate deterministic keyboard/mouse checks, including the final seven-case surface run. The partial trace and two genuine walking captures are retained in `docs/phase1/normal-walk-partial.json`, `.jsonl`, `normal-ascent-stairs.png` and `normal-entrance.png`.

I visually inspected the final entrance/district render and the actual walking captures of the entrance and stairs. No further critical visual fix was identified. A complete normal-speed full-district visual tour and hardware-GPU performance acceptance remain outside the completed evidence.

## Performance

Measurements use Chromium with SwiftShader, a 960 × 600 viewport, DPR 1 and the existing 1024² software shadow setting. They do not establish hardware-GPU gameplay FPS. Fixed-camera rendering and simulation-update costs are measured separately. No existing texture resolution, shadow quality, lighting or underground viewing distance was reduced.

The initial matched captures at Nordplatz, Central U4 and Arabellapark had zero changed pixels against the exact baseline standalone build. Their reported draw calls remained 612, 126 and 67 respectively. Central's new opening is behind that particular camera pose; this check does not cover every possible viewpoint.

The final matched run used 25 warmup renders and 21 timed renders per view:

| Fixed camera | Baseline median ms | Phase 1 median ms | Baseline / Phase 1 draw calls |
| --- | ---: | ---: | ---: |
| Nordplatz | 22.5 | 21.1 | 612 / 612 |
| Central U4 | 11.5 | 24.7 | 126 / 126 |
| Arabellapark | 15.9 | 18.1 | 67 / 67 |
| New surface entrance | — | 15.5 | — / 152 |

Central's measured render time increased in this run, and Arabellapark also increased. These results must not be described as a demonstrated performance improvement. Software-renderer scheduling and the existing geometry/shadow workload remain inspection concerns; the benchmark does not isolate the cause of the timing increases. No hardware-GPU performance run was available.

All three **final** underground scene-only captures again contain zero changed pixels against the exact baseline, each over 576,000 pixels. Triangle counts remain 146,352 at Nordplatz and 94,092 at Arabellapark. Central changes from 221,160 to 221,184 triangles for the new aperture; its fixed camera does not look towards that opening. The surface view contains 518,322 triangles, including the entrance and 61-house district. Static batching, shared materials, spatial instance groups, lazy district construction and cached stationary shadows reduce repeated work without lowering the existing graphics settings.

After 400 moving-service warmup updates, 400 ordinary `world.update(1/60)` calls took 316.8 ms on the baseline and 306.5 ms underground on Phase 1. The suspended surface took 35.9 ms. Rendering was excluded, so these figures establish the simulation gate's CPU saving for this sample rather than gameplay frame rate.

Both benchmark versions retained 53 nodes, 65 railway platforms, eight services and the same software-rendering/shadow setting. Neither produced captured browser errors or a WebGL error. The first warmed benchmark attempt timed out during compositor screenshot capture; the completed retry used the preserved WebGL drawing buffer. Scene-only captures exclude the DOM HUD.

Raw final samples, renderer details, pixel-comparison results and the entrance capture are retained in `docs/phase1/`.

## Files

Modified application files: `src/main.js`, `src/scene.js`, `src/player.js`, `src/network-world.js`, `src/visibility.js`, `src/ui.js`; regenerated `index.html`.

New application files: `src/city-layout.js`, `src/city-buildings.js`, `src/surface-entrance.js`, `src/surface-world.js`, `src/surface-simulation.js`, `src/surface.css`.

New validation files: `tests/surface.spec.js`, `tests/surface-geometry.mjs`, `tests/surface-live-inspect.mjs`, `tests/surface-performance.mjs`. Documentation: `README.md`, `PHASE1_REPORT.md`; review evidence in `docs/phase1/`.

## Scope limits and manual visit

Only Central U4 has a new exit. The rest of the city, other U4 exits and reconstruction of existing Central platform halls remain future work. There are no enterable house interiors, NPCs, traffic simulation or swimming. The new canal is a restrained opaque game material rather than an additional reflection-rendering system.

Use `npm run dev -- --port 5175 --strictPort`, then open `/app.html?line=U4&station=station-2`. Turn towards the north end of U4's Central platform, follow OLD TOWN / ALTSTADT, climb the eight flights and exit through the stone arch. The same arch returns to U4. The generated root `index.html` also works as a standalone local file.

## Handoff and remaining limits

The approved implementation is ready for **functional manual playtesting**. The complete city expansion and the other U4 exits are not complete. No new critical functional failure is known from the completed checks. Performance acceptance remains open: the software-rendered normal-animation inspection was slow, the matched Central render median increased, and no hardware-GPU run was available. The partial normal-animation tour is documented as partial rather than counted as a pass. The existing boarding-button visibility timeout passed unchanged on rerun, but the original full-suite failure remains in the results.

Implementation, setup and validation were stopped within the three-hour authorization window, after approximately two hours and twenty-two minutes. All changes remain uncommitted on the authorized branch; nothing was pushed, merged or published. The existing development server at port 5175 remains available for manual testing.

## Subsequent deployment authorization

After the implementation handoff, the user requested deployment to the existing GitHub repository and Pages URL. This authorizes a deployment commit and push on `codex/u4-surface-phase1`. The Pages workflow now also accepts pushes on this branch and checks the published surface milestone alongside the existing Phase 6/U10 journeys. `main` and the original `work` branch are preserved; no merge is required. The earlier no-commit/no-publication statements describe the implementation handoff before this later deployment request.
