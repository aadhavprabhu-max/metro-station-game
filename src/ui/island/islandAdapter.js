import { mountIsland } from './island.js';

/**
 * Read-only bridge between the live game and the Island HUD (window.AurealisIsland).
 * It reads the followed service through the UI's existing readings and calls only the
 * island's own API. Nothing here writes to services, trains, stations or timing.
 */
export const ISLAND_STORAGE_KEY = 'aurealis-island-hidden';
export const ISLAND_TOGGLE_KEY = 'KeyI';   // hide / show (free in the game's bindings)
export const ISLAND_ACTION_KEY = 'KeyO';   // tap = expand / collapse, hold = quick actions
export const ISLAND_HOLD_MS = 460;         // same long-press threshold as the prototype's pointer logic
export const ARRIVING_ALERT_SECONDS = 36;
const UPDATE_INTERVAL_MS = 250;            // ~4 Hz is plenty for text, ring and track
const SIGNAL_ALERT_SECONDS = 1;            // a hold must last this long before it is announced
const OPEN_STATES = ['expanded', 'actions'];
const STATION_STATES = ['stopped', 'boarding', 'closing', 'departing'];

const loadHidden = () => { try { return localStorage.getItem(ISLAND_STORAGE_KEY) === '1'; } catch { return false; } };
const saveHidden = hidden => { try { localStorage.setItem(ISLAND_STORAGE_KEY, hidden ? '1' : '0'); } catch { /* storage unavailable */ } };
const isTyping = target => Boolean(target?.closest?.('input, textarea, select, [contenteditable]'));
const clamp01 = v => Math.min(1, Math.max(0, v));

export class IslandAdapter {
  constructor(ui) {
    this.ui = ui;
    this.layer = document.createElement('div');
    this.layer.id = 'island-layer';
    document.querySelector('#app').append(this.layer);
    this.api = mountIsland(this.layer);
    this.root = this.layer.querySelector('#island');
    this.pillElement = this.layer.querySelector('#pill');
    this.glassPill = document.querySelector('#gh-service-pill');
    this.lastPush = -Infinity;
    this.segment = { key: '', progress: 0 };
    this.arrivalAlerted = '';
    this.signalSince = null; this.signalAlerted = false;
    this.doorMode = null;
    this.hold = null;

    this.api.onVisibility = hidden => { this.syncGlassPill(hidden); saveHidden(hidden); };
    this.api.onAction = name => window.setTimeout(() => this.action(name), 180);
    this.push(performance.now());
    if (loadHidden()) this.api.hide(); else this.syncGlassPill(false);
    this.bindKeys();
    window.metroIsland = this; // inspection hook for tests, like window.metroHud
  }

  /** Called once the loading screen goes: the island wakes from idle to compact, as in the prototype. */
  ready() { window.setTimeout(() => this.api.setState('compact'), 700); }

  /** Island visible → bottom glass pill steps aside; island hidden → pill returns. */
  syncGlassPill(islandHidden) {
    if (!this.glassPill) return;
    this.glassPill.classList.toggle('gh-pill-gone', !islandHidden);
    this.glassPill.setAttribute('aria-hidden', String(!islandHidden));
  }

