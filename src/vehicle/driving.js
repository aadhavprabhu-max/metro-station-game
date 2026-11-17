import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VehiclePhysics } from './vehicle-physics.js';
import { VehicleGround } from './vehicle-ground.js';
import { VehicleModel } from './vehicle-model.js';
import { GT3R } from './gt3r-params.js';

/** Where the car waits: the Via del Corso parking bays (eastbound kerb), facing east. */
export const PARKING = Object.freeze({ x: -66, z: -117.05, yaw: Math.PI / 2 });
const MODEL_URL = 'vehicles/gt3r/gt3r.glb';
const STEER_RATE = 2.6, STEER_RETURN = 3.4; // keyboard steering: normalised units per second

/**
 * Driving on the street: enter and leave the GT3 R, drive it with the keyboard (W/S or arrows; A/D steer),
 * the existing on-screen movement pad (touch), chase or cockpit camera (C), manual shifting (Q/E after G),
 * recovery (Backspace). The existing camera and controls are borrowed while driving and restored on exit.
 */
export class DrivingController {
  constructor(world, player, ui) {
    this.world = world; this.player = player; this.ui = ui;
    this.state = 'idle'; this.cameraMode = 'chase'; this.steer = 0; this.orbit = { yaw: 0, pitch: 0, idle: 0 };
    this.renderPosition = new THREE.Vector3(); this.renderQuaternion = new THREE.Quaternion();
    this.cameraTarget = new THREE.Vector3(); this.cameraPosition = new THREE.Vector3(); this.cameraInitialized = false;
    this.parked = { ...PARKING };
    player.vehicleController = this;
    window.addEventListener('keydown', event => this.onKey(event));
  }

  get driving() { return this.state === 'driving'; }

