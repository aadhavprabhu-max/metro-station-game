import * as THREE from 'three';
import { Station } from './station.js';
import { box, cylinder, instances, canvasTexture, seededRandom } from './geometry.js';

const materialCache = new Map();
const stoneTexture = (kind, tint) => canvasTexture(512, 512, (ctx, w, h) => {
  const random = seededRandom(kind === 'marble' ? 617 : 239);
  ctx.fillStyle = tint; ctx.fillRect(0, 0, w, h);
  if (kind === 'marble') {
    for (let n = 0; n < 65; n++) {
      ctx.beginPath(); let y = random() * h;
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 8) { y += (random() - 0.49) * 13; ctx.lineTo(x, y + 10 * Math.sin(x / 57 + n)); }
      ctx.strokeStyle = `rgba(70,66,57,${0.025 + random() * 0.09})`; ctx.lineWidth = 0.4 + random() * 2; ctx.stroke();
    }
  } else {
    for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
      const x = col * 128 + (row % 2) * 64, y = row * 64;
      ctx.fillStyle = `rgba(${random() > 0.5 ? '255,245,222' : '54,47,37'},${0.02 + random() * 0.12})`;
      ctx.fillRect(x + 1.5, y + 1.5, 125, 61);
      ctx.strokeStyle = 'rgba(50,44,36,0.22)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, y + 1, 126, 62);
    }
  }
  for (let n = 0; n < 11000; n++) { ctx.fillStyle = `rgba(45,40,33,${random() * 0.07})`; ctx.fillRect(random() * w, random() * h, 1, 1); }
});

export function architecturalMaterials(theme = 'ivory') {
  if (materialCache.has(theme)) return materialCache.get(theme);
  const palettes = {
    ivory: ['#d4c6a7', '#eee6d4', '#3d4648', '#b39a65'],
    amber: ['#c3a67d', '#e2d0a6', '#625449', '#a77c43'],
    river: ['#c6c6b3', '#e2e4d9', '#3f7478', '#9b967a'],
    monumental: ['#b5ada0', '#ddd7c9', '#434c51', '#8e8066'],
    modern: ['#d2d4cf', '#e8e9e1', '#566c69', '#aba38d'],
    forest: ['#b9bdad', '#d8d8c7', '#4b6459', '#94866d'],
  };
  const p = palettes[theme] ?? palettes.ivory;
  const stone = stoneTexture('stone', p[0]), marble = stoneTexture('marble', p[1]);
  stone.wrapS = stone.wrapT = marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
  stone.repeat.set(2, 2);
  const mat = (color, roughness = 0.65, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const m = {
    stone: new THREE.MeshStandardMaterial({ map: stone, color: '#ffffff', roughness: 0.84, bumpMap: stone, bumpScale: 0.035 }),
    marble: new THREE.MeshStandardMaterial({ map: marble, roughness: 0.24, metalness: 0.06 }),
    pale: mat(p[1], 0.46), dark: mat(p[2], 0.33), trim: mat(p[3], 0.37, 0.45),
    soffit: mat(p[0], 0.82), grout: mat('#787970'), timber: mat('#8b7251', 0.76),
    glass: new THREE.MeshPhysicalMaterial({ color: '#b8d6dc', roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }),
    light: new THREE.MeshStandardMaterial({ color: '#f2dfbb', emissive: '#f2dfbb', emissiveIntensity: 0.65, roughness: 0.45 }),
    daylight: new THREE.MeshStandardMaterial({ color: '#d9e9ed', emissive: '#d9e9ed', emissiveIntensity: 0.48, side: THREE.DoubleSide }),
  };
  for (const [name, value] of Object.entries(m)) value.name = `Phase6-${theme}-${name}`;
  materialCache.set(theme, m); return m;
}

/** A solid elliptical voussoir, also used for actual bridge masonry. */
export function archWedge(parent, material, { cx = -1.1, spring = 3, rx = 9, ry = 5, thickness = 0.35, z = 0, depth = 0.6, from = 0, to = Math.PI, name = 'StoneVoussoir' } = {}) {
  const shape = new THREE.Shape(), steps = Math.max(2, Math.ceil((to - from) * 18));
  for (let i = 0; i <= steps; i++) {
    const t = from + (to - from) * i / steps, x = cx + (rx + thickness) * Math.cos(t), y = spring + (ry + thickness) * Math.sin(t);
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) { const t = from + (to - from) * i / steps; shape.lineTo(cx + rx * Math.cos(t), spring + ry * Math.sin(t)); }
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }), material);
  mesh.position.z = z - depth / 2; mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function vault(root, m, { spring = 3, rise = 5, rx = 9, cx = -1.1, start = -44, end = 44, name = 'MasonryBarrelVault' } = {}) {
  return archWedge(root, m, { cx, spring, rx, ry: rise, thickness: 0.32, z: (start + end) / 2, depth: end - start, name });
}

