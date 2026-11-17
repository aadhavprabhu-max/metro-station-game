import * as THREE from 'three';
import { box, seededRandom } from './geometry.js';
import { uvMesh, CLUMP } from './city-buildings.js';
import { PropKit, addLamp, addBench, addCafe } from './city-props.js';
import { STREET_Y, CITY_BOUNDS, OLD_TOWN, CITY_ROADS, CITY_CROSSINGS, TERRACE, SQUARE_SITE, SQUARE_ISLAND } from './city-layout.js';
import { curtainWall, brickFacade, gridFacade, stoneFacade, shopfrontTexture, mastTexture } from './downtown-textures.js';
import { glowFacade, GLOW } from './night-glow.js';

/**
 * Downtown: non-enterable towers built as a few solid blocks with code-drawn facades,
 * merged by material per area. Palette follows the downtown reference renders: cobalt glass
 * with steel-blue floor bands, brown brick with muted stone trim, sand stone with ochre piers;
 * teal-grey hip roofs, slate and beige as accents. At night the windows glow by building type:
 * glass cool white, brick warm amber, stone golden.
 */
export function downtownMaterials(m) {
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra });
  const glass = map => std('#ffffff', { map, roughness: 0.46, metalness: 0.1 });
  const d = {
    glassBlue: glass(curtainWall({ seed: 1 })),
    glassBlueLight: glass(curtainWall({ glass: ['#2b4f95', '#33599f', '#284a8c', '#3a63aa'], mullion: '#203a68', spandrel: '#b4c2d4', edge: '#dbe3ee', light: true, seed: 2 })),
    glassTeal: glass(curtainWall({ glass: ['#2a6f86', '#337d94', '#235f74', '#3d8aa0'], mullion: '#123a48', spandrel: '#16404e', edge: '#3f7686', seed: 3 })),
    glassSlate: glass(curtainWall({ glass: ['#4a5868', '#55657a', '#3e4a58', '#5f7088'], mullion: '#20282f', spandrel: '#2e3844', edge: '#6a7686', seed: 4 })),
    glassDark: glass(curtainWall({ glass: ['#17233e', '#1d2c4c', '#121c34', '#24365c'], mullion: '#0a0f1c', spandrel: '#0e1626', edge: '#2a3a5a', seed: 5 })),
    // Red brick with projecting piers and paired tall windows; the brown tower has a square-window grid.
    brick: std('#ffffff', { map: brickFacade({ seed: 7 }), roughness: 0.9 }),
    brickDark: std('#ffffff', { map: gridFacade({ seed: 8 }), roughness: 0.88 }),
    tan: std('#ffffff', { map: stoneFacade({ seed: 11 }), roughness: 0.86 }),
    beige: std('#ffffff', { map: stoneFacade({ wall: '#cbbda2', pier: '#bcae92', pierLight: '#d4c7ab', pierShadow: '#948669', glass: '#46525f', mullion: '#ece4d2', sill: '#efe7d6', seed: 12 }), roughness: 0.86 }),
    shop: std('#ffffff', { map: shopfrontTexture(), roughness: 0.45 }),
    shopRed: std('#ffffff', { map: shopfrontTexture({ fascia: '#7e2a22', seed: 4 }), roughness: 0.45 }),
    stoneTrim: std('#e2d2ae', { roughness: 0.85 }), tanTrim: std('#b58a48', { roughness: 0.7 }), brickTrim: std('#cdb38e', { roughness: 0.85 }),
    roofTop: std('#8d918f', { roughness: 0.95 }), plant: std('#7d8187', { roughness: 0.7, metalness: 0.3 }),
    roofTeal: std('#58798a', { roughness: 0.6, metalness: 0.2, flatShading: true }),
    mast: std('#ffffff', { map: mastTexture(), roughness: 0.5 }), antenna: std('#d9dde2', { roughness: 0.4, metalness: 0.5 }),
    blossom: ['#d42a8c', '#f29a2e', '#f5c42a', '#5bbf3a', '#e8508f'], crown: std('#ffffff', { flatShading: true, roughness: 0.8 }),
    kiosk: std('#c8202a', { roughness: 0.5 }), lawn: m.grass, railing: m.railing, ground: m.paving,
    hull: ['#f4f1ea', '#c8202a', '#1f56a8', '#2e8b57'].map(color => std(color, { roughness: 0.6 })),
  };
  for (const key of ['glassBlue', 'glassBlueLight', 'glassTeal', 'glassSlate', 'glassDark', 'brick', 'brickDark', 'tan', 'beige', 'shop', 'shopRed']) d[key].userData.facade = true;
  // Night windows: one colour per building type; shopfronts stay lit a little longer.
  for (const key of ['glassBlue', 'glassBlueLight', 'glassTeal', 'glassSlate', 'glassDark']) glowFacade(d[key], GLOW.cool, { strength: 0.95 });
  for (const key of ['brick', 'brickDark']) glowFacade(d[key], GLOW.warm, { strength: 1.3 });
  for (const key of ['tan', 'beige']) glowFacade(d[key], GLOW.gold, { strength: 1.2 });
  for (const key of ['shop', 'shopRed']) glowFacade(d[key], GLOW.warm, { strength: 1.2, bias: 0.25 });
  // Trees fade out beyond ~300 m (fog hides them anyway); planters and kiosks are small clutter.
  d.crown.userData.detail = 300; m.terracotta.userData.detail = 300; m.timber.userData.detail = 300; d.kiosk.userData.detail = true; d.kiosk.userData.noCast = true;
  return d;
}

