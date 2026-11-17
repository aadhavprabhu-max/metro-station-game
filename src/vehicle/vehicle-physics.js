import * as THREE from 'three';

/**
 * Rigid-body vehicle with four independent raycast suspensions, transient (relaxation-length) tyres,
 * a six-speed sequential gearbox, clutch-type limited-slip differential, brakes with bias, aerodynamic
 * drag/downforce and box collisions against the city's colliders.
 *
 * - Fixed 240 Hz step with an accumulator: identical behaviour at any display frame rate.
 * - Semi-implicit Euler for the body; an implicit wheel-spin/slip solve so stiff tyres never explode.
 * - No allocations per step (all temporaries are preallocated).
 *
 * Body frame (same as the model): +X left, +Y up, +Z forward. World: +Y up.
 * `ground` must provide heightAt(x, z) → number|null, optionally gripAt(x, z) → factor, and
 * forEachCollider(minX, minZ, maxX, maxZ, callback(rect)) for solid obstacles (2D boxes, full height).
 */
export const PHYSICS_HZ = 240;
const H = 1 / PHYSICS_HZ, MAX_STEPS_PER_UPDATE = 30, G = 9.81;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const qTmp = new THREE.Quaternion(), mTmp = new THREE.Matrix3(), mR = new THREE.Matrix3(), m4 = new THREE.Matrix4();
const clamp = THREE.MathUtils.clamp;

