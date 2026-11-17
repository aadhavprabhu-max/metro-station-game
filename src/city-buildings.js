import * as THREE from 'three';
import { addAsphaltVariation, addPaintWear } from './surface-variation.js';
import { box, cylinder, instances, label, seededRandom } from './geometry.js';
import { batchStaticGeometry } from './optimize.js';
import { architecturalMaterials } from './phase6-stations.js';
import { STREET_Y } from './city-layout.js';
import * as T from './city-textures.js';
import { glowWindows, GLOW } from './night-glow.js';

/** Bold, sun-faded stucco. Neighbouring houses never share a colour. */
export const STUCCO = Object.freeze([
  '#dca53a', // ochre
  '#c65b30', // terracotta
  '#eaa49e', // rose
  '#9dd5bc', // mint
  '#96bee2', // powder blue
  '#f1dc9e', // cream
  '#ef9356', // apricot
  '#f2d453', // lemon
  '#e1ddd3', // limewash
]);

export function createCityMaterials(base) {
  // The Central entrance hall keeps its own stone; the town has separate finishes.
  const stone = architecturalMaterials('ivory');
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0, ...extra });
  const plasterMap = T.plasterTexture(3);
  const rough = (color, extra = {}) => std(color, { map: plasterMap, bumpMap: plasterMap, bumpScale: 1.6, roughness: 0.94, ...extra });
  const roofMap = T.roofTileTexture(41), edgeMap = T.tileEdgeTexture();
  const flagMap = T.flagstoneTexture(182), laneMap = T.flagstoneTexture(311), brickMap = T.herringboneTexture(77);
  brickMap.repeat.set(4, 4); flagMap.repeat.set(2, 2); laneMap.repeat.set(2.3, 2.3);
  const louvre = T.louvreTexture(), doorMap = T.doorTexture(), railMap = T.railingTexture();
  const red = T.flowerTexture(['#e0142a', '#ff3b3b', '#b80d1f', '#ff6d5a'], 5);
  const pink = T.flowerTexture(['#e4198b', '#ff5cb0', '#c0137a', '#ffffff'], 6);
  const alpha = { alphaTest: 0.5, side: THREE.DoubleSide };
  const materials = { ...base, stone: stone.stone, pale: stone.pale, bronze: stone.trim, masonry: stone,
    // Ground finishes: irregular flagstone lanes and a herringbone brick for squares.
    paving: std('#c4bdac', { map: flagMap, bumpMap: flagMap, bumpScale: 2, roughness: 0.95 }),
    road: std('#b8b09e', { map: laneMap, bumpMap: laneMap, bumpScale: 2, roughness: 0.95 }),
    brick: std('#d9cdb2', { map: brickMap, bumpMap: brickMap, bumpScale: 1.5, roughness: 0.9 }),
    timber: std('#5d3a22'), window: std('#ffffff', { map: T.windowTexture(), roughness: 0.28 }),
    windowBarred: std('#ffffff', { map: T.windowTexture(true), roughness: 0.3 }),
    windowFrench: std('#ffffff', { map: T.windowTexture(false, true), roughness: 0.28 }),
    roof: std('#ffffff', { map: roofMap, bumpMap: roofMap, bumpScale: 2.2, roughness: 0.82, side: THREE.DoubleSide }),
    tileEdge: std('#ffffff', { map: edgeMap, roughness: 0.82 }),
    gutter: std('#6b3a20', { roughness: 0.6, metalness: 0.2 }),
    slate: std('#646b69'), grass: std('#7fa053'), foliage: std('#3d7a35', { flatShading: true }),
    water: std('#547d7c', { roughness: 0.25, metalness: 0.25 }),
    plaster: STUCCO.map(color => rough(color)),
    trim: rough('#f4efe3', { bumpScale: 0.8, roughness: 0.82 }),
    oldWall: rough('#b3a487', { bumpScale: 3.2, roughness: 0.97 }), oldWallDark: rough('#8d7f66', { bumpScale: 3.2, roughness: 0.97 }),
    concrete: rough('#b9b6ae', { bumpScale: 1.2, roughness: 0.9 }),
    whiteStone: rough('#ebe4d2', { bumpScale: 1.2 }),
    baseStone: rough('#a9a596', { bumpScale: 2.4 }),
    // One material each; the paint colour is per instance.
    door: std('#ffffff', { map: doorMap, roughness: 0.7 }), doorColors: ['#7b4322', '#2f6a3d', '#2b4f88', '#8c2f22'],
    shutter: std('#ffffff', { map: louvre, roughness: 0.62 }), shutterColors: ['#1f7d3d', '#1e52b0', '#1d8d89', '#6f8fb1'],
    iron: std('#1a1b1e', { roughness: 0.48, metalness: 0.45 }),
    railing: std('#1a1b1e', { map: railMap, roughness: 0.5, metalness: 0.4, ...alpha }),
    terracotta: std('#c25a2c', { roughness: 0.9 }),
    flowersRed: std('#ffffff', { map: red, roughness: 0.9 }),
    flowersPink: std('#ffffff', { map: pink, roughness: 0.9 }),
    leaf: std('#2f6b2a', { flatShading: true, side: THREE.DoubleSide, roughness: 0.8 }),
    petal: std('#d81f7f', { flatShading: true, side: THREE.DoubleSide, roughness: 0.75 }),
    lanternGlass: std('#fff1c4', { emissive: '#ffd98a', emissiveIntensity: 0.55, roughness: 0.3 }),
    grassEdge: std('#ffffff', { map: T.grassEdgeTexture(12), ...alpha, roughness: 1 }),
    awnings: [T.awningTexture('#2d7a43'), T.awningTexture('#b62a2a'), T.awningTexture('#1f56a8')]
      .map(map => std('#ffffff', { map, side: THREE.DoubleSide, roughness: 0.9 })),
    cloth: std('#ffffff', { side: THREE.DoubleSide, roughness: 0.95 }),
    bunting: std('#ffffff', { side: THREE.DoubleSide, roughness: 0.8 }),
    line: std('#3d3a35', { roughness: 0.9 }),
    palmBark: std('#ffffff', { map: T.palmBarkTexture(), roughness: 0.95 }),
    palmFrond: std('#3f8f36', { flatShading: true, side: THREE.DoubleSide, roughness: 0.8 }),
    palmDry: std('#8f6d3b', { flatShading: true, side: THREE.DoubleSide, roughness: 0.95 }),
    lemon: std('#f4d21f', { roughness: 0.6 }),
    parasols: [T.stripeTexture('#1f56a8'), T.stripeTexture('#c73a2c'), T.stripeTexture('#2d7a43')]
      .map(map => std('#ffffff', { map, side: THREE.DoubleSide, roughness: 0.9 })),
    cafeWood: std('#86552f', { roughness: 0.8 }),
    tablecloth: std('#f2eee2', { roughness: 0.9 }),
  };
  // Roadway, sidewalks, signage and festival finishes.
  const asphaltMap = T.asphaltTexture(), walkMap = T.sidewalkTexture(), cloth = T.shamianaTexture(), valance = T.valanceTexture();
  Object.assign(materials, {
    // Matt asphalt: roughness 0.84–0.97 from its own map, with world-space tone variation (see surface-variation.js).
    asphalt: addAsphaltVariation(std('#ffffff', { map: asphaltMap, bumpMap: asphaltMap, bumpScale: 0.9, roughness: 1, roughnessMap: T.asphaltRoughnessTexture() })),
    sidewalk: std('#e2ddd2', { map: walkMap, bumpMap: walkMap, bumpScale: 0.8, roughness: 0.9 }),
    kerb: rough('#a7a49c', { bumpScale: 1.4 }),
    tactile: std('#ffffff', { map: T.tactileTexture(), roughness: 0.8 }),
    paint: addPaintWear(std('#ecebe4', { roughness: 0.7 })), paintYellow: addPaintWear(std('#f2c230', { roughness: 0.7 })), paintTint: addPaintWear(std('#ffffff', { roughness: 0.7 })),
    lens: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    galvanised: std('#8f969b', { roughness: 0.45, metalness: 0.6 }),
    signalRed: std('#ff2a1a', { emissive: '#ff2a1a', emissiveIntensity: 1.6 }), signalAmber: std('#4a3608'), signalGreen: std('#0d3d1a'),
    signalGreenLit: std('#2dff6a', { emissive: '#2dff6a', emissiveIntensity: 1.6 }), signalRedDim: std('#3d0c08'),
    shelterGlass: new THREE.MeshStandardMaterial({ color: '#cfe6ee', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false }),
    hydrant: std('#c4161c', { roughness: 0.5 }), bin: std('#2f5d3a', { roughness: 0.6, metalness: 0.3 }),
    grassPatch: std('#ffffff', { map: T.grassPatchTexture(71), alphaTest: 0.5, roughness: 1 }),
    grassPatch2: std('#ffffff', { map: T.grassPatchTexture(93), alphaTest: 0.5, roughness: 1 }),
    canopy: std('#ffffff', { map: cloth, side: THREE.DoubleSide, roughness: 0.85 }),
    valance: std('#ffffff', { map: valance, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }),
    durrie: std('#ffffff', { map: T.durrieTexture(), roughness: 0.95 }),
    marigold: std('#f28a0e', { flatShading: true, roughness: 0.8 }), marigoldYellow: std('#f6c31a', { flatShading: true, roughness: 0.8 }),
    poleRed: std('#8e1b2c', { roughness: 0.6 }), gold: std('#d9a733', { roughness: 0.35, metalness: 0.7 }),
    signs: Object.fromEntries(['limit', 'noparking', 'crossing', 'parking', 'bus', 'yield'].map(kind => [kind, std('#ffffff', { map: T.signTexture(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 })])),
  });
  // Small street details are hidden beyond ~170 m (see SurfaceWorld.updateDetail).
  for (const key of ['paint', 'paintYellow', 'paintTint', 'lens', 'tactile', 'iron', 'gold', 'galvanised', 'bin', 'hydrant', 'grassPatch', 'grassPatch2', 'cafeWood', 'tablecloth'])
    materials[key].userData.detail = true;
  for (const sign of Object.values(materials.signs)) sign.userData.detail = true;
  // Tiny or flush details skip the shadow pass; they would add draw calls but no visible shadow.
  // House windows light up warm at night, each window on or off by itself.
  for (const key of ['window', 'windowBarred', 'windowFrench']) glowWindows(materials[key], GLOW.warm, 1.5);
  for (const key of ['window', 'windowBarred', 'windowFrench', 'lanternGlass', 'line', 'gutter', 'grassEdge', 'paint', 'paintYellow', 'paintTint', 'lens', 'tactile', 'grassPatch', 'grassPatch2', 'signalRed', 'signalAmber', 'signalGreen', 'signalGreenLit', 'signalRedDim', 'durrie', 'shelterGlass', 'iron', 'gold', 'galvanised', 'bin', 'hydrant', 'cafeWood', 'tablecloth']) materials[key].userData.noCast = true;
  return materials;
}

