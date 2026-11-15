import { describe, expect, it } from 'vitest';
import { addOpening, facingEdges, moveOpening, moveWall, removeOpening, resizeOpening } from '../src/core/layoutEdits';
import { parseScene, type Scene } from '../src/core/scene';
import villaD from '../scenes/villa-d-ground.json';
import { twoRooms } from './fixtures';

const scene = (): Scene => parseScene(twoRooms());
const room = (s: Scene, id: string) => s.rooms.find((r) => r.id === id)!;

describe('facingEdges', () => {
  it('finds the room across a shared wall', () => {
    // Room a's edge 1 runs x = 3; room b's edge 3 runs x = 3.1.
    expect(facingEdges(scene(), 'a', 1)).toEqual([{ room: 'b', edge: 3 }]);
  });

  it('finds nothing behind an outside wall', () => {
    expect(facingEdges(scene(), 'a', 3)).toEqual([]);
  });
});

describe('moveWall', () => {
  it('moves a shared wall as one: one room grows, the other shrinks', () => {
    const next = moveWall(scene(), 'a', 1, 0.5);
    expect(room(next, 'a').polygon).toEqual([[0, 0], [3.5, 0], [3.5, 3], [0, 3]]);
    expect(room(next, 'b').polygon).toEqual([[3.6, 0], [6, 0], [6, 3], [3.6, 3]]);
  });

  it('moves an outside wall alone', () => {
    const s = scene();
    const next = moveWall(s, 'a', 3, 0.4);
    expect(room(next, 'a').polygon).toEqual([[-0.4, 0], [3, 0], [3, 3], [-0.4, 3]]);
    expect(room(next, 'b')).toBe(room(s, 'b'));
  });

  it('refuses to squash a room or push a door off its wall', () => {
    const s = scene();
    expect(moveWall(s, 'a', 1, 2.8)).toBe(s); // room b would be 0.4 m wide, and its door would not fit
    expect(moveWall(s, 'a', 3, -2.9)).toBe(s);
  });

  it('works on a real plan without breaking it', () => {
    const s = parseScene(villaD);
    const living = s.rooms.find((r) => r.id === 'living')!;
    let moved = false;
    for (let e = 0; e < living.polygon.length && !moved; e++) moved = moveWall(s, 'living', e, 0.1) !== s;
    expect(moved).toBe(true);
  });
});

describe('openings', () => {
  it('adds a door centred where asked, inside the wall', () => {
    const { scene: next, id } = addOpening(scene(), 'a', 2, 'door', 1.5);
    const door = next.openings.find((o) => o.id === id)!;
    expect(door).toMatchObject({ type: 'door', room: 'a', edge: 2, offset: 1.05, width: 0.9, height: 2.1 });
  });

  it('adds a window with a sill, and keeps it off the corner', () => {
    const { scene: next, id } = addOpening(scene(), 'b', 0, 'window', 0.1);
    expect(next.openings.find((o) => o.id === id)).toMatchObject({ offset: 0.1, sill: 0.9 });
  });

  it('moves along to the nearest free stretch of wall', () => {
    // win-a sits on room a's edge 0 from 0.5 to 1.7, so a door asked for at 1 m goes past it.
    const { scene: next, id } = addOpening(scene(), 'a', 0, 'door', 1);
    expect(next.openings.find((o) => o.id === id)!.offset).toBeCloseTo(1.8);
  });

  it('slides, resizes and removes', () => {
    let s = moveOpening(scene(), 'win-a', 1.2);
    expect(s.openings.find((o) => o.id === 'win-a')!.offset).toBe(1.2);
    s = resizeOpening(s, 'win-a', 1.6);
    expect(s.openings.find((o) => o.id === 'win-a')).toMatchObject({ width: 1.6, offset: 1 });
    s = removeOpening(s, 'win-a');
    expect(s.openings.some((o) => o.id === 'win-a')).toBe(false);
  });

  it('keeps a slid opening on its wall', () => {
    const s = moveOpening(scene(), 'win-a', 9);
    expect(s.openings.find((o) => o.id === 'win-a')!.offset).toBe(1.75);
  });
});
