import { describe, expect, it } from 'vitest';
import {
  emptyRoom, footprint, moveFurniture, putBack, resetLayout, roomAt, roomThatFits,
  addFurniture, resizeFurniture, rotateFurniture, takeOut,
} from '../src/core/edits';
import { CATALOGUE } from '../src/core/catalogue';
import { History } from '../src/core/history';
import { parseScene, type Scene } from '../src/core/scene';
import home from '../scenes/home.json';
import { twoRooms } from './fixtures';

/** Two 3 m rooms. A 2 x 1 m sofa in the middle of room a, a chair in room b. */
function furnished(): Scene {
  const s = twoRooms();
  s.furniture = [
    { id: 'sofa', model: 'sofa', room: 'a', position: [1.5, 1.5], rotationDeg: 0, size: [2, 0.8, 1] },
    { id: 'chair', model: 'chair', room: 'b', position: [4.5, 1.5], rotationDeg: 0, size: [0.5, 0.9, 0.5] },
    { id: 'lamp', model: 'lamp', room: 'a', position: [0.3, 0.3], rotationDeg: 0, size: [0.3, 1.5, 0.3] },
  ];
  return parseScene(s);
}
const piece = (scene: Scene, id: string) => scene.furniture.find((f) => f.id === id)!;

describe('footprint', () => {
  it('is the width and depth around the position', () => {
    const corners = footprint({ position: [1.5, 1.5], rotationDeg: 0, size: [2, 0.8, 1] });
    expect(corners).toEqual([
      { x: 0.5, y: 1 }, { x: 2.5, y: 1 }, { x: 2.5, y: 2 }, { x: 0.5, y: 2 },
    ]);
  });

  it('swaps width and depth at 90 degrees', () => {
    const xs = footprint({ position: [0, 0], rotationDeg: 90, size: [2, 0.8, 1] }).map((c) => c.x);
    expect(Math.min(...xs)).toBeCloseTo(-0.5);
    expect(Math.max(...xs)).toBeCloseTo(0.5);
  });
});

describe('moveFurniture', () => {
  const scene = furnished();

  it('moves a piece and leaves the old scene untouched', () => {
    const next = moveFurniture(scene, 'sofa', [1.6, 1.2]);
    expect(piece(next, 'sofa').position).toEqual([1.6, 1.2]);
    expect(piece(scene, 'sofa').position).toEqual([1.5, 1.5]);
    expect(piece(next, 'chair')).toBe(piece(scene, 'chair'));
  });

  it('lets a piece sit flush against a wall', () => {
    const next = moveFurniture(scene, 'sofa', [1, 0.5]);
    expect(piece(next, 'sofa').position).toEqual([1, 0.5]);
  });

  it('slides along a wall when pushed into it', () => {
    const next = moveFurniture(scene, 'sofa', [1.2, -3]);
    expect(piece(next, 'sofa').position).toEqual([1.2, 1.5]);
  });

  it('returns the same scene when fully blocked', () => {
    expect(moveFurniture(scene, 'sofa', [50, 50])).toBe(scene);
    expect(moveFurniture(scene, 'nope', [1, 1])).toBe(scene);
  });

  it('updates the room when a piece is carried to another room', () => {
    const next = moveFurniture(scene, 'lamp', [4, 2]);
    expect(piece(next, 'lamp').room).toBe('b');
  });
});

describe('rotateFurniture', () => {
  it('turns a piece and wraps at 360', () => {
    const scene = furnished();
    expect(piece(rotateFurniture(scene, 'sofa', 90), 'sofa').rotationDeg).toBe(90);
    expect(piece(rotateFurniture(scene, 'sofa', -90), 'sofa').rotationDeg).toBe(270);
  });

  it('nudges a piece away from the wall when it needs room to turn', () => {
    const scene = moveFurniture(furnished(), 'sofa', [1.5, 0.5]);
    const turned = piece(rotateFurniture(scene, 'sofa', 90), 'sofa');
    expect(turned.rotationDeg).toBe(90);
    expect(turned.position).toEqual([1.5, 1]);
    expect(roomThatFits(scene, turned)?.id).toBe('a');
  });

  it('is blocked when the piece cannot fit at that angle anywhere nearby', () => {
    const s = twoRooms();
    s.furniture = [
      { id: 'big', model: 'big', room: 'a', position: [1.5, 1.5], rotationDeg: 0, size: [2.95, 1, 2] },
    ];
    const scene = parseScene(s);
    expect(rotateFurniture(scene, 'big', 45)).toBe(scene);
  });
});

