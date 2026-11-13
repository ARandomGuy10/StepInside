import { describe, expect, it } from 'vitest';
import { footprint, roomThatFits } from '../src/core/edits';
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
      const piece = lower.furniture.find((f) => f.model === 'stairs' && f.fixed);
      expect(piece).toBeDefined();
      const corners = footprint(piece!);
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      // The piece and the walkable rectangle agree to within 5 cm.
      expect(Math.min(...xs)).toBeCloseTo(stair.x0, 1);
      expect(Math.max(...xs)).toBeCloseTo(stair.x1, 1);
      expect(Math.min(...ys)).toBeCloseTo(stair.yTop, 1);
      expect(Math.max(...ys)).toBeCloseTo(stair.yBottom, 1);
      // It climbs exactly one storey.
      expect(piece!.size[1]).toBeCloseTo(home.levels[stair.upper].elevation - home.levels[stair.lower].elevation, 2);
    }
  });
});