export class VehiclePhysics {
  constructor(params, ground) {
    this.params = params; this.ground = ground;
    this.mass = params.mass;
    this.invInertia = new THREE.Vector3(1 / params.inertia.pitch, 1 / params.inertia.yaw, 1 / params.inertia.roll);
    const fronts = params.wheels.filter(w => w.front), rears = params.wheels.filter(w => !w.front);
    const zf = fronts.reduce((s, w) => s + w.hub[2], 0) / fronts.length, zr = rears.reduce((s, w) => s + w.hub[2], 0) / rears.length;
    this.axleZ = { front: zf, rear: zr }; this.wheelbase = zf - zr;
    /** Centre of gravity in model coordinates. */
    this.cog = new THREE.Vector3(0, params.groundY + params.cogHeight, zf - (1 - params.frontWeightShare) * this.wheelbase);
    const S = params.suspension;
    this.wheels = params.wheels.map(w => {
      const s = w.front ? S.front : S.rear, share = w.front ? params.frontWeightShare : 1 - params.frontWeightShare;
      const staticCompression = params.mass * G * share / 2 / s.spring;
      const hub = new THREE.Vector3(...w.hub).sub(this.cog);
      return {
        id: w.id, front: w.front, left: w.left, radius: w.radius, width: w.width, spring: s, inertia: w.front ? S.wheelInertia.front : S.wheelInertia.rear,
        hubLocal: hub, mountLocal: hub.clone().add(new THREE.Vector3(0, S.staticLength, 0)),
        restLength: S.staticLength + staticCompression, minLength: S.staticLength - S.bumpTravel, maxLength: S.staticLength + S.droopTravel,
        length: S.staticLength, compression: staticCompression, prevCompression: staticCompression, contact: false,
        omega: 0, spin: 0, steer: 0, kappa: 0, slipY: 0, load: 0, suspensionForce: 0, grip: 1,
        contactPoint: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), fx: 0, fy: 0, groundY: 0, absFactor: 1,
      };
    });
    this.position = new THREE.Vector3(); this.quaternion = new THREE.Quaternion(); this.velocity = new THREE.Vector3(); this.angularVelocity = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3(); this.prevQuaternion = new THREE.Quaternion();
    this.force = new THREE.Vector3(); this.torque = new THREE.Vector3();
    this.axes = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
    this.input = { throttle: 0, brake: 0, steer: 0 };
    this.aids = { abs: true, tc: true, autoShift: true };
    this.engine = { rpm: params.engine.idleRpm, torque: 0, clutchSlip: false };
    this.gear = 1; this.shiftTimer = 0; this.reverseTimer = 0; this.tcFactor = 1;
    this.accumulator = 0; this.time = 0; this.steps = 0;
    this.acceleration = new THREE.Vector3(); this.lastVelocity = new THREE.Vector3();
    this.collisions = 0; this.lastImpact = 0; this.safePose = null; this.safeTimer = 0;
    this.bodyPoints = [];
    const b = params.body; // simplified hull: 2D footprint box for obstacles plus floor points for ground safety
    this.hull = { cx: b.center[0] - this.cog.x, cz: b.center[2] - this.cog.z, hx: b.half[0], hz: b.half[2] };
    for (const sx of [-0.92, 0.92]) for (const sz of [-2.15, 0, 2.15]) this.bodyPoints.push(new THREE.Vector3(sx, params.groundY + 0.085, sz).sub(this.cog));
  }

  /** Place the car at rest with its tyres on the ground. `yaw` 0 faces +Z. */
  reset({ x, z, yaw = 0, y = null }) {
    const ground = y ?? this.ground.heightAt(x, z) ?? 0;
    this.quaternion.setFromAxisAngle(v1.set(0, 1, 0), yaw);
    // Model origin sits on the contact plane (groundY); the CoG is above it.
    this.position.set(x, ground - this.params.groundY, z).add(v2.copy(this.cog).applyQuaternion(this.quaternion));
    this.velocity.set(0, 0, 0); this.angularVelocity.set(0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.kappa = 0; w.slipY = 0; w.length = this.params.suspension.staticLength; w.compression = w.prevCompression = w.restLength - w.length; w.absFactor = 1; }
    this.gear = 1; this.shiftTimer = 0; this.reverseTimer = 0; this.engine.rpm = this.params.engine.idleRpm; this.tcFactor = 1;
    this.prevPosition.copy(this.position); this.prevQuaternion.copy(this.quaternion); this.accumulator = 0; this.lastVelocity.set(0, 0, 0);
    this.safePose = { x, z, yaw }; this.safeTimer = 0;
  }

  /** Throttle 0..1, brake 0..1, steer −1..1 (positive turns left). Optional: shiftUp/shiftDown requests. */
  setInput(input) { Object.assign(this.input, input); }
  shift(direction) { if (this.shiftTimer > 0) return; const target = this.gear === -1 ? (direction > 0 ? 1 : -1) : clamp(this.gear + direction, 1, this.params.gearbox.ratios.length); if (target !== this.gear) { this.gear = target; this.shiftTimer = this.params.gearbox.shiftTime; } }

  /** Advance by a display frame; returns the interpolation factor for rendering. */
  update(frameDelta) {
    this.accumulator = Math.min(this.accumulator + frameDelta, MAX_STEPS_PER_UPDATE * H);
    while (this.accumulator >= H) { this.prevPosition.copy(this.position); this.prevQuaternion.copy(this.quaternion); this.step(H); this.accumulator -= H; }
    return this.accumulator / H;
  }

  /** Interpolated pose of the model origin for rendering. */
  renderPose(alpha, outPosition, outQuaternion) {
    outQuaternion.slerpQuaternions(this.prevQuaternion, this.quaternion, alpha);
    outPosition.lerpVectors(this.prevPosition, this.position, alpha).sub(v1.copy(this.cog).applyQuaternion(outQuaternion));
  }

  get speed() { return this.velocity.length(); }
  get forwardSpeed() { return this.velocity.dot(this.axes.z); }

  step(h) {
    const p = this.params, ax = this.axes, q = this.quaternion;
    ax.x.set(1, 0, 0).applyQuaternion(q); ax.y.set(0, 1, 0).applyQuaternion(q); ax.z.set(0, 0, 1).applyQuaternion(q);
    this.force.set(0, -this.mass * G, 0); this.torque.set(0, 0, 0);
    const vForward = this.velocity.dot(ax.z);
    this.updateGearAndPedals(h, vForward);
    // Steering with partial Ackermann: the inner front wheel turns more.
    const delta = this.input.steer * p.steering.maxAngle;
    for (const w of this.wheels) {
      if (!w.front) { w.steer = 0; continue; }
      if (Math.abs(delta) < 1e-5) { w.steer = 0; continue; }
      const R = this.wheelbase / Math.tan(Math.abs(delta)), half = Math.abs(w.hubLocal.x), inner = (delta > 0) === w.left;
      const ideal = Math.atan(this.wheelbase / (R + (inner ? -half : half)));
      w.steer = Math.sign(delta) * (Math.abs(delta) + p.steering.ackermann * (ideal - Math.abs(delta)));
    }
    // Suspension geometry and compression.
    for (const w of this.wheels) this.suspend(w);
    // Anti-roll bars, then spring/damper/bump-stop forces.
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const L = this.wheels[a], R = this.wheels[b], k = L.front ? p.suspension.front.antiRoll : p.suspension.rear.antiRoll;
      const arb = (L.contact && R.contact) ? k * (L.compression - R.compression) : 0;
      L.arb = arb; R.arb = -arb;
    }
    const drive = this.driveTorques(h);
    for (const w of this.wheels) this.tyre(w, h, drive);
    this.differential(h, drive);
    this.aerodynamics();
    // Integrate the body (semi-implicit Euler).
    this.velocity.addScaledVector(this.force, h / this.mass);
    this.worldInverseInertia(mTmp);
    // Gyroscopic term ω × (Iω) is negligible at these rates for a car; omitted for stability.
    v1.copy(this.torque).applyMatrix3(mTmp); this.angularVelocity.addScaledVector(v1, h);
    this.position.addScaledVector(this.velocity, h);
    const w = this.angularVelocity, angle = w.length() * h;
    if (angle > 1e-9) { qTmp.setFromAxisAngle(v1.copy(w).normalize(), angle); this.quaternion.premultiply(qTmp).normalize(); }
    this.collide();
    this.groundSafety();
    for (const wheel of this.wheels) wheel.spin = (wheel.spin + wheel.omega * h) % (Math.PI * 2);
    this.acceleration.copy(this.velocity).sub(this.lastVelocity).divideScalar(h); this.lastVelocity.copy(this.velocity);
    this.time += h; this.steps++;
    this.trackSafePose(h);
  }

  worldInverseInertia(out) {
    mR.setFromMatrix4(m4.makeRotationFromQuaternion(this.quaternion));
    const e = mR.elements, i = this.invInertia, o = out.elements; // out = R · diag(i) · Rᵀ
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const s = e[r] * i.x * e[c] + e[r + 3] * i.y * e[c + 3] + e[r + 6] * i.z * e[c + 6];
      o[r + c * 3] = s;
    }
    return out;
  }

  /** Wheel centre height on the ground, treating the tyre as a circle along its heading (rolls up kerbs smoothly). */
  wheelGround(w, cx, cz, fx, fz, out) {
    const r = w.radius, g = this.ground; let best = -Infinity, bestD = 0, any = false, lateral = 0;
    const lx = -fz, lz = fx; // horizontal lateral direction
    for (const d of OFFSETS) {
      const dd = d * r, rise = Math.sqrt(r * r - dd * dd);
      for (const s of (d === 0 ? LATERAL : ZERO)) {
        const hgt = g.heightAt(cx + fx * dd + lx * s * w.width, cz + fz * dd + lz * s * w.width);
        if (hgt === null || hgt === undefined) continue; any = true;
        const centre = hgt + rise;
        if (centre > best + 1e-4 || (Math.abs(centre - best) <= 1e-4 && Math.abs(dd) < Math.abs(bestD))) { best = centre; bestD = dd; lateral = s; }
      }
    }
    if (!any) return null;
    // Contact normal points from the contact point to the wheel centre.
    const rise = Math.sqrt(r * r - bestD * bestD);
    out.normal.set(-fx * bestD, rise, -fz * bestD).normalize();
    out.centreY = best; out.grip = g.gripAt ? g.gripAt(cx + fx * bestD, cz + fz * bestD) : 1;
    out.lateral = lateral;
    return out;
  }

  suspend(w) {
    const ax = this.axes, q = this.quaternion;
    const mount = v1.copy(w.mountLocal).applyQuaternion(q).add(this.position);
    // Wheel heading on the ground plane.
    const c = Math.cos(w.steer), s = Math.sin(w.steer);
    const hx = ax.z.x * c + ax.x.x * s, hz = ax.z.z * c + ax.x.z * s, hl = Math.hypot(hx, hz) || 1;
    w.heading = w.heading ?? new THREE.Vector3(); w.heading.set(ax.z.x * c + ax.x.x * s, ax.z.y * c + ax.x.y * s, ax.z.z * c + ax.x.z * s);
    const hubX = mount.x - ax.y.x * w.length, hubZ = mount.z - ax.y.z * w.length;
    const sample = this.wheelGround(w, hubX, hubZ, hx / hl, hz / hl, SAMPLE);
    w.prevCompression = w.compression;
    if (!sample || ax.y.y < 0.2) { w.contact = false; w.length = w.maxLength; w.compression = Math.max(0, w.restLength - w.length); w.groundY = -Infinity; return; }
    const lengthToContact = (mount.y - sample.centreY) / ax.y.y;
    w.groundY = sample.centreY - w.radius; w.grip = sample.grip;
    if (lengthToContact >= w.maxLength) { w.contact = false; w.length = w.maxLength; }
    else { w.contact = true; w.length = lengthToContact; w.normal.copy(sample.normal); }
    w.compression = w.restLength - w.length;
    w.hubWorld = w.hubWorld ?? new THREE.Vector3();
    w.hubWorld.copy(mount).addScaledVector(ax.y, -w.length);
    w.contactPoint.copy(w.hubWorld).addScaledVector(w.normal, -w.radius);
  }

  /** Engine, clutch and gearbox: drive torque available at each rear wheel this step (before tyre reaction). */
  driveTorques(h) {
    const p = this.params, e = p.engine, gb = p.gearbox, rears = this.rearWheels ?? (this.rearWheels = this.wheels.filter(w => !w.front));
    const shifting = this.shiftTimer > 0; if (shifting) this.shiftTimer = Math.max(0, this.shiftTimer - h);
    const ratio = this.gear === 0 ? 0 : (this.gear === -1 ? -gb.reverse : gb.ratios[this.gear - 1]) * gb.final;
    const wheelOmega = (rears[0].omega + rears[1].omega) / 2;
    const coupledRpm = Math.abs(wheelOmega * ratio) * 60 / (2 * Math.PI);
    let throttle = this.pedals.throttle * this.tcFactor, engineTorque = 0, wheelTorque = 0, engineInertia = 0;
    if (shifting || ratio === 0) { this.engine.rpm += (e.idleRpm + throttle * 6000 - this.engine.rpm) * Math.min(1, h * 8); this.engine.clutchSlip = false; }
    else if (coupledRpm < e.idleRpm * 1.05 || wheelOmega * ratio < -0.5 || (this.engine.clutchSlip && coupledRpm < this.engine.rpm - 50 && throttle > 0.05)) {
      // Launch: the clutch slips; the engine holds a launch speed and the clutch passes its torque.
      const target = throttle > 0.05 ? Math.max(e.idleRpm, e.launchRpm * Math.min(1, throttle * 1.4)) : e.idleRpm;
      this.engine.rpm += (target - this.engine.rpm) * Math.min(1, h * 10);
      this.engine.clutchSlip = throttle > 0.05;
      engineTorque = throttle > 0.05 ? torqueAt(e.torqueCurve, this.engine.rpm) * throttle : 0;
      wheelTorque = engineTorque * ratio * gb.efficiency;
    } else {
      this.engine.clutchSlip = false; this.engine.rpm = coupledRpm;
      const friction = e.frictionTorque[0] + e.frictionTorque[1] * coupledRpm;
      engineTorque = coupledRpm > e.limitRpm ? -friction : torqueAt(e.torqueCurve, coupledRpm) * throttle - friction * (1 - throttle);
      wheelTorque = engineTorque * ratio * gb.efficiency;
      engineInertia = e.inertia * ratio * ratio / 2;
    }
    this.engine.torque = engineTorque; this.engine.ratio = ratio;
    return { perWheel: wheelTorque / 2, total: wheelTorque, engineInertia };
  }

  /** Pedals after gear logic (reverse) and driver aids. */
  updateGearAndPedals(h, vForward) {
    const p = this.params, input = this.input, gb = p.gearbox;
    let throttle = clamp(input.throttle, 0, 1), brake = clamp(input.brake, 0, 1);
    // Reverse: hold the brake at a standstill to engage reverse; then the pedals swap.
    if (input.autoReverse !== false && Math.abs(vForward) < 0.6 && brake > 0.5 && throttle < 0.05 && this.gear !== -1) { this.reverseTimer += h; if (this.reverseTimer > 0.35) { this.gear = -1; this.shiftTimer = gb.shiftTime; this.reverseTimer = 0; } }
    else if (this.gear === -1 && Math.abs(vForward) < 0.6 && throttle > 0.1) { this.gear = 1; this.shiftTimer = gb.shiftTime; this.reverseTimer = 0; }
    else this.reverseTimer = 0;
    if (this.gear === -1) [throttle, brake] = [brake, throttle];
    this.pedals = { throttle, brake };
    // Automatic sequential shifting (manual when aids.autoShift is false).
    if (this.aids.autoShift && this.gear > 0 && this.shiftTimer === 0 && !this.engine.clutchSlip) {
      const rpm = this.engine.rpm;
      if (rpm > gb.upshiftRpm && this.gear < gb.ratios.length) this.shift(1);
      else if (this.gear > 1 && rpm < gb.downshiftRpm && rpm * gb.ratios[this.gear - 2] / gb.ratios[this.gear - 1] < gb.upshiftRpm - 500) this.shift(-1);
    }
  }

  tyre(w, h, drive) {
    const p = this.params, t = p.tyre, ax = this.axes;
    const driven = !w.front, Tdrive = driven ? drive.perWheel : 0;
    const inertia = w.inertia + (driven ? drive.engineInertia : 0);
    // Brakes (bias, ABS) and rolling resistance act as friction torques that never reverse the wheel.
    const bias = p.brakes.bias, brakeShare = w.front ? bias / 2 : (1 - bias) / 2;
    let Tbrake = this.pedals.brake * p.brakes.maxTorque * brakeShare * w.absFactor + t.rollingResistance * w.load * w.radius;
    if (!w.contact) {
      w.load = 0; w.fx = w.fy = 0; w.kappa *= 0.9; w.slipY *= 0.9;
      let omega = w.omega + h * Tdrive / inertia;
      omega = Math.sign(omega) * Math.max(0, Math.abs(omega) - h * (Tbrake + 2) / inertia);
      w.omega = omega; return;
    }
    // Normal load from the spring, damper, bump stop and anti-roll bar.
    const S = w.spring, rate = (w.compression - w.prevCompression) / h;
    let Fs = S.spring * Math.max(0, w.compression) + (rate > 0 ? S.bump : S.rebound) * rate + (w.arb ?? 0);
    if (w.length < w.minLength) Fs += p.suspension.bumpStop * (w.minLength - w.length);
    Fs = Math.max(0, Fs); w.suspensionForce = Fs;
    const n = w.normal, cosN = Math.max(0.35, n.dot(ax.y));
    const Fz = Fs / cosN; w.load = Fz * n.y;
    // Contact-plane axes: forward along the wheel heading, lateral to its left.
    const fwd = v2.copy(w.heading).addScaledVector(n, -w.heading.dot(n)).normalize();
    const lat = v3.crossVectors(n, fwd).normalize();
    const r = v4.copy(w.contactPoint).sub(this.position);
    const vc = v1.crossVectors(this.angularVelocity, r).add(this.velocity);
    const vx = vc.dot(fwd), vy = vc.dot(lat), absVx = Math.abs(vx);
    // Grip with load sensitivity and surface.
    const mu = t.mu * clamp(1 - t.loadSensitivity * (Fz - t.nominalLoad) / t.nominalLoad, 0.6, 1.25) * w.grip;
    const D = mu * Fz;
    // Lateral slip state (relaxation length): explicit; stable for this step size and speed range.
    w.slipY += h * (vy - absVx * w.slipY) / t.relaxLat; w.slipY = clamp(w.slipY, -4, 4);
    // Longitudinal: solve wheel spin and slip implicitly with a secant tyre stiffness.
    const sY = w.slipY / t.peakSlipAngle;
    const kx = w.kappa / t.peakSlipRatio, sigma0 = Math.hypot(kx, sY);
    const f0 = shape(sigma0, t.shapeC);
    const secant = sigma0 > 1e-4 ? D * f0 / sigma0 / t.peakSlipRatio : D * SLOPE0(t.shapeC) / t.peakSlipRatio;
    const a = h / t.relaxLong, R = w.radius, hb = h / inertia;
    const kappaFor = omega => w.kappa + a * (omega * R - vx - absVx * w.kappa);
    // ω' = ω + hb(T − S·κ'(ω')·R)  →  linear in ω'
    const T = Tdrive;
    let omega = (w.omega + hb * T - hb * secant * R * (w.kappa + a * (-vx - absVx * w.kappa))) / (1 + hb * secant * R * a * R);
    // Brake: reduce |ω| toward zero without crossing; lock if it would cross.
    if (Tbrake > 0) {
      const reduced = Math.abs(omega) - hb * Tbrake;
      if (reduced <= 0 || Math.sign(omega) !== Math.sign(w.omega || omega)) {
        // Locked if the brake can hold the tyre torque; otherwise slide with full brake torque.
        const kappaLocked = kappaFor(0), need = Math.abs(Tdrive - secant * kappaLocked * R);
        omega = need <= Tbrake ? 0 : Math.sign(omega) * Math.max(0, Math.abs(omega) - hb * Tbrake);
      } else omega = Math.sign(omega) * reduced;
    }
    w.omega = omega;
    w.kappa = clamp(kappaFor(omega), -4, 4);
    // Combined-slip force from the normalised Pacejka shape (similarity method).
    const sx = w.kappa / t.peakSlipRatio, sigma = Math.hypot(sx, sY);
    let Fx = 0, Fy = 0;
    if (sigma > 1e-6) { const F = D * shape(sigma, t.shapeC); Fx = F * sx / sigma; Fy = -F * sY / sigma; }
    // Low-speed damping so the car settles instead of jiggling on its tyre springs at a standstill.
    if (absVx < 4) { const fade = 1 - absVx / 4, c = Math.sqrt(D * SLOPE0(t.shapeC) / (t.peakSlipAngle * t.relaxLat) * Fz / G); Fy -= c * vy * fade; if (omega === 0) Fx -= c * vx * fade; }
    const total = Math.hypot(Fx, Fy); if (total > D * 1.05) { Fx *= D * 1.05 / total; Fy *= D * 1.05 / total; }
    w.fx = Fx; w.fy = Fy; w.vx = vx; w.vy = vy;
    // Driver aids: ABS (per wheel) and traction control (rear).
    const slipRatio = absVx > 1 ? (omega * R - vx) / absVx : 0;
    w.slipRatio = slipRatio; w.slipAngle = Math.atan2(vy, Math.max(absVx, 0.5));
    if (this.aids.abs && this.pedals.brake > 0 && absVx > 2) w.absFactor = slipRatio < -p.brakes.absSlip ? Math.max(0.2, w.absFactor * 0.82) : Math.min(1, w.absFactor + h * 6);
    else w.absFactor = 1;
    // Apply: suspension load along the contact normal, tyre forces in the contact plane, at the contact point.
    const F = v4.copy(n).multiplyScalar(Fz).addScaledVector(fwd, Fx).addScaledVector(lat, Fy);
    this.applyForce(F, w.contactPoint);
  }

  /** Clutch-type LSD: torque moves from the faster to the slower rear wheel, up to the locking torque. */
  differential(h, drive) {
    const [L, R] = this.rearWheels, d = this.params.differential;
    const lock = d.preload + (drive.total >= 0 ? d.powerRamp : d.coastRamp) * Math.abs(drive.total);
    const inertia = (L.inertia + R.inertia) / 2 + drive.engineInertia;
    const Teq = (L.omega - R.omega) * inertia / (2 * h), Tt = clamp(Teq, -lock, lock);
    L.omega -= Tt * h / inertia; R.omega += Tt * h / inertia;
    // Traction control: trim throttle while the driven wheels spin up beyond the target slip.
    if (this.aids.tc && this.pedals.throttle > 0) {
      const slip = Math.max(L.slipRatio ?? 0, R.slipRatio ?? 0), v = Math.abs(this.forwardSpeed);
      this.tcFactor = slip > this.params.brakes.tcSlip && v > 1.5 ? Math.max(0.25, this.tcFactor * 0.9) : Math.min(1, this.tcFactor + h * 3);
    } else this.tcFactor = 1;
  }

  aerodynamics() {
    const a = this.params.aero, v = this.velocity, speed = v.length(); if (speed < 0.1) return;
    const q = 0.5 * a.airDensity;
    this.force.addScaledVector(v, -q * a.dragArea * speed);
    const vf = Math.max(0, v.dot(this.axes.z)), down = q * a.liftArea * vf * vf;
    for (const [share, z] of [[a.frontBalance, this.axleZ.front], [1 - a.frontBalance, this.axleZ.rear]]) {
      const point = v1.set(0, 0, z - this.cog.z).applyQuaternion(this.quaternion).add(this.position);
      this.applyForce(v2.copy(this.axes.y).multiplyScalar(-down * share), point);
    }
  }

  applyForce(F, point) {
    this.force.add(F);
    const r = v3.copy(point).sub(this.position);
    this.torque.x += r.y * F.z - r.z * F.y; this.torque.y += r.z * F.x - r.x * F.z; this.torque.z += r.x * F.y - r.y * F.x;
  }

  applyImpulse(J, point) {
    this.velocity.addScaledVector(J, 1 / this.mass);
    const r = v3.copy(point).sub(this.position), t = v4.crossVectors(r, J).applyMatrix3(this.worldInverseInertia(mTmp));
    this.angularVelocity.add(t);
  }

  /** Effective mass of the body along direction n at a point. */
  effectiveInverseMass(point, n) {
    const r = v3.copy(point).sub(this.position), rn = v4.crossVectors(r, n).applyMatrix3(this.worldInverseInertia(mTmp));
    return 1 / this.mass + v1.crossVectors(rn, r).dot(n);
  }

  /** Footprint box versus the city's 2D colliders (separating axis test; impulses with friction). */
  collide() {
    const hull = this.hull, ax = this.axes, k = this.contactScratch ?? (this.contactScratch = {});
    const fx = ax.z.x, fz = ax.z.z, fl = Math.hypot(fx, fz) || 1;
    k.Fx = fx / fl; k.Fz = fz / fl; const Lx = -k.Fz, Lz = k.Fx;
    k.cx = this.position.x + Lx * hull.cx + k.Fx * hull.cz; k.cz = this.position.z + Lz * hull.cx + k.Fz * hull.cz;
    const ex = Math.abs(Lx) * hull.hx + Math.abs(k.Fx) * hull.hz, ez = Math.abs(Lz) * hull.hx + Math.abs(k.Fz) * hull.hz;
    k.level = this.position.y - this.cog.y + this.params.groundY; k.hits = 0;
    this.onCollider ??= rect => this.resolveCollider(rect);
    this.ground.forEachCollider(k.cx - ex, k.cz - ez, k.cx + ex, k.cz + ez, this.onCollider);
    return k.hits;
  }

  resolveCollider(rect) {
    const k = this.contactScratch, c = this.params.collision, hull = this.hull;
    if (rect.level !== undefined && Math.abs(rect.level - k.level) > 0.5) return;
    const res = obbVsAabb(k.cx, k.cz, k.Fx, k.Fz, hull.hx, hull.hz, rect); if (!res) return;
    k.hits++;
    const nx = res.nx, nz = res.nz, px = res.px, pz = res.pz;
    this.position.x += nx * res.depth; this.position.z += nz * res.depth; k.cx += nx * res.depth; k.cz += nz * res.depth;
    const point = TMPP.set(px, this.position.y - 0.1, pz), r = v3.copy(point).sub(this.position), vp = v4.crossVectors(this.angularVelocity, r).add(this.velocity);
    const vn = vp.x * nx + vp.z * nz, tx = -nz, tz = nx, vt = vp.x * tx + vp.z * tz;
    if (vn >= 0) return;
    const jn = -(1 + c.restitution) * vn / this.effectiveInverseMass(point, TMPN.set(nx, 0, nz));
    const jtMax = c.friction * jn, jt = clamp(-vt / this.effectiveInverseMass(point, TMPT.set(tx, 0, tz)), -jtMax, jtMax);
    this.applyImpulse(TMPJ.set(nx * jn + tx * jt, 0, nz * jn + tz * jt), point);
    this.lastImpact = Math.max(this.lastImpact, -vn); this.collisions++;
  }

  /** The floor of the car never passes through the ground (large bumps, steps, ramps). */
  groundSafety() {
    for (const local of this.bodyPoints) {
      const p = TMPP.copy(local).applyQuaternion(this.quaternion).add(this.position), gy = this.ground.heightAt(p.x, p.z);
      if (gy === null || gy === undefined || p.y >= gy) continue;
      this.position.y += gy - p.y; p.y = gy;
      const r = v3.copy(p).sub(this.position), vp = v4.crossVectors(this.angularVelocity, r).add(this.velocity);
      const vy = vp.y, vx = vp.x, vz = vp.z; if (vy >= 0) continue;
      const j = -1.1 * vy / this.effectiveInverseMass(p, TMPN.set(0, 1, 0)), f = 0.4 * j, vh = Math.hypot(vx, vz) || 1;
      this.applyImpulse(TMPJ.set(-vx / vh * f, j, -vz / vh * f), p);
      this.scrapes = (this.scrapes ?? 0) + 1;
    }
  }

  /** Remember an upright, grounded pose for recovery; recover automatically after a fall. */
  trackSafePose(h) {
    const grounded = this.wheels.every(w => w.contact), upright = this.axes.y.y > 0.9;
    if (grounded && upright && this.speed < 30) { this.safeTimer += h; if (this.safeTimer > 0.5) { this.safeTimer = 0; this.safePose = { x: this.position.x, z: this.position.z, yaw: Math.atan2(this.axes.z.x, this.axes.z.z) }; } }
    this.airborne = this.wheels.some(w => w.contact) ? 0 : (this.airborne ?? 0) + h;
    if (this.airborne > 2 || this.axes.y.y < -0.2 && this.speed < 1) this.recover();
  }

  recover() { if (this.safePose) this.reset(this.safePose); }

  telemetry() {
    const v = this.forwardSpeed, ax = this.axes, a = this.acceleration;
    return { speedKmh: v * 3.6, gear: this.gear, rpm: Math.round(this.engine.rpm), throttle: this.pedals?.throttle ?? 0, brake: this.pedals?.brake ?? 0,
      steer: this.input.steer, lateralG: a.dot(ax.x) / G, longitudinalG: a.dot(ax.z) / G, tc: this.tcFactor < 0.99, abs: this.wheels.some(w => w.absFactor < 0.99),
      wheels: this.wheels.map(w => ({ id: w.id, contact: w.contact, load: Math.round(w.load), slipRatio: +(w.slipRatio ?? 0).toFixed(3), slipAngle: +(w.slipAngle ?? 0).toFixed(3), compression: +w.compression.toFixed(4) })) };
  }
}

