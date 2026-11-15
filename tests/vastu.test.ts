import { describe, expect, it } from 'vitest';
import villaGround from '../scenes/villa-d-ground.json';
import { parseScene } from '../src/core/scene';
import { roomFacings, zoneAt } from '../src/core/vastu';

const plot = { minX: 0, minY: 0, maxX: 9, maxY: 9 };

describe('zones of a plot', () => {
  it('names the nine cells, with north at the top of the plan', () => {
    expect(zoneAt(4.5, 1, plot, 0)).toBe('North');
    expect(zoneAt(8, 1, plot, 0)).toBe('North-east');
    expect(zoneAt(8, 4.5, plot, 0)).toBe('East');
    expect(zoneAt(8, 8, plot, 0)).toBe('South-east');
    expect(zoneAt(1, 8, plot, 0)).toBe('South-west');
    expect(zoneAt(1, 1, plot, 0)).toBe('North-west');
    expect(zoneAt(4.5, 4.5, plot, 0)).toBe('Centre');
  });

  it('turns with the north of the scene', () => {
    // North a quarter turn clockwise from the top: the top of the plan is west.
    expect(zoneAt(4.5, 1, plot, 90)).toBe('West');
    expect(zoneAt(8, 4.5, plot, 90)).toBe('North');
    expect(zoneAt(8, 8, plot, 90)).toBe('North-east');
  });
});

describe('rooms and Vastu', () => {
  const scene = parseScene(villaGround);
  const facings = roomFacings(scene, { minX: 0, minY: 0, maxX: 10.668, maxY: 16.764 });

  it('places every room that is not a hole', () => {
    expect(facings.length).toBe(scene.rooms.filter((r) => r.kind !== 'void').length);
  });

  it('gives a verdict where the tradition has a view', () => {
    const kitchen = facings.find((f) => f.id === 'kitchen')!;
    expect(kitchen.verdict).toBeDefined();
    expect(kitchen.prefers).toContain('South-east');
  });
});
