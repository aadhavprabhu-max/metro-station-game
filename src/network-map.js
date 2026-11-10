import { MapCamera } from './map-physics.js';

/**
 * Interactive HUD network map on its own 2D canvas (no WebGL, no effect on the
 * 3D scene). Draws the model built from live game data using the reference
 * map's symbols, and ports the reference camera physics. All pointer maths is
 * relative to the map element.
 *
 * Future overlays (e.g. live train markers) can register with addOverlay();
 * none are drawn today.
 */
const SYMBOL_CAP = 1.6;      // symbols and labels stop growing past this zoom
const SYMBOL_FLOOR = 0.3;    // …and never thin below this, so tracks stay legible in a small HUD
const TAP_RADIUS = 28;      // reference value, scaled down for compact maps
const DIM_ALPHA = 0.13;
const DIM_SECONDS = 0.45;
const DRAW_IN_SECONDS = 0.95;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const normalise = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** cubic-bezier(x1, y1, x2, y2) easing, solved numerically. */
function bezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  return x => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < x) lo = mid; else hi = mid; } return at(y1, y2, (lo + hi) / 2); };
}
const drawInEase = bezier(0.2, 0.8, 0.2, 1);

const ICONS = {
  plus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
  minus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 10h12"/></svg>',
  fit: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg>',
  key: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.2v.1"/></svg>',
  close: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>',
  chevron: '<svg class="gm-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
};

export class NetworkMap {
  /**
   * @param elements { view, search, clear, lineStrip } DOM elements owned by the HUD
   * @param model    from buildNetworkMapModel()
   * @param hooks    { requestDetent(index), currentDetent(), targetViewHeight(index), kick(), reduceMotion() }
   */
  constructor(elements, model, hooks) {
    this.el = elements; this.model = model; this.hooks = hooks;
    this.camera = new MapCamera(model.size);
    this.state = { line: null, station: null, key: false };
    this.dim = { from: null, to: null, t: 1 };
    this.drawIn = null;
    this.overlays = [];
    this.pointers = new Map();
    this.dirty = true; this.visibleHeight = 0; this.width = 0; this.maxHeight = 0; this.dpr = 1;
    this.sprites = new Map();
    this.buildDom();
    this.buildPaths();
    this.bindPointer(); this.bindKeys(); this.bindSearch();
    this.readTheme();
  }

