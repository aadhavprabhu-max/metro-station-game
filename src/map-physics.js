/**
 * Spring physics for the HUD network map, ported from the approved reference
 * (map-physics-reference.html). Pure maths: no DOM access, so it can be unit
 * tested and stepped at any frame rate. All gesture coordinates are relative
 * to the map element, never to the browser viewport.
 */
export const CAMERA_PHYSICS = Object.freeze({
  response: 0.62, damping: 0.92, // critically-damped flyTo spring on x, y and log-scale
  zoomRate: 14,                  // exponential smoothing for wheel / button zoom
  friction: 0.998,               // momentum decay per millisecond
  flingMinSpeed: 160,            // px/s needed to start a momentum glide
  flingStopSpeed: 10,            // px/s at which a glide ends
  velocityWindowMs: 100,         // pointer history used for release velocity
});
export const SHEET_PHYSICS = Object.freeze({
  response: 0.46, damping: 0.8, projection: 0.42, collapsed: 78,
});
export const STEP_SECONDS = 1 / 120;
// The game simulation caps frames at 0.25 s too; fixed 1/120 s steps keep the
// motion identical at normal frame rates and real-time on slow devices.
export const MAX_FRAME_SECONDS = 0.25;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** Rubber-band displacement past a limit, as in the reference. */
export const rubber = (distance, dimension) => (1 - 1 / (distance * 0.55 / dimension + 1)) * dimension;

/** Fixed-step integration, so behaviour does not depend on the display refresh rate. */
export function integrate(frameSeconds, step) {
  let live = false;
  for (let t = Math.min(MAX_FRAME_SECONDS, Math.max(0, frameSeconds)); t > 1e-9; t -= STEP_SECONDS) live = step(Math.min(STEP_SECONDS, t)) || live;
  return live;
}

/** Release velocity from the last ~100 ms of pointer samples ({ t, x, y }). */
export function releaseVelocity(history) {
  const a = history[0], b = history[history.length - 1], dt = (b.t - a.t) / 1000;
  return dt > 0.008 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 };
}
export function pushHistory(history, sample, windowMs = CAMERA_PHYSICS.velocityWindowMs) {
  history.push(sample);
  while (history.length > 2 && sample.t - history[0].t > windowMs) history.shift();
}

export class MapCamera {
  constructor(mapSize) {
    this.map = { width: mapSize.width, height: mapSize.height };
    this.x = 0; this.y = 0; this.s = 1;
    this.vx = 0; this.vy = 0; this.vls = 0; this.fvx = 0; this.fvy = 0;
    this.goal = null; this.zoom = null;
    this.fitScale = 0.6; this.moved = false; this.reduceMotion = false;
    this.width = 1; this.height = 1;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    const omega = 2 * Math.PI / CAMERA_PHYSICS.response;
    this.k = omega * omega; this.c = 2 * CAMERA_PHYSICS.damping * omega;
  }

  /** Element size in CSS pixels. Insets mark regions covered by overlays (cards). */
  setViewport(width, height, insets = this.insets) {
    this.width = Math.max(1, width); this.height = Math.max(1, height); this.insets = { ...this.insets, ...insets };
    this.fitScale = this.fitAll().s;
  }

  visible(insets = this.insets, height = this.height) {
    return { x0: insets.left, y0: insets.top, x1: this.width - insets.right, y1: Math.max(insets.top + 40, height - insets.bottom) };
  }
  /** Margins and rubber-band distance scale with the element instead of the reference's full screen. */
  get margin() { return clamp(Math.min(this.width, this.height) * 0.3, 24, 140); }
  get rubberDimension() { return clamp(Math.max(this.width, this.height) * 0.35, 60, 320); }
  get minScale() { return this.fitScale * 0.7; }
  /** Scaled to the element: about 9× the fitted view, so symbols keep the reference proportions. */
  get maxScale() { return clamp(this.fitScale * 9, 1.6, 4); }

  boundsFor(s) {
    const v = this.visible(), m = this.margin;
    return { xmin: v.x0 + m - this.map.width * s, xmax: v.x1 - m, ymin: v.y0 + m - this.map.height * s, ymax: v.y1 - m };
  }
  fitBox(box, pad, insets = this.insets, height = this.height) {
    const v = this.visible(insets, height), w = Math.max(20, v.x1 - v.x0 - pad * 2), h = Math.max(20, v.y1 - v.y0 - pad * 2);
    const s = clamp(Math.min(w / box.w, h / box.h), 0.05, 8);
    return { x: (v.x0 + v.x1) / 2 - (box.x + box.w / 2) * s, y: (v.y0 + v.y1) / 2 - (box.y + box.h / 2) * s, s };
  }
  fitAll(height = this.height) {
    const pad = clamp(Math.min(this.width, height) * 0.06, 8, 24);
    return this.fitBox({ x: 0, y: 0, w: this.map.width, h: this.map.height }, pad, { top: 0, right: 0, bottom: 0, left: 0 }, height);
  }
  /** Map point to element coordinates. */
  project(x, y) { return { x: x * this.s + this.x, y: y * this.s + this.y }; }

