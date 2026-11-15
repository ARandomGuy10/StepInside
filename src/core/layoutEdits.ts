/**
 * Layout edits: moving walls and adding, moving or removing doors and
 * windows. Like the furniture edits, each takes a scene and returns a new
 * one, or the same scene when the change is not possible, so callers can
 * tell with `result === scene`. Every result is checked by the scene
 * parser, so an edit can never leave rooms overlapping or a door hanging
 * off the end of its wall.
 */
import type { Vec2 } from './collision';
import { cross, dot, length, pointInsideOrOn, signedArea, sub } from './geometry';
import { parseScene, toVec, type Opening, type Point, type Room, type Scene } from './scene';

/** Rooms further apart than this do not share a wall. Matches the wall builder. */
const MAX_WALL_GAP = 0.6;
/** Walls stay on a 5 mm grid, so numbers in the file stay readable. */
const grid = (v: number): number => Math.round(v * 200) / 200;

const edgeOf = (room: Room, edge: number): [Vec2, Vec2] => [toVec(room.polygon[edge]), toVec(room.polygon[(edge + 1) % room.polygon.length])];

/** The unit normal of an edge pointing out of the room. */
export function outwardNormal(room: Room, edge: number): Vec2 {
  const [a, b] = edgeOf(room, edge);
  const d = sub(b, a);
  const len = length(d) || 1;
  const n = { x: -d.y / len, y: d.x / len };
  const mid = { x: (a.x + b.x) / 2 + n.x * 0.02, y: (a.y + b.y) / 2 + n.y * 0.02 };
  return pointInsideOrOn(mid, room.polygon.map(toVec)) ? { x: -n.x, y: -n.y } : n;
}

/** Edge length in metres. */
export function edgeLength(room: Room, edge: number): number {
  const [a, b] = edgeOf(room, edge);
  return length(sub(b, a));
}

/**
 * The edges of other rooms on the far side of this wall: parallel, facing,
 * within a wall's thickness, and overlapping along their length.
 */
export function facingEdges(scene: Scene, roomId: string, edge: number): { room: string; edge: number }[] {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const [a, b] = edgeOf(room, edge);
  const d = sub(b, a);
  const len = length(d);
  const u = { x: d.x / len, y: d.y / len };
  const n = outwardNormal(room, edge);
  const found: { room: string; edge: number }[] = [];
  for (const other of scene.rooms) {
    if (other.id === roomId) continue;
    other.polygon.forEach((_, j) => {
      const [c, e] = edgeOf(other, j);
      const f = sub(e, c);
      const flen = length(f);
      if (flen < 1e-6) return;
      // Parallel: no turn between the two edges.
      if (Math.abs(cross(u, { x: f.x / flen, y: f.y / flen })) > 0.01) return;
      // Across the wall: in front of this edge, not too far.
      const gap = dot(sub(c, a), n);
      if (gap < -0.005 || gap > MAX_WALL_GAP) return;
      // Overlapping along the wall by more than a few centimetres.
      const t0 = dot(sub(c, a), u);
      const t1 = dot(sub(e, a), u);
      const overlap = Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap > 0.05) found.push({ room: other.id, edge: j });
    });
  }
  return found;
}

/** Where two lines meet, or null when they are parallel. */
function meet(p: Vec2, dp: Vec2, q: Vec2, dq: Vec2): Vec2 | null {
  const den = cross(dp, dq);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), dq) / den;
  return { x: p.x + dp.x * t, y: p.y + dp.y * t };
}

/**
 * Slides one edge of a polygon sideways by `shift`, keeping the edges on
 * either side on their own lines, so a rectangle stays a rectangle and an
 * angled wall keeps its angle.
 */
function slideEdge(polygon: Point[], edge: number, shift: Vec2): Point[] {
  const n = polygon.length;
  const at = (i: number): Vec2 => toVec(polygon[((i % n) + n) % n]);
  const i0 = edge;
  const i1 = (edge + 1) % n;
  const a = at(i0);
  const b = at(i1);
  const d = sub(b, a);
  const moved = { x: a.x + shift.x, y: a.y + shift.y };
  const before = at(i0 - 1);
  const after = at(i1 + 1);
  const newA = meet(before, sub(a, before), moved, d) ?? moved;
  const newB = meet(after, sub(b, after), moved, d) ?? { x: b.x + shift.x, y: b.y + shift.y };
  const next = polygon.map((p) => [p[0], p[1]] as Point);
  next[i0] = [grid(newA.x), grid(newA.y)];
  next[i1] = [grid(newB.x), grid(newB.y)];
  return next;
}

let problem = '';

/** Why the last refused layout edit was refused, in plain words. */
export function lastLayoutProblem(): string {
  return problem;
}

/** The scene if it passes every check the scene file does, otherwise null (and `problem` says why). */
function checked(scene: Scene): Scene | null {
  try {
    parseScene(JSON.parse(JSON.stringify(scene)));
    problem = '';
    return scene;
  } catch (e) {
    const issues: string[] = (e as { issues?: string[] }).issues ?? [];
    const first = issues[0] ?? '';
    const name = (path: string): string => {
      const m = /rooms\[(\d+)\]/.exec(path);
      return m ? (scene.rooms[Number(m[1])]?.name ?? 'a room') : 'a room';
    };
    if (/overlaps/.test(first)) problem = `It would run into ${name(first.split('overlaps')[1] ?? '')}.`;
    else if (/does not fit on its wall/.test(first)) problem = 'A door or window would no longer fit on its wall.';
    else if (/intersect|cross/.test(first)) problem = 'The room would fold over itself.';
    else problem = 'That would break the plan.';
    return null;
  }
}

