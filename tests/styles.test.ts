import { describe, expect, it } from 'vitest';
import { materialOf, resetPaint, setMaterial, setRoomWallsMaterial } from '../src/core/edits';
import { parseScene, type Scene } from '../src/core/scene';
import { applyStyle, isIndoor, STYLES } from '../src/core/styles';
import { viewFromParams, viewToParams } from '../src/core/viewLink';
import villaGround from '../scenes/villa-ground.json';
import { twoRooms } from './fixtures';

const base = (): Scene => parseScene(twoRooms());

describe('materials', () => {
  it('gives a floor a material and keeps its colour', () => {
    const s = base();
    const next = setMaterial(s, { kind: 'floor', room: 'a' }, 'stone');
    expect(materialOf(next, { kind: 'floor', room: 'a' })).toBe('stone');
    expect(next.rooms[0].floor?.color).toBe(s.rooms[0].floor?.color ?? s.defaults.floorColor);
    const plain = setMaterial(next, { kind: 'floor', room: 'a' }, undefined);
    expect(plain.rooms[0].floor).not.toHaveProperty('material');
  });

  it('gives one wall a material and keeps its other settings', () => {
    const s = base();
    const wall = { kind: 'wall', room: 'a', edge: 1 } as const;
    const next = setMaterial(s, wall, 'wood');
    expect(materialOf(next, wall)).toBe('wood');
    expect(materialOf(next, { kind: 'wall', room: 'a', edge: 0 })).toBeUndefined();
    expect(setMaterial(next, wall, 'wood')).toBe(next);
    // The result is still a valid scene file.
    expect(() => parseScene(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it('does all walls of a room at once', () => {
    const next = setRoomWallsMaterial(base(), 'a', 'tile');
    const room = next.rooms.find((r) => r.id === 'a')!;
    expect(room.polygon.every((_, edge) => materialOf(next, { kind: 'wall', room: 'a', edge }) === 'tile')).toBe(true);
  });

  it('rejects an unknown wall material in a scene file', () => {
    const json = twoRooms();
    json.rooms[0].walls = [{ edge: 0, material: 'gold' }];
    expect(() => parseScene(json)).toThrow(/material/);
  });
});

describe('styles', () => {
  const villa = parseScene(villaGround);

  for (const style of STYLES) {
    it(`${style.name} gives a valid scene and leaves outdoor spaces alone`, () => {
      const next = applyStyle(villa, style);
      expect(() => parseScene(JSON.parse(JSON.stringify(next)))).not.toThrow();
      for (const [i, room] of villa.rooms.entries()) {
        if (!isIndoor(room)) expect(next.rooms[i]).toBe(room);
      }
      expect(next.furniture.map((f) => [f.id, f.position, f.rotationDeg])).toEqual(
        villa.furniture.map((f) => [f.id, f.position, f.rotationDeg]),
      );
    });
  }

  it('tiles the bathroom and woods the bedroom', () => {
    const next = applyStyle(villa, STYLES.find((s) => s.key === 'modern')!);
    const bath = next.rooms.find((r) => r.id === 'bath')!;
    const master = next.rooms.find((r) => r.id === 'master')!;
    expect(bath.floor?.material).toBe('large-tile');
    expect(bath.walls?.every((w) => w.material === 'tile')).toBe(true);
    expect(master.floor?.material).toBe('laminate');
    expect(master.walls?.every((w) => w.color === '#f4f2ee' && !w.material)).toBe(true);
  });

  it('is undone by Reset all colours', () => {
    const next = applyStyle(villa, STYLES[3]);
    const back = resetPaint(next, villa);
    expect(back.rooms).toBe(villa.rooms);
    expect(back.furniture.map((f) => f.color)).toEqual(villa.furniture.map((f) => f.color));
  });
});

describe('view links', () => {
  it('round-trips a walk view', () => {
    const params = viewToParams({ view: 'walk', floor: 1, at: [4.234, 7.9, 90.4, -5] }, new URLSearchParams('home=villa'));
    expect(params.get('home')).toBe('villa');
    expect(params.get('at')).toBe('4.23,7.9,90,-5');
    expect(viewFromParams(params, 2)).toEqual({ view: 'walk', floor: 1, at: [4.23, 7.9, 90, -5] });
  });

  it('falls back to the whole house on a broken link', () => {
    expect(viewFromParams(new URLSearchParams('view=nope&floor=7&at=1,2'), 2)).toEqual({ view: 'whole', floor: 0 });
  });
});
