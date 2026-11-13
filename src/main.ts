import * as THREE from 'three';
import { CATALOGUE } from './core/catalogue';
import {
  addFurniture, colorOf, emptyRoom, moveFurniture, paint, paintRoomWalls, putBack, raiseFurniture, resizeFurniture,
  resetLayout, resetPaint, roomAt, rotateFurniture, takeOut, type PaintTarget,
} from './core/edits';
import { History } from './core/history';
import { HOMES, type HomeEntry, type StairEntry } from './homes';
import { loadLayout, saveLayout } from './core/layout';
import { parseScene, SceneError, toVec, type Scene } from './core/scene';
import type { Segment } from './core/collision';
import { buildWalls } from './core/walls';
import { FirstPersonControls } from './render/firstPerson';
import { FurnitureView } from './render/furnitureView';
import { addLighting, buildLamps } from './render/lighting';
import { applyShellColors, buildShell } from './render/sceneMesh';
import { skyTexture } from './render/textures';
import { TopView } from './render/topView';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { DRAG_TYPE, FurniturePanel, labelOf, type Mode } from './ui/furniturePanel';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const PANEL_WIDTH = 288;

function start(home: HomeEntry, scenes: readonly Scene[]): void {
  document.getElementById('home-name')!.textContent = home.title;
  // The renderer draws the 3D scene into the canvas using WebGL (the GPU).
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  // The Three.js scene is a tree of objects, like a DOM for 3D.
  const world = new THREE.Scene();
  world.background = skyTexture(); // seen through the windows

  // A home is a stack of storeys. Each storey is a scene of its own, built
  // at the height of its floor. The shell (walls, floors, windows) keeps
  // its shape, so it is built once and only recoloured when something is
  // painted. Furniture is rebuilt from the scene whenever the scene changes.
  const stairs = home.stairs ?? [];
  const levels = scenes.map((original, i) => {
    const entry = home.levels[i];
    const walls = buildWalls(original);
    const shell = buildShell(original, walls, {
      roof: i === scenes.length - 1,
      raised: i > 0,
      openCeilings: entry.openCeilings,
    });
    const furniture = new FurnitureView();
    const lamps = buildLamps(original);
    for (const object of [shell, furniture.group, lamps]) {
      object.position.y = entry.elevation;
      world.add(object);
    }
    // A flight of stairs is closed off along its open side and under its
    // top end, so the only way onto it from below is the first step.
    const collision: Segment[] = [...walls.collision];
    for (const s of stairs) {
      if (s.lower !== i) continue;
      collision.push({ a: { x: s.x1, y: s.yTop }, b: { x: s.x1, y: s.yBottom } });
      collision.push({ a: { x: s.x0, y: s.yTop }, b: { x: s.x1, y: s.yTop } });
    }
    return {
      name: entry.name, elevation: entry.elevation, original, shell, furniture, lamps, collision,
      painted: original as Pick<Scene, 'rooms' | 'solids'>,
    };
  });
  // The storey being walked and edited.
  let level = 0;
  const lv = () => levels[level];

  // Size the sun's shadow area to the whole home, balcony included.
  const bounds = new THREE.Box2();
  for (const original of scenes) {
    for (const room of original.rooms) {
      for (const p of room.polygon.map(toVec)) bounds.expandByPoint(new THREE.Vector2(p.x, p.y));
    }
  }
  const mid = bounds.getCenter(new THREE.Vector2());
  const radius = bounds.getSize(new THREE.Vector2()).length() / 2 + 1;
  addLighting(renderer, world, scenes[0], new THREE.Vector3(mid.x, 0, mid.y), radius);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  const spawn = home.start ?? scenes[0].start ?? { position: [mid.x, mid.y] as [number, number], yawDeg: 0 };
  const controls = new FirstPersonControls(camera, canvas, levels[0].collision, {
    x: spawn.position[0],
    y: spawn.position[1],
    yawDeg: spawn.yawDeg,
  });

  const topView = new TopView(bounds);
  world.add(topView.marker);
  let inTopView = false;
  const activeCamera = (): THREE.Camera => (inTopView ? topView.camera : camera);

  // Adding ?fast to the address skips the post-processing below, for
  // slow machines.
  const fast = new URLSearchParams(window.location.search).has('fast');

  // Post-processing: the picture is drawn off screen, then improved in
  // passes before it is shown. The ambient occlusion pass darkens corners
  // and the floor under furniture, which is what makes things look grounded.
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(world, camera);
  const occlusion = new GTAOPass(world, camera, 1, 1);
  occlusion.updateGtaoMaterial({ radius: 0.3, distanceExponent: 1.6, thickness: 1, scale: 1.1, samples: 16 });
  occlusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  occlusion.blendIntensity = 0.75;
  composer.addPass(renderPass);
  composer.addPass(occlusion);
  composer.addPass(new OutputPass());

  // ---- State: the scene with undo history, and the current selection ----

  // One undo history for the whole home: a list with one scene per storey.
  const history = new History<readonly Scene[]>(scenes);
  /** The scene of the storey being edited, as it is now. */
  const now = (): Scene => history.current[level];
  const swap = (next: Scene): readonly Scene[] => history.current.map((s, i) => (i === level ? next : s));
  const preview = (next: Scene): void => history.preview(swap(next));
  let selectedId: string | null = null;
  // The panel has two tabs. In paint mode a click picks a surface instead
  // of a piece of furniture to move.
  let mode: Mode = 'furniture';
  let paintTarget: PaintTarget | null = null;
  let pickingColor = false;
  const selection = new THREE.BoxHelper(new THREE.Object3D(), 0xff9f1c);
  selection.visible = false;
  // Draw the outline on top of everything, so a picked floor shows too.
  (selection.material as THREE.Material).depthTest = false;
  selection.renderOrder = 10;
  world.add(selection);

  const selectedPiece = () =>
    now().furniture.find((f) => f.id === selectedId && !f.removed);

  /** The room the buttons act on: the selected piece's room, else where you stand. */
  const currentRoom = () => {
    const piece = selectedPiece();
    if (piece) return now().rooms.find((r) => r.id === piece.room);
    return roomAt(now(), controls.pose);
  };

  /** Applies an edit as one undo step, or explains why nothing happened. */
  const apply = (next: Scene, blockedMessage: string): boolean => {
    if (next === now()) {
      panel.toast(blockedMessage);
      return false;
    }
    history.set(swap(next));
    return true;
  };

  /** The 3D object and label for what the paint tab has picked. */
  const paintInfo = () => {
    const scene = now();
    const shell = lv().shell;
    const t = paintTarget;
    if (!t) return undefined;
    if (t.kind === 'furniture') {
      const piece = scene.furniture.find((f) => f.id === t.id && !f.removed);
      if (!piece) return undefined;
      return { label: labelOf(piece), color: piece.color ?? '#8a8f98', isWall: false, object: lv().furniture.objectFor(t.id) };
    }
    const color = colorOf(scene, t);
    if (!color) return undefined;
    if (t.kind === 'solid') {
      return { label: `Built-in block (${t.id})`, color, isWall: false, object: shell.getObjectByName(`solid:${t.id}`) };
    }
    const room = scene.rooms.find((r) => r.id === t.room);
    const name = t.kind === 'wall' ? `wall:${t.room}:${t.edge}` : `${t.kind}:${t.room}`;
    return { label: `${room?.name ?? t.room}: ${t.kind}`, color, isWall: t.kind === 'wall', object: shell.getObjectByName(name) };
  };

  const setPaintTarget = (target: PaintTarget | null): void => {
    if (pickingColor) {
      history.endGesture();
      pickingColor = false;
    }
    paintTarget = target;
    refresh();
  };

  /** Offers the current layout as a file download. */
  const save = (): void => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const link = document.createElement('a');
    // A Blob is a file held in memory; the link "downloads" it.
    link.href = URL.createObjectURL(new Blob([saveLayout(now())], { type: 'application/json' }));
    const floor = levels.length > 1 ? `-${lv().name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
    link.download = `layout-${home.id}${floor}-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    panel.toast(`Saved as ${link.download} in your downloads folder.`);
  };

  /** Replaces furniture and colours with those of a saved file. Undoable. */
  const load = (text: string): void => {
    const result = loadLayout(text, now());
    if ('error' in result) {
      panel.toast(result.error.split('\n').slice(0, 3).join(' '));
      return;
    }
    selectedId = null;
    paintTarget = null;
    history.set(swap(result.scene));
    panel.toast('Layout loaded. Undo brings the previous one back.');
  };

  const panel = new FurniturePanel({
    save,
    load,
    setMode: (next) => {
      if (next === mode) return;
      mode = next;
      // Carry a selected piece over, so "select, then switch tab" works.
      if (mode === 'paint') paintTarget = selectedId ? { kind: 'furniture', id: selectedId } : paintTarget;
      else if (paintTarget?.kind === 'furniture') selectedId = paintTarget.id;
      updateHint();
      refresh();
    },
    resize: (size) => {
      if (!selectedId) return;
      // A blocked resize leaves the scene alone, so put the old numbers back.
      if (!apply(resizeFurniture(now(), selectedId, size), 'That size does not fit here, or is not a size.')) refresh();
    },
    raise: (delta) => {
      if (selectedId) apply(raiseFurniture(now(), selectedId, delta), 'It cannot go any further.');
    },
    add: (key) => {
      const item = CATALOGUE.find((c) => c.key === key);
      if (!item) return;
      // Look for what is straight ahead of the walker: a wall-hung piece
      // goes on that wall, a floor piece stands a step in front.
      const pose = controls.pose;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hit = raycaster.intersectObject(lv().shell, true).find((h) => !h.object.name.startsWith('glass:'));
      let near: [number, number];
      if (item.mount === 'wall') {
        const p = hit ? hit.point.clone().addScaledVector(raycaster.ray.direction, -0.05) : null;
        near = p ? [mm(p.x), mm(p.z)] : [mm(pose.x), mm(pose.y)];
      } else {
        const reach = Math.max(0.3, Math.min(1.5, (hit?.distance ?? 9) - 0.6));
        near = [mm(pose.x - Math.sin(pose.yaw) * reach), mm(pose.y - Math.cos(pose.yaw) * reach)];
      }
      // Turn a floor piece to face the walker, to the nearest quarter turn.
      const facing = (((Math.round((180 - THREE.MathUtils.radToDeg(pose.yaw)) / 90) * 90) % 360) + 360) % 360;
      const result = addFurniture(now(), item, near, facing);
      if (apply(result.scene, 'There is no space for it here. Try from a spot with more room.') && result.id) {
        selectedId = result.id;
        refresh();
        panel.toast(item.mount === 'wall' ? `Hung: ${item.name}. Drag it along the wall.` : `Added: ${item.name}. Drag it into place.`);
      }
    },
    paint: (color, done) => {
      if (!paintTarget) return;
      // Dragging in the colour picker previews live and undoes as one step.
      if (!pickingColor) {
        history.beginGesture();
        pickingColor = true;
      }
      preview(paint(now(), paintTarget, color));
      if (done) {
        history.endGesture();
        pickingColor = false;
      }
    },
    paintRoomWalls: (color) => {
      if (paintTarget?.kind === 'wall') apply(paintRoomWalls(now(), paintTarget.room, color), 'Those walls already have this colour.');
    },
    resetPaint: () => apply(resetPaint(now(), lv().original), 'The colours are already as they started.'),
    turn: (deltaDeg) => {
      if (selectedId) apply(rotateFurniture(now(), selectedId, deltaDeg), 'No space to turn it here.');
    },
    takeOut: () => {
      if (selectedId) apply(takeOut(now(), selectedId), 'Nothing to take out.');
    },
    putBack: (id) => {
      if (apply(putBack(now(), id), 'It no longer fits where it stood. Drag it onto the floor instead.')) {
        selectedId = id;
        refresh();
      }
    },
    emptyRoom: () => {
      const room = currentRoom();
      if (room) apply(emptyRoom(now(), room.id), 'This room is already empty.');
    },
    reset: () => apply(resetLayout(now(), lv().original), 'The layout is already as it started.'),
    undo: () => history.undo(),
    redo: () => history.redo(),
    toggleTopView: () => setTopView(!inTopView),
  });

  function refresh(): void {
    levels.forEach((l, i) => {
      const s = history.current[i];
      l.furniture.sync(s.furniture);
      if (s.rooms !== l.painted.rooms || s.solids !== l.painted.solids) {
        applyShellColors(l.shell, s);
        l.painted = s;
      }
    });
    const scene = now();
    if (selectedId && !selectedPiece()) selectedId = null;
    const picked = paintInfo();
    const object = mode === 'paint' ? picked?.object : selectedId ? lv().furniture.objectFor(selectedId) : undefined;
    selection.visible = !!object;
    if (object) selection.setFromObject(object);
    panel.render({
      scene,
      mode,
      paint: picked,
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
    showLevels();
    document.body.classList.toggle('top-view', on);
    updateHint();
    refresh();
  }

  /**
   * The top view shows one storey: everything above it is hidden, and so
   * are its own ceilings, roof and lamps. The storeys below stay, so the
   * pool shows from upstairs.
   */
  function showLevels(): void {
    levels.forEach((l, i) => {
      const shown = !inTopView || i <= level;
      l.shell.visible = l.furniture.group.visible = shown;
      const lid = !(inTopView && i === level);
      l.lamps.visible = shown && lid;
      for (const o of l.shell.children) {
        if (o.name.startsWith('ceiling:') || o.name === 'roof') o.visible = lid;
      }
    });
  }

  // ---- Storeys: the floor buttons, and walking the stairs ----

  const levelBar = document.getElementById('levels')!;
  const levelButtons = levels.map((l, i) => {
    const button = document.createElement('button');
    button.textContent = l.name;
    button.title = `Go to the ${l.name.toLowerCase()} (Page Up / Page Down)`;
    button.addEventListener('click', () => goTo(i));
    return button;
  });
  levelBar.replaceChildren(...levelButtons);
  if (home.start) {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    outside.title = 'Back to the gate';
    outside.addEventListener('click', () => goTo(0, home.start));
    levelBar.append(outside);
  }
  levelBar.hidden = levels.length < 2 && !home.start;

  /** The flight of stairs the walker is on, if any. */
  let onStair: StairEntry | null = null;

  /** Makes storey `i` the one that is edited and shown in the top view. */
  function setLevel(i: number): void {
    if (pickingColor) {
      history.endGesture();
      pickingColor = false;
    }
    level = i;
    selectedId = null;
    paintTarget = null;
    floorPlane.constant = -lv().elevation;
    levelButtons.forEach((b, j) => b.classList.toggle('active', j === i));
    showLevels();
    refresh();
  }

  /** Jumps to a storey: to its own starting spot, or to `spot`. */
  function goTo(i: number, spot?: { position: [number, number]; yawDeg: number }): void {
    if (i < 0 || i >= levels.length) return;
    const to = spot ?? history.current[i].start ?? spawn;
    onStair = null;
    controls.setWalls(levels[i].collision);
    controls.baseHeight = levels[i].elevation;
    controls.teleport(to.position[0], to.position[1], to.yawDeg);
    setLevel(i);
  }

  /** Called every frame: carries the walker up or down a flight of stairs. */
  function walkStairs(): void {
    const p = controls.pose;
    if (!onStair) {
      const s = stairs.find(
        (f) => (f.lower === level || f.upper === level) && p.x > f.x0 && p.x < f.x1 && p.y > f.yTop && p.y < f.yBottom,
      );
      if (!s) return;
      onStair = s;
      // On the flight only its two sides hold the walker in.
      controls.setWalls([
        { a: { x: s.x0, y: s.yTop }, b: { x: s.x0, y: s.yBottom } },
        { a: { x: s.x1, y: s.yTop }, b: { x: s.x1, y: s.yBottom } },
      ]);
    }
    const s = onStair;
    const t = (s.yBottom - p.y) / (s.yBottom - s.yTop); // 0 at the first step, 1 at the top
    const end = t <= 0 ? s.lower : t >= 1 ? s.upper : undefined;
    if (end !== undefined) {
      onStair = null;
      controls.setWalls(levels[end].collision);
    }
    const low = levels[s.lower].elevation;
    controls.baseHeight = low + (levels[s.upper].elevation - low) * Math.max(0, Math.min(1, t));
    controls.settle();
    const standingOn = end ?? (t > 0.5 ? s.upper : s.lower);
    if (standingOn !== level) setLevel(standingOn);
  }

  function updateHint(): void {
    const painting = mode === 'paint';
    document.getElementById('hint-title')!.textContent = inTopView
      ? 'Top view'
      : painting
        ? 'Click a surface to paint it'
        : 'Click the room to look around';
    document.getElementById('hint-text')!.textContent = inTopView
      ? painting
        ? 'Click a floor, wall or piece, then choose a colour · T to walk again'
        : 'Click a piece to select it · drag to move · R to turn · T to walk again'
      : painting
        ? 'W A S D to walk · right-drag or double-click to look around · while looking, click picks what the dot is on'
        : `W A S D to walk · Shift to walk faster · Esc to release the mouse · T for the top view${levels.length > 1 ? ' · Page Up / Page Down to change floor' : ''}`;
  }

  // ---- Picking: finding what is under the mouse ----

  // A raycaster shoots a line from the camera through a point on screen and
  // reports what it hits, nearest first.
  const raycaster = new THREE.Raycaster();
  const mm = (v: number): number => Math.round(v * 1000) / 1000;
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
      .intersectObjects([lv().shell, lv().furniture.group], true)
      .find((h) => isShown(h.object) && !h.object.name.startsWith('glass:'));
    return hit ? FurnitureView.idOf(hit.object) : undefined;
  };

  /** What a mesh of the shell stands for in the scene file, going by its name. */
  const targetOf = (object: THREE.Object3D): PaintTarget | undefined => {
    const [kind, ...rest] = object.name.split(':');
    if (kind === 'wall') return { kind, room: rest.slice(0, -1).join(':'), edge: Number(rest[rest.length - 1]) };
    if (kind === 'floor' || kind === 'ceiling') return { kind, room: rest.join(':') };
    if (kind === 'threshold') return { kind: 'floor', room: object.userData.roomId };
    if (kind === 'solid') return { kind, id: rest.join(':') };
    return undefined;
  };

  /** The wall, floor, ceiling or piece under the mouse, for the paint tab. */
  const pickSurface = (e: { clientX: number; clientY: number }): PaintTarget | undefined => {
    aim(e);
    const hit = raycaster
      .intersectObjects([lv().shell, lv().furniture.group], true)
      .find((h) => isShown(h.object) && !h.object.name.startsWith('glass:'));
    if (!hit) return undefined;
    const id = FurnitureView.idOf(hit.object);
    if (id) return { kind: 'furniture', id };
    // Skirting boards and window frames belong to their wall.
    for (let o: THREE.Object3D | null = hit.object; o && o !== lv().shell; o = o.parent) {
      const target = targetOf(o);
      if (target) return target;
    }
    return undefined;
  };

  /** Where the mouse points on a wall, for hanging things: x, height above this storey's floor, z. */
  const wallPoint = (e: { clientX: number; clientY: number }): THREE.Vector3 | undefined => {
    aim(e);
    const shell = lv().shell;
    for (const hit of raycaster.intersectObject(shell, true)) {
      if (!isShown(hit.object) || hit.object.name.startsWith('glass:')) continue;
      for (let o: THREE.Object3D | null = hit.object; o && o !== shell; o = o.parent) {
        const kind = o.name.split(':')[0];
        if (kind === 'wall' || kind === 'solid') return hit.point.setY(hit.point.y - lv().elevation);
      }
      return undefined; // a floor or ceiling is in front
    }
    return undefined;
  };

  const pickForPaint = (e: { clientX: number; clientY: number }): void => {
    const target = pickSurface(e);
    if (!target) panel.toast('That cannot be painted.');
    setPaintTarget(target ?? null);
  };

  /** Where the mouse points on the floor, in plan coordinates. */
  const floorPoint = (e: { clientX: number; clientY: number }): [number, number] | undefined => {
    aim(e);
    const p = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
    return p ? [p.x, p.z] : undefined;
  };

  // ---- Mouse: select, drag along the floor, or click to walk ----

  // `lift` is set while dragging a wall-hung piece along its wall: the
  // height of the piece's bottom edge above the point that was grabbed.
  let drag: { id: string; offset: [number, number]; lift?: number } | null = null;
  let press: { x: number; y: number } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (controls.locked) {
      // While looking around, a click in paint mode picks what the dot is on.
      if (mode === 'paint') {
        const rect = canvas.getBoundingClientRect();
        pickForPaint({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
      }
      return;
    }
    press = { x: e.clientX, y: e.clientY };
    if (mode === 'paint') return;
    const id = pickFurniture(e);
    if (!id) return;
    selectedId = id;
    const piece = selectedPiece();
    const onWall = piece?.mount === 'wall' && !inTopView ? wallPoint(e) : undefined;
    const grab = onWall ? ([onWall.x, onWall.z] as [number, number]) : floorPoint(e);
    if (piece?.fixed) {
      panel.toast('This is part of the building, so it stays where it is. It can be painted.');
    } else if (piece && grab) {
      drag = onWall
        ? { id, offset: [0, 0], lift: (piece.elevation ?? 0) - onWall.y }
        : { id, offset: [piece.position[0] - grab[0], piece.position[1] - grab[1]] };
      history.beginGesture();
      canvas.setPointerCapture(e.pointerId);
      document.body.classList.add('dragging');
    }
    refresh();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.lift !== undefined) {
      const hit = wallPoint(e);
      if (!hit) return;
      let next = moveFurniture(now(), drag.id, [mm(hit.x), mm(hit.z)]);
      const height = next.furniture.find((f) => f.id === drag!.id)?.elevation ?? 0;
      next = raiseFurniture(next, drag.id, mm(hit.y + drag.lift - height));
      preview(next);
      return;
    }
    const p = floorPoint(e);
    if (!p) return;
    const target: [number, number] = [mm(p[0] + drag.offset[0]), mm(p[1] + drag.offset[1])];
    preview(moveFurniture(now(), drag.id, target));
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
    if (mode === 'paint') {
      pickForPaint(e);
      return;
    }
    // A click on nothing: clear the selection, and in the walk view start looking around.
    selectedId = null;
    refresh();
    if (!inTopView) controls.lock();
  });

  canvas.addEventListener('dblclick', () => {
    if (mode === 'paint' && !inTopView) controls.lock();
  });

  // Dragging a taken-out piece from the panel onto the floor.
  canvas.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (types.includes(DRAG_TYPE) || types.includes('Files')) e.preventDefault();
  });
  canvas.addEventListener('drop', (e) => {
    // A layout file dropped onto the view is loaded.
    const file = e.dataTransfer?.files[0];
    if (file) {
      e.preventDefault();
      void file.text().then(load);
      return;
    }
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    const p = floorPoint(e);
    const next = p ? putBack(now(), id, [mm(p[0]), mm(p[1])]) : now();
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
    } else if (command && e.code === 'KeyS') {
      e.preventDefault();
      save();
    } else if (command) {
      return;
    } else if (e.code === 'KeyT') {
      setTopView(!inTopView);
    } else if (e.code === 'PageUp' || e.code === 'PageDown') {
      e.preventDefault();
      goTo(level + (e.code === 'PageUp' ? 1 : -1));
    } else if (e.code === 'Escape') {
      selectedId = null;
      setPaintTarget(null);
    } else if (mode !== 'furniture') {
      return;
    } else if (e.code === 'KeyR' && selectedId) {
      apply(rotateFurniture(now(), selectedId, e.shiftKey ? -15 : 15), 'No space to turn it here.');
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && selectedId) {
      const piece = selectedPiece();
      if (piece && apply(takeOut(now(), selectedId), '')) panel.toast(`Took out: ${labelOf(piece)}`);
    }
  });

  // ---- Sizing and the render loop ----

  function resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    topView.resize(w, h, PANEL_WIDTH);
  }
  window.addEventListener('resize', resize);
  resize();
  setLevel(0);

  let lastRoom: string | undefined;
  const timer = new THREE.Timer();
  // The render loop: the browser calls this before every screen refresh.
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    controls.update(Math.min(timer.getDelta(), 0.1));
    walkStairs();
    const pose = controls.pose;
    topView.placeMarker(pose.x, pose.y, pose.yaw, controls.baseHeight);
    if (selection.visible) selection.update();
    // Walking into another room changes what "Empty the room" refers to.
    const roomId = currentRoom()?.id;
    if (roomId !== lastRoom) {
      lastRoom = roomId;
      refresh();
    }
    if (fast) {
      renderer.render(world, activeCamera());
    } else {
      renderPass.camera = occlusion.camera = activeCamera();
      composer.render();
    }
  });

  // Handy in the browser console, and used by the automated screenshots.
  Object.assign(window, { walkthrough: { history, camera, controls, world, setTopView, goTo, topCamera: topView.camera } });
}

