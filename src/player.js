import * as THREE from 'three';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
export const SPAWN = Object.freeze({ x: -6.6, y: 1.76, z: -31.5, targetX: 1.57, targetZ: -11.5 });

export class PlayerController {
  constructor(camera, element, { bounds, colliders }) {
    this.camera = camera;
    this.element = element;
    this.bounds = bounds;
    this.colliders = colliders;
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

  reset() {
    this.releaseDrag();
    this.keys.clear();
    this.camera.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    this.yaw = Math.atan2(-(SPAWN.targetX - SPAWN.x), -(SPAWN.targetZ - SPAWN.z));
    this.pitch = -0.005;
    this.distanceTravelled = 0;
    this.applyLook();
  }

  collides(x, z) {
    return this.colliders.some(rect => {
      const closestX = THREE.MathUtils.clamp(x, rect.minX, rect.maxX);
      const closestZ = THREE.MathUtils.clamp(z, rect.minZ, rect.maxZ);
      return (x - closestX) ** 2 + (z - closestZ) ** 2 < this.radius ** 2;
    });
  }

  update(delta) {
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
    for (let i = 0; i < steps; i++) {
      const x = THREE.MathUtils.clamp(position.x + dx / steps, this.bounds.minX + this.radius, this.bounds.maxX - this.radius);
      if (!this.collides(x, position.z)) position.x = x;
      const z = THREE.MathUtils.clamp(position.z + dz / steps, this.bounds.minZ + this.radius, this.bounds.maxZ - this.radius);
      if (!this.collides(position.x, z)) position.z = z;
    }
    position.y = SPAWN.y;
    this.distanceTravelled += Math.hypot(position.x - oldX, position.z - oldZ);
  }

  dispose() { this.releaseDrag(); this.events.abort(); }
}
