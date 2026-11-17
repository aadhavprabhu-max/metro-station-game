import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Rig for the GT3 R model. The supplied model's wheel, disc, caliper and steering-wheel nodes all pivot at the
 * car origin, not at their hubs, so pivots are rebuilt here from the measured geometry:
 *   knuckle (hub centre; steers; moves with the suspension)  →  spin (rotates about the axle)
 *   WHEEL_* (tyre and rims) and DISC_* spin; SUSP_* (uprights, calipers) steer and move but do not spin.
 * The steering wheel turns about its column, found from its own geometry (principal axes).
 * Static parts are merged by material to cut draw calls; visual detail is untouched.
 */
const WHEEL_IDS = ['LF', 'RF', 'LR', 'RR'];

export class VehicleModel extends THREE.Group {
  constructor(gltfScene, params) {
    super(); this.name = 'PorscheGT3R'; this.params = params;
    const scene = gltfScene; scene.updateMatrixWorld(true);
    this.add(scene); this.updateMatrixWorld(true);
    const find = re => { let found = null; scene.traverse(o => { if (!found && re.test(o.name)) found = o; }); return found; };
    this.wheelRigs = WHEEL_IDS.map(id => {
      const wheel = find(new RegExp(`^WHEEL_${id}(_|$)`)), disc = find(new RegExp(`^DISC_${id}(_|$)`)), susp = find(new RegExp(`^SUSP_${id}(_|$)`));
      const tyre = find(new RegExp(`^GEO_TIRE_${id}(_|$)`));
      if (!wheel || !tyre) throw new Error(`GT3 R model: wheel ${id} not found`);
      const box = new THREE.Box3().setFromObject(tyre), hub = box.getCenter(new THREE.Vector3());
      this.worldToLocal(hub);
      const knuckle = new THREE.Group(); knuckle.name = `Knuckle_${id}`; knuckle.position.copy(hub); this.add(knuckle);
      const spin = new THREE.Group(); spin.name = `Spin_${id}`; knuckle.add(spin); knuckle.updateMatrixWorld(true);
      spin.attach(wheel); if (disc) spin.attach(disc); if (susp) knuckle.attach(susp);
      const blur = [], sharp = [];
      wheel.traverse(o => { if (/RIM_BLUR|RIM_STATIC/.test(o.name) && o !== wheel) blur.push(o); else if (/^RIM_/.test(o.name)) sharp.push(o); });
      // RIM_BLUR groups hold the motion-blurred rim; keep only the top-level ones for toggling.
      const blurRoots = blur.filter(o => !blur.includes(o.parent)), sharpRoots = sharp.filter(o => !sharp.includes(o.parent));
      for (const o of blurRoots) o.visible = false;
      return { id, knuckle, spin, hub: hub.clone(), blur: blurRoots, sharp: sharpRoots, blurOn: false, size: box.getSize(new THREE.Vector3()) };
    });
    // Steering wheel: pivot on its centroid, rotating about the column (least-variance axis of its vertices).
    const steer = find(/^STEER_HR/);
    if (steer) {
      const { centroid, axis } = principalAxis(steer, this);
      if (axis.z > 0) axis.negate(); // points from the wheel towards the driver
      const pivot = new THREE.Group(); pivot.name = 'SteeringColumn'; pivot.position.copy(centroid);
      pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis); this.add(pivot); pivot.updateMatrixWorld(true);
      const turn = new THREE.Group(); pivot.add(turn); turn.updateMatrixWorld(true); turn.attach(steer);
      this.steering = { pivot, turn, centroid, axis };
    }
    // Cockpit: full detail for the cockpit camera, simplified LOD (if present) from outside.
    this.cockpit = find(/^COCKPIT_HR/); this.cockpitLod = find(/^COCKPIT_LOD1/);
    this.inside = null; this.setInterior(false);
    // Brake and tail lights.
    this.lightMaterials = [];
    scene.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) if (/Emissive_Light_Rear|Glass_Emissive_Rear|AUX_LIGHT/i.test(m.name) && !this.lightMaterials.includes(m)) this.lightMaterials.push(m); });
    for (const m of this.lightMaterials) { m.userData.baseEmissive = m.emissiveIntensity ?? 1; if (!m.emissiveMap && m.map) { m.emissiveMap = m.map; m.emissive?.set('#ffffff'); } }
    this.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Merge static, opaque parts by material (excluding everything that moves or toggles).
    const dynamic = new Set([...this.wheelRigs.map(r => r.knuckle), this.steering?.pivot, this.cockpit, this.cockpitLod].filter(Boolean));
    this.drawCalls = { before: countMeshes(this) };
    mergeStatic(scene, dynamic);
    if (this.cockpit) mergeStatic(this.cockpit, new Set());
    if (this.cockpitLod) mergeStatic(this.cockpitLod, new Set());
    for (const r of this.wheelRigs) mergeStatic(r.spin, new Set(r.blur));
    this.drawCalls.after = countMeshes(this);
    this.bounds = new THREE.Box3().setFromObject(this);
  }

  /** Full cockpit inside; the light LOD outside (the cabin is only seen through the glass). */
  setInterior(inside) {
    if (this.inside === inside) return;
    if (this.cockpit && this.cockpitLod) { this.cockpit.visible = inside; this.cockpitLod.visible = !inside; }
    this.inside = inside;
  }

  /**
   * The simplified cockpit is used only where the A/B renders showed no visible difference (chase-camera distance
   * and beyond); in the cockpit view and within 4 m the full original cockpit is shown.
   */
  updateLod(cameraPosition, cockpitView) {
    this.setInterior(cockpitView || this.position.distanceToSquared(cameraPosition) < 16);
  }

  /** Apply the physics state: suspension travel, steering, wheel spin, steering wheel, lights. */
  sync(physics, { braking = false, night = 0 } = {}) {
    const staticLength = this.params.suspension.staticLength;
    physics.wheels.forEach((w, i) => {
      const rig = this.wheelRigs[i];
      rig.knuckle.position.y = rig.hub.y + (staticLength - w.length);
      rig.knuckle.rotation.y = w.steer;
      rig.spin.rotation.x = w.spin;
      const blur = Math.abs(w.omega) > 28;
      if (blur !== rig.blurOn) { rig.blurOn = blur; for (const o of rig.blur) o.visible = blur; for (const o of rig.sharp) o.visible = !blur; }
    });
    if (this.steering) {
      const front = physics.wheels.filter(w => w.front), angle = front.reduce((s, w) => s + w.steer, 0) / front.length;
      this.steering.turn.rotation.z = angle * this.params.steering.wheelRatio;
    }
    const level = (braking ? 3.2 : 0.9) + night * 0.8;
    for (const m of this.lightMaterials) if (m.emissiveIntensity !== level) m.emissiveIntensity = level;
  }
}