// ---------------------------------------------------------------- geometry kit
const FLOOR = 3.2, GROUND = 3.75, PLINTH = 0.55;
const GUTTER = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2);
const PIPE = new THREE.CylinderGeometry(1, 1, 1, 8);
export const POT = new THREE.CylinderGeometry(0.62, 0.42, 1, 12);
export const CLUMP = new THREE.IcosahedronGeometry(1, 0);
const ROD = new THREE.CylinderGeometry(1, 1, 1, 5).rotateZ(Math.PI / 2);

/** Box whose UVs are in world metres (one texture repeat per `tile` metres). */
export function uvBox(sx, sy, sz, tile = 3, offset = [0, 0]) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz), uv = geometry.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) {
    const i = face * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[face][0] / tile + offset[0], uv.getY(i) * dims[face][1] / tile + offset[1]);
  }
  return geometry;
}

export function uvMesh(parent, material, size, position, { tile = 3, offset, rotation, shadow = true } = {}) {
  const mesh = new THREE.Mesh(uvBox(...size, tile, offset), material);
  mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = mesh.receiveShadow = shadow; parent.add(mesh); return mesh;
}

/** Hip or gable roof shell from the eave line (y=0) up to the ridge; UVs in metres. */
export function roofGeometry(w, d, rise, overhang, type) {
  const W = w / 2 + overhang, D = d / 2 + overhang, faces = [];
  const quad = (a, b, c, e, eave) => faces.push([a, b, c, eave], [a, c, e, eave]);
  if (type === 'gable') {
    quad([-W, 0, D], [W, 0, D], [W, rise, 0], [-W, rise, 0], [1, 0, 0]);
    quad([W, 0, -D], [-W, 0, -D], [-W, rise, 0], [W, rise, 0], [-1, 0, 0]);
  } else if (W >= D) {
    const r = W - D;
    quad([-W, 0, D], [W, 0, D], [r, rise, 0], [-r, rise, 0], [1, 0, 0]);
    quad([W, 0, -D], [-W, 0, -D], [-r, rise, 0], [r, rise, 0], [-1, 0, 0]);
    faces.push([[W, 0, D], [W, 0, -D], [r, rise, 0], [0, 0, -1]], [[-W, 0, -D], [-W, 0, D], [-r, rise, 0], [0, 0, 1]]);
  } else {
    const r = D - W;
    quad([W, 0, D], [W, 0, -D], [0, rise, -r], [0, rise, r], [0, 0, -1]);
    quad([-W, 0, -D], [-W, 0, D], [0, rise, r], [0, rise, -r], [0, 0, 1]);
    faces.push([[-W, 0, D], [W, 0, D], [0, rise, r], [1, 0, 0]], [[W, 0, -D], [-W, 0, -D], [0, rise, -r], [-1, 0, 0]]);
  }
  const position = [], normal = [], uv = [], tile = 2.2;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3(), s = new THREE.Vector3();
  for (const [p0, p1, p2, eave] of faces) {
    a.fromArray(p0); b.fromArray(p1); c.fromArray(p2); e.fromArray(eave);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    s.crossVectors(n, e).normalize();
    for (const p of [a, b, c]) { position.push(p.x, p.y, p.z); normal.push(n.x, n.y, n.z); uv.push(p.dot(e) / tile, p.dot(s) / tile); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

/** Solid attic triangle below a gable roof, spanning the house along x. */
function gableGeometry(w, d, rise) {
  const shape = new THREE.Shape(); shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, rise * 0.985); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  const uv = geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
  return geometry.rotateY(Math.PI / 2).translate(-w / 2, 0, 0);
}

// Faces of a unit: u runs along the facade, `off` is outward from the wall plane.
function faceFrames(cx, cz, w, d) {
  return {
    pz: { len: w, ry: 0, at: (u, y, off) => [cx + u, y, cz + d / 2 + off] },
    nz: { len: w, ry: Math.PI, at: (u, y, off) => [cx - u, y, cz - d / 2 - off] },
    px: { len: d, ry: Math.PI / 2, at: (u, y, off) => [cx + w / 2 + off, y, cz - u] },
    nx: { len: d, ry: -Math.PI / 2, at: (u, y, off) => [cx - w / 2 - off, y, cz + u] },
  };
}

/** Collects instance entries per material/geometry so each house adds few draw calls. */
class Kit {
  constructor() { this.sets = new Map(); }
  add(material, entry, geometry) {
    const key = material.uuid + (geometry?.uuid ?? '') + (entry.color ? '/c' : '');
    if (!this.sets.has(key)) this.sets.set(key, { material, geometry, entries: [] });
    this.sets.get(key).entries.push(entry);
  }
  flush(root) {
    for (const { material, geometry, entries } of this.sets.values()) {
      const mesh = instances(root, material, entries, geometry);
      if (material.userData.noCast) mesh.castShadow = false;
    }
  }
}

const rowMemory = { z: null, x: -Infinity, colors: [] };
const pick = (random, count, avoid) => {
  let value = Math.floor(random() * count);
  for (let i = 0; i < count && avoid.includes(value); i++) value = (value + 1 + Math.floor(random() * 3)) % count;
  return value;
};

/**
 * A plot becomes a terrace of tall, narrow houses (split along the street and,
 * on deep plots, back-to-back). The collider is the original plot footprint.
 */
export function buildHouse(parent, m, plot, extraColliders = null) {
  const { x, z, width: w, depth: d, seed } = plot;
  const random = seededRandom(seed * 7919 + 13);
  const root = new THREE.Group(); root.name = `OldTownHouse-${seed}`;
  root.position.set(x, STREET_Y + (plot.y0 ?? 0), z); root.rotation.y = plot.rotation ?? 0; parent.add(root);
  const kit = new Kit(), row = plot.row ?? z, along = plot.rotation ? -z : x;
  if (rowMemory.z !== row || along < rowMemory.x) rowMemory.colors = [];
  rowMemory.z = row; rowMemory.x = along;
  const w1 = w >= 10 ? Math.round(w * (0.42 + random() * 0.16) * 2) / 2 : w;
  const xs = w >= 10 ? [[-w / 2 + w1 / 2, w1], [w / 2 - (w - w1) / 2, w - w1]] : [[0, w]];
  const deep = d >= 19, d1 = deep ? Math.round(d * (0.44 + random() * 0.12) * 2) / 2 : d;
  const zs = deep ? [[-d / 2 + d1 / 2, d1, -1], [d / 2 - (d - d1) / 2, d - d1, 1]] : [[0, d, 0]];
  const units = [], previous = [...rowMemory.colors];
  for (const [iz, [cz, ud, side]] of zs.entries()) {
    let leftColor = previous[iz] ?? -1, leftFloors = -1;
    for (const [ix, [cx, uw]] of xs.entries()) {
      const partner = iz > 0 ? units.find(u => u.ix === ix) : null;
      const color = pick(random, STUCCO.length, [leftColor, partner?.color ?? -1]);
      let floors = 2 + Math.floor(random() * 3);
      if (floors === leftFloors || floors === partner?.floors) floors = floors === 4 ? 3 : floors + 1;
      const faces = plot.backdrop ? { px: false, nx: false, pz: plot.backdrop === 'pz', nz: plot.backdrop === 'nz' }
        : { px: ix === xs.length - 1, nx: ix === 0, pz: side >= 0, nz: side <= 0 };
      const doors = plot.backdrop ? [plot.backdrop] : side > 0 ? ['pz'] : side < 0 ? ['nz'] : ['pz', 'nz'];
      units.push({ ix, iz, cx, cz, w: uw, d: ud, color, floors, faces, doors, seed: seed * 10 + ix + iz * 2 });
      leftColor = color; leftFloors = floors;
    }
  }
  rowMemory.colors = zs.map((_, iz) => units.filter(u => u.iz === iz).at(-1).color);
  for (const unit of units) buildUnit(root, m, unit, kit, random, plot, extraColliders);
  kit.flush(root);
  batchStaticGeometry(root);
  return { minX: x - w / 2 - 0.2, maxX: x + w / 2 + 0.2, minZ: z - d / 2 - 0.2, maxZ: z + d / 2 + 0.2 };
}

function buildUnit(root, m, unit, kit, random, plot, extraColliders) {
  const { cx, cz, w, d, floors, color, faces } = unit;
  const H = PLINTH + GROUND + (floors - 1) * FLOOR, plaster = m.plaster[color];
  const offset = [random() * 3, random() * 3];
  const style = {
    bands: random() < 0.6, quoins: random() < 0.45,
    shutter: random() < 0.82 ? m.shutterColors[Math.floor(random() * m.shutterColors.length)] : null,
    flowers: random() < 0.55 ? (random() < 0.55 ? m.flowersRed : m.flowersPink) : null,
    balcony: floors >= 3 && random() < 0.6, roof: random() < 0.6 ? 'hip' : 'gable',
    door: m.doorColors[Math.floor(random() * m.doorColors.length)], grass: random() < 0.55,
    bougainvillea: random() < 0.28, lantern: random() < 0.6, pots: random() < 0.6,
  };
  if (plot.backdrop) Object.assign(style, { grass: false, lantern: false, pots: false, bougainvillea: style.bougainvillea && random() < 0.5 });
  // Massing, plinth, cornice, string courses and quoins.
  uvMesh(root, plaster, [w, H, d], [cx, H / 2, cz], { offset });
  uvMesh(root, m.baseStone, [w + 0.08, PLINTH, d + 0.08], [cx, PLINTH / 2, cz], { tile: 2 });
  uvMesh(root, m.trim, [w + 0.36, 0.3, d + 0.36], [cx, H - 0.15, cz], { tile: 2 });
  uvMesh(root, m.trim, [w + 0.18, 0.14, d + 0.18], [cx, H - 0.37, cz], { tile: 2 });
  const floorY = f => f === 0 ? PLINTH : PLINTH + GROUND + (f - 1) * FLOOR;
  if (style.bands) for (let f = 1; f < floors; f++) uvMesh(root, m.trim, [w + 0.1, 0.17, d + 0.1], [cx, floorY(f) - 0.12, cz], { tile: 2 });
  if (style.quoins) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (!(sx > 0 ? faces.px : faces.nx) && !(sz > 0 ? faces.pz : faces.nz)) continue;
    kit.add(m.trim, { size: [0.46, H - PLINTH - 0.35, 0.46], position: [cx + sx * (w / 2 - 0.2), PLINTH + (H - PLINTH - 0.35) / 2, cz + sz * (d / 2 - 0.2)] });
  }
  // Roof: deep eaves, tile-end strips, gutters, ridge and chimneys.
  const overhang = 0.55, slope = 0.3 + random() * 0.08;
  const rise = style.roof === 'gable' ? (d / 2 + overhang) * slope : (Math.min(w, d) / 2 + overhang) * slope;
  const roof = new THREE.Mesh(roofGeometry(w, d, rise, overhang, style.roof), m.roof);
  roof.position.set(cx, H, cz); roof.castShadow = roof.receiveShadow = true; root.add(roof);
  uvMesh(root, m.trim, [w + overhang * 2 - 0.02, 0.06, d + overhang * 2 - 0.02], [cx, H - 0.05, cz], { tile: 2 });
  const W = w + overhang * 2, D = d + overhang * 2;
  const eaves = [[W, [cx, H + 0.05, cz + D / 2], 0], [W, [cx, H + 0.05, cz - D / 2], Math.PI]];
  if (style.roof === 'hip') eaves.push([D, [cx + W / 2, H + 0.05, cz], Math.PI / 2], [D, [cx - W / 2, H + 0.05, cz], -Math.PI / 2]);
  for (const [len, position, ry] of eaves) {
    uvMesh(root, m.tileEdge, [len, 0.17, 0.12], position, { tile: 1.2, rotation: [0, ry, 0] });
    const out = [Math.sin(ry) * 0.12, 0, Math.cos(ry) * 0.12];
    kit.add(m.gutter, { size: [len, 0.075, 0.075], position: [position[0] + out[0], H - 0.06, position[2] + out[2]], rotation: [0, ry, 0] }, GUTTER);
  }
  if (style.roof === 'gable') {
    const gable = new THREE.Mesh(gableGeometry(w, d, rise), plaster); gable.position.set(cx, H, cz); gable.castShadow = gable.receiveShadow = true; root.add(gable);
    const rake = Math.hypot(D / 2, rise), angle = Math.atan2(rise, D / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      uvMesh(root, m.tileEdge, [0.12, 0.17, rake], [cx + sx * W / 2, H + rise / 2 + 0.05, cz + sz * D / 4], { tile: 1.2, rotation: [sz * angle, 0, 0] });
    uvMesh(root, m.tileEdge, [W, 0.16, 0.26], [cx, H + rise + 0.02, cz], { tile: 1.2 });
  } else {
    const ridge = Math.abs(W - D);
    if (ridge > 0.2) uvMesh(root, m.tileEdge, W > D ? [ridge, 0.16, 0.26] : [0.26, 0.16, ridge], [cx, H + rise + 0.02, cz], { tile: 1.2 });
  }
  const pipeFace = faces.pz ? 1 : -1;
  kit.add(m.gutter, { size: [0.06, H, 0.06], position: [cx + (faces.px ? w / 2 - 0.12 : -w / 2 + 0.12), H / 2, cz + pipeFace * (d / 2 + 0.1)] }, PIPE);
  for (let i = 0, count = 1 + (random() < 0.45); i < count; i++) {
    const hx = cx + (random() - 0.5) * w * 0.5, hz = cz + (random() - 0.5) * d * 0.4, top = H + rise * 0.8 + 0.9 + random() * 0.7;
    uvMesh(root, plaster, [0.72, top - H, 0.62], [hx, (H + top) / 2, hz], { tile: 3 });
    kit.add(m.trim, { size: [0.98, 0.14, 0.88], position: [hx, top + 0.07, hz] });
    kit.add(m.terracotta, { size: [0.13, 0.32, 0.13], position: [hx + 0.12, top + 0.3, hz] }, PIPE);
  }
  // Facades.
  const frames = faceFrames(cx, cz, w, d), fronts = [];
  for (const key of ['pz', 'nz', 'px', 'nx']) {
    if (!faces[key]) continue;
    const face = frames[key], street = unit.doors.includes(key);
    const n = Math.max(1, Math.floor((face.len - (street ? 0.6 : 1.4)) / (street ? 2.45 : 3.1)));
    const spacing = face.len / n, columns = Array.from({ length: n }, (_, i) => -face.len / 2 + spacing * (i + 0.5));
    const doorColumn = street ? (n % 2 ? (n - 1) / 2 : Math.floor(random() * n)) : -1;
    const balcony = street && style.balcony ? { column: n > 1 && doorColumn === 0 ? 1 : Math.min(n - 1, doorColumn < 0 ? 0 : doorColumn), floor: 1 + Math.floor(random() * Math.min(2, floors - 1)) } : null;
    for (let f = 0; f < floors; f++) for (const [i, u] of columns.entries()) {
      if (f === 0 && i === doorColumn) continue;
      if (balcony && f === balcony.floor && i === balcony.column) { addBalcony(kit, m, face, u, floorY(f), style, random); continue; }
      addWindow(kit, m, face, u, floorY(f), f, style, random);
    }
    if (street) fronts.push({ face, u: columns[doorColumn], key });
    if (style.grass) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(face.len, 0.6).rotateX(-Math.PI / 2), m.grassEdge);
      const uv = strip.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * face.len / 2.5, 1 - uv.getY(i));
      strip.position.set(...face.at(0, 0.03, 0.3)); strip.rotation.y = face.ry; strip.receiveShadow = true; strip.castShadow = false; root.add(strip);
    }
  }
  for (const { face, u, key } of fronts) addEntrance(root, kit, m, face, u, style, random, unit, plot, key, extraColliders);
}

