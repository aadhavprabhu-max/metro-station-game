import './glass-hud.css';
import { SheetSpring, SHEET_PHYSICS, MAX_FRAME_SECONDS, integrate, springEasing } from './map-physics.js';
import { buildNetworkMapModel, collectTransfers, inkFor } from './network-map-model.js';
import { NetworkMap } from './network-map.js';

/**
 * Liquid Glass HUD (default interface). `?ui=legacy` keeps the original HUD.
 * Every control calls the existing UI handlers; live values are read from the
 * existing services. Nothing here changes simulation, data, rendering or audio.
 */
export const UI_MODE = new URLSearchParams(location.search).get('ui') === 'legacy' ? 'legacy' : 'glass';
document.documentElement.classList.add(UI_MODE === 'legacy' ? 'ui-legacy' : 'ui-glass');

/** Seconds before arrival at which the service pill switches to ARRIVING. */
export const APPROACHING_THRESHOLD_SECONDS = 10;
export const HINT_SECONDS = 10;
const THEME_KEY = 'aurealis-theme';
const DRAWER_STRIP = 36; // line-selection strip above the map view
const STATION_LABELS = Object.freeze({ boarding: 'DOORS OPEN', closing: 'DOORS CLOSING', departing: 'DEPARTING', stopped: 'ARRIVED' });

