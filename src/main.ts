import * as THREE from 'three';
import { CATALOGUE } from './core/catalogue';
import {
  addFurniture, colorOf, emptyRoom, materialOf, moveFurniture, paint, paintRoomWalls, putBack, raiseFurniture, resizeFurniture,
  resetLayout, resetPaint, roomAt, rotateFurniture, setMaterial, setRoomWallsMaterial, takeOut, type PaintTarget,
} from './core/edits';
import { applyStyle, STYLES } from './core/styles';
import { openSpot, tourRoute } from './core/tour';
import { viewFromParams, viewToParams, type ViewState } from './core/viewLink';
import { formatArea, summarizeAreas, type AreaSummary } from './core/areas';
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
import { addLighting, buildLamps, switchLamps, type Daylight } from './render/lighting';
import { clockText, sunPosition, sunTimes, type Place } from './core/sun';
import { applyShellColors, buildShell } from './render/sceneMesh';
import { loadSurfaces } from './render/textures';
import { OrbitView } from './render/orbitView';
import { buildStreet } from './render/site';
import { TopView } from './render/topView';
import type { Realistic } from './render/realistic';
import { FACINGS, facingOf, frontOnPlan, northFor, roomFacings, type RoomFacing } from './core/vastu';
import type { CatalogueItem } from './core/edits';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import '@fontsource-variable/archivo/wdth.css';
import { DRAG_TYPE, FurniturePanel, labelOf, type Mode } from './ui/furniturePanel';
import { hydrateIcons, setLabel, setTool } from './ui/icons';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
hydrateIcons();
const PANEL_WIDTH = 288;
/** True inside one side of the compare page: no panel, the views kept in step. */
const EMBED = window.parent !== window && new URLSearchParams(window.location.search).has('embed');

/** Where the owner's own choice of north is kept, per home. Declared before the page starts up, which reads it. */
const NORTH = 'stepinside.north.';