function column(root, m, x, z, height, { radius = 0.48, fluted = false } = {}) {
  cylinder(root, m.stone, radius, height - 0.7, [x, height / 2, z], [0, 0, 0], 24);
  for (const [y, r, h] of [[0.1, radius * 1.45, 0.2], [0.32, radius * 1.2, 0.18], [height - 0.35, radius * 1.25, 0.18], [height - 0.12, radius * 1.55, 0.24]]) cylinder(root, m.pale, r, h, [x, y, z], [0, 0, 0], 24);
  if (fluted) for (let i = 0; i < 16; i++) {
    const t = i / 16 * Math.PI * 2;
    cylinder(root, m.pale, 0.037, height - 1.1, [x + Math.cos(t) * radius, height / 2, z + Math.sin(t) * radius], [0, 0, 0], 6);
  }
  if (x < 0) root.addCollider(x, z, radius * 3.1, radius * 3.1);
}

function piersAndNiches(root, m, { height = 4, bay = 8, openings = false, fluted = false, panelStyle = 'rectangular' } = {}) {
  for (const x of [-10.05, 7.85]) {
    if (!openings) box(root, m.stone, [0.35, height, 88], [x, height / 2, 0]);
    else box(root, m.stone, [0.38, 0.65, 88], [x, 0.325, 0]);
    for (let z = -40; z <= 40; z += bay) {
      box(root, m.stone, [0.82, height, 0.95], [x, height / 2, z]);
      box(root, m.trim, [0.94, 0.18, 1.05], [x, height - 0.15, z]);
      if (openings && z + bay <= 44) {
        const arch = archWedge(root, m.stone, { cx: 0, spring: height - 1.5, rx: bay / 2 - 0.45, ry: 1.6, z: 0, depth: 0.55 });
        arch.rotation.y = Math.PI / 2; arch.position.set(x, 0, z + bay / 2);
        box(root, m.glass, [0.025, height - 1.2, bay - 1], [x, height / 2 + 0.1, z + bay / 2], { shadow: false });
      } else if (z + bay / 2 < 44 && panelStyle === 'arched') {
        const radius = (bay - 2) / 2, spring = height - 1.35, rise = 1.05, shape = new THREE.Shape();
        shape.moveTo(-radius, 0.65); shape.lineTo(radius, 0.65); shape.lineTo(radius, spring);
        for (let i = 0; i <= 24; i++) { const t = i * Math.PI / 24; shape.lineTo(radius * Math.cos(t), spring + rise * Math.sin(t)); } shape.closePath();
        const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false }), m.marble);
        panel.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; panel.position.set(x + (x < 0 ? 0.23 : -0.23), 0, z + bay / 2); root.add(panel);
        const frame = archWedge(root, m.pale, { cx: 0, spring, rx: radius, ry: rise, thickness: 0.16, depth: 0.2 });
        frame.rotation.y = Math.PI / 2; frame.position.set(x + (x < 0 ? 0.26 : -0.26), 0, z + bay / 2);
        for (const dz of [-radius, radius]) box(root, m.pale, [0.22, spring - 0.55, 0.18], [x + (x < 0 ? 0.26 : -0.26), (spring + 0.55) / 2, z + bay / 2 + dz]);
      } else if (z + bay / 2 < 44 && panelStyle === 'ashlar') {
        for (let y = 0.6; y < height; y += 0.6) box(root, y % 1.2 < 0.6 ? m.stone : m.pale, [0.19, 0.54, bay - 1.05], [x + (x < 0 ? 0.24 : -0.24), y, z + bay / 2]);
      } else if (z + bay / 2 < 44) {
        box(root, m.dark, [0.04, 2.3, bay - 1.5], [x + (x < 0 ? 0.22 : -0.22), 2, z + bay / 2]);
        box(root, m.marble, [0.045, 1.8, bay - 1.95], [x + (x < 0 ? 0.25 : -0.25), 2, z + bay / 2]);
        box(root, m.light, [0.07, 0.06, bay - 1.5], [x + (x < 0 ? 0.3 : -0.3), 3.22, z + bay / 2], { shadow: false });
      }
    }
  }
  if (fluted) for (const z of [-32, -16, 0, 16, 32]) column(root, m, -8.35, z, height + 1, { fluted: true });
}

