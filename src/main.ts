import * as THREE from 'three';
import { collisionSegments, createDemoRoom } from './core/demoRoom';
import { FirstPersonControls } from './render/firstPerson';
import { addLighting } from './render/lighting';
import { buildRoom } from './render/roomMesh';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;

// The renderer draws the scene into the canvas using WebGL (the GPU).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// The scene is a tree of objects, like a DOM for 3D.
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd9f2); // sky seen through the window

const room = createDemoRoom();
scene.add(buildRoom(room));

// A placeholder box, so there is something in the room to cast a shadow.
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.8, 0.75, 0.85),
  new THREE.MeshStandardMaterial({ color: 0x6f8f9f, roughness: 0.9 }),
);
box.position.set(room.width - 0.6, 0.375, 2.6);
box.rotation.y = Math.PI / 2;
box.castShadow = true;
box.receiveShadow = true;
scene.add(box);

addLighting(
  scene,
  { azimuthDeg: 15, elevationDeg: 28, intensity: 4, color: 0xfff1dc },
  new THREE.Vector3(room.width / 2, 0, room.depth / 2),
  Math.max(room.width, room.depth),
);

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
const controls = new FirstPersonControls(camera, canvas, collisionSegments(room), {
  x: room.width / 2,
  y: room.depth - 1.2,
  yawDeg: 0,
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
  const dt = Math.min(timer.getDelta(), 0.1);
  controls.update(dt);
  renderer.render(scene, camera);
});
