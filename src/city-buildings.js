import * as THREE from 'three';
import { box, cylinder, instances, label, canvasTexture, seededRandom } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { architecturalMaterials, archWedge } from './phase6-stations.js';
import { STREET_Y } from './city-layout.js';

export function createCityMaterials(base) {
  const stone = architecturalMaterials('ivory');
  const mat = (color, roughness = 0.84, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const roofMap = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#a16c50'; ctx.fillRect(0, 0, w, h);
    const random = seededRandom(41);
    for (let y = 0; y < h; y += 16) for (let x = -8; x < w; x += 24) {
      const xx = x + (y % 32 ? 12 : 0);
      ctx.fillStyle = `rgba(55,32,25,${0.1 + random() * 0.19})`; ctx.fillRect(xx, y + 13, 23, 2);
      ctx.fillStyle = 'rgba(245,209,164,.17)'; ctx.fillRect(xx, y, 23, 2);
    }
  });
  roofMap.wrapS = roofMap.wrapT = THREE.RepeatWrapping; roofMap.repeat.set(3, 3);
  const pavingMap = canvasTexture(512, 512, (ctx, w, h) => {
    const random=seededRandom(182);
    ctx.fillStyle='#93968a';ctx.fillRect(0,0,w,h);
    for(let row=0;row<32;row++)for(let col=-1;col<16;col++){
      const x=col*32+(row%2)*16,y=row*16,v=Math.round(174+random()*31);
      ctx.fillStyle=`rgb(${v+8},${v+5},${v-6})`;ctx.fillRect(x+1,y+1,30,14);
      ctx.fillStyle='rgba(248,240,216,.22)';ctx.fillRect(x+2,y+1,28,1);
      ctx.fillStyle='rgba(65,71,58,.13)';ctx.fillRect(x+2,y+13,28,1);
    }
  });
  pavingMap.wrapS=pavingMap.wrapT=THREE.RepeatWrapping;
  const paving = new THREE.MeshStandardMaterial({map:pavingMap,color:'#d0c9b6',roughness:.92});
  return { ...base, stone: stone.stone, pale: stone.pale, bronze: stone.trim, masonry: stone,
    paving, road: new THREE.MeshStandardMaterial({map:pavingMap,color:'#b6b39f',roughness:.94}), timber: mat('#51483d'), window: mat('#526b70', 0.35, 0.14),
    roof: new THREE.MeshStandardMaterial({ color: '#b99580', map: roofMap, roughness: 0.9 }),
    slate: mat('#646b69'), grass: mat('#879278'), foliage: mat('#647d60'), water: mat('#547d7c', 0.25, 0.25),
    plaster: ['#ddd2b8', '#c2b4a0', '#c7cbbb', '#d3b39b'].map(c => mat(c)),
  };
}

