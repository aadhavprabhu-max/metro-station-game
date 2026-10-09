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
    this.lightDefinitions = new Map();
    this.currentPlatformId = null;
    // A fixed pool avoids adding shader work for every distant station. The
    // selected platform retains its original light positions and intensities.
    for (let index = 0; index < 4; index++) {
      const point = new THREE.PointLight('#f6f3df', 0, 34, 2);
      scene.add(point);
      this.stationLights.push(point);
    }
    this.addStationFixtures(0, { pointLights: 4, platformId: 'station-1:U1' });
    this.usePlatform('station-1:U1');
  }

  /** Each station reuses the fixtures; the system's ambient and shadow key stay global. */
  addStationFixtures(offsetZ, {
    cool = false, pointLights = 2, offsetX = 0, offsetY = 0, rotationY = 0,
    platformId = `platform-${offsetX}-${offsetZ}`, fixtures: buildFixtures = true,
    pointDefinitions = null,
  } = {}) {
    const fixturesGroup = new THREE.Group();
    fixturesGroup.name = `StationFixtures-${offsetZ}`;
    fixturesGroup.userData.platformId = platformId;
    fixturesGroup.position.set(offsetX, offsetY, offsetZ);
    fixturesGroup.rotation.y = rotationY;
    this.add(fixturesGroup);
    const fixtures = [], housings = [];
    for (let z = -40; buildFixtures && z <= 40; z += 8) {
      for (const x of [-6.0, -1.3, 5.7]) {
        housings.push({ size: [0.23, 0.11, 4.3], position: [x, 5.02, z] });
        fixtures.push({ size: [0.17, 0.025, 4.1], position: [x, 4.955, z] });
      }
    }
    if (buildFixtures) {
      instances(fixturesGroup, this.materials.dark, housings, undefined, false);
      instances(fixturesGroup, this.materials.tubeLight, fixtures, undefined, false);
    }
    const positions = pointLights >= 4 ? [-28, -7, 14, 35] : [-21, 21].slice(0, pointLights);
    const definitions = pointDefinitions ?? positions.map(z => ({
      position: [-2.7, 4.65, z], color: cool ? '#dfeaf5' : '#f6f3df',
      intensity: pointLights >= 4 ? 65 : 90, distance: pointLights >= 4 ? 23 : 34,
    }));
    this.lightDefinitions.set(platformId, definitions.slice(0, 4).map(definition => ({
      ...definition,
      position: fixturesGroup.localToWorld(new THREE.Vector3(...definition.position)),
    })));
    return fixturesGroup;
  }

  usePlatform(platformId) {
    if (this.currentPlatformId === platformId) return;
    this.currentPlatformId = platformId;
    const definitions = this.lightDefinitions.get(platformId) ?? [];
    this.stationLights.forEach((point, index) => {
      const definition = definitions[index];
      point.intensity = definition?.intensity ?? 0;
      if (!definition) return;
      point.position.copy(definition.position);
      point.color.set(definition.color);
      point.distance = definition.distance;
    });
  }
}
