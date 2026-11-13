/**
 * Furniture edits. Every function takes a scene and returns a new scene,
 * leaving the old one untouched. When an edit is not possible (the piece
 * would end up inside a wall, say) the same scene object is returned, so
 * callers can tell with `result === scene`.
 */
import type { Vec2 } from './collision';
import { pointInsideOrOn, polygonsOverlap, segmentsCross, signedArea } from './geometry';
import { roomHeight, toVec, type Furniture, type Point, type Room, type Scene } from './scene';

/** The four floor corners of a piece. rotationDeg turns clockwise on the plan. */
export function footprint(f: Pick<Furniture, 'position' | 'rotationDeg' | 'size'>): Vec2[] {
  const rad = (f.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = f.size[0] / 2;
  const halfD = f.size[2] / 2;
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([x, y]) => ({
    x: f.position[0] + x * cos - y * sin,
    y: f.position[1] + x * sin + y * cos,
  }));
}

export function roomAt(scene: Scene, p: Vec2): Room | undefined {
  return scene.rooms.find((room) => pointInsideOrOn(p, room.polygon.map(toVec)));
}

/** The room a piece fits in completely, or undefined if it sticks into a wall. */
export function roomThatFits(
  scene: Scene,
  f: Pick<Furniture, 'position' | 'rotationDeg' | 'size'>,
): Room | undefined {
  const corners = footprint(f);
  return scene.rooms.find((room) => {
    if (room.kind === 'void') return false; // nothing stands in a hole in the floor
    const outline = room.polygon.map(toVec);
    if (!pointInsideOrOn(toVec(f.position), outline)) return false;
    if (!corners.every((c) => pointInsideOrOn(c, outline))) return false;
    // In an L-shaped room all corners can be inside while a side still
    // cuts across a wall, so check the sides too.
    for (let i = 0; i < corners.length; i++) {
      for (let j = 0; j < outline.length; j++) {
        if (
          segmentsCross(corners[i], corners[(i + 1) % 4], outline[j], outline[(j + 1) % outline.length])
        ) {
          return false;
        }
      }
    }
    return true;
  });
}

function update(scene: Scene, id: string, change: (f: Furniture) => Furniture | null): Scene {
  const index = scene.furniture.findIndex((f) => f.id === id);
  if (index < 0 || scene.furniture[index].fixed) return scene;
  const next = change(scene.furniture[index]);
  if (next === null) return scene;
  const furniture = [...scene.furniture];
  furniture[index] = next;
  return { ...scene, furniture };
}

const mm = (v: number): number => Math.round(v * 1000) / 1000;

// ---- What may stand where ----

/** Rugs and other flat things, what hangs at a wall (curtains, radiators) and what you walk under (a pergola): they are in nobody's way. */
const isFlat = (f: Pick<Furniture, 'size'> & { model?: string }): boolean =>
  f.size[1] <= 0.1 || /curtain|radiator|pergola/.test(f.model ?? '');
/** Small things that belong on a table top. */
const SMALL = /^(table-lamp|vase|table-plant|books)$/;
/** Furniture with a top that small things can stand on. */
const SURFACE = /table|desk|tv-unit|island|counter|bureau|sideboard/;
const SEAT = /chair|stool/;
/** A chair may be pushed in under a table. */
const tucksUnder = (a: Furniture, b: Furniture): boolean => SEAT.test(a.model) && /table|desk|island|bureau/.test(b.model);

/** The ids of the floor pieces whose footprint overlaps that of `f`. */
function overlapping(scene: Scene, f: Furniture): Furniture[] {
  if (f.mount === 'wall' || isFlat(f)) return [];
  const corners = footprint(f);
  return scene.furniture.filter(
    (o) => o.id !== f.id && !o.removed && o.mount !== 'wall' && !isFlat(o) && polygonsOverlap(corners, footprint(o)),
  );
}

/**
 * Decides whether floor piece `f` may stand where it is. Two pieces
 * cannot share floor space, with these exceptions: flat things such as
 * rugs, a chair pushed under a table, and a small thing (a lamp, a vase)
 * standing wholly on a table top. `allowed` lists pieces it may overlap
 * anyway: the ones it already overlapped, so it can be dragged free.
 * Returns the height it stands at (0 on the floor), or null if blocked.
 */