const hash = (...v) => { const x = Math.sin(v.reduce((s, n, i) => s + n * [12.9898, 78.233, 37.719][i % 3], 0)) * 43758.5453; return x - Math.floor(x); };

/**
 * Box with UVs scaled to the facade module (map.userData.tileU/V metres), aligned to the box's bottom edge.
 * Each box is shifted by a whole number of modules (same look by day), so its lit windows at night differ.
 */
export function facadeBox(parent, mat, size, position, { shadow = true } = {}) {
  const [sx, sy, sz] = size, tu = mat.map?.userData.tileU ?? 4, tv = mat.map?.userData.tileV ?? 4;
  const geometry = new THREE.BoxGeometry(sx, sy, sz), uv = geometry.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  const seed = hash(...position), ou = Math.floor(seed * 29), ov = Math.floor(hash(seed, sx, sz) * 17);
  for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) { const i = face * 4 + k; uv.setXY(i, uv.getX(i) * dims[face][0] / tu + ou + face * 3, uv.getY(i) * dims[face][1] / tv + ov); }
  const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(...position);
  mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

const STYLES = [['glassBlue', 28], ['brick', 18], ['tan', 16], ['glassBlueLight', 9], ['brickDark', 17], ['beige', 6], ['glassTeal', 4], ['glassSlate', 2]];
function pickStyle(random, avoid) {
  const total = STYLES.reduce((s, [, w]) => s + w, 0);
  for (let tries = 0; tries < 6; tries++) {
    let r = random() * total;
    for (const [style, w] of STYLES) { r -= w; if (r <= 0) { if (style !== avoid) return style; break; } }
  }
  return 'glassBlue';
}

/**
 * One tower on a lot: shopfront podium, shaft (optionally with a setback), roof and a crown by style.
 * Returns the footprint collider.
 */
