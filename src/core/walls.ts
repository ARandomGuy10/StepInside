/**
 * Turns the rooms of a scene into wall slabs and collision lines.
 *
 * Rooms are inside outlines, so the wall itself is the gap between two
 * rooms. Each room builds a slab on each of its edges, growing outwards:
 * - If another room faces the edge, the two slabs meet in the middle of
 *   the gap. If that neighbour is a balcony, the room's slab fills the gap.
 * - If nothing faces the edge, it is an outside wall with the default
 *   exterior thickness.
 * - A balcony builds a low railing on its free edges and nothing on the
 *   edges that face a room.
 *
 * An opening is declared once, on one room's edge. It is also cut into
 * the facing edge of the room behind it, so a doorway goes all the way
 * through the wall.
 *
 * No Three.js here: the result is plain data that the renderer draws.
 */
import type { Segment, Vec2 } from './collision';
import { cross, dot, length, signedArea, sub } from './geometry';
import { toVec, wallColor, wallHeight, type Opening, type Room, type Scene } from './scene';

/** Rooms further apart than this are not treated as sharing a wall. */
const MAX_WALL_GAP = 0.6;
const RAILING_THICKNESS = 0.05;
const RAILING_COLOR = '#8f8b84';
const TOLERANCE = 0.005;

export interface Hole {
  openingId: string;
  type: 'door' | 'window';
  /** Distance along the slab from its start point `a`. */
  offset: number;
  width: number;
  sill: number;
  height: number;
  /** True on the edge the opening was declared on, false on the facing copy. */
  primary: boolean;
  /** A door you can walk through: it leads into another room. */
  passable: boolean;
}

export interface WallSlab {
  roomId: string;
  /** Edge index in the room's polygon, as written in the scene file. */
  edge: number;
  kind: 'wall' | 'railing';
  /**
   * The inside face runs from a to b. Looking from a to b, the room is
   * on the right and the slab's thickness grows to the left.
   */
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
  /** Extra length past b, to fill the corner with the next wall. */
  extendEnd: number;
  color: string;
  holes: Hole[];
}

/** The strip of floor inside a doorway, between the two rooms it joins. */
export interface Threshold {
  openingId: string;
  roomId: string;
  polygon: Vec2[];
}

export interface WallModel {
  slabs: WallSlab[];
  collision: Segment[];
  thresholds: Threshold[];
}

interface Edge {
  room: Room;
  /** Edge index as written in the scene file. */
  index: number;
  a: Vec2;
  b: Vec2;
  dir: Vec2;
  outward: Vec2;
  length: number;
  /** True when a and b are swapped relative to the scene file. */
  reversed: boolean;
  thickness: number;
  holes: Hole[];
}

const isBalcony = (room: Room): boolean => room.kind === 'balcony';

/** A room's edges, all running clockwise on the page so "outward" is consistent. */
function edgesOf(room: Room): Edge[] {
  const points = room.polygon.map(toVec);
  const n = points.length;
  const reversed = signedArea(points) < 0;
  const edges: Edge[] = [];
  for (let k = 0; k < n; k++) {
    // When reversed, walk the polygon backwards: step k covers file edge n-1-k.
    const index = reversed ? n - 1 - k : k;
    const from = points[index];
    const to = points[(index + 1) % n];
    const a = reversed ? to : from;
    const b = reversed ? from : to;
    const len = length(sub(b, a));
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    edges.push({
      room, index, a, b, dir, reversed, length: len,
      outward: { x: dir.y, y: -dir.x },
      thickness: 0,
      holes: [],
    });
  }
  return edges;
}

