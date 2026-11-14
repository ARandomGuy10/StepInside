import type { Units } from './measure';
import type { Room, Scene } from './scene';

/**
 * Areas of a home, the way an architect's area statement gives them:
 *
 * - carpet area: the floor inside the rooms, walls left out;
 * - built-up area: the rooms with their walls, measured to the outside face;
 * - outdoor: balconies, terraces, courts and gardens on that floor.
 *
 * Built-up area is measured on a fine grid (5 cm): a spot counts when it is
 * inside a room or within one outside-wall thickness of one.
 */
export interface FloorAreas {
  name: string;
  carpet: number;
  builtUp: number;
  outdoor: number;
  rooms: { name: string; area: number }[];
}

export interface AreaSummary {
  /** The plot, to the outside of its boundary walls. */
  plot: number;
  floors: FloorAreas[];
  carpet: number;
  builtUp: number;
  /** Share of the plot the ground floor covers, 0 to 1. */
  coverage: number;
  /** Floor area ratio: total built-up area over the plot. */
  far: number;
  /** Ground left open to the sky or the garden: the plot less the ground floor's built-up area. */
  openGround: number;
}

/** Area of a polygon in square metres (shoelace formula). */
export function polygonArea(polygon: readonly (readonly [number, number])[]): number {
  let sum = 0;
  polygon.forEach(([x0, y0], i) => {
    const [x1, y1] = polygon[(i + 1) % polygon.length];
    sum += x0 * y1 - x1 * y0;
  });
  return Math.abs(sum) / 2;
}

const indoor = (room: Room): boolean => room.kind !== 'balcony' && room.kind !== 'void';

function inside(x: number, y: number, polygon: readonly (readonly [number, number])[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function nearEdge(x: number, y: number, polygon: readonly (readonly [number, number])[], reach: number): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= reach) return true;
  }
  return false;
}

/** The rooms of one floor with their walls, in square metres. */
export function builtUpArea(rooms: readonly Room[], wall: number, cell = 0.05): number {
  const shapes = rooms.filter(indoor).map((r) => r.polygon);
  if (!shapes.length) return 0;
  const xs = shapes.flat().map((p) => p[0]);
  const ys = shapes.flat().map((p) => p[1]);
  const x0 = Math.min(...xs) - wall;
  const y0 = Math.min(...ys) - wall;
  const cols = Math.ceil((Math.max(...xs) + wall - x0) / cell);
  const rows = Math.ceil((Math.max(...ys) + wall - y0) / cell);
  const built = new Uint8Array(cols * rows);
  for (const polygon of shapes) {
    const px = polygon.map((p) => p[0]);
    const py = polygon.map((p) => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...px) - wall - x0) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(...px) + wall - x0) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(...py) - wall - y0) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(...py) + wall - y0) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * cols + c;
        if (built[k]) continue;
        const x = x0 + (c + 0.5) * cell;
        const y = y0 + (r + 0.5) * cell;
        if (inside(x, y, polygon) || nearEdge(x, y, polygon, wall)) built[k] = 1;
      }
    }
  }
  let count = 0;
  for (const b of built) count += b;
  return count * cell * cell;
}

/** The area statement for a home: one entry per floor, then the totals. */
export function summarizeAreas(floors: readonly { name: string; scene: Scene }[]): AreaSummary {
  const ground = floors[0].scene;
  const wall = ground.defaults.exteriorWallThickness;
  const all = ground.rooms.flatMap((r) => r.polygon);
  const width = Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])) + 2 * wall;
  const depth = Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1])) + 2 * wall;
  const plot = width * depth;
  const result = floors.map(({ name, scene }) => {
    const rooms = scene.rooms.filter(indoor).map((r) => ({ name: r.name ?? r.id, area: polygonArea(r.polygon) }));
    return {
      name,
      rooms,
      carpet: rooms.reduce((sum, r) => sum + r.area, 0),
      builtUp: builtUpArea(scene.rooms, scene.defaults.exteriorWallThickness),
      outdoor: scene.rooms.filter((r) => r.kind === 'balcony').reduce((sum, r) => sum + polygonArea(r.polygon), 0),
    };
  });
  const builtUp = result.reduce((sum, f) => sum + f.builtUp, 0);
  return {
    plot,
    floors: result,
    carpet: result.reduce((sum, f) => sum + f.carpet, 0),
    builtUp,
    coverage: result[0].builtUp / plot,
    far: builtUp / plot,
    openGround: plot - result[0].builtUp,
  };
}

/** An area as text: "1,245 sq ft" or "115.7 m²". */
export function formatArea(squareMetres: number, units: Units): string {
  if (units === 'm') return `${squareMetres.toFixed(1)} m²`;
  return `${Math.round(squareMetres / (0.3048 * 0.3048)).toLocaleString('en-US')} sq ft`;
}
