import * as THREE from 'three';
import { box, cylinder, label, seededRandom } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { STREET_Y, CITY_BOUNDS, CITY_PLOTS, CITY_ROUTES, CITY_SQUARES, CITY_SHAMIANAS, CITY_ARRIVAL, CENTRAL_EXIT, rectContains } from './city-layout.js';
import { buildRoads, addShamiana, addGrassPatches } from './city-roads.js';
import { createCityMaterials, buildHouse, buildClockTower, batchCityInstances, uvMesh } from './city-buildings.js';
import { PropKit, addPalm, addCitrus, addCafe, addPlanter, addBunting, addWashing, addLamp, addBench, addPot } from './city-props.js';
import { SurfaceEntrance } from './surface-entrance.js';

// Mediterranean daylight: deep blue zenith, pale haze at the horizon, warm hard sun.
const SKY = Object.freeze({ zenith: '#0f3fb8', mid: '#2f7fe0', horizon: '#a9d8f0', haze: '#bfe0f0' });
const SUN = Object.freeze({ color: '#fff0d2', intensity: 3.4, offset: [-62, 78, -48] });

function createSkyDome() {
  const material = new THREE.ShaderMaterial({
    uniforms: { zenith: { value: new THREE.Color(SKY.zenith) }, mid: { value: new THREE.Color(SKY.mid) },
      horizon: { value: new THREE.Color(SKY.horizon) }, sun: { value: new THREE.Vector3(...SUN.offset).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sun; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.16, 0.85, h));
        float glow = pow(max(dot(normalize(vDir), sun), 0.0), 24.0);
        col += vec3(1.0, 0.93, 0.78) * glow * 0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(440, 32, 16), material);
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
    this.built = false; this.active = false;
    this.background = new THREE.Color(SKY.horizon); this.fog = new THREE.Fog(SKY.haze, 150, 470);
    // Cool sky bounce from the side opposite the sun; the shadowed key light is the sun.
    this.sun = new THREE.DirectionalLight('#9cc4ff', 0.55); this.sun.position.set(80, 60, 120); this.sun.target.position.set(-16, 10, -200);
    this.sun.visible = false; this.add(this.sun, this.sun.target);
    this.sky = createSkyDome(); this.add(this.sky);
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
      worldUV(box(root, m.paving, [x1 - x0, 0.2, z1 - z0], [(x0 + x1) / 2, STREET_Y - 0.1, (z0 + z1) / 2]),x1-x0,z1-z0);
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
    this.bridges = [-104, -16.2, 84].map(x => ({ minX: x - 4, maxX: x + 4, minZ: -339, maxZ: -328 }));
    for (const bridge of this.bridges) {
      // The deck meets the quay exactly. Logical approach bounds overlap land,
      // but another coplanar finish at either end would cause floor shimmer.
      box(root, m.stone, [8, 0.42, 9], [(bridge.minX + bridge.maxX) / 2, STREET_Y - 0.21, -333.5]);
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
    this.addBackdrop();
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
    // Visible enclosure matches the finite playable district, with no invisible exits.
    for (const x of [b.minX-.3,b.maxX+.3]) box(root,m.whiteStone,[.6,2.1,b.maxZ-b.minZ+1.2],[x,STREET_Y+1.05,(b.minZ+b.maxZ)/2]);
    for (const z of [b.minZ-.3,b.maxZ+.3]) box(root,m.whiteStone,[b.maxX-b.minX+.6,2.1,.6],[(b.minX+b.maxX)/2,STREET_Y+1.05,z]);
    label(root,'CENTRAL  ·  ALTSTADT',6.5,.38,[-16.2,STREET_Y+.026,-215],{rotation:[-Math.PI/2,0,0],background:'#e9e1cc',color:'#6b4a2e',fontSize:100});
    this.colliders.push(...this.entrance.facadeColliders);
    // Outer access walls are physical obstacles on street level as well.
    const tower=this.entrance.towers[0].group;
    for(const side of [-1,1]) this.colliders.push({minX:tower.position.x+side*3.15-.12,maxX:tower.position.x+side*3.15+.12,minZ:tower.position.z+4.1,maxZ:tower.position.z+23.8});
    batchStaticGeometry(root);
    this.userData.combinedInstanceGroups=batchCityInstances(root);
    this.built=true;
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

  /** Non-walkable terraces beyond the perimeter, so every street ends in more town, not void. */
  addBackdrop() {
    const m = this.materials, root = this.district, b = this.bounds, random = seededRandom(909);
    const rows = [];
    const along = (from, to, make) => {
      for (let t = from; to - t >= 9;) {
        let width = 10.5 + Math.round(random() * 7) / 2; const gap = 1.5 + random() * 2;
        if (to - t - width - gap < 10.5) width = Math.min(16, to - t);
        make(t + width / 2, width); t += width + gap;
      }
    };
    // North: an upper town on a retaining wall, with a stair rising out of Lemon square.
    const north = { z0: b.maxZ + 0.6, z1: -44.6, y: 2.4 }, stair = { minX: -19.2, maxX: -13.2 };
    for (const [x0, x1] of [[b.minX - 16, stair.minX], [stair.maxX, b.maxX + 16]]) {
      const w = x1 - x0, cx = (x0 + x1) / 2, cz = (north.z0 + north.z1) / 2, d = north.z1 - north.z0;
      uvMesh(root, m.whiteStone, [w, north.y, d], [cx, STREET_Y + north.y / 2, cz], { tile: 2.5 });
      uvMesh(root, m.trim, [w, 0.16, 0.5], [cx, STREET_Y + north.y + 0.08, north.z0 + 0.2], { tile: 2 });
    }
    for (let i = 0; i < 8; i++) {
      const rise = north.y / 8, run = (north.z1 - north.z0 - 1.2) / 8;
      uvMesh(root, m.whiteStone, [stair.maxX - stair.minX, rise * (i + 1), run], [(stair.minX + stair.maxX) / 2, STREET_Y + rise * (i + 1) / 2, north.z0 + run * (i + 0.5)], { tile: 2 });
    }
    uvMesh(root, m.whiteStone, [stair.maxX - stair.minX, north.y, 1.2], [(stair.minX + stair.maxX) / 2, STREET_Y + north.y / 2, north.z1 - 0.6], { tile: 2 });
    const northHouse = (x, width) => rows.push({ x, z: (north.z0 + north.z1) / 2, width, depth: north.z1 - north.z0 - 0.2, y0: north.y, backdrop: 'nz', row: 'north', seed: 900 + rows.length });
    along(b.minX - 14, stair.minX - 0.6, northHouse);
    along(stair.maxX + 0.6, b.maxX + 14, northHouse);
    // South beyond the canal quay, west and east beyond the side walls (rotated so their fronts face the town).
    along(b.minX - 14, b.maxX + 14, (x, width) => rows.push({ x, z: b.minZ - 4.4, width, depth: 7, backdrop: 'pz', row: 'south', seed: 900 + rows.length }));
    along(-b.maxZ + 6, -b.minZ - 4, (t, width) => {
      rows.push({ x: b.minX - 4.4, z: -t, width, depth: 7, rotation: Math.PI / 2, backdrop: 'pz', row: 'west', seed: 900 + rows.length });
      rows.push({ x: b.maxX + 4.4, z: -t, width, depth: 7, rotation: Math.PI / 2, backdrop: 'nz', row: 'east', seed: 1900 + rows.length });
    });
    for (const plot of rows) buildHouse(root, m, plot);
    // Ground under the outer rows so alleys between them show paving, not sky.
    for (const [sx, sz, px, pz] of [[b.maxX - b.minX + 40, 12, (b.minX + b.maxX) / 2, b.minZ - 6.6], [12, b.maxZ - b.minZ + 20, b.minX - 6.6, (b.minZ + b.maxZ) / 2], [12, b.maxZ - b.minZ + 20, b.maxX + 6.6, (b.minZ + b.maxZ) / 2]])
      box(root, m.paving, [sx, 0.2, sz], [px, STREET_Y - 0.1, pz], { shadow: false });
  }

  addCanalWall(x0,x1,z) {
    box(this.district,this.materials.stone,[x1-x0,1.0,.38],[(x0+x1)/2,STREET_Y+.5,z]);
    this.colliders.push({minX:x0,maxX:x1,minZ:z-.19,maxZ:z+.19});
  }

  findSurface(x,z,feetY,maxStep=.45,radius=.24) {
    if(Math.abs(feetY-STREET_Y)>maxStep || !rectContains(this.bounds,x,z,-radius)) return null;
    this.ensureBuilt();
    if(rectContains(this.entrance.shaftBounds,x,z,radius)) return null;
    if(rectContains(this.canal,x,z,radius) && !this.bridges.some(b=>rectContains(b,x,z,-radius))) return null;
    if(this.colliders.some(r=>{
      const xx=THREE.MathUtils.clamp(x,r.minX,r.maxX),zz=THREE.MathUtils.clamp(z,r.minZ,r.maxZ);
      return (xx-x)**2+(zz-z)**2<radius**2;
    })) return null;
    return {floorY:STREET_Y,kind:'city',difference:Math.abs(feetY-STREET_Y)};
  }

  /** Daylight grade for the street: the shared key light becomes the sun while outdoors. */
  enterDaylight(world) {
    const key = world.lighting.keyLight, hemi = world.scene.children.find(o => o.isHemisphereLight);
    this.savedLighting = { color: key.color.clone(), intensity: key.intensity, exposure: world.renderer.toneMappingExposure,
      hemi: hemi && { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), intensity: hemi.intensity }, hemiLight: hemi };
    key.color.set(SUN.color); key.intensity = SUN.intensity; world.renderer.toneMappingExposure = 0.95;
    if (hemi) { hemi.color.set('#cfe3ff'); hemi.groundColor.set('#c8b08a'); hemi.intensity = 1.0; }
  }

  leaveDaylight(world) {
    const saved = this.savedLighting; if (!saved) return;
    const key = world.lighting.keyLight;
    key.color.copy(saved.color); key.intensity = saved.intensity; world.renderer.toneMappingExposure = saved.exposure;
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
      if(world.camera.far!==480){world.camera.far=480;world.camera.updateProjectionMatrix();}
      if(world.city)world.city.visible=false;
      if(world.phase6World){world.phase6World.visible=false;world.phase6World.sun.visible=false;}
      const key=world.lighting.keyLight;
      if(!this.active) {
        Object.assign(key.shadow.camera,{left:-55,right:55,top:55,bottom:-55,far:220});
        key.shadow.camera.updateProjectionMatrix();world.renderer.shadowMap.needsUpdate=true;
        this.enterDaylight(world);
      }
      key.position.set(player.camera.position.x+SUN.offset[0],STREET_Y+SUN.offset[1],player.camera.position.z+SUN.offset[2]);
      key.target.position.set(player.camera.position.x,STREET_Y,player.camera.position.z);
      if(!this.shadowPosition || this.shadowPosition.distanceToSquared(player.camera.position)>4){
        this.shadowPosition??=new THREE.Vector3();this.shadowPosition.copy(player.camera.position);world.renderer.shadowMap.needsUpdate=true;
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
