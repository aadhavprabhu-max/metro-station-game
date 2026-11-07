import * as THREE from 'three';
import { createStationPath } from './expansion-path.js';

const UP = new THREE.Vector3(0, 1, 0);
/** Arc-length 3D railway. Flat 65 m station approaches and 200 m vertical easements. */
export function createExpressPath(from, to) {
  const horizontal = createStationPath({ ...from, position: { ...from.position, y: 0 } },
    { ...to, position: { ...to.position, y: 0 } });
  const rise = to.position.y - from.position.y;
  const length = horizontal.length, approach = 65, ease = 200;
  const gradient = rise / (length - 2 * approach - ease);
  const profile = s => {
    const x = THREE.MathUtils.clamp(s - approach, 0, length - 2 * approach);
    const run = length - 2 * approach;
    if (!rise) return { y: from.position.y, grade: 0 };
    if (x < ease) return { y: from.position.y + gradient * x * x / (2 * ease), grade: gradient * x / ease };
    if (x > run - ease) {
      const tail = run - x;
      return { y: to.position.y - gradient * tail * tail / (2 * ease), grade: gradient * tail / ease };
    }
    return { y: from.position.y + gradient * (x - ease / 2), grade: gradient };
  };
  const samples = Math.ceil(length / 2), table = [{ s: 0, d: 0 }];
  let distance = 0, previous = new THREE.Vector3();
  const point = s => { const p = horizontal.sample(s).position; p.y = profile(s).y; return p; };
  previous.copy(point(0));
  for (let i = 1; i <= samples; i++) {
    const s = length * i / samples, p = point(s);
    distance += previous.distanceTo(p); table.push({ s, d: distance }); previous.copy(p);
  }
  return {
    length: distance, hasCurves: true, hasGrades: Boolean(rise), maximumGrade: Math.abs(gradient),
    controlPoints: horizontal.controlPoints,
    sample(d, extrapolate = false) {
      const clamped = THREE.MathUtils.clamp(d, 0, distance);
      let low = 0, high = table.length - 1;
      while (high - low > 1) { const mid = (low + high) >> 1; if (table[mid].d < clamped) low = mid; else high = mid; }
      const a = table[low], b = table[high];
      const s = THREE.MathUtils.lerp(a.s, b.s, (clamped - a.d) / (b.d - a.d));
      const pose = horizontal.sample(s), { y, grade } = profile(s);
      pose.position.y = y;
      pose.tangent.y = grade; pose.tangent.normalize();
      const right = new THREE.Vector3().crossVectors(pose.tangent, UP).normalize();
      const up = new THREE.Vector3().crossVectors(right, pose.tangent).normalize();
      const frame = new THREE.Matrix4().makeBasis(right, up, pose.tangent.clone().negate());
      pose.quaternion = new THREE.Quaternion().setFromRotationMatrix(frame);
      pose.pitch = Math.atan(grade); pose.up = up; pose.grade = grade;
      if (extrapolate && d !== clamped) pose.position.addScaledVector(pose.tangent, d - clamped);
      return pose;
    },
  };
}
