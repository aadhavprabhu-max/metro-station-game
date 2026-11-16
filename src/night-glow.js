import * as THREE from 'three';

/**
 * Window light at night. Two shared uniforms drive every lit material on the surface:
 * `night` (0 by day, 1 at night) and `lit` (share of windows switched on).
 * Each window's on/off state and brightness come from a hash of its cell, so every
 * building has its own pattern without extra textures or draw calls.
 */
export const NIGHT_UNIFORMS = { night: { value: 0 }, lit: { value: 0 } };

/** The three window colours: glass towers cool white, brick warm amber, stone golden. */
export const GLOW = Object.freeze({ cool: '#bcdcff', warm: '#ff9a2e', gold: '#ffcc45' });

const HASH = 'float glowHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }';

/**
 * Facade materials: the map's mask texture marks the glazing; cells are windows per facade
 * module, so the hash picks windows, and towers differ because each box has its own UV offset.
 */
export function glowFacade(material, color, { strength = 1.7, bias = 0 } = {}) {
  const { mask, bays, floors } = material.map.userData;
  material.emissive = new THREE.Color(color);
  material.emissiveMap = mask;
  material.emissiveIntensity = strength;
  const uCells = { value: new THREE.Vector2(bays, floors) }, uBias = { value: bias };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uNight: NIGHT_UNIFORMS.night, uLit: NIGHT_UNIFORMS.lit, uCells, uBias });
    shader.fragmentShader = `uniform float uNight;\nuniform float uLit;\nuniform vec2 uCells;\nuniform float uBias;\n${HASH}\n`
      + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      {
        vec2 cell = floor(vEmissiveMapUv * uCells);
        float on = step(glowHash(cell), uLit + uBias);
        float level = 0.45 + 0.85 * glowHash(cell + 17.31);
        totalEmissiveRadiance *= texture2D(emissiveMap, vEmissiveMapUv).r * on * level * uNight;
      }`);
  };
  material.customProgramCacheKey = () => 'facade-glow';
  return material;
}

/**
 * Old-town window panes (instanced): the glass is the bluish part of the window texture,
 * and each instance (one window) is switched on or off by a hash of its position.
 */
export function glowWindows(material, color, strength = 1.5) {
  material.emissive = new THREE.Color(color);
  material.emissiveIntensity = strength;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uNight: NIGHT_UNIFORMS.night, uLit: NIGHT_UNIFORMS.lit });
    shader.vertexShader = 'varying float vGlowSeed;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vGlowSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      #else
        vGlowSeed = 0.3;
      #endif`);
    shader.fragmentShader = 'uniform float uNight;\nuniform float uLit;\nvarying float vGlowSeed;\n'
      + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      {
        float glass = clamp((diffuseColor.b - diffuseColor.r) * 14.0, 0.0, 1.0);
        float on = step(vGlowSeed, uLit);
        totalEmissiveRadiance *= glass * on * uNight * (0.6 + 0.8 * fract(vGlowSeed * 7.13));
      }`);
  };
  material.customProgramCacheKey = () => 'window-glow';
  return material;
}
