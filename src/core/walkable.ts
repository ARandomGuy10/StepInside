import { closestPointOnSegment, type Segment, type Vec2 } from './collision';
import { footprint } from './edits';
import { pointInsideOrOn } from './geometry';
import type { Furniture, Scene } from './scene';
import { buildWalls } from './walls';

/**
 * Can a person get round this floor? A plan-space check, like a building
 * inspector walking the drawings:
 *
 * - the floor is a grid of 5 cm squares; a square is free when a person
 *   (a circle `radius` wide) can stand on it without touching a wall or a
 *   piece of furniture;
 * - from the walker's start, a flood fill finds every square they can reach;
 * - every room should have reachable floor, every door should have floor
 *   you can reach on both sides, and every fixture (toilet, basin, shower,
 *   wardrobe, bed) should have floor you can reach in front of it.
 */
export interface WalkReport {
  /** Rooms with no floor a person can get to. */
  unreachableRooms: string[];
  /** Doors with no floor a person can reach on one side or the other. */
  blockedDoors: string[];
  /** Fixtures with no room to stand at them. */
  blockedFixtures: string[];
  /** Reachable floor in each room, square metres. */
  freeArea: Record<string, number>;
}

/** Pieces a person walks over or under: rugs, paving, stairs, ceiling lights. */
const WALK_OVER = /^(rug|paving|stepping-path|stairs|stairs-floating|stairs-down|led-strip|uplight|downlight|curtain|sheer-curtain|shower)$/;

/**
 * Where a person stands to use a fixture, in the piece's own frame: x across
 * its width, y out from its front (a piece's front faces -y before turning).
 */
const ACCESS: Record<string, (w: number, d: number) => [number, number][]> = {
  toilet: (_w, d) => [[0, -(d / 2 + 0.4)]],
  basin: (_w, d) => [[0, -(d / 2 + 0.4)]],
  shower: (_w, d) => [[0, -(d / 2 + 0.4)], [0, 0]],
  wardrobe: (_w, d) => [[0, -(d / 2 + 0.45)]],
  // A bed: one side at least, by the pillows.
  bed: (w, d) => [[-(w / 2 + 0.35), -d / 4], [w / 2 + 0.35, -d / 4]],
};
/** Fixtures that need only one of their access spots; the rest need all. */
const ANY_SPOT = new Set(['bed', 'shower']);

const blocks = (f: Furniture): boolean =>
  !f.removed && f.mount !== 'wall' && (f.elevation ?? 0) < 1.5 && (f.size[1] > 0.1 || f.model === 'pool') && !WALK_OVER.test(f.model);

function distanceToBox(p: Vec2, corners: Vec2[]): number {
  if (pointInsideOrOn(p, corners)) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const q = closestPointOnSegment(p, { a: corners[i], b: corners[(i + 1) % 4] });
    best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return best;
}

