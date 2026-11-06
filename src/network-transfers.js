import * as THREE from 'three';
import { box, instances, label } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

const WIDTH = 6;
const NEAR = 16;
const FAR = 22;
const LANDING_START = 14.5;
const LANDING_END = 23.5;
const BRIDGE_AT = 12.5;
const PORTAL_X = -5.8;
const CORRIDOR_HEIGHT = 3.3;
const UP = new THREE.Vector3(0, 1, 0);

function boundsFor(group, bounds) {
  group.updateWorldMatrix(true, false);
  const corners = [];
  for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) corners.push(group.localToWorld(new THREE.Vector3(x, 0, z)));
  return {
    minX: Math.min(...corners.map(p => p.x)), maxX: Math.max(...corners.map(p => p.x)),
    minZ: Math.min(...corners.map(p => p.z)), maxZ: Math.max(...corners.map(p => p.z)),
  };
}

function portalPose(station, end) {
  station.updateWorldMatrix(true, false);
  const position = station.localToWorld(new THREE.Vector3(PORTAL_X, 0, end));
  const outward = station.localToWorld(new THREE.Vector3(PORTAL_X, 0, end + Math.sign(end))).sub(position).normalize();
  return { position, yaw: Math.atan2(outward.x, outward.z) };
}

function rectangularBounds(from, to, width = 3.6) {
  if (Math.abs(from.x - to.x) < 0.0001) return {
    minX: from.x - width / 2, maxX: from.x + width / 2,
    minZ: Math.min(from.z, to.z) - width / 2, maxZ: Math.max(from.z, to.z) + width / 2,
  };
  if (Math.abs(from.z - to.z) < 0.0001) return {
    minX: Math.min(from.x, to.x) - width / 2, maxX: Math.max(from.x, to.x) + width / 2,
    minZ: from.z - width / 2, maxZ: from.z + width / 2,
  };
  throw new Error('A pedestrian corridor must be orthogonal.');
}

function contains(bounds, x, z, margin = 0) {
  return x >= bounds.minX - margin && x <= bounds.maxX + margin && z >= bounds.minZ - margin && z <= bounds.maxZ + margin;
}