/** The gap between two edges if they face each other across a wall, else null. */
function facingGap(e: Edge, f: Edge): number | null {
  if (dot(e.outward, f.outward) > -0.999) return null;
  const gap = dot(sub(f.a, e.a), e.outward);
  if (gap < 1e-4 || gap > MAX_WALL_GAP) return null;
  const t0 = dot(sub(f.a, e.a), e.dir);
  const t1 = dot(sub(f.b, e.a), e.dir);
  const overlap = Math.min(e.length, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
  return overlap > 0.01 ? gap : null;
}

export function buildWalls(scene: Scene): WallModel {
  const byRoom = new Map<string, Edge[]>(scene.rooms.map((room) => [room.id, edgesOf(room)]));
  const all = [...byRoom.values()].flat();
  const facing = new Map<Edge, Edge[]>();

  // 1. Thickness of every edge's slab.
  for (const e of all) {
    const neighbours = all.filter((f) => f.room !== e.room && facingGap(e, f) !== null);
    facing.set(e, neighbours);
    if (isBalcony(e.room)) {
      e.thickness = neighbours.length > 0 ? 0 : RAILING_THICKNESS;
      continue;
    }
    e.thickness = scene.defaults.exteriorWallThickness;
    for (const f of neighbours) {
      const gap = facingGap(e, f)!;
      e.thickness = Math.min(e.thickness, isBalcony(f.room) ? gap : gap / 2);
    }
  }

  // 2. Holes, on the declared edge and on any edge facing it.
  const jambs: Segment[] = [];
  const thresholds: Threshold[] = [];
  for (const opening of scene.openings) {
    const e = byRoom.get(opening.room)!.find((edge) => edge.index === opening.edge)!;
    const offset = e.reversed ? e.length - opening.offset - opening.width : opening.offset;
    const start = along(e, offset);
    const end = along(e, offset + opening.width);
    const copies: { edge: Edge; offset: number }[] = [];
    for (const f of facing.get(e)!) {
      const u0 = dot(sub(end, f.a), f.dir);
      const u1 = dot(sub(start, f.a), f.dir);
      if (u0 < -TOLERANCE || u1 > f.length + TOLERANCE) continue;
      copies.push({ edge: f, offset: u0 });
    }
    const passable = opening.type === 'door' && copies.length > 0;
    e.holes.push(makeHole(opening, offset, true, passable));
    for (const copy of copies) {
      copy.edge.holes.push(makeHole(opening, copy.offset, false, passable));
      if (passable) {
        // The sides of the doorway, so the walker cannot slip into the wall.
        jambs.push({ a: start, b: along(copy.edge, copy.offset + opening.width) });
        jambs.push({ a: end, b: along(copy.edge, copy.offset) });
        thresholds.push({
          openingId: opening.id,
          roomId: opening.room,
          polygon: [
            start,
            end,
            along(copy.edge, copy.offset),
            along(copy.edge, copy.offset + opening.width),
          ],
        });
      }
    }
  }

  // 3. Slabs and collision lines.
  const slabs: WallSlab[] = [];
  const collision: Segment[] = [...jambs];
  for (const edges of byRoom.values()) {
    edges.forEach((e, k) => {
      const next = edges[(k + 1) % edges.length];
      const cornerIsConvex = cross(e.dir, next.dir) > 0;
      if (e.thickness > 0) {
        slabs.push({
          roomId: e.room.id,
          edge: e.index,
          kind: isBalcony(e.room) ? 'railing' : 'wall',
          a: e.a,
          b: e.b,
          thickness: e.thickness,
          height: wallHeight(scene, e.room, e.index),
          extendEnd: cornerIsConvex ? next.thickness : 0,
          color: isBalcony(e.room)
            ? (e.room.walls?.find((w) => w.edge === e.index)?.color ?? RAILING_COLOR)
            : wallColor(scene, e.room, e.index),
          holes: [...e.holes].sort((p, q) => p.offset - q.offset),
        });
      }
      // The walker is blocked by the edge, except across passable doors.
      let cursor = 0;
      const gaps = e.holes.filter((h) => h.passable).sort((p, q) => p.offset - q.offset);
      for (const gap of gaps) {
        if (gap.offset - cursor > 1e-6) collision.push({ a: along(e, cursor), b: along(e, gap.offset) });
        cursor = Math.max(cursor, gap.offset + gap.width);
      }
      if (e.length - cursor > 1e-6) collision.push({ a: along(e, cursor), b: e.b });
    });
  }
  return { slabs, collision, thresholds };
}

function along(e: Edge, distance: number): Vec2 {
  return { x: e.a.x + e.dir.x * distance, y: e.a.y + e.dir.y * distance };
}

function makeHole(opening: Opening, offset: number, primary: boolean, passable: boolean): Hole {
  return {
    openingId: opening.id,
    type: opening.type,
    offset,
    width: opening.width,
    sill: opening.sill ?? 0,
    height: opening.height,
    primary,
    passable,
  };
}
