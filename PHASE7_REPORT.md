# Phase 7 — U10 Airport Express

Phase 7 adds U10 to the current Phase 6 game, retaining U1–U6, U9, the original U5 direct route and the protected U5 scenic river loop. The full game has 53 shared station nodes, 65 physical platforms and eight independent services.

## Preservation and surveyed alignment

Initial local inspection used branch `work`, commit `f434dedaafc24df70698b65b900f052531ff1329`, with a clean working tree. Deployment inspection found newer Phase 6 work on `main` at `ff546e3bc51b418c827f0b35d9c923b66d8f9a8e`; that work was integrated before delivery. The regression fixtures preserve both snapshots.

U9 already occupies Central at −48 m. U10 therefore uses −72 m underground platforms, a separate eastern corridor, and a 3.1 km eased climb to +26 m. Its outdoor corridor is at approximately z=−5800 m. No established station or railway was moved. Maximum gradient is 3.537906%; route length is 11,580.992966 m. New rail geometry and the train share the same three-dimensional arc-length sampler.

## Stations and architecture

| Station | Classification | Architecture / connections |
|---|---|---|
| Central | Indoor, underground | Limestone, bronze coffers and blue express wayfinding. Direct physical transfer to U9; existing U9–U3 stairs and Central passages/stairs connect U1/U2/U3/U4. |
| Finanzforum | Indoor, underground | Bronze fins, deep coffers and pale stone business-district hall. |
| Ringplatz | Indoor, underground | Circular suspended ceiling structures; physical stairs and lift to the existing U6 platform, 36 m above. |
| Eastend | Indoor, underground | Concrete barrel vault, exposed ribs and ceramic accents before the long climb. |
| Skylinequartier | Outdoor, elevated | Separate cantilever canopy segments, exposed sky and fully open platform sides. |
| Metropolbrücke | Outdoor, elevated | Expressed steel cross-bracing, partial butterfly roofs and metropolitan views. |
| East Botanical Garden | Indoor, enclosed elevated | Arched steel/glass conservatory, deep lattice ribs, lush planted terraces and an accessible garden path. |
| Europaplatz | Outdoor, elevated | Timber canopy, exposed structure, canopy gaps and open sides. |
| Flughafenpark | Outdoor, elevated | Partial lightweight shelter, airport business district and open views. |
| Aurealis International Airport | Indoor, enclosed elevated | Glazed railway hall connected by a supported public concourse to a substantial two-level airport terminal. |

**Distribution: 4 outdoor / 6 indoor = exactly 40% / 60%.** Transparent enclosing walls at East Botanical Garden do not count as outdoor. All four outdoor stations passed actual upward and sideward ray probes with zero enclosing obstructions.

Aurealis International Airport is a new destination, separate from U5 Flughafen. It includes a supported arrivals podium, long-span departures roof, check-in counters, seating, signage, concourses, gates, jet bridges, aprons, runway markings, a control tower, access roads and static aircraft. It does not introduce flight simulation or airport operations gameplay.

## East Botanical Garden

The conservatory includes 45 modelled deciduous and evergreen trees and nine botanical species representations: Quercus robur, Magnolia grandiflora, Picea abies, Rhododendron, Dryopteris filix-mas, Miscanthus sinensis, Hedera helix, Pachysandra terminalis and Echinacea purpurea. Individual trunks, roots, branches, twigs, curved leaves, fern leaflets, grass blades, petals and flower centres use actual geometry. The planting includes 165,287 leaf placements with deterministic variation; nearby and distant leaves use spatial LOD. Ground cover has actual low rosettes above the planted substrate.

Plant beds, platform-side shrubs, flowering plants, hanging vines, water features, stone paths and exterior terraces extend the landscape beyond the railway hall. Plants are not substituted by photographs, green building surfaces or generic cube foliage. Raised planted beds and supports have collision boundaries outside the clear boarding aisle.

## Train and vertical circulation

The original Aurealis E10 train has two 4.45 m tapered noses, curved panoramic windscreens with real openings behind the glazing, original white/silver/deep-blue branding, streamlined roof fairings, bogies, equipment and luggage fittings. Its three-car consist is approximately 56 m long and fits the existing 88 m platform convention. It uses the production TrainService, door integration, boarding interfaces, passenger information and reversal rules. U10-only service speed is 22 m/s; existing services retain their established settings.

