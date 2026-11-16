import * as THREE from 'three';
import { box, cylinder, label, seededRandom } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { STREET_Y, CITY_BOUNDS, OLD_TOWN, SQUARE_SITE, CITY_PLOTS, CITY_ROUTES, CITY_SQUARES, CITY_SHAMIANAS, CITY_ARRIVAL, CENTRAL_EXIT, CITY_ROADS, ROAD_BRIDGES, TERRACE, WALL_RELICS, rectContains } from './city-layout.js';
import { buildRoads, addShamiana, addGrassPatches } from './city-roads.js';
import { createCityMaterials, buildHouse, buildClockTower, batchCityInstances, uvMesh } from './city-buildings.js';
import { PropKit, addPalm, addCitrus, addCafe, addPlanter, addBunting, addWashing, addLamp, addBench, addPot } from './city-props.js';
import { SurfaceEntrance } from './surface-entrance.js';
import { downtownMaterials, queueDowntown } from './downtown-buildings.js';
import { buildAurealisSquare } from './downtown-square.js';
import { dayClock, daylightState } from './day-cycle.js';
import { NIGHT_UNIFORMS } from './night-glow.js';

// The sky, sun, moon, fog and window light follow the shared day clock (34 real minutes per day).
const SKY = Object.freeze({ horizon: '#a9d8f0', haze: '#bfe0f0' });
// The key light sits this far from the player along the sun (or moon) direction; the shadow camera reaches past it.
const LIGHT_DISTANCE = 600;

