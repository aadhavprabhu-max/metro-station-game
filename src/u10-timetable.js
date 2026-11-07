import * as THREE from 'three';
import { TrainService } from './service.js';
import { TrainCar } from './train.js';

export const U10_SERVICE_OPTIONS = Object.freeze({ maxSpeed: 22, acceleration: 0.9, braking: 1.1, initialDwell: 40, dwellDuration: 20, deferReversal: true });

/** Headless use of production door integration and TrainService, without constructing render meshes. */
export function createTimingTrain() {
  const car = Object.create(TrainCar.prototype);
  Object.assign(car, { platformSide: -1, doors: [], doorways: [], destinationDisplays: [], cabs: [], doorTargets: { '-1': 0, '1': 0 }, doorProgressBySide: { '-1': 0, '1': 0 } });
  return {
    position: new THREE.Vector3(), rotation: new THREE.Euler(), platformSide: -1,
    setLineId() {}, setDestination() {}, setDirection() {},
    setPlatformSide(side) { this.platformSide = side; car.setPlatformSide(side); },
    setDoorsOpen(side) { car.setDoorsOpen(side); }, openDoors(side) { car.openDoors(side); }, closeDoors() { car.closeDoors(); },
    get doorsOpen() { return car.doorProgressBySide[this.platformSide] >= 0.98; },
    get doorsClosed() { return Object.values(car.doorProgressBySide).every(p => p === 0); },
    update(delta) { car.update(delta); },
  };
}

/** Timings are observed from 1/60 s controller steps, never distance/speed estimates. */
export function measureU10Timetable(route, options = U10_SERVICE_OPTIONS) {
  const controller = new TrainService(createTimingTrain(), route, options);
  const departures = [], arrivals = [], segments = [];
  let tick = 0, moving = false, departure = null, initialDeparture = null;
  const maxTicks = 60 * 7200;
  while (tick < maxTicks) {
    const previousLegs = controller.completedLegs;
    controller.update(1 / 60); tick++;
    const seconds = tick / 60;
    if (controller.speed > 0 && !moving) {
      departure = { stationId: controller.currentStop.id, name: controller.currentStop.name, direction: controller.direction, seconds, tick };
      departures.push(departure); initialDeparture ??= departure; moving = true;
      if (controller.completedLegs >= (route.stops.length - 1) * 2) break;
    }
    if (controller.completedLegs !== previousLegs) {
      const arrival = { stationId: controller.currentStop.id, name: controller.currentStop.name, seconds, tick, direction: departure.direction };
      arrivals.push(arrival);
      segments.push({ from: departure.name, to: arrival.name, fromId: departure.stationId, toId: arrival.stationId, direction: departure.direction,
        seconds: (tick - departure.tick) / 60, departureSeconds: departure.seconds, arrivalSeconds: seconds }); moving = false;
    }
  }
  if (segments.length !== (route.stops.length - 1) * 2) throw new Error('U10 timing run did not complete a round trip.');
  const headway = departures.at(-1).seconds - initialDeparture.seconds;
  const directions = [1, -1].map(direction => {
    const legs = segments.filter(s => s.direction === direction);
    const intermediate = legs.slice(0, -1).map(s => {
      const next = departures.find(d => d.stationId === s.toId && d.seconds > s.arrivalSeconds);
      return { station: s.to, standstillSeconds: next.seconds - s.arrivalSeconds, passengerDwellSeconds: options.dwellDuration,
        doorAndDepartureSeconds: next.seconds - s.arrivalSeconds - options.dwellDuration };
    });
    const runningSeconds = legs.reduce((sum, leg) => sum + leg.seconds, 0);
    const intermediateStandstillSeconds = intermediate.reduce((sum, s) => sum + s.standstillSeconds, 0);
    return { direction, from: legs[0].from, to: legs.at(-1).to, segments: legs, intermediate,
      runningSeconds, passengerDwellSeconds: intermediate.length * options.dwellDuration,
      intermediateStandstillSeconds, totalSeconds: runningSeconds + intermediateStandstillSeconds };
  });
  return { measured: true, method: 'Production TrainService + production TrainCar door integration at 60 steps/second',
    stepSeconds: 1 / 60, directions, headwaySeconds: headway, trainsPerDirectionPerHour: 3600 / headway,
    averageWaitSeconds: headway / 2, maximumWaitSeconds: headway, firstDepartureSeconds: initialDeparture.seconds,
    departures: departures.slice(0, -1).map(d => ({ ...d, phase: d.seconds - initialDeparture.seconds })), arrivals, fleetSize: 1 };
}

