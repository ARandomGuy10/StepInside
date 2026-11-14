/**
 * The scene file format (/scenes/<home>.json) and its validation.
 *
 * All lengths are metres. Positions are in plan space: [x, y] as read off
 * the floor plan, with x to the right and y down the page. Heights are
 * always separate fields. Nothing here depends on Three.js.
 */
import type { Vec2 } from './collision';
import { length, polygonSelfIntersects, polygonsOverlap, signedArea, sub } from './geometry';

export type Point = [number, number];

export interface Sun {
  /** Compass bearing the sunlight comes from: 0 north, 90 east, 180 south, 270 west. */
  azimuthDeg: number;
  /** Height of the sun above the horizon. */
  elevationDeg: number;
  intensity: number;
  color: string;
}

export interface Defaults {
  ceilingHeight: number;
  /** Thickness of a wall that has no room on its other side. */
  exteriorWallThickness: number;
  railingHeight: number;
  wallColor: string;
  /** Colour of the outside of the outside walls. Without it they show the room's wall colour. */
  exteriorColor?: string;
  /** `stone` draws the outside walls as stone cladding; `render` (the default) as smooth plaster. */
  exteriorMaterial?: 'stone' | 'render' | 'wood';
  /**
   * How far the roof of the top storey climbs from the front of the home
   * to the back, in metres (a single sloping roof). Without it the roof is flat.
   */
  roofRise?: number;
  /** Colour of the bands at each floor and of the roof edge. White when not given. */
  trimColor?: string;
  /** Colour of stone cladding on walls marked `outside: "stone"`. Defaults to `exteriorColor`. */
  stoneColor?: string;
  /** Colour of timber cladding on walls marked `outside: "wood"`. A warm teak when not given. */
  woodColor?: string;
  /** `render` draws the plot's boundary walls as smooth concrete instead of stone. */
  boundaryMaterial?: 'stone' | 'render';
  /** Colour of window frames. White when not given. */
  frameColor?: string;
  /** Colour of the front door. */
  doorColor?: string;
  /** Colour of the handrails on glass railings. Brushed steel when not given. */
  railColor?: string;
  floorColor: string;
  ceilingColor: string;
}

export interface WallOverride {
  /** Index of the polygon edge: edge i runs from point i to point i + 1. */
  edge: number;
  color?: string;
  height?: number;
  /**
   * The outside finish of this wall, when it differs from
   * `defaults.exteriorMaterial`: stone cladding, render, or render behind
   * a screen of vertical aluminium fins.
   */
  outside?: 'stone' | 'render' | 'fins' | 'wood';
  /** The inside finish of this wall, from WALL_MATERIALS. Plain paint when not set. */
  material?: string;
}

/** Inside finishes a wall can have. Plain paint is the default. */
export const WALL_MATERIALS = ['stone', 'wood', 'tile'] as const;
/** Finishes a floor can have. Without one the floor is a plain, smooth surface. */
export const FLOOR_MATERIALS = ['laminate', 'large-tile', 'tile', 'stone', 'concrete', 'decking', 'lawn', 'setts'] as const;

export interface Room {
  id: string;
  name: string;
  /**
   * A balcony has no ceiling and gets railings instead of walls. A void is
   * a hole in the floor, such as a stairwell or a double-height space: it
   * has a ceiling but no floor, and the rooms round it get a guard rail.
   */
  kind?: 'room' | 'balcony' | 'void';
  /** The inside outline of the floor, corner by corner. */
  polygon: Point[];
  ceilingHeight?: number;
  floor?: { material?: string; color: string };
  ceiling?: { color: string };
  walls?: WallOverride[];
}

export interface Opening {
  id: string;
  type: 'door' | 'window';
  room: string;
  edge: number;
  /** Distance from the edge's first point to the near side of the opening. */
  offset: number;
  width: number;
  height: number;
  /** Height of the bottom of the opening above the floor. Doors default to 0. */
  sill?: number;
}

/** Solid building mass that is not a room: piers, shafts, closed cupboards. */
export interface Solid {
  id: string;
  polygon: Point[];
  height?: number;
  color?: string;
}