export function buildTower(group, d, lot, random) {
  const { x0, x1, z0, z1, style } = lot, H = lot.height, y = STREET_Y, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, dd = z1 - z0;
  const mat = d[style], glass = style.startsWith('glass'), brick = style.startsWith('brick');
  const pod = 5;
  facadeBox(group, random() < 0.25 ? d.shopRed : d.shop, [w, pod, dd], [cx, y + pod / 2, cz]);
  uvMesh(group, glass ? d.plant : brick ? d.brickTrim : d.stoneTrim, [w + 0.3, 0.45, dd + 0.3], [cx, y + pod + 0.2, cz], { tile: 3 });
  const inset = glass ? random() * 1.4 : brick ? 0 : random() * 0.6;
  const setback = H > 48 && random() < 0.6 ? H * (0.55 + random() * 0.2) : H;
  const w1 = w - 2 * inset, d1 = dd - 2 * inset;
  facadeBox(group, mat, [w1, setback - pod, d1], [cx, y + (pod + setback) / 2, cz]);
  // The reference masonry towers have no extra string courses; the draw keeps the shared random sequence (and so the layout) unchanged.
  if (!glass) random();
  let topW = w1, topD = d1, top = setback;
  if (setback < H) {
    const s = 2.5 + random() * 3.5; topW = Math.max(8, w1 - 2 * s); topD = Math.max(8, d1 - 2 * s);
    uvMesh(group, glass ? d.plant : brick ? d.brickTrim : d.stoneTrim, [w1 + 0.4, 0.7, d1 + 0.4], [cx, y + setback + 0.1, cz], { tile: 3 });
    facadeBox(group, mat, [topW, H - setback, topD], [cx, y + (setback + H) / 2, cz]);
    top = H;
  }
  // Roof: cap, parapet, plant rooms; then a crown by style.
  uvMesh(group, d.roofTop, [topW, 0.5, topD], [cx, y + top + 0.25, cz], { tile: 4 });
  if (brick) {
    uvMesh(group, d.brickTrim, [topW + 1.2, 1.0, topD + 1.2], [cx, y + top + 0.4, cz], { tile: 3 });
    const pw = topW * (0.55 + random() * 0.2), pd = topD * (0.55 + random() * 0.2), ph = 4 + random() * 5;
    facadeBox(group, mat, [pw, ph, pd], [cx, y + top + 0.9 + ph / 2, cz]);
    uvMesh(group, d.brickTrim, [pw + 0.9, 0.7, pd + 0.9], [cx, y + top + 0.9 + ph + 0.35, cz], { tile: 3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) uvMesh(group, d.brickTrim, [1, 2.2, 1], [cx + sx * (topW / 2 - 0.2), y + top + 1.9, cz + sz * (topD / 2 - 0.2)], { tile: 3 });
    if (random() < 0.5) uvMesh(group, d.roofTop, [pw * 0.5, 2.6, pd * 0.5], [cx, y + top + 0.9 + ph + 2, cz], { tile: 3 });
  } else if (style === 'tan' || style === 'beige') {
    const trim = style === 'tan' ? d.tanTrim : d.stoneTrim;
    uvMesh(group, trim, [topW + 1.4, 1.1, topD + 1.4], [cx, y + top + 0.5, cz], { tile: 3 });
    // A shallow pediment crown along the longer side.
    const along = topW >= topD, span = (along ? topD : topW) * 0.9, len = (along ? topW : topD) * 0.6, rise = span * 0.22;
    const shape = new THREE.Shape(); shape.moveTo(-span / 2, 0); shape.lineTo(span / 2, 0); shape.lineTo(0, rise); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2);
    if (along) g.rotateY(Math.PI / 2);
    const crown = new THREE.Mesh(g, trim); crown.position.set(cx, y + top + 1.05, cz); crown.castShadow = crown.receiveShadow = true; group.add(crown);
    if (style === 'beige') for (let k = 1; k <= 2; k++) uvMesh(group, d.stoneTrim, [topW + 1.2, 0.3, topD + 1.2], [cx, y + top - k * 3.6, cz], { tile: 3 });
  } else {
    uvMesh(group, d.plant, [topW + 0.2, 1.1, topD + 0.2], [cx, y + top + 0.55, cz], { tile: 3 });
    const pw = topW * 0.45, pd = topD * 0.4, ph = 3 + random() * 3, ox = (random() - 0.5) * topW * 0.2, oz = (random() - 0.5) * topD * 0.2;
    // Some glass towers wear a teal-grey hip roof (as in the reference); the rest a plant room.
    // (Extra choices use a position hash so the shared random sequence, and so the layout, is unchanged.)
    const hip = hash(cx, top, cz) < 0.4;
    if (hip) {
      const rise = Math.min(topW, topD) * (0.28 + 0.12 * hash(cz, cx));
      const roof = new THREE.Mesh(HIP, d.roofTeal); roof.scale.set(topW + 0.2, rise, topD + 0.2); roof.position.set(cx, y + top + 1.1, cz);
      roof.castShadow = roof.receiveShadow = true; group.add(roof);
    } else uvMesh(group, d.roofTop, [pw, ph, pd], [cx + ox, y + top + 0.5 + ph / 2, cz + oz], { tile: 3 });
    const mast = random() < 0.35, mastH = mast ? 10 + random() * 14 : 0;
    if (mast) box(group, d.antenna, [0.25, mastH, 0.25], hip ? [cx, y + top + 1 + mastH / 2, cz] : [cx + topW * 0.2, y + top + 6, cz - topD * 0.2]);
    // Balcony railings around the top floors of some glass towers: a slim rail and corner posts.
    if (random() < 0.35 && top - pod > 20) {
      const ry = y + top - 3.6 + 0.5, W = topW + 0.8, D = topD + 0.8;
      for (const s of [-1, 1]) {
        box(group, d.plant, [W, 0.07, 0.07], [cx, ry + 0.5, cz + s * D / 2], { shadow: false });
        box(group, d.plant, [0.07, 0.07, D], [cx + s * W / 2, ry + 0.5, cz], { shadow: false });
        box(group, d.plant, [W, 0.12, 0.25], [cx, ry - 0.5, cz + s * D / 2], { shadow: false });
        box(group, d.plant, [0.25, 0.12, D], [cx + s * W / 2, ry - 0.5, cz], { shadow: false });
        for (const t of [-1, 1]) box(group, d.plant, [0.07, 1.0, 0.07], [cx + s * W / 2, ry, cz + t * D / 2], { shadow: false });
      }
    }
  }
  return { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
}

/** Stepped dark twin-antenna skyscraper made of bundled square tubes (about 230 m). */
export function buildSupertall(group, d, cx, cz, colliders) {
  const tube = 16, y = STREET_Y, heights = [[150, 205, 150], [205, 232, 232], [110, 180, 150]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const h = heights[i][j], x = cx + (i - 1) * tube, z = cz + (j - 1) * tube;
    facadeBox(group, d.glassSlate, [tube, h, tube], [x, y + h / 2, z]);
    uvMesh(group, d.plant, [tube + 0.3, 0.8, tube + 0.3], [x, y + h + 0.4, z], { tile: 3 });
  }
  facadeBox(group, d.shop, [tube * 3 + 1, 6, tube * 3 + 1], [cx, y + 3, cz]);
  for (const [dx, dz] of [[-4, 4], [4, 4]]) {
    box(group, d.antenna, [0.9, 46, 0.9], [cx + dx, y + 232 + 23, cz + tube + dz - 4]);
    box(group, d.antenna, [1.6, 3, 1.6], [cx + dx, y + 232 + 1.5, cz + tube + dz - 4]);
  }
  colliders.push({ minX: cx - 1.5 * tube - 0.5, maxX: cx + 1.5 * tube + 0.5, minZ: cz - 1.5 * tube - 0.5, maxZ: cz + 1.5 * tube + 0.5 });
}

/** Slim needle tower with a red-and-white mast. */
export function buildNeedle(group, d, cx, cz, colliders) {
  const y = STREET_Y;
  facadeBox(group, d.shop, [24, 5, 24], [cx, y + 2.5, cz]);
  facadeBox(group, d.glassBlueLight, [22, 120, 22], [cx, y + 5 + 60, cz]);
  facadeBox(group, d.glassBlueLight, [15, 30, 15], [cx, y + 125 + 15, cz]);
  facadeBox(group, d.glassBlue, [9, 14, 9], [cx, y + 155 + 7, cz]);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 58, 8), d.mast); mast.position.set(cx, y + 169 + 29, cz); mast.castShadow = true; group.add(mast);
  colliders.push({ minX: cx - 12, maxX: cx + 12, minZ: cz - 12, maxZ: cz + 12 });
}