  apply(goal) { this.x = goal.x; this.y = goal.y; this.s = goal.s; }
  stop() { this.goal = null; this.zoom = null; this.fvx = this.fvy = 0; this.vx = this.vy = this.vls = 0; }

  flyTo(goal, { instant = false, auto = false } = {}) {
    if (!auto) this.moved = true;
    if (instant || this.reduceMotion) { this.stop(); this.apply(goal); return; }
    this.zoom = null; this.fvx = this.fvy = 0; this.goal = { x: goal.x, y: goal.y, ls: Math.log(goal.s) };
  }
  flyToPoint(x, y, s = this.s) {
    const v = this.visible();
    this.flyTo({ x: (v.x0 + v.x1) / 2 - x * s, y: (v.y0 + v.y1) / 2 - y * s, s });
  }
  /** Zoom around an element-relative focus point; the map point under it stays fixed. */
  zoomAbout(fx, fy, factor) {
    this.moved = true; this.goal = null;
    const base = this.zoom ? this.zoom.ls : Math.log(this.s);
    const ls = clamp(base + Math.log(factor), Math.log(this.minScale), Math.log(this.maxScale));
    if (this.reduceMotion) {
      const s0 = this.s, s1 = Math.exp(ls);
      this.x = fx - (fx - this.x) * s1 / s0; this.y = fy - (fy - this.y) * s1 / s0; this.s = s1; this.settleBounds(); return;
    }
    this.zoom = { ls, fx, fy };
  }
  settleBounds() {
    const s = clamp(this.s, this.minScale, this.maxScale), b = this.boundsFor(s);
    const x = clamp(this.x, b.xmin, b.xmax), y = clamp(this.y, b.ymin, b.ymax);
    if (Math.abs(x - this.x) > 0.5 || Math.abs(y - this.y) > 0.5 || Math.abs(s - this.s) > 0.001) this.flyTo({ x, y, s }, { auto: true });
  }

  /** One fixed integration step; returns true while still moving. */
  step(dt) {
    let live = false;
    if (this.goal) {
      const g = this.goal, { k, c } = this;
      this.vx += (-k * (this.x - g.x) - c * this.vx) * dt; this.x += this.vx * dt;
      this.vy += (-k * (this.y - g.y) - c * this.vy) * dt; this.y += this.vy * dt;
      let ls = Math.log(this.s); this.vls += (-k * (ls - g.ls) - c * this.vls) * dt; ls += this.vls * dt; this.s = Math.exp(ls);
      const near = Math.abs(this.x - g.x) < 0.2 && Math.abs(this.y - g.y) < 0.2 && Math.abs(ls - g.ls) < 0.0005
        && Math.abs(this.vx) + Math.abs(this.vy) < 4 && Math.abs(this.vls) < 0.01;
      if (near) { this.x = g.x; this.y = g.y; this.s = Math.exp(g.ls); this.goal = null; this.vx = this.vy = this.vls = 0; } else live = true;
    }
    if (this.zoom) {
      const z = this.zoom, ls = Math.log(this.s), next = ls + (z.ls - ls) * (1 - Math.exp(-dt * CAMERA_PHYSICS.zoomRate)), s1 = Math.exp(next);
      this.x = z.fx - (z.fx - this.x) * s1 / this.s; this.y = z.fy - (z.fy - this.y) * s1 / this.s; this.s = s1;
      if (Math.abs(z.ls - next) < 0.0008) { this.zoom = null; this.settleBounds(); } else live = true;
    }
    if (this.fvx || this.fvy) {
      const f = Math.pow(CAMERA_PHYSICS.friction, dt * 1000);
      this.x += this.fvx * dt; this.y += this.fvy * dt; this.fvx *= f; this.fvy *= f;
      if (Math.hypot(this.fvx, this.fvy) < CAMERA_PHYSICS.flingStopSpeed) { this.fvx = this.fvy = 0; this.settleBounds(); } else live = true;
    }
    return live || Boolean(this.goal || this.zoom || this.fvx || this.fvy);
  }

