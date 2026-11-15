import { polygonArea } from './areas';
import type { Scene } from './scene';
import { buildWalls } from './walls';

/**
 * A first count of what the home takes to finish: floor by finish, wall and
 * ceiling to paint, skirting, doors and windows. It is read off the model, so
 * it is as good as the model: a guide for talking to a contractor, not a bill.
 */
export interface Quantities {
  /** Floor area by finish, in square metres. Rooms with no finish chosen are under "plain". */
  floors: { finish: string; area: number }[];
  /** All floor inside the rooms, balconies and terraces included. */
  floorArea: number;
  /** Inside faces of the walls, less doors and windows. */
  wallInside: number;
  /** Outside faces of the outer walls, less doors and windows. */
  wallOutside: number;
  /** Ceilings of the roofed rooms. */
  ceiling: number;
  /** Length of skirting: round the inside of every room, less the doorways. */
  skirting: number;
  doors: number;
  windows: number;
  /** Glass in the windows, in square metres. */
  glazing: number;
  /** Loose pieces of furniture in place. */
  pieces: number;
}

const EMPTY: Quantities = {
  floors: [], floorArea: 0, wallInside: 0, wallOutside: 0, ceiling: 0, skirting: 0, doors: 0, windows: 0, glazing: 0, pieces: 0,
};

/** The quantities of one floor. */
export function quantitiesOf(scene: Scene): Quantities {
  const q: Quantities = { ...EMPTY, floors: [] };
  const byFinish = new Map<string, number>();
  const kinds = new Map(scene.rooms.map((r) => [r.id, r.kind ?? 'room']));
  for (const room of scene.rooms) {
    if (room.kind === 'void') continue;
    const area = polygonArea(room.polygon);
    const finish = room.floor?.material ?? 'plain';
    byFinish.set(finish, (byFinish.get(finish) ?? 0) + area);
    q.floorArea += area;
    if (room.kind !== 'balcony') q.ceiling += area;
  }
  q.floors = [...byFinish].map(([finish, area]) => ({ finish, area })).sort((a, b) => b.area - a.area);

  for (const slab of buildWalls(scene).slabs) {
    if (slab.kind !== 'wall' || slab.boundary || kinds.get(slab.roomId) !== 'room') continue;
    const length = Math.hypot(slab.b.x - slab.a.x, slab.b.y - slab.a.y);
    const holes = slab.holes.reduce((sum, h) => sum + h.width * h.height, 0);
    const face = Math.max(0, length * slab.height - holes);
    q.wallInside += face;
    if (slab.outside) q.wallOutside += face;
    const doorways = slab.holes.filter((h) => h.type === 'door').reduce((sum, h) => sum + h.width, 0);
    q.skirting += Math.max(0, length - doorways);
  }

  for (const opening of scene.openings) {
    if (opening.type === 'door') q.doors++;
    else {
      q.windows++;
      q.glazing += opening.width * opening.height;
    }
  }
  q.pieces = scene.furniture.filter((f) => !f.removed && !f.fixed).length;
  return q;
}

/** The quantities of every floor added up. */
export function totalQuantities(floors: readonly Quantities[]): Quantities {
  const total: Quantities = { ...EMPTY, floors: [] };
  const byFinish = new Map<string, number>();
  for (const q of floors) {
    for (const f of q.floors) byFinish.set(f.finish, (byFinish.get(f.finish) ?? 0) + f.area);
    for (const key of ['floorArea', 'wallInside', 'wallOutside', 'ceiling', 'skirting', 'doors', 'windows', 'glazing', 'pieces'] as const) {
      total[key] += q[key];
    }
  }
  total.floors = [...byFinish].map(([finish, area]) => ({ finish, area })).sort((a, b) => b.area - a.area);
  return total;
}

/** A rate the owner types in, and the quantity it is charged on. */
export interface CostLine {
  id: string;
  label: string;
  /** Square metres. */
  quantity: number;
}

/** The lines a rough cost is built from. The rates are the owner's; none are assumed. */
export function costLines(builtUp: number, total: Quantities): CostLine[] {
  return [
    { id: 'build', label: 'Construction, on built-up area', quantity: builtUp },
    { id: 'floor', label: 'Flooring, on floor area', quantity: total.floorArea },
    { id: 'paint', label: 'Painting, on walls and ceilings', quantity: total.wallInside + total.wallOutside + total.ceiling },
  ];
}

/** Square metres in one unit of area of the owner's units. */
export const AREA_UNIT = { m: 1, ft: 0.09290304 } as const;

/** What one line costs at a rate per square metre or per square foot. */
export function lineCost(line: CostLine, rate: number, units: 'm' | 'ft'): number {
  return (line.quantity / AREA_UNIT[units]) * rate;
}
