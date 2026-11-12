import * as THREE from 'three';

export interface SunSettings {
  /** Compass-style direction the light comes from, in degrees, in plan space. 0 = from the top of the plan, 90 = from the right. */
  azimuthDeg: number;
  /** Height of the sun above the horizon, in degrees. */
  elevationDeg: number;
  intensity: number;
  color: number;
}

/**
 * Adds a soft fill light and a sun that casts shadows.
 * `center` and `radius` describe the area the shadows have to cover.
 */
export function addLighting(
  scene: THREE.Scene,
  sun: SunSettings,
  center: THREE.Vector3,
  radius: number,
): THREE.DirectionalLight {
  // Fill light: stands in for daylight bouncing around the room. Real
  // bounced light is expensive to compute, so games fake it like this.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe0d8cc, 2.2));

  // The sun: a directional light has parallel rays, like real sunlight.
  const light = new THREE.DirectionalLight(sun.color, sun.intensity);
  const az = THREE.MathUtils.degToRad(sun.azimuthDeg);
  const el = THREE.MathUtils.degToRad(sun.elevationDeg);
  const towardsSun = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  );
  light.position.copy(center).addScaledVector(towardsSun, radius * 3);
  light.target.position.copy(center);

  // Shadows are drawn from the sun's point of view into a texture (the
  // "shadow map"). These settings size that view to fit the home.
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  const cam = light.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 0.1;
  cam.far = radius * 6;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.03;

  scene.add(light);
  scene.add(light.target);
  return light;
}
