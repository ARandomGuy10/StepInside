import * as THREE from 'three';
import homeJson from '../scenes/home.json';
import { emptyRoom, moveFurniture, putBack, resetLayout, roomAt, rotateFurniture, takeOut } from './core/edits';
import { History } from './core/history';
import { parseScene, SceneError, toVec, type Scene } from './core/scene';
import { buildWalls } from './core/walls';
import { FirstPersonControls } from './render/firstPerson';
import { FurnitureView } from './render/furnitureView';
import { addLighting } from './render/lighting';
import { buildShell } from './render/sceneMesh';
import { TopView } from './render/topView';
import { DRAG_TYPE, FurniturePanel, labelOf } from './ui/furniturePanel';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const PANEL_WIDTH = 288;

function start(original: Scene): void {
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

  // The shell (walls, floors, windows) never changes in this step, so it is
  // built once. Furniture is rebuilt from the scene whenever the scene changes.
  const walls = buildWalls(original);
  const shell = buildShell(original, walls);
  world.add(shell);
  const furniture = new FurnitureView();
  world.add(furniture.group);

  // Size the sun's shadow area to the whole home, balcony included.
  const bounds = new THREE.Box2();
  for (const room of original.rooms) {
    for (const p of room.polygon.map(toVec)) bounds.expandByPoint(new THREE.Vector2(p.x, p.y));
  }
  const mid = bounds.getCenter(new THREE.Vector2());
  const radius = bounds.getSize(new THREE.Vector2()).length() / 2 + 1;
  addLighting(world, original.sun, original.northDeg, new THREE.Vector3(mid.x, 0, mid.y), radius);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  const spawn = original.start ?? { position: [mid.x, mid.y] as [number, number], yawDeg: 0 };
  const controls = new FirstPersonControls(camera, canvas, walls.collision, {
    x: spawn.position[0],
    y: spawn.position[1],
    yawDeg: spawn.yawDeg,
  });

  const topView = new TopView(
    bounds,
    shell.children.filter((o) => o.name.startsWith('ceiling:') || o.name === 'roof'),
  );
  world.add(topView.marker);
  let inTopView = false;
  const activeCamera = (): THREE.Camera => (inTopView ? topView.camera : camera);

  // ---- State: the scene with undo history, and the current selection ----

  const history = new History<Scene>(original);
  let selectedId: string | null = null;
  const selection = new THREE.BoxHelper(new THREE.Object3D(), 0xff9f1c);
  selection.visible = false;
  world.add(selection);

  const selectedPiece = () =>
    history.current.furniture.find((f) => f.id === selectedId && !f.removed);

  /** The room the buttons act on: the selected piece's room, else where you stand. */
  const currentRoom = () => {
    const piece = selectedPiece();
    if (piece) return history.current.rooms.find((r) => r.id === piece.room);
    return roomAt(history.current, controls.pose);
  };

  /** Applies an edit as one undo step, or explains why nothing happened. */
  const apply = (next: Scene, blockedMessage: string): boolean => {
    if (next === history.current) {
      panel.toast(blockedMessage);
      return false;
    }
    history.set(next);
    return true;
  };

  const panel = new FurniturePanel({
    turn: (deltaDeg) => {
      if (selectedId) apply(rotateFurniture(history.current, selectedId, deltaDeg), 'No space to turn it here.');
    },
    takeOut: () => {
      if (selectedId) apply(takeOut(history.current, selectedId), 'Nothing to take out.');
    },
    putBack: (id) => {
      if (apply(putBack(history.current, id), 'It no longer fits where it stood. Drag it onto the floor instead.')) {
        selectedId = id;
        refresh();
      }
    },
    emptyRoom: () => {
      const room = currentRoom();
      if (room) apply(emptyRoom(history.current, room.id), 'This room is already empty.');
    },
    reset: () => apply(resetLayout(history.current, original), 'The layout is already as it started.'),
    undo: () => history.undo(),
    redo: () => history.redo(),
    toggleTopView: () => setTopView(!inTopView),
  });

  function refresh(): void {
    const scene = history.current;
    furniture.sync(scene.furniture);
    if (selectedId && !selectedPiece()) selectedId = null;
    const object = selectedId ? furniture.objectFor(selectedId) : undefined;
    selection.visible = !!object;
    if (object) selection.setFromObject(object);
    panel.render({
      scene,
      selected: selectedPiece(),
      room: currentRoom(),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      topView: inTopView,
    });
  }
  history.subscribe(refresh);

  function setTopView(on: boolean): void {
    inTopView = on;
    if (on) document.exitPointerLock();
    controls.enabled = !on;
    topView.setActive(on);
    document.body.classList.toggle('top-view', on);
    document.getElementById('hint-title')!.textContent = on
      ? 'Top view'
      : 'Click the room to look around';
    document.getElementById('hint-text')!.textContent = on
      ? 'Click a piece to select it · drag to move · R to turn · T to walk again'
      : 'W A S D to walk · Shift to walk faster · Esc to release the mouse · T for the top view';
    refresh();
  }

  // ---- Picking: finding what is under the mouse ----

  // A raycaster shoots a line from the camera through a point on screen and
  // reports what it hits, nearest first.
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const aim = (e: { clientX: number; clientY: number }): void => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, activeCamera());
  };

  const isShown = (object: THREE.Object3D): boolean => {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
    return true;
  };

  /** The furniture piece under the mouse, unless a wall is in front of it. */
  const pickFurniture = (e: MouseEvent): string | undefined => {
    aim(e);
    const hit = raycaster
      .intersectObjects([shell, furniture.group], true)
      .find((h) => isShown(h.object) && !h.object.name.startsWith('glass:'));
    return hit ? FurnitureView.idOf(hit.object) : undefined;
  };

  /** Where the mouse points on the floor, in plan coordinates. */
  const floorPoint = (e: { clientX: number; clientY: number }): [number, number] | undefined => {
    aim(e);
    const p = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
    return p ? [p.x, p.z] : undefined;
  };

  // ---- Mouse: select, drag along the floor, or click to walk ----

  let drag: { id: string; offset: [number, number] } | null = null;
  let press: { x: number; y: number } | null = null;
  const mm = (v: number): number => Math.round(v * 1000) / 1000;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || controls.locked) return;
    press = { x: e.clientX, y: e.clientY };
    const id = pickFurniture(e);
    if (!id) return;
    selectedId = id;
    const piece = selectedPiece();
    const grab = floorPoint(e);
    if (piece && grab) {
      drag = { id, offset: [piece.position[0] - grab[0], piece.position[1] - grab[1]] };
      history.beginGesture();
      canvas.setPointerCapture(e.pointerId);
      document.body.classList.add('dragging');
    }
    refresh();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = floorPoint(e);
    if (!p) return;
    const target: [number, number] = [mm(p[0] + drag.offset[0]), mm(p[1] + drag.offset[1])];
    history.preview(moveFurniture(history.current, drag.id, target));
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const wasClick = press !== null && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5;
    press = null;
    if (drag) {
      drag = null;
      history.endGesture();
      document.body.classList.remove('dragging');
      return;
    }
    if (!wasClick || controls.locked) return;
    // A click on nothing: clear the selection, and in the walk view start looking around.
    selectedId = null;
    refresh();
    if (!inTopView) controls.lock();
  });

  // Dragging a taken-out piece from the panel onto the floor.
  canvas.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(DRAG_TYPE)) e.preventDefault();
  });
  canvas.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    const p = floorPoint(e);
    const next = p ? putBack(history.current, id, [mm(p[0]), mm(p[1])]) : history.current;
    if (apply(next, 'It does not fit there. Try a spot with more room.')) {
      selectedId = id;
      refresh();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const command = e.metaKey || e.ctrlKey;
    if (command && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    } else if (command) {
      return;
    } else if (e.code === 'KeyT') {
      setTopView(!inTopView);
    } else if (e.code === 'KeyR' && selectedId) {
      apply(rotateFurniture(history.current, selectedId, e.shiftKey ? -15 : 15), 'No space to turn it here.');
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && selectedId) {
      const piece = selectedPiece();
      if (piece && apply(takeOut(history.current, selectedId), '')) panel.toast(`Took out: ${labelOf(piece)}`);
    } else if (e.code === 'Escape') {
      selectedId = null;
      refresh();
    }
  });

  // ---- Sizing and the render loop ----

  function resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    topView.resize(w, h, PANEL_WIDTH);
  }
  window.addEventListener('resize', resize);
  resize();
  refresh();

  let lastRoom: string | undefined;
  const timer = new THREE.Timer();
  // The render loop: the browser calls this before every screen refresh.
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    controls.update(Math.min(timer.getDelta(), 0.1));
    const pose = controls.pose;
    topView.placeMarker(pose.x, pose.y, pose.yaw);
    if (selection.visible) selection.update();
    // Walking into another room changes what "Empty the room" refers to.
    const roomId = currentRoom()?.id;
    if (roomId !== lastRoom) {
      lastRoom = roomId;
      refresh();
    }
    renderer.render(world, activeCamera());
  });

  // Handy in the browser console, and used by the automated screenshots.
  Object.assign(window, { walkthrough: { history, camera, controls, world, setTopView, topCamera: topView.camera } });
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