function createSkyDome() {
  const material = new THREE.ShaderMaterial({
    uniforms: { zenith: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      glowColor: { value: new THREE.Color() }, glow: { value: 0.3 }, night: { value: 0 },
      sun: { value: new THREE.Vector3(0, 1, 0) }, moon: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glowColor; uniform vec3 sun; uniform vec3 moon;
      uniform float glow; uniform float night; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.16, 0.85, h));
        // Sun: a broad coloured glow (strongest at sunrise and sunset), a tight halo and the disc.
        float s = max(dot(d, sun), 0.0);
        col += glowColor * (pow(s, 6.0) * glow * 0.45 + pow(s, 24.0) * 0.35);
        col += vec3(1.0, 0.96, 0.86) * smoothstep(0.9993, 0.9996, s) * (1.0 - night);
        // Night: stars above the haze and a pale moon.
        vec3 cell = floor(d * 600.0);
        float star = step(0.9978, hash(cell)) * smoothstep(0.04, 0.3, d.y) * night;
        col += vec3(star * (0.55 + 0.45 * hash(cell + 3.1)));
        float m = max(dot(d, moon), 0.0);
        col += vec3(0.86, 0.9, 1.0) * smoothstep(0.99955, 0.9997, m) * night * 1.3 + vec3(0.25, 0.35, 0.7) * pow(m, 60.0) * night * 0.3;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  dome.name = 'OldTownSkyDome'; dome.renderOrder = -1; dome.frustumCulled = false; dome.raycast = () => {};
  dome.visible = false;
  return dome;
}

/** A walkable district, separate from the retained U5/U10 scenic environments. */
export class SurfaceWorld extends THREE.Group {
  constructor(baseMaterials, station) {
    super(); this.name = 'CentralOldTownSurface'; this.streetY = STREET_Y;
    this.bounds = CITY_BOUNDS; this.routes = CITY_ROUTES; this.colliders = [];
    this.arrival = CITY_ARRIVAL; this.exit = CENTRAL_EXIT;
    this.materials = createCityMaterials(baseMaterials);
    this.entrance = new SurfaceEntrance(this.materials, station);
    this.district = new THREE.Group(); this.district.name = 'CentralOldTownDistrict'; this.district.visible = false; this.add(this.district);
    this.built = false; this.active = false; this.jobs = []; this.downtownReady = false; this.detailMeshes = []; this.towers = [];
    this.background = new THREE.Color(SKY.horizon); this.fog = new THREE.Fog(SKY.haze, 250, 1050);
    // Cool sky bounce from the side opposite the sun; the shadowed key light is the sun.
    this.sun = new THREE.DirectionalLight('#9cc4ff', 0.55); this.sun.position.set(80, 60, 120); this.sun.target.position.set(-16, 10, -200);
    this.sun.visible = false; this.add(this.sun, this.sun.target);
    this.sky = createSkyDome(); this.add(this.sky);
    this.dayClock = dayClock; this.daylight = daylightState(dayClock.hours);
    this.userData.phase = 1; this.userData.newExits = ['station-2:U4'];
  }

  ensureBuilt() {
    if (this.built) return;
    const m = this.materials, root = this.district, b = this.bounds, hole = this.entrance.shaftBounds;
    const access = { minX: this.entrance.towers[0].group.position.x - 3,
      maxX: this.entrance.towers[0].group.position.x + 3,
      minZ: this.entrance.towers[0].group.position.z, maxZ: hole.minZ };
    const worldUV=(mesh,width,depth)=>{
      mesh.geometry=mesh.geometry.clone();
      const uv=mesh.geometry.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*width/8,uv.getY(i)*depth/8);
      return mesh;
    };
    // The terrain has an actual aperture over the stairs, never a clipping plane.
    const pave = (x0, x1, z0, z1) => {
      if (x1 <= x0 || z1 <= z0) return;
      // A thin slab (bottom ≥ 9.95 m) so it clears the U2 Stadtzentrum glass roof, which tops out at 9.9 m.
      worldUV(box(root, m.paving, [x1 - x0, 0.05, z1 - z0], [(x0 + x1) / 2, STREET_Y - 0.025, (z0 + z1) / 2]),x1-x0,z1-z0);
    };
    // A canal crosses the southern edge, with three fully supported crossings.
    const canal = { minX: b.minX, maxX: b.maxX, minZ: -338, maxZ: -329 };
    this.canal = canal;
    pave(b.minX, b.maxX, b.minZ, canal.minZ);
    pave(b.minX, hole.minX, canal.maxZ, b.maxZ); pave(hole.maxX, b.maxX, canal.maxZ, b.maxZ);
    // Keep the upper hall's own finished floor and bronze inlays exposed.
    // Paving under that floor would create coincident surfaces; a street band
    // above it would conceal the architectural finish.
    pave(hole.minX, hole.maxX, canal.maxZ, access.minZ);
    pave(hole.minX, access.minX, access.minZ, access.maxZ);
    pave(access.maxX, hole.maxX, access.minZ, access.maxZ);
    pave(hole.minX, hole.maxX, hole.maxZ, b.maxZ);
    box(root, m.water, [b.maxX - b.minX, 0.08, 9], [(b.minX + b.maxX) / 2, STREET_Y - 1.25, -333.5], { shadow: false });
    // Old-town footbridges (8 m) plus road bridges carrying the outer avenues (full road width).
    const roadHalf = x => { const r = CITY_ROADS.find(road => road.axis === 'z' && road.c === x); return r.width / 2 + r.walk; };
    this.bridges = [...[-104, -16.2, 84].map(x => ({ minX: x - 4, maxX: x + 4 })), ...ROAD_BRIDGES.map(x => ({ minX: x - roadHalf(x), maxX: x + roadHalf(x) }))]
      .map(b => ({ ...b, minZ: -339, maxZ: -328 })).sort((a, b) => a.minX - b.minX);
    for (const bridge of this.bridges) {
      // The deck meets the quay exactly. Logical approach bounds overlap land,
      // but another coplanar finish at either end would cause floor shimmer.
      box(root, m.stone, [bridge.maxX - bridge.minX, 0.42, 9], [(bridge.minX + bridge.maxX) / 2, STREET_Y - 0.21, -333.5]);
      for (const x of [bridge.minX - 0.12, bridge.maxX + 0.12]) {
        box(root, m.pale, [0.25, 0.95, 10.6], [x, STREET_Y + 0.475, -333.5]);
        this.colliders.push({ minX: x - 0.13, maxX: x + 0.13, minZ: -338.8, maxZ: -328.2 });
      }
    }
    for (const z of [-338.3, -328.7]) {
      let start = b.minX;
      for (const bridge of this.bridges) {
        if (bridge.minX > start) this.addCanalWall(start, bridge.minX, z);
        start = bridge.maxX;
      }
      this.addCanalWall(start, b.maxX, z);
    }
    // Flagstone lanes along the street hierarchy, herringbone brick in the squares.
    for (const x of [-104, -16.2, 84]) {
      if (x !== -16.2) worldUV(box(root, m.road, [9, 0.012, 267.5], [x, STREET_Y + 0.006, -187.75], { shadow: false }),9,267.5);
      else for (const [a,b] of [[-321.5,access.minZ],[hole.maxZ,-81.5]])
        worldUV(box(root,m.road,[9,.012,b-a],[x,STREET_Y+.006,(a+b)/2],{shadow:false}),9,b-a);
    }
    for (const z of [-234, -320]) worldUV(box(root, m.road, [252, 0.014, 8], [-14, STREET_Y + 0.007, z], { shadow: false }),252,8);
    for(const x of [-21.0,-11.4])box(root,m.whiteStone,[.3,.016,62],[x,STREET_Y+.012,-286.5],{shadow:false});
    for (const s of CITY_SQUARES) {
      const w = s.maxX - s.minX, d = s.maxZ - s.minZ;
      worldUV(box(root, m.brick, [w, 0.006, d], [(s.minX + s.maxX) / 2, STREET_Y + 0.019, (s.minZ + s.maxZ) / 2], { shadow: false }), w, d).name = `OldTownSquare-${s.name}`;
      // Pale stone kerb framing each square.
      for (const [sx, sz, px, pz] of [[w, 0.4, (s.minX + s.maxX) / 2, s.minZ], [w, 0.4, (s.minX + s.maxX) / 2, s.maxZ], [0.4, d, s.minX, (s.minZ + s.maxZ) / 2], [0.4, d, s.maxX, (s.minZ + s.maxZ) / 2]])
        box(root, m.whiteStone, [sx, 0.008, sz], [px, STREET_Y + 0.0235, pz], { shadow: false });
    }
    const extra = [];
    for (const plot of CITY_PLOTS) this.colliders.push(buildHouse(root, m, plot, extra));
    this.colliders.push(...extra);
    this.colliders.push(buildClockTower(root, m, -135, -128));
    const kit = new PropKit(), y0 = STREET_Y;
    // Street trees: palms on the squares, citrus in the gardens; same trunk colliders as before.
    for (const [i, [x, z]] of [[62,-177],[77,-177],[94,-177],[64,-193],[94,-193],[76,-165],[94,-161],[-137,-234],[-122,-244],[-37,-240],[5,-240],[-37,-225],[5,-225],[-30,-211],[-2,-211]].entries()) {
      const palm = i >= 9 || i % 2 === 0;
      this.colliders.push(palm ? addPalm(kit, m, x, z, y0, i) : addCitrus(kit, m, x, z, y0, i));
      if (!palm || i < 9) box(root, m.grass, [4.6, 0.01, 4.6], [x, STREET_Y + 0.026, z], { shadow: false });
      else for (const [sx, sz, dx, dz] of [[2.2, 0.2, 0, -1], [2.2, 0.2, 0, 1], [0.2, 2.2, -1, 0], [0.2, 2.2, 1, 0]])
        box(root, m.whiteStone, [sx, 0.12, sz], [x + dx * 1.0, STREET_Y + 0.06, z + dz * 1.0]);
    }
    for (const [x, z] of [[69,-188],[88,-188],[-119,-244],[-30,-222],[0,-222],[-31.4,-66],[-0.8,-66]]) {
      addBench(kit, m, x, z, y0);
      this.colliders.push({ minX:x-.4,maxX:x+.4,minZ:z-1.75,maxZ:z+1.75 });
    }
    // Café terraces on each square, clear of every walking route.
    for (const [i, [x, z]] of [[-27,-247],[-5.5,-247],[-5.5,-228.5],[-114,-224],[-94,-224],[-26,-62],[-6,-62],[-26,-72],[100,-170],[104,-186]].entries())
      this.colliders.push(addCafe(kit, m, x, z, y0, i));
    // Low white stone planters with bougainvillea, some holding a palm.
    for (const [i, [x0, z0, x1, z1, palm]] of [[-32.4,-231.5,-30.2,-225.5,0],[-2.6,-231.5,-0.4,-225.5,0],[-31.6,-55.6,-27.6,-53.6,1],[-3,-55.6,1,-53.6,1],
      [56,-171,62,-168.6,1],[106,-194.6,112,-192.2,1],[-125.4,-252,-121.4,-249.6,1],[-88.6,-222.4,-84.6,-220,0]].entries())
      this.colliders.push(addPlanter(root, kit, m, x0, z0, x1, z1, y0, 50 + i, { palm: !!palm }));
    for (const [i, [x, z]] of [[-31.5,-253.5],[-0.8,-253.5],[-31.5,-219.8],[-0.8,-219.8],[-124.6,-220.4],[-83.4,-253.6],[-31,-75],[0.6,-75]].entries())
      this.colliders.push(addCitrus(kit, m, x, z, y0, 70 + i, true));
    // Lemon square fountain.
    this.addFountain(kit, -16.2, -64);
    // A stone basin gives the western market a landmark at walking scale.
    this.addFountain(kit, -85, -237);
    const lamps = [];
    for (const z of [-241,-314]) for (const x of [-110,-25,77]) lamps.push([x, z]);
    for (const z of [-125.4,-90.4]) for (const x of [-119,-25,69]) lamps.push([x, z]);
    lamps.push([-27,-204],[-5,-204]);
    for (const [x, z] of lamps) { addLamp(kit, m, x, z, y0); this.colliders.push({minX:x-.14,maxX:x+.14,minZ:z-.14,maxZ:z+.14}); }
    this.addStringLines(kit);
    // Asphalt roads with sidewalks, markings and street furniture; festive canopies; lawn patches.
    const roadRects = buildRoads(root, kit, m, this.colliders);
    for (const [i, spec] of CITY_SHAMIANAS.entries()) addShamiana(root, kit, m, spec, this.colliders, 700 + i);
    this.addGrass(kit, roadRects);
    kit.flush(root);
    // The old-town perimeter walls are gone; the whole district has a low edge wall instead.
    for (const x of [b.minX-.3,b.maxX+.3]) box(root,m.concrete,[.6,1.2,b.maxZ-b.minZ+1.2],[x,STREET_Y+.6,(b.minZ+b.maxZ)/2]);
    for (const z of [b.minZ-.3,b.maxZ+.3]) box(root,m.concrete,[b.maxX-b.minX+.6,1.2,.6],[(b.minX+b.maxX)/2,STREET_Y+.6,z]);
    this.addTerrace(root);
    this.addWallRelics(root);
    label(root,'CENTRAL  ·  ALTSTADT',6.5,.38,[-16.2,STREET_Y+.026,-215],{rotation:[-Math.PI/2,0,0],background:'#e9e1cc',color:'#6b4a2e',fontSize:100});
    this.colliders.push(...this.entrance.facadeColliders);
    // Outer access walls are physical obstacles on street level as well.
    const tower=this.entrance.towers[0].group;
    for(const side of [-1,1]) this.colliders.push({minX:tower.position.x+side*3.15-.12,maxX:tower.position.x+side*3.15+.12,minZ:tower.position.z+4.1,maxZ:tower.position.z+23.8});
    batchStaticGeometry(root);
    // The old town keeps coarse instance groups (as before downtown); downtown areas use ~140 m cells.
    this.userData.combinedInstanceGroups=batchCityInstances(root, 400);
    this.collectDetail(root);
    this.indexColliders();
    this.built=true;
    this.downtown = downtownMaterials(m);
    queueDowntown(this, this.downtown);
    this.jobs.push(() => buildAurealisSquare(this));
    // Downtown content is queued and built in small slices over the following frames (see runJobs).
    this.downtownReady = this.jobs.length === 0;
  }

  /** Build queued downtown work for at most `budget` ms; walking outside the old town waits until it's done. */
  runJobs(budget = 8) {
    if (!this.built || this.downtownReady) return;
    const start = performance.now();
    while (this.jobs.length && performance.now() - start < budget) {
      const group = this.jobs.shift()();
      if (group) { batchStaticGeometry(group); batchCityInstances(group); this.collectDetail(group); }
    }
    if (!this.jobs.length) {
      // One final merge of all static geometry by material: far fewer draw calls for a city this size.
      batchStaticGeometry(this.district);
      this.indexColliders(); this.downtownReady = true;
    }
  }

  /** Finish everything now (tests and tools). */
  finishBuild() { this.ensureBuilt(); while (!this.downtownReady) this.runJobs(1e9); }

  /** Small instanced details (markings, bollards, flowers...) are hidden beyond ~170 m. */
  collectDetail(root) {
    root.traverse(mesh => { if (mesh.isInstancedMesh && mesh.material.userData.detail && !this.detailMeshes.includes(mesh)) {
      mesh.computeBoundingSphere(); this.detailMeshes.push(mesh); } });
  }

  updateDetail(camera, world) {
    if (this.detailAt && this.detailAt.distanceToSquared(camera) < 25) return;
    (this.detailAt ??= new THREE.Vector3()).copy(camera);
    let changed = false;
    for (const mesh of this.detailMeshes) {
      const s = mesh.boundingSphere, range = typeof mesh.material.userData.detail === 'number' ? mesh.material.userData.detail : 170;
      const visible = Math.hypot(s.center.x - camera.x, s.center.z - camera.z) - s.radius < range;
      if (mesh.visible !== visible) { mesh.visible = visible; changed = true; }
    }
    if (changed) world.renderer.shadowMap.needsUpdate = true;
  }

  /** 16 m grid over colliders, so lookups stay fast with thousands of obstacles. */
  indexColliders() {
    const grid = new Map(), cell = 16;
    for (const r of this.colliders) for (let i = Math.floor(r.minX / cell); i <= Math.floor(r.maxX / cell); i++)
      for (let j = Math.floor(r.minZ / cell); j <= Math.floor(r.maxZ / cell); j++) {
        const key = i * 4096 + j; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(r);
      }
    this.colliderGrid = grid; this.indexedCount = this.colliders.length;
  }

  /** Floor height: street level, the upper-town terrace, or a step of one of its stairs. */
  floorAt(x, z) {
    const t = TERRACE, inX = r => x >= r.minX && x <= r.maxX;
    if (inX(t.stairSouth) && z >= t.stairSouth.minZ && z < t.stairSouth.minZ + 7 * 0.45) return STREET_Y + 0.3 * (Math.floor((z - t.stairSouth.minZ) / 0.45) + 1);
    if (inX(t.stairNorth) && z >= t.stairNorth.minZ && z < t.stairNorth.minZ + 7 * 0.45) return STREET_Y + t.height - 0.3 * (Math.floor((z - t.stairNorth.minZ) / 0.45) + 1);
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return STREET_Y + t.height;
    return STREET_Y;
  }

  districtAt(x, z) {
    const t = TERRACE;
    if (rectContains(SQUARE_SITE, x, z, 1)) return 'Aurealis Square';
    return rectContains(OLD_TOWN, x, z) || (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ + 4) ? 'Old town' : 'Downtown';
  }

  /** The upper-town terrace: retaining wall, stairs at both ends of its centre passage, parapets and a row of houses. */
  addTerrace(root) {
    const m = this.materials, t = TERRACE, h = t.height, y = STREET_Y, south = t.stairSouth, north = t.stairNorth, run = 0.45;
    const block = (x0, x1, z0, z1, mat = m.whiteStone) => {
      uvMesh(root, mat, [x1 - x0, h, z1 - z0], [(x0 + x1) / 2, y + h / 2, (z0 + z1) / 2], { tile: 2.5 });
      this.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, level: y });
    };
    const landing = south.minZ + 7 * run;
    block(t.minX, south.minX, t.minZ, t.maxZ); block(south.maxX, t.maxX, t.minZ, t.maxZ); block(south.minX, south.maxX, landing, t.maxZ);
    for (let i = 0; i < 7; i++) {
      const top = 0.3 * (i + 1);
      uvMesh(root, m.whiteStone, [south.maxX - south.minX, top, run], [(south.minX + south.maxX) / 2, y + top / 2, south.minZ + run * (i + 0.5)], { tile: 2 });
      const down = h - 0.3 * (i + 1);
      uvMesh(root, m.whiteStone, [north.maxX - north.minX, down, run], [(north.minX + north.maxX) / 2, y + down / 2, north.minZ + run * (i + 0.5)], { tile: 2 });
    }
    // Flagstone lane on top and a cap along the retaining wall.
    uvMesh(root, m.paving, [t.maxX - t.minX, 0.02, t.maxZ - t.minZ], [(t.minX + t.maxX) / 2, y + h + 0.01, (t.minZ + t.maxZ) / 2], { tile: 8, shadow: false }).receiveShadow = true;
    // Parapets: south (overlooking Lemon square), ends and north, open at both stairs.
    const top = y + h, parapet = (x0, x1, z0, z1) => {
      uvMesh(root, m.whiteStone, [x1 - x0, 0.95, z1 - z0], [(x0 + x1) / 2, top + 0.475, (z0 + z1) / 2], { tile: 2 });
      uvMesh(root, m.trim, [x1 - x0 + 0.12, 0.12, z1 - z0 + 0.12], [(x0 + x1) / 2, top + 1.0, (z0 + z1) / 2], { tile: 2 });
      this.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, level: top });
    };
    parapet(t.minX, south.minX, t.minZ, t.minZ + 0.35); parapet(south.maxX, t.maxX, t.minZ, t.minZ + 0.35);
    parapet(t.minX, north.minX, t.maxZ - 0.35, t.maxZ); parapet(north.maxX, t.maxX, t.maxZ - 0.35, t.maxZ);
    parapet(t.minX, t.minX + 0.35, t.minZ, t.maxZ); parapet(t.maxX - 0.35, t.maxX, t.minZ, t.maxZ);
    for (const s of [south, north]) for (const x of [s.minX - 0.15, s.maxX + 0.15]) {
      const z0 = s === south ? s.minZ : s.minZ, z1 = s === south ? landing : s.minZ + 7 * run;
      uvMesh(root, m.whiteStone, [0.3, s === south ? h + 0.95 : h + 0.95, z1 - z0], [x, y + (h + 0.95) / 2, (z0 + z1) / 2], { tile: 2 });
    }
    // Upper-town houses behind the lane, leaving the centre passage clear.
    const random = seededRandom(1207), plots = [];
    for (const [from, to] of [[t.minX + 1, south.minX - 2], [south.maxX + 2, t.maxX - 1]]) {
      for (let x = from; to - x >= 9;) {
        let width = 10.5 + Math.round(random() * 6) / 2; const gap = 1.6 + random() * 1.4;
        if (to - x - width - gap < 10.5) width = Math.min(15, to - x);
        plots.push({ x: x + width / 2, z: -34, width, depth: 14, y0: h, row: 'terrace', seed: 1200 + plots.length });
        x += width + gap;
      }
    }
    for (const plot of plots) this.colliders.push({ ...buildHouse(root, m, plot), level: top });
  }

  /** Weathered stretches of the old town wall with towers, one gateway and a plaque each. */
  addWallRelics(root) {
    const m = this.materials, y = STREET_Y, random = seededRandom(1414);
    for (const relic of WALL_RELICS) {
      for (let i = 0; i < relic.points.length - 1; i++) {
        const [x0, z0] = relic.points[i], [x1, z1] = relic.points[i + 1], alongX = Math.abs(z1 - z0) < 0.01;
        const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
        const gate = relic.gate && !alongX ? relic.gate : null;
        const pieces = gate ? [[a0, gate.z - gate.width / 2 - 1.2], [gate.z + gate.width / 2 + 1.2, a1]] : [[a0, a1]];
        for (const [p0, p1] of pieces) {
          if (p1 - p0 < 0.5) continue;
          for (let a = p0; a < p1 - 0.01;) {
            const len = Math.min(p1 - a, 3 + random() * 3), hgt = 3.8 + random() * 1.2, mid = a + len / 2;
            const pos = alongX ? [mid, y + hgt / 2, c] : [c, y + hgt / 2, mid], size = alongX ? [len, hgt, 1.4] : [1.4, hgt, len];
            uvMesh(root, random() < 0.25 ? m.oldWallDark : m.oldWall, size, pos, { tile: 2.2 });
            for (let k = a + 0.4; k < a + len - 0.5; k += 1.6) if (random() < 0.8) {
              const mp = alongX ? [k + 0.4, y + hgt + 0.45, c] : [c, y + hgt + 0.45, k + 0.4];
              uvMesh(root, m.oldWall, alongX ? [0.8, 0.9, 1.4] : [1.4, 0.9, 0.8], mp, { tile: 2.2 });
            }
            a += len;
          }
          this.colliders.push(alongX ? { minX: p0, maxX: p1, minZ: c - 0.7, maxZ: c + 0.7 } : { minX: c - 0.7, maxX: c + 0.7, minZ: p0, maxZ: p1 });
        }
        if (gate) {
          // Gateway: one solid stone face with a round-arched opening over the old lane, crenellated on top.
          const g = new THREE.Group(); g.position.set(c, y, gate.z); g.rotation.y = Math.PI / 2; root.add(g);
          const W = gate.width / 2 + 1.6, H = 9.4, spring = 4.4, r = gate.width / 2, shape = new THREE.Shape();
          shape.moveTo(-W, 0); shape.lineTo(W, 0); shape.lineTo(W, H); shape.lineTo(-W, H); shape.closePath();
          const hole = new THREE.Path(); hole.moveTo(-r, 0); hole.lineTo(r, 0); hole.lineTo(r, spring);
          hole.absarc(0, spring, r, 0, Math.PI, false); hole.lineTo(-r, 0); shape.holes.push(hole);
          const face = new THREE.ExtrudeGeometry(shape, { depth: 1.8, bevelEnabled: false, curveSegments: 18 }).translate(0, 0, -0.9);
          const uv = face.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.2, uv.getY(i) / 2.2);
          const gateMesh = new THREE.Mesh(face, m.oldWall); gateMesh.castShadow = gateMesh.receiveShadow = true; gateMesh.name = 'OldTownGate'; g.add(gateMesh);
          uvMesh(g, m.oldWallDark, [2 * W + 0.4, 0.5, 2.1], [0, H - 0.6, 0], { tile: 2.2 });
          for (let k = -W + 0.4; k <= W - 0.4; k += 1.6) uvMesh(g, m.oldWall, [0.8, 0.9, 1.8], [k, H + 0.45, 0], { tile: 2.2 });
          for (const s of [-1, 1]) this.colliders.push({ minX: c - 0.8, maxX: c + 0.8, minZ: gate.z + s * (gate.width / 2 + 0.8) - 0.8, maxZ: gate.z + s * (gate.width / 2 + 0.8) + 0.8 });
        }
      }
      // A square tower with slit windows.
      const [tx, tz] = relic.tower;
      uvMesh(root, m.oldWall, [5.6, 10, 5.6], [tx, y + 5, tz], { tile: 2.2 });
      for (let k = -2.4; k <= 2.4; k += 1.6) for (const [dx, dz, sx, sz] of [[k, -2.6, 0.8, 0.6], [k, 2.6, 0.8, 0.6], [-2.6, k, 0.6, 0.8], [2.6, k, 0.6, 0.8]])
        uvMesh(root, m.oldWall, [sx, 1.0, sz], [tx + dx, y + 10.5, tz + dz], { tile: 2.2 });
      for (const [dx, dz, ry] of [[0, 2.81, 0], [0, -2.81, Math.PI], [2.81, 0, Math.PI / 2], [-2.81, 0, -Math.PI / 2]])
        box(root, m.dark, [0.22, 1.2, 0.04], [tx + dx, y + 6.5, tz + dz], { rotation: [0, ry, 0] });
      this.colliders.push({ minX: tx - 2.8, maxX: tx + 2.8, minZ: tz - 2.8, maxZ: tz + 2.8 });
      // Plaque on the town-facing side of the first stretch.
      const [px, pz] = relic.points[0], [qx, qz] = relic.points[1], alongX = Math.abs(qz - pz) < 0.01;
      const mid = alongX ? [(px + qx) / 2, pz] : [px, (pz + qz) / 2], inward = alongX ? (pz > -200 ? -1 : 1) : (px < 0 ? 1 : -1);
      const pos = alongX ? [mid[0], y + 2.2, mid[1] + inward * 0.72] : [mid[0] + inward * 0.72, y + 2.2, mid[1]];
      const ry = alongX ? (inward > 0 ? 0 : Math.PI) : (inward > 0 ? Math.PI / 2 : -Math.PI / 2);
      label(root, 'THE OLD TOWN WALL', 1.9, 0.42, pos, { background: '#6f5a2e', color: '#f3e6c2', fontSize: 92, border: true, rotation: [0, ry, 0] });
    }
  }


  addFountain(kit, x, z) {
    const m = this.materials, root = this.district;
    cylinder(root, m.whiteStone, 2.3, 0.65, [x, STREET_Y + 0.325, z], [0,0,0], 24);
    cylinder(root, m.trim, 2.42, 0.12, [x, STREET_Y + 0.7, z], [0,0,0], 24);
    cylinder(root, m.water, 2.0, 0.04, [x, STREET_Y + 0.66, z], [0,0,0], 24);
    cylinder(root, m.whiteStone, 0.3, 2.2, [x, STREET_Y + 1.1, z], [0,0,0], 16);
    cylinder(root, m.trim, 0.85, 0.16, [x, STREET_Y + 1.9, z], [0,0,0], 20);
    cylinder(root, m.water, 0.72, 0.03, [x, STREET_Y + 1.99, z], [0,0,0], 20);
    addPot(kit, m, x, z, STREET_Y + 1.98, 9, 0.8);
    this.colliders.push({minX:x-2.3,maxX:x+2.3,minZ:z-2.3,maxZ:z+2.3});
  }

  /** Ragged lawn patches at house corners, along the canal quays and in quiet corners of the squares. */
  addGrass(kit, roadRects) {
    const random = seededRandom(515), spots = [];
    for (const p of CITY_PLOTS) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (random() < 0.45) continue;
      spots.push([p.x + sx * (p.width / 2 + 0.7), p.z + sz * (p.depth / 2 + 0.7), 1.6 + random() * 1.6]);
    }
    for (let x = this.bounds.minX + 4; x < this.bounds.maxX - 3; x += 7 + random() * 8)
      for (const z of [-327.2, -339.8]) if (!this.bridges.some(b => x > b.minX - 2 && x < b.maxX + 2)) spots.push([x, z + (random() - 0.5) * 0.6, 1.4 + random() * 1.2]);
    for (const [x, z] of [[-30.5,-252.5],[-1.5,-221],[-124,-253],[-84,-221.5],[56.5,-163.5],[112,-193.5],[-31,-55],[0.5,-55]]) spots.push([x, z, 2 + random()]);
    const avoid = [...roadRects, ...CITY_SHAMIANAS.map(q => ({ minX: q.x - q.w / 2, maxX: q.x + q.w / 2, minZ: q.z - q.d / 2, maxZ: q.z + q.d / 2 })),
      { minX: this.bounds.minX, maxX: this.bounds.maxX, minZ: -338.4, maxZ: -328.6 }, this.entrance.worldBounds];
    addGrassPatches(kit, this.materials, spots, avoid);
  }

  /** Bunting over streets and squares, washing across the narrow lanes. Anchors sit on real facades. */
  addStringLines(kit) {
    const m = this.materials, random = seededRandom(404), plotsAt = z => CITY_PLOTS.filter(p => p.z === z);
    // Narrow lanes between back-to-back rows: [south row z, north row z].
    for (const [south, north] of [[-292, -267], [-207, -178], [-178, -150]]) {
      const zs = plotsAt(south)[0], zn = plotsAt(north)[0];
      const faceS = south + zs.depth / 2, faceN = north - zn.depth / 2;
      for (const p of plotsAt(north)) {
        if (!plotsAt(south).some(q => q.x === p.x)) continue;
        const x = p.x + (random() - 0.5) * (p.width - 3), y = STREET_Y + 5.2 + random() * 1.2;
        addWashing(kit, m, [x, y, faceS + 0.05], [x + (random() - 0.5) * 2, y + 0.2, faceN - 0.05], p.seed);
      }
    }
    // Zig-zag bunting down the two long north-south streets.
    const span = (xa, xb, zs, seed) => { for (const [i, z] of zs.entries()) addBunting(kit, m, [xa, STREET_Y + 6.6, z], [xb, STREET_Y + 6.4, z + (i % 2 ? -5 : 5)], seed + i, 1.1); };
    span(-113.5, -93.5, [-298, -284, -213, -200, -160, -146], 600);
    span(69.5, 98, [-299, -287, -212, -201, -155, -144, -110, -98], 620);
    // Over the squares, anchored on the houses that frame them.
    for (const [i, z] of [-60, -66, -72].entries()) addBunting(kit, m, [-33, STREET_Y + 6.8, z], [2.5, STREET_Y + 6.8, z + 3], 640 + i, 1.6);
    addBunting(kit, m, [-34, STREET_Y + 7.2, -256], [3.5, STREET_Y + 7.2, -218], 650, 2.2);
    addBunting(kit, m, [3.5, STREET_Y + 7.2, -256], [-34, STREET_Y + 7.2, -218], 651, 2.4);
    for (const [i, x] of [-124, -118, -91, -85].entries()) addBunting(kit, m, [x, STREET_Y + 6.9, -256], [x + 4, STREET_Y + 6.9, -218], 660 + i, 1.8);
  }

  addCanalWall(x0,x1,z) {
    box(this.district,this.materials.stone,[x1-x0,1.0,.38],[(x0+x1)/2,STREET_Y+.5,z]);
    this.colliders.push({minX:x0,maxX:x1,minZ:z-.19,maxZ:z+.19});
  }

  findSurface(x,z,feetY,maxStep=.45,radius=.24) {
    if(feetY<STREET_Y-maxStep || feetY>STREET_Y+TERRACE.height+maxStep || !rectContains(this.bounds,x,z,-radius)) return null;
    const floorY=this.floorAt(x,z);
    if(Math.abs(feetY-floorY)>maxStep) return null;
    this.ensureBuilt();
    if(!this.downtownReady && !rectContains(OLD_TOWN,x,z,-radius)) return null;
    if(rectContains(this.entrance.shaftBounds,x,z,radius)) return null;
    if(rectContains(this.canal,x,z,radius) && !this.bridges.some(b=>rectContains(b,x,z,-radius))) return null;
    if(this.indexedCount!==this.colliders.length) this.indexColliders();
    const cell=16,hit=r=>{
      if(r.level!==undefined && Math.abs(r.level-floorY)>0.2) return false;
      const xx=THREE.MathUtils.clamp(x,r.minX,r.maxX),zz=THREE.MathUtils.clamp(z,r.minZ,r.maxZ);
      return (xx-x)**2+(zz-z)**2<radius**2;
    };
    for(let i=Math.floor((x-radius)/cell);i<=Math.floor((x+radius)/cell);i++)
      for(let j=Math.floor((z-radius)/cell);j<=Math.floor((z+radius)/cell);j++)
        if(this.colliderGrid.get(i*4096+j)?.some(hit)) return null;
    return {floorY,kind:'city',difference:Math.abs(feetY-floorY)};
  }

  /** Daylight grade for the street: the shared key light becomes the sun while outdoors. */
  enterDaylight(world) {
    const key = world.lighting.keyLight, hemi = world.scene.children.find(o => o.isHemisphereLight);
    this.savedLighting = { color: key.color.clone(), intensity: key.intensity, exposure: world.renderer.toneMappingExposure, environment: world.scene.environmentIntensity,
      hemi: hemi && { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), intensity: hemi.intensity }, hemiLight: hemi };
    this.applyDaylight(world);
  }

  /** Sky, sun or moon, ambient light, fog, exposure and night glow for the current time of day. */
  applyDaylight(world) {
    const state = daylightState(dayClock.hours, this.daylight), u = this.sky.material.uniforms;
    u.zenith.value.copy(state.zenith); u.mid.value.copy(state.mid); u.horizon.value.copy(state.horizon);
    u.glowColor.value.copy(state.keyColor); u.glow.value = state.glow; u.night.value = state.night;
    u.sun.value.copy(state.sun); u.moon.value.copy(state.moon);
    this.background.copy(state.horizon);
    this.fog.color.copy(state.horizon).lerp(state.mid, 0.15);
    const key = world.lighting.keyLight, hemi = this.savedLighting?.hemiLight;
    key.color.copy(state.keyColor); key.intensity = state.keyIntensity;
    if (hemi) { hemi.color.copy(state.hemiSky); hemi.groundColor.copy(state.hemiGround); hemi.intensity = state.hemiIntensity; }
    // The cool bounce light opposite the sun fades out at night.
    this.sun.color.copy(state.hemiSky); this.sun.intensity = 0.55 * (1 - state.night) + 0.08;
    world.renderer.toneMappingExposure = state.exposure;
    // The shared image-based fill (a neutral room) would light the street like dusk all night.
    world.scene.environmentIntensity = this.savedLighting.environment * (1 - 0.86 * state.night);
    NIGHT_UNIFORMS.night.value = state.night; NIGHT_UNIFORMS.lit.value = state.lit;
    // Street lamps: a soft glow by day, bright after dusk.
    this.materials.lanternGlass.emissiveIntensity = 0.55 + 3.2 * state.night;
    return state;
  }

  leaveDaylight(world) {
    const saved = this.savedLighting; if (!saved) return;
    const key = world.lighting.keyLight;
    key.color.copy(saved.color); key.intensity = saved.intensity; world.renderer.toneMappingExposure = saved.exposure;
    world.scene.environmentIntensity = saved.environment;
    if (saved.hemiLight) { saved.hemiLight.color.copy(saved.hemi.sky); saved.hemiLight.groundColor.copy(saved.hemi.ground); saved.hemiLight.intensity = saved.hemi.intensity; }
    this.savedLighting = null;
  }

  applyRendering(player,world) {
    const feet=player.camera.position.y-1.76;
    const inAccess=player.transferSurface?.transfer===this.entrance;
    const active=player.surfaceExploring || (inAccess && feet>4);
    this.justReturned=this.active && !active;
    this.district.visible=active; this.sun.visible=active; this.sky.visible=active;
    if(active) {
      this.ensureBuilt();
      world.scene.fog=this.fog;world.scene.background=this.background;
      this.sky.position.copy(player.camera.position);
      if(world.camera.far!==1100){world.camera.far=1100;world.camera.updateProjectionMatrix();}
      this.runJobs();
      if(this.tickers) { const t=performance.now()*0.00003; this.tickers.forEach((tk,i)=>{ tk.offset.x=(t*(1+i%3*0.3))%1; }); }
      this.updateDetail(player.camera.position,world);
      if(world.city)world.city.visible=false;
      if(world.phase6World){world.phase6World.visible=false;world.phase6World.sun.visible=false;}
      const key=world.lighting.keyLight;
      if(!this.active) {
        Object.assign(key.shadow.camera,{left:-90,right:90,top:90,bottom:-90,far:LIGHT_DISTANCE+700});
        key.shadow.camera.updateProjectionMatrix();world.renderer.shadowMap.needsUpdate=true;
        this.enterDaylight(world);
      }
      // The key light follows the sun (or the moon at night), far enough out that tall towers stay inside the shadow camera.
      const state=this.applyDaylight(world),dir=state.light;
      key.position.set(player.camera.position.x+dir.x*LIGHT_DISTANCE,STREET_Y+dir.y*LIGHT_DISTANCE,player.camera.position.z+dir.z*LIGHT_DISTANCE);
      key.target.position.set(player.camera.position.x,STREET_Y,player.camera.position.z);
      // Shadows refresh after 2 m of walking, or once the sun has moved about a third of a degree.
      if(!this.shadowPosition || this.shadowPosition.distanceToSquared(player.camera.position)>4 || this.shadowDirection.dot(dir)<0.99998){
        this.shadowPosition??=new THREE.Vector3();this.shadowPosition.copy(player.camera.position);
        (this.shadowDirection??=new THREE.Vector3()).copy(dir);world.renderer.shadowMap.needsUpdate=true;
      }
      world.lighting.usePlatform(this.entrance.name,player.camera.position);
    } else if(this.active) {
      this.leaveDaylight(world);
      world.scene.fog=world.undergroundFog;world.scene.background=world.undergroundBackground;
      world.camera.far=180;world.camera.updateProjectionMatrix();
      Object.assign(world.lighting.keyLight.shadow.camera,{left:-37,right:37,top:30,bottom:-30,far:75});
      world.lighting.keyLight.shadow.camera.updateProjectionMatrix();world.renderer.shadowMap.needsUpdate=true;
      world.lighting.currentPlatformId=null;
    }
    this.active=active;
    return active;
  }
}
