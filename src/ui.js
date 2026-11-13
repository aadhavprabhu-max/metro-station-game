import { GlassHud, UI_MODE } from './glass-hud.js';

/** Route journeys offered by the HUD. Each reloads the game with the chosen route. */
export const RIDE_LINKS = Object.freeze([
  { id: 'u9-central', label: 'U9 · Central', legacyLabel: 'Ride U9 · Central', query: '?line=U9' },
  { id: 'u5-river-loop', label: 'U5 · River loop', legacyLabel: 'Ride U5 · River loop', query: '?line=U5&u5=scenic&tour=river&station=u5-altstadtbruecke' },
  { id: 'u5-direct', label: 'U5 · Original direct route', legacyLabel: 'U5 · Original direct route', query: '?line=U5&u5=direct' },
]);
/** Keeps the ?ui=legacy comparison flag when following a ride link from the legacy HUD. */
const rideHref = query => UI_MODE === 'legacy' ? `${query}&ui=legacy` : query;

/** Shared live-service readings for the legacy card and the glass pill. */
export const isDocked = service => Math.abs(service.distance - service.currentStop.distance) < 0.2 && service.speed < 0.01;
export const arrivalCountdown = service => service.measuredTimetable?.arrivalCountdown() ?? service.arrivalSeconds;