  // ---------- DOM ----------
  buildDom() {
    const { view, lineStrip } = this.el;
    view.innerHTML = `<canvas class="gm-canvas" aria-hidden="true"></canvas>
      <div class="gm-ring" hidden><i class="c"></i><i class="a"></i><i class="b"></i></div>
      <div class="gm-tools" role="group" aria-label="Map view">
        <button type="button" data-tool="in" aria-label="Zoom in">${ICONS.plus}</button>
        <button type="button" data-tool="out" aria-label="Zoom out">${ICONS.minus}</button>
        <button type="button" data-tool="fit" aria-label="Show the whole network">${ICONS.fit}</button>
        <button type="button" data-tool="key" aria-label="Map key" aria-pressed="false">${ICONS.key}</button>
      </div>
      <div class="gm-card" role="region" aria-label="Map details" hidden></div>
      <div class="gm-results" role="listbox" aria-label="Station search results" hidden></div>`;
    this.canvas = view.querySelector('.gm-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.ring = view.querySelector('.gm-ring');
    this.card = view.querySelector('.gm-card');
    this.results = view.querySelector('.gm-results');
    this.tools = view.querySelector('.gm-tools');
    this.tools.addEventListener('click', event => {
      const tool = event.target.closest('[data-tool]')?.dataset.tool; if (!tool) return;
      const c = this.centre();
      if (tool === 'in') this.camera.zoomAbout(c.x, c.y, 1.7);
      if (tool === 'out') this.camera.zoomAbout(c.x, c.y, 1 / 1.7);
      if (tool === 'fit') { this.selectLine(null); this.clearStation(); this.camera.flyTo(this.camera.fitAll()); }
      if (tool === 'key') this.toggleKey();
      this.changed();
    });
    lineStrip.innerHTML = this.model.lineOrder.map(id => {
      const line = this.model.lines.get(id);
      return `<button type="button" class="gm-badge" data-line="${id}" aria-pressed="false" style="--c:${line.color};--k:${line.ink}" aria-label="Show line ${id}">${id}</button>`;
    }).join('');
    lineStrip.addEventListener('click', event => {
      const id = event.target.closest('[data-line]')?.dataset.line; if (!id) return;
      this.selectLine(this.state.line === id ? null : id);
    });
    this.card.addEventListener('click', event => {
      if (event.target.closest('[data-close]')) { this.clearCard(); return; }
      const pick = event.target.closest('[data-pick]'); if (pick) { this.selectLine(pick.dataset.pick); return; }
      const stop = event.target.closest('[data-station]'); if (stop) { this.selectStation(stop.dataset.station); return; }
      const fold = event.target.closest('[data-fold]');
      if (fold) {
        const open = fold.getAttribute('aria-expanded') !== 'true'; fold.setAttribute('aria-expanded', String(open));
        fold.closest('.gm-line-card').classList.toggle('open', open);
        window.setTimeout(() => this.measureCard(), 520);
      }
    });
    this.results.addEventListener('click', event => {
      const stop = event.target.closest('[data-station]'); if (stop) this.selectStation(stop.dataset.station);
    });
  }

  addOverlay(overlay) { this.overlays.push(overlay); this.changed(); return () => { this.overlays = this.overlays.filter(o => o !== overlay); this.changed(); }; }

  // ---------- geometry ----------
  buildPaths() {
    const polyline = points => { const p = new Path2D(); points.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)); return p; };
    this.paths = new Map();
    for (const line of this.model.lines.values()) {
      this.paths.set(line.id, {
        main: line.full ? new Path2D(line.d) : polyline(line.points),
        variant: line.variant ? new Path2D(line.variant.d) : null,
      });
    }
    const { decor } = this.model;
    this.decorPaths = { viaduct: decor.viaduct ? new Path2D(decor.viaduct.d) : null, portal: decor.portal ? new Path2D(decor.portal.d) : null };
    this.complexPaths = this.model.complexes.map(c => ({ ...c, connector: Object.keys(c.platforms).length ? new Path2D(c.connector) : null }));
  }

  /** Element size in CSS px. maxHeight sizes the canvas once for the tallest detent. */
  resize(width, maxHeight) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.width && maxHeight === this.maxHeight && dpr === this.dpr) return;
    this.width = width; this.maxHeight = maxHeight;
    if (dpr !== this.dpr) { this.dpr = dpr; this.sprites.clear(); }
    this.canvas.width = Math.max(1, Math.round(width * dpr)); this.canvas.height = Math.max(1, Math.round(maxHeight * dpr));
    this.canvas.style.width = `${width}px`; this.canvas.style.height = `${maxHeight}px`;
    this.camera.setViewport(width, Math.max(1, this.visibleHeight || maxHeight), this.insets());
    this.changed();
  }
  /** The drawer animates the visible height; the canvas itself is not reallocated. */
  setVisibleHeight(height) {
    height = Math.max(0, Math.round(height));
    if (height === this.visibleHeight) return;
    this.visibleHeight = height;
    if (height > 0) this.camera.setViewport(this.width, height, this.insets());
    this.changed();
  }
  insets() { return { top: 0, left: 0, right: 0, bottom: this.cardHeight ? this.cardHeight + 12 : 0 }; }
  centre() { const v = this.camera.visible(); return { x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2 }; }
  /** Fit the whole network for a given element height (used when the drawer changes detent). */
  autoFit(height, instant = false) {
    if (this.camera.moved) return;
    const goal = this.camera.fitAll(height);
    this.camera.flyTo(goal, { instant, auto: true }); this.changed();
  }

  readTheme() {
    const css = getComputedStyle(this.el.view);
    const v = name => css.getPropertyValue(name).trim();
    this.theme = {
      cas: v('--gm-cas'), halo: v('--gm-halo'), vbase: v('--gm-vbase'), via: v('--gm-via'), por: v('--gm-por'),
      stf: v('--gm-stf'), ix: v('--gm-ix'), ixc: v('--gm-ixc'), ixr: v('--gm-ixr'), lab: v('--gm-lab'), labStrong: v('--gm-lab-s'),
      labKnock: v('--gm-lab-k'), sub: v('--gm-sub'), font: v('--gh-font') || 'system-ui, sans-serif',
      overrides: Object.fromEntries(this.model.lineOrder.map(id => [id, v(`--gm-line-${id}`)]).filter(([, c]) => c)),
    };
    this.sprites.clear(); this.changed();
  }
  strokeFor(lineId) { return this.theme.overrides[lineId] || this.model.lines.get(lineId).color; }

  // ---------- animation ----------
  changed() { this.dirty = true; this.hooks.kick?.(); }
  step(dt) {
    let live = this.camera.step(dt);
    if (this.dim.t < 1) { this.dim.t = Math.min(1, this.dim.t + dt / DIM_SECONDS); live = true; }
    if (this.drawIn) { this.drawIn.t += dt / DRAW_IN_SECONDS; if (this.drawIn.t >= 1) this.drawIn = null; live = true; }
    if (live) this.dirty = true;
    return live || Boolean(this.camera.drag || this.camera.pinch);
  }
  alphaFor(lines) {
    const pick = id => !id || lines.includes(id) ? 1 : DIM_ALPHA;
    const t = this.hooks.reduceMotion() ? 1 : this.dim.t;
    return pick(this.dim.from) + (pick(this.dim.to) - pick(this.dim.from)) * (t * t * (3 - 2 * t));
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const { ctx, camera: cam, dpr, theme } = this, h = this.visibleHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (h <= 0 || !this.width) return;
    const s = cam.s, sym = Math.min(Math.max(s, SYMBOL_FLOOR), SYMBOL_CAP), f = sym / s;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, this.width * dpr, h * dpr); ctx.clip();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * cam.x, dpr * cam.y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (path, color, width, alpha = 1, dash = null) => {
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width * f;
      if (dash) ctx.setLineDash(dash); ctx.stroke(path); if (dash) { ctx.setLineDash([]); ctx.lineDashOffset = 0; }
    };
    // Tracks: casing, optional halo, track; the river loop as dashed alternative.
    for (const id of this.model.lineOrder) {
      const line = this.model.lines.get(id), paths = this.paths.get(id), a = this.alphaFor([id]);
      stroke(paths.main, theme.cas, 10, a);
      if (line.halo) stroke(paths.main, theme.halo, 7.6, a);
      if (this.drawIn?.id === id && !this.hooks.reduceMotion()) {
        const L = line.length / f, e = drawInEase(Math.min(1, this.drawIn.t));
        ctx.lineDashOffset = L * (1 - e);
        stroke(paths.main, this.strokeFor(id), 5, a, [L, L]);
      } else stroke(paths.main, this.strokeFor(id), 5, a);
      if (paths.variant) {
        stroke(paths.variant, theme.cas, 10, a);
        stroke(paths.variant, theme.vbase, 5, a);
        ctx.lineCap = 'butt'; stroke(paths.variant, this.strokeFor(id), 5, a, [7 / f, 5 / f]); ctx.lineCap = 'round';
      }
    }
    if (this.decorPaths.viaduct) stroke(this.decorPaths.viaduct, theme.via, 1.2, this.alphaFor([this.model.decor.viaduct.line]));
    if (this.decorPaths.portal) stroke(this.decorPaths.portal, theme.por, 1.8, this.alphaFor([this.model.decor.portal.line]));
    // Interchange complexes (Central).
    for (const c of this.complexPaths) {
      const a = this.alphaFor(this.model.stations.get(c.id).lines);
      if (c.connector) { stroke(c.connector, theme.ix, 7, a); stroke(c.connector, theme.ixr, 1.8, a); }
      ctx.globalAlpha = a;
      ctx.fillStyle = theme.ix; ctx.beginPath(); ctx.roundRect(c.body.x, c.body.y, c.body.w, c.body.h, c.body.r); ctx.fill();
      ctx.fillStyle = theme.ixc; ctx.strokeStyle = theme.ixr; ctx.lineWidth = 2.2 * f;
      ctx.beginPath(); ctx.roundRect(c.core.x, c.core.y, c.core.w, c.core.h, c.core.r); ctx.fill(); ctx.stroke();
      for (const p of Object.values(c.platforms)) this.interchangeDot(p.x, p.y, f);
    }
    // Stations.
    for (const st of this.model.stations.values()) {
      if (st.complex) continue;
      ctx.globalAlpha = this.alphaFor(st.lines);
      if (st.kind === 'interchange') { this.interchangeDot(st.x, st.y, f); continue; }
      const terminus = st.kind === 'terminus';
      ctx.beginPath(); ctx.arc(st.x, st.y, (terminus ? 5.6 : 4.3) * f, 0, Math.PI * 2);
      ctx.fillStyle = theme.stf; ctx.fill();
      ctx.strokeStyle = this.strokeFor(st.lines[0]); ctx.lineWidth = (terminus ? 3 : 2.3) * f; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Labels, chips and section captions in screen space (cached sprites).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const labelAlpha = smooth(7, 9, 13 * s), strongAlpha = smooth(5.5, 7.5, 13.5 * s), subAlpha = smooth(8, 10, 10.5 * s);
    for (const st of this.model.stations.values()) {
      const anchor = cam.project(st.x, st.y), a = this.alphaFor(st.lines);
      const at = p => ({ x: anchor.x + (p.x - st.x) * sym, y: anchor.y + (p.y - st.y) * sym });
      const strong = st.kind === 'interchange';
      const la = (strong ? strongAlpha : labelAlpha) * a;
      if (la > 0.01 && st.layout?.label) this.drawText(st.name, strong ? 'strong' : 'label', at(st.layout.label), st.layout.label.anchor, sym, la);
      if (st.sub && st.layout?.sub && subAlpha * a > 0.01) this.drawText(st.sub, 'sub', at(st.layout.sub), st.layout.sub.anchor, sym, subAlpha * a);
      if (st.chips.length && st.layout?.chips && strongAlpha * a > 0.01) this.drawChips(st, at(st.layout.chips), st.layout.chips.align, sym, strongAlpha * a);
    }
    for (const section of this.model.decor.sections) {
      const a = subAlpha * this.alphaFor([section.line]); if (a <= 0.01) continue;
      this.drawText(section.text, 'section', cam.project(section.x, section.y), section.anchor, sym, a);
    }
    ctx.globalAlpha = 1;
    for (const overlay of this.overlays) overlay.draw?.(ctx, { camera: cam, dpr, model: this.model, symbolScale: sym });
    ctx.restore();
    this.placeRing();
  }
  interchangeDot(x, y, f) {
    const { ctx, theme } = this;
    ctx.beginPath(); ctx.arc(x, y, 8.5 * f, 0, Math.PI * 2); ctx.fillStyle = theme.ix; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4.6 * f, 0, Math.PI * 2); ctx.fillStyle = theme.ixc; ctx.fill();
    ctx.strokeStyle = theme.ixr; ctx.lineWidth = 2.2 * f; ctx.stroke();
  }

  /** Text is rendered once per style into a sprite at the largest drawn size, then scaled. */
  sprite(text, style) {
    const key = `${style}|${text}`; let sprite = this.sprites.get(key);
    if (sprite) return sprite;
    const { theme } = this, scale = SYMBOL_CAP * this.dpr;
    const spec = {
      label: { size: 13, weight: 400, fill: theme.lab, knock: 3.5 },
      strong: { size: 13.5, weight: 700, fill: theme.labStrong, knock: 3.5 },
      sub: { size: 10.5, weight: 400, fill: theme.sub, knock: 3, spacing: 0 },
      section: { size: 10.5, weight: 400, fill: theme.sub, knock: 3, spacing: 0.4 },
    }[style];
    const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
    const font = `${spec.weight} ${spec.size * scale}px ${theme.font}`;
    c.font = font; if (spec.spacing) c.letterSpacing = `${spec.spacing * scale}px`;
    const metrics = c.measureText(text), pad = (spec.knock + 2) * scale;
    const ascent = metrics.fontBoundingBoxAscent ?? spec.size * scale * 0.8, descent = metrics.fontBoundingBoxDescent ?? spec.size * scale * 0.25;
    canvas.width = Math.ceil(metrics.width + pad * 2); canvas.height = Math.ceil(ascent + descent + pad * 2);
    c.font = font; if (spec.spacing) c.letterSpacing = `${spec.spacing * scale}px`;
    c.lineJoin = 'round'; c.lineWidth = spec.knock * scale; c.strokeStyle = theme.labKnock; c.fillStyle = spec.fill;
    c.strokeText(text, pad, pad + ascent); c.fillText(text, pad, pad + ascent);
    sprite = { canvas, width: metrics.width / scale, pad: pad / scale, baseline: (pad + ascent) / scale, scale };
    this.sprites.set(key, sprite); return sprite;
  }
  drawText(text, style, point, anchor, sym, alpha) {
    const sp = this.sprite(text, style), k = sym;
    const offset = anchor === 'end' ? sp.width : anchor === 'middle' ? sp.width / 2 : 0;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sp.canvas, point.x - (offset + sp.pad) * k, point.y - sp.baseline * k, sp.canvas.width / sp.scale * k, sp.canvas.height / sp.scale * k);
  }
  drawChips(station, point, align, sym, alpha) {
    const key = `chips|${station.chips.join(',')}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      const scale = SYMBOL_CAP * this.dpr, w = station.chips.length * 27 - 3, canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(15 * scale);
      const c = canvas.getContext('2d'); c.scale(scale, scale); c.font = `700 10px ${this.theme.font}`; c.textAlign = 'center';
      station.chips.forEach((id, i) => {
        const line = this.model.lines.get(id);
        c.fillStyle = line.color; c.beginPath(); c.roundRect(i * 27, 0, 24, 15, 4); c.fill();
        c.fillStyle = line.ink; c.fillText(id, i * 27 + 12, 11);
      });
      sp = { canvas, width: w, scale }; this.sprites.set(key, sp);
    }
    const x = align === 'end' ? point.x - sp.width * sym : align === 'middle' ? point.x - sp.width * sym / 2 : point.x;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sp.canvas, x, point.y, sp.width * sym, 15 * sym);
  }

  placeRing() {
    const st = this.state.station && this.model.stations.get(this.state.station);
    if (!st || this.visibleHeight <= 0) { this.ring.hidden = true; return; }
    const p = this.camera.project(st.x, st.y), sym = Math.min(this.camera.s, SYMBOL_CAP);
    this.ring.hidden = false;
    this.ring.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${(sym * (st.complex ? 1.6 : 1)).toFixed(3)})`;
  }

  // ---------- gestures ----------
  local(event) { const r = this.el.view.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  bindPointer() {
    const view = this.el.view, cam = this.camera;
    view.addEventListener('pointerdown', event => {
      if (event.target.closest('.gm-tools, .gm-card, .gm-results')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      try { view.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
      const p = this.local(event); this.pointers.set(event.pointerId, p);
      if (this.pointers.size === 1) { cam.beginDrag(p.x, p.y, performance.now()); this.tapStart = performance.now(); view.classList.add('grabbing'); }
      else if (this.pointers.size === 2) { const [a, b] = this.pointers.values(); cam.beginPinch(a, b); }
      this.changed();
    });
    view.addEventListener('pointermove', event => {
      if (!this.pointers.has(event.pointerId)) return;
      const p = this.local(event); this.pointers.set(event.pointerId, p);
      if (cam.pinch && this.pointers.size >= 2) { const [a, b] = this.pointers.values(); cam.pinchTo(a, b); }
      else cam.dragTo(p.x, p.y, performance.now());
      this.changed();
    });
    const end = event => {
      if (!this.pointers.has(event.pointerId)) return;
      const p = this.local(event); this.pointers.delete(event.pointerId);
      if (cam.pinch) {
        cam.endPinch();
        if (this.pointers.size === 1) { const [q] = this.pointers.values(); cam.beginDrag(q.x, q.y, performance.now()); cam.drag.distance = 99; }
        else cam.settleBounds();
        this.changed(); return;
      }
      if (!cam.drag) return;
      view.classList.remove('grabbing');
      const distance = cam.drag.distance;
      if (event.type === 'pointerup' && distance < 6 && performance.now() - this.tapStart < 450) { cam.drag = null; this.tap(p.x, p.y); return; }
      cam.endDrag(); this.changed();
    };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    view.addEventListener('wheel', event => {
      event.preventDefault();
      const p = this.local(event), k = event.deltaMode === 1 ? 40 : 1;
      cam.zoomAbout(p.x, p.y, Math.exp(-event.deltaY * k * (event.ctrlKey ? 0.012 : 0.0018))); this.changed();
    }, { passive: false });
    view.addEventListener('dblclick', event => { if (event.target.closest('.gm-tools, .gm-card, .gm-results')) return; const p = this.local(event); cam.zoomAbout(p.x, p.y, 2); this.changed(); });
  }
  tap(px, py) {
    let best = null, bestDistance = Math.min(TAP_RADIUS, Math.max(14, Math.min(this.width, this.visibleHeight) * 0.09));
    for (const st of this.model.stations.values()) {
      const p = this.camera.project(st.x, st.y), d = Math.hypot(p.x - px, p.y - py);
      if (d < bestDistance) { bestDistance = d; best = st; }
    }
    if (best) { this.selectStation(best.id); return; }
    // Tapping empty map clears the overlays that cover it (selection, card, search).
    this.closeSearch(true); this.clearCard();
  }

  /** Map keys work only while the map itself has focus; they never reach the walking controls. */
  bindKeys() {
    this.el.view.addEventListener('keydown', event => {
      if (event.target !== this.el.view) return;
      const c = this.centre(), cam = this.camera;
      const pan = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[event.key];
      if (event.key === '+' || event.key === '=') cam.zoomAbout(c.x, c.y, 1.5);
      else if (event.key === '-' || event.key === '_') cam.zoomAbout(c.x, c.y, 1 / 1.5);
      else if (pan) cam.flyTo({ x: (cam.goal ? cam.goal.x : cam.x) + pan[0], y: (cam.goal ? cam.goal.y : cam.y) + pan[1], s: cam.s });
      else if (event.key === '/') this.el.search.focus();
      else return;
      event.preventDefault(); event.stopPropagation(); this.changed();
    });
  }
  /** Escape inside the map: clear selection first; returns false when nothing was cleared. */
  escape() {
    if (this.state.station || this.state.line || this.state.key) { this.selectLine(null); this.clearCard(); return true; }
    return false;
  }

  // ---------- selection ----------
  setDim(to) {
    if (to === this.dim.to) return;
    const current = this.dim.t < 1 ? null : this.dim.to;
    this.dim = { from: this.dim.t < 1 ? this.dim.to : current, to, t: this.hooks.reduceMotion() ? 1 : 0 };
    this.changed();
  }
  selectLine(id, { fly = true } = {}) {
    this.state.line = id;
    for (const b of this.el.lineStrip.querySelectorAll('[data-line]')) b.setAttribute('aria-pressed', String(b.dataset.line === id));
    this.setDim(id);
    if (!id) { if (!this.state.station && !this.state.key) this.hideCard(); return; }
    this.state.station = null; this.state.key = false; this.syncKeyTool();
    if (!this.hooks.reduceMotion()) this.drawIn = { id, t: 0 };
    this.renderLineCard(this.model.lines.get(id));
    this.ensureRoomForCard();
    if (fly) this.flyToLine(id);
    this.changed();
  }
  flyToLine(id) {
    const line = this.model.lines.get(id), detent = Math.max(1, this.hooks.currentDetent());
    const height = this.hooks.targetViewHeight(detent), pad = Math.min(40, this.width * 0.08);
    this.camera.flyTo(this.camera.fitBox(line.bbox, pad, this.insets(), height));
  }
  selectStation(id) {
    const st = this.model.stations.get(id); if (!st) return;
    this.state.station = id; this.state.key = false; this.syncKeyTool();
    this.closeSearch(true);
    this.renderStationCard(st);
    this.ensureRoomForCard();
    const height = this.hooks.targetViewHeight(Math.max(1, this.hooks.currentDetent()));
    const v = this.camera.visible(this.insets(), height), s = Math.max(this.camera.s, Math.min(1.1, this.camera.maxScale));
    this.camera.flyTo({ x: (v.x0 + v.x1) / 2 - st.x * s, y: (v.y0 + v.y1) / 2 - st.y * s, s });
    this.changed();
  }
  /** Opens the drawer far enough that the map stays usable above a details card. */
  ensureRoomForCard() {
    let detent = Math.max(1, this.hooks.currentDetent());
    if (detent < 2 && this.hooks.targetViewHeight(detent) - (this.cardHeight || 0) - 12 < 110) detent = 2;
    if (detent !== this.hooks.currentDetent()) this.hooks.requestDetent(detent);
  }
  clearStation() { this.state.station = null; this.placeRing(); }
  clearCard() { this.state.station = null; this.state.key = false; this.syncKeyTool(); this.hideCard(); if (this.state.line) this.selectLine(null); this.changed(); }
  hideCard() { this.card.hidden = true; this.card.innerHTML = ''; this.cardHeight = 0; this.camera.setViewport(this.width, Math.max(1, this.visibleHeight), this.insets()); this.placeRing(); }
  toggleKey() {
    if (this.state.key) { this.state.key = false; this.syncKeyTool(); this.hideCard(); return; }
    this.state.key = true; this.state.station = null; this.selectLine(null, { fly: false }); this.syncKeyTool();
    this.showCard(`<div class="gm-card-top"><h3>Key</h3><button type="button" class="gm-x" data-close aria-label="Close key">${ICONS.close}</button></div>
      <ul class="gm-key">
        <li><svg viewBox="0 0 34 18" aria-hidden="true"><path d="M2 9H32" stroke="#8d58ac" stroke-width="5"/><circle class="k-st" cx="17" cy="9" r="4.3" stroke="#8d58ac" stroke-width="2.3"/></svg>Station</li>
        <li><svg viewBox="0 0 34 18" aria-hidden="true"><path d="M2 9H24" stroke="#8d58ac" stroke-width="5"/><circle class="k-st" cx="24" cy="9" r="5.6" stroke="#8d58ac" stroke-width="3"/></svg>Terminus</li>
        <li><svg viewBox="0 0 34 18" aria-hidden="true"><circle class="k-ix" cx="17" cy="9" r="8"/><circle class="k-ixc" cx="17" cy="9" r="4.4" stroke-width="2"/></svg>Interchange</li>
        <li><svg viewBox="0 0 34 18" aria-hidden="true"><path d="M17 1V17" stroke="#3e71b6" stroke-width="5"/><path class="k-cas" d="M2 9H32" stroke-width="9"/><path d="M2 9H32" stroke="#35947b" stroke-width="5"/></svg>Lines that cross without a symbol do not connect</li>
        ${this.model.lines.get('U5')?.variant ? '<li><svg viewBox="0 0 34 18" aria-hidden="true"><path class="k-vb" d="M2 9H32" stroke-width="5"/><path d="M2 9H32" stroke="#b88c39" stroke-width="5" stroke-dasharray="6 4"/></svg>U5 river loop, an alternative route</li>' : ''}
      </ul>`);
  }
  syncKeyTool() { this.tools.querySelector('[data-tool="key"]').setAttribute('aria-pressed', String(this.state.key)); }

  badge(id, large = false) {
    const line = this.model.lines.get(id);
    return `<span class="gm-badge${large ? ' lg' : ''}" style="--c:${line.color};--k:${line.ink}">${id}</span>`;
  }
  showCard(html) {
    this.card.innerHTML = html; this.card.hidden = false;
    this.card.classList.remove('show'); void this.card.offsetWidth; this.card.classList.add('show');
    this.measureCard();
  }
  measureCard() {
    this.cardHeight = this.card.hidden ? 0 : this.card.offsetHeight;
    this.camera.setViewport(this.width, Math.max(1, this.visibleHeight), this.insets()); this.changed();
  }
  renderStationCard(st) {
    const meta = [st.kind === 'terminus' ? 'Terminus' : st.lines.length > 1 ? 'Interchange' : 'Station', st.sub].filter(Boolean).join(' · ');
    let html = `<div class="gm-card-top"><h3>${esc(st.name)}</h3><button type="button" class="gm-x" data-close aria-label="Close station details">${ICONS.close}</button></div>`;
    html += `<div class="gm-meta">${esc(meta)}</div><div class="gm-row">${st.lines.map(id => `<button type="button" data-pick="${id}" aria-label="Show line ${id}">${this.badge(id, true)}</button>`).join('')}</div>`;
    if (st.transfers.length) html += `<ul class="gm-facts">${st.transfers.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
    if (st.levels.length) html += `<ul class="gm-facts gm-levels">${st.levels.map(l => `<li>${l.lines.map(id => this.badge(id)).join('')}<span>${esc(l.text)}</span></li>`).join('')}</ul>`;
    this.showCard(html);
  }
  renderLineCard(line) {
    const name = id => esc(this.model.stations.get(id)?.name ?? id);
    const stop = (id, own) => {
      const others = (this.model.stations.get(id)?.lines ?? []).filter(x => x !== own);
      return `<li class="gm-stop${others.length ? ' x' : ''}"><button type="button" data-station="${id}"><span class="nm">${name(id)}</span><span class="tags">${others.map(x => this.badge(x)).join('')}</span></button></li>`;
    };
    const loop = line.variant ? `<li class="gm-stops-heading">River loop · alternative to the direct track${line.variant.active ? ' · in service' : ''}</li>${line.variant.stops.map(s => stop(s.id, line.id)).join('')}` : '';
    this.showCard(`<div class="gm-line-card" style="--lc:${this.strokeFor(line.id)}">
      <div class="gm-card-top">${this.badge(line.id, true)}<div class="gm-line-title"><strong>${name(line.first)} ↔ ${name(line.last)}</strong><small>${line.name ? esc(line.name) + ' · ' : ''}${line.count} stops</small></div>
        <button type="button" class="gm-x" data-close aria-label="Close line details">${ICONS.close}</button></div>
      <button type="button" class="gm-fold-button" data-fold aria-expanded="false">Stops ${ICONS.chevron}</button>
      <div class="gm-fold"><div><ol class="gm-stops">${line.stops.map(s => stop(s.id, line.id)).join('')}${loop}</ol></div></div>
    </div>`);
  }

  // ---------- search ----------
  bindSearch() {
    const { search, clear } = this.el;
    search.addEventListener('focus', () => {
      if (!this.searching) { this.searching = true; this.beforeSearch = this.hooks.currentDetent(); }
      if (this.hooks.currentDetent() < 2) this.hooks.requestDetent(2);
      this.renderResults();
    });
    search.addEventListener('input', () => this.renderResults());
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') { const first = this.results.querySelector('[data-station]'); if (first) this.selectStation(first.dataset.station); event.preventDefault(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (search.value) { search.value = ''; this.renderResults(); } else this.closeSearch(); }
    });
    clear.addEventListener('click', () => { search.value = ''; this.renderResults(); search.focus(); });
  }
  renderResults() {
    const { search, clear } = this.el, raw = search.value.trim(), q = normalise(raw);
    clear.hidden = !search.value;
    this.results.hidden = !q;
    if (!q) return;
    const hits = this.model.stationList.filter(s => normalise(s.name).includes(q))
      .sort((a, b) => (normalise(a.name).startsWith(q) ? 0 : 1) - (normalise(b.name).startsWith(q) ? 0 : 1));
    this.results.innerHTML = hits.length
      ? `<ul>${hits.map(s => `<li><button type="button" role="option" data-station="${s.id}"><span class="nm">${esc(s.name)}</span><span class="tags">${s.lines.map(id => this.badge(id)).join('')}</span></button></li>`).join('')}</ul>`
      : `<p class="gm-none">No station matches “${esc(raw)}”.</p>`;
  }
  closeSearch(keepDetent = false) {
    const { search } = this.el;
    search.value = ''; this.renderResults();
    if (document.activeElement === search) search.blur();
    if (this.searching) { this.searching = false; if (!keepDetent) this.hooks.requestDetent(Math.max(this.beforeSearch ?? 1, 1)); }
  }
}