function portals(root, m, height) {
  for (const z of [-44, 44]) {
    root.buildPlatformEndWall({ ...m, wall: m.stone }, z, height);
    box(root, m.stone, [2.7, height, 0.5], [6.55, height / 2, z]);
    box(root, m.stone, [5.5, height - 4.5, 0.5], [2.5, (height + 4.5) / 2, z]);
    archWedge(root, m.pale, { cx: 2.5, spring: 2.85, rx: 2.55, ry: 1.6, z, depth: 0.65, thickness: 0.22 });
    if (z < 0 ? root.options.northCap : root.options.southCap) box(root, m.dark, [5.2, 5.2, 0.25], [2.5, 1.7, z + Math.sign(z) * 4]);
  }
}

function ring(root, material, x, y, z, radius, thickness = 0.1, rotation = [-Math.PI / 2, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 64), material);
  mesh.position.set(x, y, z); mesh.rotation.set(...rotation); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
}

function suspendRing(root, m, x, y, z, radius, ceilingAt) {
  for (const dx of [-radius, radius]) {
    const top = ceilingAt(x + dx, z) + 0.04, bottom = y + 0.04;
    cylinder(root, m.trim, 0.022, top - bottom, [x + dx, (top + bottom) / 2, z], [0, 0, 0], 8);
  }
}

function premiumFloor(root, m, pattern) {
  // Retain the original structural slab, edge, tactile strips and safety limits.
  for (const child of [...root.platform.children]) if (child.isInstancedMesh && child.material.name !== 'yellow' && child.material === root.baseMaterials.tile) root.platform.remove(child);
  const tiles = [];
  for (let x = -9.6; x < -0.95; x += 0.75) for (let z = -43.5; z < 44; z += 0.75) {
    tiles.push({ size: [0.743, 0.014, 0.743], position: [x, -0.007, z] });
  }
  const finish = instances(root.platform, m.marble, tiles); finish.name = `${pattern}StoneFloorTiles`;
  for (const x of [-9.1, -8.9, -1.3]) box(root.platform, m.trim, [0.065, 0.004, 87.6], [x, 0.002, 0], { shadow: false });
  const floorRing = (z, r, width) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r - width, r + width, 80), m.dark);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(-5.2, 0.005, z); mesh.name = 'FlushStoneRingInlay'; root.platform.add(mesh);
  };
  const inlays = [];
  if (pattern === 'gothic-medallion') {
    for (let z = -32; z <= 32; z += 8) {
      inlays.push({ size: [2.65, 0.004, 2.65], position: [-5.4, 0.003, z], rotation: [0, Math.PI / 4, 0] });
      for (const [scale, material] of [[1.23, m.trim], [1.06, m.marble]]) {
        const shape = new THREE.Shape();
        for (let i = 0; i <= 96; i++) {
          const t = i * Math.PI * 2 / 96, r = scale * (0.83 + 0.17 * Math.cos(4 * t)), x = Math.cos(t) * r, y = Math.sin(t) * r;
          if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
        }
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material); mesh.rotation.x = -Math.PI / 2; mesh.position.set(-5.4, scale > 1.1 ? 0.0055 : 0.006, z); root.platform.add(mesh);
      }
    }
    for (let z = -42; z <= 42; z += 2) for (const x of [-8.4, -2.4]) inlays.push({ size: [0.18, 0.004, 0.18], position: [x, 0.003, z], rotation: [0, Math.PI / 4, 0] });
  } else if (['opus-sectile', 'chevron'].includes(pattern)) {
    for (let z = -40; z <= 40; z += pattern === 'chevron' ? 1.5 : 5) for (const x of pattern === 'chevron' ? [-6.8, -5.75, -4.7, -3.65] : [-6, -3.6]) {
      inlays.push({ size: pattern === 'chevron' ? [1.4, 0.01, 0.3] : [1.35, 0.01, 1.35], position: [x, 0.003, z], rotation: [0, (pattern === 'chevron' && x < -5 ? -1 : 1) * Math.PI / 4, 0] });
    }
  } else if (pattern === 'market-mosaic') {
    for (let z = -41; z <= 41; z += 2.2) for (let x = -8.2; x < -1.8; x += 1.1) inlays.push({ size: [0.7, 0.004, 0.7], position: [x, 0.003, z], rotation: [0, Math.PI / 4, 0] });
  } else if (pattern === 'river-bands') {
    // Transverse tessellated ripples are separate from Sonnenviertel's long,
    // flowing terrazzo ribbons; these floors have different physical layouts.
    for (let z = -40; z <= 40; z += 8) for (let x = -8.7; x <= -1.6; x += 0.15) for (const offset of [-0.22, 0.22]) {
      inlays.push({ size: [0.155, 0.004, 0.09], position: [x, 0.003, z + offset + 0.4 * Math.sin((x + 8.7) * 1.2)] });
    }
  } else if (pattern === 'flowing-terrazzo') {
    for (let z = -43; z < 43; z += 0.3) for (const offset of [-1.1, 1.1]) inlays.push({ size: [0.11, 0.004, 0.31], position: [-5.2 + offset + Math.sin(z / 8) * 0.9, 0.003, z] });
  } else if (pattern === 'compass-rose') {
    for (const z of [-27, 0, 27]) {
      floorRing(z, 2.6, 0.025);
      for (let i = 0; i < 16; i++) {
        const t = i * Math.PI / 8, shape = new THREE.Shape();
        shape.moveTo(0, 0); shape.lineTo(Math.cos(t - 0.08) * 0.6, Math.sin(t - 0.08) * 0.6); shape.lineTo(Math.cos(t) * 2.35, Math.sin(t) * 2.35); shape.closePath();
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), i % 2 ? m.trim : m.dark); mesh.rotation.x = -Math.PI / 2; mesh.position.set(-5.3, 0.018, z); root.platform.add(mesh);
      }
    }
  } else if (pattern === 'central-rings') {
    for (let z = -32; z <= 32; z += 8) for (const radius of [1.1, 1.65]) for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      inlays.push({ size: [0.065, 0.004, radius * 0.83], position: [-5.2 + radius * Math.cos(a), 0.003, z + radius * Math.sin(a)], rotation: [0, -a, 0] });
    }
  } else if (pattern === 'clinical-inlays') {
    for (let z = -41; z <= 41; z += 2.25) for (let x = -8.3; x <= -1.8; x += 1.5) inlays.push({ size: [0.32, 0.004, 1.08], position: [x, 0.003, z + ((Math.round(x * 2) % 2) ? 0.55 : 0)], rotation: [0, Math.PI / 2, 0] });
  } else if (pattern === 'forest-inlays') {
    for (let z = -42; z <= 42; z += 3) for (let x = -8.4; x <= -1.5; x += 0.55) inlays.push({ size: [0.38, 0.004, 2.7], position: [x, 0.003, z + (Math.round(x * 4) % 2) * 0.12] });
  } else {
    for (let z = -42; z <= 42; z += 3) inlays.push({ size: [7.1, 0.004, 0.15], position: [-5.1, 0.016, z] });
    for (const z of [-28, 0, 28]) for (const r of [1.1, 1.7, 2.3]) floorRing(z, r, 0.035);
  }
  if (inlays.length) { const mesh = instances(root.platform, pattern === 'forest-inlays' ? m.timber : m.dark, inlays); mesh.name = `${pattern}PhysicalInlays`; }
}