function addWindow(kit, m, face, u, base, floor, style, random) {
  const ww = 1.12, wh = floor === 0 ? 1.5 : 1.75, y = base + (floor === 0 ? 1.05 : 0.92) + wh / 2;
  const put = (material, size, du, dy, off, geometry, extra = 0) =>
    kit.add(material, { size, position: face.at(u + du, y + dy, off), rotation: [0, face.ry + extra, 0] }, geometry);
  const barred = floor === 0 && random() < 0.5;
  put(barred ? m.windowBarred : m.window, [ww, wh, 0.04], 0, 0, 0.02);
  for (const s of [-1, 1]) put(m.trim, [0.2, wh + 0.2, 0.12], s * (ww / 2 + 0.1), 0, 0.06);
  put(m.trim, [ww + 0.56, 0.24, 0.16], 0, wh / 2 + 0.12, 0.08);
  put(m.trim, [ww + 0.56, 0.14, 0.34], 0, -wh / 2 - 0.07, 0.17);
  if (style.shutter && !(barred && random() < 0.6)) {
    const state = random();
    const leaf = (size, du, off) => kit.add(m.shutter, { size, position: face.at(u + du, y, off), rotation: [0, face.ry, 0], color: style.shutter });
    if (state < 0.72) for (const s of [-1, 1]) leaf([ww / 2 + 0.06, wh + 0.06, 0.05], s * (ww / 2 + 0.2 + (ww / 2 + 0.06) / 2), 0.05);
    else if (state < 0.92) for (const s of [-1, 1]) leaf([ww / 2, wh, 0.05], s * ww / 4, 0.06);
    else leaf([ww / 2 + 0.06, wh + 0.06, 0.05], -(ww / 2 + 0.2 + (ww / 2 + 0.06) / 2), 0.05);
  }
  if (floor > 0 && style.flowers && random() < 0.5) {
    put(m.terracotta, [ww + 0.24, 0.26, 0.3], 0, -wh / 2 + 0.08, 0.24);
    put(style.flowers, [ww + 0.3, 0.24, 0.36], 0, -wh / 2 + 0.3, 0.24);
  }
}

