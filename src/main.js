import './style.css';
import { createScene } from './scene.js';
import { PlayerController } from './player.js';
import { UI, showError } from './ui.js';

try {
  const world = createScene(document.querySelector('#scene'));
  const player = new PlayerController(world.camera, world.renderer.domElement, world.station);
  player.configureService(world.service, world.stations);
  const ui = new UI(player, world.station.departures, world.service, world.stations);
  let shadowTimer = 0;
  let shadowAnchor = 0;
  world.update = delta => {
    world.service.update(delta);
    player.update(delta);
    ui.update(delta);
    shadowTimer += delta;
    const anchor = player.ridingCar ? world.train.position.z : player.station.position.z;
    if (Math.abs(anchor - shadowAnchor) > 0.75) {
      world.lighting.keyLight.position.z = -25 + anchor;
      world.lighting.keyLight.target.position.z = -12 + anchor;
      shadowAnchor = anchor;
      world.renderer.shadowMap.needsUpdate = true;
    }
    // Refresh moving train and door shadows at a limited rate.
    if (shadowTimer >= 0.12) {
      if (world.service.speed > 0 || world.train.cars.some(car => car.doorProgress !== car.doorTarget)) world.renderer.shadowMap.needsUpdate = true;
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
        service: world.service.snapshot(),
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
