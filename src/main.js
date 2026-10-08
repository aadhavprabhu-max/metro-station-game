import './style.css';
import { createScene } from './scene.js';
import { PlayerController } from './player.js';
import { UI, showError } from './ui.js';
import { WorldVisibility } from './visibility.js';

try {
  const world = createScene(document.querySelector('#scene'));
  const player = new PlayerController(world.camera, world.renderer.domElement, world.station);
  player.configureServices(world.services, world.stations);
  if (new URLSearchParams(location.search).get('line') === 'U2') player.startAt('U2', 'u2-stadtzentrum');
  const ui = new UI(player, world.station.departures, world.service, world.stations, world.services);
  const visibility = new WorldVisibility(world);
  world.visibility = visibility;
  let shadowTimer = 0;
  let shadowAnchor = 0;
  let shadowAnchorX = 0;
  let shadowLine = 'U1';
  world.update = delta => {
    for (const service of world.services) service.update(delta);
    player.update(delta);
    visibility.update(player);
    ui.update(delta);
    shadowTimer += delta;
    const active = player.service ?? world.service;
    const closestStop = player.ridingCar ? active.route.stops.reduce((nearest, stop) =>
      Math.abs(stop.distance - active.distance) < Math.abs(nearest.distance - active.distance) ? stop : nearest,
    ) : null;
    const platform = closestStop ? world.stations.find(station => station.stationId === closestStop.id && station.lineId === active.lineId) : player.station;
    world.lighting.usePlatform(platform.platformId);
    platform.updateWorldMatrix(true, false);
    const matrix = platform.matrixWorld.elements;
    const anchor = player.ridingCar ? active.train.position.z : matrix[14];
    const anchorX = matrix[12];
    if (Math.abs(anchor - shadowAnchor) > 0.75 || Math.abs(anchorX - shadowAnchorX) > 0.75 || active.lineId !== shadowLine) {
      world.lighting.keyLight.position.set(anchorX - 5 * matrix[0] - 25 * matrix[8], 4.8, anchor - 5 * matrix[2] - 25 * matrix[10]);
      world.lighting.keyLight.target.position.set(anchorX + matrix[0] - 12 * matrix[8], 0, anchor + matrix[2] - 12 * matrix[10]);
      shadowAnchor = anchor;
      shadowAnchorX = anchorX;
      shadowLine = active.lineId;
      world.renderer.shadowMap.needsUpdate = true;
    }
    // Refresh moving train and door shadows at a limited rate.
    if (shadowTimer >= 0.12) {
      if (world.services.some(service => service.speed > 0 || service.train.doorsMoving)) world.renderer.shadowMap.needsUpdate = true;
      shadowTimer = 0;
    }
  };
  let lastTime = performance.now();
  let frames = 0;
  let contextLost = false;
  world.renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    player.setEnabled(false);
    runtime.status = 'context-lost';
    runtime.ready = false;
    showError(new Error('The graphics context was interrupted. Reload to return to the station.'));
  });
  // Deliberate inspection API for smoke tests and future station systems, with no per-frame DOM work.
  const runtime = {
    world, player, ready: false, status: 'initializing',
    get frames() { return frames; },
    snapshot() {
      return {
        ready: this.ready,
        status: this.status,
        position: world.camera.position.toArray(), yaw: player.yaw, pitch: player.pitch,
        dragging: Boolean(player.drag), carCount: world.train.cars.length,
        service: (player.service ?? world.service).snapshot(),
        services: world.services.map(service => service.snapshot()),
        activeLineId: player.service?.lineId ?? 'U1',
        stationCount: world.network.nodes.size, trainCount: world.trains.length,
        riding: Boolean(player.ridingCar), currentStation: player.station.displayName,
        departures: world.station.departures.departures.map(item => ({ ...item })),
        drawCalls: world.renderer.info.render.calls,
        triangles: world.renderer.info.render.triangles,
        renderer: world.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL',
        canvasSize: [world.renderer.domElement.width, world.renderer.domElement.height],
        viewport: { ...world.viewport },
      };
    },
  };
  window.metro = runtime;
  const renderFrame = now => {
    if (contextLost) return;
    try {
      const delta = Math.max(0, Math.min((now - lastTime) / 1000, 0.25));
      lastTime = now;
      if (!world.viewport.drawable) {
        runtime.status = 'waiting-for-size';
        return;
      }
      if (!document.hidden) {
        world.update(delta);
      }
      // Rendering is separate from simulation visibility. A hidden preview still
      // needs a real initial frame, and its last frame must remain capturable.
      world.renderer.render(world.scene, world.camera);
      frames++;
      runtime.status = 'running';
      if (!runtime.ready) { runtime.ready = true; ui.ready(); }
    } catch (error) {
      world.renderer.setAnimationLoop(null);
      runtime.status = 'error';
      runtime.ready = false;
      console.error(error);
      showError(error);
    }
  };
  world.onResize = () => renderFrame(performance.now());
  document.addEventListener('visibilitychange', () => {
    lastTime = performance.now();
    if (!document.hidden) renderFrame(lastTime);
  });
  // Submit the spawn view synchronously, before relying on an iframe's RAF loop.
  renderFrame(performance.now());
  if (runtime.status !== 'error') world.renderer.setAnimationLoop(renderFrame);
} catch (error) {
  console.error(error);
  showError(error);
}