// ------------------------------------------------------------------ layout
const roadHalf = r => r.width / 2 + r.walk;
/** Downtown blocks between the roads (inset 1 m from sidewalks). Each has an area tag for staged building. */
export const DOWNTOWN_BLOCKS = (() => {
  const B = CITY_BOUNDS, blocks = [];
  const add = (area, x0, x1, z0, z1, extra = {}) => { if (x1 - x0 > 8 && z1 - z0 > 8) blocks.push({ area, x0, x1, z0, z1, ...extra }); };
  const cols = [[B.minX + 1, -241], [-219, -152]], colsE = [[125, 189], [211, B.maxX - 1]];
  // North band above North Avenue.
  for (const [x0, x1] of [[B.minX + 1, -241], [-219, -111.5], [-96.5, -25.2], [-7.2, 76.5], [91.5, 189], [211, B.maxX - 1]]) add('north', x0, x1, 41, B.maxZ - 1);
  // Between Via dei Limoni and North Avenue.
  for (const [x0, x1] of [[B.minX + 1, -241], [-219, -152]]) add('north', x0, x1, -78.5, 19);
  add('north', -147, -111.5, -49, 19);
  add('park', -96.5, -25.2, -21, 19);
  add('north', -7.2, 76.5, -21, 19);
  add('north', 91.5, 120, -46, 19);
  for (const [x0, x1] of colsE) add('north', x0, x1, -78.5, 19);
  // West and east of the old town, between the canal and Via dei Limoni.
  for (const [x0, x1] of cols) { add('west', x0, x1, -111, -93.5); add('west', x0, x1, -221, -129); add('west', x0, x1, -327.5, -247); }
  for (const [x0, x1] of colsE) { add('east', x0, x1, -111, -93.5); add('east', x0, x1, -221, -129); }
  add('east', 125, 189, -311, -247); add('east', 211, B.maxX - 1, -327.5, -247);
  // South of the canal.
  const southCols = [[B.minX + 1, -241, 'southwest'], [-219, -115, 'southwest'], [-93, null, 'southcentre'], [null, 73, 'southcentre'], [95, 189, 'southeast'], [211, B.maxX - 1, 'southeast']];
  const rows = [[-419, -353.5], [-487, -441], [-559, -513], [B.minZ + 1, -581]];
  for (const [ri, [z0, z1]] of rows.entries()) for (const [x0, x1, area] of southCols) {
    const inner = ri === 0 ? [-27.2, -5.2] : ri === 3 ? [-16.2, -16.2] : [SQUARE_SITE.minX - 0.5, SQUARE_SITE.maxX + 0.5];
    if (ri === 3 && x0 === -93) { add(area, -93, 73, z0, z1, { landmarks: true }); continue; }
    if (ri === 3 && x1 === 73) continue;
    add(area, x0 ?? inner[1], x1 ?? inner[0], z0, z1, { square: ri === 1 || ri === 2 ? (x0 === -93 ? 'west' : x1 === 73 ? 'east' : null) : null });
  }
  return blocks;
})();

