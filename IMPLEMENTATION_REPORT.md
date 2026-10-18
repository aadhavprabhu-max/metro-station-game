# U5/U6 working-stage report

The latest scope preserves the original U1–U4 and adds only the planned U5/U6 stations. The speculative U1–U4 infill/end extensions from the interrupted implementation are not active.

## Implemented

- 27 shared station nodes, 34 physical platforms, six independent three-car services.
- U5: Westbahnhof → Südstadt → Stadionpark → Messepark → Technologiecampus → Flughafen → Nordklinikum → Waldtor → Hafenbogen → Ostbahnhof, and return.
- U6: Stadtzentrum → Theaterinsel → Südklinikum → Sonnenfeld → Ringplatz → Waldsee → Feldkirchen → Industriepark → Arabellapark, and return.
- Continuous physical rails and tunnels, straight station approaches, smooth braking/acceleration, individual car and bogie tracking, connected gangways and car-local riding on curves.
- Physical walking transfers at Westbahnhof (U4/U5), Ostbahnhof (U3/U5), Stadtzentrum (U2/U6), and Arabellapark (U4/U6). Central retains its original U1/U2 upper and U3/U4 lower platforms and connections.
- Original flat white/light-grey and teal train exterior, broad windshield and two rectangular headlights, recovered using the original source and Nordplatz reference. Existing interior geometry and repaired interior-floor source are unchanged.
- Distinct station families: brick, structural event halls, recessed ceramic ceilings, airport fins, timber/green canopies, bronze coffers, radial roof and industrial steel. Hafenbogen has actual harbour/crane geometry; Waldsee has restrained green ceramic/timber/planting.
- Six-line start controls, actual route/departure data, long-route maps and physically connected interchange guidance. Passenger information caches static route/transfer descriptions.

## Bugs fixed during resumption

- Removed the unfinished active U1–U4 station relocations/extensions; expansion now appends to the existing graph without clearing its nodes, links, lines or platforms.
- Shared interchange rail anchors are read from the existing platform data.
- Unequal 90-degree approaches use a broad circular corner plus a straight instead of a tight elliptical bend.
- Fixed a real staircase exit dead zone: transfer-to-platform movement now accepts the station's explicitly supported doorway extensions.
- Visibility follows real spatial bounds and the actual connected platforms. The four-light pool follows long stairways; off-screen trains do not force moving shadow refreshes. Software WebGL uses 1024-pixel shadows; hardware rendering retains 2048-pixel shadows.

## Verification actually completed

- `npm run build`: passed; generated standalone root HTML and production HTML match.
- `node tests/expansion-mechanics.mjs`: passed, including an exact comparison proving original U1–U4 line/link/platform/stop data remains unchanged after expansion.
- Mechanics coverage: 62 station visits, 248 boardings and 242 exits across complete round trips; maximum wheel-to-rail sampling error below 4.3 mm. The minimum new-route curve radius is approximately 293 m.
- `node tests/transfer-geometry-check.mjs`: passed against the actual assembled world; four interchange paths have no obstructing eye-level geometry, insufficient headroom or unsupported walking probes.
- Production Chromium: seven network/model journey cases passed. Every outbound/return stop, actual train mesh, boarding/riding/alighting, door side, destination display and all 34 physical platform renders were checked with controlled simulation steps.
- Production Chromium: physical keyboard walks through all four new interchanges passed in both directions after the doorway fix. The served production HTML was hash-checked against `dist/index.html`.
- Visually inspected the restored train from spawn/front/side/three-quarter views, all 15 new station captures, and the four new stairways. These are actual WebGL captures, not source-code-only checks.
- Full 49-case regression run: 48 passed in 39.5 minutes; the spawn/reload case exceeded the 90-second limit while reinitializing software WebGL. Its first page load took about 77 seconds before the second load began. The unchanged case passed on a targeted rerun with a 180-second limit (1.4 minutes). All 49 cases have passed across these runs; the first full run was not a clean single-run pass. No assertions or game code were changed for the rerun.
- Additional normal-RAF production run: the train and interior rendered, and mouse/keyboard approach and E boarding succeeded at 800 × 500. The subsequent departure wait exceeded 240 seconds under software WebGL. A second 640 × 400 attempt exceeded its 120-second approach limit; diagnostics recorded an active page, 50 rendered frames, 11.63 seconds of advancing simulation, no JavaScript errors and no failed requests. A complete journey at normal animation speed remains unverified in this environment. Controlled-step production journeys for all six lines passed as described above.
- Supplemental production curve inspection: passed and visually inspected at U5 distance 1,196.54 m between Messepark and Technologiecampus. The three cars have different headings along the curve, the train is aligned with the curved rails, and JavaScript errors, failed requests and WebGL errors were absent. This explicitly advances the real service with controlled steps and is not a normal-timing journey claim. The camera-only capture does not update the player's platform HUD.

