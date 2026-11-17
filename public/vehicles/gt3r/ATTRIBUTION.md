# Porsche 911 GT3 R (992) model — attribution and licence

**Source model:** "2024 Porsche 992 GT3 R" by Dave Love SketchFab (https://sketchfab.com/Tyler_Dave)
https://sketchfab.com/3d-models/2024-porsche-992-gt3-r-b76c9b2ae2d548c3869426eac4ab8a19

**Licence applied in this project: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**
https://creativecommons.org/licenses/by-nc-sa/4.0/

The project owner identified the model's licence as CC BY-NC-SA 4.0. The `license.txt` that came inside the
downloaded archive is kept here unchanged; it states CC-BY-4.0. Where the two differ, this project applies the
more restrictive CC BY-NC-SA 4.0 terms to the model and to the derived file `gt3r.glb`:

- **Attribution:** credit the author as above, wherever the game or this model is shared.
- **NonCommercial:** the model and `gt3r.glb` must not be used for commercial purposes.
- **ShareAlike:** `gt3r.glb` is an adaptation and is distributed under the same licence (CC BY-NC-SA 4.0).

## Changes made to the original (adaptation notice)
`gt3r.glb` was produced from the original `scene.gltf` by `scripts/optimize-gt3r.mjs`:
1. Unit correction: the original root node scaled metre data by 0.01; the model is now in metres (×100).
2. Identical materials and textures merged; unused data removed; vertices welded.
3. An additional simplified copy of the cockpit (`COCKPIT_LOD1`, about 37 % of its triangles) is shown only from
   outside the car beyond 4 m. The full original cockpit is kept and shown in the cockpit view and up close.
4. Textures re-encoded as WebP at their original resolution (normal maps lossless).
5. Geometry compressed with meshopt (`EXT_meshopt_compression`).

No other geometry, materials or livery were changed. Visual comparison against the original:
`docs/driving/stage2/compare/`.

Porsche and the names, logos and livery shown on the model are trademarks of their respective owners. The model
licence does not grant any trademark rights.
