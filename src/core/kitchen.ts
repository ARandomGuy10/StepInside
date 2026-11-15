/**
 * Fitted kitchens: a run of units along one wall, worked out from the
 * wall's length, its doors and its windows. The run is ordinary furniture,
 * one piece per unit, so it can still be painted, moved or taken out.
 */
import type { Vec2 } from './collision';
import { dot, length, sub } from './geometry';
import { edgeLength, outwardNormal } from './layoutEdits';
import { toVec, type Furniture, type Room, type Scene } from './scene';

export interface KitchenOptions {
  /** Colour of the doors and drawer fronts. */
  fronts: string;
  worktop: 'stone' | 'wood' | 'dark';
  /** A tall fridge unit at the start of the run. */
  tall: boolean;
  /** Cupboards on the wall above the worktop. */
  wallUnits: boolean;
}

export const KITCHEN_DEFAULTS: KitchenOptions = { fronts: '#ecebe6', worktop: 'stone', tall: true, wallUnits: true };

const DEPTH = 0.6;
const WALL_DEPTH = 0.34;
/** Standard unit widths, widest first. */
const WIDTHS = [0.6, 0.5, 0.45, 0.4, 0.3];
const mm = (v: number): number => Math.round(v * 1000) / 1000;

/** A unit laid along the wall: where it starts, how wide, and what it is. */
export interface Slot {
  start: number;
  width: number;
  kind: 'base' | 'sink' | 'hob' | 'tall';
}

/**
 * Splits a stretch of wall into units. Pure arithmetic, so it can be tested
 * on its own: `free` are the stretches clear of doors, `window` is the
 * middle of a window on the wall if there is one, where the sink goes.
 */
export function planRun(free: [number, number][], window: number | undefined, tall: boolean): Slot[] {
  const slots: Slot[] = [];
  const longest = [...free].sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  for (const stretch of free) {
    const [from, to] = stretch;
    let t = from;
    if (tall && stretch === longest && to - from >= 2.4) {
      slots.push({ start: t, width: 0.6, kind: 'tall' });
      t += 0.6;
    }
    // Fill with the widest units that fit; what is left over under 30 cm stays open.
    while (to - t >= WIDTHS[WIDTHS.length - 1] - 1e-6) {
      const width = WIDTHS.find((w) => w <= to - t + 1e-6)!;
      slots.push({ start: mm(t), width, kind: 'base' });
      t += width;
    }
  }
  const bases = slots.filter((s) => s.kind === 'base' && s.width >= 0.45);
  if (!bases.length) return slots;
  const centre = (s: Slot): number => s.start + s.width / 2;
  // The sink goes under the window, or a third of the way along.
  const span = [Math.min(...slots.map((s) => s.start)), Math.max(...slots.map((s) => s.start + s.width))];
  const aim = window ?? span[0] + (span[1] - span[0]) / 3;
  const sink = bases.reduce((best, s) => (Math.abs(centre(s) - aim) < Math.abs(centre(best) - aim) ? s : best));
  sink.kind = 'sink';
  // The hob as far from the sink as it can be, within the same run.
  const others = bases.filter((s) => s !== sink && s.width >= 0.6);
  if (others.length) {
    const hob = others.reduce((best, s) => (Math.abs(centre(s) - centre(sink)) > Math.abs(centre(best) - centre(sink)) ? s : best));
    hob.kind = 'hob';
  }
  return slots;
}

const ends = (room: Room, edge: number): [Vec2, Vec2] => [toVec(room.polygon[edge]), toVec(room.polygon[(edge + 1) % room.polygon.length])];

/**
 * Fits a run of kitchen units along one wall of a room, replacing any
 * kitchen units already against that wall. Returns the same scene when the
 * wall is too short or has no stretch clear of doors.
 */
