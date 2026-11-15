import { describe, expect, it } from 'vitest';
import villaGround from '../scenes/villa-d-ground.json';
import villaFirst from '../scenes/villa-d-first.json';
import { canArrange, layoutsFor } from '../src/core/arrange';
import { clashes, roomThatFits } from '../src/core/edits';
import { parseScene, type Scene } from '../src/core/scene';

const ground = parseScene(villaGround);
const first = parseScene(villaFirst);
const piece = (scene: Scene, id: string) => scene.furniture.find((f) => f.id === id)!;

/** Every rule a layout must keep, whatever the room. */
function expectSound(before: Scene, after: Scene, roomId: string): void {
  const clashed = new Set(clashes(before).map((pair) => pair.join()));
  expect(clashes(after).filter((pair) => !clashed.has(pair.join()))).toEqual([]);
  expect(after.furniture.length).toBe(before.furniture.length);
  after.furniture.forEach((f, i) => {
    const was = before.furniture[i];
    expect(f.id).toBe(was.id);
    if (was.room !== roomId || was.fixed) expect(f).toBe(was);
    else if (f !== was && f.mount !== 'wall' && f.size[1] > 0.1) expect(roomThatFits(after, f)?.id).toBe(roomId);
    expect(f.size).toEqual(was.size);
  });
}

describe('layouts for a room', () => {
  it('finds other places for the bed, each sound', () => {
    for (const [scene, roomId, bedId] of [[ground, 'master', 'master-bed'], [ground, 'guest', 'guest-bed']] as const) {
      const layouts = layoutsFor(scene, roomId);
      expect(layouts.length).toBeGreaterThan(0);
      const spots = new Set<string>();
      for (const layout of layouts) {
        expectSound(scene, layout.scene, roomId);
        const bed = piece(layout.scene, bedId);
        const was = piece(scene, bedId);
        expect(Math.hypot(bed.position[0] - was.position[0], bed.position[1] - was.position[1]) > 0.3 || bed.rotationDeg !== was.rotationDeg).toBe(true);
        spots.add(`${bed.position}|${bed.rotationDeg}`);
        expect(layout.name).toMatch(/^Bed /);
      }
      expect(spots.size).toBe(layouts.length);
    }
  });

  it('never stands the bed in front of a door', () => {
    for (const layout of layoutsFor(ground, 'master')) {
      const bed = piece(layout.scene, 'master-bed');
      // The master bedroom's door is in its bottom wall (y = 4.801), 2.5 to 3.4 m from the right.
      const half = bed.rotationDeg % 180 === 0 ? [bed.size[0] / 2, bed.size[2] / 2] : [bed.size[2] / 2, bed.size[0] / 2];
      const overDoor = bed.position[0] - half[0] < 8.001 - 2.515 && bed.position[0] + half[0] > 8.001 - 2.515 - 0.914;
      const nearWall = bed.position[1] + half[1] > 4.801 - 0.9;
      expect(overDoor && nearWall).toBe(false);
    }
  });

  it('keeps the bedside tables beside the bed', () => {
    const [layout] = layoutsFor(ground, 'master');
    const bed = piece(layout.scene, 'master-bed');
    for (const id of ['master-table-1', 'master-table-2']) {
      const table = piece(layout.scene, id);
      expect(Math.hypot(table.position[0] - bed.position[0], table.position[1] - bed.position[1])).toBeLessThan(bed.size[0] / 2 + 1.3);
    }
  });

  it('turns the sofa and the screen to face each other', () => {
    const layouts = layoutsFor(ground, 'living');
    for (const layout of layouts) {
      expectSound(ground, layout.scene, 'living');
      const sofa = piece(layout.scene, 'sofa');
      const tv = piece(layout.scene, 'tv-wall');
      expect(Math.abs(sofa.rotationDeg - tv.rotationDeg)).toBe(180);
      // The dining set is not part of the sitting group and stays put.
      expect(piece(layout.scene, 'dining-table')).toBe(piece(ground, 'dining-table'));
    }
  });

  it('gives nothing for a room with nothing to arrange round', () => {
    expect(layoutsFor(ground, 'kitchen')).toEqual([]);
    expect(canArrange(ground, 'kitchen')).toBe(false);
    expect(canArrange(ground, 'master')).toBe(true);
    expect(layoutsFor(ground, 'no-such-room')).toEqual([]);
  });

  it('holds on every room of the sample home', () => {
    for (const scene of [ground, first]) {
      for (const room of scene.rooms) {
        for (const layout of layoutsFor(scene, room.id)) expectSound(scene, layout.scene, room.id);
      }
    }
  });
});
