import * as THREE from 'three';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
export const SPAWN = Object.freeze({ x: -6.6, y: 1.76, z: -31.5, targetX: 1.57, targetZ: -11.5 });

export class PlayerController {
  constructor(camera, element, station) {
    this.camera = camera;
    this.element = element;
    this.station = station;
    this.bounds = station.bounds;
    this.colliders = station.colliders;
    this.stations = [station];
    this.service = null;
    this.ridingCar = null;
    this.ridingOffset = new THREE.Vector3();
    this.interiorObstacles = [];
    this.keys = new Set();
    this.walkSpeed = 4.5;
    this.sprintSpeed = 7;
    this.radius = 0.24;
    this.sensitivity = 0.0028;
    this.enabled = true;
    this.drag = null;
    this.yaw = 0;
    this.pitch = 0;
    this.distanceTravelled = 0;
    camera.rotation.order = 'YXZ';
    element.tabIndex = 0;
    element.setAttribute('aria-label', 'Metro station. Use WASD or arrow keys to walk, Shift to sprint, and drag to look.');
    this.events = new AbortController();
    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    const options = { signal: this.events.signal };
    window.addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return;
      if (MOVEMENT_KEYS.has(event.code) && this.enabled) { event.preventDefault(); this.keys.add(event.code); }
      if (event.code === 'KeyR' && !event.repeat && this.enabled) this.reset();
      if (event.code === 'KeyE' && !event.repeat && this.enabled) { event.preventDefault(); this.interact(); }
      if (event.code === 'Escape') this.releaseDrag();
    }, options);
    window.addEventListener('keyup', event => this.keys.delete(event.code), options);
    window.addEventListener('blur', () => { this.keys.clear(); this.releaseDrag(); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.keys.clear(); this.releaseDrag(); } }, options);
    this.element.addEventListener('pointerdown', event => {
      if (!this.enabled || event.button !== 0 || this.drag) return;
      this.element.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.element.setPointerCapture(event.pointerId);
      this.element.classList.add('dragging');
    }, options);
    this.element.addEventListener('pointermove', event => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.yaw -= (event.clientX - this.drag.x) * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - this.drag.y) * this.sensitivity, -1.35, 1.35);
      this.drag.x = event.clientX; this.drag.y = event.clientY;
      this.applyLook();
    }, options);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.element.addEventListener(type, event => {
      if (this.drag?.id === event.pointerId) this.releaseDrag();
    }, options);
    this.element.addEventListener('contextmenu', event => event.preventDefault(), options);
  }

  releaseDrag() {
    const pointerId = this.drag?.id;
    this.drag = null;
    this.element.classList.remove('dragging');
    if (pointerId !== undefined && this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) { this.keys.clear(); this.releaseDrag(); }
  }

  applyLook() { this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); }

  configureService(service, stations) {
    this.service = service;
    this.stations = stations;
  }

  useStation(station) {
    this.station = station;
    this.bounds = station.bounds;
    this.colliders = station.colliders;
  }

  interactionHint() {
    if (!this.service) return { text: '', enabled: false, action: null };
    const { service } = this;
    if (this.ridingCar) {
      return service.canBoard
        ? { text: `E · Leave train at ${service.currentStop.name}`, enabled: true, action: 'alight' }
        : { text: `On board · Next stop ${(service.nextStop ?? service.destinationStop).name}`, enabled: false, action: null };
    }
    if (service.canBoard && service.currentStop.id === this.station.stationId) {
      const door = service.train.nearestBoardingDoor(this.camera.position.x, this.camera.position.z);
      if (door?.distance <= 2.8) return { text: `E · Board train to ${service.destinationStop.name}`, enabled: true, action: 'board' };
      return { text: 'Walk up to an open door to board', enabled: false, action: null };
    }
    return { text: 'Stand behind the safety line · Train returns automatically', enabled: false, action: null };
  }

  interact() {
    if (!this.enabled || !this.interactionHint().enabled) return false;
    const { service } = this;
    if (this.ridingCar) {
      const station = this.stations.find(item => item.stationId === service.currentStop.id);
      const train = service.train;
      const doors = train.boardingDoors.filter(door => train.cars[door.carIndex] === this.ridingCar);
      const door = doors.reduce((best, item) => Math.abs(item.position.z - this.camera.position.z) < Math.abs(best.position.z - this.camera.position.z) ? item : best);
      this.ridingCar = null;
      this.useStation(station);
      this.camera.position.set(-1.3 + station.position.x, SPAWN.y + station.position.y, door.position.z);
      this.keys.clear();
      return true;
    }
    const door = service.train.nearestBoardingDoor(this.camera.position.x, this.camera.position.z);
    this.ridingCar = service.train.cars[door.carIndex];
    this.ridingOffset.set(-0.45, 1.85, this.ridingCar.position.z + door.localZ);
    this.interiorObstacles = [];
    // Seats and grab poles keep the rider in the aisle and vestibules.
    for (const side of [-1, 1]) for (const z of [-7.2, -3.5, -2.55, -1.6, 1.6, 2.55, 3.5, 7.2]) {
      this.interiorObstacles.push({ minX: side * 0.95 - 0.3, maxX: side * 0.95 + 0.3, minZ: z - 0.39, maxZ: z + 0.39 });
    }
    for (const z of [-5.5, 0, 5.5]) this.interiorObstacles.push({ minX: -0.024, maxX: 0.024, minZ: z - 0.024, maxZ: z + 0.024 });
    this.keys.clear();
    this.syncRide();
    return true;
  }

  syncRide() {
    if (!this.ridingCar) return;
    this.camera.position.copy(this.ridingOffset);
    this.service.train.localToWorld(this.camera.position);
  }

  reset() {
    this.releaseDrag();
    this.keys.clear();
    this.ridingCar = null;
    this.useStation(this.stations[0]);
    this.camera.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    this.yaw = Math.atan2(-(SPAWN.targetX - SPAWN.x), -(SPAWN.targetZ - SPAWN.z));
    this.pitch = -0.005;
    this.distanceTravelled = 0;
    this.applyLook();
  }

  collides(x, z, colliders = this.colliders) {
    return colliders.some(rect => {
      const closestX = THREE.MathUtils.clamp(x, rect.minX, rect.maxX);
      const closestZ = THREE.MathUtils.clamp(z, rect.minZ, rect.maxZ);
      return (x - closestX) ** 2 + (z - closestZ) ** 2 < this.radius ** 2;
    });
  }

  update(delta) {
    this.syncRide();
    if (!this.enabled) return;
    let forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    let strafe = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const length = Math.hypot(forward, strafe);
    if (!length) return;
    forward /= length; strafe /= length;
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? this.sprintSpeed : this.walkSpeed;
    const distance = speed * Math.min(delta, 0.05);
    const dx = (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe) * distance;
    const dz = (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe) * distance;
    // Small, independent axis steps prevent tunnelling and let the player slide along obstacles.
    const steps = Math.max(1, Math.ceil(distance / 0.09));
    const position = this.camera.position;
    const oldX = position.x, oldZ = position.z;
    if (this.ridingCar) {
      const offset = this.ridingOffset;
      const center = this.ridingCar.position.z;
      for (let i = 0; i < steps; i++) {
        const x = THREE.MathUtils.clamp(offset.x + dx / steps, -1.08, 1.08);
        if (!this.collides(x, offset.z - center, this.interiorObstacles)) offset.x = x;
        const z = THREE.MathUtils.clamp(offset.z + dz / steps, center - 7.05, center + 7.05);
        if (!this.collides(offset.x, z - center, this.interiorObstacles)) offset.z = z;
      }
      this.syncRide();
      this.distanceTravelled += Math.hypot(position.x - oldX, position.z - oldZ);
      return;
    }
    const stationX = this.station.position.x, stationZ = this.station.position.z;
    for (let i = 0; i < steps; i++) {
      const x = THREE.MathUtils.clamp(position.x + dx / steps, stationX + this.bounds.minX + this.radius, stationX + this.bounds.maxX - this.radius);
      if (!this.collides(x - stationX, position.z - stationZ)) position.x = x;
      const z = THREE.MathUtils.clamp(position.z + dz / steps, stationZ + this.bounds.minZ + this.radius, stationZ + this.bounds.maxZ - this.radius);
      if (!this.collides(position.x - stationX, z - stationZ)) position.z = z;
    }
    position.y = SPAWN.y;
    this.distanceTravelled += Math.hypot(position.x - oldX, position.z - oldZ);
  }

  dispose() { this.releaseDrag(); this.events.abort(); }
}
