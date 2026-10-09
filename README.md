# Aurealis-Bahn — Four-Line Metro Network

A playable first-person metro network built with Three.js, JavaScript, HTML, and CSS. The original Nordplatz opening view faces the same green three-car U1 train and physical departures board. U1 runs Nordplatz → Central → Rosenheimer Platz. The independent red U2 train runs Stadtzentrum → Central → Schwarzkopf-Tunnel → Eisenwerk. U3 adds Schattenufer → Central → Ostbahnhof → Stadtbrücke with a blue train. U4 adds Kaiser-Humboldt-Platz → Westbahnhof → Central → Arabellapark with a purple train. All four independent services stop at every station, reverse at their endpoints, and repeat automatically. Central has one shared network node with upper U1/U2 platforms and lower U3/U4 platforms 12 metres below. Level passages and a physical four-flight staircase connect all four platforms. Everything in the scene, including textures and signs, is generated locally; there are no remote models, image assets, fonts, or runtime APIs.

## Open the standalone game

`index.html` is a complete, self-contained game: Three.js, the game code, and CSS are embedded in that file. Open it directly in a browser, or select it in a raw HTML preview. It works without an asset server or Internet requests. `dist/index.html` is the same standalone build.

The modular source entry is `app.html`, with logic under `src/`. Edit those source files and run `npm run build` to regenerate the standalone `index.html`; do not edit the generated bundle manually. With the development server running, `/app.html` provides Vite's module reload workflow, and `/` serves the standalone preview.

## Run

Use Node.js 22.12+ (or Node.js 24) and npm. In this checkout:

```sh
npm ci
npm run dev
```

Vite prints the address for your browser. No backend, credentials, or environment variables are needed. Use a current browser with WebGL 2 and hardware acceleration enabled.

In the Codex cloud machine, use the writable npm cache:

```sh
npm ci --cache /workspace/.npm-cache
npm run dev -- --port 5173 --strictPort
```

## Controls

| Input | Action |
| --- | --- |
| W A S D or arrow keys | Walk |
| Shift | Sprint |
| Left-button drag / touch drag | Look around |
| E / Board train button | Board near an open platform-side door, or leave at a station |
| Start U1 / U2 / U3 / U4 | Select Nordplatz / Stadtzentrum / Schattenufer / Kaiser-Humboldt-Platz as the player start |
| R or Reset view | Return to the selected starting view |
| Escape | Release dragging / close controls |
| Touch movement pad | Walk on a touch screen |

Mouse-look releases on pointer up, cancellation, lost capture, or window blur. It does not lock the cursor. On platforms, the player collides with walls, pillars, benches, bins, and technical cabinets. The safety boundary prevents stepping onto the tracks. Approach an open doorway and press E to board. Inside, walk and look around the car; seats, grab poles, walls, and car ends constrain movement. The rider follows the selected train throughout its journey and can leave only when stopped with its platform-side doors open. At Central, the signed rear-wall passage connects upper platforms 01/02 and another connects lower platforms 03/04. The stairs at the south end of platform 01 descend to platform 03; follow the four switchback flights and landings. Both levels have clear line and stair wayfinding. Reset and start buttons reposition only the player; all four trains continue operating. Append `?line=U2`, `?line=U3`, or `?line=U4` to begin at that line’s first station.

## Train journeys

U1 has three stops at route distances 0, 240, and 480 m: Nordplatz, Central, and Rosenheimer Platz. Each adjacent pair has continuous rails and a 152 m connecting tunnel. Central is an intermediate through-station, not a terminus. The train reverses its active cab only at Rosenheimer Platz and Nordplatz; its destination remains the appropriate terminus throughout each direction.

After an initial 30-second boarding window, doors close, the U1 train pauses briefly, and it accelerates to 10 m/s. Each moving leg takes about 34 seconds, including smooth acceleration and braking. At every stop it aligns exactly with the platform, opens only the platform-side doors, and waits 20 seconds. A full four-leg cycle takes about four minutes.

U2 stops at distances 0, 240, 480, and 720 m. Its physical track is parallel to U1, 25.14 m west, with continuous rail and tunnel geometry between stops. Platform 02 is on its right; platform 01 remains on U1's left. U2 has a 40-second initial boarding window and the same movement/dwell sequence. The six-leg round trip takes about six minutes of simulation time. At each terminus the destination changes to the opposite endpoint; the active cab changes only after the dwell and closed-door interlock. The train does not turn, jump, or teleport. Central is an intermediate through-stop for both lines.