export function standingHeight(scene: Scene, f: Furniture, allowed: ReadonlySet<string> = new Set()): number | null {
  const corners = footprint(f);
  let height = 0;
  for (const o of overlapping(scene, f)) {
    if (allowed.has(o.id) || tucksUnder(f, o) || tucksUnder(o, f)) continue;
    const top = footprint(o);
    if (SMALL.test(f.model) && SURFACE.test(o.model) && corners.every((c) => pointInsideOrOn(c, top))) {
      height = Math.max(height, o.size[1]);
      continue;
    }
    // A small thing standing on this very piece is not in its way.
    if (SMALL.test(o.model) && (o.elevation ?? 0) > 0 && SURFACE.test(f.model)) continue;
    return null;
  }
  return height;
}

/** The floor pieces that overlap one another without one of the exceptions. For checking a scene file. */
export function clashes(scene: Scene): [string, string][] {
  const found: [string, string][] = [];
  for (const f of scene.furniture) {
    if (f.removed || f.mount === 'wall' || isFlat(f)) continue;
    for (const o of overlapping(scene, f)) {
      if (o.id < f.id || tucksUnder(f, o) || tucksUnder(o, f)) continue;
      if (standingHeight(scene, f, new Set(scene.furniture.filter((x) => x.id !== o.id).map((x) => x.id))) !== null) continue;
      if (standingHeight(scene, o, new Set(scene.furniture.filter((x) => x.id !== f.id).map((x) => x.id))) !== null) continue;
      found.push([f.id, o.id]);
    }
  }
  return found;
}

/**
 * Puts floor piece `f` at the spot it describes, if it fits in a room and
 * is not blocked by other furniture. Returns the placed piece or null.
 */
function settle(scene: Scene, f: Furniture, allowed: ReadonlySet<string>): Furniture | null {
  const room = roomThatFits(scene, f);
  if (!room) return null;
  const height = standingHeight(scene, f, allowed);
  if (height === null) return null;
  const { elevation: _old, ...rest } = f;
  return height > 0 ? { ...rest, room: room.id, elevation: mm(height) } : { ...rest, room: room.id };
}

const idsOf = (list: readonly Furniture[]): Set<string> => new Set(list.map((o) => o.id));

/** The small things standing on `f`. */
function riders(scene: Scene, f: Furniture): Furniture[] {
  if (!SURFACE.test(f.model)) return [];
  const top = footprint(f);
  return scene.furniture.filter(
    (o) => !o.removed && SMALL.test(o.model) && (o.elevation ?? 0) > 0 && footprint(o).every((c) => pointInsideOrOn(c, top)),
  );
}

/**
 * Where a wall-hung piece ends up when dropped at `target`: flat against
 * the nearest wall of the room it is in, facing into the room.
 */
export function snapToWall(
  scene: Scene,
  f: Pick<Furniture, 'size'>,
  target: Point,
): { position: Point; rotationDeg: number; room: string } | undefined {
  const p = toVec(target);
  let best: { position: Point; rotationDeg: number; room: string; distance: number } | undefined;
  for (const room of scene.rooms) {
    if (room.kind === 'balcony' || room.kind === 'void') continue;
    const outline = room.polygon.map(toVec);
    const sign = signedArea(outline) > 0 ? 1 : -1;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const half = f.size[0] / 2;
      if (len < f.size[0] + 0.02) continue;
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const inward = { x: -dir.y * sign, y: dir.x * sign };
      const along = Math.max(half + 0.01, Math.min(len - half - 0.01, (p.x - a.x) * dir.x + (p.y - a.y) * dir.y));
      const onWall = { x: a.x + dir.x * along, y: a.y + dir.y * along };
      const distance = Math.hypot(p.x - onWall.x, p.y - onWall.y);
      if (best && distance >= best.distance) continue;
      const gap = f.size[2] / 2 + 0.004;
      best = {
        position: [mm(onWall.x + inward.x * gap), mm(onWall.y + inward.y * gap)],
        // The front of a piece faces up the page at rotation 0.
        rotationDeg: mm((((Math.atan2(inward.x, -inward.y) * 180) / Math.PI) + 360) % 360),
        room: room.id,
        distance,
      };
    }
  }
  if (!best) return undefined;
  return { position: best.position, rotationDeg: best.rotationDeg, room: best.room };
}

