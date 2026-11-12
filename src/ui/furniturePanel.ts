import { CATALOGUE } from '../core/catalogue';
import type { Furniture, Room, Scene } from '../core/scene';

export type Mode = 'furniture' | 'paint';

export interface PanelActions {
  setMode(mode: Mode): void;
  turn(deltaDeg: number): void;
  raise(delta: number): void;
  takeOut(): void;
  putBack(id: string): void;
  add(key: string): void;
  emptyRoom(): void;
  reset(): void;
  /** `done` is false while the colour picker is still being dragged. */
  paint(color: string, done: boolean): void;
  paintRoomWalls(color: string): void;
  resetPaint(): void;
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
  paint: { label: string; color: string; isWall: boolean } | undefined;
  canUndo: boolean;
  canRedo: boolean;
  topView: boolean;
}

/** The data type used when dragging a taken-out piece onto the canvas. */
export const DRAG_TYPE = 'application/x-furniture-id';

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

  constructor(private readonly actions: PanelActions) {
    const on = (id: string, run: () => void): void => {
      byId(id).addEventListener('click', (e) => {
        run();
        // Give the keyboard back to the page, so W A S D keeps walking.
        (e.currentTarget as HTMLElement).blur();
      });
    };
    on('tab-furniture', () => actions.setMode('furniture'));
    on('tab-paint', () => actions.setMode('paint'));
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

    byId('catalogue').replaceChildren(
      ...CATALOGUE.map((item) => {
        const button = document.createElement('button');
        button.textContent = `+ ${item.name}`;
        button.title = `Add: ${item.name}`;
        button.dataset.key = item.key;
        button.addEventListener('click', () => {
          actions.add(item.key);
          button.blur();
        });
        return button;
      }),
    );
  }

  render(state: PanelState): void {
    const { scene, selected, room } = state;

    byId('tab-furniture').classList.toggle('active', state.mode === 'furniture');
    byId('tab-paint').classList.toggle('active', state.mode === 'paint');
    byId('pane-furniture').hidden = state.mode !== 'furniture';
    byId('pane-paint').hidden = state.mode !== 'paint';

    const name = byId('selected-name');
    name.textContent = selected
      ? labelOf(selected)
      : 'Click a piece to select it, then drag it along the floor.';
    name.classList.toggle('muted', !selected);
    byId('selected-actions').hidden = !selected;
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
    button.title = 'Put it back where it stood';
    button.addEventListener('click', () => this.actions.putBack(f.id));

    li.append(swatch, name, button);
    return li;
  }
}
