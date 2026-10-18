import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const forwardFor = yaw => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
const vector = value => value.isVector3 ? value.clone() : new THREE.Vector3(value.x, value.y, value.z);

/** Three.js' generic finite-difference tangent would kink at the straight joins. */
class AnalyticRailCurve extends THREE.CubicBezierCurve3 {
  getTangent(t, target = new THREE.Vector3()) {
    const u = 1 - t;
    return target.set(
      3 * u * u * (this.v1.x - this.v0.x) + 6 * u * t * (this.v2.x - this.v1.x) + 3 * t * t * (this.v3.x - this.v2.x),
      3 * u * u * (this.v1.y - this.v0.y) + 6 * u * t * (this.v2.y - this.v1.y) + 3 * t * t * (this.v3.y - this.v2.y),
      3 * u * u * (this.v1.z - this.v0.z) + 6 * u * t * (this.v2.z - this.v1.z) + 3 * t * t * (this.v3.z - this.v2.z),
    ).normalize();
  }
}

/** An arc-length railway made from exact lines and analytic cubic curves. */
export class RailPath {
  constructor(curves) {
    this.curves = curves;
    this.segments = [];
    this.length = 0;
    this.hasCurves = false;
    this.controlPoints = [];
    for (const curve of curves) {
      curve.arcLengthDivisions = 512;
      const length = curve.getLength();
      if (!(length > 0)) continue;
      const curved = Boolean(curve.isCubicBezierCurve3);
      this.hasCurves ||= curved;
      this.segments.push({ curve, startDistance: this.length, length, endDistance: this.length + length, curved });
      this.length += length;
      const points = curved ? [curve.v0, curve.v1, curve.v2, curve.v3] : [curve.v1, curve.v2];
      this.controlPoints.push({ type: curved ? 'cubic' : 'line', points: points.map(point => point.toArray()) });
    }
    if (!this.segments.length) throw new Error('A railway path must contain a positive-length segment.');
  }

  sample(distance, extrapolate = false) {
    const along = THREE.MathUtils.clamp(distance, 0, this.length);
    const segment = this.segments.find(item => item.endDistance >= along) ?? this.segments.at(-1);
    const fraction = THREE.MathUtils.clamp((along - segment.startDistance) / segment.length, 0, 1);
    const position = segment.curve.getPointAt(fraction);
    const tangent = segment.curve.getTangentAt(fraction).normalize();
    if (extrapolate && distance !== along) position.addScaledVector(tangent, distance - along);
    return { position, tangent, yaw: Math.atan2(-tangent.x, -tangent.z), up: UP };
  }
}

/** Keep each platform and its complete train on a straight 65 m approach. */
export function createStationPath(from, to, { approach = 65 } = {}) {
  const start = vector(from.position), end = vector(to.position);
  const forward = forwardFor(from.yaw ?? 0), arrival = forwardFor(to.yaw ?? 0);
  const chord = end.clone().sub(start);
  const projected = chord.dot(forward);
  // Existing straight lines keep their exact metric distance and heading.
  if (forward.dot(arrival) > 1 - 1e-10 && projected > 0
    && chord.clone().addScaledVector(forward, -projected).lengthSq() < 1e-12) {
    return new RailPath([new THREE.LineCurve3(start, end)]);
  }
  const exit = start.clone().addScaledVector(forward, approach);
  const entrance = end.clone().addScaledVector(arrival, -approach);
  const middle = entrance.clone().sub(exit);
  const startProjection = middle.dot(forward), endProjection = middle.dot(arrival);
  if (startProjection <= 0 || endProjection <= 0) throw new Error('Railway control points must provide forward platform approaches.');
  // The quarter-circle factor produces broad, tangent-continuous railway bends.
  const factor = 4 * (Math.sqrt(2) - 1) / 3;
  // An unequal pair of approaches needs a circular corner and a straight,
  // rather than a tight elliptical bend. Both use the same measured path.
  if (Math.abs(forward.dot(arrival)) < 1e-9) {
    const radius = Math.min(startProjection, endProjection);
    const cornerStart = exit.clone().addScaledVector(forward, startProjection - radius);
    const cornerEnd = entrance.clone().addScaledVector(arrival, -(endProjection - radius));
    return new RailPath([
      new THREE.LineCurve3(start, cornerStart),
      new AnalyticRailCurve(cornerStart, cornerStart.clone().addScaledVector(forward, radius * factor),
        cornerEnd.clone().addScaledVector(arrival, -radius * factor), cornerEnd),
      new THREE.LineCurve3(cornerEnd, end),
    ]);
  }
  const control1 = exit.clone().addScaledVector(forward, startProjection * factor);
  const control2 = entrance.clone().addScaledVector(arrival, -endProjection * factor);
  return new RailPath([
    new THREE.LineCurve3(start, exit),
    new AnalyticRailCurve(exit, control1, control2, entrance),
    new THREE.LineCurve3(entrance, end),
  ]);
}