Stadtzentrum is a modern tiled station. Schwarzkopf-Tunnel has a continuous irregular rock shell, mineral strata, a dark level platform, and suspended industrial strip lights inspired by the supplied natural-rock station reference. Eisenwerk has heavy steel trusses, riveted frames, pipes, a bridge crane, and inaccessible machinery. The original seven platform boards retain their U1/U2 service information; both upper Central boards show both directions of those lines. The eight lower platforms add their own U3/U4 information. The HUD follows the player's current platform or ridden train. Simulation pauses when the browser tab is hidden.


### U3 / U4 and Central’s lower level

| Line | Stops in outbound order | Route distances | Platform / elevation |
| --- | --- | --- | --- |
| U3 | Schattenufer → Central → Ostbahnhof → Stadtbrücke | 0 / 390 / 630 / 870 m | 03 / −12 m |
| U4 | Kaiser-Humboldt-Platz → Westbahnhof → Central → Arabellapark | 0 / 240 / 480 / 720 m | 04 / −12 m |

Both lower lines reuse the existing train, sampled route and door-interlocked service systems: maximum speed 10 m/s, acceleration 0.9 m/s², braking 1.1 m/s², initial boarding 40 seconds, subsequent dwell 20 seconds, closing/pause 1.5 seconds each and a 1-second stop pause. Each makes all six round-trip legs. The first U3 leg is longer (390 m); subsequent U3 and all U4 legs are 240 m. Cab direction changes after terminal doors close; the consist remains aligned with the rails. U1/U2 service parameters remain unchanged. U2 takes approximately 2 minutes 30 seconds from departure to Eisenwerk, or 3 minutes 13 seconds including the initial wait; the earlier 7-minute-30-second target is obsolete.

The lower halls share Central’s original graph node while their rail/platform poses use the same −12 m floor offset. The upper rails and existing passage remain in place. A selective platform-end opening leads to a dedicated shaft beyond the original floor slabs. Four physical 16-tread flights descend through landings at −3, −6, −9 and −12 m. The controller follows their continuous support surfaces and respects lane/wall boundaries; height checks prevent switching to a platform on the wrong floor.

Schattenufer has a curved 32 × 110 m steel diagrid canopy and a deep fluted oval illuminated oculus. Ostbahnhof uses deep coffers and synchronized hub displays; Stadtbrücke uses tied steel arches. Kaiser-Humboldt-Platz has a real masonry barrel vault, deep stone arches, carved support, teal tiles and warm ornamental lanterns. Westbahnhof has restrained brick vaulting, iron columns and period clocks; Arabellapark uses cream vaults and sage patterned tiles. Arabellapark was absent from this checkout, so it is a new station using the shared operational layout. Reference images guide original geometry and materials; no reference image appears as a backdrop or wall texture.

Central boards show the two real services on their own level, with four directional rows; global maps show all four lines. Both pedestrian connections are floor-aware. Visibility culls the remote and opaque adjacent halls while every service continues simulating. Lower fixtures and the cached shadow light follow the actual floor; the same four-point-light pool serves stations and transfer stairs.

## Build and validation

```sh
npm run build
npm run preview
npm test
```

