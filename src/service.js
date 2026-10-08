/**
 * A reversible metro service on an ordered route. Distances are measured along
 * the route; the train consist stays connected while the active cab changes.
 */
export class TrainService {
  constructor(train, route, options = {}) {
    if (!route?.stops || route.stops.length < 2 || typeof route.sample !== 'function') {
      throw new Error('A metro service needs a sampled route with at least two stops.');
    }
    this.train = train;
    this.route = route;
    this.lineId = route.lineId ?? route.id ?? 'U1';
    this.deferReversal = options.deferReversal ?? false;
    this.maxSpeed = options.maxSpeed ?? 10;
    this.acceleration = options.acceleration ?? 0.9;
    this.braking = options.braking ?? 1.1;
    this.initialDwell = options.initialDwell ?? 30;
    this.dwellDuration = options.dwellDuration ?? 20;
    this.closingDuration = 1.5;
    this.departurePause = 1.5;
    this.stopPause = 1;
    this.completedLegs = 0;
    this.reset();
  }

  reset() {
    this.stopIndex = 0;
    this.currentStop = this.route.stops[0];
    this.nextStop = this.route.stops[1];
    this.distance = this.currentStop.distance;
    this.direction = 1;
    this.cabDirection = this.direction;
    this.reversalPending = false;
    this.destinationStop = this.terminusFor(this.direction);
    this.speed = 0;
    this.state = 'boarding';
    this.stateTime = 0;
    this.dwellRemaining = this.initialDwell;
    this.completedLegs = 0;
    this.train.setLineId?.(this.lineId);
    this.train.setPlatformSide?.(this.platformSide);
    this.train.setDirection(this.cabDirection);
    this.train.setDestination(this.destinationStop.name);
    this.train.setDoorsOpen(this.platformSide);
    this.placeTrain();
  }

  get atStation() {
    return this.speed < 0.001 && Math.abs(this.distance - this.currentStop.distance) < 0.01;
  }

  get canBoard() {
    return this.state === 'boarding' && this.atStation && this.train.doorsOpen;
  }

  get directionName() { return this.directionLabel(this.direction); }

  directionLabel(direction) {
    return this.route.directionNames?.[direction] ?? (direction > 0 ? 'Northbound' : 'Southbound');
  }

  get platformSide() {
    return this.currentStop.platformSide ?? this.route.platformSide ?? this.train.platformSide ?? -1;
  }

  get isTerminus() {
    return this.currentStop === this.route.stops[0]
      || this.currentStop === this.route.stops[this.route.stops.length - 1];
  }

  terminusFor(direction) {
    return this.route.getTerminus?.(direction)
      ?? this.route.stops[direction > 0 ? this.route.stops.length - 1 : 0];
  }

  get departureSeconds() {
    if (this.state === 'boarding') return this.dwellRemaining + this.closingDuration + this.departurePause;
    if (this.state === 'closing') return Math.max(0, this.closingDuration - this.stateTime) + this.departurePause;
    if (this.state === 'departing') return Math.max(0, this.departurePause - this.stateTime);
    if (this.state === 'stopped') return Math.max(0, this.stopPause - this.stateTime)
      + this.dwellDuration + this.closingDuration + this.departurePause;
    return 0;
  }

  get arrivalSeconds() {
    return this.departureSeconds + this.motionSeconds(Math.abs(this.nextStop.distance - this.distance), this.speed);
  }

  motionSeconds(distance, speed = 0) {
    const { acceleration: a, braking: b, maxSpeed } = this;
    const peakSpeed = Math.sqrt((2 * a * b * distance + b * speed * speed) / (a + b));
    let motionTime;
    if (peakSpeed <= maxSpeed) {
      motionTime = Math.max(0, (peakSpeed - speed) / a) + peakSpeed / b;
    } else {
      const accelerationDistance = Math.max(0, (maxSpeed * maxSpeed - speed * speed) / (2 * a));
      const brakingDistance = maxSpeed * maxSpeed / (2 * b);
      motionTime = Math.max(0, (maxSpeed - speed) / a)
        + Math.max(0, distance - accelerationDistance - brakingDistance) / maxSpeed + maxSpeed / b;
    }
    return motionTime;
  }

