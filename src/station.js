import * as THREE from 'three';
import { box, cylinder, instances, label, seededRandom } from './geometry.js';
import { DeparturesBoard } from './departures.js';
import { batchStaticGeometry } from './optimize.js';

export class Platform extends THREE.Group {
  constructor(m) {
    super();
    this.name = 'Platform';
    box(this, m.concrete, [10, 0.95, 88], [-5, -0.525, 0]);
    box(this, m.grout, [9.95, 0.02, 87.9], [-5, -0.04, 0]);
    const random = seededRandom(71);
    const tiles = [];
    for (let x = -9.7; x < -0.2; x += 0.6) {
      for (let z = -43.5; z < 44; z += 0.6) {
        const value = 0.89 + random() * 0.13;
        tiles.push({ size: [0.594, 0.035, 0.594], position: [x, -0.0175, z], color: new THREE.Color(value, value, value * 0.96) });
      }
    }
    instances(this, m.tile, tiles);
    box(this, m.concrete, [0.34, 0.12, 88], [-0.17, -0.03, 0]);
    box(this, m.yellow, [0.08, 0.006, 87.8], [-0.55, 0.004, 0], { shadow: false });
    box(this, m.yellow, [0.29, 0.013, 87.8], [-0.31, 0.01, 0], { shadow: false });
    const studs = [];
    for (let z = -43.6; z < 43.8; z += 0.18) {
      for (const x of [-0.23, -0.34, -0.45]) studs.push({ size: [0.035, 0.015, 0.075], position: [x, 0.025, z] });
    }
    instances(this, m.yellow, studs, undefined, false);
    for (const z of [-30, -12, 6, 24, 39]) {
      label(this, 'MIND THE GAP', 2.5, 0.23, [-1.0, 0.009, z], { background: '#bdbfb2', color: '#575f52', rotation: [-Math.PI / 2, 0, Math.PI / 2], fontSize: 68 });
    }
    // Across the track: a narrow service ledge, never part of the player's bounds.
    box(this, m.concrete, [2.62, 0.95, 88], [6.34, -0.51, 0]);
    box(this, m.yellow, [0.06, 0.007, 87.9], [5.15, -0.03, 0]);
  }
}

export class Track extends THREE.Group {
  constructor(m) {
    super();
    this.name = 'Track';
    box(this, m.trackBed, [4.98, 0.14, 100], [2.5, -1.37, 0]);
    const sleepers = [], clips = [];
    for (let z = -49; z < 49; z += 0.65) {
      sleepers.push({ size: [2.52, 0.14, 0.21], position: [1.57, -1.22, z] });
      for (const x of [1.57 - 0.7175, 1.57 + 0.7175]) {
        clips.push({ size: [0.2, 0.06, 0.12], position: [x, -1.12, z] });
      }
    }
    instances(this, m.sleeper, sleepers);
    instances(this, m.dark, clips);
    for (const x of [1.57 - 0.7175, 1.57 + 0.7175]) {
      box(this, m.steel, [0.15, 0.025, 100], [x, -1.1375, 0]);
      box(this, m.wheel, [0.035, 0.09, 100], [x, -1.09, 0]);
      box(this, m.steel, [0.073, 0.032, 100], [x, -1.04, 0]);
    }
    box(this, m.dark, [0.27, 0.14, 96], [4.44, -0.82, 0]);
    box(this, m.aluminum, [0.31, 0.03, 96], [4.44, -0.73, 0]);
    const thirdRailBrackets = [];
    for (let z = -46; z <= 46; z += 3) thirdRailBrackets.push({ size: [0.16, 0.32, 0.21], position: [4.44, -1.02, z] });
    instances(this, m.concrete, thirdRailBrackets);
  }
}

export class Station extends THREE.Group {
  constructor(materials, options = {}) {
    super();
    this.stationId = options.id ?? 'station-1';
    this.displayName = options.displayName ?? 'Nordplatz';
    this.destinationName = options.destinationName ?? 'Central';
    this.platformNumber = options.platformNumber ?? '01';
    this.lineId = options.lineId ?? 'U1';
    this.lineIds = [this.lineId];
    this.floorY = options.floorY ?? 0;
    this.level = options.level ?? (this.floorY < 0 ? 'lower' : 'upper');
    this.platformId = `${this.stationId}:${this.lineId}`;
    this.name = `${this.displayName}Station`;
    this.options = { northCap: true, southCap: true, signageColor: '#396057', ...options };
    this.colliders = [];
    this.bounds = { minX: -9.65, maxX: -0.68, minZ: -42.7, maxZ: 42.7 };
    this.walkableAreas = [this.bounds, ...(options.walkableAreas ?? [])];
    this.platform = new Platform(materials);
    this.track = new Track(materials);
    this.add(this.platform, this.track);
    this.buildArchitecture(materials);
    this.buildFurniture(materials);
    this.buildSignage(materials);
    this.departures = new DeparturesBoard(materials, { stationName: this.displayName });
    this.add(this.departures);
    batchStaticGeometry(this);
  }