export const LANDMARKS = Object.freeze({ supertall: [-62, -621], needle: [40, -612], screenTower: [-16.2, -590] });

/** Split a block into perimeter lots of roughly 18–30 m, with narrow service gaps between towers. */
function lotsFor(block, random) {
  const w = block.x1 - block.x0, d = block.z1 - block.z0;
  const nx = Math.max(1, Math.round(w / 24)), nz = Math.max(1, Math.round(d / 24)), lots = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
    const gx = 0.8 + random() * 1.8, gz = 0.8 + random() * 1.8;
    lots.push({ x0: block.x0 + w * i / nx + (i ? gx / 2 : 0), x1: block.x0 + w * (i + 1) / nx - (i < nx - 1 ? gx / 2 : 0),
      z0: block.z0 + d * j / nz + (j ? gz / 2 : 0), z1: block.z0 + d * (j + 1) / nz - (j < nz - 1 ? gz / 2 : 0) });
  }
  return lots;
}

/** Height: tallest around Aurealis Square and the south core, stepping down toward the old town. */
function heightFor(cx, cz, random) {
  const core = Math.hypot(cx + 16, cz + 500), near = Math.max(0, Math.min(Math.abs(cx - (OLD_TOWN.minX + OLD_TOWN.maxX) / 2) - (OLD_TOWN.maxX - OLD_TOWN.minX) / 2, Math.abs(cz - (OLD_TOWN.minZ + OLD_TOWN.maxZ) / 2) - (OLD_TOWN.maxZ - OLD_TOWN.minZ) / 2));
  let h = 46 + 135 * Math.exp(-core / 260) * (0.6 + random() * 0.7) + random() * 38;
  if (near < 70) h = Math.min(h, 30 + near * 1.6 + random() * 10);
  return Math.round(Math.max(20, Math.min(175, h)) / 3.6) * 3.6 + 1.4;
}

/** Queue one build job per area; each returns its own group for per-area merging. */
export function queueDowntown(surface, d) {
  const areas = [...new Set(DOWNTOWN_BLOCKS.map(b => b.area))];
  for (const area of areas) surface.jobs.push(() => {
    const group = new THREE.Group(); group.name = `Downtown-${area}`; surface.district.add(group);
    const random = seededRandom(area.length * 977 + area.charCodeAt(0)), kit = new PropKit();
    let last = null;
    for (const block of DOWNTOWN_BLOCKS.filter(b => b.area === area)) {
      if (block.area === 'park') { addPark(group, kit, surface.materials, d, block, surface.colliders, random); continue; }
      if (block.landmarks) {
        buildSupertall(group, d, ...LANDMARKS.supertall, surface.colliders);
        buildNeedle(group, d, ...LANDMARKS.needle, surface.colliders);
      }
      for (const lot of lotsFor(block, random)) {
        const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
        if (block.landmarks && (Math.abs(cx - LANDMARKS.supertall[0]) < 40 && Math.abs(cz - LANDMARKS.supertall[1]) < 40 || Math.abs(cx - LANDMARKS.needle[0]) < 26 && Math.abs(cz - LANDMARKS.needle[1]) < 26 || Math.abs(cx - LANDMARKS.screenTower[0]) < 18)) continue;
        if (lot.x1 - lot.x0 < 9 || lot.z1 - lot.z0 < 9) continue;
        // Lots taken by Aurealis Square's clock tower and red-spired tower are built with the square.
        if ([SQUARE_ISLAND.clockTower, SQUARE_ISLAND.spireTower].some(([px, pz]) => px > lot.x0 - 10 && px < lot.x1 + 10 && pz > lot.z0 - 10 && pz < lot.z1 + 10)) continue;
        lot.style = block.square ? ['glassDark', 'brick', 'glassDark', 'brickDark', 'glassBlue'][Math.floor(random() * 5)] : pickStyle(random, last); last = lot.style;
        lot.height = heightFor(cx, cz, random);
        if (block.square) lot.height = Math.max(lot.height, Math.round((70 + random() * 70) / 3.6) * 3.6 + 1.4);
        lot.square = block.square;
        surface.colliders.push(buildTower(group, d, lot, random));
        surface.towers.push(lot);
      }
    }
    addStreetProps(kit, surface.materials, d, area, surface.colliders, random);
    if (area === 'southwest' || area === 'southeast') addCanalPiers(group, kit, surface.materials, d, area, surface.colliders);
    kit.flush(group);
    return group;
  });
  surface.jobs.push(() => { const group = new THREE.Group(); group.name = 'Downtown-skyline'; surface.district.add(group); addSkyline(group, d); return group; });
}

