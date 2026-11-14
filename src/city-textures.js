import * as THREE from 'three';
import { canvasTexture, seededRandom } from './geometry.js';

/**
 * Procedural, code-drawn surface textures for the Central old town.
 * Only plain 2D-canvas drawing calls are used (no ImageData or gradients), so
 * the headless geometry probes can stub the canvas without special cases.
 */

const repeat = (texture, x = 1, y = 1) => {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(x, y);
  return texture;
};
const linear = texture => { texture.colorSpace = THREE.NoColorSpace; return texture; };
const poly = (ctx, points) => {
  ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
};

/** Rough trowelled plaster: fine grain, larger soft blotches, faint vertical weathering. */
export function plasterTexture(seed = 3) {
  return repeat(canvasTexture(512, 512, (ctx, w, h) => {
    const random = seededRandom(seed);
    ctx.fillStyle = '#efefef'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const v = random() < 0.5 ? 255 : 160, r = 30 + random() * 90;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.012 + random() * 0.018})`;
      ctx.beginPath(); ctx.arc(random() * w, random() * h, r, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 36000; i++) {
      const v = random() < 0.55 ? Math.round(150 + random() * 60) : 255, s = random() < 0.85 ? 1 : 2;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.10 + random() * 0.16})`;
      ctx.fillRect(Math.floor(random() * w), Math.floor(random() * h), s, s);
    }
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(120,115,105,${0.02 + random() * 0.03})`;
      ctx.fillRect(random() * w, random() * h * 0.6, 2 + random() * 6, 40 + random() * 160);
    }
  }));
}

/** Terracotta barrel (Roman) tiles; columns run down the slope (texture v). */
export function roofTileTexture(seed = 41) {
  return repeat(canvasTexture(256, 256, (ctx, w, h) => {
    const random = seededRandom(seed);
    ctx.fillStyle = '#5c2615'; ctx.fillRect(0, 0, w, h);
    const cols = 8, rows = 6, cw = w / cols, rh = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw, y = r * rh, tone = random();
      const base = [Math.round(176 + tone * 40), Math.round(78 + tone * 26), Math.round(44 + tone * 16)];
      // Channel tile (wide, darker) then the convex cap with a lit crown.
      ctx.fillStyle = `rgb(${base[0] - 34},${base[1] - 18},${base[2] - 10})`; ctx.fillRect(x, y, cw, rh);
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; ctx.fillRect(x + cw * 0.18, y, cw * 0.64, rh - 3);
      ctx.fillStyle = 'rgba(255,214,170,.28)'; ctx.fillRect(x + cw * 0.36, y + 2, cw * 0.18, rh - 7);
      ctx.fillStyle = 'rgba(40,12,4,.35)'; ctx.fillRect(x + cw * 0.18, y, 2, rh - 3); ctx.fillRect(x + cw * 0.8, y, 2, rh - 3);
      ctx.fillStyle = 'rgba(30,8,2,.55)'; ctx.fillRect(x, y + rh - 4, cw, 4);
      if (random() < 0.25) { ctx.fillStyle = `rgba(70,70,40,${0.08 + random() * 0.12})`; ctx.fillRect(x + cw * 0.2, y + rh * 0.4, cw * 0.6, rh * 0.5); }
    }
  }));
}

/** Tile ends along the eave: rounded barrel mouths over a dark gap. */
export function tileEdgeTexture() {
  return repeat(canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#4a1d0f'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const cx = i * 32 + 16;
      ctx.fillStyle = '#b5522c'; ctx.beginPath(); ctx.arc(cx, h, 15, Math.PI, 0); ctx.lineTo(cx + 15, 0); ctx.lineTo(cx - 15, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a0d05'; ctx.beginPath(); ctx.arc(cx, h, 8, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,160,.28)'; ctx.fillRect(cx - 9, 4, 5, h * 0.55);
    }
  }));
}

/** Irregular flagstones from a wrapped jittered lattice, grass in many joints. */
export function flagstoneTexture(seed = 182) {
  return repeat(canvasTexture(512, 512, (ctx, w, h) => {
    const random = seededRandom(seed), n = 7, cell = w / n, jitter = cell * 0.3;
    const offsets = Array.from({ length: n }, () => Array.from({ length: n }, () => [(random() - 0.5) * jitter, (random() - 0.5) * jitter]));
    const vertex = (i, j) => { const o = offsets[((i % n) + n) % n][((j % n) + n) % n]; return [i * cell + o[0], j * cell + o[1]]; };
    ctx.fillStyle = '#5f5d4c'; ctx.fillRect(0, 0, w, h);
    const stones = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1);
      const split = random();
      if (split < 0.28) { const m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m2 = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2]; stones.push([a, m1, m2, d], [m1, b, c, m2]); }
      else if (split < 0.5) { const m1 = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2], m2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; stones.push([a, b, m2, m1], [m1, m2, c, d]); }
      else stones.push([a, b, c, d]);
    }
    for (const stone of stones) {
      const tone = random(), v = Math.round(150 + tone * 52);
      const fill = `rgb(${v + 6},${v + 2},${v - 12})`, warm = random() < 0.3;
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        const pts = stone.map(([x, y]) => [x + dx, y + dy]);
        poly(ctx, pts); ctx.fillStyle = warm ? `rgb(${v + 14},${v + 6},${v - 18})` : fill; ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = '#575546'; ctx.stroke();
      }
    }
    // Speckle and per-stone shading for a worn, slightly polished surface.
    for (let i = 0; i < 9000; i++) {
      const v = random() < 0.5 ? 245 : 70;
      ctx.fillStyle = `rgba(${v},${v},${v - 10},${0.05 + random() * 0.08})`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
    // Grass and moss creeping along joints.
    for (const stone of stones) for (let k = 0; k < stone.length; k++) {
      if (random() > 0.2) continue;
      const [x0, y0] = stone[k], [x1, y1] = stone[(k + 1) % stone.length];
      for (let t = 0; t < 1; t += 0.06) {
        const x = x0 + (x1 - x0) * t + (random() - 0.5) * 4, y = y0 + (y1 - y0) * t + (random() - 0.5) * 4;
        ctx.fillStyle = `rgba(${70 + random() * 40},${110 + random() * 40},${40 + random() * 20},${0.55 + random() * 0.4})`;
        for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) ctx.fillRect(x + dx - 2, y + dy - 2, 3 + random() * 4, 3 + random() * 4);
      }
    }
  }));
}

/** Cream herringbone brick (2:1), dark mortar joints. Period is 4 bricks in each axis. */
export function herringboneTexture(seed = 77) {
  const texture = repeat(canvasTexture(512, 512, (ctx, w, h) => {
    const random = seededRandom(seed), u = 32;
    ctx.fillStyle = '#4b4339'; ctx.fillRect(0, 0, w, h);
    const brick = (x, y, bw, bh) => {
      const v = Math.round(214 + random() * 26);
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        ctx.fillStyle = `rgb(${v},${v - 8},${v - 30})`; ctx.fillRect(x + dx + 2, y + dy + 2, bw - 4, bh - 4);
        ctx.fillStyle = 'rgba(255,250,235,.35)'; ctx.fillRect(x + dx + 3, y + dy + 3, bw - 6, 2);
        ctx.fillStyle = 'rgba(90,80,60,.16)'; ctx.fillRect(x + dx + 3, y + dy + bh - 6, bw - 6, 2);
      }
    };
    for (let a = -20; a < 20; a++) for (let b = -20; b < 20; b++) {
      const hx = (2 * b - a) * u, hy = (2 * b + a) * u;
      if (hx > -2 * u && hx < w + u && hy > -2 * u && hy < h + u) brick(hx, hy, 2 * u, u);
      const vx = hx + u, vy = hy + u;
      if (vx > -2 * u && vx < w + u && vy > -2 * u && vy < h + u) brick(vx, vy, u, 2 * u);
    }
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(80,70,50,${0.05 + random() * 0.08})`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
  }));
  texture.center.set(0.5, 0.5); texture.rotation = Math.PI / 4;
  return texture;
}

