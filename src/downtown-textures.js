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
 * (the emissive map for night lighting). `glass(x, y, w, h)` records a pane for the mask.
 */
function facade(w, h, userData, draw) {
  const panes = [];
  const texture = repeat(canvasTexture(w, h, ctx => draw(ctx, (x, y, pw, ph) => panes.push([x, y, pw, ph]))));
  const mask = repeat(canvasTexture(w, h, ctx => { rect(ctx, '#000', 0, 0, w, h); for (const p of panes) rect(ctx, '#fff', ...p); }));
  texture.userData = { ...userData, mask };
  return texture;
}

/** Cobalt glass curtain wall: dark mullions, a lighter steel-blue band per floor, sky-lit upper panes. */
export function curtainWall({ glass = ['#244a8c', '#2b5598', '#1f4280', '#3563a6'], mullion = '#152a50', spandrel = '#4a6a9e', seed = 1 } = {}) {
  const bays = 4, floors = 4, w = 512, h = 512, bw = w / bays, fh = h / floors;
  return facade(w, h, { tileU: bays * 1.6, tileV: floors * 3.6, bays, floors }, (ctx, pane) => {
    const random = seededRandom(seed);
    rect(ctx, mullion, 0, 0, w, h);
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh, tone = glass[Math.floor(random() * glass.length)];
      // Two panes per bay above a spandrel band.
      for (const [px, pw] of [[x + 5, bw / 2 - 7], [x + bw / 2 + 2, bw / 2 - 7]]) {
        const ph = fh - 34;
        rect(ctx, tone, px, y + 5, pw, ph); pane(px, y + 5, pw, ph);
        // Sky reflection fading down each pane, and a thin vertical glint.
        rect(ctx, 'rgba(190,215,250,.16)', px, y + 5, pw, ph * 0.22);
        rect(ctx, 'rgba(190,215,250,.08)', px, y + 5 + ph * 0.22, pw, ph * 0.22);
        rect(ctx, 'rgba(170,200,240,.10)', px + pw * 0.15, y + 8, pw * 0.1, ph - 8);
        if (random() < 0.12) rect(ctx, 'rgba(8,18,40,.3)', px, y + 5, pw, ph);
      }
      rect(ctx, spandrel, x, y + fh - 29, bw, 24);
      rect(ctx, 'rgba(255,255,255,.10)', x, y + fh - 29, bw, 3);
    }
  });
}

/** Brown brick with darker piers, muted stone sills and dark charcoal windows (3 bays × 3 floors). */
export function brickFacade({ brick = '#8e5b3f', pier = '#71442e', stone = '#c4a582', glazing = '#2c2a2e', seed = 7 } = {}) {
  const bays = 3, floors = 3, w = 384, h = 384, bw = w / bays, fh = h / floors;
  return facade(w, h, { tileU: bays * 2.6, tileV: floors * 3.6, bays, floors }, (ctx, pane) => {
    const random = seededRandom(seed);
    rect(ctx, brick, 0, 0, w, h);
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? -6 : 0; x < w; x += 12) {
      const v = random() * 0.12; ctx.fillStyle = `rgba(${random() < 0.5 ? '40,20,10' : '255,225,195'},${v})`; ctx.fillRect(x + 1, y + 1, 10, 4);
    }
    for (let b = 0; b <= bays; b++) rect(ctx, pier, b * bw - 10, 0, 20, h);
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw + 22, y = f * fh + 22, ww = bw - 44, wh = fh - 48;
      rect(ctx, stone, x - 5, y - 7, ww + 10, 7);
      rect(ctx, glazing, x, y, ww, wh); pane(x, y, ww, wh);
      rect(ctx, 'rgba(150,175,210,.16)', x + 3, y + 3, ww * 0.4, wh - 6);
      rect(ctx, '#4a3a30', x + ww / 2 - 2, y, 4, wh); rect(ctx, '#4a3a30', x, y + wh * 0.45, ww, 4);
      rect(ctx, stone, x - 6, y + wh, ww + 12, 8);
    }
    rect(ctx, stone, 0, h - 10, w, 5);
  });
}

/** Sand stone with ochre-gold piers and dark slate windows in cream frames (4 bays × 4 floors). */
export function stoneFacade({ wall = '#c9a46c', pier = '#b3843f', glass = '#353d4a', band = '#dcc08e', frame = '#e8d6ae', seed = 11 } = {}) {
  const bays = 4, floors = 4, w = 512, h = 512, bw = w / bays, fh = h / floors;
  return facade(w, h, { tileU: bays * 1.9, tileV: floors * 3.6, bays, floors }, (ctx, pane) => {
    const random = seededRandom(seed);
    rect(ctx, wall, 0, 0, w, h);
    for (let i = 0; i < 2200; i++) { ctx.fillStyle = `rgba(${random() < 0.5 ? '255,245,220' : '110,80,40'},.07)`; ctx.fillRect(random() * w, random() * h, 2, 2); }
    for (let b = 0; b <= bays; b += 2) rect(ctx, pier, b * bw - 9, 0, 18, h);
    for (let f = 0; f < floors; f++) {
      rect(ctx, band, 0, f * fh + fh - 10, w, 8);
      for (let b = 0; b < bays; b++) {
        const x = b * bw + 18, y = f * fh + 18, ww = bw - 36, wh = fh - 46;
        rect(ctx, glass, x, y, ww, wh); pane(x, y, ww, wh);
        rect(ctx, 'rgba(170,195,230,.16)', x + 3, y + 3, ww * 0.35, wh - 6);
        rect(ctx, frame, x + ww / 2 - 2, y, 4, wh); rect(ctx, frame, x, y + wh * 0.5, ww, 3);
      }
    }
  });
}

/** Ground-floor shopfronts: glazing in slim frames, a fascia band, a door every few bays (8 m × 5 m). */
export function shopfrontTexture({ frame = '#3a3f46', fascia = '#4a4f57', seed = 3 } = {}) {
  return facade(512, 320, { tileU: 8, tileV: 5, bays: 4, floors: 1 }, (ctx, pane) => {
    const w = 512, h = 320, random = seededRandom(seed);
    rect(ctx, frame, 0, 0, w, h);
    rect(ctx, fascia, 0, 0, w, 62);
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 10, door = i === 1;
      rect(ctx, door ? '#4a3324' : '#1b2a3c', x, 76, 108, h - 86);
      if (!door) {
        pane(x, 76, 108, h - 86);
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
