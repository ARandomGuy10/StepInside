import * as THREE from 'three';
import type { Sun } from '../core/scene';

/**
 * Adds a soft fill light and a sun that casts shadows.
 * `center` and `radius` describe the area the shadows have to cover.
 */
export function addLighting(
  scene: THREE.Scene,
  sun: Sun,
  northDeg: number,
  center: THREE.Vector3,
  radius: number,
): THREE.DirectionalLight {
  // Fill light: stands in for daylight bouncing around the room. Real
  // bounced light is expensive to compute, so games fake it like this.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe0d8cc, 1.9));
  // Two weak side lights with no shadows. They shade walls that face
  // different ways slightly differently, so corners are easy to read.
  for (const [x, z, strength] of [[0.6, 0.8, 0.7], [-0.8, -0.3, 0.35]] as const) {
    const side = new THREE.DirectionalLight(0xffffff, strength);
    side.position.set(x, 0.35, z);
    scene.add(side);
  }

  // The sun: a directional light has parallel rays, like real sunlight.
  const light = new THREE.DirectionalLight(sun.color, sun.intensity);
  // The sun's compass bearing, turned into an angle on the plan:
  // 0 is "from the top of the page" and it grows clockwise.
  const az = THREE.MathUtils.degToRad(sun.azimuthDeg + northDeg);
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
  light.shadow.mapSize.set(4096, 4096);
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
