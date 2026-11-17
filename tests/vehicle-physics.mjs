// Vehicle physics tests (headless, deterministic). Synthetic test surfaces exist only here, never in the city.
//   node tests/vehicle-physics.mjs            (exits 1 on failure)
//   VEHICLE_REPORT=out.json node tests/vehicle-physics.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { VehiclePhysics, PHYSICS_HZ } from '../src/vehicle/vehicle-physics.js';
import { GT3R } from '../src/vehicle/gt3r-params.js';

class TestGround {
  constructor({ height = () => 0, colliders = [], grip = () => 1 } = {}) { this.h = height; this.colliders = colliders; this.grip = grip; }
  heightAt(x, z) { return this.h(x, z); }
  gripAt(x, z) { return this.grip(x, z); }
  forEachCollider(minX, minZ, maxX, maxZ, cb) { for (const r of this.colliders) if (r.maxX >= minX && r.minX <= maxX && r.maxZ >= minZ && r.minZ <= maxZ) cb(r); }
}
const flat = () => new TestGround();
const kmh = v => v / 3.6;
const deg = r => r * 180 / Math.PI;
const yawOf = car => Math.atan2(car.axes.z.x, car.axes.z.z);
const finite = car => [car.position.x, car.position.y, car.position.z, car.velocity.x, car.velocity.y, car.velocity.z, car.angularVelocity.y].every(Number.isFinite);
function make(ground = flat(), pose = { x: 0, z: 0, yaw: 0 }, aids = {}) { const car = new VehiclePhysics(GT3R, ground); car.reset(pose); Object.assign(car.aids, aids); return car; }
/** Drive with a frame rate; `control(t, car)` returns the input for that frame; `until(t, car)` stops early. */
function drive(car, seconds, control, { fps = 60, until = null, every = null } = {}) {
  const dt = 1 / fps; let t = 0;
  while (t < seconds - 1e-9) { car.setInput(control(t, car)); car.update(dt); t += dt; every?.(t, car); if (until?.(t, car)) break; assert.ok(finite(car), `state became non-finite at t=${t.toFixed(3)}`); }
  return t;
}
/** Hold a target speed with a simple throttle/brake controller (a test driver, not part of the car). */
const cruise = (target, steer = 0) => (t, car) => { const e = target - car.forwardSpeed; return { throttle: e > 0 ? Math.min(1, e * 0.6) : 0, brake: e < -0.5 ? Math.min(1, -e * 0.3) : 0, steer }; };
const report = {}, failures = [];
const check = (name, condition, detail) => { if (!condition) failures.push({ name, detail }); };

// 1. Stability at rest: settles without creep or jitter; static load split matches the CoG.
{
  const car = make(); const start = car.position.clone(); let maxV = 0;
  drive(car, 6, () => ({ throttle: 0, brake: 0, steer: 0 }), { every: (t, c) => { if (t > 1) maxV = Math.max(maxV, c.speed); } });
  const loads = car.wheels.map(w => w.load), front = (loads[0] + loads[1]) / loads.reduce((a, b) => a + b, 0);
  report.rest = { driftM: +car.position.clone().setY(0).distanceTo(start.clone().setY(0)).toFixed(5), heaveM: +(car.position.y - start.y).toFixed(4), maxSpeedAfter1s: +maxV.toFixed(5), frontLoadShare: +front.toFixed(3), allContact: car.wheels.every(w => w.contact) };
  check('rest: no creep', report.rest.driftM < 0.01, report.rest); check('rest: no jitter', maxV < 0.01, report.rest);
  check('rest: load split', Math.abs(front - GT3R.frontWeightShare) < 0.02, report.rest); check('rest: wheels on ground', report.rest.allContact, report.rest);
  check('rest: settles at authored ride height', Math.abs(report.rest.heaveM) < 0.01, report.rest);
}