  onKey(event) {
    if (event.target?.closest?.('input, textarea, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (event.code === 'KeyF' && this.player.enabled && (this.driving || this.player.surfaceExploring)) { event.preventDefault(); this.toggle(); return; }
    if (!this.driving) return;
    const car = this.physics;
    if (event.code === 'KeyC') { this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase'; this.cameraInitialized = false; }
    else if (event.code === 'KeyG') car.aids.autoShift = !car.aids.autoShift;
    else if (event.code === 'KeyE' && !car.aids.autoShift) car.shift(1);
    else if (event.code === 'KeyQ' && !car.aids.autoShift) car.shift(-1);
    else if (event.code === 'Backspace') { event.preventDefault(); car.recover(); }
    else return;
    this.updateHud(true);
  }

  async toggle() { return this.driving ? this.exit() : this.enter(); }

  /** Load the model once (lazy: only when driving is first requested). */
  async load() {
    if (this.model) return true;
    if (this.loading) return this.loading;
    this.state = 'loading'; this.updateHud(true);
    this.loading = (async () => {
      try {
        const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
        const url = new URL(MODEL_URL, document.baseURI).href;
        if (location.protocol === 'file:') throw new Error('file');
        const gltf = await loader.loadAsync(url);
        const surface = this.world.surfaceWorld; surface.finishBuild();
        this.ground = new VehicleGround(surface);
        this.physics = new VehiclePhysics(GT3R, this.ground);
        this.model = new VehicleModel(gltf.scene, GT3R);
        surface.add(this.model); this.model.visible = false;
        this.placeParked();
        this.state = 'idle'; return true;
      } catch (error) {
        console.warn('Driving is unavailable:', error.message);
        this.state = 'unavailable'; this.unavailableReason = location.protocol === 'file:' || /fetch|404|file/i.test(String(error.message)) ? 'hosted' : 'error';
        this.loading = null; this.updateHud(true); return false;
      }
    })();
    return this.loading;
  }

  placeParked() {
    const p = this.parked; this.physics.reset({ x: p.x, z: p.z, yaw: p.yaw });
    // Settle on the suspension before anyone sees it.
    this.physics.setInput(PARKED); for (let i = 0; i < 120; i++) this.physics.update(1 / 60);
    this.syncModel(1);
  }

  async enter() {
    if (!this.player.surfaceExploring || this.driving) return false;
    if (!await this.load()) return false;
    const p = this.player;
    p.releaseDrag(); p.keys.clear();
    this.savedLook = { yaw: p.yaw, pitch: p.pitch };
    this.state = 'driving'; this.model.visible = true; this.steer = 0; this.cameraInitialized = false;
    p.driving = true; p.surfaceExploring = true;
    this.orbit.yaw = 0; this.orbit.pitch = 0; p.yaw = 0; p.pitch = 0;
    this.updateHud(true);
    return true;
  }

  /** Leave the car beside the driver's door (left), or the first clear spot around it. */
  exit({ silent = false } = {}) {
    if (!this.driving) return false;
    const p = this.player, car = this.physics, s = this.world.surfaceWorld, ax = car.axes;
    const origin = car.position, fx = ax.z.x, fz = ax.z.z, l = Math.hypot(fx, fz) || 1, F = [fx / l, fz / l], L = [-F[1], F[0]];
    let spot = null;
    for (const [a, b] of [[0.2, 1.75], [0.2, -1.75], [-3.2, 0], [3.2, 0], [0.2, 2.6], [0.2, -2.6]]) {
      const x = origin.x + F[0] * a + L[0] * b, z = origin.z + F[1] * a + L[1] * b;
      if (s.findSurface(x, z, s.streetY, 0.45, p.radius)) { spot = { x, z }; break; }
    }
    if (!spot && !silent) return false;
    this.state = 'idle'; p.driving = false;
    this.parked = { x: car.position.x, z: car.position.z, yaw: Math.atan2(ax.z.x, ax.z.z) };
    car.setInput(PARKED);
    if (spot) {
      p.camera.position.set(spot.x, s.floorAt(spot.x, spot.z) + 1.76, spot.z);
      p.yaw = Math.atan2(-(origin.x - spot.x), -(origin.z - spot.z)) + Math.PI; p.pitch = -0.05; p.applyLook();
      p.transferSurface = null; p.syncSurfaceContext();
    }
    this.updateHud(true);
    return true;
  }

  /** Called every frame from the world update while on the street. */
  update(delta) {
    if (!this.model) { this.updateHud(); return; }
    const car = this.physics;
    if (this.driving) {
      const k = this.player.keys, enabled = this.player.enabled;
      const up = enabled && (k.has('KeyW') || k.has('ArrowUp')), down = enabled && (k.has('KeyS') || k.has('ArrowDown'));
      const left = enabled && (k.has('KeyA') || k.has('ArrowLeft')), right = enabled && (k.has('KeyD') || k.has('ArrowRight'));
      // Keyboard steering is rate-limited and eased back to centre; at speed its range narrows to what the tyres
      // can use (about the peak slip angle), like a driver's hands. The physics itself has no assistance.
      const target = (left ? 1 : 0) - (right ? 1 : 0), speed = Math.abs(car.forwardSpeed);
      const limit = Math.min(1, 0.16 + 6.5 / Math.max(1, speed));
      const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? STEER_RETURN : STEER_RATE;
      this.steer += THREE.MathUtils.clamp(target * limit - this.steer, -rate * delta, rate * delta);
      car.setInput({ throttle: up ? 1 : 0, brake: down ? 1 : 0, steer: this.steer, autoReverse: true });
    } else car.setInput(PARKED);
    // Parked and out of sight: no simulation needed.
    const near = this.driving || this.model.position.distanceToSquared(this.player.camera.position) < 250 ** 2;
    this.model.visible = near;
    if (near) this.model.updateLod(this.player.camera.position, this.driving && this.cameraMode === 'cockpit');
    if (near && (this.driving || car.speed > 0.01 || !this.settled)) { const alpha = car.update(delta); this.syncModel(alpha); this.settled = !this.driving && car.speed < 0.01; }
    if (this.driving) this.updateCamera(delta);
    this.updateHud();
  }

  syncModel(alpha) {
    const car = this.physics; car.renderPose(alpha, this.renderPosition, this.renderQuaternion);
    this.model.position.copy(this.renderPosition); this.model.quaternion.copy(this.renderQuaternion);
    const light = this.world.surfaceWorld.lightState;
    this.model.sync(car, { braking: (car.pedals?.brake ?? 0) > 0.05 && this.driving, night: light?.night ?? 0 });
  }

  updateCamera(delta) {
    const cam = this.player.camera, car = this.physics, q = this.renderQuaternion, p = this.renderPosition, o = this.orbit;
    // Drag-look orbits the camera; it eases back to centre after a moment without input.
    if (this.player.drag) { o.idle = 0; } else { o.idle += delta; if (o.idle > 1.2) { this.player.yaw *= Math.exp(-delta * 2.5); this.player.pitch *= Math.exp(-delta * 2.5); } }
    o.yaw = this.player.yaw; o.pitch = THREE.MathUtils.clamp(this.player.pitch, -0.6, 0.5);
    if (this.cameraMode === 'cockpit') {
      const eye = this.model.steering ? TMP.copy(this.model.steering.centroid).add(EYE_OFFSET) : TMP.set(0.33, 1.02, -0.25);
      cam.position.copy(eye).applyQuaternion(q).add(p);
      cam.quaternion.copy(q).multiply(Q1.setFromEuler(E1.set(o.pitch - 0.06, Math.PI + o.yaw, 0, 'YXZ')));
      return;
    }
    // Chase camera: a fixed distance behind and above; only its heading follows the car with a short lag, so the
    // framing is steady at any speed and the view swings naturally through corners.
    const fwd = TMP.set(0, 0, 1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
    const carHeading = Math.atan2(fwd.x, fwd.z);
    if (!this.cameraInitialized) { this.cameraHeading = carHeading; this.cameraInitialized = true; }
    const lag = Math.atan2(Math.sin(carHeading - this.cameraHeading), Math.cos(carHeading - this.cameraHeading));
    this.cameraHeading += lag * (1 - Math.exp(-delta * 7));
    const heading = this.cameraHeading + o.yaw, dist = 5.9, height = 1.75 - o.pitch * 3;
    this.cameraPosition.set(p.x - Math.sin(heading) * dist, p.y + height, p.z - Math.cos(heading) * dist);
    this.cameraTarget.set(p.x + fwd.x * 1.6, p.y + 0.95, p.z + fwd.z * 1.6);
    // Keep the camera out of buildings: pull it in along the line to the car while it would be inside a collider.
    const ground = this.ground; let t = 1;
    for (let i = 0; i < 6; i++) { const x = p.x + (this.cameraPosition.x - p.x) * t, z = p.z + (this.cameraPosition.z - p.z) * t; let inside = false;
      ground.forEachCollider(x - 0.25, z - 0.25, x + 0.25, z + 0.25, r => { if (!r.bollard && r.level === undefined && x > r.minX - 0.25 && x < r.maxX + 0.25 && z > r.minZ - 0.25 && z < r.maxZ + 0.25) inside = true; });
      if (!inside) break; t *= 0.75; }
    cam.position.set(p.x + (this.cameraPosition.x - p.x) * t, Math.max(this.cameraPosition.y, (ground.heightAt(cam.position.x, cam.position.z) ?? p.y) + 0.6), p.z + (this.cameraPosition.z - p.z) * t);
    cam.lookAt(this.cameraTarget);
  }

  mountHud() {
    if (this.hud) return;
    const app = document.querySelector('#app');
    const button = document.createElement('button'); button.type = 'button'; button.id = 'drive-button'; button.className = 'drive-button gh-glass';
    button.addEventListener('click', () => this.toggle()); button.title = 'Shortcut: F';
    (document.querySelector('#glass-hud') ?? app).append(button);
    const panel = document.createElement('aside'); panel.className = 'drive-hud gh-glass'; panel.hidden = true; panel.setAttribute('aria-live', 'off');
    panel.innerHTML = '<div class="drive-speed"><strong>0</strong><small>km/h</small></div><div class="drive-gear"><strong>1</strong><small>gear</small></div><div class="drive-rpm"><span></span></div><p class="drive-help"></p>';
    app.append(panel);
    const note = document.createElement('p'); note.className = 'drive-note gh-glass'; note.hidden = true; app.append(note);
    this.hud = { button, panel, note, speed: panel.querySelector('.drive-speed strong'), gear: panel.querySelector('.drive-gear strong'), rpm: panel.querySelector('.drive-rpm span'), help: panel.querySelector('.drive-help') };
  }

  updateHud(force = false) {
    this.mountHud();
    const h = this.hud, street = this.player.surfaceExploring, show = street || this.driving;
    h.button.hidden = !show;
    const label = this.state === 'loading' ? 'Loading car…' : this.driving ? '<span aria-hidden="true">⎋</span> Leave car' : '<span aria-hidden="true">◆</span> Drive';
    if (force || h.button.dataset.label !== label) { h.button.innerHTML = label; h.button.dataset.label = label; h.button.disabled = this.state === 'loading'; h.button.setAttribute('aria-label', this.driving ? 'Leave the car' : 'Drive the Porsche 911 GT3 R'); }
    const note = this.state === 'unavailable' ? (this.unavailableReason === 'hosted'
      ? 'Driving needs the hosted version (development server or GitHub Pages). The car model is not part of this single-file preview.'
      : 'The car could not be loaded. Reload to try again.') : '';
    if (h.note.textContent !== note) h.note.textContent = note; h.note.hidden = !note || !street;
    h.panel.hidden = !this.driving; document.querySelector('#app')?.classList.toggle('driving', this.driving);
    if (!this.driving) return;
    const t = this.physics.telemetry(), speed = Math.round(Math.abs(t.speedKmh)), gear = t.gear === -1 ? 'R' : String(t.gear);
    if (h.speed.textContent !== String(speed)) h.speed.textContent = speed;
    if (h.gear.textContent !== gear) h.gear.textContent = gear;
    h.rpm.style.transform = `scaleX(${Math.min(1, t.rpm / GT3R.engine.limitRpm).toFixed(3)})`;
    const help = `W/S throttle · brake (hold S to reverse) · A/D steer · C ${this.cameraMode === 'chase' ? 'cockpit' : 'chase'} view · ${this.physics.aids.autoShift ? 'G manual' : 'Q/E shift · G auto'} · F leave${t.tc ? ' · TC' : ''}${t.abs ? ' · ABS' : ''}`;
    if (force || h.help.textContent !== help) h.help.textContent = help;
  }

  /** Scripted drive for tests/surface-benchmark.mjs: full throttle down Broadway North, a lane change, braking. */
  async benchmark(seconds, bench) {
    const w = this.world, p = this.player; await this.load();
    if (this.state === 'unavailable') return { unavailable: true };
    bench.place(-200, -432.5, -Math.PI / 2);
    this.parked = { x: -200, z: -432.5, yaw: Math.PI / 2 }; this.placeParked(); await this.enter();
    const original = { setInput: this.physics.setInput.bind(this.physics) };
    let t = 0; const script = () => ({ throttle: t < 6 ? 1 : 0.4, brake: t > seconds - 2 ? 1 : 0, steer: t > 4 && t < 4.6 ? 0.08 : t > 4.6 && t < 5.2 ? -0.08 : 0 });
    this.physics.setInput = input => original.setInput({ ...input, ...script() });
    const stamps = [], updates = [], shadow = [], originalUpdate = w.update;
    w.update = delta => { const t0 = performance.now(); originalUpdate(1 / 60); t += 1 / 60; updates.push(performance.now() - t0); shadow.push(w.renderer.shadowMap.needsUpdate); stamps.push(performance.now()); };
    await new Promise(resolve => {
      const loop = () => { if (t >= seconds) return resolve(); w.update(1 / 60); w.renderer.render(w.scene, w.camera); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    w.update = originalUpdate; this.physics.setInput = original.setInput;
    const frames = stamps.slice(1).map((s, k) => s - stamps[k]), f = bench.q(frames);
    const result = { seconds, frames: frames.length, frameIntervalMs: f, fpsMedian: +(1000 / f.median).toFixed(1), fps1PercentLow: +(1000 / f.p99).toFixed(1), updateMs: bench.q(updates, 3),
      shadowRefreshFrames: shadow.filter(Boolean).length, topSpeedKmh: +(this.physics.forwardSpeed * 3.6).toFixed(1), calls: w.renderer.info.render.calls, triangles: w.renderer.info.render.triangles, modelDrawCalls: this.model.drawCalls };
    this.exit({ silent: true });
    return result;
  }
}

const TMP = new THREE.Vector3(), TMP2 = new THREE.Vector3(), Q1 = new THREE.Quaternion(), E1 = new THREE.Euler();
// Driver's eye relative to the steering-wheel centre (model frame: +Z forward): behind and above the rim.
const EYE_OFFSET = new THREE.Vector3(0, 0.24, -0.46);
/** A parked car holds its brakes; it must never select reverse by itself (that is only for the driver's S key). */
const PARKED = Object.freeze({ throttle: 0, brake: 1, steer: 0, autoReverse: false });
