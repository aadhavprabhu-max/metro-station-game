# Central U4 old town: Mediterranean restyle

Restyle of the built-up part of the Central U4 surface district toward a stylized,
sunlit Mediterranean hill town. All geometry and textures are generated in code
(no imported assets). Images `01`–`08` are before/after pairs from identical
camera poses (`main` build vs. this branch's build); `09`–`16` show new areas and details.

## What changed

| Area | Change |
| --- | --- |
| Sky and light | Deep-blue gradient sky dome with a pale horizon haze and sun glow; warm, harder sun at a lower angle; cool sky fill; slightly brighter exposure. Applied only while the street is active and restored exactly on return underground (verified: 0 differing pixels on the Central U4 platform). |
| Houses | Each plot becomes a terrace of tall, narrow houses (split along the street and back-to-back on deep plots), 2–4 floors. Neighbours never share a colour or a height. Bold stucco palette (ochre, terracotta, rose, mint, powder blue, cream, apricot, lemon, limewash) with a rough plaster texture and bump. |
| Facades | White stone window surrounds with chunky sills and lintels; green, blue, teal and grey-blue louvred shutters (open, closed or single); barred ground-floor windows; plinths, string courses and quoins; panelled doors in white surrounds with stone doorsteps. |
| Details | Wrought-iron balconies on corbelled slabs, flower boxes, wall lanterns, potted geraniums, climbing bougainvillea, chimneys, gutters and downpipes, shop awnings. |
| Roofs | Low hip or gable roofs in terracotta barrel tile with deep eaves, tile-end edges, ridge caps and brown gutters. |
| Ground | Irregular flagstone lanes with grass in the joints, grass verges at house bases, herringbone brick squares with dark joints and pale stone kerbs. |
| Greenery and props | Palms, citrus trees (planted and potted), stone planters with bougainvillea, café tables under striped parasols, slatted benches, cast-iron lamp posts, fountains, bunting over streets and squares, washing lines across the narrow lanes. |
| Extension | District bounds extended north from z = −92 to z = −50: a new upper lane, a new terrace of houses and **Lemon square** with fountain, cafés and a stair up to an "upper town" terrace. The walking loop now includes Upper lane → Lemon square. Non-walkable backdrop terraces ring the perimeter so streets end in more town, not void. |

## What did not change

Stations, tunnels, trains, schedules, physics, the arch/stair hall (its materials are untouched),
the canal and bridge layout, the HUD. House collision footprints are the original plot rectangles.
New freestanding props (cafés, planters, potted trees, door pots, benches, lamps, fountains) have
small colliders placed clear of every walking route. The extension stays south of z = −44,
where an underground station's glass roof reaches y = 9.9.

## Cost

Central square pose, 1280×800, including the shadow pass:

| | Draw calls | Triangles |
| --- | --- | --- |
| Before | 261 | 0.93 M |
| After | 416 | 1.78 M |

About 120 of those calls are the underground line worlds, which already render while on the
street. Window glass, lantern glass, gutters, ropes and grass verges don't cast shadows, and
house details are instanced and merged per material in two north/south bands.

## Code

- `src/city-textures.js`: procedural canvas textures (plaster, barrel tiles, flagstones, herringbone, louvres, glazing, doors, railings, flowers, grass, stripes, palm bark).
- `src/city-buildings.js`: materials, the terrace/house builder, roofs and the restyled clock tower.
- `src/city-props.js`: palms, citrus, bougainvillea, cafés, planters, bunting, washing lines, lamps, benches, pots.
- `src/city-layout.js`: extended bounds, northern plots and routes, square outlines.
- `src/surface-world.js`: sky dome, daylight grade, ground finishes, prop placement and backdrop terraces.
