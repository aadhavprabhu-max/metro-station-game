import * as THREE from 'three';
import { box, cylinder, label } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';

/** Central's stairs occupy a dedicated shaft beyond the platform end slabs. */
export class VerticalInterchange extends THREE.Group {
  constructor(materials, upperStation, lowerStation) {
    super();
    this.name = 'CentralVerticalInterchange';
    this.stationId = upperStation.stationId;
    this.platforms = [upperStation, lowerStation];
    this.platformIds = this.platforms.map(station => station.platformId);
    const upper = upperStation.getWorldPosition(new THREE.Vector3());
    const lower = lowerStation.getWorldPosition(new THREE.Vector3());
    this.upperY = upper.y;
    this.lowerY = lower.y;
    this.surfaces = [];
    this.worldBounds = { minX: -8.8, maxX: -2.8, minZ: -292.5, maxZ: -282.4, minY: lower.y, maxY: upper.y + 3.35 };
    this.pointLights = [];
    this.buildSurfaces();
    this.buildStructure(materials);
    this.buildSteps(materials);
    this.buildWayfinding(materials);
    batchStaticGeometry(this);
  }

  flat(id, bounds, floorY, kind = 'landing', edges = {}) {
    this.surfaces.push({ id, kind, ...bounds, floorY, edges, heightAt: () => floorY });
  }

  buildSurfaces() {
    const width = { minX: -8.8, maxX: -2.8 };
    const entry = { ...width, minZ: -285.3, maxZ: -282.4 };
    // Ends joining another floor stay open; radius is applied at actual edges.
    this.flat('upper-entry', entry, this.upperY, 'entry', { minZ: false, maxZ: false });
    this.flat('lower-entry', entry, this.lowerY, 'entry', { minZ: false, maxZ: false });
    const drop = (this.upperY - this.lowerY) / 4;
    for (let flight = 0; flight < 4; flight++) {
      const left = flight % 2 === 0;
      const startZ = left ? -285 : -291;
      const endZ = left ? -291 : -285;
      const startY = this.upperY - flight * drop;
      const endY = startY - drop;
      this.surfaces.push({
        id: `flight-${flight + 1}`, kind: 'stairs', flight,
        minX: left ? -8.8 : -5.5, maxX: left ? -6.1 : -2.8,
        minZ: -291, maxZ: -285, startZ, endZ, startY, endY,
        edges: { minZ: false, maxZ: false },
        heightAt: (_x, z) => THREE.MathUtils.lerp(startY, endY, THREE.MathUtils.clamp((z - startZ) / (endZ - startZ), 0, 1)),
      });
    }
    // Entry overlaps the first/last tread by 30 cm. Follow the adjacent ramp
    // there so walking onto a flight does not create a sudden height step.
    const firstFlight = this.surfaces.find(surface => surface.id === 'flight-1');
    const lastFlight = this.surfaces.find(surface => surface.id === 'flight-4');
    this.surfaces.find(surface => surface.id === 'upper-entry').heightAt = (x, z) =>
      x <= firstFlight.maxX && z < -285 ? firstFlight.heightAt(x, z) : this.upperY;
    this.surfaces.find(surface => surface.id === 'lower-entry').heightAt = (x, z) =>
      x >= lastFlight.minX && z < -285 ? lastFlight.heightAt(x, z) : this.lowerY;
    this.flat('far-landing-1', { ...width, minZ: -292.5, maxZ: -291 }, this.upperY - drop, 'landing', { maxZ: false });
    this.flat('middle-landing', { ...width, minZ: -285, maxZ: -283.5 }, this.upperY - 2 * drop, 'landing', { minZ: false });
    this.flat('far-landing-2', { ...width, minZ: -292.5, maxZ: -291 }, this.upperY - 3 * drop, 'landing', { maxZ: false });
    this.flat('bottom-landing', { ...width, minZ: -285, maxZ: -283.5 }, this.lowerY, 'landing', { minZ: false, maxZ: false });
  }

