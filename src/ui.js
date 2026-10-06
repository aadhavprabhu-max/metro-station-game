const STATE_LABELS = Object.freeze({ boarding: 'Boarding', closing: 'Doors closing', departing: 'Departing', travelling: 'Travelling', arriving: 'Arriving', stopped: 'Stopped' });

export class UI {
  constructor(player, board, service = null, stations = []) {
    this.player = player;
    this.board = board;
    this.service = service;
    this.stations = stations;
    this.helpPanel = document.querySelector('#help-panel');
    this.helpButton = document.querySelector('#help-button');
    this.elapsed = 0;
    this.clockElement = document.querySelector('#station-clock');
    this.destinationElement = document.querySelector('.service-main strong');
    this.routeElement = document.querySelector('.service-main .line-badge');
    this.minutesElement = document.querySelector('#service-countdown') ?? document.querySelector('.arrival').firstChild;
    this.countdownUnit = document.querySelector('#service-countdown-unit');
    this.platformElement = document.querySelector('#service-platform') ?? document.querySelector('.service-footer > span:last-child');
    this.statusElement = document.querySelector('#train-status');
    this.detailElement = document.querySelector('#service-detail');
    this.locationElement = document.querySelector('#location-name');
    this.locationPlatform = document.querySelector('#location-platform');
    this.locationDirection = document.querySelector('#location-direction');
    this.interactionElement = document.querySelector('#interaction-hint');
    this.interactButton = document.querySelector('#interact-button');
    this.lastRouteUpdate = -Infinity;
    this.lastTimetableKey = '';
    this.boardRevision = -1;
    this.lastClock = '';
    document.querySelector('#reset-button').addEventListener('click', () => { this.showHelp(false); this.player.reset(); });
    document.querySelector('.identity').addEventListener('click', event => { event.preventDefault(); this.player.reset(); });
    this.helpButton.addEventListener('click', () => this.showHelp(this.helpPanel.hidden));
    document.querySelector('#close-help').addEventListener('click', () => this.showHelp(false));
    window.addEventListener('keydown', event => { if (event.code === 'Escape') this.showHelp(false); });
    this.interactButton?.addEventListener('click', () => {
      if (this.player.enabled) this.player.interact?.();
    });
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
    // Use one station clock for the HUD and both physical timetables.
    const minutes = 14 * 60 + 32 + Math.floor(this.elapsed / 60);
    const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (clock !== this.lastClock) {
      this.clockElement.textContent = clock;
      for (const board of this.boards()) board.setClock(clock);
      this.lastClock = clock;
    }
    if (this.service) {
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
    const service = this.service;
    const state = service.snapshot();
    const current = service.currentStop;
    const destination = service.destinationStop;
    const docked = Math.abs(service.distance - current.distance) < 0.2 && service.speed < 0.01;
    const riding = Boolean(this.player.ridingCar);
    const station = riding && docked
      ? this.stations.find(item => item.stationId === current.id)
      : this.player.station;
    const stationName = riding && !docked ? 'On board' : station?.displayName ?? current.name;
    this.setText(this.locationElement, stationName);
    this.setText(this.locationPlatform, riding && !docked ? 'U1 · Connecting tunnel' : `Platform ${station?.platformNumber ?? current.platform ?? '01'}`);
    this.setText(this.locationDirection, `Direction ${destination.name}`);
    this.setText(this.destinationElement, destination.name);
    this.setText(this.routeElement, 'U1');
    this.setText(this.statusElement, STATE_LABELS[service.state] ?? service.state);
    this.setText(this.detailElement, riding ? (docked ? `${current.name} · Doors ${service.canBoard ? 'open' : 'closed'}` : `On board · ${current.name} → ${destination.name}`) : `${current.name} → ${destination.name}`);
    this.setText(this.platformElement, docked ? `Platform ${current.platform ?? '01'} →` : 'U1 · In service');
    const countdown = service.state === 'boarding' ? service.dwellRemaining
      : ['travelling', 'arriving', 'departing'].includes(service.state) ? state.arrivalSeconds : null;
    this.setText(this.minutesElement, countdown === null || !Number.isFinite(countdown) ? '—' : String(Math.max(0, Math.ceil(countdown))));
    this.setText(this.countdownUnit, countdown === null || !Number.isFinite(countdown) ? '' : 'sec');

    const hint = this.player.interactionHint?.() ?? { text: 'Approach an open train door to board.', enabled: false };
    this.setText(this.interactionElement, typeof hint === 'string' ? hint : hint.text);
    if (this.interactButton) {
      this.interactButton.hidden = !hint.enabled;
      this.interactButton.disabled = !this.player.enabled;
      this.setText(this.interactButton.querySelector('span'), hint.action === 'alight' ? 'Leave train' : 'Board train');
    }

    // A screen texture update costs much more than a HUD label. Each station's
    // departure row updates once per second, or immediately when state changes.
    const key = `${Math.floor(this.elapsed)}:${service.state}:${current.id}:${destination.id}`;
    if (key === this.lastTimetableKey) return;
    this.lastTimetableKey = key;
    for (const station of this.stations) {
      const board = station.departures;
      if (!board) continue;
      const next = this.stations.find(item => item.stationId !== station.stationId);
      if (!next) continue;
      let due;
      if (docked && station.stationId === current.id) {
        due = service.state === 'boarding' ? `${Math.max(0, Math.ceil(service.dwellRemaining))} s`
          : service.state === 'closing' ? 'Closing' : service.state === 'stopped' ? 'Stopped' : 'Now';
      } else if (station.stationId === destination.id) {
        due = service.state === 'arriving' ? 'Arriving' : `${Math.max(1, Math.ceil(state.arrivalSeconds ?? Math.abs(destination.distance - service.distance) / service.maxSpeed))} s`;
      } else {
        const otherDistance = Math.abs(destination.distance - current.distance);
        const nextVisit = (state.arrivalSeconds ?? 35) + 20 + otherDistance / service.maxSpeed + 12;
        due = `${Math.max(1, Math.ceil(nextVisit / 60))} min`;
      }
      board.setDepartures([
        { ...board.departures[0], route: 'U1', destination: next.displayName, platform: station.platformNumber ?? '01', color: '#c8784d', due },
        ...board.departures.slice(1),
      ]);
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
