/**
 * Other ways to furnish a room, worked out by rules, with the pieces the room
 * already has. Nothing here guesses: each rule is one an interior designer
 * would state out loud (a bed's head goes on a wall with no door in it, a
 * television faces the sofa, nothing stands in a doorway).
 *
 * A layout is a new scene. The pieces of other rooms, and the fixed parts of
 * this one, are left exactly where they are.
 */
import type { Vec2 } from './collision';
import { footprint, roomThatFits, standingHeight } from './edits';
import { pointInsideOrOn } from './geometry';
import { toVec, type Furniture, type Point, type Room, type Scene } from './scene';
import { buildWalls } from './walls';

export interface Layout {
  /** A short name, such as "Bed facing the door". */
  name: string;
  /** One sentence on the rule behind it. */
  why: string;
  scene: Scene;
}

/** A straight wall of the room: the pieces stand along it, backs to it. */
interface Wall {
  a: Vec2;
  /** Unit vector along the wall, from a. */
  t: Vec2;
  /** Unit vector into the room. */
  n: Vec2;
  length: number;
  doors: Span[];
  windows: (Span & { sill: number })[];
}

/** A stretch of a wall, from `from` to `to` metres along it. */
interface Span {
  from: number;
  to: number;
}

const mm = (v: number): number => Math.round(v * 1000) / 1000;
const GAP = 0.03;
/** Clear floor kept in front of a door. */
const DOOR_DEPTH = 0.9;

const BED = /^(bed|[a-z]+-bed)$/;
/** Things with "bed" in the name that nobody sleeps in. */
const NOT_BED = /planting|flower|day/;
const SOFA = /sofa|couch/;
const TABLE = /dining-table|round-table/;
const CHAIR = /dining-chair|^chair/;
const SIDE = /side-table|nightstand|bedside/;
const COFFEE = /coffee-table/;
const ARMCHAIR = /armchair/;
const TV = /^tv/;
const STORAGE = /wardrobe|sideboard|bookshelf|shelf|dresser|cabinet|desk/;
const BENCH = /ottoman|^bench/;
const CORNER = /floor-plant|floor-lamp|^plant/;
const isRug = (f: Furniture): boolean => f.size[1] <= 0.1;

/** The walls of a room that run straight across or straight down the plan. */
function wallsOf(scene: Scene, room: Room): Wall[] {
  const outline = room.polygon.map(toVec);
  const slabs = buildWalls(scene).slabs.filter((s) => s.roomId === room.id);
  const walls: Wall[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.6) return;
    const t = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    if (Math.abs(t.x) > 0.01 && Math.abs(t.y) > 0.01) return; // a slanting wall: nothing is stood against it
    let n = { x: -t.y, y: t.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!pointInsideOrOn({ x: mid.x + n.x * 0.05, y: mid.y + n.y * 0.05 }, outline)) n = { x: -n.x, y: -n.y };
    const wall: Wall = { a, t, n, length, doors: [], windows: [] };
    for (const slab of slabs) {
      if (slab.edge !== i) continue;
      const sl = Math.hypot(slab.b.x - slab.a.x, slab.b.y - slab.a.y) || 1;
      const dir = { x: (slab.b.x - slab.a.x) / sl, y: (slab.b.y - slab.a.y) / sl };
      for (const hole of slab.holes) {
        const ends = [hole.offset, hole.offset + hole.width].map((d) => {
          const p = { x: slab.a.x + dir.x * d, y: slab.a.y + dir.y * d };
          return (p.x - a.x) * t.x + (p.y - a.y) * t.y;
        });
        const span = { from: Math.min(...ends), to: Math.max(...ends) };
        if (hole.type === 'door') wall.doors.push(span);
        else wall.windows.push({ ...span, sill: hole.sill });
      }
    }
    walls.push(wall);
  });
  return walls;
}

/** The turn that puts a piece's back against a wall whose inside faces along `n`. */
function facing(n: Vec2): number {
  if (Math.abs(n.y) > Math.abs(n.x)) return n.y > 0 ? 180 : 0;
  return n.x > 0 ? 90 : 270;
}

