import * as THREE from 'three';
import { canvasTexture, seededRandom } from './geometry.js';

/**
 * Code-drawn facades for the downtown towers. Each texture is one repeat of a
 * facade module (a few bays wide, a few floors tall) with its size in metres,
 * so towers of any size get correctly scaled windows that line up by floor.
 * Only plain canvas drawing calls are used (no ImageData or gradients). Each facade
 * also carries a window-glass mask used for lit windows at night.
 */
const repeat = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
const rect = (ctx, color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

/**
 * Draw a facade module and, alongside it, a white-on-black mask of its window glass
 * (the emissive map for night lighting). `mark(x, y, w, h)` records a pane for the mask.
 */
function facade(w, h, userData, draw) {
  const panes = [];
  const texture = repeat(canvasTexture(w, h, ctx => draw(ctx, (x, y, pw, ph) => panes.push([x, y, pw, ph]))));
  const mask = repeat(canvasTexture(w, h, ctx => { rect(ctx, '#000', 0, 0, w, h); for (const p of panes) rect(ctx, '#fff', ...p); }));
  texture.userData = { ...userData, mask };
  return texture;
}

/** A vertical tone ramp from stacked bands (plain fills only): lighter sky reflection at the top. */
function pane(ctx, color, x, y, w, h, lift = 0.16) {
  rect(ctx, color, x, y, w, h);
  for (let k = 0; k < 4; k++) rect(ctx, `rgba(200,222,255,${(lift * (4 - k) / 4).toFixed(3)})`, x, y + h * k * 0.12, w, h * 0.12);
}

/**
 * Glass curtain wall: large flat panes between thin mullions, one band per floor. The default has
 * a dark navy floor band; `light` gives the white-grey sill band variant from the reference.
 */
export function curtainWall({ glass = ['#2c58a6', '#3263b3', '#2a51a0', '#3a6dbd'], mullion = '#1a2f58', spandrel = '#22395f', edge = '#4a6a9a', light = false, seed = 1 } = {}) {
  const bays = 4, floors = 4, w = 512, h = 512, bw = w / bays, fh = h / floors, band = light ? 22 : 30;
  return facade(w, h, { tileU: bays * 1.5, tileV: floors * 3.6, bays, floors }, (ctx, mark) => {
    const random = seededRandom(seed);
    rect(ctx, mullion, 0, 0, w, h);
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw + 3, y = f * fh + 3, pw = bw - 6, ph = fh - band - 6;
      pane(ctx, glass[Math.floor(random() * glass.length)], x, y, pw, ph, light ? 0.12 : 0.16); mark(x, y, pw, ph);
      if (random() < 0.15) rect(ctx, 'rgba(10,20,45,.22)', x, y, pw, ph);
      rect(ctx, 'rgba(255,255,255,.06)', x + pw * 0.08, y + 2, pw * 0.07, ph - 4);
    }
    for (let f = 0; f < floors; f++) {
      const y = f * fh + fh - band;
      rect(ctx, spandrel, 0, y, w, band);
      rect(ctx, edge, 0, y, w, 3);
      if (light) rect(ctx, 'rgba(60,80,110,.35)', 0, y + band - 4, w, 4);
    }
  });
}

/**
 * Red-brown brick with projecting lighter piers (lit on one side, shadowed on the other)
 * and pairs of tall narrow blue windows between them (3 bays × 3 floors).
 */
export function brickFacade({ brick = '#80503e', pier = '#a8786a', pierLight = '#c09080', pierShadow = '#55301f', glazing = '#2d4672', frame = '#3a2a24', panel = '#6e4232', seed = 7 } = {}) {
  const bays = 3, floors = 3, w = 384, h = 384, bw = w / bays, fh = h / floors;
  return facade(w, h, { tileU: bays * 2.8, tileV: floors * 3.6, bays: bays * 2, floors }, (ctx, mark) => {
    const random = seededRandom(seed);
    rect(ctx, brick, 0, 0, w, h);
    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? -4 : 0; x < w; x += 8) {
      ctx.fillStyle = `rgba(${random() < 0.5 ? '40,15,8' : '255,210,185'},${(random() * 0.08).toFixed(3)})`; ctx.fillRect(x + 1, y + 1, 7, 3);
    }
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x0 = b * bw + 22, y = f * fh + 12, ww = bw - 44, wh = fh - 38;
      // Recessed spandrel panel under each window pair.
      rect(ctx, panel, x0, y + wh + 6, ww, fh - wh - 26); rect(ctx, 'rgba(0,0,0,.25)', x0, y + wh + 6, ww, 3);
      rect(ctx, frame, x0, y, ww, wh);
      for (const k of [0, 1]) {
        const px = x0 + 3 + k * (ww / 2), pw = ww / 2 - 6;
        pane(ctx, glazing, px, y + 4, pw, wh - 8, 0.22); mark(px, y + 4, pw, wh - 8);
        rect(ctx, 'rgba(160,195,240,.18)', px + 3, y + 6, pw * 0.3, wh - 14);
      }
      rect(ctx, 'rgba(0,0,0,.3)', x0, y, ww, 4);
      rect(ctx, '#b48a72', x0 - 2, y + wh, ww + 4, 5);
    }
    // Piers: full height, light face with a shadow to one side for relief.
    for (let b = 0; b <= bays; b++) {
      const x = b * bw - 16;
      rect(ctx, pier, x, 0, 32, h); rect(ctx, pierLight, x, 0, 7, h); rect(ctx, pierShadow, x + 32, 0, 7, h);
    }
  });
}