The Playwright tests use `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to a locally installed Chromium executable if necessary. Tests run Chromium with a software WebGL renderer so they also work on a cloud machine without a GPU. Interactive performance is best with hardware acceleration; software-rendered test timing does not represent desktop GPU performance.

The suite checks real scene rendering and WebGL errors, line-of-sight to all three cars and the board at spawn, live keyboard movement, WASD and arrow directions, sprint, diagonal normalization, delta time, mouse directions and pitch limits, pointer cancellation, collisions, reset, focus loss, reload, touch movement, timetable updates, and the door animation API. `test-results/spawn.png` records the tested opening view.

`npm test -- tests/standalone-preview.spec.js` loads the actual root HTML with all external requests blocked, checks styled UI and real canvas pixels, exercises keyboard movement, mouse-look and reset, and saves `test-results/standalone-preview.png`. This protects the raw HTML preview that cannot fetch separate script or CSS files.

Rendering regressions also check the actual canvas pixels between frames, startup while document visibility is hidden, and a preview container growing from zero size without a window resize. The renderer preserves its drawing buffer so embedded preview captures retain the last 3D frame. Startup explicitly draws the spawn view; a `ResizeObserver` keeps the canvas and projection in sync with the containing preview.

For browser-level rendering diagnostics, run `node tests/render-diagnostics.mjs`. It launches the installed Chromium without forcing a GPU backend, reports failed requests, console errors, canvas attachment and size, WebGL state, scene mesh/light counts, advancing frames, and actual captured pixels. It saves both the browser screenshot and the raw 3D canvas under `/tmp`. Set `METRO_URL` to inspect a different running dev or production URL.

`npm test -- tests/journey.spec.js tests/network.spec.js tests/u2.spec.js` checks both upper routes, synchronized cars, stopping accuracy, door interlocks, terminal destination displays, boarding and alighting at every station, rider/platform collisions, directional departure predictions, and Central's shared network node. The U2 tests cover all six legs, independent service states, red/green material separation, correct doors on mirrored platforms, deferred cab reversal, and a continuous Central transfer using keyboard input. They also inspect the actual rock mesh and ironworks structure. Before the U3/U4 source edits, all 23 existing tests passed unchanged.

For real-time production-browser evidence, run `METRO_URL=http://127.0.0.1:4173/metro-station-game/ node tests/u1-network-inspect.mjs`. This runner follows the normal animation loop without changing service timing or moving the train artificially. Real keyboard and mouse input boards, rides all four legs, and leaves/reboards at each stop; screenshots and diagnostics are written under `/tmp/metro-u1-network`. The previous `tests/journey-inspect.mjs` command remains available as an alias. On a software-rendered cloud machine, set `SOFTWARE_WEBGL=1`; `METRO_VIEWPORT_WIDTH` and `METRO_VIEWPORT_HEIGHT` optionally adjust the inspection viewport.

`SOFTWARE_WEBGL=1 node tests/u2-network-inspect.mjs` follows the normal production animation loop with actual keyboard, mouse, and UI input. It boards at Stadtzentrum, rides all six U2 legs, leaves/reboards at the stops, and then makes a separate U1 ride to Central, walks the interchange, and boards U2. It saves screenshots and diagnostics under `/tmp/metro-u2-network`, and checks that U1 continues operating while U2 is ridden. The same URL, Chromium, and viewport variables apply.

`SOFTWARE_WEBGL=1 node tests/station-inspect.mjs` additionally captures wide views of all fifteen physical platforms and their high-resolution board textures. This supplemental inspection advances the real services in small steps and positions a diagnostic camera; it does not replace the separate live journey test.

Phase 4 validation on 8 October 2026: the original 18 tests passed before edits; all 23 tests passed after implementation, and the production build succeeded. Chromium rendered all seven platform overviews. The normal-RAF production inspection completed the six-leg U2 round trip and a real U1 ride, walking Central transfer, and U2 boarding/ride. Its 43 captures reported zero JavaScript errors, WebGL errors, failed requests, or rail-position error. Both services continued operating throughout the round trip. The rendered cave, ironworks, station views, and green/red trains were visually inspected.

For the lower network, `npm test -- tests/lower-lines.spec.js` checks four-line graph identity and platform elevations, both six-leg lower round trips, train synchronization, door interlocks, destination reversal, boarding/alighting/reset, physical staircase descent/ascent, and genuine curved station geometry. The original 23 cases remain in the full suite.

`SOFTWARE_WEBGL=1 node tests/u34-inspect.mjs` inspects the production version using normal animation frames and real input. It rides all six legs of U3 and U4, then rides U1 to Central, walks downstairs, transfers through the lower passage to U4, rides that service and returns upstairs. It saves screenshots, per-frame stair-height diagnostics, live timetable/state and runtime/WebGL/request diagnostics under `/tmp/metro-u34-network`. `METRO_INSPECT_MODE=ride|transfer` and `METRO_INSPECT_LINE=U3|U4` permit a focused retry; these do not change the game’s timetable.

U3/U4 validation on 9 October 2026: the original 23 tests passed before source edits, and all 30 tests passed after integration, including the retained U1/U2 cases. The production build succeeded. The normal-animation production browser completed all six U3 legs and all six U4 legs using real keyboard, mouse and boarding input. Both trains stopped exactly, opened the correct doors, changed terminal destinations and kept all three cars synchronized; U1 and U2 continued operating independently. The twelve live journey legs reported zero JavaScript errors, WebGL errors, failed asset requests or rail-position error. Supplemental rendered overviews covered all fifteen physical platforms and their departures displays. The production HTML served by the preview matched `dist/index.html` exactly, with SHA-256 `cdc35d3461487b171c7928b754713b6d4e16ccb596cfb261a85d267562461a57`.

