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
    this.services = [];
    this.service = null;
    this.transfers = [];
    this.transferSurface = null;
    this.startLineId = station.lineId ?? 'U1';
    this.startStationId = station.stationId;
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
    this.configureServices([service], stations);
  }

  configureServices(services, stations) {
    this.services = services;
    this.stations = stations;
    this.service = services.find(service => service.lineId === (this.station.lineId ?? 'U1')) ?? services[0];
  }

  configureTransfers(transfers) {
    this.transfers = (Array.isArray(transfers) ? transfers : [transfers]).filter(Boolean);
    this.transferSurface = this.findTransferSurface(this.camera.position.x, this.camera.position.z, this.camera.position.y - SPAWN.y);
  }

  useStation(station) {
    this.station = station;
    this.bounds = station.bounds;
    this.colliders = station.colliders;
    if (!this.ridingCar) this.service = this.services.find(service => service.lineId === (station.lineId ?? 'U1')) ?? this.service;
  }

  startAt(lineId, stationId = null) {
    const service = this.services.find(item => item.lineId === lineId);
    const id = stationId ?? service?.route.stops[0].id;
    if (!service || !this.stations.some(station => station.stationId === id && station.lineId === lineId)) return false;
    this.startLineId = lineId;
    this.startStationId = id;
    this.reset();
    return true;
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
      const sameLevel = door && Math.abs(door.position.y - (this.camera.position.y - SPAWN.y)) <= 0.45;
      if (door?.distance <= 2.8 && sameLevel) return { text: `E · Board train to ${service.destinationStop.name}`, enabled: true, action: 'board' };
      return { text: 'Walk up to an open door to board', enabled: false, action: null };
    }
    return { text: 'Stand behind the safety line · Train returns automatically', enabled: false, action: null };
  }

  interact() {
    if (!this.enabled || !this.interactionHint().enabled) return false;
    const { service } = this;
    if (this.ridingCar) {
      const station = this.stations.find(item => item.stationId === service.currentStop.id && (item.lineId ?? 'U1') === service.lineId);
      const train = service.train;
      const doors = train.boardingDoors.filter(door => train.cars[door.carIndex] === this.ridingCar);
      const door = doors.reduce((best, item) => Math.abs(item.position.z - this.camera.position.z) < Math.abs(best.position.z - this.camera.position.z) ? item : best);
      this.ridingCar = null;
      this.transferSurface = null;
      this.useStation(station);
      const localDoor = station.worldToLocal(door.position.clone());
      this.camera.position.set(-1.3, SPAWN.y, localDoor.z);
      station.localToWorld(this.camera.position);
      this.keys.clear();
      return true;
    }
    const door = service.train.nearestBoardingDoor(this.camera.position.x, this.camera.position.z);
    this.transferSurface = null;
    this.ridingCar = service.train.cars[door.carIndex];
    this.ridingOffset.set(door.side * 0.45, 1.85, this.ridingCar.position.z + door.localZ);
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
    this.transferSurface = null;
    const start = this.stations.find(station => station.stationId === this.startStationId && (station.lineId ?? 'U1') === this.startLineId) ?? this.stations[0];
    this.useStation(start);
    this.camera.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    start.localToWorld(this.camera.position);
    const target = start.localToWorld(new THREE.Vector3(SPAWN.targetX, SPAWN.y, SPAWN.targetZ));
    this.yaw = Math.atan2(-(target.x - this.camera.position.x), -(target.z - this.camera.position.z));
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

  constrainPlatformAxis(value, fixed, axis, fallback) {
    const other = axis === 'X' ? 'Z' : 'X';
    const areas = this.station.walkableAreas ?? [this.bounds];
    let nearest = fallback, nearestDistance = Infinity;
    for (const area of areas) {
      if (fixed < area[`min${other}`] + this.radius || fixed > area[`max${other}`] - this.radius) continue;
      const candidate = THREE.MathUtils.clamp(value, area[`min${axis}`] + this.radius, area[`max${axis}`] - this.radius);
      const distance = Math.abs(candidate - value);
      if (distance < nearestDistance) { nearest = candidate; nearestDistance = distance; }
    }
    return nearest;
  }

  updatePlatformContext() {
    // The interchange is one station with connected physical platforms. Change
    // the boarding context only after actually walking onto the other platform.
    for (const station of this.stations) {
      if (station === this.station || station.stationId !== this.station.stationId) continue;
      const local = station.worldToLocal(this.camera.position.clone());
      // Shared Central has platforms at different elevations. Matching only
      // X/Z would select the upper hall while standing on the lower railway.
      if (Math.abs(local.y - SPAWN.y) > 0.45) continue;
      const { minX, maxX, minZ, maxZ } = station.bounds;
      if (local.x >= minX + this.radius && local.x <= maxX - this.radius
        && local.z >= minZ + this.radius && local.z <= maxZ - this.radius) {
        this.useStation(station);
        break;
      }
    }
  }

  findTransferSurface(x, z, feetY) {
    let best = null;
    for (const transfer of this.transfers) {
      const candidate = transfer.findSurface(x, z, feetY, 0.45, this.radius);
      if (candidate && (!best || candidate.difference < best.difference)) best = candidate;
    }
    return best;
  }

  findPlatformSurface(x, z, feetY) {
    for (const station of this.stations) {
      if (station.stationId !== this.station.stationId) continue;
      const local = station.worldToLocal(new THREE.Vector3(x, feetY, z));
      if (Math.abs(local.y) > 0.45) continue;
      const { minX, maxX, minZ, maxZ } = station.bounds;
      if (local.x < minX + this.radius || local.x > maxX - this.radius
        || local.z < minZ + this.radius || local.z > maxZ - this.radius
        || this.collides(local.x, local.z, station.colliders)) continue;
      const floorY = station.localToWorld(new THREE.Vector3(local.x, 0, local.z)).y;
      return { station, floorY };
    }
    return null;
  }

  moveOnTransfer(dx, dz, steps) {
    const position = this.camera.position;
    for (let step = 0; step < steps; step++) {
      for (const [axis, amount] of [['x', dx / steps], ['z', dz / steps]]) {
        const x = position.x + (axis === 'x' ? amount : 0);
        const z = position.z + (axis === 'z' ? amount : 0);
        const feetY = position.y - SPAWN.y;
        const surface = this.findTransferSurface(x, z, feetY);
        if (surface) {
          position.set(x, surface.floorY + SPAWN.y, z);
          this.transferSurface = surface;
          continue;
        }
        const platform = this.findPlatformSurface(x, z, feetY);
        if (platform) {
          position.set(x, platform.floorY + SPAWN.y, z);
          this.transferSurface = null;
          this.useStation(platform.station);
        }
      }
    }
    this.updatePlatformContext();
  }

  update(delta) {
    this.syncRide();
    if (!this.enabled) return;
    if (!this.ridingCar) {
      this.transferSurface = this.findTransferSurface(this.camera.position.x, this.camera.position.z, this.camera.position.y - SPAWN.y);
      this.updatePlatformContext();
    }
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
    const oldX = position.x, oldY = position.y, oldZ = position.z;
    if (this.ridingCar) {
      const offset = this.ridingOffset;
      const center = this.ridingCar.position.z;
      this.service.train.updateWorldMatrix(true, false);
      const matrix = this.service.train.matrixWorld.elements;
      const localDx = matrix[0] * dx + matrix[2] * dz;
      const localDz = matrix[8] * dx + matrix[10] * dz;
      for (let i = 0; i < steps; i++) {
        const x = THREE.MathUtils.clamp(offset.x + localDx / steps, -1.08, 1.08);
        if (!this.collides(x, offset.z - center, this.interiorObstacles)) offset.x = x;
        const z = THREE.MathUtils.clamp(offset.z + localDz / steps, center - 7.05, center + 7.05);
        if (!this.collides(offset.x, z - center, this.interiorObstacles)) offset.z = z;
      }
      this.syncRide();
      this.distanceTravelled += Math.hypot(position.x - oldX, position.z - oldZ);
      return;
    }
    if (this.transferSurface) {
      this.moveOnTransfer(dx, dz, steps);
      this.distanceTravelled += Math.hypot(position.x - oldX, position.y - oldY, position.z - oldZ);
      return;
    }
    const local = this.station.worldToLocal(position.clone());
    const matrix = this.station.matrixWorld.elements;
    const localDx = matrix[0] * dx + matrix[2] * dz;
    const localDz = matrix[8] * dx + matrix[10] * dz;
    for (let i = 0; i < steps; i++) {
      const x = this.constrainPlatformAxis(local.x + localDx / steps, local.z, 'X', local.x);
      if (!this.collides(x, local.z)) local.x = x;
      const z = this.constrainPlatformAxis(local.z + localDz / steps, local.x, 'Z', local.z);
      if (!this.collides(local.x, z)) local.z = z;
    }
    local.y = SPAWN.y;
    position.copy(this.station.localToWorld(local));
    this.transferSurface = this.findTransferSurface(position.x, position.z, position.y - SPAWN.y);
    this.updatePlatformContext();
    this.distanceTravelled += Math.hypot(position.x - oldX, position.z - oldZ);
  }

  dispose() { this.releaseDrag(); this.events.abort(); }
}
