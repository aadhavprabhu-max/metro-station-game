import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { box, cylinder, instances, seededRandom, label } from './geometry.js';
import { architecturalMaterials, archWedge } from './phase6-stations.js';
import { batchStaticGeometry } from './optimize.js';
import { NetworkLineWorld, buildSampledRailway } from './network-world.js';

/** The two turnouts and the approach diamond share a fail-closed reservation. */
export class U5JunctionProtection {
  constructor(branch) { this.branch = branch; this.owner = null; this.lockedVariant = null; this.signals = []; this.blades = []; }
  intervals(route) {
    const b = this.branch;
    return route.variant === 'scenic'
      ? [[b.splitDistance - 70, b.splitDistance + 220], [b.splitDistance + b.length - 220, b.splitDistance + b.length + 70]]
      : [[b.splitDistance - 70, b.mergeDistance + 70]];
  }
  reserve(service) {
    if (this.owner && this.owner !== service) return false;
    this.owner = service; this.lockedVariant = service.route.variant ?? 'direct'; return true;
  }
  release(service) { if (this.owner === service) { this.owner = null; this.lockedVariant = null; } }
  distanceToStop(service) {
    const intervals = this.intervals(service.route), d = service.distance, sign = service.direction;
    const occupied = intervals.some(([a, b]) => d + 28 >= a && d - 28 <= b);
    const next = intervals.map(([a, b]) => sign > 0 ? a - 28 - d : d - b - 28).filter(v => v >= 0).sort((a, b) => a - b)[0] ?? Infinity;
    if ((occupied || next < 110) && this.reserve(service)) return Infinity;
    if (occupied && this.owner !== service) return 0;
    return next;
  }
  update(service) {
    const intervals = this.intervals(service.route), d = service.distance;
    if (this.owner === service && !intervals.some(([a, b]) => d + 28 >= a - 110 && d - 28 <= b + 110)) this.release(service);
    const safe = !this.owner || this.owner === service;
    for (const { red, green } of this.signals) { red.visible = !safe; green.visible = safe; }
    const diverging = (this.lockedVariant ?? service.route.variant) === 'scenic';
    for (const blade of this.blades) blade.rotation.y = blade.userData.baseYaw + (diverging ? blade.userData.throw : 0);
  }
  snapshot() { return { locked: Boolean(this.owner), variant: this.lockedVariant, owner: this.owner?.lineId ?? null, protectedHalfLength: 28, protects: ['J-A', 'J-B', 'underground-diamond'] }; }
}

function junctionChamber(root, base, branch, authority) {
  const m = architecturalMaterials('monumental'), chamber = new THREE.Group(); chamber.name = 'U5ProtectedJunctionChamber'; root.add(chamber);
  box(chamber, base.trackBed, [45, 0.3, 220], [18, -25.45, -655]);
  box(chamber, m.stone, [0.4, 6.5, 220], [-3.5, -21.9, -655]);
  box(chamber, m.stone, [45, 0.4, 220], [18, -18.5, -655]);
  for (const [a, b] of [[-765, -745], [-704, -607], [-565, -545]]) box(chamber, m.stone, [0.4, 6.5, b - a], [40.5, -21.9, (a + b) / 2]);
  for (let z = -757; z <= -550; z += 12) box(chamber, m.light, [18, 0.05, 0.15], [15, -19.1, z], { shadow: false });
  for (const [id, toe] of Object.entries(branch.junctions)) {
    const signal = new THREE.Group(); signal.position.set(toe.x - 2.2, toe.y, toe.z + (id === 'split' ? -70 : 70)); chamber.add(signal);
    box(signal, base.dark, [0.12, 2.8, 0.12], [0, 0.35, 0]); box(signal, base.dark, [0.45, 0.9, 0.2], [0, 1.85, 0]);
    const redMat = new THREE.MeshBasicMaterial({ color: '#e94635' }), greenMat = new THREE.MeshBasicMaterial({ color: '#74dc94' });
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), redMat), green = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), greenMat);
    red.position.set(0, 2.05, 0.14); green.position.set(0, 1.65, 0.14); signal.add(red, green); signal.userData.dynamic = true;
    authority.signals.push({ red, green });
    label(chamber, `${id === 'split' ? 'J-A' : 'J-B'} · U5 RIVER LOOP`, 3, 0.4, [toe.x - 1.8, -20.7, toe.z - 18], { fontSize: 105, rotation: [0, Math.PI, 0] });
    // Real point rails occupy the toe. Their small throw selects the already
    // continuous direct or branch rail; static stock rails never move.
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(toe.x + side * 0.7175, -25.04, toe.z); pivot.userData.dynamic = true;
      const blade = box(pivot, base.steel, [0.045, 0.06, 10], [0, 0, id === 'split' ? 5 : -5]); blade.name = `${id}SwitchBlade`;
      pivot.userData.baseYaw = 0; pivot.userData.throw = (id === 'split' ? 1 : -1) * 0.0166; chamber.add(pivot); authority.blades.push(pivot);
    }
  }
  // The broad approach arcs meet here at equal level. A proper diamond/frog
  // and the same reservation prevent conflicting movements through the throat.
  const crossingX = 301.57 - Math.sqrt(300 ** 2 - 75 ** 2);
  for (const yaw of [-Math.asin(0.25), Math.PI + Math.asin(0.25)]) {
    const frog = new THREE.Group(); frog.position.set(crossingX, -25.035, -655); frog.rotation.y = yaw; chamber.add(frog);
    for (const x of [-0.7175, 0.7175]) {
      box(frog, base.steel, [0.055, 0.055, 3.8], [x, 0, 0]);
      box(frog, base.steel, [0.055, 0.08, 4.4], [x + Math.sign(x) * 0.14, -0.02, 0]);
    }
  }
  chamber.userData.protectedDiamond = { x: crossingX, y: -24, z: -655 };
  batchStaticGeometry(chamber);
}

