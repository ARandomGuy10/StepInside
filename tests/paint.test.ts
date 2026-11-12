import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../src/core/catalogue';
import {
  addFurniture, colorOf, moveFurniture, paint, paintRoomWalls, putBack, raiseFurniture, resetPaint,
  roomThatFits, rotateFurniture, snapToWall, takeOut,
} from '../src/core/edits';
import { parseScene, type Scene } from '../src/core/scene';
import home from '../scenes/home.json';
import { twoRooms } from './fixtures';

function scene(): Scene {
  const s = twoRooms();
  s.furniture = [
    { id: 'sofa', model: 'sofa', room: 'a', position: [1.5, 1.5], rotationDeg: 0, size: [2, 0.8, 1], color: '#111111' },
  ];
  return parseScene(s);
}
const item = (key: string) => CATALOGUE.find((c) => c.key === key)!;

describe('paint', () => {
  const base = scene();

  it('paints one wall and leaves the others on the default', () => {
    const next = paint(base, { kind: 'wall', room: 'a', edge: 2 }, '#aa3344');
    expect(colorOf(next, { kind: 'wall', room: 'a', edge: 2 })).toBe('#aa3344');
    expect(colorOf(next, { kind: 'wall', room: 'a', edge: 1 })).toBe('#ffffff');
    expect(colorOf(next, { kind: 'wall', room: 'b', edge: 2 })).toBe('#ffffff');
    expect(base.rooms[0].walls).toBeUndefined();
  });

  it('repaints a wall without adding a second entry', () => {
    const once = paint(base, { kind: 'wall', room: 'a', edge: 2 }, '#aa3344');
    const twice = paint(once, { kind: 'wall', room: 'a', edge: 2 }, '#00ff00');
    expect(twice.rooms[0].walls).toEqual([{ edge: 2, color: '#00ff00' }]);
  });

  it('paints floors, ceilings and furniture', () => {
    let next = paint(base, { kind: 'floor', room: 'b' }, '#123456');
    next = paint(next, { kind: 'ceiling', room: 'b' }, '#654321');
    next = paint(next, { kind: 'furniture', id: 'sofa' }, '#abcdef');
    expect(next.rooms[1].floor).toEqual({ color: '#123456' });
    expect(next.rooms[1].ceiling).toEqual({ color: '#654321' });
    expect(next.furniture[0].color).toBe('#abcdef');
    expect(() => parseScene(next)).not.toThrow();
  });

  it('keeps a floor material when repainting it', () => {
    const real = parseScene(home);
    const next = paint(real, { kind: 'floor', room: 'bathroom' }, '#223344');
    expect(next.rooms.find((r) => r.id === 'bathroom')!.floor).toEqual({ material: 'tile', color: '#223344' });
  });

  it('returns the same scene for no change, a bad colour or a missing target', () => {
    expect(paint(base, { kind: 'furniture', id: 'sofa' }, '#111111')).toBe(base);
    expect(paint(base, { kind: 'floor', room: 'a' }, 'red')).toBe(base);
    expect(paint(base, { kind: 'floor', room: 'zzz' }, '#000000')).toBe(base);
    expect(paint(base, { kind: 'wall', room: 'a', edge: 9 }, '#000000')).toBe(base);
  });

  it('resets paint and keeps the layout', () => {
    let next = paint(base, { kind: 'wall', room: 'a', edge: 0 }, '#aa3344');
    next = paint(next, { kind: 'furniture', id: 'sofa' }, '#abcdef');
    next = moveFurniture(next, 'sofa', [1.6, 1.4]);
    const reset = resetPaint(next, base);
    expect(reset.rooms).toBe(base.rooms);
    expect(reset.furniture[0]).toMatchObject({ color: '#111111', position: [1.6, 1.4] });
    expect(resetPaint(base, base)).toBe(base);
  });
});

