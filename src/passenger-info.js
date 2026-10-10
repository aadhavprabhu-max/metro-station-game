const EPSILON = 0.000001;

const sideForDirection = (platformSide, direction) =>
  platformSide === -1 || platformSide === 1 ? (platformSide * direction < 0 ? 'left' : 'right') : null;

/** Passenger-facing route data and events, derived entirely from the live service. */
export class PassengerInformation {
  constructor(service, network = service?.route?.network) {
    if (!service?.route?.stops?.length || !network?.nodes || !network?.lines) {
      throw new Error('Passenger information requires a live service and its metro network.');
    }
    this.service = service;
    this.network = network;
    this.sessionId = 0;
    this.revision = 0;
    this.events = [];
    this.listeners = new Set();
    this.seenEvents = new Set();
    this.timeSeconds = 0;
    this.hasClock = false;
    this.departedAt = null;
    this.arrival = null;
    this.transferLinks = null;
    this.route = service.route;
    this.snapshot = this.describe();
    this.visibleKey = this.displayKey(this.snapshot);
  }

  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('A passenger information subscriber must be a function.');
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Physical passages/stairs supply topology without another station list. */
  configureTransfers(transfers) {
    this.transferLinks = transfers.map(transfer => ({
      type: transfer.type ?? (transfer.surfaces ? 'stairs' : 'passage'),
      platformIds: [...(transfer.platformIds ?? transfer.platforms.map(platform => platform.platformId))],
    }));
    return this.update();
  }

  transferPath(fromId, toId) {
    if (!this.transferLinks) return null;
    const pending = [{ id: fromId, path: [] }];
    const visited = new Set([fromId]);
    for (let index = 0; index < pending.length; index++) {
      const current = pending[index];
      if (current.id === toId) return current.path;
      for (const link of this.transferLinks) {
        if (!link.platformIds.includes(current.id)) continue;
        for (const id of link.platformIds) {
          if (visited.has(id)) continue;
          visited.add(id);
          pending.push({ id, path: [...current.path, { from: current.id, to: id, type: link.type }] });
        }
      }
    }
    return [];
  }

  describeStop(stop) {
    if (!stop) return null;
    const { service, network } = this;
    const lineId = service.lineId;
    const node = network.nodes.get(stop.id) ?? stop.node;
    const platform = node?.platforms?.[lineId];
    const floorY = stop.floorY ?? platform?.floorY ?? stop.position?.y ?? node?.position?.y ?? 0;
    const level = stop.level ?? platform?.level ?? (floorY < 0 ? 'lower' : 'upper');
    const platformSide = stop.platformSide ?? platform?.platformSide ?? service.route.platformSide ?? service.train.platformSide ?? null;
    // A planned line alone does not establish a usable transfer. Central's
    // implemented lines all have a real platform on the shared station node.
    const interchanges = node?.interchangeCapable && this.transferLinks ? (node.lineIds ?? []).filter(id =>
      id !== lineId && network.lines.has(id) && node.platforms?.[id],
    ).flatMap(id => {
      const other = node.platforms[id];
      const otherFloor = other.floorY ?? other.position.y;
      const line = network.lines.get(id);
      const steps = this.transferPath(platform?.id ?? `${stop.id}:${lineId}`, other.id);
      // When physical topology is provided, omit disconnected platforms.
      if (steps && !steps.length) return [];
      const path = steps?.map(step => {
        const target = Object.values(node.platforms).find(item => item.id === step.to);
        return {
          type: step.type, fromPlatformId: step.from, toPlatformId: step.to,
          lineId: target.lineId, platformNumber: target.number,
          floorY: target.floorY ?? target.position.y,
          level: target.level ?? (target.position.y < 0 ? 'lower' : 'upper'),
        };
      }) ?? [];
      return [{
        lineId: id, name: line.name, color: line.color,
        platformNumber: other.number, platform: other.number,
        floorY: otherFloor, level: other.level ?? (otherFloor < 0 ? 'lower' : 'upper'),
        connection: steps ? (steps.some(step => step.type === 'stairs') ? 'stairs' : 'passage') : null,
        implemented: Boolean(steps), path,
      }];
    }) : [];
    return {
      id: stop.id, name: stop.name ?? node?.name,
      displayName: stop.displayName ?? node?.displayName ?? stop.name ?? node?.name,
      distance: stop.distance,
      platformNumber: stop.platform ?? platform?.number ?? node?.platform,
      platform: stop.platform ?? platform?.number ?? node?.platform,
      platformId: stop.platformId ?? platform?.id ?? `${stop.id}:${lineId}`,
      floorY, level, platformSide, interchanges,
      isTerminus: stop === service.route.stops[0] || stop === service.route.stops.at(-1),
    };
  }

