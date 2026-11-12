import * as THREE from 'three';
import homeJson from '../scenes/home.json';
import { parseScene, SceneError, toVec, type Scene } from './core/scene';
import { buildWalls } from './core/walls';
import { FirstPersonControls } from './render/firstPerson';
import { addLighting } from './render/lighting';
import { buildShell } from './render/sceneMesh';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;

function start(scene: Scene): void {
  // The renderer draws the 3D scene into the canvas using WebGL (the GPU).
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // The Three.js scene is a tree of objects, like a DOM for 3D.
  const world = new THREE.Scene();
  world.background = new THREE.Color(0xbfd9f2); // sky seen through the windows

  const walls = buildWalls(scene);
  world.add(buildShell(scene, walls));

  // Size the sun's shadow area to the whole home, balcony included.
  const box = new THREE.Box2();
  for (const room of scene.rooms) {
    for (const p of room.polygon.map(toVec)) box.expandByPoint(new THREE.Vector2(p.x, p.y));
  }
  const mid = box.getCenter(new THREE.Vector2());
  const radius = box.getSize(new THREE.Vector2()).length() / 2 + 1;
  addLighting(world, scene.sun, scene.northDeg, new THREE.Vector3(mid.x, 0, mid.y), radius);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  const spawn = scene.start ?? { position: [mid.x, mid.y] as [number, number], yawDeg: 0 };
  const controls = new FirstPersonControls(camera, canvas, walls.collision, {
    x: spawn.position[0],
    y: spawn.position[1],
    yawDeg: spawn.yawDeg,
  });

  function resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // The render loop: the browser calls this before every screen refresh.
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    controls.update(Math.min(timer.getDelta(), 0.1));
    renderer.render(world, camera);
  });

  // Handy in the browser console, and used by the automated screenshots.
  Object.assign(window, { walkthrough: { scene, camera, controls, world } });
}

try {
  start(parseScene(homeJson));
} catch (error) {
  const panel = document.querySelector<HTMLElement>('#error')!;
  panel.hidden = false;
  panel.textContent =
    error instanceof SceneError ? error.message : `Could not start: ${String(error)}`;
  if (!(error instanceof SceneError)) throw error;
}