/**
 * Moves a piece towards `target`. If the full move is blocked it tries
 * moving along x only, then y only, so a dragged piece slides along a wall.
 * A wall-hung piece jumps to the nearest wall instead.
 */
export function moveFurniture(scene: Scene, id: string, target: Point): Scene {
  const before = scene.furniture.find((f) => f.id === id);
  const moved = update(scene, id, (f) => {
    if (f.mount === 'wall') {
      const snap = snapToWall(scene, f, target);
      if (!snap) return null;
      if (snap.position[0] === f.position[0] && snap.position[1] === f.position[1]) return null;
      return { ...f, position: snap.position, rotationDeg: snap.rotationDeg, room: snap.room };
    }
    const allowed = idsOf(overlapping(scene, f));
    const attempts: Point[] = [target, [target[0], f.position[1]], [f.position[0], target[1]]];
    for (const position of attempts) {
      if (position[0] === f.position[0] && position[1] === f.position[1]) continue;
      const placed = settle(scene, { ...f, position }, allowed);
      if (placed) return placed;
    }
    return null;
  });
  if (moved === scene || !before || before.mount === 'wall') return moved;
  // What stands on a table moves with the table.
  const onTop = idsOf(riders(scene, before));
  if (onTop.size === 0) return moved;
  const after = moved.furniture.find((f) => f.id === id)!;
  const dx = after.position[0] - before.position[0];
  const dy = after.position[1] - before.position[1];
  return {
    ...moved,
    furniture: moved.furniture.map((f) =>
      onTop.has(f.id) ? { ...f, room: after.room, position: [mm(f.position[0] + dx), mm(f.position[1] + dy)] as Point } : f,
    ),
  };
}

/**
 * The nearest spot to `near`, within 3 m, where a new floor piece fits
 * clear of the walls and of the other furniture.
 */
function findSpot(scene: Scene, f: Furniture, near: Point): Furniture | undefined {
  for (let step = 0; step <= 30; step++) {
    for (let k = 0; k < (step === 0 ? 1 : 12); k++) {
      const angle = (k * Math.PI) / 6;
      const position: Point = [mm(near[0] + Math.cos(angle) * step * 0.1), mm(near[1] + Math.sin(angle) * step * 0.1)];
      const placed = settle(scene, { ...f, position }, new Set());
      if (placed) return placed;
    }
  }
  return undefined;
}

/**
 * Turns a piece by `deltaDeg` (clockwise on the plan). If the turned piece
 * would stick into a wall, it is nudged to the nearest spot within a metre
 * where it fits, so a sofa standing against a wall can still be turned.
 */
export function rotateFurniture(scene: Scene, id: string, deltaDeg: number): Scene {
  return update(scene, id, (f) => {
    if (f.mount === 'wall') return null;
    const rotationDeg = (((f.rotationDeg + deltaDeg) % 360) + 360) % 360;
    const turned = { ...f, rotationDeg };
    const allowed = idsOf(overlapping(scene, f));
    const inPlace = settle(scene, turned, allowed);
    if (inPlace) return inPlace;
    for (let step = 1; step <= 20; step++) {
      for (let k = 0; k < 8; k++) {
        const angle = (k * Math.PI) / 4;
        const position: Point = [
          Math.round((f.position[0] + Math.cos(angle) * step * 0.05) * 1000) / 1000,
          Math.round((f.position[1] + Math.sin(angle) * step * 0.05) * 1000) / 1000,
        ];
        const placed = settle(scene, { ...turned, position }, allowed);
        if (placed) return placed;
      }
    }
    return null;
  });
}

/**
 * Gives a piece a new size: [width, height, depth] in metres. A floor
 * piece that no longer fits where it stands is nudged up to a metre to
 * where it does; a wall-hung piece stays flat against its wall.
 */