function ribbedVault(root, m, { rise = 5, spring = 3, spacing = 8 } = {}) {
  vault(root, m.soffit, { rise, spring });
  for (let z = -40; z <= 40; z += spacing) {
    for (let i = 0; i < 24; i++) archWedge(root, i === 12 ? m.trim : m.stone, { spring, ry: rise - 0.03, z, depth: 0.6, thickness: 0.23, from: i * Math.PI / 24 + 0.004, to: (i + 1) * Math.PI / 24 - 0.004 });
  }
  for (const x of [-9.2, 7]) box(root, m.light, [0.12, 0.06, 86], [x, spring + 0.14, 0], { shadow: false });
}

function kaiserforum(root, m) {
  piersAndNiches(root, m, { height: 5, bay: 8 });
  for (const x of [-10.05, 7.85]) {
    box(root, m.marble, [0.3, 5.7, 88], [x, 7.75, 0]);
    for (const y of [5.05, 9.35, 10.25]) box(root, m.pale, [0.7, 0.22, 88], [x, y, 0]);
    for (let z = -36; z <= 36; z += 8) {
      const arch = archWedge(root, m.trim, { cx: 0, spring: 6.2, rx: 2.6, ry: 2.1, z: 0, depth: 0.18, thickness: 0.12 });
      arch.rotation.y = Math.PI / 2; arch.position.set(x + (x < 0 ? 0.22 : -0.22), 0, z);
    }
  }
  for (const x of [-8.35, 6.4]) box(root, m.pale, [1.7, 0.8, 88], [x, 10.1, 0]);
  // Deep classical coffers, with individual recessed panels and rosettes.
  box(root, m.soffit, [18.3, 0.4, 88], [-1.1, 10.7, 0]);
  for (let z = -40; z <= 40; z += 8) for (let x = -8; x < 8; x += 4) {
    box(root, m.marble, [3.6, 0.18, 7.35], [x, 10.31, z]);
    for (const dx of [-1.88, 1.88]) box(root, m.pale, [0.26, 0.8, 8], [x + dx, 10.25, z]);
    for (const dz of [-3.8, 3.8]) box(root, m.pale, [4, 0.8, 0.26], [x, 10.25, z + dz]);
    ring(root, m.trim, x, 10.15, z, 0.58, 0.08);
  }
  for (const z of [-32, -16, 0, 16, 32]) {
    for (const x of [-8.35, 6.4]) column(root, m, x, z, 9.7, { radius: 0.6, fluted: true });
    ring(root, m.trim, -1.1, 7.75, z, 1.6, 0.08);
    for (const x of [-2.7, 0.5]) cylinder(root, m.trim, 0.025, 2.5, [x, 9.05, z]);
    ring(root, m.light, -1.1, 7.68, z, 1.55, 0.05);
  }
  portals(root, m, 10.5);
}