/** Solid closed houses, with actual roof silhouettes, framed bays and recessed doors. */
export function buildHouse(parent, m, plot) {
  const { x, z, width: w, depth: d, floors, style } = plot;
  const root = new THREE.Group(); root.name = `OldTownHouse-${plot.seed}`;
  root.position.set(x, STREET_Y, z); parent.add(root);
  const h = floors * 3.25 + 0.6, rise = w * 0.38;
  box(root, m.plaster[style], [w, h, d], [0, h / 2, 0]);
  box(root, m.stone, [w + 0.14, 0.65, d + 0.14], [0, 0.325, 0]);
  for (const y of [3.45, h - 0.18]) box(root, m.pale, [w + 0.35, 0.19, d + 0.35], [0, y, 0]);
  const slope = Math.atan2(rise, w / 2), roofWidth = Math.hypot(w / 2 + 0.55, rise);
  for (const side of [-1, 1]) box(root, style === 2 ? m.slate : m.roof,
    [roofWidth, 0.22, d + 1.1], [side * w / 4, h + rise / 2, 0], { rotation: [0, 0, -side * slope] });
  // Solid gables avoid the hollow roof triangles of decorative box buildings.
  const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, rise); shape.closePath();
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }), m.plaster[style]);
  gable.position.set(0, h, -d / 2); gable.castShadow = gable.receiveShadow = true; root.add(gable);
  box(root, m.stone, [0.85, 2.7, 0.95], [w * 0.27, h + rise * 0.7, d * 0.2]);
  box(root, m.pale, [1.12, 0.19, 1.2], [w * 0.27, h + rise * 0.7 + 1.36, d * 0.2]);
  const panes = [], frames = [], beams = [];
  for (let floor = 0; floor < floors; floor++) for (const side of [-1, 1]) {
    const yy = floor * 3.25 + 2.05;
    for (let xx = -w / 2 + 2.1; xx < w / 2 - 1; xx += 3.3) {
      if (floor === 0 && Math.abs(xx) < 2.3) continue;
      panes.push({ size: [1.32, 1.85, 0.05], position: [xx, yy, side * (d / 2 + 0.025)] });
      for (const dx of [-0.77, 0, 0.77]) frames.push({ size: [0.1, 2.08, 0.14], position: [xx + dx, yy, side * (d / 2 + 0.08)] });
      for (const dy of [-1.02, 0.25, 1.02]) frames.push({ size: [1.65, 0.1, 0.17], position: [xx, yy + dy, side * (d / 2 + 0.08)] });
      if (style === 0) for (const dx of [-1.04, 1.04]) beams.push({ size: [0.42, 1.9, 0.08], position: [xx + dx, yy, side * (d / 2 + 0.11)] });
    }
    for (let zz = -d / 2 + 2.1; zz < d / 2 - 1; zz += 3.4) {
      panes.push({ size: [0.05, 1.85, 1.3], position: [side * (w / 2 + 0.025), yy, zz] });
      for (const dz of [-0.76, 0, 0.76]) frames.push({ size: [0.14, 2.05, 0.09], position: [side * (w / 2 + 0.08), yy, zz + dz] });
      for (const dy of [-1.01, 1.01]) frames.push({ size: [0.17, 0.09, 1.6], position: [side * (w / 2 + 0.08), yy + dy, zz] });
    }
  }
  if (style === 0 || style === 3) {
    for (const side of [-1, 1]) {
      for (const xx of [-w / 2 + 0.16, 0, w / 2 - 0.16]) beams.push({ size: [0.18, h - 0.7, 0.16], position: [xx, h / 2 + 0.35, side * (d / 2 + 0.1)] });
      for (let floor = 1; floor <= floors; floor++) beams.push({ size: [w, 0.2, 0.16], position: [0, floor * 3.25, side * (d / 2 + 0.1)] });
      const diagonal = Math.atan2(rise, w / 2);
      for (const s of [-1, 1]) beams.push({ size: [Math.hypot(w / 2, rise), 0.17, 0.16], position: [s * w / 4, h + rise / 2, side * (d / 2 + 0.1)], rotation: [0, 0, -s * diagonal] });
    }
  }
  instances(root, m.window, panes); instances(root, m.pale, frames); if (beams.length) instances(root, m.timber, beams);
  for (const side of [-1, 1]) {
    box(root, m.timber, [1.7, 2.65, 0.08], [0, 1.325, side * (d / 2 + 0.045)]);
    box(root, m.bronze, [0.08, 0.13, 0.08], [0.55, 1.25, side * (d / 2 + 0.11)]);
    archWedge(root, m.pale, { cx: 0, spring: 2.25, rx: 0.95, ry: 0.7, thickness: 0.15, depth: 0.22, z: side * (d / 2 + 0.1) });
  }
  if(plot.seed%7===0) {
    box(root,m.timber,[3.6,.55,.2],[0,3.18,d/2+.18]);
    label(root,plot.seed%2?'BUCHHANDLUNG':'BÄCKEREI',3.35,.36,[0,3.18,d/2+.29],{background:'#51483d',color:'#e9e0c9',fontSize:110});
  }
  if(style===2) {
    box(root,m.pale,[3.4,2.4,.8],[0,5.5,d/2+.4]);
    box(root,m.window,[2.9,1.8,.04],[0,5.65,d/2+.82]);
    for(const xx of [-1.45,0,1.45])box(root,m.pale,[.12,2,.15],[xx,5.65,d/2+.85]);
    box(root,m.slate,[3.8,.18,1.2],[0,6.88,d/2+.38]);
  }
  batchStaticGeometry(root);
  return { minX: x - w / 2 - 0.2, maxX: x + w / 2 + 0.2, minZ: z - d / 2 - 0.2, maxZ: z + d / 2 + 0.2 };
}

