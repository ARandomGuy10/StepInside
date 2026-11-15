import type { Mode } from './furniturePanel';

/**
 * The four things a person does with a home. Each has its own tools in the
 * panel and on the rail, and its own meaning for a click on the model.
 */
export type Work = 'explore' | 'plan' | 'finishes' | 'furnish';

export const WORKS: readonly { work: Work; note: string }[] = [
  { work: 'explore', note: 'Look only. Nothing here changes the home.' },
  { work: 'plan', note: 'The drawing. Its tools are in the bar on the right: sizes, measure, notes, areas, cost and PDF.' },
  { work: 'finishes', note: 'Click a surface to change its colour or material.' },
  { work: 'furnish', note: 'Click a piece to move, turn or resize it.' },
];

/** Finishes has two tabs of its own, paint and style; the other three map one to one. */
export const workOf = (mode: Mode): Work =>
  mode === 'furniture' ? 'furnish' : mode === 'paint' || mode === 'style' ? 'finishes' : mode;

/** True in the modes where a click changes the home. */
export const edits = (mode: Mode): boolean => mode === 'furniture' || mode === 'paint' || mode === 'style';