  /**
   * Upcoming departures on this line, predicted by walking the same ordered
   * stops and reversal rules as the live service. Intermediate stations offer
   * both directions; termini offer the one direction into the line.
   * dueSeconds counts down to door closing, when the departure sequence starts.
   */
  departuresFor(stationId) {
    const stationIndex = this.route.stops.findIndex(stop => stop.id === stationId);
    if (stationIndex < 0) return [];
    const lastIndex = this.route.stops.length - 1;
    const directions = stationIndex === 0 ? [1] : stationIndex === lastIndex ? [-1] : [1, -1];
    const upcoming = new Map();
    const record = (index, direction, dueSeconds) => {
      if (index !== stationIndex || upcoming.has(direction)) return;
      const stop = this.route.stops[index];
      const nextStop = this.route.stops[index + direction];
      const destinationStop = this.terminusFor(direction);
      const atPlatform = this.atStation && this.currentStop.id === stationId && this.direction === direction;
      const arrivingDirection = index === lastIndex ? -1 : index === 0 ? 1 : this.direction;
      upcoming.set(direction, {
        lineId: this.lineId,
        route: this.lineId,
        stationId,
        direction,
        directionName: this.directionLabel(direction),
        destination: destinationStop.name,
        destinationStop,
        nextStation: nextStop.name,
        nextStop,
        platform: stop.platform,
        platformSide: stop.platformSide ?? this.route.platformSide ?? this.train.platformSide ?? -1,
        dueSeconds: Math.max(0, dueSeconds),
        atPlatform,
        state: atPlatform ? this.state
          : this.nextStop.id === stationId && direction === arrivingDirection && this.state === 'arriving' ? 'arriving' : 'scheduled',
      });
    };

    if (this.atStation) {
      const untilClosing = this.state === 'boarding' ? this.dwellRemaining
        : this.state === 'stopped' ? Math.max(0, this.stopPause - this.stateTime) + this.dwellDuration : 0;
      record(this.stopIndex, this.direction, untilClosing);
    }
    let index = this.route.stops.indexOf(this.nextStop);
    let direction = this.direction;
    let arrivalTime = this.arrivalSeconds;
    // One complete reversal cycle contains every station/direction combination.
    for (let visited = 0; visited < this.route.stops.length * 2 && upcoming.size < directions.length; visited++) {
      if (index === lastIndex) direction = -1;
      else if (index === 0) direction = 1;
      const closingTime = arrivalTime + this.stopPause + this.dwellDuration;
      record(index, direction, closingTime);
      const nextIndex = index + direction;
      const legDistance = Math.abs(this.route.stops[nextIndex].distance - this.route.stops[index].distance);
      arrivalTime = closingTime + this.closingDuration + this.departurePause + this.motionSeconds(legDistance);
      index = nextIndex;
    }
    return directions.map(direction => upcoming.get(direction)).filter(Boolean);
  }

  getDepartures(stationId) { return this.departuresFor(stationId); }

  requestDeparture() {
    if (!this.canBoard) return false;
    this.dwellRemaining = 0;
    this.changeState('closing');
    this.train.closeDoors();
    return true;
  }

  changeState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  placeTrain() {
    const sample = this.route.sample(this.distance);
    this.train.position.copy(sample.position);
    // A metro reverses cabs, rather than rotating its three connected cars.
    this.train.rotation.y = sample.yaw ?? 0;
  }

  arrive() {
    this.distance = this.nextStop.distance;
    this.speed = 0;
    this.currentStop = this.nextStop;
    this.stopIndex = this.route.stops.indexOf(this.currentStop);
    this.completedLegs += 1;
    if (this.stopIndex === this.route.stops.length - 1) this.direction = -1;
    else if (this.stopIndex === 0) this.direction = 1;
    this.nextStop = this.route.stops[this.stopIndex + this.direction];
    this.destinationStop = this.terminusFor(this.direction);
    this.train.setPlatformSide?.(this.platformSide);
    this.reversalPending = this.deferReversal && this.cabDirection !== this.direction;
    if (!this.reversalPending) {
      this.cabDirection = this.direction;
      this.train.setDirection(this.cabDirection);
    }
    this.train.setDestination(this.destinationStop.name);
    this.changeState('stopped');
    this.placeTrain();
  }