/** Smooth taupe-brown wall with a tight grid of square four-pane windows in beige surrounds (4 bays × 4 floors). */
export function gridFacade({ wall = '#7d6252', surround = '#a68a74', glass = '#3e3836', cross = '#6f5a4c', seed = 9 } = {}) {
  const bays = 4, floors = 4, w = 512, h = 512, bw = w / bays, fh = h / floors;
  return facade(w, h, { tileU: bays * 2.3, tileV: floors * 3.6, bays, floors }, (ctx, mark) => {
    const random = seededRandom(seed);
    rect(ctx, wall, 0, 0, w, h);
    for (let i = 0; i < 1600; i++) { ctx.fillStyle = `rgba(${random() < 0.5 ? '255,235,215' : '60,40,30'},.05)`; ctx.fillRect(random() * w, random() * h, 2, 2); }
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw + 24, y = f * fh + 20, ww = bw - 48, wh = Math.round(fh * 0.6);
      rect(ctx, surround, x - 7, y - 7, ww + 14, wh + 14);
      rect(ctx, 'rgba(0,0,0,.28)', x, y, ww, 5);
      pane(ctx, glass, x, y, ww, wh, 0.1);
      // Four lit panes per window at night, with the cross left dark.
      for (const [px, py] of [[x, y], [x + ww / 2 + 3, y], [x, y + wh / 2 + 3], [x + ww / 2 + 3, y + wh / 2 + 3]]) mark(px, py, ww / 2 - 3, wh / 2 - 3);
      rect(ctx, 'rgba(150,165,190,.14)', x + 4, y + 6, ww * 0.35, wh * 0.45);
      rect(ctx, cross, x + ww / 2 - 3, y, 6, wh); rect(ctx, cross, x, y + wh / 2 - 3, ww, 6);
      rect(ctx, '#c0a48c', x - 9, y + wh + 5, ww + 18, 5);
    }
  });
}

/**
 * Sand stone with wide ochre piers and horizontal ribbon windows: grey glass split by cream
 * mullions, a pale sill under each ribbon (2 bays of 4 panes × 4 floors).
 */
export function stoneFacade({ wall = '#cba56c', pier = '#c49650', pierLight = '#dcb877', pierShadow = '#9c743c', glass = '#4a5664', mullion = '#e3d2ad', sill = '#e6d3a8', seed = 11 } = {}) {
  const slots = 8, floors = 4, w = 512, h = 512, sw = w / slots, fh = h / floors;
  return facade(w, h, { tileU: 12, tileV: floors * 3.6, bays: slots, floors }, (ctx, mark) => {
    const random = seededRandom(seed);
    rect(ctx, wall, 0, 0, w, h);
    for (let i = 0; i < 2000; i++) { ctx.fillStyle = `rgba(${random() < 0.5 ? '255,245,220' : '110,80,40'},.06)`; ctx.fillRect(random() * w, random() * h, 2, 2); }
    for (let f = 0; f < floors; f++) {
      const y = f * fh + 16, wh = fh - 46;
      rect(ctx, mullion, 0, y - 3, w, wh + 6);
      for (let s = 0; s < slots; s++) { const x = s * sw + 3, pw = sw - 6; pane(ctx, glass, x, y, pw, wh, 0.14); mark(x, y, pw, wh); }
      rect(ctx, 'rgba(0,0,0,.22)', 0, y - 3, w, 4);
      rect(ctx, sill, 0, y + wh + 3, w, 6);
    }
    // Wide piers every four panes, centred on the slot boundaries so each pane stays whole.
    for (let k = 0; k <= slots; k += 4) {
      const x = k * sw - 20;
      rect(ctx, pier, x, 0, 40, h); rect(ctx, pierLight, x, 0, 6, h); rect(ctx, pierShadow, x + 40, 0, 6, h);
    }
  });
}

/** Ground-floor shopfronts: glazing in slim frames, a fascia band, a door every few bays (8 m × 5 m). */
export function shopfrontTexture({ frame = '#3a3f46', fascia = '#4a4f57', seed = 3 } = {}) {
  return facade(512, 320, { tileU: 8, tileV: 5, bays: 4, floors: 1 }, (ctx, mark) => {
    const w = 512, h = 320, random = seededRandom(seed);
    rect(ctx, frame, 0, 0, w, h);
    rect(ctx, fascia, 0, 0, w, 62);
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 10, door = i === 1;
      rect(ctx, door ? '#4a3324' : '#1b2a3c', x, 76, 108, h - 86);
      if (!door) {
        mark(x, 76, 108, h - 86);
        rect(ctx, 'rgba(255,214,150,.20)', x + 6, 82, 96, (h - 98) * 0.55); rect(ctx, 'rgba(170,205,245,.16)', x + 8, 84, 20, h - 100);
      } else { rect(ctx, '#6a4a34', x + 10, 86, 40, h - 108); rect(ctx, '#6a4a34', x + 58, 86, 40, h - 108); }
      if (random() < 0.5) rect(ctx, 'rgba(255,255,255,.35)', x + 20, 24, 80, 14);
    }
  });
}

/** Red-and-white banded mast. */
export function mastTexture() {
  return repeat(canvasTexture(16, 128, (ctx, w, h) => { for (let i = 0; i < 8; i++) rect(ctx, i % 2 ? '#f4f1ea' : '#d0202c', 0, i * h / 8, w, h / 8 + 1); }));
}

/** Clock face (Roman-free, simple marks) for the clock tower. */
export function clockTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2b1d12'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f8edc8'; ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = '#c99a2e'; ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#2b1d12';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.fillRect(128 + Math.sin(a) * 92 - 4, 128 - Math.cos(a) * 92 - 8, 8, 16); }
    ctx.lineWidth = 9; ctx.strokeStyle = '#2b1d12'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 + 52, 128 - 30); ctx.stroke();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 - 12, 128 - 84); ctx.stroke();
  });
}
