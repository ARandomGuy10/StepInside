import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { Light, Scene } from '../core/scene';
import { skyTexture } from './textures';

/**
 * Lights the home: soft light from all around, a sun that casts shadows
 * through the windows, and the lamps listed in the scene file.
 * `center` and `radius` describe the area the sun's shadows must cover.
 */
/** Lets the app move the sun, for a time of day. */
export interface Daylight {
  /** Puts the sun at a compass bearing and height (degrees), and sets the light and sky to match. */
  setSun(azimuthDeg: number, elevationDeg: number): void;
}

export function addLighting(
  renderer: THREE.WebGLRenderer,
  world: THREE.Scene,
  scene: Scene,
  center: THREE.Vector3,
  radius: number,
): Daylight {
  // An environment map is a picture of the surroundings that every surface
  // reflects a little. It gives metal, glass and polished wood something
  // to reflect, and adds gentle light from all directions.
  // It starts as a simple made-up room, then switches to a real panorama
  // photographed outdoors (an "HDRI": a 360° photo that keeps the true
  // brightness of the sky). Glass, tiles and metal then reflect a real sky
  // and greenery, and the light from all around has real colour.
  const pmrem = new THREE.PMREMGenerator(renderer);
  world.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  let envStrength = 0.3;
  let fillStrength = 0.73;
  let lastSun: [number, number] = [scene.sun.azimuthDeg, scene.sun.elevationDeg];
  new HDRLoader().load(
    `${import.meta.env.BASE_URL}env/garden.hdr`,
    (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const old = world.environment;
      world.environment = pmrem.fromEquirectangular(hdr).texture;
      old?.dispose();
      hdr.dispose();
      pmrem.dispose();
      // The panorama brings its own soft light, so the fake fill steps back.
      envStrength = 0.55;
      fillStrength = 0.55;
      setSun(...lastSun);
    },
    undefined,
    () => pmrem.dispose(),
  );

  // Fill light: stands in for daylight bouncing around the rooms. Real
  // bounced light is expensive to compute, so real-time 3D fakes it.
  const fill = new THREE.HemisphereLight(0xfff6ea, 0xcbbfae, 0.85);
  world.add(fill);
  // Two weak side lights with no shadows. They shade walls that face
  // different ways slightly differently, so corners are easy to read.
  const sides: THREE.DirectionalLight[] = [];
  for (const [x, z, strength] of [[0.6, 0.8, 0.35], [-0.8, -0.3, 0.18]] as const) {
    const side = new THREE.DirectionalLight(0xffffff, strength);
    side.position.set(x, 0.35, z);
    side.userData.strength = strength;
    sides.push(side);
    world.add(side);
  }

  // The sun: a directional light has parallel rays, like real sunlight.
  const sun = new THREE.DirectionalLight(scene.sun.color, scene.sun.intensity);

  // Shadows are drawn from the sun's point of view into a texture (the
  // "shadow map"). These settings size that view to fit the home.
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 0.1;
  cam.far = radius * 6;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3; // blurs the shadow edge a little
  world.add(sun);
  world.add(sun.target);

  const noon = new THREE.Color(scene.sun.color);
  const lowSun = new THREE.Color('#ff9a52');
  const dayFill = new THREE.Color(0xfff6ea);
  const duskFill = new THREE.Color('#e7b3a0');
  const nightFill = new THREE.Color('#5d6a8c');
  let skyKey = '';

  function setSun(azimuthDeg: number, elevationDeg: number): void {
    lastSun = [azimuthDeg, elevationDeg];
    // The sun's compass bearing, turned into an angle on the plan:
    // 0 is "from the top of the page" and it grows clockwise.
    const az = THREE.MathUtils.degToRad(azimuthDeg + scene.northDeg);
    // Below the horizon the light is off, so its exact height does not matter.
    const el = THREE.MathUtils.degToRad(Math.max(2, elevationDeg));
    const towardsSun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    sun.position.copy(center).addScaledVector(towardsSun, radius * 3);
    sun.target.position.copy(center);

    // 0 at night, 1 in full day; the sun warms and dims as it gets low.
    const day = THREE.MathUtils.smoothstep(elevationDeg, -6, 12);
    const warm = 1 - THREE.MathUtils.smoothstep(elevationDeg, 2, 25);
    sun.color.copy(noon).lerp(lowSun, warm);
    sun.intensity = scene.sun.intensity * THREE.MathUtils.smoothstep(elevationDeg, -1, 10);
    sun.castShadow = elevationDeg > -1;
    fill.intensity = 0.12 + fillStrength * day;
    fill.color.copy(nightFill).lerp(duskFill, THREE.MathUtils.smoothstep(elevationDeg, -6, 2)).lerp(dayFill, 1 - warm);
    for (const side of sides) side.intensity = side.userData.strength * (0.25 + 0.75 * day);
    world.environmentIntensity = 0.08 + (envStrength - 0.08) * day;

    const key = `${Math.round(elevationDeg)}`;
    if (key !== skyKey) {
      skyKey = key;
      (world.background as THREE.Texture | null)?.dispose?.();
      world.background = skyTexture(elevationDeg);
    }
  }
  setSun(scene.sun.azimuthDeg, scene.sun.elevationDeg);
  return { setSun };
}

/** The lamps of one storey, as a group to place at that storey's height. */
export function buildLamps(scene: Scene): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lamps';
  const ceiling = scene.defaults.ceilingHeight;
  for (const light of scene.lights ?? []) group.add(buildLamp(light, ceiling));
  return group;
}

/** A lamp: the light itself plus a simple fitting hanging from the ceiling. */
function buildLamp(light: Light, ceiling: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `light:${light.id}`;
  group.position.set(light.position[0], 0, light.position[1]);
  const style = light.style ?? 'spot';

  // A point light shines in all directions and fades with distance.
  const bulb = new THREE.PointLight(light.color, light.intensity, 9, 2);
  bulb.position.y = Math.min(light.height, ceiling - 0.15) - (style === 'spot' ? 0 : 0.2);
  if (style === 'cloud') {
    // Only the main living room lamp casts shadows: each shadow-casting
    // point light costs six extra drawings of the scene per frame.
    bulb.castShadow = true;
    bulb.shadow.mapSize.set(1024, 1024);
    bulb.shadow.bias = -0.003;
    bulb.shadow.radius = 4;
  }
  group.add(bulb);

  const glow = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(light.color),
    emissiveIntensity: 1.1,
    roughness: 0.9,
  });
  const add = (mesh: THREE.Mesh, y: number): void => {
    mesh.position.y = y;
    mesh.name = 'lamp';
    group.add(mesh);
  };
  if (style === 'spot') {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 20), glow), ceiling - 0.012);
    return group;
  }
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, ceiling - light.height, 6),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }),
  );
  add(cord, (ceiling + light.height) / 2);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), glow), ceiling - 0.016);
  if (style === 'pendant') {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), glow), light.height);
    return group;
  }
  // "cloud": a ball of crumpled paper, made from a cluster of faceted lumps.
  for (let i = 0; i < 16; i++) {
    const a = i * 2.399963; // the golden angle spreads the lumps evenly
    const up = 1 - (2 * (i + 0.5)) / 16;
    const ring = Math.sqrt(1 - up * up);
    const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11 + (i % 3) * 0.02, 0), glow);
    lump.position.set(Math.cos(a) * ring * 0.2, light.height + up * 0.13, Math.sin(a) * ring * 0.2);
    lump.rotation.set(i, i * 2, i * 3);
    lump.name = 'lamp';
    group.add(lump);
  }
  return group;
}
