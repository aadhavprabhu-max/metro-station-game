# Phase 6 implementation and verification

## Approved routing and preservation

The original Phase 5 graph still comes from `createCompleteMetroNetwork()`. Phase 6 layers its additions on that graph. Existing node names/positions, all existing platform records, all six original line definitions, original link lengths and original curve control points are checked against a fresh Phase 5 graph. The original U5 sampler is also compared every half metre. Its direct service remains the default; the scenic service is an explicit journey choice. One U5 train operates the selected routing per game session, alongside U1–U4, U6 and U9.

The code survey confirmed the approved junctions on `u5-hafenbogen-ostbahnhof`:

| Junction | Original U5 distance | World position | Distance before Ostbahnhof |
| --- | ---: | --- | ---: |
| J-A split | 3907.675727 m | `(1.57, -24, -730)` | 250 m |
| J-B rejoin | 4057.675727 m | `(1.57, -24, -580)` | 100 m |

Both lie on the existing 303.43 m straight approach. The consist has three 16 m cars at 17 m spacing, giving a 50 m body length; junction protection uses a 28 m half-envelope. The station's own track starts 50 m before its stopping position. Neither approved junction nor an existing station was moved.

The scenic path is 9241.793333 m, with a surveyed minimum radius of approximately 297.55 m and a maximum gradient of 3.6%. Its approach throat is level at −24 m. Both bridge tracks and all three new U5 platforms are level at 0 m. The broad eastern loop keeps Uferpromenade a through-station and retains Ostbahnhof as U5's terminus. The approach arcs form an underground diamond protected by the same reservation as both turnouts. An occupied reservation denies conflicting trains, which brake before the home signal; release occurs only after the protected consist envelope clears. Route selection cannot change underneath a moving train.

As explicitly approved after comparing the supplied map with the source graph, U9 uses existing Nordklinikum and Waldtor as its lower interchange anchors; no southern U5 spur or new U5 terminus was invented. Its eight stopping positions form the southwest–south–east progression, with its last approach returning north to the fixed Waldtor position. U9's five new names are Kaiserforum, Goldmarkt, Sonnenviertel, Hohenbrück and Kronenplatz. All U9 platforms sit at −48 m. New stairs at Central, Nordklinikum and Waldtor connect physical platforms. The two non-aligned transfers use mezzanines twelve metres above the U9 floor so their corridors clear the actual station vaults.

## Architectural work

| New station | Roof and walls | Physical floor treatment |
| --- | --- | --- |
| Altstadtbrücke | Stone barrel/groin vaults, individual voussoirs and diagonal ribs, warm masonry bays | Quatrefoil medallions in diamond surrounds and inset borders |
| Uferpromenade | Open stone loggia, arched glazing, timber pitched roofs and integrated light bands | Transverse river-wave mosaic bands in polished stone |
| Steinbogen | Massive stone diaphragms under a high barrel vault, deep piers and inset lights | Ashlar runner with contrasting circular inlays |
| Kaiserforum | Tall fluted classical columns, entablatures, deep marble coffers and upper-wall arches | Opus-sectile marble diamonds |
| Goldmarkt | Continuous stone vault bays, warm stone arcades and suspended framed lanterns | Dense market mosaic pattern |
| Sonnenviertel | Continuous sculptural roof with separate curved fins, articulated wall relief and six deep daylight wells | Flowing terrazzo ribbons |
| Hohenbrück | Refined stone vault, paired voussoir ribs, detailed columns and restrained lighting | Chevron marble inlays |
| Kronenplatz | Three ribbed domes with actual apertures and solid pendentives; larger central crown | Compass roses and inset perimeter bands |

Central U9 has an octagonal lantern vault; Nordklinikum U9 uses porcelain/light arches; Waldtor U9 has a timber arch undercroft. Reused platform slabs, safety edges, tactile strips, rail gauge, boarding geometry and furniture collisions retain their original engineering dimensions. New floor finishes replace the default tiles rather than covering them with competing coplanar surfaces. Existing stations receive only the platform-end openings needed for the approved transfers.

The 400 m bridge has ten open stone arches, barrel soffits, separately modelled arch stones, projecting cutwaters, moulded parapets, sculptures and slate-roofed stone gateway turrets. It contains no exposed modern structural beams or enclosed bridge tunnel. Its parapet top is 0.12 m; standing first-person eyes in the carriage are about 1.85 m. Water is at −14 m. Three.js Water provides live planar reflections and animated procedural normals. Stone quays, terrain with surveyed railway cuttings, embankments, planted banks and village buildings ground the crossing in a river valley.

## Verification

- `node tests/expansion-mechanics.mjs`: original six-line outbound/return journeys, boarding/alighting and vehicle/rider alignment pass.
- `node tests/transfer-geometry-check.mjs`: the four original added interchanges retain supported, unobstructed walking paths and headroom.
- `node tests/phase6-mechanics.mjs`: existing graph/platform preservation; exact junction alignment; continuous three-dimensional paths; gradient/radius survey; U9's 15 outbound/return station visits and scenic U5's 25 visits; full car/bogie orientation; conflicting junction request stopping and resumption.
- `node tests/phase6-geometry.mjs`: actual assembled meshes, independently raycast. Eleven architectural platforms pass floor, ceiling and headroom probes; independent physical instance-layout fingerprints also confirm eleven distinct floor patterns; all three new transfer paths pass support and obstruction checks; 1540 rail probes pass; no loading-gauge obstructions. Four closed-window sightlines, on both sides of both bridge tracks, reach the water before any opaque obstruction.
- `tests/phase6.spec.js`: actual browser train meshes complete U9 and scenic U5 outbound/return journeys with boarding/alighting at every stop, closed doors while moving, accurate car/bogie orientation and rider attachment. All three U9 transfers support continuous walking both ways. Both bridge crossings render animated reflective water through closed train windows.
- `npx playwright test tests/metro.spec.js tests/train-engineering.spec.js --timeout=180000`: all ten existing regression cases pass, including real keyboard/touch controls, collision limits, reset/help/focus handling, independent doors, physical carriage floors and floor stability in rendered pixels.
- `node tests/phase6-inspect.mjs`: renders each of the eleven new architectural platforms, both first-person bridge crossings and an exterior bridge view for visual inspection. Inspection screenshots are written to `/tmp/phase6-qa/`.

Journey tests deliberately advance the normal service controller in controlled time steps; they are not claims that complete journeys were observed in real time. Browser screenshots use software WebGL on this machine. Hardware-accelerated WebGL 2 is recommended, as for the existing game. No quality settings were reduced to satisfy the new architecture.

The five Phase 6 browser cases also pass against the local standalone production build at the repository's actual Pages base path. Its HTTP response matches `dist/index.html` byte for byte.

The production build regenerates the standalone root and `dist` game. The existing GitHub Pages workflow builds and publishes `dist`; it is not replaced with a different hosting system. An added post-deployment job runs those five browser cases against the public URL returned by Pages and retains browser evidence. This provides public deployment verification from GitHub's runner because this task's executor network policy denies direct requests to the GitHub Pages domain.