/** A piece with its back to `wall`, its middle `along` metres from the wall's start, `out` metres off the wall. */
function against(f: Furniture, wall: Wall, along: number, out = GAP): Furniture {
  const depth = f.size[2] / 2 + out;
  return {
    ...f,
    position: [mm(wall.a.x + wall.t.x * along + wall.n.x * depth), mm(wall.a.y + wall.t.y * along + wall.n.y * depth)],
    rotationDeg: facing(wall.n),
  };
}

const overlap = (a: Span, b: Span, margin = 0): boolean => a.from < b.to + margin && b.from < a.to + margin;

/** The box round a piece's footprint. */
function boxOf(f: Furniture): { x0: number; y0: number; x1: number; y1: number } {
  const c = footprint(f);
  return { x0: Math.min(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), x1: Math.max(...c.map((p) => p.x)), y1: Math.max(...c.map((p) => p.y)) };
}

class Arranger {
  /** The scene as arranged so far: pieces still to be placed are taken out of it. */
  scene: Scene;
  private readonly waiting = new Map<string, Furniture>();

  constructor(private readonly original: Scene, readonly room: Room, readonly walls: readonly Wall[], movable: readonly Furniture[]) {
    for (const f of movable) this.waiting.set(f.id, f);
    this.scene = { ...original, furniture: original.furniture.filter((f) => !this.waiting.has(f.id)) };
  }

  /** True when `f` may stand where it says: inside the room, clear of the other pieces, the doors and the windows. */
  fits(f: Furniture): boolean {
    if (roomThatFits(this.scene, f)?.id !== this.room.id) return false;
    if (isRug(f)) return true;
    if (standingHeight(this.scene, f) === null) return false;
    const box = boxOf(f);
    for (const wall of this.walls) {
      // The piece as this wall sees it: a stretch along the wall, and how far off it.
      const along = [box.x0, box.x1].flatMap((x) => [box.y0, box.y1].map((y) => (x - wall.a.x) * wall.t.x + (y - wall.a.y) * wall.t.y));
      const off = [box.x0, box.x1].flatMap((x) => [box.y0, box.y1].map((y) => (x - wall.a.x) * wall.n.x + (y - wall.a.y) * wall.n.y));
      const span = { from: Math.min(...along), to: Math.max(...along) };
      const near = Math.min(...off);
      if (wall.doors.some((d) => overlap(span, d, 0.05) && near < DOOR_DEPTH)) return false;
      if (wall.windows.some((w) => overlap(span, w) && near < 0.3 && f.size[1] > w.sill + 0.15)) return false;
    }
    return true;
  }

  /** Puts a piece down at the first of the spots it fits. False when none does. */
  place(id: string, spots: Iterable<Furniture>): boolean {
    if (!this.waiting.has(id)) return false;
    // A rug only has to lie inside the room.
    for (const spot of spots) {
      if (!this.fits(spot)) continue;
      this.put(spot);
      return true;
    }
    return false;
  }

  put(f: Furniture): void {
    this.waiting.delete(f.id);
    this.scene = { ...this.scene, furniture: [...this.scene.furniture.filter((o) => o.id !== f.id), f] };
  }

  get northDeg(): number {
    return this.original.northDeg;
  }

  get(id: string): Furniture | undefined {
    return this.scene.furniture.find((f) => f.id === id);
  }

  /** Spots along a wall, starting from `first` and working outwards. */
  *alongWall(f: Furniture, wall: Wall, first: number): Iterable<Furniture> {
    const half = f.size[0] / 2;
    const low = half + GAP;
    const high = wall.length - half - GAP;
    if (high < low) return;
    const start = Math.max(low, Math.min(high, first));
    yield against(f, wall, start);
    for (let step = 0.1; step < wall.length; step += 0.1) {
      if (start - step >= low) yield against(f, wall, start - step);
      if (start + step <= high) yield against(f, wall, start + step);
    }
  }