/** Protected, physical stairs/corridors between two platforms of one shared node. */
export class NetworkTransfer extends THREE.Group {
  constructor(materials, upperStation, lowerStation, { upperEnd = 44, lowerEnd = 44, mezzanineOffset = 6 } = {}) {
    super();
    if (upperStation.stationId !== lowerStation.stationId) throw new Error('Transfer platforms must belong to the same network station.');
    this.name = `${upperStation.displayName}PhysicalTransfer`;
    this.stationId = upperStation.stationId;
    this.platforms = [upperStation, lowerStation];
    this.platformIds = this.platforms.map(station => station.platformId);
    this.surfaces = [];
    this.lightDefinitions = [];
    this.walkingPath = [];
    this.pointLights = [];
    const upper = portalPose(upperStation, upperEnd), lower = portalPose(lowerStation, lowerEnd);
    this.upperY = upper.position.y; this.lowerY = lower.position.y;
    this.floorY = this.lowerY;
    if (this.upperY - this.lowerY < 12 - 0.001) throw new Error('Network transfer requires at least twelve metres between railway levels.');
    const aligned = Math.hypot(upper.position.x - lower.position.x, upper.position.z - lower.position.z) < 0.001
      && Math.abs(Math.sin(upper.yaw - lower.yaw)) < 0.001 && Math.cos(upper.yaw - lower.yaw) > 0;
    this.mezzanineY = aligned ? null : this.lowerY + mezzanineOffset;
    this.towers = [];
    const mezzanineRectangles = [], mezzanineOpenings = [];
    if (aligned) {
      const tower = this.buildTower(materials, upper, this.upperY, this.lowerY, 'through');
      this.buildApproach(materials, tower.group, this.upperY, 0, LANDING_START, 'upper-entry');
      this.buildApproach(materials, tower.group, this.lowerY, 0, LANDING_START, 'lower-entry');
      this.walkingPath = [{ x: upper.position.x, y: upper.position.y, z: upper.position.z },
        ...tower.walkingPath, { x: lower.position.x, y: lower.position.y, z: lower.position.z }];
    } else {
      const first = this.buildTower(materials, upper, this.upperY, this.mezzanineY, 'upper');
      const second = this.buildTower(materials, lower, this.mezzanineY, this.lowerY, 'lower');
      this.buildApproach(materials, first.group, this.upperY, 0, LANDING_START, 'upper-entry');
      this.buildApproach(materials, second.group, this.lowerY, 0, LANDING_START, 'lower-entry');
      for (const tower of [first, second]) {
        const approach = { minX: -WIDTH / 2, maxX: WIDTH / 2, minZ: 10.5, maxZ: LANDING_START };
        mezzanineRectangles.push(boundsFor(tower.group, approach));
        mezzanineOpenings.push(boundsFor(tower.group, { minX: -3, maxX: 3, minZ: LANDING_START - 0.02, maxZ: LANDING_START + 0.02 }));
      }
      const start = first.group.localToWorld(new THREE.Vector3(0, 0, BRIDGE_AT));
      const end = second.group.localToWorld(new THREE.Vector3(0, 0, BRIDGE_AT));
      const bend = new THREE.Vector3(end.x, 0, start.z);
      if (start.distanceTo(new THREE.Vector3(bend.x, start.y, bend.z)) > 0.01) mezzanineRectangles.push(rectangularBounds(start, bend));
      if (Math.hypot(bend.x - end.x, bend.z - end.z) > 0.01) mezzanineRectangles.push(rectangularBounds(bend, end));
      this.buildCorridorUnion(materials, mezzanineRectangles, this.mezzanineY, mezzanineOpenings, 'protected-mezzanine');
      this.walkingPath = [{ x: upper.position.x, y: upper.position.y, z: upper.position.z }, ...first.walkingPath,
        { x: start.x, y: this.mezzanineY, z: start.z }, { x: bend.x, y: this.mezzanineY, z: bend.z }, { x: end.x, y: this.mezzanineY, z: end.z },
        ...second.walkingPath, { x: lower.position.x, y: lower.position.y, z: lower.position.z }];
      this.lightDefinitions.push({ position: [bend.x, this.mezzanineY + 2.7, bend.z], color: '#e4ece9', intensity: 55, distance: 15 });
    }
    this.buildWayfinding(materials, upper, lower);
    this.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(this);
    this.worldBounds = { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z,
      minY: this.lowerY, maxY: this.upperY + CORRIDOR_HEIGHT + 0.2 };
    this.userData.pedestrianTransfer = true;
    this.userData.railwayClearance = { mezzanineAboveLowerPlatform: this.mezzanineY === null ? null : 6, minimumLandingHeadroom: 3.1 };
    batchStaticGeometry(this);
  }

  addSurface(group, id, bounds, heightAt, options = {}) {
    group.updateWorldMatrix(true, false);
    const inverse = group.matrixWorld.clone().invert();
    const worldBounds = boundsFor(group, bounds);
    const local = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(inverse);
    // X/Z do not depend on the Y component for these upright cardinal transforms.
    const surface = {
      id, kind: options.kind ?? 'landing', ...worldBounds,
      floorY: options.floorY, edges: options.edges ?? {}, localBounds: { ...bounds },
      heightAt: (x, z) => { const point = local(x, z); return heightAt(point.x, point.z); },
      contains: (x, z, radius) => {
        const point = local(x, z), edges = options.edges ?? {};
        return point.x >= bounds.minX + (edges.minX === false ? 0 : radius) - 1e-7
          && point.x <= bounds.maxX - (edges.maxX === false ? 0 : radius) + 1e-7
          && point.z >= bounds.minZ + (edges.minZ === false ? 0 : radius) - 1e-7
          && point.z <= bounds.maxZ - (edges.maxZ === false ? 0 : radius) + 1e-7
          && (!options.localContains || options.localContains(point.x, point.z));
      },
      ...(options.flight === undefined ? {} : { flight: options.flight }),
    };
    this.surfaces.push(surface);
    return surface;
  }