export function fitKitchen(scene: Scene, roomId: string, edge: number, options: KitchenOptions = KITCHEN_DEFAULTS): Scene {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room || edge < 0 || edge >= room.polygon.length) return scene;
  const wall = edgeLength(room, edge);
  const [a, b] = ends(room, edge);
  const u = { x: (b.x - a.x) / wall, y: (b.y - a.y) / wall };
  const out = outwardNormal(room, edge);
  const inward = { x: -out.x, y: -out.y };
  const openings = scene.openings.filter((o) => o.room === roomId && o.edge === edge);

  // Doors cut the run, with a little room either side for the frame.
  let free: [number, number][] = [[0, wall]];
  for (const door of openings.filter((o) => o.type === 'door')) {
    const cut: [number, number] = [door.offset - 0.1, door.offset + door.width + 0.1];
    free = free.flatMap(([s, e]) => [[s, Math.min(e, cut[0])], [Math.max(s, cut[1]), e]] as [number, number][]).filter(([s, e]) => e - s > 0.29);
  }
  if (!free.length) return scene;
  // Take out the kitchen units already standing against this wall.
  const against = (f: Furniture): boolean => {
    if (!f.model.startsWith('kitchen') || f.room !== roomId) return false;
    const p = toVec(f.position);
    const along = dot(sub(p, a), u);
    const off = dot(sub(p, a), inward);
    return along > -0.3 && along < wall + 0.3 && off >= -0.05 && off < 0.9;
  };
  const kept = scene.furniture.filter((f) => !against(f));
  // A run on the next wall already fills a corner: start this one past it.
  const busy = (corner: Vec2): boolean =>
    kept.some((f) => f.room === roomId && !f.removed && f.mount !== 'wall' && f.model.startsWith('kitchen') && length(sub(toVec(f.position), corner)) < 0.8);
  if (busy(a)) free = free.map(([s0, e0]) => [Math.max(s0, DEPTH), e0] as [number, number]).filter(([s0, e0]) => e0 - s0 > 0.29);
  if (busy(b)) free = free.map(([s0, e0]) => [s0, Math.min(e0, wall - DEPTH)] as [number, number]).filter(([s0, e0]) => e0 - s0 > 0.29);
  if (!free.length) return scene;
  const window = openings.find((o) => o.type === 'window' && (o.sill ?? 0) >= 0.85);
  const slots = planRun(free, window ? window.offset + window.width / 2 : undefined, options.tall);
  if (!slots.length) return scene;

  const taken = new Set(scene.furniture.map((f) => f.id));
  const nextId = (key: string): string => {
    let n = 1;
    while (taken.has(`${key}-${n}`)) n++;
    taken.add(`${key}-${n}`);
    return `${key}-${n}`;
  };
  // Turned so the fronts face into the room: front is (sin r, -cos r) on the plan.
  const rotationDeg = mm(((Math.atan2(inward.x, -inward.y) * 180) / Math.PI + 360) % 360);
  const at = (t: number, depth: number): [number, number] => [mm(a.x + u.x * t + inward.x * depth / 2), mm(a.y + u.y * t + inward.y * depth / 2)];

  const units: Furniture[] = [];
  const tops = `:${options.worktop}`;
  for (const slot of slots) {
    const mid = slot.start + slot.width / 2;
    const base = { room: roomId, rotationDeg, color: options.fronts };
    if (slot.kind === 'tall') {
      units.push({ ...base, id: nextId('kitchen-tall'), name: 'Tall fridge unit', model: 'kitchen-tall', size: [0.6, 2.1, DEPTH], position: at(mid, DEPTH) });
      continue;
    }
    const model = slot.kind === 'sink' ? 'kitchen-sink-unit' : slot.kind === 'hob' ? 'kitchen-hob-unit' : 'kitchen-base';
    const name = slot.kind === 'sink' ? 'Sink unit' : slot.kind === 'hob' ? 'Hob unit' : 'Base unit';
    units.push({ ...base, id: nextId(model), name: `${name}, ${Math.round(slot.width * 100)} cm`, model: model + tops, size: [slot.width, 0.9, DEPTH], position: at(mid, DEPTH) });
    // Wall cupboards, except over a window, the sink's window, or the hob (where a hood would go).
    const underWindow = openings.some((o) => o.type === 'window' && o.offset < slot.start + slot.width && slot.start < o.offset + o.width);
    if (options.wallUnits && slot.kind !== 'hob' && !underWindow) {
      units.push({
        ...base, id: nextId('kitchen-wall-unit'), name: `Wall cupboard, ${Math.round(slot.width * 100)} cm`, model: 'kitchen-wall-unit',
        size: [slot.width, 0.72, WALL_DEPTH], position: at(mid, WALL_DEPTH), mount: 'wall', elevation: 1.45,
      });
    }
  }
  return { ...scene, furniture: [...kept, ...units] };
}

/** True when a room reads as a kitchen: by name, or by the units in it. */
export function isKitchen(scene: Scene, room: Room): boolean {
  return /kitchen|pantry|cook/i.test(room.name) || scene.furniture.some((f) => f.room === room.id && !f.removed && f.model.startsWith('kitchen'));
}

/** How long the fitted run along a wall is, in metres of units, for the panel. */
export function runLength(scene: Scene, roomId: string): number {
  return scene.furniture
    .filter((f) => f.room === roomId && !f.removed && f.mount !== 'wall' && f.model.startsWith('kitchen') && !f.model.startsWith('kitchen-island'))
    .reduce((sum, f) => sum + f.size[0], 0);
}

