const STATE_LABELS = Object.freeze({ boarding: 'Boarding', closing: 'Doors closing', departing: 'Departing', travelling: 'Travelling', arriving: 'Arriving', stopped: 'Stopped' });
const LINE_COLORS = Object.freeze({ U1: '#bb6343', U2: '#b4443d', U3: '#3e71b6', U4: '#8d58ac' });

export class UI {
  constructor(player, board, service = null, stations = [], services = []) {
    this.player = player;
    this.board = board;
    this.service = service;
    this.services = services.length ? services : service ? [service] : [];
    this.stations = stations;
    this.helpPanel = document.querySelector('#help-panel');
    this.helpButton = document.querySelector('#help-button');
    this.elapsed = 0;
    this.clockElement = document.querySelector('#station-clock');
    this.destinationElement = document.querySelector('.service-main strong');
    this.routeElement = document.querySelector('.service-main .line-badge');
    this.locationLineElement = document.querySelector('#location-line');
    this.serviceLabel = document.querySelector('#service-label');
    this.startButtons = [...document.querySelectorAll('[data-start-line]')];
    this.minutesElement = document.querySelector('#service-countdown') ?? document.querySelector('.arrival').firstChild;
    this.countdownUnit = document.querySelector('#service-countdown-unit');
    this.platformElement = document.querySelector('#service-platform') ?? document.querySelector('.service-footer > span:last-child');
    this.statusElement = document.querySelector('#train-status');
    this.detailElement = document.querySelector('#service-detail');
    this.nextStopElement = document.querySelector('#service-next-stop');
    this.countdownLabel = document.querySelector('#countdown-label');
    this.locationElement = document.querySelector('#location-name');
    this.locationPlatform = document.querySelector('#location-platform');
    this.locationDirection = document.querySelector('#location-direction');
    this.transferElement = document.querySelector('#location-transfer');
    this.interactionElement = document.querySelector('#interaction-hint');
    this.interactButton = document.querySelector('#interact-button');
    this.lastRouteUpdate = -Infinity;
    this.lastTimetableKey = '';
    this.boardRevision = -1;
    this.lastClock = '';
    const networkInfo = this.services.map(item => ({
      id: item.lineId,
      color: LINE_COLORS[item.lineId] ?? '#6094be',
      stations: item.route.stops.map(stop => stop.name),
    }));
    for (const station of stations) {
      station.departures?.setNetworkInfo(networkInfo);
      station.departures?.setPlatformInfo(station.lineId ?? 'U1', station.platformNumber ?? '01', station.stationId === 'station-2', station.level ?? ((station.floorY ?? 0) < 0 ? 'lower' : 'upper'));
    }
    document.querySelector('#reset-button').addEventListener('click', () => { this.showHelp(false); this.player.reset(); });
    document.querySelector('.identity').addEventListener('click', event => { event.preventDefault(); this.player.reset(); });
    this.helpButton.addEventListener('click', () => this.showHelp(this.helpPanel.hidden));
    document.querySelector('#close-help').addEventListener('click', () => this.showHelp(false));
    window.addEventListener('keydown', event => { if (event.code === 'Escape') this.showHelp(false); });
    this.interactButton?.addEventListener('click', () => {
      if (this.player.enabled) this.player.interact?.();
    });
    for (const button of this.startButtons) {
      button.addEventListener('click', () => {
        this.showHelp(false);
        this.player.startAt?.(button.dataset.startLine, button.dataset.startStation);
        this.lastRouteUpdate = -Infinity;
        this.updateRoute();
      });
    }
    for (const button of document.querySelectorAll('[data-move]')) {
      button.addEventListener('pointerdown', event => { event.preventDefault(); if (!this.player.enabled) return; button.setPointerCapture(event.pointerId); this.player.keys.add(button.dataset.move); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => this.player.keys.delete(button.dataset.move));
    }
  }

  showHelp(open) {
    this.helpPanel.hidden = !open;
    this.helpButton.setAttribute('aria-expanded', String(open));
    this.player.setEnabled(!open);
    if (open) document.querySelector('#close-help').focus();
  }

  update(delta) {
    this.elapsed += delta;
    // Use one station clock for the HUD and all physical timetables.
    const minutes = 14 * 60 + 32 + Math.floor(this.elapsed / 60);
    const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (clock !== this.lastClock) {
      this.clockElement.textContent = clock;
      for (const board of this.boards()) board.setClock(clock);
      this.lastClock = clock;
    }
    if (this.player.service ?? this.service) {
      // Movement is smooth every frame; text only needs a modest refresh rate.
      if (this.elapsed - this.lastRouteUpdate >= 0.12) {
        this.updateRoute();
        this.lastRouteUpdate = this.elapsed;
      }
    } else if (this.boardRevision !== this.board.revision) {
      const next = this.board.departures[0];
      if (next) {
        this.destinationElement.textContent = next.destination;
        this.routeElement.textContent = next.route;
        this.minutesElement.textContent = next.due ?? String(next.minutes);
        if (this.countdownUnit) this.countdownUnit.textContent = next.due ? '' : 'min';
        this.platformElement.textContent = `Platform ${next.platform}  →`;
      }
      this.boardRevision = this.board.revision;
    }
  }

  boards() {
    return [...new Set([this.board, ...this.stations.map(station => station.departures)].filter(Boolean))];
  }

  updateRoute() {
    const service = this.player.service ?? this.service;
    if (!service) return;
    const state = service.snapshot();
    const lineId = service.lineId ?? state.lineId ?? 'U1';
    const current = service.currentStop;
    const nextStop = service.nextStop;
    const destination = service.destinationStop;
    const direction = state.directionName ?? (service.direction > 0 ? 'Northbound' : 'Southbound');
    const docked = Math.abs(service.distance - current.distance) < 0.2 && service.speed < 0.01;
    const riding = Boolean(this.player.ridingCar);
    const station = riding && docked
      ? this.stations.find(item => item.stationId === current.id && (item.lineId ?? 'U1') === lineId)
      : this.player.station;
    const stationName = riding && !docked ? 'On board' : station?.displayName ?? current.name;
    const floorY = station?.floorY ?? current.floorY ?? 0;
    const lower = (station?.level ?? current.level ?? (floorY < 0 ? 'lower' : 'upper')) === 'lower';
    const atCentral = !riding || docked ? station?.stationId === 'station-2' : false;
    this.setText(this.locationElement, stationName);
    this.setText(this.locationPlatform, riding && !docked ? `${lineId} · Connecting tunnel` : `${station?.lineId ?? lineId} · Platform ${station?.platformNumber ?? current.platform ?? '01'}${atCentral ? lower ? ' · Lower level' : ' · Upper level' : ''}`);
    this.setText(this.locationDirection, direction);
    this.setText(this.transferElement, atCentral ? lower ? 'Upper: U1 / U2 ↑ stairs · Lower: U3 / U4' : 'Upper: U1 / U2 · Lower: U3 / U4 ↓ stairs' : '');
    if (this.transferElement) this.transferElement.hidden = !atCentral;
    this.setText(this.destinationElement, destination.name);
    for (const badge of [this.routeElement, this.locationLineElement]) {
      this.setText(badge, lineId);
      if (badge) badge.style.backgroundColor = LINE_COLORS[lineId] ?? '#6094be';
    }
    this.setText(this.serviceLabel, `${lineId} LIVE SERVICE`);
    document.querySelector('.service-card')?.setAttribute('aria-label', `Live ${lineId} train service`);
    this.setText(this.statusElement, STATE_LABELS[service.state] ?? service.state);
    this.setText(this.detailElement, `${direction} · ${docked ? 'At ' + current.name : 'From ' + current.name}`);
    this.setText(this.nextStopElement, `Next stop · ${nextStop.name}`);
    this.setText(this.platformElement, docked ? `Platform ${current.platform ?? '01'} →` : `${lineId} · In service`);
    const countdown = service.state === 'boarding' ? service.dwellRemaining
      : ['travelling', 'arriving', 'departing'].includes(service.state) ? state.arrivalSeconds : null;
    this.setText(this.minutesElement, countdown === null || !Number.isFinite(countdown) ? '—' : String(Math.max(0, Math.ceil(countdown))));
    this.setText(this.countdownUnit, countdown === null || !Number.isFinite(countdown) ? '' : 'sec');
    this.setText(this.countdownLabel, service.state === 'boarding' ? 'DOORS CLOSE' : ['travelling', 'arriving', 'departing'].includes(service.state) ? 'NEXT STOP' : '');

    const hint = this.player.interactionHint?.() ?? { text: 'Approach an open train door to board.', enabled: false };
    this.setText(this.interactionElement, typeof hint === 'string' ? hint : hint.text);
    if (this.interactButton) {
      this.interactButton.hidden = !hint.enabled;
      this.interactButton.disabled = !this.player.enabled;
      this.setText(this.interactButton.querySelector('span'), hint.action === 'alight' ? 'Leave train' : 'Board train');
    }
    for (const button of this.startButtons) button.setAttribute('aria-pressed', String(button.dataset.startLine === (this.player.startLineId ?? 'U1')));

    // A screen texture update costs much more than a HUD label. Each station's
    // departure row updates once per second, or immediately when state changes.
    const key = `${Math.floor(this.elapsed)}:${this.services.map(item => `${item.lineId}:${item.state}:${item.currentStop.id}:${item.nextStop.id}:${item.destinationStop.id}:${item.direction}`).join('|')}`;
    if (key === this.lastTimetableKey) return;
    this.lastTimetableKey = key;
    for (const station of this.stations) {
      const board = station.departures;
      if (!board) continue;
      const servicesAtStation = this.services.filter(item => {
        const stop = item.route.stops.find(candidate => candidate.id === station.stationId);
        if (!stop) return false;
        if (station.stationId !== 'station-2') return true;
        // Central is one network node with two railway levels. Each platform's
        // display includes both services on its level, without dropping rows.
        return Math.abs((stop.floorY ?? stop.position?.y ?? 0) - (station.floorY ?? station.position.y ?? 0)) < 0.1;
      });
      const rows = servicesAtStation.flatMap(item => item.departuresFor(station.stationId).map(departure => {
        let due;
        if (departure.atPlatform) {
          due = departure.state === 'boarding' ? `${Math.max(0, Math.ceil(item.dwellRemaining))} s`
            : departure.state === 'closing' ? 'Closing' : departure.state === 'stopped' ? 'Stopped' : 'Now';
        } else if (departure.state === 'arriving') {
          due = 'Arriving';
        } else {
          const seconds = Math.max(1, Math.ceil(departure.dueSeconds));
          due = seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
        }
        return {
          route: item.lineId, destination: departure.destinationStop.name,
          nextStop: departure.nextStop.name, direction: departure.directionName,
          platform: departure.platform ?? station.platformNumber ?? '01', color: item.lineId === 'U1' ? '#c8784d' : LINE_COLORS[item.lineId] ?? '#6094be', due,
        };
      }));
      board.setDepartures(rows.slice(0, 5));
    }
  }

  setText(element, text) {
    if (element && element.textContent !== String(text ?? '')) element.textContent = text ?? '';
  }

  ready() {
    const loading = document.querySelector('#loading');
    loading.classList.add('complete');
    window.setTimeout(() => loading.hidden = true, 450);
  }
}

export function showError(error) {
  document.querySelector('#loading').hidden = true;
  document.querySelector('#error-message').textContent = error.message || 'Please use a browser with WebGL 2 support and hardware acceleration enabled.';
  document.querySelector('#error').hidden = false;
}
