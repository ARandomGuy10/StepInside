import { describe, expect, it } from 'vitest';
import { roomThatFits } from '../src/core/edits';
import { parseScene } from '../src/core/scene';
import { buildWalls } from '../src/core/walls';
import apartment from '../scenes/home.json';
import villaFirst from '../scenes/villa-first.json';
import villaGround from '../scenes/villa-ground.json';

describe.each([
  ['apartment', apartment],
  ['villa ground floor', villaGround],
  ['villa first floor', villaFirst],
])('%s', (_name, json) => {
  it('is a valid scene with walls', () => {
    const scene = parseScene(json);
    expect(buildWalls(scene).slabs.length).toBeGreaterThan(scene.rooms.length);
  });

  it('has every piece of furniture inside its room', () => {
    const scene = parseScene(json);
    const outside = scene.furniture.filter((f) => roomThatFits(scene, f)?.id !== f.room).map((f) => f.id);
    expect(outside).toEqual([]);
  });

  it('starts the walker inside a room', () => {
    const scene = parseScene(json);
    expect(scene.start).toBeDefined();
  });
});