function countMeshes(root) { let n = 0; root.traverse(o => { if (o.isMesh && o.visible !== false) n++; }); return n; }

/** Geometry with plain Float32 attributes (meshopt-quantized data is integer and cannot be transformed in place). */
function toFloat(geometry) {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'tangent', 'color'].includes(name)) continue;
    const size = attr.itemSize, out = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  if (geometry.index) g.setIndex(geometry.index.clone());
  return g;
}

/** Merge opaque meshes under `root` by material + attribute layout; skip nodes in `skip` (and their subtrees). */
function mergeStatic(root, skip) {
  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert(), groups = new Map();
  const visit = node => {
    if (node !== root && skip.has(node)) return;
    if (node.isMesh && !node.isSkinnedMesh && !Array.isArray(node.material) && !node.material.transparent && node.visible !== false) {
      const key = `${node.material.uuid}|${Object.keys(node.geometry.attributes).filter(n => ['position', 'normal', 'uv', 'uv1', 'tangent', 'color'].includes(n)).sort().join(',')}`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node);
    }
    for (const child of [...node.children]) visit(child);
  };
  visit(root);
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => toFloat(mesh.geometry).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
    const merged = mergeGeometries(geometries.map(g => g.index ? g : g), false);
    geometries.forEach(g => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, meshes[0].material); mesh.name = `GT3R-${meshes[0].material.name || 'part'}`;
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
    for (const m of meshes) m.removeFromParent();
  }
}

/** Centroid and least-variance axis (in `space` coordinates) of all vertices below `object`. */
function principalAxis(object, space) {
  const points = [], v = new THREE.Vector3(), inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  object.updateWorldMatrix(true, true);
  object.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 4000))) { v.fromBufferAttribute(p, i).applyMatrix4(m); points.push(v.clone()); } });
  const c = points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  const { values, vectors } = jacobi(C), k = values.indexOf(Math.min(...values));
  return { centroid: c, axis: new THREE.Vector3(vectors[0][k], vectors[1][k], vectors[2][k]).normalize() };
}

function jacobi(A) {
  const a = A.map(r => [...r]), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let p = 0, q = 1; for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(phi), s = Math.sin(phi);
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: V };
}