describe('wall-hung pieces', () => {
  const base = scene();
  const painting = item('painting-wide');

  it('snaps to the nearest wall, facing into the room', () => {
    // Room a spans 0..3 on both axes. A point near the top wall (y = 0).
    const top = snapToWall(base, painting, [1.5, 0.4])!;
    expect(top).toMatchObject({ room: 'a', rotationDeg: 180 });
    expect(top.position[0]).toBeCloseTo(1.5);
    expect(top.position[1]).toBeCloseTo(0.024);
    // Near the left wall (x = 0): its front faces +x.
    expect(snapToWall(base, painting, [0.3, 1.5])!.rotationDeg).toBe(90);
    // Near the bottom wall: front faces up the page.
    expect(snapToWall(base, painting, [1.5, 2.8])!.rotationDeg).toBe(0);
  });

  it('keeps the whole piece on the wall near a corner', () => {
    const snap = snapToWall(base, painting, [0.1, 0.2])!;
    const placed = { position: snap.position, rotationDeg: snap.rotationDeg, size: painting.size };
    expect(roomThatFits(base, placed)?.id).toBe('a');
  });

  it('adds a painting on the nearest wall with a unique id', () => {
    const first = addFurniture(base, painting, [1.5, 0.4]);
    const second = addFurniture(first.scene, painting, [4.5, 0.4]);
    expect(first.id).toBe('painting-wide-1');
    expect(second.id).toBe('painting-wide-2');
    const added = second.scene.furniture.find((f) => f.id === second.id)!;
    expect(added).toMatchObject({ mount: 'wall', room: 'b', elevation: 1.25 });
    expect(() => parseScene(second.scene)).not.toThrow();
  });

  it('slides along and between walls when dragged, and cannot be turned', () => {
    const { scene: s, id } = addFurniture(base, painting, [1.5, 0.4]);
    const moved = moveFurniture(s, id!, [0.2, 2]);
    expect(moved.furniture.find((f) => f.id === id)!.rotationDeg).toBe(90);
    expect(rotateFurniture(s, id!, 15)).toBe(s);
  });

  it('can be raised and lowered but not through the floor or ceiling', () => {
    const { scene: s, id } = addFurniture(base, painting, [1.5, 0.4]);
    const up = raiseFurniture(s, id!, 0.1);
    expect(up.furniture.find((f) => f.id === id)!.elevation).toBeCloseTo(1.35);
    const top = raiseFurniture(s, id!, 50);
    expect(top.furniture.find((f) => f.id === id)!.elevation).toBeCloseTo(2.6 - 0.8);
    expect(raiseFurniture(top, id!, 0.1)).toBe(top);
    expect(raiseFurniture(s, id!, -50).furniture.find((f) => f.id === id)!.elevation).toBe(0);
  });

  it('goes back on a wall when put back', () => {
    const { scene: s, id } = addFurniture(base, painting, [1.5, 0.4]);
    const back = putBack(takeOut(s, id!), id!, [2.8, 1.5]);
    expect(back.furniture.find((f) => f.id === id)).toMatchObject({ removed: false, rotationDeg: 270 });
  });
});

describe('adding floor pieces', () => {
  it('finds the nearest free spot when the exact spot is in a wall', () => {
    const base = scene();
    const { scene: next, id } = addFurniture(base, item('armchair'), [0.1, 0.1]);
    const chair = next.furniture.find((f) => f.id === id)!;
    expect(roomThatFits(next, chair)?.id).toBe('a');
    expect(chair.room).toBe('a');
  });

  it('gives up when nothing fits nearby', () => {
    const base = scene();
    expect(addFurniture(base, item('armchair'), [40, 40])).toEqual({ scene: base });
  });

  it('every catalogue item can be added to the real home', () => {
    let s = parseScene(home);
    for (const entry of CATALOGUE) {
      const result = addFurniture(s, entry, [1.75, 5.6]);
      expect(result.id, entry.key).toBeDefined();
      s = result.scene;
    }
    expect(() => parseScene(s)).not.toThrow();
  });
});

describe('built-in blocks and whole rooms', () => {
  it('paints a closet block and resets it', () => {
    const real = parseScene(home);
    const id = real.solids![0].id;
    const next = paint(real, { kind: 'solid', id }, '#334455');
    expect(colorOf(next, { kind: 'solid', id })).toBe('#334455');
    expect(() => parseScene(next)).not.toThrow();
    expect(resetPaint(next, real).solids).toBe(real.solids);
    expect(paint(real, { kind: 'solid', id: 'nope' }, '#334455')).toBe(real);
  });

  it('paints all walls of a room as one edit', () => {
    const base = scene();
    const next = paintRoomWalls(base, 'a', '#102030');
    const room = next.rooms.find((r) => r.id === 'a')!;
    expect(room.walls).toHaveLength(room.polygon.length);
    expect(colorOf(next, { kind: 'wall', room: 'b', edge: 0 })).toBe('#ffffff');
    expect(paintRoomWalls(next, 'a', '#102030')).toBe(next);
  });
});

describe('finding a free spot', () => {
  it('stands a new piece clear of the furniture already there', () => {
    const base = scene();
    const first = addFurniture(base, item('plant'), [1.5, 1.5]);
    const plant = first.scene.furniture.find((f) => f.id === first.id)!;
    // The sofa covers x 0.5..2.5, y 1..2, so the plant must end up outside it.
    const inside = plant.position[0] > 0.2 && plant.position[0] < 2.8 && plant.position[1] > 0.7 && plant.position[1] < 2.3;
    expect(inside).toBe(false);
    const second = addFurniture(first.scene, item('plant'), plant.position);
    expect(second.scene.furniture.find((f) => f.id === second.id)!.position).not.toEqual(plant.position);
  });
});
