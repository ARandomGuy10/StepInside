/**
 * How much floor is free in front of a piece: the distance from its front
 * edge to the nearest wall or other piece, looking the way it faces.
 */
import type { Vec2 } from './collision';
import { footprint } from './edits';
import { toVec, type Furniture, type Scene } from './scene';

/** Distances beyond this count as "open": the readout says so instead of a number. */
export const OPEN_FLOOR = 3;
/** Under this the readout warns that the space in front is tight. */
export const TIGHT = 0.6;

/** Where a ray from `o` along `d` first meets the segment a–b, as a distance, or null. */
function rayHit(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
  const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  return t > 1e-6 && u >= 0 && u <= 1 ? t : null;
}

/** A piece other pieces bump into: standing on the floor and taller than a rug. */
const inTheWay = (f: Furniture): boolean => !f.removed && f.mount !== 'wall' && f.size[1] > 0.05;

/**
 * Metres of free floor in front of the piece, or null when it hangs on a
 * wall or lies flat (a rug), where the question does not apply. Looks along
 * three lines, from both front corners and the middle, and takes the
 * shortest. Anything past OPEN_FLOOR is returned as OPEN_FLOOR.
 */
export function clearInFront(scene: Scene, piece: Furniture): number | null {
  if (!inTheWay(piece)) return null;
  const rad = (piece.rotationDeg * Math.PI) / 180;
  const ahead: Vec2 = { x: Math.sin(rad), y: -Math.cos(rad) };
  const [left, right] = footprint(piece);
  // Start just inside the corners, so a piece standing against a side wall
  // does not "see" that wall along its own edge.
  const inset = Math.min(0.03, piece.size[0] / 4);
  const along = { x: (right.x - left.x) / piece.size[0], y: (right.y - left.y) / piece.size[0] };
  const starts: Vec2[] = [
    { x: left.x + along.x * inset, y: left.y + along.y * inset },
    { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
    { x: right.x - along.x * inset, y: right.y - along.y * inset },
  ];

  const edges: [Vec2, Vec2][] = [];
  const room = scene.rooms.find((r) => r.id === piece.room);
  if (room) {
    const outline = room.polygon.map(toVec);
    outline.forEach((a, i) => edges.push([a, outline[(i + 1) % outline.length]]));
  }
  for (const other of scene.furniture) {
    if (other.id === piece.id || !inTheWay(other)) continue;
    const corners = footprint(other);
    corners.forEach((a, i) => edges.push([a, corners[(i + 1) % 4]]));
  }

  let best = OPEN_FLOOR;
  for (const o of starts) {
    for (const [a, b] of edges) {
      const t = rayHit(o, ahead, a, b);
      if (t !== null && t < best) best = t;
    }
  }
  return best;
}
