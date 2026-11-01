import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMaterials } from './materials.js';
import { Train } from './train.js';
import { Lighting } from './lighting.js';
import { MetroRoute } from './route.js';
import { TrainService } from './service.js';
import { createMetroNetwork, addU2ToNetwork, addLowerLinesToNetwork, createCompleteMetroNetwork } from './network.js';
import { NetworkLineWorld, NEW_TRANSFERS } from './network-world.js';
import { CentralInterchange } from './interchange.js';
import { VerticalInterchange } from './vertical-interchange.js';
import { NetworkTransfer } from './network-transfers.js';
import { PassengerInformation } from './passenger-info.js';
import { attachPassengerDisplays } from './passenger-displays.js';

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
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const graphicsName = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
  const softwareGraphics = /swiftshader|llvmpipe|software/i.test(graphicsName);
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
  // The original graph is a regression fixture using this same engine. Normal
  // gameplay includes U5/U6 and the completed seven-stop U1/U2/U3 routes.
  const originalNetwork = new URLSearchParams(location.search).get('network') === 'original';
  const network = originalNetwork ? createMetroNetwork() : createCompleteMetroNetwork();
  if (originalNetwork) { addU2ToNetwork(network); addLowerLinesToNetwork(network); }
  const routes = Object.fromEntries([...network.lines.keys()].map(lineId => [lineId, new MetroRoute(network, lineId)]));
  for (const route of Object.values(routes)) if (route.lineId !== 'U1') route.directionNames = { 1: 'Outbound', '-1': 'Inbound' };
  const lineWorlds = Object.fromEntries(Object.values(routes).map(route => [route.lineId, new NetworkLineWorld(materials, route)]));
  const stations = Object.values(lineWorlds).flatMap(root => root.stations);
  const routeWorld = lineWorlds.U1, u2World = lineWorlds.U2;
  const station = routeWorld.stations[0], route = routes.U1;
  const services = Object.values(routes).map(nextRoute => {
    const side = nextRoute.stops[0].platformSide ?? (['U2', 'U4'].includes(nextRoute.lineId) ? 1 : -1);
    const nextTrain = new Train(materials, { lineId: nextRoute.lineId, platformSide: side,
      ...(nextRoute.lineId === 'U1' ? {} : { accentColor: nextRoute.line.color }) });
    return new TrainService(nextTrain, nextRoute, { initialDwell: nextRoute.lineId === 'U1' ? 30 : 40, deferReversal: nextRoute.lineId !== 'U1' });
  });
  const service = services[0], train = service.train, trains = services.map(item => item.train);
  const lowerWorld = new THREE.Group(); lowerWorld.name = 'LowerRailwayWorld'; lowerWorld.floorY = -12; lowerWorld.level = 'lower';
  Object.assign(lowerWorld, { u3World: lineWorlds.U3, u4World: lineWorlds.U4,
    lineWorlds: { U3: lineWorlds.U3, U4: lineWorlds.U4 },
    stations: [...lineWorlds.U3.stations, ...lineWorlds.U4.stations],
    centralU3: lineWorlds.U3.central, centralU4: lineWorlds.U4.central });
  lowerWorld.add(lineWorlds.U3, lineWorlds.U4);
  // Central retains its original physical upper/lower passages and staircase.
  const upperPassage = new CentralInterchange(u2World.materials, routeWorld.central, u2World.central, {
    firstDestinations: routes.U1.stops.filter(stop => stop.isTerminus).map(stop => stop.name.toUpperCase()).join(' / '),
    secondDestinations: routes.U2.stops.filter(stop => stop.isTerminus).map(stop => stop.name.toUpperCase()).join(' / '),
  });
  u2World.add(upperPassage); u2World.interchange = upperPassage; u2World.interchanges = [upperPassage];
  const lowerPassage = new CentralInterchange(lineWorlds.U4.materials, lineWorlds.U3.central, lineWorlds.U4.central, {
    floorY: -12, firstLine: 'U3', secondLine: 'U4', firstColor: routes.U3.line.color, secondColor: routes.U4.line.color,
    firstDestinations: routes.U3.stops.filter(stop => stop.isTerminus).map(stop => stop.name.toUpperCase()).join(' / '),
    secondDestinations: routes.U4.stops.filter(stop => stop.isTerminus).map(stop => stop.name.toUpperCase()).join(' / '),
  });
  lineWorlds.U4.add(lowerPassage); lineWorlds.U4.interchange = lowerPassage;
  lowerWorld.interchange = lowerPassage; lowerWorld.interchanges = [lowerPassage];
  const verticalInterchange = new VerticalInterchange(materials, routeWorld.central, lineWorlds.U3.central);
  const networkTransfers = NEW_TRANSFERS.filter(definition => routes[definition.lowerLine]).map(definition => {
    const upper = stations.find(item => item.stationId === definition.id && item.lineId === definition.upperLine);
    const lower = stations.find(item => item.stationId === definition.id && item.lineId === definition.lowerLine);
    const transfer = new NetworkTransfer(materials, upper, lower, definition);
    network.nodes.get(definition.id).interchangeCapable = true;
    return transfer;
  });
  const interchanges = [upperPassage, lowerPassage];
  const pedestrianTransfers = [verticalInterchange, ...networkTransfers];
  const passengerInformation = services.map(nextService => new PassengerInformation(nextService, network));
  const transferConnections = [...interchanges.map(passage => ({ type: 'passage', platformIds: passage.platformIds })),
    ...pedestrianTransfers.map(stairs => ({ type: 'stairs', platformIds: stairs.platformIds }))];
  for (const info of passengerInformation) info.configureTransfers(transferConnections);
  const passengerDisplays = trains.map((nextTrain, index) => attachPassengerDisplays(nextTrain, passengerInformation[index], nextTrain.materials));
  const lighting = new Lighting(scene, materials);
  // Preserve full hardware shadows; software WebGL gets a bounded depth target.
  if (softwareGraphics) lighting.keyLight.shadow.mapSize.set(1024, 1024);
  // Replace the constructor's original-position fixture with the actual graph pose.
  lighting.children.find(group => group.userData.platformId === 'station-1:U1')?.removeFromParent();
  for (const nextStation of stations) {
    const position = nextStation.getWorldPosition(new THREE.Vector3());
    const matrix = nextStation.matrixWorld.elements;
    lighting.addStationFixtures(position.z, {
      cool: nextStation.stationId === 'station-2', pointLights: nextStation === station ? 4 : 2,
      ...nextStation.lightingOptions,
      offsetX: position.x, offsetY: position.y, rotationY: Math.atan2(matrix[8], matrix[10]),
      platformId: nextStation.platformId,
    });
  }
  lighting.currentPlatformId = null;
  lighting.addStationFixtures(0, {
    platformId: 'central-stairs', fixtures: false,
    pointDefinitions: [
      { position: [-7.4, 1.9, -288], color: '#f5e4c7', intensity: 52, distance: 9 },
      { position: [-4.2, -1.8, -288], color: '#e7edf1', intensity: 52, distance: 9 },
      { position: [-7.4, -5.2, -288], color: '#f5e4c7', intensity: 52, distance: 9 },
      { position: [-4.2, -8.8, -287], color: '#e7edf1', intensity: 52, distance: 9 },
    ],
  });
  for (const transfer of networkTransfers) lighting.addStationFixtures(0, {
    platformId: transfer.name, fixtures: false, pointDefinitions: transfer.lightDefinitions,
  });
  scene.add(...trains, lighting, routeWorld, u2World, lowerWorld, verticalInterchange, ...networkTransfers,
    ...Object.entries(lineWorlds).filter(([id]) => ['U5', 'U6'].includes(id)).map(([, root]) => root));
  const world = {
    scene, renderer, camera, station, stations, train, route, network, routeWorld, service,
    routes, services, trains, passengerInformation, passengerDisplays, u2World, lowerWorld, verticalInterchange,
    lineWorlds, interchanges, networkTransfers, pedestrianTransfers,
    lighting, resize, environment, viewport, quality: { softwareGraphics, shadowSize: softwareGraphics ? 1024 : 2048 }, onResize: null,
  };
  const handleResize = () => { if (resize()) world.onResize?.(); };
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);
  window.addEventListener('resize', handleResize);
  world.disposeResize = () => { resizeObserver.disconnect(); window.removeEventListener('resize', handleResize); };
  return world;
}