describe('taking out and putting back', () => {
  const scene = furnished();

  it('takes a piece out and puts it back where it stood', () => {
    const out = takeOut(scene, 'sofa');
    expect(piece(out, 'sofa').removed).toBe(true);
    expect(takeOut(out, 'sofa')).toBe(out);
    const back = putBack(out, 'sofa');
    expect(piece(back, 'sofa')).toMatchObject({ removed: false, position: [1.5, 1.5] });
  });

  it('puts a piece back at a new spot, in another room', () => {
    const back = putBack(takeOut(scene, 'lamp'), 'lamp', [5, 2]);
    expect(piece(back, 'lamp')).toMatchObject({ removed: false, position: [5, 2], room: 'b' });
  });

  it('refuses a spot that does not fit', () => {
    const out = takeOut(scene, 'sofa');
    expect(putBack(out, 'sofa', [0.2, 0.2])).toBe(out);
  });

  it('empties one room only', () => {
    const emptied = emptyRoom(scene, 'a');
    expect(emptied.furniture.map((f) => !!f.removed)).toEqual([true, false, true]);
    expect(emptyRoom(emptied, 'a')).toBe(emptied);
  });

  it('resets to the original layout', () => {
    const changed = emptyRoom(moveFurniture(scene, 'chair', [5, 2]), 'a');
    expect(resetLayout(changed, scene).furniture).toBe(scene.furniture);
    expect(resetLayout(scene, scene)).toBe(scene);
  });
});

describe('the real home', () => {
  const scene = parseScene(home);

  it('starts with every piece fitting inside its room', () => {
    for (const f of scene.furniture) {
      expect(roomThatFits(scene, f)?.id, f.id).toBe(f.room);
    }
  });

  it('does not let a piece overlap the pier in the living room', () => {
    // The pier is at x 0..0.34, y 0.78..2.1. The chest is 0.45 m deep.
    const next = moveFurniture(scene, 'chest', [0.25, 1.5]);
    const chest = next.furniture.find((f) => f.id === 'chest')!;
    expect(chest.position).not.toEqual([0.25, 1.5]);
    expect(roomThatFits(next, chest)?.id).toBe('living');
    expect(roomAt(scene, { x: 0.2, y: 1.5 })).toBeUndefined();
  });
});

describe('History', () => {
  it('undoes and redoes', () => {
    const h = new History(1);
    h.set(2);
    h.set(3);
    h.undo();
    expect(h.current).toBe(2);
    h.redo();
    expect(h.current).toBe(3);
    expect(h.canRedo).toBe(false);
  });

  it('ignores a set to the same value and clears redo on a new change', () => {
    const h = new History(1);
    h.set(1);
    expect(h.canUndo).toBe(false);
    h.set(2);
    h.undo();
    h.set(5);
    expect(h.canRedo).toBe(false);
  });

  it('records a whole gesture as one undo step', () => {
    const h = new History(0);
    const seen: number[] = [];
    h.subscribe((v) => seen.push(v));
    h.beginGesture();
    h.preview(1);
    h.preview(2);
    h.preview(3);
    h.endGesture();
    expect(h.current).toBe(3);
    h.undo();
    expect(h.current).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(seen).toEqual([1, 2, 3, 3, 0]);
  });

  it('records nothing for a gesture that changed nothing', () => {
    const h = new History(0);
    h.beginGesture();
    h.endGesture();
    expect(h.canUndo).toBe(false);
  });
});

describe('resizing', () => {
  const home2 = parseScene(home);

  it('changes the size and keeps the piece in place when it still fits', () => {
    const next = resizeFurniture(home2, 'coffee-table', [1.0, 0.4, 0.5]);
    const table = next.furniture.find((f) => f.id === 'coffee-table')!;
    expect(table.size).toEqual([1.0, 0.4, 0.5]);
    expect(table.position).toEqual(home2.furniture.find((f) => f.id === 'coffee-table')!.position);
    expect(() => parseScene(next)).not.toThrow();
  });

  it('nudges a piece that grows into a wall, and refuses one that cannot fit', () => {
    const before = home2.furniture.find((f) => f.id === 'tv-unit')!;
    const next = resizeFurniture(home2, 'tv-unit', [before.size[0], before.size[1], 0.6]);
    const after = next.furniture.find((f) => f.id === 'tv-unit')!;
    expect(after.size[2]).toBe(0.6);
    expect(after.position).not.toEqual(before.position);
    expect(roomThatFits(next, after)).toBeDefined();
    expect(resizeFurniture(home2, 'tv-unit', [9, 0.5, 9])).toBe(home2);
    expect(resizeFurniture(home2, 'tv-unit', [1, 3.5, 0.4])).toBe(home2);
  });

  it('ignores sizes that are not sensible and no-op changes', () => {
    const size = home2.furniture.find((f) => f.id === 'rug')!.size;
    expect(resizeFurniture(home2, 'rug', size)).toBe(home2);
    expect(resizeFurniture(home2, 'rug', [0, 1, 1])).toBe(home2);
    expect(resizeFurniture(home2, 'rug', [NaN, 1, 1])).toBe(home2);
  });

  it('keeps a wall-hung piece against its wall', () => {
    const item = CATALOGUE.find((c) => c.key === 'wall-shelf')!;
    const added = addFurniture(home2, item, [0.1, 5]);
    const next = resizeFurniture(added.scene, added.id!, [1.2, 0.25, 0.3]);
    const shelf = next.furniture.find((f) => f.id === added.id)!;
    expect(shelf.position[0]).toBeCloseTo(0.154, 3);
    expect(shelf.mount).toBe('wall');
  });
});
