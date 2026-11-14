import * as THREE from 'three';
import { roomHeight, toVec, wallColor, type Room, type Scene } from '../core/scene';
import type { Vec2 } from '../core/collision';
import type { Hole, WallModel, WallSlab } from '../core/walls';
import { applySurface, floorSurface, pattern } from './textures';

const FRAME_COLOR = 0xfafafa;
const FRONT_DOOR_COLOR = 0x3f5f85;
const FRAME_BAR = 0.05;

/**
 * Builds the 3D shell of the home from the scene and its wall slabs.
 * Plan (x, y) maps to 3D (x, height, z). Three.js uses Y as "up".
 * Every mesh is named after the scene element it came from, which is
 * what the paint panel will use to find out what was clicked.
 */
export interface ShellOptions {
  /** False for a storey with another one on top: the floor above is its roof. */
  roof?: boolean;
  /** True for an upper storey: its floors get an underside, seen from below. */
  raised?: boolean;
  /** Rooms left without a ceiling, because a void in the storey above opens them up. */
  openCeilings?: readonly string[];
}

export function buildShell(scene: Scene, walls: WallModel, options: ShellOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shell';

  let maxHeight = 0;
  const bounds = new THREE.Box2();
  for (const room of scene.rooms) {
    const points = room.polygon.map(toVec);
    const balcony = room.kind === 'balcony';

    if (room.kind !== 'void') {
      const floor = new THREE.Mesh(flatPolygon(points, 0, true), floorMaterial(scene, room));
      floor.name = `floor:${room.id}`;
      floor.receiveShadow = true;
      group.add(floor);
      if (options.raised) {
        // A thin slab under the floor, so it is solid when seen from below.
        const under = new THREE.Mesh(prism(points, 0.04), matte(scene.defaults.ceilingColor, 1));
        under.name = 'slab';
        under.position.y = -0.045;
        under.castShadow = true;
        group.add(under);
      }
    }

    if (balcony) continue;
    const height = roomHeight(scene, room);
    maxHeight = Math.max(maxHeight, height);
    points.forEach((p) => bounds.expandByPoint(new THREE.Vector2(p.x, p.y)));

    if (options.openCeilings?.includes(room.id)) continue;
    const ceiling = new THREE.Mesh(
      flatPolygon(points, height, false),
      matte(room.ceiling?.color ?? scene.defaults.ceilingColor, 1),
    );
    ceiling.name = `ceiling:${room.id}`;
    group.add(ceiling);
  }

  for (const slab of walls.slabs) group.add(buildSlab(slab, scene, !!options.raised));

  // The floor carries on through each doorway, in the colour of the room
  // the door was declared on.
  for (const threshold of walls.thresholds) {
    const room = scene.rooms.find((r) => r.id === threshold.roomId);
    const strip = new THREE.Mesh(flatPolygon(threshold.polygon, 0, true), floorMaterial(scene, room));
    strip.name = `threshold:${threshold.openingId}`;
    strip.userData.roomId = threshold.roomId;
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

  // Roof slabs over the rooms and a ground slab under the home. Neither is
  // seen from inside; they stop sunlight leaking in from above and below.
  const t = scene.defaults.exteriorWallThickness;
  const size = bounds.getSize(new THREE.Vector2());
  const center = bounds.getCenter(new THREE.Vector2());
  // Each room gets its own roof slab, so courtyards and balconies stay
  // open to the sky and the sun can reach them.
  const rise = options.roof === false ? 0 : (scene.defaults.roofRise ?? 0);
  // A sloping roof is one plane over the whole storey: low over the front
  // (largest y), where it shows as a thin white edge from the street, and
  // climbing towards the back. Every room's piece of roof lies on it, so
  // the pieces join up. The interior keeps its flat ceilings.
  const front = bounds.max.y;
  const depth = Math.max(1, bounds.max.y - bounds.min.y);
  const roofTop = (p: Vec2): number => maxHeight + 0.45 + (rise * (front - p.y)) / depth;
  for (const room of scene.rooms) {
    if (room.kind === 'balcony' || options.openCeilings?.includes(room.id)) continue;
    // Under another storey the roof is only a thin cover, for the parts
    // the floor above does not reach.
    const covered = options.roof === false;
    if (!covered && rise > 0) {
      const points = room.polygon.map(toVec);
      const height = roomHeight(scene, room);
      // The walls carry on up to the slope, over the walls' thickness...
      const upstand = new THREE.Mesh(
        slopedPrism(spread(points, t), () => height, (p) => roofTop(p) - 0.2),
        sided(matte(scene.defaults.trimColor ? (scene.defaults.exteriorColor ?? '#f4f1ea') : '#f4f1ea', 0.9)),
      );
      // ...then a white roof slab that overhangs them, with a dark metal sheet on top.
      const slab = new THREE.Mesh(
        slopedPrism(spread(points, t + 0.5), (p) => roofTop(p) - 0.2, roofTop),
        sided(matte(scene.defaults.trimColor ?? '#f1efea', 0.9)),
      );
      const sheet = new THREE.Mesh(
        slopedPrism(spread(points, t + 0.44), roofTop, (p) => roofTop(p) + 0.025),
        sided(new THREE.MeshStandardMaterial({ color: '#4a4d50', roughness: 0.55, metalness: 0.3 })),
      );
      for (const part of [upstand, slab, sheet]) {
        part.name = 'roof';
        part.castShadow = true;
        part.receiveShadow = true;
        group.add(part);
      }
      continue;
    }
    // The top roof is a white slab that overhangs the walls.
    const outline = covered ? room.polygon.map(toVec) : spread(room.polygon.map(toVec), t + 0.45);
    const roof = new THREE.Mesh(prism(outline, covered ? 0.03 : 0.26), matte(covered ? '#d9d6d0' : '#f1efea', 0.9));
    roof.name = 'roof';
    roof.position.y = roomHeight(scene, room) + (covered ? 0.001 : 0.01);
    roof.castShadow = true;
    group.add(roof);
  }
  const slabGeometry = new THREE.BoxGeometry(size.x + 2 * t, 0.2, size.y + 2 * t);
  if (!options.raised) {
    const ground = new THREE.Mesh(slabGeometry, matte('#55524d', 1));
    ground.name = 'ground';
    ground.position.set(center.x, -0.11, center.y);
    group.add(ground);
    if (scene.site) {
      // Open ground round the home: the street and the neighbours' side.
      const reach = scene.site.margin;
      const site = new THREE.Mesh(
        new THREE.BoxGeometry(size.x + 2 * reach, 0.1, size.y + 2 * reach),
        matte(scene.site.color, 1),
      );
      site.name = 'site';
      site.position.set(center.x, -0.07, center.y);
      site.receiveShadow = true;
      group.add(site);
    }
  }

  return group;
}

/**
 * Brings the colours of the shell in line with the scene, after painting.
 * Only colours change, so the meshes are kept and just recoloured.
 */
export function applyShellColors(shell: THREE.Object3D, scene: Scene): void {
  const rooms = new Map(scene.rooms.map((r) => [r.id, r]));
  for (const child of shell.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const [kind, ...rest] = child.name.split(':');
    let color: string | undefined;
    if (kind === 'floor' || kind === 'threshold') {
      const room = rooms.get(kind === 'floor' ? rest.join(':') : child.userData.roomId);
      color = room?.floor?.color ?? scene.defaults.floorColor;
    } else if (kind === 'ceiling') {
      color = rooms.get(rest.join(':'))?.ceiling?.color ?? scene.defaults.ceilingColor;
    } else if (kind === 'wall') {
      const room = rooms.get(rest.slice(0, -1).join(':'));
      if (room) color = wallColor(scene, room, Number(rest[rest.length - 1]));
    } else if (kind === 'solid') {
      const solid = scene.solids?.find((x) => x.id === rest.join(':'));
      color = solid?.color ?? scene.defaults.wallColor;
    }
    if (color) (child.material as THREE.MeshStandardMaterial).color.set(color);
  }
}

/** A floor's colour, with the pattern for its material (planks, tiles) on top. */
function floorMaterial(scene: Scene, room: Room | undefined): THREE.MeshStandardMaterial {
  const material = matte(room?.floor?.color ?? scene.defaults.floorColor, 0.6);
  const surface = floorSurface(room?.floor?.material);
  if (surface) applySurface(material, surface[0], surface[1]);
  return material;
}

function matte(color: string, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Moves every corner of a polygon outwards from its middle by `by` metres along each axis. */
function spread(points: readonly Vec2[], by: number): Vec2[] {
  const box = new THREE.Box2().setFromPoints(points.map((p) => new THREE.Vector2(p.x, p.y)));
  const mid = box.getCenter(new THREE.Vector2());
  return points.map((p) => ({ x: p.x + Math.sign(p.x - mid.x) * by, y: p.y + Math.sign(p.y - mid.y) * by }));
}

function sided(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.side = THREE.DoubleSide;
  return material;
}

/**
 * A solid over a plan polygon whose bottom and top heights may vary from
 * corner to corner (for sloping roofs). Heights are linear along each edge.
 */
function slopedPrism(points: readonly Vec2[], bottom: (p: Vec2) => number, top: (p: Vec2) => number): THREE.BufferGeometry {
  const contour = points.map((p) => new THREE.Vector2(p.x, p.y));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const out: number[] = [];
  const push = (p: Vec2, h: number): void => {
    out.push(p.x, h, p.y);
  };
  for (const [a, b, c] of faces) {
    push(points[a], top(points[a]));
    push(points[c], top(points[c]));
    push(points[b], top(points[b]));
    push(points[a], bottom(points[a]));
    push(points[b], bottom(points[b]));
    push(points[c], bottom(points[c]));
  }
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    push(a, bottom(a));
    push(b, bottom(b));
    push(b, top(b));
    push(a, bottom(a));
    push(b, top(b));
    push(a, top(a));
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  geometry.computeVertexNormals();
  return geometry;
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
function buildSlab(slab: WallSlab, scene: Scene, raised: boolean): THREE.Mesh {
  const exteriorColor = scene.defaults.exteriorColor;
  const dx = slab.b.x - slab.a.x;
  const dy = slab.b.y - slab.a.y;
  const length = Math.hypot(dx, dy);
  const top = slab.height;

  // The wall's outline, walked along its bottom edge with each door
  // notched out. A gate that is cut through the full height of a low wall
  // splits the wall into separate pieces, so nothing is left over it.
  const end = length + slab.extendEnd;
  const pieces: { shape: THREE.Shape; from: number; to: number }[] = [];
  let shape = new THREE.Shape();
  let from = 0;
  shape.moveTo(0, 0);
  const close = (to: number): void => {
    shape.lineTo(to, 0);
    shape.lineTo(to, top);
    shape.lineTo(from, top);
    shape.closePath();
    if (to - from > 0.005) pieces.push({ shape, from, to });
  };
  for (const hole of [...slab.holes].sort((p, q) => p.offset - q.offset)) {
    if (hole.sill > 0.001) continue;
    if (hole.height >= top) {
      close(hole.offset);
      shape = new THREE.Shape();
      from = hole.offset + hole.width;
      shape.moveTo(from, 0);
      continue;
    }
    shape.lineTo(hole.offset, 0);
    shape.lineTo(hole.offset, hole.height);
    shape.lineTo(hole.offset + hole.width, hole.height);
    shape.lineTo(hole.offset + hole.width, 0);
  }
  close(end);

  for (const hole of slab.holes) {
    if (hole.sill <= 0.001) continue;
    const path = new THREE.Path();
    path.moveTo(hole.offset, hole.sill);
    path.lineTo(hole.offset + hole.width, hole.sill);
    path.lineTo(hole.offset + hole.width, hole.sill + hole.height);
    path.lineTo(hole.offset, hole.sill + hole.height);
    path.closePath();
    const piece = pieces.find((x) => hole.offset >= x.from - 1e-6 && hole.offset + hole.width <= x.to + 1e-6);
    piece?.shape.holes.push(path);
  }

  const geometry = new THREE.ExtrudeGeometry(pieces.map((x) => x.shape), { depth: slab.thickness, bevelEnabled: false });
  geometry.translate(0, 0, -slab.thickness);

  const material = matte(slab.color, 0.95);
  if (slab.glass) {
    // A glass balustrade: the slab itself is the pane.
    material.color.set('#cfe2e6');
    material.roughness = 0.05;
    material.transparent = true;
    material.opacity = 0.22;
    material.depthWrite = false;
  } else if (slab.boundary) {
    applySurface(material, 'stone', 1 / 2.4);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${slab.kind}:${slab.roomId}:${slab.edge}`;
  const along = new THREE.Vector3(dx / length, 0, dy / length);
  const up = new THREE.Vector3(0, 1, 0);
  const inward = new THREE.Vector3().crossVectors(along, up);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, up, inward));
  mesh.position.set(slab.a.x, 0, slab.a.y);
  mesh.castShadow = !slab.glass;
  mesh.receiveShadow = true;

  const doors = slab.holes.filter((h) => h.sill <= 0.001);
  const full = length + slab.extendEnd;
  if (slab.glass) addGlassFittings(mesh, slab, full, doors, raised && slab.outside);
  if (slab.boundary) addBoundaryFittings(mesh, slab, full, doors);

  if (slab.kind === 'wall' && slab.outside && exteriorColor) {
    // The outside of an outside wall is a thin skin: stone cladding or render.
    const kind = slab.finish ?? scene.defaults.exteriorMaterial ?? 'render';
    const finish = matte(kind === 'stone' ? (scene.defaults.stoneColor ?? exteriorColor) : exteriorColor, 0.95);
    if (kind === 'stone') applySurface(finish, 'stone', 1 / 2.4);
    const skin = new THREE.Mesh(
      new THREE.ExtrudeGeometry(pieces.map((x) => x.shape), { depth: 0.015, bevelEnabled: false }).translate(0, 0, -slab.thickness - 0.015),
      finish,
    );
    skin.name = 'skin';
    skin.castShadow = true;
    skin.receiveShadow = true;
    mesh.add(skin);
    // A white band where the floor above (or the roof) meets the wall, standing proud of it.
    if (kind === 'fins') addFins(mesh, slab, full);
    const band = new THREE.Mesh(new THREE.BoxGeometry(full + 0.4, 0.32, 0.2), matte(scene.defaults.trimColor ?? '#f6f4ef', 0.85));
    band.name = 'band';
    band.position.set(full / 2, top + 0.04, -slab.thickness - 0.1);
    band.castShadow = true;
    band.receiveShadow = true;
    mesh.add(band);
  }
  if (slab.kind === 'wall') addTrim(mesh, slab, length);

  for (const hole of slab.holes) {
    if (!hole.primary) continue;
    if (hole.type === 'window') mesh.add(buildWindow(hole, slab.thickness));
    else if (!hole.passable && slab.kind === 'wall') mesh.add(buildClosedDoor(hole, slab.thickness));
  }
  return mesh;
}

/**
 * A screen of slim vertical aluminium fins standing off the outside of a
 * wall, over its full height, windows included, with a warm light strip
 * along the top that glows after dark.
 */
function addFins(mesh: THREE.Mesh, slab: WallSlab, length: number): void {
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.45, metalness: 0.6 });
  const fin = new THREE.BoxGeometry(0.05, slab.height - 0.1, 0.14);
  const pitch = 0.22;
  const count = Math.floor((length - 0.1) / pitch);
  const start = (length - count * pitch) / 2;
  for (let i = 0; i <= count; i++) {
    const piece = new THREE.Mesh(fin, metal);
    piece.name = 'trim';
    piece.position.set(start + i * pitch, (slab.height - 0.1) / 2, -slab.thickness - 0.13);
    piece.castShadow = true;
    mesh.add(piece);
  }
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc27a, emissiveIntensity: 0.8 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.02, 0.04), glow);
  strip.name = 'trim';
  strip.position.set(length / 2, slab.height - 0.14, -slab.thickness - 0.05);
  mesh.add(strip);
}

/** The stretches of a wall between its doorways, as [from, to] along the wall. */
function between(length: number, doors: readonly Hole[]): [number, number][] {
  const parts: [number, number][] = [];
  let cursor = 0;
  for (const door of [...doors].sort((p, q) => p.offset - q.offset)) {
    if (door.offset - cursor > 0.02) parts.push([cursor, door.offset]);
    cursor = Math.max(cursor, door.offset + door.width);
  }
  if (length - cursor > 0.02) parts.push([cursor, length]);
  return parts;
}

/** Steel handrail and base shoe for a glass balustrade, and a white slab edge under a raised balcony. */
function addGlassFittings(mesh: THREE.Mesh, slab: WallSlab, length: number, doors: readonly Hole[], edge: boolean): void {
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.3, metalness: 0.9 });
  for (const [from, to] of between(length, doors)) {
    for (const [h, y] of [[0.04, slab.height - 0.02], [0.06, 0.03]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(to - from, h, slab.thickness + 0.03), steel);
      bar.name = 'trim';
      bar.position.set((from + to) / 2, y, -slab.thickness / 2);
      bar.castShadow = true;
      mesh.add(bar);
    }
  }
  if (edge) {
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(length + 0.5, 0.36, 0.25), matte('#f6f4ef', 0.85));
    fascia.name = 'band';
    fascia.position.set(length / 2, -0.15, -slab.thickness - 0.1);
    fascia.castShadow = true;
    fascia.receiveShadow = true;
    mesh.add(fascia);
  }
}

/** A white coping on a boundary wall, and a timber gate between grey posts in each gateway. */
function addBoundaryFittings(mesh: THREE.Mesh, slab: WallSlab, length: number, doors: readonly Hole[]): void {
  const white = matte('#f6f4ef', 0.85);
  for (const [from, to] of between(length, doors)) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(to - from, 0.05, slab.thickness + 0.06), white);
    cap.name = 'trim';
    cap.position.set((from + to) / 2, slab.height + 0.025, -slab.thickness / 2);
    cap.castShadow = true;
    mesh.add(cap);
  }
  const post = matte('#9c9a96', 0.8);
  for (const door of doors) {
    if (!door.primary || !door.passable) continue;
    const height = Math.max(1.5, slab.height + 0.25);
    for (const x of [door.offset - 0.15, door.offset + door.width + 0.15]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.3, height, slab.thickness + 0.14), post);
      pillar.name = 'trim';
      pillar.position.set(x, height / 2, -slab.thickness / 2);
      pillar.castShadow = true;
      mesh.add(pillar);
    }
    // Two leaves, swung open into the garden so the way in stays clear.
    const leafWidth = door.width / 2 - 0.02;
    for (const side of [1, -1]) {
      const leaf = buildGateLeaf(leafWidth, Math.max(1.4, slab.height), side);
      leaf.position.set(side === 1 ? door.offset + 0.01 : door.offset + door.width - 0.01, 0.05, -slab.thickness / 2);
      leaf.rotation.y = -side * 1.25;
      mesh.add(leaf);
    }
  }
}

/**
 * One leaf of a timber gate: horizontal slats in a dark steel frame with a
 * half-circle of steel rings on its free edge, so a closed pair shows a circle.
 * It runs from its hinge at x = 0 towards +x (side 1) or -x (side -1).
 */
function buildGateLeaf(width: number, height: number, side: number): THREE.Group {
  const leaf = new THREE.Group();
  leaf.name = 'gate';
  const wood = new THREE.MeshStandardMaterial({ color: 0xa8784b, roughness: 0.55 });
  wood.map = pattern('wood', 1);
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3b3d, roughness: 0.45, metalness: 0.6 });
  const part = (w: number, h: number, d: number, x: number, y: number, material: THREE.Material): void => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    box.position.set(side * x, y, 0);
    box.castShadow = true;
    leaf.add(box);
  };
  const slats = Math.round((height - 0.1) / 0.14);
  for (let i = 0; i < slats; i++) part(width - 0.08, 0.12, 0.03, width / 2, 0.08 + i * ((height - 0.1) / slats) + 0.06, wood);
  part(width, 0.04, 0.05, width / 2, 0.02, steel);
  part(width, 0.04, 0.05, width / 2, height - 0.02, steel);
  part(0.04, height, 0.05, 0.02, height / 2, steel);
  part(0.04, height, 0.05, width - 0.02, height / 2, steel);
  for (let i = 0; i < 3; i++) {
    const r = height * 0.32 - i * 0.07;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 32, Math.PI), steel);
    // A half ring, its open side on the leaf's free edge.
    ring.rotation.z = side === 1 ? Math.PI / 2 : -Math.PI / 2;
    ring.position.set(side * width, height / 2, 0.03);
    leaf.add(ring);
  }
  return leaf;
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
  for (const d of doors) {
    const from = d.offset - FRAME_BAR;
    const to = d.offset + d.width + FRAME_BAR;
    part(from - cursor, 0.07, (cursor + from) / 2, 0.035);
    // A gate cut through the full height of a low wall has pillars, not a frame.
    if (d.height < slab.height) {
      part(FRAME_BAR, d.height, d.offset - FRAME_BAR / 2, d.height / 2);
      part(FRAME_BAR, d.height, d.offset + d.width + FRAME_BAR / 2, d.height / 2);
      part(to - from, FRAME_BAR, (from + to) / 2, d.height + FRAME_BAR / 2);
    }
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