A separate focused production-browser transfer also passed: board U1 at Nordplatz, ride to Central, alight, walk all four stair flights to −12 m, cross the lower passage, board and ride U4, return to Central, alight and climb all four flights to the upper U1 platform. The descent and ascent monitors recorded every flight and landing, with maximum frame-to-frame height changes of 0.175 m and supported feet heights between −12 and 0 m. Its 15 rendered captures and two stair-monitor records reported zero JavaScript errors, WebGL errors, console warnings or failed requests. The rendered new station architecture, trains, departures displays, stairwell and both railway levels were visually inspected. These checks leave U2's original timetable unchanged.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/main.js` | Application lifecycle, render loop, context-loss handling |
| `src/scene.js` | Renderer, camera, environment, scene composition |
| `src/player.js` | Input, drag look, movement, collision, reset |
| `src/station.js` | Reusable `Station`, `Platform`, and `Track` |
| `src/train.js` | Reusable `Train` / `TrainCar`, cabs, interiors, separate doors |
| `src/network.js` | Shared station nodes, physical links, line definitions, future interchange metadata |
| `src/route.js` | Route sampling, Central/Rosenheimer stations, continuous connecting tracks and tunnels |
| `src/u2-world.js` | U2 platform definitions and continuous connecting tracks/tunnels |
| `src/interchange.js` | Central’s reusable level passages between 01/02 and 03/04 |
| `src/lower-world.js` | U3/U4 platform definitions and continuous lower track/tunnel geometry |
| `src/vertical-interchange.js` | Four-flight transfer stairs, landings, structure and walking support surfaces |
| `src/modern-stations.js` | Schattenufer’s diagrid/oculus, Ostbahnhof coffers and Stadtbrücke arches |
| `src/historic-stations.js` | Kaiser-Humboldt vaults/carving, Westbahnhof railway details and Arabellapark tilework |
| `src/rock-station.js` | Continuous procedurally displaced rock shell and industrial fixtures |
| `src/iron-station.js` | Ironworks architecture, steel trusses, crane, pipes, and machinery |
| `src/service.js` | Door/dwell sequence, acceleration/braking, exact stops, reversing service |
| `src/departures.js` | Timetable data and updateable canvas display |
| `src/lighting.js` | Ambient, directional, point lights and physical fixtures |
| `src/materials.js` | Shared physical materials and procedural textures |
| `src/geometry.js` | Shared primitives, instancing, procedural signs |
| `src/optimize.js` | Static geometry batching that preserves dynamic objects |
| `src/visibility.js` | Remote-section and opaque adjacent-hall culling without pausing services |
| `src/ui.js` | HUD, station clock, controls help, touch controls |

World units are meters. The platform is 88 m long; each car is 16 m long, with a 1 m articulated connection. The track gauge is 1.435 m. Camera eye height is 1.76 m, FOV is 73°, and clipping planes are 0.06–180 m. Walking is 4.5 m/s and sprinting is 7 m/s.

Tiles, tactile strips, sleepers, roof vents, rivets, and ceiling slats use instancing. Other opaque static pieces are batched by material; door leaves, destination displays, headlights, and glass remain independent. Shadows use a 2048² map, cached while geometry is stationary and refreshed during train/door movement. The shadow light follows the rider's station or train. A fixed pool of four point lights follows the active platform or stairs. Remote tunnel sections and the hall behind the dividing wall are culled; the connected Central halls are revealed while the player crosses a passage or uses the stairs. All four train services keep simulating regardless of visibility. Resolution is capped at a device pixel ratio of 1.6. No post-processing is required.

For future systems, `Train.openDoors()`, `Train.closeDoors()`, `Train.update(delta)`, `DeparturesBoard.setDepartures(rows)`, and `DeparturesBoard.setClock(value)` are available. `window.metro.snapshot()` exposes read-only diagnostic snapshots; `window.metro.world` and `.player` support development inspection. Timetable updates also refresh the next-departure HUD.

Passenger NPCs, ambient audio, ticketing, additional lines beyond U1–U4, and the above-ground city remain future work. The shared graph separates logical stations from line-specific platforms and links. All four lines have independent routes, trains, destinations, and service state. Riders explore one car at a time; gangway traversal is not implemented. The station clock advances from a fixed scenario time. Departure predictions describe the actual local simulation, not an external real-time transit feed.

The existing `.github/workflows/pages.yml` builds and deploys pushes to `main`. Production asset URLs use `/metro-station-game/`; local development uses the root path. GitHub Pages serves the generated self-contained `dist/index.html`.
