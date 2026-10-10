import * as THREE from 'three';
import { box, canvasTexture } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

const DEFAULT_SLOTS = Object.freeze([
  { position: [0, 2.43, -3.9], width: 2.1, height: 0.55 },
  { position: [0, 2.43, 3.9], width: 2.1, height: 0.55 },
]);

function fitText(ctx, text, x, y, maxWidth, size, weight = 500, minSize = 20) {
  let current = size;
  ctx.font = `${weight} ${current}px Arial, sans-serif`;
  while (ctx.measureText(text).width > maxWidth && current > minSize) ctx.font = `${weight} ${--current}px Arial, sans-serif`;
  ctx.fillText(text, x, y, maxWidth);
}

function stopName(stop) { return stop?.displayName ?? stop?.name ?? ''; }

function connections(stop, ownLine) {
  return (stop?.interchanges ?? []).filter(link => link.lineId !== ownLine && link.implemented === true && ['passage', 'stairs'].includes(link.connection));
}

function transferText(stop, ownLine) {
  return connections(stop, ownLine).map(link => `${link.lineId} · ${link.platformNumber}${link.level ? ' ' + link.level : ''}`).join('  /  ');
}

function displayedDoorSide(data) {
  const arrival = data.atStation && ['open', 'opening'].includes(data.doorState) && data.arrivalDoorSide;
  const side = arrival ? data.arrivalDoorSide : data.doorSide;
  return side ? { side, reference: arrival ? 'arrival direction' : 'direction of travel' } : null;
}

function drawNextStop(ctx, data) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#164d82'; ctx.fillRect(0, 0, 1024, 560);
  ctx.fillStyle = '#edf5ff'; ctx.font = '600 24px Arial'; ctx.fillText('AUREALIS-BAHN', 28, 44);
  ctx.fillStyle = data.color ?? '#476f91'; ctx.beginPath(); ctx.roundRect(882, 18, 113, 61, 9); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px Arial'; ctx.fillText(data.lineId, 909, 61);
  ctx.fillStyle = '#79a1c0'; ctx.fillRect(28, 93, 968, 2);
  const headlineStop = data.atStation ? data.currentStation : data.nextStation;
  ctx.fillStyle = '#c2def1'; ctx.font = '500 29px Arial'; ctx.fillText(data.atStation ? 'AT STATION' : 'NEXT STATION', 28, 141);
  ctx.fillStyle = '#ffffff'; fitText(ctx, stopName(headlineStop), 28, 218, 968, 66, 600, 40);
  ctx.fillStyle = '#e6f0f9';
  const secondary = data.atStation ? data.nextStation : data.followingStation;
  fitText(ctx, secondary ? `${data.atStation ? 'Next' : 'Then'}: ${stopName(secondary)}` : 'End of this journey', 28, 286, 968, 32);
  const transfers = transferText(headlineStop, data.lineId);
  ctx.fillStyle = '#c8e3f1';
  fitText(ctx, transfers ? `Change: ${transfers}` : data.atStation && data.followingStation ? `Then: ${stopName(data.followingStation)}` : data.directionName, 28, 335, 968, transfers ? 27 : 28);
  ctx.fillStyle = '#0d345a'; ctx.fillRect(0, 370, 1024, 114);
  ctx.fillStyle = '#ffffff'; fitText(ctx, `→  ${stopName(data.terminus)}`, 28, 417, 968, 35, 600, 24);
  ctx.fillStyle = '#bdd9ea'; fitText(ctx, `${data.directionName}  ·  ${data.lineId}`, 28, 463, 968, 24);
  const door = displayedDoorSide(data);
  const state = String(data.doorState ?? 'closed');
  ctx.fillStyle = ['open', 'opening'].includes(state) ? '#aee4c5' : state === 'closing' ? '#f2ce86' : '#d0e2ed';
  const doorText = door ? `Doors ${door.side} · ${state} · ${door.reference}` : `Doors ${state}`;
  fitText(ctx, doorText, 28, 530, 968, 25, 500, 20);
}

