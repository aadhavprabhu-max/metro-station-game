import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Batch opaque static pieces by material without merging interactive groups or glass. */
export function batchStaticGeometry(root) {
  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const batches = new Map();
  const visit = node => {
    if (node !== root && node.userData.dynamic) return;
    if (node.isMesh && !node.isInstancedMesh && !Array.isArray(node.material) && !node.material.transparent) {
      const key = `${node.material.uuid}/${node.castShadow}/${node.receiveShadow}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(node);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(transform);
    });
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error('Unable to batch compatible station geometry.');
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, meshes[0].material);
    merged.name = `StaticBatch-${root.name}`;
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    root.add(merged);
    meshes.forEach(mesh => mesh.removeFromParent());
    geometries.forEach(item => item.dispose());
  }
}