function goldmarkt(root, m) {
  piersAndNiches(root, m, { height: 3.5, bay: 8, panelStyle: 'arched' });
  // Expressed vault bays and lanterns above an arcaded market hall.
  for (let z = -40; z <= 40; z += 8) {
    vault(root, m.stone, { spring: 3.5, rise: 4.8, start: Math.max(-44, z - 4.01), end: Math.min(44, z + 4.01), name: 'MarketSailVault' });
    archWedge(root, m.trim, { spring: 3.5, ry: 4.65, z, depth: 0.12, thickness: 0.12 });
    const lantern = new THREE.Group(); lantern.position.set(-4.5, 5.6, z); root.add(lantern);
    box(lantern, m.light, [0.5, 0.8, 0.5], [0, 0, 0], { shadow: false });
    for (const x of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) box(lantern, m.trim, [0.04, 1, 0.04], [x, 0, dz]);
    cylinder(lantern, m.trim, 0.025, 2.15, [0, 1.475, 0]);
    for (const x of [-8.6, 6.4]) column(root, m, x, z, 3.65, { radius: 0.36 });
  }
  portals(root, m, 8.2);
}

function sonnenviertel(root, m) {
  for (const x of [-10.05, 7.85]) {
    box(root, m.pale, [0.3, 7, 88], [x, 3.5, 0]);
    for (let z = -42; z <= 42; z += 2) {
      const relief = 0.12 + 0.09 * Math.sin(z / 4);
      box(root, z % 6 === 0 ? m.trim : m.marble, [0.16, 4.3, 1.8], [x + (x < 0 ? relief : -relief), 2.4, z]);
    }
    box(root, m.dark, [0.32, 0.65, 88], [x, 0.325, 0]);
    box(root, m.light, [0.36, 0.045, 87], [x, 4.9, 0], { shadow: false });
  }
  const heightAt = (x, z) => 6.2 + Math.sin((x + 10.1) / 18 * Math.PI) * 3 + 0.7 * Math.sin(z / 12 + (x + 10.1) / 18 * 24 / 9);
  const xs = [...new Set([-10.1, 7.9, -8.4, -6, 2.4, 4.8, ...Array.from({ length: 35 }, (_, i) => -9.8 + i * 0.5)])].sort((a, b) => a - b);
  const zs = [...new Set([-44, 44, -31.5, -24.5, -3.5, 3.5, 24.5, 31.5, ...Array.from({ length: 175 }, (_, i) => -43.5 + i * 0.5)])].sort((a, b) => a - b);
  const vertices = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2;
    if ([-7.2, 3.6].some(a => Math.abs(x - a) < 1.2) && [-28, 0, 28].some(a => Math.abs(z - a) < 3.5)) continue;
    const p = [[xs[i], zs[j]], [xs[i + 1], zs[j]], [xs[i + 1], zs[j + 1]], [xs[i], zs[j + 1]]].map(([x, z]) => [x, heightAt(x, z) + 0.17, z]);
    vertices.push(...p[0], ...p[2], ...p[1], ...p[0], ...p[3], ...p[2]);
  }
  const surface = new THREE.BufferGeometry(); surface.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); surface.computeVertexNormals();
  const shellMaterial = m.soffit.clone(); shellMaterial.side = THREE.DoubleSide;
  const shell = new THREE.Mesh(surface, shellMaterial); shell.name = 'ContinuousSculpturalRoofWithDaylightApertures'; shell.castShadow = shell.receiveShadow = true; root.add(shell);
  // Physical, continuously varying folded fins; open roof slots lead to actual
  // 48 m light wells, rather than an emissive rectangle covering a solid roof.
  for (let z = -43; z <= 43; z += 1.6) {
    const width = 18, points = [];
    for (let i = 0; i <= 24; i++) {
      const x = -10.1 + width * i / 24, y = 6.2 + Math.sin(i / 24 * Math.PI) * 3 + 0.7 * Math.sin(z / 12 + i / 9);
      points.push(new THREE.Vector3(x, y, z));
    }
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.16, 6, false), m.pale); mesh.name = 'SculpturalCeilingFin'; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  for (const x of [-7.2, 3.6]) for (const z of [-28, 0, 28]) {
    for (const dx of [-1.2, 1.2]) box(root, m.soffit, [0.16, 46, 7], [x + dx, 29.8, z]);
    for (const dz of [-3.5, 3.5]) box(root, m.soffit, [2.4, 46, 0.16], [x, 29.8, z + dz]);
    box(root, m.daylight, [2.25, 0.06, 6.7], [x, 52.7, z], { shadow: false });
    box(root, m.glass, [2.25, 0.04, 6.7], [x, 9.7, z], { shadow: false });
  }
  for (const x of [-9.2, 7]) {
    box(root, m.light, [0.06, 0.08, 86], [x, 4.8, 0], { shadow: false });
    const wall = x < 0 ? -9.9 : 7.7;
    for (let z = -40; z <= 40; z += 8) box(root, m.trim, [Math.abs(wall - x), 0.045, 0.09], [(wall + x) / 2, 4.85, z]);
  }
  portals(root, m, 8.8);
}

