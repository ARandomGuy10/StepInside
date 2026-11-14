import {
  ArrowDown, ArrowUp, Bookmark, Box, ChevronDown, ChevronUp, Columns2, createElement, Download, FileText, Footprints,
  Link, Minus, PaintRoller, Play, Plus, Redo2, RotateCcw, RotateCw, Ruler, Share2, Sofa, Square, SwatchBook, Trash2,
  Undo2, Upload, X, type IconNode,
} from 'lucide';

/**
 * The viewer's icons, from the Lucide set: one weight, one size. Buttons in
 * the markup ask for one with `data-icon="undo"`; `hydrateIcons` puts it in.
 */
const ICONS: Record<string, IconNode> = {
  'turn-left': RotateCcw, 'turn-right': RotateCw, up: ArrowUp, down: ArrowDown, remove: Trash2, undo: Undo2, redo: Redo2,
  save: Download, load: Upload, plus: Plus, minus: Minus, play: Play, stop: Square, share: Share2, bookmark: Bookmark,
  ruler: Ruler, file: FileText, close: X, 'chevron-down': ChevronDown, 'chevron-up': ChevronUp, compare: Columns2,
  walk: Footprints, link: Link, furniture: Sofa, paint: PaintRoller, style: SwatchBook, box: Box,
};

export type IconName = keyof typeof ICONS;

export function icon(name: string): SVGElement {
  const svg = createElement(ICONS[name] ?? X);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  return svg as SVGElement;
}

/** Sets a button's icon and words. With no words the button is the icon alone, named for screen readers by `title`. */
export function setLabel(button: HTMLElement, name: string, text = ''): void {
  button.replaceChildren(icon(name));
  if (text) button.append(text);
  else {
    button.classList.add('icon-only');
    if (button.title) button.setAttribute('aria-label', button.title);
  }
}

/** Fills in every `data-icon` element under `root`, keeping its words. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const text = el.textContent?.trim() ?? '';
    setLabel(el, el.dataset.icon!, text);
    delete el.dataset.icon;
  }
}