const inRect = (r, x, z, m = 0) => x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m;
const areaOf = (x, z) => z < -339 ? (x < -115 ? 'southwest' : x > 94 ? 'southeast' : 'southcentre') : z > -79 ? 'north' : x < 0 ? 'west' : 'east';

/** Blossom trees in square planters and lamp posts along downtown sidewalks; cafés with awnings; kiosks; bunting. */
function addStreetProps(kit, m, d, area, colliders, random) {
  const y = STREET_Y, skip = (x, z) => inRect(OLD_TOWN, x, z, 3) || inRect(SQUARE_SITE, x, z, 2) || (z > -341 && z < -326) || areaOf(x, z) !== area
    || (x > TERRACE.minX - 3 && x < TERRACE.maxX + 3 && z > TERRACE.minZ - 3 && z < TERRACE.maxZ + 6);
  for (const road of CITY_ROADS) {
    const w = road.width / 2, at = (a, b) => road.axis === 'x' ? [a, road.c + b] : [road.c + b, a];
    const near = a => CITY_ROADS.some(o => o.axis !== road.axis && a > o.c - roadHalf(o) - 6 && a < o.c + roadHalf(o) + 6 && o.from <= road.c && o.to >= road.c)
      || CITY_CROSSINGS.some(([name, c]) => name === road.name && Math.abs(a - c) < 5) || a < road.from + 4 || a > road.to - 4;
    for (const side of [-1, 1]) {
      let n = 0;
      for (let a = road.from + 5.5 + (side > 0 ? 0 : 5.5); a < road.to - 4; a += 11, n++) {
        if (near(a)) continue;
        const [tx, tz] = at(a, side * (w + 1.0));
        if (skip(tx, tz)) continue;
        if (n % 3 === 1) {
          const [lx, lz] = at(a, side * (w + 0.45)); addLamp(kit, m, lx, lz, y);
          colliders.push({ minX: lx - 0.14, maxX: lx + 0.14, minZ: lz - 0.14, maxZ: lz + 0.14 });
          continue;
        }
        addBlossomTree(kit, d, m, tx, tz, random);
        colliders.push({ minX: tx - 0.7, maxX: tx + 0.7, minZ: tz - 0.7, maxZ: tz + 0.7 });
      }
      // Cafés: a striped awning on the shopfront and bistro sets against the facade.
      if (road.walk >= 4) for (let a = road.from + 30 + random() * 40; a < road.to - 20; a += 70 + random() * 60) {
        if (near(a) || near(a + 4) || near(a - 4)) continue;
        const [ax, az] = at(a, side * (w + road.walk + 1.2)), [cx, cz] = at(a, side * (w + road.walk - 1.1));
        if (skip(cx, cz)) continue;
        const awning = m.awnings[Math.floor(random() * m.awnings.length)], yaw = road.axis === 'x' ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        // Tilted so the outer edge drops toward the street.
        kit.add(awning, { size: road.axis === 'x' ? [5.2, 0.06, 1.7] : [1.7, 0.06, 5.2], position: [ax + (road.axis === 'z' ? -side * 0.8 : 0), y + 3.2, az + (road.axis === 'x' ? -side * 0.8 : 0)],
          rotation: road.axis === 'x' ? [-side * 0.38, 0, 0] : [0, 0, side * 0.38] });
        void yaw;
        for (const e of [-1.4, 1.4]) {
          const [bx, bz] = road.axis === 'x' ? [cx + e, cz] : [cx, cz + e];
          kit.add(m.tablecloth, { size: [0.35, 0.04, 0.35], position: [bx, y + 0.74, bz] }, PIPE);
          kit.add(m.iron, { size: [0.03, 0.72, 0.03], position: [bx, y + 0.36, bz] }, PIPE);
          for (const k of [-0.5, 0.5]) kit.add(m.cafeWood, { size: [0.38, 0.05, 0.38], position: road.axis === 'x' ? [bx + k, y + 0.45, bz] : [bx, y + 0.45, bz + k] });
          colliders.push({ minX: bx - 0.75, maxX: bx + 0.75, minZ: bz - 0.75, maxZ: bz + 0.75 });
        }
      }
    }
  }
  // A few red kiosks on the pavement, 1 m behind the kerb (the avenue kiosks previously stood on or over it,
  // three of them inside the East and Garibaldi Avenue traffic lanes).
  for (const [x, z] of [[-237, -140], [193, -150], [-111, -380], [77, -470], [-237, -470], [193, 60], [-98, 55], [-25.6, -390]]) {
    if (areaOf(x, z) !== area) continue;
    // Red street kiosk: slim body, glazed upper band, overhanging roof.
    kit.add(d.kiosk, { size: [1.1, 1.5, 0.9], position: [x, y + 0.75, z] });
    kit.add(m.window, { size: [1.12, 0.7, 0.92], position: [x, y + 1.85, z] });
    kit.add(d.kiosk, { size: [1.4, 0.16, 1.2], position: [x, y + 2.28, z] });
    colliders.push({ minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.6, maxZ: z + 0.6 });
  }
}