  buildTower(m, pose, topY, bottomY, name) {
    const group = new THREE.Group();
    group.name = `${name}SwitchbackStairTower`;
    group.position.set(pose.position.x, 0, pose.position.z);
    group.rotation.y = pose.yaw;
    this.add(group); group.updateWorldMatrix(true, false);
    const totalDrop = topY - bottomY;
    let flights = Math.ceil(totalDrop / 3 - 1e-8);
    if (flights % 2) flights++;
    const drop = totalDrop / flights;
    const steps = [], nosings = [], rails = [], posts = [];
    const flightSurfaces = [];
    const walkingPath = [];
    const waypoint = (x, y, z) => {
      const p = group.localToWorld(new THREE.Vector3(x, y, z));
      walkingPath.push({ x: p.x, y: p.y, z: p.z });
    };
    for (let flight = 0; flight < flights; flight++) {
      const left = flight % 2 === 0;
      const startZ = left ? NEAR : FAR, endZ = left ? FAR : NEAR;
      const startY = topY - flight * drop, endY = topY - (flight + 1) * drop;
      const minX = left ? -3 : 0.3, maxX = left ? -0.3 : 3;
      const heightAt = (_x, z) => THREE.MathUtils.lerp(startY, endY, THREE.MathUtils.clamp((z - startZ) / (endZ - startZ), 0, 1));
      const surface = this.addSurface(group, `${name}-flight-${flight + 1}`, { minX, maxX, minZ: NEAR, maxZ: FAR }, heightAt,
        { kind: 'stairs', flight, edges: { minZ: false, maxZ: false } });
      Object.assign(surface, { startY, endY, startZ, endZ, localGroup: group });
      flightSurfaces.push({ surface, heightAt, minX, maxX, startZ, endZ, startY, endY });
      const middle = (minX + maxX) / 2;
      waypoint(middle, startY, left ? NEAR - 0.65 : FAR + 0.65);
      waypoint(middle, startY, startZ);
      waypoint(middle, endY, endZ);
      waypoint(middle, endY, left ? FAR + 0.65 : NEAR - 0.65);
      for (let step = 0; step < 16; step++) {
        const z = startZ + Math.sign(endZ - startZ) * (step + 0.5) * 0.375;
        const y = startY - (step + 1) * drop / 16;
        steps.push({ size: [maxX - minX, drop / 16 + 0.1, 0.382], position: [(minX + maxX) / 2, y - (drop / 16 + 0.1) / 2, z] });
        nosings.push({ size: [maxX - minX - 0.08, 0.012, 0.028], position: [(minX + maxX) / 2, y + 0.006, z - Math.sign(endZ - startZ) * 0.1875] });
      }
      for (const x of [minX - 0.025, maxX + 0.025]) {
        rails.push(this.member([x, startY + 1, startZ], [x, endY + 1, endZ], 0.03));
        for (let post = 0; post <= 4; post++) {
          const z = THREE.MathUtils.lerp(startZ, endZ, post / 4), y = heightAt(x, z);
          posts.push({ size: [0.025, 1, 0.025], position: [x, y + 0.5, z] });
        }
      }
    }
    for (let landing = 0; landing <= flights; landing++) {
      const y = topY - landing * drop;
      if (landing % 2) {
        const bounds = { minX: -3, maxX: 3, minZ: FAR, maxZ: LANDING_END };
        this.addSurface(group, `${name}-far-landing-${landing}`, bounds, () => y, { floorY: y, edges: { minZ: false } });
        this.floor(group, m, bounds, y);
        rails.push(this.member([-2.94, y + 1, LANDING_END - 0.06], [2.94, y + 1, LANDING_END - 0.06], 0.03));
      } else {
        const bounds = { minX: -3, maxX: 3, minZ: LANDING_START, maxZ: NEAR + 0.3 };
        const previous = landing > 0 ? flightSurfaces[landing - 1] : null;
        const next = landing < flights ? flightSurfaces[landing] : null;
        const heightAt = (x, z) => {
          if (z > NEAR && x < -0.3 && next) return next.heightAt(x, z);
          if (z > NEAR && x > 0.3 && previous) return previous.heightAt(x, z);
          return y;
        };
        this.addSurface(group, `${name}-near-landing-${landing}`, bounds, heightAt, { floorY: y, edges: { minZ: false, maxZ: false },
          localContains: (x, z) => z <= NEAR || (x < -0.3 && Boolean(next)) || (x > 0.3 && Boolean(previous)) });
        this.floor(group, m, { ...bounds, maxZ: NEAR }, y);
        if (landing > 0 && landing < flights) rails.push(this.member([-2.94, y + 1, LANDING_START + 0.06], [2.94, y + 1, LANDING_START + 0.06], 0.03));
        // Protect the unconnected lane where a flight exists six metres away.
        if (landing === 0) rails.push(this.member([0.32, y + 1, NEAR], [2.94, y + 1, NEAR], 0.03));
        if (landing === flights) rails.push(this.member([-2.94, y + 1, NEAR], [-0.32, y + 1, NEAR], 0.03));
      }
      if (landing % 2 === 0) {
        const at = group.localToWorld(new THREE.Vector3(0, y + 2.7, LANDING_START + 0.65));
        this.lightDefinitions.push({ position: at.toArray(), color: '#efe8d9', intensity: 48, distance: 12 });
        box(group, m.dark, [3.2, 0.08, 0.2], [0, y + 3.18, LANDING_START + 0.65], { shadow: false });
        box(group, m.tubeLight, [3, 0.022, 0.12], [0, y + 3.125, LANDING_START + 0.65], { shadow: false });
      }
    }
    instances(group, m.concrete, steps).name = 'PhysicalStairTreads';
    instances(group, m.steel, nosings, undefined, false).name = 'StairSafetyNosings';
    instances(group, m.steel, rails).name = 'ContinuousStairHandrails';
    instances(group, m.steel, posts).name = 'StairHandrailPosts';
    const height = topY - bottomY + CORRIDOR_HEIGHT;
    for (const x of [-3.13, 3.13]) box(group, m.wallTile, [0.22, height, LANDING_END - LANDING_START + 0.3], [x, bottomY + height / 2, (LANDING_START + LANDING_END) / 2]);
    box(group, m.wall, [6.45, height, 0.22], [0, bottomY + height / 2, LANDING_END + 0.13]);
    box(group, m.concrete, [6.45, 0.18, LANDING_END - LANDING_START + 0.3], [0, topY + CORRIDOR_HEIGHT + 0.09, (LANDING_START + LANDING_END) / 2]);
    const tower = { name, group, topY, bottomY, flights, drop, stepRise: drop / 16, tread: 0.375, walkingPath };
    this.towers.push(tower);
    return tower;
  }