  /** The corners of the room, as spots for a plant or a lamp. */
  *corners(f: Furniture): Iterable<Furniture> {
    for (const wall of this.walls) {
      yield against(f, wall, f.size[0] / 2 + 0.1, 0.1);
      yield against(f, wall, wall.length - f.size[0] / 2 - 0.1, 0.1);
    }
  }

  /** Whatever was not placed goes back where it was, if that spot is still free. False if one cannot. */
  finish(): boolean {
    for (const f of [...this.waiting.values()]) {
      if (!this.fits(f) && !isRug(f)) return false;
      this.put(f);
    }
    // Keep the pieces in the order of the file, so nothing else about the scene changes.
    const placed = new Map(this.scene.furniture.map((f) => [f.id, f]));
    this.scene = { ...this.original, furniture: this.original.furniture.map((f) => placed.get(f.id) ?? f) };
    return true;
  }

  /** The wall across the room from `wall`. */
  opposite(wall: Wall): Wall | undefined {
    return [...this.walls]
      .filter((w) => w.n.x * wall.n.x + w.n.y * wall.n.y < -0.9)
      .sort((p, q) => q.length - p.length)[0];
  }
}

/** How far along `wall` the point `p` lies. */
const alongOf = (wall: Wall, p: Point | readonly [number, number]): number => (p[0] - wall.a.x) * wall.t.x + (p[1] - wall.a.y) * wall.t.y;

/** A spot `out` metres in front of piece `of`, on the side it faces, for piece `f` turned by `turn` more. */
function inFront(f: Furniture, of: Furniture, wall: Wall, out: number, turn = 0, shift = 0): Furniture {
  const reach = of.size[2] / 2 + out + (turn % 180 === 0 ? f.size[2] : f.size[0]) / 2;
  return {
    ...f,
    position: [mm(of.position[0] + wall.n.x * reach + wall.t.x * shift), mm(of.position[1] + wall.n.y * reach + wall.t.y * shift)],
    rotationDeg: (of.rotationDeg + turn) % 360,
  };
}

/** What the wall is like, in the owner's words, for naming a layout. */
function describe(wall: Wall, arranger: Arranger): { where: string; why: string } {
  const across = arranger.opposite(wall);
  if (wall.windows.length) return { where: 'under the window', why: 'Light comes from behind, and the other walls stay free.' };
  if (across?.doors.length) return { where: 'facing the door', why: 'You see who comes in, and the door is not behind you.' };
  if (across?.windows.length) return { where: 'facing the window', why: 'It looks out, with a solid wall behind.' };
  // A plain wall is told apart by the side of the home it is on.
  const bearing = (Math.atan2(-wall.n.x, wall.n.y) * 180) / Math.PI - arranger.northDeg;
  const side = ['north', 'east', 'south', 'west'][((Math.round(bearing / 90) % 4) + 4) % 4];
  return { where: `on the ${side} wall`, why: 'A solid wall behind, and the middle of the room left open.' };
}

function score(wall: Wall, width: number, arranger: Arranger, kind: 'bed' | 'sofa'): number {
  if (wall.length < width + 2 * GAP) return -Infinity;
  let points = Math.min(wall.length, 6) * 0.1;
  if (!wall.doors.length) points += 3;
  if (!wall.windows.length) points += kind === 'bed' ? 2 : 0.5;
  if (arranger.opposite(wall)?.doors.length) points += kind === 'bed' ? 1.5 : 0.5;
  return points;
}

/**
 * Up to three other layouts for a room, best first. Empty when the room has
 * no bed, sofa or dining table to build a layout round, or no other way fits.
 */
