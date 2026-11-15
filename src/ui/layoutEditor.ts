import type { Vec2 } from '../core/collision';
import { dot, length, sub } from '../core/geometry';
import { addOpening, edgeLength, facingEdges, lastLayoutProblem, moveOpening, moveWall, outwardNormal, removeOpening, resizeOpening } from '../core/layoutEdits';
import { formatLength, type Units } from '../core/measure';
import { toVec, type Opening, type Room, type Scene } from '../core/scene';

/** What the editor needs from the viewer. */
export interface LayoutHost {
  now(): Scene;
  /** Shows a change while a drag is under way; ended by `commit`. */
  begin(): void;
  preview(next: Scene): void;
  commit(): void;
  /** Applies a change in one step, or shows `blocked` when it is not possible. */
  apply(next: Scene, blocked: string): boolean;
  /** Plan coordinates under the mouse, on this storey's floor. */
  floorPoint(e: PointerEvent): [number, number] | undefined;
  /** Screen pixels for a plan point on this storey's floor. */
  toScreen(x: number, y: number): [number, number];
  units(): Units;
  toast(message: string): void;
  /** The room shown on its own, if any: only its walls get handles. */
  onlyRoom(): string | undefined;
}

type Picked = { kind: 'wall'; room: string; edge: number } | { kind: 'opening'; id: string } | null;

const SVG = 'http://www.w3.org/2000/svg';
/** Walls move in 5 cm steps, the way a drawing is usually dimensioned. */
const STEP = 0.05;

/**
 * Change the layout: walls drawn as handles over the plan, to drag in or
 * out, and doors and windows on them to slide along, resize or remove.
 * Lives in Plan mode while it is switched on.
 */
export class LayoutEditor {
  on = false;
  private readonly layer = document.createElementNS(SVG, 'svg');
  private picked: Picked = null;
  private withFurniture = false;
  private drawnFrom: Scene | null = null;
  private drawnFor = '';
  private drag: { base: Scene; start: Vec2; apply: (p: Vec2) => Scene } | null = null;
  private readonly readout = document.createElement('div');

  constructor(private readonly host: LayoutHost, private readonly pane: HTMLElement, private readonly onChange: () => void) {
    this.layer.id = 'layout-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.style.display = 'none';
    this.readout.id = 'layout-readout';
    this.readout.hidden = true;
    document.body.append(this.layer, this.readout);
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', () => this.release());
  }

  setOn(on: boolean): void {
    this.on = on;
    if (!on) this.picked = null;
    // Walls and doors are easier to judge in empty rooms, so the furniture
    // steps aside each time; the pane can bring it back.
    if (on) this.withFurniture = false;
    this.layer.style.display = on ? '' : 'none';
    this.drawnFrom = null;
    this.renderPane();
    this.onChange();
  }

  /** Whether the furniture is on show: always, except while changing the layout with the rooms emptied. */
  get furnitureShown(): boolean {
    return !this.on || this.withFurniture;
  }

  /** Esc: drop the pick first, then leave. Returns true when it used the key. */
  escape(): boolean {
    if (!this.on) return false;
    if (this.picked) {
      this.picked = null;
      this.drawnFrom = null;
      this.renderPane();
    } else this.setOn(false);
    this.onChange();
    return true;
  }

  /** Delete: take out the picked door or window. */
  deletePicked(): boolean {
    if (!this.on || this.picked?.kind !== 'opening') return false;
    const id = this.picked.id;
    if (this.host.apply(removeOpening(this.host.now(), id), 'Nothing to remove.')) this.picked = null;
    this.renderPane();
    return true;
  }

  /** Called every frame while the plan is on screen, so the handles follow the camera. */
  place(visible: boolean): void {
    this.layer.style.display = this.on && visible ? '' : 'none';
    if (!this.on || !visible) return;
    const scene = this.host.now();
    const only = this.host.onlyRoom() ?? '';
    if (scene !== this.drawnFrom || only !== this.drawnFor) this.rebuild(scene);
    for (const el of this.layer.children) {
      const line = el as SVGLineElement;
      const [x1, y1, x2, y2] = (line.dataset.plan ?? '').split(',').map(Number);
      const a = this.host.toScreen(x1, y1);
      const b = this.host.toScreen(x2, y2);
      line.setAttribute('x1', String(a[0]));
      line.setAttribute('y1', String(a[1]));
      line.setAttribute('x2', String(b[0]));
      line.setAttribute('y2', String(b[1]));
    }
  }

