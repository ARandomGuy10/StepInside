import * as THREE from 'three';
import { CATALOGUE } from './core/catalogue';
import {
  addFurniture, colorOf, emptyRoom, materialOf, moveFurniture, paint, paintRoomWalls, putBack, raiseFurniture, resizeFurniture,
  resetLayout, resetPaint, roomAt, rotateFurniture, setMaterial, setRoomWallsMaterial, takeOut, type PaintTarget,
} from './core/edits';
import { applyStyle, STYLES } from './core/styles';
import { openSpot, tourRoute } from './core/tour';
import { viewFromParams, viewToParams, type ViewState } from './core/viewLink';
import { TourPlayer } from './render/tourPlayer';
import { History } from './core/history';
import { HOMES, type HomeEntry, type StairEntry } from './homes';
import { loadLayout, saveLayout } from './core/layout';
import { formatLength, formatSize, roomSize } from './core/measure';
import { parseScene, SceneError, toVec, type Scene } from './core/scene';
import type { Segment } from './core/collision';
import { buildWalls } from './core/walls';
import { FirstPersonControls } from './render/firstPerson';
import { FurnitureView } from './render/furnitureView';
import { addLighting, buildLamps, type Daylight } from './render/lighting';
import { clockText, sunPosition, sunTimes, type Place } from './core/sun';
import { applyShellColors, buildShell } from './render/sceneMesh';
import { loadSurfaces } from './render/textures';
import { OrbitView } from './render/orbitView';
import { buildStreet } from './render/site';
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
    for (const [x0, y0, x1, y1] of entry.keepOut ?? []) {
      const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      corners.forEach((a, k) => collision.push({ a, b: corners[(k + 1) % 4] }));
    }
    for (const s of stairs) {
      if (s.lower !== i) continue;
      collision.push({ a: { x: s.x1, y: s.yTop }, b: { x: s.x1, y: s.yBottom } });
      // A flight standing free in a room is closed on its other side too.
      if (s.closedBothSides) collision.push({ a: { x: s.x0, y: s.yTop }, b: { x: s.x0, y: s.yBottom } });
      collision.push({ a: { x: s.x0, y: s.yTop }, b: { x: s.x1, y: s.yTop } });
    }
    return {
      name: entry.name, elevation: entry.elevation, original, walls, shell, furniture, lamps, collision,
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
  const daylight = addLighting(renderer, world, scenes[0], new THREE.Vector3(mid.x, 0, mid.y), radius);
  if (home.place) setUpSunControls(home.place, daylight);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  const spawn = home.start ?? scenes[0].start ?? { position: [mid.x, mid.y] as [number, number], yawDeg: 0 };
  const controls = new FirstPersonControls(camera, canvas, levels[0].collision, {
    x: spawn.position[0],
    y: spawn.position[1],
    yawDeg: spawn.yawDeg,
  });

  const topView = new TopView(bounds);
  // The whole-house view circles the home from outside.
  const top = levels[levels.length - 1];
  // The highest storey with rooms under a roof: a roof terrace above it
  // comes off with the roof.
  let roofed = levels.length - 1;
  while (roofed > 0 && home.levels[roofed].roofTerrace) roofed--;
  const orbit = new OrbitView(bounds, top.elevation + scenes[scenes.length - 1].defaults.ceilingHeight);
  let inOrbit = false;
  // A floor plan is seen at an angle too, from nearly overhead, so the
  // walls and furniture read as 3D. Tilt it all the way up for a flat plan.
  const plan = new OrbitView(bounds, 1, { azimuth: 0.3, polar: 0.5, reach: 1.25 });
  const units = home.units ?? 'm';
  let dimensions = true;
  // A home without an outside to show, such as a flat, opens with its lid off.
  let roofHidden = !scenes[0].site;
  if (scenes[0].site) {
    world.add(buildStreet(bounds, scenes[0].defaults.exteriorWallThickness, scenes[0].site.margin, spawn.position[0]));
  }
  world.add(topView.marker);
  let inTopView = false;
  const activeCamera = (): THREE.Camera => (inOrbit ? orbit.camera : inTopView ? plan.camera : camera);

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

  // The selected piece of furniture gets a glowing pad on the floor and a
  // see-through box round it. Both turn red while a drag is blocked.
  const SELECTED = 0xff9f1c;
  const BLOCKED = 0xe5484d;
  const glow = new THREE.MeshBasicMaterial({ color: SELECTED, transparent: true, opacity: 0.32, depthWrite: false });
  const haze = new THREE.MeshBasicMaterial({ color: SELECTED, transparent: true, opacity: 0.1, depthWrite: false });
  const edge = new THREE.LineBasicMaterial({ color: SELECTED, depthTest: false });
  const highlight = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glow);
  const cage = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), haze);
  const cageEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), edge);
  cageEdges.renderOrder = 10;
  highlight.add(pad, cage, cageEdges);
  highlight.visible = false;
  world.add(highlight);
  let blocked = false;
  const setBlocked = (on: boolean): void => {
    if (on === blocked) return;
    blocked = on;
    for (const m of [glow, haze, edge]) m.color.set(on ? BLOCKED : SELECTED);
    document.body.classList.toggle('blocked', on);
  };

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
    const material = t.kind === 'ceiling' ? undefined : { kind: t.kind, current: materialOf(scene, t) };
    return { label: `${room?.name ?? t.room}: ${t.kind}`, color, isWall: t.kind === 'wall', material, object: shell.getObjectByName(name) };
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
    resetPaint: () => {
      // On the Style tab this undoes a style everywhere; on the Paint tab, on this floor.
      if (mode === 'style') {
        const next = history.current.map((s, i) => resetPaint(s, levels[i].original));
        if (next.every((s, i) => s === history.current[i])) panel.toast('This is already the original look.');
        else history.set(next);
        return;
      }
      apply(resetPaint(now(), lv().original), 'The colours are already as they started.');
    },
    setMaterial: (material) => {
      const t = paintTarget;
      if (t?.kind === 'floor' || t?.kind === 'wall') apply(setMaterial(now(), t, material), 'It already has that material.');
    },
    setRoomWallsMaterial: (material) => {
      if (paintTarget?.kind === 'wall') {
        apply(setRoomWallsMaterial(now(), paintTarget.room, material), 'Those walls already have this material.');
      }
    },
    applyStyle: (key, allFloors) => {
      const style = STYLES.find((s) => s.key === key);
      if (!style) return;
      const next = history.current.map((s, i) => (allFloors || i === level ? applyStyle(s, style) : s));
      history.set(next);
      panel.toast(`${style.name} style on ${allFloors && levels.length > 1 ? 'every floor' : 'this floor'}. Undo brings the old look back.`);
    },
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
    const chosen = mode === 'furniture' ? selectedPiece() : undefined;
    selection.visible = !!object && !chosen;
    if (object && !chosen) selection.setFromObject(object);
    highlight.visible = !!chosen;
    if (chosen) {
      const [w, h, d] = chosen.size;
      const up = chosen.elevation ?? 0;
      highlight.position.set(chosen.position[0], lv().elevation, chosen.position[1]);
      highlight.rotation.y = -THREE.MathUtils.degToRad(chosen.rotationDeg);
      const onWall = chosen.mount === 'wall';
      pad.visible = !onWall;
      pad.scale.set(w + 0.24, 1, d + 0.24);
      pad.position.y = 0.012;
      cage.scale.set(w + 0.03, h + 0.03, d + 0.03);
      cage.position.y = up + h / 2;
      cageEdges.scale.copy(cage.scale);
      cageEdges.position.copy(cage.position);
    }
    panel.render({
      scene,
      mode,
      paint: picked,
      selected: selectedPiece(),
      room: currentRoom(),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      topView: inTopView,
      storeys: levels.length > 1,
    });
  }
  history.subscribe(refresh);

  function setTopView(on: boolean): void {
    if (tour) stopTour();
    inTopView = on;
    inOrbit = false;
    if (on) controls.unlock();
    controls.enabled = !on;
    topView.setActive(on);
    showLevels();
    document.body.classList.toggle('top-view', on);
    document.body.classList.remove('orbit-view', 'hint-gone');
    updateHint();
    refresh();
  }

  /** The whole home seen from outside. Nothing is edited in this view. */
  function setOrbit(): void {
    if (tour) stopTour();
    setTopView(false);
    inOrbit = true;
    controls.unlock();
    controls.enabled = false;
    selectedId = null;
    paintTarget = null;
    document.body.classList.add('orbit-view');
    showLevels();
    updateHint();
    refresh();
  }

  // ---- The view bar: whole house, a plan per floor, walk through ----

  const viewBar = document.getElementById('views')!;
  const viewButton = (label: string, title: string, run: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', run);
    return button;
  };
  const wholeButton = viewButton(scenes[0].site ? 'Whole house' : 'Whole home', 'See it from outside: drag to turn, scroll to zoom', setOrbit);
  const planButtons = levels.map((l, i) =>
    viewButton(levels.length > 1 ? `${l.name} plan` : 'Floor plan', 'This floor as a 3D plan with its sizes', () => {
      if (i !== level) goTo(i);
      setTopView(true);
    }),
  );
  const walkButton = viewButton('Walk through', 'Walk it in first person', () => setTopView(false));
  walkButton.classList.add('primary');
  const tourButton = viewButton('▶ Tour', 'A walk through every room, hands free', () => (tour ? stopTour() : startTour()));
  const shareButton = viewButton('Share', 'Copy a link that opens exactly this view', () => void shareView());
  const savedButton = viewButton('Saved views ▾', 'Keep this view, or go back to one you kept', () => toggleSaved());
  tourButton.id = 'btn-tour';
  viewBar.replaceChildren(wholeButton, ...planButtons, walkButton);
  document.getElementById('view-extras')!.replaceChildren(tourButton, savedButton, shareButton);
  const tools = document.getElementById('orbit-tools')!;
  const roofButton = viewButton('', 'Take the roof off to look inside', () => {
    roofHidden = !roofHidden;
    showLevels();
    updateHint();
  });
  const dimensionsButton = viewButton('', 'Show or hide the room names and sizes', () => {
    dimensions = !dimensions;
    updateHint();
  });
  roofButton.id = 'btn-roof';
  dimensionsButton.id = 'btn-dimensions';
  /** The camera that drags, the wheel and these buttons act on. */
  const turnable = (): OrbitView => (inOrbit ? orbit : plan);
  tools.replaceChildren(
    viewButton('⟲', 'Turn left', () => turnable().turn(-Math.PI / 4)),
    viewButton('⟳', 'Turn right', () => turnable().turn(Math.PI / 4)),
    viewButton('+', 'Zoom in', () => turnable().zoom(0.8)),
    viewButton('−', 'Zoom out', () => turnable().zoom(1.25)),
    viewButton('Reset view', 'Back to the first view', () => turnable().reset()),
    roofButton,
    dimensionsButton,
  );

  // Room names and sizes are HTML labels laid over the 3D view, one per
  // room of the floor on show, plus one for the selected piece.
  const labelLayer = document.getElementById('labels')!;
  const labelPool: HTMLElement[] = [];
  const spot = new THREE.Vector3();
  function placeLabels(): void {
    const show = inTopView && dimensions;
    labelLayer.hidden = !show;
    if (!show) return;
    const items: { text: string; sub: string; x: number; y: number; z: number; piece?: boolean }[] = [];
    for (const room of now().rooms) {
      if (room.kind === 'void') continue;
      const size = roomSize(room);
      items.push({ text: room.name ?? room.id, sub: formatSize(size.width, size.depth, units), x: size.center[0], y: 0.05, z: size.center[1] });
    }
    const chosen = selectedPiece();
    if (chosen) {
      const [w, h, d] = chosen.size;
      items.push({
        text: labelOf(chosen),
        sub: `${formatSize(w, d, units)}, ${formatLength(h, units)} high`,
        x: chosen.position[0], y: (chosen.elevation ?? 0) + h + 0.25, z: chosen.position[1], piece: true,
      });
    }
    while (labelPool.length < items.length) {
      const el = document.createElement('div');
      el.append(document.createElement('strong'), document.createElement('span'));
      labelLayer.append(el);
      labelPool.push(el);
    }
    const { innerWidth: w, innerHeight: h } = window;
    labelPool.forEach((el, i) => {
      const item = items[i];
      el.hidden = !item;
      if (!item) return;
      spot.set(item.x, lv().elevation + item.y, item.z).project(plan.camera);
      el.style.transform = `translate(-50%, -50%) translate(${((spot.x + 1) / 2) * w}px, ${((1 - spot.y) / 2) * h}px)`;
      el.classList.toggle('piece', !!item.piece);
      if (el.firstElementChild!.textContent !== item.text) el.firstElementChild!.textContent = item.text;
      if (el.lastElementChild!.textContent !== item.sub) el.lastElementChild!.textContent = item.sub;
    });
  }


  /**
   * The top view shows one storey: everything above it is hidden, and so
   * are its own ceilings, roof and lamps. The storeys below stay, so the
   * pool shows from upstairs.
   */
  function showLevels(): void {
    levels.forEach((l, i) => {
      // An open roof terrace comes off with the roof in the whole-house view.
      const lifted = inOrbit && roofHidden && i > roofed;
      const shown = (!inTopView || i <= level) && !lifted;
      l.shell.visible = l.furniture.group.visible = shown;
      // In the whole-house view the roof of the top storey can come off.
      const lid = !(inTopView && i === level) && !(inOrbit && roofHidden && i === roofed);
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
    plan.lookAtHeight(lv().elevation);
    levelButtons.forEach((b, j) => b.classList.toggle('active', j === i));
    showLevels();
    updateHint();
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
        (f) =>
          (f.lower === level || f.upper === level) &&
          p.x > f.x0 && p.x < f.x1 &&
          p.y > Math.min(f.yTop, f.yBottom) && p.y < Math.max(f.yTop, f.yBottom),
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
    tourButton.textContent = tour ? '■ Stop tour' : '▶ Tour';
    tourButton.classList.toggle('active', !!tour);
    if (tour) {
      wholeButton.classList.remove('active');
      planButtons.forEach((b) => b.classList.remove('active'));
      walkButton.classList.remove('active');
      document.getElementById('hint-title')!.textContent = tour.room ? `Tour: ${tour.room}` : 'Tour';
      document.getElementById('hint-text')!.textContent = 'Click the view or press any key to stop and take over';
      return;
    }
    wholeButton.classList.toggle('active', inOrbit);
    planButtons.forEach((b, i) => b.classList.toggle('active', inTopView && i === level));
    walkButton.classList.toggle('active', !inOrbit && !inTopView);
    roofButton.textContent = roofHidden ? 'Show roof' : 'Hide roof';
    dimensionsButton.textContent = dimensions ? 'Hide dimensions' : 'Show dimensions';
    dimensionsButton.classList.toggle('active', dimensions);
    if (inOrbit) {
      document.getElementById('hint-title')!.textContent = home.title;
      document.getElementById('hint-text')!.textContent =
        'Drag to turn it · scroll to zoom · pick a floor plan, or Walk through to go inside';
      return;
    }
    document.getElementById('hint-title')!.textContent = inTopView
      ? `${lv().name}: plan`
      : painting
        ? 'Click a surface to paint it'
        : 'Click the room to look around';
    document.getElementById('hint-text')!.textContent = inTopView
      ? painting
        ? 'Click a floor, wall or piece, then choose a colour · drag the background to turn the plan'
        : 'Click a piece to select it · drag to move · R to turn · drag the background to turn the plan'
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

  // In the whole-house view a drag turns the home and the wheel zooms.
  let turning: { x: number; y: number } | null = null;
  canvas.addEventListener('wheel', (e) => {
    if (!inOrbit && !inTopView) return;
    e.preventDefault();
    turnable().zoom(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (tour) {
      stopTour();
      return;
    }
    // The hint has done its job once the view is touched.
    document.body.classList.add('hint-gone');
    if (inOrbit) {
      turning = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
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
    // In a plan, dragging anything but a piece of furniture turns the plan.
    const id = mode === 'paint' ? undefined : pickFurniture(e);
    if (!id && inTopView) {
      turning = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    }
    if (mode === 'paint') return;
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
    if (turning) {
      turnable().turn(-(e.clientX - turning.x) * 0.006, -(e.clientY - turning.y) * 0.005, true);
      turning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drag) {
      // Show that a piece can be picked up.
      if (mode === 'furniture' && !controls.locked && !inOrbit) canvas.style.cursor = pickFurniture(e) ? 'grab' : '';
      return;
    }
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
    const moved = moveFurniture(now(), drag.id, target);
    preview(moved);
    // Red while the piece cannot follow the mouse: a wall or another piece is in the way.
    const at = moved.furniture.find((f) => f.id === drag!.id)!.position;
    setBlocked(Math.hypot(at[0] - target[0], at[1] - target[1]) > 0.08);
  });

  canvas.addEventListener('pointerup', (e) => {
    turning = null;
    if (inOrbit || e.button !== 0) return;
    const wasClick = press !== null && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5;
    press = null;
    if (drag) {
      drag = null;
      setBlocked(false);
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
    // Any key during the tour hands control back, right where the tour is.
    if (tour && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      stopTour();
      if (e.code === 'Escape') return;
    }
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
      setTopView(inOrbit || !inTopView);
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

  // ---- Touch screens: pinch to zoom, a stick to walk, a panel that folds away ----

  const touches = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2 || (!inOrbit && !inTopView)) return;
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) turnable().zoom(pinch / d);
    pinch = d;
    turning = null; // two fingers zoom; they do not also turn
  });
  const lift = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = 0;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  if (window.matchMedia('(pointer: coarse)').matches) {
    document.body.classList.add('touch');
    const pad = document.createElement('div');
    pad.id = 'walk-pad';
    pad.innerHTML = '<div class="knob"></div>';
    pad.title = 'Push to walk';
    document.body.append(pad);
    const knob = pad.firstElementChild as HTMLElement;
    let held: number | null = null;
    const push = (e: PointerEvent): void => {
      const r = pad.getBoundingClientRect();
      const reach = r.width / 2;
      let dx = (e.clientX - (r.left + reach)) / reach;
      let dy = (e.clientY - (r.top + reach)) / reach;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      knob.style.transform = `translate(${dx * reach * 0.6}px, ${dy * reach * 0.6}px)`;
      controls.setStick(-dy, dx);
    };
    pad.addEventListener('pointerdown', (e) => {
      held = e.pointerId;
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        // Not every browser can capture a touch; the stick still works while the finger stays on it.
      }
      document.body.classList.add('hint-gone');
      push(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === held) push(e);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== held) return;
      held = null;
      knob.style.transform = '';
      controls.setStick(0, 0);
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
  }

  // On a phone the editing tools fold away under a "More" button.
  const more = document.createElement('button');
  more.id = 'panel-more';
  more.type = 'button';
  const showMore = (open: boolean): void => {
    document.body.classList.toggle('panel-open', open);
    more.textContent = open ? 'Less ▴' : 'Edit ▾';
  };
  more.addEventListener('click', () => showMore(!document.body.classList.contains('panel-open')));
  showMore(false);
  document.getElementById('home-bar')!.append(more);

  // ---- The tour: a hands-free walk through every room ----

  /** The tour being played: one storey at a time, in `order`. */
  let tour: { player: TourPlayer; order: number[]; step: number; room?: string; fade: number } | null = null;
  const fader = document.createElement('div');
  fader.id = 'fade';
  document.body.append(fader);

  /** The tour route of storey `i`, from `from` if it is inside a room there. */
  function routeFor(i: number, from?: { x: number; y: number }) {
    const scene = history.current[i];
    const inside = from ? roomAt(scene, from) : undefined;
    let startRoom = inside?.id;
    if (!startRoom) {
      // Upstairs, begin by the top of the stairs; elsewhere at the room nearest the start.
      const flight = stairs.find((s) => s.upper === i);
      const near = flight ? { x: (flight.x0 + flight.x1) / 2, y: flight.yTop + 0.4 * Math.sign(flight.yTop - flight.yBottom) } : from ?? { x: spawn.position[0], y: spawn.position[1] };
      const rooms = scene.rooms.filter((r) => r.kind !== 'void');
      const byDistance = rooms.map((r) => ({ r, p: openSpot(r, scene.furniture) }))
        .sort((a, b) => Math.hypot(a.p.x - near.x, a.p.y - near.y) - Math.hypot(b.p.x - near.x, b.p.y - near.y));
      startRoom = roomAt(scene, near)?.id ?? byDistance[0]?.r.id;
    }
    return tourRoute(scene, levels[i].walls, startRoom, inside ? from : undefined);
  }

  function startTour(): void {
    const walking = !inOrbit && !inTopView;
    const first = walking ? level : 0;
    if (!walking) setTopView(false);
    controls.unlock();
    controls.enabled = false;
    selectedId = null;
    paintTarget = null;
    const order = [first, ...levels.map((_, i) => i).filter((i) => i !== first)];
    const route = routeFor(first, walking ? controls.pose : undefined);
    if (route.path.length === 0) {
      controls.enabled = true;
      panel.toast('There are no rooms to tour here.');
      return;
    }
    const p = route.path[0];
    if (!walking || level !== first) goTo(first, { position: [p.x, p.y], yawDeg: THREE.MathUtils.radToDeg(controls.pose.yaw) });
    tour = { player: new TourPlayer(route, controls.pose.yaw), order, step: 0, fade: 0 };
    document.body.classList.add('touring');
    document.body.classList.remove('hint-gone');
    updateHint();
    refresh();
  }

  function stopTour(): void {
    tour = null;
    controls.enabled = !inTopView && !inOrbit;
    fader.style.opacity = '0';
    document.body.classList.remove('touring');
    updateHint();
  }

  /** Called every frame while the tour plays. */
  function playTour(dt: number): void {
    const t = tour!;
    // Between storeys the view fades out, jumps, and fades back in.
    if (t.fade > 0) {
      t.fade -= dt;
      fader.style.opacity = String(Math.min(1, Math.max(0, t.fade / 0.5)));
    }
    const frame = t.player.update(dt);
    controls.teleport(frame.x, frame.y, THREE.MathUtils.radToDeg(frame.yaw), -6);
    if (frame.room !== t.room && frame.room) {
      t.room = frame.room;
      updateHint();
    }
    if (!frame.done) return;
    t.step += 1;
    if (t.step >= t.order.length) {
      stopTour();
      panel.toast('That was every room. Walk on from here, or press Tour to see it again.');
      return;
    }
    const next = t.order[t.step];
    const route = routeFor(next);
    const start = route.path[0];
    if (!start) return;
    goTo(next, { position: [start.x, start.y], yawDeg: THREE.MathUtils.radToDeg(frame.yaw) });
    controls.enabled = false;
    t.player = new TourPlayer(route, frame.yaw);
    t.fade = 1;
    fader.style.opacity = '1';
  }

  // ---- Views: share a link to this view, and keep views to come back to ----

  /** The view on screen now, as it goes into a link. */
  function currentView(): ViewState {
    if (inOrbit) return { view: 'whole', floor: level, cam: orbit.state };
    if (inTopView) return { view: 'plan', floor: level, cam: plan.state };
    const p = controls.pose;
    return { view: 'walk', floor: level, at: [p.x, p.y, THREE.MathUtils.radToDeg(p.yaw), controls.pitchDeg] };
  }

  /** Shows a view from a link or a saved view. */
  function showView(v: ViewState): void {
    if (tour) stopTour();
    if (v.view === 'whole') {
      setOrbit();
      if (v.cam) orbit.restore(v.cam);
    } else if (v.view === 'plan') {
      if (v.floor !== level) goTo(v.floor);
      setTopView(true);
      if (v.cam) plan.restore(v.cam);
    } else {
      setTopView(false);
      if (v.at) {
        goTo(v.floor, { position: [v.at[0], v.at[1]], yawDeg: v.at[2] });
        controls.teleport(v.at[0], v.at[1], v.at[2], v.at[3]);
      } else if (v.floor !== level) {
        goTo(v.floor);
      }
    }
  }

  const linkTo = (v: ViewState): string => {
    const base = new URLSearchParams(window.location.search);
    base.set('home', home.id);
    return `${window.location.origin}${window.location.pathname}?${viewToParams(v, base)}`;
  };

  async function shareView(): Promise<void> {
    const link = linkTo(currentView());
    try {
      await navigator.clipboard.writeText(link);
      panel.toast('Link copied. It opens this exact view; furniture and colour changes are not in it.');
    } catch {
      // Some browsers refuse the clipboard; show the link so it can be copied by hand.
      window.history.replaceState(null, '', link);
      panel.toast('The address bar now holds the link to this view. Copy it from there.');
    }
  }

  /** Views kept in this browser, per home. */
  interface SavedView { name: string; state: ViewState }
  const storeKey = `stepinside.views.${home.id}`;
  const readSaved = (): SavedView[] => {
    try {
      const list = JSON.parse(localStorage.getItem(storeKey) ?? '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeSaved = (list: SavedView[]): void => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(list));
    } catch {
      panel.toast('This browser will not keep saved views (private window?).');
    }
  };

  const savedBox = document.createElement('div');
  savedBox.id = 'saved-views';
  savedBox.hidden = true;
  savedBox.innerHTML = `
    <div class="saved-head"><strong>Saved views</strong><span>Kept in this browser</span></div>
    <form class="row"><input type="text" id="saved-name" maxlength="40" aria-label="Name for this view" /><button type="submit">Save this view</button></form>
    <ul></ul>
    <p class="muted" id="saved-empty">Nothing saved yet. Find a good spot, give it a name and save it.</p>`;
  // It opens above the view bar, as part of it.
  document.getElementById('view-bar')!.prepend(savedBox);
  savedBox.addEventListener('keydown', (e) => e.stopPropagation());
  const nameBox = savedBox.querySelector<HTMLInputElement>('#saved-name')!;

  /** A name for the view on screen, such as "Living room" or "Ground floor plan". */
  const suggestName = (): string => {
    if (inOrbit) return scenes[0].site ? 'Whole house' : 'Whole home';
    const floorName = levels.length > 1 ? lv().name : 'Floor';
    if (inTopView) return `${floorName} plan`;
    const room = roomAt(now(), controls.pose)?.name;
    return room ?? (levels.length > 1 ? lv().name : 'Walk');
  };

  function renderSaved(): void {
    const list = readSaved();
    savedBox.querySelector('#saved-empty')!.toggleAttribute('hidden', list.length > 0);
    savedBox.querySelector('ul')!.replaceChildren(
      ...list.map((item, i) => {
        const li = document.createElement('li');
        const go = document.createElement('button');
        go.className = 'go';
        go.textContent = item.name;
        go.title = 'Go to this view';
        go.addEventListener('click', () => {
          showView(item.state);
          savedBox.hidden = true;
        });
        const copy = document.createElement('button');
        copy.textContent = 'Link';
        copy.title = 'Copy a link to this view';
        copy.addEventListener('click', () => {
          void navigator.clipboard.writeText(linkTo(item.state)).then(
            () => panel.toast(`Link to "${item.name}" copied.`),
            () => panel.toast('The browser would not copy the link.'),
          );
        });
        const remove = document.createElement('button');
        remove.textContent = '×';
        remove.title = 'Forget this view';
        remove.addEventListener('click', () => {
          writeSaved(readSaved().filter((_, j) => j !== i));
          renderSaved();
        });
        li.append(go, copy, remove);
        return li;
      }),
    );
  }

  savedBox.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameBox.value.trim() || suggestName();
    writeSaved([...readSaved(), { name, state: currentView() }]);
    nameBox.value = '';
    nameBox.placeholder = suggestName();
    renderSaved();
    panel.toast(`Saved "${name}".`);
  });

  function toggleSaved(): void {
    savedBox.hidden = !savedBox.hidden;
    savedButton.classList.toggle('active', !savedBox.hidden);
    if (savedBox.hidden) return;
    nameBox.value = '';
    nameBox.placeholder = suggestName();
    renderSaved();
  }

  // ---- Sizing and the render loop ----

  function resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // On a phone the panel sits across the top, so nothing moves aside for it,
    // and the sun panel joins the view bar at the bottom.
    const phone = w <= 700;
    const side = phone ? 0 : PANEL_WIDTH;
    const bottom = phone ? 210 : 130;
    topView.resize(w, h, side);
    // Keep the home clear of the view bar, and in a plan of the panel too.
    orbit.resize(w, h, 0, bottom);
    plan.resize(w, h, side, bottom);
  }
  window.addEventListener('resize', resize);
  resize();
  setLevel(0);
  // Open on the whole home, unless the address asks for another view.
  showView(viewFromParams(new URLSearchParams(window.location.search), levels.length));

  let lastRoom: string | undefined;
  const timer = new THREE.Timer();
  // The render loop: the browser calls this before every screen refresh.
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1);
    controls.update(dt);
    if (inOrbit) orbit.update(dt);
    if (inTopView) plan.update(dt);
    placeLabels();
    if (tour) playTour(dt);
    else walkStairs();
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
  Object.assign(window, { walkthrough: { history, camera, controls, world, setTopView, setOrbit, orbit, goTo, planCamera: plan.camera, topCamera: topView.camera, startTour, stopTour, currentView, showView } });
}