export function layoutsFor(scene: Scene, roomId: string): Layout[] {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room || room.kind === 'void') return [];
  const mine = scene.furniture.filter((f) => f.room === roomId && !f.removed && !f.fixed && f.mount !== 'wall' && !(f.elevation && f.elevation > 0));
  const largest = (test: RegExp): Furniture | undefined =>
    mine.filter((f) => test.test(f.model)).sort((p, q) => q.size[0] * q.size[2] - p.size[0] * p.size[2])[0];
  const bed = mine.filter((f) => BED.test(f.model) && !NOT_BED.test(f.model)).sort((p, q) => q.size[0] * q.size[2] - p.size[0] * p.size[2])[0];
  const sofa = largest(SOFA);
  const table = largest(TABLE);
  const all = (test: RegExp): Furniture[] => mine.filter((f) => test.test(f.model));

  const walls = wallsOf(scene, room);
  /** The walls a piece `width` wide can back onto, the most suitable first. */
  const ranked = (width: number, kind: 'bed' | 'sofa'): Wall[] => {
    const probe = new Arranger(scene, room, walls, []);
    return walls
      .map((wall) => ({ wall, points: score(wall, width, probe, kind) }))
      .filter((w) => w.points > -Infinity)
      .sort((p, q) => q.points - p.points)
      .map((w) => w.wall);
  };

  const found: Layout[] = [];
  const keep = (name: string, why: string, arranger: Arranger, anchor: Furniture): void => {
    if (!arranger.finish()) return;
    const moved = arranger.scene.furniture.find((f) => f.id === anchor.id)!;
    const same = (a: Furniture, b: Furniture): boolean =>
      Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) < 0.3 && a.rotationDeg === b.rotationDeg;
    if (same(moved, anchor)) return;
    if (found.some((l) => same(l.scene.furniture.find((f) => f.id === anchor.id)!, moved))) return;
    found.push({ name, why, scene: arranger.scene });
  };

  if (bed) {
    const movable = [bed, ...all(SIDE), ...all(BENCH), ...all(STORAGE), ...all(TV), ...all(CORNER), ...mine.filter(isRug)];
    for (const wall of ranked(bed.size[0], 'bed')) {
      const arranger = new Arranger(scene, room, walls, movable);
      const tables = all(SIDE);
      const besideBed = (table: Furniture, at: number, side: number): Furniture =>
        against(table, wall, at + side * (bed.size[0] / 2 + 0.05 + table.size[0] / 2));
      /** Stands the bedside tables at the two sides of the bed; says how many found a place. */
      const flank = (on: Arranger): number => {
        const at = alongOf(wall, on.get(bed.id)!.position);
        return tables.filter((table, i) => on.place(table.id, [besideBed(table, at, i % 2 ? 1 : -1), besideBed(table, at, i % 2 ? -1 : 1)])).length;
      };
      // The bed goes as near the middle of the wall as leaves room for its tables.
      let best: { spot: Furniture; tables: number } | null = null;
      for (const spot of arranger.alongWall(bed, wall, wall.length / 2)) {
        if (!arranger.fits(spot)) continue;
        const trial = new Arranger(scene, room, walls, movable);
        trial.put(spot);
        const stood = flank(trial);
        if (!best || stood > best.tables) best = { spot, tables: stood };
        if (stood === tables.length) break;
      }
      // A bed with its tables left behind on another wall is not a layout worth showing.
      if (!best || (tables.length > 0 && best.tables === 0)) continue;
      arranger.put(best.spot);
      flank(arranger);
      const placedBed = arranger.get(bed.id)!;
      for (const bench of all(BENCH)) arranger.place(bench.id, [inFront(bench, placedBed, wall, 0.25)]);
      for (const rug of mine.filter(isRug)) {
        // A rug lies under the foot of the bed, showing on three sides.
        const reach = placedBed.size[2] * 0.3;
        arranger.place(rug.id, [
          { ...rug, position: [mm(placedBed.position[0] + wall.n.x * reach), mm(placedBed.position[1] + wall.n.y * reach)], rotationDeg: placedBed.rotationDeg },
          rug,
        ]);
      }
      const across = arranger.opposite(wall);
      for (const tv of all(TV)) if (across) arranger.place(tv.id, arranger.alongWall(tv, across, alongOf(across, placedBed.position)));
      for (const piece of all(STORAGE)) {
        // Tall storage goes to a corner of another wall, the longest first.
        const others = arranger.walls.filter((w) => w !== wall).sort((p, q) => q.length - p.length);
        arranger.place(piece.id, (function* () {
          for (const w of others) {
            yield against(piece, w, piece.size[0] / 2 + GAP);
            yield against(piece, w, w.length - piece.size[0] / 2 - GAP);
          }
          for (const w of others) yield* arranger.alongWall(piece, w, w.length / 2);
        })());
      }
      for (const piece of all(CORNER)) arranger.place(piece.id, arranger.corners(piece));
      const words = describe(wall, arranger);
      keep(`Bed ${words.where}`, words.why, arranger, bed);
      if (found.length === 3) break;
    }
    return found;
  }

  if (sofa) {
    const set = [sofa, ...all(COFFEE), ...all(ARMCHAIR), ...all(TV), ...all(CORNER), ...all(STORAGE), ...mine.filter(isRug)];
    for (const wall of ranked(sofa.size[0], 'sofa')) {
      const arranger = new Arranger(scene, room, walls, set);
      const across = arranger.opposite(wall);
      const tv = all(TV)[0];
      let done = false;
      // The sofa and the television go down as a pair: try each spot for the sofa until the screen fits opposite.
      for (const spot of arranger.alongWall(sofa, wall, wall.length / 2)) {
        if (!arranger.fits(spot)) continue;
        if (!tv || !across) {
          arranger.put(spot);
          done = true;
          break;
        }
        const trial = new Arranger(scene, room, walls, set);
        trial.put(spot);
        if (trial.place(tv.id, trial.alongWall(tv, across, alongOf(across, spot.position)))) {
          arranger.put(spot);
          arranger.put(trial.get(tv.id)!);
          done = true;
          break;
        }
      }
      if (!done) continue;
      const placed = arranger.get(sofa.id)!;
      const coffee = all(COFFEE)[0];
      if (coffee) {
        const turn = coffee.size[0] >= coffee.size[2] ? 0 : 90;
        arranger.place(coffee.id, [inFront(coffee, placed, wall, 0.45, turn), inFront(coffee, placed, wall, 0.35, turn)]);
      }
      const middle = (coffee && arranger.get(coffee.id)) || inFront({ ...placed, size: [0.1, 0.1, 0.1] }, placed, wall, 0.8);
      for (const rug of mine.filter(isRug)) {
        const turn = (rug.size[0] >= rug.size[2]) === (Math.abs(wall.t.x) > 0.5) ? 0 : 90;
        arranger.place(rug.id, [{ ...rug, position: [middle.position[0], middle.position[1]], rotationDeg: turn }, rug]);
      }
      all(ARMCHAIR).forEach((chair, i) => {
        // An armchair sits at the end of the coffee table, turned to face it.
        const beside = (side: number): Furniture => {
          const reach = (coffee ? coffee.size[0] : 1) / 2 + 0.45 + chair.size[2] / 2;
          return {
            ...chair,
            position: [mm(middle.position[0] + wall.t.x * side * reach), mm(middle.position[1] + wall.t.y * side * reach)],
            rotationDeg: facing({ x: -wall.t.x * side, y: -wall.t.y * side }),
          };
        };
        arranger.place(chair.id, [beside(i % 2 ? -1 : 1), beside(i % 2 ? 1 : -1), ...arranger.corners(chair)]);
      });
      const at = alongOf(wall, placed.position);
      for (const piece of all(CORNER)) {
        const end = (side: number): Furniture => against(piece, wall, at + side * (placed.size[0] / 2 + 0.1 + piece.size[0] / 2), 0.1);
        arranger.place(piece.id, /lamp/.test(piece.model) ? [end(1), end(-1), ...arranger.corners(piece)] : arranger.corners(piece));
      }
      for (const piece of all(STORAGE)) {
        const others = arranger.walls.filter((w) => w !== wall).sort((p, q) => q.length - p.length);
        arranger.place(piece.id, (function* () {
          for (const w of others) yield* arranger.alongWall(piece, w, w.length / 2);
        })());
      }
      const words = describe(wall, arranger);
      keep(`Sofa ${words.where}`, tv ? `${words.why} The screen is straight across from it.` : words.why, arranger, sofa);
      if (found.length === 3) break;
    }
    return found;
  }

  if (table) {
    const chairs = all(CHAIR);
    const xs = room.polygon.map((p) => p[0]);
    const ys = room.polygon.map((p) => p[1]);
    const mid: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const roomWide = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    for (const [turn, name, why] of [
      [roomWide ? 0 : 90, 'Table along the room', 'The long side of the table follows the long side of the room, which leaves the widest way round it.'],
      [roomWide ? 90 : 0, 'Table across the room', 'Turned a quarter, for a room that is used from both ends.'],
    ] as const) {
      const arranger = new Arranger(scene, room, walls, [table, ...chairs]);
      const spot: Furniture = { ...table, position: [mm(mid[0]), mm(mid[1])], rotationDeg: turn };
      if (!arranger.fits(spot)) continue;
      arranger.put(spot);
      // Chairs go down the two long sides, evenly, pushed in a little.
      const along: Vec2 = turn === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const out: Vec2 = { x: -along.y, y: along.x };
      const perSide = Math.ceil(chairs.length / 2);
      let ok = true;
      chairs.forEach((chair, i) => {
        const side = i < perSide ? 1 : -1;
        const n = i < perSide ? perSide : chairs.length - perSide;
        const k = i < perSide ? i : i - perSide;
        const shift = ((k + 0.5) / n - 0.5) * table.size[0];
        const reach = table.size[2] / 2 + chair.size[2] / 2 - 0.08;
        const placed: Furniture = {
          ...chair,
          position: [mm(mid[0] + along.x * shift + out.x * side * reach), mm(mid[1] + along.y * shift + out.y * side * reach)],
          rotationDeg: facing({ x: -out.x * side, y: -out.y * side }),
        };
        if (arranger.fits(placed)) arranger.put(placed);
        else ok = false;
      });
      if (ok) keep(name, why, arranger, table);
    }
  }
  return found;
}