export interface Furniture {
  id: string;
  /** Shown in the furniture panel. Falls back to the id. */
  name?: string;
  /** Looks for /public/models/<model>.glb. A box is drawn if there is none. */
  model: string;
  room: string;
  position: Point;
  /** Turn about the vertical axis, clockwise as seen on the plan. */
  rotationDeg: number;
  /** Width, height, depth. Used for the placeholder box and for scaling. */
  size: [number, number, number];
  color?: string | null;
  removed?: boolean;
  /** Part of the building, such as a staircase: it can be painted but not moved or taken out. */
  fixed?: boolean;
  /** "wall" pieces, such as paintings, hang on a wall instead of standing on the floor. */
  mount?: 'floor' | 'wall';
  /** Height of the bottom of the piece above the floor. Defaults to 0. */
  elevation?: number;
}

/**
 * A curved concrete roof or shell: a smooth curve drawn across the plan
 * (x) and up (height above the storey's floor), carried along the plan's
 * y axis from `from` to `to`. Only the outside is drawn; it is not walked on.
 */
export interface Sweep {
  id: string;
  /** Points of the curve as [x, height], in metres, left to right. */
  profile: Point[];
  from: number;
  to: number;
  /** Thickness of the shell. */
  thickness: number;
  /** True fills the space under the curve down to the floor, as a solid hump. */
  solid?: boolean;
  color?: string;
  /** A rooflight set into the curve, between these fractions of its length (0 to 1). */
  glazing?: [number, number];
  /**
   * A wall of glass under the curve, standing at plan y = `y` between
   * x = `from` and `to`, from the floor up to the curve's underside.
   */
  curtain?: { y: number; from: number; to: number };
  /** True closes both ends of a hollow shell with a wall under the curve, so it can roof a room. */
  ends?: boolean;
}

/** A lamp: a point of light, drawn with a simple fitting. */
export interface Light {
  id: string;
  position: Point;
  /** Height of the light above the floor. */
  height: number;
  color: string;
  intensity: number;
  /** The fitting drawn for it. Defaults to "spot". */
  style?: 'pendant' | 'spot' | 'cloud';
}

export interface Scene {
  schemaVersion: 1;
  name: string;
  units: 'm';
  /** Where north points on the plan, in degrees clockwise from "up the page". */
  northDeg: number;
  sun: Sun;
  defaults: Defaults;
  start?: { position: Point; yawDeg: number };
  /** Open ground round the home, `margin` metres past the rooms on every side. */
  site?: { margin: number; color: string };
  rooms: Room[];
  openings: Opening[];
  solids?: Solid[];
  sweeps?: Sweep[];
  lights?: Light[];
  furniture: Furniture[];
}

export class SceneError extends Error {
  constructor(readonly issues: string[]) {
    super(`Scene file is not valid:\n- ${issues.join('\n- ')}`);
    this.name = 'SceneError';
  }
}

export const toVec = (p: Point): Vec2 => ({ x: p[0], y: p[1] });

export function roomHeight(scene: Scene, room: Room): number {
  if (room.kind === 'balcony') return scene.defaults.railingHeight;
  return room.ceilingHeight ?? scene.defaults.ceilingHeight;
}

export function wallHeight(scene: Scene, room: Room, edge: number): number {
  return room.walls?.find((w) => w.edge === edge)?.height ?? roomHeight(scene, room);
}