const ICONS = {
  menu: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 6.5h10M5 10h10M5 13.5h10"/></svg>',
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  reset: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 9.5a5.5 5.5 0 1 0 1.7-4"/><path d="M4.2 3.6v3.2h3.2"/></svg>',
  theme: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6.2"/><path d="M10 3.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" stroke="none"/></svg>',
  search: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>',
  clear: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>',
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function installSpringEasing() {
  if (!(window.CSS?.supports?.('transition-timing-function', 'linear(0, 1)'))) return; // keeps the cubic-bezier fallback
  const { easing, duration } = springEasing({ response: 0.5, damping: 0.78 });
  document.documentElement.style.setProperty('--spring', easing);
  document.documentElement.style.setProperty('--spring-d', `${duration}s`);
}

export function initialTheme() {
  const requested = new URLSearchParams(location.search).get('theme');
  if (requested === 'light' || requested === 'dark') return requested;
  try { const saved = localStorage.getItem(THEME_KEY); if (saved === 'light' || saved === 'dark') return saved; } catch { /* storage unavailable */ }
  return 'dark';
}

export class GlassHud {
  constructor(ui) {
    this.ui = ui; this.player = ui.player; this.approachingThreshold = APPROACHING_THRESHOLD_SECONDS;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    this.isOpen = false; this.raf = 0; this.last = 0;
    this.phase = { key: '', max: 1 };
    this.relocated = new Set();
    installSpringEasing();
    this.setTheme(initialTheme(), { persist: false });
    this.build();
    this.buildMap();
    this.bind();
    this.reduce.addEventListener?.('change', () => this.applyReducedMotion());
    this.applyReducedMotion();
    this.relocateLegacyControls();
    // Inspection API for tests, like window.metro; it exposes state, never data copies.
    window.metroHud = this;
  }

  /** True when no HUD animation is pending (sheet, camera, dimming, draw-in). */
  get settled() { return !this.raf && !this.sheet?.drag && !this.map?.camera.drag; }

  // ---------- DOM ----------
  build() {
    const ui = this.ui, root = document.createElement('div');
    root.id = 'glass-hud'; root.className = 'gh';
    const lines = ui.networkInfo;
    const rides = ui.rideLinks();
    root.innerHTML = `
      <div class="gh-top">
        <span class="gh-clock" id="gh-clock" aria-label="Station time">14:32</span>
        <button type="button" class="gh-menu-button gh-glass" id="gh-menu-button" aria-label="Open menu" aria-expanded="false" aria-controls="gh-panel">${ICONS.menu}</button>
      </div>
      <section class="gh-panel gh-glass" id="gh-panel" aria-label="Aurealis-Bahn menu" hidden inert>
        <div class="gh-upper">
          <div class="gh-section-head"><h2 class="gh-label">Start a line</h2>
            <button type="button" class="gh-theme-button" id="gh-theme-button">${ICONS.theme}</button></div>
          <div class="gh-start-grid">${lines.map((line, i) => {
            const first = ui.services[i].route.stops[0];
            return `<button type="button" class="gh-line-button" id="gh-start-${line.id.toLowerCase()}" data-start-line="${line.id}" data-start-station="${first.id}" aria-pressed="false" aria-label="Start ${line.id}" title="Start at ${esc(first.name)}" style="--line-color:${line.color}"><i aria-hidden="true"></i>${line.id}</button>`;
          }).join('')}</div>
          ${rides.length ? `<h2 class="gh-label">Rides</h2><nav class="gh-rides" aria-label="Rides">${rides.map(r => `<a class="gh-ride" href="${esc(r.href)}" data-ride="${esc(r.id)}"><span>${esc(r.label)}</span>${ICONS.chevron}</a>`).join('')}</nav>` : ''}
          <div class="gh-more" id="gh-more"></div>
        </div>
        <div class="gh-footer">
          <button type="button" class="gh-pill-button" id="gh-sound-button" aria-pressed="false">Sound off</button>
          <button type="button" class="gh-pill-button" id="gh-captions-button" aria-pressed="true">Captions on</button>
          <button type="button" class="gh-square-button" id="gh-reset-button" aria-label="Reset view" title="Reset view">${ICONS.reset}</button>
        </div>
        <section class="gm" id="gm-drawer" aria-label="Network map">
          <div class="gm-head">
            <label class="gm-search">${ICONS.search}<input id="gm-search" type="search" placeholder="Search stations" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search stations"><button type="button" class="gm-clear" id="gm-clear" aria-label="Clear search" hidden>${ICONS.clear}</button></label>
          </div>
          <div class="gm-body" id="gm-body" inert>
            <div class="gm-lines" id="gm-lines" role="toolbar" aria-label="Highlight a line"></div>
            <div class="gm-view" id="gm-view" tabindex="0" role="application" aria-roledescription="interactive map" aria-label="Network map. Drag to pan, scroll or pinch to zoom. With the map focused, use the arrow keys to pan and plus or minus to zoom."></div>
          </div>
          <div class="gm-grab-row"><h2 class="gh-label gm-title">Network map</h2><button type="button" class="gm-grab" id="gm-grab" aria-label="Expand map" aria-expanded="false" aria-controls="gm-body"><span></span></button><span class="gm-summary" id="gm-summary"></span></div>
        </section>
      </section>
      <div class="gh-actions" id="gh-actions"><p class="gh-hint" id="gh-hint" aria-hidden="true"><span class="gh-hint-fine">W A S D to walk · Shift to sprint · Drag to look · E to board</span><span class="gh-hint-touch">Use the pad to walk · Drag to look · Tap Board to ride</span></p></div>
      <div class="gh-pill gh-glass" id="gh-service-pill" data-state="between" aria-label="Live service">
        <span class="gh-roundel" id="gh-roundel">U1</span>
        <div class="gh-pill-body">
          <div class="gh-pill-current"><span class="gh-pill-label" id="gh-current-label">DOORS OPEN</span><strong id="gh-current-stop"></strong></div>
          <span class="gh-pill-divider" aria-hidden="true"></span>
          <div class="gh-pill-next"><span class="gh-pill-label" id="gh-next-label">NEXT</span><strong id="gh-next-stop"></strong></div>
        </div>
        <span class="gh-ring" role="timer" aria-label="Seconds remaining"><svg viewBox="0 0 54 54" aria-hidden="true"><circle class="gh-ring-track" cx="27" cy="27" r="24"/><circle class="gh-ring-value" id="gh-ring-value" cx="27" cy="27" r="24" pathLength="100"/></svg><span class="gh-ring-text" id="gh-ring-text">—</span></span>
        <span class="gh-progress" aria-hidden="true"><i id="gh-progress"></i></span>
      </div>`;
    document.querySelector('#app').append(root);
    this.root = root;
    const $ = s => root.querySelector(s);
    Object.assign(this, {
      clock: $('#gh-clock'), menuButton: $('#gh-menu-button'), panel: $('#gh-panel'), upper: $('.gh-upper'), footer: $('.gh-footer'),
      drawer: $('#gm-drawer'), drawerBody: $('#gm-body'), grab: $('#gm-grab'), more: $('#gh-more'),
      soundButton: $('#gh-sound-button'), captionsButton: $('#gh-captions-button'), resetButton: $('#gh-reset-button'), themeButton: $('#gh-theme-button'),
      actions: $('#gh-actions'), hint: $('#gh-hint'), pill: $('#gh-service-pill'),
      pillParts: { roundel: $('#gh-roundel'), currentLabel: $('#gh-current-label'), current: $('#gh-current-stop'), nextLabel: $('#gh-next-label'), next: $('#gh-next-stop'), ring: $('#gh-ring-value'), seconds: $('#gh-ring-text'), progress: $('#gh-progress') },
    });
    this.startButtons = [...root.querySelectorAll('[data-start-line]')];
    this.syncThemeButton();
    this.addControlsHelp();
  }

  /** The original controls reference stays available inside the menu. */
  addControlsHelp() {
    const list = document.querySelector('#help-panel dl'), note = document.querySelector('#help-panel .help-note');
    if (!list) return;
    const details = document.createElement('details'); details.className = 'gh-details'; details.id = 'gh-controls';
    details.innerHTML = '<summary>Controls & help</summary>';
    details.append(list.cloneNode(true)); if (note) details.append(note.cloneNode(true));
    this.more.append(details);
  }

  buildMap() {
    const services = this.ui.services, network = services[0]?.route.network;
    if (!network) return;
    const variants = Object.fromEntries(services.filter(s => s.route.variant).map(s => [s.lineId, s.route.variant]));
    if (network.phase6?.branch && !variants.U5) variants.U5 = 'direct';
    this.model = buildNetworkMapModel({ network, transfers: collectTransfers(services, this.player.transfers ?? []), variants });
    this.root.querySelector('#gm-summary').textContent = `${this.model.lines.size} lines · ${this.model.stations.size} stations`;
    this.sheet = new SheetSpring();
    this.map = new NetworkMap({
      view: this.root.querySelector('#gm-view'), search: this.root.querySelector('#gm-search'),
      clear: this.root.querySelector('#gm-clear'), lineStrip: this.root.querySelector('#gm-lines'),
    }, this.model, {
      requestDetent: index => this.setDetent(index),
      currentDetent: () => this.sheet.index,
      targetViewHeight: index => this.viewHeightFor(this.sheet.detents[index]),
      kick: () => this.kick(),
      reduceMotion: () => this.reduce.matches,
    });
  }

  // ---------- events ----------
  bind() {
    const ui = this.ui;
    this.menuButton.addEventListener('click', () => this.setMenuOpen(!this.isOpen));
    for (const button of this.startButtons) button.addEventListener('click', () => ui.startLine(button.dataset.startLine, button.dataset.startStation));
    this.soundButton.addEventListener('click', () => ui.toggleSound());
    this.captionsButton.addEventListener('click', () => this.setCaptions(this.captionsButton.getAttribute('aria-pressed') !== 'true'));
    this.resetButton.addEventListener('click', () => ui.resetView());
    this.themeButton.addEventListener('click', () => this.setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
    this.panel.addEventListener('transitionend', event => { if (event.target === this.panel && !this.isOpen) this.panel.hidden = true; });
    window.addEventListener('resize', () => { if (this.isOpen) this.measure(); });
    if (!this.map) return;
    // Grabber: a drag moves the drawer; a tap cycles detents. The pointer is
    // captured at once (a fast flick leaves the 28 px row on its first move), so
    // taps are recognised on release: capture retargets the click away from the button.
    const grabRow = this.grab.parentElement;
    grabRow.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      try { grabRow.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
      this.grabPointer = { id: event.pointerId };
      this.sheet.beginDrag(event.clientY, performance.now());
      this.kick();
    });
    grabRow.addEventListener('pointermove', event => {
      if (this.grabPointer?.id !== event.pointerId) return;
      this.sheet.dragTo(event.clientY, performance.now()); this.paintDrawer(); this.kick();
    });
    const endGrab = event => {
      if (this.grabPointer?.id !== event.pointerId) return;
      this.grabPointer = null;
      const result = this.sheet.endDrag();
      if (result?.tap && event.type === 'pointerup') {
        this.suppressGrabClick = true; window.setTimeout(() => { this.suppressGrabClick = false; }, 0);
        this.cycleDetent();
      } else if (result) this.afterDetent();
      this.kick();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) grabRow.addEventListener(type, endGrab);
    this.grab.addEventListener('click', () => {
      if (this.suppressGrabClick) { this.suppressGrabClick = false; return; }
      this.cycleDetent();
    });
    this.grab.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') this.setDetent(Math.min(2, this.sheet.index + 1));
      else if (event.key === 'ArrowUp') this.setDetent(Math.max(0, this.sheet.index - 1));
      else return;
      event.preventDefault(); event.stopPropagation();
    });
    // Escape inside the map: clear selection, then collapse, then (bubbling) close the menu.
    this.drawer.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.target.matches('input')) return;
      if (this.map.escape()) { event.stopPropagation(); return; }
      if (this.sheet.index > 0) { this.setDetent(0); this.grab.focus(); event.stopPropagation(); }
    });
  }

  // ---------- menu ----------
  setMenuOpen(open, { focus = true } = {}) {
    if (open === this.isOpen) { if (open && focus) this.focusFirst(); return; }
    this.isOpen = open;
    this.menuButton.setAttribute('aria-expanded', String(open));
    this.menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    this.menuButton.innerHTML = open ? ICONS.close : ICONS.menu;
    this.root.classList.toggle('gh-menu-open', open);
    if (open) {
      this.panel.hidden = false; this.panel.inert = false;
      this.measure();
      void this.panel.offsetWidth;
      this.panel.classList.add('open');
      if (focus) this.focusFirst();
      this.kick();
    } else {
      const hadFocus = this.panel.contains(document.activeElement);
      this.panel.classList.remove('open'); this.panel.inert = true;
      this.map?.closeSearch(true);
      if (hadFocus) this.menuButton.focus({ preventScroll: true });
      if (this.reduce.matches) this.panel.hidden = true;
      else window.setTimeout(() => { if (!this.isOpen) this.panel.hidden = true; }, 420);
    }
  }
  focusFirst() { (this.startButtons.find(b => b.getAttribute('aria-pressed') === 'true') ?? this.startButtons[0] ?? this.panel).focus({ preventScroll: true }); }

  // ---------- drawer (map sheet) ----------
  viewHeightFor(drawerHeight) { return Math.max(0, drawerHeight - SHEET_PHYSICS.collapsed - DRAWER_STRIP); }
  /** Detents relative to the panel's own available height (collapsed 78 px, half ≈ 50 % of the viewport, full). */
  measure() {
    if (!this.map) return;
    const panelTop = this.panel.offsetTop, avail = Math.max(240, this.root.clientHeight - panelTop - 12);
    const style = getComputedStyle(this.panel), pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), gap = parseFloat(style.rowGap) || 0;
    this.chrome = pad + this.footer.offsetHeight + gap * 2;
    this.available = avail;
    const collapsed = SHEET_PHYSICS.collapsed;
    const full = Math.max(collapsed + 160, Math.round(avail - this.chrome));
    const half = clamp(Math.round(window.innerHeight * 0.5), Math.min(260, full - 40), Math.max(Math.min(260, full - 40), full - 90));
    this.sheet.setDetents([collapsed, half, full]);
    this.panel.style.maxHeight = `${avail}px`;
    const width = this.drawer.clientWidth - 16;
    this.map.resize(width, this.viewHeightFor(full));
    this.paintDrawer();
    if (!this.map.camera.moved) this.map.autoFit(this.viewHeightFor(this.sheet.target), true);
  }
  /** Grabber tap: collapsed → half → full → half, as in the reference. */
  cycleDetent() { const i = this.sheet.index; this.setDetent(i === 0 ? 1 : i === 1 ? 2 : 1); }
  setDetent(index, velocity = 0) {
    if (!this.sheet) return;
    this.sheet.setDetent(index, velocity, this.reduce.matches);
    this.afterDetent();
    this.kick();
  }
  afterDetent() {
    const i = this.sheet.index;
    this.grab.setAttribute('aria-expanded', String(i > 0));
    this.grab.setAttribute('aria-label', i === 2 ? 'Shrink map' : i === 1 ? 'Expand map to full height' : 'Expand map');
    this.drawer.dataset.detent = ['collapsed', 'half', 'full'][i];
    this.drawerBody.inert = i === 0;
    this.map.autoFit(this.viewHeightFor(this.sheet.target));
  }
  paintDrawer() {
    if (!this.sheet) return;
    const h = this.sheet.h;
    this.drawer.style.height = `${h.toFixed(1)}px`;
    this.drawerBody.style.opacity = clamp((h - SHEET_PHYSICS.collapsed - 16) / 90, 0, 1).toFixed(3);
    const upperSpace = (this.available ?? 600) - (this.chrome ?? 160) - h;
    const upperOpacity = clamp(upperSpace / 140, 0, 1);
    this.upper.style.opacity = upperOpacity.toFixed(3);
    this.upper.inert = upperSpace < 48;
    this.map.setVisibleHeight(this.viewHeightFor(h));
  }
  applyReducedMotion() {
    const reduce = this.reduce.matches;
    if (this.sheet) this.sheet.reduceMotion = reduce;
    if (this.map) this.map.camera.reduceMotion = reduce;
    this.root.classList.toggle('gh-reduced-motion', reduce);
  }

  kick() { if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame(ts => this.frame(ts)); } }
  frame(ts) {
    // The first frame only primes the clock: a rAF timestamp can precede the kick.
    const dt = this.last ? Math.min(MAX_FRAME_SECONDS, Math.max(0, (ts - this.last) / 1000)) : 0; this.last = ts;
    let live = dt === 0;
    if (this.map) {
      if (dt > 0) live = integrate(dt, step => { const a = this.sheet.step(step), b = this.map.step(step); return a || b; });
      this.paintDrawer();
      if (this.isOpen) this.map.draw();
    }
    const busy = live || this.sheet?.drag || this.map?.camera.drag || this.map?.camera.pinch;
    this.raf = busy ? requestAnimationFrame(next => this.frame(next)) : 0;
  }

  // ---------- settings ----------
  setTheme(theme, { persist = true } = {}) {
    document.documentElement.dataset.theme = theme;
    if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ } }
    this.syncThemeButton();
    this.map?.readTheme();
  }
  syncThemeButton() {
    if (!this.themeButton) return;
    const light = document.documentElement.dataset.theme === 'light';
    this.themeButton.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    this.themeButton.setAttribute('aria-pressed', String(light));
    this.themeButton.title = light ? 'Dark theme' : 'Light theme';
  }
  /** Caption visibility is a display preference; the announcer keeps running unchanged. */
  setCaptions(on) {
    this.captionsButton.setAttribute('aria-pressed', String(on));
    this.captionsButton.textContent = on ? 'Captions on' : 'Captions off';
    this.root.closest('#app').classList.toggle('gh-captions-off', !on);
  }
  syncAnnouncements(status, label) {
    if (this.soundButton.textContent !== label) this.soundButton.textContent = label;
    this.soundButton.setAttribute('aria-pressed', String(status.enabled));
    this.soundButton.title = this.ui.soundButton?.title ?? '';
  }
  syncStartLine(lineId) { for (const b of this.startButtons) b.setAttribute('aria-pressed', String(b.dataset.startLine === lineId)); }
  setClock(text) { if (this.clock.textContent !== text) this.clock.textContent = text; }

  // ---------- existing gameplay controls ----------
  /** Moves the existing controls (same elements, same handlers) into the glass layout. */
  relocateLegacyControls() {
    const move = (selector, target, before = null) => {
      const el = document.querySelector(selector);
      if (!el || this.relocated.has(el) || !target) return;
      this.relocated.add(el); target.insertBefore(el, before);
    };
    move('#announcement-caption', this.actions, this.actions.firstChild);
    move('#interact-button', this.actions, this.hint);
    move('#app > .lift-action', this.actions, this.hint);
    move('.service-card .journey-times-button', this.more, this.more.firstChild);
    move('#help-panel #u10-timings', this.more, this.more.querySelector('#gh-controls'));
  }
  ready() {
    this.relocateLegacyControls();
    this.hint.classList.add('show');
    window.setTimeout(() => this.hint.classList.add('fade'), HINT_SECONDS * 1000);
  }

  // ---------- live service pill ----------
  update() {
    // Late-mounted controls (lift button, U10 journey times) appear within the first frames.
    if (this.relocated.size < 5 && (this.relocateFrames = (this.relocateFrames ?? 0) + 1) < 120) this.relocateLegacyControls();
    this.updatePill();
  }
  updatePill() {
    const live = this.ui.liveService(); if (!live) return;
    const { service, lineId, color, docked, current, next } = live, p = this.pillParts;
    let state, countdown;
    if (docked && !['travelling', 'arriving'].includes(service.state)) { state = 'station'; countdown = service.departureSeconds; }
    else { countdown = live.arrivalCountdown; state = Number.isFinite(countdown) && countdown <= APPROACHING_THRESHOLD_SECONDS ? 'approaching' : 'between'; }
    if (this.pill.dataset.state !== state) this.pill.dataset.state = state;
    if (this.pill.dataset.line !== lineId) {
      this.pill.dataset.line = lineId;
      this.pill.style.setProperty('--line', color); this.pill.style.setProperty('--line-ink', inkFor(color));
      p.roundel.textContent = lineId;
    }
    const set = (el, text) => { if (el.textContent !== text) el.textContent = text; };
    set(p.currentLabel, STATION_LABELS[service.state] ?? 'AT STATION');
    set(p.current, current.name);
    set(p.nextLabel, state === 'approaching' ? 'ARRIVING' : 'NEXT');
    set(p.next, next.name);
    const finite = Number.isFinite(countdown);
    set(p.seconds, finite ? String(Math.max(0, Math.ceil(countdown))) : '—');
    // The ring empties over the current phase (dwell or leg); its length is the longest value seen.
    const key = `${lineId}|${state === 'station' ? 'station' : 'leg'}|${current.id}|${next.id}|${service.direction}`;
    if (key !== this.phase.key) this.phase = { key, max: finite ? Math.max(1, countdown) : 1 };
    else if (finite) this.phase.max = Math.max(this.phase.max, countdown);
    const fraction = finite ? clamp(countdown / this.phase.max, 0, 1) : 0;
    const offset = (100 * (1 - fraction)).toFixed(1);
    if (p.ring.style.strokeDashoffset !== offset) p.ring.style.strokeDashoffset = offset;
    const span = next.distance - current.distance;
    const progress = state === 'station' || !span ? 0 : clamp((service.distance - current.distance) / span, 0, 1);
    const scale = progress.toFixed(3);
    if (this.lastProgress !== scale) { p.progress.style.transform = `scaleX(${scale})`; this.lastProgress = scale; }
    const label = state === 'station' ? `${lineId} at ${current.name}, ${p.currentLabel.textContent.toLowerCase()}. Next ${next.name}` : `${lineId}, ${state === 'approaching' ? 'arriving at' : 'next stop'} ${next.name}`;
    if (this.pill.getAttribute('aria-label') !== label) this.pill.setAttribute('aria-label', label);
  }
}
