import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const context=new Proxy({}, {get:(t,k)=>k in t?t[k]:k==='measureText'?s=>({width:s.length*12}):()=>{}});
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
const {createMaterials}=await import('../src/materials.js');
const {createPhase6Network}=await import('../src/phase6-network.js');
const {addU10ToNetwork}=await import('../src/u10-network.js');
const {MetroRoute}=await import('../src/route.js');
const {NetworkLineWorld}=await import('../src/network-world.js');
const {SurfaceWorld}=await import('../src/surface-world.js');
const {CITY_ROUTES,STREET_Y}=await import('../src/city-layout.js');
const network=createPhase6Network();addU10ToNetwork(network);
const materials=createMaterials(),scene=new THREE.Group();
const worlds=['U1','U2','U3','U4'].map(id=>{
 const route=new MetroRoute(network,id);if(id==='U4')route.surfaceExitEnabled=true;
 return new NetworkLineWorld(materials,route);
});scene.add(...worlds);scene.updateMatrixWorld(true);
const surface=new SurfaceWorld(materials,worlds[3].central);surface.ensureBuilt();scene.add(surface,surface.entrance);scene.updateMatrixWorld(true);
const e=surface.entrance,records=[];
scene.traverse(mesh=>{if(mesh.isMesh && !mesh.material?.isMeshBasicMaterial)records.push({mesh,bounds:new THREE.Box3().setFromObject(mesh)});});
function hits(a,b){const box=new THREE.Box3().setFromPoints([a,b]).expandByScalar(.002),v=b.clone().sub(a);return new THREE.Raycaster(a,v.clone().normalize(),.002,v.length()-.002).intersectObjects(records.filter(r=>r.bounds.intersectsBox(box)).map(r=>r.mesh),false);}
const path=[...e.walkingPath].reverse().map(p=>new THREE.Vector3(p.x,p.y,p.z));
path.unshift(worlds[3].central.localToWorld(new THREE.Vector3(-5.8,0,-41.8)));
path.push(new THREE.Vector3(e.streetPortal.x,STREET_Y,e.streetPortal.z-16));
const failures=[],report={flights:e.towers[0].flights,rise:STREET_Y-e.lowerY,pathSamples:0,headroomProbes:0,routeSamples:0};
for(let i=0;i<path.length-1;i++){
 const a=path[i],b=path[i+1],count=Math.ceil(a.distanceTo(b)/.25);
 const obstruction=hits(a.clone().add(new THREE.Vector3(0,1.76,0)),b.clone().add(new THREE.Vector3(0,1.76,0)));
 if(obstruction.length)failures.push({kind:'eye-path',segment:i,point:obstruction[0].point.toArray(),object:obstruction[0].object.name});
 for(let j=0;j<=count;j++){
  const p=a.clone().lerp(b,j/count);report.pathSamples++;
  const supported=e.findSurface(p.x,p.z,p.y,.45,.24)||surface.findSurface(p.x,p.z,p.y,.45,.24)||i===0;
  if(!supported)failures.push({kind:'unsupported',segment:i,point:p.toArray()});
  const ceiling=hits(p.clone().add(new THREE.Vector3(0,1.76,0)),p.clone().add(new THREE.Vector3(0,2.98,0)));report.headroomProbes++;
  if(ceiling.length)failures.push({kind:'headroom',segment:i,point:p.toArray(),object:ceiling[0].object.name});
  const floor=hits(p.clone().add(new THREE.Vector3(0,.15,0)),p.clone().add(new THREE.Vector3(0,-.5,0)));
  if(!floor.length)failures.push({kind:'missing-physical-floor',segment:i,point:p.toArray()});
 }
}
for(let i=0;i<CITY_ROUTES.length-1;i++){
 const a=CITY_ROUTES[i],b=CITY_ROUTES[i+1],count=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.3);
 for(let j=0;j<=count;j++){
  const x=THREE.MathUtils.lerp(a.x,b.x,j/count),z=THREE.MathUtils.lerp(a.z,b.z,j/count);report.routeSamples++;
  if(!surface.findSurface(x,z,STREET_Y,.06,.24))failures.push({kind:'blocked-city-route',segment:i,x,z});
 }
}
for(const x of [-104,-16.2,84])for(let z=-341;z<=-326;z+=.2){
 if(!surface.findSurface(x,z,STREET_Y,.06,.24))failures.push({kind:'bridge-support',x,z});
}
for(const x of [-104,-16.2,84])for(const z of [-338.5,-328.5]){
 const from=new THREE.Vector3(x+.57,STREET_Y+.2,z);
 const floor=hits(from,from.clone().add(new THREE.Vector3(0,-.4,0))).filter(h=>Math.abs(h.point.y-STREET_Y)<1e-5);
 assert.equal(new Set(floor.map(h=>h.object)).size,1,'bridge approaches must have one exposed floor finish');
}
assert.equal(surface.findSurface(0,-333,STREET_Y),null,'canal must not be walkable away from bridges');
assert.equal(surface.findSurface(-77,-267,STREET_Y),null,'building interiors must collide');
assert.equal(surface.findSurface(-160,-240,STREET_Y),null,'visible perimeter must bound movement');
const hole=e.shaftBounds;
const finishProbe=new THREE.Vector3(e.streetPortal.x-.67,STREET_Y+.2,e.streetPortal.z+8.71);
const finishes=hits(finishProbe,finishProbe.clone().add(new THREE.Vector3(0,-.4,0)))
 .filter(h=>Math.abs(h.point.y-STREET_Y)<1e-5);
assert.equal(new Set(finishes.map(h=>h.object)).size,1,'the upper access must have one exposed finished floor');
const cover=hits(new THREE.Vector3((hole.minX+hole.maxX)/2,STREET_Y+.2,(hole.minZ+hole.maxZ)/2),new THREE.Vector3((hole.minX+hole.maxX)/2,STREET_Y-.2,(hole.minZ+hole.maxZ)/2));
assert.equal(cover.length,0,'street paving must not cap the stairwell');
Object.assign(report,{meshes:records.length,failures:failures.slice(0,30),failureCount:failures.length});
await writeFile('/tmp/aurealis-surface-geometry.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
assert.equal(failures.length,0,'actual geometry, walking support or district route failed');