function hohenbrueck(root, m) {
  piersAndNiches(root, m, { height: 3.2, bay: 8, panelStyle: 'arched' });
  // Paired transverse arches and contrasting longitudinal stone ribs.
  ribbedVault(root, m, { rise: 5.2, spring: 3.2, spacing: 8 });
  for (const z of [-36, -20, -4, 12, 28]) {
    for (const x of [-8.55, 6.4]) column(root, m, x, z, 3.4, { radius: 0.38, fluted: true });
    for (const x of [-7.95, 5.8]) box(root, m.light, [0.1, 0.75, 0.25], [x, 3.2, z], { shadow: false });
  }
  for (const x of [-5.6, 3.4]) box(root, m.trim, [0.12, 0.11, 87.5], [x, 3.2 + 5.2 * Math.sqrt(1 - ((x + 1.1) / 9) ** 2) - 0.035, 0]);
  portals(root, m, 8.5);
}

function kronenplatz(root, m) {
  piersAndNiches(root, m, { height: 5.4, bay: 8 });
  for (const x of [-10.05, 7.85]) box(root, m.pale, [0.65, 0.5, 88], [x, 5.65, 0]);
  const pendentives = new THREE.Shape(); pendentives.moveTo(-10.1, -44); pendentives.lineTo(7.9, -44); pendentives.lineTo(7.9, 44); pendentives.lineTo(-10.1, 44); pendentives.closePath();
  for (const [z, radius] of [[-28, 7.7], [0, 8.8], [28, 7.7]]) {
    const aperture = new THREE.Path(); aperture.absarc(-1.1, z, radius - 0.03, 0, Math.PI * 2, true); pendentives.holes.push(aperture);
  }
  const pendentiveSlab = new THREE.Mesh(new THREE.ExtrudeGeometry(pendentives, { depth: 0.3, bevelEnabled: false, curveSegments: 48 }), m.soffit);
  pendentiveSlab.rotation.x = Math.PI / 2; pendentiveSlab.position.y = 6.1; pendentiveSlab.name = 'SolidDomePendentives'; root.add(pendentiveSlab);
  // Three complete pendentive domes: the central crown is the major landmark.
  for (const [z, radius] of [[-28, 7.7], [0, 8.8], [28, 7.7]]) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), m.marble);
    mesh.material = m.marble.clone(); mesh.material.side = THREE.DoubleSide; mesh.position.set(-1.1, 5.8, z); mesh.scale.y = 0.65; mesh.name = 'CrownPendentiveDome'; root.add(mesh);
    ring(root, m.trim, -1.1, 5.85, z, radius, 0.15);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8, points = [];
      for (let j = 0; j <= 16; j++) { const t = j / 16 * Math.PI / 2; points.push(new THREE.Vector3(-1.1 + radius * Math.sin(t) * Math.cos(angle), 5.8 + radius * 0.65 * Math.cos(t), z + radius * Math.sin(t) * Math.sin(angle))); }
      root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, 0.065, 6, false), m.trim));
    }
    for (const x of [-8.7, 6.5]) for (const dz of [-7.5, 7.5]) column(root, m, x, z + dz, 5.8, { radius: 0.54 });
    ring(root, m.light, -1.1, 7.3, z, radius * 0.34, 0.065);
    suspendRing(root, m, -1.1, 7.3, z, radius * 0.34, (x, zz) => 5.8 + radius * 0.65 * Math.sqrt(1 - ((x + 1.1) ** 2 + (zz - z) ** 2) / radius ** 2));
  }
  for (const x of [-8.9, 6.7]) box(root, m.soffit, [2.5, 0.24, 88], [x, 6.1, 0]);
  for (const z of [-42, -14, 14, 42]) box(root, m.soffit, [18, 0.25, 6], [-1.1, 6.1, z]);
  portals(root, m, 6.2);
}

