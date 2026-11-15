import type { Scene } from './scene';

/**
 * Counts what differs between the home as it was last kept and as it is now:
 * one for every piece of furniture, room, door, window or built-in block that changed,
 * arrived or left. Scenes are immutable, so an untouched thing is the very
 * same object in both and costs one comparison.
 */
export function countChanges(kept: readonly Scene[], current: readonly Scene[]): number {
  if (kept === current) return 0;
  let n = 0;
  current.forEach((scene, i) => {
    const before = kept[i];
    if (!before || before === scene) return;
    n += differing(before.furniture, scene.furniture);
    n += differing(before.rooms, scene.rooms);
    n += differing(before.solids ?? [], scene.solids ?? []);
    n += differing(before.openings, scene.openings);
  });
  return n;
}

function differing<T extends { id: string }>(before: readonly T[], after: readonly T[]): number {
  if (before === after) return 0;
  const old = new Map(before.map((item) => [item.id, item]));
  let n = 0;
  for (const item of after) {
    if (old.get(item.id) !== item) n++;
    old.delete(item.id);
  }
  return n + old.size;
}
