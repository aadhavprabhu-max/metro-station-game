import * as THREE from 'three';
import { box, instances } from './geometry.js';

export class Lighting extends THREE.Group {
  constructor(scene, materials) {
    super();
    this.name = 'StationLighting';
    scene.add(new THREE.HemisphereLight('#e5eee9', '#696e5f', 1.45));
    const key = new THREE.DirectionalLight('#fff3d9', 1.8);
    key.position.set(-5, 4.8, -25);
    key.target.position.set(1, 0, -12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -37, right: 37, top: 30, bottom: -30, near: 1, far: 75 });
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.035;
    scene.add(key, key.target);
    this.keyLight = key;
    const fixtures = [];
    for (let z = -40; z <= 40; z += 8) {
      for (const x of [-6.0, -1.3, 5.7]) {
        box(this, materials.dark, [0.23, 0.11, 4.3], [x, 5.02, z], { shadow: false });
        fixtures.push({ size: [0.17, 0.025, 4.1], position: [x, 4.955, z] });
      }
    }
    instances(this, materials.tubeLight, fixtures, undefined, false);
    for (const z of [-28, -7, 14, 35]) {
      const point = new THREE.PointLight('#f6f3df', 65, 23, 2);
      point.position.set(-2.7, 4.65, z);
      scene.add(point);
    }
  }
}