  findSurface(x, z, feetY, maxStep = 0.45, radius = 0) {
    let best = null;
    for (const surface of this.surfaces) {
      const inset = edge => surface.edges?.[edge] === false ? 0 : radius;
      if (x < surface.minX + inset('minX') || x > surface.maxX - inset('maxX')
        || z < surface.minZ + inset('minZ') || z > surface.maxZ - inset('maxZ')) continue;
      const floorY = surface.heightAt(x, z);
      const difference = Math.abs(floorY - feetY);
      if (difference > maxStep + 0.000001 || (best && difference >= best.difference)) continue;
      best = { surface, id: surface.id, kind: surface.kind, floorY, difference, transfer: this };
    }
    return best;
  }

  contains(position, eyeHeight = 1.76) {
    return Boolean(this.findSurface(position.x, position.z, position.y - eyeHeight));
  }

  beamBetween(parent, material, from, to, radius = 0.025) {
    const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const beam = cylinder(parent, material, radius, direction.length(), start.add(end).multiplyScalar(0.5).toArray());
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return beam;
  }

  buildStructure(m) {
    const shaftHeight = this.upperY - this.lowerY + 3.35;
    const middleY = (this.lowerY + this.upperY + 3.35) / 2;
    for (const x of [-8.94, -2.66]) box(this, m.wallTile, [0.28, shaftHeight, 9], [x, middleY, -288.15]);
    box(this, m.wall, [6.55, shaftHeight, 0.25], [-5.8, middleY, -292.63]);
    box(this, m.concrete, [6.55, 0.25, 9.5], [-5.8, this.upperY + 3.35, -288]);
    // A retaining wall between the two entrance openings; neither level's
    // passenger doorway is covered by it.
    const retainingBottom = this.lowerY + 3.1;
    const retainingTop = this.upperY - 0.2;
    box(this, m.concrete, [6.25, retainingTop - retainingBottom, 0.22], [-5.8, (retainingTop + retainingBottom) / 2, -283.38]);
    for (const x of [-9.1, -2.5]) for (const z of [-292.45, -284.15]) {
      box(this, m.beam, [0.25, shaftHeight, 0.25], [x, middleY, z]);
    }
    // Entry floors extend only beyond the old tiles. Their walkable surface
    // continues across the existing slab through each new doorway.
    for (const y of [this.upperY, this.lowerY]) {
      box(this, m.concrete, [6, 0.16, 1.25], [-5.8, y - 0.08, -284.375]);
      box(this, m.tile, [6, 0.016, 1.25], [-5.8, y - 0.008, -284.375]);
      const x = y === this.upperY ? -4.45 : -7.15;
      box(this, m.concrete, [3.3, 0.16, 0.3], [x, y - 0.08, -285.15]);
      box(this, m.tile, [3.3, 0.016, 0.3], [x, y - 0.008, -285.15]);
    }
    for (const surface of this.surfaces.filter(item => item.kind === 'landing' && item.id !== 'bottom-landing')) {
      const width = surface.maxX - surface.minX, depth = surface.maxZ - surface.minZ;
      const x = (surface.minX + surface.maxX) / 2, z = (surface.minZ + surface.maxZ) / 2;
      box(this, m.concrete, [width, 0.16, depth], [x, surface.floorY - 0.08, z]);
      box(this, m.tile, [width, 0.015, depth], [x, surface.floorY - 0.0075, z]);
      const outsideZ = surface.id === 'middle-landing' ? surface.maxZ : surface.minZ;
      this.beamBetween(this, m.steel, [surface.minX + 0.06, surface.floorY + 0.94, outsideZ], [surface.maxX - 0.06, surface.floorY + 0.94, outsideZ]);
      for (const xSide of [surface.minX + 0.06, surface.maxX - 0.06]) {
        this.beamBetween(this, m.steel, [xSide, surface.floorY + 0.94, surface.minZ], [xSide, surface.floorY + 0.94, surface.maxZ]);
        cylinder(this, m.steel, 0.023, 0.94, [xSide, surface.floorY + 0.47, outsideZ]);
      }
    }
    for (const [y, z] of [[this.upperY + 2.8, -285.7], [this.lowerY + 2.8, -285.7], [this.upperY - 3.4, -291.6]]) {
      box(this, m.dark, [3.1, 0.09, 0.22], [-5.8, y, z], { shadow: false });
      box(this, m.tubeLight, [2.9, 0.026, 0.15], [-5.8, y - 0.06, z], { shadow: false });
    }
  }

