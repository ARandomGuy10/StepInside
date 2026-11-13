import type { Room } from './scene';

export type Units = 'm' | 'ft';

/** A length in metres as text: "3.45 m", or feet and inches such as 12′ 6″. */
export function formatLength(metres: number, units: Units): string {
  if (units === 'm') return `${metres.toFixed(2)} m`;
  const inches = Math.round(metres / 0.0254);
  const feet = Math.floor(inches / 12);
  const rest = inches % 12;
  return rest === 0 ? `${feet}′` : `${feet}′ ${rest}″`;
}

/** Width (across the page) and depth (down the page) of the box round a room, in metres. */
export function roomSize(room: Room): { width: number; depth: number; center: [number, number] } {
  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { width: x1 - x0, depth: y1 - y0, center: [(x0 + x1) / 2, (y0 + y1) / 2] };
}

/** "12′ × 15′" or "3.66 × 4.57 m". */
export function formatSize(width: number, depth: number, units: Units): string {
  if (units === 'm') return `${width.toFixed(2)} × ${depth.toFixed(2)} m`;
  return `${formatLength(width, units)} × ${formatLength(depth, units)}`;
}
