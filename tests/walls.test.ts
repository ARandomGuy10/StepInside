import { describe, expect, it } from 'vitest';
import { moveWithCollision } from '../src/core/collision';
import { parseScene } from '../src/core/scene';
import { buildWalls, type WallSlab } from '../src/core/walls';
import home from '../scenes/home.json';
import { twoRooms } from './fixtures';

const RADIUS = 0.25;

function slab(slabs: WallSlab[], room: string, edge: number): WallSlab {
  const found = slabs.find((s) => s.roomId === room && s.edge === edge);
  if (!found) throw new Error(`no slab for ${room} edge ${edge}`);
  return found;
}

describe('buildWalls on two rooms', () => {
  const { slabs, collision } = buildWalls(parseScene(twoRooms()));

  it('builds one slab per room edge', () => {
    expect(slabs).toHaveLength(8);
  });

  it('splits the gap between facing rooms in half', () => {
    expect(slab(slabs, 'a', 1).thickness).toBeCloseTo(0.05);
    expect(slab(slabs, 'b', 3).thickness).toBeCloseTo(0.05);
  });

  it('uses the exterior thickness where no room faces the wall', () => {
    expect(slab(slabs, 'a', 0).thickness).toBeCloseTo(0.3);
    expect(slab(slabs, 'b', 1).thickness).toBeCloseTo(0.3);
  });

  it('extends each wall past its end to fill the corner', () => {
    expect(slab(slabs, 'a', 0).extendEnd).toBeCloseTo(0.05);
    expect(slab(slabs, 'a', 1).extendEnd).toBeCloseTo(0.3);
  });

  it('cuts a door through both sides of a shared wall', () => {
    const near = slab(slabs, 'a', 1).holes;
    const far = slab(slabs, 'b', 3).holes;
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(1);
    expect(near[0]).toMatchObject({ openingId: 'door-ab', offset: 1, primary: true, passable: true });
    // Edge 3 of room b runs the other way, from y=3 to y=0.
    expect(far[0].offset).toBeCloseTo(3 - 1 - 0.9);
    expect(far[0]).toMatchObject({ primary: false, passable: true });
  });

  it('marks a door to the outside as not passable', () => {
    expect(slab(slabs, 'b', 2).holes[0]).toMatchObject({ openingId: 'door-out', passable: false });
  });

  it('lets the walker through the door between rooms', () => {
    const p = moveWithCollision({ x: 1.5, y: 1.45 }, { x: 3, y: 0 }, RADIUS, collision);
    expect(p.x).toBeCloseTo(4.5);
  });

  it('blocks the walker beside the door, at windows and at outside doors', () => {
    const beside = moveWithCollision({ x: 1.5, y: 0.5 }, { x: 3, y: 0 }, RADIUS, collision);
    expect(beside.x).toBeCloseTo(3 - RADIUS);
    const window = moveWithCollision({ x: 1.1, y: 1.5 }, { x: 0, y: -5 }, RADIUS, collision);
    expect(window.y).toBeCloseTo(RADIUS);
    const outside = moveWithCollision({ x: 4.55, y: 1.5 }, { x: 0, y: 5 }, RADIUS, collision);
    expect(outside.y).toBeCloseTo(3 - RADIUS);
  });

  it('gives the same walls when a room is listed anticlockwise', () => {
    const s = twoRooms();
    s.rooms[1].polygon = [[3.1, 0], [3.1, 3], [6, 3], [6, 0]];
    // The same outside door, now on edge 1 (from [3.1,3] to [6,3]).
    s.openings[2] = { id: 'door-out', type: 'door', room: 'b', edge: 1, offset: 1, width: 0.9, height: 2.1 };
    const flipped = buildWalls(parseScene(s));
    expect(slab(flipped.slabs, 'b', 0).thickness).toBeCloseTo(0.05);
    expect(slab(flipped.slabs, 'b', 0).holes[0].passable).toBe(true);
    expect(slab(flipped.slabs, 'b', 1).holes[0].offset).toBeCloseTo(2.9 - 1 - 0.9);
    const p = moveWithCollision({ x: 1.5, y: 1.45 }, { x: 3, y: 0 }, RADIUS, flipped.collision);
    expect(p.x).toBeCloseTo(4.5);
  });
});

