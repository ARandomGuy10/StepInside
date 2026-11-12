import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../src/core/catalogue';
import { addFurniture, moveFurniture, paint, takeOut } from '../src/core/edits';
import { loadLayout, sameShell, saveLayout } from '../src/core/layout';
import { parseScene } from '../src/core/scene';
import home from '../scenes/home.json';
import { twoRooms } from './fixtures';

describe('save and load', () => {
  const original = parseScene(home);

  it('round-trips an edited home', () => {
    let s = paint(original, { kind: 'wall', room: 'living', edge: 7 }, '#7d8a74');
    s = paint(s, { kind: 'solid', id: 'closets-hal' }, '#22313f');
    s = moveFurniture(s, 'coffee-table', [2.2, 2.6]);
    s = takeOut(s, 'bar-trolley');
    s = addFurniture(s, CATALOGUE.find((c) => c.key === 'painting-wide')!, [0.1, 5]).scene;
    const result = loadLayout(saveLayout(s), original);
    expect('scene' in result && result.scene).toEqual(s);
  });

  it('keeps the lights and sun of the running scene', () => {
    const edited = { ...original, lights: [], sun: { ...original.sun, elevationDeg: 5 } };
    const result = loadLayout(saveLayout(edited), original);
    expect('scene' in result && result.scene.lights).toBe(original.lights);
    expect('scene' in result && result.scene.sun).toBe(original.sun);
  });

  it('refuses text that is not JSON, not a scene, or another home', () => {
    expect(loadLayout('hello', original)).toEqual({ error: 'That file is not JSON.' });
    const invalid = loadLayout('{"rooms": 3}', original);
    expect('error' in invalid && invalid.error).toContain('Scene file is not valid');
    const other = loadLayout(saveLayout(parseScene(twoRooms())), original);
    expect('error' in other && other.error).toContain('different walls');
  });

  it('treats paint and furniture as the same shell, a moved wall as a different one', () => {
    expect(sameShell(paint(original, { kind: 'floor', room: 'hal' }, '#000000'), original)).toBe(true);
    const moved = structuredClone(original);
    moved.openings[0].offset += 0.1;
    expect(sameShell(moved, original)).toBe(false);
  });
});
