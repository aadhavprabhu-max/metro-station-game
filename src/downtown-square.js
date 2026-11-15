import * as THREE from 'three';
import { box, canvasTexture, seededRandom, label } from './geometry.js';
import { uvMesh } from './city-buildings.js';
import { PropKit } from './city-props.js';
import { STREET_Y, SQUARE_SITE, SQUARE_ISLAND } from './city-layout.js';
import { facadeBox, addBlossomTree, LANDMARKS } from './downtown-buildings.js';
import { clockTexture } from './downtown-textures.js';

/*
 * Aurealis Square: a Times Square–style plaza in daylight. All billboard artwork and brands
 * are original and drawn in code (no real logos). Screens use unlit materials so they read as
 * glowing panels against the facades; two tickers scroll by texture offset only.
 */
const T = (ctx, text, x, y, size, color = '#fff', weight = 800, align = 'center') => {
  ctx.fillStyle = color; ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
};
const circle = (ctx, x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
const poly = (ctx, color, pts) => { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.fill(); };
const bg = (ctx, w, h, a, b, n = 0) => { ctx.fillStyle = a; ctx.fillRect(0, 0, w, h); if (n) for (let i = 0; i < n; i++) { ctx.fillStyle = b; ctx.fillRect(i * w / n, 0, w / (2 * n), h); } };

/** Landscape (512×320) and portrait (256×512) ad designs. */
const ADS = {
  cola: [512, 320, (c, w, h) => { bg(c, w, h, '#d3141e'); poly(c, '#fff', [[0, 210], [w, 140], [w, 175], [0, 245]]);
    c.fillStyle = '#7a0a10'; c.fillRect(392, 60, 54, 200); circle(c, 419, 60, 27, '#7a0a10'); c.fillRect(408, 22, 22, 30);
    T(c, 'LUMA', 190, 92, 92); T(c, 'COLA', 190, 172, 74, '#ffe36b'); T(c, 'Ice cold since 1931', 190, 285, 26, '#fff', 600); }],
  cafe: [512, 320, (c, w, h) => { bg(c, w, h, '#f3e3c3'); circle(c, 120, 170, 86, '#6b3d22'); circle(c, 120, 170, 66, '#f8f1e2'); circle(c, 120, 170, 52, '#7b4a2b');
    c.lineWidth = 9; c.strokeStyle = '#a0866a'; for (const x of [96, 124, 152]) { c.beginPath(); c.moveTo(x, 70); c.quadraticCurveTo(x + 18, 50, x, 30); c.stroke(); }
    T(c, 'CAFÉ NOVA', 345, 130, 58, '#5a2f16'); T(c, 'fresh roast · all day', 345, 200, 28, '#8c5a32', 700); }],
  musical: [256, 512, (c, w, h) => { bg(c, w, h, '#101d4a'); for (let i = 0; i < 40; i++) circle(c, (i * 97) % w, (i * 53) % h, 2, '#ffffff');
    poly(c, '#ffd23a', [...Array(10)].map((_, i) => { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 40 : 96; return [128 + Math.cos(a) * r, 190 + Math.sin(a) * r]; }));
    T(c, 'STARLIGHT', 128, 350, 42, '#ffd23a'); T(c, 'THE MUSICAL', 128, 400, 24); T(c, 'NOW PLAYING', 128, 455, 20, '#ff7aa8', 700); }],
  fest: [512, 320, (c, w, h) => { bg(c, w, h, '#6a1fb0', '#8f35d6', 8); c.fillStyle = '#fff';
    for (const [x, y] of [[80, 200], [150, 150], [420, 190]]) { circle(c, x, y, 22, '#ffe14a'); c.fillStyle = '#ffe14a'; c.fillRect(x + 16, y - 90, 8, 90); c.fillRect(x + 16, y - 90, 40, 10); }
    T(c, 'AURA FEST', 280, 110, 70, '#ffe14a'); T(c, 'Summer music festival', 280, 190, 30); T(c, 'CANAL STAGE · 3 NIGHTS', 280, 250, 24, '#ffb3f2', 700); }],
  burger: [512, 320, (c, w, h) => { bg(c, w, h, '#ffc21a');
    c.fillStyle = '#d98a2b'; c.beginPath(); c.ellipse(140, 120, 100, 60, 0, Math.PI, 0); c.fill(); c.fillStyle = '#5b9e2e'; c.fillRect(40, 120, 200, 18);
    c.fillStyle = '#6b3015'; c.fillRect(46, 138, 188, 34); c.fillStyle = '#f2b818'; c.fillRect(40, 172, 200, 12); c.fillStyle = '#d98a2b'; c.fillRect(46, 184, 188, 34);
    T(c, 'BURGER', 370, 120, 64, '#c8202a'); T(c, 'BAY', 370, 190, 64, '#c8202a'); T(c, 'double stack ✦ 4.90', 370, 262, 26, '#5a2a0a', 700); }],
  pals: [256, 512, (c, w, h) => { bg(c, w, h, '#26c4e8'); circle(c, 128, 200, 96, '#ffe2c0'); circle(c, 92, 180, 14, '#222'); circle(c, 164, 180, 14, '#222');
    c.lineWidth = 10; c.strokeStyle = '#222'; c.beginPath(); c.arc(128, 215, 46, 0.2, Math.PI - 0.2); c.stroke(); poly(c, '#ff5a5a', [[40, 120], [216, 120], [128, 60]]);
    T(c, 'PIXEL PALS', 128, 360, 38); T(c, 'new episodes', 128, 410, 24, '#073b4c', 700); T(c, 'every friday', 128, 445, 24, '#073b4c', 700); }],
  icecream: [256, 512, (c, w, h) => { bg(c, w, h, '#ff8fc3'); poly(c, '#e0a25a', [[78, 250], [178, 250], [128, 430]]);
    circle(c, 100, 220, 46, '#fff6e0'); circle(c, 156, 220, 46, '#8a4b2a'); circle(c, 128, 170, 50, '#ff4f7a'); circle(c, 128, 118, 12, '#d0101f');
    T(c, 'ICE', 128, 470, 40, '#7a1240'); T(c, 'DREAM', 128, 60, 44, '#7a1240'); }],
  air: [512, 320, (c, w, h) => { bg(c, w, h, '#4fb3f0'); circle(c, 420, 70, 40, '#fff4a8');
    poly(c, '#fff', [[60, 170], [330, 150], [370, 160], [330, 172], [60, 182]]); poly(c, '#fff', [[180, 160], [250, 90], [272, 90], [230, 162]]); poly(c, '#fff', [[180, 176], [250, 236], [272, 236], [230, 172]]);
    T(c, 'SKYLINE AIR', 256, 268, 52, '#ffffff'); T(c, 'fly further', 256, 40, 24, '#0b3d66', 700); }],
  neon: [512, 320, (c, w, h) => { bg(c, w, h, '#0b0c18'); c.lineWidth = 8;
    for (const [color, r] of [['#ff2fd2', 90], ['#2ff7ff', 64], ['#fff24a', 38]]) { c.strokeStyle = color; c.beginPath(); c.arc(130, 160, r, 0, Math.PI * 2); c.stroke(); }
    T(c, 'NEON', 360, 120, 66, '#ff2fd2'); T(c, 'NIGHTS', 360, 200, 66, '#2ff7ff'); }],
  play: [512, 320, (c, w, h) => { bg(c, w, h, '#2fb34a'); c.fillStyle = '#1b1f2a'; c.beginPath(); c.ellipse(140, 170, 110, 66, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.fillRect(80, 160, 44, 14); c.fillRect(95, 145, 14, 44); circle(c, 190, 150, 12, '#ff5a5a'); circle(c, 214, 176, 12, '#ffd23a');
    T(c, 'PLAY ZONE', 370, 130, 52); T(c, 'arcade · open late', 370, 200, 26, '#e7ffe9', 700); }],
  bank: [512, 320, (c, w, h) => { bg(c, w, h, '#0e2a5c'); circle(c, 110, 160, 70, '#d9a733'); circle(c, 110, 160, 50, '#0e2a5c'); T(c, 'A', 110, 162, 64, '#d9a733');
    T(c, 'AUREALIS', 340, 130, 54, '#ffffff'); T(c, 'SAVINGS BANK', 340, 195, 30, '#d9a733', 700); }],
  galaxy: [256, 512, (c, w, h) => { bg(c, w, h, '#1b0f3a'); for (let i = 0; i < 50; i++) circle(c, (i * 71) % w, (i * 37) % h, 2, '#ffffff');
    poly(c, '#e9eef5', [[128, 90], [160, 200], [160, 300], [96, 300], [96, 200]]); poly(c, '#ff5a3a', [[96, 300], [128, 380], [160, 300]]); circle(c, 128, 200, 16, '#4fb3f0');
    T(c, 'GALAXY', 128, 420, 44, '#ffb33a'); T(c, 'RUN', 128, 466, 44, '#ffb33a'); }],
  happy: [256, 512, (c, w, h) => { bg(c, w, h, '#ffd84a'); circle(c, 128, 210, 90, '#ff9b4a'); circle(c, 98, 190, 12, '#2b1d12'); circle(c, 158, 190, 12, '#2b1d12');
    c.lineWidth = 9; c.strokeStyle = '#2b1d12'; c.beginPath(); c.arc(128, 220, 44, 0.25, Math.PI - 0.25); c.stroke(); c.fillStyle = '#2b1d12'; c.fillRect(56, 104, 144, 18); c.fillRect(86, 52, 84, 56);
    T(c, 'HAPPY', 128, 370, 46, '#c8202a'); T(c, 'HOUR', 128, 420, 46, '#c8202a'); T(c, 'two for one', 128, 470, 22, '#2b1d12', 700); }],
};
const BLADES = [['THEATRE', '#ff3a3a'], ['HOTEL', '#2ff7ff'], ['CAFE', '#ffd23a'], ['PIZZA', '#ff8a2a'], ['LIVE', '#ff2fd2'], ['MUSIC', '#7aff6a']];
function bladeTexture(text, color) {
  return canvasTexture(64, 512, (c, w, h) => { c.fillStyle = '#121218'; c.fillRect(0, 0, w, h); c.strokeStyle = color; c.lineWidth = 4; c.strokeRect(4, 4, w - 8, h - 8);
    const step = (h - 40) / text.length; for (let i = 0; i < text.length; i++) T(c, text[i], w / 2, 30 + step * (i + 0.5), 44, color); });
}
function tickerTexture(text, color = '#ffb33a') {
  const t = canvasTexture(1024, 64, (c, w, h) => { c.fillStyle = '#0d0f14'; c.fillRect(0, 0, w, h); T(c, text, 8, h / 2, 34, color, 800, 'left'); });
  t.wrapS = THREE.RepeatWrapping; return t;
}
function plazaTexture() {
  const t = canvasTexture(512, 512, (c, w, h) => {
    const random = seededRandom(91); c.fillStyle = '#8f8a82'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = Math.round(214 + random() * 22); c.fillStyle = `rgb(${v},${v - 2},${v - 6})`; c.fillRect(i * 128 + 2, j * 128 + 2, 124, 124); }
    for (let k = 0; k < 3000; k++) { c.fillStyle = `rgba(90,90,90,${0.06 + random() * 0.06})`; c.fillRect(random() * w, random() * h, 2, 2); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

const PIPE = new THREE.CylinderGeometry(1, 1, 1, 10);
const screen = map => new THREE.MeshBasicMaterial({ map, toneMapped: false, color: '#ececec' });

/** Build the whole square; returns tickers to scroll. Runs after the area jobs so tower data exists. */
export function buildAurealisSquare(surface) {
  const m = surface.materials, d = surface.downtown, y = STREET_Y, group = new THREE.Group(); group.name = 'AurealisSquare';
  surface.district.add(group);
  const kit = new PropKit(), random = seededRandom(2026), colliders = surface.colliders, I = SQUARE_ISLAND, tickers = [];
  const red = new THREE.MeshStandardMaterial({ color: '#c7262b', roughness: 0.45, metalness: 0.4 });
  const bronze = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.35, metalness: 0.75 });
  const granite = new THREE.MeshStandardMaterial({ color: '#8d8b88', roughness: 0.6 });
  const frame = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.5, metalness: 0.5 });
  // Island paving (light slabs) over the inner sidewalks, broken by Midtown Street.
  const plaza = new THREE.MeshStandardMaterial({ map: plazaTexture(), roughness: 0.85 });
  for (const [z0, z1] of [[-560, -508], [-492, -440]])
    uvMesh(group, plaza, [I.maxX - I.minX - 0.4, 0.004, z1 - z0], [(I.minX + I.maxX) / 2, y + 0.0172, (z0 + z1) / 2], { tile: 6, shadow: false }).receiveShadow = true;
  // Red bistro tables and chairs in loose clusters, clear of the island's centre line.
  for (const [z0, z1] of [[-488, -446], [-556, -512]]) for (let z = z0 + 3; z < z1 - 2; z += 5.5) for (const side of [-1, 1]) {
    if (random() < 0.2) continue;
    const x = -16.2 + side * (3 + random() * 3.4), tz = z + (random() - 0.5) * 2;
    if (Math.hypot(x - I.statue[0], tz - I.statue[1]) < 5) continue;
    kit.add(red, { size: [0.42, 0.04, 0.42], position: [x, y + 0.74, tz] }, PIPE);
    kit.add(red, { size: [0.035, 0.72, 0.035], position: [x, y + 0.37, tz] }, PIPE);
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + random(), cx = x + Math.cos(a) * 0.72, cz = tz + Math.sin(a) * 0.72;
      kit.add(red, { size: [0.4, 0.04, 0.4], position: [cx, y + 0.45, cz], rotation: [0, -a, 0] });
      kit.add(red, { size: [0.04, 0.42, 0.38], position: [cx + Math.cos(a) * 0.2, y + 0.68, cz + Math.sin(a) * 0.2], rotation: [0, -a, 0] });
      for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) kit.add(red, { size: [0.025, 0.44, 0.025], position: [cx + lx, y + 0.22, cz + lz] }, PIPE);
    }
    colliders.push({ minX: x - 1.05, maxX: x + 1.05, minZ: tz - 1.05, maxZ: tz + 1.05 });
  }
  // Bronze statue on a granite plinth.
  const [sx, sz] = I.statue;
  uvMesh(group, granite, [3, 1.6, 3], [sx, y + 0.8, sz], { tile: 2 }); uvMesh(group, granite, [3.5, 0.3, 3.5], [sx, y + 0.15, sz], { tile: 2 });
  for (const [s, p, r] of [[[0.36, 1.3, 0.36], [-0.22, 2.25, 0], 0], [[0.36, 1.3, 0.36], [0.22, 2.25, 0], 0], [[0.9, 1.2, 0.5], [0, 3.5, 0], 0], [[0.25, 1.1, 0.25], [0.62, 4.4, 0], -0.7], [[0.25, 1.0, 0.25], [-0.6, 3.6, 0], 0.2]])
    box(group, bronze, s, [sx + p[0], y + p[1], sz + p[2]], { rotation: [0, 0, r] });
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), bronze); head.position.set(sx, y + 4.45, sz); head.castShadow = true; group.add(head);
  colliders.push({ minX: sx - 1.8, maxX: sx + 1.8, minZ: sz - 1.8, maxZ: sz + 1.8 });
  // Low granite planters with orange and pink blossom along the island edges.
  for (let z = -556; z < -446; z += 14) for (const x of [I.minX + 1.3, I.maxX - 1.3]) {
    if (z > -514 && z < -486) continue;
    uvMesh(group, granite, [1.6, 0.55, 4], [x, y + 0.275, z], { tile: 2 });
    addBlossomTree(kit, d, m, x, z, random, false, d.blossom[(z / 14 | 0) % 2 ? 1 : 4]);
    colliders.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 2, maxZ: z + 2 });
  }
  // Tall cobra-head street lights on the outer sidewalks and the island.
  for (let z = -555; z < -440; z += 22) for (const [x, dir] of [[-38.6, 1], [6.2, -1], [I.minX + 0.4, -1], [I.maxX - 0.4, 1]]) {
    if (z > -514 && z < -486) continue;
    kit.add(d.antenna ?? m.galvanised, { size: [0.1, 8.4, 0.1], position: [x, y + 4.2, z] }, PIPE);
    kit.add(m.galvanised, { size: [2.6, 0.12, 0.12], position: [x + dir * 1.25, y + 8.3, z], rotation: [0, 0, dir * 0.18] });
    kit.add(m.galvanised, { size: [0.7, 0.18, 0.34], position: [x + dir * 2.55, y + 8.0, z] });
    kit.add(m.lanternGlass, { size: [0.55, 0.05, 0.26], position: [x + dir * 2.55, y + 7.9, z] });
    colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15 });
  }
  // Billboards on every tower facing the square: stacked screens, corner wraps, blade signs and tickers.
  const ads = Object.entries(ADS).map(([name, [w, h, draw]]) => ({ name, portrait: h > w, material: screen(canvasTexture(w, h, draw)) }));
  const blades = BLADES.map(([text, color]) => screen(bladeTexture(text, color)));
  let next = 0;
  const pickAd = portrait => { for (let k = 0; k < ads.length; k++) { const a = ads[(next + k) % ads.length]; if (a.portrait === portrait) { next = (next + k + 1) % ads.length; return a.material; } } return ads[0].material; };
  const towers = surface.towers.filter(t => t.square && t.x0 > SQUARE_SITE.minX - 60 && t.x1 < SQUARE_SITE.maxX + 60);
  for (const t of towers) {
    const west = t.square === 'west', fx = west ? t.x1 : t.x0, out = west ? 1 : -1, width = t.z1 - t.z0, top = Math.min(t.height - 4, 58);
    if (Math.abs(fx - (west ? SQUARE_SITE.minX - 0.5 : SQUARE_SITE.maxX + 0.5)) > 2.5) continue;
    const panel = (pw, ph, cz, cy, mat, depth = 0.25) => {
      box(group, frame, [0.35, ph + 0.4, pw + 0.4], [fx + out * 0.2, cy, cz]);
      const s = box(group, mat, [0.06, ph, pw], [fx + out * (0.4 + depth), cy, cz], { shadow: false });
      s.rotation.y = 0; s.castShadow = false;
    };
    // Ticker band just above the shopfronts.
    const tk = tickerTexture(random() < 0.5 ? '  AUREALIS-BAHN · U4 TO CENTRAL EVERY 4 MIN · AURA FEST TONIGHT · CANAL STAGE ·' : '  BREAKING: NEW DOWNTOWN OPENS · LUMA COLA · STARLIGHT NOW PLAYING · WELCOME TO AUREALIS SQUARE ·', random() < 0.5 ? '#ffb33a' : '#4af0ff');
    tk.repeat.x = width / 18; tickers.push(tk);
    panel(width - 0.6, 1.0, (t.z0 + t.z1) / 2, y + 5.9, screen(tk), 0.1);
    for (let cy = 7.2; cy < top - 4;) {
      const ph = 5 + random() * 6; if (cy + ph > top) break;
      if (width > 18 && random() < 0.5) {
        const a = (width - 2) / 2;
        panel(a - 0.6, ph, t.z0 + 1 + a / 2, y + cy + ph / 2, pickAd(false));
        panel(a - 0.6, ph, t.z1 - 1 - a / 2, y + cy + ph / 2, pickAd(random() < 0.4));
      } else {
        const pw = Math.min(width - 2, ph * (random() < 0.3 ? 0.55 : 1.6));
        panel(pw, ph, t.z0 + 1 + pw / 2 + random() * (width - 2 - pw), y + cy + ph / 2, pickAd(pw < ph));
      }
      cy += ph + 0.8 + random() * 1.5;
    }
    // Corner-wrapping screen and a vertical blade sign at one corner.
    const cz = random() < 0.5 ? t.z0 : t.z1, inz = cz === t.z0 ? 1 : -1, ch = 8 + random() * 8, cy = y + 9 + random() * 10;
    box(group, frame, [6.4, ch + 0.4, 0.35], [fx - out * 3, cy, cz - inz * 0.2]);
    box(group, pickAd(false), [6, ch, 0.06], [fx - out * 3, cy, cz - inz * 0.42], { shadow: false });
    const blade = blades[Math.floor(random() * blades.length)];
    box(group, frame, [1.6, 11.4, 0.5], [fx + out * 1.0, y + 14, cz + inz * 1.5]);
    box(group, blade, [1.4, 11, 0.56], [fx + out * 1.0, y + 14, cz + inz * 1.5], { shadow: false });
    // Red storefront canopy and, now and then, a CAFE sign.
    uvMesh(group, red, [1.6, 0.12, Math.min(8, width - 2)], [fx + out * 0.8, y + 3.4, (t.z0 + t.z1) / 2], { tile: 2 });
    if (random() < 0.45) label(group, 'CAFE', 2.4, 0.7, [fx + out * 0.45, y + 4.3, (t.z0 + t.z1) / 2], { background: '#c7262b', color: '#ffffff', fontSize: 300, rotation: [0, out * Math.PI / 2, 0] });
  }
  addSquareLandmarks(group, kit, surface, d, frame, screen, pickAd, colliders);
  kit.flush(group);
  surface.tickers = tickers;
  return group;
}

