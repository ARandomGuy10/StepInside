import * as THREE from 'three';
import { roomHeight, toVec, type Room, type Scene } from '../core/scene';
import type { Vec2 } from '../core/collision';
import type { Hole, WallModel, WallSlab } from '../core/walls';
import { floorTexture } from './textures';

const FRAME_COLOR = 0xfafafa;
const FRONT_DOOR_COLOR = 0x3f5f85;
const FRAME_BAR = 0.05;

/**
 * Builds the 3D shell of the home from the scene and its wall slabs.
 * Plan (x, y) maps to 3D (x, height, z). Three.js uses Y as "up".
 * Every mesh is named after the scene element it came from, which is
 * what the paint panel will use to find out what was clicked.
 */
export function buildShell(scene: Scene, walls: WallModel): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shell';

  let maxHeight = 0;
  const bounds = new THREE.Box2();
  for (const room of scene.rooms) {
    const points = room.polygon.map(toVec);
    const balcony = room.kind === 'balcony';

    const floor = new THREE.Mesh(flatPolygon(points, 0, true), floorMaterial(scene, room));
    floor.name = `floor:${room.id}`;
    floor.receiveShadow = true;
    group.add(floor);

    if (balcony) continue;
    const height = roomHeight(scene, room);
    maxHeight = Math.max(maxHeight, height);
    points.forEach((p) => bounds.expandByPoint(new THREE.Vector2(p.x, p.y)));

    const ceiling = new THREE.Mesh(
      flatPolygon(points, height, false),
      matte(room.ceiling?.color ?? scene.defaults.ceilingColor, 1),
    );
    ceiling.name = `ceiling:${room.id}`;
    group.add(ceiling);
  }

  for (const slab of walls.slabs) group.add(buildSlab(slab));

  // The floor carries on through each doorway, in the colour of the room
  // the door was declared on.
  for (const threshold of walls.thresholds) {
    const room = scene.rooms.find((r) => r.id === threshold.roomId);
    const strip = new THREE.Mesh(flatPolygon(threshold.polygon, 0, true), floorMaterial(scene, room));
    strip.name = `threshold:${threshold.openingId}`;
    strip.receiveShadow = true;
    group.add(strip);
  }

  for (const solid of scene.solids ?? []) {
    const material = matte(solid.color ?? scene.defaults.wallColor, 0.95);
    // Solids share faces with walls. This makes the wall win where they
    // coincide, instead of the two flickering ("z-fighting").
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 4;
    const mesh = new THREE.Mesh(
      prism(solid.polygon.map(toVec), solid.height ?? scene.defaults.ceilingHeight),
      material,
    );
    mesh.name = `solid:${solid.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // A roof slab over the whole home and a ground slab under it. Neither is
  // seen from inside; they stop sunlight leaking in from above and below.
  const t = scene.defaults.exteriorWallThickness;
  const size = bounds.getSize(new THREE.Vector2());
  const center = bounds.getCenter(new THREE.Vector2());
  const slabGeometry = new THREE.BoxGeometry(size.x + 2 * t, 0.2, size.y + 2 * t);
  const roof = new THREE.Mesh(slabGeometry, matte('#d9d6d0', 1));
  roof.name = 'roof';
  roof.position.set(center.x, maxHeight + 0.11, center.y);
  roof.castShadow = true;
  group.add(roof);
  const ground = new THREE.Mesh(slabGeometry, matte('#55524d', 1));
  ground.name = 'ground';
  ground.position.set(center.x, -0.11, center.y);
  group.add(ground);

  return group;
}

/** A floor's colour, with the pattern for its material (planks, tiles) on top. */
function floorMaterial(scene: Scene, room: Room | undefined): THREE.MeshStandardMaterial {
  const material = matte(room?.floor?.color ?? scene.defaults.floorColor, 0.6);
  material.map = floorTexture(room?.floor?.material);
  return material;
}

function matte(color: string, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** A flat polygon at a given height, facing up (a floor) or down (a ceiling). */
function flatPolygon(points: readonly Vec2[], height: number, faceUp: boolean): THREE.BufferGeometry {
  const contour = points.map((p) => new THREE.Vector2(p.x, p.y));
  // Triangulation splits the polygon into triangles, which is all a GPU draws.
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = points.flatMap((p) => [p.x, height, p.y]);
  // UVs say which part of a texture lands on each corner. Here they are
  // simply the plan position in metres, with planks running down the page.
  const uvs = points.flatMap((p) => [p.y, p.x]);
  const index: number[] = [];
  for (const [i, j, k] of triangles) {
    const a = points[i];
    const b = points[j];
    const c = points[k];
    // The corner order decides which side of a triangle is its front.
    const up = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) > 0;
    if (up === faceUp) index.push(i, j, k);
    else index.push(i, k, j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** A polygon extruded straight up from the floor. */
function prism(points: readonly Vec2[], height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * One wall: a flat outline (length by height) with its doors notched out
 * of the bottom and its windows cut as holes, extruded to the wall's
 * thickness. In the wall's local space, X runs along the wall, Y is up
 * and Z points into the room, so the thickness sits at negative Z.
 */
function buildSlab(slab: WallSlab): THREE.Mesh {
  const dx = slab.b.x - slab.a.x;
  const dy = slab.b.y - slab.a.y;
  const length = Math.hypot(dx, dy);
  const top = slab.height;

  const outline = new THREE.Shape();
  outline.moveTo(0, 0);
  for (const hole of slab.holes) {
    if (hole.sill > 0.001) continue;
    outline.lineTo(hole.offset, 0);
    outline.lineTo(hole.offset, hole.height);
    outline.lineTo(hole.offset + hole.width, hole.height);
    outline.lineTo(hole.offset + hole.width, 0);
  }
  outline.lineTo(length + slab.extendEnd, 0);
  outline.lineTo(length + slab.extendEnd, top);
  outline.lineTo(0, top);
  outline.closePath();

  for (const hole of slab.holes) {
    if (hole.sill <= 0.001) continue;
    const path = new THREE.Path();
    path.moveTo(hole.offset, hole.sill);
    path.lineTo(hole.offset + hole.width, hole.sill);
    path.lineTo(hole.offset + hole.width, hole.sill + hole.height);
    path.lineTo(hole.offset, hole.sill + hole.height);
    path.closePath();
    outline.holes.push(path);
  }

  const geometry = new THREE.ExtrudeGeometry(outline, { depth: slab.thickness, bevelEnabled: false });
  geometry.translate(0, 0, -slab.thickness);

  const mesh = new THREE.Mesh(geometry, matte(slab.color, 0.95));
  mesh.name = `${slab.kind}:${slab.roomId}:${slab.edge}`;
  const along = new THREE.Vector3(dx / length, 0, dy / length);
  const up = new THREE.Vector3(0, 1, 0);
  const inward = new THREE.Vector3().crossVectors(along, up);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, up, inward));
  mesh.position.set(slab.a.x, 0, slab.a.y);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  if (slab.kind === 'wall') addTrim(mesh, slab, length);

  for (const hole of slab.holes) {
    if (!hole.primary) continue;
    if (hole.type === 'window') mesh.add(buildWindow(hole, slab.thickness));
    else if (!hole.passable) mesh.add(buildClosedDoor(hole, slab.thickness));
  }
  return mesh;
}

/** Skirting boards along the foot of a wall and a frame around each doorway. */
function addTrim(mesh: THREE.Mesh, slab: WallSlab, length: number): void {
  const paint = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.55 });
  const depth = 0.014;
  const part = (w: number, h: number, x: number, y: number): void => {
    if (w <= 0.01) return;
    const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), paint);
    piece.name = 'trim';
    piece.position.set(x, y, depth / 2);
    piece.receiveShadow = true;
    mesh.add(piece);
  };
  const doors = slab.holes.filter((h) => h.sill <= 0.001);
  let cursor = 0;
  for (const door of doors) {
    const from = door.offset - FRAME_BAR;
    const to = door.offset + door.width + FRAME_BAR;
    part(from - cursor, 0.07, (cursor + from) / 2, 0.035);
    part(FRAME_BAR, door.height, door.offset - FRAME_BAR / 2, door.height / 2);
    part(FRAME_BAR, door.height, door.offset + door.width + FRAME_BAR / 2, door.height / 2);
    part(to - from, FRAME_BAR, (from + to) / 2, door.height + FRAME_BAR / 2);
    cursor = to;
  }
  part(length - cursor, 0.07, (cursor + length) / 2, 0.035);
}

/** A frame with upright bars and a sheet of glass, in the wall's local space. */
function buildWindow(hole: Hole, thickness: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `window:${hole.openingId}`;
  group.position.set(hole.offset + hole.width / 2, hole.sill + hole.height / 2, -thickness / 2);

  const frame = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.6 });
  const depth = Math.min(0.07, thickness);
  const bar = (w: number, h: number, x: number, y: number): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), frame);
    mesh.position.set(x, y, 0);
    mesh.castShadow = true;
    group.add(mesh);
  };
  bar(hole.width, FRAME_BAR, 0, hole.height / 2 - FRAME_BAR / 2);
  bar(hole.width, FRAME_BAR, 0, -hole.height / 2 + FRAME_BAR / 2);
  // Outer uprights, plus dividers so no pane is much wider than a metre.
  const panes = Math.max(1, Math.round(hole.width / 1.0));
  for (let i = 0; i <= panes; i++) {
    const x = -hole.width / 2 + FRAME_BAR / 2 + (i * (hole.width - FRAME_BAR)) / panes;
    bar(FRAME_BAR, hole.height, x, 0);
  }

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(hole.width, hole.height),
    new THREE.MeshStandardMaterial({
      color: 0xdfeefa,
      transparent: true,
      opacity: 0.12,
      roughness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.name = `glass:${hole.openingId}`;
  group.add(glass);
  return group;
}

/** A door that leads nowhere in the model, such as the front door: a shut panel. */
function buildClosedDoor(hole: Hole, thickness: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(hole.width, hole.height, 0.05),
    new THREE.MeshStandardMaterial({ color: FRONT_DOOR_COLOR, roughness: 0.5 }),
  );
  mesh.name = `door:${hole.openingId}`;
  mesh.position.set(hole.offset + hole.width / 2, hole.height / 2, -thickness / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
