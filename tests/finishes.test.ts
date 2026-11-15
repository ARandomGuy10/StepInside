import { describe, expect, it } from 'vitest';
import { setIndoorFloors } from '../src/core/edits';
import { PAINT_GROUPS, paintName } from '../src/core/paints';
import { parseScene } from '../src/core/scene';
import { twoRooms } from './fixtures';

describe('setIndoorFloors', () => {
  it('sets every room floor and leaves balconies alone', () => {
    const s = twoRooms();
    s.rooms[1].kind = 'balcony';
    const scene = parseScene(s);
    const next = setIndoorFloors(scene, 'tile', '#e6dccb');
    expect(next.rooms[0].floor).toEqual({ color: '#e6dccb', material: 'tile' });
    expect(next.rooms[1]).toBe(scene.rooms[1]);
  });

  it('returns the same scene when nothing changes', () => {
    const scene = setIndoorFloors(parseScene(twoRooms()), undefined, '#aaaaaa');
    expect(setIndoorFloors(scene, undefined, '#aaaaaa')).toBe(scene);
  });
});

describe('paints', () => {
  it('names a ready-made paint whatever the case', () => {
    expect(paintName('#B7C4B1')).toBe('Sage');
    expect(paintName('#123456')).toBeUndefined();
  });

  it('has no colour twice', () => {
    const hexes = PAINT_GROUPS.flatMap((g) => g.paints.map((p) => p.hex));
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