/** One louvred shutter leaf, near-white so a material colour tints it. */
export function louvreTexture() {
  return canvasTexture(64, 160, (ctx, w, h) => {
    ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6); ctx.fillRect(0, 0, 6, h); ctx.fillRect(w - 6, 0, 6, h);
    ctx.fillRect(0, h / 2 - 3, w, 6);
    for (let y = 9; y < h - 8; y += 6) {
      if (Math.abs(y - h / 2) < 5) continue;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(6, y, w - 12, 2);
      ctx.fillStyle = '#7d7d7d'; ctx.fillRect(6, y + 3, w - 12, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(w - 3, 0, 3, h);
  });
}

/** Deep navy glazing with a white mullion cross; optional iron bars. */
export function windowTexture(barred = false, french = false) {
  return canvasTexture(128, french ? 256 : 192, (ctx, w, h) => {
    ctx.fillStyle = '#0d1e4a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,160,230,.16)'; poly(ctx, [[0, h * 0.55], [w * 0.7, 0], [w, 0], [0, h * 0.85]]); ctx.fill();
    ctx.fillStyle = 'rgba(160,200,255,.10)'; poly(ctx, [[0, h], [w, h * 0.35], [w, h * 0.5], [w * 0.2, h]]); ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(0, 0, w, 8); ctx.fillRect(0, h - 8, w, 8); ctx.fillRect(0, 0, 8, h); ctx.fillRect(w - 8, 0, 8, h);
    ctx.fillRect(w / 2 - 4, 0, 8, h);
    const bars = french ? [0.28, 0.56, 0.8] : [0.38];
    for (const t of bars) ctx.fillRect(0, h * t - 3, w, 6);
    if (barred) {
      ctx.fillStyle = '#16181c';
      for (let x = 14; x < w - 6; x += 14) ctx.fillRect(x, 0, 4, h);
      ctx.fillRect(0, h * 0.2, w, 4); ctx.fillRect(0, h * 0.8, w, 4);
      for (let x = 14; x < w - 6; x += 28) { ctx.beginPath(); ctx.arc(x + 9, h * 0.2, 6, 0, Math.PI); ctx.lineWidth = 3; ctx.strokeStyle = '#16181c'; ctx.stroke(); }
    }
  });
}

/** Panelled timber door, light so a material colour sets the paint. */
export function doorTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    const random = seededRandom(9);
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(90,90,90,${0.04 + random() * 0.06})`; ctx.fillRect(random() * w, 0, 1, h); }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(w / 2 - 1, 0, 2, h);
    for (const x of [12, w / 2 + 10]) for (const [y, ph] of [[16, 70], [100, 70], [184, 58]]) {
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, y, w / 2 - 22, ph);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x + 4, y + 4, w / 2 - 30, ph - 8);
    }
    ctx.fillStyle = '#b08a3a'; ctx.fillRect(w / 2 + 6, h * 0.52, 5, 12);
  });
}

/** Wrought-iron railing with balusters and small scrolls (alpha-tested). */
export function railingTexture() {
  return repeat(canvasTexture(256, 128, (ctx, w, h) => {
    ctx.clearRect?.(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 8); ctx.fillRect(0, 22, w, 4);
    for (let x = 4; x < w; x += 16) ctx.fillRect(x, 0, 4, h);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
    for (let x = 12; x < w; x += 32) { ctx.beginPath(); ctx.arc(x, 16, 6, 0, Math.PI * 2); ctx.stroke(); }
  }));
}

/** Leafy clumps dotted with blossoms, for window boxes and pots. */
export function flowerTexture(colors, seed = 5) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const random = seededRandom(seed);
    ctx.fillStyle = '#2f5d24'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { ctx.fillStyle = random() < 0.5 ? '#3f7a2c' : '#22481a'; ctx.fillRect(random() * w, random() * h, 3 + random() * 5, 2 + random() * 4); }
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = colors[Math.floor(random() * colors.length)];
      const x = random() * w, y = random() * h * 0.92, r = 2 + random() * 3.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}

/** Ragged grass verge (alpha-tested) at house bases. */
export function grassEdgeTexture(seed = 12) {
  return repeat(canvasTexture(256, 64, (ctx, w, h) => {
    const random = seededRandom(seed);
    ctx.clearRect?.(0, 0, w, h);
    for (let x = 0; x < w; x += 2) {
      const top = h * (0.08 + random() * 0.55 + 0.25 * Math.sin(x * 0.05) ** 2);
      ctx.fillStyle = `rgb(${70 + random() * 35},${118 + random() * 40},${42 + random() * 20})`;
      ctx.fillRect(x, top, 2 + random() * 2, h - top);
    }
    for (let i = 0; i < 200; i++) { ctx.fillStyle = 'rgba(40,70,20,.5)'; ctx.fillRect(random() * w, h * 0.5 + random() * h * 0.5, 2, 3); }
  }), 1, 1);
}

/** Radial stripes for café parasols (u wraps around a cone). */
export function stripeTexture(a = '#1f56a8', b = '#f3efe4', count = 8) {
  return canvasTexture(256, 8, (ctx, w, h) => {
    for (let i = 0; i < count * 2; i++) { ctx.fillStyle = i % 2 ? b : a; ctx.fillRect(i * w / (count * 2), 0, w / (count * 2) + 1, h); }
  });
}

/** Straight awning stripes. */
export function awningTexture(a = '#2d7a43', b = '#f1ede2') {
  return canvasTexture(128, 32, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? b : a; ctx.fillRect(i * w / 8, 0, w / 8 + 1, h); }
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, h - 5, w, 5);
  });
}

/** Ringed palm trunk bark. */
export function palmBarkTexture() {
  return repeat(canvasTexture(64, 256, (ctx, w, h) => {
    const random = seededRandom(31);
    ctx.fillStyle = '#9c8466'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      ctx.fillStyle = 'rgba(70,52,34,.55)'; ctx.fillRect(0, y, w, 4);
      ctx.fillStyle = 'rgba(230,210,180,.25)'; ctx.fillRect(0, y + 5, w, 3);
      for (let x = 0; x < w; x += 8) { ctx.fillStyle = `rgba(60,45,30,${random() * 0.25})`; ctx.fillRect(x, y + 6, 8, 9); }
    }
  }), 1, 3);
}

export const bump = texture => linear(texture.clone());