const STATE_LABELS = Object.freeze({ boarding: 'Boarding', closing: 'Doors closing', departing: 'Departing', travelling: 'Travelling', arriving: 'Arriving', stopped: 'Stopped' });
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
    this.startButtons = [];
    this.serviceCard = document.querySelector('.service-card');
    this.soundButton = document.querySelector('#sound-button');
    this.soundStatusElement = document.querySelector('#sound-status');
    this.captionElement = document.querySelector('#announcement-caption');
    this.captionTextElement = document.querySelector('#announcement-text');
    this.announcer = null;
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
      color: item.route.line?.color ?? '#6094be',
      stations: item.route.stops.map(stop => stop.name),
    }));
    this.lineColors = new Map(networkInfo.map(line => [line.id, line.color]));
    const starts = document.querySelector('.line-starts');
    const map = document.querySelector('#network-map');
    for (const [index, line] of networkInfo.entries()) {
      const firstStop = this.services[index].route.stops[0];
      if (starts) {
        const button = document.createElement('button');
        button.type = 'button'; button.id = `start-${line.id.toLowerCase()}-button`;
        button.dataset.startLine = line.id; button.dataset.startStation = firstStop.id;
        button.textContent = `Start ${line.id}`; button.title = `Start at ${firstStop.name}, ${line.id}`;
        button.setAttribute('aria-pressed', String(line.id === this.player.startLineId));
        button.style.setProperty('--line-color', line.color);
        starts.append(button); this.startButtons.push(button);
      }
      if (map) {
        const row = document.createElement('p'); row.dataset.line = line.id;
        const badge = document.createElement('span'); badge.className = 'line-badge';
        badge.textContent = line.id; badge.style.backgroundColor = line.color;
        const route = document.createElement('span'); route.textContent = line.stations.join(' ↔ ');
        if (line.id === 'U10') route.textContent = this.services[index].route.stops.map(stop => {
          const connections = stop.servedLines.filter(id => id !== 'U10');
          const platform = stop.node.platforms.U10;
          return `${stop.name}${connections.length ? ' ⇄ ' + connections.join('/') : ''} (${platform.position.y < 0 ? 'underground' : platform.outdoor ? 'open elevated' : 'enclosed elevated'})`;
        }).join(' → ');
        row.append(badge, route); map.append(row);
      }
    }
    this.setText(document.querySelector('#network-line-count'), `${networkInfo.length} LINES`);
    this.setText(document.querySelector('#network-summary'), `${networkInfo.length} metro lines run independently in both directions. Choose a starting line, approach an open door and press E to board. Explore your carriage and read the onboard screens.`);
    this.networkInfo = networkInfo;
    if (this.services.some(s => s.lineId === 'U9') && starts) {
      const routes = document.createElement('nav'); routes.className = 'phase6-routes'; routes.setAttribute('aria-label', 'Phase 6 journeys');
      for (const ride of RIDE_LINKS) { const link = document.createElement('a'); link.href = rideHref(ride.query); link.textContent = ride.legacyLabel; routes.append(link); }
      starts.after(routes);
      const u5 = this.services.find(s => s.lineId === 'U5');
      this.setText(document.querySelector('#network-summary'), `Phase 6 · U9 connects Central, Nordklinikum and Waldtor. U5 ${u5.route.variant === 'scenic' ? 'takes the historic river loop before Ostbahnhof' : 'uses its preserved direct route; select River loop for the bridge journey'}. Approach an open door and press E to board.`);
    }
    if (this.services.some(s => s.lineId === 'U10')) this.setText(document.querySelector('#network-summary'), 'Phase 7 · U10 Airport Express connects Central with Aurealis International Airport through the metropolitan skyline and East Botanical Garden. All existing lines, U9 and both U5 routes remain available. Approach an open door and press E to board. Use the lifts or stairs to change platforms.');
    this.stationServices = new Map();
    this.stationInformation = new Map();
    this.informationRevisions = new Map();
    this.refreshStationInformation();
    document.querySelector('#reset-button').addEventListener('click', () => this.resetView());
    document.querySelector('.identity').addEventListener('click', event => { event.preventDefault(); this.player.reset(); });
    this.helpButton.addEventListener('click', () => this.showHelp(this.helpPanel.hidden));
    document.querySelector('#close-help').addEventListener('click', () => this.showHelp(false));
    window.addEventListener('keydown', event => { if (event.code === 'Escape') this.showHelp(false); });
    this.interactButton?.addEventListener('click', () => {
      if (this.player.enabled) this.player.interact?.();
    });
    this.soundButton?.addEventListener('click', () => this.toggleSound());
    for (const button of this.startButtons) {
      button.addEventListener('click', () => this.startLine(button.dataset.startLine, button.dataset.startStation));
    }
    for (const button of document.querySelectorAll('[data-move]')) {
      button.addEventListener('pointerdown', event => { event.preventDefault(); if (!this.player.enabled) return; button.setPointerCapture(event.pointerId); this.player.keys.add(button.dataset.move); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => this.player.keys.delete(button.dataset.move));
    }
    // The Liquid Glass HUD is the default; ?ui=legacy keeps only the original HUD.
    this.glass = UI_MODE === 'glass' ? new GlassHud(this) : null;
  }

  /** Existing control actions, shared by the legacy HUD and the glass HUD. */
  startLine(lineId, stationId) {
    this.showHelp(false);
    this.player.startAt?.(lineId, stationId);
    this.lastRouteUpdate = -Infinity;
    this.updateRoute();
  }

  toggleSound() {
    this.announcer?.toggle();
    this.updateAnnouncements();
  }

  resetView() {
    this.showHelp(false);
    this.player.reset();
  }

  rideLinks() {
    return this.services.some(s => s.lineId === 'U9') ? RIDE_LINKS.map(ride => ({ ...ride, href: rideHref(ride.query) })) : [];
  }

  /** Current live values of the followed service, read from the existing service. */
  liveService() {
    const service = this.player.service ?? this.service;
    if (!service) return null;
    const lineId = service.lineId ?? 'U1';
    return {
      service, lineId, color: this.lineColors.get(lineId) ?? '#6094be', docked: isDocked(service),
      current: service.currentStop, next: service.nextStop, destination: service.destinationStop,
      arrivalCountdown: arrivalCountdown(service),
    };
  }

  showHelp(open) {
    if (this.glass) { this.glass.setMenuOpen(open, { focus: open }); return; }
    this.helpPanel.hidden = !open;
    this.helpButton.setAttribute('aria-expanded', String(open));
    this.player.setEnabled(!open);
    if (open) document.querySelector('#close-help').focus();
  }

  configureAnnouncements(announcer) {
    this.announcer = announcer;
    this.updateAnnouncements();
  }

  updateAnnouncements() {
    if (!this.announcer) return;
    const status = this.announcer.getStatus();
    const soundLabel = status.enabled ? status.available ? 'Sound on' : 'Captions only' : 'Sound off';
    this.setText(this.soundButton, soundLabel);
    this.soundButton?.setAttribute('aria-pressed', String(status.enabled));
    const availability = !status.enabled ? 'Captions on board'
      : !status.available ? 'Audio unavailable · captions only'
      : status.voiceAvailable ? status.enabled ? status.audioAvailable ? 'Voice + chimes' : 'Voice announcements' : 'Captions on'
      : status.audioAvailable && status.enabled ? 'Chimes · voice unavailable' : 'Voice unavailable · captions on';
    this.setText(this.soundStatusElement, availability);
    if (this.soundButton) this.soundButton.title = status.enabled ? `Mute announcements. ${availability}` : `Enable announcements. ${availability}`;
    this.glass?.syncAnnouncements(status, soundLabel);
    const ownLine = (this.player.service ?? this.service)?.lineId;
    const caption = this.player.ridingCar && status.captionLineId === ownLine ? status.caption : '';
    this.setText(this.captionTextElement, caption);
    if (this.captionElement) this.captionElement.hidden = !caption;
    if (this.captionTextElement) this.captionTextElement.title = caption || '';
  }

  update(delta) {
    if (this.player.surfaceWorld) {
      if (!this.surfaceStatus) {
        this.surfaceStatus = document.createElement('aside');
        this.surfaceStatus.className = 'surface-status gh-glass';
        this.surfaceStatus.innerHTML = '<strong>Central · Old town</strong><small>U4 · Return through the stone arch</small>';
        document.querySelector('#app').append(this.surfaceStatus);
      }
      this.surfaceStatus.hidden = !this.player.surfaceExploring;
      document.querySelector('#app').classList.toggle('surface-exploring', this.player.surfaceExploring);
    }
    this.elapsed += delta;
    // Use one station clock for the HUD and all physical timetables.
    const minutes = 14 * 60 + 32 + Math.floor(this.elapsed / 60);
    const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (clock !== this.lastClock) {
      this.clockElement.textContent = clock;
      for (const board of this.boards()) board.setClock(clock);
      this.glass?.setClock(clock);
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
    this.glass?.update(delta);
  }

  boards() {
    return [...new Set([this.board, ...this.stations.map(station => station.departures)].filter(Boolean))];
  }

  refreshStationInformation() {
    if (this.stationInformation.size && this.services.every(service =>
      this.informationRevisions.get(service) === service.passengerInformation?.cacheRevision)) return;
    for (const service of this.services) this.informationRevisions.set(service, service.passengerInformation?.cacheRevision);
    for (const station of this.stations) {
      const ownService = this.services.find(item => item.lineId === station.lineId);
      const ownStop = ownService?.route.stops.find(stop => stop.id === station.stationId);
      const information = ownService?.passengerInformation?.describeStop(ownStop);
      this.stationInformation.set(station, information);
      this.stationServices.set(station, this.services.filter(item => {
        const stop = item.route.stops.find(candidate => candidate.id === station.stationId);
        if (!stop) return false;
        // Central's established boards show only the trains on their floor.
        // Other interchanges include only physically connected live platforms.
        if (station.stationId === 'station-2') return Math.abs((stop.floorY ?? stop.position?.y ?? 0) - (station.floorY ?? station.position.y ?? 0)) < 0.1;
        return item === ownService || information?.interchanges.some(link => link.lineId === item.lineId && link.implemented);
      }));
      station.departures?.setNetworkInfo(this.networkInfo);
      station.departures?.setPlatformInfo(station.lineId ?? 'U1', station.platformNumber ?? '01', Boolean(information?.interchanges.length), station.level ?? ((station.floorY ?? 0) < 0 ? 'lower' : 'upper'));
      station.departures?.setTransferGuidance(this.transferText(station));
    }
    this.lastTimetableKey = '';
  }

  transferText(station) {
    const links = this.stationInformation.get(station)?.interchanges ?? [];
    if (!links.length) return '';
    if (station.stationId === 'station-2') {
      if (this.services.some(s => s.lineId === 'U10')) return station.lineId === 'U10'
        ? 'U9 ↑ stairs / lifts · U3 / U4 via U9 · U1 / U2 via upper stairs'
        : station.lineId === 'U9' ? 'U10 ↓ south-end stairs / lifts · U3 ↑ north-end stairs'
          : 'U1 / U2 upper · U3 / U4 lower · U9 ↓ via U3 · U10 via U9';
      if (station.lineId === 'U9') return 'U3 ↑ stairs · U4 via U3 passage · U1 / U2 via upper stairs';
      return station.level === 'lower' || (station.floorY ?? 0) < 0
        ? `Upper: U1 / U2 ↑ stairs · Lower: U3 / U4${this.services.some(s => s.lineId === 'U9') ? ' · U9 ↓ via U3' : ''}`
        : `Upper: U1 / U2 · Lower: U3 / U4 ↓ stairs${this.services.some(s => s.lineId === 'U9') ? ' · U9 via U3' : ''}`;
    }
    return `Change: ${links.map(link => `${link.lineId} · Platform ${link.platformNumber}${link.connection === 'stairs' ? ' via stairs' : ' via passage'}`).join(' / ')}`;
  }

  updateRoute() {
    this.refreshStationInformation();
    this.updateAnnouncements();
    const service = this.player.service ?? this.service;
    if (!service) return;
    const state = service.snapshot();
    const lineId = service.lineId ?? state.lineId ?? 'U1';
    const current = service.currentStop;
    const nextStop = service.nextStop;
    const destination = service.destinationStop;
    const direction = state.directionName ?? (service.direction > 0 ? 'Northbound' : 'Southbound');
    const docked = isDocked(service);
    const riding = Boolean(this.player.ridingCar);
    const station = riding && docked
      ? this.stations.find(item => item.stationId === current.id && (item.lineId ?? 'U1') === lineId)
      : this.player.station;
    const stationName = riding && !docked ? 'On board' : station?.displayName ?? current.name;
    const floorY = station?.floorY ?? current.floorY ?? 0;
    const lower = (station?.level ?? current.level ?? (floorY < 0 ? 'lower' : 'upper')) === 'lower';
    const atCentral = !riding || docked ? station?.stationId === 'station-2' : false;
    this.setText(this.locationElement, stationName);
    const infrastructure = lineId === 'U10' ? this.player.camera.position.y > 5 ? 'Elevated railway' : 'Underground railway'
      : service.route.variant === 'scenic' && service.train.position.y > -9 ? 'River loop' : 'In service';
    this.setText(this.locationPlatform, riding && !docked ? `${lineId} · ${infrastructure}` : `${station?.lineId ?? lineId} · Platform ${station?.platformNumber ?? current.platform ?? '01'}${atCentral ? lineId === 'U10' ? ' · Airport Express level' : lower ? ' · Lower level' : ' · Upper level' : ''}`);
    this.setText(this.locationDirection, direction);
    const transferText = !riding || docked ? this.transferText(station) : '';
    this.setText(this.transferElement, transferText);
    if (this.transferElement) this.transferElement.hidden = !transferText;
    this.setText(this.destinationElement, destination.name);
    for (const badge of [this.routeElement, this.locationLineElement]) {
      this.setText(badge, lineId);
      if (badge) badge.style.backgroundColor = this.lineColors.get(lineId) ?? '#6094be';
    }
    this.setText(this.serviceLabel, `${lineId} LIVE SERVICE`);
    this.serviceCard?.setAttribute('aria-label', `Live ${lineId} train service`);
    this.setText(this.statusElement, service.waitingForSignal ? 'Waiting at signal' : STATE_LABELS[service.state] ?? service.state);
    this.setText(this.detailElement, `${direction} · ${docked ? 'At ' + current.name : 'From ' + current.name}`);
    this.setText(this.nextStopElement, `Next stop · ${nextStop.name}`);
    this.setText(this.platformElement, docked ? `Platform ${current.platform ?? '01'} →` : `${lineId} · In service`);
    const countdown = service.state === 'boarding' ? service.dwellRemaining
      : ['travelling', 'arriving', 'departing'].includes(service.state) ? arrivalCountdown(service) : null;
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
    this.glass?.syncStartLine(this.player.startLineId ?? 'U1');

    // A screen texture update costs much more than a HUD label. Each station's
    // departure row updates once per second, or immediately when state changes.
    const key = `${Math.floor(this.elapsed)}:${this.services.map(item => `${item.lineId}:${item.state}:${item.currentStop.id}:${item.nextStop.id}:${item.destinationStop.id}:${item.direction}`).join('|')}`;
    if (key === this.lastTimetableKey) return;
    this.lastTimetableKey = key;
    for (const station of this.stations) {
      const board = station.departures;
      if (!board) continue;
      const servicesAtStation = this.stationServices.get(station) ?? [];
      const rows = servicesAtStation.flatMap(item => item.departuresFor(station.stationId).map(departure => {
        const measuredWait = item.measuredTimetable?.waitingFor(station.stationId).find(w => w.direction === departure.direction);
        let due;
        if (departure.atPlatform) {
          due = departure.state === 'boarding' ? `${Math.max(0, Math.ceil(item.dwellRemaining))} s`
            : departure.state === 'closing' ? 'Closing' : departure.state === 'stopped' ? 'Stopped' : 'Now';
        } else if (departure.state === 'arriving') {
          due = 'Arriving';
        } else {
          const seconds = Math.max(1, Math.ceil(measuredWait?.seconds ?? departure.dueSeconds));
          due = seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
        }
        return {
          route: item.lineId, destination: departure.destinationStop.name,
          nextStop: departure.nextStop.name, direction: departure.directionName,
          platform: departure.platform ?? station.platformNumber ?? '01', color: this.lineColors.get(item.lineId) ?? '#6094be', due,
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
    this.glass?.ready();
    window.setTimeout(() => loading.hidden = true, 450);
  }
}

export function showError(error) {
  document.querySelector('#loading').hidden = true;
  document.querySelector('#error-message').textContent = error.message || 'Please use a browser with WebGL 2 support and hardware acceleration enabled.';
  document.querySelector('#error').hidden = false;
}