Evidence files: `/tmp/metro-resumed-mechanics.json`, `/tmp/metro-transfer-geometry.json`, `/tmp/metro-resumed-expansion-tests/`, `/tmp/metro-resumed-stair-fixed/`, `/tmp/metro-final-suite/`, `/tmp/metro-final-reload-rerun/`, `/tmp/metro-network-live/`, `/tmp/metro-network-live-small/failure.json`, and `/tmp/metro-network-curve/report.json`.

The original baseline was recorded before integration: 11 passes, two software-renderer timeouts, one interrupted case and 27 unrun cases in the interrupted full baseline run. A shorter first attempt also hit an intermittent boarding-button visibility timeout. These are not reported as passing checks.

## Limits and publication

This is the coherent U5/U6 stage, not a 40-station implementation. No speculative U1–U4 stations, city, NPCs, train-driving controls or new audio system were added. Existing opt-in announcements/captions remain; audible speech and hardware-GPU performance were not verified here. No dependency changes were needed. GitHub Pages configuration/base path are preserved. Nothing was pushed or deployed during implementation; the user subsequently authorized publishing this stage. The deployment outcome is recorded in GitHub Actions.

The build retains Vite's non-fatal bundle-size advisory. Existing diagnostic tests that import a separate Three.js module can emit a multiple-instances warning.

Updated cloud startup instructions were saved as an unpublished environment configuration draft. Review and save them in Environment Settings, then publish the environment to activate those setup notes. This environment draft is separate from the game's GitHub Pages deployment.

## Changed files

- `IMPLEMENTATION_REPORT.md`
- `README.md`
- `app.html`
- `index.html`
- `src/departures.js`
- `src/expansion-path.js`
- `src/glass-cathedral-station.js`
- `src/historic-stations.js`
- `src/lighting.js`
- `src/main.js`
- `src/materials.js`
- `src/modern-stations.js`
- `src/network-transfers.js`
- `src/network-world.js`
- `src/network.js`
- `src/passenger-displays.js`
- `src/passenger-info.js`
- `src/player.js`
- `src/route.js`
- `src/scene.js`
- `src/service.js`
- `src/station-config.js`
- `src/station-families.js`
- `src/station.js`
- `src/style.css`
- `src/train-cab.js`
- `src/train.js`
- `src/ui.js`
- `src/visibility.js`
- `tests/expansion-mechanics.mjs`
- `tests/expansion.spec.js`
- `tests/journey.spec.js`
- `tests/lower-lines.spec.js`
- `tests/metro.spec.js`
- `tests/network-live-inspect.mjs`
- `tests/network.spec.js`
- `tests/passenger-inspect.mjs`
- `tests/passenger.spec.js`
- `tests/rendering.spec.js`
- `tests/station-inspect.mjs`
- `tests/station-redesign.spec.js`
- `tests/train-engineering.spec.js`
- `tests/train-model-inspect.mjs`
- `tests/train-model.spec.js`
- `tests/transfer-geometry-check.mjs`
- `tests/u2-network-inspect.mjs`
- `tests/u2.spec.js`
- `tests/u34-inspect.mjs`
