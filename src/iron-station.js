import * as THREE from 'three';
import { Station } from './station.js';
import { box, cylinder, instances, label, seededRandom } from './geometry.js';

const rivetGeometry = new THREE.CylinderGeometry(0.032, 0.032, 0.042, 8);
const valveGeometry = new THREE.TorusGeometry(0.245, 0.028, 5, 12);

function createIronMaterials(materials) {
  const industrial = { ...materials };
  for (const [name, color, roughness] of [
    ['concrete', '#999d94', 0.92], ['tile', '#888a81', 0.63],
    ['wall', '#7d8077', 0.85], ['wallTile', '#8a908b', 0.74],
    ['greenTile', '#8e4640', 0.7], ['wood', '#82766a', 0.88],
  ]) {
    industrial[name] = materials[name].clone();
    industrial[name].color.set(color);
    industrial[name].roughness = roughness;
  }
  industrial.ironFrame = new THREE.MeshStandardMaterial({ color: '#313936', roughness: 0.76, metalness: 0.6 });
  industrial.weatheredSteel = new THREE.MeshStandardMaterial({ color: '#62685f', roughness: 0.8, metalness: 0.43 });
  industrial.rust = new THREE.MeshStandardMaterial({ color: '#835737', roughness: 0.95, metalness: 0.12 });
  industrial.factoryPanel = new THREE.MeshStandardMaterial({ color: '#797e73', roughness: 0.86, metalness: 0.25 });
  industrial.amberFixture = new THREE.MeshStandardMaterial({ color: '#ffd19a', emissive: '#ffba6b', emissiveIntensity: 2.2, roughness: 0.55 });
  for (const name of ['ironFrame', 'weatheredSteel', 'rust', 'factoryPanel', 'amberFixture']) industrial[name].name = `Ironworks-${name}`;
  return industrial;
}

