# Aurealis-Bahn — Phase 5

Phase 5 completes U1, U2 and U3 to seven playable stations each, bringing the existing six-line game to 37 shared station nodes and 44 physical platforms. The ten added names were explicitly approved in this chat. Their architecture is new work; it is not presented as a recovered historical expansion.

## Routes and connections

| Line | Complete outbound stopping order | Route distances (metres) |
| --- | --- | --- |
| U1 | Nordplatz → Central → Rosenheimer Platz → Lindenallee → Universitätsviertel → Botanischer Garten → Ostgärten | 0, 240, 480, 960, 1320, 1680, 2040 |
| U2 | Stadtzentrum → Rathausmarkt → Central → Kupfergasse → Schwarzkopf-Tunnel → Stahlhof → Eisenwerk | 0, 120, 240, 360, 480, 600, 720 |
| U3 | Schattenufer → Central → Ostbahnhof → Stadtbrücke → Museumsinsel → Kanalpark → Seetor | 0, 390, 630, 870, 1230, 1590, 1950 |

U1 adds four connecting rail/tunnel sections after Rosenheimer Platz: 480, 360, 360 and 360 m between station centres. Its new rail/platform anchors remain at x = 1.57, y = 0, with z = −960, −1320, −1680 and −2040.

U2 replaces each existing 240 m link with two 120 m links. The three infill anchors are x = −23.57, y = 0, z = −120, −360 and −600. The original endpoints and all existing stations stay in place. This deliberately preserves the compact game scale and the Stadtzentrum/U6 interchange. The 88 m platforms leave 32 m between standard portals and 26 m beside Schwarzkopf's 50 m rock portals. Existing 100 m station rail sections leave positive 20 m connecting rail sections. There are no duplicate bypass links.

U3 adds three 360 m sections after Stadtbrücke. Its new anchors remain at x = 1.57, y = −12, z = −1080, −1440 and −1800. Route distances include the original 390 m first leg. These extensions continue the established straight corridors without moving shared platforms or changing U5/U6 curves.

Rosenheimer Platz and Stadtbrücke become through-stations. The existing station builder opens their track portals because they are no longer route endpoints. Reversal and destination logic use Ostgärten and Seetor as the new termini. Every stop has an actual platform, connected rails/tunnels, collisions, signs, departure boards, boarding/alighting and live onboard information.

## New station architecture

| Station | Implemented identity |
| --- | --- |
| Lindenallee | Green ceramic walls, slim portal structure and continuous ceiling lighting |
| Universitätsviertel | Folded concrete plates, ridge beams and illuminated ridge slots |
| Botanischer Garten | Glazed roof, timber pergola baffles, green ceramic reliefs and planting beyond the service ledge |
| Ostgärten | Double-pitch glazed terminus canopy and cycle stands beyond the public platform |
| Rathausmarkt | Warm civic stone palette and deep bronze ceiling coffers |
| Kupfergasse | Copper-coloured brick vault with expressed masonry ribs |
| Stahlhof | Blue-grey steel portal trusses and industrial wall panels |
| Museumsinsel | Pale gallery hall with deep ceiling coffers and restrained terracotta accents |
| Kanalpark | Teal ceramic walls, round columns and concave ceiling modules |
| Seetor | Extruded wave ribs, following light strips and a luminous ceiling |

The two new roof builders are isolated branches in the existing station-family implementation. Other stations reuse existing platform, track, furniture, collision and lighting systems with explicit architecture configurations. No external assets or dependencies were added.

## Preserved infrastructure

- All existing station names, node objects and platform poses remain intact.
- U4, U5 and U6 retain exactly the same route, platform and link data, including U5/U6 path control points.
- Central retains its shared node, upper U1/U2 passage, lower U3/U4 passage and four-flight U1/U3 staircase. Golden Hive remains on the lower U3/U4 platforms.
- Stadtzentrum's Glass Cathedral, Schwarzkopf's rock hall, Eisenwerk's steel structure and the existing U3 landmarks remain intact.
- Westbahnhof/U4–U5, Ostbahnhof/U3–U5, Stadtzentrum/U2–U6 and Arabellapark/U4–U6 transfers remain functional.
- Train models, repaired floors, interiors, movement settings, door interlocks, announcements, player controls and GitHub Pages configuration are retained.
- The original four-line graph remains available through `?network=original` for existing regression fixtures. The default game loads Phase 5 through the same engine.