export function wallColor(scene: Scene, room: Room, edge: number): string {
  return room.walls?.find((w) => w.edge === edge)?.color ?? scene.defaults.wallColor;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Dict = Record<string, unknown>;

class Checker {
  readonly issues: string[] = [];

  fail(path: string, message: string): void {
    this.issues.push(`${path}: ${message}`);
  }

  object(value: unknown, path: string, allowed: readonly string[]): Dict | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'must be an object');
      return null;
    }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.fail(`${path}.${key}`, 'unknown field');
    }
    return value as Dict;
  }

  array(value: unknown, path: string): unknown[] | null {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array');
      return null;
    }
    return value;
  }

  number(value: unknown, path: string, min = -Infinity, max = Infinity): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(path, 'must be a number');
      return false;
    }
    if (value < min || value > max) {
      this.fail(path, `must be between ${min} and ${max}, got ${value}`);
      return false;
    }
    return true;
  }

  positive(value: unknown, path: string): value is number {
    if (!this.number(value, path)) return false;
    if (value <= 0) {
      this.fail(path, `must be greater than 0, got ${value}`);
      return false;
    }
    return true;
  }

  string(value: unknown, path: string): value is string {
    if (typeof value !== 'string' || value.length === 0) {
      this.fail(path, 'must be a non-empty string');
      return false;
    }
    return true;
  }

  color(value: unknown, path: string): value is string {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      this.fail(path, 'must be a colour like "#a1b2c3"');
      return false;
    }
    return true;
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): value is T {
    if (!options.includes(value as T)) {
      this.fail(path, `must be one of ${options.map((o) => `"${o}"`).join(', ')}`);
      return false;
    }
    return true;
  }

  point(value: unknown, path: string): value is Point {
    if (!Array.isArray(value) || value.length !== 2) {
      this.fail(path, 'must be a point [x, y]');
      return false;
    }
    return this.number(value[0], `${path}[0]`) && this.number(value[1], `${path}[1]`);
  }

  polygon(value: unknown, path: string): Point[] | null {
    const list = this.array(value, path);
    if (!list) return null;
    if (list.length < 3) {
      this.fail(path, 'needs at least 3 points');
      return null;
    }
    if (!list.map((p, i) => this.point(p, `${path}[${i}]`)).every(Boolean)) return null;
    const points = (list as Point[]).map(toVec);
    for (let i = 0; i < points.length; i++) {
      if (length(sub(points[(i + 1) % points.length], points[i])) < 0.01) {
        this.fail(`${path}[${i}]`, 'is the same as the next point');
        return null;
      }
    }
    if (polygonSelfIntersects(points)) {
      this.fail(path, 'crosses over itself');
      return null;
    }
    if (Math.abs(signedArea(points)) < 1e-4) {
      this.fail(path, 'has no area');
      return null;
    }
    return list as Point[];
  }

  uniqueId(value: unknown, path: string, seen: Set<string>): void {
    if (!this.string(value, path)) return;
    if (seen.has(value)) this.fail(path, `duplicate id "${value}"`);
    seen.add(value);
  }
}