const PIPE = new THREE.CylinderGeometry(1, 1, 1, 8);
// Unit square pyramid (1 × 1 base, 1 high, base at y = 0) for hip roofs.
const HIP = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
const PLANTER = new THREE.BoxGeometry(1, 1, 1);
const CROWN = new THREE.IcosahedronGeometry(1, 0);
export function addBlossomTree(kit, d, m, x, z, random, planter = true, colour = null) {
  const y = STREET_Y, base = planter ? 0.62 : 0, s = 1.25 + random() * 0.55;
  if (planter) {
    kit.add(m.terracotta, { size: [1.3, 0.62, 1.3], position: [x, y + 0.31, z] }, PLANTER);
    kit.add(m.timber, { size: [1.12, 0.04, 1.12], position: [x, y + 0.62, z] }, PLANTER);
  }
  kit.add(m.timber, { size: [0.09, 1.9, 0.09], position: [x, y + base + 0.95, z] }, PIPE);
  const leaf = colour ?? d.blossom[random() < 0.12 ? 3 : [0, 1, 2, 4][Math.floor(random() * 4)]];
  kit.add(d.crown, { size: [s, s * 0.85, s], position: [x, y + base + 2.3 + s * 0.4, z], rotation: [random(), random() * 6, random()], color: leaf }, CROWN);
  kit.add(d.crown, { size: [s * 0.7, s * 0.6, s * 0.7], position: [x + (random() - 0.5) * s, y + base + 2.5 + s * 0.6, z + (random() - 0.5) * s], rotation: [random(), random() * 6, 0], color: leaf }, CROWN);
}

/** Terrace Park: lawn, paths, blossom trees, a café terrace with parasols and benches. */
function addPark(group, kit, m, d, b, colliders, random) {
  const y = STREET_Y, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  box(group, m.grass, [b.x1 - b.x0, 0.04, b.z1 - b.z0], [cx, y + 0.02, cz], { shadow: false }).receiveShadow = true;
  // Cross path through the park, and the short link from the terrace's north stair to Terrace Street. The link
  // stops where the street begins: it used to continue for 34 m down the middle of the carriageway.
  const street = CITY_ROADS.find(r => r.name === 'TERRACE STREET'), link = [b.z0, street.from];
  for (const [sx, sz, px, pz] of [[b.x1 - b.x0, 4, cx, cz], [4, link[1] - link[0], -16.2, (link[0] + link[1]) / 2]]) uvMesh(group, m.paving, [sx, 0.03, sz], [px, y + 0.045, pz], { tile: 8, shadow: false });
  for (let i = 0; i < 16; i++) {
    const x = b.x0 + 3 + random() * (b.x1 - b.x0 - 6), z = b.z0 + 3 + random() * (b.z1 - b.z0 - 6);
    if (Math.abs(z - cz) < 4 || Math.abs(x + 16.2) < 4) continue;
    addBlossomTree(kit, d, m, x, z, random, random() < 0.5, d.blossom[[3, 1, 2, 3, 0][i % 5]]);
    colliders.push({ minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.7, maxZ: z + 0.7 });
  }
  for (const [i, [x, z]] of [[-40, 10], [-34, 10], [-40, 3]].entries()) colliders.push(addCafe(kit, m, x, z, y, 30 + i));
  for (const [x, z] of [[-70, -1.5], [-55, -1.5], [-80, 13]]) { addBench(kit, m, x, z, y); colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 1.75, maxZ: z + 1.75 }); }
}

