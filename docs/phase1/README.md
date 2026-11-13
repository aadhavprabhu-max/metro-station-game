# Phase 1 review evidence

Read `../../PHASE1_REPORT.md` for the complete scope, validation results, limitations and manual visit instructions.

- `preservation.json`: exact branch/baseline and SHA-256 hashes of 119 unchanged original tracked files. The original `work` branch is retained.
- `validation.json` and `test-logs/`: browser and CPU check results. The full frozen-feature run had 84 passes and one failure; the unchanged failed case subsequently passed. Final focused source checks are recorded separately.
- `performance.json`: matched baseline/Phase 1 raw samples at 960 × 600, DPR 1, Chromium/SwiftShader. Fixed-camera rendering uses 25 warmups and 21 timed samples. Simulation updates are measured separately. These are not hardware-GPU FPS measurements.
- `underground-pixel-comparison.json`: final scene-only pixel comparisons at three existing station views; all have zero changed pixels.
- `updated-city.png`: final fixed-camera entrance view, captured from the preserved WebGL drawing buffer. It excludes the DOM HUD.

The generated standalone HTML used for measurement is identified by SHA-256 in `performance.json`. New buildings and the entrance are original procedural game geometry; no photorealistic assets or additional dependencies were introduced.

The supplementary ordinary-animation tour is explicitly **partial**: see `normal-walk-partial.json` and its JSONL progress log. It completed the full ascent and surface entry but was stopped for handoff before the normal-animation descent. The complete two-way traversal passed the separate keyboard/mouse tests. `normal-ascent-stairs.png` and `normal-entrance.png` were captured during the genuine input walk at 640 × 400; no diagnostic player repositioning was used. Hardware-GPU performance and a complete normal-speed visual tour remain manual acceptance work.