function altstadtbruecke(root, m) {
  piersAndNiches(root, m, { height: 3.6, bay: 8, panelStyle: 'arched' });
  ribbedVault(root, m, { rise: 5.8, spring: 3.6, spacing: 8 });
  // Cross ribs make the historic vault read as a sequence of stone bays.
  for (let z = -36; z <= 36; z += 8) for (const sign of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector3(-9.8 + t * 17.4, 3.6 + Math.sin(t * Math.PI) * 5.75, z + sign * (t - 0.5) * 8)); }
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.12, 8, false), m.pale); mesh.castShadow = true; root.add(mesh);
  }
  for (const z of [-32, -16, 0, 16, 32]) {
    column(root, m, -8.55, z, 3.6, { radius: 0.4 });
    ring(root, m.trim, -4, 5.1, z, 0.7, 0.06);
    ring(root, m.light, -4, 5.08, z, 0.66, 0.03);
    suspendRing(root, m, -4, 5.1, z, 0.7, x => 3.6 + 5.8 * Math.sqrt(1 - ((x + 1.1) / 9) ** 2));
  }
  portals(root, m, 9.5);
}

function uferpromenade(root, m) {
  piersAndNiches(root, m, { height: 4.1, bay: 8, openings: true });
  // Open riverside loggia with three pitched timber roof bays and glazed slots.
  for (const x of [-7.1, -1.1, 4.9]) {
    for (const sign of [-1, 1]) box(root, m.timber, [3.35, 0.22, 88], [x + sign * 1.45, 7.1, 0], { rotation: [0, 0, -sign * 0.4] });
    box(root, m.glass, [1.2, 0.1, 88], [x, 7.72, 0], { shadow: false });
  }
  for (let z = -40; z <= 40; z += 8) {
    for (const x of [-9, 6.8]) column(root, m, x, z, 6.82, { radius: 0.28 });
    archWedge(root, m.timber, { spring: 4, ry: 3.3, z, depth: 0.22, thickness: 0.12 });
    box(root, m.light, [12, 0.05, 0.06], [-1, 6.65, z], { shadow: false });
  }
  portals(root, m, 7.9);
}

function steinbogen(root, m) {
  // Massive diaphragms alternate with high transverse barrel vaults.
  piersAndNiches(root, m, { height: 4.5, bay: 8, panelStyle: 'ashlar' });
  vault(root, m.soffit, { spring: 4.5, rise: 5.8, name: 'MonumentalStoneBarrel' });
  for (let z = -40; z <= 40; z += 8) {
    archWedge(root, m.stone, { spring: 3.9, ry: 5.9, rx: 8.65, z, depth: 1.15, thickness: 0.55 });
    for (const x of [-9, 6.85]) {
      box(root, m.stone, [1.2, 4.5, 1.5], [x, 2.25, z]);
      if (x < 0) root.addCollider(x, z, 1.2, 1.5);
      box(root, m.light, [0.08, 0.5, 0.6], [x + (x < 0 ? 0.62 : -0.62), 2.9, z], { shadow: false });
    }
  }
  portals(root, m, 10.4);
}