const OFFSETS = [0, -0.35, 0.35, -0.6, 0.6, -0.8, 0.8], LATERAL = [0, -0.4, 0.4], ZERO = [0];
const SAMPLE = { normal: new THREE.Vector3(), centreY: 0, grip: 1, lateral: 0 };
const TMPN = new THREE.Vector3(), TMPP = new THREE.Vector3(), TMPT = new THREE.Vector3(), TMPJ = new THREE.Vector3();
const B_CACHE = new Map();
/** Normalised Pacejka curve with its peak (1.0) at σ = 1. */
function shape(sigma, C) { let B = B_CACHE.get(C); if (B === undefined) { B = Math.tan(Math.PI / (2 * C)); B_CACHE.set(C, B); } return Math.sin(C * Math.atan(B * sigma)); }
function SLOPE0(C) { return C * Math.tan(Math.PI / (2 * C)); }
export function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (rpm <= curve[i][0]) { const [r0, t0] = curve[i - 1], [r1, t1] = curve[i]; return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0); }
  return curve.at(-1)[1];
}

/** Oriented box (centre, forward unit vector, half extents) versus an axis-aligned rectangle; null if apart. */
const OBB = { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };
export function obbVsAabb(cx, cz, fx, fz, hx, hz, r) {
  const lx = -fz, lz = fx; // left axis
  const bx = (r.minX + r.maxX) / 2, bz = (r.minZ + r.maxZ) / 2, ex = (r.maxX - r.minX) / 2, ez = (r.maxZ - r.minZ) / 2;
  const dx = cx - bx, dz = cz - bz;
  let best = Infinity, nx = 0, nz = 0, owner = 0;
  for (let i = 0; i < 4; i++) {
    const ux = i === 0 ? 1 : i === 1 ? 0 : i === 2 ? lx : fx, uz = i === 0 ? 0 : i === 1 ? 1 : i === 2 ? lz : fz;
    const ra = hx * Math.abs(lx * ux + lz * uz) + hz * Math.abs(fx * ux + fz * uz), rb = ex * Math.abs(ux) + ez * Math.abs(uz);
    const dist = dx * ux + dz * uz, overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return null;
    if (overlap < best) { best = overlap; const s = dist >= 0 ? 1 : -1; nx = ux * s; nz = uz * s; owner = i < 2 ? 0 : 1; }
  }
  // Contact point: the middle of the overlap along the contact face (centred for a head-on wall hit, on the
  // bollard for a narrow post), placed on the box face (box axis) or on the car face (car axis).
  const tx = -nz, tz = nx;
  const ct = cx * tx + cz * tz, rc = hx * Math.abs(lx * tx + lz * tz) + hz * Math.abs(fx * tx + fz * tz);
  const cb = bx * tx + bz * tz, rbt = ex * Math.abs(tx) + ez * Math.abs(tz);
  const mt = (Math.max(ct - rc, cb - rbt) + Math.min(ct + rc, cb + rbt)) / 2;
  const pn = owner === 0 ? bx * nx + bz * nz + ex * Math.abs(nx) + ez * Math.abs(nz)
    : cx * nx + cz * nz - (hx * Math.abs(lx * nx + lz * nz) + hz * Math.abs(fx * nx + fz * nz));
  const px = tx * mt + nx * pn, pz = tz * mt + nz * pn;
  OBB.nx = nx; OBB.nz = nz; OBB.depth = best; OBB.px = px; OBB.pz = pz; return OBB;
}
