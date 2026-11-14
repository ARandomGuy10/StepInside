import { describe, expect, it } from 'vitest';
import { builtUpArea, formatArea, polygonArea, summarizeAreas } from '../src/core/areas';
import { parseScene } from '../src/core/scene';
import { HOMES } from '../src/homes';

describe('areas', () => {
  it('measures a polygon', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBeCloseTo(12);
    expect(polygonArea([[0, 0], [4, 0], [4, 4], [2, 4], [2, 2], [0, 2]])).toBeCloseTo(12);
  });

  it('adds the walls to a room for its built-up area', () => {
    const room = { id: 'a', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] as [number, number][] };
    // 4 x 3 with a 0.2 m wall all round: about 4.4 x 3.4, less the rounded corners.
    expect(builtUpArea([room as never], 0.2)).toBeGreaterThan(14.6);
    expect(builtUpArea([room as never], 0.2)).toBeLessThan(15.1);
  });

  it('formats in square feet or metres', () => {
    expect(formatArea(100, 'ft')).toBe('1,076 sq ft');
    expect(formatArea(100, 'm')).toBe('100.0 m²');
  });

  it('gives design D a plot of 35 x 55 ft and sensible totals', () => {
    const home = HOMES.find((h) => h.id === 'villa-d')!;
    const summary = summarizeAreas(home.levels.map((l) => ({ name: l.name, scene: parseScene(l.json) })));
    expect(summary.plot / 0.3048 ** 2).toBeCloseTo(35 * 55, -1);
    expect(summary.floors).toHaveLength(3);
    for (const f of summary.floors) expect(f.builtUp).toBeGreaterThan(f.carpet);
    expect(summary.coverage).toBeGreaterThan(0.5);
    expect(summary.coverage).toBeLessThan(1);
  });
});
