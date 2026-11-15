import * as THREE from 'three';
import { canvasTexture, seededRandom } from './geometry.js';

/**
 * Code-drawn facades for the downtown towers. Each texture is one repeat of a
 * facade module (a few bays wide, a few floors tall) with its size in metres,
 * so towers of any size get correctly scaled windows that line up by floor.
 * Only plain canvas drawing calls are used (no ImageData or gradients).
 */
const repeat = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
const rect = (ctx, color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

/** Royal-blue (or teal/grey/dark) glass curtain wall: mullions, a spandrel band per floor, sky reflections. */
export function curtainWall({ glass = ['#1d4fb8', '#2a63cc', '#173f97', '#3473d6'], mullion = '#0d2459', spandrel = '#14357d', seed = 1 } = {}) {
  const bays = 4, floors = 4, w = 512, h = 512, bw = w / bays, fh = h / floors;
  const texture = repeat(canvasTexture(w, h, (ctx) => {
    const random = seededRandom(seed);
    rect(ctx, mullion, 0, 0, w, h);
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh, tone = glass[Math.floor(random() * glass.length)];
      // Two panes per bay above a spandrel strip.
      for (const [px, pw] of [[x + 5, bw / 2 - 7], [x + bw / 2 + 2, bw / 2 - 7]]) {
        rect(ctx, tone, px, y + 5, pw, fh - 34);
        rect(ctx, 'rgba(255,255,255,.10)', px, y + 5, pw, (fh - 34) * 0.35);
        rect(ctx, 'rgba(160,210,255,.16)', px + pw * 0.15, y + 8, pw * 0.12, fh - 42);
        if (random() < 0.12) rect(ctx, 'rgba(8,20,48,.35)', px, y + 5, pw, fh - 34);
      }
      rect(ctx, spandrel, x, y + fh - 29, bw, 24);
      rect(ctx, 'rgba(255,255,255,.08)', x, y + fh - 29, bw, 3);
    }
    // A broad, soft diagonal reflection band across the module.
    ctx.fillStyle = 'rgba(190,225,255,.10)';
    ctx.beginPath(); ctx.moveTo(0, h * 0.7); ctx.lineTo(w * 0.55, 0); ctx.lineTo(w * 0.8, 0); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  }));
  texture.userData = { tileU: bays * 1.6, tileV: floors * 3.6 };
  return texture;
}

/** Brown brick with darker piers, stone sills/lintels and deep-set dark windows (3 bays × 3 floors). */
export function brickFacade({ brick = '#8b5536', pier = '#64381f', stone = '#d9c7a2', seed = 7 } = {}) {
  const bays = 3, floors = 3, w = 384, h = 384, bw = w / bays, fh = h / floors;
  const texture = repeat(canvasTexture(w, h, (ctx) => {
    const random = seededRandom(seed);
    rect(ctx, brick, 0, 0, w, h);
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? -6 : 0; x < w; x += 12) {
      const v = random() * 0.16; ctx.fillStyle = `rgba(${random() < 0.5 ? '40,18,8' : '255,220,190'},${v})`; ctx.fillRect(x + 1, y + 1, 10, 4);
    }
    for (let b = 0; b <= bays; b++) rect(ctx, pier, b * bw - 9, 0, 18, h);
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw + 22, y = f * fh + 22, ww = bw - 44, wh = fh - 48;
      rect(ctx, stone, x - 5, y - 8, ww + 10, 8);
      rect(ctx, '#1b2232', x, y, ww, wh);
      rect(ctx, 'rgba(120,160,210,.22)', x + 3, y + 3, ww * 0.4, wh - 6);
      rect(ctx, '#3a2d26', x + ww / 2 - 2, y, 4, wh); rect(ctx, '#3a2d26', x, y + wh * 0.45, ww, 4);
      rect(ctx, stone, x - 6, y + wh, ww + 12, 9);
    }
    rect(ctx, stone, 0, h - 10, w, 6);
  }));
  texture.userData = { tileU: bays * 2.6, tileV: floors * 3.6 };
  return texture;
}

/** Tan / sand stone with gold piers and a grid of blue-glass windows (4 bays × 4 floors). */
export function stoneFacade({ wall = '#d6b277', pier = '#b8893e', glass = '#2a4f8f', band = '#e6cf9f', seed = 11 } = {}) {
  const bays = 4, floors = 4, w = 512, h = 512, bw = w / bays, fh = h / floors;
  const texture = repeat(canvasTexture(w, h, (ctx) => {
    const random = seededRandom(seed);
    rect(ctx, wall, 0, 0, w, h);
    for (let i = 0; i < 2200; i++) { ctx.fillStyle = `rgba(${random() < 0.5 ? '255,245,220' : '120,90,40'},.08)`; ctx.fillRect(random() * w, random() * h, 2, 2); }
    for (let b = 0; b <= bays; b += 2) rect(ctx, pier, b * bw - 8, 0, 16, h);
    for (let f = 0; f < floors; f++) {
      rect(ctx, band, 0, f * fh + fh - 10, w, 8);
      for (let b = 0; b < bays; b++) {
        const x = b * bw + 18, y = f * fh + 18, ww = bw - 36, wh = fh - 46;
        rect(ctx, glass, x, y, ww, wh);
        rect(ctx, 'rgba(170,210,255,.22)', x + 3, y + 3, ww * 0.35, wh - 6);
        rect(ctx, '#f1e3c0', x + ww / 2 - 2, y, 4, wh); rect(ctx, '#f1e3c0', x, y + wh * 0.5, ww, 3);
      }
    }
  }));
  texture.userData = { tileU: bays * 1.9, tileV: floors * 3.6 };
  return texture;
}

/** Ground-floor shopfronts: dark glazing in frames, a fascia band, a door every few bays (8 m × 5 m). */
export function shopfrontTexture({ frame = '#2a2f36', fascia = '#3b4048', seed = 3 } = {}) {
  const texture = repeat(canvasTexture(512, 320, (ctx, w, h) => {
    const random = seededRandom(seed);
    rect(ctx, frame, 0, 0, w, h);
    rect(ctx, fascia, 0, 0, w, 62);
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 10, door = i === 1;
      rect(ctx, door ? '#3c2a1e' : '#122033', x, 76, 108, h - 86);
      if (!door) { rect(ctx, 'rgba(255,214,150,.18)', x + 6, 82, 96, (h - 98) * 0.55); rect(ctx, 'rgba(160,200,255,.18)', x + 8, 84, 20, h - 100); }
      else { rect(ctx, '#5a4030', x + 10, 86, 40, h - 108); rect(ctx, '#5a4030', x + 58, 86, 40, h - 108); }
      if (random() < 0.5) rect(ctx, 'rgba(255,255,255,.35)', x + 20, 24, 80, 14);
    }
  }));
  texture.userData = { tileU: 8, tileV: 5 };
  return texture;
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