export function resizeFurniture(scene: Scene, id: string, size: readonly [number, number, number]): Scene {
  if (!size.every((v) => Number.isFinite(v) && v >= 0.01 && v <= 10)) return scene;
  return update(scene, id, (f) => {
    const next: [number, number, number] = [mm(size[0]), mm(size[1]), mm(size[2])];
    if (next.every((v, i) => v === f.size[i])) return null;
    const sized = { ...f, size: next };
    if (f.mount === 'wall') {
      const snap = snapToWall(scene, sized, f.position);
      if (!snap) return null;
      const room = scene.rooms.find((r) => r.id === snap.room);
      const top = (room ? roomHeight(scene, room) : scene.defaults.ceilingHeight) - next[1];
      if (top < 0) return null;
      return { ...sized, ...snap, elevation: mm(Math.min(f.elevation ?? 0, top)) };
    }
    const room = scene.rooms.find((r) => r.id === f.room);
    if (next[1] > (room ? roomHeight(scene, room) : scene.defaults.ceilingHeight)) return null;
    const allowed = idsOf(overlapping(scene, f));
    for (let step = 0; step <= 20; step++) {
      for (let k = 0; k < (step === 0 ? 1 : 8); k++) {
        const angle = (k * Math.PI) / 4;
        const position: Point = [mm(f.position[0] + Math.cos(angle) * step * 0.05), mm(f.position[1] + Math.sin(angle) * step * 0.05)];
        const placed = settle(scene, { ...sized, position }, allowed);
        if (placed) return placed;
      }
    }
    return null;
  });
}

/** Takes a piece out of the home. It keeps its last position for putting back. */
export function takeOut(scene: Scene, id: string): Scene {
  return update(scene, id, (f) => (f.removed ? null : { ...f, removed: true }));
}

/** Puts a taken-out piece back, at `position` if given, else where it last stood. */
export function putBack(scene: Scene, id: string, position?: Point): Scene {
  return update(scene, id, (f) => {
    if (!f.removed) return null;
    if (f.mount === 'wall') {
      const snap = snapToWall(scene, f, position ?? f.position);
      return snap ? { ...f, ...snap, removed: false } : null;
    }
    const placed = settle(scene, { ...f, removed: false, position: position ?? f.position }, new Set());
    return placed ? { ...placed, removed: false } : null;
  });
}

/** Raises or lowers a wall-hung piece, keeping it between floor and ceiling. */
export function raiseFurniture(scene: Scene, id: string, delta: number): Scene {
  return update(scene, id, (f) => {
    if (f.mount !== 'wall') return null;
    const room = scene.rooms.find((r) => r.id === f.room);
    const top = (room ? roomHeight(scene, room) : scene.defaults.ceilingHeight) - f.size[1];
    const elevation = mm(Math.max(0, Math.min(top, (f.elevation ?? 0) + delta)));
    return elevation === (f.elevation ?? 0) ? null : { ...f, elevation };
  });
}

/** A piece that can be added from the panel. */
export interface CatalogueItem {
  key: string;
  name: string;
  model: string;
  size: [number, number, number];
  color: string;
  mount?: 'wall';
  elevation?: number;
}

/**
 * Adds a new piece from the catalogue as close to `near` as it fits.
 * Returns the new scene and the id of the piece, or the same scene if
 * there is no room for it nearby.
 */
export function addFurniture(scene: Scene, item: CatalogueItem, near: Point, rotationDeg = 0): { scene: Scene; id?: string } {
  const taken = new Set([
    ...scene.furniture.map((f) => f.id),
    ...scene.rooms.map((r) => r.id),
    ...scene.openings.map((o) => o.id),
    ...(scene.solids ?? []).map((x) => x.id),
    ...(scene.lights ?? []).map((l) => l.id),
  ]);
  let n = 1;
  while (taken.has(`${item.key}-${n}`)) n++;
  const id = `${item.key}-${n}`;
  const base = { id, name: item.name, model: item.model, size: item.size, color: item.color };
  let piece: Furniture;
  if (item.mount === 'wall') {
    const snap = snapToWall(scene, item, near);
    if (!snap) return { scene };
    piece = { ...base, ...snap, mount: 'wall', elevation: item.elevation ?? 1.2 };
  } else {
    const spot = findSpot(scene, { ...base, room: '', position: near, rotationDeg }, near);
    if (!spot) return { scene };
    piece = spot;
  }
  return { scene: { ...scene, furniture: [...scene.furniture, piece] }, id };
}

