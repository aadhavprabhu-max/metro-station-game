import * as THREE from 'three';
import { instances } from './geometry.js';

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
    this.scene = scene;
    this.materials = materials;
    this.stationLights = [];
    this.addStationFixtures(0, { pointLights: 4 });
  }

  /** Each station reuses the fixtures; the system's ambient and shadow key stay global. */
  addStationFixtures(offsetZ, { cool = false, pointLights = 2 } = {}) {
    const fixturesGroup = new THREE.Group();
    fixturesGroup.name = `StationFixtures-${offsetZ}`;
    fixturesGroup.position.z = offsetZ;
    this.add(fixturesGroup);
    const fixtures = [], housings = [];
    for (let z = -40; z <= 40; z += 8) {
      for (const x of [-6.0, -1.3, 5.7]) {
        housings.push({ size: [0.23, 0.11, 4.3], position: [x, 5.02, z] });
        fixtures.push({ size: [0.17, 0.025, 4.1], position: [x, 4.955, z] });
      }
    }
    instances(fixturesGroup, this.materials.dark, housings, undefined, false);
    instances(fixturesGroup, this.materials.tubeLight, fixtures, undefined, false);
    const positions = pointLights >= 4 ? [-28, -7, 14, 35] : [-21, 21].slice(0, pointLights);
    for (const z of positions) {
      const point = new THREE.PointLight(cool ? '#dfeaf5' : '#f6f3df', pointLights >= 4 ? 65 : 90, pointLights >= 4 ? 23 : 34, 2);
      point.position.set(-2.7, 4.65, z + offsetZ);
      this.scene.add(point);
      this.stationLights.push(point);
    }
    return fixturesGroup;
  }
}
