/**
 * World-space variation for road surfaces, added to the standard material through onBeforeCompile:
 * - asphalt: low-frequency tone and roughness variation, so the 8 m texture never visibly repeats;
 * - road paint: worn, broken edges on top faces (the binder shows through), never on the sides.
 * Works for ordinary and instanced meshes. Costs a few ALU ops per pixel; no extra textures.
 */
const NOISE = /* glsl */`
  varying vec3 vSurfWorld; varying float vSurfUp;
  float surfHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float surfNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(surfHash(i), surfHash(i + vec2(1.0, 0.0)), u.x), mix(surfHash(i + vec2(0.0, 1.0)), surfHash(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
const VERTEX_DECL = 'varying vec3 vSurfWorld; varying float vSurfUp;\n';
const VERTEX_BODY = /* glsl */`
  vec4 surfW = vec4(transformed, 1.0); vec3 surfN = objectNormal;
  #ifdef USE_INSTANCING
    surfW = instanceMatrix * surfW; surfN = mat3(instanceMatrix) * surfN;
  #endif
  vSurfWorld = (modelMatrix * surfW).xyz; vSurfUp = normalize(mat3(modelMatrix) * surfN).y;
`;

function patch(material, key, fragmentAfterMap, fragmentAfterRoughness = '') {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERTEX_BODY);
    shader.fragmentShader = NOISE + shader.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + fragmentAfterMap)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + fragmentAfterRoughness);
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (previousKey ? previousKey() : '') + key;
  material.needsUpdate = true;
  return material;
}

export function addAsphaltVariation(material) {
  return patch(material, '|asphalt-variation', /* glsl */`
    float surfA = surfNoise(vSurfWorld.xz * 0.09), surfB = surfNoise(vSurfWorld.xz * 0.31 + 17.0), surfC = surfNoise(vSurfWorld.xz * 1.7 + 5.0);
    diffuseColor.rgb *= 1.0 + (surfA - 0.5) * 0.18 + (surfB - 0.5) * 0.09 + (surfC - 0.5) * 0.05;
  `, /* glsl */`
    roughnessFactor = clamp(roughnessFactor + (surfNoise(vSurfWorld.xz * 0.09) - 0.5) * 0.06, 0.8, 1.0);
  `);
}

export function addPaintWear(material) {
  return patch(material, '|paint-wear', /* glsl */`
    float wearA = surfNoise(vSurfWorld.xz * 3.1) * 0.62 + surfNoise(vSurfWorld.xz * 13.0 + 9.0) * 0.38;
    float wear = smoothstep(0.58, 0.86, wearA) * step(0.5, vSurfUp);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.047, 0.05), wear * 0.6);
    diffuseColor.rgb *= 0.93 + 0.07 * surfNoise(vSurfWorld.xz * 0.5);
  `, /* glsl */`
    roughnessFactor = mix(roughnessFactor, 0.9, step(0.5, vSurfUp) * 0.5);
  `);
}