// 2. Standing acceleration (aids on): 0–100, 0–200 km/h; straight-line stability.
{
  const car = make(); const marks = {}; let maxYaw = 0;
  drive(car, 25, () => ({ throttle: 1, brake: 0, steer: 0 }), { every: (t, c) => { const v = c.forwardSpeed * 3.6; for (const m of [100, 200]) if (v >= m && !marks[m]) marks[m] = +t.toFixed(2); maxYaw = Math.max(maxYaw, Math.abs(deg(yawOf(c)))); }, until: (t, c) => c.forwardSpeed * 3.6 > 205 });
  report.acceleration = { zeroTo100s: marks[100], zeroTo200s: marks[200], maxHeadingDeviationDeg: +maxYaw.toFixed(3), gearAt200: car.gear, rpm: Math.round(car.engine.rpm) };
  check('acceleration: 0-100 plausible (2.6–4.5 s)', marks[100] > 2.6 && marks[100] < 4.5, report.acceleration);
  check('acceleration: 0-200 plausible (6.5–13 s)', marks[200] > 6.5 && marks[200] < 13, report.acceleration);
  check('acceleration: straight', maxYaw < 1, report.acceleration);
}

// 3. Braking from 100 and 200 km/h with and without ABS: distances and stability.
const brakeTest = (from, abs) => {
  const car = make(flat(), { x: 0, z: 0, yaw: 0 }, { abs }); drive(car, 30, cruise(kmh(from)), { until: (t, c) => c.forwardSpeed >= kmh(from) });
  const z0 = car.position.z, yaw0 = yawOf(car); let peak = 0, t = 0;
  t = drive(car, 15, () => ({ throttle: 0, brake: 1, steer: 0 }), { every: (tt, c) => { peak = Math.max(peak, -c.acceleration.dot(c.axes.z) / 9.81); }, until: (tt, c) => c.forwardSpeed < 0.05 });
  return { from, abs, distanceM: +(car.position.z - z0).toFixed(2), timeS: +t.toFixed(2), peakDecelG: +peak.toFixed(2), yawChangeDeg: +Math.abs(deg(yawOf(car) - yaw0)).toFixed(2), lockedWheels: car.wheels.filter(w => w.omega === 0).length };
};
report.braking = [brakeTest(100, true), brakeTest(200, true), brakeTest(100, false)];
// Envelopes follow from the estimated slick grip (μ 1.6–1.8) plus downforce: 100-0 needs at least v²/(2·1.8g) ≈ 21.8 m
// without aero help, and less with it; the upper bounds allow for much weaker brakes than a GT3 car has.
check('braking: 100-0 distance plausible (19–40 m)', report.braking[0].distanceM > 19 && report.braking[0].distanceM < 40, report.braking[0]);
check('braking: 200-0 distance plausible (60–140 m)', report.braking[1].distanceM > 60 && report.braking[1].distanceM < 140, report.braking[1]);
check('braking: deceleration within tyre and aero limits (< 2.8 g)', report.braking.every(b => b.peakDecelG < 2.8), report.braking);
check('braking: stable with ABS', report.braking.slice(0, 2).every(b => b.yawChangeDeg < 3), report.braking);
check('braking: without ABS the wheels can lock', report.braking[2].distanceM >= report.braking[0].distanceM - 1, report.braking[2]);

// 4. Progressive braking: deceleration rises with the pedal.
{
  const car = make(); drive(car, 20, cruise(kmh(150)), { until: (t, c) => c.forwardSpeed >= kmh(150) });
  const samples = []; drive(car, 2, t => ({ throttle: 0, brake: t / 2, steer: 0 }), { every: (t, c) => { if (Math.round(t * 60) % 15 === 0) samples.push(+(-c.acceleration.dot(c.axes.z) / 9.81).toFixed(2)); } });
  // Below the grip limit deceleration follows the pedal; at the limit ABS holds a plateau, which then eases as speed
  // (and downforce) falls.
  const peakAt = samples.indexOf(Math.max(...samples));
  report.progressiveBraking = { decelGEvery250ms: samples, peakAtIndex: peakAt };
  check('progressive braking: rises with the pedal up to the limit', samples.slice(0, peakAt + 1).every((v, i) => i === 0 || v >= samples[i - 1] - 0.05), report.progressiveBraking);
  check('progressive braking: ABS holds a plateau after the limit', samples.slice(peakAt).every(v => v > 0.85 * samples[peakAt]), report.progressiveBraking);
}

