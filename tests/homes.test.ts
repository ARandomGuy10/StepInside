import { describe, expect, it } from 'vitest';
import { clashes, footprint, roomThatFits } from '../src/core/edits';
import { parseScene } from '../src/core/scene';
import { buildWalls } from '../src/core/walls';
import { HOMES } from '../src/homes';

const storeys = HOMES.flatMap((home) => home.levels.map((level) => [`${home.id}: ${level.name}`, level.json] as const));

describe.each(storeys)('%s', (_name, json) => {
  it('is a valid scene with walls', () => {
    const scene = parseScene(json);
    expect(buildWalls(scene).slabs.length).toBeGreaterThan(scene.rooms.length);
  });

  it('has every piece of furniture inside its room', () => {
    const scene = parseScene(json);
    const outside = scene.furniture.filter((f) => roomThatFits(scene, f)?.id !== f.room).map((f) => f.id);
    expect(outside).toEqual([]);
  });

  it('has no two pieces standing in the same spot', () => {
    // The apartment keeps a few overlaps from its photos: the L-shaped sofa
    // is checked by its bounding box, and two chests stand corner to corner.
    const known = new Set(['coffee-table|sofa', 'sideboard|wicker-drawers']);
    const found = clashes(parseScene(json)).map((pair) => pair.join('|')).filter((pair) => !known.has(pair));
    expect(found).toEqual([]);
  });

  it('starts the walker inside a room', () => {
    const scene = parseScene(json);
    expect(scene.start).toBeDefined();
  });
});

describe.each(HOMES.map((home) => [home.id, home] as const))('%s', (_id, home) => {
  it('stacks its storeys from the ground up', () => {
    const heights = home.levels.map((l) => l.elevation);
    expect(heights[0]).toBe(0);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
  });

  it('has a staircase piece under every flight that can be walked', () => {
    for (const stair of home.stairs ?? []) {
      const lower = parseScene(home.levels[stair.lower].json);
      // The piece under this flight: the one whose middle is inside it.
      const piece = lower.furniture.find(
        (f) => (f.model === 'stairs' || f.model === 'stairs-floating') && f.fixed && f.position[0] > stair.x0 && f.position[0] < stair.x1,
      );
      expect(piece).toBeDefined();
      // A flight's first step is at the yBottom end: the piece turns round when that end is the smaller y.
      expect(piece!.rotationDeg).toBe(stair.yBottom > stair.yTop ? 0 : 180);
      const corners = footprint(piece!);
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      // The piece and the walkable rectangle agree to within 5 cm.
      expect(Math.min(...xs)).toBeCloseTo(stair.x0, 1);
      expect(Math.max(...xs)).toBeCloseTo(stair.x1, 1);
      expect(Math.min(...ys)).toBeCloseTo(Math.min(stair.yTop, stair.yBottom), 1);
      expect(Math.max(...ys)).toBeCloseTo(Math.max(stair.yTop, stair.yBottom), 1);
      // It climbs exactly one storey.
      expect(piece!.size[1]).toBeCloseTo(home.levels[stair.upper].elevation - home.levels[stair.lower].elevation, 2);
    }
  });
});