/** A structural member between two points; its long axis follows the endpoints. */
function member(parent, material, start, end, width = 0.16, depth = 0.22) {
  const from = new THREE.Vector3(...start);
  const to = new THREE.Vector3(...end);
  const direction = to.clone().sub(from);
  const mesh = box(parent, material, [width, direction.length(), depth], from.clone().add(to).multiplyScalar(0.5).toArray());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

/** A complete platform inside a steelworks hall, using the existing station systems. */
export class IronStation extends Station {
  constructor(materials, options = {}) {
    super(createIronMaterials(materials), {
      id: 'u2-eisenwerk', displayName: 'Eisenwerk', lineId: 'U2',
      lineName: 'THE INDUSTRIAL LINE', platformNumber: '02',
      destinationName: 'Stadtzentrum', signageColor: '#b4443d',
      northCap: false, southCap: true, ...options,
    });
    this.theme = 'ironworks';
    this.userData.stationTheme = 'ironworks';
    this.userData.industrialArchitecture = {
      roofHeight: 8.95, trusses: 11, platformColumns: 5,
      rivets: this.userData.industrialRivetCount, machineryAreas: 4,
      bridgeCranes: 1, machineryAccessible: false,
    };
    // The shared lighting manager transforms these local positions and pools
    // four lights across the network instead of lighting every remote hall.
    this.lightingOptions = {
      pointDefinitions: [
        { position: [-4.9, 4.6, -27], color: '#e8eee8', intensity: 80, distance: 32 },
        { position: [-3.4, 4.6, 0], color: '#eef0e6', intensity: 85, distance: 34 },
        { position: [-4.9, 4.6, 27], color: '#e8eee8', intensity: 80, distance: 32 },
        { position: [9, 5, 0], color: '#ffd099', intensity: 110, distance: 38 },
      ],
    };
  }

  buildArchitecture(m) {
    // A much taller, wider hall than the modern stations. The original level
    // platform and railway remain intact under the industrial roof structure.
    box(this, m.factoryPanel, [0.36, 9.0, 90], [-10.1, 4.42, 0]);
    box(this, m.factoryPanel, [0.36, 9.0, 90], [14.1, 4.42, 0]);
    box(this, m.weatheredSteel, [24.6, 0.22, 90], [2, 8.95, 0]);
    box(this, m.concrete, [6.3, 0.9, 88], [10.85, -0.48, 0]);

    const corrugations = [], wallRibs = [], suspensions = [], rivets = [], wear = [];
    const random = seededRandom(694);
    for (let z = -44; z <= 44; z += 0.7) {
      corrugations.push({ size: [24.2, 0.06, 0.085], position: [2, 8.8, z] });
    }
    for (let z = -42; z <= 42; z += 3) {
      wallRibs.push({ size: [0.11, 8.9, 0.14], position: [-9.86, 4.42, z] });
      wallRibs.push({ size: [0.14, 8.9, 0.14], position: [13.86, 4.42, z] });
    }
    instances(this, m.weatheredSteel, corrugations, undefined, false).name = 'IronworksRoofCorrugations';
    instances(this, m.ironFrame, wallRibs).name = 'IronworksWallRibs';

    // Longitudinal girders carry the repeated triangulated transverse trusses.
    for (const x of [-8.3, 7.95, 13.65]) {
      box(this, m.ironFrame, [0.37, 0.78, 88], [x, 6.38, 0]);
      box(this, m.weatheredSteel, [0.83, 0.11, 88], [x, 5.93, 0]);
      box(this, m.weatheredSteel, [0.83, 0.11, 88], [x, 6.83, 0]);
    }
    for (let z = -40; z <= 40; z += 8) {
      const bottom = 6.58;
      member(this, m.ironFrame, [-9.9, bottom, z], [13.9, bottom, z], 0.38, 0.5);
      const nodes = [-9.9, -5.14, -0.38, 4.38, 9.14, 13.9];
      const heights = [7.9, 8.3, 8.65, 8.65, 8.3, 7.9];
      for (let i = 0; i < nodes.length; i++) {
        member(this, m.weatheredSteel, [nodes[i], bottom, z], [nodes[i], heights[i], z], 0.12, 0.18);
        if (i < nodes.length - 1) {
          member(this, m.ironFrame, [nodes[i], heights[i], z], [nodes[i + 1], heights[i + 1], z], 0.3, 0.42);
          const rising = i % 2 === 0;
          member(this, m.weatheredSteel,
            [nodes[i], rising ? bottom : heights[i], z],
            [nodes[i + 1], rising ? heights[i + 1] : bottom, z], 0.17, 0.23);
        }
      }
      // Hanging rods align with the normal neutral-white fixture system.
      for (const x of [-6.0, -1.3, 5.7]) {
        for (const dz of [-1.7, 1.7]) suspensions.push({ size: [0.027, 1.46, 0.027], position: [x, 5.8, z + dz] });
      }
    }
    instances(this, m.ironFrame, suspensions, undefined, false).name = 'IronworksLightSuspensions';

    // Riveted I-section platform columns use the original column positions.
    for (const z of [-32, -16, 0, 16, 32]) {
      box(this, m.ironFrame, [0.16, 6.3, 0.62], [-8.3, 3.15, z]);
      for (const side of [-1, 1]) {
        box(this, m.ironFrame, [0.72, 6.3, 0.105], [-8.3, 3.15, z + side * 0.33]);
        for (const y of [0.32, 0.56, 2.35, 2.58, 4.85, 5.08, 5.94, 6.17]) {
          for (const dx of [-0.24, 0.24]) rivets.push({ position: [-8.3 + dx, y, z + side * 0.403], rotation: [Math.PI / 2, 0, 0] });
        }
      }
      box(this, m.weatheredSteel, [0.96, 0.12, 1.02], [-8.3, 0.06, z]);
      box(this, m.weatheredSteel, [0.88, 0.13, 0.89], [-8.3, 6.32, z]);
      wear.push({ size: [0.37, 0.23 + random() * 0.22, 0.011], position: [-8.25, 0.28, z - 0.39] });
      this.addCollider(-8.3, z, 0.98, 1.04);
      label(this, this.platformNumber, 0.39, 0.25, [-7.927, 1.76, z], {
        rotation: [0, Math.PI / 2, 0], fontSize: 190, background: '#8e4640',
      });
    }

    // A service gantry behind the tracks carries the familiar station signs;
    // its open frame reveals actual large factory equipment behind it.
    for (const z of [-40, -24, -8, 8, 24, 40]) {
      box(this, m.ironFrame, [0.31, 6.2, 0.36], [7.95, 3.1, z]);
      box(this, m.weatheredSteel, [0.52, 0.08, 0.58], [7.95, 0.04, z]);
      for (const y of [0.29, 0.5, 5.7, 5.95]) {
        for (const dz of [-0.13, 0.13]) rivets.push({ position: [7.765, y, z + dz], rotation: [0, 0, Math.PI / 2] });
      }
    }
    for (const z of [-27, -8, 12, 32]) {
      box(this, m.ironFrame, [0.085, 0.83, 4.92], [7.69, 2.6, z]);
    }
    for (const y of [0.47, 1.08]) box(this, m.ironFrame, [0.065, 0.075, 87.6], [7.86, y, 0]);
    for (const z of [-32, -16, 0, 16, 32]) {
      member(this, m.weatheredSteel, [13.81, 1.1, z - 7.6], [13.81, 7.4, z + 7.6], 0.14, 0.14);
    }
    instances(this, m.weatheredSteel, rivets, rivetGeometry).name = 'IronworksRivets';
    instances(this, m.rust, wear, undefined, false).name = 'IronworksRustWear';
    this.userData.industrialRivetCount = rivets.length;

    this.buildIndustrialMachinery(m);
    this.buildPortals(m);
  }

  buildIndustrialMachinery(m) {
    const amberHousings = [], amberStrips = [], pipeBrackets = [];
    // A stationary bridge crane makes the hall read as working steelworks.
    // Its girder clears the entire railway; its hanging hoist stays behind
    // the inaccessible service gantry, never over the train or platform.
    const craneZ = -18;
    box(this, m.ironFrame, [23.4, 0.87, 0.86], [2, 6.25, craneZ]);
    for (const y of [5.75, 6.75]) box(this, m.weatheredSteel, [23.8, 0.13, 1.03], [2, y, craneZ]);
    box(this, m.weatheredSteel, [22.8, 0.07, 0.55], [2, 6.87, craneZ + 0.8]);
    for (const y of [7.24, 7.63]) box(this, m.ironFrame, [22.8, 0.048, 0.048], [2, y, craneZ + 1.04]);
    for (let x = -8.7; x <= 12.6; x += 2.6) box(this, m.ironFrame, [0.046, 0.8, 0.046], [x, 7.25, craneZ + 1.04]);
    box(this, m.rust, [1.65, 0.58, 1.36], [9.65, 5.34, craneZ]);
    cylinder(this, m.ironFrame, 0.28, 1.05, [9.65, 5.0, craneZ], [Math.PI / 2, 0, 0]);
    for (const dx of [-0.23, 0.23]) cylinder(this, m.dark, 0.023, 1.28, [9.65 + dx, 4.12, craneZ]);
    box(this, m.ironFrame, [0.67, 0.23, 0.27], [9.65, 3.44, craneZ]);
    for (const x of [-5.6, 3.4, 9.1]) {
      amberHousings.push({ size: [0.34, 0.14, 1.65], position: [x, 5.6, craneZ] });
      amberStrips.push({ size: [0.24, 0.052, 1.46], position: [x, 5.502, craneZ] });
    }
    for (const z of [-32, -8, 16, 36]) {
      // Boilers, heavy bases, a ventilation plenum, and real pipe flanges.
      box(this, m.ironFrame, [3.25, 0.24, 5.3], [11.15, 0.13, z]);
      cylinder(this, m.weatheredSteel, 1.35, 3.95, [11.15, 2.33, z], [0, 0, 0], 16);
      for (const y of [0.49, 3.97]) cylinder(this, m.ironFrame, 1.4, 0.12, [11.15, y, z], [0, 0, 0], 16);
      box(this, m.factoryPanel, [1.18, 1.02, 2.7], [12.04, 4.93, z]);
      for (let i = 0; i < 7; i++) box(this, m.dark, [0.03, 0.055, 2.34], [11.433, 4.61 + i * 0.11, z]);
      cylinder(this, m.weatheredSteel, 0.16, 2.6, [9.65, 1.43, z], [0, 0, Math.PI / 2]);
      cylinder(this, m.rust, 0.22, 0.12, [9.19, 1.43, z], [0, 0, Math.PI / 2]);
      const wheel = new THREE.Mesh(valveGeometry, m.rust);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(9.06, 1.43, z);
      wheel.castShadow = wheel.receiveShadow = true;
      this.add(wheel);
      for (const angle of [0, Math.PI / 2]) {
        const spoke = box(this, m.rust, [0.03, 0.42, 0.03], [9.06, 1.43, z]);
        spoke.rotation.x = angle;
      }
      amberHousings.push({ size: [0.35, 0.16, 3.3], position: [9.3, 5.52, z] });
      amberStrips.push({ size: [0.24, 0.055, 3.07], position: [9.3, 5.413, z] });
      for (const dz of [-1.4, 1.4]) box(this, m.ironFrame, [0.035, 0.8, 0.035], [9.3, 5.98, z + dz]);
    }
    for (const [x, y, radius] of [[12.87, 5.74, 0.24], [13.18, 6.25, 0.16], [13.49, 3.97, 0.085]]) {
      cylinder(this, m.weatheredSteel, radius, 87, [x, y, 0], [Math.PI / 2, 0, 0], 12);
      for (let z = -40; z <= 40; z += 8) pipeBrackets.push({ size: [0.67, 0.1, 0.1], position: [13.44, y - radius - 0.1, z] });
    }
    instances(this, m.ironFrame, pipeBrackets).name = 'IronworksPipeSupports';
    instances(this, m.ironFrame, amberHousings, undefined, false).name = 'IronworksWorklightHousings';
    instances(this, m.amberFixture, amberStrips, undefined, false).name = 'IronworksAmberStrips';
    label(this, 'EISENWERK  /  HALLE 04', 5.2, 0.73, [13.88, 6.75, 1], {
      rotation: [0, -Math.PI / 2, 0], color: '#ddd9c8', background: '#4f5751', fontSize: 86,
    });
    for (const z of [-35, 20]) label(this, 'WERKSANLAGE  ·  NO PUBLIC ACCESS', 2.15, 0.27, [7.705, 1.58, z], {
      rotation: [0, -Math.PI / 2, 0], color: '#ddd2a9', background: '#484f46', fontSize: 62,
    });
  }

  buildPortals(m) {
    for (const z of [-44, 44]) {
      box(this, m.factoryPanel, [9.7, 6.1, 0.3], [-5.18, 2.96, z]);
      box(this, m.factoryPanel, [8.6, 6.1, 0.3], [9.78, 2.96, z]);
      for (const x of [-0.28, 5.32]) {
        box(this, m.ironFrame, [0.3, 5.7, 0.6], [x, 1.8, z]);
        box(this, m.weatheredSteel, [0.37, 5.7, 0.07], [x, 1.8, z - Math.sign(z) * 0.34]);
      }
      box(this, m.ironFrame, [5.9, 0.42, 0.62], [2.52, 4.48, z]);
      box(this, m.factoryPanel, [5.75, 4.1, 0.29], [2.52, 6.72, z]);
      const capped = z < 0 ? this.options.northCap : this.options.southCap;
      if (capped) {
        box(this, m.dark, [5.28, 5.5, 0.15], [2.52, 1.68, z + Math.sign(z) * 4.0]);
        // The stopped 50 m consist clears this buffer by more than 18 m.
        const bufferZ = z + Math.sign(z) * 2.5;
        for (const x of [0.85, 2.29]) {
          member(this, m.ironFrame, [x, -1.05, bufferZ + Math.sign(z) * 0.85], [x, -0.25, bufferZ], 0.15, 0.18);
        }
        box(this, m.weatheredSteel, [2.28, 0.2, 0.18], [1.57, -0.19, bufferZ]);
        for (const x of [0.85, 2.29]) box(this, m.rubber, [0.33, 0.29, 0.17], [x, -0.16, bufferZ - Math.sign(z) * 0.16]);
      }
    }
  }
}