// 5. Low-speed steering: full lock at ~10 km/h → turning circle.
{
  const car = make(); let minX = Infinity, maxX = -Infinity;
  drive(car, 14, cruise(kmh(10), 1), { every: (t, c) => { if (t > 4) { minX = Math.min(minX, c.position.x); maxX = Math.max(maxX, c.position.x); } } });
  const outer = car.wheels.reduce((m, w) => Math.max(m, Math.abs(w.hubLocal.x)), 0);
  report.lowSpeedSteering = { pathDiameterM: +(maxX - minX).toFixed(2), kerbToKerbEstimateM: +(maxX - minX + 2 * outer).toFixed(2), maxWheelAngleDeg: +deg(Math.max(...car.wheels.map(w => Math.abs(w.steer)))).toFixed(1) };
  check('low-speed steering: turning circle plausible (9–18 m)', report.lowSpeedSteering.pathDiameterM > 9 && report.lowSpeedSteering.pathDiameterM < 18, report.lowSpeedSteering);
}

// 6. Cornering and traction: steady state on a constant steer, increasing speed until the limit (skid pad).
{
  const car = make(); let peakG = 0, atSpeed = 0;
  // 0.25 steer (≈5.7° at the wheels, a ~25 m circle) so the tyres, not the steering lock, set the limit.
  drive(car, 40, (t, c) => ({ ...cruise(kmh(30 + t * 2.2), 0.25)(t, c) }), { every: (t, c) => { const g = Math.abs(c.acceleration.dot(c.axes.x)) / 9.81; if (t > 3 && g > peakG) { peakG = g; atSpeed = c.forwardSpeed * 3.6; } } });
  report.cornering = { peakLateralG: +peakG.toFixed(2), atKmh: +atSpeed.toFixed(0) };
  check('cornering: peak lateral grip plausible (1.3–2.6 g)', peakG > 1.3 && peakG < 2.6, report.cornering);
}

// 7. High-speed steering: step steer at 180 km/h; yaw-rate response and settling.
{
  const car = make(); drive(car, 30, cruise(kmh(180)), { until: (t, c) => c.forwardSpeed >= kmh(180) });
  const rates = []; drive(car, 3, (t, c) => ({ ...cruise(kmh(180), 0.06)(t, c) }), { every: (t, c) => rates.push([t, c.angularVelocity.y]) });
  const final = rates.slice(-30).reduce((s, [, r]) => s + r, 0) / 30, peak = Math.max(...rates.map(([, r]) => r)), t63 = rates.find(([, r]) => r >= 0.63 * final)?.[0];
  report.highSpeedSteering = { steadyYawRateDegS: +deg(final).toFixed(2), riseTime63S: +(t63 ?? NaN).toFixed(3), overshootPct: +((peak / final - 1) * 100).toFixed(1), lateralG: +(Math.abs(car.acceleration.dot(car.axes.x)) / 9.81).toFixed(2) };
  check('high-speed steering: responsive (<0.45 s)', t63 < 0.45, report.highSpeedSteering);
  check('high-speed steering: not instantaneous (>0.03 s)', t63 > 0.03, report.highSpeedSteering);
  check('high-speed steering: well damped (<35 % overshoot)', report.highSpeedSteering.overshootPct < 35, report.highSpeedSteering);
}

