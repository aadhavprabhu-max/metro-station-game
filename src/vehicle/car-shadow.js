import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

/**
 * Real-time shadow of the moving car without re-rendering the city's shadow map.
 * The street's shared shadow map is cached and refreshed only every ~16 m (texel-aligned, see surface-world.js);
 * a moving car in it would leave a stale shadow behind. Instead, a simplified silhouette of the car (about 4 k
 * triangles) is rendered every frame from the sun's direction into a small texture and projected onto the ground
 * plane under the car, together with a soft contact-occlusion term. The car still receives the city's shadows.
 */
export class CarShadow extends THREE.Mesh {
  constructor(proxyGeometry) {
    const target = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: true, generateMipmaps: false });
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: target.texture }, shadowMatrix: { value: new THREE.Matrix4() }, strength: { value: 0.5 }, aoStrength: { value: 0.45 },
        carInverse: { value: new THREE.Matrix4() }, aoHalf: { value: new THREE.Vector2(1.3, 2.75) }, texel: { value: 1 / 256 } },
      vertexShader: /* glsl */`varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`uniform sampler2D map; uniform mat4 shadowMatrix; uniform float strength; uniform float aoStrength; uniform mat4 carInverse; uniform vec2 aoHalf; uniform float texel; varying vec3 vWorld;
        void main(){
          vec4 sc = shadowMatrix * vec4(vWorld, 1.0); vec2 uv = sc.xy / sc.w; float s = 0.0;
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) s += texture2D(map, uv + vec2(float(i), float(j)) * texel).r;
            s /= 25.0;
          }
          vec3 local = (carInverse * vec4(vWorld, 1.0)).xyz; float d = length(local.xz / aoHalf);
          float ao = (1.0 - smoothstep(0.55, 1.0, d)) * aoStrength;
          float a = 1.0 - (1.0 - s * strength) * (1.0 - ao);
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    super(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), material);
    this.name = 'CarProjectedShadow'; this.renderOrder = 1; this.frustumCulled = false; this.castShadow = false; this.receiveShadow = false;
    this.target = target;
    this.proxyScene = new THREE.Scene();
    this.proxy = new THREE.Mesh(proxyGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.proxy.matrixAutoUpdate = false; this.proxyScene.add(this.proxy);
    this.camera = new THREE.OrthographicCamera(-3.6, 3.6, 3.6, -3.6, 0.1, 40);
    this.centre = new THREE.Vector3(); this.clearColor = new THREE.Color();
  }

  /** Render the silhouette from the sun and position the receiver plane on the ground under the car. */
  update(renderer, car, sunDirection, strength, groundY) {
    car.updateMatrixWorld(true);
    this.proxy.matrix.copy(car.matrixWorld); this.proxy.matrixWorldNeedsUpdate = true;
    this.centre.setFromMatrixPosition(car.matrixWorld); this.centre.y = groundY + 0.6;
    const sun = TMP.copy(sunDirection); if (sun.y < 0.12) sun.y = 0.12; sun.normalize();
    this.camera.position.copy(this.centre).addScaledVector(sun, 18); this.camera.lookAt(this.centre); this.camera.updateMatrixWorld(); this.camera.updateProjectionMatrix();
    const previous = renderer.getRenderTarget(), alpha = renderer.getClearAlpha(); renderer.getClearColor(this.clearColor);
    // The proxy scene has no lights, so this pass never touches the street's shadow map.
    renderer.setRenderTarget(this.target); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(this.proxyScene, this.camera);
    renderer.setRenderTarget(previous); renderer.setClearColor(this.clearColor, alpha);
    const u = this.material.uniforms;
    u.shadowMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
    u.strength.value = strength; u.carInverse.value.copy(car.matrixWorld).invert();
    // Long shadows under a low sun: move the receiver along the shadow so all of it stays on the plane.
    const horizontal = Math.hypot(sun.x, sun.z) || 1, length = Math.min(5, 1.3 * horizontal / sun.y);
    this.position.set(this.centre.x - sun.x / horizontal * length / 2, groundY + 0.003, this.centre.z - sun.z / horizontal * length / 2);
  }

  dispose() { this.target.dispose(); this.geometry.dispose(); this.material.dispose(); this.proxy.geometry.dispose(); this.proxy.material.dispose(); }
}
const TMP = new THREE.Vector3();

/** A simplified, position-only silhouette of the car's exterior (cockpit interior and transparent parts excluded). */
export async function buildShadowProxy(model, targetTriangles = 4000) {
  await MeshoptSimplifier.ready;
  model.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert(), parts = [];
  model.traverse(o => {
    if (!o.isMesh || o.material.transparent) return;
    for (let p = o.parent; p; p = p.parent) if (/^COCKPIT/.test(p.name)) return;
    const g = new THREE.BufferGeometry(), src = o.geometry.attributes.position, pos = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) { pos[i * 3] = src.getX(i); pos[i * 3 + 1] = src.getY(i); pos[i * 3 + 2] = src.getZ(i); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    parts.push((g.index ? g : g).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld)));
  });
  let merged = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g)); parts.forEach(g => g.dispose());
  merged = mergeVertices(merged, 1e-4);
  const index = new Uint32Array(merged.index.array), positions = merged.attributes.position.array;
  let [simplified] = MeshoptSimplifier.simplify(index, positions, 3, Math.min(index.length, targetTriangles * 3), 0.02, []);
  // Many separate shells keep the quality-preserving simplifier above target; the sloppy variant is fine for a shadow.
  if (simplified.length > targetTriangles * 9) [simplified] = MeshoptSimplifier.simplifySloppy(index, positions, 3, null, targetTriangles * 3, 0.01);
  merged.setIndex(new THREE.BufferAttribute(simplified, 1));
  merged.computeBoundingSphere();
  return merged;
}