/** Checks untrusted JSON and returns it typed as a Scene, or throws a SceneError. */
export function parseScene(input: unknown): Scene {
  const c = new Checker();
  const root = c.object(input, 'scene', [
    'schemaVersion', 'name', 'units', 'northDeg', 'sun', 'defaults', 'start', 'site',
    'rooms', 'openings', 'solids', 'sweeps', 'lights', 'furniture',
  ]);
  if (!root) throw new SceneError(c.issues);

  if (root.schemaVersion !== 1) c.fail('scene.schemaVersion', 'must be 1');
  c.string(root.name, 'scene.name');
  if (root.units !== 'm') c.fail('scene.units', 'must be "m"');
  c.number(root.northDeg, 'scene.northDeg', -360, 360);

  const sun = c.object(root.sun, 'scene.sun', ['azimuthDeg', 'elevationDeg', 'intensity', 'color']);
  if (sun) {
    c.number(sun.azimuthDeg, 'scene.sun.azimuthDeg', -360, 360);
    c.number(sun.elevationDeg, 'scene.sun.elevationDeg', 1, 90);
    c.number(sun.intensity, 'scene.sun.intensity', 0, 100);
    c.color(sun.color, 'scene.sun.color');
  }

  const defaults = c.object(root.defaults, 'scene.defaults', [
    'ceilingHeight', 'exteriorWallThickness', 'railingHeight', 'wallColor', 'floorColor', 'ceilingColor', 'exteriorColor', 'exteriorMaterial', 'roofRise', 'trimColor', 'stoneColor', 'woodColor', 'boundaryMaterial', 'frameColor', 'doorColor', 'railColor',
  ]);
  if (defaults) {
    c.positive(defaults.ceilingHeight, 'scene.defaults.ceilingHeight');
    c.positive(defaults.exteriorWallThickness, 'scene.defaults.exteriorWallThickness');
    c.positive(defaults.railingHeight, 'scene.defaults.railingHeight');
    c.color(defaults.wallColor, 'scene.defaults.wallColor');
    c.color(defaults.floorColor, 'scene.defaults.floorColor');
    c.color(defaults.ceilingColor, 'scene.defaults.ceilingColor');
    if (defaults.roofRise !== undefined) c.positive(defaults.roofRise, 'scene.defaults.roofRise');
    if (defaults.trimColor !== undefined) c.color(defaults.trimColor, 'scene.defaults.trimColor');
    if (defaults.stoneColor !== undefined) c.color(defaults.stoneColor, 'scene.defaults.stoneColor');
    if (defaults.exteriorColor !== undefined) c.color(defaults.exteriorColor, 'scene.defaults.exteriorColor');
    if (defaults.woodColor !== undefined) c.color(defaults.woodColor, 'scene.defaults.woodColor');
    for (const key of ['frameColor', 'doorColor', 'railColor'] as const) {
      if (defaults[key] !== undefined) c.color(defaults[key], `scene.defaults.${key}`);
    }
    if (defaults.exteriorMaterial !== undefined && !['stone', 'render', 'wood'].includes(defaults.exteriorMaterial as string)) {
      c.fail('scene.defaults.exteriorMaterial', 'must be "stone", "render" or "wood"');
    }
    if (defaults.boundaryMaterial !== undefined && !['stone', 'render'].includes(defaults.boundaryMaterial as string)) {
      c.fail('scene.defaults.boundaryMaterial', 'must be "stone" or "render"');
    }
  }
  const defaultHeight =
    defaults && typeof defaults.ceilingHeight === 'number' ? defaults.ceilingHeight : NaN;

  if (root.start !== undefined) {
    const start = c.object(root.start, 'scene.start', ['position', 'yawDeg']);
    if (start) {
      c.point(start.position, 'scene.start.position');
      c.number(start.yawDeg, 'scene.start.yawDeg');
    }
  }

  if (root.site !== undefined) {
    const site = c.object(root.site, 'scene.site', ['margin', 'color']);
    if (site) {
      c.number(site.margin, 'scene.site.margin', 0, 100);
      c.color(site.color, 'scene.site.color');
    }
  }

  // Rooms
  const ids = new Set<string>();
  const shapes: { path: string; points: Vec2[] }[] = [];
  const roomInfo = new Map<string, { edges: number[]; height: number }>();
  const rooms = c.array(root.rooms, 'scene.rooms') ?? [];
  if (rooms.length === 0) c.fail('scene.rooms', 'needs at least one room');
  rooms.forEach((value, i) => {
    const path = `scene.rooms[${i}]`;
    const room = c.object(value, path, [
      'id', 'name', 'kind', 'polygon', 'ceilingHeight', 'floor', 'ceiling', 'walls',
    ]);
    if (!room) return;
    c.uniqueId(room.id, `${path}.id`, ids);
    c.string(room.name, `${path}.name`);
    if (room.kind !== undefined) c.oneOf(room.kind, `${path}.kind`, ['room', 'balcony', 'void'] as const);
    if (room.ceilingHeight !== undefined) c.positive(room.ceilingHeight, `${path}.ceilingHeight`);
    if (room.floor !== undefined) {
      const floor = c.object(room.floor, `${path}.floor`, ['material', 'color']);
      if (floor) {
        if (floor.material !== undefined) c.string(floor.material, `${path}.floor.material`);
        c.color(floor.color, `${path}.floor.color`);
      }
    }
    if (room.ceiling !== undefined) {
      const ceiling = c.object(room.ceiling, `${path}.ceiling`, ['color']);
      if (ceiling) c.color(ceiling.color, `${path}.ceiling.color`);
    }
    const polygon = c.polygon(room.polygon, `${path}.polygon`);
    if (!polygon) return;
    const points = polygon.map(toVec);
    shapes.push({ path, points });
    const height =
      room.kind === 'balcony'
        ? Infinity
        : typeof room.ceilingHeight === 'number'
          ? room.ceilingHeight
          : defaultHeight;
    if (typeof room.id === 'string') {
      roomInfo.set(room.id, {
        edges: points.map((p, k) => length(sub(points[(k + 1) % points.length], p))),
        height,
      });
    }
    if (room.walls !== undefined) {
      const seenEdges = new Set<number>();
      (c.array(room.walls, `${path}.walls`) ?? []).forEach((w, k) => {
        const wp = `${path}.walls[${k}]`;
        const wall = c.object(w, wp, ['edge', 'color', 'height', 'outside', 'material']);
        if (!wall) return;
        if (!Number.isInteger(wall.edge) || (wall.edge as number) < 0 || (wall.edge as number) >= polygon.length) {
          c.fail(`${wp}.edge`, `must be an edge index from 0 to ${polygon.length - 1}`);
        } else if (seenEdges.has(wall.edge as number)) {
          c.fail(`${wp}.edge`, `edge ${wall.edge} is listed twice`);
        } else {
          seenEdges.add(wall.edge as number);
        }
        if (wall.color !== undefined) c.color(wall.color, `${wp}.color`);
        if (wall.height !== undefined) c.positive(wall.height, `${wp}.height`);
        if (wall.outside !== undefined && !['stone', 'render', 'fins', 'wood'].includes(wall.outside as string)) {
          c.fail(`${wp}.outside`, 'must be "stone", "render", "fins" or "wood"');
        }
        if (wall.material !== undefined && !(WALL_MATERIALS as readonly string[]).includes(wall.material as string)) {
          c.fail(`${wp}.material`, `must be one of ${WALL_MATERIALS.join(', ')}`);
        }
      });
    }
  });

  // Solids
  if (root.solids !== undefined) {
    (c.array(root.solids, 'scene.solids') ?? []).forEach((value, i) => {
      const path = `scene.solids[${i}]`;
      const solid = c.object(value, path, ['id', 'polygon', 'height', 'color']);
      if (!solid) return;
      c.uniqueId(solid.id, `${path}.id`, ids);
      if (solid.height !== undefined) c.positive(solid.height, `${path}.height`);
      if (solid.color !== undefined) c.color(solid.color, `${path}.color`);
      const polygon = c.polygon(solid.polygon, `${path}.polygon`);
      if (polygon) shapes.push({ path, points: polygon.map(toVec) });
    });
  }

  // Sweeps: curved roofs. They are drawn only, so they may sit over rooms.
  if (root.sweeps !== undefined) {
    (c.array(root.sweeps, 'scene.sweeps') ?? []).forEach((value, i) => {
      const path = `scene.sweeps[${i}]`;
      const sweep = c.object(value, path, ['id', 'profile', 'from', 'to', 'thickness', 'solid', 'color', 'glazing', 'curtain', 'ends']);
      if (!sweep) return;
      c.uniqueId(sweep.id, `${path}.id`, ids);
      const profile = c.array(sweep.profile, `${path}.profile`) ?? [];
      if (profile.length < 2) c.fail(`${path}.profile`, 'needs at least two points');
      profile.forEach((p, k) => c.point(p, `${path}.profile[${k}]`));
      c.number(sweep.from, `${path}.from`);
      c.number(sweep.to, `${path}.to`);
      if (typeof sweep.from === 'number' && typeof sweep.to === 'number' && sweep.to <= sweep.from) c.fail(`${path}.to`, 'must be more than from');
      c.positive(sweep.thickness, `${path}.thickness`);
      if (sweep.solid !== undefined && typeof sweep.solid !== 'boolean') c.fail(`${path}.solid`, 'must be true or false');
      if (sweep.ends !== undefined && typeof sweep.ends !== 'boolean') c.fail(`${path}.ends`, 'must be true or false');
      if (sweep.color !== undefined) c.color(sweep.color, `${path}.color`);
      if (sweep.curtain !== undefined) {
        const curtain = c.object(sweep.curtain, `${path}.curtain`, ['y', 'from', 'to']);
        if (curtain) {
          c.number(curtain.y, `${path}.curtain.y`);
          c.number(curtain.from, `${path}.curtain.from`);
          c.number(curtain.to, `${path}.curtain.to`);
        }
      }
      if (sweep.glazing !== undefined) {
        const g = sweep.glazing;
        if (!Array.isArray(g) || g.length !== 2 || !g.every((x) => typeof x === 'number' && x >= 0 && x <= 1) || g[0] >= g[1]) {
          c.fail(`${path}.glazing`, 'must be [start, end] with 0 <= start < end <= 1');
        }
      }
    });
  }

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (polygonsOverlap(shapes[i].points, shapes[j].points)) {
        c.fail(shapes[j].path, `overlaps ${shapes[i].path}`);
      }
    }
  }

  // Openings
  const spans = new Map<string, { id: string; from: number; to: number }[]>();
  (c.array(root.openings, 'scene.openings') ?? []).forEach((value, i) => {
    const path = `scene.openings[${i}]`;
    const o = c.object(value, path, ['id', 'type', 'room', 'edge', 'offset', 'width', 'height', 'sill']);
    if (!o) return;
    c.uniqueId(o.id, `${path}.id`, ids);
    const typeOk = c.oneOf(o.type, `${path}.type`, ['door', 'window'] as const);
    const numbersOk = [
      c.number(o.offset, `${path}.offset`, 0),
      c.positive(o.width, `${path}.width`),
      c.positive(o.height, `${path}.height`),
      o.sill === undefined ? true : c.number(o.sill, `${path}.sill`, 0),
    ].every(Boolean);
    if (typeOk && o.type === 'window' && o.sill === undefined) {
      c.fail(`${path}.sill`, 'is required for a window');
    }
    if (!c.string(o.room, `${path}.room`)) return;
    const info = roomInfo.get(o.room);
    if (!info) {
      c.fail(`${path}.room`, `no room with id "${o.room}"`);
      return;
    }
    if (!Number.isInteger(o.edge) || (o.edge as number) < 0 || (o.edge as number) >= info.edges.length) {
      c.fail(`${path}.edge`, `must be an edge index from 0 to ${info.edges.length - 1}`);
      return;
    }
    if (!numbersOk) return;
    const edgeLength = info.edges[o.edge as number];
    const from = o.offset as number;
    const to = from + (o.width as number);
    // A small margin keeps the opening clear of the wall's corners.
    if (from < 0.01 || to > edgeLength - 0.01) {
      c.fail(path, `does not fit on its wall: it spans ${from} to ${round(to)} m on a wall ${round(edgeLength)} m long`);
    }
    const top = ((o.sill as number | undefined) ?? 0) + (o.height as number);
    if (top > info.height - 0.05) {
      c.fail(path, `is too tall: its top is at ${round(top)} m but the wall is ${info.height} m high`);
    }
    const key = `${o.room}#${o.edge}`;
    const others = spans.get(key) ?? [];
    for (const other of others) {
      if (from < other.to && other.from < to) c.fail(path, `overlaps opening "${other.id}" on the same wall`);
    }
    others.push({ id: String(o.id), from, to });
    spans.set(key, others);
  });

  // Lights
  if (root.lights !== undefined) {
    (c.array(root.lights, 'scene.lights') ?? []).forEach((value, i) => {
      const path = `scene.lights[${i}]`;
      const light = c.object(value, path, ['id', 'position', 'height', 'color', 'intensity', 'style']);
      if (!light) return;
      c.uniqueId(light.id, `${path}.id`, ids);
      c.point(light.position, `${path}.position`);
      c.positive(light.height, `${path}.height`);
      c.color(light.color, `${path}.color`);
      c.number(light.intensity, `${path}.intensity`, 0, 1000);
      if (light.style !== undefined) {
        c.oneOf(light.style, `${path}.style`, ['pendant', 'spot', 'cloud'] as const);
      }
    });
  }

  // Furniture
  (c.array(root.furniture, 'scene.furniture') ?? []).forEach((value, i) => {
    const path = `scene.furniture[${i}]`;
    const f = c.object(value, path, [
      'id', 'name', 'model', 'room', 'position', 'rotationDeg', 'size', 'color', 'removed', 'mount', 'elevation', 'fixed',
    ]);
    if (!f) return;
    c.uniqueId(f.id, `${path}.id`, ids);
    if (f.name !== undefined) c.string(f.name, `${path}.name`);
    c.string(f.model, `${path}.model`);
    if (c.string(f.room, `${path}.room`) && !roomInfo.has(f.room)) {
      c.fail(`${path}.room`, `no room with id "${f.room}"`);
    }
    c.point(f.position, `${path}.position`);
    c.number(f.rotationDeg, `${path}.rotationDeg`);
    if (!Array.isArray(f.size) || f.size.length !== 3) {
      c.fail(`${path}.size`, 'must be [width, height, depth]');
    } else {
      f.size.forEach((v, k) => c.positive(v, `${path}.size[${k}]`));
    }
    if (f.color !== undefined && f.color !== null) c.color(f.color, `${path}.color`);
    if (f.mount !== undefined) c.oneOf(f.mount, `${path}.mount`, ['floor', 'wall'] as const);
    if (f.elevation !== undefined) c.number(f.elevation, `${path}.elevation`, 0, 10);
    if (f.fixed !== undefined && typeof f.fixed !== 'boolean') c.fail(`${path}.fixed`, 'must be true or false');
    if (f.removed !== undefined && typeof f.removed !== 'boolean') {
      c.fail(`${path}.removed`, 'must be true or false');
    }
  });

  if (c.issues.length > 0) throw new SceneError(c.issues);
  return input as Scene;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
