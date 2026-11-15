import { describe, expect, it } from 'vitest';
import { fitKitchen, planRun } from '../src/core/kitchen';
import { parseScene } from '../src/core/scene';
import { twoRooms } from './fixtures';

describe('planRun', () => {
  it('fills a wall with standard units, a tall unit first, sink and hob apart', () => {
    const slots = planRun([[0, 3]], undefined, true);
    expect(slots.map((s) => [s.kind, s.width])).toEqual([
      ['tall', 0.6], ['sink', 0.6], ['base', 0.6], ['base', 0.6], ['hob', 0.6],
    ]);
  });

  it('puts the sink under the window', () => {
    const slots = planRun([[0, 3]], 2.1, false);
    const sink = slots.find((s) => s.kind === 'sink')!;
    expect(sink.start).toBeLessThanOrEqual(2.1);
    expect(sink.start + sink.width).toBeGreaterThanOrEqual(2.1);
  });

  it('leaves a gap under 30 cm open', () => {
    const slots = planRun([[0, 1.25]], undefined, false);
    expect(slots.reduce((s, x) => s + x.width, 0)).toBeCloseTo(1.2);
  });
});

describe('fitKitchen', () => {
  it('fits units against the wall, facing into the room, and in the room', () => {
    const s = parseScene(twoRooms());
    // Room b, edge 0 runs along y = 0 from x 3.1 to 6: units face +y (rotation 180).
    const next = fitKitchen(s, 'b', 0);
    const units = next.furniture.filter((f) => f.model.startsWith('kitchen'));
    expect(units.length).toBeGreaterThan(3);
    for (const f of units.filter((u) => u.mount !== 'wall')) {
      expect(f.rotationDeg).toBe(180);
      expect(f.position[1]).toBeCloseTo(0.3);
      expect(f.position[0]).toBeGreaterThan(3.1);
      expect(f.position[0]).toBeLessThan(6);
    }
  });

  it('replaces a run fitted before, rather than doubling it', () => {
    const s = parseScene(twoRooms());
    const once = fitKitchen(s, 'b', 0);
    const twice = fitKitchen(once, 'b', 0, { fronts: '#22313f', worktop: 'wood', tall: false, wallUnits: false });
    expect(twice.furniture.every((f) => !f.model.startsWith('kitchen') || f.color === '#22313f')).toBe(true);
    expect(twice.furniture.some((f) => f.model.startsWith('kitchen-tall'))).toBe(false);
  });

  it('keeps clear of a door on the wall', () => {
    const s = parseScene(twoRooms());
    // door-out is on room b's edge 2 at offset 1, 0.9 wide.
    const next = fitKitchen(s, 'b', 2);
    const room = s.rooms.find((r) => r.id === 'b')!;
    const [ax] = room.polygon[2];
    for (const f of next.furniture.filter((x) => x.model.startsWith('kitchen') && x.mount !== 'wall')) {
      const along = ax - f.position[0]; // edge 2 runs from x = 6 back to x = 3.1
      const half = f.size[0] / 2;
      expect(along + half <= 0.9 + 1e-6 || along - half >= 2.0 - 1e-6).toBe(true);
    }
  });
});
