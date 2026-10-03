// =============================================================================
// localSun.js — one extra factor on the Sun's light for objects near the
// player (ship, astronaut, rocks, landers).
//
// The scene has a single sunlight. The terrain must stay lit on its day side
// even when you watch it from the night side, but the ship parked on the
// night side must not be lit by a Sun that is below its horizon. This shared
// uniform dims direct sunlight on the local objects only.
// =============================================================================
import * as THREE from 'three';

export const LOCAL_SUN = { value: 1 };

const PATCHED = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uLocalSun;',
);

export function applyLocalSun(material) {
  if (material.userData.localSun) return material;
  material.userData.localSun = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.uLocalSun = LOCAL_SUN;
    shader.fragmentShader = `uniform float uLocalSun;\n${shader.fragmentShader.replace('#include <lights_fragment_begin>', PATCHED)}`;
  };
  material.customProgramCacheKey = () => `localsun|${prevKey ? prevKey() : ''}`;
  material.needsUpdate = true;
  return material;
}

/** Patch every lit material under an object. */
export function applyLocalSunTree(root) {
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial) applyLocalSun(m);
  });
}
