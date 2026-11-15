/**
 * Which way things face, and what traditional Vastu says about it.
 *
 * The plot is cut into a three by three grid. Each cell is named for the compass
 * direction it lies in from the middle of the plot, and each kind of room has
 * cells that Vastu tradition prefers and cells it avoids. This is a guide to a
 * tradition many owners in India ask about, not a rule of building.
 */
import type { Room, Scene } from './scene';

export const ZONES = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west', 'Centre'] as const;
export type Zone = (typeof ZONES)[number];

export interface Plot {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The zone of the plot a point lies in. `northDeg` is the scene's: 0 means north
 * is towards the top of the plan, and it grows clockwise.
 */
export function zoneAt(x: number, y: number, plot: Plot, northDeg: number): Zone {
  const dx = (x - (plot.minX + plot.maxX) / 2) / ((plot.maxX - plot.minX) / 2 || 1);
  const dy = (y - (plot.minY + plot.maxY) / 2) / ((plot.maxY - plot.minY) / 2 || 1);
  const col = dx < -1 / 3 ? -1 : dx > 1 / 3 ? 1 : 0;
  const row = dy < -1 / 3 ? -1 : dy > 1 / 3 ? 1 : 0;
  if (col === 0 && row === 0) return 'Centre';
  // Clockwise from the top of the plan, then turned so that 0 is north.
  const bearing = (Math.atan2(col, -row) * 180) / Math.PI - northDeg;
  return ZONES[((Math.round(bearing / 45) % 8) + 8) % 8];
}

interface Guide {
  /** What kind of room this is, matched against its name and id. */
  match: RegExp;
  kind: string;
  prefers: Zone[];
  avoids: Zone[];
}

// Checked in order, so the narrower names come first ("pool shower" before "pool").
const GUIDES: Guide[] = [
  { match: /pooja|puja|prayer|mandir|temple/i, kind: 'Prayer room', prefers: ['North-east', 'East', 'North'], avoids: ['South', 'South-west'] },
  { match: /kitchen/i, kind: 'Kitchen', prefers: ['South-east', 'North-west'], avoids: ['North-east', 'South-west', 'Centre'] },
  { match: /toilet|bath|shower|powder|\bwc\b/i, kind: 'Bathroom', prefers: ['North-west', 'West', 'South'], avoids: ['North-east', 'Centre', 'South-west'] },
  { match: /master/i, kind: 'Master bedroom', prefers: ['South-west', 'South'], avoids: ['North-east', 'South-east'] },
  { match: /guest/i, kind: 'Guest room', prefers: ['North-west', 'West'], avoids: ['South-west'] },
  { match: /child|kid|bed/i, kind: 'Bedroom', prefers: ['West', 'North-west', 'South', 'East'], avoids: ['North-east'] },
  { match: /pool|water|pond/i, kind: 'Water', prefers: ['North-east', 'North', 'East'], avoids: ['South-west', 'South-east', 'Centre'] },
  { match: /living|lounge|family|drawing/i, kind: 'Living room', prefers: ['North', 'East', 'North-east', 'North-west'], avoids: [] },
  { match: /dining/i, kind: 'Dining', prefers: ['West', 'East', 'North'], avoids: [] },
  { match: /study|office|library/i, kind: 'Study', prefers: ['East', 'North', 'North-east', 'West'], avoids: [] },
  { match: /stair/i, kind: 'Stairs', prefers: ['South', 'West', 'South-west'], avoids: ['North-east', 'Centre'] },
  { match: /store|utility|laundry/i, kind: 'Store', prefers: ['South-west', 'North-west', 'West', 'South'], avoids: ['North-east'] },
  { match: /entrance|foyer|hall|porch/i, kind: 'Entrance', prefers: ['North', 'East', 'North-east'], avoids: ['South-west'] },
  { match: /garden|lawn/i, kind: 'Garden', prefers: ['North', 'East', 'North-east'], avoids: [] },
];

export interface RoomFacing {
  id: string;
  name: string;
  zone: Zone;
  /** What Vastu tradition says of this kind of room in this zone, or nothing if it has no view on the room. */
  verdict?: 'suits' | 'neutral' | 'avoids';
  /** Where the tradition would rather have it, for the note beside the room. */
  prefers?: Zone[];
}

const centreOf = (room: Room): [number, number] => {
  let x = 0;
  let y = 0;
  for (const p of room.polygon) {
    x += p[0];
    y += p[1];
  }
  return [x / room.polygon.length, y / room.polygon.length];
};

/** Every room of a storey with the zone it lies in and what Vastu says of it. */
export function roomFacings(scene: Scene, plot: Plot): RoomFacing[] {
  return scene.rooms
    .filter((room) => room.kind !== 'void')
    .map((room) => {
      const [x, y] = centreOf(room);
      const zone = zoneAt(x, y, plot, scene.northDeg);
      const name = room.name ?? room.id;
      const guide = GUIDES.find((g) => g.match.test(name) || g.match.test(room.id));
      if (!guide) return { id: room.id, name, zone };
      const verdict = guide.prefers.includes(zone) ? 'suits' : guide.avoids.includes(zone) ? 'avoids' : 'neutral';
      return { id: room.id, name, zone, verdict, prefers: guide.prefers };
    });
}