function addBalcony(kit, m, face, u, base, style, random) {
  const ww = 1.05, wide = ww + 1.4, deep = 0.95;
  const put = (material, size, du, y, off, extra = 0, geometry) =>
    kit.add(material, { size, position: face.at(u + du, y, off), rotation: [0, face.ry + extra, 0] }, geometry);
  put(m.windowFrench, [ww, 2.3, 0.04], 0, base + 1.2, 0.02);
  for (const s of [-1, 1]) put(m.trim, [0.2, 2.5, 0.12], s * (ww / 2 + 0.1), base + 1.25, 0.06);
  put(m.trim, [ww + 0.6, 0.26, 0.16], 0, base + 2.48, 0.08);
  if (style.shutter) for (const s of [-1, 1]) kit.add(m.shutter, { size: [ww / 2 + 0.06, 2.3, 0.05], position: face.at(u + s * (ww / 2 + 0.2 + (ww / 2 + 0.06) / 2), base + 1.2, 0.05), rotation: [0, face.ry, 0], color: style.shutter });
  put(m.trim, [wide, 0.2, deep], 0, base - 0.1, deep / 2);
  put(m.trim, [wide + 0.08, 0.06, deep + 0.04], 0, base - 0.22, deep / 2);
  for (const s of [-1, 1]) put(m.trim, [0.2, 0.42, deep * 0.75], s * (wide / 2 - 0.3), base - 0.42, deep * 0.38);
  put(m.railing, [wide, 1.0, 0.03], 0, base + 0.5, deep - 0.03);
  for (const s of [-1, 1]) put(m.railing, [deep - 0.04, 1.0, 0.03], s * (wide / 2 - 0.03), base + 0.5, deep / 2, Math.PI / 2);
  put(m.iron, [wide + 0.04, 0.06, 0.07], 0, base + 1.02, deep - 0.03);
  for (const s of [-1, 1]) put(m.iron, [0.07, 0.06, deep], s * (wide / 2 - 0.03), base + 1.02, deep / 2);
  if (random() < 0.7) {
    const du = (random() < 0.5 ? -1 : 1) * (wide / 2 - 0.45);
    put(m.terracotta, [0.4, 0.42, 0.4], du, base + 0.21, deep / 2, 0, POT);
    put(style.flowers ?? m.flowersRed, [0.34, 0.3, 0.34], du, base + 0.52, deep / 2, 0, CLUMP);
  }
}