  describeDoors() {
    const { service } = this;
    const side = service.platformSide;
    const cars = service.train.cars ?? [];
    const progress = cars.length ? cars.reduce((sum, car) => sum + (car.doorProgressBySide?.[side] ?? 0), 0) / cars.length : null;
    const target = cars.length ? cars.reduce((sum, car) => sum + (car.doorTargets?.[side] ?? car.doorTarget ?? 0), 0) / cars.length : null;
    let state;
    if (progress !== null && target > progress + EPSILON) state = 'opening';
    else if (progress !== null && target < progress - EPSILON) state = 'closing';
    else if (service.train.doorsOpen) state = 'open';
    else if (service.train.doorsClosed) state = 'closed';
    else state = service.state === 'closing' ? 'closing' : service.state === 'boarding' ? 'opening' : 'moving';
    return { state, progress, target, open: Boolean(service.train.doorsOpen), closed: Boolean(service.train.doorsClosed) };
  }

  describe() {
    const { service } = this;
    const sourceStops = service.route.stops;
    const direction = service.direction;
    const currentIndex = sourceStops.indexOf(service.currentStop);
    const nextIndex = sourceStops.indexOf(service.nextStop);
    const currentStation = this.describeStop(service.currentStop);
    const nextStation = this.describeStop(service.nextStop);
    const atStation = service.speed <= EPSILON && Math.abs(service.distance - service.currentStop.distance) <= EPSILON;
    const remainingStops = [];
    for (let index = nextIndex; index >= 0 && index < sourceStops.length; index += direction) {
      remainingStops.push(this.describeStop(sourceStops[index]));
    }
    const orderedStops = sourceStops.map((stop, index) => {
      let status = (index - currentIndex) * direction < 0 ? 'passed' : 'upcoming';
      if (index === currentIndex) status = atStation ? 'current' : 'passed';
      if (index === nextIndex) status = 'next';
      return { ...this.describeStop(stop), status };
    });
    const platformSide = service.platformSide;
    const doors = this.describeDoors();
    const fromDistance = service.currentStop.distance;
    const toDistance = service.nextStop.distance;
    const length = Math.abs(toDistance - fromDistance);
    const travelled = Math.min(length, Math.max(0, Math.abs(service.distance - fromDistance)));
    const line = this.network.lines.get(service.lineId) ?? service.route.line;
    const arrivalDirection = this.arrival?.direction ?? direction;
    const previousIndex = currentIndex - (atStation && this.arrival ? arrivalDirection : direction);
    const conflicts = sourceStops.filter(stop => {
      const node = this.network.nodes.get(stop.id);
      return node?.name && stop.name && node.name !== stop.name;
    }).map(stop => ({ id: stop.id, routeName: stop.name, networkName: this.network.nodes.get(stop.id).name }));
    return {
      lineId: service.lineId, color: line?.color, lineName: line?.name,
      orderedStops, direction, directionName: service.directionName,
      cabDirection: service.cabDirection, reversalPending: Boolean(service.reversalPending),
      currentStation, previousStation: this.describeStop(sourceStops[previousIndex]),
      nextStation, followingStation: this.describeStop(sourceStops[nextIndex + direction]),
      remainingStops, terminus: this.describeStop(service.destinationStop),
      termini: { forward: this.describeStop(sourceStops.at(-1)), reverse: this.describeStop(sourceStops[0]) },
      state: service.state, distance: service.distance, speed: service.speed, atStation,
      platformNumber: currentStation.platformNumber, floorY: currentStation.floorY, level: currentStation.level,
      platformSide, doorSide: sideForDirection(platformSide, direction),
      doorSideReference: 'direction of travel', arrivalDirection,
      arrivalDoorSide: sideForDirection(platformSide, arrivalDirection),
      nextDoorSide: sideForDirection(nextStation.platformSide, direction),
      doorState: doors.state, doors, canBoard: Boolean(service.canBoard),
      interchanges: (atStation ? currentStation : nextStation).interchanges,
      completedLegs: service.completedLegs, sessionId: this.sessionId,
      legId: `${service.lineId}:${this.sessionId}:${service.completedLegs}`,
      leg: {
        from: currentStation, to: nextStation, direction, arrivalDirection: direction, length, travelled,
        remaining: Math.max(0, length - travelled), progress: length > 0 ? travelled / length : 0,
        elapsedSeconds: this.hasClock && this.departedAt !== null ? Math.max(0, this.timeSeconds - this.departedAt) : null,
      },
      arrival: this.arrival,
      timeSeconds: this.hasClock ? this.timeSeconds : null,
      stateTime: service.stateTime, dwellRemaining: service.dwellRemaining,
      arrivalSeconds: service.arrivalSeconds, departureSeconds: service.departureSeconds,
      routeConflicts: conflicts, revision: this.revision,
    };
  }