function sculptedSaint(root, m, x, z, facing) {
  const group = new THREE.Group(); group.position.set(x, -1.2, z); group.rotation.y = facing; root.add(group);
  box(group, m.stone, [2.2, 0.4, 2.2], [0, 0.2, 0]); box(group, m.pale, [1.6, 1.15, 1.6], [0, 0.95, 0]);
  box(group, m.stone, [1.9, 0.2, 1.9], [0, 1.62, 0]);
  const profile = [[0.7, 0], [0.68, 0.2], [0.55, 0.6], [0.5, 1.2], [0.46, 1.8], [0.55, 2.25], [0.34, 2.5]].map(([x, y]) => new THREE.Vector2(x, y));
  const robe = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), m.stone); robe.position.y = 1.75; group.add(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), m.pale); head.position.set(0, 4.5, 0); head.scale.set(0.85, 1.15, 0.9); group.add(head);
  for (const sign of [-1, 1]) {
    const arm = cylinder(group, m.stone, 0.17, 1.1, [sign * 0.47, 3.6, 0.05], [0, 0, sign * 0.35], 12);
    arm.name = 'CarvedRobeSleeve';
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 24), m.trim); halo.position.set(0, 4.55, -0.1); group.add(halo);
}

function bridge(root, branch) {
  const source = architecturalMaterials('amber'), m = { ...source, stone: source.stone.clone() };
  m.stone.map = source.stone.map.clone(); m.stone.map.repeat.set(0.12, 0.16); m.stone.bumpMap = m.stone.map;
  const group = new THREE.Group(); group.name = 'PragueHistoricStoneArchBridge';
  group.userData.bridge = { ...branch.bridge, exposedModernStructure: false, archCount: 10, parapetTop: 0.12 };
  root.add(group);
  const { fromX, toX, centerZ } = branch.bridge, width = 16.5, bay = (toX - fromX) / 10;
  for (let i = 0; i < 10; i++) {
    const left = fromX + i * bay, cx = left + bay / 2, spring = -10.3, rise = 7.3, radius = bay / 2 - 3;
    const shape = new THREE.Shape();
    shape.moveTo(left, -19); shape.lineTo(left + 3, -19); shape.lineTo(left + 3, spring);
    for (let j = 0; j <= 40; j++) { const t = Math.PI - j / 40 * Math.PI; shape.lineTo(cx + radius * Math.cos(t), spring + rise * Math.sin(t)); }
    shape.lineTo(left + bay - 3, -19); shape.lineTo(left + bay, -19); shape.lineTo(left + bay, -1.38); shape.lineTo(left, -1.38); shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: width, steps: 1, bevelEnabled: false }), m.stone);
    mesh.name = 'OpenStoneArchAndSpandrel'; mesh.position.z = centerZ - width / 2; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    for (const z of [centerZ - width / 2 - 0.1, centerZ + width / 2 - 0.45]) for (let j = 0; j < 28; j++) archWedge(group, j === 14 ? m.pale : m.stone, {
      cx, spring, rx: radius, ry: rise, thickness: 0.85, depth: 0.55, z, from: j * Math.PI / 28 + 0.003, to: (j + 1) * Math.PI / 28 - 0.003,
    });
  }
  box(group, m.stone, [400, 0.32, width], [1600, -1.56, centerZ]);
  for (const z of [centerZ - width / 2, centerZ + width / 2]) {
    box(group, m.stone, [404, 1.3, 0.55], [1600, -0.62, z]);
    box(group, m.pale, [405, 0.18, 0.78], [1600, 0.03, z]);
    box(group, m.pale, [404, 0.22, 0.72], [1600, -1.15, z]);
    for (let x = fromX; x <= toX; x += 40) {
      // Projecting cutwaters, moulded pier caps, and carved figures supply the
      // historic silhouette without any overhead structure across the view.
      cylinder(group, m.stone, 3.6, 9, [x, -14.5, z], [0, 0, 0], 6);
      box(group, m.stone, [3, 1.8, 2.2], [x, -1.5, z]);
      if (x > fromX && x < toX && (x - fromX) % 80 === 0) sculptedSaint(group, m, x, z + Math.sign(z - centerZ) * 0.75, z < centerZ ? Math.PI : 0);
      else {
        box(group, m.pale, [0.6, 0.35, 0.75], [x, 0.25, z]);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), m.stone); cap.position.set(x, 0.55, z); group.add(cap);
      }
    }
  }
  const slate = new THREE.MeshStandardMaterial({ color: '#4f605e', roughness: 0.79 });
  for (const x of [1382, 1818]) for (const sign of [-1, 1]) {
    const z = centerZ + sign * 14, tower = new THREE.Group(); tower.name = 'HistoricBridgeGatewayTurret'; tower.position.set(x, -1.4, z); group.add(tower);
    box(tower, m.stone, [8, 8, 8], [0, -4, 0]);
    box(tower, m.stone, [6, 19, 6], [0, 9.5, 0]);
    for (const y of [0.4, 7.6, 15.2, 19]) box(tower, m.pale, [6.6, 0.3, 6.6], [0, y, 0]);
    for (const y of [4, 11, 17]) for (const side of [-1, 1]) {
      box(tower, m.dark, [1.2, 2.6, 0.06], [side * 1.4, y, -3.04]);
      archWedge(tower, m.pale, { cx: side * 1.4, spring: y + 0.7, rx: 0.7, ry: 0.75, z: -3.1, depth: 0.15, thickness: 0.12 });
      for (const dx of [-0.7, 0.7]) box(tower, m.pale, [0.15, 2.1, 0.16], [side * 1.4 + dx, y - 0.25, -3.1]);
    }
    for (let y = 0.7; y < 19; y += 0.9) for (const dx of [-2.85, 2.85]) for (const dz of [-2.85, 2.85]) box(tower, m.pale, [0.65, 0.35, 0.65], [dx, y, dz]);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4.9, 9, 4), slate); spire.rotation.y = Math.PI / 4; spire.position.y = 23.65; spire.castShadow = true; tower.add(spire);
    cylinder(tower, m.trim, 0.07, 2, [0, 28.6, 0]);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), m.trim); finial.position.y = 29.3; tower.add(finial);
  }
  batchStaticGeometry(group); return group;
}