/** True when the room has a piece a layout can be built round. */
export function canArrange(scene: Scene, roomId: string): boolean {
  return scene.furniture.some(
    (f) => f.room === roomId && !f.removed && !f.fixed && f.mount !== 'wall' && ((BED.test(f.model) && !NOT_BED.test(f.model)) || SOFA.test(f.model) || TABLE.test(f.model)),
  );
}

/** The doors and windows of a room as lines on the plan, for drawing it small. */
export function roomOpenings(scene: Scene, roomId: string): { type: 'door' | 'window'; a: Point; b: Point }[] {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  return wallsOf(scene, room).flatMap((wall) =>
    [...wall.doors.map((d) => ({ ...d, type: 'door' as const })), ...wall.windows.map((w) => ({ ...w, type: 'window' as const }))].map((span) => ({
      type: span.type,
      a: [wall.a.x + wall.t.x * span.from, wall.a.y + wall.t.y * span.from] as Point,
      b: [wall.a.x + wall.t.x * span.to, wall.a.y + wall.t.y * span.to] as Point,
    })),
  );
}

/** `current` with the pieces of one room standing where they do in `source`. */
export function withRoomFrom(current: Scene, source: Scene, roomId: string): Scene {
  const there = new Map(source.furniture.map((f) => [f.id, f]));
  return {
    ...current,
    furniture: current.furniture.map((f) => {
      const other = there.get(f.id);
      return other && (f.room === roomId || other.room === roomId) && !f.removed ? { ...f, position: other.position, rotationDeg: other.rotationDeg, room: other.room } : f;
    }),
  };
}

/** The piece a layout of this room is built round. */
export function anchorOf(scene: Scene, roomId: string): Furniture | undefined {
  const mine = scene.furniture.filter((f) => f.room === roomId && !f.removed && !f.fixed && f.mount !== 'wall');
  const largest = (test: (f: Furniture) => boolean): Furniture | undefined =>
    mine.filter(test).sort((p, q) => q.size[0] * q.size[2] - p.size[0] * p.size[2])[0];
  return largest((f) => BED.test(f.model) && !NOT_BED.test(f.model)) ?? largest((f) => SOFA.test(f.model)) ?? largest((f) => TABLE.test(f.model));
}