/**
 * Moves a wall of a room by `distance` metres: positive makes the room
 * bigger. The room on the other side of the wall gives up the same space,
 * so the wall moves as one. Doors and windows stay where they are along the
 * wall. Returns the same scene if the move would make rooms overlap, leave
 * a room too small, or push a door or window off its wall.
 */
export function moveWall(scene: Scene, roomId: string, edge: number, distance: number): Scene {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room || edge < 0 || edge >= room.polygon.length || Math.abs(distance) < 0.001) return scene;
  const n = outwardNormal(room, edge);
  const shift = { x: n.x * distance, y: n.y * distance };
  const moving = [{ room: roomId, edge }, ...facingEdges(scene, roomId, edge)];
  const rooms = scene.rooms.map((r) => {
    const mine = moving.filter((m) => m.room === r.id);
    if (!mine.length) return r;
    let polygon = r.polygon;
    for (const m of mine) polygon = slideEdge(polygon, m.edge, shift);
    return { ...r, polygon };
  });
  // No room may shrink to a sliver.
  if (rooms.some((r) => r !== scene.rooms.find((o) => o.id === r.id) && Math.abs(signedArea(r.polygon.map(toVec))) < 1)) {
    problem = 'A room would become too small.';
    return scene;
  }
  return checked({ ...scene, rooms }) ?? scene;
}

/** Usual sizes for a new door or window, in metres. */
export const OPENING_DEFAULTS: Record<Opening['type'], { width: number; height: number; sill: number }> = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
};

/**
 * Adds a door or window to a wall, centred as near to `at` metres from the
 * wall's first corner as it fits beside what is already there. Returns the
 * scene and the new id.
 */
export function addOpening(scene: Scene, roomId: string, edge: number, type: Opening['type'], at: number): { scene: Scene; id?: string } {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room || edge < 0 || edge >= room.polygon.length) return { scene };
  const size = OPENING_DEFAULTS[type];
  const wall = edgeLength(room, edge);
  const width = Math.min(size.width, wall - 0.2);
  if (width < 0.5) return { scene };
  // Two openings may not share the same stretch of wall, so look outwards
  // from where it was asked for to the nearest free stretch.
  const free = (start: number): boolean =>
    !scene.openings.some((o) => o.room === roomId && o.edge === edge && o.offset < start + width + 0.1 && start < o.offset + o.width + 0.1);
  const clamp = (v: number): number => grid(Math.max(0.1, Math.min(wall - width - 0.1, v)));
  let offset = NaN;
  for (let step = 0; step * 0.05 <= wall && Number.isNaN(offset); step++) {
    for (const sign of step === 0 ? [1] : [1, -1]) {
      const start = clamp(at - width / 2 + sign * step * 0.05);
      if (free(start)) {
        offset = start;
        break;
      }
    }
  }
  if (Number.isNaN(offset)) {
    problem = 'This wall has no free stretch that wide.';
    return { scene };
  }
  const taken = new Set(scene.openings.map((o) => o.id));
  let k = 1;
  while (taken.has(`${type}-${roomId}-${k}`)) k++;
  const id = `${type}-${roomId}-${k}`;
  const opening: Opening = {
    id, type, room: roomId, edge, offset, width: grid(width), height: size.height,
    ...(type === 'window' ? { sill: size.sill } : {}),
  };
  const next = checked({ ...scene, openings: [...scene.openings, opening] });
  return next ? { scene: next, id } : { scene };
}

/** Slides a door or window along its wall to start `offset` metres from the first corner. */
export function moveOpening(scene: Scene, id: string, offset: number): Scene {
  const o = scene.openings.find((x) => x.id === id);
  const room = o && scene.rooms.find((r) => r.id === o.room);
  if (!o || !room) return scene;
  const wall = edgeLength(room, o.edge);
  const next = grid(Math.max(0.05, Math.min(wall - o.width - 0.05, offset)));
  if (Math.abs(next - o.offset) < 0.001) return scene;
  const clash = scene.openings.some(
    (x) => x.id !== id && x.room === o.room && x.edge === o.edge && x.offset < next + o.width && next < x.offset + x.width,
  );
  if (clash) return scene;
  return checked({ ...scene, openings: scene.openings.map((x) => (x.id === id ? { ...x, offset: next } : x)) }) ?? scene;
}

/** Makes a door or window wider or narrower about its middle. */
export function resizeOpening(scene: Scene, id: string, width: number): Scene {
  const o = scene.openings.find((x) => x.id === id);
  if (!o || width < 0.4 || Math.abs(width - o.width) < 0.001) return scene;
  const offset = grid(o.offset + (o.width - width) / 2);
  return checked({ ...scene, openings: scene.openings.map((x) => (x.id === id ? { ...x, width: grid(width), offset } : x)) }) ?? scene;
}

export function removeOpening(scene: Scene, id: string): Scene {
  if (!scene.openings.some((o) => o.id === id)) return scene;
  return { ...scene, openings: scene.openings.filter((o) => o.id !== id) };
}