  addCollider(x, z, width, depth) {
    this.colliders.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
  }

  buildArchitecture(m) {
    const opening = this.options.backwallOpening;
    if (opening) {
      const leftEdge = opening.z - opening.width / 2, rightEdge = opening.z + opening.width / 2;
      const height = opening.height ?? 3.05;
      for (const [start, end] of [[-45, leftEdge], [rightEdge, 45]]) {
        if (end > start) box(this, m.concrete, [0.35, 5.7, end - start], [-10.1, 2.77, (start + end) / 2]);
      }
      box(this, m.concrete, [0.35, 5.62 - height, opening.width], [-10.1, (height + 5.62) / 2, opening.z]);
    } else box(this, m.concrete, [0.35, 5.7, 90], [-10.1, 2.77, 0]);
    box(this, m.concrete, [0.4, 5.7, 90], [7.85, 2.77, 0]);
    box(this, m.concrete, [18.1, 0.3, 90], [-1.1, 5.53, 0]);
    // Open track portals anchor the ends of the platform.
    for (const z of [-44, 44]) {
      this.buildPlatformEndWall(m, z);
      box(this, m.wall, [2.9, 5.4, 0.4], [6.4, 2.7, z]);
      box(this, m.wall, [4.9, 1.5, 0.4], [2.45, 4.7, z]);
      const hasCap = z < 0 ? this.options.northCap : this.options.southCap;
      if (hasCap) box(this, m.rubber, [4.8, 5.1, 0.1], [2.45, 1.8, z + Math.sign(z) * 4], { shadow: false });
    }
    const panels = [], lowerPanels = [], crossBeams = [], ceilingSlats = [];
    for (let z = -42; z <= 42; z += 3) {
      for (const x of [-9.9, 7.62]) {
        const sections = this.wallPanelSections(x, z, 2.965);
        for (const section of sections) {
          panels.push({ size: [0.07, 2.44, section.depth], position: [x, 2.33, section.z] });
          lowerPanels.push({ size: [0.095, 1.11, section.depth], position: [x, 0.6, section.z] });
        }
        if (opening && x < 0 && Math.abs(z - opening.z) < (opening.width + 2.965) / 2) {
          const left = Math.max(z - 2.965 / 2, opening.z - opening.width / 2);
          const right = Math.min(z + 2.965 / 2, opening.z + opening.width / 2);
          const bottom = opening.height ?? 3.05;
          if (right > left && bottom < 3.55) panels.push({ size: [0.07, 3.55 - bottom, right - left], position: [x, (bottom + 3.55) / 2, (left + right) / 2] });
        }
      }
    }
    instances(this, m.wallTile, panels);
    instances(this, m.greenTile, lowerPanels);
    for (let z = -40; z <= 40; z += 8) crossBeams.push({ size: [17.65, 0.28, 0.32], position: [-1.12, 5.2, z] });
    instances(this, m.beam, crossBeams);
    for (let z = -44; z < 44; z += 0.36) ceilingSlats.push({ size: [17.65, 0.035, 0.045], position: [-1.1, 5.35, z] });
    instances(this, m.beam, ceilingSlats, undefined, false);
    for (const z of [-32, -16, 0, 16, 32]) {
      box(this, m.concrete, [0.62, 5.23, 0.72], [-8.3, 2.6, z]);
      box(this, m.steel, [0.67, 0.72, 0.77], [-8.3, 0.36, z]);
      box(this, m.greenTile, [0.64, 1.07, 0.74], [-8.3, 1.65, z]);
      label(this, this.platformNumber, 0.38, 0.22, [-7.97, 1.8, z], { rotation: [0, Math.PI / 2, 0], fontSize: 250, background: this.options.platformSignColor ?? '#496a60' });
      this.addCollider(-8.3, z, 0.67, 0.77);
    }
    // Cable trays, conduit, and ventilation stay close to the far wall.
    for (const y of [3.93, 4.09]) cylinder(this, m.dark, 0.032, 87, [7.49, y, 0], [Math.PI / 2, 0, 0]);
    box(this, m.aluminum, [0.32, 0.19, 87.7], [7.4, 4.43, 0]);
    const ventSlats = [];
    for (const z of [-33, -13, 10, 32]) {
      box(this, m.dark, [0.09, 0.48, 2.45], [7.53, 3.67, z]);
      for (let i = 0; i < 7; i++) ventSlats.push({ size: [0.07, 0.035, 2.33], position: [7.475, 3.46 + i * 0.065, z] });
    }
    instances(this, m.aluminum, ventSlats, undefined, false);
  }