const HULL = (() => {
  const s = new THREE.Shape(); s.moveTo(-2.6, 0); s.lineTo(2.2, 0); s.quadraticCurveTo(3.4, 0, 3.6, 0.9); s.lineTo(-2.9, 0.9); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 1.8, bevelEnabled: false }).translate(0, 0, -0.9);
})();
/** Two small timber piers with moored boats on the downtown stretches of the canal. */
function addCanalPiers(group, kit, m, d, area, colliders) {
  const water = STREET_Y - 1.21, x = area === 'southwest' ? -253 : 223; // beside the road bridges, so they can be seen
  uvMesh(group, m.cafeWood, [9, 0.25, 3.2], [x, STREET_Y - 0.55, -336.3], { tile: 2 });
  for (const dx of [-4, 0, 4]) for (const dz of [-1.4, 1.4]) kit.add(m.timber, { size: [0.14, 1.6, 0.14], position: [x + dx, water + 0.2, -336.3 + dz] }, PIPE);
  for (const [i, dx] of (x < 0 ? [-10, 2, 9] : [10, -2, -9]).entries()) {
    const hull = new THREE.Mesh(HULL, d.hull[(i + (x > 0 ? 1 : 0)) % d.hull.length]);
    hull.position.set(x + dx, water - 0.35, -333.2 + (i % 2) * 0.6); hull.rotation.y = i % 2 ? Math.PI : 0; hull.castShadow = true; group.add(hull);
    uvMesh(group, d.hull[0], [2.2, 0.7, 1.3], [x + dx - 0.4, water + 0.85, -333.2 + (i % 2) * 0.6], { tile: 2 });
  }
}

/** Simple, shadowless towers just outside the boundary so every street ends in more city. */
function addSkyline(group, d) {
  const B = CITY_BOUNDS, random = seededRandom(4242), styles = ['glassBlue', 'brick', 'tan', 'glassBlueLight', 'glassBlue', 'brickDark', 'glassSlate'];
  // Ground beyond the boundary wall only (never over the canal or the district).
  const W = B.maxX - B.minX, D = B.maxZ - B.minZ, cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2, edge = 130;
  for (const [sx, sz, px, pz] of [[W + 2 * edge, edge, cx, B.minZ - edge / 2], [W + 2 * edge, edge, cx, B.maxZ + edge / 2], [edge, D, B.minX - edge / 2, cz], [edge, D, B.maxX + edge / 2, cz]])
    uvMesh(group, d.ground, [sx, 0.05, sz], [px, STREET_Y - 0.025, pz], { tile: 8, shadow: false }).receiveShadow = true;
  const ring = (fixed, from, to, alongX, outward) => {
    for (let t = from; t < to;) {
      const w = 22 + random() * 18, depth = 22 + random() * 16, h = 30 + random() * (outward < 0 && !alongX ? 90 : 120);
      const off = 14 + depth / 2 + random() * 30, c = t + w / 2, pos = alongX ? [c, STREET_Y + h / 2, fixed + outward * off] : [fixed + outward * off, STREET_Y + h / 2, c];
      facadeBox(group, d[styles[Math.floor(random() * styles.length)]], alongX ? [w, h, depth] : [depth, h, w], pos, { shadow: false });
      t += w + 4 + random() * 10;
    }
  };
  ring(B.minZ, B.minX - 80, B.maxX + 80, true, -1); ring(B.maxZ, B.minX - 80, B.maxX + 80, true, 1);
  ring(B.minX, B.minZ, B.maxZ, false, -1); ring(B.maxX, B.minZ, B.maxZ, false, 1);
}