U10 cars and bogies use full path orientation on curves and grades. Actual mesh journeys test car, bogie and rider attachment. Body clearance is also checked against rendered railway/station geometry.

Central uses the existing U3→U9 transfer followed by a new U9→U10 connection at U9’s opposite platform end. The new connection drops 24 m with eight stair flights, two continuously moving lift stages and a mezzanine. Ringplatz drops 36 m using twelve stair flights and a through lift. Eight additional U10 entrances have physical stairs, supported forecourts and lifts. Use the contextual lift button to call or ride a lift. New U9 and U6 platform-end apertures are the narrow architecture changes required by those transfers; established floors, roofs, track alignments and other architecture remain intact.

## Measured timetable

Times below are observed by running the production TrainService and production TrainCar door integration at 1/60-second steps. The actual rendered train is separately run through all 18 legs and compared against these timestamps. Dwell durations are observed from controller state transitions. No distance/speed estimate is used to populate this timetable.

### Central → Aurealis International Airport

- Central → Finanzforum = 43.95 seconds
- Finanzforum → Ringplatz = 62.15 seconds
- Ringplatz → Eastend = 66.77 seconds
- Eastend → Skylinequartier = 163.20 seconds
- Skylinequartier → Metropolbrücke = 101.43 seconds
- Metropolbrücke → East Botanical Garden = 67.68 seconds
- East Botanical Garden → Europaplatz = 63.13 seconds
- Europaplatz → Flughafenpark = 76.77 seconds
- Flughafenpark → Aurealis International Airport = 81.32 seconds

Running time: **726.40 seconds**. Eight intermediate boarding dwells total **160.00 seconds**. Observed stop/door/departure sequences add **32.27 seconds**. Total one-way time: **918.67 seconds**.

### Aurealis International Airport → Central

- Aurealis International Airport → Flughafenpark = 81.32 seconds
- Flughafenpark → Europaplatz = 76.77 seconds
- Europaplatz → East Botanical Garden = 63.13 seconds
- East Botanical Garden → Metropolbrücke = 67.68 seconds
- Metropolbrücke → Skylinequartier = 101.43 seconds
- Skylinequartier → Eastend = 163.20 seconds
- Eastend → Ringplatz = 66.77 seconds
- Ringplatz → Finanzforum = 62.15 seconds
- Finanzforum → Central = 43.95 seconds

Running time: **726.40 seconds**. Eight intermediate boarding dwells total **160.00 seconds**. Observed stop/door/departure sequences add **32.27 seconds**. Total one-way time: **918.67 seconds**.

One train operates the complete U10 return service. Its measured same-direction departure interval is **1885.40 seconds** (1.9094 departures/hour in each direction). For uniformly timed passenger arrivals, mean waiting time is **942.70 seconds**, and maximum scheduled wait is **1885.40 seconds**. These are consequences of the implemented service frequency, not an assumed airport timetable.

The U10 journey-times button opens both complete direction tables, intermediate dwell records and a station selector showing both applicable departure directions. Live waiting values use the measured repeating service schedule and resynchronise to observed departures. Values are simulation seconds; slow software rendering does not establish wall-clock journey performance.

## City and performance

The metropolitan region contains 12,989 three-dimensional buildings over a 22.5 × 17.5 km generation area, including 1,108 detailed/infill buildings. Neighbourhoods combine mid-rise European blocks, pitched roofs, cornices, window bays, office towers, setbacks, roof equipment, streets, pavements, road markings, streetlights and the botanical landscape.

Basic facades/roofs share regional instance buffers. Nearby windows and equipment use LOD; glass panes use their actual visible surfaces instead of hidden box faces. Distant districts remain real geometry. Rail detail is culled by distance while a continuous structural viaduct and its actual piers remain visible farther away. Materials and geometry are shared; foliage uses spatial leaf LOD. The outdoor camera reaches 8.5 km, with atmospheric fog from 1.1–7 km. Exposure/fog transition smoothly as U10 emerges from the cutting. Existing underground and Phase 6 river-view settings restore on changing lines.