  // ---- gestures (element-relative coordinates) ----
  beginDrag(x, y, t) { this.stop(); this.drag = { x0: x, y0: y, cx: this.x, cy: this.y, history: [{ t, x, y }], distance: 0 }; }
  dragTo(x, y, t) {
    const d = this.drag; if (!d) return;
    const dx = x - d.x0, dy = y - d.y0; d.distance = Math.max(d.distance, Math.hypot(dx, dy));
    const b = this.boundsFor(this.s), dim = this.rubberDimension;
    const band = (v, lo, hi) => v < lo ? lo - rubber(lo - v, dim) : v > hi ? hi + rubber(v - hi, dim) : v;
    this.x = band(d.cx + dx, b.xmin, b.xmax); this.y = band(d.cy + dy, b.ymin, b.ymax);
    if (d.distance > 4) this.moved = true;
    pushHistory(d.history, { t, x, y });
  }
  /** Ends a drag; a fast release glides with friction, otherwise the camera settles inside its bounds. */
  endDrag() {
    const d = this.drag; this.drag = null; if (!d) return;
    const v = releaseVelocity(d.history);
    if (Math.hypot(v.x, v.y) > CAMERA_PHYSICS.flingMinSpeed && !this.reduceMotion) { this.fvx = v.x; this.fvy = v.y; } else this.settleBounds();
  }
  beginPinch(a, b) {
    this.stop(); this.drag = null;
    this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, s0: this.s, x0: this.x, y0: this.y };
  }
  pinchTo(a, b) {
    const p = this.pinch; if (!p) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const s = clamp(p.s0 * d / p.d0, this.fitScale * 0.55, this.maxScale * 1.125), wx = (p.mx - p.x0) / p.s0, wy = (p.my - p.y0) / p.s0;
    this.s = s; this.x = mx - wx * s; this.y = my - wy * s; this.moved = true;
  }
  endPinch() { this.pinch = null; }
}

/** The map drawer's height spring with three detents. */
export class SheetSpring {
  constructor() {
    const omega = 2 * Math.PI / SHEET_PHYSICS.response;
    this.k = omega * omega; this.c = 2 * SHEET_PHYSICS.damping * omega;
    this.detents = [SHEET_PHYSICS.collapsed, 320, 560];
    this.h = SHEET_PHYSICS.collapsed; this.v = 0; this.target = this.h; this.index = 0; this.drag = null; this.reduceMotion = false;
  }
  setDetents(detents) {
    this.detents = detents; this.target = detents[this.index];
    if (!this.drag && Math.abs(this.v) < 1) this.h = this.target;
  }
  setDetent(index, velocity = 0, instant = false) {
    this.index = clamp(index, 0, this.detents.length - 1); this.target = this.detents[this.index]; this.v = velocity;
    if (instant || this.reduceMotion) { this.h = this.target; this.v = 0; }
  }
  /** Pointer position along the drag axis (element/viewport y); downward grows the drawer. */
  beginDrag(y, t) { this.drag = { y0: y, h0: this.h, history: [{ t, x: 0, y }], distance: 0 }; this.v = 0; }
  dragTo(y, t) {
    const d = this.drag; if (!d) return;
    const dy = y - d.y0; d.distance = Math.max(d.distance, Math.abs(dy));
    const [min, , max] = this.detents, raw = d.h0 + dy;
    this.h = raw > max ? max + rubber(raw - max, 140) : raw < min ? min - rubber(min - raw, 40) : raw;
    pushHistory(d.history, { t, x: 0, y });
  }
  /** Projects the release (h + v·0.42) to the nearest detent and keeps the release velocity. */
  endDrag() {
    const d = this.drag; this.drag = null; if (!d) return null;
    if (d.distance < 4) { this.v = 0; return { tap: true }; }
    const v = releaseVelocity(d.history).y, projected = this.h + v * SHEET_PHYSICS.projection;
    let index = 0; this.detents.forEach((x, i) => { if (Math.abs(x - projected) < Math.abs(this.detents[index] - projected)) index = i; });
    this.setDetent(index, v);
    return { tap: false, index };
  }
  step(dt) {
    if (this.drag) return false;
    this.v += (-this.k * (this.h - this.target) - this.c * this.v) * dt; this.h += this.v * dt;
    if (Math.abs(this.h - this.target) < 0.3 && Math.abs(this.v) < 6) { this.h = this.target; this.v = 0; return false; }
    return true;
  }
}

/** CSS `linear()` easing sampled from a spring (response 0.5 s, damping ratio 0.78). */
export function springEasing({ response = 0.5, damping = 0.78, points = 40 } = {}) {
  const w = 2 * Math.PI / response, dt = 1 / 240; let x = 0, v = 0; const xs = [0];
  for (let i = 0; i < 960; i++) {
    v += (-w * w * (x - 1) - 2 * damping * w * v) * dt; x += v * dt; xs.push(x);
    if (i > 20 && Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.01) break;
  }
  const values = [];
  for (let i = 0; i <= points; i++) values.push(+xs[Math.round(i / points * (xs.length - 1))].toFixed(4));
  values[points] = 1;
  return { easing: `linear(${values.join(',')})`, duration: +(xs.length * dt).toFixed(2) };
}
