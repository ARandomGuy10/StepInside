/**
 * 2D collision for the walker, in floor plan space (metres).
 *
 * The walker is a circle and every wall is a line segment. Nothing here
 * depends on Three.js, so it runs in plain unit tests.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** The point on segment `s` that is closest to `p`. */
export function closestPointOnSegment(p: Vec2, s: Segment): Vec2 {
  const abx = s.b.x - s.a.x;
  const aby = s.b.y - s.a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return { x: s.a.x, y: s.a.y };
  const t = ((p.x - s.a.x) * abx + (p.y - s.a.y) * aby) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  return { x: s.a.x + abx * clamped, y: s.a.y + aby * clamped };
}

/**
 * Pushes a circle out of any wall it overlaps. A few passes are enough
 * for corners, where fixing one wall can push the circle into another.
 */
export function pushOutOfWalls(pos: Vec2, radius: number, walls: readonly Segment[]): Vec2 {
  let x = pos.x;
  let y = pos.y;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const wall of walls) {
      const c = closestPointOnSegment({ x, y }, wall);
      const dx = x - c.x;
      const dy = y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= radius) continue;
      if (dist > 1e-9) {
        const push = (radius - dist) / dist;
        x += dx * push;
        y += dy * push;
      } else {
        // Exactly on the wall line: push along the wall's normal.
        const wx = wall.b.x - wall.a.x;
        const wy = wall.b.y - wall.a.y;
        const len = Math.hypot(wx, wy) || 1;
        x += (-wy / len) * radius;
        y += (wx / len) * radius;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, y };
}

/**
 * Moves a circle by `delta` and slides it along any walls in the way.
 * Long moves are split into short steps so the circle cannot jump
 * through a wall in a single frame.
 */
export function moveWithCollision(
  pos: Vec2,
  delta: Vec2,
  radius: number,
  walls: readonly Segment[],
): Vec2 {
  const distance = Math.hypot(delta.x, delta.y);
  if (distance === 0) return pushOutOfWalls(pos, radius, walls);
  const steps = Math.max(1, Math.ceil(distance / (radius * 0.5)));
  let current = pos;
  for (let i = 0; i < steps; i++) {
    current = pushOutOfWalls(
      { x: current.x + delta.x / steps, y: current.y + delta.y / steps },
      radius,
      walls,
    );
  }
  return current;
}
