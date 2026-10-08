import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMaterials } from './materials.js';
import { Station } from './station.js';
import { Train } from './train.js';
import { Lighting } from './lighting.js';
import { MetroRoute, RouteWorld } from './route.js';
import { TrainService } from './service.js';
import { createMetroNetwork, addU2ToNetwork } from './network.js';
import { U2World } from './u2-world.js';

export function createScene(container) {
  if (!container) throw new Error('The 3D scene container is missing.');
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    // Embedded previews may copy the canvas after RAF has finished. Keep the last
    // actual frame available instead of exposing a discarded, transparent buffer.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#64736b');
  scene.fog = new THREE.Fog('#6c7a6f', 62, 125);
  const camera = new THREE.PerspectiveCamera(73, 1, 0.06, 180);
  const viewport = { width: -1, height: -1, drawable: false };
  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === viewport.width && height === viewport.height) return false;
    Object.assign(viewport, { width, height, drawable: width > 0 && height > 0 });
    // A preview can begin at 0 × 0. Never create a NaN projection matrix or a
    // zero-sized drawing buffer; wait for the container's real layout instead.
    camera.aspect = Math.max(width, 1) / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
    return true;
  };
  resize();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.48;
  room.dispose(); pmrem.dispose();
  const materials = createMaterials();
  const network = createMetroNetwork();
  addU2ToNetwork(network);
  const route = new MetroRoute(network, 'U1');
  const u2Route = new MetroRoute(network, 'U2');
  u2Route.directionNames = { 1: 'Outbound', '-1': 'Inbound' };
  const station = new Station(materials, { northCap: false, destinationName: route.getTerminus(1).name, routeNames: route.stops.map(stop => stop.name) });
  const train = new Train(materials);
  const routeWorld = new RouteWorld(materials, station, route);
  const service = new TrainService(train, route);
  const u2World = new U2World(materials, u2Route, routeWorld.station2);
  const u2Train = new Train(materials, { lineId: 'U2', platformSide: 1, accentColor: u2Route.line.color });
  const u2Service = new TrainService(u2Train, u2Route, { initialDwell: 40, deferReversal: true });
  const stations = [...routeWorld.stations, ...u2World.stations];
  const services = [service, u2Service];
  const lighting = new Lighting(scene, materials);
  for (const nextStation of stations.slice(1)) {
    const position = nextStation.getWorldPosition(new THREE.Vector3());
    const matrix = nextStation.matrixWorld.elements;
    lighting.addStationFixtures(position.z, {
      cool: nextStation.stationId === 'station-2', pointLights: 2,
      ...nextStation.lightingOptions,
      offsetX: position.x, rotationY: Math.atan2(matrix[8], matrix[10]),
      platformId: nextStation.platformId,
    });
  }
  scene.add(station, train, u2Train, lighting, routeWorld, u2World);
  const world = {
    scene, renderer, camera, station, stations, train, route, network, routeWorld, service,
    routes: { U1: route, U2: u2Route }, services, trains: [train, u2Train], u2World,
    interchanges: u2World.interchanges,
    lighting, resize, environment, viewport, onResize: null,
  };
  const handleResize = () => { if (resize()) world.onResize?.(); };
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);
  window.addEventListener('resize', handleResize);
  world.disposeResize = () => { resizeObserver.disconnect(); window.removeEventListener('resize', handleResize); };
  return world;
}
