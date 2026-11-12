import { describe, expect, it } from 'vitest';
import {
  closestPointOnSegment,
  moveWithCollision,
  pushOutOfWalls,
  type Segment,
} from '../src/core/collision';

const RADIUS = 0.25;

/** A 4 m by 3 m room with its top-left inside corner at the origin. */
const room: Segment[] = [
  { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
  { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
  { a: { x: 4, y: 3 }, b: { x: 0, y: 3 } },
  { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
];

describe('closestPointOnSegment', () => {
  const s: Segment = { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } };

  it('projects onto the middle of the segment', () => {
    expect(closestPointOnSegment({ x: 1, y: 2 }, s)).toEqual({ x: 1, y: 0 });
  });

  it('clamps to the end points', () => {
    expect(closestPointOnSegment({ x: -3, y: 1 }, s)).toEqual({ x: 0, y: 0 });
    expect(closestPointOnSegment({ x: 9, y: 1 }, s)).toEqual({ x: 4, y: 0 });
  });

  it('handles a zero-length segment', () => {
    const point: Segment = { a: { x: 2, y: 2 }, b: { x: 2, y: 2 } };
    expect(closestPointOnSegment({ x: 0, y: 0 }, point)).toEqual({ x: 2, y: 2 });
  });
});

describe('pushOutOfWalls', () => {
  it('leaves a position in open space alone', () => {
    expect(pushOutOfWalls({ x: 2, y: 1.5 }, RADIUS, room)).toEqual({ x: 2, y: 1.5 });
  });

  it('pushes the walker away from a wall it overlaps', () => {
    const p = pushOutOfWalls({ x: 2, y: 0.1 }, RADIUS, room);
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(RADIUS);
  });

  it('resolves a corner against both walls', () => {
    const p = pushOutOfWalls({ x: 0.05, y: 0.1 }, RADIUS, room);
    expect(p.x).toBeGreaterThanOrEqual(RADIUS - 1e-6);
    expect(p.y).toBeGreaterThanOrEqual(RADIUS - 1e-6);
  });
});

describe('moveWithCollision', () => {
  it('moves freely in open space', () => {
    const p = moveWithCollision({ x: 1, y: 1 }, { x: 0.5, y: 0.25 }, RADIUS, room);
    expect(p.x).toBeCloseTo(1.5);
    expect(p.y).toBeCloseTo(1.25);
  });

  it('stops at a wall', () => {
    const p = moveWithCollision({ x: 2, y: 1 }, { x: 0, y: -5 }, RADIUS, room);
    expect(p.y).toBeCloseTo(RADIUS);
  });

  it('slides along a wall when moving into it at an angle', () => {
    const p = moveWithCollision({ x: 1, y: 0.3 }, { x: 1, y: -1 }, RADIUS, room);
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(RADIUS);
  });

  it('does not tunnel through a wall on a very long move', () => {
    const p = moveWithCollision({ x: 2, y: 1.5 }, { x: 100, y: 0 }, RADIUS, room);
    expect(p.x).toBeCloseTo(4 - RADIUS);
    expect(p.y).toBeCloseTo(1.5);
  });

  it('keeps the walker inside the room from any direction', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const p = moveWithCollision(
        { x: 2, y: 1.5 },
        { x: Math.cos(rad) * 50, y: Math.sin(rad) * 50 },
        RADIUS,
        room,
      );
      expect(p.x).toBeGreaterThanOrEqual(RADIUS - 1e-6);
      expect(p.x).toBeLessThanOrEqual(4 - RADIUS + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(RADIUS - 1e-6);
      expect(p.y).toBeLessThanOrEqual(3 - RADIUS + 1e-6);
    }
  });
});