function addEntrance(root, kit, m, face, u, style, random, unit, plot, key, extraColliders) {
  const put = (material, size, du, y, off, geometry, extra = 0) =>
    kit.add(material, { size, position: face.at(u + du, y, off), rotation: [0, face.ry + extra, 0] }, geometry);
  kit.add(m.door, { size: [1.25, 2.5, 0.06], position: face.at(u, 1.27, 0.06), rotation: [0, face.ry, 0], color: style.door });
  for (const s of [-1, 1]) put(m.trim, [0.24, 2.78, 0.15], s * 0.745, 1.39, 0.08);
  put(m.trim, [1.86, 0.28, 0.2], 0, 2.9, 0.1);
  put(m.whiteStone, [1.8, 0.14, 0.38], 0, 0.07, 0.2);
  const side = u > 0 ? -1 : 1, room = face.len / 2 - Math.abs(u) - 1.1;
  if (style.lantern) {
    const du = side * Math.min(1.25, Math.max(0.95, room)), y = 3.15;
    put(m.iron, [0.16, 0.34, 0.05], du, y + 0.12, 0.02);
    put(m.iron, [0.05, 0.05, 0.5], du, y + 0.26, 0.26);
    put(m.iron, [0.05, 0.3, 0.05], du, y + 0.12, 0.47, undefined);
    put(m.lanternGlass, [0.26, 0.36, 0.26], du, y - 0.18, 0.52);
    put(m.iron, [0.36, 0.08, 0.36], du, y + 0.03, 0.52);
    put(m.iron, [0.18, 0.12, 0.18], du, y + 0.12, 0.52);
    put(m.iron, [0.2, 0.06, 0.2], du, y - 0.39, 0.52);
  }
  if (style.pots) for (const s of [-1, 1]) {
    if (random() < 0.35) continue;
    const du = s * 1.2, [px, , pz] = face.at(u + du, 0, 0.42);
    put(m.terracotta, [0.42, 0.55, 0.42], du, 0.275, 0.42, POT);
    put(random() < 0.5 ? m.flowersRed : (style.flowers ?? m.flowersPink), [0.36, 0.34, 0.36], du, 0.7, 0.42, CLUMP);
    extraColliders?.push({ minX: px - 0.28, maxX: px + 0.28, minZ: pz - 0.28, maxZ: pz + 0.28 });
  }
  if (style.bougainvillea) {
    const du = -side * 1.3;
    put(m.timber, [0.09, 3.1, 0.09], du, 1.55, 0.12, PIPE);
    for (let i = 0; i < 4; i++) {
      const sx = 0.7 + random() * 0.5;
      put(m.petal, [sx, 0.6 + random() * 0.3, 0.42], du + (random() - 0.4) * 1.6 * -side, 2.8 + random() * 1.4, 0.32, PETALS);
      put(m.leaf, [sx * 0.95, 0.6, 0.38], du + (random() - 0.4) * 1.4 * -side, 2.7 + random() * 1.4, 0.26, LEAVES);
    }
  }
  if (plot.seed % 7 === 0 && unit.ix === 0) {
    const awning = m.awnings[plot.seed % m.awnings.length];
    const canopy = box(root, awning, [2.6, 0.04, 1.3], face.at(u, 3.25, 0.62));
    canopy.rotation.set(0.32, face.ry, 0, 'YXZ');
    const [lx, ly, lz] = face.at(u, 3.72, 0.1);
    label(root, plot.seed % 2 ? 'LIBRERIA' : 'PANETTERIA', 2.4, 0.34, [lx, ly, lz], { background: '#f2ead6', color: '#7a3a1f', fontSize: 104, rotation: [0, face.ry, 0] });
  }
}

