import { describe, expect, it } from 'vitest';
import villaGround from '../scenes/villa-d-ground.json';
import { parseScene, type Scene } from '../src/core/scene';
import { costLines, lineCost, quantitiesOf, totalQuantities } from '../src/core/quantities';

/** One room, 4 m by 3 m, 3 m high, with a door and a window. */
const box = (): Scene => {
  const base = parseScene(villaGround);
  return {
    ...base,
    defaults: { ...base.defaults, ceilingHeight: 3 },
    rooms: [{ id: 'a', name: 'A', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], floor: { material: 'tile', color: '#fff' } }],
    openings: [
      { id: 'd', type: 'door', room: 'a', edge: 0, offset: 1, width: 1, height: 2 },
      { id: 'w', type: 'window', room: 'a', edge: 2, offset: 1, width: 1.5, height: 1, sill: 1 },
    ],
    solids: [], sweeps: [], lights: [], furniture: [], site: undefined,
  };
};

describe('quantities', () => {
  it('measures a plain room', () => {
    const q = quantitiesOf(box());
    expect(q.floorArea).toBeCloseTo(12);
    expect(q.floors).toEqual([{ finish: 'tile', area: expect.closeTo(12) }]);
    expect(q.ceiling).toBeCloseTo(12);
    // 14 m of wall, 3 m high, less a 2 m² door and a 1.5 m² window.
    expect(q.wallInside).toBeCloseTo(42 - 2 - 1.5);
    expect(q.wallOutside).toBeCloseTo(42 - 2 - 1.5);
    expect(q.skirting).toBeCloseTo(13);
    expect([q.doors, q.windows]).toEqual([1, 1]);
    expect(q.glazing).toBeCloseTo(1.5);
  });

  it('adds floors up', () => {
    const q = quantitiesOf(box());
    const total = totalQuantities([q, q]);
    expect(total.floorArea).toBeCloseTo(24);
    expect(total.doors).toBe(2);
    expect(total.floors[0].area).toBeCloseTo(24);
  });

  it('gives sensible numbers for the sample home', () => {
    const q = quantitiesOf(parseScene(villaGround));
    expect(q.floorArea).toBeGreaterThan(50);
    expect(q.wallInside).toBeGreaterThan(q.wallOutside);
    expect(q.doors).toBeGreaterThan(3);
  });

  it('costs a line at a rate per square foot', () => {
    const [build] = costLines(100, quantitiesOf(box()));
    expect(lineCost(build, 2000, 'm')).toBeCloseTo(200000);
    expect(lineCost(build, 200, 'ft')).toBeCloseTo((100 / 0.09290304) * 200);
  });
});
