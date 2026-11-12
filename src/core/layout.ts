/**
 * Saving and loading. A saved layout is a complete scene file, in the same
 * format as scenes/home.json, so a layout you like can replace that file.
 */
import { parseScene, SceneError, type Scene } from './scene';

/** The scene as the text of a JSON file. */
export function saveLayout(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`;
}

/**
 * True when two scenes describe the same building: the same rooms, doors,
 * windows and built-in blocks, whatever their colours and furniture.
 */
export function sameShell(a: Scene, b: Scene): boolean {
  const shape = (s: Scene): string =>
    JSON.stringify({
      rooms: s.rooms.map((r) => [r.id, r.kind ?? 'room', r.polygon, r.ceilingHeight ?? null, r.floor?.material ?? null]),
      openings: s.openings,
      solids: (s.solids ?? []).map((x) => [x.id, x.polygon, x.height ?? null]),
      thickness: s.defaults.exteriorWallThickness,
      height: s.defaults.ceilingHeight,
    });
  return shape(a) === shape(b);
}

export type LoadResult = { scene: Scene } | { error: string };

/**
 * Reads a saved layout and applies its furniture and colours to `current`.
 * The file must be a valid scene of the same home; lights, the sun and
 * the defaults stay as they are.
 */
export function loadLayout(text: string, current: Scene): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'That file is not JSON.' };
  }
  let loaded: Scene;
  try {
    loaded = parseScene(data);
  } catch (e) {
    return { error: e instanceof SceneError ? e.message : 'That file is not a layout.' };
  }
  if (!sameShell(loaded, current)) {
    return { error: 'That layout is for a home with different walls, so it cannot be loaded here.' };
  }
  return { scene: { ...current, rooms: loaded.rooms, solids: loaded.solids, furniture: loaded.furniture } };
}