/** Low-poly triangle clouds for bougainvillea: magenta bracts and leaves. */
function triangleCloud(count, size, seed) {
  const random = seededRandom(seed), position = [];
  for (let i = 0; i < count; i++) {
    const t = random() * Math.PI * 2, p = Math.acos(2 * random() - 1), r = 0.55 + random() * 0.45;
    const c = new THREE.Vector3(Math.sin(p) * Math.cos(t) * r, Math.cos(p) * r * 0.9, Math.sin(p) * Math.sin(t) * r);
    const n = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
    const a = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0.3)).normalize(), b = new THREE.Vector3().crossVectors(n, a);
    const s = size * (0.7 + random() * 0.6);
    for (const k of [0, 1, 2]) {
      const angle = k * Math.PI * 2 / 3 + random() * 0.4;
      const v = c.clone().addScaledVector(a, Math.cos(angle) * s).addScaledVector(b, Math.sin(angle) * s * (k === 0 ? 1.4 : 1));
      position.push(v.x, v.y, v.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.computeVertexNormals();
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(position.length / 3 * 2), 2));
  return geometry;
}
export const PETALS = triangleCloud(120, 0.22, 11);
export const LEAVES = triangleCloud(70, 0.24, 12);

export function buildClockTower(parent, m, x, z) {
  const root = new THREE.Group(); root.position.set(x, STREET_Y, z); root.name = 'OldTownClockTower'; parent.add(root);
  uvMesh(root, m.plaster[1], [7, 19, 7], [0, 9.5, 0]);
  uvMesh(root, m.baseStone, [7.2, 1.2, 7.2], [0, 0.6, 0], { tile: 2 });
  for (const y of [7, 14, 19]) uvMesh(root, m.trim, [7.6, 0.34, 7.6], [0, y, 0], { tile: 2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) uvMesh(root, m.trim, [0.6, 17.8, 0.6], [sx * 3.25, 9.9, sz * 3.25], { tile: 2 });
  const belfry = new THREE.Group(); root.add(belfry);
  for (const r of [0, 1, 2, 3]) {
    const ry = r * Math.PI / 2, f = { at: (u, y, off) => [Math.sin(ry) * (3.5 + off) + Math.cos(ry) * u, y, Math.cos(ry) * (3.5 + off) - Math.sin(ry) * u] };
    box(belfry, m.window, [1.6, 2.6, 0.05], f.at(0, 9.6, 0.02), { rotation: [0, ry, 0] });
    box(belfry, m.trim, [2.1, 0.22, 0.32], f.at(0, 8.2, 0.14), { rotation: [0, ry, 0] });
    box(belfry, m.window, [1.1, 1.6, 0.05], f.at(0, 4, 0.02), { rotation: [0, ry, 0] });
  }
  const roof = new THREE.Mesh(roofGeometry(7, 7, 4.2, 0.6, 'hip'), m.roof); roof.position.y = 19.2; roof.castShadow = true; root.add(roof);
  for (const side of [-1, 1]) label(root, 'Ⅻ\n◷', 2.6, 2.6, [0, 15.9, side * 3.52], { background: '#f4efe3', color: '#2d3a2f', fontSize: 240, rotation: [0, side > 0 ? 0 : Math.PI, 0] });
  batchStaticGeometry(root);
  return { minX: x - 3.8, maxX: x + 3.8, minZ: z - 3.8, maxZ: z + 3.8 };
}

/** Combine identical static window/frame instance buffers across the small district.
 * World transforms, per-instance colours and both shadow flags are retained. */
export const CELL = 140;
export function batchCityInstances(root, cell = CELL) {
  root.updateWorldMatrix(true,true);
  const inverse=root.matrixWorld.clone().invert(),groups=new Map();
  root.traverse(mesh=>{
    if(!mesh.isInstancedMesh || Array.isArray(mesh.material))return;
    const centre=mesh.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld);
    // Keep each ~140 m area independently cullable instead of one district-wide bound.
    const key=[Math.floor(centre.x/cell),Math.floor(centre.z/cell),mesh.geometry.uuid,mesh.material.uuid,mesh.castShadow,mesh.receiveShadow,Boolean(mesh.instanceColor)].join('/');
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
