# Nordplatz · Metro Station — U1 / U2 Network

A playable first-person metro network built with Three.js, JavaScript, HTML, and CSS. The original Nordplatz opening view faces the same green three-car U1 train and physical departures board. U1 runs Nordplatz → Central → Rosenheimer Platz. The independent red U2 train runs Stadtzentrum → Central → Schwarzkopf-Tunnel → Eisenwerk. Both services stop at every station, reverse at their endpoints, and repeat automatically. Central has one shared network node and two adjacent platform halls connected by a safe, level pedestrian passage. Everything in the scene, including textures and signs, is generated locally; there are no remote models, image assets, fonts, or runtime APIs.

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
| Start U1 / Start U2 | Select Nordplatz / Stadtzentrum as the player start |
| R or Reset view | Return to the selected starting view |
| Escape | Release dragging / close controls |
| Touch movement pad | Walk on a touch screen |

Mouse-look releases on pointer up, cancellation, lost capture, or window blur. It does not lock the cursor. On platforms, the player collides with walls, pillars, benches, bins, and technical cabinets. The safety boundary prevents stepping onto the tracks. Approach an open doorway and press E to board. Inside, walk and look around the car; seats, grab poles, walls, and car ends constrain movement. The rider follows the selected train throughout its journey and can leave only when stopped with its platform-side doors open. At Central, walk through the signed passage near the back of platform 01 to platform 02 to change lines. Reset and the start buttons reposition only the player; both trains continue operating. Append `?line=U2` to the game URL to begin at Stadtzentrum, or use Start U2.

## Train journeys

U1 has three stops at route distances 0, 240, and 480 m: Nordplatz, Central, and Rosenheimer Platz. Each adjacent pair has continuous rails and a 152 m connecting tunnel. Central is an intermediate through-station, not a terminus. The train reverses its active cab only at Rosenheimer Platz and Nordplatz; its destination remains the appropriate terminus throughout each direction.

After an initial 30-second boarding window, doors close, the U1 train pauses briefly, and it accelerates to 10 m/s. Each moving leg takes about 34 seconds, including smooth acceleration and braking. At every stop it aligns exactly with the platform, opens only the platform-side doors, and waits 20 seconds. A full four-leg cycle takes about four minutes.

U2 stops at distances 0, 240, 480, and 720 m. Its physical track is parallel to U1, 25.14 m west, with continuous rail and tunnel geometry between stops. Platform 02 is on its right; platform 01 remains on U1's left. U2 has a 40-second initial boarding window and the same movement/dwell sequence. The six-leg round trip takes about six minutes of simulation time. At each terminus the destination changes to the opposite endpoint; the active cab changes only after the dwell and closed-door interlock. The train does not turn, jump, or teleport. Central is an intermediate through-stop for both lines.

Stadtzentrum is a modern tiled station. Schwarzkopf-Tunnel has a continuous irregular rock shell, mineral strata, a dark level platform, and suspended industrial strip lights inspired by the supplied natural-rock station reference. Eisenwerk has heavy steel trusses, riveted frames, pipes, a bridge crane, and inaccessible machinery. All seven physical platform boards show only departures from the two actual services; both Central boards show both directions of both lines. The HUD follows the player's current platform or ridden train. Simulation pauses when the browser tab is hidden.

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

`npm test -- tests/journey.spec.js tests/network.spec.js tests/u2.spec.js` checks both routes, synchronized cars, stopping accuracy, door interlocks, terminal destination displays, boarding and alighting at every station, rider/platform collisions, directional departure predictions, and Central's shared network node. The U2 tests cover all six legs, independent service states, red/green material separation, correct doors on mirrored platforms, deferred cab reversal, and a continuous Central transfer using keyboard input. They also inspect the actual rock mesh and ironworks structure. Before this phase's source edits, the existing 18 tests passed unchanged.

For real-time production-browser evidence, run `METRO_URL=http://127.0.0.1:4173/metro-station-game/ node tests/u1-network-inspect.mjs`. This runner follows the normal animation loop without changing service timing or moving the train artificially. Real keyboard and mouse input boards, rides all four legs, and leaves/reboards at each stop; screenshots and diagnostics are written under `/tmp/metro-u1-network`. The previous `tests/journey-inspect.mjs` command remains available as an alias. On a software-rendered cloud machine, set `SOFTWARE_WEBGL=1`; `METRO_VIEWPORT_WIDTH` and `METRO_VIEWPORT_HEIGHT` optionally adjust the inspection viewport.

`SOFTWARE_WEBGL=1 node tests/u2-network-inspect.mjs` follows the normal production animation loop with actual keyboard, mouse, and UI input. It boards at Stadtzentrum, rides all six U2 legs, leaves/reboards at the stops, and then makes a separate U1 ride to Central, walks the interchange, and boards U2. It saves screenshots and diagnostics under `/tmp/metro-u2-network`, and checks that U1 continues operating while U2 is ridden. The same URL, Chromium, and viewport variables apply.

`SOFTWARE_WEBGL=1 node tests/station-inspect.mjs` additionally captures wide views of all seven physical platforms and their high-resolution board textures. This supplemental inspection advances the real services in small steps and positions a diagnostic camera; it does not replace the separate live journey test.

Phase 4 validation on 8 October 2026: the original 18 tests passed before edits; all 23 tests passed after implementation, and the production build succeeded. Chromium rendered all seven platform overviews. The normal-RAF production inspection completed the six-leg U2 round trip and a real U1 ride, walking Central transfer, and U2 boarding/ride. Its 43 captures reported zero JavaScript errors, WebGL errors, failed requests, or rail-position error. Both services continued operating throughout the round trip. The rendered cave, ironworks, station views, and green/red trains were visually inspected.

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
| `src/interchange.js` | Central's level pedestrian connection between platforms 01 and 02 |
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

Tiles, tactile strips, sleepers, roof vents, rivets, and ceiling slats use instancing. Other opaque static pieces are batched by material; door leaves, destination displays, headlights, and glass remain independent. Shadows use a 2048² map, cached while geometry is stationary and refreshed during train/door movement. The shadow light follows the rider's station or train. A fixed pool of four point lights follows the active platform. Remote tunnel sections and the hall behind the dividing wall are culled; both Central halls are revealed while the player crosses the passage. Both train services keep simulating regardless of visibility. Resolution is capped at a device pixel ratio of 1.6. No post-processing is required.

For future systems, `Train.openDoors()`, `Train.closeDoors()`, `Train.update(delta)`, `DeparturesBoard.setDepartures(rows)`, and `DeparturesBoard.setClock(value)` are available. `window.metro.snapshot()` exposes read-only diagnostic snapshots; `window.metro.world` and `.player` support development inspection. Timetable updates also refresh the next-departure HUD.

Passenger NPCs, ambient audio, ticketing, additional lines, and the above-ground city remain future work. The shared graph separates logical stations from line-specific platforms and links; U1 and U2 have independent routes, trains, destinations, and service state. Riders explore one car at a time; gangway traversal is not implemented. The station clock advances from a fixed scenario time. Departure predictions describe the actual local simulation, not an external real-time transit feed.

The existing `.github/workflows/pages.yml` builds and deploys pushes to `main`. Production asset URLs use `/metro-station-game/`; local development uses the root path. GitHub Pages serves the generated self-contained `dist/index.html`.