  // ---------- keyboard ----------
  bindKeys() {
    window.addEventListener('keydown', event => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.code === ISLAND_TOGGLE_KEY) { event.preventDefault(); if (!event.repeat) this.api.toggle(); return; }
      if (event.code !== ISLAND_ACTION_KEY) return;
      event.preventDefault();
      if (event.repeat || this.hold || this.api.hidden || this.layerSuppressed()) return;
      this.root.classList.add('press');
      // The timer waits one more animation frame: Chrome dispatches queued input before rAF
      // callbacks, so a keyup stuck behind a slow frame still cancels the hold.
      const hold = this.hold = { fired: false, start: event.timeStamp, timer: window.setTimeout(() => requestAnimationFrame(() => { if (this.hold === hold) this.fireHold(); }), ISLAND_HOLD_MS) };
    });
    window.addEventListener('keyup', event => {
      if (event.code !== ISLAND_ACTION_KEY || !this.hold) return;
      // A slow frame can deliver keyup before the timer task runs, so the real held time
      // (event timestamps, not handling time) decides too.
      if (!this.hold.fired && event.timeStamp - this.hold.start >= ISLAND_HOLD_MS) this.fireHold();
      const { fired, timer } = this.hold; this.hold = null;
      window.clearTimeout(timer); this.root.classList.remove('press');
      if (fired) return;
      // A tap does exactly what a tap on the island does; in quick actions it collapses them.
      if (this.api.state === 'actions') this.api.setState('compact');
      else this.pillElement.click();
    });
    window.addEventListener('blur', () => { if (this.hold) { window.clearTimeout(this.hold.timer); this.hold = null; this.root.classList.remove('press'); } });
    // The pill itself is focusable: plain Tab + Enter / Space already work through the island's own handler.
    // Focus left on a control that just became inert goes back to the 3D view.
    this.api.onState = state => {
      if (OPEN_STATES.includes(state) || !this.root.contains(document.activeElement) || document.activeElement === this.pillElement) return;
      this.ui.player?.element?.focus?.({ preventScroll: true });
    };
  }

  /** Hold on the action key: quick actions, like a 460 ms long-press on the island. */
  fireHold() {
    if (!this.hold || this.hold.fired) return;
    this.hold.fired = true; this.root.classList.remove('press');
    this.api.setState('actions');
    // Keyboard users land on the first action, so Enter / Space work straight away.
    this.root.querySelector('[data-act]')?.focus({ preventScroll: true });
  }

  // ---------- live data ----------
  /** Reads the followed service. Pure read: describe() only caches passenger-facing text. */
  read() {
    const live = this.ui.liveService();
    if (!live) return null;
    const { service, lineId, color, docked } = live;
    const info = service.passengerInformation?.describe?.() ?? null;
    const stops = service.route.stops, dir = service.direction;
    const current = info?.currentStation ?? service.currentStop, next = info?.nextStation ?? service.nextStop;
    const previous = info ? info.previousStation : stops[stops.indexOf(service.currentStop) - dir];
    const following = info ? info.followingStation : stops[stops.indexOf(service.nextStop) + dir];
    const destination = info?.terminus ?? service.destinationStop;
    // At a platform the track shows the leg just completed (prev → this station → next), like the
    // prototype's dwell. With no known previous stop (e.g. a fresh start) it shows the leg ahead.
    const atStation = docked && STATION_STATES.includes(service.state) && Boolean(previous);
    const countdown = Number.isFinite(live.arrivalCountdown) ? live.arrivalCountdown : 0;
    const segment = atStation
      ? { prev: previous, next: current, after: next, key: `${lineId}|${previous.id}|${current.id}|dwell` }
      : { prev: current, next, after: following, key: `${lineId}|${current.id}|${next.id}|${dir}` };
    // Distance-based progress, clamped so it can only move forward within one segment.
    let progress = atStation ? 1 : clamp01(info?.leg?.progress
      ?? Math.abs(service.distance - service.currentStop.distance) / (Math.abs(service.nextStop.distance - service.currentStop.distance) || 1));
    if (segment.key === this.segment.key) progress = Math.max(progress, this.segment.progress);
    this.segment = { key: segment.key, progress };
    const doorSide = atStation ? info?.arrivalDoorSide ?? info?.doorSide : info?.nextDoorSide;
    return {
      service, atStation, countdown, segmentKey: segment.key,
      data: {
        line: lineId, color, dest: destination?.name ?? '',
        prev: segment.prev?.name ?? '', next: segment.next?.name ?? '', after: segment.after?.name ?? '',
        etaSec: atStation ? 0 : countdown, progress,
        platform: String(segment.next?.platformNumber ?? segment.next?.platform ?? '—'),
        speed: Math.max(0, service.speed) * 3.6, delayMin: 0, doors: doorSide ?? '—',
      },
    };
  }

  /** Throttled from the game loop (wall-clock, so it also runs while transport time is paused). */
  update() {
    const now = performance.now();
    if (now - this.lastPush < UPDATE_INTERVAL_MS) return;
    this.push(now);
  }

  push(now) {
    this.lastPush = now;
    const reading = this.read();
    if (!reading) return;
    const { service, atStation, countdown, data, segmentKey } = reading;
    this.api.update(data);
    // Doors: boarding = open, closing = closing, otherwise no bubble.
    const docked = this.ui.liveService()?.docked;
    const doorMode = docked && service.state === 'boarding' ? 'open' : docked && service.state === 'closing' ? 'closing' : null;
    if (doorMode !== this.doorMode) { this.doorMode = doorMode; this.api.doors(doorMode); }
    const quiet = OPEN_STATES.includes(this.api.state) || this.layerSuppressed();
    // Nearing a station: one alert per leg, about 36 s out.
    if (!atStation && countdown > 0 && countdown <= ARRIVING_ALERT_SECONDS && this.arrivalAlerted !== segmentKey) {
      this.arrivalAlerted = segmentKey;
      if (!quiet) this.api.alert({ tone: 'info', icon: 'bell', title: `Arriving at ${data.next}`,
        sub: data.doors === '—' ? `Platform ${data.platform}` : `Platform ${data.platform} · doors on the ${data.doors}` });
    }
    // The one hold the game already knows about: a red signal ahead.
    if (service.waitingForSignal) {
      this.signalSince ??= now;
      if (!this.signalAlerted && now - this.signalSince >= SIGNAL_ALERT_SECONDS * 1000) {
        this.signalAlerted = true;
        if (!quiet) this.api.alert({ tone: 'warn', icon: 'warn', title: 'Held at signal', sub: `Waiting for the line ahead to clear · next ${data.next}`, action: '' });
      }
    } else { this.signalSince = null; this.signalAlerted = false; }
  }

  /** True while the island is stepped aside by CSS (street exploring or driving). */
  layerSuppressed() { const app = this.layer.parentElement; return app.classList.contains('surface-exploring') || app.classList.contains('driving'); }

  // ---------- quick actions: existing features only, never the simulation ----------
  action(name) {
    const d = this.api.data;
    const info = { tone: 'info', action: '' };
    if (name === 'map') {
      this.api.setState('compact');
      const glass = this.ui.glass;
      if (glass) { glass.setMenuOpen(true); glass.setDetent?.(1); }
      return;
    }
    if (name === 'announce') {
      const status = this.ui.announcer?.getStatus?.();
      const caption = status?.caption && status.captionLineId === d.line ? status.caption : '';
      this.api.alert({ ...info, icon: 'speaker', title: 'Announcement',
        sub: caption || `Next stop: ${d.next}.${d.doors === '—' ? '' : ` Doors on the ${d.doors}.`}`, duration: 2600 });
      return;
    }
    if (name === 'horn') { this.api.alert({ ...info, icon: 'horn', title: 'Horn', sub: 'Not available on this train yet', duration: 1800 }); return; }
    if (name === 'doors') {
      const live = this.ui.liveService(), service = live?.service;
      let sub;
      if (!service) sub = 'No train selected';
      else if (live.docked && service.state === 'boarding') sub = `Open · closing in ${Math.max(0, Math.ceil(service.dwellRemaining))} s`;
      else if (live.docked && service.state === 'closing') sub = 'Closing · stand clear';
      else if (live.docked && service.state === 'stopped') sub = 'Opening shortly';
      else if (live.docked) sub = 'Closed · departing';
      else sub = d.doors === '—' ? `Locked · next stop ${d.next}` : `Locked · open on the ${d.doors} at ${d.next}`;
      this.api.alert({ ...info, icon: 'door', title: 'Doors', sub, duration: 2400 });
    }
  }
}
