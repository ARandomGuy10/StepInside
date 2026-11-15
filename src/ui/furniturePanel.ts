import { CATALOGUE, GROUPS } from '../core/catalogue';
import { TIGHT, OPEN_FLOOR } from '../core/fit';
import { formatLength, formatSize, type Units } from '../core/measure';
import type { Furniture, Room, Scene } from '../core/scene';
import { STYLES } from '../core/styles';
import { Thumbnails } from './thumbnails';

/**
 * What the panel is showing. 'explore' and 'plan' change nothing; 'paint' and
 * 'style' are the two tabs of Finishes; 'furniture' is Furnish.
 */
export type Mode = 'explore' | 'plan' | 'furniture' | 'paint' | 'style';

/** Material choices offered in the paint tab. `undefined` is a plain surface. */
const FLOOR_CHOICES: readonly [string | undefined, string][] = [
  ['laminate', 'Wood'], ['tile', 'Tiles'], ['large-tile', 'Large tiles'], ['stone', 'Stone'],
  ['concrete', 'Concrete'], ['decking', 'Decking'], [undefined, 'Plain'],
];
const WALL_CHOICES: readonly [string | undefined, string][] = [
  [undefined, 'Paint'], ['stone', 'Stone'], ['wood', 'Wood panels'], ['tile', 'Tiles'],
];

export interface PanelActions {
  setMode(mode: Mode): void;
  turn(deltaDeg: number): void;
  raise(delta: number): void;
  /** New width, height and depth in metres, typed into the size boxes. */
  resize(size: [number, number, number]): void;
  takeOut(): void;
  putBack(id: string): void;
  add(key: string): void;
  emptyRoom(): void;
  reset(): void;
  /** `done` is false while the colour picker is still being dragged. */
  paint(color: string, done: boolean): void;
  paintRoomWalls(color: string): void;
  resetPaint(): void;
  /** Gives the picked floor or wall a material; undefined makes it plain. */
  setMaterial(material: string | undefined): void;
  setRoomWallsMaterial(material: string | undefined): void;
  /** Restyles this floor, or the whole home when `allFloors` is set. */
  applyStyle(key: string, allFloors: boolean): void;
  save(): void;
  /** Called with the text of a file the user chose to load. */
  load(text: string): void;
  undo(): void;
  redo(): void;
  toggleTopView(): void;
}

export interface PanelState {
  scene: Scene;
  mode: Mode;
  selected: Furniture | undefined;
  room: Room | undefined;
  /** What the paint tab has picked: its label and current colour. */
  paint: { label: string; color: string; isWall: boolean; material?: { kind: 'floor' | 'wall'; current: string | undefined } } | undefined;
  /** True when the home has more than one storey. */
  storeys: boolean;
  canUndo: boolean;
  canRedo: boolean;
  topView: boolean;
  units: Units;
  /** Metres free in front of the selected piece; null when that does not apply. */
  fit: number | null;
}

/** The data type used when dragging a taken-out piece onto the canvas. */
export const DRAG_TYPE = 'application/x-furniture-id';
/** The data type used when dragging a catalogue card onto the canvas. */
export const CATALOGUE_DRAG = 'application/x-catalogue-key';

/** Ready-made colours for the paint tab: wall paints first, then stronger accents. */
const PALETTE = [
  '#ffffff', '#f1ece3', '#e6dccb', '#d8c7a6', '#c9b79c', '#b8946b', '#8c7b6b', '#4a3a30',
  '#dfe5dc', '#b7c4b1', '#7d8a74', '#40513b', '#dbe4ea', '#9fb4c7', '#4f6d8a', '#22313f',
  '#f3dcd4', '#e2a89a', '#c8553d', '#8f3f34', '#f2e3b3', '#e3b23c', '#8a8f98', '#22201d',
];

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export const labelOf = (f: Furniture): string => f.name ?? f.id;

/**
 * The side panel with its Furniture and Paint tabs. It is plain HTML: the
 * markup lives in index.html and this class fills it in from the current
 * state on every change.
 */
export class FurniturePanel {
  private toastTimer: number | undefined;
  private removedKey = '';
  private materialKey = '';
  /** The material the picked wall has, for "use on all walls". */
  private wallMaterial: string | undefined;
  private readonly thumbs = new Thumbnails();
  private catalogueUnits: Units | null = null;
  private drawingKey = '';