function centralLanterns(root, m) {
  piersAndNiches(root, m, { height: 4.5, bay: 8 });
  vault(root, m.soffit, { spring: 4.5, rise: 4.3 });
  for (const z of [-32, -16, 0, 16, 32]) {
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.8, 1.4, 8, 1, true), m.trim);
    lantern.position.set(-1.1, 6.6, z); root.add(lantern);
    suspendRing(root, m, -1.1, 7.26, z, 2, x => 4.5 + 4.3 * Math.sqrt(1 - ((x + 1.1) / 9) ** 2));
    cylinder(root, m.light, 1.9, 0.05, [-1.1, 6, z], [0, 0, 0], 8);
    archWedge(root, m.pale, { spring: 4.5, ry: 4.1, z, depth: 0.55 });
  }
  portals(root, m, 8.9);
}

function nordklinikum(root, m) {
  piersAndNiches(root, m, { height: 4.4, bay: 8 });
  vault(root, m.pale, { spring: 4.4, rise: 3.6 });
  for (let z = -42; z <= 42; z += 3) {
    archWedge(root, m.trim, { spring: 4.4, ry: 3.48, z, depth: 0.08, thickness: 0.055 });
    if (z % 2 === 0) archWedge(root, m.light, { spring: 4.4, ry: 3.35, z, depth: 0.06, thickness: 0.045 });
  }
  portals(root, m, 8.2);
}

function waldtor(root, m) {
  piersAndNiches(root, m, { height: 4.3, bay: 8 });
  vault(root, m.soffit, { spring: 4.3, rise: 4.2 });
  for (let z = -42; z <= 42; z += 2.8) archWedge(root, m.timber, { spring: 4.1, ry: 4.1, z, depth: 0.18, thickness: 0.14 });
  for (const x of [-8.2, -4.8, 2.6, 6]) box(root, m.light, [0.07, 0.07, 86], [x, 4.1 + 4.1 * Math.sqrt(1 - ((x + 1.1) / 9) ** 2) - 0.03, 0], { shadow: false });
  portals(root, m, 8.6);
}

export const PHASE6_DESIGNS = Object.freeze({
  'u5-altstadtbruecke': ['amber', 'gothic-medallion', 'Stone groin vaults', altstadtbruecke],
  'u5-uferpromenade': ['river', 'river-bands', 'Open riverside timber loggia', uferpromenade],
  'u5-steinbogen': ['monumental', 'ashlar-runner', 'Monumental stone diaphragms', steinbogen],
  'u9-kaiserforum': ['ivory', 'opus-sectile', 'Classical marble coffer hall', kaiserforum],
  'u9-goldmarkt': ['amber', 'market-mosaic', 'Arcaded market vaults and lanterns', goldmarkt],
  'u9-sonnenviertel': ['modern', 'flowing-terrazzo', 'Sculptural fins and deep daylight wells', sonnenviertel],
  'u9-hohenbrueck': ['ivory', 'chevron', 'Paired European stone arches', hohenbrueck],
  'u9-kronenplatz': ['ivory', 'compass-rose', 'Three ribbed pendentive domes', kronenplatz],
  'station-2': ['ivory', 'central-rings', 'Octagonal Central lantern vault', centralLanterns],
  'u5-nordklinikum': ['modern', 'clinical-inlays', 'Porcelain ribs and light arches', nordklinikum],
  'u5-waldtor': ['forest', 'forest-inlays', 'Timber arch undercroft', waldtor],
});

export class Phase6Station extends Station {
  buildArchitecture(base) {
    const design = PHASE6_DESIGNS[this.stationId];
    if (!design) throw new Error(`Missing individual Phase 6 architecture: ${this.stationId}`);
    const [theme, floor, roof, build] = design, m = architecturalMaterials(theme);
    this.baseMaterials = base;
    premiumFloor(this, m, floor); build(this, m);
    this.userData.phase6Architecture = { roof, wall: `${theme} masonry, articulated bays and inset materials`, floor };
    this.lightingOptions = { fixtures: false, pointDefinitions: [
      { position: [-4.8, 4.8, -30], color: theme === 'modern' || theme === 'river' ? '#e3edf1' : '#f3d7a9', intensity: 95, distance: 27 },
      { position: [-4.8, 4.8, -10], color: '#eee4cf', intensity: 75, distance: 26 },
      { position: [-4.8, 4.8, 10], color: '#eee4cf', intensity: 75, distance: 26 },
      { position: [-4.8, 4.8, 30], color: theme === 'modern' || theme === 'river' ? '#e3edf1' : '#f3d7a9', intensity: 95, distance: 27 },
    ] };
  }
}
