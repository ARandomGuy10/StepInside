/**
 * The route of the automatic tour: a walk through every room of a storey
 * that can be reached through doors, like a person showing you round.
 *
 * Rooms are joined where a doorway leads from one to the other. The walk
 * goes depth first: into a room, stop and look round, on into the rooms
 * behind it, and back out the way it came. Inside a room it walks between
 * the doorways and the room's most open spot, which keeps it clear of the
 * walls even in an L-shaped room.
 *
 * No Three.js here: plain data, unit tested.
 */
import type { Vec2 } from './collision';
import { pointInsideOrOn } from './geometry';
import { footprint } from './edits';
import { toVec, type Furniture, type Room, type Scene } from './scene';
import type { WallModel } from './walls';

export interface TourStop {
  /** Index into `path` of the point where the tour stops to look round. */
  at: number;
  roomId: string;
  name: string;
}

export interface TourRoute {
  path: Vec2[];
  stops: TourStop[];
}

/**
 * The point of a room furthest from its walls and from the furniture
 * standing in it (so not over a bed or in the pool), found on a fine grid.
 */
export function openSpot(room: Room, furniture: readonly Furniture[] = []): Vec2 {
  const poly = room.polygon.map(toVec);
  // Flat things (rugs, paths) and what hangs on the walls are not in the way.
  const pieces = furniture
    .filter((f) => !f.removed && f.room === room.id && f.mount !== 'wall' && f.size[1] > 0.1 && !/curtain|radiator|pergola/.test(f.model))
    .map((f) => footprint(f));
  const edges: [Vec2, Vec2][] = [
    ...poly.map((a, i): [Vec2, Vec2] => [a, poly[(i + 1) % poly.length]]),
    ...pieces.flatMap((c) => c.map((a, i): [Vec2, Vec2] => [a, c[(i + 1) % c.length]])),
  ];
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best: Vec2 = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  let bestClear = -1;
  const step = Math.max(0.1, Math.max(x1 - x0, y1 - y0) / 80);
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p = { x, y };
      if (!pointInsideOrOn(p, poly) || pieces.some((c) => pointInsideOrOn(p, c))) continue;
      const clear = Math.min(...edges.map(([a, b]) => distanceToSegment(p, a, b)));
      if (clear > bestClear) {
        bestClear = clear;
        best = p;
      }
    }
  }
  return best;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

interface Door {
  /** The middle of the doorway, halfway through the wall. */
  middle: Vec2;
  rooms: [string, string];
}

/** Every doorway you can walk through, with the two rooms it joins. */
export function doorways(scene: Scene, walls: WallModel): Door[] {
  const byOpening = new Map<string, { roomId: string; point: Vec2 }[]>();
  const roomAtPoint = (p: Vec2): string | undefined =>
    scene.rooms.find((r) => r.kind !== 'void' && pointInsideOrOn(p, r.polygon.map(toVec)))?.id;
  for (const slab of walls.slabs) {
    const dx = slab.b.x - slab.a.x;
    const dy = slab.b.y - slab.a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    for (const hole of slab.holes) {
      if (!hole.passable) continue;
      const t = (hole.offset + hole.width / 2) / len;
      const point = { x: slab.a.x + dx * t, y: slab.a.y + dy * t };
      const sides = byOpening.get(hole.openingId) ?? [];
      sides.push({ roomId: slab.roomId, point });
      // A door onto a balcony or garden is cut into one wall only: look
      // through the wall for the room on its far side.
      const reach = slab.thickness + 0.15;
      for (const sign of [1, -1]) {
        const far = { x: point.x + (-dy / len) * reach * sign, y: point.y + (dx / len) * reach * sign };
        const other = roomAtPoint(far);
        if (other && other !== slab.roomId) {
          sides.push({ roomId: other, point: { x: point.x + (-dy / len) * slab.thickness * sign, y: point.y + (dx / len) * slab.thickness * sign } });
          break;
        }
      }
      byOpening.set(hole.openingId, sides);
    }
  }
  const doors: Door[] = [];
  for (const sides of byOpening.values()) {
    const rooms = [...new Set(sides.map((s) => s.roomId))];
    if (rooms.length !== 2) continue;
    const middle = {
      x: sides.reduce((sum, s) => sum + s.point.x, 0) / sides.length,
      y: sides.reduce((sum, s) => sum + s.point.y, 0) / sides.length,
    };
    doors.push({ middle, rooms: [rooms[0], rooms[1]] });
  }
  return doors;
}

/**
 * The tour of one storey, starting in `startRoom` (or the first room) and
 * visiting every room reachable from it. Holes in the floor are skipped.
 */
export function tourRoute(scene: Scene, walls: WallModel, startRoom?: string, from?: Vec2): TourRoute {
  const rooms = new Map(scene.rooms.filter((r) => r.kind !== 'void').map((r) => [r.id, r]));
  const doors = doorways(scene, walls).filter((d) => rooms.has(d.rooms[0]) && rooms.has(d.rooms[1]));
  const spots = new Map([...rooms.values()].map((r) => [r.id, openSpot(r, scene.furniture)]));
  const first = startRoom && rooms.has(startRoom) ? startRoom : [...rooms.keys()][0];
  const path: Vec2[] = [];
  const stops: TourStop[] = [];
  if (!first) return { path, stops };
  const seen = new Set<string>();
  const add = (p: Vec2): void => {
    const last = path[path.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.01) path.push(p);
  };
  if (from) add(from);

  const visit = (id: string): void => {
    seen.add(id);
    const room = rooms.get(id)!;
    add(spots.get(id)!);
    stops.push({ at: path.length - 1, roomId: id, name: room.name ?? id });
    // Nearest doorway first, so the walk does not criss-cross the room.
    const here = spots.get(id)!;
    const exits = doors
      .filter((d) => d.rooms.includes(id))
      .sort((a, b) => Math.hypot(a.middle.x - here.x, a.middle.y - here.y) - Math.hypot(b.middle.x - here.x, b.middle.y - here.y));
    for (const door of exits) {
      const next = door.rooms[0] === id ? door.rooms[1] : door.rooms[0];
      if (seen.has(next)) continue;
      add(door.middle);
      visit(next);
      // Back through the same doorway, via this room's open spot.
      add(door.middle);
      add(here);
    }
  };
  visit(first);

  // There is no need to walk back after the last room.
  const end = stops.length ? stops[stops.length - 1].at : path.length - 1;
  path.length = end + 1;
  return { path, stops };
}
