/**
 * Furniture edits. Every function takes a scene and returns a new scene,
 * leaving the old one untouched. When an edit is not possible (the piece
 * would end up inside a wall, say) the same scene object is returned, so
 * callers can tell with `result === scene`.
 */
import type { Vec2 } from './collision';
import { pointInsideOrOn, segmentsCross } from './geometry';
import { toVec, type Furniture, type Point, type Room, type Scene } from './scene';

/** The four floor corners of a piece. rotationDeg turns clockwise on the plan. */
export function footprint(f: Pick<Furniture, 'position' | 'rotationDeg' | 'size'>): Vec2[] {
  const rad = (f.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = f.size[0] / 2;
  const halfD = f.size[2] / 2;
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([x, y]) => ({
    x: f.position[0] + x * cos - y * sin,
    y: f.position[1] + x * sin + y * cos,
  }));
}

export function roomAt(scene: Scene, p: Vec2): Room | undefined {
  return scene.rooms.find((room) => pointInsideOrOn(p, room.polygon.map(toVec)));
}

/** The room a piece fits in completely, or undefined if it sticks into a wall. */
export function roomThatFits(
  scene: Scene,
  f: Pick<Furniture, 'position' | 'rotationDeg' | 'size'>,
): Room | undefined {
  const corners = footprint(f);
  return scene.rooms.find((room) => {
    const outline = room.polygon.map(toVec);
    if (!pointInsideOrOn(toVec(f.position), outline)) return false;
    if (!corners.every((c) => pointInsideOrOn(c, outline))) return false;
    // In an L-shaped room all corners can be inside while a side still
    // cuts across a wall, so check the sides too.
    for (let i = 0; i < corners.length; i++) {
      for (let j = 0; j < outline.length; j++) {
        if (
          segmentsCross(corners[i], corners[(i + 1) % 4], outline[j], outline[(j + 1) % outline.length])
        ) {
          return false;
        }
      }
    }
    return true;
  });
}

function update(scene: Scene, id: string, change: (f: Furniture) => Furniture | null): Scene {
  const index = scene.furniture.findIndex((f) => f.id === id);
  if (index < 0) return scene;
  const next = change(scene.furniture[index]);
  if (next === null) return scene;
  const furniture = [...scene.furniture];
  furniture[index] = next;
  return { ...scene, furniture };
}

/**
 * Moves a piece towards `target`. If the full move is blocked it tries
 * moving along x only, then y only, so a dragged piece slides along a wall.
 */
export function moveFurniture(scene: Scene, id: string, target: Point): Scene {
  return update(scene, id, (f) => {
    const attempts: Point[] = [target, [target[0], f.position[1]], [f.position[0], target[1]]];
    for (const position of attempts) {
      if (position[0] === f.position[0] && position[1] === f.position[1]) continue;
      const room = roomThatFits(scene, { ...f, position });
      if (room) return { ...f, position, room: room.id };
    }
    return null;
  });
}

/**
 * Turns a piece by `deltaDeg` (clockwise on the plan). If the turned piece
 * would stick into a wall, it is nudged to the nearest spot within a metre
 * where it fits, so a sofa standing against a wall can still be turned.
 */
export function rotateFurniture(scene: Scene, id: string, deltaDeg: number): Scene {
  return update(scene, id, (f) => {
    const rotationDeg = (((f.rotationDeg + deltaDeg) % 360) + 360) % 360;
    const turned = { ...f, rotationDeg };
    if (roomThatFits(scene, turned)) return turned;
    for (let step = 1; step <= 20; step++) {
      for (let k = 0; k < 8; k++) {
        const angle = (k * Math.PI) / 4;
        const position: Point = [
          Math.round((f.position[0] + Math.cos(angle) * step * 0.05) * 1000) / 1000,
          Math.round((f.position[1] + Math.sin(angle) * step * 0.05) * 1000) / 1000,
        ];
        const room = roomThatFits(scene, { ...turned, position });
        if (room) return { ...turned, position, room: room.id };
      }
    }
    return null;
  });
}

/** Takes a piece out of the home. It keeps its last position for putting back. */
export function takeOut(scene: Scene, id: string): Scene {
  return update(scene, id, (f) => (f.removed ? null : { ...f, removed: true }));
}

/** Puts a taken-out piece back, at `position` if given, else where it last stood. */
export function putBack(scene: Scene, id: string, position?: Point): Scene {
  return update(scene, id, (f) => {
    if (!f.removed) return null;
    const placed = { ...f, position: position ?? f.position };
    const room = roomThatFits(scene, placed);
    return room ? { ...placed, room: room.id, removed: false } : null;
  });
}

/** Takes out every piece in one room. */
export function emptyRoom(scene: Scene, roomId: string): Scene {
  if (!scene.furniture.some((f) => f.room === roomId && !f.removed)) return scene;
  return {
    ...scene,
    furniture: scene.furniture.map((f) => (f.room === roomId && !f.removed ? { ...f, removed: true } : f)),
  };
}

/** Puts all furniture back the way it is in `original`. */
export function resetLayout(scene: Scene, original: Scene): Scene {
  if (scene.furniture === original.furniture) return scene;
  return { ...scene, furniture: original.furniture };
}