  /** One line per wall (a shared wall only once) and one per door or window. */
  private rebuild(scene: Scene): void {
    this.drawnFrom = scene;
    const only = this.host.onlyRoom();
    this.drawnFor = only ?? '';
    const lines: SVGLineElement[] = [];
    const seen = new Set<string>();
    for (const room of scene.rooms) {
      if (room.kind === 'void' || (only && room.id !== only)) continue;
      room.polygon.forEach((_, edge) => {
        if (seen.has(`${room.id}/${edge}`) || edgeLength(room, edge) < 0.3) return;
        const behind = facingEdges(scene, room.id, edge);
        for (const f of behind) seen.add(`${f.room}/${f.edge}`);
        const [a, b] = ends(room, edge);
        const n = outwardNormal(room, edge);
        // Drawn in the middle of the wall: half the gap to the room behind, or 10 cm out.
        const half = behind.length ? gapTo(scene, room, edge, behind[0]) / 2 : 0.1;
        const line = document.createElementNS(SVG, 'line');
        line.dataset.plan = [a.x + n.x * half, a.y + n.y * half, b.x + n.x * half, b.y + n.y * half].join(',');
        line.setAttribute('class', `wall${this.isPicked({ kind: 'wall', room: room.id, edge }) ? ' picked' : ''}`);
        line.addEventListener('pointerdown', (e) => this.grabWall(e, room.id, edge));
        lines.push(line);
      });
    }
    for (const o of scene.openings) {
      const room = scene.rooms.find((r) => r.id === o.room);
      if (!room) continue;
      // A door declared on the next room still shows when it is in this room's wall.
      if (only && room.id !== only && !facingEdges(scene, room.id, o.edge).some((f) => f.room === only)) continue;
      const [a, b] = ends(room, o.edge);
      const u = unit(sub(b, a));
      const n = outwardNormal(room, o.edge);
      const behind = facingEdges(scene, room.id, o.edge);
      const half = behind.length ? gapTo(scene, room, o.edge, behind[0]) / 2 : 0.1;
      const p0 = { x: a.x + u.x * o.offset + n.x * half, y: a.y + u.y * o.offset + n.y * half };
      const p1 = { x: p0.x + u.x * o.width, y: p0.y + u.y * o.width };
      const line = document.createElementNS(SVG, 'line');
      line.dataset.plan = [p0.x, p0.y, p1.x, p1.y].join(',');
      line.setAttribute('class', `${o.type}${this.isPicked({ kind: 'opening', id: o.id }) ? ' picked' : ''}`);
      line.addEventListener('pointerdown', (e) => this.grabOpening(e, o));
      lines.push(line);
    }
    this.layer.replaceChildren(...lines);
  }

  private isPicked(p: Picked): boolean {
    return JSON.stringify(p) === JSON.stringify(this.picked);
  }

  private grabWall(e: PointerEvent, roomId: string, edge: number): void {
    e.stopPropagation();
    e.preventDefault();
    this.picked = { kind: 'wall', room: roomId, edge };
    const start = this.host.floorPoint(e);
    const base = this.host.now();
    const room = base.rooms.find((r) => r.id === roomId)!;
    const n = outwardNormal(room, edge);
    if (start) {
      this.host.begin();
      this.drag = {
        base,
        start: toVec(start),
        apply: (p) => {
          const along = Math.round(dot(sub(p, toVec(start)), n) / STEP) * STEP;
          const next = moveWall(base, roomId, edge, along);
          this.showReadout(e, along === 0 ? '' : next === base ? lastLayoutProblem() || 'It cannot go there.' : `${along > 0 ? 'Out' : 'In'} ${formatLength(Math.abs(along), this.host.units())}`, next === base && along !== 0);
          return next;
        },
      };
    }
    this.drawnFrom = null;
    this.renderPane();
    this.onChange();
  }

  private grabOpening(e: PointerEvent, o: Opening): void {
    e.stopPropagation();
    e.preventDefault();
    this.picked = { kind: 'opening', id: o.id };
    const start = this.host.floorPoint(e);
    const base = this.host.now();
    const room = base.rooms.find((r) => r.id === o.room)!;
    const [a, b] = ends(room, o.edge);
    const u = unit(sub(b, a));
    if (start) {
      this.host.begin();
      this.drag = {
        base,
        start: toVec(start),
        apply: (p) => {
          const slide = Math.round(dot(sub(p, toVec(start)), u) / 0.01) * 0.01;
          const next = moveOpening(base, o.id, o.offset + slide);
          const moved = next.openings.find((x) => x.id === o.id)!;
          this.showReadout(e, `${formatLength(moved.offset, this.host.units())} from the corner`, false);
          return next;
        },
      };
    }
    this.drawnFrom = null;
    this.renderPane();
    this.onChange();
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const p = this.host.floorPoint(e);
    if (!p) return;
    this.host.preview(this.drag.apply(toVec(p)));
    this.readout.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  }

  private release(): void {
    if (!this.drag) return;
    this.drag = null;
    this.readout.hidden = true;
    this.host.commit();
    this.renderPane();
  }

  private showReadout(e: PointerEvent, text: string, wrong: boolean): void {
    this.readout.hidden = !text;
    this.readout.textContent = text;
    this.readout.classList.toggle('wrong', wrong);
    this.readout.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  }