// 8. Suspension response: kerb strike, bumps, washboard, and a ramp hold.
{
  const kerb = new TestGround({ height: (x, z) => (z > 20 && z < 20.22 && x > 0 ? 0.054 : 0) + (z >= 20.22 && x > 0 ? 0.0 : 0) }); // a 54 mm kerb ridge under the left wheels
  const car = make(kerb); let maxAcc = 0, minLoad = Infinity;
  drive(car, 4, cruise(kmh(30)), { every: (t, c) => { maxAcc = Math.max(maxAcc, Math.abs(c.acceleration.y) / 9.81); if (c.position.z > 16) minLoad = Math.min(minLoad, ...c.wheels.map(w => w.load)); } });
  report.kerbStrike = { peakVerticalG: +maxAcc.toFixed(2), minWheelLoadN: Math.round(minLoad), finalAllContact: car.wheels.every(w => w.contact), yawDeg: +deg(yawOf(car)).toFixed(2) };
  check('kerb strike: bounded response', maxAcc < 6, report.kerbStrike); check('kerb strike: recovers', report.kerbStrike.finalAllContact && Math.abs(report.kerbStrike.yawDeg) < 3, report.kerbStrike);

  const bumps = new TestGround({ height: (x, z) => 0.03 * Math.max(0, Math.sin(z * Math.PI / 2)) });
  const c2 = make(bumps); let contact = 0, n = 0, heave = [];
  drive(c2, 6, cruise(kmh(60)), { every: (t, c) => { if (t > 2) { n++; contact += c.wheels.filter(w => w.contact).length / 4; heave.push(c.position.y); } } });
  const mean = heave.reduce((a, b) => a + b, 0) / heave.length, rms = Math.sqrt(heave.reduce((s, y) => s + (y - mean) ** 2, 0) / heave.length);
  report.bumps = { contactRatio: +(contact / n).toFixed(3), bodyHeaveRmsM: +rms.toFixed(4) };
  check('bumps: tyres stay on the road', contact / n > 0.85, report.bumps); check('bumps: body isolated', rms < 0.02, report.bumps);

  const wash = new TestGround({ height: (x, z) => 0.012 * Math.sin(z * Math.PI / 0.35) + 0.012 });
  const c3 = make(wash); let maxYawRate = 0; drive(c3, 4, cruise(kmh(90)), { every: (t, c) => { maxYawRate = Math.max(maxYawRate, Math.abs(c.angularVelocity.y)); } });
  report.washboard = { maxYawRateDegS: +deg(maxYawRate).toFixed(2), speedKmh: +(c3.forwardSpeed * 3.6).toFixed(1) };
  check('uneven surface: tracks straight', maxYawRate < 0.05, report.washboard);

  const ramp = new TestGround({ height: (x, z) => Math.max(0, z - 5) * 0.08 });
  const c4 = make(ramp); drive(c4, 12, cruise(kmh(20)), { until: (t, c) => c.position.z > 25 });
  const stop = () => ({ throttle: 0, brake: 1, steer: 0, autoReverse: false });
  drive(c4, 3, stop); // come to a stop first, then measure any creep while held
  const hold = c4.position.clone(); drive(c4, 5, stop);
  report.ramp = { gradePct: 8, holdCreepM: +c4.position.distanceTo(hold).toFixed(4), climbedM: +(c4.position.y).toFixed(2) };
  check('elevation: holds on an 8 % grade with the brake', report.ramp.holdCreepM < 0.05, report.ramp);
}

// 9. Collisions: wall at 10 and 30 m/s, a 0.24 m bollard at 30 m/s; no tunnelling, bounded rebound.
for (const [label, speed, rect] of [['wall10', 10, { minX: -20, maxX: 20, minZ: 40, maxZ: 41 }], ['wall30', 30, { minX: -20, maxX: 20, minZ: 80, maxZ: 81 }], ['bollard30', 30, { minX: -0.12, maxX: 0.12, minZ: 80, maxZ: 80.24 }]]) {
  const car = make(new TestGround({ colliders: [rect] })); let impactSpeed = 0, minVz = 0, maxW = 0;
  drive(car, 30, cruise(speed), { until: (t, c) => c.forwardSpeed >= speed - 0.2 && c.position.z > rect.minZ - 30 });
  if (car.position.z > rect.minZ - 30) { /* got there late; still valid */ }
  // Coast into the obstacle at speed.
  drive(car, 8, (t, c) => ({ throttle: t < 0.5 ? 0.6 : 0, brake: 0, steer: 0 }), { every: (t, c) => { if (!impactSpeed && c.collisions) impactSpeed = Math.abs(c.lastImpact); minVz = Math.min(minVz, c.velocity.z); maxW = Math.max(maxW, c.angularVelocity.length()); } });
  const frontZ = car.position.z + (car.hull.cz + car.hull.hz);
  report[label] = { impactMs: +impactSpeed.toFixed(2), reboundMs: +(-minVz).toFixed(2), maxAngularVelocity: +maxW.toFixed(2), noseZ: +frontZ.toFixed(2), obstacleZ: rect.minZ, finite: finite(car) };
  check(`${label}: collided`, car.collisions > 0, report[label]);
  check(`${label}: no tunnelling`, car.position.z < rect.minZ, report[label]);
  check(`${label}: bounded rebound`, -minVz < 0.35 * speed, report[label]);
  check(`${label}: stable`, maxW < 6 && finite(car), report[label]);
}

