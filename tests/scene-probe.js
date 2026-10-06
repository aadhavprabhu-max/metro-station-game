// Served through Vite so the probe shares the application's Three.js instance.
import * as THREE from 'three';

export function probeSpawn(world) {
  world.scene.updateMatrixWorld(true);
  world.camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const visible = (position, targetRoot) => {
    const projected = new THREE.Vector3(...position).project(world.camera);
    if (Math.abs(projected.x) >= 1 || Math.abs(projected.y) >= 1 || projected.z >= 1) return false;
    raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), world.camera);
    const hit = raycaster.intersectObjects(world.scene.children, true)[0];
    for (let node = hit?.object; node; node = node.parent) if (node === targetRoot) return true;
    return false;
  };
  return {
    trainVisible: [-20, -4, 17].map(z => visible([0.12, 1.5, z], world.train)),
    boardVisible: visible(world.station.departures.screen.getWorldPosition(new THREE.Vector3()).toArray(), world.station.departures),
  };
}
