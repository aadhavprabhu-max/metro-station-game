/**
 * Soft edge for the street's cached shadow map.
 * The shadow map covers ±90 m around a centre that moves in ~16 m texel-aligned steps (surface-world.js). Without a
 * fade, distant shadows end abruptly at the map's border and that border jumps whenever the centre moves. Here the
 * directional shadow lookup of street materials is blended smoothly to "unshadowed" with distance from the *viewer*
 * (measured in the shadow map's own plane, 64–86 % of the half-width ≈ 58–77 m), not from the map's centre: the viewer
 * moves continuously, so the fade glides with them instead of jumping 16 m at each recentre (a band anchored to the
 * map's centre shifted by most of its width in one frame, which still looked like a pop). The viewer is at most ~8 m
 * (per axis) from the centre, so the faded band always ends inside the map; as a safety net the map's last 5 % also
 * fades. Shadows within ~58 m of the viewer keep full quality.
 * Applied per material through onBeforeCompile; only materials used exclusively by the street (and the car) are
 * changed, so the underground stations, which share the key light, are untouched.
 */
import * as THREE from 'three';

export const SHADOW_EDGE_FADE = Object.freeze({ start: 0.64, end: 0.86, mapStart: 0.95, mapEnd: 1.0 });
/** The viewer's position in shadow-map coordinates (0–1); updated every frame by the street (surface-world.js). */
export const shadowEdgeFadeOrigin = { value: new THREE.Vector2(0.5, 0.5) };
const LOOKUP = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';
const FUNCTION = /* glsl */`
uniform vec2 shadowEdgeFadeOrigin;
float shadowEdgeFade( float shadow, vec4 shadowCoord ) {
  vec2 c = shadowCoord.xy / shadowCoord.w;
  vec2 v = abs( c - shadowEdgeFadeOrigin ), m = abs( c - 0.5 );
  float fromViewer = smoothstep( ${SHADOW_EDGE_FADE.start.toFixed(3)}, ${SHADOW_EDGE_FADE.end.toFixed(3)}, 2.0 * max( v.x, v.y ) );
  float atBorder = smoothstep( ${SHADOW_EDGE_FADE.mapStart.toFixed(3)}, ${SHADOW_EDGE_FADE.mapEnd.toFixed(3)}, 2.0 * max( m.x, m.y ) );
  return mix( shadow, 1.0, max( fromViewer, atBorder ) );
}
`;
const patched = new WeakSet();

/** True when this three.js build contains the expected lookup (checked once; nothing is patched otherwise). */
export const shadowEdgeFadeSupported = THREE.ShaderChunk.lights_fragment_begin.includes(LOOKUP);

function patch(material) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) return;
    shader.uniforms.shadowEdgeFadeOrigin = shadowEdgeFadeOrigin;
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace(LOOKUP, `shadowEdgeFade( ${LOOKUP}, vDirectionalShadowCoord[ i ] )`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lights).replace('void main() {', FUNCTION + 'void main() {');
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (previousKey ? previousKey() : '') + '|shadow-edge-fade';
  material.needsUpdate = true;
  patched.add(material);
}

/**
 * Fade shadow edges on every lit, shadow-receiving material below `root`, except those in `shared`
 * (materials also used outside the street). Returns counts for diagnostics.
 */
export function fadeShadowEdges(root, shared = new Set()) {
  const result = { patched: 0, skippedShared: 0 };
  if (!shadowEdgeFadeSupported) return result;
  root.traverse(object => {
    if (!object.isMesh || !object.receiveShadow) return;
    for (const material of [object.material].flat()) {
      if (!material || patched.has(material) || material.isShaderMaterial || material.isMeshBasicMaterial) continue;
      if (shared.has(material)) { result.skippedShared++; continue; }
      patch(material); result.patched++;
    }
  });
  return result;
}

/** Materials used anywhere in `scene` outside `exclude` (the street subtree). */
export function materialsOutside(scene, exclude) {
  const set = new Set();
  const visit = object => { if (object === exclude) return; if (object.material) for (const m of [object.material].flat()) set.add(m); for (const child of object.children) visit(child); };
  visit(scene);
  return set;
}