  constructor(readonly actions: PanelActions) {
    const on = (id: string, run: () => void): void => {
      byId(id).addEventListener('click', (e) => {
        run();
        // Give the keyboard back to the page, so W A S D keeps walking.
        (e.currentTarget as HTMLElement).blur();
      });
    };
    on('tab-paint', () => actions.setMode('paint'));
    on('tab-style', () => actions.setMode('style'));
    on('btn-reset-style', () => actions.resetPaint());
    on('btn-material-room', () => actions.setRoomWallsMaterial(this.wallMaterial));

    const allFloors = byId<HTMLInputElement>('style-all');
    byId('styles').replaceChildren(
      ...STYLES.map((style) => {
        const button = document.createElement('button');
        button.className = 'style-card';
        button.dataset.key = style.key;
        const strip = document.createElement('span');
        strip.className = 'strip';
        for (const color of [style.wall, style.floor.color, style.fabric, style.wood, style.kitchen]) {
          const swatch = document.createElement('i');
          swatch.style.background = color;
          strip.append(swatch);
        }
        const name = document.createElement('strong');
        name.textContent = style.name;
        const about = document.createElement('span');
        about.textContent = style.about;
        button.append(strip, name, about);
        button.addEventListener('click', () => {
          actions.applyStyle(style.key, allFloors.checked);
          button.blur();
        });
        return button;
      }),
    );
    on('btn-top', () => actions.toggleTopView());
    on('btn-turn-left', () => actions.turn(-15));
    on('btn-turn-right', () => actions.turn(15));
    on('btn-turn-90', () => actions.turn(90));
    on('btn-raise', () => actions.raise(0.05));
    on('btn-lower', () => actions.raise(-0.05));
    on('btn-take-out', () => actions.takeOut());
    on('btn-empty', () => actions.emptyRoom());
    on('btn-reset', () => actions.reset());
    on('btn-undo', () => actions.undo());
    on('btn-redo', () => actions.redo());
    on('btn-reset-paint', () => actions.resetPaint());
    on('btn-save', () => actions.save());
    // The Load button opens the browser's file chooser through a hidden input.
    const file = byId<HTMLInputElement>('file-load');
    on('btn-load', () => file.click());
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      file.value = ''; // so choosing the same file again fires "change"
      if (chosen) void chosen.text().then((text) => actions.load(text));
    });

    // The size boxes show centimetres; the scene file stores metres.
    const sizeBoxes = ['size-w', 'size-h', 'size-d'].map((id) => byId<HTMLInputElement>(id));
    for (const box of sizeBoxes) {
      box.addEventListener('change', () => {
        const [w, h, d] = sizeBoxes.map((b) => Number(b.value) / 100);
        actions.resize([w, h, d]);
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') box.blur(); // leaving the box applies the change
      });
    }

    const picker = byId<HTMLInputElement>('paint-color');
    // "input" fires while the picker is dragged, "change" when it closes.
    picker.addEventListener('input', () => actions.paint(picker.value, false));
    picker.addEventListener('change', () => actions.paint(picker.value, true));
    on('btn-paint-room', () => actions.paintRoomWalls(picker.value));

    byId('palette').replaceChildren(
      ...PALETTE.map((color) => {
        const button = document.createElement('button');
        button.style.background = color;
        button.title = color;
        button.dataset.color = color;
        button.addEventListener('click', () => {
          actions.paint(color, true);
          button.blur();
        });
        return button;
      }),
    );

    const search = byId<HTMLInputElement>('catalogue-search');
    search.addEventListener('input', () => this.filterCatalogue(search.value));
    search.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name must not walk or switch tools
      if (e.key === 'Escape') {
        search.value = '';
        this.filterCatalogue('');
        search.blur();
      }
    });
  }

  /** The catalogue as cards on shelves. Rebuilt when the units change, so sizes read right. */
  private buildCatalogue(units: Units): void {
    this.catalogueUnits = units;
    const shelves = GROUPS.map((group) => {
      const items = CATALOGUE.filter((item) => item.group === group);
      const shelf = document.createElement('section');
      shelf.className = 'shelf';
      shelf.dataset.group = group;
      const title = document.createElement('h3');
      title.textContent = group;
      const cards = document.createElement('div');
      cards.className = 'cards';
      cards.append(
        ...items.map((item) => {
          const card = document.createElement('button');
          card.className = 'cat-card';
          card.dataset.key = item.key;
          card.dataset.find = item.name.toLowerCase();
          card.draggable = true;
          const [w, h, d] = item.size;
          card.title = `Add: ${item.name}. ${formatSize(w, d, units)}, ${formatLength(h, units)} high`;
          const picture = document.createElement('span');
          picture.className = 'picture';
          const name = document.createElement('strong');
          name.textContent = item.name;
          const size = document.createElement('span');
          size.className = 'size';
          size.textContent = item.mount === 'wall' ? formatSize(w, h, units) : formatSize(w, d, units);
          card.append(picture, name, size);
          card.addEventListener('click', () => {
            this.actions.add(item.key);
            card.blur();
          });
          card.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData(CATALOGUE_DRAG, item.key);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
            const img = picture.querySelector('img');
            if (img && e.dataTransfer) e.dataTransfer.setDragImage(img, 36, 36);
          });
          return card;
        }),
      );
      shelf.append(title, cards);
      return shelf;
    });
    byId('catalogue').replaceChildren(...shelves);
    this.filterCatalogue(byId<HTMLInputElement>('catalogue-search').value);
    this.drawPictures();
  }

  /** Draws the card pictures a few at a time, so opening Furnish stays smooth. */
  private drawPictures(): void {
    const waiting = [...document.querySelectorAll<HTMLElement>('#catalogue .picture:empty')];
    const next = (): void => {
      const started = performance.now();
      while (waiting.length && performance.now() - started < 12) {
        const slot = waiting.shift()!;
        const item = CATALOGUE.find((c) => c.key === slot.parentElement?.dataset.key);
        if (!item) continue;
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        slot.append(img);
        this.thumbs.of(item.key, item, (url) => (img.src = url));
      }
      if (waiting.length) requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }

  private filterCatalogue(text: string): void {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const shelf of document.querySelectorAll<HTMLElement>('#catalogue .shelf')) {
      let any = false;
      for (const card of shelf.querySelectorAll<HTMLElement>('.cat-card')) {
        const hit = words.every((w) => card.dataset.find!.includes(w));
        card.hidden = !hit;
        any ||= hit;
        if (hit) shown++;
      }
      shelf.hidden = !any;
    }
    byId('catalogue-none').hidden = shown > 0;
  }

  /** "Fits, 85 cm clear in front", or a warning when it is tight. */
  private renderFit(selected: Furniture | undefined, fit: number | null, units: Units): void {
    const el = byId('selected-fit');
    el.hidden = !selected || selected.fixed === true || fit === null;
    if (el.hidden) return;
    const tight = fit! < TIGHT;
    el.className = tight ? 'fit tight' : 'fit';
    el.textContent = fit! >= OPEN_FLOOR
      ? `Fits, with open floor in front.`
      : tight
        ? `Tight: ${formatLength(fit!, units)} clear in front. Most people want about ${formatLength(TIGHT, units)} to walk past or sit.`
        : `Fits, with ${formatLength(fit!, units)} clear in front.`;
  }

  /** The front and side of the selected piece, drawn flat with its sizes. */
  private renderDrawing(selected: Furniture | undefined, units: Units): void {
    const box = byId('selected-drawing');
    const key = selected && !selected.fixed ? `${selected.model}|${selected.size.join(',')}|${selected.color}|${units}` : '';
    box.hidden = !key;
    if (key === this.drawingKey) return;
    this.drawingKey = key;
    if (!selected || !key) return box.replaceChildren();
    const [w, h, d] = selected.size;
    const withSide = d >= 0.1;
    const gap = 46;
    const room = { width: 236 - (withSide ? gap : 0) - 30, height: 96 };
    const scale = Math.min(room.width / (w + (withSide ? d : 0)), room.height / h, 140);
    const fw = w * scale;
    const sw = d * scale;
    const ht = h * scale;
    const left = 30;
    const top = 6;
    const total = { w: left + fw + (withSide ? gap + sw : 0) + 4, h: top + ht + 30 };
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${total.w} ${total.h}`);
    svg.setAttribute('width', String(total.w));
    svg.setAttribute('height', String(total.h));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Front and side of ${labelOf(selected)}`);
    const add = (tag: string, attrs: Record<string, string | number>, text?: string): void => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (text) el.textContent = text;
      svg.append(el);
    };
    const view = (x: number, width: number, side: 'front' | 'side', label: string): void => {
      add('line', { x1: x - 4, y1: top + ht, x2: x + width + 4, y2: top + ht, class: 'ground' });
      // An outline first; the picture covers it once it is drawn.
      add('rect', { x, y: top, width, height: ht, class: 'outline' });
      const outline = svg.lastElementChild!;
      const picture = document.createElementNS(NS, 'image');
      for (const [k, v] of Object.entries({ x, y: top, width, height: ht })) picture.setAttribute(k, String(v));
      svg.append(picture);
      this.thumbs.elevation(selected, side, scale * 2, (url) => {
        picture.setAttribute('href', url);
        outline.remove();
      });
      add('text', { x: x + width / 2, y: top + ht + 26, class: 'view' }, label);
    };
    /** A tape-style size line with ticks at both ends. */
    const tape = (x1: number, y1: number, x2: number, y2: number, text: string, upright = false): void => {
      add('line', { x1, y1, x2, y2, class: 'dim' });
      const tick = 3;
      if (upright) {
        add('line', { x1: x1 - tick, y1, x2: x1 + tick, y2: y1, class: 'dim' });
        add('line', { x1: x2 - tick, y1: y2, x2: x2 + tick, y2, class: 'dim' });
        add('text', { x: x1 - 5, y: (y1 + y2) / 2, class: 'size', transform: `rotate(-90 ${x1 - 5} ${(y1 + y2) / 2})` }, text);
      } else {
        add('line', { x1, y1: y1 - tick, x2: x1, y2: y1 + tick, class: 'dim' });
        add('line', { x1: x2, y1: y2 - tick, x2, y2: y2 + tick, class: 'dim' });
        add('text', { x: (x1 + x2) / 2, y: y1 + 10, class: 'size' }, text);
      }
    };
    view(left, fw, 'front', 'Front');
    tape(left, top + ht + 6, left + fw, top + ht + 6, formatLength(w, units));
    tape(left - 10, top, left - 10, top + ht, formatLength(h, units), true);
    if (withSide) {
      const sx = left + fw + gap;
      view(sx, sw, 'side', 'Side');
      tape(sx, top + ht + 6, sx + sw, top + ht + 6, formatLength(d, units));
    }
    box.replaceChildren(svg);
  }

  render(state: PanelState): void {
    const { scene, selected, room } = state;

    byId('tab-paint').classList.toggle('active', state.mode === 'paint');
    byId('pane-explore').hidden = state.mode !== 'explore';
    byId('pane-plan').hidden = state.mode !== 'plan';
    byId('finish-tabs').hidden = state.mode !== 'paint' && state.mode !== 'style';
    byId('pane-furniture').hidden = state.mode !== 'furniture';
    // The cards are built the first time Furnish opens, and again for new units.
    if (state.mode === 'furniture' && this.catalogueUnits !== state.units) this.buildCatalogue(state.units);
    if (state.mode === 'furniture') {
      this.renderFit(selected, state.fit, state.units);
      this.renderDrawing(selected, state.units);
    }
    byId('pane-paint').hidden = state.mode !== 'paint';
    byId('tab-style').classList.toggle('active', state.mode === 'style');
    byId('pane-style').hidden = state.mode !== 'style';
    byId('style-scope').hidden = !state.storeys;

    const name = byId('selected-name');
    name.textContent = selected
      ? labelOf(selected)
      : 'Click a piece to select it, then drag it along the floor.';
    name.classList.toggle('muted', !selected);
    // A fixed piece, such as a staircase, has nothing to turn or resize.
    const movable = !!selected && !selected.fixed;
    byId('selected-actions').hidden = !movable;
    byId('selected-size').hidden = !movable;
    if (selected) {
      // Scene order is width, height, depth. Leave a box alone while it is typed in.
      ['size-w', 'size-h', 'size-d'].forEach((id, i) => {
        const box = byId<HTMLInputElement>(id);
        if (document.activeElement !== box) box.value = String(Math.round(selected.size[i] * 1000) / 10);
      });
    }
    const onWall = selected?.mount === 'wall';
    for (const id of ['btn-turn-left', 'btn-turn-right', 'btn-turn-90']) byId(id).hidden = onWall;
    for (const id of ['btn-raise', 'btn-lower']) byId(id).hidden = !onWall;

    byId('room-name').textContent = room?.name ?? 'none';
    byId<HTMLButtonElement>('btn-empty').disabled =
      !room || !scene.furniture.some((f) => f.room === room.id && !f.removed);
    byId<HTMLButtonElement>('btn-undo').disabled = !state.canUndo;
    byId<HTMLButtonElement>('btn-redo').disabled = !state.canRedo;
    byId('btn-top').classList.toggle('active', state.topView);
    byId('btn-top').textContent = state.topView ? 'Walk view' : 'Top view';

    const paintName = byId('paint-name');
    paintName.textContent = state.paint?.label ?? 'Click a wall, floor, ceiling or piece of furniture to pick it.';
    paintName.classList.toggle('muted', !state.paint);
    byId('paint-controls').hidden = !state.paint;
    if (state.paint) {
      const color = state.paint.color.toLowerCase();
      const picker = byId<HTMLInputElement>('paint-color');
      // Leave the picker alone while it is the thing being dragged.
      if (document.activeElement !== picker) picker.value = color;
      byId('paint-hex').textContent = color;
      byId('btn-paint-room').hidden = !state.paint.isWall;
      for (const button of byId('palette').children) {
        button.classList.toggle('current', (button as HTMLElement).dataset.color === color);
      }
    }
    this.renderMaterials(state.paint?.material);

    const removed = scene.furniture.filter((f) => f.removed);
    byId('removed-empty').hidden = removed.length > 0;
    byId('removed-help').hidden = removed.length === 0;
    // Only rebuild the list when it changed, so a drag in progress survives.
    const key = removed.map((f) => f.id).join('|');
    if (key !== this.removedKey) {
      this.removedKey = key;
      byId('removed').replaceChildren(...removed.map((f) => this.removedItem(f)));
    }
  }

  /** The material chips for a picked floor or wall. */
  private renderMaterials(material: { kind: 'floor' | 'wall'; current: string | undefined } | undefined): void {
    byId('material-box').hidden = !material;
    if (!material) return;
    this.wallMaterial = material.kind === 'wall' ? material.current : undefined;
    byId('btn-material-room').hidden = material.kind !== 'wall';
    const choices = material.kind === 'floor' ? FLOOR_CHOICES : WALL_CHOICES;
    // A floor of a material not on the list (a lawn) shows it as an extra choice.
    const list = choices.some(([key]) => key === material.current)
      ? choices
      : [...choices, [material.current, material.current ?? 'Plain'] as [string | undefined, string]];
    const key = `${material.kind}|${list.map(([k]) => k).join(',')}`;
    if (key !== this.materialKey) {
      this.materialKey = key;
      byId('materials').replaceChildren(
        ...list.map(([value, label]) => {
          const button = document.createElement('button');
          button.textContent = label;
          button.dataset.material = value ?? '';
          button.addEventListener('click', () => {
            this.actions.setMaterial(value);
            button.blur();
          });
          return button;
        }),
      );
    }
    for (const button of byId('materials').children) {
      button.classList.toggle('current', (button as HTMLElement).dataset.material === (material.current ?? ''));
    }
  }

  toast(message: string): void {
    const el = byId('toast');
    el.textContent = message;
    el.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), 2600);
  }

  private removedItem(f: Furniture): HTMLLIElement {
    const li = document.createElement('li');
    li.draggable = true;
    li.title = 'Drag onto the floor to put it back';
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, f.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = f.color ?? '#8a8f98';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = labelOf(f);

    const button = document.createElement('button');
    button.textContent = 'Put back';
    button.className = 'small';
    button.title = 'Put it back where it stood';
    button.addEventListener('click', () => this.actions.putBack(f.id));

    li.append(swatch, name, button);
    return li;
  }
}