function river(root, branch) {
  const normals = new Uint8Array(256 * 256 * 4), random = seededRandom(618);
  const lattice = Array.from({ length: 32 * 32 }, () => random());
  const noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy, s = t => t * t * (3 - 2 * t), at = (a, b) => lattice[((b + 320) % 32) * 32 + (a + 320) % 32];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), s(u)), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), s(u)), s(v));
  };
  const height = (x, y) => noise(x / 8, y / 8) + 0.24 * noise(x / 2, y / 2);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    normals[i] = 128 + Math.round(120 * (height(x + 1, y) - height(x - 1, y))); normals[i + 1] = 128 + Math.round(120 * (height(x, y + 1) - height(x, y - 1))); normals[i + 2] = 252; normals[i + 3] = 255;
  }
  const normal = new THREE.DataTexture(normals, 256, 256); normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.needsUpdate = true;
  const water = new Water(new THREE.PlaneGeometry(240, 4600), {
    textureWidth: 512, textureHeight: 512, waterNormals: normal,
    sunDirection: new THREE.Vector3(-0.4, 0.8, 0.3).normalize(), sunColor: '#fff1d1', waterColor: '#244d56', distortionScale: 1.1, fog: false,
  });
  water.rotation.x = -Math.PI / 2; water.position.set(1600, branch.bridge.waterY, -500); water.name = 'AnimatedReflectiveRiver';
  root.add(water);
  const m = architecturalMaterials('river'), bank = new THREE.Group(); bank.name = 'RiverbanksAndStoneQuays'; root.add(bank);
  for (const [x, sign] of [[1470, -1], [1730, 1]]) {
    // Continuous river edges sit below the arch soffits. The train sees water
    // along the river in both directions, above the low bridge parapets.
    box(bank, m.stone, [18, 10, 4600], [x, -13, -500]);
    box(bank, m.pale, [22, 0.35, 4600], [x, -7.9, -500]);
    for (let z = -2700; z < 1700; z += 32) {
      if (Math.abs(z + 433) < 35) continue;
      box(bank, m.stone, [8, 2, 5], [x + sign * 6, -6.9, z]);
    }
  }
  batchStaticGeometry(bank); return water;
}