/** Clock tower (east), red-spired dark tower (west) and the screen tower closing the south end. */
function addSquareLandmarks(group, kit, surface, d, frame, screenMaterial, pickAd, colliders) {
  const y = STREET_Y, I = SQUARE_ISLAND;
  // Brick clock tower: brick shaft, stone bands, a lit clock on two faces, gold crown.
  { const [x, z] = I.clockTower, w = 16, h = 96;
    facadeBox(group, d.shop, [w, 5, w], [x, y + 2.5, z]);
    facadeBox(group, d.brick, [w - 1, h - 5, w - 1], [x, y + (h + 5) / 2, z]);
    for (const hh of [30, 60, h]) uvMesh(group, d.brickTrim, [w + 0.4, 0.8, w + 0.4], [x, y + hh, z], { tile: 3 });
    facadeBox(group, d.brick, [w - 5, 14, w - 5], [x, y + h + 7, z]);
    const face = new THREE.MeshBasicMaterial({ map: clockTexture(), toneMapped: false });
    for (const [px, pz, ry] of [[x - (w - 5) / 2 - 0.05, z, -Math.PI / 2], [x, z + (w - 5) / 2 + 0.05, 0]]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.5), face); plane.position.set(px, y + h + 7, pz); plane.rotation.y = ry; group.add(plane);
    }
    const gold = new THREE.MeshStandardMaterial({ color: '#d9a733', emissive: '#7a5a12', emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.8 });
    const crown = new THREE.Mesh(new THREE.ConeGeometry(6, 12, 4), gold); crown.rotation.y = Math.PI / 4; crown.position.set(x, y + h + 20, z); crown.castShadow = true; group.add(crown);
    box(group, gold, [0.4, 6, 0.4], [x, y + h + 29, z]);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - w / 2, maxZ: z + w / 2 });
  }
  // Dark glass tower with a red-lit spire and mast.
  { const [x, z] = I.spireTower, w = 22, h = 150;
    facadeBox(group, d.shop, [w, 5, w], [x, y + 2.5, z]);
    facadeBox(group, d.glassDark, [w - 1, h - 5, w - 1], [x, y + (h + 5) / 2, z]);
    facadeBox(group, d.glassDark, [w - 7, 18, w - 7], [x, y + h + 9, z]);
    const redLit = new THREE.MeshStandardMaterial({ color: '#e0202c', emissive: '#e0202c', emissiveIntensity: 1.2 });
    const spire = new THREE.Mesh(new THREE.ConeGeometry(5, 26, 4), d.glassDark); spire.rotation.y = Math.PI / 4; spire.position.set(x, y + h + 31, z); spire.castShadow = true; group.add(spire);
    box(group, d.antenna, [0.6, 30, 0.6], [x, y + h + 59, z]);
    for (const hh of [h + 18.4, h + 46, h + 72]) box(group, redLit, [1.6, 1.2, 1.6], [x, y + hh, z], { shadow: false });
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - w / 2, maxZ: z + w / 2 });
  }
  // Screen tower: a narrow dark tower on the axis, its north face stacked with screens.
  { const [x, z] = LANDMARKS.screenTower, w = 14, dd = 10, h = 74;
    facadeBox(group, d.shop, [w, 5, dd], [x, y + 2.5, z]);
    facadeBox(group, d.glassDark, [w - 1, h - 5, dd - 1], [x, y + (h + 5) / 2, z]);
    const face = z + dd / 2;
    for (let k = 0, cy = 7; k < 8; k++) {
      const ph = 6.2 + (k % 3) * 0.6;
      box(group, frame, [w + 0.6, ph + 0.4, 0.4], [x, y + cy + ph / 2, face + 0.2]);
      box(group, pickAd(false), [w, ph, 0.06], [x, y + cy + ph / 2, face + 0.45], { shadow: false });
      cy += ph + 0.8;
    }
    box(group, d.antenna, [0.5, 14, 0.5], [x, y + h + 7, z]);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - dd / 2, maxZ: z + dd / 2 });
  }
}
