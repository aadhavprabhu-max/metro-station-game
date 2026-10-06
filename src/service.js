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
    this.destinationStop = this.route.stops[1];
    this.distance = this.currentStop.distance;
    this.direction = 1;
    this.speed = 0;
    this.state = 'boarding';
    this.stateTime = 0;
    this.dwellRemaining = this.initialDwell;
    this.completedLegs = 0;
    this.train.setDirection(this.direction);
    this.train.setDestination(this.destinationStop.name);
    this.train.setDoorsOpen(-1);
    this.placeTrain();
  }

  get atStation() {
    return this.speed < 0.001 && Math.abs(this.distance - this.currentStop.distance) < 0.01;
  }

  get canBoard() {
    return this.state === 'boarding' && this.atStation && this.train.doorsOpen;
  }

  get departureSeconds() {
    if (this.state === 'boarding') return this.dwellRemaining + this.closingDuration + this.departurePause;
    if (this.state === 'closing') return Math.max(0, this.closingDuration - this.stateTime) + this.departurePause;
    if (this.state === 'departing') return Math.max(0, this.departurePause - this.stateTime);
    return 0;
  }

  get arrivalSeconds() {
    const distance = Math.abs(this.destinationStop.distance - this.distance);
    const { speed, acceleration: a, braking: b, maxSpeed } = this;
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
    return this.departureSeconds + motionTime;
  }

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
    this.distance = this.destinationStop.distance;
    this.speed = 0;
    this.currentStop = this.destinationStop;
    this.stopIndex = this.route.stops.indexOf(this.currentStop);
    this.completedLegs += 1;
    if (this.stopIndex === this.route.stops.length - 1) this.direction = -1;
    else if (this.stopIndex === 0) this.direction = 1;
    this.destinationStop = this.route.stops[this.stopIndex + this.direction];
    this.train.setDirection(this.direction);
    this.train.setDestination(this.destinationStop.name);
    this.changeState('stopped');
    this.placeTrain();
  }

  move(delta) {
    // Braking is based on stopping distance, with a small integration margin.
    const remaining = Math.abs(this.destinationStop.distance - this.distance);
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
        if (this.stateTime >= this.closingDuration && this.train.doorsClosed) this.changeState('departing');
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
          this.train.openDoors(-1);
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
    const describeStop = stop => ({ id: stop.id, name: stop.name, distance: stop.distance, platform: stop.platform });
    return {
      state: this.state,
      speed: this.speed,
      distance: this.distance,
      direction: this.direction,
      currentStop: describeStop(this.currentStop),
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