Hardware-GPU frame rate has not been measured. Software WebGL validation must run sequentially in this 8 GB container: an attempted concurrent browser inspection/regression run exhausted memory and lost a graphics context. The sequential focused U10 browser run passed. The full browser suite and final focused U10 suite passed sequentially. Deployment provenance is recorded below after the public verification job completes.

## Validation

- Pre-change six-line browser baseline: **51 passed** (15.7 minutes).
- `node tests/expansion-mechanics.mjs`: passed.
- `node tests/phase5-geometry.mjs`: passed.
- `node tests/transfer-geometry-check.mjs`: passed.
- `node tests/phase6-mechanics.mjs`: passed, including U9 and both U5 variants.
- `node tests/phase6-geometry.mjs`: passed.
- `node tests/u10-mechanics.mjs`: passed; protects all 45 Phase 6 station nodes, 55 platforms, 45 links and seven existing line definitions.
- `node tests/u10-geometry.mjs`: passed; 2,124 rail probes, 3,186 train-pose probes, 848 body-envelope clearance probes, all ten stair routes, lift-door openings, airport floor support and four open-air station probes.
- Focused U10 production browser run: **5 passed** (38.2 seconds), including lift rides, reset during a moving lift, measured actual-mesh journeys and restoration of Phase 6 rendering. An earlier diagnostic found and repaired a lift arrival rounding issue.
- Twelve-view in-game visual inspection: no JavaScript errors, failed requests or WebGL errors. Diagnostic cameras and extended photo dwell are labelled inspection tools; they are not real-time journeys.
- Full browser suite: **61 passed** (16.6 minutes). After the final U10-only lift-reset/end-glazing changes, the focused production U10 suite passed **5/5** (38.2 seconds).
- Production build: passed; only the existing large-bundle advisory remains.
- `node tests/u10-standalone.mjs`: passed with all external requests blocked; eight services, 53 nodes, U10 selection at −72 m, keyboard movement, reset and all 18 timing rows verified, with zero runtime/WebGL errors.
- Standalone static verification: passed; root and dist HTML are identical and have no external script or stylesheet dependencies.
- Standalone SHA-256: `503af40e5a3cf895926cfce45bd0c386f13920c30744384df0e7931438fdd18d`.

## Files

New application modules: `src/u10-network.js`, `src/u10-path.js`, `src/u10-world.js`, `src/u10-stations.js`, `src/u10-train.js`, `src/u10-train-cab.js`, `src/u10-timetable.js`, `src/metropolitan-city.js`, `src/botanical-vegetation.js`, `src/international-airport.js`, `src/transfer-lift.js`.

Existing Phase 6 application integration: `src/scene.js`, `src/main.js`, `src/network-world.js`, `src/network-transfers.js`, `src/train.js`, `src/ui.js`, `src/visibility.js`, `src/style.css`, `app.html`; regenerated `index.html`. Existing `network.js`, `service.js`, `player.js` and Phase 6 station/world modules remain as on the preserved Phase 6 main branch.

Validation/documentation: `tests/u10.spec.js`, `tests/u10-mechanics.mjs`, `tests/u10-geometry.mjs`, `tests/u10-inspect.mjs`, `tests/u10-standalone.mjs`, baseline network fixtures, explicit historical fixtures in `tests/expansion.spec.js` and `tests/phase6.spec.js`, `README.md`, this report. The established Pages verification job now checks Phase 6 and U10 against the actual public deployment and compares its HTML hash with the committed build. No dependency or lockfile changes.

## Deployment

PENDING final regression and deployment. The managed workspace blocks direct requests to the public GitHub Pages hostname; the established GitHub Actions verification job opens that actual URL, exercises the published game, compares its SHA-256 with the committed standalone build and retains screenshots/provenance. Public success will be reported only after that job passes.

Local launch: `npm ci && npm run dev`; open `/app.html?line=U10`. Production preview: `npm run build && npm run preview`; open `/metro-station-game/?line=U10` on the displayed local server. These are local launch instructions, not public deployment links.
