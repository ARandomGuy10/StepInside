/**
 * Step 1 only: one hard-coded rectangular room.
 * Step 2 replaces this with rooms loaded from /scenes/<home>.json.
 *
 * Plan space: x runs to the right and y runs down the page, in metres,
 * with the origin at the room's top-left inside corner. The renderer
 * maps plan (x, y) to 3D (x, height, z).
 */
import type { Segment, Vec2 } from './collision';

export interface Opening {
  /** Distance from the start of the wall to the opening, in metres. */
  offset: number;
  width: number;
  height: number;
  /** Height of the bottom of the opening above the floor. 0 for a door. */
  sill: number;
}

export interface Wall {
  a: Vec2;
  b: Vec2;
  openings: Opening[];
}

export interface DemoRoom {
  width: number;
  depth: number;
  ceilingHeight: number;
  wallThickness: number;
  walls: Wall[];
}

export function createDemoRoom(): DemoRoom {
  // The size of the living room on the floor plan.
  const width = 3.49;
  const depth = 7.44;
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
  const walls: Wall[] = corners.map((a, i) => ({
    a,
    b: corners[(i + 1) % corners.length],
    openings: [],
  }));
  // A wide window in the wall at the top of the plan, so the sun gets in.
  walls[0].openings.push({ offset: 0.4, width: 2.4, height: 1.5, sill: 0.8 });
  return { width, depth, ceilingHeight: 2.62, wallThickness: 0.2, walls };
}

/** The wall lines the walker collides with. Windows still block walking. */
export function collisionSegments(room: DemoRoom): Segment[] {
  return room.walls.map((w) => ({ a: w.a, b: w.b }));
}
