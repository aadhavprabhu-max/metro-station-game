/** Freeze the actual simulation owners in place; no state serialization or catch-up. */
export class SurfaceSimulation {
  constructor() { this.paused = false; this.transitions = 0; }
  synchronize(player) {
    const paused = Boolean(player.surfaceExploring && !player.ridingCar);
    if (paused !== this.paused) { this.paused = paused; this.transitions++; }
    return this.paused;
  }
  advance(world, delta) {
    if (this.paused) return;
    for (const service of world.services) service.update(delta);
    for (const lift of world.lifts) lift.update(delta);
    world.u10Timetable?.update(delta);
    for (const info of world.passengerInformation) info.update(delta);
  }
}
