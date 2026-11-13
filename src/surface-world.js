import * as THREE from 'three';
import { box, instances, label, cylinder } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { STREET_Y, CITY_BOUNDS, CITY_PLOTS, CITY_ROUTES, rectContains } from './city-layout.js';
import { createCityMaterials, buildHouse, buildTree, buildClockTower, batchCityInstances } from './city-buildings.js';
import { SurfaceEntrance } from './surface-entrance.js';

/** A walkable district, separate from the retained U5/U10 scenic environments. */
export class SurfaceWorld extends THREE.Group {
  constructor(baseMaterials, station) {
    super(); this.name = 'CentralOldTownSurface'; this.streetY = STREET_Y;
    this.bounds = CITY_BOUNDS; this.routes = CITY_ROUTES; this.colliders = [];
    this.materials = createCityMaterials(baseMaterials);
    this.entrance = new SurfaceEntrance(this.materials, station);
    this.district = new THREE.Group(); this.district.name = 'CentralOldTownDistrict'; this.district.visible = false; this.add(this.district);
    this.built = false; this.active = false;
    this.background = new THREE.Color('#b7c7c6'); this.fog = new THREE.Fog('#b7c7c6', 180, 420);
    this.sun = new THREE.DirectionalLight('#fff0d5', 0.35); this.sun.position.set(-100, 160, -300); this.sun.target.position.set(-16, 10, -230);
    this.sun.visible = false; this.add(this.sun, this.sun.target);
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
    // Reusable paving bands establish a connected street hierarchy.
    for (const x of [-104, -16.2, 84]) {
      if (x !== -16.2) worldUV(box(root, m.road, [9, 0.012, 220], [x, STREET_Y + 0.006, -211.5], { shadow: false }),9,220);
      else for (const [a,b] of [[-321.5,access.minZ],[hole.maxZ,-101.5]])
        worldUV(box(root,m.road,[9,.012,b-a],[x,STREET_Y+.006,(a+b)/2],{shadow:false}),9,b-a);
    }
    for (const z of [-120, -234, -320]) worldUV(box(root, m.road, [252, 0.014, 8], [-14, STREET_Y + 0.007, z], { shadow: false }),252,8);
    for(const x of [-21.0,-11.4])box(root,m.pale,[.16,.016,116],[x,STREET_Y+.02,-262],{shadow:false});
    const joints = [];
    for (let z = -252; z <= -217; z += 1.5) joints.push({ size: [37, 0.004, 0.035], position: [-16.2, STREET_Y + 0.018, z] });
    for (let x = -34; x <= 2; x += 1.5) joints.push({ size: [0.035, 0.004, 36], position: [x, STREET_Y + 0.018, -234.5] });
    instances(root, m.grout, joints, undefined, false).name = 'CentralSquareStoneJoints';
    for (const plot of CITY_PLOTS) this.colliders.push(buildHouse(root, m, plot));
    this.colliders.push(buildClockTower(root, m, -135, -128));
    for (const [i, [x, z]] of [[62,-177],[77,-177],[94,-177],[64,-193],[94,-193],[76,-165],[94,-161],[-137,-234],[-122,-244],[-37,-240],[5,-240],[-37,-225],[5,-225],[-30,-211],[-2,-211]].entries()) {
      this.colliders.push(buildTree(root, m, x, z, i));
      box(root, m.grass, [4.6, 0.01, 4.6], [x, STREET_Y + 0.005, z], { shadow: false });
    }
    for (const [x, z] of [[69,-188],[88,-188],[-119,-244],[-30,-222],[0,-222]]) {
      box(root, m.wood, [0.65, 0.15, 3.4], [x, STREET_Y + 0.5, z]);
      for (const dz of [-1.25,1.25]) box(root, m.dark, [0.52, 0.48, 0.12], [x, STREET_Y + 0.24, z + dz]);
      this.colliders.push({ minX:x-.4,maxX:x+.4,minZ:z-1.75,maxZ:z+1.75 });
    }
    // A stone basin gives the western market a landmark at walking scale.
    const basinX = -85, basinZ = -237;
    cylinder(root, m.stone, 2.3, 0.65, [basinX, STREET_Y + 0.325, basinZ], [0,0,0], 24);
    cylinder(root, m.water, 1.95, 0.04, [basinX, STREET_Y + 0.66, basinZ], [0,0,0], 24);
    cylinder(root, m.pale, 0.3, 2.2, [basinX, STREET_Y + 1.1, basinZ], [0,0,0], 16);
    this.colliders.push({minX:basinX-2.3,maxX:basinX+2.3,minZ:basinZ-2.3,maxZ:basinZ+2.3});
    const poles = [], lamps = [];
    for (const z of [-125,-241,-314]) for (const x of [-110,-25,77]) {
      poles.push({size:[.12,4.8,.12],position:[x,STREET_Y+2.4,z]});
      lamps.push({size:[.36,.55,.36],position:[x,STREET_Y+4.8,z]});
      this.colliders.push({minX:x-.1,maxX:x+.1,minZ:z-.1,maxZ:z+.1});
    }
    for(const x of [-27,-5]){
      poles.push({size:[.12,4.8,.12],position:[x,STREET_Y+2.4,-204]});
      lamps.push({size:[.36,.55,.36],position:[x,STREET_Y+4.8,-204]});
      this.colliders.push({minX:x-.1,maxX:x+.1,minZ:-204.1,maxZ:-203.9});
    }
    instances(root,m.dark,poles); instances(root,m.warmLight,lamps,undefined,false);
    // Visible enclosure matches the finite playable district, with no invisible exits.
    for (const x of [b.minX-.3,b.maxX+.3]) box(root,m.stone,[.6,2.1,b.maxZ-b.minZ+1.2],[x,STREET_Y+1.05,(b.minZ+b.maxZ)/2]);
    for (const z of [b.minZ-.3,b.maxZ+.3]) box(root,m.stone,[b.maxX-b.minX+.6,2.1,.6],[(b.minX+b.maxX)/2,STREET_Y+1.05,z]);
    label(root,'CENTRAL  ·  ALTSTADT',6.5,.38,[-16.2,STREET_Y+.024,-215],{rotation:[-Math.PI/2,0,0],background:'#c8c0ae',color:'#545f51',fontSize:100});
    this.colliders.push(...this.entrance.facadeColliders);
    // Outer access walls are physical obstacles on street level as well.
    const tower=this.entrance.towers[0].group;
    for(const side of [-1,1]) this.colliders.push({minX:tower.position.x+side*3.15-.12,maxX:tower.position.x+side*3.15+.12,minZ:tower.position.z+4.1,maxZ:tower.position.z+23.8});
    batchStaticGeometry(root);
    this.userData.combinedInstanceGroups=batchCityInstances(root);
    this.built=true;
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

  applyRendering(player,world) {
    const feet=player.camera.position.y-1.76;
    const inAccess=player.transferSurface?.transfer===this.entrance;
    const active=player.surfaceExploring || (inAccess && feet>4);
    this.justReturned=this.active && !active;
    this.district.visible=active; this.sun.visible=active;
    if(active) {
      this.ensureBuilt();
      world.scene.fog=this.fog;world.scene.background=this.background;
      if(world.camera.far!==480){world.camera.far=480;world.camera.updateProjectionMatrix();}
      if(world.city)world.city.visible=false;
      if(world.phase6World){world.phase6World.visible=false;world.phase6World.sun.visible=false;}
      const key=world.lighting.keyLight;
      if(!this.active) {
        Object.assign(key.shadow.camera,{left:-55,right:55,top:55,bottom:-55,far:220});
        key.shadow.camera.updateProjectionMatrix();world.renderer.shadowMap.needsUpdate=true;
      }
      key.position.set(player.camera.position.x-40,100,player.camera.position.z-55);
      key.target.position.set(player.camera.position.x,STREET_Y,player.camera.position.z);
      if(!this.shadowPosition || this.shadowPosition.distanceToSquared(player.camera.position)>4){
        this.shadowPosition??=new THREE.Vector3();this.shadowPosition.copy(player.camera.position);world.renderer.shadowMap.needsUpdate=true;
      }
      world.lighting.usePlatform(this.entrance.name,player.camera.position);
    } else if(this.active) {
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