function landscape(root, base, branch) {
  const m = architecturalMaterials('river'), random = seededRandom(604);
  const grass = new THREE.MeshStandardMaterial({ color: '#79866a', roughness: 0.97 });
  const foliage = new THREE.MeshStandardMaterial({ color: '#61704f', roughness: 1 });
  const roof = new THREE.MeshStandardMaterial({ color: '#846a55', roughness: 0.85 });
  const landscape = new THREE.Group(); landscape.name = 'HistoricRiverValley'; root.add(landscape);
  // Terraces are below the railway, with real abutments/embankments below the
  // level railbed. No terrain plane is drawn across the rising rail approaches.
  const cuttings = [];
  for (let d = 0; d < branch.length; d += 5) { const p = branch.sample(d).position; if (p.y < -4) cuttings.push(p); }
  const bankGround = (left, right) => {
    const vertices = [], size = 10;
    for (let x = left; x < right; x += size) for (let z = -1800; z < 800; z += size) {
      const cx = x + size / 2, cz = z + size / 2;
      if (cuttings.some(p => Math.abs(p.x - cx) < 17 && Math.abs(p.z - cz) < 17)) continue;
      vertices.push(x, -9, z, x, -9, z + size, x + size, -9, z + size, x, -9, z, x + size, -9, z + size, x + size, -9, z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, grass); mesh.name = 'RiverbankTerrainWithSurveyedRailCuttings'; mesh.receiveShadow = true; landscape.add(mesh);
  };
  bankGround(350, 1450); bankGround(1740, 4340);
  for (const x of [1280, 1920]) for (let z = -1800; z <= 600; z += 220) {
    if (Math.abs(z + 433) < 160) continue;
    const h = 7 + random() * 8, w = 18 + random() * 14;
    box(landscape, m.stone, [w, h, 20], [x + (random() - 0.5) * 45, -9 + h / 2, z]);
    const top = new THREE.Mesh(new THREE.ConeGeometry(w * 0.76, 6, 4), roof); top.rotation.y = Math.PI / 4; top.position.set(x, -9 + h + 3, z); landscape.add(top);
    for (const y of [-5, -1, 3, 7]) if (y < -9 + h - 1) for (const dx of [-6, 0, 6]) box(landscape, m.dark, [1.6, 2.2, 0.08], [x + dx, y, z - 10.05]);
  }
  for (let i = 0; i < 160; i++) {
    const x = 300 + random() * 3950, z = -1600 + random() * 1900;
    if (x > 1430 && x < 1780 || Math.abs(z + 430) < 50 || Math.abs(z + 1070) < 70) continue;
    let near = false;
    for (let d = 0; d < branch.length; d += 30) { const p = branch.sample(d).position; if (Math.hypot(p.x - x, p.z - z) < 22) { near = true; break; } }
    if (near) continue;
    const h = 5 + random() * 6;
    cylinder(landscape, m.timber, 0.3, h, [x, -9 + h / 2, z]);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.7 + random() * 1.8, 1), foliage); crown.position.set(x, -9 + h, z); crown.scale.y = 1.5; landscape.add(crown);
  }
  // Support every open-air railway span, excluding the historic bridge and
  // stations (which have their own platforms and foundations).
  const supports = [];
  for (let d = 0; d < branch.length; d += 6) {
    const p = branch.sample(d), isBridge = p.position.x >= 1400 && p.position.x <= 1800 && Math.abs(p.position.z + 433) < 8;
    if (isBridge || p.position.y < -7) continue;
    const h = p.position.y + 9 - 1.37;
    supports.push({ size: [5.6, h, 6.15], position: [p.position.x, -9 + h / 2, p.position.z], rotation: [0, p.yaw, 0] });
  }
  instances(landscape, m.stone, supports);
  // Individual station terraces give the riverside hall a grounded promenade.
  for (const s of branch.stations) {
    const terrace = new THREE.Group(); terrace.position.set(s.position.x, 0, s.position.z); terrace.rotation.y = s.yaw; landscape.add(terrace);
    box(terrace, m.stone, [29, 7.7, 103], [-4, -5.15, 0]);
    box(terrace, m.pale, [29, 0.2, 103], [-4, -1.2, 0]);
  }
  batchStaticGeometry(landscape);
}

