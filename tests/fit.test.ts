import { describe, expect, it } from 'vitest';
import { clearInFront, OPEN_FLOOR } from '../src/core/fit';
import { parseScene, type Furniture, type Scene } from '../src/core/scene';
import { twoRooms } from './fixtures';

/** Room a is 3 x 3 m. A 2 x 1 m sofa in its middle, facing up the page (towards y = 0). */
function withSofa(extra: Furniture[] = [], rotationDeg = 0): Scene {
  const s = twoRooms();
  s.furniture = [
    { id: 'sofa', model: 'sofa', room: 'a', position: [1.5, 1.5], rotationDeg, size: [2, 0.8, 1] },
    ...extra,
  ];
  return parseScene(s);
}
const sofa = (s: Scene) => s.furniture.find((f) => f.id === 'sofa')!;

describe('clearInFront', () => {
  it('measures to the wall it faces', () => {
    const s = withSofa();
    expect(clearInFront(s, sofa(s))).toBeCloseTo(1);
  });

  it('stops at a piece standing in front', () => {
    const table: Furniture = { id: 't', model: 'table', room: 'a', position: [1.5, 0.6], rotationDeg: 0, size: [1, 0.4, 0.4] };
    const s = withSofa([table]);
    // The table's back edge is at y = 0.8, the sofa's front at y = 1.
    expect(clearInFront(s, sofa(s))).toBeCloseTo(0.2);
  });

  it('looks the way the piece is turned', () => {
    const s = withSofa([], 90);
    // Turned a quarter clockwise it faces +x: front edge at x = 2, wall at x = 3.
    expect(clearInFront(s, sofa(s))).toBeCloseTo(1);
  });

  it('ignores rugs and wall pieces, and has no answer for them', () => {
    const rug: Furniture = { id: 'rug', model: 'rug', room: 'a', position: [1.5, 0.5], rotationDeg: 0, size: [2, 0.02, 0.8] };
    const s = withSofa([rug]);
    expect(clearInFront(s, sofa(s))).toBeCloseTo(1);
    expect(clearInFront(s, s.furniture[1])).toBeNull();
  });

  it('caps open floor', () => {
    const s = twoRooms();
    s.rooms[0].polygon = [[0, 0], [9, 0], [9, 9], [0, 9]];
    s.rooms[1].polygon = [[9, 0], [12, 0], [12, 3], [9, 3]];
    s.furniture = [{ id: 'sofa', model: 'sofa', room: 'a', position: [4.5, 8], rotationDeg: 0, size: [2, 0.8, 1] }];
    const scene = parseScene(s);
    expect(clearInFront(scene, sofa(scene))).toBe(OPEN_FLOOR);
  });
});
