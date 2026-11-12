import { describe, expect, it } from 'vitest';
import { parseScene, SceneError } from '../src/core/scene';
import home from '../scenes/home.json';
import { twoRooms } from './fixtures';

function issuesOf(scene: unknown): string[] {
  try {
    parseScene(scene);
  } catch (e) {
    if (e instanceof SceneError) return e.issues;
    throw e;
  }
  return [];
}

describe('parseScene', () => {
  it('accepts a valid scene', () => {
    expect(issuesOf(twoRooms())).toEqual([]);
  });

  it('accepts the real home scene', () => {
    expect(issuesOf(home)).toEqual([]);
  });

  it('rejects something that is not an object', () => {
    expect(issuesOf(42)).toEqual(['scene: must be an object']);
  });

  it('reports unknown fields with their path', () => {
    const s = twoRooms();
    s.rooms[0].colour = '#ffffff';
    expect(issuesOf(s)).toEqual(['scene.rooms[0].colour: unknown field']);
  });

  it('reports every problem, not just the first', () => {
    const s = twoRooms();
    s.units = 'ft';
    s.sun.color = 'red';
    expect(issuesOf(s)).toHaveLength(2);
  });

  it('rejects duplicate ids across rooms and openings', () => {
    const s = twoRooms();
    s.openings[0].id = 'a';
    expect(issuesOf(s)).toEqual(['scene.openings[0].id: duplicate id "a"']);
  });

  it('rejects a polygon that crosses itself', () => {
    const s = twoRooms();
    s.rooms[0].polygon = [[0, 0], [3, 3], [3, 0], [0, 3]];
    s.openings = [];
    expect(issuesOf(s)).toEqual(['scene.rooms[0].polygon: crosses over itself']);
  });

  it('rejects rooms that overlap', () => {
    const s = twoRooms();
    s.rooms[1].polygon = [[2.5, 0], [6, 0], [6, 3], [2.5, 3]];
    expect(issuesOf(s)).toEqual(['scene.rooms[1]: overlaps scene.rooms[0]']);
  });

  it('allows rooms that only touch along an edge', () => {
    const s = twoRooms();
    s.rooms[1].polygon = [[3, 0], [6, 0], [6, 3], [3, 3]];
    s.openings = [];
    expect(issuesOf(s)).toEqual([]);
  });

  it('rejects an opening that does not fit on its wall', () => {
    const s = twoRooms();
    s.openings[0].offset = 2.5;
    expect(issuesOf(s)[0]).toContain('does not fit on its wall');
  });

  it('rejects an opening taller than the wall', () => {
    const s = twoRooms();
    s.openings[1].height = 2;
    expect(issuesOf(s)[0]).toContain('is too tall');
  });

  it('rejects two openings that overlap on one wall', () => {
    const s = twoRooms();
    s.openings.push({ id: 'door-2', type: 'door', room: 'a', edge: 1, offset: 1.5, width: 0.9, height: 2.1 });
    expect(issuesOf(s)[0]).toContain('overlaps opening "door-ab"');
  });

  it('rejects an opening on a room or edge that does not exist', () => {
    const s = twoRooms();
    s.openings[0].room = 'nope';
    s.openings[1].edge = 7;
    expect(issuesOf(s)).toEqual([
      'scene.openings[0].room: no room with id "nope"',
      'scene.openings[1].edge: must be an edge index from 0 to 3',
    ]);
  });

  it('requires a sill height on windows', () => {
    const s = twoRooms();
    delete s.openings[1].sill;
    expect(issuesOf(s)).toEqual(['scene.openings[1].sill: is required for a window']);
  });

  it('validates furniture', () => {
    const s = twoRooms();
    s.furniture.push({ id: 'sofa', model: 'sofa', room: 'zzz', position: [1, 1], rotationDeg: 0, size: [2, 0.8, 0] });
    expect(issuesOf(s)).toEqual([
      'scene.furniture[0].room: no room with id "zzz"',
      'scene.furniture[0].size[2]: must be greater than 0, got 0',
    ]);
  });
});
