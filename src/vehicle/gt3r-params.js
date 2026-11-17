/**
 * Porsche 911 GT3 R (992) simulation parameters.
 *
 * Every value carries its provenance:
 *   PUBLISHED  – Porsche Motorsport data (racing.porsche.com, MY2026 press data; 51GT3 technical report).
 *   MEASURED   – measured from the supplied 3D model after its ×100 scale correction.
 *   ESTIMATED  – engineering estimate; not published. Typical of GT3-class cars, chosen before calibration.
 *   CALIBRATED – adjusted in tests/vehicle-physics.mjs against plausibility envelopes (never to make it easier).
 *
 * Model frame: +Y up, +Z forward (nose), +X left. Units: SI (m, kg, s, N, N·m, rad).
 */
export const GT3R = Object.freeze({
  name: 'Porsche 911 GT3 R (992)',
  // ── Mass properties ───────────────────────────────────────────────────────────
  mass: 1330,                 // ESTIMATED race mass with driver and part fuel. PUBLISHED: ≈1,250–1,265 kg dry, BoP-dependent.
  frontWeightShare: 0.42,     // ESTIMATED (rear-mounted flat six).
  cogHeight: 0.43,            // ESTIMATED, metres above the ground plane.
  inertia: { pitch: 1900, yaw: 2000, roll: 520 }, // ESTIMATED principal moments (kg·m²) about model X, Y and Z.
  // ── Geometry (MEASURED unless noted) ─────────────────────────────────────────
  wheelbase: 2.517,           // MEASURED 2.5166 m. PUBLISHED 2,507 mm (within 0.4 %).
  groundY: 0.02,              // MEASURED: tyre contact plane of the authored model (model units after ×100).
  // Hub centres in model coordinates, MEASURED from the tyre bounding boxes. The model's rear hubs are 15 mm
  // asymmetric (LR x 0.8345, RR x −0.8197: an authoring artifact that would make the car pull to one side), so the
  // physics uses the mean rear half-track 0.8271 m; the visual rig keeps every wheel at its measured position.
  wheels: [
    { id: 'LF', hub: [0.8411, 0.3605, 1.3013], radius: 0.3403, width: 0.334, front: true, left: true },   // tyre Ø 0.681 m; PUBLISHED 30/68-18 → 680 mm
    { id: 'RF', hub: [-0.8411, 0.3605, 1.3013], radius: 0.3403, width: 0.334, front: true, left: false },
    { id: 'LR', hub: [0.8271, 0.3746, -1.2153], radius: 0.3521, width: 0.354, front: false, left: true }, // tyre Ø 0.704 m; PUBLISHED 31/71-18 → 710 mm
    { id: 'RR', hub: [-0.8271, 0.3746, -1.2153], radius: 0.3521, width: 0.354, front: false, left: false },
  ],
  body: { center: [0.006, 0.62, 0], half: [1.02, 0.6, 2.37] }, // MEASURED envelope 2.049 × 1.254 × 4.768 m (simplified hull)
  // ── Suspension (ESTIMATED; ≈3.2 Hz ride frequency, typical for a GT3 car) ──────
  suspension: {
    staticLength: 0.15,       // geometric reference (hub to mount at static ride); not a physical part length
    bumpTravel: 0.055, droopTravel: 0.06,
    front: { spring: 115000, bump: 6200, rebound: 8500, antiRoll: 80000 },
    rear: { spring: 150000, bump: 8400, rebound: 11400, antiRoll: 55000 },
    bumpStop: 600000,
    wheelInertia: { front: 1.3, rear: 1.6 }, // kg·m² wheel+tyre+disc, ESTIMATED
  },
  // ── Tyres (ESTIMATED slick behaviour; similarity-method combined slip, Pacejka shape) ──
  tyre: {
    mu: 1.70, loadSensitivity: 0.10, nominalLoad: 4000,
    peakSlipRatio: 0.09, peakSlipAngle: 0.105, // tan(α) at peak ≈ 6°
    shapeC: 1.35,                             // sliding/peak ≈ 0.85
    relaxLong: 0.18, relaxLat: 0.45,          // relaxation lengths (m)
    rollingResistance: 0.012,
  },
  // ── Powertrain ────────────────────────────────────────────────────────────────
  engine: {
    // PUBLISHED: 4,194 cc flat six, ≈416 kW (565 hp). Torque-curve shape ESTIMATED, peak power matched (430 N·m @ 9,250 rpm ≈ 416 kW).
    torqueCurve: [[1000, 250], [3000, 380], [4500, 440], [6000, 470], [7500, 470], [8500, 455], [9250, 430], [9500, 400]],
    idleRpm: 1500, launchRpm: 4500, limitRpm: 9400,
    inertia: 0.18,            // ESTIMATED crank + flywheel + clutch
    frictionTorque: [40, 0.012], // ESTIMATED engine braking: a + b·rpm (N·m)
  },
  gearbox: {
    // PUBLISHED: six-speed sequential, rear-wheel drive. Ratios ESTIMATED for ≈291 km/h at the limiter in sixth.
    ratios: [2.80, 2.06, 1.68, 1.42, 1.23, 1.08], reverse: 3.2, final: 3.95,
    efficiency: 0.92, shiftTime: 0.05, upshiftRpm: 9050, downshiftRpm: 5200,
  },
  differential: { preload: 120, powerRamp: 0.45, coastRamp: 0.30 }, // ESTIMATED clutch-type LSD
  // ── Brakes (ESTIMATED capacity; bias adjustable, like the car's brake-bias control) ──
  brakes: { maxTorque: 10000, bias: 0.58, absSlip: 0.11, tcSlip: 0.10 },
  // ── Aerodynamics (ESTIMATED; not published) ──────────────────────────────────────
  aero: { dragArea: 0.95, liftArea: 3.1, frontBalance: 0.40, airDensity: 1.225 },
  // ── Steering (ESTIMATED) ────────────────────────────────────────────────────────
  steering: { maxAngle: 0.40, ackermann: 0.6, wheelRatio: 12 },
  // ── Collisions (CALIBRATED for plausibility) ───────────────────────────────────
  collision: { restitution: 0.15, friction: 0.45 },
});