  move(delta) {
    // Braking is based on stopping distance, with a small integration margin.
    const remaining = Math.abs(this.nextStop.distance - this.distance);
    const stoppingDistance = this.speed * this.speed / (2 * this.braking);
    const shouldBrake = this.state === 'arriving' || remaining <= stoppingDistance + this.speed * delta + 0.02;
    if (shouldBrake && this.state !== 'arriving') this.changeState('arriving');
    const previousSpeed = this.speed;
    // Once braking starts, solve the precise deceleration for the remaining
    // distance. This prevents a stop short of the platform followed by a creep.
    const deceleration = shouldBrake && remaining > 0 ? this.speed * this.speed / (2 * remaining) : this.braking;
    this.speed = shouldBrake
      ? Math.max(0, this.speed - deceleration * delta)
      : Math.min(this.maxSpeed, this.speed + this.acceleration * delta);
    const travel = (previousSpeed + this.speed) * delta / 2;
    if (travel >= remaining || (remaining < 0.0001 && this.speed < 0.02)) {
      this.arrive();
      return;
    }
    this.distance += this.direction * travel;
    this.distance = Math.max(this.route.stops[0].distance, Math.min(this.route.length, this.distance));
    this.placeTrain();
    if (this.state === 'departing' && this.speed >= 2) this.changeState('travelling');
  }

  step(delta) {
    this.stateTime += delta;
    this.train.update(delta);
    switch (this.state) {
      case 'boarding':
        this.dwellRemaining = Math.max(0, this.dwellRemaining - delta);
        if (this.dwellRemaining === 0) {
          this.train.closeDoors();
          this.changeState('closing');
        }
        break;
      case 'closing':
        if (this.stateTime >= this.closingDuration && this.train.doorsClosed) {
          // A reversing service switches the active cab only after its dwell
          // and complete door closure. Its connected cars never turn around.
          if (this.reversalPending) {
            this.cabDirection = this.direction;
            this.train.setDirection(this.cabDirection);
            this.reversalPending = false;
          }
          this.changeState('departing');
        }
        break;
      case 'departing':
        if (this.stateTime >= this.departurePause && this.train.doorsClosed) this.move(delta);
        break;
      case 'travelling':
      case 'arriving':
        this.move(delta);
        break;
      case 'stopped':
        if (this.stateTime >= this.stopPause) {
          this.dwellRemaining = this.dwellDuration;
          this.train.openDoors(this.platformSide);
          this.changeState('boarding');
        }
        break;
      default:
        throw new Error(`Unknown metro service state: ${this.state}`);
    }
  }

  update(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    // Small simulation steps avoid skipping platforms or door safety on late frames.
    let remaining = delta;
    while (remaining > 0.000001) {
      const step = Math.min(remaining, 1 / 60);
      this.step(step);
      remaining -= step;
    }
  }

  snapshot() {
    const describeStop = stop => ({
      id: stop.id, name: stop.name, distance: stop.distance, platform: stop.platform,
      platformSide: stop.platformSide ?? this.route.platformSide ?? this.train.platformSide ?? -1,
      nodeId: stop.node?.id ?? stop.id,
      isTerminus: stop === this.route.stops[0] || stop === this.route.stops[this.route.stops.length - 1],
      interchange: Boolean(stop.interchange || (stop.node?.lineIds?.length ?? 0) > 1),
      interchangeCapable: Boolean(stop.interchangeCapable ?? stop.node?.interchangeCapable),
      servedLines: [...(stop.node?.lineIds ?? stop.servedLines ?? [this.lineId])],
      plannedLines: [...(stop.node?.plannedLines ?? stop.plannedLines ?? [])],
    });
    return {
      state: this.state,
      speed: this.speed,
      distance: this.distance,
      direction: this.direction,
      cabDirection: this.cabDirection,
      reversalPending: this.reversalPending,
      directionName: this.directionName,
      lineId: this.lineId,
      platformSide: this.platformSide,
      isTerminus: this.isTerminus,
      currentStop: describeStop(this.currentStop),
      nextStop: describeStop(this.nextStop),
      destinationStop: describeStop(this.destinationStop),
      stateTime: this.stateTime,
      dwellRemaining: this.dwellRemaining,
      canBoard: this.canBoard,
      atStation: this.atStation,
      departureSeconds: this.departureSeconds,
      arrivalSeconds: this.arrivalSeconds,
      completedLegs: this.completedLegs,
      doorsOpen: this.train.doorsOpen,
      doorsClosed: this.train.doorsClosed,
    };
  }
}