export function buildTree(parent, m, x, z, seed = 0) {
  const root = new THREE.Group(); root.position.set(x, STREET_Y, z); parent.add(root);
  cylinder(root, m.timber, 0.21, 4.2, [0, 2.1, 0], [0, 0, 0], 10);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 1), m.foliage);
  crown.position.set(0, 5.2, 0); crown.scale.set(1, 1.25 + seed % 3 * 0.08, 1); crown.castShadow = crown.receiveShadow = true; root.add(crown);
  return { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 };
}

export function buildClockTower(parent, m, x, z) {
  const root = new THREE.Group(); root.position.set(x, STREET_Y, z); root.name = 'OldTownClockTower'; parent.add(root);
  box(root, m.stone, [7, 19, 7], [0, 9.5, 0]);
  for (const y of [0.3, 7, 14, 19]) box(root, m.pale, [7.6, 0.3, 7.6], [0, y, 0]);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 9, 4), m.slate); roof.rotation.y = Math.PI / 4; roof.position.y = 23.5; roof.castShadow = true; root.add(roof);
  for (const side of [-1, 1]) label(root, 'Ⅻ\n◷', 2.6, 2.6, [0, 15.9, side * 3.51], { background: '#e3d8bd', color: '#4e554a', fontSize: 240, rotation: [0, side > 0 ? 0 : Math.PI, 0] });
  batchStaticGeometry(root);
  return { minX: x - 3.8, maxX: x + 3.8, minZ: z - 3.8, maxZ: z + 3.8 };
}

/** Combine identical static window/frame instance buffers across the small district.
 * World transforms, per-instance colours and both shadow flags are retained. */
export function batchCityInstances(root) {
  root.updateWorldMatrix(true,true);
  const inverse=root.matrixWorld.clone().invert(),groups=new Map();
  root.traverse(mesh=>{
    if(!mesh.isInstancedMesh || Array.isArray(mesh.material))return;
    const centre=mesh.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld);
    // Keep north/south rows independently cullable instead of growing one region-wide bound.
    const key=[Math.floor(centre.z/80),mesh.geometry.uuid,mesh.material.uuid,mesh.castShadow,mesh.receiveShadow,Boolean(mesh.instanceColor)].join('/');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(mesh);
  });
  const instance=new THREE.Matrix4(),transform=new THREE.Matrix4(),color=new THREE.Color();
  let removedCalls=0;
  for(const meshes of groups.values()){
    if(meshes.length<2)continue;
    const first=meshes[0],count=meshes.reduce((n,m)=>n+m.count,0);
    const batch=new THREE.InstancedMesh(first.geometry,first.material,count);
    batch.name='OldTownSharedInstances';batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;
    let offset=0;
    for(const mesh of meshes){
      transform.multiplyMatrices(inverse,mesh.matrixWorld);
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,instance);instance.premultiply(transform);batch.setMatrixAt(offset,instance);
        if(mesh.instanceColor){mesh.getColorAt(i,color);batch.setColorAt(offset,color);}
        offset++;
      }
      mesh.removeFromParent();mesh.dispose();
    }
    batch.computeBoundingSphere();root.add(batch);removedCalls+=meshes.length-1;
  }
  return removedCalls;
}