  displayKey(snapshot) {
    // Exact motion/time remains available in snapshot. Only passenger-visible
    // changes revise the display, avoiding a new canvas texture every frame.
    return JSON.stringify({
      line: snapshot.lineId, color: snapshot.color,
      stations: snapshot.orderedStops,
      direction: snapshot.direction, cabDirection: snapshot.cabDirection,
      reversalPending: snapshot.reversalPending,
      current: snapshot.currentStation.id, next: snapshot.nextStation.id,
      following: snapshot.followingStation?.id, terminus: snapshot.terminus.id,
      state: snapshot.state, atStation: snapshot.atStation, doors: snapshot.doorState,
      side: snapshot.doorSide, arrivalSide: snapshot.arrivalDoorSide,
    });
  }

  isReset(previous) {
    const { service } = this;
    if (service.route !== this.route || service.completedLegs < previous.completedLegs) return true;
    return service.completedLegs === 0 && service.state === 'boarding' && service.speed <= EPSILON
      && service.currentStop === service.route.stops[0]
      && Math.abs(service.distance - service.currentStop.distance) <= EPSILON
      && (previous.state !== 'boarding' || previous.speed > EPSILON
        || service.stateTime + EPSILON < previous.stateTime);
  }

  emit(type, extra = {}) {
    const snapshot = this.snapshot;
    const legId = extra.legId ?? snapshot.legId;
    const id = `${legId}:${type}`;
    if (this.seenEvents.has(id)) return;
    this.seenEvents.add(id);
    const station = extra.station ?? snapshot.currentStation;
    const event = {
      id, type, lineId: snapshot.lineId, sessionId: snapshot.sessionId, legId,
      station, nextStation: snapshot.nextStation, terminus: snapshot.terminus,
      interchanges: type === 'departure' || type === 'approaching' ? snapshot.nextStation.interchanges : station.interchanges,
      direction: snapshot.direction, arrivalDirection: snapshot.arrivalDirection,
      platformSide: snapshot.platformSide, doorSide: snapshot.doorSide,
      arrivalDoorSide: snapshot.arrivalDoorSide,
      state: snapshot.state, distance: snapshot.distance, speed: snapshot.speed,
      stateTime: snapshot.stateTime, timeSeconds: snapshot.timeSeconds,
      leg: snapshot.leg, snapshot, ...extra,
    };
    this.events.push(event);
    if (this.events.length > 256) this.seenEvents.delete(this.events.shift().id);
    for (const callback of this.listeners) callback(event);
  }

  /** Call after the service physics; pass the same delta for simulation timestamps. */
  update(deltaSeconds = null) {
    const previous = this.snapshot;
    if (this.isReset(previous)) {
      this.sessionId++;
      this.seenEvents.clear();
      this.route = this.service.route;
      this.arrival = null;
      this.departedAt = null;
    }
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      this.timeSeconds += deltaSeconds;
      this.hasClock = true;
    }
    const arrived = this.service.completedLegs > previous.completedLegs
      && this.service.speed <= EPSILON
      && Math.abs(this.service.distance - this.service.currentStop.distance) <= EPSILON;
    if (arrived) {
      this.arrival = {
        from: previous.leg.from, to: this.describeStop(this.service.currentStop),
        direction: previous.direction, legId: previous.legId,
        timeSeconds: this.hasClock ? this.timeSeconds : null,
        elapsedSeconds: this.hasClock && this.departedAt !== null ? this.timeSeconds - this.departedAt : null,
      };
      this.departedAt = null;
    }
    const departing = this.service.speed > EPSILON
      && Math.abs(this.service.distance - this.service.currentStop.distance) > EPSILON;
    const departureId = `${this.service.lineId}:${this.sessionId}:${this.service.completedLegs}:departure`;
    const firstMovement = departing && !this.seenEvents.has(departureId);
    if (firstMovement) this.departedAt = this.hasClock ? this.timeSeconds : null;
    this.snapshot = this.describe();
    const visibleKey = this.displayKey(this.snapshot);
    if (visibleKey !== this.visibleKey) { this.visibleKey = visibleKey; this.revision++; }
    this.snapshot.revision = this.revision;
    if (firstMovement) this.emit('departure');
    if (this.snapshot.state === 'arriving' && this.snapshot.speed > EPSILON) this.emit('approaching', { station: this.snapshot.nextStation });
    if (arrived) {
      const arrivalLeg = {
        from: this.arrival.from, to: this.arrival.to, direction: this.arrival.direction,
        length: Math.abs(this.arrival.to.distance - this.arrival.from.distance),
        travelled: Math.abs(this.arrival.to.distance - this.arrival.from.distance),
        remaining: 0, progress: 1, elapsedSeconds: this.arrival.elapsedSeconds,
      };
      this.emit('arrival', { legId: this.arrival.legId, leg: arrivalLeg });
      if (this.snapshot.currentStation.isTerminus) this.emit('terminus', { legId: this.arrival.legId, leg: arrivalLeg });
    }
    if (this.snapshot.doorState !== previous.doorState) {
      const types = { opening: 'doors-opening', open: 'doors-open', closing: 'doors-closing', closed: 'doors-closed' };
      if (types[this.snapshot.doorState]) this.emit(types[this.snapshot.doorState]);
    }
    return this.snapshot;
  }
}