  member(from, to, thickness) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    return { position: a.add(b).multiplyScalar(0.5).toArray(), size: [thickness, direction.length(), thickness],
      rotation: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize())).toArray().slice(0, 3) };
  }

  floor(parent, m, bounds, y) {
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    box(parent, m.concrete, [width, 0.18, depth], [(bounds.minX + bounds.maxX) / 2, y - 0.1, (bounds.minZ + bounds.maxZ) / 2]);
    box(parent, m.tile, [width, 0.02, depth], [(bounds.minX + bounds.maxX) / 2, y - 0.01, (bounds.minZ + bounds.maxZ) / 2]);
  }

  buildApproach(m, group, y, start, end, id) {
    const bounds = { minX: -3, maxX: 3, minZ: start, maxZ: end };
    this.addSurface(group, id, bounds, () => y, { floorY: y, kind: 'entry', edges: { minZ: false, maxZ: false } });
    this.floor(group, m, bounds, y);
    for (const x of [-3.12, 3.12]) box(group, m.wallTile, [0.2, CORRIDOR_HEIGHT, end - start], [x, y + CORRIDOR_HEIGHT / 2, (start + end) / 2]);
    box(group, m.concrete, [6.4, 0.18, end - start], [0, y + CORRIDOR_HEIGHT + 0.09, (start + end) / 2]);
    box(group, m.dark, [0.18, 0.08, end - start - 0.3], [0, y + 3.12, (start + end) / 2], { shadow: false });
    box(group, m.tubeLight, [0.1, 0.018, end - start - 0.4], [0, y + 3.07, (start + end) / 2], { shadow: false });
  }

  buildCorridorUnion(m, rectangles, y, openings, id) {
    const xs = [...new Set(rectangles.flatMap(r => [r.minX, r.maxX]).map(v => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
    const zs = [...new Set(rectangles.flatMap(r => [r.minZ, r.maxZ]).map(v => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
    const filled = (i, j) => i >= 0 && j >= 0 && i < xs.length - 1 && j < zs.length - 1
      && rectangles.some(r => contains(r, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2, 1e-6));
    const isOpening = (x, z) => openings.some(r => contains(r, x, z, 0.015));
    let cell = 0;
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      if (!filled(i, j)) continue;
      const bounds = { minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] };
      const centerX = (bounds.minX + bounds.maxX) / 2, centerZ = (bounds.minZ + bounds.maxZ) / 2;
      const edges = {
        minX: !filled(i - 1, j) && !isOpening(bounds.minX, centerZ),
        maxX: !filled(i + 1, j) && !isOpening(bounds.maxX, centerZ),
        minZ: !filled(i, j - 1) && !isOpening(centerX, bounds.minZ),
        maxZ: !filled(i, j + 1) && !isOpening(centerX, bounds.maxZ),
      };
      this.addSurface(this, `${id}-${cell++}`, bounds, () => y, { floorY: y, kind: 'passage', edges });
      this.floor(this, m, bounds, y);
      box(this, m.concrete, [bounds.maxX - bounds.minX, 0.16, bounds.maxZ - bounds.minZ], [centerX, y + CORRIDOR_HEIGHT + 0.08, centerZ]);
      for (const side of ['minX', 'maxX']) if (edges[side]) box(this, m.wallTile, [0.14, CORRIDOR_HEIGHT, bounds.maxZ - bounds.minZ], [bounds[side], y + CORRIDOR_HEIGHT / 2, centerZ]);
      for (const side of ['minZ', 'maxZ']) if (edges[side]) box(this, m.wallTile, [bounds.maxX - bounds.minX, CORRIDOR_HEIGHT, 0.14], [centerX, y + CORRIDOR_HEIGHT / 2, bounds[side]]);
      if (bounds.maxX - bounds.minX > 1 && bounds.maxZ - bounds.minZ > 1) {
        box(this, m.dark, [0.16, 0.07, Math.max(0.4, bounds.maxZ - bounds.minZ - 0.2)], [centerX, y + 3.12, centerZ], { shadow: false });
        box(this, m.tubeLight, [0.09, 0.018, Math.max(0.3, bounds.maxZ - bounds.minZ - 0.3)], [centerX, y + 3.07, centerZ], { shadow: false });
      }
    }
  }

  buildWayfinding(m, upper, lower) {
    for (const [station, pose, destination, symbol] of [
      [this.platforms[0], upper, this.platforms[1], '↓'], [this.platforms[1], lower, this.platforms[0], '↑'],
    ]) {
      const group = new THREE.Group(); group.position.copy(pose.position); group.rotation.y = pose.yaw; this.add(group);
      label(group, `${destination.lineId}  ${symbol}  PLATFORM ${destination.platformNumber}`, 4.8, 0.26, [0, 3.15, 2.5], { rotation: [0, Math.PI, 0], background: station.options.signageColor, fontSize: 77 });
      label(group, `${station.displayName.toUpperCase()}  /  TRANSFER`, 4.8, 0.26, [0, 3.15, 13.9], { rotation: [0, Math.PI, 0], background: '#354a43', fontSize: 66 });
      box(group, m.structure ?? m.steel, [5.1, 0.09, 0.12], [0, 3.22, 2.5]);
    }
  }

  findSurface(x, z, feetY, maxStep = 0.45, radius = 0) {
    let best = null;
    for (const surface of this.surfaces) {
      if (!surface.contains(x, z, radius)) continue;
      const floorY = surface.heightAt(x, z), difference = Math.abs(floorY - feetY);
      if (difference > maxStep + 1e-6 || (best && difference >= best.difference)) continue;
      best = { surface, id: surface.id, kind: surface.kind, floorY, difference, transfer: this };
    }
    return best;
  }

  contains(position, eyeHeight = 1.76) {
    return Boolean(this.findSurface(position.x, position.z, position.y - eyeHeight));
  }
}
