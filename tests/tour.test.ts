import { describe, expect, it } from 'vitest';
import { parseScene } from '../src/core/scene';
import { buildWalls } from '../src/core/walls';
import { doorways, openSpot, tourRoute } from '../src/core/tour';
import { roomAt } from '../src/core/edits';
import home from '../scenes/home.json';
import villaGround from '../scenes/villa-ground.json';
import villaFirst from '../scenes/villa-first.json';
import villaBGround from '../scenes/villa-b-ground.json';
import villaBFirst from '../scenes/villa-b-first.json';

describe('tour', () => {
  it('finds the most open spot inside an L-shaped room', () => {
    const room = { id: 'l', name: 'L', polygon: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]] as [number, number][] };
    const p = openSpot(room);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(1);
    expect(p.y).toBeLessThan(1);
  });

  for (const [name, json] of Object.entries({ home, villaGround, villaFirst, villaBGround, villaBFirst })) {
    it(`visits every room of ${name} once, each stop inside its room`, () => {
      const scene = parseScene(json);
      const walls = buildWalls(scene);
      const route = tourRoute(scene, walls, scene.rooms[0].id);
      const ids = route.stops.map((s) => s.roomId);
      expect(new Set(ids).size).toBe(ids.length);
      // Every room joined to the first by doors is on the tour.
      const reachable = new Set([scene.rooms[0].id]);
      const doors = doorways(scene, walls);
      for (let grew = true; grew; ) {
        grew = false;
        for (const d of doors) {
          const [a, b] = d.rooms;
          if (reachable.has(a) !== reachable.has(b)) {
            reachable.add(a);
            reachable.add(b);
            grew = true;
          }
        }
      }
      const expected = scene.rooms.filter((r) => r.kind !== 'void' && reachable.has(r.id)).map((r) => r.id);
      expect(new Set(ids)).toEqual(new Set(expected));
      for (const stop of route.stops) expect(roomAt(scene, route.path[stop.at])?.id).toBe(stop.roomId);
      expect(route.path.length - 1).toBe(route.stops[route.stops.length - 1].at);
    });
  }
});