  buildPlatformEndWall(m, z) {
    const opening = this.options.platformEndOpenings?.find(item => Math.abs(item.z - z) < 0.01);
    if (!opening) {
      box(this, m.wall, [10.1, 5.4, 0.4], [-5, 2.7, z]);
      return;
    }
    const height = opening.height ?? 3.05;
    for (const [start, end] of [[-10.05, opening.minX], [opening.maxX, 0.05]]) {
      if (end > start) box(this, m.wall, [end - start, 5.4, 0.4], [(start + end) / 2, 2.7, z]);
    }
    box(this, m.wall, [opening.maxX - opening.minX, 5.4 - height, 0.4], [(opening.minX + opening.maxX) / 2, (5.4 + height) / 2, z]);
  }

  wallPanelSections(x, z, depth) {
    const opening = this.options.backwallOpening;
    if (!opening || x > 0) return [{ z, depth }];
    const start = z - depth / 2, end = z + depth / 2;
    const gapStart = opening.z - opening.width / 2, gapEnd = opening.z + opening.width / 2;
    if (end <= gapStart || start >= gapEnd) return [{ z, depth }];
    const sections = [];
    if (start < gapStart) sections.push({ z: (start + gapStart) / 2, depth: gapStart - start });
    if (end > gapEnd) sections.push({ z: (gapEnd + end) / 2, depth: end - gapEnd });
    return sections;
  }

  buildFurniture(m) {
    for (const z of [-15, 3, 22]) {
      const bench = new THREE.Group();
      bench.position.set(-7.1, 0, z);
      this.add(bench);
      for (let i = 0; i < 5; i++) box(bench, m.wood, [0.1, 0.045, 2.45], [-0.22 + i * 0.115, 0.48, 0]);
      for (let i = 0; i < 3; i++) box(bench, m.wood, [0.065, 0.095, 2.45], [-0.27, 0.75 + i * 0.12, 0]);
      for (const end of [-0.85, 0.85]) {
        box(bench, m.dark, [0.39, 0.07, 0.08], [0, 0.085, end]);
        box(bench, m.steel, [0.055, 0.39, 0.055], [0.05, 0.27, end]);
        box(bench, m.steel, [0.055, 0.66, 0.055], [-0.28, 0.44, end]);
      }
      for (const z2 of [-1.19, 0, 1.19]) {
        box(bench, m.steel, [0.53, 0.04, 0.036], [0, 0.67, z2]);
        box(bench, m.steel, [0.034, 0.22, 0.036], [0.22, 0.57, z2]);
      }
      this.addCollider(-7.1, z, 0.63, 2.52);
    }
    for (const z of [-19, 7, 27]) {
      box(this, m.aluminum, [0.56, 0.96, 0.46], [-7.85, 0.48, z]);
      box(this, m.dark, [0.58, 0.08, 0.48], [-7.85, 1, z]);
      box(this, m.rubber, [0.016, 0.17, 0.33], [-7.56, 0.81, z]);
      label(this, 'RECYCLE', 0.26, 0.08, [-7.558, 0.55, z], { rotation: [0, Math.PI / 2, 0], background: '#9daaa4', color: '#294a3f', fontSize: 90 });
      this.addCollider(-7.85, z, 0.6, 0.5);
    }
    for (const z of [-37, 36]) {
      box(this, m.dark, [0.1, 2.3, 1.35], [-9.85, 1.15, z]);
      box(this, m.aluminum, [0.08, 2.13, 1.17], [-9.77, 1.07, z]);
      cylinder(this, m.steel, 0.015, 0.17, [-9.711, 1.05, z + 0.37]);
      label(this, 'STAFF ONLY', 0.51, 0.1, [-9.72, 1.66, z], { rotation: [0, Math.PI / 2, 0], color: '#2d4038', background: '#a8b4aa', fontSize: 100 });
      label(this, '←  EXIT', 1.07, 0.28, [-9.71, 2.53, z], { rotation: [0, Math.PI / 2, 0], background: '#3c6955', fontSize: 170 });
    }
    box(this, m.aluminum, [0.43, 1.69, 1.1], [-9.65, 0.845, 14]);
    box(this, m.dark, [0.013, 1.5, 0.01], [-9.425, 0.85, 14]);
    this.addCollider(-9.65, 14, 0.45, 1.14);
    label(this, '⚡  TECHNICAL', 0.6, 0.19, [-9.42, 1.23, 14], { rotation: [0, Math.PI / 2, 0], background: '#bac1b5', color: '#574d28', fontSize: 80 });
    const red = new THREE.MeshStandardMaterial({ color: '#a34233', roughness: 0.65 });
    box(this, red, [0.19, 0.9, 0.62], [-9.75, 1.12, -6]);
    label(this, 'SOS', 0.38, 0.18, [-9.645, 1.15, -6], { background: '#a34233', rotation: [0, Math.PI / 2, 0], fontSize: 230 });
  }

