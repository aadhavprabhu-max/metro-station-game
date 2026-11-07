import * as THREE from 'three';
import { Train, TrainCar } from './train.js';
import { box, label } from './geometry.js';
import { buildExpressCab } from './u10-train-cab.js';

class ExpressCar extends TrainCar {
  buildCab(m, end) { buildExpressCab(this, m, end); }
  buildRoof(m) {
    // Continuous low fairings replace the exposed C-series roof boxes.
    const shape = new THREE.Shape(); shape.moveTo(-0.95, 3.05); shape.quadraticCurveTo(-0.95, 3.32, -0.6, 3.34);
    shape.lineTo(0.6, 3.34); shape.quadraticCurveTo(0.95, 3.32, 0.95, 3.05); shape.closePath();
    const fairing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 10.4, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.1, bevelSegments: 3 }), m.trainSilver);
    fairing.position.z = -5.2; fairing.castShadow = true; this.add(fairing);
    for (const z of [-3.8, 3.8]) for (let i = 0; i < 10; i++) box(this, m.cabCharcoal, [1.03, 0.012, 0.035], [0, 3.383, z - 0.6 + i * 0.13]);
    this.userData.vehicleDesign = { ...this.userData.vehicleDesign, family: 'Aurealis E10 Airport Express', aerodynamic: true };
  }
  buildInterior(m, leading, trailing) {
    super.buildInterior(m, leading, trailing);
    // Luggage fittings sit outside the existing central aisle and door vestibules.
    for (const side of [-1, 1]) {
      box(this, m.trainSilver, [0.35, 0.055, 1.1], [side * 1.12, 2.16, 6.65]);
      label(this, 'AIRPORT EXPRESS · LUGGAGE', 1.25, 0.11, [side * 1.3, 2.36, 2.58], { background: '#123b75', rotation: [0, side * Math.PI / 2, 0], fontSize: 80 });
    }
  }
}

/** Geometry differs, service and boarding contracts remain the production Train contracts. */
export class ExpressTrain extends Train {
  constructor(base) {
    const materials = { ...base };
    for (const [key, color] of Object.entries({ whitePaint: '#eef0ee', trainSilver: '#c9d0d7', trainTeal: '#123b75', trainAccent: '#123b75', cabCharcoal: '#162b41' })) {
      materials[key] = base[key].clone(); materials[key].color.set(color);
    }
    materials.cabGlass = base.cabGlass.clone(); materials.cabGlass.opacity = 0.6;
    super(materials, { lineId: 'U10', platformSide: -1, carType: ExpressCar });
    this.name = 'U10-ICEInspiredAirportExpress';
    this.userData.design = { family: 'E10', consistLength: 56, width: 2.9, gauge: 1.435 };
    this.inverseQuaternion = new THREE.Quaternion();
  }
  placeCarsOnRoute(route, distance) {
    this.updateWorldMatrix(true, false);
    for (const car of this.cars) {
      const carDistance = distance - car.userData.nominalRouteOffset;
      const pose = route.sampleExtended(carDistance);
      car.position.copy(this.worldToLocal(pose.position));
      this.getWorldQuaternion(this.inverseQuaternion).invert();
      car.quaternion.copy(this.inverseQuaternion).multiply(pose.quaternion);
      car.userData.routeDistance = carDistance;
      car.updateWorldMatrix(false, false);
      for (const bogie of car.bogies) {
        const bd = carDistance - bogie.userData.localZ, bp = route.sampleExtended(bd);
        bogie.position.copy(car.worldToLocal(bp.position));
        car.getWorldQuaternion(this.inverseQuaternion).invert(); bogie.quaternion.copy(this.inverseQuaternion).multiply(bp.quaternion);
        bogie.userData.routeDistance = bd;
      }
    }
    this.updateWorldMatrix(false, true);
    for (const { group, fromIndex, toIndex } of this.gangways) {
      const a = this.cars[fromIndex].localToWorld(new THREE.Vector3(0, 0, 7.925));
      const b = this.cars[toIndex].localToWorld(new THREE.Vector3(0, 0, -7.925));
      this.worldToLocal(a); this.worldToLocal(b); group.position.copy(a).add(b).multiplyScalar(0.5);
      const direction = b.clone().sub(a); group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize()); group.scale.z = direction.length() / 0.87;
    }
  }
}