function distanceToSegment(p: Vec2, s: Segment): number {
  const q = closestPointOnSegment(p, s);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function checkWalkable(scene: Scene, radius = 0.25, cell = 0.05): WalkReport {
  const rooms = scene.rooms.filter((r) => r.kind !== 'void');
  const shapes = rooms.map((r) => r.polygon.map(([x, y]) => ({ x, y })));
  const model = buildWalls(scene);
  const walls = model.collision;
  // The floor through each doorway, across the thickness of its wall.
  const doorways = model.thresholds.map((t) => t.polygon);
  const pieces = scene.furniture.filter(blocks).map(footprint);
  const all = shapes.flat();
  const x0 = Math.min(...all.map((p) => p.x));
  const y0 = Math.min(...all.map((p) => p.y));
  const cols = Math.ceil((Math.max(...all.map((p) => p.x)) - x0) / cell);
  const rows = Math.ceil((Math.max(...all.map((p) => p.y)) - y0) / cell);
  const centre = (c: number, r: number): Vec2 => ({ x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell });

  // Which room each square is in (-1: none), and whether a person fits there.
  const owner = new Int16Array(cols * rows).fill(-1);
  const free = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = centre(c, r);
      const k = r * cols + c;
      owner[k] = shapes.findIndex((s) => pointInsideOrOn(p, s));
      if (owner[k] < 0 && !doorways.some((s) => pointInsideOrOn(p, s))) continue;
      if (walls.some((s) => distanceToSegment(p, s) < radius)) continue;
      if (pieces.some((box) => distanceToBox(p, box) < radius)) continue;
      free[k] = 1;
    }
  }

  // Flood fill from the start, through free squares.
  const reached = new Uint8Array(cols * rows);
  const at = (p: Vec2): number => {
    const c = Math.floor((p.x - x0) / cell);
    const r = Math.floor((p.y - y0) / cell);
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  };
  const start = scene.start?.position;
  const seed = start ? nearestFree({ x: start[0], y: start[1] }) : -1;
  function nearestFree(p: Vec2, within = 0.6): number {
    let best = -1;
    let bestD = within;
    const span = Math.ceil(within / cell);
    const c0 = Math.floor((p.x - x0) / cell);
    const r0 = Math.floor((p.y - y0) / cell);
    for (let r = r0 - span; r <= r0 + span; r++) {
      for (let c = c0 - span; c <= c0 + span; c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows || !free[r * cols + c]) continue;
        const q = centre(c, r);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) [best, bestD] = [r * cols + c, d];
      }
    }
    return best;
  }
  const queue: number[] = [];
  if (seed >= 0) {
    reached[seed] = 1;
    queue.push(seed);
  }
  while (queue.length) {
    const k = queue.pop()!;
    const c = k % cols;
    const r = (k - c) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc;
      if (free[n] && !reached[n]) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }
  // Is there reachable floor within a hand's reach of this spot?
  const canReach = (p: Vec2, within = 0.15): boolean => {
    const span = Math.ceil(within / cell);
    const k = at(p);
    if (k < 0) return false;
    const c0 = k % cols;
    const r0 = (k - c0) / cols;
    for (let r = r0 - span; r <= r0 + span; r++) {
      for (let c = c0 - span; c <= c0 + span; c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows || !reached[r * cols + c]) continue;
        const q = centre(c, r);
        if (Math.hypot(q.x - p.x, q.y - p.y) <= within) return true;
      }
    }
    return false;
  };

  const freeArea: Record<string, number> = {};
  rooms.forEach((room) => (freeArea[room.id] = 0));
  for (let k = 0; k < owner.length; k++) if (reached[k] && owner[k] >= 0) freeArea[rooms[owner[k]].id] += cell * cell;
  for (const id of Object.keys(freeArea)) freeArea[id] = Math.round(freeArea[id] * 100) / 100;
  const unreachableRooms = rooms.filter((room) => freeArea[room.id] === 0).map((room) => room.id);

  // A door needs floor you can reach a step in front of it and a step behind.
  const blockedDoors = scene.openings
    .filter((o) => o.type === 'door')
    .filter((o) => {
      const room = scene.rooms.find((r) => r.id === o.room);
      if (!room) return true;
      const [ax, ay] = room.polygon[o.edge];
      const [bx, by] = room.polygon[(o.edge + 1) % room.polygon.length];
      const length = Math.hypot(bx - ax, by - ay);
      const [dx, dy] = [(bx - ax) / length, (by - ay) / length];
      const mid = { x: ax + dx * (o.offset + o.width / 2), y: ay + dy * (o.offset + o.width / 2) };
      const step = 0.5;
      const sides = [
        { x: mid.x - dy * step, y: mid.y + dx * step },
        { x: mid.x + dy * step, y: mid.y - dx * step },
      ];
      // A door in an outside wall leads out of the floor: only the inside counts.
      const inside = sides.filter((p) => shapes.some((s) => pointInsideOrOn(p, s)));
      return inside.length === 0 || !inside.every((p) => canReach(p, 0.3));
    })
    .map((o) => o.id);

  const blockedFixtures = scene.furniture
    .filter((f) => !f.removed && ACCESS[f.model])
    .filter((f) => {
      const rad = (f.rotationDeg * Math.PI) / 180;
      const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
      const spots = ACCESS[f.model](f.size[0], f.size[2]).map(([x, y]) => ({
        x: f.position[0] + x * cos - y * sin,
        y: f.position[1] + x * sin + y * cos,
      }));
      const ok = spots.map((p) => canReach(p, 0.2));
      return ANY_SPOT.has(f.model) ? !ok.some(Boolean) : !ok.every(Boolean);
    })
    .map((f) => f.id);

  return { unreachableRooms, blockedDoors, blockedFixtures, freeArea };
}