// 10. Traction loss and recovery (TC off): power oversteer, then lift and countersteer.
{
  const car = make(flat(), { x: 0, z: 0, yaw: 0 }, { tc: false }); drive(car, 20, cruise(kmh(60)), { until: (t, c) => c.forwardSpeed >= kmh(60) });
  car.shift(-1); car.shift(-1); // second gear
  let maxSlip = 0, maxBeta = 0;
  drive(car, 1.6, () => ({ throttle: 1, brake: 0, steer: 0.35 }), { every: (t, c) => { maxSlip = Math.max(maxSlip, ...c.wheels.filter(w => !w.front).map(w => Math.abs(w.slipRatio ?? 0))); maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.velocity.dot(c.axes.x), c.velocity.dot(c.axes.z)))); } });
  const lost = { rearSlip: +maxSlip.toFixed(2), bodySlipDeg: +deg(maxBeta).toFixed(1) };
  // Recovery: lift and countersteer proportionally to the slide (a simple driver).
  let recovered = null, spunOut = false; const yaw0 = yawOf(car);
  drive(car, 5, (t, c) => { const beta = Math.atan2(c.velocity.dot(c.axes.x), Math.max(0.5, c.velocity.dot(c.axes.z))); return { throttle: 0.15, brake: 0, steer: Math.max(-1, Math.min(1, beta * 2.5 - c.angularVelocity.y * 0.15)) }; },
    { every: (t, c) => { const beta = Math.abs(Math.atan2(c.velocity.dot(c.axes.x), c.velocity.dot(c.axes.z))); if (recovered === null && beta < 0.035 && Math.abs(c.angularVelocity.y) < 0.15) recovered = +t.toFixed(2); if (Math.abs(yawOf(c) - yaw0) > Math.PI * 0.9) spunOut = true; } });
  report.tractionLossRecovery = { lost, recoveredAfterS: recovered, spunOut };
  check('traction: power oversteer happens with TC off', maxSlip > 0.15 || maxBeta > 0.06, report.tractionLossRecovery);
  check('traction: recoverable', recovered !== null && recovered < 4 && !spunOut, report.tractionLossRecovery);
  // With TC on the same input keeps rear slip near target.
  const tc = make(); drive(tc, 20, cruise(kmh(60)), { until: (t, c) => c.forwardSpeed >= kmh(60) }); tc.shift(-1); tc.shift(-1); let tcSlip = 0;
  drive(tc, 1.6, () => ({ throttle: 1, brake: 0, steer: 0.35 }), { every: (t, c) => { if (t > 0.5) tcSlip = Math.max(tcSlip, ...c.wheels.filter(w => !w.front).map(w => Math.abs(w.slipRatio ?? 0))); } });
  report.tractionLossRecovery.withTcRearSlip = +tcSlip.toFixed(2);
}

// 11. Frame-rate independence: the same manoeuvre at 30, 60 and 144 Hz display rates.
{
  const plan = t => ({ throttle: t < 3 ? 1 : 0.3, brake: t >= 4.5 && t < 5.5 ? 0.6 : 0, steer: t >= 2 && t < 4 ? 0.2 : t >= 4 ? -0.1 : 0 });
  const runs = [30, 60, 144].map(fps => { const car = make(); const dt = 1 / fps, n = Math.round(6 * fps); for (let i = 0; i < n; i++) { car.setInput(plan(i * dt + 1e-9)); car.update(dt); } return { fps, x: car.position.x, z: car.position.z, v: car.forwardSpeed, yaw: yawOf(car), steps: car.steps }; });
  const spread = k => Math.max(...runs.map(r => r[k])) - Math.min(...runs.map(r => r[k]));
  report.frameRateIndependence = { runs: runs.map(r => ({ fps: r.fps, x: +r.x.toFixed(4), z: +r.z.toFixed(4), speed: +r.v.toFixed(4), steps: r.steps })), spreadM: +Math.hypot(spread('x'), spread('z')).toFixed(4), speedSpread: +spread('v').toFixed(4) };
  check('frame-rate independence', report.frameRateIndependence.spreadM < 0.05 && report.frameRateIndependence.speedSpread < 0.02, report.frameRateIndependence);
}

// 12. Cost: physics time per simulated second (CPU).
{
  const car = make(); const t0 = performance.now(); drive(car, 10, cruise(kmh(120), 0.03)); const ms = performance.now() - t0;
  report.cost = { msPerSimulatedSecond: +(ms / 10).toFixed(2), stepsPerSecond: PHYSICS_HZ, msPer60HzFrame: +(ms / 600).toFixed(3) };
  check('cost: under 1 ms per 60 Hz frame', ms / 600 < 1, report.cost);
}

report.failures = failures;
if (process.env.VEHICLE_REPORT) await writeFile(process.env.VEHICLE_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) { console.error(`${failures.length} vehicle physics check(s) failed:`); for (const f of failures) console.error(' -', f.name); process.exitCode = 1; }