  buildSteps(m) {
    for (const flight of this.surfaces.filter(surface => surface.kind === 'stairs')) {
      const count = 16, tread = 6 / count, rise = (flight.startY - flight.endY) / count;
      const direction = Math.sign(flight.endZ - flight.startZ);
      const centerX = (flight.minX + flight.maxX) / 2;
      for (let step = 0; step < count; step++) {
        const z = flight.startZ + direction * (step + 0.5) * tread;
        const y = flight.startY - (step + 1) * rise;
        box(this, m.concrete, [flight.maxX - flight.minX, rise + 0.1, tread + 0.008], [centerX, y - (rise + 0.1) / 2, z]);
        box(this, m.steel, [flight.maxX - flight.minX - 0.12, 0.012, 0.028], [centerX, y + 0.006, z - direction * tread / 2], { shadow: false });
      }
      for (const x of [flight.minX + 0.06, flight.maxX - 0.06]) {
        this.beamBetween(this, m.steel, [x, flight.startY + 0.95, flight.startZ], [x, flight.endY + 0.95, flight.endZ], 0.03);
        for (let post = 0; post <= 4; post++) {
          const fraction = post / 4;
          const z = THREE.MathUtils.lerp(flight.startZ, flight.endZ, fraction);
          const y = THREE.MathUtils.lerp(flight.startY, flight.endY, fraction);
          cylinder(this, m.steel, 0.021, 0.95, [x, y + 0.475, z]);
        }
      }
    }
    // Guard the unconnected half of the upper entrance. It cannot lead into
    // a flight six metres below its floor.
    this.beamBetween(this, m.steel, [-5.45, this.upperY + 0.95, -285.25], [-2.86, this.upperY + 0.95, -285.25], 0.03);
    for (const x of [-5.45, -2.86]) cylinder(this, m.steel, 0.023, 0.95, [x, this.upperY + 0.475, -285.25]);
    this.beamBetween(this, m.steel, [-8.74, this.lowerY + 0.95, -285.25], [-6.15, this.lowerY + 0.95, -285.25], 0.03);
    for (const x of [-8.74, -6.15]) cylinder(this, m.steel, 0.023, 0.95, [x, this.lowerY + 0.475, -285.25]);
  }

  buildWayfinding(m) {
    for (const floorY of [this.upperY, this.lowerY]) {
      for (const x of [-7.8, -3.8]) {
        cylinder(this, m.steel, 0.012, 0.18, [x, floorY + 2.96, -283.9], [0, 0, 0], 6);
      }
    }
    label(this, 'U3  U4  ↓  LOWER LEVEL', 5.2, 0.43, [-5.8, this.upperY + 2.65, -283.9], { background: '#255c66', fontSize: 70 });
    label(this, 'U1  U2  ↑  UPPER LEVEL', 5.2, 0.43, [-5.8, this.lowerY + 2.65, -283.9], { background: '#88543e', fontSize: 70 });
    label(this, 'CENTRAL  •  TRANSFER STAIRS', 4.2, 0.3, [-5.8, this.upperY + 1.6, -292.485], { background: '#334d49', fontSize: 68 });
    label(this, 'U3  U4  ↓', 1.65, 0.42, [-7.45, this.upperY + 0.026, -284.3], { background: '#b7c2bd', color: '#245a61', fontSize: 108, rotation: [-Math.PI / 2, 0, 0] });
    label(this, 'U1  U2  ↑', 1.65, 0.42, [-4.15, this.lowerY + 0.026, -284.3], { background: '#b7c2bd', color: '#82543b', fontSize: 108, rotation: [-Math.PI / 2, 0, Math.PI] });
  }
}