export class U10Timetable {
  constructor(service) { this.service = service; service.measuredTimetable = this; this.data = measureU10Timetable(service.route); this.elapsed = 0; this.phaseCorrection = 0; this.previous = null; this.departedAt = null; }
  update(delta) {
    this.elapsed += delta;
    const s = this.service, moving = s.speed > 0;
    if (moving && !this.previous?.moving) {
      this.departedAt = this.elapsed;
      const entry = this.data.departures.find(d => d.stationId === s.currentStop.id && d.direction === s.direction);
      if (entry) this.phaseCorrection = entry.phase - (this.elapsed - this.data.firstDepartureSeconds);
    }
    this.previous = { moving };
  }
  arrivalCountdown() {
    const s = this.service;
    const leg = this.data.directions.find(d => d.direction === s.direction)?.segments.find(l => l.fromId === s.currentStop.id);
    if (!leg) return 0;
    if (s.speed > 0 && this.departedAt !== null) return Math.max(0, leg.seconds - (this.elapsed - this.departedAt));
    return leg.seconds + s.departureSeconds;
  }
  waitingFor(stationId) {
    const { data } = this;
    const phase = this.elapsed - data.firstDepartureSeconds + this.phaseCorrection;
    return data.departures.filter(d => d.stationId === stationId).map(d => {
      let seconds;
      if (this.elapsed < data.firstDepartureSeconds) seconds = d.seconds - this.elapsed;
      else seconds = ((d.phase - phase) % data.headwaySeconds + data.headwaySeconds) % data.headwaySeconds;
      if (this.service.currentStop.id === stationId && this.service.canBoard && this.service.direction === d.direction) seconds = 0;
      return { direction: d.direction, destination: this.service.route.getTerminus(d.direction).name, seconds, boardingNow: seconds === 0 };
    });
  }
}

export function mountU10Timetable(timetable, player) {
  const panel = document.querySelector('#help-panel');
  const details = document.createElement('details'); details.id = 'u10-timings'; details.className = 'u10-timings';
  const summary = document.createElement('summary'); summary.textContent = 'U10 · Measured journey times'; details.append(summary);
  const introduction = document.createElement('p'); introduction.textContent = 'Measured using the actual train controller at 60 simulation steps per second. Values are simulation seconds; rendering frame rate does not change the timetable.'; details.append(introduction);
  for (const direction of timetable.data.directions) {
    const title = document.createElement('p'); title.className = 'timing-direction'; title.textContent = `${direction.from} → ${direction.to}`; details.append(title);
    for (const leg of direction.segments) {
      const row = document.createElement('p'); row.className = 'timing-segment'; row.textContent = `${leg.from} → ${leg.to} = ${leg.seconds.toFixed(2)} seconds`; details.append(row);
    }
    const totals = document.createElement('p');
    totals.textContent = `Running time = ${direction.runningSeconds.toFixed(2)} seconds. Intermediate boarding dwell = ${direction.passengerDwellSeconds.toFixed(2)} seconds. Intermediate door and departure sequences = ${(direction.intermediateStandstillSeconds - direction.passengerDwellSeconds).toFixed(2)} seconds. Total one-way journey = ${direction.totalSeconds.toFixed(2)} seconds.`; details.append(totals);
    for (const stop of direction.intermediate) {
      const row = document.createElement('p'); row.className = 'timing-dwell'; row.textContent = `${stop.station}: boarding ${stop.passengerDwellSeconds.toFixed(2)} seconds + door/departure sequence ${stop.doorAndDepartureSeconds.toFixed(2)} seconds`; details.append(row);
    }
  }
  const frequency = document.createElement('p'); frequency.textContent = `One U10 train operates the complete return service. Measured same-direction frequency = ${timetable.data.trainsPerDirectionPerHour.toFixed(2)} departures/hour; interval = ${timetable.data.headwaySeconds.toFixed(2)} seconds. Average wait for a uniformly timed arrival = ${timetable.data.averageWaitSeconds.toFixed(2)} seconds; maximum scheduled wait = ${timetable.data.maximumWaitSeconds.toFixed(2)} seconds. Both directions use this measured return cycle.`; details.append(frequency);
  const waiting = document.createElement('p'); waiting.id = 'u10-live-wait'; details.append(waiting);
  const stops = document.createElement('select'); stops.setAttribute('aria-label', 'U10 waiting-time station');
  for (const stop of timetable.service.route.stops) { const option = document.createElement('option'); option.value = stop.id; option.textContent = stop.name; stops.append(option); }
  details.append(stops); panel.insertBefore(details, document.querySelector('#close-help'));
  const button = document.createElement('button'); button.className = 'journey-times-button'; button.textContent = 'U10 journey times';
  button.addEventListener('click', () => {
    if (panel.hidden) document.querySelector('#help-button').click(); details.open = true; details.scrollIntoView({ block: 'start' });
  }); document.querySelector('.service-card').append(button);
  return () => { button.hidden = player.service?.lineId !== 'U10'; if (!details.open) return; waiting.textContent = timetable.waitingFor(stops.value).map(w => `${w.destination}: ${w.boardingNow ? 'boarding now' : w.seconds.toFixed(1) + ' seconds until next departure'}`).join(' · '); };
}