  /** Shows or hides the furniture while the layout changes. Only the view: nothing is taken out. */
  private furnitureButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quiet';
    b.textContent = this.withFurniture ? 'Hide furniture' : 'Show furniture';
    b.title = 'The rooms are shown empty while you change the layout; the furniture is still there.';
    b.addEventListener('click', () => {
      this.withFurniture = !this.withFurniture;
      b.blur();
      this.renderPane();
      this.onChange();
    });
    return b;
  }

  /** The panel's part: what is picked, and what can be done with it. */
  renderPane(): void {
    const scene = this.host.now();
    const units = this.host.units();
    const button = (label: string, run: () => void, quiet = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (quiet) b.className = 'quiet';
      b.addEventListener('click', () => {
        run();
        b.blur();
        this.renderPane();
      });
      return b;
    };
    const section = document.createElement('section');
    const title = document.createElement('h2');
    title.textContent = 'Change the layout';
    section.append(title);
    const text = (words: string, muted = false): void => {
      const p = document.createElement('p');
      p.textContent = words;
      if (muted) p.className = 'muted';
      section.append(p);
    };
    const row = (...buttons: HTMLButtonElement[]): void => {
      const div = document.createElement('div');
      div.className = 'row';
      div.append(...buttons);
      section.append(div);
    };

    if (!this.on) {
      text('Move walls, and add, move or remove doors and windows. Every change can be undone, and Keep saves it.', true);
      row(button('Change the layout', () => this.setOn(true)));
    } else if (!this.picked) {
      text('Drag a wall to move it. Click a wall to add a door or window to it. Drag a door or window along its wall.', true);
      row(button('Done', () => this.setOn(false)), this.furnitureButton());
    } else if (this.picked.kind === 'wall') {
      const { room: roomId, edge } = this.picked;
      const room = scene.rooms.find((r) => r.id === roomId);
      if (!room) {
        this.picked = null;
        return this.renderPane();
      }
      const behind = facingEdges(scene, roomId, edge).map((f) => scene.rooms.find((r) => r.id === f.room)?.name).filter(Boolean);
      text(`Wall of ${room.name}${behind.length ? ` and ${behind.join(', ')}` : ', outside'} · ${formatLength(edgeLength(room, edge), units)} long`);
      const along = edgeLength(room, edge) / 2;
      row(
        button('Add a door', () => this.add(roomId, edge, 'door', along)),
        button('Add a window', () => this.add(roomId, edge, 'window', along)),
      );
      const step = units === 'ft' ? 0.1524 : 0.1;
      const stepText = formatLength(step, units);
      row(
        button(`Out ${stepText}`, () => this.host.apply(moveWall(scene, roomId, edge, step), lastLayoutProblem() || 'The wall cannot go further out here.')),
        button(`In ${stepText}`, () => this.host.apply(moveWall(scene, roomId, edge, -step), lastLayoutProblem() || 'The wall cannot come further in here.')),
      );
      text(`"Out" makes ${room.name} bigger${behind.length ? ` and ${behind.join(', ')} smaller` : ''}.`, true);
      row(button('Done', () => this.setOn(false), true));
    } else {
      const id = this.picked.id;
      const o = scene.openings.find((x) => x.id === id);
      const room = o && scene.rooms.find((r) => r.id === o.room);
      if (!o || !room) {
        this.picked = null;
        return this.renderPane();
      }
      text(`${o.type === 'door' ? 'Door' : 'Window'} in ${room.name} · ${formatLength(o.width, units)} wide, ${formatLength(o.height, units)} high`);
      const step = units === 'ft' ? 0.1524 : 0.1;
      row(
        button('Narrower', () => this.host.apply(resizeOpening(scene, id, o.width - step), 'It cannot be any narrower.')),
        button('Wider', () => this.host.apply(resizeOpening(scene, id, o.width + step), 'There is no more wall to widen into.')),
        button('Remove', () => {
          if (this.host.apply(removeOpening(scene, id), 'Nothing to remove.')) this.picked = null;
        }, true),
      );
      text('Drag it along the wall to move it. Delete removes it.', true);
      row(button('Done', () => this.setOn(false), true));
    }
    this.pane.replaceChildren(section);
  }

  private add(roomId: string, edge: number, type: Opening['type'], at: number): void {
    const result = addOpening(this.host.now(), roomId, edge, type, at);
    if (this.host.apply(result.scene, lastLayoutProblem() || `No room for a ${type} on this wall.`) && result.id) {
      this.picked = { kind: 'opening', id: result.id };
      this.host.toast(`Added a ${type}. Drag it along the wall to place it.`);
    }
    this.drawnFrom = null;
  }
}

const ends = (room: Room, edge: number): [Vec2, Vec2] => [toVec(room.polygon[edge]), toVec(room.polygon[(edge + 1) % room.polygon.length])];
const unit = (v: Vec2): Vec2 => {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len };
};

/** The thickness of the wall between an edge and the facing edge of the room behind. */
function gapTo(scene: Scene, room: Room, edge: number, behind: { room: string; edge: number }): number {
  const other = scene.rooms.find((r) => r.id === behind.room);
  if (!other) return 0.2;
  const [a] = ends(room, edge);
  const [c] = ends(other, behind.edge);
  return Math.max(0, dot(sub(c, a), outwardNormal(room, edge)));
}