  buildSignage(m) {
    for (const z of [-27, -8, 12, 32]) {
      label(this, this.displayName.toUpperCase(), 4.65, 0.65, [7.58, 2.6, z], { rotation: [0, -Math.PI / 2, 0], background: this.options.signageColor, color: '#f0f0e0', fontSize: 94 });
      const opening = this.options.backwallOpening;
      if (!opening || Math.abs(z + 3 - opening.z) > (opening.width + 3.35) / 2) {
        label(this, this.displayName.toUpperCase(), 3.35, 0.48, [-9.85, 2.73, z + 3], { rotation: [0, Math.PI / 2, 0], background: this.options.signageColor, color: '#f0f0e0', fontSize: 94 });
      }
    }
    for (const z of [-6, 18, 38]) {
      const sign = new THREE.Group();
      sign.position.set(-4.8, 3.95, z);
      sign.rotation.y = Math.PI;
      this.add(sign);
      box(sign, m.dark, [3.5, 0.63, 0.12], [0, 0, 0]);
      label(sign, '↑  EXIT   /   AUSGANG', 3.34, 0.49, [0, 0, 0.07], { fontSize: 82, background: '#263f36' });
      for (const x of [-1.35, 1.35]) box(sign, m.steel, [0.035, 1.19, 0.035], [x, 0.89, 0]);
    }
    const platformSign = new THREE.Group();
    platformSign.position.set(-3.8, 3.9, -34);
    platformSign.rotation.y = -2.65;
    this.add(platformSign);
    box(platformSign, m.dark, [2.62, 0.61, 0.11], [0, 0, 0]);
    label(platformSign, `${this.platformNumber}   ${this.lineId}  → ${this.destinationName.toUpperCase()}`, 2.5, 0.49, [0, 0, 0.062], { fontSize: 75 });
    for (const x of [-0.9, 0.9]) box(platformSign, m.steel, [0.035, 1.3, 0.035], [x, 0.97, 0]);
    // A self-contained route diagram; no external fonts or image assets.
    for (const z of [-21, 9]) {
      const diagram = new THREE.Group();
      diagram.position.set(-9.81, 1.88, z);
      diagram.rotation.y = Math.PI / 2;
      this.add(diagram);
      box(diagram, m.aluminum, [1.58, 1.24, 0.04], [0, 0, 0]);
      label(diagram, `${this.lineId}  /  ${this.options.lineName ?? 'THE CENTRAL LINE'}`, 1.42, 0.18, [0, 0.44, 0.03], { background: '#d7dfd4', color: '#2c594e', fontSize: 71 });
      box(diagram, m.trainAccent, [1.13, 0.026, 0.023], [0, 0.04, 0.033], { shadow: false });
      for (let i = 0; i < 5; i++) {
        const x = -0.55 + i * 0.275;
        const circle = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), i === 1 ? m.yellow : m.whitePaint);
        circle.position.set(x, 0.04, 0.051); diagram.add(circle);
      }
      label(diagram, this.options.routeNames?.join('   •   ') ?? 'Nordplatz   Museum   Rathaus   Central', 1.34, 0.13, [0, -0.17, 0.037], { background: '#d7dfd4', color: '#364c41', fontSize: 45 });
      label(diagram, `${this.options.networkName ?? 'CITY METRO'}  •  INFORMATION`, 1.34, 0.14, [0, -0.44, 0.037], { background: '#d7dfd4', color: '#697b6c', fontSize: 54 });
    }
  }
}
