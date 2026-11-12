/** Small 2D geometry helpers in floor plan space. No Three.js. */
import type { Vec2 } from './collision';

export const EPS = 1e-6;

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);

/**
 * Twice-signed area by the shoelace formula, halved. With y running down
 * the page, a polygon listed clockwise on the page has a positive area.
 */
export function signedArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** True when the two segments cross at a single interior point of both. */
export function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  );
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / lenSq));
  return length({ x: p.x - (a.x + ab.x * t), y: p.y - (a.y + ab.y * t) });
}

/** True when `p` is inside the polygon and not on its boundary. */
export function pointStrictlyInside(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (distanceToSegment(p, a, b) < 1e-4) return false;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonSelfIntersects(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** True when the two polygons share some area. Touching edges do not count. */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  const probes = (poly: readonly Vec2[]): Vec2[] =>
    poly.flatMap((p, i) => {
      const q = poly[(i + 1) % poly.length];
      return [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }];
    });
  return (
    probes(a).some((p) => pointStrictlyInside(p, b)) ||
    probes(b).some((p) => pointStrictlyInside(p, a))
  );
}

/** True when `p` is inside the polygon or on its boundary. */
export function pointInsideOrOn(p: Vec2, poly: readonly Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]) < 2e-3) return true;
  }
  return pointStrictlyInside(p, poly);
}
