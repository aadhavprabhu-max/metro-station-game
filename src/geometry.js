import * as THREE from 'three';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitPlane = new THREE.PlaneGeometry(1, 1);
const cylinderCache = new Map();
const transform = new THREE.Object3D();

export function box(parent, material, size, position, { shadow = true, rotation = null } = {}) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  parent.add(mesh);
  return mesh;
}

export function cylinder(parent, material, radius, length, position, rotation = [0, 0, 0], segments = 12) {
  const key = `${radius}/${length}/${segments}`;
  if (!cylinderCache.has(key)) cylinderCache.set(key, new THREE.CylinderGeometry(radius, radius, length, segments));
  const mesh = new THREE.Mesh(cylinderCache.get(key), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function instances(parent, material, entries, geometry = unitBox, shadow = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  entries.forEach((entry, index) => {
    transform.position.set(...entry.position);
    transform.scale.set(...(entry.size ?? [1, 1, 1]));
    transform.rotation.set(...(entry.rotation ?? [0, 0, 0]));
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    if (entry.color) mesh.setColorAt(index, new THREE.Color(entry.color));
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas textures are unavailable in this browser.');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function label(parent, text, width, height, position, { background = '#243d38', color = '#edf1e7', fontSize = 68, rotation = [0, 0, 0], align = 'center', border = false } = {}) {
  const texture = canvasTexture(1024, Math.max(128, Math.round(1024 * height / width)), (ctx, w, h) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    if (border) { ctx.strokeStyle = '#899f96'; ctx.lineWidth = 5; ctx.strokeRect(12, 12, w - 24, h - 24); }
    ctx.fillStyle = color;
    ctx.font = `600 ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, align === 'left' ? 40 : w / 2, h / 2, w - 50);
  });
  const mesh = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.scale.set(width, height, 1);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

export function seededRandom(seed = 27) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