function start(home: HomeEntry, scenes: readonly Scene[]): void {
  document.getElementById('home-name')!.textContent = home.title;
  // The renderer draws the 3D scene into the canvas using WebGL (the GPU).
  /** Set once Realistic mode exists; it is built late, and things above it need to tell it of changes. */
  let realisticRef: { invalidate(): void } | undefined;
  /** Runs after the panel is redrawn, for the features added below it. */
  let afterRefresh: () => void = () => {};
  /** The recording of a tour, while one is being made. */
  let recorder: MediaRecorder | null = null;
  /** Rooms are labelled with the part of the plot they lie in, instead of their size. */
  let directions = false;
  let facings = new Map<string, RoomFacing>();
  let snapNext = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Shadows only change when the sun or something in the home moves, not when the
  // viewer does. Redrawing them every frame would draw the whole home twice for nothing,
  // so they are redrawn for a short while after each change and then left alone.
  renderer.shadowMap.autoUpdate = false;
  let shadowsUntil = performance.now() + 10_000;
  const touchShadows = (): void => { shadowsUntil = performance.now() + 1500; };
  // A held pointer may be dragging a piece of furniture.
  window.addEventListener('pointermove', (e) => { if (e.buttons) touchShadows(); }, { passive: true });
  for (const kind of ['pointerup', 'keyup', 'drop', 'change', 'input', 'click']) window.addEventListener(kind, touchShadows, { passive: true });
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
    furniture.onModel = () => { touchShadows(); realisticRef?.invalidate(); };
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
  const sunClock = !home.place ? null : setUpSunControls(home.place, {
      setSun: (azimuthDeg, elevationDeg) => {
        daylight.setSun(azimuthDeg, elevationDeg);
        touchShadows();
        realisticRef?.invalidate();
      },
    });

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
  /** Room sizes under the room names; off leaves just the names. */
  let sizes = false;
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
  let fast = new URLSearchParams(window.location.search).has('fast');

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

  /** Adds a piece in front of the walker. Set below, where the panel's actions are. */
  let addItem: (item: CatalogueItem) => void = () => {};
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
      if (item) addItem(item);
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
  addItem = (item) => {
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
  };

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
    afterRefresh();
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
  const viewButton = (label: string, title: string, run: () => void, iconName?: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = title;
    if (iconName) setLabel(button, iconName, label);
    else button.textContent = label;
    button.addEventListener('click', run);
    return button;
  };
  /** A view in the list: its name, and the key that goes to it. */
  const withKey = (button: HTMLButtonElement, key: string): HTMLButtonElement => {
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    button.append(kbd);
    return button;
  };
  /** A tool on the rail: an icon, with its name and key shown beside it on hover. */
  const tool = (name: string, label: string, key: string, run: () => void, glyph = ''): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.key = key;
    setTool(button, name, label, glyph);
    button.addEventListener('click', run);
    return button;
  };
  const wholeButton = withKey(viewButton(scenes[0].site ? 'Whole house' : 'Whole home', 'See it from outside: drag to turn, right-drag to move, scroll to zoom', setOrbit), 'H');
  const planButtons = levels.map((l, i) =>
    withKey(
      viewButton(levels.length > 1 ? `${l.name} plan` : 'Floor plan', 'This floor as a 3D plan with its sizes', () => {
        if (i !== level) goTo(i);
        setTopView(true);
      }),
      String(i + 1),
    ),
  );
  const walkButton = withKey(viewButton('Walk through', 'Walk it in first person', () => setTopView(false), 'walk'), 'Enter');
  walkButton.classList.add('primary');
  const tourButton = tool('play', 'Tour', 'G', () => (tour ? stopTour() : startTour()));
  const savedButton = tool('bookmark', 'Saved views', 'V', () => toggleSaved());
  const shareButton = tool('share', 'Share a link', 'C', () => void shareView());
  const areasButton = tool('areas', 'Areas', 'I', () => toggleAreas());
  let capturing = false;
  const pdfButton = tool('file', 'PDF', 'Shift P', () => exportPdf());
  const keysButton = tool('keys', 'Shortcuts', '?', () => toggleKeys());
  const realisticButton = tool('realistic', 'Realistic light (beta)', 'Y', () => setRealistic(!realistic.on));
  realisticButton.id = 'btn-realistic';
  const snapButton = tool('camera', 'Save a picture', 'Z', () => {
    snapNext = true;
  });
  const recordButton = tool('video', 'Record the tour', 'Shift G', () => recordTour());
  tourButton.id = 'btn-tour';
  viewBar.replaceChildren(wholeButton, ...planButtons, walkButton);
  document.getElementById('view-extras')!.replaceChildren(realisticButton, tourButton, recordButton, snapButton, savedButton, shareButton, areasButton, pdfButton, keysButton);
  const tools = document.getElementById('orbit-tools')!;
  const roofButton = tool('roof', 'Hide roof', 'O', () => {
    roofHidden = !roofHidden;
    showLevels();
    updateHint();
  });
  const dimensionsButton = tool('labels', 'Hide labels', 'N', () => {
    dimensions = !dimensions;
    updateHint();
  });
  const sizesButton = tool('ruler', 'Hide sizes', 'M', () => {
    if (!dimensions) return;
    sizes = !sizes;
    updateHint();
  });
  roofButton.id = 'btn-roof';
  dimensionsButton.id = 'btn-dimensions';
  sizesButton.id = 'btn-sizes';
  const flatButton = tool('', 'Flat 2D drawing', 'X', () => {
    plan.setFlat(!plan.flat);
    updateHint();
  }, '2D');
  flatButton.id = 'btn-flat';
  /** The camera that drags, the wheel and these buttons act on. */
  const turnable = (): OrbitView => (inOrbit ? orbit : plan);
  const turnLeft = tool('turn-left', 'Turn left', 'Q', () => turnable().turn(-Math.PI / 4));
  const turnRight = tool('turn-right', 'Turn right', 'E', () => turnable().turn(Math.PI / 4));
  const zoomIn = tool('plus', 'Zoom in', '+', () => turnable().zoom(0.8));
  const zoomOut = tool('minus', 'Zoom out', '-', () => turnable().zoom(1.25));
  const resetButton = tool('fit', 'Reset view', '0', () => turnable().reset());
  for (const b of [flatButton, turnLeft, turnRight, zoomIn, zoomOut]) b.classList.add('bare');
  tools.replaceChildren(flatButton, turnLeft, turnRight, zoomIn, zoomOut, resetButton, roofButton, dimensionsButton, sizesButton);

  // On a wide screen the list of views lives in the panel at the side and the tools on a
  // slim rail at the right, so nothing lies over the model. On a phone, and on each side
  // of the compare page (which has no panel), the views stay in a bar at the bottom.
  const wideScreen = window.matchMedia('(min-width: 701px)');
  const placeViews = (): void => {
    const aside = !EMBED && wideScreen.matches;
    if (aside) document.getElementById('home-box')!.after(viewBar);
    else document.getElementById('view-bar')!.append(viewBar);
    document.body.classList.toggle('views-aside', aside);
  };
  placeViews();
  wideScreen.addEventListener('change', placeViews);

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
      items.push({ text: room.name ?? room.id, sub: directions ? (facings.get(room.id)?.zone ?? '') : formatSize(size.width, size.depth, units), x: size.center[0], y: 0.05, z: size.center[1] });
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
      // With sizes off, rooms show only their names; a selected piece keeps its size.
      (el.lastElementChild as HTMLElement).hidden = !sizes && !directions && !item.piece;
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
    touchShadows();
    realisticRef?.invalidate();
    afterRefresh();
    const painting = mode === 'paint';
    setTool(tourButton, tour ? 'stop' : 'play', tour ? 'Stop tour' : 'Tour');
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
    setTool(roofButton, 'roof', roofHidden ? 'Show roof' : 'Hide roof');
    roofButton.classList.toggle('active', !roofHidden);
    setTool(dimensionsButton, 'labels', dimensions ? 'Hide labels' : 'Show labels');
    dimensionsButton.classList.toggle('active', dimensions);
    setTool(sizesButton, 'ruler', sizes ? 'Hide sizes' : 'Show sizes');
    setTool(flatButton, '', plan.flat ? 'Back to the 3D plan' : 'Flat 2D drawing', plan.flat ? '3D' : '2D');
    flatButton.classList.toggle('active', plan.flat);
    sizesButton.classList.toggle('active', sizes && dimensions);
    sizesButton.disabled = !dimensions;
    if (inOrbit) {
      document.getElementById('hint-title')!.textContent = home.title;
      document.getElementById('hint-text')!.textContent =
        'Drag to turn it · right-drag or Shift-drag to move it · scroll to zoom · pick a floor plan, or Walk through to go inside';
      return;
    }
    document.getElementById('hint-title')!.textContent = inTopView
      ? `${lv().name}: plan`
      : painting
        ? 'Click a surface to paint it'
        : 'Click the room to look around';
    document.getElementById('hint-text')!.textContent = inTopView
      ? painting
        ? 'Click a floor, wall or piece, then choose a colour · drag the background to turn the plan · right-drag to move it'
        : 'Click a piece to select it · drag to move · R to turn · drag the background to turn the plan · right-drag to move it'
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

  // In the whole-house view a drag turns the home and the wheel zooms. A
  // right-drag, Shift-drag or two fingers slide it across the screen instead.
  let turning: { x: number; y: number } | null = null;
  let panning: { x: number; y: number } | null = null;
  canvas.addEventListener('contextmenu', (e) => {
    if (inOrbit || inTopView) e.preventDefault();
  });
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
    if ((inOrbit || inTopView) && (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey))) {
      panning = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'move';
      return;
    }
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
    if (panning) {
      turnable().pan(e.clientX - panning.x, e.clientY - panning.y);
      panning = { x: e.clientX, y: e.clientY };
      return;
    }
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
    if (panning) {
      panning = null;
      canvas.style.cursor = '';
    }
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

  // ---- A key for every feature. The list here is also what the shortcuts card shows. ----

  const SHORTCUTS: [string, [string, string][]][] = [
    ['Views', [
      ['H', scenes[0].site ? 'Whole house' : 'Whole home'],
      [levels.length > 1 ? `1 to ${levels.length}` : '1', levels.length > 1 ? 'Plan of a floor' : 'Floor plan'],
      ['Enter', 'Walk through'],
      ['T', 'Switch between plan and walk'],
      ['Page Up / Down', 'Floor above or below'],
      ['G', 'Tour'],
    ]],
    ['Looking around', [
      ['Q  E', 'Turn left or right'],
      ['+  -', 'Zoom in or out'],
      ['0', 'Reset view'],
      ['X', 'Flat 2D or 3D plan'],
      ['O', 'Roof on or off'],
      ['N  M', 'Room names, sizes'],
      ['W A S D', 'Walk (Shift: faster)'],
      ['Y', 'Realistic light'],
      ['K  J', 'Night, lights on or off'],
      ['B', 'Directions and Vastu'],
    ]],
    ['Changing things', [
      ['F  P  L', 'Furniture, Paint, Style'],
      ['R', 'Turn the selected piece'],
      ['Delete', 'Take the piece out'],
      ['Ctrl/Cmd Z', 'Undo (with Shift: redo)'],
      ['Ctrl/Cmd S', 'Save the layout'],
    ]],
    ['Sharing', [
      ['C', 'Copy a link to this view'],
      ['V', 'Saved views'],
      ['I', 'Areas'],
      ['Shift P', 'Plans as a PDF'],
      ['Z', 'Save a picture'],
      ['Shift G', 'Record the tour'],
      ['?', 'This list'],
    ]],
  ];
  const keysPanel = document.createElement('section');
  keysPanel.id = 'keys';
  keysPanel.hidden = true;
  {
    const head = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'Keyboard shortcuts';
    head.append(title, viewButton('', 'Close', () => toggleKeys(), 'close'));
    const groups = document.createElement('div');
    groups.className = 'groups';
    for (const [name, rows] of SHORTCUTS) {
      const group = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = name;
      const list = document.createElement('dl');
      for (const [key, what] of rows) {
        const dt = document.createElement('dt');
        for (const part of key.split('  ')) {
          const kbd = document.createElement('kbd');
          kbd.textContent = part;
          dt.append(kbd);
        }
        const dd = document.createElement('dd');
        dd.textContent = what;
        list.append(dt, dd);
      }
      group.append(h, list);
      groups.append(group);
    }
    keysPanel.append(head, groups);
  }
  document.body.append(keysPanel);
  function toggleKeys(): void {
    keysPanel.hidden = !keysPanel.hidden;
    keysButton.classList.toggle('active', !keysPanel.hidden);
  }

  /** Runs the feature a plain key stands for. True if the key was one of them. */
  function quickKey(e: KeyboardEvent): boolean {
    const looking = inOrbit || inTopView;
    const onButton = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement;
    if (e.key === '?') toggleKeys();
    else if (e.code === 'KeyH') setOrbit();
    else if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey && planButtons[Number(e.code.slice(5)) - 1]) planButtons[Number(e.code.slice(5)) - 1].click();
    else if (e.code === 'Enter' && !onButton) setTopView(false);
    else if (e.code === 'KeyG' && e.shiftKey) recordTour();
    else if (e.code === 'KeyG') startTour();
    else if (e.code === 'KeyZ') snapNext = true;
    else if (e.code === 'KeyB') toggleDirections();
    else if (e.code === 'KeyK' && sunClock) toggleNight();
    else if (e.code === 'KeyJ') switchAllLights();
    else if (e.code === 'KeyY') setRealistic(!realistic.on);
    else if (e.code === 'KeyP' && e.shiftKey) void exportPdf();
    else if (e.code === 'KeyC') void shareView();
    else if (e.code === 'KeyV') toggleSaved();
    else if (e.code === 'KeyI') toggleAreas();
    else if (e.code === 'KeyQ' && looking) turnable().turn(-Math.PI / 4);
    else if (e.code === 'KeyE' && looking) turnable().turn(Math.PI / 4);
    else if ((e.key === '+' || e.key === '=') && looking) turnable().zoom(0.8);
    else if ((e.key === '-' || e.key === '_') && looking) turnable().zoom(1.25);
    else if (e.code === 'Digit0' && looking) turnable().reset();
    else if (e.code === 'KeyX' && inTopView) flatButton.click();
    else if (e.code === 'KeyO' && inOrbit) roofButton.click();
    else if (e.code === 'KeyN' && inTopView) dimensionsButton.click();
    else if (e.code === 'KeyM' && inTopView) sizesButton.click();
    else if (!EMBED && !inOrbit && (e.code === 'KeyF' || e.code === 'KeyP' || e.code === 'KeyL')) {
      document.getElementById(e.code === 'KeyF' ? 'tab-furniture' : e.code === 'KeyP' ? 'tab-paint' : 'tab-style')!.click();
    } else return false;
    return true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    // Any key during the tour hands control back, right where the tour is.
    if (tour && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      stopTour();
      return;
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
      if (!keysPanel.hidden) toggleKeys();
      selectedId = null;
      setPaintTarget(null);
    } else if (e.altKey) {
      return;
    } else if (quickKey(e)) {
      e.preventDefault();
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
  let pinchMid: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2 || (!inOrbit && !inTopView)) return;
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinch > 0) {
      turnable().zoom(pinch / d);
      // Moving both fingers together slides the home.
      if (pinchMid) turnable().pan(mid.x - pinchMid.x, mid.y - pinchMid.y);
    }
    pinch = d;
    pinchMid = mid;
    turning = null; // two fingers zoom and slide; they do not also turn
  });
  const lift = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
    if (touches.size < 2) {
      pinch = 0;
      pinchMid = null;
    }
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
    setLabel(more, open ? 'chevron-up' : 'chevron-down', open ? 'Less' : 'Edit');
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
    finishRecording();
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
    if (inTopView) return { view: 'plan', floor: level, cam: plan.state, ...(plan.flat ? { flat: true } : {}) };
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
      plan.setFlat(!!v.flat);
      if (v.cam) plan.restore(v.cam);
      updateHint();
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
        copy.title = 'Copy a link to this view';
        setLabel(copy, 'link');
        copy.addEventListener('click', () => {
          void navigator.clipboard.writeText(linkTo(item.state)).then(
            () => panel.toast(`Link to "${item.name}" copied.`),
            () => panel.toast('The browser would not copy the link.'),
          );
        });
        const remove = document.createElement('button');
        remove.title = 'Forget this view';
        setLabel(remove, 'close');
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
    const phone = w <= 700 && !EMBED;
    const side = phone || EMBED ? 0 : PANEL_WIDTH;
    const bottom = EMBED ? 100 : phone ? 210 : 130;
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

  // ---- Areas and the PDF of the plans ----

  const designName = home.design ? `${home.title}, ${home.design.name}` : home.title;
  const areas = (): AreaSummary => summarizeAreas(levels.map((l, i) => ({ name: l.name, scene: history.current[i] })));

  /** The area statement as an HTML table. */
  function areaTable(summary: AreaSummary): HTMLTableElement {
    const table = document.createElement('table');
    const row = (cells: string[], head = false): void => {
      const tr = table.insertRow();
      for (const text of cells) {
        const cell = document.createElement(head ? 'th' : 'td');
        cell.textContent = text;
        tr.append(cell);
      }
    };
    const a = (v: number): string => formatArea(v, units);
    row(['', 'Carpet', 'Built-up', 'Open (balconies, terraces, courts)'], true);
    for (const f of summary.floors) row([f.name, a(f.carpet), a(f.builtUp), a(f.outdoor)]);
    row(['Total', a(summary.carpet), a(summary.builtUp), a(summary.floors.reduce((s, f) => s + f.outdoor, 0))], true);
    return table;
  }

  function areaFacts(summary: AreaSummary): HTMLElement {
    const facts = document.createElement('dl');
    for (const [term, value] of [
      ['Plot', formatArea(summary.plot, units)],
      ['Ground coverage', `${Math.round(summary.coverage * 100)}%`],
      ['Floor area ratio', summary.far.toFixed(2)],
      ['Ground not built on', formatArea(summary.openGround, units)],
    ]) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      facts.append(dt, dd);
    }
    return facts;
  }

  const areasPanel = document.createElement('section');
  areasPanel.id = 'areas';
  areasPanel.hidden = true;
  document.body.append(areasPanel);
  function toggleAreas(): void {
    areasPanel.hidden = !areasPanel.hidden;
    areasButton.classList.toggle('active', !areasPanel.hidden);
    if (areasPanel.hidden) return;
    const summary = areas();
    const head = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'Areas';
    const close = viewButton('', 'Close', () => toggleAreas(), 'close');
    head.append(title, close);
    const note = document.createElement('p');
    note.textContent =
      'Carpet: floor inside the rooms. Built-up: rooms with their walls, to the outside face. Open areas such as a covered court count as open. Floor area ratio is all built-up area over the plot.';
    const rooms = document.createElement('details');
    const summaryLine = document.createElement('summary');
    summaryLine.textContent = 'Room by room';
    rooms.append(summaryLine);
    for (const f of summary.floors) {
      const list = document.createElement('table');
      const caption = list.createCaption();
      caption.textContent = f.name;
      for (const r of f.rooms) {
        const tr = list.insertRow();
        tr.insertCell().textContent = r.name;
        tr.insertCell().textContent = formatArea(r.area, units);
      }
      rooms.append(list);
    }
    areasPanel.replaceChildren(head, areaFacts(summary), areaTable(summary), note, rooms);
  }

  /**
   * The plans as a printable document: the area statement, then each floor
   * drawn flat with its room names and sizes. The browser's print dialog
   * saves it as a PDF.
   */
  let exporting = false;
  /** Waits for the browser to paint, so a message shows before slow work starts. */
  const painted = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  /** A full-screen note while the PDF is prepared; null hides it. */
  function busyNote(text: string | null): void {
    let note = document.getElementById('busy');
    if (!note) {
      note = document.createElement('div');
      note.id = 'busy';
      note.setAttribute('role', 'status');
      note.innerHTML = '<div><span class="spinner"></span><p></p><small></small></div>';
      document.body.append(note);
    }
    note.hidden = text === null;
    if (text !== null) note.querySelector('p')!.textContent = text;
  }
  function busyStep(text: string): void {
    const small = document.querySelector('#busy small');
    if (small) small.textContent = text;
  }

  async function exportPdf(): Promise<void> {
    if (exporting) return;
    exporting = true;
    pdfButton.disabled = true;
    setTool(pdfButton, 'file', 'Preparing…');
    busyNote('Preparing the PDF…');
    busyStep('Getting the plans ready');
    await painted();
    try {
      await buildPdf();
    } finally {
      busyNote(null);
      pdfButton.disabled = false;
      setTool(pdfButton, 'file', 'PDF');
      capturing = false;
      exporting = false;
    }
    setTimeout(() => window.print(), 50);
  }

  async function buildPdf(): Promise<void> {
    const before = currentView();
    const wasFlat = plan.flat;
    const wasDimensions = dimensions;
    const [w, h] = [1200, 1600];
    // The render loop stands aside while the plans are drawn at print size.
    capturing = true;
    renderer.setSize(w, h, false);
    plan.resize(w, h, 0, 0);
    const images: { name: string; src: string }[] = [];
    for (const [i, l] of levels.entries()) {
      busyStep(`Drawing the ${l.name.toLowerCase()} plan (${i + 1} of ${levels.length})`);
      await painted();
      if (i !== level) setLevel(i);
      if (!inTopView) setTopView(true);
      plan.setFlat(true);
      plan.reset();
      plan.snap();
      renderer.render(world, plan.camera);
      const shot = document.createElement('canvas');
      shot.width = w;
      shot.height = h;
      const g = shot.getContext('2d')!;
      g.drawImage(renderer.domElement, 0, 0, w, h);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const room of history.current[i].rooms) {
        if (room.kind === 'void') continue;
        const size = roomSize(room);
        spot.set(size.center[0], l.elevation + 0.05, size.center[1]).project(plan.camera);
        const x = ((spot.x + 1) / 2) * w;
        const y = ((1 - spot.y) / 2) * h;
        const name = room.name ?? room.id;
        const sub = formatSize(size.width, size.depth, units);
        g.font = '600 20px system-ui, sans-serif';
        const width = Math.max(g.measureText(name).width, (g.font = '17px system-ui, sans-serif', g.measureText(sub).width)) + 18;
        g.fillStyle = 'rgba(255,255,255,0.88)';
        g.beginPath();
        g.roundRect(x - width / 2, y - 25, width, 50, 8);
        g.fill();
        g.fillStyle = '#22201d';
        g.font = '600 20px system-ui, sans-serif';
        g.fillText(name, x, y - 10);
        g.fillStyle = '#5d564d';
        g.font = '17px system-ui, sans-serif';
        g.fillText(sub, x, y + 12);
      }
      images.push({ name: l.name, src: shot.toDataURL('image/jpeg', 0.92) });
    }
    busyStep('Adding the area statement');
    await painted();
    plan.setFlat(wasFlat);
    dimensions = wasDimensions;
    capturing = false;
    resize();
    showView(before);

    const doc = document.getElementById('print') ?? document.createElement('div');
    doc.id = 'print';
    const cover = document.createElement('section');
    const title = document.createElement('h1');
    title.textContent = designName;
    const date = document.createElement('p');
    date.textContent = `Floor plans and areas · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const summary = areas();
    cover.append(title, date, areaFacts(summary), areaTable(summary));
    const pages = images.map(({ name, src }) => {
      const page = document.createElement('section');
      const heading = document.createElement('h2');
      heading.textContent = `${name} plan`;
      const img = document.createElement('img');
      img.src = src;
      img.alt = `${name} plan`;
      page.append(heading, img);
      return page;
    });
    doc.replaceChildren(cover, ...pages);
    document.body.append(doc);
    // Let the plan images decode before the print dialog lays out the pages.
    await Promise.all([...doc.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
  }

  // ---- Compare mode: this home is one side of a side-by-side page ----
  // The page passes views between its two sides, so turning, zooming or
  // walking on one side shows the same view of the other design.
  const embedded = EMBED;
  let lastSync = '';
  let lastSyncAt = 0;
  const viewKey = (v: ViewState): string => viewToParams(v, new URLSearchParams()).toString();
  if (embedded) {
    document.body.classList.add('embed');
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || e.data?.type !== 'stepinside-view') return;
      const v = e.data.state as ViewState;
      if (v.view === 'whole') {
        if (!inOrbit) setOrbit();
        if (v.cam) orbit.restore(v.cam);
      } else if (v.view === 'plan' && inTopView && v.floor === level) {
        if (plan.flat !== !!v.flat) {
          plan.setFlat(!!v.flat);
          updateHint();
        }
        if (v.cam) plan.restore(v.cam);
      } else if (v.view === 'walk' && !inOrbit && !inTopView && v.floor === level && v.at) {
        // Two designs have their walls in different places, so the same spot may be inside
        // a wall here. Follow by room instead: go to the room of the same name if this
        // design has one, and always look the same way.
        const here = roomAt(now(), controls.pose);
        const name = e.data.room as string | undefined;
        const match = name && (here?.name ?? here?.id) !== name ? now().rooms.find((r) => r.kind !== 'void' && (r.name ?? r.id) === name) : undefined;
        if (match) {
          const spot = openSpot(match, now().furniture);
          controls.teleport(spot.x, spot.y, v.at[2], v.at[3]);
        } else {
          controls.teleport(controls.pose.x, controls.pose.y, v.at[2], v.at[3]);
        }
      } else {
        showView(v);
      }
      lastSync = viewKey(currentView());
    });
  }
  /** Tells the compare page when the view here changes, a few times a second at most. */
  function syncView(time: number): void {
    if (!embedded || time - lastSyncAt < 60) return;
    const v = currentView();
    const key = viewKey(v);
    if (key === lastSync) return;
    lastSync = key;
    lastSyncAt = time;
    const room = v.view === 'walk' ? roomAt(now(), controls.pose) : undefined;
    window.parent.postMessage({ type: 'stepinside-view', state: v, room: room?.name ?? room?.id }, '*');
  }

  // ---- Realistic mode: a path-traced picture whenever the view rests ----

  const drawFast = (): void => {
    if (fast) {
      renderer.render(world, activeCamera());
    } else {
      renderPass.camera = occlusion.camera = activeCamera();
      occlusion.enabled = !(inTopView && plan.flat);
      composer.render();
    }
  };
  // The tracer is a large piece of code that most visits never use, so it is only
  // downloaded the first time Realistic light is switched on.
  const realistic = {
    on: false,
    maxPasses: 400,
    tracer: undefined as Realistic | undefined,
    wanted: false,
    get preparing(): boolean { return !this.tracer || this.tracer.preparing; },
    get passes(): number { return this.tracer?.passes ?? 0; },
    invalidate(): void { this.tracer?.invalidate(); },
    render(camera: THREE.Camera, time: number): boolean {
      if (!this.tracer) return false;
      this.tracer.on = this.on;
      return this.tracer.render(camera, time);
    },
    fetch(): void {
      if (this.wanted) return;
      this.wanted = true;
      import('./render/realistic').then(
        (module) => { this.tracer = new module.Realistic(renderer, world, drawFast); },
        () => {
          this.wanted = false;
          setRealistic(false);
          panel.toast('Realistic light could not be loaded. Check the connection and try again.');
        },
      );
    },
  };
  realisticRef = realistic;
  const realisticNote = document.createElement('div');
  realisticNote.id = 'realistic-note';
  realisticNote.hidden = true;
  realisticNote.setAttribute('role', 'status');
  document.body.append(realisticNote);
  let realisticText = '';
  function setRealistic(on: boolean): void {
    realistic.on = on;
    if (on) realistic.fetch();
    realistic.invalidate();
    realisticButton.classList.toggle('active', on);
    setTool(realisticButton, 'realistic', on ? 'Back to the fast picture' : 'Realistic light (beta)');
    realisticNote.hidden = !on;
    document.body.classList.toggle('realistic', on);
  }
  // Any change to the home, the floor on show or the sun means the light must be traced again.
  history.subscribe(() => realistic.invalidate());
  function drawRealistic(time: number): boolean {
    if (!realistic.on) return false;
    // A flat drawing has no light to trace, and a tour never rests.
    const possible = !(inTopView && plan.flat) && !tour;
    let drew = false;
    if (possible) {
      try {
        drew = realistic.render(activeCamera(), time);
      } catch (error) {
        console.error(error);
        setRealistic(false);
        panel.toast('Realistic light is not available on this device.');
        return false;
      }
    }
    const text = !possible
      ? 'Realistic light is for 3D views'
      : realistic.preparing
        ? 'Tracing the light…'
        : drew
          ? realistic.passes >= realistic.maxPasses
            ? 'Realistic light: done'
            : `Realistic light: pass ${realistic.passes} of ${realistic.maxPasses}`
          : 'Hold the view still for realistic light';
    if (text !== realisticText) {
      realisticText = text;
      realisticNote.textContent = text;
    }
    return drew;
  }


  // ---- Night and lights ----

  /** Lights switched off, as "storey:light id". Not part of the layout, so not undone or saved. */
  const lightsOff = new Set<string>();
  const lightKey = (storey: number, id: string): string => `${storey}:${id}`;
  const allLights = (): string[] => levels.flatMap((_, i) => (history.current[i].lights ?? []).map((l) => lightKey(i, l.id)));
  const roomLights = (): string[] => {
    const room = currentRoom();
    if (!room) return [];
    return (now().lights ?? [])
      .filter((l) => roomAt(now(), { x: l.position[0], y: l.position[1] })?.id === room.id)
      .map((l) => lightKey(level, l.id));
  };
  const roomLightsButton = document.getElementById('btn-room-lights') as HTMLButtonElement;
  let allLightsButton: HTMLButtonElement | null = null;
  let nightButton: HTMLButtonElement | null = null;
  function showLights(): void {
    levels.forEach((l, i) => switchLamps(l.lamps, (id) => !lightsOff.has(lightKey(i, id))));
    realistic.invalidate();
    labelLights();
  }
  function labelLights(): void {
    const inRoom = roomLights();
    roomLightsButton.disabled = inRoom.length === 0;
    setLabel(roomLightsButton, 'bulb', inRoom.length === 0 ? 'No lights' : inRoom.some((k) => !lightsOff.has(k)) ? 'Lights off' : 'Lights on');
    if (allLightsButton) allLightsButton.textContent = allLights().some((k) => !lightsOff.has(k)) ? 'Lights off' : 'Lights on';
  }
  /** Switches a set of lights: off if any of them is on, otherwise on. */
  function flip(keys: string[]): void {
    const anyOn = keys.some((k) => !lightsOff.has(k));
    for (const k of keys) {
      if (anyOn) lightsOff.add(k);
      else lightsOff.delete(k);
    }
    showLights();
  }
  const switchAllLights = (): void => flip(allLights());
  roomLightsButton.addEventListener('click', () => flip(roomLights()));

  // Night: the sun panel's clock jumps to nine in the evening, and back to where it was.
  let dayHours = 10;
  const isNight = (): boolean => !!sunClock && (sunClock.hours() < 6 || sunClock.hours() >= 19);
  function toggleNight(): void {
    if (!sunClock) return;
    if (isNight()) {
      sunClock.setHours(dayHours);
    } else {
      dayHours = sunClock.hours();
      sunClock.setHours(21);
    }
    labelNight();
  }
  const labelNight = (): void => {
    if (nightButton) nightButton.textContent = isNight() ? 'Day' : 'Night';
  };
  if (sunClock) {
    nightButton = document.createElement('button');
    nightButton.type = 'button';
    nightButton.title = 'See the home after dark, and back (K)';
    nightButton.addEventListener('click', toggleNight);
    allLightsButton = document.createElement('button');
    allLightsButton.type = 'button';
    allLightsButton.title = 'Switch every light in the home (J)';
    allLightsButton.addEventListener('click', switchAllLights);
    const row = document.createElement('div');
    row.className = 'sun-row';
    row.append(nightButton, allLightsButton);
    sunClock.head.parentElement!.append(row);
    sunClock.head.parentElement!.addEventListener('input', labelNight);
    sunClock.head.parentElement!.addEventListener('click', labelNight);
    labelNight();
  }

  // ---- A picture of the view, and a video of the tour ----

  const stamp = (): string => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  function download(blob: Blob, name: string): void {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }
  function recordTour(): void {
    if (recorder) {
      stopTour();
      return;
    }
    // MP4 plays everywhere, WhatsApp included; browsers that cannot make one give WebM.
    const type =
      typeof MediaRecorder === 'undefined'
        ? undefined
        : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) {
      panel.toast('This browser cannot record a video.');
      return;
    }
    if (tour) stopTour();
    startTour();
    if (!tour) return;
    const stream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    const made = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    made.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    made.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      const mp4 = type.includes('mp4');
      download(new Blob(chunks, { type: mp4 ? 'video/mp4' : 'video/webm' }), `${home.id}-tour-${stamp()}.${mp4 ? 'mp4' : 'webm'}`);
      panel.toast(mp4 ? 'Saved the tour as a video.' : 'Saved the tour as a WebM video. Some phones need it converted to MP4 to play it.');
    };
    made.start();
    recorder = made;
    recordButton.classList.add('active');
    setTool(recordButton, 'stop', 'Stop and save the video');
  }
  function finishRecording(): void {
    if (!recorder) return;
    const made = recorder;
    recorder = null;
    made.stop();
    recordButton.classList.remove('active');
    setTool(recordButton, 'video', 'Record the tour');
  }

  // ---- Compass, and where each room lies on the plot ----

  const plot = { minX: bounds.min.x, minY: bounds.min.y, maxX: bounds.max.x, maxY: bounds.max.y };
  const compass = document.createElement('button');
  compass.id = 'compass';
  compass.type = 'button';
  compass.title = 'Which way the home faces. Click for directions and Vastu (B)';
  compass.innerHTML =
    '<svg viewBox="-30 -30 60 60" aria-hidden="true"><g id="compass-dial">' +
    '<circle r="27" class="rim"/><path d="M0 -21 L5.5 0 L-5.5 0 Z" class="north"/><path d="M0 21 L5.5 0 L-5.5 0 Z" class="south"/>' +
    '<text y="-22.5" class="n">N</text></g></svg>';
  compass.addEventListener('click', () => toggleDirections());
  document.body.append(compass);
  document.body.classList.toggle('has-sun', !!sunClock);
  const dial = compass.querySelector<SVGGElement>('#compass-dial')!;
  const ownNorth = ownNorthOf(home.id) !== null;
  const northRad = THREE.MathUtils.degToRad(scenes[0].northDeg);
  let dialAt = '';
  /** Turns the compass so its N points north as the view sees it. */
  function turnCompass(): void {
    const m = activeCamera().matrixWorld.elements;
    // "Up the screen" along the ground: the way the camera looks when walking, its top edge when looking down.
    const ux = m[4] - m[8];
    const uz = m[6] - m[10];
    const nx = Math.sin(northRad);
    const nz = -Math.cos(northRad);
    const turn = `rotate(${(THREE.MathUtils.radToDeg(Math.atan2(nx * m[0] + nz * m[2], nx * ux + nz * uz))).toFixed(1)})`;
    if (turn === dialAt) return;
    dialAt = turn;
    dial.setAttribute('transform', turn);
  }

  // The plot cut in nine, drawn over a floor plan.
  const gridPoints: number[] = [];
  for (const t of [0, 1 / 3, 2 / 3, 1]) {
    const x = plot.minX + (plot.maxX - plot.minX) * t;
    const z = plot.minY + (plot.maxY - plot.minY) * t;
    gridPoints.push(x, 0, plot.minY, x, 0, plot.maxY, plot.minX, 0, z, plot.maxX, 0, z);
  }
  const zoneGrid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3)),
    new THREE.LineBasicMaterial({ color: 0xffd21f, depthTest: false, transparent: true }),
  );
  zoneGrid.renderOrder = 5;
  zoneGrid.visible = false;
  world.add(zoneGrid);

  const directionsPanel = document.createElement('section');
  directionsPanel.id = 'directions';
  directionsPanel.hidden = true;
  document.body.append(directionsPanel);
  function drawDirections(): void {
    zoneGrid.visible = directions && inTopView;
    zoneGrid.position.y = lv().elevation + 0.08;
    if (!directions) return;
    const list = roomFacings(now(), plot);
    facings = new Map(list.map((f) => [f.id, f]));
    const head = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `Directions: ${lv().name}`;
    head.append(title, viewButton('', 'Close', () => toggleDirections(), 'close'));
    const note = document.createElement('p');
    note.textContent =
      'The part of the plot each room lies in, and what Vastu tradition says of that kind of room there. It is a guide many owners ask for, not a rule of building.';
    const table = document.createElement('table');
    for (const f of list) {
      const row = table.insertRow();
      row.insertCell().textContent = f.name;
      row.insertCell().textContent = f.zone;
      const says = row.insertCell();
      says.className = f.verdict ?? 'none';
      says.textContent =
        f.verdict === 'suits' ? 'Suits Vastu'
        : f.verdict === 'avoids' ? `Vastu avoids this; prefers ${f.prefers!.slice(0, 2).join(' or ').toLowerCase()}`
        : f.verdict === 'neutral' ? `Fine; Vastu prefers ${f.prefers!.slice(0, 2).join(' or ').toLowerCase()}`
        : '';
    }
    // Which way the home faces: the one thing the owner knows that the drawing may not say.
    const front = frontOnPlan(scenes[0].start?.position ?? [(plot.minX + plot.maxX) / 2, plot.maxY], plot);
    const facing = document.createElement('label');
    facing.className = 'facing';
    const choose = document.createElement('select');
    // Or the browser puts the old choice back after the page reopens.
    choose.autocomplete = 'off';
    const current = Math.round(facingOf(front, scenes[0].northDeg) / 45) % 8;
    FACINGS.forEach(([name, bearing], i) => choose.add(new Option(name, String(bearing), i === current, i === current)));
    choose.addEventListener('change', () => {
      try {
        localStorage.setItem(NORTH + home.id, String(northFor(front, Number(choose.value))));
        sessionStorage.setItem('stepinside.directions', '1');
      } catch {
        panel.toast('This browser would not keep the direction.');
        return;
      }
      // North turns the sun, the shadows, the compass and the zones, so the home is opened afresh.
      window.location.reload();
    });
    facing.append('The front of this home faces ', choose);
    const how = document.createElement('p');
    how.className = 'how';
    how.textContent =
      (ownNorth ? 'You set this. ' : 'This is taken from the drawing; check it. ') +
      'Not sure? Stand at your gate looking out at the street with the compass on your phone open: the direction it shows is the one to pick. The sun and shadows follow it too.';
    directionsPanel.replaceChildren(head, facing, how, note, table);
  }
  if (sessionStorage.getItem('stepinside.directions')) {
    sessionStorage.removeItem('stepinside.directions');
    setTimeout(() => !directions && toggleDirections(), 0);
  }
  function toggleDirections(): void {
    directions = !directions;
    directionsPanel.hidden = !directions;
    compass.classList.toggle('active', directions);
    if (directions && !inTopView && !inOrbit) panel.toast('Open a floor plan to see the plot cut into its nine zones.');
    drawDirections();
  }

  // ---- My pieces: furniture kept with its real size, to use again in any room ----

  const MINE = 'stepinside.pieces';
  let mine: CatalogueItem[] = [];
  try {
    const kept = JSON.parse(localStorage.getItem(MINE) ?? '[]');
    if (Array.isArray(kept)) mine = kept.filter((k) => k && typeof k.model === 'string' && Array.isArray(k.size) && k.size.length === 3);
  } catch {
    // Nothing kept, or a browser that does not allow it.
  }
  const mineBox = document.getElementById('mine-box')!;
  const mineList = document.getElementById('mine')!;
  function drawMine(): void {
    mineBox.hidden = mine.length === 0;
    mineList.replaceChildren(
      ...mine.map((item, i) => {
        const row = document.createElement('li');
        const add = document.createElement('button');
        add.type = 'button';
        add.title = `Add: ${item.name}`;
        const name = document.createElement('strong');
        name.textContent = item.name;
        const size = document.createElement('span');
        size.textContent = `${formatSize(item.size[0], item.size[2], units)}, ${formatLength(item.size[1], units)} high`;
        add.append(name, size);
        add.addEventListener('click', () => {
          addItem(item);
          add.blur();
        });
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.title = `Forget: ${item.name}`;
        setLabel(drop, 'close');
        drop.addEventListener('click', () => {
          mine.splice(i, 1);
          keepMine();
        });
        row.append(add, drop);
        return row;
      }),
    );
  }
  function keepMine(): void {
    try {
      localStorage.setItem(MINE, JSON.stringify(mine));
    } catch {
      // Kept for this visit only.
    }
    drawMine();
  }
  document.getElementById('btn-save-piece')!.addEventListener('click', () => {
    const piece = selectedPiece();
    if (!piece || piece.fixed) return;
    const item: CatalogueItem = {
      key: `my-${piece.model}`,
      name: labelOf(piece),
      model: piece.model,
      size: [...piece.size],
      color: piece.color ?? '#b8b0a2',
      ...(piece.mount === 'wall' ? { mount: 'wall' as const, elevation: piece.elevation } : {}),
    };
    const same = (a: CatalogueItem): boolean => a.model === item.model && a.color === item.color && a.size.every((n, k) => Math.abs(n - item.size[k]) < 0.005);
    if (mine.some(same)) {
      panel.toast('That piece is already in My pieces.');
      return;
    }
    mine.push(item);
    keepMine();
    panel.toast(`Kept: ${item.name}. It is under My pieces, ready to add to any room.`);
  });
  drawMine();

  afterRefresh = () => {
    labelLights();
    drawDirections();
  };
  showLights();

  let lastRoom: string | undefined;
  const timer = new THREE.Timer();
  // The render loop: the browser calls this before every screen refresh.
  // If this device takes too long over each picture, drop the extra shading and the
  // finer pixels by itself. Nobody should have to know about ?fast to walk smoothly.
  let frames = 0;
  let slow = 0;
  let lastFrame = 0;
  function watchSpeed(began: number): void {
    const opening = document.querySelector('#opening');
    if (opening && frames === 2) {
      opening.classList.add('gone');
      setTimeout(() => opening.remove(), 400);
    }
    frames++;
    const now = performance.now();
    const gap = now - lastFrame;
    lastFrame = now;
    // The first pictures include one-off set-up work, and a hidden tab draws nothing.
    if (fast || realistic.on || frames < 20 || frames > 400 || document.hidden || gap > 1000) return;
    // Either drawing itself is slow, or the pictures arrive far apart.
    if (now - began > 40 || gap > 55) slow++;
    else slow = Math.max(0, slow - 1);
    if (slow < 12) return;
    fast = true;
    renderer.setPixelRatio(1);
    resize();
    panel.toast('Switched to lighter drawing to keep this smooth on your device.');
  }

  renderer.setAnimationLoop((time) => {
    timer.update(time);
    if (capturing) return;
    const dt = Math.min(timer.getDelta(), 0.1);
    controls.update(dt);
    if (inOrbit) orbit.update(dt);
    if (inTopView) plan.update(dt);
    placeLabels();
    syncView(time);
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
    turnCompass();
    if (tour || performance.now() < shadowsUntil) renderer.shadowMap.needsUpdate = true;
    const began = performance.now();
    if (drawRealistic(time)) {
      // The traced picture is on screen.
    } else if (fast) {
      renderer.render(world, activeCamera());
    } else {
      renderPass.camera = occlusion.camera = activeCamera();
      // A flat plan is a drawing: no shading in the corners.
      occlusion.enabled = !(inTopView && plan.flat);
      composer.render();
    }
    watchSpeed(began);
    if (snapNext) {
      // The picture is read in the same breath as it is drawn, before the browser clears it.
      snapNext = false;
      canvas.toBlob((blob) => blob && download(blob, `${home.id}-${stamp()}.png`), 'image/png');
      panel.toast('Saved a picture of this view.');
    }
  });

  // Handy in the browser console, and used by the automated screenshots.
  Object.assign(window, { walkthrough: { history, camera, controls, world, setTopView, setOrbit, orbit, goTo, planCamera: plan.camera, topCamera: topView.camera, startTour, stopTour, currentView, showView, plan, marker: topView.marker } });
}

// The address picks the home: ?home=apartment. Without it, the start
// screen lists the homes to choose from.
const params = new URLSearchParams(window.location.search);
const chosen = HOMES.find((h) => h.id === params.get('home'));

if (params.has('compare')) {
  startCompare(params);
} else if (!chosen) {
  document.getElementById('panel')!.hidden = true;
  document.getElementById('hint')!.hidden = true;
  document.getElementById('view-bar')!.hidden = true;
  document.querySelector('#opening')?.remove();
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
  document.querySelector<HTMLAnchorElement>('#home-change')!.href = back.size ? `?${back}` : 'studio.html';
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
    const compare = document.querySelector<HTMLAnchorElement>('#compare-link')!;
    const other = designs.find((h) => h !== chosen);
    compare.hidden = !other;
    if (other) {
      const query = new URLSearchParams(params);
      query.delete('home');
      query.set('compare', `${chosen.id},${other.id}`);
      compare.href = `?${query}`;
    }
    picker.addEventListener('change', () => {
      const next = new URLSearchParams(params);
      next.set('home', picker.value);
      window.location.search = next.toString();
    });
    const scenes = chosen.levels.map((l) => parseScene(l.json));
    // The owner may have said which way the home faces; that outranks the drawing.
    const north = ownNorthOf(chosen.id);
    if (north !== null) for (const scene of scenes) scene.northDeg = north;
    // The photographed surfaces load first (a few seconds at most), so the
    // floors and walls appear with them rather than switching over later.
    void loadSurfaces(6000)
      .then(() => start(chosen, scenes))
      .catch(showStartError);
  } catch (error) {
    showStartError(error);
  }
}

/**
 * Compare mode: two designs side by side, each a full copy of the app in a
 * frame. Views pass between them, so both always show the same angle.
 * ?compare=villa-d,villa-e
 */
function startCompare(params: URLSearchParams): void {
  document.querySelector('#opening')?.remove();
  for (const id of ['panel', 'hint', 'view-bar', 'chooser']) document.getElementById(id)!.hidden = true;
  canvas.hidden = true;
  document.body.classList.add('compare');
  const ids = (params.get('compare') ?? '').split(',');
  const first = HOMES.find((h) => h.id === ids[0]) ?? HOMES.find((h) => h.design) ?? HOMES[0];
  const choices = HOMES.filter((h) => !first.design || h.design?.group === first.design.group);
  const second = HOMES.find((h) => h.id === ids[1]) ?? choices.find((h) => h !== first) ?? first;

  const page = document.createElement('div');
  page.id = 'compare';
  const bar = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = 'Compare designs';
  const sync = document.createElement('label');
  sync.innerHTML = '<input type="checkbox" checked /> Move both sides together';
  sync.title = 'Turning, zooming and plans match exactly. In a walk each design has its own walls, so the other side goes to the room of the same name and looks the same way.';
  const syncBox = sync.querySelector('input')!;
  const brand = document.createElement('a');
  brand.className = 'mark';
  brand.href = './';
  brand.textContent = 'Step Inside';
  bar.append(brand);
  const back = document.createElement('a');
  back.textContent = 'Back to one design';
  bar.append(title, sync, back);
  const sides = document.createElement('div');
  sides.className = 'sides';
  page.append(bar, sides);
  document.body.append(page);

  // The view to open on: from the address, or the whole house.
  const view = new URLSearchParams();
  for (const key of ['view', 'floor', 'at', 'cam', 'flat', 'fast', 'date', 'time']) {
    const value = params.get(key);
    if (value !== null) view.set(key, value);
  }
  const picked = [first, second];
  const frames = picked.map((home, i) => {
    const side = document.createElement('section');
    const picker = document.createElement('select');
    picker.title = 'Pick the design for this side';
    picker.replaceChildren(
      ...choices.map((h) => {
        const option = document.createElement('option');
        option.value = h.id;
        option.textContent = h.design?.name ?? h.title;
        option.selected = h === home;
        return option;
      }),
    );
    const frame = document.createElement('iframe');
    frame.title = home.design?.name ?? home.title;
    const load = (id: string): void => {
      const query = new URLSearchParams(view);
      query.set('home', id);
      query.set('embed', '1');
      frame.src = `?${query}`;
    };
    load(home.id);
    picker.addEventListener('change', () => {
      picked[i] = HOMES.find((h) => h.id === picker.value) ?? picked[i];
      load(picker.value);
      updateAddress();
    });
    side.append(picker, frame);
    sides.append(side);
    return frame;
  });

  function updateAddress(): void {
    const next = new URLSearchParams(params);
    next.set('compare', picked.map((h) => h.id).join(','));
    history.replaceState(null, '', `?${next}`);
    const single = new URLSearchParams(params);
    single.delete('compare');
    single.set('home', picked[0].id);
    back.href = `?${single}`;
  }
  updateAddress();

  // Whatever one side shows, the other follows.
  window.addEventListener('message', (e) => {
    if (!syncBox.checked || e.data?.type !== 'stepinside-view') return;
    const from = frames.findIndex((f) => f.contentWindow === e.source);
    if (from < 0) return;
    frames[1 - from].contentWindow?.postMessage(e.data, '*');
  });
}

function ownNorthOf(homeId: string): number | null {
  try {
    const kept = localStorage.getItem(NORTH + homeId);
    const value = kept === null ? NaN : Number(kept);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function showStartError(error: unknown): void {
  document.querySelector('#opening')?.remove();
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
/** The clock of the sun panel, for the Night button and the keys. */
interface SunClock {
  hours(): number;
  setHours(hours: number): void;
  /** The row of buttons in the panel's head, for more buttons. */
  head: HTMLElement;
}

function setUpSunControls(place: Place & { name: string }, daylight: Daylight): SunClock {
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
  return {
    hours: () => Number(timeInput.value),
    setHours: (hours) => {
      timeInput.value = String(hours);
      update();
    },
    head: bar.querySelector<HTMLElement>('.sun-head')!,
  };
}