## Validation

- Production build: passed. The standalone root HTML, `dist/index.html` and served `/metro-station-game/` response match SHA-256 `d639ee05c3bc6052307297d4d226b5fd062079853f444bea12ea5eadadae73c5`. Both modular production assets also return their correct JavaScript/CSS content types under the GitHub Pages base path. The preview was mounted with `--base /metro-station-game/` to reproduce that hosting layout.
- Baseline mechanics: the saved pre-change source passed its existing full six-line mechanics check.
- Updated mechanics: passed all six round trips: 82 station visits, 328 boardings and 322 exits. Maximum sampled wheel-to-rail error remained below 4.3 mm. Assertions also verify preserved U4–U6 data, existing node identity/platform poses, seven-stop distances, idempotent expansion and absence of orphan track links.
- Actual mesh checks: passed 2,034 rail probes, including joins, and 324 train-portal probes against the assembled six-line geometry with Central and the U5/U6 transfer structures included. Both former termini are open. All ten new stations have finite geometry, unit normals and clear walking aisles; the three lower ceilings stay below the upper railway envelope.
- Transfer geometry: passed against 5,151 physical meshes and 2,423 headroom probes across the four U5/U6 transfer paths. Corrected the existing check's material filter: Three.js gives ordinary materials a positive emissive intensity even when their emissive colour is black. The old filter excluded all solid meshes. The check now includes those meshes and requires a nonempty inspected set.
- Full Playwright suite: all 51 cases passed in one complete run (20.1 minutes, exit code 0), with no failures, skips or retries. This includes the 49 existing cases plus two new cases for visible landmark roofs and keyboard transfers through Central in the completed network. Only the expected expanded station orders/counts changed in existing browser tests; their safety, boarding, journey and display assertions remain. The raw standalone HTML also passed with all external requests blocked.
- Visual inspection: examined actual browser renders of all ten new stations. Dedicated hide/restore pixel checks passed for Universitätsviertel and Seetor.
- Normal-animation production ride: passed from Stadtzentrum to Rathausmarkt at the GitHub Pages base path. Real keyboard input boarded and alighted; the existing `requestDeparture()` API started departure. The normal animation loop then carried the rider, stopped at exactly 120 m with speed 0, opened the platform-side doors and allowed a safe exit onto Rathausmarkt. No scripted simulation steps were used during the journey. The inspection took 137.9 wall-clock seconds under software WebGL and reported no JavaScript errors, failed requests or WebGL errors. Arrival and platform screenshots were visually inspected.

Commands:

```sh
node tests/expansion-mechanics.mjs
node tests/phase5-geometry.mjs
node tests/transfer-geometry-check.mjs
npm run build
npm test -- --timeout=180000 --output=/tmp/metro-phase5-playwright
```

The 180-second default test budget accommodates software WebGL without changing assertions or simulation settings. Journey tests advance the real controller in small scripted steps; they are not evidence of complete journeys at normal animation speed on hardware GPUs.

Evidence in this environment: `/tmp/metro-phase5-geometry.json`, `/tmp/metro-transfer-geometry.json`, `/tmp/metro-phase5-production.json`, `/tmp/metro-phase5-live/`, and `/tmp/metro-phase5-playwright/`.

## Files changed

- `src/network.js`: ten station definitions, focused graph extension/infill and default integration.
- `src/station-config.js`: ten architecture definitions and two new roof families.
- `src/station-families.js`: folded and wave ceilings with their structural support and lighting.
- `src/scene.js`: current network assembly comment.
- `app.html`: initial U1 destination updated to Ostgärten.
- `index.html`: regenerated standalone game.
- `tests/expansion-mechanics.mjs`: expanded routes and protected-data assertions.
- `tests/expansion.spec.js`: expanded orders/counts, new roof and Central transfer checks.
- `tests/transfer-geometry-check.mjs`: new totals and corrected physical-mesh filtering.
- `tests/phase5-geometry.mjs`: new independent physical rail, portal and station geometry checks.
- `README.md`: current routes, architecture, validation commands and historical-fixture clarification.
- `PHASE5_REPORT.md`: this implementation and validation record.

## Limits

The existing non-fatal Vite bundle-size advisory remains. Hardware-GPU performance and audible native speech have not been measured in this cloud environment. Deployment uses the existing GitHub Pages workflow; GitHub Actions records its publication outcome.
