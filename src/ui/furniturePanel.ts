import type { Furniture, Room, Scene } from '../core/scene';

export interface PanelActions {
  turn(deltaDeg: number): void;
  takeOut(): void;
  putBack(id: string): void;
  emptyRoom(): void;
  reset(): void;
  undo(): void;
  redo(): void;
  toggleTopView(): void;
}

export interface PanelState {
  scene: Scene;
  selected: Furniture | undefined;
  room: Room | undefined;
  canUndo: boolean;
  canRedo: boolean;
  topView: boolean;
}

/** The data type used when dragging a taken-out piece onto the canvas. */
export const DRAG_TYPE = 'application/x-furniture-id';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export const labelOf = (f: Furniture): string => f.name ?? f.id;

/**
 * The Furniture panel. It is plain HTML: the markup lives in index.html
 * and this class fills it in from the current state on every change.
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
    on('btn-top', () => actions.toggleTopView());
    on('btn-turn-left', () => actions.turn(-15));
    on('btn-turn-right', () => actions.turn(15));
    on('btn-turn-90', () => actions.turn(90));
    on('btn-take-out', () => actions.takeOut());
    on('btn-empty', () => actions.emptyRoom());
    on('btn-reset', () => actions.reset());
    on('btn-undo', () => actions.undo());
    on('btn-redo', () => actions.redo());
  }

  render(state: PanelState): void {
    const { scene, selected, room } = state;

    const name = byId('selected-name');
    name.textContent = selected
      ? labelOf(selected)
      : 'Click a piece to select it, then drag it along the floor.';
    name.classList.toggle('muted', !selected);
    byId('selected-actions').hidden = !selected;

    byId('room-name').textContent = room?.name ?? 'none';
    byId<HTMLButtonElement>('btn-empty').disabled =
      !room || !scene.furniture.some((f) => f.room === room.id && !f.removed);
    byId<HTMLButtonElement>('btn-undo').disabled = !state.canUndo;
    byId<HTMLButtonElement>('btn-redo').disabled = !state.canRedo;
    byId('btn-top').classList.toggle('active', state.topView);
    byId('btn-top').textContent = state.topView ? 'Walk view' : 'Top view';

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
