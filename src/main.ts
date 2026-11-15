import * as THREE from 'three';
import { CATALOGUE } from './core/catalogue';
import {
  addFurniture, colorOf, emptyRoom, footprint, materialOf, moveFurniture, paint, paintRoomWalls, putBack, raiseFurniture, resizeFurniture,
  resetLayout, resetPaint, roomAt, rotateFurniture, setIndoorFloors, setMaterial, setRoomWallsMaterial, takeOut, type PaintTarget,
} from './core/edits';
import { applyStyle, STYLES } from './core/styles';
import { openSpot, tourRoute } from './core/tour';
import { viewFromParams, viewToParams, type ViewState } from './core/viewLink';
import { formatArea, polygonArea, summarizeAreas, type AreaSummary } from './core/areas';
import { anchorOf, canArrange, layoutsFor, roomOpenings, withRoomFrom, type Layout } from './core/arrange';
import { costLines, lineCost, quantitiesOf, totalQuantities, type Quantities } from './core/quantities';
import { TourPlayer } from './render/tourPlayer';
import { History } from './core/history';
import { HOMES, type HomeEntry, type StairEntry } from './homes';
import { loadLayout, saveLayout } from './core/layout';
import { formatLength, formatSize, roomSize, UNITS, type Units } from './core/measure';
import { parseScene, SceneError, toVec, type Room, type Scene } from './core/scene';
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
import { CATALOGUE_DRAG, DRAG_TYPE, FurniturePanel, labelOf, type Mode } from './ui/furniturePanel';
import { hydrateIcons, icon, setLabel, setTool } from './ui/icons';
import { edits, workOf, WORKS, type Work } from './ui/modes';
import { countChanges } from './core/session';
import { clearInFront } from './core/fit';
import { LayoutEditor } from './ui/layoutEditor';
import { facingEdges, outwardNormal } from './core/layoutEdits';
import { KitchenPanel } from './ui/kitchenPanel';

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
  /** While measuring or pinning a note, a click on the model goes here instead of selecting or walking. */
  let clickTaker: ((e: { clientX: number; clientY: number }) => void) | null = null;
  /** Shows the size of the piece under the mouse; set where the labels are built. */
  let hoverPiece: (id: string | undefined, e?: { clientX: number; clientY: number }) => void = () => {};
  /** Work done just before each picture is drawn, such as moving labels with the view. */
  const everyFrame: (() => void)[] = [];
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
  /** The walls, shell and walk-into lines of storey `i`, built from `scene`. */
  const buildStorey = (scene: Scene, i: number) => {
    const entry = home.levels[i];
    const walls = buildWalls(scene);
    const shell = buildShell(scene, walls, {
      roof: i === scenes.length - 1,
      raised: i > 0,
      openCeilings: entry.openCeilings,
    });
    shell.position.y = entry.elevation;
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
    return { walls, shell, collision };
  };
  /** The outlines of the rooms as text, to tell a moved wall from a new paint colour. */
  const roomShapes = (rooms: readonly Room[]): string => rooms.map((r) => `${r.id}:${r.polygon.flat().join(',')}`).join('|');
  const disposeTree = (object: THREE.Object3D): void => {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) child.geometry.dispose();
    });
  };
  const levels = scenes.map((original, i) => {
    const entry = home.levels[i];
    const { walls, shell, collision } = buildStorey(original, i);
    const furniture = new FurnitureView();
    furniture.onModel = () => { touchShadows(); realisticRef?.invalidate(); };
    const lamps = buildLamps(original);
    for (const object of [furniture.group, lamps]) object.position.y = entry.elevation;
    for (const object of [shell, furniture.group, lamps]) world.add(object);
    return {
      name: entry.name, elevation: entry.elevation, original, walls, shell, furniture, lamps, collision,
      painted: original as Pick<Scene, 'rooms' | 'solids'>,
      /** The rooms and openings the shell was last built from. */
      built: original as Pick<Scene, 'rooms' | 'openings'>,
    };
  });
  // The storey being walked and edited.
  let level = 0;
  const lv = () => levels[level];
  /** The room shown on its own on the plan, with everything else of the home hidden. */
  let alone: { level: number; room: string } | null = null;

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
  const plan = new OrbitView(bounds, 1, { azimuth: 0.3, polar: 0.5, reach: 1.5 });
  // The owner's own choice of units, kept in this browser, outranks the home's.
  const UNITS_KEY = 'stepinside.units';
  let units: Units = home.units ?? 'm';
  try {
    const kept = localStorage.getItem(UNITS_KEY);
    if (kept === 'cm' || kept === 'm' || kept === 'ft') units = kept;
  } catch {
    // Storage is off: the home's own units.
  }
  let dimensions = true;
  /** Room sizes under the room names; off leaves just the names. */
  let sizes = false;
  // A home without an outside to show, such as a flat, opens with its lid off.
  let roofHidden = !scenes[0].site;
  const street = scenes[0].site ? buildStreet(bounds, scenes[0].defaults.exteriorWallThickness, scenes[0].site.margin, spawn.position[0]) : null;
  if (street) world.add(street);
  world.add(topView.marker);
  let inTopView = false;
  const activeCamera = (): THREE.Camera => (inOrbit ? orbit.camera : inTopView ? plan.camera : camera);

  // Adding ?fast to the address skips the post-processing below, for
  // slow machines.
  let fast = new URLSearchParams(window.location.search).has('fast');
  /** The owner's own choice of drawing, which stops the automatic switch. */
  const DRAWING_KEY = 'stepinside.drawing';
  let drawingChosen = false;
  try {
    const kept = localStorage.getItem(DRAWING_KEY);
    if (kept === 'light' || kept === 'full') {
      drawingChosen = true;
      if (!fast) fast = kept === 'light';
    }
  } catch {
    // Storage is off: decide by speed.
  }
  /** True when the drawing went lighter by itself because this device was slow. */
  let autoLight = false;

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
  // The home opens in Explore, where a click only looks. In Furnish a click
  // picks a piece to move; in Finishes (paint, style) it picks a surface.
  let mode: Mode = 'explore';
  /** Change the layout, inside Plan mode. Set up once the plan view exists. */
  let layout: LayoutEditor | null = null;
  /** The Finishes tab last used, so the mode opens where it was left. */
  let lastFinish: Mode = 'paint';
  let paintTarget: PaintTarget | null = null;
  let pickingColor = false;
  const endColorDrag = (): void => {
    if (!pickingColor) return;
    history.endGesture();
    pickingColor = false;
  };
  /** Tells the page which mode it is in: the stylesheet shows that mode's tools. */
  const showMode = (): void => {
    const work = workOf(mode);
    document.body.dataset.mode = work;
    for (const { work: w, note } of WORKS) {
      const button = document.getElementById(`mode-${w}`)!;
      button.classList.toggle('active', w === work);
      button.setAttribute('aria-pressed', String(w === work));
      if (w === work) document.getElementById('mode-note')!.textContent = note;
    }
  };
  /** A view that cannot hold the current mode puts the panel back in Explore. */
  const fallToExplore = (): void => {
    if (mode === 'explore') return;
    endColorDrag();
    mode = 'explore';
    selectedId = null;
    paintTarget = null;
    showMode();
  };
  /**
   * Changes mode. Plan lives on the floor plan; Finishes and Furnish need to be
   * inside the home, so from the whole-house view they open the plan of this floor.
   */
  function setMode(next: Mode): void {
    if (next === mode) return;
    endColorDrag();
    const from = mode;
    mode = next;
    if (next === 'paint' || next === 'style') lastFinish = next;
    // Carry a selected piece over, so "select, then switch" works both ways.
    if (next === 'paint' && selectedId) paintTarget = { kind: 'furniture', id: selectedId };
    if (next === 'furniture' && from === 'paint' && paintTarget?.kind === 'furniture') selectedId = paintTarget.id;
    if (next !== 'furniture') selectedId = null;
    if (next !== 'paint') paintTarget = null;
    if (next !== 'plan' && layout?.on) layout.setOn(false);
    showMode();
    if ((next === 'plan' && !inTopView) || (edits(next) && inOrbit)) setTopView(true);
    updateHint();
    refresh();
  }
  const setWork = (work: Work): void =>
    setMode(work === 'furnish' ? 'furniture' : work === 'finishes' ? lastFinish : work);
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
    if (alone) return now().rooms.find((r) => r.id === alone!.room);
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
    setMode,
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
    setIndoorFloors: () => {
      if (paintTarget?.kind !== 'floor') return;
      const target = paintTarget;
      const scene = now();
      const room = scene.rooms.find((r) => r.id === target.room);
      const color = colorOf(scene, target);
      if (!room || !color) return;
      apply(setIndoorFloors(scene, room.floor?.material, color), 'Every room already has this floor.');
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
  const kitchen = new KitchenPanel(
    { now, apply, units: () => units, toast: (message) => panel.toast(message) },
    document.getElementById('kitchen-box')!,
  );
  addItem = (item) => {
    // On the plan, a new piece goes in the room on its own, or the middle of the view.
    if (inTopView) {
      const room = alone ? now().rooms.find((r) => r.id === alone!.room) : undefined;
      const side = document.getElementById('panel')!.getBoundingClientRect().right;
      const middle = room ? roomSize(room).center : floorPoint({ clientX: (side + innerWidth) / 2, clientY: innerHeight / 2 });
      if (!middle) return;
      const within = room ?? roomAt(now(), { x: middle[0], y: middle[1] });
      const result = addFurniture(now(), item, [mm(middle[0]), mm(middle[1])], 0, within?.kind === 'void' ? undefined : within?.id);
      if (apply(result.scene, 'This room has no free floor that size. Take something out, or try a smaller piece.') && result.id) {
        selectedId = result.id;
        refresh();
        panel.toast(`Added: ${item.name}. Drag it into place.`);
      }
      return;
    }
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
    let rebuilt = false;
    levels.forEach((l, i) => {
      const s = history.current[i];
      l.furniture.sync(s.furniture);
      // A moved wall or a new door changes the building itself: build that storey again.
      if (s.openings !== l.built.openings || (s.rooms !== l.built.rooms && roomShapes(s.rooms) !== roomShapes(l.built.rooms))) {
        const next = buildStorey(s, i);
        world.remove(l.shell);
        disposeTree(l.shell);
        world.add(next.shell);
        Object.assign(l, next, { built: s, painted: { rooms: [], solids: [] } });
        if (i === level) controls.setWalls(l.collision);
        rebuilt = true;
      } else if (s.rooms !== l.built.rooms) {
        l.built = s;
      }
      if (s.rooms !== l.painted.rooms || s.solids !== l.painted.solids) {
        applyShellColors(l.shell, s);
        l.painted = s;
      }
    });
    if (rebuilt) {
      showLevels();
      touchShadows();
      realisticRef?.invalidate();
    }
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
      units,
      fit: mode === 'furniture' && chosen ? clearInFront(scene, chosen) : null,
    });
    kitchen.render(mode === 'furniture', currentRoom());
    afterRefresh();
  }
  history.subscribe(refresh);

  /**
   * Where to stand to walk into a room: a step inside its door, facing in.
   * A room with no door starts at its most open spot.
   */
  function entranceOf(room: Room): { x: number; y: number; yawDeg: number } {
    const scene = now();
    const doors: { edge: number; middle: number }[] = [];
    for (const o of scene.openings) {
      if (o.type !== 'door') continue;
      if (o.room === room.id) doors.push({ edge: o.edge, middle: o.offset + o.width / 2 });
    }
    // Doors declared on the room next door, in the wall the two share.
    room.polygon.forEach((_, edge) => {
      for (const f of facingEdges(scene, room.id, edge)) {
        const other = scene.rooms.find((r) => r.id === f.room)!;
        for (const o of scene.openings) {
          if (o.type !== 'door' || o.room !== other.id || o.edge !== f.edge) continue;
          // Measure the door's middle along this room's edge instead.
          const [c, d] = [toVec(other.polygon[f.edge]), toVec(other.polygon[(f.edge + 1) % other.polygon.length])];
          const len = Math.hypot(d.x - c.x, d.y - c.y);
          const t = (o.offset + o.width / 2) / len;
          const point = { x: c.x + (d.x - c.x) * t, y: c.y + (d.y - c.y) * t };
          const a = toVec(room.polygon[edge]);
          const b = toVec(room.polygon[(edge + 1) % room.polygon.length]);
          const along = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
          doors.push({ edge, middle: along });
        }
      }
    });
    const door = doors[0];
    if (!door) {
      const spot = openSpot(room, scene.furniture);
      return { x: spot.x, y: spot.y, yawDeg: controls.pose.yaw * (180 / Math.PI) };
    }
    const a = toVec(room.polygon[door.edge]);
    const b = toVec(room.polygon[(door.edge + 1) % room.polygon.length]);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const out = outwardNormal(room, door.edge);
    const x = a.x + ((b.x - a.x) / len) * door.middle - out.x * 0.6;
    const y = a.y + ((b.y - a.y) / len) * door.middle - out.y * 0.6;
    // Facing in: forward on the plan is (-sin yaw, -cos yaw).
    return { x, y, yawDeg: THREE.MathUtils.radToDeg(Math.atan2(out.x, out.y)) };
  }

  function setTopView(on: boolean): void {
    if (tour) stopTour();
    // Walking from a room on its own starts at that room's door.
    if (!on && inTopView && alone) {
      const room = now().rooms.find((r) => r.id === alone!.room);
      leaveRoom(false);
      if (room) {
        const start = entranceOf(room);
        controls.teleport(start.x, start.y, start.yawDeg);
      }
    }
    // The Plan mode works on the drawing, so leaving the plan leaves the mode.
    if (!on && mode === 'plan') fallToExplore();
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
    fallToExplore();
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
  const measureButton = tool('measure', 'Measure', 'U', () => setMeasuring(!measuring));
  const notesButton = tool('note', 'Notes for the architect', 'Shift N', () => toggleNotes());
  const quantitiesButton = tool('cost', 'Quantities and cost', 'Shift I', () => toggleQuantities());
  measureButton.id = 'btn-measure';
  notesButton.id = 'btn-notes';
  quantitiesButton.id = 'btn-quantities';
  const realisticButton = tool('realistic', 'Realistic light (beta)', 'Y', () => setRealistic(!realistic.on));
  realisticButton.id = 'btn-realistic';
  const snapButton = tool('camera', 'Save a picture', 'Z', () => {
    snapNext = true;
  });
  const recordButton = tool('video', 'Record the tour', 'Shift G', () => recordTour());
  tourButton.id = 'btn-tour';
  // Short names for the chip row that Finishes and Furnish show instead of the full list.
  const shortName = (button: HTMLButtonElement, text: string): void => {
    const span = document.createElement('span');
    span.className = 'short';
    span.textContent = text;
    button.append(span);
  };
  shortName(wholeButton, 'House');
  planButtons.forEach((b, i) => shortName(b, levels.length > 1 ? levels[i].name.replace(/ floor$/i, '') : 'Plan'));
  shortName(walkButton, 'Walk');
  viewBar.replaceChildren(wholeButton, ...planButtons, walkButton);
  document.getElementById('view-extras')!.replaceChildren(realisticButton, tourButton, recordButton, snapButton, measureButton, notesButton, savedButton, shareButton, areasButton, quantitiesButton, pdfButton, keysButton);
  const tools = document.getElementById('orbit-tools')!;
  const roofButton = tool('roof', 'Hide roof', 'O', () => {
    roofHidden = !roofHidden;
    showLevels();
    updateHint();
  });
  const dimensionsButton = tool('labels', 'Hide room names', 'N', () => {
    dimensions = !dimensions;
    updateHint();
  });
  const sizesButton = tool('ruler', 'Hide sizes', 'M', () => {
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

  // ---- Modes: each has its own tools on the rail and its own page in the panel ----

  // The rail carries only the tools of the mode in hand. Every key still works in any mode.
  const railModes: [HTMLButtonElement, Work[]][] = [
    [realisticButton, ['explore', 'finishes']],
    [tourButton, ['explore']],
    [recordButton, ['explore']],
    [snapButton, ['explore', 'plan', 'finishes', 'furnish']],
    [measureButton, ['explore', 'plan']],
    [notesButton, ['plan']],
    [savedButton, ['explore']],
    [shareButton, ['explore']],
    [areasButton, ['plan']],
    [quantitiesButton, ['plan']],
    [pdfButton, ['plan']],
    [keysButton, ['explore', 'plan', 'finishes', 'furnish']],
  ];
  for (const [button, works] of railModes) button.dataset.modes = works.join(' ');

  for (const { work } of WORKS) {
    const button = document.getElementById(`mode-${work}`)!;
    button.addEventListener('click', () => {
      setWork(work);
      button.blur();
    });
  }
  showMode();

  /** The few facts that say what kind of home this is, at the top of Explore. */
  const drawFacts = (): void => {
    const summary = summarizeAreas(levels.map((l, i) => ({ name: l.name, scene: history.current[i] })));
    const rooms = history.current.reduce((n, scene) => n + scene.rooms.length, 0);
    const facts: [string, string][] = [
      [levels.length > 1 ? 'Floors' : 'Floor', levels.length > 1 ? levels.map((l) => l.name).join(', ') : lv().name],
      ['Rooms and spaces', String(rooms)],
      ['Built-up area', formatArea(summary.builtUp, units)],
    ];
    if (summary.plot > 0) facts.push(['Plot', formatArea(summary.plot, units)]);
    document.getElementById('home-facts')!.replaceChildren(
      ...facts.flatMap(([term, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = value;
        return [dt, dd];
      }),
    );
  };
  drawFacts();

  // ---- Changes not yet kept: counted on a strip of tape, with Keep and Discard ----

  // "Kept" is the home as it was last stored in this browser. Until Keep is
  // pressed, changes live only in this tab.
  const KEPT = `stepinside.kept.${home.id}`;
  let kept: readonly Scene[] = history.current;
  const sessionBar = document.getElementById('session')!;
  const drawSession = (): void => {
    const n = countChanges(kept, history.current);
    sessionBar.hidden = n === 0;
    document.getElementById('session-count')!.textContent = `${n} ${n === 1 ? 'change' : 'changes'} not kept`;
    document.body.classList.toggle('unkept', n > 0);
  };
  history.subscribe(drawSession);
  document.getElementById('btn-keep')!.addEventListener('click', () => {
    try {
      localStorage.setItem(KEPT, JSON.stringify(history.current.map((scene) => saveLayout(scene))));
      kept = history.current;
      drawSession();
      panel.toast('Kept in this browser. It will be here the next time you open this home.');
    } catch {
      panel.toast('This browser would not store it. Use File to save it instead.');
    }
  });
  document.getElementById('btn-discard')!.addEventListener('click', () => {
    selectedId = null;
    paintTarget = null;
    history.set(kept);
    panel.toast('Back to what you last kept. Undo brings the changes back.');
  });
  window.addEventListener('beforeunload', (e) => {
    if (countChanges(kept, history.current) > 0) e.preventDefault();
  });
  /** Puts back what was kept on an earlier visit. Called once the home is on screen. */
  const restoreKept = (): void => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(KEPT) ?? 'null');
      if (!Array.isArray(stored) || stored.length !== levels.length) return;
      const next = history.current.map((scene, i) => {
        const result = loadLayout(String(stored[i]), scene);
        return 'error' in result ? scene : result.scene;
      });
      history.set(next);
      kept = history.current;
      drawSession();
    } catch {
      // Nothing kept, or it no longer reads: the home opens as drawn.
    }
  };

  // On a wide screen the list of views lives in the panel at the side and the tools on a
  // slim rail at the right, so nothing lies over the model. On a phone, and on each side
  // of the compare page (which has no panel), the views stay in a bar at the bottom.
  const wideScreen = window.matchMedia('(min-width: 701px)');
  const placeViews = (): void => {
    const aside = !EMBED && wideScreen.matches;
    if (aside) document.getElementById('mode-note')!.after(viewBar);
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
    // Names and sizes are separate switches; the label shows whichever are on.
    const show = inTopView && (dimensions || sizes || directions);
    labelLayer.hidden = !show;
    placeWallSizes(inTopView && sizes && !directions);
    if (!show) return;
    const items: { text: string; sub: string; x: number; y: number; z: number; piece?: boolean }[] = [];
    for (const room of now().rooms) {
      if (room.kind === 'void' || (alone && room.id !== alone.room)) continue;
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
      // Each part of a label follows its own switch. The selected piece always shows its name.
      (el.firstElementChild as HTMLElement).hidden = !dimensions && !item.piece;
      (el.lastElementChild as HTMLElement).hidden = !sizes && !directions;
      el.classList.toggle('bare', !dimensions && !item.piece);
    });
  }

  // In Furnish, the selected piece carries a few buttons just below it on the plan:
  // turn either way, make a copy, take it out. The panel has the same and more.
  const pieceTools = document.createElement('div');
  pieceTools.id = 'piece-tools';
  pieceTools.hidden = true;
  const pieceButton = (name: string, title: string, run: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.title = title;
    button.setAttribute('aria-label', title);
    button.append(icon(name));
    button.addEventListener('pointerdown', (e) => e.stopPropagation());
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      run();
      button.blur();
    });
    pieceTools.append(button);
    return button;
  };
  const turnButtons = [
    pieceButton('turn-left', 'Turn 15° anticlockwise', () => panel.actions.turn(-15)),
    pieceButton('turn-right', 'Turn 15° clockwise', () => panel.actions.turn(15)),
  ];
  pieceButton('copy', 'Add another one like it', () => copySelected());
  pieceButton('remove', 'Take it out', () => panel.actions.takeOut());
  document.body.append(pieceTools);

  function copySelected(): void {
    const piece = selectedPiece();
    if (!piece || piece.fixed) return;
    const item: CatalogueItem = {
      key: piece.id.replace(/-\d+$/, ''),
      name: labelOf(piece),
      model: piece.model,
      size: piece.size,
      color: (piece.color ?? undefined) as string,
      ...(piece.mount === 'wall' ? { mount: 'wall' as const, elevation: piece.elevation } : {}),
    };
    // Try beside it first, along its width, then let the search look nearby.
    const rad = THREE.MathUtils.degToRad(piece.rotationDeg);
    const step = piece.size[0] + 0.15;
    const near: [number, number] = [mm(piece.position[0] + Math.cos(rad) * step), mm(piece.position[1] + Math.sin(rad) * step)];
    const result = addFurniture(now(), item, near, piece.rotationDeg);
    if (apply(result.scene, 'There is no space for another one nearby.') && result.id) {
      selectedId = result.id;
      refresh();
      panel.toast(`Added another ${labelOf(piece).toLowerCase()}. Drag it into place.`);
    }
  }

  const corner = new THREE.Vector3();
  function placePieceTools(): void {
    const piece = mode === 'furniture' && inTopView && !drag && !measuring ? selectedPiece() : undefined;
    pieceTools.hidden = !piece || !!piece.fixed;
    if (pieceTools.hidden || !piece) return;
    const { innerWidth: w, innerHeight: h } = window;
    let low = -Infinity;
    let sumX = 0;
    const corners = footprint(piece);
    for (const c of corners) {
      corner.set(c.x, lv().elevation + (piece.elevation ?? 0), c.y).project(plan.camera);
      const x = ((corner.x + 1) / 2) * w;
      const y = ((1 - corner.y) / 2) * h;
      sumX += x;
      low = Math.max(low, y);
    }
    for (const b of turnButtons) b.hidden = piece.mount === 'wall';
    pieceTools.style.transform = `translate(-50%, 0) translate(${sumX / corners.length}px, ${low + 14}px)`;
  }

  // With sizes on, every wall of a room carries its length too, written along the
  // wall just inside the room, the way a drawing gives its dimensions.
  const wallLayer = document.createElement('div');
  wallLayer.id = 'wall-sizes';
  labelLayer.after(wallLayer);
  const wallPool: HTMLElement[] = [];
  const ends = [new THREE.Vector3(), new THREE.Vector3()];
  function placeWallSizes(show: boolean): void {
    wallLayer.hidden = !show;
    if (!show) return;
    const { innerWidth: w, innerHeight: h } = window;
    const y = lv().elevation + 0.05;
    const toScreen = (v: THREE.Vector3): [number, number] => {
      v.project(plan.camera);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    };
    let n = 0;
    for (const room of now().rooms) {
      if (room.kind === 'void' || (alone && room.id !== alone.room)) continue;
      const poly = room.polygon;
      // Which side is inside: the sign of the room's area says which way it is drawn.
      let twice = 0;
      poly.forEach(([x0, z0], i) => {
        const [x1, z1] = poly[(i + 1) % poly.length];
        twice += x0 * z1 - x1 * z0;
      });
      const inward = twice > 0 ? 1 : -1;
      poly.forEach(([x0, z0], i) => {
        const [x1, z1] = poly[(i + 1) % poly.length];
        const length = Math.hypot(x1 - x0, z1 - z0);
        // Short pieces, such as the steps of a curve, would only crowd the drawing.
        if (length < 0.9) return;
        const nx = (-(z1 - z0) / length) * inward * 0.28;
        const nz = ((x1 - x0) / length) * inward * 0.28;
        const a = toScreen(ends[0].set(x0 + nx, y, z0 + nz));
        const b = toScreen(ends[1].set(x1 + nx, y, z1 + nz));
        const across = Math.hypot(b[0] - a[0], b[1] - a[1]);
        // No room on screen for the words: leave this wall out.
        if (across < 46) return;
        let angle = THREE.MathUtils.radToDeg(Math.atan2(b[1] - a[1], b[0] - a[0]));
        if (angle > 90) angle -= 180;
        else if (angle <= -90) angle += 180;
        if (wallPool.length <= n) {
          const el = document.createElement('span');
          wallLayer.append(el);
          wallPool.push(el);
        }
        const el = wallPool[n++];
        const text = formatLength(length, units);
        if (el.textContent !== text) el.textContent = text;
        el.hidden = false;
        el.style.transform = `translate(${(a[0] + b[0]) / 2}px, ${(a[1] + b[1]) / 2}px) translate(-50%, -50%) rotate(${angle.toFixed(1)}deg)`;
      });
    }
    for (let i = n; i < wallPool.length; i++) wallPool[i].hidden = true;
  }


  /**
   * The top view shows one storey: everything above it is hidden, and so
   * are its own ceilings, roof and lamp fittings (their light stays). The storeys below stay, so the
   * pool shows from upstairs.
   */
  function showLevels(): void {
    if (alone && (!inTopView || alone.level !== level)) leaveRoom(false);
    const room = alone ? now().rooms.find((r) => r.id === alone!.room) : undefined;
    // A room on its own stands alone: no street or plot round it either.
    if (street) street.visible = !room;
    levels.forEach((l, i) => {
      // An open roof terrace comes off with the roof in the whole-house view.
      const lifted = inOrbit && roofHidden && i > roofed;
      // A room on its own hides the floors under it too.
      const shown = (!inTopView || i <= level) && !lifted && (!room || i === level);
      l.shell.visible = shown;
      l.furniture.group.visible = shown && (!inTopView || i !== level || (layout?.furnitureShown ?? true));
      // In the whole-house view the roof of the top storey can come off.
      const lid = !(inTopView && i === level) && !(inOrbit && roofHidden && i === roofed);
      // From above the fittings would block the view, but the light they give stays on.
      l.lamps.visible = shown;
      l.lamps.traverse((o) => {
        if (o instanceof THREE.Mesh) o.visible = lid;
      });
      for (const o of l.shell.children) {
        const base = o.name.startsWith('ceiling:') || o.name === 'roof' ? lid : true;
        o.visible = base && (!room || i !== level || partOfRoom(o, room));
      }
      for (const f of history.current[i].furniture) {
        const object = l.furniture.objectFor(f.id);
        if (object) object.visible = !room || i !== level || f.room === room.id;
      }
    });
  }

  // Resting the mouse on a room of the plan offers to open it, so the
  // double-click is found without reading the hint.
  const roomTip = document.createElement('div');
  roomTip.id = 'room-tip';
  roomTip.hidden = true;
  document.body.append(roomTip);
  let tipTimer = 0;
  canvas.addEventListener('pointermove', (e) => {
    roomTip.hidden = true;
    window.clearTimeout(tipTimer);
    if (!inTopView || alone || e.buttons || measuring || layout?.on || EMBED) return;
    tipTimer = window.setTimeout(() => {
      const p = floorPoint(e);
      const room = p ? now().rooms.find((r) => r.kind !== 'void' && insideOrOnEdge(r.polygon, p[0], p[1], 0)) : undefined;
      if (!room) return;
      roomTip.textContent = `Double-click to open ${room.name ?? 'this room'}`;
      roomTip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
      roomTip.hidden = false;
    }, 700);
  });
  canvas.addEventListener('pointerleave', () => {
    window.clearTimeout(tipTimer);
    roomTip.hidden = true;
  });
  canvas.addEventListener('pointerdown', () => {
    window.clearTimeout(tipTimer);
    roomTip.hidden = true;
  });

  // ---- A room on its own: double-click it on the plan ----

  const centres = new WeakMap<THREE.Object3D, THREE.Vector3>();
  const box = new THREE.Box3();
  /** True when a part of the building belongs to `room`: its floor, or a wall, door or window on its edge. */
  function partOfRoom(o: THREE.Object3D, room: Room): boolean {
    if (o.name.startsWith('floor:')) return o.name === `floor:${room.id}`;
    if (o.name.startsWith('ceiling:')) return o.name === `ceiling:${room.id}`;
    if (['roof', 'ground', 'site', 'slab', 'skin', 'band'].includes(o.name)) return false;
    let c = centres.get(o);
    if (!c) {
      c = box.setFromObject(o).getCenter(new THREE.Vector3());
      centres.set(o, c);
    }
    return insideOrOnEdge(room.polygon, c.x, c.z, 0.35);
  }
  /** Whether a point lies in a polygon, or within `margin` metres of its outline. */
  function insideOrOnEdge(poly: readonly (readonly [number, number])[], x: number, z: number, margin: number): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      const dx = xj - xi;
      const dz = zj - zi;
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - (xi + dx * t), z - (zi + dz * t)) < margin) return true;
    }
    return inside;
  }
  const aloneBar = document.createElement('div');
  aloneBar.id = 'alone-bar';
  aloneBar.hidden = true;
  const aloneName = document.createElement('strong');
  const aloneSize = document.createElement('span');
  const aloneBack = document.createElement('button');
  aloneBack.type = 'button';
  aloneBack.textContent = 'Back to the whole floor';
  aloneBack.title = 'Show the rest of the home again (Esc)';
  aloneBack.addEventListener('click', () => leaveRoom());
  aloneBar.append(aloneName, aloneSize, aloneBack);
  document.body.append(aloneBar);
  /** Shows one room of this floor on its own, close up. */
  function openRoom(room: Room): void {
    alone = { level, room: room.id };
    selectedId = selectedPiece()?.room === room.id ? selectedId : null;
    const size = roomSize(room);
    plan.focus(size.center[0], size.center[1], Math.max(size.width, size.depth), 0.3);
    aloneName.textContent = room.name ?? room.id;
    aloneSize.textContent = `${formatSize(size.width, size.depth, units)} · ${formatArea(polygonArea(room.polygon), units)}`;
    aloneBar.hidden = false;
    document.body.classList.add('room-alone');
    showLevels();
    updateHint();
    refresh();
  }
  /** Brings back the rest of the home. `reframe` glides back to the whole floor. */
  function leaveRoom(reframe = true): void {
    if (!alone) return;
    alone = null;
    aloneBar.hidden = true;
    document.body.classList.remove('room-alone');
    if (reframe) plan.reset();
    showLevels();
    updateHint();
    refresh();
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
    endColorDrag();
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
    setTool(dimensionsButton, 'labels', dimensions ? 'Hide room names' : 'Show room names');
    dimensionsButton.classList.toggle('active', dimensions);
    setTool(sizesButton, 'ruler', sizes ? 'Hide sizes' : 'Show sizes');
    setTool(flatButton, '', plan.flat ? 'Back to the 3D plan' : 'Flat 2D drawing', plan.flat ? '3D' : '2D');
    flatButton.classList.toggle('active', plan.flat);
    sizesButton.classList.toggle('active', sizes);
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
        : mode === 'furniture'
          ? 'Click a piece to select it · drag to move · R to turn · drag the background to turn the plan · right-drag to move it'
          : alone
            ? 'Double-click outside the room, zoom out, or press Esc to see the whole floor again'
            : 'Double-click a room to see it on its own · drag to turn the plan · right-drag to move it · scroll to zoom'
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

  const layoutSpot = new THREE.Vector3();
  layout = new LayoutEditor(
    {
      now,
      begin: () => history.beginGesture(),
      preview,
      commit: () => history.endGesture(),
      apply,
      floorPoint,
      toScreen: (x, y) => {
        layoutSpot.set(x, lv().elevation + 0.02, y).project(plan.camera);
        return [((layoutSpot.x + 1) / 2) * innerWidth, ((1 - layoutSpot.y) / 2) * innerHeight];
      },
      units: () => units,
      toast: (message) => panel.toast(message),
      onlyRoom: () => alone?.room,
    },
    document.getElementById('pane-plan')!,
    () => {
      updateHint();
      showLevels();
    },
  );
  layout.renderPane();
  history.subscribe(() => {
    if (mode === 'plan') layout?.renderPane();
  });

  // ---- Mouse: select, drag along the floor, or click to walk ----

  // `lift` is set while dragging a wall-hung piece along its wall: the
  // height of the piece's bottom edge above the point that was grabbed.
  let drag: { id: string; offset: [number, number]; lift?: number } | null = null;
  let press: { x: number; y: number } | null = null;
  /** Where the left button went down, in any view: a press that does not move is a tap. */
  let tap: { x: number; y: number } | null = null;

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
    tap = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    hoverPiece(undefined);
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
      // While looking around, the dot in the middle of the screen is the pointer.
      if (clickTaker) {
        const rect = canvas.getBoundingClientRect();
        clickTaker({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
        return;
      }
      if (mode === 'paint') {
        const rect = canvas.getBoundingClientRect();
        pickForPaint({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
      }
      return;
    }
    press = { x: e.clientX, y: e.clientY };
    // In a plan, dragging anything but a piece of furniture turns the plan.
    const id = mode !== 'furniture' || clickTaker ? undefined : pickFurniture(e);
    if (!id && inTopView) {
      turning = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    }
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
      if (clickTaker) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (!edits(mode) || mode === 'furniture') {
        if (controls.locked || inOrbit) return;
        const id = pickFurniture(e);
        canvas.style.cursor = id && mode === 'furniture' ? 'grab' : '';
        hoverPiece(id, e);
      }
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
    const tapped = tap !== null && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 5;
    tap = null;
    if (clickTaker && tapped && !controls.locked) {
      press = null;
      clickTaker(e);
      return;
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

  canvas.addEventListener('dblclick', (e) => {
    if (mode === 'paint' && !inTopView) controls.lock();
    if (!inTopView || clickTaker || EMBED) return;
    const p = floorPoint(e);
    const room = p ? now().rooms.find((r) => r.kind !== 'void' && insideOrOnEdge(r.polygon, p[0], p[1], 0)) : undefined;
    // With a room on its own, a double-click anywhere outside it goes back to the whole floor.
    if (alone) {
      if (room?.id !== alone.room) leaveRoom();
      return;
    }
    if (room) openRoom(room);
  });

  // Dragging a taken-out piece from the panel onto the floor.
  canvas.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (types.includes(DRAG_TYPE) || types.includes(CATALOGUE_DRAG) || types.includes('Files')) e.preventDefault();
  });
  canvas.addEventListener('drop', (e) => {
    // A layout file dropped onto the view is loaded.
    const file = e.dataTransfer?.files[0];
    if (file) {
      e.preventDefault();
      void file.text().then(load);
      return;
    }
    // A catalogue card dropped onto the floor (or a wall) adds that piece there.
    const key = e.dataTransfer?.getData(CATALOGUE_DRAG);
    const item = key ? CATALOGUE.find((c) => c.key === key) : undefined;
    if (item) {
      e.preventDefault();
      const p = floorPoint(e);
      if (!p) return panel.toast('Drop it onto the floor of a room.');
      const within = roomAt(now(), { x: p[0], y: p[1] });
      const result = addFurniture(now(), item, [mm(p[0]), mm(p[1])], 0, within?.kind === 'void' ? undefined : within?.id);
      if (apply(result.scene, 'There is no space for it there. Try a spot with more room.') && result.id) {
        selectedId = result.id;
        refresh();
        panel.toast(`Added: ${item.name}.`);
      }
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
      ['U', 'Measure between two points'],
    ]],
    ['Changing things', [
      ['Shift 1 to 4', 'Explore, Plan, Finishes, Furnish'],
      ['F  P  L', 'Furnish, paint one surface, style the whole home'],
      ['Shift L', 'Other layouts for the room'],
      ['R', 'Turn the selected piece'],
      ['Delete', 'Take the piece out'],
      ['Ctrl/Cmd Z', 'Undo (with Shift: redo)'],
      ['Ctrl/Cmd S', 'Save the layout'],
    ]],
    ['Sharing', [
      ['C', 'Copy a link to this view'],
      ['V', 'Saved views'],
      ['I', 'Areas'],
      ['Shift I', 'Quantities and rough cost'],
      ['Shift N', 'Notes for the architect'],
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
    else if (e.code === 'KeyI' && e.shiftKey) toggleQuantities();
    else if (e.code === 'KeyI') toggleAreas();
    else if (e.code === 'KeyU') setMeasuring(!measuring);
    else if (e.code === 'KeyL' && e.shiftKey && !EMBED) toggleLayouts();
    else if (e.code === 'KeyN' && e.shiftKey) toggleNotes();
    else if (e.code === 'KeyQ' && looking) turnable().turn(-Math.PI / 4);
    else if (e.code === 'KeyE' && looking) turnable().turn(Math.PI / 4);
    else if ((e.key === '+' || e.key === '=') && looking) turnable().zoom(0.8);
    else if ((e.key === '-' || e.key === '_') && looking) turnable().zoom(1.25);
    else if (e.code === 'Digit0' && looking) turnable().reset();
    else if (e.code === 'KeyX' && inTopView) flatButton.click();
    else if (e.code === 'KeyO' && inOrbit) roofButton.click();
    else if (e.code === 'KeyN' && inTopView) dimensionsButton.click();
    else if (e.code === 'KeyM' && inTopView) sizesButton.click();
    else if (!EMBED && e.shiftKey && /^Digit[1-4]$/.test(e.code)) setWork(WORKS[Number(e.code.slice(5)) - 1].work);
    else if (!EMBED && (e.code === 'KeyF' || e.code === 'KeyP' || e.code === 'KeyL')) {
      setMode(e.code === 'KeyF' ? 'furniture' : e.code === 'KeyP' ? 'paint' : 'style');
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
    } else if (e.code === 'Escape' && layout?.escape()) {
      return;
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && layout?.deletePicked()) {
      e.preventDefault();
    } else if (e.code === 'Escape') {
      if (!keysPanel.hidden) toggleKeys();
      if (alone && !measuring && !pinning && !selectedId && !paintTarget) leaveRoom();
      if (measuring && !tapeStart) setMeasuring(false);
      else if (measuring) dropLength();
      if (pinning) setPinning(false);
      selectedId = null;
      setPaintTarget(null);
    } else if (e.altKey) {
      return;
    } else if (measuring && (e.code === 'Backspace' || e.code === 'Delete')) {
      e.preventDefault();
      dropLength();
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
    roomLightsButton.hidden = inRoom.length === 0;
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

  // ---- The walk bar: a small map with you on it, and where you are ----

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const walkBar = document.createElement('div');
  walkBar.id = 'walk-bar';
  walkBar.hidden = true;
  const map = document.createElementNS(SVG_NS, 'svg');
  map.setAttribute('class', 'walk-map');
  map.setAttribute('aria-hidden', 'true');
  const mapRooms = document.createElementNS(SVG_NS, 'g');
  const you = document.createElementNS(SVG_NS, 'g');
  const youCone = document.createElementNS(SVG_NS, 'path');
  youCone.setAttribute('class', 'cone');
  const youDot = document.createElementNS(SVG_NS, 'circle');
  youDot.setAttribute('class', 'dot');
  you.append(youCone, youDot);
  map.append(mapRooms, you);
  const whereFloor = document.createElement('span');
  whereFloor.className = 'floor';
  const whereRoom = document.createElement('strong');
  const whereSize = document.createElement('span');
  whereSize.className = 'size';
  const where = document.createElement('div');
  where.className = 'where';
  where.append(whereFloor, whereRoom, whereSize);
  walkBar.append(map, where);
  document.body.append(walkBar);

  let mapKey = '';
  let whereKey = '';
  /** Draws the rooms of this floor into the map, once per floor or change of rooms. */
  function drawMap(): void {
    const scene = now();
    const key = `${level}|${levels.length}`;
    if (key === mapKey && mapRooms.childElementCount) return;
    mapKey = key;
    const xs = scene.rooms.flatMap((r) => r.polygon.map((p) => p[0]));
    const zs = scene.rooms.flatMap((r) => r.polygon.map((p) => p[1]));
    const x0 = Math.min(...xs) - 0.5;
    const z0 = Math.min(...zs) - 0.5;
    const w = Math.max(...xs) + 0.5 - x0;
    const h = Math.max(...zs) + 0.5 - z0;
    map.setAttribute('viewBox', `${x0} ${z0} ${w} ${h}`);
    // The map keeps the floor's own shape, inside a box at most 112 by 112 pixels.
    const scale = 112 / Math.max(w, h);
    map.setAttribute('width', String(Math.round(w * scale)));
    map.setAttribute('height', String(Math.round(h * scale)));
    youDot.setAttribute('r', String(0.38 * (Math.max(w, h) / 30)));
    mapRooms.replaceChildren(
      ...scene.rooms.filter((r) => r.kind !== 'void').map((r) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', `M${r.polygon.map((p) => p.join(' ')).join('L')}Z`);
        path.dataset.room = r.id;
        if (r.kind === 'balcony') path.classList.add('outdoor');
        return path;
      }),
    );
  }
  everyFrame.push(() => {
    const walking = !inOrbit && !inTopView && !EMBED;
    if (walkBar.hidden === walking) {
      walkBar.hidden = !walking;
      document.body.classList.toggle('walk-bar-on', walking);
      // It sits on the right, under the sun card, so the middle of the view stays clear.
      const sun = document.getElementById('sun-bar');
      const below = sun && !sun.hidden ? sun.getBoundingClientRect().bottom : 0;
      walkBar.style.top = `${Math.round(below + 10)}px`;
    }
    if (!walking) return;
    drawMap();
    const pose = controls.pose;
    const span = Math.max(...map.getAttribute('viewBox')!.split(' ').slice(2).map(Number));
    const reach = span / 7;
    // The cone shows which way you face: forward is -sin(yaw), -cos(yaw) on the plan.
    const fx = -Math.sin(pose.yaw);
    const fz = -Math.cos(pose.yaw);
    const spread = 0.55;
    const l = [fx * Math.cos(spread) - fz * Math.sin(spread), fx * Math.sin(spread) + fz * Math.cos(spread)];
    const r = [fx * Math.cos(-spread) - fz * Math.sin(-spread), fx * Math.sin(-spread) + fz * Math.cos(-spread)];
    youCone.setAttribute('d', `M${pose.x} ${pose.y}L${pose.x + l[0] * reach} ${pose.y + l[1] * reach}L${pose.x + r[0] * reach} ${pose.y + r[1] * reach}Z`);
    youDot.setAttribute('cx', String(pose.x));
    youDot.setAttribute('cy', String(pose.y));
    const room = roomAt(now(), pose);
    const key = `${level}|${room?.id}|${units}`;
    if (key === whereKey) return;
    whereKey = key;
    for (const path of mapRooms.children) path.classList.toggle('here', (path as SVGElement).dataset.room === room?.id);
    whereFloor.textContent = levels.length > 1 ? lv().name : '';
    whereFloor.hidden = levels.length < 2;
    whereRoom.textContent = room ? (room.name ?? room.id) : 'Outside';
    whereSize.textContent = room ? formatArea(polygonArea(room.polygon), units) : '';
  });

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

  // ---- The size of the piece under the mouse ----

  const hoverLabel = document.createElement('div');
  hoverLabel.id = 'hover-size';
  hoverLabel.hidden = true;
  hoverLabel.append(document.createElement('strong'), document.createElement('span'));
  document.body.append(hoverLabel);
  let hoverId: string | undefined;
  hoverPiece = (id, e) => {
    // The selected piece already carries its size in a plan.
    const piece = id && !(inTopView && dimensions && sizes && id === selectedId) ? now().furniture.find((f) => f.id === id) : undefined;
    hoverLabel.hidden = !piece || !e;
    if (!piece || !e) {
      hoverId = undefined;
      return;
    }
    if (hoverId !== id) {
      hoverId = id;
      const [w, h, d] = piece.size;
      hoverLabel.firstElementChild!.textContent = labelOf(piece);
      hoverLabel.lastElementChild!.textContent = `${formatSize(w, d, units)}, ${formatLength(h, units)} high`;
    }
    hoverLabel.style.transform = `translate(-50%, -100%) translate(${e.clientX}px, ${e.clientY - 16}px)`;
  };
  canvas.addEventListener('pointerleave', () => hoverPiece(undefined));
  // While looking around, the dot in the middle of the screen does the pointing.
  let hoverChecked = 0;
  everyFrame.push(() => {
    if (!controls.locked) return;
    const t = performance.now();
    if (t - hoverChecked < 160) return;
    hoverChecked = t;
    const rect = canvas.getBoundingClientRect();
    const middle = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    hoverPiece(clickTaker || tour ? undefined : pickFurniture(middle as MouseEvent), middle);
  });

  // ---- Tools that take a click on the model: the tape measure, and notes ----

  /** The point of the model under the mouse, on any floor that is on show. */
  const hitPoint = (e: { clientX: number; clientY: number }): THREE.Vector3 | undefined => {
    aim(e);
    const hit = raycaster
      .intersectObjects(levels.flatMap((l) => [l.shell, l.furniture.group]), true)
      .find((h) => isShown(h.object) && !h.object.name.startsWith('glass:'));
    return hit?.point.clone();
  };
  /** Where a point of the model falls on screen, or null when it is behind the viewer. */
  const onScreen = (p: THREE.Vector3): [number, number] | null => {
    spot.copy(p).project(activeCamera());
    if (spot.z > 1 || spot.z < -1) return null;
    const rect = canvas.getBoundingClientRect();
    return [rect.left + ((spot.x + 1) / 2) * rect.width, rect.top + ((1 - spot.y) / 2) * rect.height];
  };
  const toolNote = document.createElement('div');
  toolNote.id = 'tool-note';
  toolNote.hidden = true;
  toolNote.setAttribute('role', 'status');
  document.body.append(toolNote);
  const say = (text: string | null): void => {
    toolNote.hidden = !text;
    if (text) toolNote.textContent = text;
  };

  // The tape measure: click where a length starts and where it ends. Every length
  // stays on the model until the tool is put away, so several can be compared.
  // Near a corner, a wall or the end of another length the point snaps to it, and a
  // length that runs almost straight along the plan is held straight.
  let measuring = false;
  type Length = { a: THREE.Vector3; b: THREE.Vector3 };
  let lengths: Length[] = [];
  let tapeStart: THREE.Vector3 | null = null;
  let tapeEnd: THREE.Vector3 | null = null;
  /** What the pointer is held to right now, for the ring round the dot. */
  let snapKind: 'corner' | 'wall' | 'straight' | null = null;
  const MAX_LENGTHS = 40;
  const tapeLines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAX_LENGTHS + 1) * 6), 3)),
    new THREE.LineBasicMaterial({ color: 0xff2e88, depthTest: false }),
  );
  tapeLines.renderOrder = 12;
  tapeLines.frustumCulled = false;
  tapeLines.visible = false;
  world.add(tapeLines);
  const tapeLayer = document.createElement('div');
  tapeLayer.id = 'tape-layer';
  document.body.append(tapeLayer);
  const tapeLabels: HTMLElement[] = [];
  const tapeDots: HTMLElement[] = [];
  const pooled = (pool: HTMLElement[], n: number, make: () => HTMLElement): void => {
    while (pool.length < n) {
      const el = make();
      tapeLayer.append(el);
      pool.push(el);
    }
  };
  function setMeasuring(on: boolean): void {
    if (on) setPinning(false);
    measuring = on;
    lengths = [];
    tapeStart = tapeEnd = null;
    snapKind = null;
    clickTaker = on ? takeTapePoint : null;
    measureButton.classList.toggle('active', on);
    canvas.style.cursor = on ? 'crosshair' : '';
    say(on ? 'Measure: click where the length starts. Esc to finish.' : null);
    if (on && !inTopView && !inOrbit && !controls.locked) panel.toast('Click two points. While looking around, the dot in the middle is the pointer.');
  }
  /** Takes back the length being drawn, or the last one finished. True if there was one. */
  function dropLength(): boolean {
    if (tapeStart) tapeStart = null;
    else if (!lengths.pop()) return false;
    tapeEnd = null;
    say(lengths.length ? `Measure: ${lengths.length} ${lengths.length === 1 ? 'length' : 'lengths'}. Click to start another.` : 'Measure: click where the length starts. Esc to finish.');
    return true;
  }

  /**
   * The point the tape should use for the pointer at `e`: the model under it, pulled
   * onto a nearby corner, wall line or length end, then held straight to the start.
   */
  function tapePoint(e: { clientX: number; clientY: number }): THREE.Vector3 | undefined {
    const hit = hitPoint(e);
    if (!hit) return undefined;
    const pointer: [number, number] = [e.clientX, e.clientY];
    const away = (p: THREE.Vector3): number => {
      const s = onScreen(p);
      return s ? Math.hypot(s[0] - pointer[0], s[1] - pointer[1]) : Infinity;
    };
    // A plan is read on the floor; walking, a corner is snapped at the height clicked.
    const y = inTopView ? lv().elevation : hit.y;
    let best: THREE.Vector3 | null = null;
    let bestAway = 14;
    snapKind = null;
    const corners: THREE.Vector3[] = lengths.flatMap((l) => [l.a, l.b]);
    if (tapeStart) corners.push(tapeStart);
    for (const room of now().rooms) for (const [x, z] of room.polygon) corners.push(new THREE.Vector3(x, y, z));
    for (const c of corners) {
      const d = away(c);
      if (d < bestAway) {
        best = c.clone();
        bestAway = d;
        snapKind = 'corner';
      }
    }
    if (!best) {
      // The nearest point on any wall line of this floor, if one is close on screen.
      let wallAway = 9;
      for (const room of now().rooms) {
        const poly = room.polygon;
        poly.forEach(([x0, z0], i) => {
          const [x1, z1] = poly[(i + 1) % poly.length];
          const dx = x1 - x0;
          const dz = z1 - z0;
          const len2 = dx * dx + dz * dz;
          if (len2 < 1e-6) return;
          const t = Math.max(0, Math.min(1, ((hit.x - x0) * dx + (hit.z - z0) * dz) / len2));
          const p = new THREE.Vector3(x0 + dx * t, y, z0 + dz * t);
          const d = away(p);
          if (d < wallAway) {
            best = p;
            wallAway = d;
            snapKind = 'wall';
          }
        });
      }
    }
    const point = best ?? hit;
    // On a plan every point lies on the floor, so a click on a sofa or a wall top reads the same.
    if (inTopView) point.y = lv().elevation;
    // Held straight: within 4° of running along or across the plan, the end lines up with the start.
    if (tapeStart && snapKind !== 'corner') {
      const dx = point.x - tapeStart.x;
      const dz = point.z - tapeStart.z;
      const angle = Math.abs(Math.atan2(dz, dx)) % (Math.PI / 2);
      if (Math.hypot(dx, dz) > 0.2 && Math.min(angle, Math.PI / 2 - angle) < THREE.MathUtils.degToRad(4)) {
        if (Math.abs(dx) > Math.abs(dz)) point.z = tapeStart.z;
        else point.x = tapeStart.x;
        snapKind ??= 'straight';
      }
    }
    return point;
  }
  function takeTapePoint(e: { clientX: number; clientY: number }): void {
    const p = tapePoint(e);
    if (!p) {
      panel.toast('Click on a floor, a wall or a piece.');
      return;
    }
    if (!tapeStart) {
      tapeStart = p;
      tapeEnd = null;
      say('Measure: now click where it ends. Esc lets go of this one.');
      return;
    }
    if (p.distanceTo(tapeStart) < 0.01) return;
    lengths.push({ a: tapeStart, b: p });
    if (lengths.length > MAX_LENGTHS) lengths.shift();
    tapeStart = tapeEnd = null;
    say(`Measure: ${lengths.length} ${lengths.length === 1 ? 'length' : 'lengths'}. Click to start another · Backspace takes the last one back · Esc to finish.`);
  }
  canvas.addEventListener('pointermove', (e) => {
    if (!measuring || controls.locked) return;
    tapeEnd = tapePoint(e) ?? tapeEnd;
  });
  /** A length as words: the length, and its parts when it slopes. */
  const lengthText = (a: THREE.Vector3, b: THREE.Vector3): [string, string] => {
    const flat = Math.hypot(b.x - a.x, b.z - a.z);
    const up = Math.abs(b.y - a.y);
    // On a plan a length is read across the floor, even when a click lands on top of a wall.
    const text = formatLength(inTopView ? flat : a.distanceTo(b), units);
    const parts = up <= 0.05 || flat <= 0.05 ? ''
      : inTopView ? `${formatLength(up, units)} difference in height`
      : `${formatLength(flat, units)} along, ${formatLength(up, units)} up`;
    return [text, parts];
  };
  everyFrame.push(() => {
    if (measuring && controls.locked) {
      const rect = canvas.getBoundingClientRect();
      tapeEnd = tapePoint({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }) ?? tapeEnd;
    }
    const shown: Length[] = [...lengths];
    if (tapeStart && tapeEnd) shown.push({ a: tapeStart, b: tapeEnd });
    // The lines: one pair of points per length.
    const points = tapeLines.geometry.attributes.position as THREE.BufferAttribute;
    shown.forEach(({ a, b }, i) => {
      points.setXYZ(i * 2, a.x, a.y, a.z);
      points.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    });
    points.needsUpdate = true;
    tapeLines.geometry.setDrawRange(0, shown.length * 2);
    tapeLines.visible = shown.length > 0;
    // The dots: both ends of every length, the start being drawn, and the pointer.
    const dots: { p: THREE.Vector3; snap?: boolean }[] = shown.flatMap(({ a, b }) => [{ p: a }, { p: b }]);
    if (tapeStart && !tapeEnd) dots.push({ p: tapeStart });
    if (measuring && tapeEnd && snapKind) dots.push({ p: tapeEnd, snap: true });
    else if (measuring && !tapeStart && tapeEnd) dots.push({ p: tapeEnd, snap: !!snapKind });
    pooled(tapeDots, dots.length, () => {
      const dot = document.createElement('i');
      dot.className = 'tape-dot';
      return dot;
    });
    tapeDots.forEach((dot, i) => {
      const at = dots[i] ? onScreen(dots[i].p) : null;
      dot.hidden = !at;
      if (!at) return;
      dot.classList.toggle('snap', !!dots[i].snap);
      dot.style.transform = `translate(-50%, -50%) translate(${at[0]}px, ${at[1]}px)`;
    });
    // The labels: one strip of tape half way along each length.
    pooled(tapeLabels, shown.length, () => {
      const label = document.createElement('div');
      label.className = 'tape-label';
      label.append(document.createElement('strong'), document.createElement('span'));
      return label;
    });
    tapeLabels.forEach((label, i) => {
      const length = shown[i];
      const first = length ? onScreen(length.a) : null;
      const second = length ? onScreen(length.b) : null;
      label.hidden = !first || !second;
      if (!length || !first || !second) return;
      const [text, parts] = lengthText(length.a, length.b);
      if (label.firstElementChild!.textContent !== text) label.firstElementChild!.textContent = text;
      if (label.lastElementChild!.textContent !== parts) label.lastElementChild!.textContent = parts;
      (label.lastElementChild as HTMLElement).hidden = !parts;
      label.classList.toggle('drawing', i === lengths.length);
      label.style.transform = `translate(-50%, -50%) translate(${(first[0] + second[0]) / 2}px, ${(first[1] + second[1]) / 2 - 14}px)`;
    });
  });

  // ---- Cards that open beside the rail: one at a time ----

  const cards: { el: HTMLElement; button: HTMLElement; draw: () => void }[] = [];
  const card = (id: string, button: HTMLElement, draw: () => void): HTMLElement => {
    const el = document.createElement('section');
    el.id = id;
    el.className = 'card';
    el.hidden = true;
    document.body.append(el);
    cards.push({ el, button, draw });
    return el;
  };
  const showCard = (el: HTMLElement, open: boolean): void => {
    for (const c of cards) {
      c.el.hidden = c.el !== el || !open;
      c.button.classList.toggle('active', !c.el.hidden);
      if (!c.el.hidden) c.draw();
    }
  };
  const cardHead = (text: string, close: () => void): HTMLElement => {
    const head = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = text;
    head.append(title, viewButton('', 'Close', close, 'close'));
    return head;
  };
  const textButton = (text: string, run: () => void, iconName?: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    if (iconName) setLabel(b, iconName, text);
    else b.textContent = text;
    b.addEventListener('click', run);
    return b;
  };

  // ---- Notes for the architect: pinned to a spot, kept in this browser, sent as text ----

  interface Note { id: string; level: number; at: [number, number, number]; room: string; text: string }
  const NOTES = `stepinside.notes.${home.id}`;
  let notes: Note[] = [];
  try {
    const kept = JSON.parse(localStorage.getItem(NOTES) ?? '[]');
    if (Array.isArray(kept)) notes = kept.filter((n) => n && typeof n.text === 'string' && Array.isArray(n.at) && n.at.length === 3 && levels[n.level]);
  } catch {
    // Nothing kept, or a browser that does not allow it.
  }
  const keepNotes = (): void => {
    try {
      localStorage.setItem(NOTES, JSON.stringify(notes));
    } catch {
      panel.toast('This browser would not keep the note.');
    }
  };
  const notesText = (): string =>
    [`Notes for the architect: ${designName}`, '', ...notes.map((n, i) => `${i + 1}. ${levels[n.level].name}, ${n.room}: ${n.text}`)].join('\n');
  let pinning = false;
  let editing: string | null = null;
  const pinLayer = document.createElement('div');
  pinLayer.id = 'pins';
  document.body.append(pinLayer);
  const notesPanel = card('notes', notesButton, drawNotes);
  function setPinning(on: boolean): void {
    if (on) setMeasuring(false);
    pinning = on;
    clickTaker = on ? takePin : measuring ? takeTapePoint : null;
    canvas.style.cursor = on ? 'crosshair' : '';
    say(on ? 'Note: click the spot it is about. Esc to cancel.' : null);
  }
  function takePin(e: { clientX: number; clientY: number }): void {
    const p = hitPoint(e);
    if (!p) {
      panel.toast('Click on a floor, a wall or a piece.');
      return;
    }
    // The floor the spot is on: the highest one whose floor is at or below it.
    let on = 0;
    levels.forEach((l, i) => {
      if (p.y >= l.elevation - 0.2) on = i;
    });
    const room = roomAt(history.current[on], { x: p.x, y: p.z });
    const note: Note = { id: `n${Date.now().toString(36)}`, level: on, at: [mm(p.x), mm(p.y), mm(p.z)], room: room?.name ?? 'outside', text: '' };
    notes.push(note);
    editing = note.id;
    setPinning(false);
    if (document.pointerLockElement) document.exitPointerLock();
    showCard(notesPanel, true);
  }
  function drawNotes(): void {
    // A note left empty was never written.
    notes = notes.filter((n) => n.text || n.id === editing);
    let writing: HTMLTextAreaElement | null = null as HTMLTextAreaElement | null;
    const note = document.createElement('p');
    note.textContent = notes.length
      ? 'Kept in this browser only. Copy or download them to send to your architect.'
      : 'Pin a note to any spot: a window to move, a socket to add, a wall you are unsure of. They are kept in this browser; copy or download them to send to your architect.';
    const list = document.createElement('ol');
    notes.forEach((n) => {
      const row = document.createElement('li');
      const where = document.createElement('span');
      where.className = 'where';
      where.textContent = `${levels[n.level].name}, ${n.room}`;
      if (n.id === editing) {
        const box = document.createElement('textarea');
        box.rows = 3;
        box.value = n.text;
        box.placeholder = 'What should change here?';
        box.setAttribute('aria-label', 'Note');
        const done = (): void => {
          n.text = box.value.trim();
          editing = null;
          keepNotes();
          drawNotes();
        };
        box.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            done();
          }
        });
        const actions = document.createElement('div');
        actions.className = 'row';
        actions.append(textButton('Keep note', done));
        row.append(where, box, actions);
        writing = box;
      } else {
        const words = document.createElement('p');
        words.textContent = n.text;
        const actions = document.createElement('div');
        actions.className = 'row';
        actions.append(
          textButton('Show', () => {
            if (n.level !== level) goTo(n.level);
            setTopView(true);
          }),
          textButton('Edit', () => {
            editing = n.id;
            drawNotes();
          }),
          textButton('Delete', () => {
            notes = notes.filter((other) => other !== n);
            keepNotes();
            drawNotes();
          }),
        );
        row.append(where, words, actions);
      }
      list.append(row);
    });
    const foot = document.createElement('div');
    foot.className = 'row foot';
    const add = textButton('Add a note', () => setPinning(true), 'note');
    add.classList.add('primary');
    foot.append(add);
    if (notes.some((n) => n.text)) {
      foot.append(
        textButton('Copy all', () => {
          void navigator.clipboard.writeText(notesText()).then(
            () => panel.toast('Notes copied. Paste them into a message to your architect.'),
            () => panel.toast('Could not copy. Use Download instead.'),
          );
        }, 'copy'),
        textButton('Download', () => download(new Blob([notesText()], { type: 'text/plain' }), `${home.id}-notes.txt`), 'save'),
      );
    }
    notesPanel.replaceChildren(cardHead('Notes for the architect', () => toggleNotes()), note, list, foot);
    // Straight away, so that words typed at once land in the box.
    writing?.focus();
    notesButton.classList.toggle('has', notes.length > 0);
  }
  function toggleNotes(): void {
    editing = null;
    showCard(notesPanel, notesPanel.hidden === true);
    // With nothing written yet, the next step is to pick a spot.
    if (!notesPanel.hidden && notes.length === 0) setPinning(true);
  }
  notesButton.classList.toggle('has', notes.length > 0);
  // The pins: a numbered mark at each note's spot, on the floors that are on show.
  const pinPool: HTMLButtonElement[] = [];
  const pinAt = new THREE.Vector3();
  everyFrame.push(() => {
    const eye = activeCamera().getWorldPosition(spot.clone());
    let used = 0;
    notes.forEach((n, i) => {
      if (!levels[n.level].shell.visible) return;
      pinAt.set(n.at[0], n.at[1], n.at[2]);
      // Indoors, only the notes near enough to be about what is in view.
      if (!inTopView && !inOrbit && (n.level !== level || pinAt.distanceTo(eye) > 9)) return;
      const at = onScreen(pinAt);
      if (!at) return;
      let pin = pinPool[used];
      if (!pin) {
        pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pin';
        pinLayer.append(pin);
        pinPool.push(pin);
      }
      used++;
      pin.hidden = false;
      const label = String(i + 1);
      if (pin.textContent !== label) pin.textContent = label;
      if (pin.title !== n.text) pin.title = n.text;
      pin.onclick = () => {
        editing = null;
        showCard(notesPanel, true);
      };
      pin.style.transform = `translate(-50%, -100%) translate(${at[0]}px, ${at[1]}px)`;
    });
    for (let i = used; i < pinPool.length; i++) pinPool[i].hidden = true;
  });

  // ---- Quantities, and a rough cost at the owner's own rates ----

  const RATES = 'stepinside.rates';
  let rates: Record<string, number> = {};
  try {
    const kept = JSON.parse(localStorage.getItem(RATES) ?? '{}');
    if (kept && typeof kept === 'object') rates = kept;
  } catch {
    // Nothing kept.
  }
  const quantitiesPanel = card('quantities', quantitiesButton, drawQuantities);
  const FINISH: Record<string, string> = {
    plain: 'No finish chosen', laminate: 'Wood laminate', 'large-tile': 'Large tiles', tile: 'Tiles', stone: 'Stone',
    concrete: 'Concrete', decking: 'Decking', lawn: 'Lawn', setts: 'Paving setts',
  };
  function drawQuantities(): void {
    const each = history.current.map(quantitiesOf);
    const total: Quantities = totalQuantities(each);
    const a = (v: number): string => formatArea(v, units);
    const table = document.createElement('table');
    const row = (label: string, value: string, head = false): void => {
      const tr = table.insertRow();
      const first = document.createElement(head ? 'th' : 'td');
      first.textContent = label;
      if (head) first.colSpan = 2;
      tr.append(first);
      if (!head) tr.insertCell().textContent = value;
    };
    row('Floors, by finish', '', true);
    for (const f of total.floors) row(FINISH[f.finish] ?? f.finish, a(f.area));
    row('Walls and ceilings, to paint', '', true);
    row('Inside walls', a(total.wallInside));
    row('Outside walls', a(total.wallOutside));
    row('Ceilings', a(total.ceiling));
    row('Fittings', '', true);
    row('Skirting', formatLength(total.skirting, units));
    row('Doors', String(total.doors));
    row('Windows', `${total.windows}, ${a(total.glazing)} of glass`);
    row('Loose furniture in place', String(total.pieces));

    const note = document.createElement('p');
    note.textContent =
      'Read off this model, doors and windows taken out. Good for checking a quotation or asking for one; a contractor will measure on site and add wastage.';

    const cost = document.createElement('div');
    cost.className = 'cost';
    const costHead = document.createElement('h3');
    costHead.textContent = 'Rough cost, at your rates';
    const per = units === 'ft' ? 'per sq ft' : 'per m²';
    const costNote = document.createElement('p');
    costNote.textContent = `Type the rates you have been quoted, ${per}. Step Inside does not supply prices; they vary too much by city and finish.`;
    const lines = costLines(areas().builtUp, total);
    const sum = document.createElement('p');
    sum.className = 'sum';
    const money = (v: number): string => Math.round(v).toLocaleString();
    const showSum = (): void => {
      const filled = lines.filter((l) => rates[l.id] > 0);
      sum.textContent = filled.length
        ? `Total of the rates filled in: ${money(filled.reduce((s, l) => s + lineCost(l, rates[l.id], units), 0))}`
        : '';
    };
    const grid = document.createElement('div');
    grid.className = 'rates';
    for (const line of lines) {
      const label = document.createElement('label');
      const words = document.createElement('span');
      words.textContent = `${line.label} (${a(line.quantity)})`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.inputMode = 'decimal';
      input.placeholder = `Rate ${per}`;
      if (rates[line.id] > 0) input.value = String(rates[line.id]);
      const out = document.createElement('output');
      const show = (): void => {
        out.textContent = rates[line.id] > 0 ? money(lineCost(line, rates[line.id], units)) : '';
      };
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (value > 0) rates[line.id] = value;
        else delete rates[line.id];
        try {
          localStorage.setItem(RATES, JSON.stringify(rates));
        } catch {
          // The sum still shows; it just will not be there next time.
        }
        show();
        showSum();
      });
      show();
      label.append(words, input, out);
      grid.append(label);
    }
    showSum();
    cost.append(costHead, costNote, grid, sum);
    quantitiesPanel.replaceChildren(cardHead('Quantities', () => toggleQuantities()), table, note, cost);
  }
  function toggleQuantities(): void {
    showCard(quantitiesPanel, quantitiesPanel.hidden === true);
  }
  // An open card follows edits to the home.
  history.subscribe(() => {
    if (!quantitiesPanel.hidden) drawQuantities();
  });

  // ---- Layouts: other ways to furnish the room, drawn small and side by side ----

  const layoutsButton = document.getElementById('btn-layouts') as HTMLButtonElement;
  const layoutsPanel = card('layouts', layoutsButton, drawLayouts);
  /** The room the card is about, the scene it started from, and what was worked out for it. */
  let arranging: { level: number; room: string; before: Scene; layouts: Layout[]; chosen: number } | null = null;
  const SVG = 'http://www.w3.org/2000/svg';
  /** The room seen from above, a few centimetres across: walls, doors, windows and the pieces. */
  function miniPlan(scene: Scene, roomId: string): SVGSVGElement {
    const room = scene.rooms.find((r) => r.id === roomId)!;
    const xs = room.polygon.map((p) => p[0]);
    const ys = room.polygon.map((p) => p[1]);
    const pad = 0.25;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + 2 * pad} ${Math.max(...ys) - Math.min(...ys) + 2 * pad}`);
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag: string, cls: string, attrs: Record<string, string>): void => {
      const el = document.createElementNS(SVG, tag);
      el.setAttribute('class', cls);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.append(el);
    };
    const points = (list: readonly { x: number; y: number }[]): string => list.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
    add('polygon', 'floor', { points: points(room.polygon.map(toVec)) });
    for (const o of roomOpenings(scene, roomId)) add('line', o.type, { x1: String(o.a[0]), y1: String(o.a[1]), x2: String(o.b[0]), y2: String(o.b[1]) });
    const anchor = anchorOf(scene, roomId);
    const pieces = scene.furniture.filter((f) => f.room === roomId && !f.removed && f.mount !== 'wall' && !(f.elevation && f.elevation > 0));
    // Rugs first, so the pieces standing on them are drawn over them.
    for (const f of [...pieces].sort((a, b) => a.size[1] - b.size[1])) {
      const corners = footprint(f);
      add('polygon', f.size[1] <= 0.1 ? 'rug' : f.id === anchor?.id ? 'piece anchor' : f.fixed ? 'piece fixed' : 'piece', { points: points(corners) });
      // Pillows on a bed and the back of a sofa, so it reads which way it faces.
      if (f.id === anchor?.id && !/table/.test(f.model)) {
        // A point of the piece: `u` across from left to right, `v` from the back to the front, each 0 to 1.
        const at = (u: number, v: number): { x: number; y: number } => ({
          x: corners[3].x + (corners[2].x - corners[3].x) * u + (corners[0].x - corners[3].x) * v,
          y: corners[3].y + (corners[2].y - corners[3].y) * u + (corners[0].y - corners[3].y) * v,
        });
        const patch = (u0: number, u1: number, v0: number, v1: number): void =>
          add('polygon', 'back', { points: points([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]) });
        if (/sofa|couch/.test(f.model)) patch(0, 1, 0, 0.22);
        else {
          patch(0.1, 0.45, 0.06, 0.24);
          patch(0.55, 0.9, 0.06, 0.24);
        }
      }
    }
    return svg;
  }
  function drawLayouts(): void {
    if (!arranging) return;
    const { room: roomId, before, layouts } = arranging;
    const room = before.rooms.find((r) => r.id === roomId)!;
    const note = document.createElement('p');
    note.textContent = layouts.length
      ? 'Worked out by rules from the pieces already in this room: nothing in a doorway, nothing tall across a window. Click one to see it in the model. Undo puts it back.'
      : 'No other way of standing these pieces fits this room by the rules: nothing in a doorway, nothing tall across a window.';
    const grid = document.createElement('div');
    grid.className = 'plans';
    const option = (index: number, name: string, why: string, scene: Scene): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(arranging!.chosen === index));
      const title = document.createElement('strong');
      title.textContent = name;
      const reason = document.createElement('span');
      reason.textContent = why;
      b.append(miniPlan(scene, roomId), title, reason);
      b.addEventListener('click', () => {
        if (!arranging || arranging.chosen === index) return;
        arranging.chosen = index;
        if (arranging.level !== level) goTo(arranging.level);
        history.set(swap(withRoomFrom(now(), scene, roomId)));
        drawLayouts();
      });
      grid.append(b);
    };
    option(-1, 'As it is', 'The room as you had it.', before);
    layouts.forEach((l, i) => option(i, l.name, l.why, l.scene));
    layoutsPanel.replaceChildren(cardHead(`Layouts: ${room.name}`, () => toggleLayouts()), note, grid);
  }
  function toggleLayouts(): void {
    if (!layoutsPanel.hidden) {
      showCard(layoutsPanel, false);
      arranging = null;
      return;
    }
    const room = currentRoom();
    if (!room || !canArrange(now(), room.id)) {
      panel.toast('Layouts work in a room with a bed, a sofa or a dining table. Walk into one, or click a piece in it.');
      return;
    }
    arranging = { level, room: room.id, before: now(), layouts: layoutsFor(now(), room.id), chosen: -1 };
    showCard(layoutsPanel, true);
  }
  layoutsButton.addEventListener('click', () => {
    layoutsButton.blur();
    toggleLayouts();
  });

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
    if (fast || drawingChosen || realistic.on || frames < 20 || frames > 400 || document.hidden || gap > 1000) return;
    // Either drawing itself is slow, or the pictures arrive far apart.
    if (now - began > 40 || gap > 55) slow++;
    else slow = Math.max(0, slow - 1);
    if (slow < 12) return;
    autoLight = true;
    setDrawing(true, false);
    panel.toast('Switched to lighter drawing to keep this smooth. The Drawing switch in the panel puts it back.');
  }

  /** Lighter drawing skips the shading pass and draws at one pixel per pixel. */
  function setDrawing(light: boolean, chosen: boolean): void {
    fast = light;
    renderer.setPixelRatio(light ? 1 : Math.min(window.devicePixelRatio, 2));
    resize();
    if (chosen) {
      drawingChosen = true;
      autoLight = false;
      try {
        localStorage.setItem(DRAWING_KEY, light ? 'light' : 'full');
      } catch {
        // Not kept: it holds for this visit.
      }
    }
    drawDisplay();
    realisticRef?.invalidate();
  }

  /** The units and drawing switches at the foot of the panel. */
  const unitButtons = UNITS.map((u) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = u;
    button.title = u === 'cm' ? 'Centimetres' : u === 'm' ? 'Metres' : 'Feet and inches';
    button.addEventListener('click', () => {
      setUnits(u);
      button.blur();
    });
    return button;
  });
  const unitsLabel = document.createElement('span');
  unitsLabel.textContent = 'Units';
  const unitSegments = document.createElement('div');
  unitSegments.className = 'segments';
  unitSegments.append(...unitButtons);
  document.getElementById('units')!.replaceChildren(unitsLabel, unitSegments);
  const drawingLabel = document.createElement('span');
  drawingLabel.textContent = 'Drawing';
  const fullButton = document.getElementById('draw-full')!;
  const lightButton = document.getElementById('draw-light')!;
  const drawSegments = document.createElement('div');
  drawSegments.className = 'segments';
  drawSegments.append(fullButton, lightButton);
  document.getElementById('drawing')!.replaceChildren(drawingLabel, drawSegments);
  fullButton.addEventListener('click', () => setDrawing(false, true));
  lightButton.addEventListener('click', () => setDrawing(true, true));
  function drawDisplay(): void {
    unitButtons.forEach((b, i) => b.classList.toggle('active', UNITS[i] === units));
    fullButton.classList.toggle('active', !fast);
    lightButton.classList.toggle('active', fast);
    // When the view was slow and Lighter was chosen for you, the button says so.
    lightButton.textContent = autoLight ? 'Lighter · auto' : 'Lighter';
    lightButton.title = autoLight
      ? 'Chosen for you because the view was slow on this computer. Pick Full to go back.'
      : 'Fewer effects and coarser pixels: smoother on a slower computer';
  }
  function setUnits(next: Units): void {
    if (next === units) return;
    units = next;
    try {
      localStorage.setItem(UNITS_KEY, next);
    } catch {
      // Not kept: it holds for this visit.
    }
    drawDisplay();
    drawFacts();
    hoverPiece(undefined);
    if (!areasPanel.hidden) {
      toggleAreas();
      toggleAreas();
    }
    if (!quantitiesPanel.hidden) drawQuantities();
    drawMine();
    refresh();
    panel.toast(`Sizes now in ${next === 'cm' ? 'centimetres' : next === 'm' ? 'metres' : 'feet and inches'}.`);
  }
  if (fast) renderer.setPixelRatio(1);
  drawDisplay();

  let shadowsOff = false;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    if (capturing) return;
    const dt = Math.min(timer.getDelta(), 0.1);
    controls.update(dt);
    if (inOrbit) orbit.update(dt);
    if (inTopView) plan.update(dt);
    // Zooming well out of a room on its own brings the rest of the floor back.
    if (inTopView && alone && plan.zoomShare > 0.85) leaveRoom();
    placeLabels();
    placePieceTools();
    layout?.place(inTopView && mode === 'plan');
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
    for (const work of everyFrame) work();
    // A flat plan is a drawing: no shadows on it, only the lines and colours.
    const flatNow = inTopView && plan.flat;
    if (flatNow !== shadowsOff) {
      shadowsOff = flatNow;
      world.traverse((o) => {
        const light = o as THREE.DirectionalLight;
        if (!light.isLight || !light.shadow) return;
        light.userData.shadowIntensity ??= light.shadow.intensity;
        light.shadow.intensity = flatNow ? 0 : light.userData.shadowIntensity;
      });
      touchShadows();
    }
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

  restoreKept();

  // Handy in the browser console, and used by the automated screenshots.
  Object.assign(window, { walkthrough: { setMode, history, camera, controls, world, setTopView, setOrbit, orbit, goTo, planCamera: plan.camera, topCamera: topView.camera, startTour, stopTour, currentView, showView, plan, marker: topView.marker } });
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