describe('buildWalls on a balcony', () => {
  const s = twoRooms();
  s.rooms[1] = { id: 'b', name: 'Balcony', kind: 'balcony', polygon: [[3.3, 0], [4.5, 0], [4.5, 3], [3.3, 3]] };
  s.openings = [{ id: 'door-ab', type: 'door', room: 'a', edge: 1, offset: 1, width: 0.9, height: 2.1 }];
  const { slabs } = buildWalls(parseScene(s));

  it('fills the whole gap from the room side', () => {
    expect(slab(slabs, 'a', 1).thickness).toBeCloseTo(0.3);
  });

  it('builds railings only on the free edges', () => {
    const rails = slabs.filter((x) => x.roomId === 'b');
    expect(rails.map((r) => r.edge).sort()).toEqual([0, 1, 2]);
    expect(rails.every((r) => r.kind === 'railing' && r.height === 1)).toBe(true);
  });
});

describe('the real home', () => {
  const scene = parseScene(home);
  const { slabs, collision } = buildWalls(scene);
  const walk = (from: [number, number], to: [number, number]) =>
    moveWithCollision(
      { x: from[0], y: from[1] },
      { x: to[0] - from[0], y: to[1] - from[1] },
      RADIUS,
      collision,
    );

  it('makes every door passable except the front door', () => {
    const doors = slabs.flatMap((s) => s.holes).filter((h) => h.type === 'door' && h.primary);
    const blocked = doors.filter((h) => !h.passable).map((h) => h.openingId);
    expect(blocked).toEqual(['door-front']);
    expect(doors).toHaveLength(10);
  });

  it('never builds a wall thinner than 3 cm', () => {
    for (const s of slabs) expect(s.thickness).toBeGreaterThanOrEqual(0.03);
  });

  it('lets you walk every doorway', () => {
    const routes: [string, [number, number], [number, number]][] = [
      ['living to hal', [2.8, 5.135], [4.5, 5.135]],
      ['hal to bedroom 3', [4.155, 5.2], [4.155, 3.8]],
      ['hal to bedroom 1', [6.155, 5.2], [6.155, 3.8]],
      ['hal to bedroom 2', [6.155, 5.2], [6.155, 6.6]],
      ['hal to bathroom', [5.26, 5.2], [5.26, 6.6]],
      ['living to entree', [0.46, 6.9], [0.46, 8.3]],
      ['living to balcony', [3.12, 0.6], [3.12, -0.65]],
      ['bedroom 3 to balcony', [4.245, 1.2], [4.245, -0.3]],
      ['bedroom 1 to balcony', [6.23, 1.2], [6.23, -0.3]],
    ];
    for (const [name, from, to] of routes) {
      const p = walk(from, to);
      expect(p.x, name).toBeCloseTo(to[0], 2);
      expect(p.y, name).toBeCloseTo(to[1], 2);
    }
  });

  it('keeps you inside at the front door, windows and plain walls', () => {
    expect(walk([0.46, 8.5], [0.46, 12]).y).toBeCloseTo(9.77 - RADIUS);
    expect(walk([1.4, 1], [1.4, -3]).y).toBeCloseTo(RADIUS);
    expect(walk([2, 3], [6, 3]).x).toBeCloseTo(3.49 - RADIUS);
    expect(walk([5, -0.4], [5, -4]).y).toBeCloseTo(-1.05 + RADIUS);
  });
});

describe('thresholds', () => {
  it('adds a strip of floor inside each passable doorway', () => {
    const { thresholds } = buildWalls(parseScene(twoRooms()));
    expect(thresholds).toHaveLength(1);
    expect(thresholds[0].openingId).toBe('door-ab');
    const xs = thresholds[0].polygon.map((p) => p.x).sort();
    expect(xs).toEqual([3, 3, 3.1, 3.1]);
  });
});