/** Takes out every piece in one room. */
export function emptyRoom(scene: Scene, roomId: string): Scene {
  const goes = (f: Furniture): boolean => f.room === roomId && !f.removed && !f.fixed;
  if (!scene.furniture.some(goes)) return scene;
  return {
    ...scene,
    furniture: scene.furniture.map((f) => (goes(f) ? { ...f, removed: true } : f)),
  };
}

/** Puts all furniture back the way it is in `original`. Paint is kept. */
export function resetLayout(scene: Scene, original: Scene): Scene {
  if (scene.furniture === original.furniture) return scene;
  return { ...scene, furniture: original.furniture };
}

/** Puts every colour back the way it is in `original`. The layout is kept. */
export function resetPaint(scene: Scene, original: Scene): Scene {
  const colors = new Map(original.furniture.map((f) => [f.id, f.color]));
  const furniture = scene.furniture.map((f) =>
    colors.has(f.id) && colors.get(f.id) !== f.color ? { ...f, color: colors.get(f.id) } : f,
  );
  const changed = furniture.some((f, i) => f !== scene.furniture[i]);
  if (!changed && scene.rooms === original.rooms && scene.solids === original.solids) return scene;
  return { ...scene, rooms: original.rooms, solids: original.solids, furniture: changed ? furniture : scene.furniture };
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

/** Something that can be given a colour. */
export type PaintTarget =
  | { kind: 'wall'; room: string; edge: number }
  | { kind: 'floor'; room: string }
  | { kind: 'ceiling'; room: string }
  | { kind: 'solid'; id: string }
  | { kind: 'furniture'; id: string };

/** The current colour of a paint target, if it exists. */
export function colorOf(scene: Scene, target: PaintTarget): string | undefined {
  if (target.kind === 'furniture') {
    return scene.furniture.find((f) => f.id === target.id)?.color ?? undefined;
  }
  if (target.kind === 'solid') {
    const solid = scene.solids?.find((x) => x.id === target.id);
    return solid ? (solid.color ?? scene.defaults.wallColor) : undefined;
  }
  const room = scene.rooms.find((r) => r.id === target.room);
  if (!room) return undefined;
  if (target.kind === 'floor') return room.floor?.color ?? scene.defaults.floorColor;
  if (target.kind === 'ceiling') return room.ceiling?.color ?? scene.defaults.ceilingColor;
  return room.walls?.find((w) => w.edge === target.edge)?.color ?? scene.defaults.wallColor;
}

/** Paints every wall of one room in one go. */
export function paintRoomWalls(scene: Scene, roomId: string, color: string): Scene {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room) return scene;
  return room.polygon.reduce((s, _, edge) => paint(s, { kind: 'wall', room: roomId, edge }, color), scene);
}

/** Sets the colour of a wall, floor, ceiling, built-in block or furniture piece. */
export function paint(scene: Scene, target: PaintTarget, color: string): Scene {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return scene;
  if (colorOf(scene, target)?.toLowerCase() === color.toLowerCase()) return scene;
  if (target.kind === 'furniture') return update(scene, target.id, (f) => ({ ...f, color }));
  if (target.kind === 'solid') {
    if (!scene.solids?.some((x) => x.id === target.id)) return scene;
    return { ...scene, solids: scene.solids.map((x) => (x.id === target.id ? { ...x, color } : x)) };
  }
  const index = scene.rooms.findIndex((r) => r.id === target.room);
  if (index < 0) return scene;
  const room = scene.rooms[index];
  let next: Room;
  if (target.kind === 'floor') {
    next = { ...room, floor: { ...room.floor, color } };
  } else if (target.kind === 'ceiling') {
    next = { ...room, ceiling: { color } };
  } else {
    if (target.edge < 0 || target.edge >= room.polygon.length) return scene;
    const walls = [...(room.walls ?? [])];
    const at = walls.findIndex((w) => w.edge === target.edge);
    if (at >= 0) walls[at] = { ...walls[at], color };
    else walls.push({ edge: target.edge, color });
    next = { ...room, walls };
  }
  const rooms = [...scene.rooms];
  rooms[index] = next;
  return { ...scene, rooms };
}