function drawRouteMap(ctx, data, progressBucket) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#102d46'; ctx.fillRect(0, 0, 1024, 560);
  ctx.fillStyle = data.color ?? '#476f91'; ctx.beginPath(); ctx.roundRect(24, 20, 83, 45, 7); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 27px Arial'; ctx.fillText(data.lineId, 43, 52);
  ctx.fillStyle = '#dae9f2'; fitText(ctx, `→ ${stopName(data.terminus)}`, 127, 50, 870, 25, 600);
  ctx.fillStyle = '#84aac1'; ctx.font = '18px Arial'; ctx.fillText('AUREALIS-BAHN · YOUR JOURNEY', 25, 86);
  const stops = data.direction < 0 ? [...data.orderedStops].reverse() : data.orderedStops;
  const spacing = stops.length > 1 ? Math.min(112, 365 / (stops.length - 1)) : 112;
  const firstY = 138;
  ctx.strokeStyle = '#59748b'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(56, firstY); ctx.lineTo(56, firstY + spacing * (stops.length - 1)); ctx.stroke();
  stops.forEach((stop, index) => {
    const y = firstY + index * spacing;
    const status = stop.status;
    const colors = { passed: '#71899a', current: '#f1d387', next: '#9ddbf6', upcoming: '#d9e9f3' };
    const labels = { passed: 'Passed', current: 'Here', next: 'Next', upcoming: 'Ahead' };
    const color = colors[status] ?? '#d9e9f3';
    ctx.fillStyle = '#102d46'; ctx.beginPath(); ctx.arc(56, y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(56, y, status === 'current' || status === 'next' ? 13 : 9, 0, Math.PI * 2); ctx.stroke();
    if (status === 'current') { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(56, y, 6, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = color; fitText(ctx, stopName(stop), 103, y + 4, 895, 34, status === 'current' || status === 'next' ? 600 : 500, 24);
    const transfers = transferText(stop, data.lineId);
    ctx.fillStyle = status === 'passed' ? '#7893a4' : '#b9d3e2';
    fitText(ctx, `${labels[status] ?? ''}${transfers ? `  ·  ${transfers}` : ''}`, 103, y + 35, 895, transfers ? 19 : 23, 500, 16);
  });
  if (!data.atStation) {
    const from = stops.findIndex(stop => stop.id === (data.leg?.from?.id ?? data.currentStation?.id));
    const to = stops.findIndex(stop => stop.id === (data.leg?.to?.id ?? data.nextStation?.id));
    if (from >= 0 && to >= 0) {
      const y = firstY + spacing * (from + (to - from) * progressBucket / 20);
      ctx.fillStyle = '#f5cf79'; ctx.beginPath(); ctx.roundRect(42, y - 18, 28, 36, 5); ctx.fill();
      ctx.fillStyle = '#16354c'; ctx.fillRect(47, y - 10, 18, 11);
      ctx.fillRect(47, y + 5, 5, 5); ctx.fillRect(60, y + 5, 5, 5);
    }
  }
  const side = displayedDoorSide(data);
  ctx.fillStyle = '#96b6c9';
  fitText(ctx, `${data.directionName}${side ? `  ·  Doors ${side.side} (${side.reference})` : ''}`, 25, 545, 973, 19);
}

/** Reusable, two-sided screens for all carriages, driven only by route data. */
export class PassengerDisplays {
  constructor(train, information, materials) {
    if (!information?.snapshot || !Array.isArray(information.snapshot.orderedStops)) throw new Error('Passenger displays need authoritative passenger information.');
    this.train = train;
    this.information = information;
    this.screens = [];
    this.maps = [];
    this.mounts = [];
    this.redraws = 0;
    this.lastKey = '';
    this.lastRevisionKey = '';
    this.lastProgressBucket = -1;
    this.mainRedraws = 0;
    this.mapRedraws = 0;
    this.data = null;
    this.disposed = false;
    this.textures = {
      nextStop: canvasTexture(1024, 560, () => {}),
      routeMap: canvasTexture(1024, 560, () => {}),
    };
    this.materials = {
      nextStop: new THREE.MeshBasicMaterial({ map: this.textures.nextStop, toneMapped: false }),
      routeMap: new THREE.MeshBasicMaterial({ map: this.textures.routeMap, toneMapped: false }),
    };
    this.planeGeometry = new THREE.PlaneGeometry(1, 1);
    for (const car of train.cars) {
      const slots = car.userData.interiorLayout?.screenSlots ?? DEFAULT_SLOTS;
      for (const slot of slots) this.buildMount(car, slot, materials);
      car.passengerDisplays = this.screens.filter(mesh => mesh.userData.carNumber === car.carNumber);
      car.passengerMaps = this.maps.filter(mesh => mesh.userData.carNumber === car.carNumber);
      car.userData.passengerDisplays = { screens: car.passengerDisplays.length, maps: car.passengerMaps.length, sharedTextures: true };
    }
    this.update();
  }

  buildMount(car, slot, materials) {
    const mount = new THREE.Group();
    mount.name = 'PassengerScreenPair'; mount.userData.dynamic = true;
    mount.position.set(...slot.position);
    const width = slot.width ?? 2.1, height = slot.height ?? 0.55;
    box(mount, materials.trainSilver ?? materials.aluminum, [width + 0.075, height + 0.035, 0.12], [0, 0, 0], { shadow: false });
    box(mount, materials.cabCharcoal ?? materials.dark, [width + 0.008, height, 0.142], [0, 0, 0], { shadow: false });
    box(mount, materials.trainSilver ?? materials.aluminum, [0.04, height + 0.018, 0.152], [0, 0, 0], { shadow: false });
    for (const x of [-0.76, 0.76]) box(mount, materials.steel, [0.045, 0.065, 0.075], [x, height / 2 + 0.025, 0], { shadow: false });
    for (const face of [-1, 1]) for (const type of ['nextStop', 'routeMap']) {
      const mesh = new THREE.Mesh(this.planeGeometry, this.materials[type]);
      mesh.name = type === 'nextStop' ? 'PassengerNextStopDisplay' : 'PassengerRouteMap';
      mesh.position.set((type === 'nextStop' ? -face : face) * width / 4, 0, face * 0.08);
      mesh.scale.set(width / 2 - 0.035, height, 1);
      mesh.rotation.y = face > 0 ? 0 : Math.PI;
      mesh.userData = { dynamic: true, kind: type, lineId: this.train.lineId, carNumber: car.carNumber, faceDirection: face };
      mount.add(mesh);
      (type === 'nextStop' ? this.screens : this.maps).push(mesh);
    }
    batchStaticGeometry(mount);
    car.add(mount); this.mounts.push(mount);
  }

  update() {
    if (this.disposed) return false;
    const data = this.information.snapshot;
    this.data = data;
    const progressBucket = data.atStation ? -1 : Math.max(0, Math.min(20, Math.round((data.leg?.progress ?? 0) * 20)));
    const revisionKey = Number.isFinite(data.revision) ? `${data.sessionId ?? ''}:${data.revision}` : '';
    if (revisionKey && revisionKey === this.lastRevisionKey && progressBucket === this.lastProgressBucket) return false;
    const key = JSON.stringify({
      lineId: data.lineId, color: data.color, direction: data.direction, directionName: data.directionName,
      current: data.currentStation?.id, next: data.nextStation?.id, following: data.followingStation?.id,
      terminus: data.terminus?.id, atStation: data.atStation, state: data.state,
      doorState: data.doorState, doorSide: data.doorSide, arrivalDoorSide: data.arrivalDoorSide,
      stops: data.orderedStops.map(stop => [stop.id, stop.name, stop.status, stop.interchanges]),
    });
    this.lastRevisionKey = revisionKey;
    const contentChanged = key !== this.lastKey;
    if (!contentChanged && progressBucket === this.lastProgressBucket) return false;
    if (contentChanged) {
      drawNextStop(this.textures.nextStop.image.getContext('2d'), data);
      this.textures.nextStop.needsUpdate = true;
      this.mainRedraws++;
    }
    drawRouteMap(this.textures.routeMap.image.getContext('2d'), data, progressBucket);
    this.textures.routeMap.needsUpdate = true;
    this.mapRedraws++;
    this.lastProgressBucket = progressBucket;
    this.lastKey = key;
    this.redraws++;
    for (const mesh of [...this.screens, ...this.maps]) {
      Object.assign(mesh.userData, {
        lineId: data.lineId, currentStation: data.currentStation?.id,
        nextStation: data.nextStation?.id, destination: data.terminus?.id,
        direction: data.direction, doorState: data.doorState, doorSide: displayedDoorSide(data)?.side ?? null,
        positionProgress: data.leg?.progress ?? 0, positionBucket: progressBucket,
      });
    }
    return true;
  }

  snapshot() {
    return {
      lineId: this.data?.lineId,
      screenCount: this.screens.length, mapCount: this.maps.length,
      mountingCount: this.mounts.length, redraws: this.redraws,
      mainRedraws: this.mainRedraws, mapRedraws: this.mapRedraws, positionProgress: this.data?.leg?.progress ?? 0,
      nextStation: this.data?.nextStation?.name, currentStation: this.data?.currentStation?.name,
      destination: this.data?.terminus?.name, direction: this.data?.direction,
      route: this.data?.orderedStops.map(stop => ({ id: stop.id, name: stop.name, status: stop.status })),
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mount of this.mounts) {
      mount.traverse(mesh => {
        if (mesh.isMesh && mesh.geometry !== this.planeGeometry && mesh.name.startsWith('StaticBatch-')) mesh.geometry.dispose();
      });
      mount.removeFromParent();
    }
    this.planeGeometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    for (const texture of Object.values(this.textures)) texture.dispose();
  }
}

export function attachPassengerDisplays(train, information, materials) {
  return new PassengerDisplays(train, information, materials);
}