// The address picks the home: ?home=apartment. Without it, the start
// screen lists the homes to choose from.
const params = new URLSearchParams(window.location.search);
const chosen = HOMES.find((h) => h.id === params.get('home'));

if (!chosen) {
  document.getElementById('panel')!.hidden = true;
  document.getElementById('hint')!.hidden = true;
  document.getElementById('view-bar')!.hidden = true;
  document.getElementById('chooser')!.hidden = false;
  document.getElementById('chooser-list')!.replaceChildren(
    // A home with several designs is listed once; its designs are picked inside.
    ...HOMES.filter((h, i) => !h.design || HOMES.findIndex((o) => o.design?.group === h.design?.group) === i).map((h) => {
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
    // The designs of this home, in a dropdown. Picking one loads it in the same view.
    const designs = HOMES.filter((h) => chosen.design && h.design?.group === chosen.design.group);
    const picker = document.querySelector<HTMLSelectElement>('#design')!;
    picker.hidden = designs.length < 2;
    picker.replaceChildren(
      ...designs.map((h) => {
        const option = document.createElement('option');
        option.value = h.id;
        option.textContent = h.design!.name;
        option.selected = h === chosen;
        return option;
      }),
    );
    picker.addEventListener('change', () => {
      const next = new URLSearchParams(params);
      next.set('home', picker.value);
      window.location.search = next.toString();
    });
    const scenes = chosen.levels.map((l) => parseScene(l.json));
    // The photographed surfaces load first (a few seconds at most), so the
    // floors and walls appear with them rather than switching over later.
    void loadSurfaces(6000)
      .then(() => start(chosen, scenes))
      .catch(showStartError);
  } catch (error) {
    showStartError(error);
  }
}

function showStartError(error: unknown): void {
  const panel = document.querySelector<HTMLElement>('#error')!;
  panel.hidden = false;
  panel.textContent =
    error instanceof SceneError ? error.message : `Could not start: ${String(error)}`;
  if (!(error instanceof SceneError)) throw error;
}

/**
 * The sun panel: pick a date and drag the time of day, and the sun moves
 * along its real path for the home's town, with sunrise and sunset colours.
 */
function setUpSunControls(place: Place & { name: string }, daylight: Daylight): void {
  const bar = document.createElement('div');
  bar.id = 'sun-bar';
  bar.innerHTML = `
    <div class="sun-head"><strong>Sun</strong><span>${place.name}</span><button type="button" id="sun-now">Now</button></div>
    <input type="date" id="sun-date" aria-label="Date" />
    <input type="range" id="sun-time" min="0" max="24" step="0.25" aria-label="Time of day" />
    <div class="sun-read"><span id="sun-clock"></span><span id="sun-span"></span></div>`;
  document.body.append(bar);
  const dateInput = bar.querySelector<HTMLInputElement>('#sun-date')!;
  const timeInput = bar.querySelector<HTMLInputElement>('#sun-time')!;
  const clock = bar.querySelector<HTMLElement>('#sun-clock')!;
  const span = bar.querySelector<HTMLElement>('#sun-span')!;

  /** The date and clock time it is now in the home's town. */
  const now = (): { date: string; hours: number } => {
    const local = new Date(Date.now() + place.utcOffset * 3600_000);
    return {
      date: local.toISOString().slice(0, 10),
      hours: local.getUTCHours() + local.getUTCMinutes() / 60,
    };
  };

  const update = (): void => {
    const [y, m, d] = dateInput.value.split('-').map(Number);
    if (!y) return;
    const hours = Number(timeInput.value);
    const sun = sunPosition(place, y, m, d, hours);
    daylight.setSun(sun.azimuthDeg, sun.elevationDeg);
    const times = sunTimes(place, y, m, d);
    clock.textContent = clockText(hours);
    span.textContent = `sunrise ${clockText(times.rise)} · sunset ${clockText(times.set)}`;
  };

  // Opens on today at 10 am, or at ?time=17.5 when given (handy for comparing).
  const params = new URLSearchParams(window.location.search);
  dateInput.value = params.get('date') ?? now().date;
  timeInput.value = params.get('time') ?? '10';
  dateInput.addEventListener('input', update);
  timeInput.addEventListener('input', update);
  bar.querySelector('#sun-now')!.addEventListener('click', () => {
    const n = now();
    dateInput.value = n.date;
    timeInput.value = String(Math.round(n.hours * 4) / 4);
    update();
  });
  // Keys typed into the panel should not also walk or turn the camera.
  bar.addEventListener('keydown', (e) => e.stopPropagation());
  update();
}