// The address picks the home: ?home=apartment. Without it, the start
// screen lists the homes to choose from.
const params = new URLSearchParams(window.location.search);
const chosen = HOMES.find((h) => h.id === params.get('home'));

if (!chosen) {
  document.getElementById('panel')!.hidden = true;
  document.getElementById('hint')!.hidden = true;
  document.getElementById('chooser')!.hidden = false;
  document.getElementById('chooser-list')!.replaceChildren(
    ...HOMES.map((h) => {
      const link = document.createElement('a');
      const query = new URLSearchParams(params);
      query.set('home', h.id);
      link.href = `?${query}`;
      const title = document.createElement('strong');
      title.textContent = h.title;
      const about = document.createElement('span');
      about.textContent = h.about;
      link.append(title, about);
      return link;
    }),
  );
} else {
  // "Change home" keeps other switches such as ?fast.
  const back = new URLSearchParams(params);
  back.delete('home');
  document.querySelector<HTMLAnchorElement>('#home-change')!.href = back.size ? `?${back}` : './';
  try {
    start(chosen, chosen.levels.map((l) => parseScene(l.json)));
  } catch (error) {
    const panel = document.querySelector<HTMLElement>('#error')!;
    panel.hidden = false;
    panel.textContent =
      error instanceof SceneError ? error.message : `Could not start: ${String(error)}`;
    if (!(error instanceof SceneError)) throw error;
  }
}
