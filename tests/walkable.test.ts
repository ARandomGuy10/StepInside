import { describe, expect, it } from 'vitest';
import { parseScene, type Scene } from '../src/core/scene';
import { checkWalkable } from '../src/core/walkable';
import { HOMES } from '../src/homes';

const room = (id: string, polygon: [number, number][], kind?: 'balcony'): Scene['rooms'][number] => ({ id, name: id, polygon, ...(kind ? { kind } : {}) });
const scene = (furniture: Scene['furniture'], openings: Scene['openings'] = []): Scene =>
  parseScene({
    schemaVersion: 1,
    name: 'Test',
    units: 'm',
    northDeg: 0,
    sun: { azimuthDeg: 180, elevationDeg: 45, intensity: 3, color: '#ffffff' },
    defaults: { ceilingHeight: 2.7, exteriorWallThickness: 0.2, railingHeight: 1.1, wallColor: '#eeeeee', floorColor: '#cccccc', ceilingColor: '#ffffff', exteriorColor: '#dddddd' },
    start: { position: [1, 1], yawDeg: 0 },
    rooms: [room('a', [[0, 0], [4, 0], [4, 3], [0, 3]]), room('b', [[4.15, 0], [7, 0], [7, 3], [4.15, 3]])],
    openings: [{ id: 'door-b', type: 'door', room: 'b', edge: 3, offset: 1, width: 0.9, height: 2.1 }, ...openings],
    furniture,
  });

describe('checkWalkable', () => {
  it('walks through an open door into the next room', () => {
    const report = checkWalkable(scene([]));
    expect(report.unreachableRooms).toEqual([]);
    expect(report.blockedDoors).toEqual([]);
  });

  it('finds a door blocked by a wardrobe in front of it', () => {
    const wardrobe = { id: 'w', model: 'wardrobe', room: 'b', position: [4.5, 1.45] as [number, number], rotationDeg: 90, size: [1.4, 2.2, 0.6] as [number, number, number], color: '#ffffff' };
    const report = checkWalkable(scene([wardrobe]));
    expect(report.blockedDoors).toEqual(['door-b']);
    expect(report.unreachableRooms).toEqual(['b']);
  });

  it('finds a toilet with no room to stand in front of it', () => {
    const toilet = { id: 'wc', model: 'toilet', room: 'a', position: [2, 0.4] as [number, number], rotationDeg: 180, size: [0.4, 0.78, 0.68] as [number, number, number], color: '#ffffff' };
    const bench = { id: 'bench', model: 'bench', room: 'a', position: [2, 1.15] as [number, number], rotationDeg: 0, size: [1.6, 0.45, 0.4] as [number, number, number], color: '#ffffff' };
    expect(checkWalkable(scene([toilet])).blockedFixtures).toEqual([]);
    expect(checkWalkable(scene([toilet, bench])).blockedFixtures).toEqual(['wc']);
  });
});

// Design D, the chosen design, is walked floor by floor: a person 50 cm
// across reaches every room and door and can stand at every fixture.
// Planters are left out: nobody walks in them.
const PLANTERS = new Set(['curl-garden', 'slab-planter']);
const d = HOMES.find((h) => h.id === 'villa-d')!;
describe.each(d.levels.map((l) => [l.name, l.json] as const))('villa-d: %s can be walked', (_name, json) => {
  const report = checkWalkable(parseScene(json));
  it('reaches every room', () => expect(report.unreachableRooms.filter((id) => !PLANTERS.has(id))).toEqual([]));
  it('has a clear step on both sides of every door', () => expect(report.blockedDoors).toEqual([]));
  it('has room to stand at every bed, wardrobe, toilet, basin and shower', () => expect(report.blockedFixtures).toEqual([]));
});
