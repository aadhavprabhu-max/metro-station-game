import './style.css';
import './surface.css';
import { createScene } from './scene.js';
import { PlayerController } from './player.js';
import { UI, showError } from './ui.js';
import { WorldVisibility } from './visibility.js';
import { AnnouncementController } from './announcements.js';
import { mountU10Timetable } from './u10-timetable.js';
import { Color } from 'three';

const interiorBackground = new Color('#64736b'), exteriorBackground = new Color('#a9ccdf');
const interiorFog = new Color('#6c7a6f'), exteriorFog = new Color('#b7cfdb');

try {
  const world = createScene(document.querySelector('#scene'));
  const player = new PlayerController(world.camera, world.renderer.domElement, world.station);
  player.configureServices(world.services, world.stations);
  player.configureTransfers(world.pedestrianTransfers);
  player.configureSurface(world.surfaceWorld);
  const initialLine = new URLSearchParams(location.search).get('line');
  if (initialLine && world.routes[initialLine]) player.startAt(initialLine, new URLSearchParams(location.search).get('station'));
  const ui = new UI(player, world.station.departures, world.service, world.stations, world.services);
  const announcer = new AnnouncementController(world.passengerInformation, player);
  ui.configureAnnouncements(announcer);
  world.announcer = announcer;
  const updateTimetable = world.u10Timetable ? mountU10Timetable(world.u10Timetable, player) : null;
  const liftButton = document.createElement('button'); liftButton.className = 'lift-action'; liftButton.hidden = true;
  document.querySelector('#app').append(liftButton); let activeLift = null;
  liftButton.addEventListener('click', () => activeLift?.activate(player));
  const visibility = new WorldVisibility(world);
  world.visibility = visibility;
  let shadowTimer = 0;
  let shadowAnchor = 0;
  let shadowAnchorX = 0;
  let shadowAnchorY = 0;
  let shadowLine = 'U1';
  world.update = delta => {
    player.syncSurfaceContext();
    world.surfaceSimulation.synchronize(player);
    // All transport clocks consume the same delta, including the frame that
    // crosses a street/stair threshold. Surface time is never accumulated.
    const transportDelta = world.surfaceSimulation.paused ? 0 : delta;
    world.surfaceSimulation.advance(world, transportDelta);
    player.update(delta);
    world.surfaceSimulation.synchronize(player);
    if (!world.surfaceSimulation.paused) {
      announcer.update(transportDelta);
      for (const displays of world.passengerDisplays) displays.update();
    }
    visibility.update(player);
    ui.update(transportDelta);
    if (world.surfaceWorld?.applyRendering(player, world)) {
      // The upper stairs can see daylight before reaching public street floor.
      // Keep railway reservations live there; suspend them with the services
      // only once surface exploration actually starts.
      if (!world.surfaceSimulation.paused) world.phase6World?.authority.update(world.services.find(service => service.lineId === 'U5'));
      liftButton.hidden = true;
      return;
    }
    if (world.phase6World && player.service?.lineId === 'U10') {
      world.phase6World.visible = false;
      world.phase6World.authority.update(world.services.find(s => s.lineId === 'U5'));
    } else world.phase6World?.update(delta, player, world);
    updateTimetable?.();
    activeLift = world.lifts.find(lift => lift.hint(player)) ?? null;
    const liftHint = activeLift?.hint(player);
    liftButton.hidden = !liftHint; liftButton.disabled = !liftHint?.enabled;
    if (liftHint && liftButton.textContent !== liftHint.text) liftButton.textContent = liftHint.text;
    const exposure = player.service?.lineId === 'U10' ? Math.max(0, Math.min(1, (player.camera.position.y - 1) / 15)) : 0;
    const outdoorBlend = exposure * exposure * (3 - 2 * exposure);
    const expressOutdoors = outdoorBlend > 0;
    if (world.city) world.city.visible = expressOutdoors;
    const onExpress = player.service?.lineId === 'U10';
    if (onExpress) {
      world.scene.fog = world.expressFog; world.scene.background = world.expressBackground;
      world.camera.far = 180 + 8320 * outdoorBlend;
    } else if (!world.phase6World && world.outdoorBlend !== undefined) {
      world.scene.fog = world.undergroundFog; world.scene.background = world.undergroundBackground; world.camera.far = 180;
    }
    if (onExpress && world.outdoorBlend !== outdoorBlend) {
      world.outdoorBlend = outdoorBlend;
      world.scene.background.copy(interiorBackground).lerp(exteriorBackground, outdoorBlend);
      world.scene.fog.color.copy(interiorFog).lerp(exteriorFog, outdoorBlend);
      world.scene.fog.near = 62 + 1038 * outdoorBlend; world.scene.fog.far = 125 + 6875 * outdoorBlend;
      world.camera.far = 180 + 8320 * outdoorBlend; world.camera.updateProjectionMatrix();
    }
    if (!onExpress) world.outdoorBlend = undefined;
    if (world.expressOutdoors !== expressOutdoors) {
      world.expressOutdoors = expressOutdoors;
      Object.assign(world.lighting.keyLight.shadow.camera, expressOutdoors
        ? { left: -65, right: 65, top: 65, bottom: -65, far: 400 }
        : { left: -37, right: 37, top: 30, bottom: -30, far: 75 });
      world.lighting.keyLight.shadow.camera.updateProjectionMatrix(); world.renderer.shadowMap.needsUpdate = true;
    }
    shadowTimer += delta;
    const active = player.service ?? world.service;
    const closestStop = player.ridingCar ? active.route.stops.reduce((nearest, stop) =>
      Math.abs(stop.distance - active.distance) < Math.abs(nearest.distance - active.distance) ? stop : nearest,
    ) : null;
    const platform = closestStop ? world.stations.find(station => station.stationId === closestStop.id && station.lineId === active.lineId) : player.station;
    world.lighting.usePlatform(player.transferSurface ? (player.transferSurface.transfer === world.verticalInterchange ? 'central-stairs' : player.transferSurface.transfer.name) : platform.platformId, player.transferSurface ? player.camera.position : null);
    platform.updateWorldMatrix(true, false);
    const matrix = player.ridingCar && active.route.hasCurves ? active.train.matrixWorld.elements : platform.matrixWorld.elements;
    const anchor = player.transferSurface ? player.camera.position.z : player.ridingCar ? active.train.position.z : matrix[14];
    const anchorX = player.transferSurface ? player.camera.position.x : player.ridingCar && active.route.hasCurves ? active.train.position.x : matrix[12];
    const anchorY = player.transferSurface?.floorY ?? (player.ridingCar && active.route.hasGrades ? active.train.position.y : matrix[13]);
    if (world.surfaceWorld?.justReturned || Math.abs(anchor - shadowAnchor) > 0.75 || Math.abs(anchorX - shadowAnchorX) > 0.75 || Math.abs(anchorY - shadowAnchorY) > 0.3 || active.lineId !== shadowLine) {
      world.lighting.keyLight.position.set(anchorX - 5 * matrix[0] - (expressOutdoors ? 85 : 25) * matrix[8], anchorY + (expressOutdoors ? 160 : 4.8), anchor - 5 * matrix[2] - (expressOutdoors ? 85 : 25) * matrix[10]);
      world.lighting.keyLight.target.position.set(anchorX + matrix[0] - 12 * matrix[8], anchorY, anchor + matrix[2] - 12 * matrix[10]);
      shadowAnchor = anchor;
      shadowAnchorX = anchorX;
      shadowAnchorY = anchorY;
      shadowLine = active.lineId;
      world.renderer.shadowMap.needsUpdate = true;
    }
    // Refresh moving train and door shadows at a limited rate.
    if (shadowTimer >= 0.12) {
      if (world.services.some(service => service.train.visible && (service.speed > 0 || service.train.doorsMoving))) world.renderer.shadowMap.needsUpdate = true;
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
        surfaceExploring: player.surfaceExploring, trainsSuspended: world.surfaceSimulation.paused,
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
