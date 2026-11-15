import { describe, expect, it } from 'vitest';
import { countChanges } from '../src/core/session';
import { moveFurniture, paint, takeOut } from '../src/core/edits';
import { parseScene } from '../src/core/scene';
import { HOMES } from '../src/homes';

const scene = parseScene(HOMES[0].levels[0].json);
const piece = scene.furniture.find((f) => !f.fixed && !f.mount)!;

describe('countChanges', () => {
  it('is zero for the same home', () => {
    expect(countChanges([scene], [scene])).toBe(0);
    expect(countChanges([scene], [scene].slice())).toBe(0);
  });

  it('counts each changed piece once, however often it moved', () => {
    const once = takeOut(scene, piece.id);
    expect(countChanges([scene], [once])).toBe(1);
  });

  it('counts a painted room', () => {
    const room = scene.rooms[0];
    const painted = paint(scene, { kind: 'floor', room: room.id }, '#123456');
    expect(countChanges([scene], [painted])).toBe(1);
  });

  it('adds pieces and rooms together', () => {
    const room = scene.rooms[0];
    const next = paint(takeOut(scene, piece.id), { kind: 'floor', room: room.id }, '#123456');
    expect(countChanges([scene], [next])).toBe(2);
    expect(moveFurniture).toBeTypeOf('function');
  });
});