export class Phase6World extends THREE.Group {
  constructor(base, network) {
    super(); this.name = 'Phase6RiverWorld'; this.lineId = 'U5'; this.branch = network.phase6.branch;
    const b = this.branch;
    this.authority = new U5JunctionProtection(b);
    const route = { ...b, network, line: network.lines.get('U5'), getTerminus: d => b.original.getTerminus(d) };
    const platforms = new NetworkLineWorld(base, route, { buildRailway: false });
    this.stations = platforms.stations; this.add(platforms);
    const rails = new THREE.Group(); rails.name = 'U5ScenicContinuousRailway'; this.add(rails);
    const openStart = b.path.distanceAtHorizontal(1100), openEnd = b.path.distanceAtHorizontal(b.horizontal.length - 1100);
    buildSampledRailway(rails, base, b, { start: 0, end: b.length, terminalCaps: false, openIntervals: [[0, 150], [openStart, openEnd], [b.length - 150, b.length]] });
    junctionChamber(this, base, b, this.authority);
    this.bridge = bridge(this, b); this.water = river(this, b); landscape(this, base, b);
    this.sun = new THREE.DirectionalLight('#ffe8bf', 1.5); this.sun.position.set(1100, 700, -1500); this.sun.target.position.set(1600, -10, -433); this.add(this.sun, this.sun.target);
    this.surfaceFog = new THREE.Fog('#b7c7c6', 260, 1900);
    this.surfaceBackground = new THREE.Color('#b7c7c6');
    this.surfaceSections = [];
    for (const section of rails.children) this.surfaceSections.push({ group: section, bounds: new THREE.Box3().setFromObject(section) });
  }
  update(delta, player, world) {
    this.water.material.uniforms.time.value += delta * 0.5;
    const service = world.services.find(s => s.lineId === 'U5');
    this.authority.update(service);
    const active = player.service?.lineId === 'U5', surface = active && player.camera.position.y > -9;
    this.visible = active;
    this.sun.visible = surface;
    if (surface) {
      world.scene.fog = this.surfaceFog; world.scene.background = this.surfaceBackground; world.camera.far = 2300;
      this.water.visible = Math.abs(player.camera.position.x - 1600) < 1300;
    } else { world.scene.fog = world.undergroundFog; world.scene.background = world.undergroundBackground; world.camera.far = 180; }
    world.camera.updateProjectionMatrix();
    const range = surface ? 360 : 145, nearest = new THREE.Vector3();
    for (const { group, bounds } of this.surfaceSections) { bounds.clampPoint(player.camera.position, nearest); group.visible = nearest.distanceToSquared(player.camera.position) < range * range; }
    for (const station of this.stations) station.visible = active && station.getWorldPosition(nearest).distanceToSquared(player.camera.position) < (range + 70) ** 2;
  }
}
